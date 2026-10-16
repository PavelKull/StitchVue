//! Reproducible favorites benchmarks (temp dirs only).
//!
//! ```powershell
//! $env:CARGO_TARGET_DIR = "...\src-tauri\target"
//! $env:STITCHVUE_FAV_METRICS = "1"
//! cargo test bench_favorites_mass -- --ignored --nocapture
//! ```

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use rusqlite::Connection;

use super::fav_metrics;
use super::favorites_batch::{preview_remove_favorite_copies, remove_favorite_copies_batch, FavoriteBatchRemoveItem};
use super::{
    execute, Action, FileOperationResult, IoGate, LOCAL_FAVORITES, OperationRequest, ServiceRole,
    write_service_role,
};
use super::content_hash::sha256_file;
use crate::database;

struct DirectIo;

impl IoGate for DirectIo {
    fn wait_visible(&self, cancel: &std::sync::atomic::AtomicBool) -> bool {
        !cancel.load(Ordering::Relaxed)
    }

    fn with_read<T>(&self, work: impl FnOnce() -> T) -> T {
        work()
    }
}

fn run_copy(
    dir: &Path,
    paths: Vec<String>,
    slots: usize,
    cancel: &AtomicBool,
) -> FileOperationResult {
    let request = OperationRequest {
        operation_id: format!("bench-{}", paths.len()),
        directory: dir.display().to_string(),
        action: Action::CopyToLocalFavorites,
        paths,
    };
    execute(&DirectIo, &request, slots, cancel, &|_| {}).unwrap()
}

const SIZES: &[(&str, usize)] = &[("small", 4 * 1024), ("medium", 128 * 1024), ("large", 1024 * 1024)];
const COUNTS: &[usize] = &[10, 100, 500];

fn ensure_favorite_copies(root: &Path, count: usize) {
    let favorites = root.join(LOCAL_FAVORITES);
    if !favorites.is_dir() {
        fs::create_dir_all(&favorites).unwrap();
        write_service_role(&favorites, ServiceRole::Favorites).unwrap();
    }
    for index in 0..count {
        let name = format!("img-{index:05}.jpg");
        let origin = root.join(&name);
        let copy = favorites.join(&name);
        if !copy.exists() && origin.is_file() {
            fs::copy(&origin, &copy).unwrap();
        }
    }
}

fn bench_root() -> PathBuf {
    std::env::var_os("STITCHVUE_FAV_BENCH_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("stitchvue-fav-bench-v1")
}

fn fixture_album(count: usize, body_len: usize) -> PathBuf {
    let root = bench_root().join(format!("album-{count}-{body_len}"));
    let marker = root.join(".ready");
    if marker.is_file() {
        ensure_favorite_copies(&root, count);
        return root;
    }
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    let favorites = root.join(LOCAL_FAVORITES);
    fs::create_dir_all(&favorites).unwrap();
    write_service_role(&favorites, ServiceRole::Favorites).unwrap();
    for index in 0..count {
        let body: Vec<u8> = (0..body_len)
            .map(|offset| ((index * 31 + offset) % 251) as u8)
            .collect();
        let name = format!("img-{index:05}.jpg");
        fs::write(root.join(&name), &body).unwrap();
    }
    // Origins only; copies are created by the add benchmark.
    fs::write(&marker, b"").unwrap();
    root
}

fn memory_db_with_links(root: &Path, count: usize) -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    database::migrate(&conn).unwrap();
    let favorites = root.join(LOCAL_FAVORITES);
    for index in 0..count {
        let name = format!("img-{index:05}.jpg");
        let origin = root.join(&name);
        let copy = favorites.join(&name);
        let om = fs::metadata(&origin).unwrap();
        let cm = fs::metadata(&copy).unwrap();
        let hash = sha256_file(&origin).unwrap();
        database::record_favorite_copy(
            &conn,
            origin.to_str().unwrap(),
            om.len(),
            modified_ms(&om),
            copy.to_str().unwrap(),
            cm.len(),
            modified_ms(&cm),
            Some(&hash),
        )
        .unwrap();
    }
    conn
}

