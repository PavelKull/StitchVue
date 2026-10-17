//! P2 Safe Favorites VERIFY (T021–T022b): scoped reconcile metadata-only.
//! Temp FS (`sv-fav-p2-*`) + in-memory SQLite only.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::Connection;

use super::favorites::active_favorite_origins_in;
use super::reconcile::reconcile_favorites_scope;
use super::{write_service_role, ServiceRole, LOCAL_FAVORITES};
use crate::database::{self, FileOpLog, ST_NEEDS_RECONCILIATION, ST_PENDING};
use crate::file_ops::content_hash::sha256_file;
use crate::file_ops::p1_identity_gate::{classify_origin_availability, OriginAvailability};

fn sandbox(tag: &str) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let root = std::env::temp_dir().join(format!(
        "sv-fav-p2-{}-{}-{}",
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

/// T021 — post-op scoped reconcile updates metadata without deleting copies (SC-011).
#[test]
fn p2_reconcile_t021_post_op_metadata_without_deleting_copies() {
    let root = sandbox("t021");
    let directory = root.to_str().unwrap().to_string();
    let origin = root.join("photo.jpg");
    let favorites = root.join(LOCAL_FAVORITES);
    let copy = favorites.join("photo.jpg");
    write_bytes(&origin, b"body-t021");
    write_bytes(&copy, b"body-t021");
    write_service_role(&favorites, ServiceRole::Favorites).unwrap();

    let conn = memory_db();
    let row = FileOpLog {
        id: "fav-p2-t021".to_string(),
        op_type: database::OP_ADD_TO_FAVORITES.to_string(),
        source_path: origin.to_str().unwrap().to_string(),
        destination_path: Some(copy.to_str().unwrap().to_string()),
        origin_path: Some(origin.to_str().unwrap().to_string()),
        source_name: Some("photo.jpg".to_string()),
        source_size: Some(9),
        source_modified_at: None,
        status: ST_PENDING.to_string(),
        error_code: None,
        error_message: None,
    };
    database::insert_pending_op(&conn, &row).unwrap();
    database::finish_op(
        &conn,
        &row.id,
        ST_NEEDS_RECONCILIATION,
        copy.to_str(),
        Some("favorite_link"),
        Some("simulated link lag"),
    )
    .unwrap();

    reconcile_favorites_scope(&conn, &directory).unwrap();

    assert!(origin.is_file(), "origin must survive scoped reconcile");
    assert!(copy.is_file(), "favorite copy must not be deleted");
    let snap = database::favorite_snapshot_for_copy(&conn, copy.to_str().unwrap())
        .unwrap()
        .expect("journal reconcile must persist favorite_copies row");
    assert_eq!(snap.copy_size, Some(fs::metadata(&copy).unwrap().len()));
    assert!(
        database::unfinished_ops(&conn)
            .unwrap()
            .iter()
            .all(|op| op.id != row.id),
        "scoped journal finish should clear needs_reconciliation for this op"
    );

    let _ = fs::remove_dir_all(&root);
}

/// T022 — Unavailable origin must not purge `favorite_copies` (CL-P04 / EC-02).
#[test]
fn p2_reconcile_t022_unavailable_origin_skips_favorite_copies_purge() {
    let root = sandbox("t022");
    let directory = root.to_str().unwrap().to_string();
    let favorites = root.join(LOCAL_FAVORITES);
    fs::create_dir_all(&favorites).unwrap();
    write_service_role(&favorites, ServiceRole::Favorites).unwrap();

    let copy = favorites.join("photo.jpg");
    write_bytes(&copy, b"kept-copy");
    let copy_meta = fs::metadata(&copy).unwrap();
    let hash = sha256_file(&copy).unwrap();

    // UNC to non-existent host → BAD_NETPATH (53) → Unavailable (not Missing).
    let unavailable_origin = r"\\sv-fav-p2-nohost\share\photo.jpg";
    let probe_err =
        fs::symlink_metadata(unavailable_origin).expect_err("fixture host must be unreachable");
    let probe = classify_origin_availability(&probe_err);
    assert_eq!(
        probe,
        OriginAvailability::Unavailable,
        "fixture must classify as Unavailable, got {probe:?}"
    );

    let conn = memory_db();
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

    reconcile_favorites_scope(&conn, &directory).unwrap();

    assert_eq!(
        favorite_row_count(&conn),
        1,
        "Unavailable origin must not purge favorite_copies"
    );
    assert!(copy.is_file(), "copy must remain on disk");

    let _ = fs::remove_dir_all(&root);
}

/// T022a — Explorer rename of origin must not invent a link by basename (EC-05).
#[test]
fn p2_reconcile_t022a_explorer_rename_does_not_invent_basename_link() {
    let root = sandbox("t022a");
    let directory = root.to_str().unwrap().to_string();
    let favorites = root.join(LOCAL_FAVORITES);
    fs::create_dir_all(&favorites).unwrap();
    write_service_role(&favorites, ServiceRole::Favorites).unwrap();

    let origin = root.join("photo.jpg");
    let copy = favorites.join("photo.jpg");
    write_bytes(&origin, b"same-bytes");
    write_bytes(&copy, b"same-bytes");

    let conn = memory_db();
    record_link(&conn, &origin, &copy);
    assert_eq!(favorite_row_count(&conn), 1);

    let renamed = root.join("renamed-in-explorer.jpg");
    fs::rename(&origin, &renamed).unwrap();
    assert!(!origin.exists());
    assert!(renamed.is_file());

    reconcile_favorites_scope(&conn, &directory).unwrap();

    assert_eq!(
        favorite_row_count(&conn),
        1,
        "reconcile must not invent a second row"
    );
    assert!(
        database::favorite_snapshot_for_origin(&conn, renamed.to_str().unwrap())
            .unwrap()
            .is_none(),
        "must not invent favorite link for Explorer-renamed basename"
    );
    let snap = database::favorite_snapshot_for_copy(&conn, copy.to_str().unwrap())
        .unwrap()
        .expect("original SQLite row kept");
    assert_eq!(snap.origin_path, origin.to_str().unwrap());

    let stars = active_favorite_origins_in(&conn, &directory).unwrap();
    assert!(
        !stars
            .iter()
            .any(|path| path.eq_ignore_ascii_case(renamed.to_str().unwrap())),
        "active_favorite_origins_in must not invent star for renamed path"
    );
    assert!(copy.is_file());

    let _ = fs::remove_dir_all(&root);
}

/// T022b — orphan copy without `favorite_copies` row must not be deleted (EC-21).
#[test]
fn p2_reconcile_t022b_orphan_copy_without_row_not_deleted() {
    let root = sandbox("t022b");
    let directory = root.to_str().unwrap().to_string();
    let favorites = root.join(LOCAL_FAVORITES);
    fs::create_dir_all(&favorites).unwrap();
    write_service_role(&favorites, ServiceRole::Favorites).unwrap();

    let orphan = favorites.join("orphan.jpg");
    write_bytes(&orphan, b"orphan-body");
    let conn = memory_db();
    assert_eq!(favorite_row_count(&conn), 0);

    reconcile_favorites_scope(&conn, &directory).unwrap();

    assert!(
        orphan.is_file(),
        "EC-21: orphan copy must not be deleted by scoped reconcile"
    );
    assert_eq!(
        favorite_row_count(&conn),
        0,
        "EC-21: must not invent favorite_copies row for orphan"
    );

    let _ = fs::remove_dir_all(&root);
}
