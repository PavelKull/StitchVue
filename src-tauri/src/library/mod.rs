mod display_rotation;

use rusqlite::{params, Connection};

use crate::scanner::FolderShortcut;

pub use display_rotation::{DisplayRotation, list_for_paths as list_display_rotations, rotate_clockwise};

pub fn remember(conn: &Connection, path: &str, name: &str) -> Result<(), String> {
    let opened_at = now();
    conn.execute(
        "INSERT INTO recent_folders (path, name, opened_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(path) DO UPDATE SET name = excluded.name, opened_at = excluded.opened_at",
        params![path, name, opened_at],
    )
    .map_err(|err| format!("remember {path}: {err}"))?;
    conn.execute(
        "DELETE FROM recent_folders WHERE path NOT IN (
            SELECT path FROM recent_folders ORDER BY opened_at DESC LIMIT 8
         )",
        [],
    )
    .map_err(|err| format!("trim recent folders: {err}"))?;
    Ok(())
}

pub fn toggle_favorite(conn: &Connection, path: &str, name: &str) -> Result<bool, String> {
    let exists: bool = conn
        .query_row(
            "SELECT 1 FROM favorite_folders WHERE path = ?1",
            [path],
            |_| Ok(true),
        )
        .unwrap_or(false);
    if exists {
        conn.execute("DELETE FROM favorite_folders WHERE path = ?1", [path])
            .map_err(|err| format!("remove favorite {path}: {err}"))?;
        Ok(false)
    } else {
        conn.execute(
            "INSERT INTO favorite_folders (path, name, added_at) VALUES (?1, ?2, ?3)",
            params![path, name, now()],
        )
        .map_err(|err| format!("add favorite {path}: {err}"))?;
        Ok(true)
    }
}

pub fn recent(conn: &Connection) -> Result<Vec<FolderShortcut>, String> {
    rows(
        conn,
        "SELECT name, path FROM recent_folders ORDER BY opened_at DESC",
    )
}

pub fn favorites(conn: &Connection) -> Result<Vec<FolderShortcut>, String> {
    rows(
        conn,
        "SELECT name, path FROM favorite_folders ORDER BY name COLLATE NOCASE",
    )
}

fn rows(conn: &Connection, sql: &str) -> Result<Vec<FolderShortcut>, String> {
    let mut statement = conn.prepare(sql).map_err(|err| format!("folders: {err}"))?;
    let mut folders = statement
        .query_map([], |row| {
            Ok(FolderShortcut {
                name: row.get(0)?,
                path: row.get(1)?,
                kind: crate::scanner::FolderKind::Folder,
                media: None,
                service_role: None,
                place_code: None,
                drive_letter: None,
                drive_kind: None,
            })
        })
        .map_err(|err| format!("folders: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("folders: {err}"))?;
    for folder in &mut folders {
        folder.service_role = crate::file_ops::read_service_role(std::path::Path::new(&folder.path))
            .map(|role| role.as_str().to_string());
    }
    Ok(folders)
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|time| time.as_secs() as i64)
        .unwrap_or(0)
}
