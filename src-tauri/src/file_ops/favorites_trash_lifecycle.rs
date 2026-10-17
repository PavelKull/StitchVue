use std::fs;

use std::path::{Path, PathBuf};

use std::sync::{Mutex, atomic::Ordering};



use rusqlite::Connection;



use super::{write_service_role, ServiceRole, LOCAL_FAVORITES, LOCAL_TRASH};

use crate::database;

use crate::file_ops::favorites::{

    preview_remove_favorite_copy, remove_favorite_copy_distributed,

};



fn db() -> Connection {

    let conn = Connection::open_in_memory().unwrap();

    database::migrate(&conn).unwrap();

    conn

}



fn sandbox() -> PathBuf {

    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    let root = std::env::temp_dir().join(format!(

        "stitchvue-fav-trash-{}-{}",

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



fn record_link(

    conn: &Connection,

    origin: &Path,

    copy: &Path,

) -> Result<(), String> {

    let origin_meta = fs::metadata(origin).map_err(|err| err.to_string())?;

    let copy_meta = fs::metadata(copy).map_err(|err| err.to_string())?;

    let hash = crate::file_ops::sha256_file(origin)?;

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

}



fn move_origin_to_trash(

    conn: &Connection,

    origin: &Path,

    trash_dir: &Path,

) -> PathBuf {

    let trash_file = trash_dir.join(origin.file_name().unwrap());

    let size = fs::metadata(&trash_file)

        .ok()

        .map(|meta| meta.len())

        .unwrap_or_else(|| fs::metadata(origin).map(|meta| meta.len()).unwrap_or(0));

    fs::rename(origin, &trash_file).unwrap();

    database::record_trash(

        conn,

        trash_file.to_str().unwrap(),

        origin.to_str().unwrap(),

        size,

    )

    .unwrap();

    trash_file

}



fn trash_fixture(conn: &Connection) -> (PathBuf, PathBuf, PathBuf, PathBuf) {

    let root = sandbox();

    let favorites = root.join(LOCAL_FAVORITES);

    let trash = root.join(LOCAL_TRASH);

    fs::create_dir(&favorites).unwrap();

    fs::create_dir(&trash).unwrap();

    write_service_role(&favorites, ServiceRole::Favorites).unwrap();

    write_service_role(&trash, ServiceRole::Trash).unwrap();

    let origin = root.join("photo.jpg");

    let copy = favorites.join("photo.jpg");

    fs::write(&origin, b"bytes").unwrap();

    fs::write(&copy, b"bytes").unwrap();

    record_link(conn, &origin, &copy).unwrap();

    let trash_file = move_origin_to_trash(conn, &origin, &trash);

    (root, origin, copy, trash_file)

}



#[test]

fn t4_unfavorite_with_origin_in_trash_needs_trash_dialog() {

    let conn = db();

    let (root, _origin, copy, _trash_file) = trash_fixture(&conn);

    let preview = preview_remove_favorite_copy(&conn, copy.to_str().unwrap()).unwrap();

    assert_eq!(preview.status, "needs_confirm");

    assert_eq!(preview.confirm_kind.as_deref(), Some("origin_in_local_trash"));

    assert!(preview.trash_path.is_some());

    let _ = fs::remove_dir_all(&root);

}



#[test]

fn t5_recycle_copy_leaves_origin_in_trash() {

    let conn = Mutex::new(db());

    let (root, origin, copy, trash_file) = trash_fixture(&conn.lock().unwrap());

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

    assert!(!origin.is_file());

    assert!(

        database::favorite_snapshot_for_copy(&conn.lock().unwrap(), copy.to_str().unwrap())

            .unwrap()

            .is_none()

    );

    let _ = fs::remove_dir_all(&root);

}



#[test]

fn t6_restore_origin_keeps_favorite_copy() {

    let conn = Mutex::new(db());

    let (root, origin, copy, _trash_file) = trash_fixture(&conn.lock().unwrap());

    let result = remove_favorite_copy_distributed(

        &conn,

        copy.to_str().unwrap(),

        true,

        Some("restore_origin"),

    )

    .unwrap();

    assert_eq!(result.status, "restored_origin");

    assert!(origin.is_file());

    assert!(copy.is_file());

    assert!(

        database::favorite_snapshot_for_copy(&conn.lock().unwrap(), copy.to_str().unwrap())

            .unwrap()

            .is_some()

    );

    let _ = fs::remove_dir_all(&root);

}


