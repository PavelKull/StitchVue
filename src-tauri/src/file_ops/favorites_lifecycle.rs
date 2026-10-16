use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use rusqlite::Connection;

use super::content_hash::sha256_file;
use super::favorites::active_favorite_origins_in;
use super::recycle::authorize_favorite_copy;
use super::{
    active_favorites_folder, execute, is_active_favorites_folder, is_favorites_folder_name,
    read_role_marker, read_service_role, rename_child_folder, same_path, Action, IoGate,
    OperationRequest, LOCAL_FAVORITES, LOCAL_FAVORITES_ALT, ServiceRole,
};
use crate::database;
use crate::scanner::list_directory;

struct DirectIo;

impl IoGate for DirectIo {
    fn wait_visible(&self, cancel: &AtomicBool) -> bool {
        !cancel.load(Ordering::Relaxed)
    }

    fn with_read<T>(&self, work: impl FnOnce() -> T) -> T {
        work()
    }
}

fn sandbox() -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let root = std::env::temp_dir().join(format!(
        "sv-fav-life-{}-{}",
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

fn write_image(path: &Path, bytes: &[u8]) {
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
        &origin.to_string_lossy(),
        origin_meta.len(),
        stamp_ms(&origin_meta),
        &copy.to_string_lossy(),
        copy_meta.len(),
        stamp_ms(&copy_meta),
        Some(&hash),
    )
    .unwrap();
}

fn add_photos(root: &Path, db: &Connection, count: usize) -> Vec<(PathBuf, PathBuf)> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let stamp = NEXT.fetch_add(count as u64, Ordering::Relaxed);
    let mut origins = Vec::new();
    let mut requested = Vec::new();
    for index in 0..count {
        let origin = root.join(format!("photo-{stamp}-{index}.jpg"));
        write_image(&origin, format!("body-{stamp}-{index}").as_bytes());
        requested.push(origin.display().to_string());
        origins.push(origin);
    }
    let result = execute(
        &DirectIo,
        &OperationRequest {
            operation_id: format!("add-{}-{}", std::process::id(), stamp),
            directory: root.display().to_string(),
            action: Action::CopyToLocalFavorites,
            paths: requested,
        },
        1,
        &AtomicBool::new(false),
        &|_| {},
    )
    .unwrap();
    assert_eq!(result.state, "completed");
    let favorites = root.join(LOCAL_FAVORITES);
    let mut pairs = Vec::new();
    for (index, origin) in origins.iter().enumerate() {
        let outcome = &result.outcomes[index];
        assert_eq!(outcome.status, "copied");
        let copy = PathBuf::from(outcome.destination_path.as_ref().unwrap());
        assert!(same_path(copy.parent().unwrap(), &favorites));
        record_link(db, origin, &copy);
        pairs.push((origin.clone(), copy));
    }
    pairs
}

fn row_count(db: &Connection) -> i64 {
    db.query_row("SELECT COUNT(*) FROM favorite_copies", [], |row| row.get(0))
        .unwrap()
}

fn hashes(paths: impl IntoIterator<Item = PathBuf>) -> Vec<String> {
    paths.into_iter().map(|path| sha256_file(&path).unwrap()).collect()
}

fn finish_collection(root: &Path, db: &Connection, new_name: &str) -> PathBuf {
    let favorites = root.join(LOCAL_FAVORITES);
    let old = favorites.display().to_string();
    let new_path = rename_child_folder(&root.display().to_string(), &old, new_name).unwrap();
    database::relocate_folder_path(db, &old, &new_path, new_name).unwrap();
    PathBuf::from(new_path)
}

