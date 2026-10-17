// Batch + resolution for origin-in-trash (TASK-FAVORITES-TRASH-LIFECYCLE-FINAL).

use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, atomic::Ordering};

use rusqlite::Connection;

use super::{write_service_role, ServiceRole, LOCAL_FAVORITES, LOCAL_TRASH};
use crate::database;
use crate::file_ops::favorites::remove_favorite_copy_distributed;
use crate::file_ops::favorites_batch::{
    remove_favorite_copies_batch, FavoriteBatchRemoveItem,
};

fn db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    database::migrate(&conn).unwrap();
    conn
}

fn sandbox() -> PathBuf {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let root = std::env::temp_dir().join(format!(
        "stitchvue-fav-final-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    root
}

fn modified_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn link_with_trash_origin(
    conn: &Connection,
    root: &PathBuf,
    name: &str,
) -> (PathBuf, PathBuf, PathBuf) {
    let favorites = root.join(LOCAL_FAVORITES);
    let trash = root.join(LOCAL_TRASH);
    fs::create_dir_all(&favorites).unwrap();
    fs::create_dir_all(&trash).unwrap();
    if crate::file_ops::read_service_role(&favorites) != Some(ServiceRole::Favorites) {
        write_service_role(&favorites, ServiceRole::Favorites).unwrap();
    }
    if crate::file_ops::read_service_role(&trash) != Some(ServiceRole::Trash) {
        write_service_role(&trash, ServiceRole::Trash).unwrap();
    }
    let origin = root.join(name);
    let copy = favorites.join(name);
    fs::write(&origin, b"x").unwrap();
    fs::write(&copy, b"x").unwrap();
    let om = fs::metadata(&origin).unwrap();
    let cm = fs::metadata(&copy).unwrap();
    let hash = crate::file_ops::sha256_file(&origin).unwrap();
    database::record_favorite_copy(
        conn,
        origin.to_str().unwrap(),
        om.len(),
        modified_ms(&om),
        copy.to_str().unwrap(),
        cm.len(),
        modified_ms(&cm),
        Some(&hash),
    )
    .unwrap();
    let trash_file = trash.join(name);
    fs::rename(&origin, &trash_file).unwrap();
    database::record_trash(
        conn,
        trash_file.to_str().unwrap(),
        origin.to_str().unwrap(),
        om.len(),
    )
    .unwrap();
    (origin, copy, trash_file)
}

fn link_ready(
    conn: &Connection,
    root: &PathBuf,
    name: &str,
) -> (PathBuf, PathBuf) {
    let favorites = root.join(LOCAL_FAVORITES);
    fs::create_dir_all(&favorites).unwrap();
    if crate::file_ops::read_service_role(&favorites) != Some(ServiceRole::Favorites) {
        write_service_role(&favorites, ServiceRole::Favorites).unwrap();
    }
    let origin = root.join(name);
    let copy = favorites.join(name);
    fs::write(&origin, b"ready-bytes").unwrap();
    fs::write(&copy, b"ready-bytes").unwrap();
    let om = fs::metadata(&origin).unwrap();
    let cm = fs::metadata(&copy).unwrap();
    let hash = crate::file_ops::sha256_file(&origin).unwrap();
    database::record_favorite_copy(
        conn,
        origin.to_str().unwrap(),
        om.len(),
        modified_ms(&om),
        copy.to_str().unwrap(),
        cm.len(),
        modified_ms(&cm),
        Some(&hash),
    )
    .unwrap();
    (origin, copy)
}

#[test]
fn f6_mixed_batch_three_recycled_one_failed_keeps_results_in_order() {
    let root = sandbox();
    let conn = Mutex::new(db());
    let (_, copy_a) = link_ready(&conn.lock().unwrap(), &root, "a.jpg");
    let (_, copy_b) = link_ready(&conn.lock().unwrap(), &root, "b.jpg");
    let (_, copy_c) = link_ready(&conn.lock().unwrap(), &root, "c.jpg");
    let missing = root.join(LOCAL_FAVORITES).join("missing.jpg");
    let items = vec![
        FavoriteBatchRemoveItem {
            path: copy_a.to_str().unwrap().to_string(),
            confirmed: true,
            resolution: None,
        },
        FavoriteBatchRemoveItem {
            path: missing.to_str().unwrap().to_string(),
            confirmed: true,
            resolution: None,
        },
        FavoriteBatchRemoveItem {
            path: copy_b.to_str().unwrap().to_string(),
            confirmed: true,
            resolution: None,
        },
        FavoriteBatchRemoveItem {
            path: copy_c.to_str().unwrap().to_string(),
            confirmed: true,
            resolution: None,
        },
    ];
    let out = remove_favorite_copies_batch(&conn, &items).unwrap();
    assert_eq!(out.len(), 4);
    assert_eq!(out[0].result.status, "recycled");
    assert_eq!(out[1].result.status, "failed");
    assert_eq!(out[2].result.status, "recycled");
    assert_eq!(out[3].result.status, "recycled");
    assert!(
        database::favorite_snapshot_for_copy(&conn.lock().unwrap(), copy_a.to_str().unwrap())
            .unwrap()
            .is_none()
    );
    assert!(
        database::favorite_snapshot_for_copy(&conn.lock().unwrap(), copy_b.to_str().unwrap())
            .unwrap()
            .is_none()
    );
    assert!(
        database::favorite_snapshot_for_copy(&conn.lock().unwrap(), copy_c.to_str().unwrap())
            .unwrap()
            .is_none()
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn b4_mixed_batch_restore_skips_ready_recycle() {
    let root = sandbox();
    let favorites = root.join(LOCAL_FAVORITES);
    fs::create_dir_all(&favorites).unwrap();
    write_service_role(&favorites, ServiceRole::Favorites).unwrap();
    let conn = Mutex::new(db());
    let ready_origin = root.join("ready.jpg");
    let ready_copy = favorites.join("ready.jpg");
    fs::write(&ready_origin, b"r").unwrap();
    fs::write(&ready_copy, b"r").unwrap();
    let rom = fs::metadata(&ready_origin).unwrap();
    let rcm = fs::metadata(&ready_copy).unwrap();
    let rh = crate::file_ops::sha256_file(&ready_origin).unwrap();
    database::record_favorite_copy(
        &conn.lock().unwrap(),
        ready_origin.to_str().unwrap(),
        rom.len(),
        modified_ms(&rom),
        ready_copy.to_str().unwrap(),
        rcm.len(),
        modified_ms(&rcm),
        Some(&rh),
    )
    .unwrap();
    let (trash_origin, trash_copy, _) =
        link_with_trash_origin(&conn.lock().unwrap(), &root, "trash.jpg");
    let items = vec![
        FavoriteBatchRemoveItem {
            path: ready_copy.to_str().unwrap().to_string(),
            confirmed: true,
            resolution: Some("restore_origin".to_string()),
        },
        FavoriteBatchRemoveItem {
            path: trash_copy.to_str().unwrap().to_string(),
            confirmed: true,
            resolution: Some("restore_origin".to_string()),
        },
    ];
    let out = remove_favorite_copies_batch(&conn, &items).unwrap();
    let ready_result = out
        .iter()
        .find(|row| row.path == ready_copy.to_str().unwrap())
        .unwrap();
    assert_eq!(ready_result.result.status, "skipped");
    let trash_result = out
        .iter()
        .find(|row| row.path == trash_copy.to_str().unwrap())
        .unwrap();
    assert_eq!(trash_result.result.status, "restored_origin");
    assert!(ready_copy.is_file());
    assert!(trash_origin.is_file());
    assert!(trash_copy.is_file());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn b2_batch_recycle_copy_resolution() {
    let root = sandbox();
    let conn = Mutex::new(db());
    let (_, copy, trash_file) =
        link_with_trash_origin(&conn.lock().unwrap(), &root, "one.jpg");
    let result = remove_favorite_copy_distributed(
        &conn,
        copy.to_str().unwrap(),
        true,
        Some("recycle_copy"),
    )
    .unwrap();
    assert_eq!(result.status, "recycled");
    assert!(!copy.is_file());
    assert!(trash_file.is_file());
    let _ = fs::remove_dir_all(&root);
}

mod fault_injection_cp {
    use super::*;
    use crate::database::{
        self, FileOpLog, ST_COMPLETED, ST_FAILED, ST_NEEDS_RECONCILIATION, ST_PENDING,
    };
    use crate::file_ops::reconcile::{reconcile_one, reconcile_on_boot};

    fn pending_recycle(copy: &std::path::Path, origin: &str, id: &str) -> FileOpLog {
        FileOpLog {
            id: id.to_string(),
            op_type: database::OP_REMOVE_FROM_FAVORITES.to_string(),
            source_path: copy.to_str().unwrap().to_string(),
            destination_path: None,
            origin_path: Some(origin.to_string()),
            source_name: Some(copy.file_name().unwrap().to_string_lossy().to_string()),
            source_size: Some(1),
            source_modified_at: None,
            status: ST_PENDING.to_string(),
            error_code: None,
            error_message: None,
        }
    }

    fn pending_restore(trash: &std::path::Path, origin: &std::path::Path, id: &str) -> FileOpLog {
        FileOpLog {
            id: id.to_string(),
            op_type: database::OP_RESTORE_FROM_LOCAL_TRASH.to_string(),
            source_path: trash.to_str().unwrap().to_string(),
            destination_path: Some(origin.to_str().unwrap().to_string()),
            origin_path: Some(origin.to_str().unwrap().to_string()),
            source_name: Some(trash.file_name().unwrap().to_string_lossy().to_string()),
            source_size: Some(1),
            source_modified_at: None,
            status: ST_PENDING.to_string(),
            error_code: None,
            error_message: None,
        }
    }

    #[test]
    fn recycle_copy_cp1_pending_before_fs_leaves_copy_and_origin_in_trash() {
        let root = sandbox();
        let conn = db();
        let (origin, copy, trash_file) = link_with_trash_origin(&conn, &root, "cp1.jpg");
        let row = pending_recycle(&copy, origin.to_str().unwrap(), "cp-r1");
        database::insert_pending_op(&conn, &row).unwrap();
        let status = reconcile_one(&conn, &row).unwrap();
        assert_eq!(status, ST_FAILED);
        assert!(copy.is_file());
        assert!(trash_file.is_file());
        assert!(
            database::favorite_snapshot_for_copy(&conn, copy.to_str().unwrap())
                .unwrap()
                .is_some()
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn recycle_copy_cp2_after_fs_before_sqlite_finishes_link() {
        let root = sandbox();
        let conn = db();
        let (origin, copy, trash_file) = link_with_trash_origin(&conn, &root, "cp2.jpg");
        let row = pending_recycle(&copy, origin.to_str().unwrap(), "cp-r2");
        database::insert_pending_op(&conn, &row).unwrap();
        fs::remove_file(&copy).unwrap();
        let status = reconcile_one(&conn, &row).unwrap();
        assert_eq!(status, ST_COMPLETED);
        assert!(!copy.is_file());
        assert!(trash_file.is_file());
        assert!(
            database::favorite_snapshot_for_copy(&conn, copy.to_str().unwrap())
                .unwrap()
                .is_none()
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn recycle_copy_cp3_after_sqlite_before_finish_is_idempotent() {
        let root = sandbox();
        let conn = db();
        let (origin, copy, trash_file) = link_with_trash_origin(&conn, &root, "cp3.jpg");
        let row = pending_recycle(&copy, origin.to_str().unwrap(), "cp-r3");
        database::insert_pending_op(&conn, &row).unwrap();
        fs::remove_file(&copy).unwrap();
        database::delete_favorite_copy_path(&conn, copy.to_str().unwrap()).unwrap();
        let status = reconcile_one(&conn, &row).unwrap();
        assert_eq!(status, ST_COMPLETED);
        assert!(trash_file.is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn recycle_copy_cp4_second_reconcile_boot_is_noop() {
        let root = sandbox();
        let conn = db();
        let (origin, copy, _) = link_with_trash_origin(&conn, &root, "cp4.jpg");
        let row = pending_recycle(&copy, origin.to_str().unwrap(), "cp-r4");
        database::insert_pending_op(&conn, &row).unwrap();
        fs::remove_file(&copy).unwrap();
        reconcile_on_boot(&conn);
        assert!(
            database::favorite_snapshot_for_copy(&conn, copy.to_str().unwrap())
                .unwrap()
                .is_none()
        );
        reconcile_on_boot(&conn);
        assert!(
            database::favorite_snapshot_for_copy(&conn, copy.to_str().unwrap())
                .unwrap()
                .is_none()
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn restore_origin_cp1_pending_before_fs_fails_while_trash_remains() {
        let root = sandbox();
        let conn = db();
        let (origin, copy, trash_file) = link_with_trash_origin(&conn, &root, "rs1.jpg");
        let row = pending_restore(&trash_file, &origin, "cp-s1");
        database::insert_pending_op(&conn, &row).unwrap();
        let status = reconcile_one(&conn, &row).unwrap();
        assert_eq!(status, ST_FAILED);
        assert!(trash_file.is_file());
        assert!(!origin.is_file());
        assert!(copy.is_file());
        assert!(
            database::favorite_snapshot_for_copy(&conn, copy.to_str().unwrap())
                .unwrap()
                .is_some()
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn restore_origin_cp2_after_fs_before_sqlite_clears_trash_row() {
        let root = sandbox();
        let conn = db();
        let (origin, copy, trash_file) = link_with_trash_origin(&conn, &root, "rs2.jpg");
        let row = pending_restore(&trash_file, &origin, "cp-s2");
        database::insert_pending_op(&conn, &row).unwrap();
        fs::rename(&trash_file, &origin).unwrap();
        let status = reconcile_one(&conn, &row).unwrap();
        assert_eq!(status, ST_COMPLETED);
        assert!(origin.is_file());
        assert!(copy.is_file());
        assert!(database::trash_origin(&conn, trash_file.to_str().unwrap()).unwrap().is_none());
        assert!(
            database::favorite_snapshot_for_copy(&conn, copy.to_str().unwrap())
                .unwrap()
                .is_some()
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn restore_origin_cp3_after_sqlite_before_finish_completes_journal() {
        let root = sandbox();
        let conn = db();
        let (origin, copy, trash_file) = link_with_trash_origin(&conn, &root, "rs3.jpg");
        let row = pending_restore(&trash_file, &origin, "cp-s3");
        database::insert_pending_op(&conn, &row).unwrap();
        fs::rename(&trash_file, &origin).unwrap();
        database::delete_trash(&conn, trash_file.to_str().unwrap()).unwrap();
        let status = reconcile_one(&conn, &row).unwrap();
        assert_eq!(status, ST_COMPLETED);
        assert!(copy.is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn restore_origin_cp4_double_reconcile_boot_is_idempotent() {
        let root = sandbox();
        let conn = db();
        let (origin, copy, trash_file) = link_with_trash_origin(&conn, &root, "rs4.jpg");
        let row = pending_restore(&trash_file, &origin, "cp-s4");
        database::insert_pending_op(&conn, &row).unwrap();
        fs::rename(&trash_file, &origin).unwrap();
        reconcile_on_boot(&conn);
        assert!(origin.is_file());
        assert!(copy.is_file());
        reconcile_on_boot(&conn);
        assert!(origin.is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn restore_origin_both_paths_missing_needs_reconciliation() {
        let root = sandbox();
        let conn = db();
        let (origin, copy, trash_file) = link_with_trash_origin(&conn, &root, "orphan.jpg");
        let row = pending_restore(&trash_file, &origin, "cp-orphan");
        database::insert_pending_op(&conn, &row).unwrap();
        fs::remove_file(&trash_file).unwrap();
        assert!(!origin.is_file());
        let status = reconcile_one(&conn, &row).unwrap();
        assert_eq!(status, ST_NEEDS_RECONCILIATION);
        assert!(
            database::favorite_snapshot_for_copy(&conn, copy.to_str().unwrap())
                .unwrap()
                .is_some()
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn recycle_copy_cp1_failed_reconcile_allows_safe_user_retry() {
        let root = sandbox();
        let conn = Mutex::new(db());
        let (origin, copy) = link_ready(&conn.lock().unwrap(), &root, "retry.jpg");
        let row = pending_recycle(&copy, origin.to_str().unwrap(), "cp-retry");
        database::insert_pending_op(&conn.lock().unwrap(), &row).unwrap();
        let status = reconcile_one(&conn.lock().unwrap(), &row).unwrap();
        assert_eq!(status, ST_FAILED);
        assert!(copy.is_file());
        let retry = remove_favorite_copy_distributed(
            &conn,
            copy.to_str().unwrap(),
            true,
            None,
        )
        .unwrap();
        assert_eq!(retry.status, "recycled");
        assert!(
            database::favorite_snapshot_for_copy(&conn.lock().unwrap(), copy.to_str().unwrap())
                .unwrap()
                .is_none()
        );
        assert!(origin.is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn restore_origin_conflict_origin_already_present_fails_reconcile() {
        let root = sandbox();
        let conn = db();
        let (origin, copy, trash_file) = link_with_trash_origin(&conn, &root, "conf.jpg");
        fs::write(&origin, b"blocker").unwrap();
        let row = pending_restore(&trash_file, &origin, "cp-conf");
        database::insert_pending_op(&conn, &row).unwrap();
        let status = reconcile_one(&conn, &row).unwrap();
        assert_eq!(status, ST_FAILED);
        assert!(trash_file.is_file());
        assert!(copy.is_file());
        let _ = fs::remove_dir_all(&root);
    }
}
