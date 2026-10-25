use rusqlite::{Connection, OptionalExtension};
use std::collections::HashMap;
use std::path::PathBuf;

/// Same place as Tauri's `$LOCALDATA` (the asset scope in `tauri.conf.json`).
pub fn app_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join("Library").join("Application Support"));
    #[cfg(target_os = "linux")]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
        });
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    base.unwrap_or_else(std::env::temp_dir).join("StitchVue")
}

pub fn open() -> Result<Connection, String> {
    let dir = app_dir();
    std::fs::create_dir_all(dir.join("cache").join("thumbnails"))
        .map_err(|err| format!("create_dir {}: {err}", dir.display()))?;
    let db_path = dir.join("stitchvue.db");
    let conn =
        Connection::open(&db_path).map_err(|err| format!("open {}: {err}", db_path.display()))?;
    migrate(&conn).map_err(|err| format!("migrate {}: {err}", db_path.display()))?;
    Ok(conn)
}

pub fn migrate(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE IF NOT EXISTS image_meta (
            source_path TEXT NOT NULL,
            source_size INTEGER NOT NULL,
            source_modified_at INTEGER NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            orientation INTEGER NOT NULL,
            PRIMARY KEY (source_path, source_size, source_modified_at)
        );
        CREATE TABLE IF NOT EXISTS thumbnail_cache (
            id INTEGER PRIMARY KEY,
            source_path TEXT NOT NULL,
            source_size INTEGER NOT NULL,
            source_modified_at INTEGER NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            orientation INTEGER NOT NULL,
            tier INTEGER NOT NULL,
            thumbnail_path TEXT NOT NULL,
            thumbnail_size INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            last_accessed_at INTEGER NOT NULL,
            UNIQUE (source_path, source_size, source_modified_at, tier)
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS recent_folders (
            path TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            opened_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS favorite_folders (
            path TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            added_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS decode_fail (
            source_path TEXT NOT NULL,
            source_size INTEGER NOT NULL,
            source_modified_at INTEGER NOT NULL,
            decoder TEXT NOT NULL,
            kind TEXT NOT NULL,
            message TEXT NOT NULL,
            PRIMARY KEY (source_path, source_size, source_modified_at)
        );
        CREATE TABLE IF NOT EXISTS favorite_copies (
            origin_path TEXT NOT NULL,
            origin_size INTEGER NOT NULL,
            origin_modified_at INTEGER NOT NULL,
            copy_path TEXT NOT NULL,
            PRIMARY KEY (origin_path, origin_size, origin_modified_at)
        );
        CREATE TABLE IF NOT EXISTS trash_entries (
            trash_path TEXT PRIMARY KEY,
            origin_path TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS favorite_undo (
            id TEXT PRIMARY KEY,
            copy_path TEXT NOT NULL,
            origin_path TEXT NOT NULL,
            origin_size INTEGER NOT NULL,
            origin_modified_at INTEGER NOT NULL,
            held_path TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS image_display_rotation (
            source_path TEXT NOT NULL,
            source_size INTEGER NOT NULL,
            source_modified_at INTEGER NOT NULL,
            quarters INTEGER NOT NULL,
            PRIMARY KEY (source_path, source_size, source_modified_at)
        );
        CREATE TABLE IF NOT EXISTS file_op_log (
            id TEXT PRIMARY KEY,
            op_type TEXT NOT NULL,
            source_path TEXT NOT NULL,
            destination_path TEXT,
            origin_path TEXT,
            source_name TEXT,
            source_size INTEGER,
            source_modified_at INTEGER,
            status TEXT NOT NULL,
            error_code TEXT,
            error_message TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        ",
    )
    .map_err(|err| err.to_string())?;
    ensure_column(conn, "trash_entries", "source_size", "INTEGER")?;
    ensure_column(conn, "favorite_copies", "copy_size", "INTEGER")?;
    ensure_column(conn, "favorite_copies", "copy_modified_at", "INTEGER")?;
    ensure_column(conn, "favorite_copies", "content_sha256", "TEXT")?;
    ensure_column(conn, "favorite_copies", "record_version", "INTEGER")?;
    ensure_column(conn, "favorite_copies", "origin_key", "TEXT")?;
    ensure_column(conn, "favorite_copies", "copy_key", "TEXT")?;
    backfill_favorite_path_keys(conn)?;
    Ok(())
}

fn ensure_column(conn: &Connection, table: &str, column: &str, decl: &str) -> Result<(), String> {
    let mut statement = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|err| err.to_string())?;
    let names = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    if names.iter().any(|name| name == column) {
        return Ok(());
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"),
        [],
    )
    .map_err(|err| format!("add {table}.{column}: {err}"))?;
    Ok(())
}

pub fn setting(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .optional()
    .map_err(|err| format!("read setting {key}: {err}"))
}

pub const FAVORITE_RECORD_VERSION: i64 = 2;

pub fn record_favorite_copy(
    conn: &Connection,
    origin_path: &str,
    origin_size: u64,
    origin_modified_at: i64,
    copy_path: &str,
    copy_size: u64,
    copy_modified_at: i64,
    content_sha256: Option<&str>,
) -> Result<(), String> {
    let origin_stored = normalize_stored_path(origin_path);
    let copy_stored = normalize_stored_path(copy_path);
    let origin_key = path_key(&origin_stored);
    let copy_key = path_key(&copy_stored);
    // Drop older links for the same physical copy or origin key so one file has one row.
    conn.execute(
        "DELETE FROM favorite_copies WHERE copy_key = ?1 OR origin_key = ?2",
        (&copy_key, &origin_key),
    )
    .map_err(|err| format!("clear favorite duplicates: {err}"))?;
    conn.execute(
        "INSERT INTO favorite_copies (
            origin_path, origin_size, origin_modified_at, copy_path,
            copy_size, copy_modified_at, content_sha256, record_version, origin_key, copy_key
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(origin_path, origin_size, origin_modified_at)
         DO UPDATE SET
            copy_path = excluded.copy_path,
            copy_size = excluded.copy_size,
            copy_modified_at = excluded.copy_modified_at,
            content_sha256 = excluded.content_sha256,
            record_version = excluded.record_version,
            origin_key = excluded.origin_key,
            copy_key = excluded.copy_key",
        (
            origin_stored,
            origin_size as i64,
            origin_modified_at,
            copy_stored,
            copy_size as i64,
            copy_modified_at,
            content_sha256,
            FAVORITE_RECORD_VERSION,
            origin_key,
            copy_key,
        ),
    )
    .map_err(|err| format!("record favorite: {err}"))?;
    Ok(())
}

pub fn record_trash(
    conn: &Connection,
    trash_path: &str,
    origin_path: &str,
    source_size: u64,
) -> Result<(), String> {
    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO trash_entries (trash_path, origin_path, created_at, source_size) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(trash_path) DO UPDATE SET origin_path = excluded.origin_path, created_at = excluded.created_at, source_size = excluded.source_size",
        (trash_path, origin_path, created_at, source_size as i64),
    )
    .map_err(|err| format!("record trash: {err}"))?;
    Ok(())
}
#[derive(Debug, Clone)]

pub struct TrashRow {
    pub trash_path: String,
    pub origin_path: String,
    pub source_size: Option<u64>,
}

pub fn trash_rows(conn: &Connection) -> Result<Vec<TrashRow>, String> {
    let mut statement = conn
        .prepare("SELECT trash_path, origin_path, source_size FROM trash_entries")
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| {
            let size: Option<i64> = row.get(2)?;
            Ok(TrashRow {
                trash_path: row.get(0)?,
                origin_path: row.get(1)?,
                source_size: size.and_then(|value| u64::try_from(value).ok()),
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

pub fn update_trash_path(conn: &Connection, from_path: &str, to_path: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE trash_entries SET trash_path = ?1 WHERE trash_path = ?2",
        (to_path, from_path),
    )
    .map_err(|err| format!("update trash path: {err}"))?;
    Ok(())
}
#[derive(Debug, Clone)]

pub struct FavoriteSnapshot {
    pub origin_path: String,
    pub origin_size: u64,
    pub origin_modified_at: i64,
    pub copy_path: String,
    pub copy_size: Option<u64>,
    pub copy_modified_at: Option<i64>,
    pub content_sha256: Option<String>,
    pub record_version: i64,
}

fn snapshot_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<FavoriteSnapshot> {
    let copy_size: Option<i64> = row.get(4)?;
    let version: Option<i64> = row.get(7)?;
    Ok(FavoriteSnapshot {
        origin_path: row.get(0)?,
        origin_size: u64::try_from(row.get::<_, i64>(1)?).unwrap_or(0),
        origin_modified_at: row.get(2)?,
        copy_path: row.get(3)?,
        copy_size: copy_size.and_then(|value| u64::try_from(value).ok()),
        copy_modified_at: row.get(5)?,
        content_sha256: row.get(6)?,
        record_version: version.unwrap_or(1),
    })
}
const SNAPSHOT_SELECT: &str = "SELECT origin_path, origin_size, origin_modified_at, copy_path,
    copy_size, copy_modified_at, content_sha256, record_version
    FROM favorite_copies";

pub(crate) fn load_all_favorite_snapshots(
    conn: &Connection,
) -> Result<Vec<FavoriteSnapshot>, String> {
    let mut statement = conn
        .prepare(SNAPSHOT_SELECT)
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], snapshot_row)
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

/// Rows whose origin or copy path lies under `directory_prefix` (same rules as scoped reconcile).
pub(crate) fn load_favorite_snapshots_in_directory_scope(
    conn: &Connection,
    directory_prefix: &str,
) -> Result<Vec<FavoriteSnapshot>, String> {
    let prefix = path_key(directory_prefix);
    let like_pattern = format!("{}\\%", prefix);
    let sql = format!(
        "{SNAPSHOT_SELECT} WHERE origin_key = ?1 OR origin_key LIKE ?2
         OR copy_key = ?1 OR copy_key LIKE ?2"
    );
    let mut statement = conn.prepare(&sql).map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([&prefix, &like_pattern], snapshot_row)
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

fn favorite_stored_path_candidates(requested: &str) -> Vec<String> {
    let normalized = normalize_stored_path(requested);
    let mut out = Vec::new();
    let mut push = |value: String| {
        if !out.iter().any(|existing| existing == &value) {
            out.push(value);
        }
    };
    push(normalized.clone());
    if normalized != requested {
        push(requested.to_string());
    }
    if normalized.len() >= 3 && normalized.as_bytes().get(1) == Some(&b':') {
        push(format!(r"\\?\{}", normalized));
    }
    out
}

fn favorite_snapshot_for_column(
    conn: &Connection,
    column: &str,
    path: &str,
) -> Result<Option<FavoriteSnapshot>, String> {
    let key = path_key(path);
    let key_column = if column == "origin_path" {
        "origin_key"
    } else {
        "copy_key"
    };
    let by_key = conn
        .query_row(
            &format!("{SNAPSHOT_SELECT} WHERE {key_column} = ?1"),
            [&key],
            snapshot_row,
        )
        .optional()
        .map_err(|err| err.to_string())?;
    if by_key.is_some() {
        return Ok(by_key);
    }
    let mut matches = Vec::new();
    for candidate in favorite_stored_path_candidates(path) {
        let row = conn
            .query_row(
                &format!("{SNAPSHOT_SELECT} WHERE {column} = ?1"),
                [&candidate],
                snapshot_row,
            )
            .optional()
            .map_err(|err| err.to_string())?;
        if let Some(row) = row {
            matches.push(row);
        }
    }
    if matches.len() > 1 {
        let message = if column == "origin_path" {
            "Несколько связей избранного указывают на один оригинал."
        } else {
            "Несколько связей избранного указывают на один путь копии."
        };
        return Err(message.to_string());
    }
    Ok(matches.pop())
}

/// Batch lookup by `origin_key` (one round-trip for P2 chunk / P3 hint load).
pub(crate) fn favorite_snapshots_for_origin_paths(
    conn: &Connection,
    paths: &[String],
) -> Result<HashMap<String, FavoriteSnapshot>, String> {
    let mut keys: Vec<String> = Vec::new();
    for path in paths {
        let key = path_key(path);
        if !keys.iter().any(|existing| existing == &key) {
            keys.push(key);
        }
    }
    if keys.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders = keys.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!("{SNAPSHOT_SELECT} WHERE origin_key IN ({placeholders})");
    let mut statement = conn.prepare(&sql).map_err(|err| err.to_string())?;
    let params: Vec<&str> = keys.iter().map(String::as_str).collect();
    let rows = statement
        .query_map(rusqlite::params_from_iter(params.iter()), snapshot_row)
        .map_err(|err| err.to_string())?;
    let mut out = HashMap::new();
    for row in rows {
        let snap = row.map_err(|err| err.to_string())?;
        out.insert(path_key(&snap.origin_path), snap);
    }
    Ok(out)
}

pub fn favorite_snapshot_for_copy(
    conn: &Connection,
    copy_path: &str,
) -> Result<Option<FavoriteSnapshot>, String> {
    favorite_snapshot_for_column(conn, "copy_path", copy_path)
}

pub fn favorite_snapshot_for_origin(
    conn: &Connection,
    origin_path: &str,
) -> Result<Option<FavoriteSnapshot>, String> {
    favorite_snapshot_for_column(conn, "origin_path", origin_path)
}

fn backfill_favorite_path_keys(conn: &Connection) -> Result<(), String> {
    let mut statement = conn
        .prepare("SELECT origin_path, copy_path FROM favorite_copies WHERE origin_key IS NULL OR copy_key IS NULL OR origin_key = '' OR copy_key = ''")
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    drop(statement);
    for (origin_path, copy_path) in rows {
        let origin_stored = normalize_stored_path(&origin_path);
        let copy_stored = normalize_stored_path(&copy_path);
        conn.execute(
            "UPDATE favorite_copies
             SET origin_path = ?1, copy_path = ?2, origin_key = ?3, copy_key = ?4,
                 record_version = COALESCE(record_version, 1)
             WHERE origin_path = ?5 AND copy_path = ?6",
            (
                &origin_stored,
                &copy_stored,
                path_key(&origin_stored),
                path_key(&copy_stored),
                &origin_path,
                &copy_path,
            ),
        )
        .map_err(|err| format!("backfill favorite keys: {err}"))?;
    }
    Ok(())
}

fn normalize_stored_path(value: &str) -> String {
    if !cfg!(windows) {
        return value.to_string();
    }
    let text = value.replace('/', "\\");
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        text
    }
}
#[allow(dead_code)]

pub struct FavoriteUndo {
    pub id: String,
    pub copy_path: String,
    pub origin_path: String,
    pub origin_size: u64,
    pub origin_modified_at: i64,
    pub held_path: String,
}
#[allow(dead_code)]

pub fn insert_favorite_undo(conn: &Connection, undo: &FavoriteUndo) -> Result<(), String> {
    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO favorite_undo (id, copy_path, origin_path, origin_size, origin_modified_at, held_path, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        (
            &undo.id,
            &undo.copy_path,
            &undo.origin_path,
            undo.origin_size as i64,
            undo.origin_modified_at,
            &undo.held_path,
            created_at,
        ),
    )
    .map_err(|err| format!("record undo: {err}"))?;
    Ok(())
}
#[allow(dead_code)]

pub fn take_favorite_undo(conn: &Connection, id: &str) -> Result<Option<FavoriteUndo>, String> {
    let row = conn
        .query_row(
            "SELECT id, copy_path, origin_path, origin_size, origin_modified_at, held_path FROM favorite_undo WHERE id = ?1",
            [id],
            |row| {
                Ok(FavoriteUndo {
                    id: row.get(0)?,
                    copy_path: row.get(1)?,
                    origin_path: row.get(2)?,
                    origin_size: u64::try_from(row.get::<_, i64>(3)?).unwrap_or(0),
                    origin_modified_at: row.get(4)?,
                    held_path: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(|err| err.to_string())?;
    if row.is_some() {
        conn.execute("DELETE FROM favorite_undo WHERE id = ?1", [id])
            .map_err(|err| err.to_string())?;
    }
    Ok(row)
}

pub fn favorite_origin_paths(conn: &Connection) -> Result<Vec<(String, String)>, String> {
    let mut statement = conn
        .prepare("SELECT origin_path, copy_path FROM favorite_copies")
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

pub fn delete_favorite_copy_path(conn: &Connection, copy_path: &str) -> Result<(), String> {
    let key = path_key(copy_path);
    let changed = conn
        .execute("DELETE FROM favorite_copies WHERE copy_key = ?1", [&key])
        .map_err(|err| err.to_string())?;
    if changed > 0 {
        return Ok(());
    }
    if let Some(row) = favorite_snapshot_for_copy(conn, copy_path)? {
        conn.execute(
            "DELETE FROM favorite_copies WHERE origin_path = ?1 AND origin_size = ?2 AND origin_modified_at = ?3",
            (
                &row.origin_path,
                row.origin_size as i64,
                row.origin_modified_at,
            ),
        )
        .map_err(|err| err.to_string())?;
    }
    Ok(())
}
#[allow(dead_code)]

pub fn trash_paths(conn: &Connection) -> Result<Vec<String>, String> {
    let mut statement = conn
        .prepare("SELECT trash_path FROM trash_entries")
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| row.get(0))
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

pub fn trash_origin(conn: &Connection, trash_path: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT origin_path FROM trash_entries WHERE trash_path = ?1",
        [trash_path],
        |row| row.get(0),
    )
    .optional()
    .map_err(|err| err.to_string())
}

/// First trash entry whose `origin_path` matches and trash file still exists.
pub fn trash_path_for_origin(conn: &Connection, origin_path: &str) -> Result<Option<String>, String> {
    let stored = normalize_stored_path(origin_path);
    let mut statement = conn
        .prepare("SELECT trash_path FROM trash_entries WHERE origin_path = ?1")
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([&stored], |row| row.get::<_, String>(0))
        .map_err(|err| err.to_string())?;
    for row in rows {
        let trash_path = row.map_err(|err| err.to_string())?;
        if std::path::Path::new(&trash_path).is_file() {
            return Ok(Some(trash_path));
        }
    }
    Ok(None)
}

pub fn delete_trash(conn: &Connection, trash_path: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM trash_entries WHERE trash_path = ?1",
        [trash_path],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn path_key(value: &str) -> String {
    normalize_stored_path(value)
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

pub(crate) fn favorite_origin_lookup_key(value: &str) -> String {
    path_key(value)
}

pub fn relocate_folder_path(
    conn: &Connection,
    old_path: &str,
    new_path: &str,
    new_name: &str,
) -> Result<(), String> {
    let old_key = path_key(old_path);
    conn.execute(
        "UPDATE recent_folders SET path = ?1, name = ?2
         WHERE lower(replace(path, '/', '\\')) = lower(replace(?3, '/', '\\'))",
        (new_path, new_name, old_path),
    )
    .map_err(|err| format!("update recent folder: {err}"))?;
    conn.execute(
        "UPDATE favorite_folders SET path = ?1, name = ?2
         WHERE lower(replace(path, '/', '\\')) = lower(replace(?3, '/', '\\'))",
        (new_path, new_name, old_path),
    )
    .map_err(|err| format!("update favorite folder: {err}"))?;
    rewrite_path_prefix(conn, "favorite_copies", "origin_path", &old_key, new_path)?;
    rewrite_path_prefix(conn, "favorite_copies", "copy_path", &old_key, new_path)?;
    sync_favorite_copy_keys(conn)?;
    rewrite_path_prefix(conn, "trash_entries", "trash_path", &old_key, new_path)?;
    rewrite_path_prefix(
        conn,
        "image_display_rotation",
        "source_path",
        &old_key,
        new_path,
    )?;
    Ok(())
}

/// Recompute `origin_key` / `copy_key` from stored paths after prefix rewrites.
pub fn sync_favorite_copy_keys(conn: &Connection) -> Result<(), String> {
    let mut statement = conn
        .prepare(
            "SELECT origin_path, origin_size, origin_modified_at, copy_path
             FROM favorite_copies",
        )
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|err| err.to_string())?;
    for row in rows {
        let (origin_path, origin_size, origin_modified_at, copy_path) =
            row.map_err(|err| err.to_string())?;
        let origin_key = path_key(&origin_path);
        let copy_key = path_key(&copy_path);
        conn.execute(
            "UPDATE favorite_copies SET origin_key = ?1, copy_key = ?2
             WHERE origin_path = ?3 AND origin_size = ?4 AND origin_modified_at = ?5",
            (
                origin_key,
                copy_key,
                normalize_stored_path(&origin_path),
                origin_size,
                origin_modified_at,
            ),
        )
        .map_err(|err| format!("sync favorite keys: {err}"))?;
    }
    Ok(())
}

pub fn purge_paths_under(conn: &Connection, folder_path: &str) -> Result<(), String> {
    let prefix = path_key(folder_path);
    let nested_prefix = format!("{}\\", prefix.trim_end_matches('\\'));
    for (table, column) in [
        ("favorite_copies", "copy_path"),
        ("trash_entries", "trash_path"),
        ("image_display_rotation", "source_path"),
    ] {
        purge_rows_with_prefix(conn, table, column, &prefix, &nested_prefix)?;
    }
    purge_rows_with_prefix(conn, "recent_folders", "path", &prefix, &nested_prefix)?;
    purge_rows_with_prefix(conn, "favorite_folders", "path", &prefix, &nested_prefix)?;
    Ok(())
}

fn purge_rows_with_prefix(
    conn: &Connection,
    table: &str,
    column: &str,
    prefix: &str,
    nested_prefix: &str,
) -> Result<(), String> {
    let mut statement = conn
        .prepare(&format!("SELECT {column} FROM {table}"))
        .map_err(|err| format!("read {table}: {err}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|err| format!("read {table}: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("read {table}: {err}"))?;
    for path in rows {
        let key = path_key(&path);
        if key != prefix && !key.starts_with(nested_prefix) {
            continue;
        }
        conn.execute(&format!("DELETE FROM {table} WHERE {column} = ?1"), [&path])
            .map_err(|err| format!("purge {table}: {err}"))?;
    }
    Ok(())
}

fn rewrite_path_prefix(
    conn: &Connection,
    table: &str,
    column: &str,
    old_prefix: &str,
    new_path: &str,
) -> Result<(), String> {
    let mut statement = conn
        .prepare(&format!("SELECT {column} FROM {table}"))
        .map_err(|err| format!("read {table}: {err}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|err| format!("read {table}: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("read {table}: {err}"))?;
    let new_base = normalize_stored_path(new_path);
    let new_base = new_base.trim_end_matches(['\\', '/']);
    let nested = format!("{old_prefix}\\");
    for path in rows {
        let key = path_key(&path);
        if key != old_prefix && !key.starts_with(&nested) {
            continue;
        }
        // Keys only lowercase ASCII and fold separators, so byte offsets match the
        // stored path: keep its real suffix (case matters on Linux file systems).
        let stored = normalize_stored_path(&path);
        let rebuilt = format!("{new_base}{}", &stored[old_prefix.len()..]);
        conn.execute(
            &format!("UPDATE {table} SET {column} = ?1 WHERE {column} = ?2"),
            (rebuilt, path),
        )
        .map_err(|err| format!("update {table}: {err}"))?;
    }
    Ok(())
}

pub const OP_MOVE_TO_LOCAL_TRASH: &str = "move_to_local_trash";

pub const OP_RESTORE_FROM_LOCAL_TRASH: &str = "restore_from_local_trash";

pub const OP_MOVE_TO_WINDOWS_RECYCLE: &str = "move_to_windows_recycle_bin";

pub const OP_ADD_TO_FAVORITES: &str = "add_to_favorites";

pub const OP_REMOVE_FROM_FAVORITES: &str = "remove_from_favorites";

pub const ST_PENDING: &str = "pending";

pub const ST_COMPLETED: &str = "completed";

pub const ST_FAILED: &str = "failed";

pub const ST_NEEDS_RECONCILIATION: &str = "needs_reconciliation";
#[derive(Debug, Clone)]

pub struct FileOpLog {
    pub id: String,
    pub op_type: String,
    pub source_path: String,
    pub destination_path: Option<String>,
    pub origin_path: Option<String>,
    pub source_name: Option<String>,
    pub source_size: Option<u64>,
    pub source_modified_at: Option<i64>,
    #[allow(dead_code)]
    pub status: String,
    #[allow(dead_code)]
    pub error_code: Option<String>,
    #[allow(dead_code)]
    pub error_message: Option<String>,
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn durable(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("PRAGMA synchronous = FULL")
        .map_err(|err| format!("durable journal: {err}"))?;
    Ok(())
}

fn restore_pragma(conn: &Connection) {
    let _ = conn.execute_batch("PRAGMA wal_checkpoint(PASSIVE); PRAGMA synchronous = NORMAL");
}

pub fn insert_pending_op(conn: &Connection, row: &FileOpLog) -> Result<(), String> {
    durable(conn)?;
    let created = now_ms();
    let result = conn.execute(
        "INSERT INTO file_op_log (
            id, op_type, source_path, destination_path, origin_path, source_name,
            source_size, source_modified_at, status, error_code, error_message, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, NULL, ?10, ?10)",
        (
            &row.id,
            &row.op_type,
            &row.source_path,
            &row.destination_path,
            &row.origin_path,
            &row.source_name,
            row.source_size.map(|value| value as i64),
            row.source_modified_at,
            ST_PENDING,
            created,
        ),
    );
    restore_pragma(conn);
    result.map_err(|err| format!("record pending: {err}"))?;
    Ok(())
}

pub fn update_pending_destination(
    conn: &Connection,
    id: &str,
    destination_path: &str,
) -> Result<(), String> {
    durable(conn)?;
    let result = conn.execute(
        "UPDATE file_op_log
         SET destination_path = ?1, updated_at = ?2
         WHERE id = ?3 AND status = ?4",
        (destination_path, now_ms(), id, ST_PENDING),
    );
    restore_pragma(conn);
    result.map_err(|err| format!("update pending destination: {err}"))?;
    Ok(())
}

pub fn finish_op(
    conn: &Connection,
    id: &str,
    status: &str,
    destination_path: Option<&str>,
    error_code: Option<&str>,
    error_message: Option<&str>,
) -> Result<(), String> {
    durable(conn)?;
    let result = conn.execute(
        "UPDATE file_op_log
         SET status = ?1, destination_path = COALESCE(?2, destination_path),
             error_code = ?3, error_message = ?4, updated_at = ?5
         WHERE id = ?6",
        (
            status,
            destination_path,
            error_code,
            error_message,
            now_ms(),
            id,
        ),
    );
    restore_pragma(conn);
    result.map_err(|err| format!("update op log: {err}"))?;
    Ok(())
}

pub fn unfinished_ops(conn: &Connection) -> Result<Vec<FileOpLog>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, op_type, source_path, destination_path, origin_path, source_name,
                    source_size, source_modified_at, status, error_code, error_message
             FROM file_op_log
             WHERE status IN ('pending', 'needs_reconciliation')",
        )
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| {
            let size: Option<i64> = row.get(6)?;
            Ok(FileOpLog {
                id: row.get(0)?,
                op_type: row.get(1)?,
                source_path: row.get(2)?,
                destination_path: row.get(3)?,
                origin_path: row.get(4)?,
                source_name: row.get(5)?,
                source_size: size.and_then(|value| u64::try_from(value).ok()),
                source_modified_at: row.get(7)?,
                status: row.get(8)?,
                error_code: row.get(9)?,
                error_message: row.get(10)?,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

pub fn origin_from_log(conn: &Connection, trash_path: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT source_path FROM file_op_log
         WHERE op_type = ?1 AND destination_path = ?2
         ORDER BY created_at DESC LIMIT 1",
        (OP_MOVE_TO_LOCAL_TRASH, trash_path),
        |row| row.get(0),
    )
    .optional()
    .map_err(|err| err.to_string())
}

pub fn list_favorite_undo(conn: &Connection) -> Result<Vec<FavoriteUndo>, String> {
    let mut statement = conn
        .prepare("SELECT id, copy_path, origin_path, origin_size, origin_modified_at, held_path FROM favorite_undo")
        .map_err(|err| err.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(FavoriteUndo {
                id: row.get(0)?,
                copy_path: row.get(1)?,
                origin_path: row.get(2)?,
                origin_size: u64::try_from(row.get::<_, i64>(3)?).unwrap_or(0),
                origin_modified_at: row.get(4)?,
                held_path: row.get(5)?,
            })
        })
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

pub fn delete_favorite_undo_row(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM favorite_undo WHERE id = ?1", [id])
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
    .map_err(|err| format!("write setting {key}: {err}"))?;
    Ok(())
}

#[cfg(test)]

mod tests {
    use super::*;

    #[test]
    fn folder_rename_keeps_file_name_case_and_skips_sibling_prefix() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        let root = std::path::PathBuf::from(if cfg!(windows) { r"C:\Photos" } else { "/home/me/Photos" });
        let at = |parts: &[&str]| {
            parts.iter().fold(root.clone(), |path, part| path.join(part)).display().to_string()
        };
        for folder in ["Trip", "Trip 2024"] {
            record_favorite_copy(
                &conn,
                &at(&[folder, "IMG_0001.JPG"]),
                10,
                100,
                &at(&[folder, "Favorites", "IMG_0001.JPG"]),
                10,
                100,
                Some("abc"),
            )
            .unwrap();
        }
        relocate_folder_path(&conn, &at(&["Trip"]), &at(&["Trip Renamed"]), "Trip Renamed").unwrap();
        let mut rows = favorite_origin_paths(&conn).unwrap();
        rows.sort();
        assert_eq!(
            rows,
            vec![
                (at(&["Trip 2024", "IMG_0001.JPG"]), at(&["Trip 2024", "Favorites", "IMG_0001.JPG"])),
                (
                    at(&["Trip Renamed", "IMG_0001.JPG"]),
                    at(&["Trip Renamed", "Favorites", "IMG_0001.JPG"])
                ),
            ]
        );
    }

    // Windows path fixtures (drive letters, `\\?\`, UNC).
    #[cfg(windows)]
    #[test]
    fn favorite_copy_lookup_ignores_extended_prefix() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        record_favorite_copy(
            &conn,
            r"C:\Photos\a.jpg",
            10,
            100,
            r"\\?\C:\Photos\Favorites\a.jpg",
            10,
            100,
            Some("abc"),
        )
        .unwrap();
        let found = favorite_snapshot_for_copy(&conn, r"C:\Photos\Favorites\a.jpg")
            .unwrap()
            .expect("link");
        assert_eq!(found.origin_path, r"C:\Photos\a.jpg");
        assert_eq!(found.copy_path, r"C:\Photos\Favorites\a.jpg");
        assert!(!found.copy_path.contains(r"\\?\"));
    }

    #[test]
    fn favorite_snapshots_for_origin_paths_batch_load() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        record_favorite_copy(
            &conn,
            r"C:\Photos\a.jpg",
            1,
            1,
            r"C:\Photos\Fav\a.jpg",
            1,
            1,
            Some("h1"),
        )
        .unwrap();
        record_favorite_copy(
            &conn,
            r"C:\Photos\b.jpg",
            2,
            2,
            r"C:\Photos\Fav\b.jpg",
            2,
            2,
            Some("h2"),
        )
        .unwrap();
        let map = favorite_snapshots_for_origin_paths(
            &conn,
            &[
                r"C:\Photos\a.jpg".to_string(),
                r"C:\Photos\b.jpg".to_string(),
            ],
        )
        .unwrap();
        assert_eq!(map.len(), 2);
        assert_eq!(
            map
                .get(&favorite_origin_lookup_key(r"C:\Photos\a.jpg"))
                .unwrap()
                .content_sha256
                .as_deref(),
            Some("h1")
        );
    }

    fn load_favorite_snapshots_in_directory_scope_filters_other_albums() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        record_favorite_copy(
            &conn,
            r"C:\Photos\album-a\a.jpg",
            10,
            100,
            r"C:\Photos\album-a\Избранное\a.jpg",
            10,
            100,
            None,
        )
        .unwrap();
        record_favorite_copy(
            &conn,
            r"C:\Photos\album-b\b.jpg",
            20,
            200,
            r"C:\Photos\album-b\Избранное\b.jpg",
            20,
            200,
            None,
        )
        .unwrap();
        let scoped = load_favorite_snapshots_in_directory_scope(&conn, r"C:\Photos\album-a")
            .unwrap();
        assert_eq!(scoped.len(), 1);
        assert_eq!(scoped[0].origin_path, r"C:\Photos\album-a\a.jpg");
    }

    fn sync_favorite_keys_after_path_rewrite() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        record_favorite_copy(
            &conn,
            r"C:\Photos\old\a.jpg",
            10,
            100,
            r"C:\Photos\old\Favorites\a.jpg",
            10,
            100,
            Some("abc"),
        )
        .unwrap();
        rewrite_path_prefix(
            &conn,
            "favorite_copies",
            "origin_path",
            &path_key(r"C:\Photos\old"),
            r"C:\Photos\new",
        )
        .unwrap();
        rewrite_path_prefix(
            &conn,
            "favorite_copies",
            "copy_path",
            &path_key(r"C:\Photos\old"),
            r"C:\Photos\new",
        )
        .unwrap();
        sync_favorite_copy_keys(&conn).unwrap();
        let found = favorite_snapshot_for_copy(&conn, r"C:\Photos\new\Favorites\a.jpg")
            .unwrap()
            .expect("link");
        assert_eq!(
            path_key(&found.origin_path),
            path_key(r"C:\Photos\new\a.jpg")
        );
        assert_eq!(
            path_key(&found.copy_path),
            path_key(r"C:\Photos\new\Favorites\a.jpg")
        );
    }
}
