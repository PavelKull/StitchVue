use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use image::codecs::jpeg::JpegEncoder;
use image::RgbImage;

use crate::{cache, metadata, thumbnail};

const SYNTHETIC_COUNT: usize = 1000;
const SYNTHETIC_SIZE: (u32, u32) = (3000, 2000);
const WORKERS: usize = 4;

fn generate(path: &Path) -> Result<Vec<(u32, Vec<u8>)>, String> {
    let bytes = std::fs::read(path).map_err(|err| err.to_string())?;
    let source =
        thumbnail::decode(&bytes, crate::formats::from_path(path)).map_err(|err| err.message)?;
    drop(bytes);
    let rendered = thumbnail::render(source, &[512, 256]).map_err(|err| err.message)?;
    Ok(rendered.tiers)
}

fn legacy_generate(path: &Path) -> Result<Vec<(u32, Vec<u8>)>, String> {
    use image::{DynamicImage, GenericImageView, ImageDecoder, ImageReader, Limits};
    let bytes = std::fs::read(path).map_err(|err| err.to_string())?;
    let mut reader = ImageReader::new(std::io::Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|err| err.to_string())?;
    reader.limits(Limits::default());
    let mut decoder = reader.into_decoder().map_err(|err| err.to_string())?;
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut image = DynamicImage::from_decoder(decoder).map_err(|err| err.to_string())?;
    image.apply_orientation(orientation);
    drop(bytes);
    let mut encoded = Vec::new();
    for tier in [512u32, 256] {
        let (width, height) = image.dimensions();
        if width.max(height) > tier {
            image = image.thumbnail(tier, tier);
        }
        let resized = image.clone();
        let mut out = Vec::new();
        JpegEncoder::new_with_quality(&mut out, 80)
            .encode_image(&resized)
            .map_err(|err| err.to_string())?;
        encoded.push((tier, out));
    }
    Ok(encoded)
}

fn synthetic_jpeg_dir() -> PathBuf {
    let root = std::env::var_os("STITCHVUE_BENCH_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let dir = root.join("stitchvue-bench-jpeg-3000x2000-v2");
    let marker = dir.join(".complete");
    if marker.is_file() {
        return dir;
    }
    std::fs::create_dir_all(&dir).unwrap();
    let (width, height) = SYNTHETIC_SIZE;
    let next = AtomicUsize::new(0);
    std::thread::scope(|scope| {
        for _ in 0..WORKERS {
            scope.spawn(|| loop {
                let index = next.fetch_add(1, Ordering::Relaxed);
                if index >= SYNTHETIC_COUNT {
                    break;
                }
                let mut seed = 0x9e37_79b9_u32.wrapping_mul(index as u32 + 1);
                let image = RgbImage::from_fn(width, height, |x, y| {
                    seed ^= seed << 13;
                    seed ^= seed >> 17;
                    seed ^= seed << 5;
                    let noise = (seed & 7) as u8;
                    image::Rgb([
                        ((x * 255 / width) as u8).wrapping_add(noise),
                        ((y * 255 / height) as u8).wrapping_add(noise),
                        (((x + y + index as u32 * 7) % 256) as u8) / 2 + noise,
                    ])
                });
                let mut bytes = Vec::new();
                JpegEncoder::new_with_quality(&mut bytes, 90)
                    .encode_image(&image)
                    .unwrap();
                std::fs::write(dir.join(format!("img-{index:04}.jpg")), bytes).unwrap();
            });
        }
    });
    std::fs::write(&marker, b"").unwrap();
    dir
}

fn corpus_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.is_file() && !path.file_name().unwrap().to_string_lossy().starts_with('.')
        })
        .collect();
    files.sort();
    files
}

fn parallel<T: Send>(files: &[PathBuf], job: impl Fn(&Path) -> T + Sync) -> (Duration, Vec<T>) {
    let next = AtomicUsize::new(0);
    let start = Instant::now();
    let mut results: Vec<(usize, T)> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..WORKERS)
            .map(|_| {
                scope.spawn(|| {
                    let mut out = Vec::new();
                    loop {
                        let index = next.fetch_add(1, Ordering::Relaxed);
                        let Some(path) = files.get(index) else {
                            break;
                        };
                        out.push((index, job(path)));
                    }
                    out
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|handle| handle.join().unwrap())
            .collect()
    });
    let elapsed = start.elapsed();
    results.sort_by_key(|(index, _)| *index);
    (
        elapsed,
        results.into_iter().map(|(_, value)| value).collect(),
    )
}

fn per_file(total: Duration, count: usize) -> String {
    format!(
        "{:>9.1} ms total {:>7.2} ms/file {:>7.1} files/s",
        total.as_secs_f64() * 1000.0,
        total.as_secs_f64() * 1000.0 / count.max(1) as f64,
        count as f64 / total.as_secs_f64().max(1e-9)
    )
}

