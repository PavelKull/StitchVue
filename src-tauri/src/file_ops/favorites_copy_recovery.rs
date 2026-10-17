//! FIX-C1C2: journal destination + reconcile recovery for copy-to-favorites.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use super::{
    execute, file_op_log_id, write_service_role, Action, IoGate, OperationRequest, ServiceRole,
    LOCAL_FAVORITES,
};
use crate::database::{self, FileOpLog, ST_COMPLETED, ST_NEEDS_RECONCILIATION, ST_PENDING};
use crate::file_ops::reconcile::{reconcile_on_boot, reconcile_one};

struct DirectIo;

impl IoGate for DirectIo {
    fn wait_visible(&self, cancel: &AtomicBool) -> bool {
        !cancel.load(Ordering::Relaxed)
    }

    fn with_read<T>(&self, work: impl FnOnce() -> T) -> T {
        work()
    }
}

fn db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    database::migrate(&conn).unwrap();
    conn
}

fn sandbox() -> PathBuf {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let root = std::env::temp_dir().join(format!(
        "stitchvue-fav-fix-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    root
}

fn write_role_favorites(dir: &PathBuf) {
    let favorites = dir.join(LOCAL_FAVORITES);
    fs::create_dir(&favorites).unwrap();
    write_service_role(&favorites, ServiceRole::Favorites).unwrap();
}

fn pending_favorite(id: &str, source: &str, dest: Option<&str>) -> FileOpLog {
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

#[test]
fn t1_successful_add_journals_destination_before_copy() {
    let root = sandbox();
    write_role_favorites(&root);
    let source = root.join("a.jpg");
    fs::write(&source, b"body").unwrap();
    let conn = Arc::new(Mutex::new(db()));
    let op_id = "op-t1";
    let log_id = file_op_log_id(op_id, source.to_str().unwrap());
    database::insert_pending_op(
        &conn.lock().unwrap(),
        &pending_favorite(&log_id, source.to_str().unwrap(), None),
    )
    .unwrap();
    let journal_conn = Arc::clone(&conn);
    let journal_dest: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let journal_dest_capture = Arc::clone(&journal_dest);
    let journal = move |lid: &str, dest: &str| {
        assert_eq!(lid, log_id);
        database::update_pending_destination(&journal_conn.lock().unwrap(), lid, dest).unwrap();
        *journal_dest_capture.lock().unwrap() = Some(dest.to_string());
    };
    let request = OperationRequest {
        operation_id: op_id.to_string(),
        directory: root.display().to_string(),
        action: Action::CopyToLocalFavorites,
        paths: vec![source.display().to_string()],
    };
    let result = execute(
        &DirectIo,
        &request,
        1,
        &AtomicBool::new(false),
        &|_| {},
        Some(&journal),
    )
    .unwrap();
    assert_eq!(result.outcomes[0].status, "copied");
    let dest = journal_dest.lock().unwrap().clone().unwrap();
    assert!(PathBuf::from(dest).is_file());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn t2_duplicate_pending_insert_fails_before_execute() {
    let conn = db();
    let row = pending_favorite("dup", r"C:\tmp\a.jpg", None);
    database::insert_pending_op(&conn, &row).unwrap();
    let err = database::insert_pending_op(&conn, &row).unwrap_err();
    assert!(err.contains("record pending"));
}

#[test]
fn t4_reconcile_restores_link_after_copy_with_destination() {
    let root = sandbox();
    let source = root.join("a.jpg");
    let dest = root.join("Избранное").join("a.jpg");
    fs::create_dir_all(dest.parent().unwrap()).unwrap();
    fs::write(&source, b"abcd").unwrap();
    fs::write(&dest, b"abcd").unwrap();
    let conn = db();
    let row = pending_favorite("fav-t4", source.to_str().unwrap(), dest.to_str());
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
fn t5_needs_reconciliation_recovers_without_deleting_copy() {
    let root = sandbox();
    let source = root.join("a.jpg");
    let dest = root.join("Избранное").join("a.jpg");
    fs::create_dir_all(dest.parent().unwrap()).unwrap();
    fs::write(&source, b"abcd").unwrap();
    fs::write(&dest, b"abcd").unwrap();
    let conn = db();
    let row = pending_favorite("fav-t5", source.to_str().unwrap(), dest.to_str());
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
    assert!(dest.is_file());
    let status = reconcile_one(&conn, &row).unwrap();
    assert_eq!(status, ST_COMPLETED);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn t6_double_reconcile_is_idempotent() {
    let root = sandbox();
    let source = root.join("a.jpg");
    let dest = root.join("Избранное").join("a.jpg");
    fs::create_dir_all(dest.parent().unwrap()).unwrap();
    fs::write(&source, b"abcd").unwrap();
    fs::write(&dest, b"abcd").unwrap();
    let conn = db();
    let row = pending_favorite("fav-t6", source.to_str().unwrap(), dest.to_str());
    database::insert_pending_op(&conn, &row).unwrap();
    assert_eq!(reconcile_one(&conn, &row).unwrap(), ST_COMPLETED);
    assert_eq!(reconcile_one(&conn, &row).unwrap(), ST_COMPLETED);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn t7_repeat_add_uses_already_exists_without_duplicate_files() {
    let root = sandbox();
    let favorites = root.join(LOCAL_FAVORITES);
    fs::create_dir(&favorites).unwrap();
    write_service_role(&favorites, ServiceRole::Favorites).unwrap();
    fs::write(favorites.join("photo.jpg"), b"same-bytes").unwrap();
    let source = root.join("photo.jpg");
    fs::write(&source, b"same-bytes").unwrap();
    let request = OperationRequest {
        operation_id: "op-t7".to_string(),
        directory: root.display().to_string(),
        action: Action::CopyToLocalFavorites,
        paths: vec![source.display().to_string()],
    };
    let result = execute(
        &DirectIo,
        &request,
        1,
        &AtomicBool::new(false),
        &|_| {},
        None,
    )
    .unwrap();
    assert_eq!(result.outcomes[0].status, "already_exists");
    let count = fs::read_dir(&favorites)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file() && e.file_name() != ".stitchvue.role")
        .count();
    assert_eq!(count, 1);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn t8_missing_origin_does_not_delete_copy() {
    let root = sandbox();
    let dest = root.join("Избранное").join("a.jpg");
    fs::create_dir_all(dest.parent().unwrap()).unwrap();
    fs::write(&dest, b"keep").unwrap();
    let conn = db();
    let row = pending_favorite(
        "fav-t8",
        root.join("gone.jpg").to_str().unwrap(),
        dest.to_str(),
    );
    database::insert_pending_op(&conn, &row).unwrap();
    let status = reconcile_one(&conn, &row).unwrap();
    assert_eq!(status, ST_NEEDS_RECONCILIATION);
    assert_eq!(fs::read(&dest).unwrap(), b"keep");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn t9_missing_copy_does_not_create_false_link() {
    let root = sandbox();
    let source = root.join("a.jpg");
    fs::write(&source, b"abcd").unwrap();
    let dest = root.join("Избранное").join("a.jpg");
    let conn = db();
    let row = pending_favorite("fav-t9", source.to_str().unwrap(), dest.to_str());
    database::insert_pending_op(&conn, &row).unwrap();
    let status = reconcile_one(&conn, &row).unwrap();
    assert_eq!(status, ST_NEEDS_RECONCILIATION);
    assert!(
        database::favorite_snapshot_for_copy(&conn, dest.to_str().unwrap())
            .unwrap()
            .is_none()
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn t11_wrong_file_at_destination_stays_ambiguous() {
    let root = sandbox();
    let source = root.join("a.jpg");
    let dest = root.join("Избранное").join("a.jpg");
    fs::create_dir_all(dest.parent().unwrap()).unwrap();
    fs::write(&source, b"origin").unwrap();
    fs::write(&dest, b"other-file").unwrap();
    let conn = db();
    let row = pending_favorite("fav-t11", source.to_str().unwrap(), dest.to_str());
    database::insert_pending_op(&conn, &row).unwrap();
    let status = reconcile_one(&conn, &row).unwrap();
    assert_eq!(status, ST_NEEDS_RECONCILIATION);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn t4_boot_reconcile_picks_up_pending_with_destination() {
    let root = sandbox();
    let source = root.join("a.jpg");
    let dest = root.join("Избранное").join("a.jpg");
    fs::create_dir_all(dest.parent().unwrap()).unwrap();
    fs::write(&source, b"abcd").unwrap();
    fs::write(&dest, b"abcd").unwrap();
    let conn = db();
    let row = pending_favorite("fav-boot", source.to_str().unwrap(), dest.to_str());
    database::insert_pending_op(&conn, &row).unwrap();
    reconcile_on_boot(&conn);
    assert!(
        database::favorite_snapshot_for_copy(&conn, dest.to_str().unwrap())
            .unwrap()
            .is_some()
    );
    let _ = fs::remove_dir_all(&root);
}
