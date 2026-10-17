use std::fs;
use std::path::Path;

use rusqlite::Connection;

use super::p1_identity_gate::{classify_origin_availability, OriginAvailability};
use crate::database::{self, FileOpLog, ST_COMPLETED, ST_FAILED, ST_NEEDS_RECONCILIATION};
use crate::file_ops::recycle::{path_still_there, recycle_path, RecycleStatus};

pub fn reconcile_on_boot(db: &Connection) {
    recover_legacy_undo(db);
    if let Ok(rows) = database::unfinished_ops(db) {
        for row in rows {
            let _ = reconcile_one(db, &row);
        }
    }
}

/// Light scoped favorites reconcile (CL-P01): unfinished journal + copy metadata only.
/// Never unlinks user photos / orphan copies; never purges `favorite_copies` on Unavailable (CL-P04).
/// Does not call `recover_legacy_undo` (boot-only; recycle side effects).
pub fn reconcile_favorites_scope(db: &Connection, directory_prefix: &str) -> Result<(), String> {
    if directory_prefix.trim().is_empty() {
        return Ok(());
    }
    finish_scoped_favorite_journal(db, directory_prefix);
    refresh_scoped_favorite_metadata(db, directory_prefix)?;
    // EC-21: orphan files under Избранное without a row are intentionally ignored (no invent, no delete).
    Ok(())
}

fn scope_key(value: &str) -> String {
    crate::file_ops::normalize_key(Path::new(value)).to_ascii_lowercase()
}

fn path_in_directory_scope(path: &str, directory_prefix: &str) -> bool {
    let path_k = scope_key(path);
    let prefix = scope_key(directory_prefix);
    let nested = format!("{}\\", prefix.trim_end_matches('\\'));
    path_k == prefix || path_k.starts_with(&nested)
}

fn favorite_op_in_scope(row: &FileOpLog, directory_prefix: &str) -> bool {
    matches!(
        row.op_type.as_str(),
        database::OP_ADD_TO_FAVORITES | database::OP_REMOVE_FROM_FAVORITES
    ) && (path_in_directory_scope(&row.source_path, directory_prefix)
        || row
            .destination_path
            .as_deref()
            .is_some_and(|dest| path_in_directory_scope(dest, directory_prefix))
        || row
            .origin_path
            .as_deref()
            .is_some_and(|origin| path_in_directory_scope(origin, directory_prefix)))
}

fn finish_scoped_favorite_journal(db: &Connection, directory_prefix: &str) {
    let Ok(rows) = database::unfinished_ops(db) else {
        return;
    };
    for row in rows {
        if favorite_op_in_scope(&row, directory_prefix) {
            let _ = reconcile_one(db, &row);
        }
    }
}

fn stamp_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn probe_origin_availability(origin: &Path) -> OriginAvailability {
    match fs::symlink_metadata(origin) {
        Ok(_) => OriginAvailability::Accessible,
        Err(err) => classify_origin_availability(&err),
    }
}

/// Refresh copy stamps for in-scope rows. Never deletes rows on Unavailable / Missing.
fn refresh_scoped_favorite_metadata(
    db: &Connection,
    directory_prefix: &str,
) -> Result<(), String> {
    let snapshots = database::load_all_favorite_snapshots(db)?;
    for snap in snapshots {
        if !path_in_directory_scope(&snap.origin_path, directory_prefix)
            && !path_in_directory_scope(&snap.copy_path, directory_prefix)
        {
            continue;
        }

        // CL-P04: Unavailable must not trigger SQLite purge of favorite_copies.
        match probe_origin_availability(Path::new(&snap.origin_path)) {
            OriginAvailability::Unavailable | OriginAvailability::Missing => {
                refresh_copy_stamps_keeping_origin(db, &snap)?;
                continue;
            }
            OriginAvailability::Accessible => {}
        }

        let copy = Path::new(&snap.copy_path);
        let Ok(copy_meta) = fs::metadata(copy) else {
            // Copy gone → leave row (listing filters stars); never invent / never unlink others.
            continue;
        };
        let Ok(origin_meta) = fs::metadata(Path::new(&snap.origin_path)) else {
            refresh_copy_stamps_keeping_origin(db, &snap)?;
            continue;
        };
        database::record_favorite_copy(
            db,
            &snap.origin_path,
            origin_meta.len(),
            stamp_ms(&origin_meta),
            &snap.copy_path,
            copy_meta.len(),
            stamp_ms(&copy_meta),
            snap.content_sha256.as_deref(),
        )?;
    }
    Ok(())
}

