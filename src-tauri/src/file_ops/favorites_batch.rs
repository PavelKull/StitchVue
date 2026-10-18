use std::collections::HashSet;
use std::sync::Mutex;

use serde::Serialize;

use super::favorites::{
    load_removal_context, plan_removal_with_scan, preview_plan, removal_classify_debug,
    remove_favorite_copy_distributed_with_scan, BatchRemovalScanCaches, RemovalClassifyDebug,
    RemoveFavoriteCopyResult,
};
use super::normalize_key;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteCopyOrigin {
    pub copy_path: String,
    pub origin_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteBatchPathResult {
    pub path: String,
    pub result: RemoveFavoriteCopyResult,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub classify_debug: Option<RemovalClassifyDebug>,
}

#[derive(Debug, Clone)]
pub struct FavoriteBatchRemoveItem {
    pub path: String,
    pub confirmed: bool,
    pub resolution: Option<String>,
}

/// T040 / R9: бакеты preview для массового снятия избранного.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreviewConfirmBucket {
    Fr11Required,
    StandardConfirm,
    Ready,
    Other,
}

/// Сгруппированный результат preview (эквивалент Vec + классификация для UI).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteBatchPreviewBuckets {
    pub fr11_required: Vec<FavoriteBatchPathResult>,
    pub standard_confirm: Vec<FavoriteBatchPathResult>,
    pub ready: Vec<FavoriteBatchPathResult>,
    /// failed / skipped и прочие статусы вне трёх основных бакетов.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub other: Vec<FavoriteBatchPathResult>,
}

/// CL-P03: UnknownOrigin / Ambiguous → `fr11Required`; прочий needs_confirm → standardConfirm; ready → ready.
pub fn classify_preview_bucket(result: &RemoveFavoriteCopyResult) -> PreviewConfirmBucket {
    match result.status.as_str() {
        "ready" => PreviewConfirmBucket::Ready,
        "needs_confirm" => {
            // DTO-hint (T023) или confirm_kind — оба надёжны для Ambiguous/Unknown.
            if result.fr11_required == Some(true)
                || matches!(
                    result.confirm_kind.as_deref(),
                    Some("unknown_origin") | Some("ambiguous_origin")
                )
            {
                PreviewConfirmBucket::Fr11Required
            } else {
                PreviewConfirmBucket::StandardConfirm
            }
        }
        _ => PreviewConfirmBucket::Other,
    }
}

pub fn bucket_preview_results(rows: Vec<FavoriteBatchPathResult>) -> FavoriteBatchPreviewBuckets {
    let mut fr11_required = Vec::new();
    let mut standard_confirm = Vec::new();
    let mut ready = Vec::new();
    let mut other = Vec::new();
    for row in rows {
        match classify_preview_bucket(&row.result) {
            PreviewConfirmBucket::Fr11Required => fr11_required.push(row),
            PreviewConfirmBucket::StandardConfirm => standard_confirm.push(row),
            PreviewConfirmBucket::Ready => ready.push(row),
            PreviewConfirmBucket::Other => other.push(row),
        }
    }
    FavoriteBatchPreviewBuckets {
        fr11_required,
        standard_confirm,
        ready,
        other,
    }
}

/// Functionally equivalent to sequential `preview_remove_favorite_copy` per path (single IPC).
pub fn preview_remove_favorite_copies(
    db_mutex: &Mutex<rusqlite::Connection>,
    paths: &[String],
) -> Result<Vec<FavoriteBatchPathResult>, String> {
    let ordered = dedupe_preserve_order(paths);
    let mut out = Vec::with_capacity(ordered.len());
    let mut scan_caches = BatchRemovalScanCaches::new();
    for path in ordered {
        let ctx = {
            let guard = db_mutex.lock().unwrap_or_else(|err| err.into_inner());
            load_removal_context(&guard, &path)?
        };
        let plan = plan_removal_with_scan(&path, &ctx, Some(&mut scan_caches))?;
        let result = preview_plan(&plan);
        let classify_debug = if result.status == "needs_confirm" {
            Some(removal_classify_debug(&path, &ctx, &plan)?)
        } else {
            None
        };
        out.push(FavoriteBatchPathResult {
            path,
            result,
            classify_debug,
        });
    }
    Ok(out)
}

