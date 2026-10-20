use std::time::Duration;

use tauri::{AppHandle, Emitter};

use super::places::logical_drive_mask;

const POLL_INTERVAL: Duration = Duration::from_secs(2);

/// Emits `drives-changed` when the Windows logical-drive bitmask changes (USB attach/eject).
#[cfg(windows)]
pub fn spawn_drive_monitor(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last = logical_drive_mask();
        loop {
            std::thread::sleep(POLL_INTERVAL);
            let current = logical_drive_mask();
            if current != last {
                last = current;
                let _ = app.emit("drives-changed", ());
            }
        }
    });
}

#[cfg(not(windows))]
pub fn spawn_drive_monitor(_app: AppHandle) {}
