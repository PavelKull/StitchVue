use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use serde::Serialize;

use super::content_hash::sha256_file;
use super::recycle::{authorize_favorite_copy, recycle_path, RecycleStatus};
use super::{
    active_favorites_folder, is_reparse, path_string_for_app, read_service_role, same_path,
    try_lock_paths, ServiceFolderLocation, ServiceRole,
};
use crate::database::{self, FavoriteSnapshot};

const COPY_CHUNK: usize = 1024 * 1024;
const MAX_SUFFIX: u32 = 10_000;
const META_TOLERANCE_MS: i64 = 2_000;

/// Origins whose copies sit in the current active favorites folder of `directory`.
/// Missing files and historical collections do not yield stars and do not delete rows.
pub fn active_favorite_origins_in(
    db: &rusqlite::Connection,
    directory: &str,
) -> Result<Vec<String>, String> {
    let parent = Path::new(directory);
    let Some(active) = active_favorites_folder(parent) else {
        return Ok(Vec::new());
    };
    let rows = database::favorite_origin_paths(db)?;
    let mut origins = Vec::new();
    for (origin, copy) in rows {
        let origin_path = Path::new(&origin);
        if origin_path
            .parent()
            .is_none_or(|origin_parent| !same_path(origin_parent, parent))
        {
            continue;
        }
        let copy_path = Path::new(&copy);
        if copy_path
            .parent()
            .is_none_or(|copy_parent| !same_path(copy_parent, &active))
        {
            continue;
        }
        match fs::symlink_metadata(copy_path) {
            Ok(meta) if !is_reparse(&meta) && meta.is_file() => origins.push(origin),
            _ => {}
        }
    }
    Ok(origins)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfirmKind {
    UnknownOrigin,
    OriginChanged,
    CopyChanged,
    AmbiguousOrigin,
}

impl ConfirmKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::UnknownOrigin => "unknown_origin",
            Self::OriginChanged => "origin_changed",
            Self::CopyChanged => "copy_changed",
            Self::AmbiguousOrigin => "ambiguous_origin",
        }
    }
}

/// Sanitized preview diagnostics (basename only, no paths or hashes).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovalClassifyDebug {
    pub basename: String,
    pub confirm_kind: Option<String>,
    pub snapshot_present: bool,
    pub record_version: Option<i64>,
    pub reason_code: String,
    pub copy_check: String,
    pub origin_check: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveFavoriteCopyResult {
    pub status: String,
    pub undo_id: String,
    pub removed_service_folder: Option<ServiceFolderLocation>,
    pub restored_path: Option<String>,
    pub notice_code: Option<String>,
    pub confirm_kind: Option<String>,
    /// `removed` | `not_empty` | `already_gone` | `failed` after a successful file op.
    pub cleanup_status: Option<String>,
}

impl RemoveFavoriteCopyResult {
    fn recycled(
        removed: Option<ServiceFolderLocation>,
        cleanup_status: Option<String>,
    ) -> Self {
        Self {
            status: "recycled".to_string(),
            undo_id: String::new(),
            removed_service_folder: removed,
            restored_path: None,
            notice_code: None,
            confirm_kind: None,
            cleanup_status,
        }
    }

    fn relocated(
        path: PathBuf,
        removed: Option<ServiceFolderLocation>,
        notice: &str,
        cleanup_status: Option<String>,
    ) -> Self {
        Self {
            status: "relocated".to_string(),
            undo_id: String::new(),
            removed_service_folder: removed,
            restored_path: Some(path_string_for_app(&path)),
            notice_code: Some(notice.to_string()),
            confirm_kind: None,
            cleanup_status,
        }
    }

    fn needs_confirm(kind: ConfirmKind) -> Self {
        Self {
            status: "needs_confirm".to_string(),
            undo_id: String::new(),
            removed_service_folder: None,
            restored_path: None,
            notice_code: None,
            confirm_kind: Some(kind.as_str().to_string()),
            cleanup_status: None,
        }
    }

    fn ready() -> Self {
        Self {
            status: "ready".to_string(),
            undo_id: String::new(),
            removed_service_folder: None,
            restored_path: None,
            notice_code: None,
            confirm_kind: None,
            cleanup_status: None,
        }
    }
}

#[derive(Debug)]
pub(crate) enum Plan {
    Recycle {
        copy: PathBuf,
        origin: PathBuf,
        snapshot: FavoriteSnapshot,
    },
    Relocate {
        copy: PathBuf,
        parent: PathBuf,
        snapshot: Option<FavoriteSnapshot>,
        notice: &'static str,
    },
    NeedsConfirm {
        kind: ConfirmKind,
        copy: PathBuf,
        parent: PathBuf,
        snapshot: Option<FavoriteSnapshot>,
    },
}

#[derive(Debug, Clone)]
pub struct RemovalContext {
    pub in_favorites: bool,
    pub snapshot: Option<FavoriteSnapshot>,
}

/// Phase A: read SQLite only.
pub fn load_removal_context(db: &rusqlite::Connection, path: &str) -> Result<RemovalContext, String> {
    let requested = PathBuf::from(path);
    let parent_role = requested.parent().and_then(read_service_role);
    let in_favorites = parent_role == Some(ServiceRole::Favorites);
    let snapshot = if in_favorites {
        database::favorite_snapshot_for_copy(db, path)?
    } else {
        database::favorite_snapshot_for_origin(db, path)?
    };
    Ok(RemovalContext {
        in_favorites,
        snapshot,
    })
}

/// Phase B: classify without holding the DB mutex (may read disk / hash).
pub fn plan_removal(path: &str, ctx: &RemovalContext) -> Result<Plan, String> {
    plan_removal_with_scan(path, ctx, None)
}

/// Same as `plan_removal`, but reuses one directory listing per parent album during batch preview.
pub fn plan_removal_with_scan(
    path: &str,
    ctx: &RemovalContext,
    scan_caches: Option<&mut BatchRemovalScanCaches>,
) -> Result<Plan, String> {
    classify(path, ctx.in_favorites, ctx.snapshot.clone(), scan_caches)
}

/// Per-batch index for `scan_parent_for_identical` (not a global cache).
pub(crate) struct BatchRemovalScanCaches {
    parents: HashMap<String, ParentDirectoryIndex>,
    read_dir_calls: usize,
}

struct ParentDirectoryIndex {
    by_size: HashMap<u64, Vec<PathBuf>>,
}

impl BatchRemovalScanCaches {
    pub fn new() -> Self {
        Self {
            parents: HashMap::new(),
            read_dir_calls: 0,
        }
    }

    #[cfg(test)]
    pub fn read_dir_calls(&self) -> usize {
        self.read_dir_calls
    }

    fn scan(
        &mut self,
        parent: &Path,
        copy: &Path,
        registered_origin: &Path,
    ) -> Result<ParentScan, String> {
        let key = super::normalize_key(parent);
        if !self.parents.contains_key(&key) {
            self.read_dir_calls += 1;
            super::fav_metrics::record_read_dir();
            let mut by_size: HashMap<u64, Vec<PathBuf>> = HashMap::new();
            let entries = fs::read_dir(parent).map_err(|err| format!("read parent: {err}"))?;
            for entry in entries {
                let Ok(entry) = entry else {
                    continue;
                };
                let path = entry.path();
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                if !file_type.is_file() {
                    continue;
                }
                let Ok(meta) = fs::symlink_metadata(&path) else {
                    continue;
                };
                if is_reparse(&meta) {
                    continue;
                }
                by_size.entry(meta.len()).or_default().push(path);
            }
            self.parents.insert(key.clone(), ParentDirectoryIndex { by_size });
        }
        let index = self
            .parents
            .get(&key)
            .ok_or_else(|| "parent index missing".to_string())?;
        let copy_size = fs::metadata(copy).map_err(|err| format!("copy meta: {err}"))?.len();
        let candidates = index.by_size.get(&copy_size).map(Vec::as_slice).unwrap_or(&[]);
        for path in candidates {
            if same_path(path, copy) || same_path(path, registered_origin) {
                continue;
            }
            if files_bytes_identical(path, copy)? {
                return Ok(ParentScan::ContentMatch);
            }
        }
        Ok(ParentScan::None)
    }
}

pub fn preview_plan(plan: &Plan) -> RemoveFavoriteCopyResult {
    match plan {
        Plan::NeedsConfirm { kind, .. } => RemoveFavoriteCopyResult::needs_confirm(*kind),
        Plan::Relocate { snapshot: None, .. } => {
            RemoveFavoriteCopyResult::needs_confirm(ConfirmKind::UnknownOrigin)
        }
        Plan::Recycle { .. } | Plan::Relocate { .. } => RemoveFavoriteCopyResult::ready(),
    }
}

