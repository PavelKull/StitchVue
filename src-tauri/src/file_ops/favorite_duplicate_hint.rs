//! P3.2: skip reading favorite copy bytes when SQLite already has a content hash for the link.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use rusqlite::Connection;
use sha2::{Digest, Sha256};

use super::content_hash::format_sha256_digest;
use super::{Fail, IoGate, normalize_key, open_regular, COPY_CHUNK};
use crate::database;

#[derive(Debug, Clone)]
pub(crate) struct FavoriteDuplicateHint {
    pub copy_path_key: String,
    pub origin_size: u64,
    pub origin_modified_at: i64,
    pub content_sha256: String,
}

pub(crate) fn favorite_duplicate_hints_for_paths(
    db: &Connection,
    paths: &[String],
) -> HashMap<String, FavoriteDuplicateHint> {
    let mut out = HashMap::new();
    for path in paths {
        let origin_key = normalize_key(Path::new(path)).to_ascii_lowercase();
        let snap = match database::favorite_snapshot_for_origin(db, path) {
            Ok(Some(snap)) => snap,
            _ => continue,
        };
        let hash = match snap.content_sha256 {
            Some(hash) if !hash.is_empty() => hash,
            _ => continue,
        };
        out.insert(
            origin_key,
            FavoriteDuplicateHint {
                copy_path_key: normalize_key(Path::new(&snap.copy_path)).to_ascii_lowercase(),
                origin_size: snap.origin_size,
                origin_modified_at: snap.origin_modified_at,
                content_sha256: hash,
            },
        );
    }
    out
}

fn metadata_stamp_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// When the hint applies to `dest`, hash `source` once (gated IO) and compare to stored SHA-256.
/// `Ok(Some(()))` — same content as last link; `Ok(None)` — fall back to byte-compare.
pub(crate) fn try_confirm_duplicate_via_hint<G: IoGate>(
    gate: &G,
    source: &Path,
    dest: &Path,
    hint: &FavoriteDuplicateHint,
    cancel: &AtomicBool,
) -> Result<Option<()>, Fail> {
    let dest_key = normalize_key(dest).to_ascii_lowercase();
    if dest_key != hint.copy_path_key {
        return Ok(None);
    }
    let source_meta = fs::metadata(source).map_err(|err| super::io_fail(source, &err))?;
    if source_meta.len() != hint.origin_size
        || metadata_stamp_ms(&source_meta) != hint.origin_modified_at
    {
        return Ok(None);
    }
    let dest_meta = fs::metadata(dest).map_err(|err| super::io_fail(dest, &err))?;
    if dest_meta.len() != source_meta.len() {
        return Ok(None);
    }
    let actual = sha256_source_gated(gate, source, cancel)?;
    if actual == hint.content_sha256 {
        return Ok(Some(()));
    }
    Ok(None)
}

fn sha256_source_gated<G: IoGate>(
    gate: &G,
    source: &Path,
    cancel: &AtomicBool,
) -> Result<String, Fail> {
    let mut input = open_regular(source)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; COPY_CHUNK];
    let started = std::time::Instant::now();
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(super::fail("cancelled", "Операция отменена"));
        }
        if !gate.wait_visible(cancel) {
            return Err(super::fail("cancelled", "Операция отменена"));
        }
        let read = gate
            .with_read(|| -> std::io::Result<usize> { input.read(&mut buffer) })
            .map_err(|err| super::io_fail(source, &err))?;
        if cancel.load(Ordering::Relaxed) {
            return Err(super::fail("cancelled", "Операция отменена"));
        }
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    super::fav_metrics::record_sha256(started.elapsed());
    Ok(format_sha256_digest(hasher.finalize().as_ref()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::{migrate, record_favorite_copy};
    use rusqlite::Connection;

    #[test]
    fn favorite_duplicate_hints_for_paths_requires_stored_hash() {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        record_favorite_copy(
            &conn,
            r"C:\album\a.jpg",
            5,
            100,
            r"C:\album\Избранное\a.jpg",
            5,
            100,
            None,
        )
        .unwrap();
        let without_hash =
            favorite_duplicate_hints_for_paths(&conn, &[r"C:\album\a.jpg".to_string()]);
        assert!(without_hash.is_empty());

        record_favorite_copy(
            &conn,
            r"C:\album\a.jpg",
            5,
            100,
            r"C:\album\Избранное\a.jpg",
            5,
            100,
            Some("deadbeef"),
        )
        .unwrap();
        let with_hash =
            favorite_duplicate_hints_for_paths(&conn, &[r"C:\album\a.jpg".to_string()]);
        assert_eq!(with_hash.len(), 1);
        assert_eq!(
            with_hash
                .get(&normalize_key(Path::new(r"C:\album\a.jpg")).to_ascii_lowercase())
                .unwrap()
                .content_sha256,
            "deadbeef"
        );
    }
}
