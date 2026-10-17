use std::path::PathBuf;

use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension};

#[derive(Debug, Clone)]
pub struct WindowThumb {
    pub source_path: String,
    pub tier: u32,
    pub thumbnail_path: String,
    /// Cached JPEG pixel size. Not original geometry; layout reads `image_meta`.
    #[allow(dead_code)]
    pub width: u32,
    #[allow(dead_code)]
    pub height: u32,
}

pub fn thumbs_for_sources(
    conn: &Connection,
    sources: &[(String, i64, i64)],
) -> Result<Vec<WindowThumb>, String> {
    let mut found = Vec::new();
    for chunk in sources.chunks(24) {
        if chunk.is_empty() {
            continue;
        }
        let mut sql = String::from(
            "SELECT source_path, tier, thumbnail_path, width, height FROM thumbnail_cache WHERE ",
        );
        let mut values = Vec::new();
        for (index, (path, size, modified)) in chunk.iter().enumerate() {
            if index > 0 {
                sql.push_str(" OR ");
            }
            let base = index * 3;
            sql.push_str(&format!(
                "(source_path = ?{} AND source_size = ?{} AND source_modified_at = ?{})",
                base + 1,
                base + 2,
                base + 3
            ));
            values.push(Value::Text(path.clone()));
            values.push(Value::Integer(*size));
            values.push(Value::Integer(*modified));
        }
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|err| format!("prepare thumbnail window: {err}"))?;
        let rows = stmt
            .query_map(params_from_iter(values), |row| {
                Ok(WindowThumb {
                    source_path: row.get(0)?,
                    tier: row.get(1)?,
                    thumbnail_path: row.get(2)?,
                    width: row.get(3)?,
                    height: row.get(4)?,
                })
            })
            .map_err(|err| format!("query thumbnail window: {err}"))?;
        for row in rows {
            let row = row.map_err(|err| format!("read thumbnail window: {err}"))?;
            if std::path::Path::new(&row.thumbnail_path).is_file() {
                found.push(row);
            }
        }
    }
    Ok(found)
}

pub fn meta_for_sources(
    conn: &Connection,
    sources: &[(String, i64, i64)],
) -> Result<Vec<(String, u32, u32)>, String> {
    let mut found = Vec::new();
    for chunk in sources.chunks(24) {
        if chunk.is_empty() {
            continue;
        }
        let mut sql = String::from("SELECT source_path, width, height FROM image_meta WHERE ");
        let mut values = Vec::new();
        for (index, (path, size, modified)) in chunk.iter().enumerate() {
            if index > 0 {
                sql.push_str(" OR ");
            }
            let base = index * 3;
            sql.push_str(&format!(
                "(source_path = ?{} AND source_size = ?{} AND source_modified_at = ?{})",
                base + 1,
                base + 2,
                base + 3
            ));
            values.push(Value::Text(path.clone()));
            values.push(Value::Integer(*size));
            values.push(Value::Integer(*modified));
        }
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|err| format!("prepare meta window: {err}"))?;
        let rows = stmt
            .query_map(params_from_iter(values), |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .map_err(|err| format!("query meta window: {err}"))?;
        for row in rows {
            found.push(row.map_err(|err| format!("read meta window: {err}"))?);
        }
    }
    Ok(found)
}

pub fn fails_for_sources(
    conn: &Connection,
    sources: &[(String, i64, i64)],
) -> Result<Vec<(String, String)>, String> {
    let mut found = Vec::new();
    for chunk in sources.chunks(24) {
        if chunk.is_empty() {
            continue;
        }
        let mut sql =
            String::from("SELECT source_path, kind FROM decode_fail WHERE decoder = ?1 AND (");
        let mut values = vec![Value::Text(DECODER.to_string())];
        for (index, (path, size, modified)) in chunk.iter().enumerate() {
            if index > 0 {
                sql.push_str(" OR ");
            }
            let base = 1 + index * 3;
            sql.push_str(&format!(
                "(source_path = ?{} AND source_size = ?{} AND source_modified_at = ?{})",
                base + 1,
                base + 2,
                base + 3
            ));
            values.push(Value::Text(path.clone()));
            values.push(Value::Integer(*size));
            values.push(Value::Integer(*modified));
        }
        sql.push(')');
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|err| format!("prepare fail window: {err}"))?;
        let rows = stmt
            .query_map(params_from_iter(values), |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(|err| format!("query fail window: {err}"))?;
        for row in rows {
            found.push(row.map_err(|err| format!("read fail window: {err}"))?);
        }
    }
    Ok(found)
}

pub const DEFAULT_LIMIT: i64 = 1024 * 1024 * 1024;
pub const DEFAULT_TTL_SECS: i64 = 7 * 24 * 60 * 60;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheUsage {
    pub used_bytes: i64,
    pub limit_bytes: i64,
    pub ttl_secs: Option<i64>,
}