/// T040: тот же preview, сразу разложенный по бакетам fr11Required / standardConfirm / ready.
pub fn preview_remove_favorite_copies_bucketed(
    db_mutex: &Mutex<rusqlite::Connection>,
    paths: &[String],
) -> Result<FavoriteBatchPreviewBuckets, String> {
    let rows = preview_remove_favorite_copies(db_mutex, paths)?;
    Ok(bucket_preview_results(rows))
}

/// Batch execute: каждый элемент — свой `confirmed` / `resolution` (T041).
/// FR-11 (UnknownOrigin/Ambiguous) без resolution не auto-relocate/recycle — делегирует
/// в `remove_favorite_copy_distributed_with_scan` (тот же контракт, что single-path).
pub fn remove_favorite_copies_batch(
    db_mutex: &Mutex<rusqlite::Connection>,
    items: &[FavoriteBatchRemoveItem],
) -> Result<Vec<FavoriteBatchPathResult>, String> {
    let mut out = Vec::with_capacity(items.len());
    let mut scan_caches = BatchRemovalScanCaches::new();
    for item in items {
        let result = match remove_favorite_copy_distributed_with_scan(
            db_mutex,
            &item.path,
            item.confirmed,
            item.resolution.as_deref(),
            Some(&mut scan_caches),
        ) {
            Ok(result) => result,
            // Конструктор обязателен после optional DTO-полей на RemoveFavoriteCopyResult (T023).
            Err(message) => RemoveFavoriteCopyResult::failed(message),
        };
        out.push(FavoriteBatchPathResult {
            path: item.path.clone(),
            result,
            classify_debug: None,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database;
    use rusqlite::Connection;
    use std::sync::Mutex;

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        database::migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn batch_preview_dedupes_paths() {
        let path = r"C:\Album\Избранное\a.jpg".to_string();
        let ordered = dedupe_preserve_order(&[path.clone(), path.clone()]);
        assert_eq!(ordered.len(), 1);
        assert_eq!(ordered[0], path);
    }

    #[test]
    fn batch_remove_reports_per_file_failure_without_aborting_batch() {
        let db = Mutex::new(memory_db());
        let items = vec![
            FavoriteBatchRemoveItem {
                path: r"C:\Album\Избранное\missing.jpg".to_string(),
                confirmed: false,
                resolution: None,
            },
            FavoriteBatchRemoveItem {
                path: r"C:\Album\Избранное\other.jpg".to_string(),
                confirmed: false,
                resolution: None,
            },
        ];
        let out = remove_favorite_copies_batch(&db, &items).unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].result.status, "failed");
        assert_eq!(out[1].result.status, "failed");
    }

    fn dto(
        status: &str,
        confirm_kind: Option<&str>,
        fr11_required: Option<bool>,
    ) -> RemoveFavoriteCopyResult {
        RemoveFavoriteCopyResult {
            status: status.to_string(),
            undo_id: String::new(),
            removed_service_folder: None,
            restored_path: None,
            notice_code: None,
            confirm_kind: confirm_kind.map(str::to_string),
            trash_path: None,
            cleanup_status: None,
            reconcile_suggested: None,
            fr11_required,
        }
    }

    #[test]
    fn classify_preview_bucket_maps_fr11_standard_ready() {
        assert_eq!(
            classify_preview_bucket(&dto("ready", None, None)),
            PreviewConfirmBucket::Ready
        );
        assert_eq!(
            classify_preview_bucket(&dto("needs_confirm", Some("unknown_origin"), Some(true))),
            PreviewConfirmBucket::Fr11Required
        );
        assert_eq!(
            classify_preview_bucket(&dto("needs_confirm", Some("ambiguous_origin"), Some(true))),
            PreviewConfirmBucket::Fr11Required
        );
        assert_eq!(
            classify_preview_bucket(&dto("needs_confirm", Some("origin_changed"), None)),
            PreviewConfirmBucket::StandardConfirm
        );
    }
}

fn dedupe_preserve_order(paths: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for path in paths {
        let key = normalize_key(Path::new(path));
        if seen.insert(key) {
            out.push(path.clone());
        }
    }
    out
}