/// Classify only — no recycle/relocate. Used to batch-confirm before a background pass.
pub fn preview_remove_favorite_copy(
    db: &rusqlite::Connection,
    path: &str,
) -> Result<RemoveFavoriteCopyResult, String> {
    let ctx = load_removal_context(db, path)?;
    let plan = plan_removal(path, &ctx)?;
    Ok(preview_plan(&plan))
}

/// Distributed DB locks: load → plan (no DB) → short DB/FS phases.
pub fn remove_favorite_copy_distributed(
    db_mutex: &Mutex<rusqlite::Connection>,
    path: &str,
    confirmed: bool,
) -> Result<RemoveFavoriteCopyResult, String> {
    remove_favorite_copy_distributed_with_scan(db_mutex, path, confirmed, None)
}

pub(crate) fn remove_favorite_copy_distributed_with_scan(
    db_mutex: &Mutex<rusqlite::Connection>,
    path: &str,
    confirmed: bool,
    scan_caches: Option<&mut BatchRemovalScanCaches>,
) -> Result<RemoveFavoriteCopyResult, String> {
    let ctx = with_db(db_mutex, |db| load_removal_context(db, path))?;
    let plan = match scan_caches {
        Some(caches) => plan_removal_with_scan(path, &ctx, Some(caches))?,
        None => plan_removal(path, &ctx)?,
    };
    dispatch_removal_plan(db_mutex, plan, confirmed)
}

/// Monolithic path (single `Connection` held for FS). Production uses `remove_favorite_copy_distributed`.
/// Safe removal candidate: delegate Tauri `pipeline::remove_favorite_copy` already uses distributed;
/// keep this only if external callers need in-process `Connection` tests without a mutex.
pub fn remove_favorite_copy(
    db: &rusqlite::Connection,
    path: &str,
    confirmed: bool,
) -> Result<RemoveFavoriteCopyResult, String> {
    let ctx = load_removal_context(db, path)?;
    let plan = plan_removal(path, &ctx)?;
    dispatch_removal_plan_on_conn(db, plan, confirmed)
}

fn with_db<R>(
    db_mutex: &Mutex<rusqlite::Connection>,
    f: impl FnOnce(&rusqlite::Connection) -> Result<R, String>,
) -> Result<R, String> {
    let wait_start = std::time::Instant::now();
    let guard = db_mutex.lock().unwrap_or_else(|err| err.into_inner());
    super::fav_metrics::record_db_lock_wait(wait_start.elapsed());
    f(&guard)
}

fn dispatch_removal_plan(
    db_mutex: &Mutex<rusqlite::Connection>,
    plan: Plan,
    confirmed: bool,
) -> Result<RemoveFavoriteCopyResult, String> {
    match plan {
        Plan::NeedsConfirm {
            kind,
            copy,
            parent,
            snapshot,
        } => {
            if !confirmed {
                return Ok(RemoveFavoriteCopyResult::needs_confirm(kind));
            }
            relocate_distributed(db_mutex, &copy, &parent, snapshot.as_ref(), notice_for(kind))
        }
        Plan::Recycle {
            copy,
            origin,
            snapshot,
        } => recycle_distributed(db_mutex, &copy, &origin, &snapshot),
        Plan::Relocate {
            copy,
            parent,
            snapshot,
            notice,
        } => {
            if !confirmed && snapshot.is_none() {
                return Ok(RemoveFavoriteCopyResult::needs_confirm(ConfirmKind::UnknownOrigin));
            }
            relocate_distributed(db_mutex, &copy, &parent, snapshot.as_ref(), notice)
        }
    }
}

fn dispatch_removal_plan_on_conn(
    db: &rusqlite::Connection,
    plan: Plan,
    confirmed: bool,
) -> Result<RemoveFavoriteCopyResult, String> {
    match plan {
        Plan::NeedsConfirm {
            kind,
            copy,
            parent,
            snapshot,
        } => {
            if !confirmed {
                return Ok(RemoveFavoriteCopyResult::needs_confirm(kind));
            }
            execute_relocate(db, &copy, &parent, snapshot.as_ref(), notice_for(kind))
        }
        Plan::Recycle {
            copy,
            origin,
            snapshot,
        } => execute_recycle(db, &copy, &origin, &snapshot),
        Plan::Relocate {
            copy,
            parent,
            snapshot,
            notice,
        } => {
            if !confirmed && snapshot.is_none() {
                return Ok(RemoveFavoriteCopyResult::needs_confirm(ConfirmKind::UnknownOrigin));
            }
            execute_relocate(db, &copy, &parent, snapshot.as_ref(), notice)
        }
    }
}

fn recycle_distributed(
    db_mutex: &Mutex<rusqlite::Connection>,
    copy: &Path,
    origin: &Path,
    snapshot: &FavoriteSnapshot,
) -> Result<RemoveFavoriteCopyResult, String> {
    revalidate_recycle_plan(copy, origin, snapshot)?;
    authorize_favorite_copy(copy, origin).map_err(|err| err.message)?;
    let _lock = try_lock_paths([copy, origin])?;
    let op_id = with_db(db_mutex, |db| begin_recycle_op(db, copy, origin, snapshot))?;
    let recycle_result = recycle_path(copy);
    with_db(db_mutex, |db| {
        finish_recycle_op(db, &op_id, copy, snapshot, recycle_result)
    })
}

fn relocate_distributed(
    db_mutex: &Mutex<rusqlite::Connection>,
    copy: &Path,
    parent: &Path,
    snapshot: Option<&FavoriteSnapshot>,
    notice: &str,
) -> Result<RemoveFavoriteCopyResult, String> {
    if read_service_role(parent).is_some() {
        return Err("Нельзя переместить копию в служебную папку.".to_string());
    }
    let parent_meta = fs::symlink_metadata(parent).map_err(|err| format!("parent: {err}"))?;
    if is_reparse(&parent_meta) || !parent_meta.is_dir() {
        return Err("Родительская папка недоступна.".to_string());
    }
    let favorites_dir = copy
        .parent()
        .ok_or_else(|| "Нет папки копии.".to_string())?;
    if read_service_role(favorites_dir) != Some(ServiceRole::Favorites) {
        return Err("Файл не лежит в зарегистрированной папке «Избранное».".to_string());
    }
    let target = claim_relocate_target(parent, copy)?;
    let _lock = try_lock_paths([copy, parent, target.as_path()])?;
    if let Some(row) = snapshot {
        revalidate_recycle_plan(copy, Path::new(&row.origin_path), row)?;
    }
    let op_id = with_db(db_mutex, |db| begin_relocate_op(db, copy, &target, snapshot))?;
    let relocate_result = relocate_file(copy, &target);
    with_db(db_mutex, |db| {
        finish_relocate_op(
            db,
            &op_id,
            copy,
            &target,
            parent,
            favorites_dir,
            snapshot,
            notice,
            relocate_result,
        )
    })
}

fn revalidate_recycle_plan(
    copy: &Path,
    _origin: &Path,
    snapshot: &FavoriteSnapshot,
) -> Result<(), String> {
    let favorites_dir = copy
        .parent()
        .ok_or_else(|| "Нет папки «Избранное».".to_string())?;
    let parent = favorites_dir
        .parent()
        .ok_or_else(|| "Нет родительской папки для «Избранное».".to_string())?;
    match classify_with_link(copy.to_path_buf(), parent.to_path_buf(), snapshot.clone(), None)? {
        Plan::Recycle { .. } => Ok(()),
        Plan::NeedsConfirm { kind, .. } => Err(format!(
            "Требуется подтверждение ({}). Повторите операцию.",
            kind.as_str()
        )),
        Plan::Relocate { .. } => Err("План исключения устарел. Повторите операцию.".to_string()),
    }
}

fn assert_snapshot_unchanged(
    db: &rusqlite::Connection,
    expected: &FavoriteSnapshot,
) -> Result<(), String> {
    let current = database::favorite_snapshot_for_copy(db, &expected.copy_path)?;
    match current {
        Some(row)
            if row.copy_path == expected.copy_path
                && row.origin_path == expected.origin_path
                && row.origin_size == expected.origin_size
                && row.origin_modified_at == expected.origin_modified_at =>
        {
            Ok(())
        }
        Some(_) => Err("Связь избранного изменилась. Повторите операцию.".to_string()),
        None => Err("Связь избранного уже удалена.".to_string()),
    }
}

