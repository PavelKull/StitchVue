use std::fs::File;
use std::io::Read;
use std::path::Path;

use sha2::{Digest, Sha256};

const CHUNK: usize = 1024 * 1024;

/// Streaming SHA-256 of a regular file. Does not load the whole file into memory.
pub fn sha256_file(path: &Path) -> Result<String, String> {
    let start = std::time::Instant::now();
    let mut file =
        File::open(path).map_err(|err| format!("hash open {}: {err}", path.display()))?;
    let out =
        sha256_reader(&mut file).map_err(|err| format!("hash read {}: {err}", path.display()))?;
    crate::file_ops::fav_metrics::record_sha256(start.elapsed());
    Ok(out)
}

/// Incremental SHA-256 over any reader (used while copying to avoid a second full read).
pub fn sha256_reader(mut reader: impl Read) -> Result<String, String> {
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; CHUNK];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|err| format!("hash read: {err}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex_lower(hasher.finalize().as_ref()))
}

/// Format a raw 32-byte SHA-256 digest as lowercase hex.
pub fn format_sha256_digest(digest: &[u8]) -> String {
    hex_lower(digest)
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0xf) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn hashes_known_bytes() {
        let dir = std::env::temp_dir().join(format!("sv-hash-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.bin");
        std::fs::File::create(&path)
            .unwrap()
            .write_all(b"stitchvue")
            .unwrap();
        let expected = hex_lower(Sha256::digest(b"stitchvue").as_ref());
        assert_eq!(sha256_file(&path).unwrap(), expected);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
