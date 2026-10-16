//! Windows-only prototype: animate top-level window geometry with Win32 `SetWindowPos`.
//! Does **not** replace `setFullscreen`. Invoked only via experimental Tauri commands.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, WebviewWindow};

const DEFAULT_DURATION_MS: u32 = 250;
const MIN_DURATION_MS: u32 = 120;
const MAX_DURATION_MS: u32 = 600;
/// Target ~120 Hz samples during the tween.
const FRAME_GAP: Duration = Duration::from_millis(8);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PrototypeFillMode {
    /// Monitor work area (taskbar stays visible).
    WorkArea,
    /// Full monitor rectangle (may sit under/over the taskbar; not true fullscreen).
    Monitor,
    /// Full monitor + temporary borderless chrome (decorations restored on collapse).
    BorderlessMonitor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrototypeAnimRequest {
    pub expand: bool,
    pub mode: PrototypeFillMode,
    pub duration_ms: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrototypeAnimReport {
    pub ok: bool,
    pub expand: bool,
    pub mode: PrototypeFillMode,
    pub duration_ms: u32,
    pub frame_count: u32,
    pub max_gap_ms: f64,
    pub mean_gap_ms: f64,
    pub dpi: u32,
    pub from: RectDto,
    pub to: RectDto,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RectDto {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone)]
struct SavedGeom {
    rect: RectDto,
    #[allow(dead_code)]
    mode: PrototypeFillMode,
    removed_decorations: bool,
}

pub struct WindowAnimState {
    saved: Mutex<Option<SavedGeom>>,
    busy: AtomicBool,
}

impl Default for WindowAnimState {
    fn default() -> Self {
        Self {
            saved: Mutex::new(None),
            busy: AtomicBool::new(false),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SampleEvent {
    t: f64,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

pub fn ease_out_cubic(t: f64) -> f64 {
    let t = t.clamp(0.0, 1.0);
    let u = 1.0 - t;
    1.0 - u * u * u
}

pub fn lerp_i32(a: i32, b: i32, t: f64) -> i32 {
    let v = f64::from(a) + (f64::from(b) - f64::from(a)) * t;
    v.round() as i32
}

pub fn lerp_rect(from: RectDto, to: RectDto, t: f64) -> RectDto {
    let e = ease_out_cubic(t);
    RectDto {
        x: lerp_i32(from.x, to.x, e),
        y: lerp_i32(from.y, to.y, e),
        width: lerp_i32(from.width, to.width, e).max(1),
        height: lerp_i32(from.height, to.height, e).max(1),
    }
}

fn clamp_duration(ms: Option<u32>) -> u32 {
    ms.unwrap_or(DEFAULT_DURATION_MS)
        .clamp(MIN_DURATION_MS, MAX_DURATION_MS)
}

#[cfg(windows)]
mod win {
    use super::*;
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongW, GetWindowRect, IsZoomed, SetWindowPos, GWL_STYLE, SWP_NOACTIVATE,
        SWP_NOZORDER, WS_CAPTION,
    };

    pub fn hwnd_of(window: &WebviewWindow) -> Result<HWND, String> {
        window.hwnd().map_err(|err| format!("hwnd: {err}"))
    }

    pub fn read_rect(hwnd: HWND) -> Result<RectDto, String> {
        let mut rect = RECT::default();
        unsafe {
            GetWindowRect(hwnd, &mut rect).map_err(|err| format!("GetWindowRect: {err}"))?;
        }
        Ok(RectDto {
            x: rect.left,
            y: rect.top,
            width: (rect.right - rect.left).max(1),
            height: (rect.bottom - rect.top).max(1),
        })
    }

    pub fn dpi_of(hwnd: HWND) -> u32 {
        unsafe { GetDpiForWindow(hwnd) }
    }

    pub fn is_maximized(hwnd: HWND) -> bool {
        unsafe { IsZoomed(hwnd).as_bool() }
    }

    pub fn has_caption(hwnd: HWND) -> bool {
        let style = unsafe { GetWindowLongW(hwnd, GWL_STYLE) } as u32;
        style & WS_CAPTION.0 != 0
    }

    pub fn monitor_rects(hwnd: HWND) -> Result<(RectDto, RectDto), String> {
        let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let ok = unsafe { GetMonitorInfoW(monitor, &mut info) };
        if !ok.as_bool() {
            return Err("GetMonitorInfoW failed".into());
        }
        let monitor_rect = RectDto {
            x: info.rcMonitor.left,
            y: info.rcMonitor.top,
            width: (info.rcMonitor.right - info.rcMonitor.left).max(1),
            height: (info.rcMonitor.bottom - info.rcMonitor.top).max(1),
        };
        let work = RectDto {
            x: info.rcWork.left,
            y: info.rcWork.top,
            width: (info.rcWork.right - info.rcWork.left).max(1),
            height: (info.rcWork.bottom - info.rcWork.top).max(1),
        };
        Ok((monitor_rect, work))
    }

    pub fn apply_rect(hwnd: HWND, rect: RectDto) -> Result<(), String> {
        unsafe {
            SetWindowPos(
                hwnd,
                None,
                rect.x,
                rect.y,
                rect.width,
                rect.height,
                SWP_NOZORDER | SWP_NOACTIVATE,
            )
            .map_err(|err| format!("SetWindowPos: {err}"))
        }
    }

    pub fn animate(
        app: &AppHandle,
        hwnd: HWND,
        from: RectDto,
        to: RectDto,
        duration_ms: u32,
    ) -> Result<(u32, f64, f64), String> {
        let duration = Duration::from_millis(u64::from(duration_ms));
        let started = Instant::now();
        let mut frame_count = 0u32;
        let mut max_gap_ms = 0.0f64;
        let mut gap_sum = 0.0f64;
        let mut last = started;

        loop {
            let elapsed = started.elapsed();
            let t = if duration.is_zero() {
                1.0
            } else {
                (elapsed.as_secs_f64() / duration.as_secs_f64()).min(1.0)
            };
            let rect = lerp_rect(from, to, t);
            apply_rect(hwnd, rect)?;
            frame_count += 1;

            let now = Instant::now();
            let gap = now.duration_since(last).as_secs_f64() * 1000.0;
            max_gap_ms = max_gap_ms.max(gap);
            gap_sum += gap;
            last = now;

            let _ = app.emit(
                "window-anim-sample",
                SampleEvent {
                    t,
                    x: rect.x,
                    y: rect.y,
                    width: rect.width,
                    height: rect.height,
                },
            );

            if t >= 1.0 {
                break;
            }
            std::thread::sleep(FRAME_GAP);
        }

        apply_rect(hwnd, to)?;
        let mean = if frame_count > 0 {
            gap_sum / f64::from(frame_count)
        } else {
            0.0
        };
        Ok((frame_count, max_gap_ms, mean))
    }
}

#[cfg(windows)]
pub async fn run_prototype(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, WindowAnimState>,
    request: PrototypeAnimRequest,
) -> Result<PrototypeAnimReport, String> {
    if state
        .busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("window animation already running".into());
    }

    let result = run_prototype_inner(app, window, &state, request).await;
    state.busy.store(false, Ordering::SeqCst);
    result
}

#[cfg(windows)]
async fn run_prototype_inner(
    app: AppHandle,
    window: WebviewWindow,
    state: &WindowAnimState,
    request: PrototypeAnimRequest,
) -> Result<PrototypeAnimReport, String> {
    let duration_ms = clamp_duration(request.duration_ms);
    let hwnd = win::hwnd_of(&window)?;
    let mut notes = Vec::new();

    if win::is_maximized(hwnd) {
        notes.push("window was maximized; restore before animating".into());
        window
            .unmaximize()
            .map_err(|err| format!("unmaximize: {err}"))?;
        // Let DWM apply restore before reading the rect.
        std::thread::sleep(Duration::from_millis(32));
    }

    let from = win::read_rect(hwnd)?;
    let dpi = win::dpi_of(hwnd);
    let (monitor, work) = win::monitor_rects(hwnd)?;

    let (to, removed_decorations) = if request.expand {
        let target = match request.mode {
            PrototypeFillMode::WorkArea => work,
            PrototypeFillMode::Monitor | PrototypeFillMode::BorderlessMonitor => monitor,
        };
        let mut removed = false;
        if request.mode == PrototypeFillMode::BorderlessMonitor && win::has_caption(hwnd) {
            window
                .set_decorations(false)
                .map_err(|err| format!("set_decorations(false): {err}"))?;
            removed = true;
            notes.push("decorations removed for borderlessMonitor".into());
            std::thread::sleep(Duration::from_millis(16));
        }
        {
            let mut guard = state.saved.lock().map_err(|_| "anim state lock")?;
            *guard = Some(SavedGeom {
                rect: from,
                mode: request.mode,
                removed_decorations: removed,
            });
        }
        if request.mode == PrototypeFillMode::Monitor {
            notes.push(
                "monitor fill is not OS fullscreen; taskbar z-order may stay above the window"
                    .into(),
            );
        }
        (target, removed)
    } else {
        let saved = {
            let mut guard = state.saved.lock().map_err(|_| "anim state lock")?;
            guard.take()
        };
        let Some(saved) = saved else {
            return Err("no saved window geometry; expand first".into());
        };
        if saved.removed_decorations {
            notes.push("decorations will be restored after geometry tween".into());
        }
        (saved.rect, saved.removed_decorations)
    };

    let from_live = win::read_rect(hwnd)?;
    let app_clone = app.clone();
    // HWND is !Send; pass the raw value and rebuild on the worker thread.
    let hwnd_raw = hwnd.0 as isize;
    let (frame_count, max_gap_ms, mean_gap_ms) = tauri::async_runtime::spawn_blocking(move || {
        let hwnd = windows::Win32::Foundation::HWND(hwnd_raw as *mut std::ffi::c_void);
        win::animate(&app_clone, hwnd, from_live, to, duration_ms)
    })
    .await
    .map_err(|err| format!("anim task: {err}"))??;

    if !request.expand && removed_decorations {
        window
            .set_decorations(true)
            .map_err(|err| format!("set_decorations(true): {err}"))?;
        notes.push("decorations restored".into());
    }

    let report = PrototypeAnimReport {
        ok: true,
        expand: request.expand,
        mode: request.mode,
        duration_ms,
        frame_count,
        max_gap_ms,
        mean_gap_ms,
        dpi,
        from: from_live,
        to,
        notes,
    };
    let _ = app.emit("window-anim-done", &report);
    Ok(report)
}

#[cfg(not(windows))]
pub async fn run_prototype(
    _app: AppHandle,
    _window: WebviewWindow,
    _state: tauri::State<'_, WindowAnimState>,
    _request: PrototypeAnimRequest,
) -> Result<PrototypeAnimReport, String> {
    Err("prototype_window_anim is Windows-only".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ease_out_starts_fast_ends_slow() {
        let a = ease_out_cubic(0.25);
        let b = ease_out_cubic(0.75);
        assert!(a > 0.25);
        assert!(b > 0.75);
        assert!((ease_out_cubic(0.0) - 0.0).abs() < 1e-9);
        assert!((ease_out_cubic(1.0) - 1.0).abs() < 1e-9);
    }

    #[test]
    fn lerp_rect_reaches_endpoints() {
        let from = RectDto {
            x: 100,
            y: 100,
            width: 800,
            height: 600,
        };
        let to = RectDto {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let start = lerp_rect(from, to, 0.0);
        let end = lerp_rect(from, to, 1.0);
        assert_eq!(start.width, 800);
        assert_eq!(end.width, 1920);
        assert_eq!(end.height, 1080);
    }
}
