//! P5 VERIFY (T045 / EC-10): смешанный batch с missing-origin.
//! Только temp FS + in-memory SQLite.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use rusqlite::Connection;

use super::favorites_batch::{
    preview_remove_favorite_copies_bucketed, remove_favorite_copies_batch, FavoriteBatchRemoveItem,
    PreviewConfirmBucket, classify_preview_bucket,
};
use super::{write_service_role, ServiceRole, LOCAL_FAVORITES};
use crate::database;
use crate::file_ops::content_hash::sha256_file;

fn sandbox(tag: &str) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let root = std::env::temp_dir().join(format!(
        "sv-fav-p5-{}-{}-{}",
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

fn link_ready(db: &Connection, root: &Path, name: &str, bytes: &[u8]) -> (PathBuf, PathBuf) {
    let favorites = root.join(LOCAL_FAVORITES);
    fs::create_dir_all(&favorites).unwrap();
    write_service_role(&favorites, ServiceRole::Favorites).unwrap();
    let origin = root.join(name);
    let copy = favorites.join(name);
    write_bytes(&origin, bytes);
    write_bytes(&copy, bytes);
    record_link(db, &origin, &copy);
    (origin, copy)
}

fn link_missing_origin(db: &Connection, root: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let (_origin, copy) = link_ready(db, root, name, bytes);
    fs::remove_file(root.join(name)).unwrap();
    copy
}

/// Ambiguous: missing recorded origin + sibling decoy того же размера/байт в родителе.
fn link_ambiguous_missing(db: &Connection, root: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let favorites = root.join(LOCAL_FAVORITES);
    fs::create_dir_all(&favorites).unwrap();
    write_service_role(&favorites, ServiceRole::Favorites).unwrap();
    let decoy = root.join(format!("decoy-{name}"));
    write_bytes(&decoy, bytes);
    let copy = favorites.join(name);
    write_bytes(&copy, bytes);
    let om = fs::metadata(&decoy).unwrap();
    let cm = fs::metadata(&copy).unwrap();
    let hash = sha256_file(&copy).unwrap();
    database::record_favorite_copy(
        db,
        &format!(r"C:\gone\{name}"),
        om.len(),
        stamp_ms(&om),
        copy.to_str().unwrap(),
        cm.len(),
        stamp_ms(&cm),
        Some(&hash),
    )
    .unwrap();
    copy
}

fn link_origin_changed(db: &Connection, root: &Path, name: &str) -> PathBuf {
    let favorites = root.join(LOCAL_FAVORITES);
    fs::create_dir_all(&favorites).unwrap();
    write_service_role(&favorites, ServiceRole::Favorites).unwrap();
    let origin = root.join(name);
    let copy = favorites.join(name);
    write_bytes(&origin, b"origin-v1");
    write_bytes(&copy, b"origin-v1");
    record_link(db, &origin, &copy);
    write_bytes(&origin, b"origin-CHANGED");
    copy
}

/// T040 + T045: preview раскладывает ready / fr11Required / standardConfirm.
#[test]
fn p5_t040_preview_buckets_mixed_missing_origin() {
    let root = sandbox("t040-preview");
    let conn = Mutex::new(memory_db());
    let (_o, ready_copy) = link_ready(&conn.lock().unwrap(), &root, "ready.jpg", b"ready-bytes");
    let missing_copy =
        link_missing_origin(&conn.lock().unwrap(), &root, "gone.jpg", b"missing-bytes");
    let ambiguous_copy =
        link_ambiguous_missing(&conn.lock().unwrap(), &root, "amb.jpg", b"amb-bytes");
    let changed_copy = link_origin_changed(&conn.lock().unwrap(), &root, "changed.jpg");

    let paths = vec![
        ready_copy.to_str().unwrap().to_string(),
        missing_copy.to_str().unwrap().to_string(),
        ambiguous_copy.to_str().unwrap().to_string(),
        changed_copy.to_str().unwrap().to_string(),
    ];
    let buckets = preview_remove_favorite_copies_bucketed(&conn, &paths).unwrap();

    assert_eq!(buckets.ready.len(), 1);
    assert_eq!(buckets.ready[0].path, ready_copy.to_str().unwrap());
    assert_eq!(buckets.ready[0].result.status, "ready");

    assert_eq!(buckets.fr11_required.len(), 2);
    for row in &buckets.fr11_required {
        assert_eq!(row.result.status, "needs_confirm");
        assert_eq!(row.result.fr11_required, Some(true));
        assert!(
            matches!(
                row.result.confirm_kind.as_deref(),
                Some("unknown_origin") | Some("ambiguous_origin")
            ),
            "got {:?}",
            row.result.confirm_kind
        );
        assert_eq!(
            classify_preview_bucket(&row.result),
            PreviewConfirmBucket::Fr11Required
        );
    }

    assert_eq!(buckets.standard_confirm.len(), 1);
    assert_eq!(buckets.standard_confirm[0].path, changed_copy.to_str().unwrap());
    assert_eq!(
        buckets.standard_confirm[0].result.confirm_kind.as_deref(),
        Some("origin_changed")
    );
    assert!(buckets.standard_confirm[0].result.fr11_required.is_none());

    let _ = fs::remove_dir_all(&root);
}

/// T041 + T045 / EC-10: mixed batch — FR-11 без resolution не auto-relocate;
/// ready recycles; FR-11 с resolution — per-item; standard confirm relocates.
#[test]
fn p5_t045_mixed_missing_origin_batch_per_item_dispatch() {
    let root = sandbox("t045-mixed");
    let conn = Mutex::new(memory_db());
    let (_o, ready_copy) = link_ready(&conn.lock().unwrap(), &root, "ok.jpg", b"ok-body");
    let fr11_no_res =
        link_missing_origin(&conn.lock().unwrap(), &root, "fr11-keep.jpg", b"keep-me");
    let fr11_relocate =
        link_missing_origin(&conn.lock().unwrap(), &root, "fr11-move.jpg", b"move-me");
    let changed_copy = link_origin_changed(&conn.lock().unwrap(), &root, "chg.jpg");

    let items = vec![
        FavoriteBatchRemoveItem {
            path: ready_copy.to_str().unwrap().to_string(),
            confirmed: true,
            resolution: None,
        },
        FavoriteBatchRemoveItem {
            path: fr11_no_res.to_str().unwrap().to_string(),
            confirmed: true,
            resolution: None,
        },
        FavoriteBatchRemoveItem {
            path: fr11_relocate.to_str().unwrap().to_string(),
            confirmed: true,
            resolution: Some("return_to_source".to_string()),
        },
        FavoriteBatchRemoveItem {
            path: changed_copy.to_str().unwrap().to_string(),
            confirmed: true,
            resolution: None,
        },
    ];
    let out = remove_favorite_copies_batch(&conn, &items).unwrap();
    assert_eq!(out.len(), 4);

    assert_eq!(out[0].result.status, "recycled");
    assert!(!ready_copy.is_file());

    // FR-11 без resolution: needs_confirm + fr11Required; копия на месте (не false success).
    assert_eq!(out[1].result.status, "needs_confirm");
    assert_eq!(out[1].result.fr11_required, Some(true));
    assert_ne!(out[1].result.status, "recycled");
    assert_ne!(out[1].result.status, "relocated");
    assert!(fr11_no_res.is_file(), "FR-11 copy must stay without resolution");

    assert_eq!(out[2].result.status, "relocated");
    assert!(!fr11_relocate.is_file());
    let restored = out[2].result.restored_path.as_ref().expect("restored_path");
    assert!(PathBuf::from(restored).is_file());

    assert_eq!(out[3].result.status, "relocated");
    assert!(!changed_copy.is_file());

    let _ = fs::remove_dir_all(&root);
}

/// T041: confirmed batch не удаляет ambiguous без resolution (EC-10).
#[test]
fn p5_t041_ambiguous_batch_never_auto_deletes() {
    let root = sandbox("t041-amb");
    let conn = Mutex::new(memory_db());
    let amb = link_ambiguous_missing(&conn.lock().unwrap(), &root, "a.jpg", b"amb-body");
    let items = vec![FavoriteBatchRemoveItem {
        path: amb.to_str().unwrap().to_string(),
        confirmed: true,
        resolution: None,
    }];
    let out = remove_favorite_copies_batch(&conn, &items).unwrap();
    assert_eq!(out[0].result.status, "needs_confirm");
    assert_eq!(out[0].result.confirm_kind.as_deref(), Some("ambiguous_origin"));
    assert_eq!(out[0].result.fr11_required, Some(true));
    assert!(amb.is_file());

    let _ = fs::remove_dir_all(&root);
}
