use std::sync::{Mutex, OnceLock};

use super::{
    abandon, any_file_operation_in_progress, begin_app_update_prepare, claim,
    end_app_update_prepare, Claim,
};

fn test_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn with_isolated_gate(body: impl FnOnce()) {
    let _guard = test_lock().lock().unwrap_or_else(|err| err.into_inner());
    end_app_update_prepare();
    body();
    end_app_update_prepare();
}

#[test]
fn prepare_blocks_new_claim() {
    with_isolated_gate(|| {
        begin_app_update_prepare().expect("prepare");
        assert!(matches!(claim("update-gate-block"), Claim::Busy));
        end_app_update_prepare();
        match claim("update-gate-block") {
            Claim::Start(_) => abandon("update-gate-block"),
            Claim::Busy | Claim::Replay(_) => panic!("expected Start after end prepare"),
        }
    });
}

#[test]
fn active_operation_blocks_prepare() {
    with_isolated_gate(|| {
        match claim("update-gate-active") {
            Claim::Start(_) => {}
            Claim::Busy | Claim::Replay(_) => panic!("expected Start"),
        }
        assert!(any_file_operation_in_progress());
        assert_eq!(
            begin_app_update_prepare().unwrap_err(),
            "file_operation_in_progress"
        );
        abandon("update-gate-active");
        begin_app_update_prepare().expect("prepare after abandon");
        end_app_update_prepare();
    });
}

#[test]
fn end_clears_prepare() {
    with_isolated_gate(|| {
        begin_app_update_prepare().expect("prepare");
        end_app_update_prepare();
        end_app_update_prepare();
        match claim("update-gate-clear") {
            Claim::Start(_) => abandon("update-gate-clear"),
            Claim::Busy | Claim::Replay(_) => panic!("expected Start"),
        }
    });
}