fn begin_recycle_op(
    db: &rusqlite::Connection,
    copy: &Path,
    origin: &Path,
    snapshot: &FavoriteSnapshot,
) -> Result<String, String> {
    assert_snapshot_unchanged(db, snapshot)?;
    let op_id = new_op_id("unfav");
    let (size, modified, name) = path_stamp(copy);
    database::insert_pending_op(
        db,
        &database::FileOpLog {
            id: op_id.clone(),
            op_type: database::OP_REMOVE_FROM_FAVORITES.to_string(),
            source_path: path_string_for_app(copy),
            destination_path: None,
            origin_path: Some(snapshot.origin_path.clone()),
            source_name: name,
            source_size: Some(size),
            source_modified_at: Some(modified),
            status: database::ST_PENDING.to_string(),
            error_code: None,
            error_message: None,
        },
    )?;
    let _ = origin;
    Ok(op_id)
}

fn finish_recycle_op(
    db: &rusqlite::Connection,
    op_id: &str,
    copy: &Path,
    snapshot: &FavoriteSnapshot,
    recycle_result: Result<RecycleStatus, super::recycle::RecycleError>,
) -> Result<RemoveFavoriteCopyResult, String> {
    assert_snapshot_unchanged(db, snapshot)?;
    match recycle_result {
        Ok(RecycleStatus::Recycled) => {}
        Ok(RecycleStatus::Ambiguous) => {
            let _ = database::finish_op(
                db,
                op_id,
                database::ST_NEEDS_RECONCILIATION,
                None,
                Some("ambiguous"),
                Some("Результат корзины Windows неоднозначен"),
            );
            return Err("Результат корзины Windows неоднозначен. Копия и связь сохранены.".to_string());
        }
        Err(err) => {
            let _ = database::finish_op(
                db,
                op_id,
                database::ST_FAILED,
                None,
                Some(err.code),
                Some(&err.message),
            );
            return Err(err.message);
        }
    }
    database::delete_favorite_copy_path(db, &snapshot.copy_path)?;
    let _ = database::finish_op(db, op_id, database::ST_COMPLETED, None, None, None);
    let (removed, cleanup_status) = cleanup_favorites_after_copy(copy);
    if let Some(location) = &removed {
        let _ = database::purge_paths_under(db, &location.folder_path);
    }
    Ok(RemoveFavoriteCopyResult::recycled(removed, cleanup_status))
}

fn begin_relocate_op(
    db: &rusqlite::Connection,
    copy: &Path,
    target: &Path,
    snapshot: Option<&FavoriteSnapshot>,
) -> Result<String, String> {
    if let Some(row) = snapshot {
        assert_snapshot_unchanged(db, row)?;
    }
    let op_id = new_op_id("unfav-move");
    let (size, modified, name) = path_stamp(copy);
    database::insert_pending_op(
        db,
        &database::FileOpLog {
            id: op_id.clone(),
            op_type: database::OP_REMOVE_FROM_FAVORITES.to_string(),
            source_path: path_string_for_app(copy),
            destination_path: Some(path_string_for_app(target)),
            origin_path: snapshot.map(|row| row.origin_path.clone()),
            source_name: name,
            source_size: Some(size),
            source_modified_at: Some(modified),
            status: database::ST_PENDING.to_string(),
            error_code: None,
            error_message: None,
        },
    )?;
    Ok(op_id)
}

fn finish_relocate_op(
    db: &rusqlite::Connection,
    op_id: &str,
    copy: &Path,
    target: &Path,
    parent: &Path,
    favorites_dir: &Path,
    snapshot: Option<&FavoriteSnapshot>,
    notice: &str,
    relocate_result: Result<(), String>,
) -> Result<RemoveFavoriteCopyResult, String> {
    if let Some(row) = snapshot {
        assert_snapshot_unchanged(db, row)?;
    }
    if let Err(err) = relocate_result {
        let _ = database::finish_op(
            db,
            op_id,
            database::ST_FAILED,
            None,
            Some("relocate"),
            Some(&err),
        );
        return Err(err);
    }
    if let Some(row) = snapshot {
        database::delete_favorite_copy_path(db, &row.copy_path)?;
    }
    let _ = database::finish_op(
        db,
        op_id,
        database::ST_COMPLETED,
        Some(&path_string_for_app(target)),
        None,
        None,
    );
    let (removed, cleanup_status) = cleanup_favorites_after_copy(copy);
    if let Some(location) = &removed {
        let _ = database::purge_paths_under(db, &location.folder_path);
    }
    crate::scanner::drop_listing_cache(parent);
    crate::scanner::drop_listing_cache(favorites_dir);
    Ok(RemoveFavoriteCopyResult::relocated(
        target.to_path_buf(),
        removed,
        notice,
        cleanup_status,
    ))
}

fn notice_for(kind: ConfirmKind) -> &'static str {
    match kind {
        ConfirmKind::UnknownOrigin => "unknown_origin_saved",
        ConfirmKind::OriginChanged | ConfirmKind::CopyChanged | ConfirmKind::AmbiguousOrigin => {
            "changed_saved"
        }
    }
}

fn classify(
    path: &str,
    in_favorites: bool,
    snapshot: Option<FavoriteSnapshot>,
    scan_caches: Option<&mut BatchRemovalScanCaches>,
) -> Result<Plan, String> {
    let requested = PathBuf::from(path);
    if in_favorites {
        let favorites_dir = requested
            .parent()
            .ok_or_else(|| "Нет папки «Избранное».".to_string())?
            .to_path_buf();
        let parent = favorites_dir
            .parent()
            .ok_or_else(|| "Нет родительской папки для «Избранное».".to_string())?
            .to_path_buf();
        let Some(snapshot) = snapshot else {
            return Ok(Plan::NeedsConfirm {
                kind: ConfirmKind::UnknownOrigin,
                copy: requested,
                parent,
                snapshot: None,
            });
        };
        let copy = resolve_existing_path(&snapshot.copy_path, &requested)?;
        return classify_with_link(copy, parent, snapshot, scan_caches);
    }

    let Some(snapshot) = snapshot else {
        return Err("Копия в избранном не найдена".to_string());
    };
    let copy = PathBuf::from(&snapshot.copy_path);
    let favorites_dir = copy
        .parent()
        .ok_or_else(|| "Нет папки копии избранного.".to_string())?
        .to_path_buf();
    if read_service_role(&favorites_dir) != Some(ServiceRole::Favorites) {
        return Err("Файл не лежит в зарегистрированной папке «Избранное».".to_string());
    }
    let parent = favorites_dir
        .parent()
        .ok_or_else(|| "Нет родительской папки для «Избранное».".to_string())?
        .to_path_buf();
    classify_with_link(copy, parent, snapshot, scan_caches)
}

