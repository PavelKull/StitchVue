use std::sync::atomic::{AtomicU64, Ordering};

/// How much estimated bitmap traffic may overlap.
/// This is a concurrency budget, not a process RSS ceiling. A decoder can allocate
/// temporary copies the estimate does not see, and one image can be larger than the budget.
pub const HEAVY_LIMIT: u64 = 512 * 1024 * 1024;

static USED: AtomicU64 = AtomicU64::new(0);
static ESTIMATE_SUM: AtomicU64 = AtomicU64::new(0);
static PEAK_ESTIMATE: AtomicU64 = AtomicU64::new(0);

/// Guessed peak for one heavy bitmap plus the extra copy `encode_viewer` keeps.
/// 8 bytes/pixel covers a 16-bit buffer; the second factor covers that copy.
/// `rawler` can still allocate more inside `develop_intermediate`.
pub fn bitmap_estimate(pixels: u64) -> u64 {
    pixels.saturating_mul(16).max(1)
}

pub fn peak_estimate_bytes() -> u64 {
    PEAK_ESTIMATE.load(Ordering::Relaxed)
}

pub struct Hold {
    accounted: u64,
    estimate: u64,
}

impl Hold {
    /// Reserve overlap room for `estimate` bytes.
    /// An estimate above [`HEAVY_LIMIT`] takes the whole budget, and only when it is idle,
    /// so a second heavy decode waits or skips. The accounted bytes are the concurrency token.
    pub fn reserve(estimate: u64) -> Option<Self> {
        let estimate = estimate.max(1);
        let exclusive = estimate > HEAVY_LIMIT;
        let accounted = if exclusive { HEAVY_LIMIT } else { estimate };
        let mut used = USED.load(Ordering::Relaxed);
        loop {
            if exclusive {
                if used != 0 {
                    return None;
                }
            } else if used.saturating_add(accounted) > HEAVY_LIMIT {
                return None;
            }
            let next = used.saturating_add(accounted);
            match USED.compare_exchange_weak(used, next, Ordering::AcqRel, Ordering::Relaxed) {
                Ok(_) => {
                    let sum = ESTIMATE_SUM
                        .fetch_add(estimate, Ordering::AcqRel)
                        .saturating_add(estimate);
                    let mut peak = PEAK_ESTIMATE.load(Ordering::Relaxed);
                    while sum > peak {
                        match PEAK_ESTIMATE.compare_exchange_weak(
                            peak,
                            sum,
                            Ordering::AcqRel,
                            Ordering::Relaxed,
                        ) {
                            Ok(_) => break,
                            Err(current) => peak = current,
                        }
                    }
                    return Some(Self {
                        accounted,
                        estimate,
                    });
                }
                Err(current) => used = current,
            }
        }
    }
}

impl Drop for Hold {
    fn drop(&mut self) {
        USED.fetch_sub(self.accounted, Ordering::AcqRel);
        ESTIMATE_SUM.fetch_sub(self.estimate, Ordering::AcqRel);
    }
}

#[cfg(test)]
mod tests {
    use super::{Hold, HEAVY_LIMIT};

    #[test]
    fn heavy_reservation_is_a_concurrency_budget_not_a_ram_ceiling() {
        {
            let _first = Hold::reserve(HEAVY_LIMIT).expect("one heavy decode fits");
            assert!(Hold::reserve(1024 * 1024).is_none());
        }
        {
            let _big = Hold::reserve(HEAVY_LIMIT + 1).expect("a larger estimate still runs alone");
            assert!(Hold::reserve(1024).is_none());
            assert!(super::peak_estimate_bytes() >= HEAVY_LIMIT + 1);
        }
        assert!(Hold::reserve(1024).is_some());
    }
}