fn refresh_copy_stamps_keeping_origin(
    db: &Connection,
    snap: &database::FavoriteSnapshot,
) -> Result<(), String> {
    let Ok(copy_meta) = fs::metadata(Path::new(&snap.copy_path)) else {
        return Ok(());
    };
    database::record_favorite_copy(
        db,
        &snap.origin_path,
        snap.origin_size,
        snap.origin_modified_at,
        &snap.copy_path,
        copy_meta.len(),
        stamp_ms(&copy_meta),
        snap.content_sha256.as_deref(),
    )
}

fn recover_legacy_undo(db: &Connection) {
    let Ok(rows) = database::list_favorite_undo(db) else {
        return;
    };
    for undo in rows {
        let held = Path::new(&undo.held_path);
        if !path_still_there(held) {
            let _ = database::delete_favorite_undo_row(db, &undo.id);
            continue;
        }
        match recycle_path(held) {
            Ok(RecycleStatus::Recycled) => {
                let _ = database::delete_favorite_undo_row(db, &undo.id);
            }
            Ok(RecycleStatus::Ambiguous) if !path_still_there(held) => {
                let _ = database::delete_favorite_undo_row(db, &undo.id);
            }
            _ => {}
        }
    }
}

fn favorite_bytes_match(origin: &Path, copy: &Path) -> bool {
    let origin_meta = fs::metadata(origin).ok();
    let copy_meta = fs::metadata(copy).ok();
    match (origin_meta, copy_meta) {
        (Some(left), Some(right)) if left.len() == right.len() => {
            match (
                crate::file_ops::sha256_file(origin),
                crate::file_ops::sha256_file(copy),
            ) {
                (Ok(left_hash), Ok(right_hash)) => left_hash == right_hash,
                _ => false,
            }
        }
        _ => false,
    }
}

fn reconcile_add_to_favorites(
    db: &Connection,
    row: &FileOpLog,
    source: &Path,
    dest: Option<&Path>,
    source_here: bool,
    dest_here: bool,
) -> Result<&'static str, String> {
    if dest_here {
        let destination = dest.expect("dest_here implies destination path");
        if let Some(snapshot) =
            database::favorite_snapshot_for_copy(db, &destination.display().to_string())?
        {
            if snapshot.origin_path == row.source_path {
                return Ok(ST_COMPLETED);
            }
            return Ok(ST_NEEDS_RECONCILIATION);
        }
        if !source_here || !favorite_bytes_match(source, destination) {
            return Ok(ST_NEEDS_RECONCILIATION);
        }
        let meta = fs::metadata(destination).map_err(|err| err.to_string())?;
        let size = meta.len();
        let modified = meta
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or(0);
        let origin_meta = fs::metadata(source).map_err(|err| err.to_string())?;
        let origin_size = origin_meta.len();
        let origin_modified = origin_meta
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or(modified);
        let hash = crate::file_ops::sha256_file(destination).ok();
        database::record_favorite_copy(
            db,
            &row.source_path,
            origin_size,
            origin_modified,
            &destination.display().to_string(),
            size,
            modified,
            hash.as_deref(),
        )?;
        return Ok(ST_COMPLETED);
    }
    if source_here {
        Ok(ST_NEEDS_RECONCILIATION)
    } else {
        Ok(ST_NEEDS_RECONCILIATION)
    }
}

