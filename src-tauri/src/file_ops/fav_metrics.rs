//! Optional counters for favorites benchmarks (`STITCHVUE_FAV_METRICS=1`).
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

static ENABLED: AtomicBool = AtomicBool::new(false);

#[cfg(test)]
pub fn set_enabled_from_env() {
    let on = std::env::var_os("STITCHVUE_FAV_METRICS").is_some_and(|v| v != "0" && v != "false");
    ENABLED.store(on, Ordering::Relaxed);
}

fn enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

#[cfg(test)]
pub fn reset() {
    READ_DIR_CALLS.store(0, Ordering::Relaxed);
    BYTE_COMPARE_PAIRS.store(0, Ordering::Relaxed);
    BYTE_COMPARE_BYTES.store(0, Ordering::Relaxed);
    SHA256_NS.store(0, Ordering::Relaxed);
    DB_LOCK_ACQUIRES.store(0, Ordering::Relaxed);
    DB_LOCK_WAIT_NS.store(0, Ordering::Relaxed);
}

static READ_DIR_CALLS: AtomicU64 = AtomicU64::new(0);
static BYTE_COMPARE_PAIRS: AtomicU64 = AtomicU64::new(0);
static BYTE_COMPARE_BYTES: AtomicU64 = AtomicU64::new(0);
static SHA256_NS: AtomicU64 = AtomicU64::new(0);
static DB_LOCK_ACQUIRES: AtomicU64 = AtomicU64::new(0);
static DB_LOCK_WAIT_NS: AtomicU64 = AtomicU64::new(0);

pub fn record_read_dir() {
    if enabled() {
        READ_DIR_CALLS.fetch_add(1, Ordering::Relaxed);
    }
}

pub fn record_byte_compare(file_len: u64) {
    if enabled() {
        BYTE_COMPARE_PAIRS.fetch_add(1, Ordering::Relaxed);
        BYTE_COMPARE_BYTES.fetch_add(file_len.saturating_mul(2), Ordering::Relaxed);
    }
}

pub fn record_sha256(duration: Duration) {
    if enabled() {
        SHA256_NS.fetch_add(duration.as_nanos() as u64, Ordering::Relaxed);
    }
}

pub fn record_db_lock_wait(wait: Duration) {
    if enabled() {
        DB_LOCK_ACQUIRES.fetch_add(1, Ordering::Relaxed);
        DB_LOCK_WAIT_NS.fetch_add(wait.as_nanos() as u64, Ordering::Relaxed);
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Snapshot {
    pub read_dir_calls: u64,
    pub byte_compare_pairs: u64,
    pub byte_compare_bytes: u64,
    pub sha256_ns: u64,
    pub db_lock_acquires: u64,
    pub db_lock_wait_ns: u64,
}

pub fn snapshot() -> Snapshot {
    Snapshot {
        read_dir_calls: READ_DIR_CALLS.load(Ordering::Relaxed),
        byte_compare_pairs: BYTE_COMPARE_PAIRS.load(Ordering::Relaxed),
        byte_compare_bytes: BYTE_COMPARE_BYTES.load(Ordering::Relaxed),
        sha256_ns: SHA256_NS.load(Ordering::Relaxed),
        db_lock_acquires: DB_LOCK_ACQUIRES.load(Ordering::Relaxed),
        db_lock_wait_ns: DB_LOCK_WAIT_NS.load(Ordering::Relaxed),
    }
}

pub fn print_snapshot(label: &str, snap: Snapshot) {
    eprintln!(
        "{label}: read_dir={} byte_compare_pairs={} byte_compare_mib={:.2} sha256_ms={:.2} db_locks={} db_lock_wait_ms={:.2}",
        snap.read_dir_calls,
        snap.byte_compare_pairs,
        snap.byte_compare_bytes as f64 / (1024.0 * 1024.0),
        snap.sha256_ns as f64 / 1_000_000.0,
        snap.db_lock_acquires,
        snap.db_lock_wait_ns as f64 / 1_000_000.0,
    );
}
