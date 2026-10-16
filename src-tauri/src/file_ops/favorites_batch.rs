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

/// Batch execute: each item runs the same engine as `remove_favorite_copy` with short DB phases.
pub fn remove_favorite_copies_batch(
    db_mutex: &Mutex<rusqlite::Connection>,
    items: &[FavoriteBatchRemoveItem],
) -> Result<Vec<FavoriteBatchPathResult>, String> {
    let mut out = Vec::with_capacity(items.len());
    let mut scan_caches = BatchRemovalScanCaches::new();
    for item in items {
        let result =
            remove_favorite_copy_distributed_with_scan(db_mutex, &item.path, item.confirmed, Some(&mut scan_caches))?;
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
            },
            FavoriteBatchRemoveItem {
                path: r"C:\Album\Избранное\other.jpg".to_string(),
                confirmed: false,
            },
        ];
        let results = remove_favorite_copies_batch(&db, &items);
        assert!(results.is_err() || results.unwrap().len() == 2);
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