fn classify_with_link(
    copy: PathBuf,
    parent: PathBuf,
    snapshot: FavoriteSnapshot,
    scan_caches: Option<&mut BatchRemovalScanCaches>,
) -> Result<Plan, String> {
    let copy_state = inspect_copy(&copy, &snapshot)?;
    if copy_state == FileState::Changed {
        return Ok(Plan::NeedsConfirm {
            kind: ConfirmKind::CopyChanged,
            copy,
            parent,
            snapshot: Some(snapshot),
        });
    }
    if copy_state == FileState::Missing {
        return Err("Копия в избранном не найдена на диске.".to_string());
    }

    let origin = PathBuf::from(&snapshot.origin_path);
    if same_path(&copy, &origin) {
        return Err("Нельзя удалить оригинал вместо копии.".to_string());
    }

    match inspect_origin(&origin, &copy, &snapshot, scan_caches)? {
        OriginState::Confirmed => Ok(Plan::Recycle {
            copy,
            origin,
            snapshot,
        }),
        OriginState::Missing => Ok(Plan::Relocate {
            copy,
            parent,
            snapshot: Some(snapshot),
            notice: "origin_missing_saved",
        }),
        OriginState::Changed => Ok(Plan::NeedsConfirm {
            kind: ConfirmKind::OriginChanged,
            copy,
            parent,
            snapshot: Some(snapshot),
        }),
        OriginState::Ambiguous => Ok(Plan::NeedsConfirm {
            kind: ConfirmKind::AmbiguousOrigin,
            copy,
            parent,
            snapshot: Some(snapshot),
        }),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FileState {
    Unchanged,
    Changed,
    Missing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OriginState {
    Confirmed,
    Missing,
    Changed,
    Ambiguous,
}

fn copy_diagnostics(copy: &Path, snapshot: &FavoriteSnapshot) -> Result<(FileState, &'static str), String> {
    let meta = match fs::symlink_metadata(copy) {
        Ok(meta) => meta,
        Err(_) => return Ok((FileState::Missing, "missing")),
    };
    if is_reparse(&meta) || !meta.is_file() {
        return Err("Нельзя удалить этот путь".to_string());
    }
    let size = meta.len();
    let modified = modified_ms(&meta);
    if snapshot.record_version >= 2 {
        let recorded_size = snapshot.copy_size.unwrap_or(snapshot.origin_size);
        let recorded_modified = snapshot
            .copy_modified_at
            .unwrap_or(snapshot.origin_modified_at);
        if size != recorded_size {
            return Ok((FileState::Changed, "size_mismatch"));
        }
        if !mtime_close(modified, recorded_modified) {
            return Ok((FileState::Changed, "mtime_drift"));
        }
        if let Some(expected) = snapshot.content_sha256.as_deref() {
            let actual = sha256_file(copy)?;
            if actual != expected {
                return Ok((FileState::Changed, "hash_mismatch"));
            }
        }
        return Ok((FileState::Unchanged, "unchanged"));
    }
    if size != snapshot.origin_size {
        return Ok((FileState::Changed, "size_mismatch"));
    }
    if !mtime_close(modified, snapshot.origin_modified_at) {
        return Ok((FileState::Changed, "mtime_drift"));
    }
    Ok((FileState::Unchanged, "unchanged"))
}

fn inspect_copy(copy: &Path, snapshot: &FavoriteSnapshot) -> Result<FileState, String> {
    copy_diagnostics(copy, snapshot).map(|(state, _)| state)
}

fn origin_diagnostics(
    origin: &Path,
    copy: &Path,
    snapshot: &FavoriteSnapshot,
    scan_caches: Option<&mut BatchRemovalScanCaches>,
) -> Result<(OriginState, &'static str), String> {
    let meta = match fs::symlink_metadata(origin) {
        Ok(meta) => meta,
        Err(_) => {
            return match scan_parent_for_identical(copy, origin, scan_caches)? {
                ParentScan::None => Ok((OriginState::Missing, "missing_no_parent_match")),
                ParentScan::ContentMatch => Ok((OriginState::Ambiguous, "missing_parent_byte_match")),
            };
        }
    };
    if is_reparse(&meta) || !meta.is_file() {
        return Ok((OriginState::Ambiguous, "not_regular_file"));
    }
    if snapshot.record_version >= 2 {
        if meta.len() != snapshot.origin_size {
            return Ok((OriginState::Changed, "size_mismatch"));
        }
        if !mtime_close(modified_ms(&meta), snapshot.origin_modified_at) {
            return Ok((OriginState::Changed, "mtime_drift"));
        }
        if let Some(expected) = snapshot.content_sha256.as_deref() {
            let actual = sha256_file(origin)?;
            if actual != expected {
                return Ok((OriginState::Changed, "hash_mismatch"));
            }
            return Ok((OriginState::Confirmed, "hash_match"));
        }
        if files_bytes_identical(origin, copy)? {
            return Ok((OriginState::Confirmed, "bytes_match"));
        }
        return Ok((OriginState::Changed, "bytes_differ"));
    }
    if files_bytes_identical(origin, copy)? {
        Ok((OriginState::Confirmed, "bytes_match"))
    } else {
        Ok((OriginState::Changed, "bytes_differ"))
    }
}

fn inspect_origin(
    origin: &Path,
    copy: &Path,
    snapshot: &FavoriteSnapshot,
    scan_caches: Option<&mut BatchRemovalScanCaches>,
) -> Result<OriginState, String> {
    origin_diagnostics(origin, copy, snapshot, scan_caches).map(|(state, _)| state)
}

pub(crate) fn removal_classify_debug(
    path: &str,
    ctx: &RemovalContext,
    plan: &Plan,
) -> Result<RemovalClassifyDebug, String> {
    let basename = Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file")
        .to_string();
    let snapshot_present = ctx.snapshot.is_some();
    let record_version = ctx.snapshot.as_ref().map(|row| row.record_version);
    let (confirm_kind, reason_code, copy_check, origin_check) = match plan {
        Plan::NeedsConfirm { kind, copy, .. } => {
            let kind_str = kind.as_str().to_string();
            let (reason, copy_chk, origin_chk) =
                explain_needs_confirm(*kind, &copy, ctx.snapshot.as_ref())?;
            (Some(kind_str), reason, copy_chk, origin_chk)
        }
        _ => (
            None,
            "not_needs_confirm".to_string(),
            "not_applicable".to_string(),
            "not_applicable".to_string(),
        ),
    };
    Ok(RemovalClassifyDebug {
        basename,
        confirm_kind,
        snapshot_present,
        record_version,
        reason_code,
        copy_check,
        origin_check,
    })
}

fn explain_needs_confirm(
    kind: ConfirmKind,
    copy: &Path,
    snapshot: Option<&FavoriteSnapshot>,
) -> Result<(String, String, String), String> {
    match kind {
        ConfirmKind::UnknownOrigin => Ok((
            "snapshot_missing".to_string(),
            "not_checked".to_string(),
            "not_checked".to_string(),
        )),
        ConfirmKind::CopyChanged => {
            let Some(snapshot) = snapshot else {
                return Ok((
                    "snapshot_missing".to_string(),
                    "not_checked".to_string(),
                    "not_checked".to_string(),
                ));
            };
            let (state, copy_chk) = copy_diagnostics(copy, snapshot)?;
            let reason = match state {
                FileState::Missing => "copy_missing",
                FileState::Changed => "copy_changed",
                FileState::Unchanged => "copy_changed_unexpected",
            };
            Ok((reason.to_string(), copy_chk.to_string(), "not_evaluated".to_string()))
        }
        ConfirmKind::OriginChanged => {
            let Some(snapshot) = snapshot else {
                return Ok((
                    "snapshot_missing".to_string(),
                    "not_checked".to_string(),
                    "not_checked".to_string(),
                ));
            };
            let (copy_state, copy_chk) = copy_diagnostics(copy, snapshot)?;
            if copy_state != FileState::Unchanged {
                return Ok((
                    "copy_changed_before_origin".to_string(),
                    copy_chk.to_string(),
                    "not_evaluated".to_string(),
                ));
            }
            let origin = PathBuf::from(&snapshot.origin_path);
            let (_, origin_chk) = origin_diagnostics(&origin, copy, snapshot, None)?;
            Ok((
                "origin_changed".to_string(),
                copy_chk.to_string(),
                origin_chk.to_string(),
            ))
        }
        ConfirmKind::AmbiguousOrigin => {
            let Some(snapshot) = snapshot else {
                return Ok((
                    "snapshot_missing".to_string(),
                    "not_checked".to_string(),
                    "not_checked".to_string(),
                ));
            };
            let (copy_state, copy_chk) = copy_diagnostics(copy, snapshot)?;
            if copy_state != FileState::Unchanged {
                return Ok((
                    "copy_changed_before_origin".to_string(),
                    copy_chk.to_string(),
                    "not_evaluated".to_string(),
                ));
            }
            let origin = PathBuf::from(&snapshot.origin_path);
            let (_, origin_chk) = origin_diagnostics(&origin, copy, snapshot, None)?;
            Ok((
                "ambiguous_origin".to_string(),
                copy_chk.to_string(),
                origin_chk.to_string(),
            ))
        }
    }
}

enum ParentScan {
    None,
    /// One or more content matches — never auto-pick as the registered origin.
    ContentMatch,
}

fn scan_parent_for_identical(
    copy: &Path,
    registered_origin: &Path,
    scan_caches: Option<&mut BatchRemovalScanCaches>,
) -> Result<ParentScan, String> {
    let favorites_dir = copy
        .parent()
        .ok_or_else(|| "Нет папки копии.".to_string())?;
    let parent = favorites_dir
        .parent()
        .ok_or_else(|| "Нет родителя «Избранное».".to_string())?;
    if let Some(caches) = scan_caches {
        return caches.scan(parent, copy, registered_origin);
    }
    let copy_meta = fs::metadata(copy).map_err(|err| format!("copy meta: {err}"))?;
    let copy_size = copy_meta.len();
    super::fav_metrics::record_read_dir();
    let entries = fs::read_dir(parent).map_err(|err| format!("read parent: {err}"))?;
    let mut hits = Vec::new();
    for entry in entries {
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        if same_path(&path, copy) || same_path(&path, registered_origin) {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if is_reparse(&meta) || meta.len() != copy_size {
            continue;
        }
        if files_bytes_identical(&path, copy)? {
            hits.push(path);
            if !hits.is_empty() {
                return Ok(ParentScan::ContentMatch);
            }
        }
    }
    Ok(if hits.is_empty() {
        ParentScan::None
    } else {
        ParentScan::ContentMatch
    })
}

fn execute_recycle(
    db: &rusqlite::Connection,
    copy: &Path,
    origin: &Path,
    snapshot: &FavoriteSnapshot,
) -> Result<RemoveFavoriteCopyResult, String> {
    authorize_favorite_copy(copy, origin).map_err(|err| err.message)?;
    let _lock = try_lock_paths([copy, origin])?;
    let op_id = new_op_id("unfav");
    let (size, modified, name) = path_stamp(copy);
    database::insert_pending_op(
        db,
        &database::FileOpLog {
            id: op_id.clone(),
            op_type: database::OP_REMOVE_FROM_FAVORITES.to_string(),
            source_path: path_string_for_app(copy),
            destination_path: None,
            origin_path: Some(snapshot.origin_path.clone()),
            source_name: name,
            source_size: Some(size),
            source_modified_at: Some(modified),
            status: database::ST_PENDING.to_string(),
            error_code: None,
            error_message: None,
        },
    )?;
    match recycle_path(copy) {
        Ok(RecycleStatus::Recycled) => {}
        Ok(RecycleStatus::Ambiguous) => {
            let _ = database::finish_op(
                db,
                &op_id,
                database::ST_NEEDS_RECONCILIATION,
                None,
                Some("ambiguous"),
                Some("Результат корзины Windows неоднозначен"),
            );
            return Err("Результат корзины Windows неоднозначен. Копия и связь сохранены.".to_string());
        }
        Err(err) => {
            let _ = database::finish_op(
                db,
                &op_id,
                database::ST_FAILED,
                None,
                Some(err.code),
                Some(&err.message),
            );
            return Err(err.message);
        }
    }
    database::delete_favorite_copy_path(db, &snapshot.copy_path)?;
    let _ = database::finish_op(db, &op_id, database::ST_COMPLETED, None, None, None);
    let (removed, cleanup_status) = cleanup_favorites_after_copy(copy);
    if let Some(location) = &removed {
        let _ = database::purge_paths_under(db, &location.folder_path);
    }
    Ok(RemoveFavoriteCopyResult::recycled(removed, cleanup_status))
}

fn execute_relocate(
    db: &rusqlite::Connection,
    copy: &Path,
    parent: &Path,
    snapshot: Option<&FavoriteSnapshot>,
    notice: &str,
) -> Result<RemoveFavoriteCopyResult, String> {
    if read_service_role(parent).is_some() {
        return Err("Нельзя переместить копию в служебную папку.".to_string());
    }
    let parent_meta = fs::symlink_metadata(parent).map_err(|err| format!("parent: {err}"))?;
    if is_reparse(&parent_meta) || !parent_meta.is_dir() {
        return Err("Родительская папка недоступна.".to_string());
    }
    let favorites_dir = copy
        .parent()
        .ok_or_else(|| "Нет папки копии.".to_string())?;
    if read_service_role(favorites_dir) != Some(ServiceRole::Favorites) {
        return Err("Файл не лежит в зарегистрированной папке «Избранное».".to_string());
    }
    let target = claim_relocate_target(parent, copy)?;
    let _lock = try_lock_paths([copy, parent, target.as_path()])?;
    let op_id = new_op_id("unfav-move");
    let (size, modified, name) = path_stamp(copy);
    database::insert_pending_op(
        db,
        &database::FileOpLog {
            id: op_id.clone(),
            op_type: database::OP_REMOVE_FROM_FAVORITES.to_string(),
            source_path: path_string_for_app(copy),
            destination_path: Some(path_string_for_app(&target)),
            origin_path: snapshot.map(|row| row.origin_path.clone()),
            source_name: name,
            source_size: Some(size),
            source_modified_at: Some(modified),
            status: database::ST_PENDING.to_string(),
            error_code: None,
            error_message: None,
        },
    )?;
    if let Err(err) = relocate_file(copy, &target) {
        let _ = database::finish_op(
            db,
            &op_id,
            database::ST_FAILED,
            None,
            Some("relocate"),
            Some(&err),
        );
        return Err(err);
    }
    if let Some(row) = snapshot {
        database::delete_favorite_copy_path(db, &row.copy_path)?;
    }
    let _ = database::finish_op(
        db,
        &op_id,
        database::ST_COMPLETED,
        Some(&path_string_for_app(&target)),
        None,
        None,
    );
    let (removed, cleanup_status) = cleanup_favorites_after_copy(copy);
    if let Some(location) = &removed {
        let _ = database::purge_paths_under(db, &location.folder_path);
    }
    crate::scanner::drop_listing_cache(parent);
    crate::scanner::drop_listing_cache(favorites_dir);
    Ok(RemoveFavoriteCopyResult::relocated(
        target,
        removed,
        notice,
        cleanup_status,
    ))
}

fn claim_relocate_target(parent: &Path, copy: &Path) -> Result<PathBuf, String> {
    let file_name = copy
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Некорректное имя файла.".to_string())?;
    let (stem, ext) = split_stem_ext(file_name);
    let candidates = [
        format!("{stem} (из избранного){ext}"),
        // numbered variants filled below
    ];
    let first = parent.join(&candidates[0]);
    if path_is_free(&first)? {
        return Ok(first);
    }
    for index in 2..=MAX_SUFFIX {
        let name = format!("{stem} (из избранного {index}){ext}");
        let candidate = parent.join(name);
        if path_is_free(&candidate)? {
            return Ok(candidate);
        }
    }
    Err("Не удалось подобрать свободное имя в родительской папке.".to_string())
}

fn path_is_free(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(true),
        Err(err) => Err(format!("probe {}: {err}", path.display())),
        Ok(_) => Ok(false),
    }
}

fn relocate_file(from: &Path, to: &Path) -> Result<(), String> {
    match fs::rename(from, to) {
        Ok(()) => return Ok(()),
        Err(err) if err.kind() == io::ErrorKind::AlreadyExists => {
            return Err("Целевой файл уже существует.".to_string());
        }
        Err(_) => {}
    }
    // Cross-volume: copy to temp, verify, publish, then recycle source (never remove_file).
    let temp = to.with_file_name(format!(
        ".stitchvue-relocate-{}.tmp",
        std::process::id()
    ));
    if temp.exists() {
        return Err("Временный файл перемещения уже существует.".to_string());
    }
    copy_verified(from, &temp).map_err(|err| {
        let _ = fs::remove_file(&temp);
        err
    })?;
    match fs::rename(&temp, to) {
        Ok(()) => {}
        Err(err) => {
            let _ = fs::remove_file(&temp);
            return Err(format!("Не удалось опубликовать файл: {err}"));
        }
    }
    if !files_bytes_identical(from, to)? {
        return Err("Проверка после копирования не совпала. Исходный файл сохранён.".to_string());
    }
    match recycle_path(from) {
        Ok(RecycleStatus::Recycled) => Ok(()),
        Ok(RecycleStatus::Ambiguous) => Err(
            "Файл сохранён в родительской папке, но исходник в «Избранном» остался (корзина неоднозначна)."
                .to_string(),
        ),
        Err(err) => Err(format!(
            "Файл сохранён в родительской папке, но не удалось убрать копию из «Избранного»: {}",
            err.message
        )),
    }
}

fn copy_verified(from: &Path, to: &Path) -> Result<(), String> {
    let mut input = open_regular(from)?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(to)
        .map_err(|err| format!("create temp: {err}"))?;
    let mut buffer = vec![0_u8; COPY_CHUNK];
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|err| format!("read: {err}"))?;
        if read == 0 {
            break;
        }
        output
            .write_all(&buffer[..read])
            .map_err(|err| format!("write: {err}"))?;
    }
    output.sync_all().map_err(|err| format!("sync: {err}"))?;
    Ok(())
}

fn files_bytes_identical(left: &Path, right: &Path) -> Result<bool, String> {
    let left_meta = fs::metadata(left).map_err(|err| format!("meta left: {err}"))?;
    let right_meta = fs::metadata(right).map_err(|err| format!("meta right: {err}"))?;
    if left_meta.len() != right_meta.len() {
        return Ok(false);
    }
    super::fav_metrics::record_byte_compare(left_meta.len());
    let mut left_file = open_regular(left)?;
    let mut right_file = open_regular(right)?;
    let mut left_buf = vec![0_u8; COPY_CHUNK];
    let mut right_buf = vec![0_u8; COPY_CHUNK];
    loop {
        let left_read = read_full(&mut left_file, &mut left_buf)?;
        let right_read = read_full(&mut right_file, &mut right_buf)?;
        if left_read != right_read || left_buf[..left_read] != right_buf[..right_read] {
            return Ok(false);
        }
        if left_read == 0 {
            return Ok(true);
        }
    }
}

fn open_regular(path: &Path) -> Result<File, String> {
    let meta = fs::symlink_metadata(path).map_err(|err| format!("open {}: {err}", path.display()))?;
    if is_reparse(&meta) {
        return Err(format!("Файл является ссылкой: {}", path.display()));
    }
    if !meta.is_file() {
        return Err(format!("Это не файл: {}", path.display()));
    }
    File::open(path).map_err(|err| format!("open {}: {err}", path.display()))
}

fn read_full(file: &mut File, buffer: &mut [u8]) -> Result<usize, String> {
    let mut filled = 0;
    while filled < buffer.len() {
        match file.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(read) => filled += read,
            Err(err) if err.kind() == io::ErrorKind::Interrupted => continue,
            Err(err) => return Err(err.to_string()),
        }
    }
    Ok(filled)
}