pub fn reconcile_one(db: &Connection, row: &FileOpLog) -> Result<String, String> {
    let source = Path::new(&row.source_path);
    let dest = row.destination_path.as_deref().map(Path::new);
    let source_here = path_still_there(source);
    let dest_here = dest.is_some_and(path_still_there);

    let status = match row.op_type.as_str() {
        database::OP_MOVE_TO_LOCAL_TRASH => {
            if !source_here && dest_here {
                if let Some(destination) = row.destination_path.as_deref() {
                    let size = row.source_size.unwrap_or_else(|| {
                        fs::metadata(destination)
                            .map(|meta| meta.len())
                            .unwrap_or(0)
                    });
                    database::record_trash(db, destination, &row.source_path, size)?;
                }
                ST_COMPLETED
            } else if source_here && !dest_here {
                ST_FAILED
            } else {
                ST_NEEDS_RECONCILIATION
            }
        }
        database::OP_RESTORE_FROM_LOCAL_TRASH => {
            if !source_here && dest_here {
                database::delete_trash(db, &row.source_path)?;
                ST_COMPLETED
            } else if source_here {
                ST_FAILED
            } else {
                ST_NEEDS_RECONCILIATION
            }
        }
        database::OP_ADD_TO_FAVORITES => {
            reconcile_add_to_favorites(db, row, source, dest, source_here, dest_here)?
        }
        database::OP_REMOVE_FROM_FAVORITES | database::OP_MOVE_TO_WINDOWS_RECYCLE => {
            if source_here {
                ST_FAILED
            } else {
                if row.op_type == database::OP_REMOVE_FROM_FAVORITES {
                    database::delete_favorite_copy_path(db, &row.source_path)?;
                } else {
                    database::delete_trash(db, &row.source_path)?;
                    if fs::symlink_metadata(source).is_err() {
                        if let Some(parent) = source.parent() {
                            let _ = crate::file_ops::remove_service_folder_if_empty(parent);
                        }
                    }
                }
                ST_COMPLETED
            }
        }
        _ => ST_NEEDS_RECONCILIATION,
    };

    let message = match status {
        ST_FAILED => Some("сверено после сбоя: операция не завершена"),
        ST_NEEDS_RECONCILIATION => Some("сверено после сбоя: результат неоднозначен"),
        _ => None,
    };
    database::finish_op(db, &row.id, status, None, None, message)?;
    Ok(status.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{self, FileOpLog, ST_PENDING};
    use rusqlite::Connection;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        database::migrate(&conn).unwrap();
        conn
    }

    fn sandbox() -> std::path::PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "stitchvue-recon-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn pending(id: &str, op: &str, source: &str, dest: Option<&str>) -> FileOpLog {
        FileOpLog {
            id: id.to_string(),
            op_type: op.to_string(),
            source_path: source.to_string(),
            destination_path: dest.map(str::to_string),
            origin_path: Some(source.to_string()),
            source_name: None,
            source_size: Some(4),
            source_modified_at: None,
            status: ST_PENDING.to_string(),
            error_code: None,
            error_message: None,
        }
    }

    #[test]
    fn crash_after_move_records_trash_from_journal() {
        let root = sandbox();
        let source = root.join("a.jpg");
        let dest = root.join("Удаленное").join("a.jpg");
        fs::create_dir_all(dest.parent().unwrap()).unwrap();
        fs::write(&dest, b"abcd").unwrap();
        let conn = db();
        let row = pending(
            "op-1",
            database::OP_MOVE_TO_LOCAL_TRASH,
            source.to_str().unwrap(),
            dest.to_str(),
        );
        database::insert_pending_op(&conn, &row).unwrap();
        let status = reconcile_one(&conn, &row).unwrap();
        assert_eq!(status, ST_COMPLETED);
        assert_eq!(
            database::trash_origin(&conn, dest.to_str().unwrap())
                .unwrap()
                .as_deref(),
            source.to_str()
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn crash_after_favorite_add_records_link_from_journal() {
        let root = sandbox();
        let source = root.join("a.jpg");
        let dest = root.join("Избранное").join("a.jpg");
        fs::create_dir_all(dest.parent().unwrap()).unwrap();
        fs::write(&source, b"abcd").unwrap();
        fs::write(&dest, b"abcd").unwrap();
        let conn = db();
        let row = pending(
            "fav-1",
            database::OP_ADD_TO_FAVORITES,
            source.to_str().unwrap(),
            dest.to_str(),
        );
        database::insert_pending_op(&conn, &row).unwrap();
        let status = reconcile_one(&conn, &row).unwrap();
        assert_eq!(status, ST_COMPLETED);
        assert!(
            database::favorite_snapshot_for_copy(&conn, dest.to_str().unwrap())
                .unwrap()
                .is_some()
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn recycle_pending_does_not_delete_remaining_file() {
        let root = sandbox();
        let copy = root.join("copy.jpg");
        fs::write(&copy, b"keep").unwrap();
        let conn = db();
        let row = pending(
            "op-2",
            database::OP_REMOVE_FROM_FAVORITES,
            copy.to_str().unwrap(),
            None,
        );
        database::insert_pending_op(&conn, &row).unwrap();
        let status = reconcile_one(&conn, &row).unwrap();
        assert_eq!(status, ST_FAILED);
        assert_eq!(fs::read(&copy).unwrap(), b"keep");
        let _ = fs::remove_dir_all(&root);
    }
}
