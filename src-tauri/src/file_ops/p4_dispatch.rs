//! P4a VERIFY (T038): missing-origin без FR-11 resolution не уходит в recycle.
//! Только temp FS + in-memory SQLite.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use rusqlite::Connection;

use super::favorites::{
    load_removal_context, plan_removal, remove_favorite_copy, remove_favorite_copy_distributed,
    ConfirmKind, Plan,
};
use super::locks::try_claim_favorite_removal;
use super::{write_service_role, ServiceRole, LOCAL_FAVORITES};
use crate::database;
use crate::file_ops::content_hash::sha256_file;

fn sandbox(tag: &str) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let root = std::env::temp_dir().join(format!(
        "sv-fav-p4-{}-{}-{}",
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

fn missing_origin_fixture(tag: &str) -> (PathBuf, Connection, PathBuf) {
    let root = sandbox(tag);
    let conn = memory_db();
    let favorites = root.join(LOCAL_FAVORITES);
    fs::create_dir_all(&favorites).unwrap();
    write_service_role(&favorites, ServiceRole::Favorites).unwrap();
    let origin = root.join("gone.jpg");
    let copy = favorites.join("gone.jpg");
    write_bytes(&origin, b"missing-origin-bytes");
    write_bytes(&copy, b"missing-origin-bytes");
    record_link(&conn, &origin, &copy);
    fs::remove_file(&origin).unwrap();
    (root, conn, copy)
}

/// T038 / SC-005: missing origin + confirmed без resolution → не recycle.
#[test]
fn p4_t038_missing_origin_confirmed_without_resolution_never_recycles() {
    let (root, conn, copy) = missing_origin_fixture("t038");
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
        "fixture must be UnknownOrigin"
    );

    let result = remove_favorite_copy(&conn, copy.to_str().unwrap(), true, None).unwrap();
    assert_ne!(result.status, "recycled");
    assert_ne!(result.status, "relocated");
    assert_eq!(result.status, "needs_confirm");
    assert_eq!(result.confirm_kind.as_deref(), Some("unknown_origin"));
    assert_eq!(result.fr11_required, Some(true));
    assert!(copy.is_file(), "copy must remain in Избранное");

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn p4_fr11_a_return_to_source_relocates_with_gate() {
    let (root, conn, copy) = missing_origin_fixture("fr11-a");
    let result = remove_favorite_copy(
        &conn,
        copy.to_str().unwrap(),
        true,
        Some("return_to_source"),
    )
    .unwrap();
    assert_eq!(result.status, "relocated");
    assert!(!copy.is_file(), "copy left Избранное after A");
    let restored = result.restored_path.expect("restored_path");
    assert!(PathBuf::from(&restored).is_file());

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn p4_fr11_c_cancel_keeps_copy() {
    let (root, conn, copy) = missing_origin_fixture("fr11-c");
    let result =
        remove_favorite_copy(&conn, copy.to_str().unwrap(), true, Some("cancel")).unwrap();
    assert_eq!(result.status, "skipped");
    assert_eq!(result.notice_code.as_deref(), Some("cancelled"));
    assert!(copy.is_file());

    let keep =
        remove_favorite_copy(&conn, copy.to_str().unwrap(), true, Some("keep_copy")).unwrap();
    assert_eq!(keep.status, "skipped");
    assert!(copy.is_file());

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn p4_fr11_b_choose_folder_relocates_into_chosen() {
    let (root, conn, copy) = missing_origin_fixture("fr11-b-ok");
    let chosen = root.join("picked");
    fs::create_dir_all(&chosen).unwrap();
    let resolution = format!("choose_folder:{}", chosen.to_str().unwrap());
    let result =
        remove_favorite_copy(&conn, copy.to_str().unwrap(), true, Some(&resolution)).unwrap();
    assert_eq!(result.status, "relocated");
    assert!(!copy.is_file(), "copy left Избранное after B");
    let restored = PathBuf::from(result.restored_path.expect("restored_path"));
    assert!(
        restored.starts_with(&chosen),
        "restored under chosen: {}",
        restored.display()
    );
    assert!(restored.is_file());

    let _ = fs::remove_dir_all(&root);
}

/// Занятый путь (файл вместо каталога) — Err, копия и occupant сохраняются (CL-00).
#[test]
fn p4_fr11_b_choose_folder_occupied_conflict() {
    let (root, conn, copy) = missing_origin_fixture("fr11-b-conflict");
    let occupied = root.join("occupied-as-file");
    write_bytes(&occupied, b"NOT-A-DIRECTORY");
    let resolution = format!("choose_folder:{}", occupied.to_str().unwrap());
    let err = remove_favorite_copy(&conn, copy.to_str().unwrap(), true, Some(&resolution))
        .unwrap_err();
    assert!(!err.is_empty(), "must reject occupied non-dir target");
    assert!(copy.is_file(), "CL-00: copy kept on conflict");
    assert_eq!(
        fs::read(&occupied).unwrap(),
        b"NOT-A-DIRECTORY",
        "occupant bytes must survive"
    );

    // Предпочитаемое имя занято чужим содержимым: gate не перезаписывает;
    // claim берёт свободный суффикс — чужие байты целы (как return_to_source / T012).
    let (root2, conn2, copy2) = missing_origin_fixture("fr11-b-name");
    let chosen = root2.join("picked-id");
    fs::create_dir_all(&chosen).unwrap();
    let preferred = chosen.join("gone (из избранного).jpg");
    let occupant = b"OTHER-OCCUPANT";
    write_bytes(&preferred, occupant);
    let resolution = format!("choose_folder:{}", chosen.to_str().unwrap());
    let result =
        remove_favorite_copy(&conn2, copy2.to_str().unwrap(), true, Some(&resolution)).unwrap();
    assert_eq!(result.status, "relocated");
    assert_eq!(fs::read(&preferred).unwrap(), occupant);
    let restored = PathBuf::from(result.restored_path.expect("restored_path"));
    assert_ne!(restored, preferred);

    let _ = fs::remove_dir_all(&root);
    let _ = fs::remove_dir_all(&root2);
}

#[test]
fn p4_fr11_b_choose_folder_requires_path() {
    let (root, conn, copy) = missing_origin_fixture("fr11-b-bare");
    let err = remove_favorite_copy(
        &conn,
        copy.to_str().unwrap(),
        true,
        Some("choose_folder"),
    )
    .unwrap_err();
    assert!(
        err.contains("папк") || err.contains("FR-11"),
        "{err}"
    );
    assert!(copy.is_file());

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn p4_t033_duplicate_in_flight_removal_rejected() {
    let (root, conn, copy) = missing_origin_fixture("t033");
    let path = copy.to_str().unwrap().to_string();
    let db = Mutex::new(conn);

    let _hold = try_claim_favorite_removal(Path::new(&path)).unwrap();
    let err = remove_favorite_copy_distributed(&db, &path, true, None).unwrap_err();
    assert!(
        err.contains("уже выполняется"),
        "duplicate in-flight must fail: {err}"
    );
    drop(_hold);

    // После снятия claim обычный FR-11 путь снова доступен.
    let result = remove_favorite_copy_distributed(&db, &path, true, None).unwrap();
    assert_eq!(result.status, "needs_confirm");
    assert!(copy.is_file());

    let _ = fs::remove_dir_all(&root);
}