fn resolve_existing_path(stored: &str, requested: &Path) -> Result<PathBuf, String> {
    if requested.exists() {
        return Ok(requested.to_path_buf());
    }
    let stored_path = PathBuf::from(stored);
    if stored_path.exists() {
        return Ok(stored_path);
    }
    if same_path(requested, &stored_path) {
        return Ok(requested.to_path_buf());
    }
    Err("Копия в избранном не найдена на диске.".to_string())
}

/// Returns `(location for navigation when folder is gone, cleanup_status)`.
/// `location` is set for both `removed` (app deleted) and `already_gone` (path missing).
fn cleanup_favorites_after_copy(
    copy: &Path,
) -> (Option<ServiceFolderLocation>, Option<String>) {
    let Some(favorites_dir) = copy.parent() else {
        return (None, Some("failed".to_string()));
    };
    let outcome = super::cleanup_service_folder_at(favorites_dir);
    match outcome.status.as_str() {
        "removed" => (outcome.location, Some("removed".to_string())),
        "already_gone" => (outcome.location, Some("already_gone".to_string())),
        "not_empty" => (None, Some("not_empty".to_string())),
        _ => (None, Some("failed".to_string())),
    }
}

fn split_stem_ext(name: &str) -> (String, String) {
    match name.rfind('.') {
        Some(index) if index > 0 => (name[..index].to_string(), name[index..].to_string()),
        _ => (name.to_string(), String::new()),
    }
}

