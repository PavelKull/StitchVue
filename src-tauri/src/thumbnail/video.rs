//! Video poster frames from Quick Look (`qlmanage`), the same frame Finder shows.
// ponytail: one qlmanage process per video (~0.1 s). It never exits on a file it cannot
// thumbnail, so a broken video costs TIMEOUT once (failures are cached per file identity).
// Move to AVAssetImageGenerator in-process if that becomes a problem.

use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use super::{DecodeError, FailureKind, Source};
use crate::formats::Format;

/// Largest poster edge; Quick Look never upscales past the video size.
const POSTER_EDGE: u32 = 1024;
/// A good video takes ~0.1 s; a broken one would hold a decode worker forever.
const TIMEOUT: Duration = Duration::from_secs(10);

pub fn decode_path(path: &Path) -> Result<Source, DecodeError> {
    // qlmanage also hangs on a missing file instead of failing.
    if !std::fs::metadata(path).map_err(DecodeError::io)?.is_file() {
        return Err(DecodeError::new(FailureKind::Unsupported, "video path is not a file"));
    }
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let out = std::env::temp_dir().join(format!(
        "stitchvue-poster-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    std::fs::create_dir_all(&out).map_err(DecodeError::io)?;
    let result = quick_look(path, &out);
    let _ = std::fs::remove_dir_all(&out);
    result
}

fn quick_look(path: &Path, out: &Path) -> Result<Source, DecodeError> {
    let mut child = Command::new("qlmanage")
        .args(["-t", "-s", &POSTER_EDGE.to_string(), "-o"])
        .arg(out)
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(DecodeError::io)?;
    let started = Instant::now();
    while child.try_wait().map_err(DecodeError::io)?.is_none() {
        if started.elapsed() > TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(DecodeError::new(
                FailureKind::Corrupted,
                "Quick Look could not read the video",
            ));
        }
        std::thread::sleep(Duration::from_millis(15));
    }
    // `out` is private to this call, so take its only file instead of rebuilding
    // `<name>.png` (Unicode normalization of the name may differ).
    let no_frame =
        || DecodeError::new(FailureKind::Unsupported, "Quick Look produced no poster frame");
    let poster = std::fs::read_dir(out)
        .map_err(DecodeError::io)?
        .flatten()
        .next()
        .ok_or_else(no_frame)?;
    let bytes = std::fs::read(poster.path()).map_err(|_| no_frame())?;
    super::decode(&bytes, Some(Format::Png))
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::decode_path;

    #[test]
    fn poster_frame_keeps_video_aspect() {
        let dir = std::env::temp_dir().join(format!("stitchvue-video-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let clip = dir.join("clip.mov");
        std::fs::write(&clip, include_bytes!("testdata/tiny.mov")).unwrap();
        let source = decode_path(&clip).unwrap();
        assert_eq!((source.image.width(), source.image.height()), (128, 72));
        assert!(decode_path(&dir.join("missing.mov")).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