#[cfg(windows)]
fn peak_working_set_mb() -> f64 {
    #[repr(C)]
    #[derive(Default)]
    struct Counters {
        cb: u32,
        page_faults: u32,
        peak_working_set: usize,
        working_set: usize,
        quota_peak_paged: usize,
        quota_paged: usize,
        quota_peak_nonpaged: usize,
        quota_nonpaged: usize,
        pagefile: usize,
        peak_pagefile: usize,
    }
    unsafe extern "system" {
        fn GetCurrentProcess() -> *mut core::ffi::c_void;
        fn K32GetProcessMemoryInfo(
            process: *mut core::ffi::c_void,
            counters: *mut Counters,
            cb: u32,
        ) -> i32;
    }
    let mut counters = Counters {
        cb: std::mem::size_of::<Counters>() as u32,
        ..Default::default()
    };
    let ok = unsafe { K32GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, counters.cb) };
    if ok == 0 {
        return 0.0;
    }
    counters.peak_working_set as f64 / (1024.0 * 1024.0)
}

#[cfg(not(windows))]
fn peak_working_set_mb() -> f64 {
    0.0
}

fn run_folder(label: &str, dir: &Path) {
    let files = corpus_files(dir);
    let count = files.len();
    eprintln!("== {label}: {count} files in {}", dir.display());

    let start = Instant::now();
    let view = crate::scanner::browse(Some(&dir.to_string_lossy())).unwrap();
    eprintln!(
        "discovery      {}  ({} listed)",
        per_file(start.elapsed(), count),
        view.images.len()
    );

    let start = Instant::now();
    let mut meta_failed = 0;
    for path in &files {
        if metadata::read_header(path).is_err() {
            meta_failed += 1;
        }
    }
    eprintln!(
        "metadata 1x    {}  failed {meta_failed}",
        per_file(start.elapsed(), count)
    );

    let first = files.iter().take(24).cloned().collect::<Vec<_>>();
    let (elapsed, _) = parallel(&first, |path| generate(path).map(|tiers| tiers.len()));
    eprintln!(
        "first 24 thumbs {:>8.1} ms ({WORKERS} workers)",
        elapsed.as_secs_f64() * 1000.0
    );

    let thumbs_dir =
        std::env::temp_dir().join(format!("stitchvue-bench-thumbs-{}", std::process::id()));
    std::fs::create_dir_all(&thumbs_dir).unwrap();
    let (elapsed, results) = parallel(&files, |path| generate(path));
    let failed = results.iter().filter(|result| result.is_err()).count();
    eprintln!(
        "uncached {WORKERS}x    {}  failed {failed}",
        per_file(elapsed, count)
    );
    eprintln!("peak working set {:.0} MB", peak_working_set_mb());

    let conn = rusqlite::Connection::open_in_memory().unwrap();
    crate::database::migrate(&conn).unwrap();
    for (index, (path, result)) in files.iter().zip(results).enumerate() {
        let Ok(tiers) = result else {
            continue;
        };
        let source = path.to_string_lossy();
        for (tier, bytes) in tiers {
            let dest = thumbs_dir.join(format!("{index}-{tier}.jpg"));
            std::fs::write(&dest, &bytes).unwrap();
            cache::save_thumb(
                &conn,
                &source,
                1,
                1,
                1,
                1,
                1,
                tier,
                &dest.to_string_lossy(),
                bytes.len() as i64,
            )
            .unwrap();
        }
    }
    let start = Instant::now();
    let mut hits = 0;
    for path in &files {
        let source = path.to_string_lossy();
        for tier in [256u32, 512] {
            if matches!(cache::cached_thumb(&conn, &source, 1, 1, tier), Ok(Some(_))) {
                hits += 1;
            }
        }
    }
    eprintln!(
        "cached lookup  {}  hits {hits}",
        per_file(start.elapsed(), count)
    );
    let _ = std::fs::remove_dir_all(&thumbs_dir);
}

#[test]
#[ignore = "A/B of the pre-Stage-2 JPEG path against the current one"]
fn bench_jpeg_ab() {
    let files = corpus_files(&synthetic_jpeg_dir());
    let files = &files[..files.len().min(400)];
    for round in 0..3 {
        let (legacy, _) = parallel(files, |path| legacy_generate(path).map(|tiers| tiers.len()));
        let (current, _) = parallel(files, |path| generate(path).map(|tiers| tiers.len()));
        eprintln!(
            "round {round}: legacy {:.2} ms/file, current {:.2} ms/file ({:+.1}%)",
            legacy.as_secs_f64() * 1000.0 / files.len() as f64,
            current.as_secs_f64() * 1000.0 / files.len() as f64,
            (current.as_secs_f64() / legacy.as_secs_f64() - 1.0) * 100.0
        );
    }
}

#[test]
#[ignore = "format pipeline benchmark"]
fn bench_formats() {
    run_folder("synthetic JPEG 3000x2000", &synthetic_jpeg_dir());
    if let Some(corpus) = std::env::var_os("STITCHVUE_CORPUS") {
        for dir in std::env::split_paths(&corpus) {
            run_folder("corpus", &dir);
        }
    }
}