fn modified_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn mtime_close(left: i64, right: i64) -> bool {
    (left - right).abs() <= META_TOLERANCE_MS
}

fn path_stamp(path: &Path) -> (u64, i64, Option<String>) {
    let meta = fs::metadata(path).ok();
    let size = meta.as_ref().map(|item| item.len()).unwrap_or(0);
    let modified = meta
        .as_ref()
        .map(modified_ms)
        .unwrap_or(0);
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned());
    (size, modified, name)
}

fn new_op_id(prefix: &str) -> String {
    format!(
        "{prefix}-{}",
        std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_ops::{write_service_role, ServiceRole, LOCAL_FAVORITES};
    use std::io::Write;

    fn sandbox() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sv-fav-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn free_name_avoids_collision() {
        let root = sandbox();
        let favorites = root.join(LOCAL_FAVORITES);
        fs::create_dir(&favorites).unwrap();
        write_service_role(&favorites, ServiceRole::Favorites).unwrap();
        let copy = favorites.join("photo.jpg");
        File::create(&copy).unwrap().write_all(b"abc").unwrap();
        File::create(root.join("photo (из избранного).jpg"))
            .unwrap()
            .write_all(b"x")
            .unwrap();
        let target = claim_relocate_target(&root, &copy).unwrap();
        assert_eq!(
            target.file_name().unwrap().to_string_lossy(),
            "photo (из избранного 2).jpg"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn same_path_equates_extended_prefix() {
        let plain = Path::new(r"C:\Photos\Избранное\a.jpg");
        let extended = Path::new(r"\\?\C:\Photos\Избранное\a.jpg");
        assert!(same_path(plain, extended));
    }
}

#[cfg(test)]
mod regression_tests {
    use super::*;
    use crate::database::{self, FAVORITE_RECORD_VERSION};
    use crate::file_ops::content_hash::sha256_file;
    use crate::file_ops::{write_service_role, ServiceRole, LOCAL_FAVORITES};
    use rusqlite::Connection;
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;

    fn sandbox() -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "sv-fav-reg-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        database::migrate(&conn).unwrap();
        conn
    }

    fn write_bytes(path: &Path, bytes: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, bytes).unwrap();
    }

    fn link_v2(
        conn: &Connection,
        root: &Path,
        body: &[u8],
    ) -> (PathBuf, PathBuf, FavoriteSnapshot) {
        let favorites = root.join(LOCAL_FAVORITES);
        fs::create_dir_all(&favorites).unwrap();
        write_service_role(&favorites, ServiceRole::Favorites).unwrap();
        let origin = root.join("photo.jpg");
        write_bytes(&origin, body);
        let copy = favorites.join("photo.jpg");
        write_bytes(&copy, body);
        let origin_meta = fs::metadata(&origin).unwrap();
        let copy_meta = fs::metadata(&copy).unwrap();
        let hash = sha256_file(&origin).unwrap();
        database::record_favorite_copy(
            conn,
            origin.to_str().unwrap(),
            origin_meta.len(),
            modified_ms(&origin_meta),
            copy.to_str().unwrap(),
            copy_meta.len(),
            modified_ms(&copy_meta),
            Some(&hash),
        )
        .unwrap();
        let snapshot = database::favorite_snapshot_for_copy(conn, copy.to_str().unwrap())
            .unwrap()
            .expect("snapshot");
        assert_eq!(snapshot.record_version, FAVORITE_RECORD_VERSION);
        (origin, copy, snapshot)
    }

    #[test]
    fn preview_ready_then_copy_changed_requires_confirm_on_execute() {
        let root = sandbox();
        let conn = memory_db();
        let (_origin, copy, _) = link_v2(&conn, &root, b"stable");
        let db = Mutex::new(conn);
        let preview = preview_remove_favorite_copy(&db.lock().unwrap(), copy.to_str().unwrap())
            .unwrap();
        assert_eq!(preview.status, "ready");
        write_bytes(&copy, b"mutated-body");
        let removal =
            remove_favorite_copy_distributed(&db, copy.to_str().unwrap(), false).unwrap();
        assert_eq!(removal.status, "needs_confirm");
        assert_eq!(removal.confirm_kind.as_deref(), Some("copy_changed"));
        assert!(copy.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn revalidate_blocks_recycle_when_copy_changed() {
        let root = sandbox();
        let conn = memory_db();
        let (origin, copy, snapshot) = link_v2(&conn, &root, b"recycle-guard");
        revalidate_recycle_plan(&copy, &origin, &snapshot).unwrap();
        write_bytes(&copy, b"changed-body-longer");
        let err = revalidate_recycle_plan(&copy, &origin, &snapshot).unwrap_err();
        assert!(err.contains("подтверждение") || err.contains("устарел"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn finish_recycle_rejects_stale_db_snapshot() {
        let root = sandbox();
        let conn = memory_db();
        let (origin, copy, snapshot) = link_v2(&conn, &root, b"db-stale");
        let op_id = begin_recycle_op(&conn, &copy, &origin, &snapshot).unwrap();
        conn.execute(
            "UPDATE favorite_copies SET origin_path = ?1 WHERE copy_path = ?2",
            (r"C:\other\photo.jpg", snapshot.copy_path.as_str()),
        )
        .unwrap();
        let err = finish_recycle_op(
            &conn,
            &op_id,
            &copy,
            &snapshot,
            Ok(RecycleStatus::Recycled),
        )
        .unwrap_err();
        assert!(err.contains("изменилась") || err.contains("удалена"));
        assert!(database::favorite_snapshot_for_copy(&conn, copy.to_str().unwrap())
            .unwrap()
            .is_some());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn finish_relocate_rejects_stale_db_snapshot() {
        let root = sandbox();
        let conn = memory_db();
        let (origin, copy, snapshot) = link_v2(&conn, &root, b"relocate-stale");
        let target = root.join("photo (из избранного).jpg");
        let op_id = begin_relocate_op(&conn, &copy, &target, Some(&snapshot)).unwrap();
        conn.execute("DELETE FROM favorite_copies", []).unwrap();
        let err = finish_relocate_op(
            &conn,
            &op_id,
            &copy,
            &target,
            &root,
            copy.parent().unwrap(),
            Some(&snapshot),
            "changed_saved",
            Ok(()),
        )
        .unwrap_err();
        assert!(err.contains("удалена") || err.contains("изменилась"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn concurrent_path_lock_blocks_second_unfavorite() {
        let root = sandbox();
        let conn = memory_db();
        let (origin, copy, _) = link_v2(&conn, &root, b"lock");
        let guard = try_lock_paths([&copy, &origin]).unwrap();
        let db = Arc::new(Mutex::new(conn));
        let copy_path = copy.to_str().unwrap().to_string();
        let handle = thread::spawn(move || remove_favorite_copy_distributed(&db, &copy_path, false));
        let err = handle.join().unwrap().unwrap_err();
        assert!(err.contains("Конфликтующая") || err.contains("блокиров"));
        drop(guard);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn batch_preview_matches_sequential_preview() {
        let root = sandbox();
        let conn = memory_db();
        let (_o1, c1, _) = link_v2(&conn, &root, b"one");
        let body = b"two";
        let favorites = root.join(LOCAL_FAVORITES);
        let origin2 = root.join("two.jpg");
        write_bytes(&origin2, body);
        let copy2 = favorites.join("two.jpg");
        write_bytes(&copy2, body);
        let om = fs::metadata(&origin2).unwrap();
        let cm = fs::metadata(&copy2).unwrap();
        let hash = sha256_file(&origin2).unwrap();
        database::record_favorite_copy(
            &conn,
            origin2.to_str().unwrap(),
            om.len(),
            modified_ms(&om),
            copy2.to_str().unwrap(),
            cm.len(),
            modified_ms(&cm),
            Some(&hash),
        )
        .unwrap();
        let db = Mutex::new(conn);
        let paths = vec![
            c1.to_string_lossy().into_owned(),
            copy2.to_string_lossy().into_owned(),
        ];
        let batch = crate::file_ops::favorites_batch::preview_remove_favorite_copies(
            &db,
            &paths,
        )
        .unwrap();
        assert_eq!(batch.len(), 2);
        for entry in &batch {
            let single =
                preview_remove_favorite_copy(&db.lock().unwrap(), &entry.path).unwrap();
            assert_eq!(single.status, entry.result.status);
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_origin_with_duplicate_size_yields_ambiguous_confirm() {
        let root = sandbox();
        let conn = memory_db();
        let favorites = root.join(LOCAL_FAVORITES);
        fs::create_dir_all(&favorites).unwrap();
        write_service_role(&favorites, ServiceRole::Favorites).unwrap();
        let body = b"dup-origin";
        let decoy = root.join("decoy.jpg");
        write_bytes(&decoy, body);
        let copy = favorites.join("copy.jpg");
        write_bytes(&copy, body);
        let om = fs::metadata(&decoy).unwrap();
        let cm = fs::metadata(&copy).unwrap();
        let hash = sha256_file(&copy).unwrap();
        database::record_favorite_copy(
            &conn,
            r"C:\gone\photo.jpg",
            om.len(),
            modified_ms(&om),
            copy.to_str().unwrap(),
            cm.len(),
            modified_ms(&cm),
            Some(&hash),
        )
        .unwrap();
        let preview = preview_remove_favorite_copy(&conn, copy.to_str().unwrap()).unwrap();
        assert_eq!(preview.status, "needs_confirm");
        assert_eq!(preview.confirm_kind.as_deref(), Some("ambiguous_origin"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn batch_scan_cache_uses_one_read_dir_per_parent_album() {
        let root = sandbox();
        let conn = memory_db();
        let favorites = root.join(LOCAL_FAVORITES);
        fs::create_dir_all(&favorites).unwrap();
        write_service_role(&favorites, ServiceRole::Favorites).unwrap();
        let body = b"shared-body";
        let decoy = root.join("decoy.jpg");
        write_bytes(&decoy, body);
        let mut copy_paths = Vec::new();
        for index in 0..3 {
            let copy = favorites.join(format!("copy-{index}.jpg"));
            write_bytes(&copy, body);
            let cm = fs::metadata(&copy).unwrap();
            let hash = sha256_file(&copy).unwrap();
            let copy_path = copy.to_string_lossy().into_owned();
            let missing_origin = format!(r"C:\missing\{index}.jpg");
            database::record_favorite_copy(
                &conn,
                &missing_origin,
                cm.len(),
                modified_ms(&cm),
                &copy_path,
                cm.len(),
                modified_ms(&cm),
                Some(&hash),
            )
            .unwrap();
            copy_paths.push(copy);
        }
        for copy in &copy_paths {
            let ctx = load_removal_context(&conn, copy.to_str().unwrap()).unwrap();
            let plan = plan_removal_with_scan(copy.to_str().unwrap(), &ctx, None).unwrap();
            assert!(matches!(
                plan,
                Plan::NeedsConfirm {
                    kind: ConfirmKind::AmbiguousOrigin,
                    ..
                }
            ));
        }
        let mut batch_caches = BatchRemovalScanCaches::new();
        for copy in &copy_paths {
            let ctx = load_removal_context(&conn, copy.to_str().unwrap()).unwrap();
            let plan = plan_removal_with_scan(
                copy.to_str().unwrap(),
                &ctx,
                Some(&mut batch_caches),
            )
            .unwrap();
            assert!(matches!(
                plan,
                Plan::NeedsConfirm {
                    kind: ConfirmKind::AmbiguousOrigin,
                    ..
                }
            ));
        }
        assert_eq!(batch_caches.read_dir_calls(), 1);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn batch_execute_plan_shares_parent_scan_cache() {
        let root = sandbox();
        let conn = memory_db();
        let favorites = root.join(LOCAL_FAVORITES);
        fs::create_dir_all(&favorites).unwrap();
        write_service_role(&favorites, ServiceRole::Favorites).unwrap();
        let body = b"exec-batch-scan";
        let decoy = root.join("decoy.jpg");
        write_bytes(&decoy, body);
        let mut paths = Vec::new();
        for index in 0..3 {
            let copy = favorites.join(format!("exec-{index}.jpg"));
            write_bytes(&copy, body);
            let cm = fs::metadata(&copy).unwrap();
            let hash = sha256_file(&copy).unwrap();
            let copy_path = copy.to_string_lossy().into_owned();
            database::record_favorite_copy(
                &conn,
                &format!(r"C:\missing\exec-{index}.jpg"),
                cm.len(),
                modified_ms(&cm),
                &copy_path,
                cm.len(),
                modified_ms(&cm),
                Some(&hash),
            )
            .unwrap();
            paths.push(copy_path);
        }
        let mut batch_caches = BatchRemovalScanCaches::new();
        for path in &paths {
            let ctx = load_removal_context(&conn, path).unwrap();
            let plan = plan_removal_with_scan(path, &ctx, Some(&mut batch_caches)).unwrap();
            assert!(matches!(
                plan,
                Plan::NeedsConfirm {
                    kind: ConfirmKind::AmbiguousOrigin,
                    ..
                }
            ));
        }
        assert_eq!(
            batch_caches.read_dir_calls(),
            1,
            "batch execute planning should share one read_dir per parent"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn retry_execute_after_first_item_succeeds() {
        let root = sandbox();
        let conn = memory_db();
        let (_origin, copy, _) = link_v2(&conn, &root, b"retry-one");
        let db = Mutex::new(conn);
        let first = remove_favorite_copy_distributed(&db, copy.to_str().unwrap(), false).unwrap();
        assert!(first.status == "recycled" || first.status == "relocated" || first.status == "ready");
        let second = remove_favorite_copy_distributed(&db, copy.to_str().unwrap(), false);
        assert!(second.is_err() || second.unwrap().status == "failed");
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    #[test]
    fn distributed_remove_recycles_via_windows_shell() {
        let root = sandbox();
        let conn = memory_db();
        let (_origin, copy, _) = link_v2(&conn, &root, b"win-recycle-integration");
        let db = Mutex::new(conn);
        let result = remove_favorite_copy_distributed(&db, copy.to_str().unwrap(), false).unwrap();
        assert!(
            result.status == "recycled" || !copy.exists(),
            "expected recycle outcome, got {:?}",
            result.status
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn concurrent_batch_and_single_on_same_copy() {
        let root = sandbox();
        let conn = memory_db();
        let (_origin, copy, _) = link_v2(&conn, &root, b"race");
        let db = Arc::new(Mutex::new(conn));
        let copy_path = copy.to_str().unwrap().to_string();
        let batch = thread::spawn({
            let db = Arc::clone(&db);
            let copy_path = copy_path.clone();
            move || {
                crate::file_ops::favorites_batch::remove_favorite_copies_batch(
                    &db,
                    &[crate::file_ops::FavoriteBatchRemoveItem {
                        path: copy_path,
                        confirmed: false,
                    }],
                )
            }
        });
        let single = thread::spawn({
            let db = Arc::clone(&db);
            let copy_path = copy_path.clone();
            move || remove_favorite_copy_distributed(&db, &copy_path, false)
        });
        let batch_out = batch.join().unwrap();
        let single_out = single.join().unwrap();
        let mut outcomes: Vec<String> = Vec::new();
        match batch_out {
            Ok(rows) => {
                for row in rows {
                    outcomes.push(row.result.status);
                }
            }
            Err(err) => outcomes.push(err),
        }
        match single_out {
            Ok(result) => outcomes.push(result.status),
            Err(err) => outcomes.push(err),
        }
        let successes = outcomes
            .iter()
            .filter(|status| *status == "recycled" || *status == "relocated")
            .count();
        assert!(successes <= 1, "only one concurrent unfavorite may succeed: {:?}", outcomes);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn batch_preview_includes_classify_debug_for_needs_confirm() {
        let root = sandbox();
        let conn = memory_db();
        let favorites = root.join(LOCAL_FAVORITES);
        fs::create_dir_all(&favorites).unwrap();
        write_service_role(&favorites, ServiceRole::Favorites).unwrap();
        let copy = favorites.join("orphan.jpg");
        write_bytes(&copy, b"orphan");
        let db = Mutex::new(conn);
        let previews = crate::file_ops::favorites_batch::preview_remove_favorite_copies(
            &db,
            &[copy.to_string_lossy().into_owned()],
        )
        .unwrap();
        assert_eq!(previews[0].result.status, "needs_confirm");
        assert_eq!(previews[0].result.confirm_kind.as_deref(), Some("unknown_origin"));
        let debug = previews[0].classify_debug.as_ref().expect("debug");
        assert_eq!(debug.basename, "orphan.jpg");
        assert!(!debug.snapshot_present);
        assert_eq!(debug.reason_code, "snapshot_missing");
        let _ = fs::remove_dir_all(&root);
    }
}

#[cfg(test)]
mod classify_scenario_tests {
    use super::*;
    use crate::database::{self, FAVORITE_RECORD_VERSION};
    use crate::file_ops::content_hash::sha256_file;
    use crate::file_ops::{write_service_role, ServiceRole, LOCAL_FAVORITES};
    use rusqlite::Connection;
    use std::fs::OpenOptions;
    use std::time::{Duration, SystemTime};

    fn sandbox() -> PathBuf {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "sv-fav-scenario-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        database::migrate(&conn).unwrap();
        conn
    }

    fn write_bytes(path: &Path, bytes: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, bytes).unwrap();
    }

    fn preview_ready(conn: &Connection, copy: &Path) {
        let ctx = load_removal_context(conn, copy.to_str().unwrap()).unwrap();
        let plan = plan_removal(copy.to_str().unwrap(), &ctx).unwrap();
        assert!(matches!(plan, Plan::Recycle { .. }));
        assert_eq!(preview_plan(&plan).status, "ready");
    }

    fn link_v2(
        root: &Path,
        conn: &Connection,
        body: &[u8],
    ) -> (PathBuf, PathBuf, FavoriteSnapshot) {
        let favorites = root.join(LOCAL_FAVORITES);
        fs::create_dir_all(&favorites).unwrap();
        write_service_role(&favorites, ServiceRole::Favorites).unwrap();
        let origin = root.join("photo.jpg");
        write_bytes(&origin, body);
        let copy = favorites.join("photo.jpg");
        write_bytes(&copy, body);
        let origin_meta = fs::metadata(&origin).unwrap();
        let copy_meta = fs::metadata(&copy).unwrap();
        let hash = sha256_file(&origin).unwrap();
        database::record_favorite_copy(
            conn,
            origin.to_str().unwrap(),
            origin_meta.len(),
            modified_ms(&origin_meta),
            copy.to_str().unwrap(),
            copy_meta.len(),
            modified_ms(&copy_meta),
            Some(&hash),
        )
        .unwrap();
        let snapshot = database::favorite_snapshot_for_copy(conn, copy.to_str().unwrap())
            .unwrap()
            .expect("snapshot");
        assert_eq!(snapshot.record_version, FAVORITE_RECORD_VERSION);
        (origin, copy, snapshot)
    }

    #[test]
    fn fresh_link_preview_is_ready() {
        let root = sandbox();
        let conn = memory_db();
        let (_origin, copy, _) = link_v2(&root, &conn, b"fresh-remove");
        preview_ready(&conn, &copy);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn orphan_copy_without_sqlite_row_is_unknown_origin() {
        let root = sandbox();
        let conn = memory_db();
        let favorites = root.join(LOCAL_FAVORITES);
        fs::create_dir_all(&favorites).unwrap();
        write_service_role(&favorites, ServiceRole::Favorites).unwrap();
        let copy = favorites.join("old.jpg");
        write_bytes(&copy, b"legacy");
        let ctx = load_removal_context(&conn, copy.to_str().unwrap()).unwrap();
        let plan = plan_removal(copy.to_str().unwrap(), &ctx).unwrap();
        assert!(matches!(
            plan,
            Plan::NeedsConfirm {
                kind: ConfirmKind::UnknownOrigin,
                ..
            }
        ));
        let debug = removal_classify_debug(copy.to_str().unwrap(), &ctx, &plan).unwrap();
        assert_eq!(debug.reason_code, "snapshot_missing");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn parent_folder_rename_via_db_relocate_stays_ready() {
        let root = sandbox();
        let conn = memory_db();
        let (_origin, copy, _) = link_v2(&root, &conn, b"rename-album");
        let old = root.to_string_lossy().into_owned();
        let new = root
            .parent()
            .unwrap()
            .join(format!("renamed-{}", std::process::id()));
        let _ = fs::remove_dir_all(&new);
        fs::rename(&root, &new).unwrap();
        database::relocate_folder_path(&conn, &old, new.to_str().unwrap(), "renamed").unwrap();
        let copy_path = new.join(LOCAL_FAVORITES).join("photo.jpg");
        preview_ready(&conn, &copy_path);
        let _ = fs::remove_dir_all(&new);
    }

    #[test]
    fn duplicate_bytes_in_album_yield_ambiguous_when_origin_missing() {
        let root = sandbox();
        let conn = memory_db();
        let favorites = root.join(LOCAL_FAVORITES);
        fs::create_dir_all(&favorites).unwrap();
        write_service_role(&favorites, ServiceRole::Favorites).unwrap();
        let body = b"dup-bytes";
        write_bytes(&root.join("twin.jpg"), body);
        let copy = favorites.join("fav.jpg");
        write_bytes(&copy, body);
        let cm = fs::metadata(&copy).unwrap();
        let hash = sha256_file(&copy).unwrap();
        database::record_favorite_copy(
            &conn,
            r"C:\gone\origin.jpg",
            cm.len(),
            modified_ms(&cm),
            copy.to_str().unwrap(),
            cm.len(),
            modified_ms(&cm),
            Some(&hash),
        )
        .unwrap();
        let ctx = load_removal_context(&conn, copy.to_str().unwrap()).unwrap();
        let plan = plan_removal(copy.to_str().unwrap(), &ctx).unwrap();
        assert!(matches!(
            plan,
            Plan::NeedsConfirm {
                kind: ConfirmKind::AmbiguousOrigin,
                ..
            }
        ));
        let debug = removal_classify_debug(copy.to_str().unwrap(), &ctx, &plan).unwrap();
        assert_eq!(debug.origin_check, "missing_parent_byte_match");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn metadata_only_mtime_drift_triggers_copy_changed_not_hash() {
        let root = sandbox();
        let conn = memory_db();
        let (_origin, copy, snapshot) = link_v2(&root, &conn, b"meta-only");
        let later = SystemTime::UNIX_EPOCH + Duration::from_secs(1_900_000_000);
        OpenOptions::new()
            .write(true)
            .open(&copy)
            .unwrap()
            .set_modified(later)
            .unwrap();
        let ctx = load_removal_context(&conn, copy.to_str().unwrap()).unwrap();
        let plan = plan_removal(copy.to_str().unwrap(), &ctx).unwrap();
        assert!(matches!(
            plan,
            Plan::NeedsConfirm {
                kind: ConfirmKind::CopyChanged,
                ..
            }
        ));
        let debug = removal_classify_debug(copy.to_str().unwrap(), &ctx, &plan).unwrap();
        assert_eq!(debug.copy_check, "mtime_drift");
        assert_eq!(sha256_file(&copy).unwrap(), snapshot.content_sha256.unwrap());
        let _ = fs::remove_dir_all(&root);
    }
}
