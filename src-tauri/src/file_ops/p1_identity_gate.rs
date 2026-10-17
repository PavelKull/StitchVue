//! P1 identity / origin availability helpers (research R1, CL-P04).
//! Size/mtime are pre-filters only; content proof is required for occupied targets.

use std::fs;
use std::io;
use std::path::Path;

use super::content_hash::sha256_file;
use super::is_reparse;

/// Disk reachability of a registered origin path (CL-P04).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OriginAvailability {
    /// File metadata readable at the registered path.
    Accessible,
    Missing,
    Unavailable,
}


/// Map IO from origin inspect: not-ready/access/offline → Unavailable;
/// stable NotFound → Missing. Present file is handled by the caller as Accessible.
pub fn classify_origin_availability(err: &io::Error) -> OriginAvailability {
    if let Some(code) = err.raw_os_error() {
        match code {
            // FILE_NOT_FOUND / PATH_NOT_FOUND — stable absence on reachable volume.
            2 | 3 => return OriginAvailability::Missing,
            // NOT_READY, INVALID_DRIVE, ACCESS_DENIED, SHARING/LOCK, network/offline-ish.
            5 | 15 | 19 | 21 | 32 | 33 | 53 | 64 | 65 | 67 | 1231 | 1460 => {
                return OriginAvailability::Unavailable;
            }
            _ => {}
        }
    }
    match err.kind() {
        io::ErrorKind::NotFound => OriginAvailability::Missing,
        io::ErrorKind::PermissionDenied => OriginAvailability::Unavailable,
        // Safer default: treat other IO as unavailable so we never purge on transient errors.
        _ => OriginAvailability::Unavailable,
    }
}

const IDENTITY_CONFLICT: &str =
    "Конфликт идентичности: целевой файл занят другим содержимым (CL-00).";

/// T0–T3 gate before writing onto `target`.
/// Free path → Ok. Occupied → content_sha256 and/or byte-identity vs `proof_source` required;
/// size/mtime alone never authorize overwrite.
pub fn assert_identity_allows_write(
    target: &Path,
    proof_source: &Path,
    expected_sha256: Option<&str>,
    bytes_identical: impl Fn(&Path, &Path) -> Result<bool, String>,
) -> Result<(), String> {
    let meta = match fs::symlink_metadata(target) {
        Ok(meta) => meta,
        Err(err) => {
            return match classify_origin_availability(&err) {
                OriginAvailability::Missing => Ok(()),
                OriginAvailability::Unavailable => Err(format!(
                    "Целевой путь временно недоступен: {}",
                    target.display()
                )),
                OriginAvailability::Accessible => Ok(()),
            };
        }
    };
    if is_reparse(&meta) {
        return Err(format!(
            "Целевой путь является ссылкой/junction: {}",
            target.display()
        ));
    }
    if !meta.is_file() {
        return Err(format!(
            "Целевой путь не является файлом: {}",
            target.display()
        ));
    }

    // T1 pre-filter: different size ⇒ cannot be the same content.
    let proof_meta =
        fs::metadata(proof_source).map_err(|err| format!("proof meta: {err}"))?;
    if meta.len() != proof_meta.len() {
        return Err(IDENTITY_CONFLICT.to_string());
    }

    if let Some(expected) = expected_sha256 {
        let actual = sha256_file(target)?;
        if actual == expected {
            return Ok(());
        }
        return Err(IDENTITY_CONFLICT.to_string());
    }
    if bytes_identical(target, proof_source)? {
        return Ok(());
    }
    Err(IDENTITY_CONFLICT.to_string())
}

#[cfg(test)]
mod unit_tests {
    use super::*;
    use std::io::{Error, ErrorKind};

    #[test]
    fn p1_identity_availability_maps_not_found_to_missing() {
        assert_eq!(
            classify_origin_availability(&Error::from_raw_os_error(2)),
            OriginAvailability::Missing
        );
        assert_eq!(
            classify_origin_availability(&Error::from_raw_os_error(3)),
            OriginAvailability::Missing
        );
        assert_eq!(
            classify_origin_availability(&Error::new(ErrorKind::NotFound, "gone")),
            OriginAvailability::Missing
        );
    }

    #[test]
    fn p1_identity_availability_maps_access_offline_to_unavailable() {
        assert_eq!(
            classify_origin_availability(&Error::from_raw_os_error(5)),
            OriginAvailability::Unavailable
        );
        assert_eq!(
            classify_origin_availability(&Error::from_raw_os_error(21)),
            OriginAvailability::Unavailable
        );
        assert_eq!(
            classify_origin_availability(&Error::from_raw_os_error(32)),
            OriginAvailability::Unavailable
        );
        assert_eq!(
            classify_origin_availability(&Error::new(ErrorKind::PermissionDenied, "deny")),
            OriginAvailability::Unavailable
        );
    }
}