pub fn usage(conn: &Connection) -> Result<CacheUsage, String> {
    let used_bytes = conn
        .query_row(
            "SELECT COALESCE(SUM(thumbnail_size), 0) FROM thumbnail_cache",
            [],
            |row| row.get(0),
        )
        .map_err(|err| format!("cache usage: {err}"))?;
    Ok(CacheUsage {
        used_bytes,
        limit_bytes: limit_bytes(conn)?,
        ttl_secs: ttl_secs(conn)?,
    })
}

pub fn maintain(conn: &Connection) -> Result<(), String> {
    maintain_with(conn, "")
}

pub fn maintain_with(conn: &Connection, active_folder: &str) -> Result<(), String> {
    purge_thumbnail_temps()?;
    let limit = limit_bytes(conn)?;
    let mut used = usage(conn)?.used_bytes;
    if used <= limit {
        return Ok(());
    }
    let recent = recent_folders(conn);
    let target = (limit as f64 * 0.85) as i64;
    if let Some(ttl) = ttl_secs(conn)? {
        let cutoff = now_secs() - ttl;
        used = evict(
            conn,
            used,
            target,
            "created_at < ?1",
            params![cutoff],
            active_folder,
            &recent,
        )?;
    }
    if used > target {
        evict(
            conn,
            used,
            target,
            "1 = 1",
            params![],
            active_folder,
            &recent,
        )?;
    }
    Ok(())
}

fn recent_folders(conn: &Connection) -> Vec<String> {
    let Ok(mut statement) =
        conn.prepare("SELECT path FROM recent_folders ORDER BY opened_at DESC LIMIT 5")
    else {
        return Vec::new();
    };
    statement
        .query_map([], |row| row.get::<_, String>(0))
        .ok()
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default()
}

pub fn set_limit(conn: &Connection, bytes: i64) -> Result<CacheUsage, String> {
    const PRESETS: [i64; 4] = [
        512 * 1024 * 1024,
        1024 * 1024 * 1024,
        2 * 1024 * 1024 * 1024,
        5 * 1024 * 1024 * 1024,
    ];
    if !PRESETS.contains(&bytes) {
        return Err(format!("unsupported cache limit: {bytes}"));
    }
    crate::database::set_setting(conn, "cache_limit_bytes", &bytes.to_string())?;
    maintain(conn)?;
    usage(conn)
}

pub fn set_ttl(conn: &Connection, preset: &str) -> Result<CacheUsage, String> {
    let stored = match preset {
        "3" => "259200",
        "7" => "604800",
        "30" => "2592000",
        "never" => "never",
        _ => return Err(format!("unsupported cache ttl: {preset}")),
    };
    crate::database::set_setting(conn, "cache_ttl_secs", stored)?;
    usage(conn)
}

