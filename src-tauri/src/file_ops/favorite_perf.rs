//! Stage timings for favorite ADD (`STITCHVUE_FAV_PERF=1`). No user paths in logs.

use std::time::Instant;

pub fn enabled() -> bool {
    std::env::var_os("STITCHVUE_FAV_PERF").is_some_and(|v| v != "0" && v != "false")
}

pub struct FavoriteAddPerf {
    operation_id: String,
    file_count: usize,
    started: Instant,
    lock_done: Option<Instant>,
    journal_done: Option<Instant>,
    execute_done: Option<Instant>,
    links_done: Option<Instant>,
}

impl FavoriteAddPerf {
    pub fn begin(operation_id: &str, file_count: usize) -> Option<Self> {
        if !enabled() {
            return None;
        }
        Some(Self {
            operation_id: operation_id.to_string(),
            file_count,
            started: Instant::now(),
            lock_done: None,
            journal_done: None,
            execute_done: None,
            links_done: None,
        })
    }

    pub fn mark_lock_acquired(&mut self) {
        self.lock_done = Some(Instant::now());
    }

    pub fn mark_journal_done(&mut self) {
        self.journal_done = Some(Instant::now());
    }

    pub fn mark_execute_done(&mut self) {
        self.execute_done = Some(Instant::now());
    }

    pub fn mark_links_done(&mut self) {
        self.links_done = Some(Instant::now());
    }

    pub fn finish(self, reconcile_done: Instant, outcome: &str) {
        let ms = |from: Instant, to: Instant| -> u64 {
            to.duration_since(from).as_millis() as u64
        };
        let lock_ms = self
            .lock_done
            .map(|t| ms(self.started, t))
            .unwrap_or(0);
        let journal_ms = match (self.lock_done, self.journal_done) {
            (Some(a), Some(b)) => ms(a, b),
            _ => 0,
        };
        let execute_ms = match (self.journal_done, self.execute_done) {
            (Some(a), Some(b)) => ms(a, b),
            _ => 0,
        };
        let links_ms = match (self.execute_done, self.links_done) {
            (Some(a), Some(b)) => ms(a, b),
            _ => 0,
        };
        let reconcile_ms = self
            .links_done
            .or(self.execute_done)
            .map(|t| ms(t, reconcile_done))
            .unwrap_or(0);
        let total_ms = ms(self.started, reconcile_done);
        eprintln!(
            "[stitchvue:favorite-perf] rust operation_id={} file_count={} outcome={} lock_ms={} journal_ms={} copy_ms={} links_ms={} reconcile_ms={} total_ms={}",
            self.operation_id,
            self.file_count,
            outcome,
            lock_ms,
            journal_ms,
            execute_ms,
            links_ms,
            reconcile_ms,
            total_ms,
        );
        if std::env::var_os("STITCHVUE_FAV_METRICS").is_some_and(|v| v != "0" && v != "false") {
            let snap = super::fav_metrics::snapshot();
            super::fav_metrics::print_snapshot("  fav_metrics", snap);
        }
    }
}