fn modified_ms(meta: &fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

struct BenchRow {
    size_label: &'static str,
    count: usize,
    add_ms: f64,
    preview_ms: f64,
    execute_ms: f64,
    metrics: fav_metrics::Snapshot,
}

fn run_scenario(size_label: &'static str, count: usize, body_len: usize) -> BenchRow {
    fav_metrics::set_enabled_from_env();
    fav_metrics::reset();

    let root = fixture_album(count, body_len);
    let paths: Vec<String> = (0..count)
        .map(|index| root.join(format!("img-{index:05}.jpg")).to_string_lossy().into_owned())
        .collect();

    let add_start = Instant::now();
    let cancel = AtomicBool::new(false);
    let add_result = run_copy(&root, paths.clone(), 2, &cancel);
    assert_eq!(add_result.state, "completed");
    let add_ms = add_start.elapsed().as_secs_f64() * 1000.0;

    let conn = memory_db_with_links(&root, count);
    let db = Mutex::new(conn);
    let copy_paths: Vec<String> = (0..count)
        .map(|index| {
            root.join(LOCAL_FAVORITES)
                .join(format!("img-{index:05}.jpg"))
                .to_string_lossy()
                .into_owned()
        })
        .collect();

    fav_metrics::reset();
    let preview_start = Instant::now();
    let preview = preview_remove_favorite_copies(&db, &copy_paths).unwrap();
    let preview_ms = preview_start.elapsed().as_secs_f64() * 1000.0;
    assert_eq!(preview.len(), count);

    fav_metrics::reset();
    let execute_start = Instant::now();
    #[cfg(windows)]
    {
        let items: Vec<FavoriteBatchRemoveItem> = copy_paths
            .iter()
            .map(|path| FavoriteBatchRemoveItem {
                path: path.clone(),
                confirmed: false,
            })
            .collect();
        let executed = remove_favorite_copies_batch(&db, &items).unwrap();
        assert_eq!(executed.len(), count);
        let ready = executed.iter().filter(|row| row.result.status == "ready" || row.result.status == "recycled").count();
        eprintln!("  execute ready/recycled rows: {ready}/{count}");
    }
    #[cfg(not(windows))]
    {
        eprintln!("  execute skipped (non-Windows recycle)");
    }
    let execute_ms = execute_start.elapsed().as_secs_f64() * 1000.0;
    let metrics = fav_metrics::snapshot();

    BenchRow {
        size_label,
        count,
        add_ms,
        preview_ms,
        execute_ms,
        metrics,
    }
}

#[test]
#[ignore = "favorites mass benchmark — set STITCHVUE_FAV_METRICS=1"]
fn bench_favorites_mass() {
    fav_metrics::set_enabled_from_env();
    eprintln!("favorites bench root: {}", bench_root().display());
    let counts: &[usize] = if std::env::var_os("STITCHVUE_FAV_BENCH_QUICK").is_some() {
        &[10]
    } else {
        COUNTS
    };
    let sizes: &[(&str, usize)] = if std::env::var_os("STITCHVUE_FAV_BENCH_QUICK").is_some() {
        &[("medium", 128 * 1024)]
    } else {
        SIZES
    };
    eprintln!("counts={:?} sizes={:?}", counts, sizes);

    for &(size_label, body_len) in sizes {
        for &count in counts {
            let row = run_scenario(size_label, count, body_len);
            eprintln!(
                "[{}/{}] add={:.1}ms preview={:.1}ms execute={:.1}ms",
                size_label,
                count,
                row.add_ms,
                row.preview_ms,
                row.execute_ms,
            );
            fav_metrics::print_snapshot("  metrics", row.metrics);
        }
    }
}

/// Micro-benchmark: gallery stays responsive when unfavorite runs on a blocking pool (proxy = total wall time).
#[test]
#[ignore = "favorites responsiveness proxy"]
fn bench_favorites_sequential_vs_parallel_proxy() {
    let count = 50;
    let root = fixture_album(count, 64 * 1024);
    let paths: Vec<String> = (0..count)
        .map(|index| root.join(format!("img-{index:05}.jpg")).to_string_lossy().into_owned())
        .collect();
    let cancel = AtomicBool::new(false);
    let sequential = Instant::now();
    run_copy(&root, paths, 1, &cancel);
    let seq_ms = sequential.elapsed().as_secs_f64() * 1000.0;

    let next = AtomicU64::new(0);
    let parallel = Instant::now();
    std::thread::scope(|scope| {
        for _ in 0..2 {
            scope.spawn(|| {
                loop {
                    let index = next.fetch_add(1, Ordering::Relaxed);
                    if index >= count as u64 {
                        break;
                    }
                    let path = root.join(format!("img-{index:05}.jpg"));
                    let _ = fs::metadata(&path);
                }
            });
        }
    });
    let par_ms = parallel.elapsed().as_secs_f64() * 1000.0;
    eprintln!(
        "sequential copy {count} files: {seq_ms:.1}ms; metadata-only parallel probe: {par_ms:.1}ms",
    );
}