pub fn clear(conn: &Connection) -> Result<(), String> {
    let mut statement = conn
        .prepare("SELECT thumbnail_path FROM thumbnail_cache")
        .map_err(|err| format!("clear cache: {err}"))?;
    let paths = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|err| format!("clear cache: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("clear cache: {err}"))?;
    drop(statement);
    for path in paths {
        let _ = std::fs::remove_file(path);
    }
    conn.execute("DELETE FROM thumbnail_cache", [])
        .map_err(|err| format!("clear cache: {err}"))?;
    Ok(())
}

pub fn cached_thumb(
    conn: &Connection,
    path: &str,
    size: u64,
    modified_at: i64,
    tier: u32,
) -> Result<Option<String>, String> {
    let found: Option<String> = conn
        .query_row(
            "SELECT thumbnail_path FROM thumbnail_cache
             WHERE source_path = ?1 AND source_size = ?2 AND source_modified_at = ?3 AND tier = ?4",
            params![path, size as i64, modified_at, tier],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| format!("lookup thumbnail {path}: {err}"))?;
    let Some(thumb) = found else {
        return Ok(None);
    };
    if !std::path::Path::new(&thumb).is_file() {
        conn.execute(
            "DELETE FROM thumbnail_cache WHERE thumbnail_path = ?1",
            [&thumb],
        )
        .map_err(|err| format!("drop missing thumbnail: {err}"))?;
        return Ok(None);
    }
    conn.execute(
        "UPDATE thumbnail_cache SET last_accessed_at = ?1 WHERE thumbnail_path = ?2",
        params![now_secs(), thumb],
    )
    .map_err(|err| format!("touch thumbnail: {err}"))?;
    Ok(Some(thumb))
}

pub const DECODER: &str = "heic-rs-0.1.1+rawler-0.8.0";

pub fn cached_fail(
    conn: &Connection,
    path: &str,
    size: u64,
    modified_at: i64,
) -> Result<Option<(String, String)>, String> {
    conn.query_row(
        "SELECT kind, message FROM decode_fail
         WHERE source_path = ?1 AND source_size = ?2 AND source_modified_at = ?3 AND decoder = ?4",
        params![path, size as i64, modified_at, DECODER],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(|err| format!("lookup fail {path}: {err}"))
}

pub fn save_fail(
    conn: &Connection,
    path: &str,
    size: u64,
    modified_at: i64,
    kind: &str,
    message: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO decode_fail (source_path, source_size, source_modified_at, decoder, kind, message)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(source_path, source_size, source_modified_at)
         DO UPDATE SET decoder = excluded.decoder, kind = excluded.kind, message = excluded.message",
        params![path, size as i64, modified_at, DECODER, kind, message],
    )
    .map_err(|err| format!("save fail {path}: {err}"))?;
    Ok(())
}

pub fn cached_meta(
    conn: &Connection,
    path: &str,
    size: u64,
    modified_at: i64,
) -> Result<Option<(u32, u32)>, String> {
    conn.query_row(
        "SELECT width, height FROM image_meta
         WHERE source_path = ?1 AND source_size = ?2 AND source_modified_at = ?3",
        params![path, size as i64, modified_at],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(|err| format!("lookup meta {path}: {err}"))
}

pub fn save_meta(
    conn: &Connection,
    path: &str,
    size: u64,
    modified_at: i64,
    width: u32,
    height: u32,
    orientation: u8,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO image_meta (source_path, source_size, source_modified_at, width, height, orientation)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(source_path, source_size, source_modified_at)
         DO UPDATE SET width = excluded.width, height = excluded.height, orientation = excluded.orientation",
        params![path, size as i64, modified_at, width, height, orientation],
    )
    .map_err(|err| format!("save meta {path}: {err}"))?;
    Ok(())
}

pub fn save_thumb(
    conn: &Connection,
    path: &str,
    size: u64,
    modified_at: i64,
    width: u32,
    height: u32,
    orientation: u8,
    tier: u32,
    thumbnail_path: &str,
    thumbnail_size: i64,
) -> Result<(), String> {
    let now = now_secs();
    conn.execute(
        "INSERT INTO thumbnail_cache (
            source_path, source_size, source_modified_at, width, height, orientation,
            tier, thumbnail_path, thumbnail_size, created_at, last_accessed_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
         ON CONFLICT(source_path, source_size, source_modified_at, tier)
         DO UPDATE SET
            thumbnail_path = excluded.thumbnail_path,
            thumbnail_size = excluded.thumbnail_size,
            width = excluded.width,
            height = excluded.height,
            last_accessed_at = excluded.last_accessed_at",
        params![
            path,
            size as i64,
            modified_at,
            width,
            height,
            orientation,
            tier,
            thumbnail_path,
            thumbnail_size,
            now
        ],
    )
    .map_err(|err| format!("save thumbnail {path}: {err}"))?;
    Ok(())
}

/// Writes image_meta and thumbnail_cache in one transaction after the JPEG file exists.
pub fn publish_thumbnail(
    conn: &Connection,
    path: &str,
    size: u64,
    modified_at: i64,
    width: u32,
    height: u32,
    orientation: u8,
    tier: u32,
    thumbnail_path: &str,
    thumbnail_size: i64,
    write_meta: bool,
) -> Result<(), String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|err| format!("publish thumbnail tx {path}: {err}"))?;
    if write_meta {
        tx.execute(
            "INSERT INTO image_meta (source_path, source_size, source_modified_at, width, height, orientation)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(source_path, source_size, source_modified_at)
             DO UPDATE SET width = excluded.width, height = excluded.height, orientation = excluded.orientation",
            params![path, size as i64, modified_at, width, height, orientation],
        )
        .map_err(|err| format!("publish meta {path}: {err}"))?;
    }
    let now = now_secs();
    tx.execute(
        "INSERT INTO thumbnail_cache (
            source_path, source_size, source_modified_at, width, height, orientation,
            tier, thumbnail_path, thumbnail_size, created_at, last_accessed_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
         ON CONFLICT(source_path, source_size, source_modified_at, tier)
         DO UPDATE SET
            thumbnail_path = excluded.thumbnail_path,
            thumbnail_size = excluded.thumbnail_size,
            width = excluded.width,
            height = excluded.height,
            last_accessed_at = excluded.last_accessed_at",
        params![
            path,
            size as i64,
            modified_at,
            width,
            height,
            orientation,
            tier,
            thumbnail_path,
            thumbnail_size,
            now
        ],
    )
    .map_err(|err| format!("publish thumbnail row {path}: {err}"))?;
    tx.commit()
        .map_err(|err| format!("commit thumbnail {path}: {err}"))?;
    Ok(())
}