#[test]
fn adding_ten_photos_creates_copies_and_active_stars() {
    let root = sandbox();
    let db = memory_db();
    let pairs = add_photos(&root, &db, 10);
    let origins = active_favorite_origins_in(&db, &root.display().to_string()).unwrap();
    assert_eq!(origins.len(), 10);
    assert_eq!(row_count(&db), 10);
    for (origin, copy) in &pairs {
        assert!(origin.is_file());
        assert!(copy.is_file());
        assert_eq!(sha256_file(origin).unwrap(), sha256_file(copy).unwrap());
    }
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn app_rename_deactivates_stars_and_keeps_copies() {
    let root = sandbox();
    let db = memory_db();
    let pairs = add_photos(&root, &db, 3);
    let origin_hashes = hashes(pairs.iter().map(|(origin, _)| origin.clone()));
    let copy_hashes = hashes(pairs.iter().map(|(_, copy)| copy.clone()));
    let renamed = finish_collection(&root, &db, "Лучшие фото");
    assert!(!is_active_favorites_folder(&renamed));
    assert!(read_role_marker(&renamed).is_none());
    assert!(read_service_role(&renamed).is_none());
    assert!(active_favorites_folder(&root).is_none());
    assert!(active_favorite_origins_in(&db, &root.display().to_string())
        .unwrap()
        .is_empty());
    assert_eq!(row_count(&db), 3);
    for (index, (origin, copy)) in pairs.iter().enumerate() {
        assert!(origin.is_file());
        let moved = renamed.join(copy.file_name().unwrap());
        assert!(moved.is_file());
        assert_eq!(sha256_file(origin).unwrap(), origin_hashes[index]);
        assert_eq!(sha256_file(&moved).unwrap(), copy_hashes[index]);
    }
    let listed = list_directory(&root).unwrap();
    let folder = listed
        .folders
        .iter()
        .find(|item| item.name == "Лучшие фото")
        .expect("renamed folder");
    assert!(folder.service_role.is_none());
    assert!(list_directory(&renamed).unwrap().service_role.is_none());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn explorer_rename_deactivates_stars_without_sqlite_wipe() {
    let root = sandbox();
    let db = memory_db();
    let pairs = add_photos(&root, &db, 2);
    let favorites = root.join(LOCAL_FAVORITES);
    let renamed = root.join("Лучшие фото");
    fs::rename(&favorites, &renamed).unwrap();
    assert_eq!(read_role_marker(&renamed), Some(ServiceRole::Favorites));
    assert!(read_service_role(&renamed).is_none());
    let before = row_count(&db);
    assert!(active_favorite_origins_in(&db, &root.display().to_string())
        .unwrap()
        .is_empty());
    assert_eq!(row_count(&db), before);
    for (_, copy) in &pairs {
        assert!(renamed.join(copy.file_name().unwrap()).is_file());
    }
    assert!(active_favorite_origins_in(&db, &root.display().to_string())
        .unwrap()
        .is_empty());
    assert_eq!(row_count(&db), before);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn add_after_rename_creates_new_active_favorites() {
    let root = sandbox();
    let db = memory_db();
    let first = add_photos(&root, &db, 2);
    let renamed = finish_collection(&root, &db, "Лучшие фото");
    let extra = root.join("photo-new.jpg");
    write_image(&extra, b"brand-new");
    let result = execute(
        &DirectIo,
        &OperationRequest {
            operation_id: format!("add-after-rename-{}", std::process::id()),
            directory: root.display().to_string(),
            action: Action::CopyToLocalFavorites,
            paths: vec![extra.display().to_string()],
        },
        1,
        &AtomicBool::new(false),
        &|_| {},
    )
    .unwrap();
    assert_eq!(result.outcomes[0].status, "copied");
    let new_copy = PathBuf::from(result.outcomes[0].destination_path.as_ref().unwrap());
    record_link(&db, &extra, &new_copy);
    let active = active_favorites_folder(&root).expect("new active folder");
    assert!(same_path(&active, &root.join(LOCAL_FAVORITES)));
    assert_eq!(read_service_role(&active), Some(ServiceRole::Favorites));
    let stars = active_favorite_origins_in(&db, &root.display().to_string()).unwrap();
    assert_eq!(stars.len(), 1);
    assert!(stars.iter().any(|path| same_path(Path::new(path), &extra)));
    assert!(renamed.join(first[0].1.file_name().unwrap()).is_file());
    assert!(!same_path(new_copy.parent().unwrap(), &renamed));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn leftover_marker_does_not_keep_renamed_folder_active() {
    let root = sandbox();
    let favorites = root.join(LOCAL_FAVORITES);
    fs::create_dir(&favorites).unwrap();
    super::write_service_role(&favorites, ServiceRole::Favorites).unwrap();
    write_image(&favorites.join("photo.jpg"), b"copy");
    let renamed = root.join("Альбом");
    fs::rename(&favorites, &renamed).unwrap();
    assert_eq!(read_role_marker(&renamed), Some(ServiceRole::Favorites));
    assert!(read_service_role(&renamed).is_none());
    let listed = list_directory(&root).unwrap();
    let folder = listed
        .folders
        .iter()
        .find(|item| item.name == "Альбом")
        .unwrap();
    assert!(folder.service_role.is_none());
    assert!(list_directory(&renamed).unwrap().service_role.is_none());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn restart_equivalent_read_matches_post_rename_state() {
    let root = sandbox();
    let db = memory_db();
    add_photos(&root, &db, 2);
    fs::rename(&root.join(LOCAL_FAVORITES), root.join("Лучшие фото")).unwrap();
    let first = active_favorite_origins_in(&db, &root.display().to_string()).unwrap();
    let second = active_favorite_origins_in(&db, &root.display().to_string()).unwrap();
    assert!(first.is_empty());
    assert_eq!(first, second);
    assert_eq!(row_count(&db), 2);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn rename_parent_rewrites_links_safely() {
    let root = sandbox();
    let album = root.join("Отпуск");
    fs::create_dir(&album).unwrap();
    let db = memory_db();
    let pairs = add_photos(&album, &db, 2);
    let origin_hashes = hashes(pairs.iter().map(|(origin, _)| origin.clone()));
    let new_album = rename_child_folder(
        &root.display().to_string(),
        &album.display().to_string(),
        "Отпуск 2026",
    )
    .unwrap();
    database::relocate_folder_path(&db, &album.display().to_string(), &new_album, "Отпуск 2026")
        .unwrap();
    let stars = active_favorite_origins_in(&db, &new_album).unwrap();
    assert_eq!(stars.len(), 2);
    let active = active_favorites_folder(Path::new(&new_album)).expect("still active");
    assert!(is_active_favorites_folder(&active));
    for (index, (origin, copy)) in pairs.iter().enumerate() {
        let new_origin = Path::new(&new_album).join(origin.file_name().unwrap());
        let new_copy = active.join(copy.file_name().unwrap());
        assert!(new_origin.is_file());
        assert!(new_copy.is_file());
        assert_eq!(sha256_file(&new_origin).unwrap(), origin_hashes[index]);
    }
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn failed_rename_keeps_active_collection() {
    let root = sandbox();
    let db = memory_db();
    add_photos(&root, &db, 1);
    let favorites = root.join(LOCAL_FAVORITES);
    fs::create_dir(root.join("занято")).unwrap();
    let err = rename_child_folder(
        &root.display().to_string(),
        &favorites.display().to_string(),
        "занято",
    )
    .unwrap_err();
    assert!(err.contains("уже существует"));
    assert!(is_active_favorites_folder(&favorites));
    assert_eq!(
        active_favorite_origins_in(&db, &root.display().to_string())
            .unwrap()
            .len(),
        1
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn missing_copy_path_does_not_delete_sqlite_rows() {
    let root = sandbox();
    let db = memory_db();
    add_photos(&root, &db, 2);
    let before = row_count(&db);
    fs::rename(&root.join(LOCAL_FAVORITES), root.join("offline-name")).unwrap();
    let stars = active_favorite_origins_in(&db, &root.display().to_string()).unwrap();
    assert!(stars.is_empty());
    assert_eq!(row_count(&db), before);
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn stale_copy_key_after_rename_does_not_light_stars() {
    let root = sandbox();
    let db = memory_db();
    add_photos(&root, &db, 2);
    fs::rename(&root.join(LOCAL_FAVORITES), root.join("Лучшие фото")).unwrap();
    assert_eq!(row_count(&db), 2);
    assert!(active_favorite_origins_in(&db, &root.display().to_string())
        .unwrap()
        .is_empty());
    let extra = root.join("other.jpg");
    write_image(&extra, b"other");
    let result = execute(
        &DirectIo,
        &OperationRequest {
            operation_id: format!("stale-key-{}", std::process::id()),
            directory: root.display().to_string(),
            action: Action::CopyToLocalFavorites,
            paths: vec![extra.display().to_string()],
        },
        1,
        &AtomicBool::new(false),
        &|_| {},
    )
    .unwrap();
    let new_copy = PathBuf::from(result.outcomes[0].destination_path.as_ref().unwrap());
    record_link(&db, &extra, &new_copy);
    let stars = active_favorite_origins_in(&db, &root.display().to_string()).unwrap();
    assert_eq!(stars.len(), 1);
    assert!(stars.iter().any(|path| same_path(Path::new(path), &extra)));
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn two_historical_collections_do_not_conflict_with_new_favorites() {
    let root = sandbox();
    let db = memory_db();
    let first = add_photos(&root, &db, 1);
    let best = finish_collection(&root, &db, "Лучшие фото");
    let first_copy = best.join(first[0].1.file_name().unwrap());
    let second = add_photos(&root, &db, 1);
    let great = finish_collection(&root, &db, "Отличные");
    let second_copy = great.join(second[0].1.file_name().unwrap());
    let third = add_photos(&root, &db, 1);
    let stars = active_favorite_origins_in(&db, &root.display().to_string()).unwrap();
    assert_eq!(stars.len(), 1);
    assert!(stars
        .iter()
        .any(|path| same_path(Path::new(path), &third[0].0)));
    assert!(first_copy.is_file());
    assert!(second_copy.is_file());
    assert!(same_path(
        third[0].1.parent().unwrap(),
        &root.join(LOCAL_FAVORITES)
    ));
    authorize_favorite_copy(&first_copy, &first[0].0).expect_err("historical copy");
    authorize_favorite_copy(&third[0].1, &third[0].0).unwrap();
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn historical_copies_are_not_authorized_as_active_favorites() {
    let root = sandbox();
    let db = memory_db();
    let first = add_photos(&root, &db, 1);
    let renamed = finish_collection(&root, &db, "Лучшие фото");
    let moved = renamed.join(first[0].1.file_name().unwrap());
    let newest = add_photos(&root, &db, 1);
    authorize_favorite_copy(&moved, &first[0].0).expect_err("old collection");
    authorize_favorite_copy(&newest[0].1, &newest[0].0).unwrap();
    assert!(moved.is_file());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn repeated_reconcile_is_idempotent() {
    let root = sandbox();
    let db = memory_db();
    let pairs = add_photos(&root, &db, 3);
    let origin_hashes = hashes(pairs.iter().map(|(origin, _)| origin.clone()));
    let copy_hashes = hashes(pairs.iter().map(|(_, copy)| copy.clone()));
    let directory = root.display().to_string();
    let first = active_favorite_origins_in(&db, &directory).unwrap();
    let second = active_favorite_origins_in(&db, &directory).unwrap();
    let third = active_favorite_origins_in(&db, &directory).unwrap();
    assert_eq!(first.len(), 3);
    assert_eq!(first, second);
    assert_eq!(second, third);
    assert_eq!(row_count(&db), 3);
    for (index, (origin, copy)) in pairs.iter().enumerate() {
        assert_eq!(sha256_file(origin).unwrap(), origin_hashes[index]);
        assert_eq!(sha256_file(copy).unwrap(), copy_hashes[index]);
    }
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn rename_to_other_canonical_name_keeps_activity() {
    let root = sandbox();
    let db = memory_db();
    add_photos(&root, &db, 2);
    let favorites = root.join(LOCAL_FAVORITES);
    let new_path = rename_child_folder(
        &root.display().to_string(),
        &favorites.display().to_string(),
        LOCAL_FAVORITES_ALT,
    )
    .unwrap();
    database::relocate_folder_path(&db, &favorites.display().to_string(), &new_path, LOCAL_FAVORITES_ALT)
        .unwrap();
    let renamed = PathBuf::from(&new_path);
    assert!(is_favorites_folder_name(LOCAL_FAVORITES_ALT));
    assert!(is_active_favorites_folder(&renamed));
    assert_eq!(read_role_marker(&renamed), Some(ServiceRole::Favorites));
    assert_eq!(
        active_favorite_origins_in(&db, &root.display().to_string())
            .unwrap()
            .len(),
        2
    );
    let listed = list_directory(&root).unwrap();
    let folder = listed
        .folders
        .iter()
        .find(|item| item.name == LOCAL_FAVORITES_ALT)
        .unwrap();
    assert_eq!(folder.service_role.as_deref(), Some("favorites"));
    let _ = fs::remove_dir_all(&root);
}
