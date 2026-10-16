use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayRotation {
    pub path: String,
    pub quarters: u8,
}

pub fn file_key(path: &str) -> Result<(String, u64, i64), String> {
    let meta = std::fs::metadata(path).map_err(|err| format!("read {path}: {err}"))?;
    if !meta.is_file() {
        return Err("not a file".to_string());
    }
    Ok((path.to_string(), meta.len(), modified_millis(&meta)))
}

fn modified_millis(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

pub fn read_quarters(conn: &Connection, path: &str, size: u64, modified_at: i64) -> Result<u8, String> {
    let value: Option<i64> = conn
        .query_row(
            "SELECT quarters FROM image_display_rotation
             WHERE source_path = ?1 AND source_size = ?2 AND source_modified_at = ?3",
            params![path, size as i64, modified_at],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| format!("read rotation {path}: {err}"))?;
    Ok(value.unwrap_or(0).clamp(0, 3) as u8)
}

pub fn write_quarters(
    conn: &Connection,
    path: &str,
    size: u64,
    modified_at: i64,
    quarters: u8,
) -> Result<(), String> {
    let quarters = quarters % 4;
    conn.execute(
        "INSERT INTO image_display_rotation (source_path, source_size, source_modified_at, quarters)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(source_path, source_size, source_modified_at)
         DO UPDATE SET quarters = excluded.quarters",
        params![path, size as i64, modified_at, quarters as i64],
    )
    .map_err(|err| format!("save rotation {path}: {err}"))?;
    Ok(())
}

pub fn rotate_clockwise(conn: &Connection, path: &str) -> Result<u8, String> {
    let (path, size, modified_at) = file_key(path)?;
    let next = (read_quarters(conn, &path, size, modified_at)? + 1) % 4;
    write_quarters(conn, &path, size, modified_at, next)?;
    Ok(next)
}

pub fn list_for_paths(conn: &Connection, paths: &[String]) -> Result<Vec<DisplayRotation>, String> {
    let mut items = Vec::new();
    for path in paths {
        let (path, size, modified_at) = match file_key(path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let quarters = read_quarters(conn, &path, size, modified_at)?;
        if quarters != 0 {
            items.push(DisplayRotation { path, quarters });
        }
    }
    Ok(items)
}
