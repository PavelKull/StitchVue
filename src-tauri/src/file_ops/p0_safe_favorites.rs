//! P0 Safe Favorites VERIFY (T001–T004): temp FS + in-memory SQLite only.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::Connection;

use super::favorites::{
    load_removal_context, plan_removal, preview_remove_favorite_copy, remove_favorite_copy,
    ConfirmKind, Plan,
};
use super::{write_service_role, ServiceRole, LOCAL_FAVORITES};
use crate::database::{self, FileOpLog, ST_NEEDS_RECONCILIATION, ST_PENDING};
use crate::file_ops::content_hash::sha256_file;
use crate::file_ops::reconcile::{reconcile_on_boot, reconcile_one};

fn sandbox(tag: &str) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let root = std::env::temp_dir().join(format!(
        "sv-fav-p0-{}-{}-{}",
        tag,
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

fn stamp_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn record_link(db: &Connection, origin: &Path, copy: &Path) {
    let origin_meta = fs::metadata(origin).unwrap();
    let copy_meta = fs::metadata(copy).unwrap();
    let hash = sha256_file(origin).unwrap();
    database::record_favorite_copy(
        db,
        origin.to_str().unwrap(),
        origin_meta.len(),
        stamp_ms(&origin_meta),
        copy.to_str().unwrap(),
        copy_meta.len(),
        stamp_ms(&copy_meta),
        Some(&hash),
    )
    .unwrap();
}

fn favorite_row_count(db: &Connection) -> i64 {
    db.query_row("SELECT COUNT(*) FROM favorite_copies", [], |row| row.get(0))
        .unwrap()
}

fn pending_add(id: &str, source: &str, dest: Option<&str>) -> FileOpLog {
    FileOpLog {
        id: id.to_string(),
        op_type: database::OP_ADD_TO_FAVORITES.to_string(),
        source_path: source.to_string(),
        destination_path: dest.map(str::to_string),
        origin_path: Some(source.to_string()),
        source_name: Some("a.jpg".to_string()),
        source_size: Some(4),
        source_modified_at: None,
        status: ST_PENDING.to_string(),
        error_code: None,
        error_message: None,
    }
}

/// T001 — documented defect: `unknown_origin` + `confirmed` without FR-11 resolution
/// must not auto-relocate. Expected RED until T030.
#[test]
fn p0_safe_favorites_t001_unknown_origin_confirmed_must_not_relocate() {
    let root = sandbox("t001");
    let conn = memory_db();
    let favorites = root.join(LOCAL_FAVORITES);
    fs::create_dir_all(&favorites).unwrap();
    write_service_role(&favorites, ServiceRole::Favorites).unwrap();
    let copy = favorites.join("orphan.jpg");
    write_bytes(&copy, b"orphan-legacy");

    let ctx = load_removal_context(&conn, copy.to_str().unwrap()).unwrap();
    let plan = plan_removal(copy.to_str().unwrap(), &ctx).unwrap();
    assert!(
        matches!(
            plan,
            Plan::NeedsConfirm {
                kind: ConfirmKind::UnknownOrigin,
                ..
            }
        ),
        "fixture must classify as UnknownOrigin"
    );

    let result = remove_favorite_copy(&conn, copy.to_str().unwrap(), true, None).unwrap();
    assert_ne!(
        result.status, "relocated",
        "FR-011b: confirmed unknown_origin without resolution must not auto-relocate"
    );
    assert!(
        copy.is_file(),
        "orphan copy must stay in Избранное (no auto-relocate to parent)"
    );

    let _ = fs::remove_dir_all(&root);
}

/// T002 — EC-12 / EC-22 / CL-00: other file at stored origin must not be overwritten.
#[test]
fn p0_safe_favorites_t002_return_to_source_aborts_if_origin_path_occupied_by_other_file() {
    let root = sandbox("t002");
    let conn = memory_db();
    let favorites = root.join(LOCAL_FAVORITES);
    fs::create_dir_all(&favorites).unwrap();
    write_service_role(&favorites, ServiceRole::Favorites).unwrap();

    let origin = root.join("photo.jpg");
    let copy = favorites.join("photo.jpg");
    write_bytes(&origin, b"linked-original");
    write_bytes(&copy, b"linked-original");
    record_link(&conn, &origin, &copy);

    let other_bytes = b"OTHER-OCCUPANT-BYTES";
    write_bytes(&origin, other_bytes);
    assert_eq!(fs::read(&origin).unwrap(), other_bytes);

    let outcome = remove_favorite_copy(&conn, copy.to_str().unwrap(), true, None);
    let origin_after = fs::read(&origin).unwrap();
    assert_eq!(
        origin_after, other_bytes,
        "CL-00: file occupying origin path must not be overwritten"
    );

    match &outcome {
        Ok(result) => {
            if let Some(restored) = &result.restored_path {
                assert_ne!(
                    PathBuf::from(restored),
                    origin,
                    "return/relocate must not target occupied origin path"
                );
            }
            assert!(
                result.status == "relocated"
                    || result.status == "needs_confirm"
                    || result.status == "skipped"
                    || result.status == "recycled",
                "unexpected status for occupied-origin remove: {}",
                result.status
            );
        }
        Err(err) => {
            assert!(
                !err.is_empty(),
                "abort/error path acceptable for identity conflict"
            );
        }
    }

    let _ = fs::remove_dir_all(&root);
}

/// T003 — existing reconcile paths are metadata/recovery-only (no unlink of user photos).
#[test]
fn p0_safe_favorites_t003_reconcile_paths_do_not_delete_user_photos() {
    let root = sandbox("t003");
    let origin = root.join("origin.jpg");
    let album = root.join("album.jpg");
    let dest = root.join(LOCAL_FAVORITES).join("origin.jpg");
    write_bytes(&origin, b"origin-body");
    write_bytes(&album, b"album-body");
    write_bytes(&dest, b"origin-body");

    let conn = memory_db();
    let row = pending_add("fav-p0-t003", origin.to_str().unwrap(), dest.to_str());
    database::insert_pending_op(&conn, &row).unwrap();
    database::finish_op(
        &conn,
        &row.id,
        ST_NEEDS_RECONCILIATION,
        dest.to_str(),
        Some("favorite_link"),
        Some("simulated link error"),
    )
    .unwrap();

    let status = reconcile_one(&conn, &row).unwrap();
    assert!(
        status == database::ST_COMPLETED || status == ST_NEEDS_RECONCILIATION,
        "unexpected reconcile_one status: {status}"
    );
    assert!(origin.is_file(), "user origin must not be unlinked");
    assert!(
        album.is_file(),
        "unrelated album photo must not be unlinked"
    );
    assert!(
        dest.is_file(),
        "favorite copy must not be unlinked by reconcile"
    );

    let pending2 = pending_add("fav-p0-t003-boot", origin.to_str().unwrap(), dest.to_str());
    database::insert_pending_op(&conn, &pending2).unwrap();
    reconcile_on_boot(&conn);
    assert!(origin.is_file(), "boot reconcile must not unlink origin");
    assert!(
        album.is_file(),
        "boot reconcile must not unlink album photo"
    );
    assert!(
        dest.is_file(),
        "boot reconcile must not unlink favorite copy"
    );

    let _ = fs::remove_dir_all(&root);
}

/// T004 — unavailable origin volume must not purge `favorite_copies` (CL-P04 / EC-02).
#[test]
fn p0_safe_favorites_t004_unavailable_origin_does_not_purge_favorite_copies_row() {
    let root = sandbox("t004");
    let conn = memory_db();
    let favorites = root.join(LOCAL_FAVORITES);
    fs::create_dir_all(&favorites).unwrap();
    write_service_role(&favorites, ServiceRole::Favorites).unwrap();

    let copy = favorites.join("photo.jpg");
    write_bytes(&copy, b"kept-copy");
    let copy_meta = fs::metadata(&copy).unwrap();
    let hash = sha256_file(&copy).unwrap();
    let unavailable_origin = r"Z:\sv-fav-p0-missing\photo.jpg";
    database::record_favorite_copy(
        &conn,
        unavailable_origin,
        copy_meta.len(),
        stamp_ms(&copy_meta),
        copy.to_str().unwrap(),
        copy_meta.len(),
        stamp_ms(&copy_meta),
        Some(&hash),
    )
    .unwrap();
    assert_eq!(favorite_row_count(&conn), 1);

    let preview = preview_remove_favorite_copy(&conn, copy.to_str().unwrap()).unwrap();
    assert_eq!(
        favorite_row_count(&conn),
        1,
        "preview must not purge favorite_copies when origin volume unavailable"
    );

    let soft = remove_favorite_copy(&conn, copy.to_str().unwrap(), false, None).unwrap();
    assert_eq!(
        favorite_row_count(&conn),
        1,
        "unconfirmed remove/classify must not purge favorite_copies for unavailable origin"
    );
    assert!(
        preview.status == "needs_confirm" || preview.status == "ready",
        "preview status: {}",
        preview.status
    );
    assert_eq!(soft.status, "needs_confirm");
    assert!(copy.is_file());

    let _ = fs::remove_dir_all(&root);
}