pub fn discard_thumbnail_file(thumbnail_path: &str) {
    if thumbnail_path.is_empty() {
        return;
    }
    let _ = std::fs::remove_file(thumbnail_path);
}

pub fn purge_thumbnail_temps() -> Result<(), String> {
    let dir = thumbnail_dir();
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(&dir).map_err(|err| format!("read thumbnail dir: {err}"))? {
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "tmp") {
            let _ = std::fs::remove_file(path);
        }
    }
    Ok(())
}

fn thumbnail_dir() -> PathBuf {
    crate::database::app_dir().join("cache").join("thumbnails")
}

fn evict(
    conn: &Connection,
    mut used: i64,
    target: i64,
    filter: &str,
    filter_params: impl rusqlite::Params,
    active_folder: &str,
    recent: &[String],
) -> Result<i64, String> {
    let sql = format!(
        "SELECT id, thumbnail_path, thumbnail_size, source_path, tier, last_accessed_at
         FROM thumbnail_cache WHERE {filter}"
    );
    let mut statement = conn.prepare(&sql).map_err(|err| format!("evict: {err}"))?;
    let mut rows = statement
        .query_map(filter_params, |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })
        .map_err(|err| format!("evict: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("evict: {err}"))?;
    drop(statement);
    rows.sort_by(|left, right| {
        keep_rank(&left.3, active_folder, recent)
            .cmp(&keep_rank(&right.3, active_folder, recent))
            .then_with(|| tier_rank(left.4).cmp(&tier_rank(right.4)))
            .then_with(|| left.5.cmp(&right.5))
    });
    for (id, path, size, _, _, _) in rows {
        if used <= target {
            break;
        }
        let _ = std::fs::remove_file(&path);
        conn.execute("DELETE FROM thumbnail_cache WHERE id = ?1", [id])
            .map_err(|err| format!("evict row: {err}"))?;
        used -= size;
    }
    Ok(used.max(0))
}

fn limit_bytes(conn: &Connection) -> Result<i64, String> {
    match crate::database::setting(conn, "cache_limit_bytes")? {
        Some(value) => Ok(value.parse().unwrap_or(DEFAULT_LIMIT)),
        None => Ok(DEFAULT_LIMIT),
    }
}

fn ttl_secs(conn: &Connection) -> Result<Option<i64>, String> {
    match crate::database::setting(conn, "cache_ttl_secs")? {
        Some(value) if value == "never" => Ok(None),
        Some(value) => Ok(Some(value.parse().unwrap_or(DEFAULT_TTL_SECS))),
        None => Ok(Some(DEFAULT_TTL_SECS)),
    }
}

fn keep_rank(path: &str, active_folder: &str, recent: &[String]) -> u8 {
    if path_under(path, active_folder) {
        2
    } else if recent.iter().any(|folder| path_under(path, folder)) {
        1
    } else {
        0
    }
}

fn tier_rank(tier: i64) -> u8 {
    match tier {
        1024 => 0,
        512 => 1,
        _ => 2,
    }
}

fn path_under(path: &str, folder: &str) -> bool {
    if folder.is_empty() {
        return false;
    }
    let path = path.replace('/', "\\").to_lowercase();
    let mut folder = folder
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase();
    folder.push('\\');
    path.starts_with(&folder)
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|time| time.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod publish_tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn publish_thumbnail_writes_meta_and_thumb_together() {
        let conn = Connection::open_in_memory().unwrap();
        crate::database::migrate(&conn).unwrap();
        publish_thumbnail(
            &conn,
            "C:\\photos\\a.jpg",
            42,
            99,
            800,
            600,
            1,
            256,
            "C:\\cache\\a-256.jpg",
            12_345,
            true,
        )
        .unwrap();
        let meta = cached_meta(&conn, "C:\\photos\\a.jpg", 42, 99).unwrap();
        assert_eq!(meta, Some((800, 600)));
        let stored: String = conn
            .query_row(
                "SELECT thumbnail_path FROM thumbnail_cache
                 WHERE source_path = ?1 AND source_size = ?2 AND source_modified_at = ?3 AND tier = ?4",
                params!["C:\\photos\\a.jpg", 42_i64, 99_i64, 256],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored, "C:\\cache\\a-256.jpg");
    }

    #[test]
    fn a_missing_thumbnail_file_drops_the_sqlite_row() {
        let conn = Connection::open_in_memory().unwrap();
        crate::database::migrate(&conn).unwrap();
        publish_thumbnail(
            &conn,
            "C:\\photos\\b.jpg",
            1,
            1,
            3,
            2,
            1,
            256,
            "C:\\cache\\missing.jpg",
            10,
            true,
        )
        .unwrap();
        assert!(cached_thumb(&conn, "C:\\photos\\b.jpg", 1, 1, 256)
            .unwrap()
            .is_none());
    }
}
