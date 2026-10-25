mod hover;
mod viewer;

use std::collections::{HashMap, HashSet};
use std::panic::AssertUnwindSafe;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::cache;
use crate::formats;
use crate::metadata::{self, HeaderMeta};
use crate::storage::{self, StorageProfile};
use crate::thumbnail::{self, DecodeError, FailureKind};

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceFile {
    pub path: String,
    pub size: u64,
    pub modified_at: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MetaEvent {
    session: u64,
    path: String,
    width: u32,
    height: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThumbEvent {
    session: u64,
    path: String,
    tier: u32,
    thumbnail_path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderChanged {
    folder: String,
    session: u64,
}

pub use viewer::ViewerOffer;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerSource {
    pub kind: String,
    pub path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineStats {
    pub pass: String,
    pub ready: u32,
    pub pending: u32,
    pub failed: u32,
    pub cache_hits: u64,
    pub cache_misses: u64,
    pub reads_in_use: u32,
    pub decodes_in_use: u32,
    pub cancelled: u64,
    pub cache_bytes: i64,
    pub background_per_sec: f32,
    pub cache_capped: bool,
    pub raw_develop_ms: u64,
    pub viewer_cache_hits: u64,
    pub decode_peak_mb: u64,
    pub stale_tasks: u64,
    pub scheduler_mode: String,
    pub pending_p1: u32,
    pub pending_p4: u32,
    pub pending_p5: u32,
    pub background_completed: u64,
    pub background_yields: u64,
    pub viewport_base_ready: bool,
    pub viewport_quality_ready: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FailEvent {
    session: u64,
    path: String,
    reason: String,
}

struct Item {
    path: String,
    size: u64,
    modified_at: i64,
    busy: bool,
    failed: bool,
    header_done: bool,
    cache_checked: bool,
    preview_only: bool,
    bitmap_held: bool,
    ready: [bool; 3],
    deferred_heavy: bool,
    cache_blocked: bool,
    inflight_priority: u8,
}

fn new_item(path: String, size: u64, modified_at: i64) -> Item {
    Item {
        path,
        size,
        modified_at,
        busy: false,
        failed: false,
        header_done: false,
        cache_checked: false,
        preview_only: false,
        bitmap_held: false,
        ready: [false; 3],
        deferred_heavy: false,
        cache_blocked: false,
        inflight_priority: 0,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Pass {
    Idle,
    Running,
    Paused,
    Completed,
    Cancelled,
}

impl Pass {
    fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Running => "running",
            Self::Paused => "paused",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
        }
    }
}

/// Adaptive pick order for non-critical work. Priority numbers P0–P5 stay fixed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LoadMode {
    Idle,
    Scrolling,
    FastScrolling,
}

impl LoadMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Scrolling => "scrolling",
            Self::FastScrolling => "fastScrolling",
        }
    }

    fn parse(mode: &str) -> Self {
        match mode {
            "fastScrolling" | "fast" => Self::FastScrolling,
            "scrolling" => Self::Scrolling,
            _ => Self::Idle,
        }
    }
}

/// After this many P2/P3/P4 picks, allow one P5 so quality/prefetch cannot starve the folder fill.
const FAIR_SHARE_EVERY: u8 = 7;

struct Board {
    generation: u64,
    session: u64,
    folder: String,
    items: Vec<Item>,
    visible_start: usize,
    visible_end: usize,
    focus_start: usize,
    focus_end: usize,
    viewport_gen: u64,
    requested_tier: u32,
    background_index: usize,
    background_inflight: usize,
    pass: Pass,
    cache_capped: bool,
    viewer_gen: u64,
    viewer_fast: bool,
    viewer_dir: i8,
    cache_hits: u64,
    cache_misses: u64,
    cancelled: u64,
    base_ready: u32,
    rate_ready: u32,
    rate_at: Instant,
    background_per_sec: f32,
    meta_done: bool,
    scrolling: bool,
    load_mode: LoadMode,
    noncritical_since_background: u8,
    background_completed: u64,
    background_yields: u64,
    profile_override: Option<StorageProfile>,
    read_slots: usize,
    reads_in_use: usize,
    heavy_in_use: usize,
    viewer_wants_read: bool,
    viewer_index: Option<usize>,
    viewer_ahead: u32,
    scroll_ahead: i8,
    priming: bool,
    geometry_start: usize,
    geometry_end: usize,
}

struct Inner {
    app: AppHandle,
    db: Mutex<Connection>,
    board: Mutex<Board>,
    wake: Condvar,
    read_wake: Condvar,
    heavy_wake: Condvar,
    write: Mutex<()>,
    held: Mutex<HashMap<(u64, usize), HeldBitmap>>,
    watcher: Mutex<Option<RecommendedWatcher>>,
    viewer: Mutex<viewer::Slot>,
    viewer_wake: Condvar,
    develop_mail: Mutex<Option<viewer::DevelopRequest>>,
    develop_wake: Condvar,
    hover: Mutex<hover::HoverControl>,
    hover_wake: Condvar,
    decoding: Mutex<HashSet<String>>,
    viewer_cache_hits: AtomicU64,
    stale_tasks: AtomicU64,
    raw_develop_ms: AtomicU64,
}

#[derive(Clone)]
pub struct Pipeline {
    inner: Arc<Inner>,
}

fn resolve_trash_origin(db: &Connection, path: &str) -> Result<String, String> {
    if let Some(origin) = crate::database::trash_origin(db, path)? {
        return Ok(origin);
    }
    let file = Path::new(path);
    let parent = file.parent().ok_or_else(|| "origin_unknown".to_string())?;
    if crate::file_ops::read_service_role(parent) != Some(crate::file_ops::ServiceRole::Trash) {
        return Err("origin_unknown".to_string());
    }
    let rows = crate::database::trash_rows(db)?;
    let candidates: Vec<crate::file_ops::TrashCandidate> = rows
        .into_iter()
        .map(|row| crate::file_ops::TrashCandidate {
            trash_path: row.trash_path,
            origin_path: row.origin_path,
            source_size: row.source_size,
        })
        .collect();
    let Some(matched) = crate::file_ops::match_renamed_trash(parent, file, &candidates) else {
        if let Some(origin) = crate::database::origin_from_log(db, path)? {
            return Ok(origin);
        }
        return Err("origin_unknown".to_string());
    };
    crate::database::update_trash_path(db, &matched.trash_path, path)?;
    Ok(matched.origin_path)
}

fn stamp_service_markers(_db: &Connection) -> Result<(), String> {
    Ok(())
}

fn path_stamp(path: &Path) -> (Option<u64>, Option<i64>, Option<String>) {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string());
    let meta = std::fs::metadata(path).ok();
    let size = meta.as_ref().map(|item| item.len());
    let modified = meta
        .and_then(|item| item.modified().ok())
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64);
    (size, modified, name)
}

fn alias_favorite_copy_thumbnails(db: &Connection, origin_path: &str, copy_path: &str) {
    let (origin_size, origin_modified, _) = path_stamp(Path::new(origin_path));
    let (copy_size, copy_modified, _) = path_stamp(Path::new(copy_path));
    let (Some(origin_size), Some(origin_modified), Some(copy_size), Some(copy_modified)) =
        (origin_size, origin_modified, copy_size, copy_modified)
    else {
        return;
    };
    let _ = crate::cache::alias_thumbnails_from_origin(
        db,
        origin_path,
        origin_size,
        origin_modified,
        copy_path,
        copy_size,
        copy_modified,
    );
}

fn record_favorite_link(
    db: &Connection,
    origin_path: &str,
    copy_path: &str,
    source_content_sha256: Option<&str>,
) -> Result<(), String> {
    let origin = Path::new(origin_path);
    let copy = Path::new(copy_path);
    let origin_meta = std::fs::metadata(origin).map_err(|err| format!("origin meta: {err}"))?;
    let copy_meta = std::fs::metadata(copy).map_err(|err| format!("copy meta: {err}"))?;
    let origin_modified = origin_meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);
    let copy_modified = copy_meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);
    let hash = match source_content_sha256 {
        Some(value) if !value.is_empty() => value.to_string(),
        _ => crate::file_ops::sha256_file(origin)?,
    };
    crate::database::record_favorite_copy(
        db,
        origin_path,
        origin_meta.len(),
        origin_modified,
        copy_path,
        copy_meta.len(),
        copy_modified,
        Some(&hash),
    )
}

fn new_file_op_id(prefix: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{prefix}-{nanos}-{}", std::process::id())
}

impl Pipeline {
    pub fn start(app: AppHandle, db: Connection) -> Self {
        let _ = stamp_service_markers(&db);
        crate::file_ops::reconcile::reconcile_on_boot(&db);
        let stored = crate::database::setting(&db, "storage_profile")
            .ok()
            .flatten();
        let profile_override = match stored.as_deref() {
            Some("hdd") => Some(StorageProfile::Hdd),
            Some("ssd") => Some(StorageProfile::Ssd),
            _ => None,
        };
        let threads = std::thread::available_parallelism()
            .map(|value| value.get().saturating_sub(2).max(1))
            .unwrap_or(2);
        let _ = rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .build_global();
        let inner = Arc::new(Inner {
            app,
            db: Mutex::new(db),
            board: Mutex::new(Board {
                generation: 0,
                session: 0,
                folder: String::new(),
                items: Vec::new(),
                visible_start: 0,
                visible_end: 0,
                focus_start: 0,
                focus_end: 0,
                viewport_gen: 0,
                requested_tier: 512,
                background_index: 0,
                background_inflight: 0,
                pass: Pass::Idle,
                cache_capped: false,
                viewer_gen: 0,
                viewer_fast: false,
                viewer_dir: 1,
                cache_hits: 0,
                cache_misses: 0,
                cancelled: 0,
                base_ready: 0,
                rate_ready: 0,
                rate_at: Instant::now(),
                background_per_sec: 0.0,
                meta_done: false,
                scrolling: false,
                load_mode: LoadMode::Idle,
                noncritical_since_background: 0,
                background_completed: 0,
                background_yields: 0,
                profile_override,
                read_slots: 1,
                reads_in_use: 0,
                heavy_in_use: 0,
                viewer_wants_read: false,
                viewer_index: None,
                viewer_ahead: 5,
                scroll_ahead: 0,
                priming: false,
                geometry_start: 0,
                geometry_end: 0,
            }),
            wake: Condvar::new(),
            read_wake: Condvar::new(),
            heavy_wake: Condvar::new(),
            write: Mutex::new(()),
            held: Mutex::new(HashMap::new()),
            watcher: Mutex::new(None),
            viewer: Mutex::new(viewer::Slot::default()),
            viewer_wake: Condvar::new(),
            develop_mail: Mutex::new(None),
            develop_wake: Condvar::new(),
            hover: Mutex::new(hover::HoverControl::default()),
            hover_wake: Condvar::new(),
            decoding: Mutex::new(HashSet::new()),
            viewer_cache_hits: AtomicU64::new(0),
            stale_tasks: AtomicU64::new(0),
            raw_develop_ms: AtomicU64::new(0),
        });
        for _ in 0..4 {
            let inner = Arc::clone(&inner);
            thread::spawn(move || worker(inner));
        }
        let viewer_inner = Arc::clone(&inner);
        thread::spawn(move || viewer::run(viewer_inner));
        let hover_inner = Arc::clone(&inner);
        thread::spawn(move || hover::run(hover_inner));
        let idle = Arc::clone(&inner);
        thread::spawn(move || idle_loop(idle));
        Self { inner }
    }

    pub fn session(&self) -> u64 {
        self.inner
            .board
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .session
    }

    pub fn begin_session(&self, session: u64, folder: Option<String>) {
        {
            let board = self
                .inner
                .board
                .lock()
                .unwrap_or_else(|err| err.into_inner());
            if session <= board.session {
                return;
            }
        }
        hover::cancel(&self.inner);
        viewer::cancel_hover(&self.inner);
        {
            let mut board = self
                .inner
                .board
                .lock()
                .unwrap_or_else(|err| err.into_inner());
            if session <= board.session {
                return;
            }
            board.pass = Pass::Cancelled;
            board.generation = board.generation.wrapping_add(1);
            board.session = session;
            board.folder = folder.clone().unwrap_or_default();
            board.items.clear();
            board.visible_start = 0;
            board.visible_end = 0;
            board.focus_start = 0;
            board.focus_end = 0;
            board.background_index = 0;
            board.background_inflight = 0;
            board.pass = Pass::Idle;
            board.cache_capped = false;
            board.viewer_gen = board.viewer_gen.wrapping_add(1);
            board.viewer_fast = false;
            board.viewer_dir = 1;
            board.cache_hits = 0;
            board.cache_misses = 0;
            board.cancelled = 0;
            board.base_ready = 0;
            board.rate_ready = 0;
            board.rate_at = Instant::now();
            board.background_per_sec = 0.0;
            board.viewport_gen = board.viewport_gen.wrapping_add(1);
            board.meta_done = true;
            board.viewer_index = None;
            board.priming = false;
            board.geometry_start = 0;
            board.geometry_end = 0;
            board.load_mode = LoadMode::Idle;
            board.scrolling = false;
            board.scroll_ahead = 0;
            board.noncritical_since_background = 0;
            board.background_completed = 0;
            board.background_yields = 0;
            board.read_slots = read_slots_for(&board.folder, board.profile_override);
        }
        self.inner
            .held
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .clear();
        match folder {
            Some(path) if !path.is_empty() => {
                self.watch_folder(&path, session);
                let _ = self
                    .inner
                    .app
                    .asset_protocol_scope()
                    .allow_directory(&path, false);
            }
            _ => {
                *self
                    .inner
                    .watcher
                    .lock()
                    .unwrap_or_else(|err| err.into_inner()) = None;
            }
        }
        self.nudge();
    }

    pub fn index(&self, folder: String, files: Vec<SourceFile>, session: u64) {
        {
            let board = self
                .inner
                .board
                .lock()
                .unwrap_or_else(|err| err.into_inner());
            if session < board.session {
                return;
            }
        }
        hover::cancel(&self.inner);
        viewer::cancel_hover(&self.inner);
        let profile_override = self
            .inner
            .board
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .profile_override;
        let (generation, geometry_end) = {
            let mut board = self
                .inner
                .board
                .lock()
                .unwrap_or_else(|err| err.into_inner());
            if session < board.session {
                return;
            }
            board.pass = Pass::Cancelled;
            board.generation += 1;
            board.session = session;
            board.folder = folder.clone();
            board.items = files
                .into_iter()
                .map(|file| new_item(file.path, file.size, file.modified_at))
                .collect();
            board.visible_start = 0;
            board.visible_end = board.items.len().min(32);
            board.focus_start = 0;
            board.focus_end = board.items.len().min(8);
            board.background_index = board.visible_end;
            board.background_inflight = 0;
            board.pass = if board.items.is_empty() {
                Pass::Idle
            } else {
                Pass::Running
            };
            board.cache_capped = false;
            board.viewer_gen = board.viewer_gen.wrapping_add(1);
            board.viewer_fast = false;
            board.viewer_dir = 1;
            board.cache_hits = 0;
            board.cache_misses = 0;
            board.cancelled = 0;
            board.base_ready = 0;
            board.rate_ready = 0;
            board.rate_at = Instant::now();
            board.background_per_sec = 0.0;
            board.viewport_gen = board.viewport_gen.wrapping_add(1);
            board.meta_done = false;
            board.read_slots = read_slots_for(&folder, profile_override);
            board.viewer_index = None;
            board.priming = true;
            board.geometry_start = 0;
            board.geometry_end = board.items.len().min(GEOMETRY_FALLBACK);
            board.load_mode = LoadMode::Idle;
            board.scrolling = false;
            board.scroll_ahead = 0;
            board.noncritical_since_background = 0;
            board.background_completed = 0;
            board.background_yields = 0;
            (board.generation, board.geometry_end)
        };
        self.inner
            .held
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .clear();
        prime_cache(&self.inner, generation, 0, geometry_end);
        {
            let mut board = self
                .inner
                .board
                .lock()
                .unwrap_or_else(|err| err.into_inner());
            if board.generation == generation {
                board.priming = false;
            }
        }
        self.nudge();
        self.watch_folder(&folder, session);
        let _ = self
            .inner
            .app
            .asset_protocol_scope()
            .allow_directory(&folder, false);
        let inner = Arc::clone(&self.inner);
        thread::spawn(move || metadata_pass(inner, generation));
    }

    pub fn set_visible(
        &self,
        start: usize,
        end: usize,
        focus_start: usize,
        focus_end: usize,
        tier: u32,
    ) {
        let mut board = self
            .inner
            .board
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let len = board.items.len();
        let next_start = start.min(len);
        let next_end = end.min(len).max(next_start);
        let next_focus_start = focus_start.min(len);
        let next_focus_end = focus_end.min(len).max(next_focus_start);
        if next_start != board.visible_start
            || next_end != board.visible_end
            || next_focus_start != board.focus_start
            || next_focus_end != board.focus_end
        {
            board.viewport_gen = board.viewport_gen.wrapping_add(1);
        }
        board.visible_start = next_start;
        board.visible_end = next_end;
        board.focus_start = next_focus_start;
        board.focus_end = next_focus_end;
        if board.focus_start == board.focus_end {
            board.focus_start = board.visible_start;
            board.focus_end = board.visible_end;
        }
        board.requested_tier = if tier >= 1024 {
            1024
        } else if tier >= 512 {
            512
        } else {
            256
        };
        let generation = board.generation;
        let (keep_from, keep_to) = nearby_window(&board);
        drop(board);
        self.inner
            .held
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .retain(|&(gen, index), _| gen == generation && index >= keep_from && index < keep_to);
        prime_cache(&self.inner, generation, keep_from, keep_to);
        self.nudge();
    }

    pub fn set_geometry(&self, start: usize, end: usize) {
        let mut board = self
            .inner
            .board
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let (next_start, next_end) = clamp_index_range(start, end, board.items.len());
        if next_start == board.geometry_start && next_end == board.geometry_end {
            return;
        }
        board.geometry_start = next_start;
        board.geometry_end = next_end;
        let generation = board.generation;
        drop(board);
        prime_cache(&self.inner, generation, next_start, next_end);
        self.nudge();
    }

    pub fn set_scrolling(&self, mode: &str, ahead: i32) {
        let load_mode = LoadMode::parse(mode);
        let mut board = self
            .inner
            .board
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        board.load_mode = load_mode;
        board.scrolling = load_mode != LoadMode::Idle;
        board.scroll_ahead = if board.scrolling {
            ahead.clamp(-1, 1) as i8
        } else {
            0
        };
        drop(board);
        self.nudge();
    }

    /// Keeps decode state and retargets the queue when the gallery sort changes.
    pub fn order(&self, files: Vec<SourceFile>) {
        let (generation, restart_meta, geometry_end) = {
            let mut board = self
                .inner
                .board
                .lock()
                .unwrap_or_else(|err| err.into_inner());
            if board.items.len() == files.len()
                && board
                    .items
                    .iter()
                    .zip(&files)
                    .all(|(item, file)| item.path == file.path)
            {
                return;
            }
            let viewer_path = board
                .viewer_index
                .and_then(|index| board.items.get(index).map(|item| item.path.clone()));
            let old = std::mem::take(&mut board.items)
                .into_iter()
                .map(|item| (item.path.clone(), item))
                .collect::<HashMap<_, _>>();
            board.generation = board.generation.wrapping_add(1);
            board.items = files
                .into_iter()
                .map(|file| match old.get(&file.path) {
                    Some(item) => {
                        let mut kept = Item {
                            path: item.path.clone(),
                            size: item.size,
                            modified_at: item.modified_at,
                            busy: false,
                            failed: item.failed,
                            header_done: item.header_done,
                            cache_checked: item.cache_checked,
                            preview_only: item.preview_only,
                            bitmap_held: false,
                            ready: item.ready,
                            deferred_heavy: item.deferred_heavy,
                            cache_blocked: item.cache_blocked,
                            inflight_priority: 0,
                        };
                        if kept.size != file.size || kept.modified_at != file.modified_at {
                            kept.size = file.size;
                            kept.modified_at = file.modified_at;
                            kept.failed = false;
                            kept.header_done = false;
                            kept.cache_checked = false;
                            kept.preview_only = false;
                            kept.ready = [false; 3];
                            kept.deferred_heavy = false;
                            kept.cache_blocked = false;
                        }
                        kept
                    }
                    None => new_item(file.path, file.size, file.modified_at),
                })
                .collect();
            board.viewer_index =
                viewer_path.and_then(|path| board.items.iter().position(|item| item.path == path));
            board.visible_start = 0;
            board.visible_end = board.items.len().min(32);
            board.focus_start = 0;
            board.focus_end = board.items.len().min(8);
            board.background_index = board.visible_end;
            board.background_inflight = 0;
            board.geometry_start = 0;
            board.geometry_end = board.items.len().min(GEOMETRY_FALLBACK);
            board.cache_capped = false;
            board.pass = if board
                .items
                .iter()
                .any(|item| !item.failed && !item.ready[0] && !item.cache_blocked)
            {
                Pass::Running
            } else {
                Pass::Completed
            };
            board.viewport_gen = board.viewport_gen.wrapping_add(1);
            board.viewer_gen = board.viewer_gen.wrapping_add(1);
            let restart_meta = board.items.iter().any(|item| !item.header_done);
            board.meta_done = !restart_meta;
            (board.generation, restart_meta, board.geometry_end)
        };
        self.inner
            .held
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .clear();
        prime_cache(&self.inner, generation, 0, geometry_end);
        self.nudge();
        if restart_meta {
            let inner = Arc::clone(&self.inner);
            thread::spawn(move || metadata_pass(inner, generation));
        }
    }

    pub fn set_viewer(&self, path: Option<String>, ahead: u32, fast: bool, direction: i32) {
        let mut board = self
            .inner
            .board
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        board.viewer_ahead = ahead.clamp(1, 15);
        let next_index =
            path.and_then(|path| board.items.iter().position(|item| item.path == path));
        if next_index != board.viewer_index {
            board.viewer_gen = board.viewer_gen.wrapping_add(1);
        }
        if direction != 0 {
            let next_dir = direction.clamp(-1, 1) as i8;
            if board.viewer_dir != next_dir {
                board.viewer_gen = board.viewer_gen.wrapping_add(1);
                board.viewer_dir = next_dir;
            }
        }
        board.viewer_fast = fast;
        board.viewer_index = next_index;
        drop(board);
        self.nudge();
    }

    pub fn stats(&self) -> PipelineStats {
        let board = self
            .inner
            .board
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        let ready = board.items.iter().filter(|item| item.ready[0]).count() as u32;
        let failed = board.items.iter().filter(|item| item.failed).count() as u32;
        let pending = board
            .items
            .iter()
            .filter(|item| !item.failed && !item.ready[0] && !item.cache_blocked)
            .count() as u32;
        let decodes_in_use = board.items.iter().filter(|item| item.busy).count() as u32;
        let cache_bytes = {
            let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
            cache::usage(&db).map(|usage| usage.used_bytes).unwrap_or(0)
        };
        let pending_p1 = visible_range(&board)
            .filter(|&index| cache_pending(&board, index) || needs_256(&board, index))
            .count() as u32;
        let pending_p4 = visible_range(&board)
            .filter(|&index| needs_upgrade(&board, index))
            .count() as u32;
        let pending_p5 = board
            .items
            .iter()
            .enumerate()
            .filter(|(index, _)| cache_pending(&board, *index) || needs_base(&board, *index))
            .count() as u32;
        PipelineStats {
            pass: board.pass.as_str().to_string(),
            ready,
            pending,
            failed,
            cache_hits: board.cache_hits,
            cache_misses: board.cache_misses,
            reads_in_use: board.reads_in_use as u32,
            decodes_in_use,
            cancelled: board.cancelled,
            cache_bytes,
            raw_develop_ms: self.inner.raw_develop_ms.load(Ordering::Relaxed),
            viewer_cache_hits: self.inner.viewer_cache_hits.load(Ordering::Relaxed),
            decode_peak_mb: thumbnail::peak_estimate_bytes() / (1024 * 1024),
            stale_tasks: self.inner.stale_tasks.load(Ordering::Relaxed),
            background_per_sec: board.background_per_sec,
            cache_capped: board.cache_capped,
            scheduler_mode: board.load_mode.as_str().to_string(),
            pending_p1,
            pending_p4,
            pending_p5,
            background_completed: board.background_completed,
            background_yields: board.background_yields,
            viewport_base_ready: viewport_base_ready(&board),
            viewport_quality_ready: viewport_quality_ready(&board),
        }
    }

    fn nudge(&self) {
        self.inner.wake.notify_all();
        self.inner.read_wake.notify_all();
        self.inner.hover_wake.notify_all();
    }

    pub fn prefetch_folder(&self, path: String, order: String, first: usize, extra: usize) {
        hover::request(&self.inner, path, order, first, extra);
    }

    pub fn cancel_folder_prefetch(&self) {
        hover::cancel(&self.inner);
    }

    pub fn prefetch_photo(
        &self,
        path: &str,
        size: u64,
        modified_at: i64,
        long_edge: u32,
    ) -> viewer::ViewerOffer {
        viewer::prefetch(&self.inner, path, size, modified_at, long_edge)
    }

    pub fn cancel_photo_prefetch(&self) {
        viewer::cancel_hover(&self.inner);
    }

    pub fn record_operation_links(&self, result: &mut crate::file_ops::FileOperationResult) {
        let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
        for outcome in &mut result.outcomes {
            let log_id = format!(
                "{}:{}",
                result.operation_id,
                crate::file_ops::normalize_key(Path::new(&outcome.source_path))
            );
            let dest = outcome.destination_path.clone();
            let dest_ref = dest.as_deref();
            match outcome.status.as_str() {
                "copied" | "already_exists" => {
                    if let Some(destination) = dest_ref {
                        match record_favorite_link(
                            &db,
                            &outcome.source_path,
                            destination,
                            outcome.source_content_sha256.as_deref(),
                        ) {
                            Ok(()) => {
                                alias_favorite_copy_thumbnails(
                                    &db,
                                    &outcome.source_path,
                                    destination,
                                );
                                let _ = crate::database::finish_op(
                                    &db,
                                    &log_id,
                                    crate::database::ST_COMPLETED,
                                    dest_ref,
                                    None,
                                    None,
                                );
                            }
                            Err(err) => {
                                let _ = crate::database::finish_op(
                                    &db,
                                    &log_id,
                                    crate::database::ST_NEEDS_RECONCILIATION,
                                    dest_ref,
                                    Some("favorite_link"),
                                    Some(&err),
                                );
                                outcome.error_code = Some("favorite_link".to_string());
                                outcome.error_message = Some(err);
                            }
                        }
                    } else {
                        let _ = crate::database::finish_op(
                            &db,
                            &log_id,
                            crate::database::ST_COMPLETED,
                            dest_ref,
                            None,
                            None,
                        );
                    }
                }
                "moved" => {
                    if let Some(destination) = dest_ref {
                        let size = std::fs::metadata(destination)
                            .map(|item| item.len())
                            .unwrap_or(0);
                        let _ = crate::database::record_trash(
                            &db,
                            destination,
                            &outcome.source_path,
                            size,
                        );
                    }
                    let _ = crate::database::finish_op(
                        &db,
                        &log_id,
                        crate::database::ST_COMPLETED,
                        dest_ref,
                        None,
                        None,
                    );
                }
                "cancelled" => {
                    let _ = crate::database::finish_op(
                        &db,
                        &log_id,
                        crate::database::ST_FAILED,
                        dest_ref,
                        Some("cancelled"),
                        outcome.error_message.as_deref(),
                    );
                }
                _ => {
                    let _ = crate::database::finish_op(
                        &db,
                        &log_id,
                        crate::database::ST_FAILED,
                        dest_ref,
                        outcome.error_code.as_deref(),
                        outcome.error_message.as_deref(),
                    );
                }
            }
        }
    }

    pub fn execute_file_operation<G: crate::file_ops::IoGate>(
        &self,
        gate: &G,
        request: &crate::file_ops::OperationRequest,
        copy_slots: usize,
        cancel: &std::sync::atomic::AtomicBool,
        on_progress: &(dyn Fn(&crate::file_ops::FileOperationProgress) + Sync),
    ) -> Result<crate::file_ops::FileOperationResult, String> {
        let trace_fav_add =
            request.action == crate::file_ops::Action::CopyToLocalFavorites;
        let mut fav_perf = if trace_fav_add {
            crate::file_ops::favorite_perf::FavoriteAddPerf::begin(
                &request.operation_id,
                request.paths.len(),
            )
        } else {
            None
        };
        let dest_name = request.action.folder_name();
        let dest_folder = Path::new(&request.directory).join(dest_name);
        let mut lock_paths: Vec<PathBuf> = request.paths.iter().map(PathBuf::from).collect();
        lock_paths.push(PathBuf::from(&request.directory));
        lock_paths.push(dest_folder);
        let _lock = crate::file_ops::try_lock_paths(lock_paths)?;
        if let Some(perf) = &mut fav_perf {
            perf.mark_lock_acquired();
        }
        let favorite_duplicate_hints = {
            let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
            for path in &request.paths {
                let (size, modified, name) = path_stamp(Path::new(path));
                let row = crate::database::FileOpLog {
                    id: format!(
                        "{}:{}",
                        request.operation_id,
                        crate::file_ops::normalize_key(Path::new(path))
                    ),
                    op_type: match request.action {
                        crate::file_ops::Action::MoveToLocalTrash => {
                            crate::database::OP_MOVE_TO_LOCAL_TRASH.to_string()
                        }
                        crate::file_ops::Action::CopyToLocalFavorites => {
                            crate::database::OP_ADD_TO_FAVORITES.to_string()
                        }
                    },
                    source_path: path.clone(),
                    destination_path: None,
                    origin_path: Some(path.clone()),
                    source_name: name,
                    source_size: size,
                    source_modified_at: modified,
                    status: crate::database::ST_PENDING.to_string(),
                    error_code: None,
                    error_message: None,
                };
                crate::database::insert_pending_op(&db, &row)?;
            }
            if request.action == crate::file_ops::Action::CopyToLocalFavorites {
                let hints =
                    crate::file_ops::favorite_duplicate_hints_for_paths(&db, &request.paths);
                if hints.is_empty() {
                    None
                } else {
                    Some(hints)
                }
            } else {
                None
            }
        };
        if let Some(perf) = &mut fav_perf {
            perf.mark_journal_done();
        }
        let mut executed = if request.action == crate::file_ops::Action::CopyToLocalFavorites {
            let inner = Arc::clone(&self.inner);
            let favorites_journal = move |log_id: &str, destination: &str| {
                let db = inner.db.lock().unwrap_or_else(|err| err.into_inner());
                let _ = crate::database::update_pending_destination(&db, log_id, destination);
            };
            crate::file_ops::execute(
                gate,
                request,
                copy_slots,
                cancel,
                on_progress,
                Some(&favorites_journal),
                favorite_duplicate_hints.as_ref(),
            )
        } else {
            crate::file_ops::execute(
                gate,
                request,
                copy_slots,
                cancel,
                on_progress,
                None,
                None,
            )
        };
        if let Some(perf) = &mut fav_perf {
            perf.mark_execute_done();
        }
        match &mut executed {
            Ok(result) => self.record_operation_links(result),
            Err(message) => {
                let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
                for path in &request.paths {
                    let log_id = format!(
                        "{}:{}",
                        request.operation_id,
                        crate::file_ops::normalize_key(Path::new(path))
                    );
                    let _ = crate::database::finish_op(
                        &db,
                        &log_id,
                        crate::database::ST_FAILED,
                        None,
                        Some("failed"),
                        Some(message),
                    );
                }
            }
        }
        if let Some(perf) = &mut fav_perf {
            perf.mark_links_done();
        }
        // CL-P01.2: post-op scoped reconcile after favorites file-op (Ok and Err).
        if request.action == crate::file_ops::Action::CopyToLocalFavorites {
            let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
            let _ = crate::file_ops::reconcile::reconcile_favorites_scope(
                &db,
                &request.directory,
                Some(&request.paths),
            );
        }
        if let Some(perf) = fav_perf {
            let outcome = if executed.is_ok() {
                "completed"
            } else {
                "failed"
            };
            perf.finish(std::time::Instant::now(), outcome);
        }
        executed
    }

    pub fn disk_gate(&self) -> DiskGate {
        DiskGate {
            inner: Arc::clone(&self.inner),
        }
    }

    pub fn set_profile(&self, mode: &str) -> StorageProfile {
        let override_profile = match mode {
            "hdd" => Some(StorageProfile::Hdd),
            "ssd" => Some(StorageProfile::Ssd),
            _ => None,
        };
        {
            let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
            let _ = crate::database::set_setting(&db, "storage_profile", mode);
        }
        let mut board = self
            .inner
            .board
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        board.profile_override = override_profile;
        board.read_slots = read_slots_for(&board.folder, override_profile);
        let profile = storage::profile_for(Path::new(&board.folder), override_profile);
        self.inner.wake.notify_all();
        self.inner.read_wake.notify_all();
        profile
    }

    pub fn clear_cache(&self) -> Result<(), String> {
        {
            let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
            cache::clear(&db)?;
        }
        let mut board = self
            .inner
            .board
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        board.generation = board.generation.wrapping_add(1);
        board.cache_hits = 0;
        board.cache_misses = 0;
        self.inner
            .held
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .clear();
        self.inner
            .decoding
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .clear();
        self.inner.wake.notify_all();
        self.inner.read_wake.notify_all();
        Ok(())
    }

    pub fn usage(&self) -> Result<cache::CacheUsage, String> {
        let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
        cache::usage(&db)
    }

    pub fn set_cache_limit(&self, bytes: i64) -> Result<cache::CacheUsage, String> {
        let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
        cache::set_limit(&db, bytes)
    }

    pub fn set_cache_ttl(&self, preset: &str) -> Result<cache::CacheUsage, String> {
        let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
        cache::set_ttl(&db, preset)
    }

    pub fn remember_folder(&self, path: &str, name: &str) -> Result<(), String> {
        let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
        crate::library::remember(&db, path, name)
    }

    pub fn toggle_favorite(&self, path: &str, name: &str) -> Result<bool, String> {
        let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
        crate::library::toggle_favorite(&db, path, name)
    }

    pub fn recent_folders(&self) -> Result<Vec<crate::scanner::FolderShortcut>, String> {
        let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
        crate::library::recent(&db)
    }

    pub fn folder_menu_options(
        &self,
        parent_directory: &str,
        folder_path: &str,
    ) -> Result<crate::file_ops::FolderMenuOptions, String> {
        crate::file_ops::folder_menu_options(parent_directory, folder_path)
    }

    pub fn rename_folder(
        &self,
        parent_directory: &str,
        folder_path: &str,
        new_name: &str,
    ) -> Result<String, String> {
        let old_path = folder_path;
        let new_path =
            crate::file_ops::rename_child_folder(parent_directory, folder_path, new_name)?;
        let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
        // Filesystem already moved. Do not rename back if SQLite rewrite fails;
        // activity is derived from the live folder, and the next read reconciles.
        let _ = crate::database::relocate_folder_path(&db, old_path, &new_path, new_name.trim());
        Ok(new_path)
    }

    pub fn remove_empty_service_folder(
        &self,
        parent_directory: &str,
        folder_path: &str,
    ) -> Result<crate::file_ops::ServiceFolderLocation, String> {
        let location = crate::file_ops::remove_empty_service_folder(parent_directory, folder_path)?;
        let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
        crate::database::purge_paths_under(&db, &location.folder_path)?;
        Ok(location)
    }

    pub fn cleanup_empty_service_folder(
        &self,
        parent_directory: &str,
        folder_path: &str,
    ) -> crate::file_ops::ServiceFolderCleanupResult {
        let outcome = crate::file_ops::cleanup_empty_service_folder(parent_directory, folder_path);
        if outcome.status == "removed" {
            if let Some(location) = &outcome.location {
                let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
                let _ = crate::database::purge_paths_under(&db, &location.folder_path);
            }
        } else if outcome.status == "already_gone" {
            if let Some(location) = &outcome.location {
                let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
                let _ = crate::database::purge_paths_under(&db, &location.folder_path);
            }
        }
        outcome
    }

    pub fn favorite_origins_for_copies(
        &self,
        paths: &[String],
    ) -> Result<Vec<crate::file_ops::FavoriteCopyOrigin>, String> {
        let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
        let mut out = Vec::with_capacity(paths.len());
        for copy_path in paths {
            let origin_path = crate::database::favorite_snapshot_for_copy(&db, copy_path)?
                .map(|row| row.origin_path);
            out.push(crate::file_ops::FavoriteCopyOrigin {
                copy_path: copy_path.clone(),
                origin_path,
            });
        }
        Ok(out)
    }

    pub fn favorite_origins_in(&self, directory: &str) -> Result<Vec<String>, String> {
        let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
        crate::file_ops::favorites::active_favorite_origins_in(&db, directory)
    }

    pub fn remove_favorite_copy(
        &self,
        path: &str,
        confirmed: bool,
        resolution: Option<&str>,
    ) -> Result<crate::file_ops::RemoveFavoriteCopyResult, String> {
        crate::file_ops::favorites::remove_favorite_copy_distributed(
            &self.inner.db,
            path,
            confirmed,
            resolution,
        )
    }

    pub fn preview_remove_favorite_copy(
        &self,
        path: &str,
    ) -> Result<crate::file_ops::RemoveFavoriteCopyResult, String> {
        let ctx = {
            let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
            crate::file_ops::favorites::load_removal_context(&db, path)?
        };
        let plan = crate::file_ops::favorites::plan_removal(path, &ctx)?;
        Ok(crate::file_ops::favorites::preview_plan(&plan))
    }

    pub fn preview_remove_favorite_copies(
        &self,
        paths: Vec<String>,
    ) -> Result<Vec<crate::file_ops::FavoriteBatchPathResult>, String> {
        crate::file_ops::favorites_batch::preview_remove_favorite_copies(&self.inner.db, &paths)
    }

    pub fn remove_favorite_copies_batch(
        &self,
        items: Vec<crate::file_ops::FavoriteBatchRemoveItem>,
    ) -> Result<Vec<crate::file_ops::FavoriteBatchPathResult>, String> {
        crate::file_ops::favorites_batch::remove_favorite_copies_batch(&self.inner.db, &items)
    }

    pub fn undo_favorite_removal(&self, _id: &str) -> Result<(), String> {
        Err("Восстановите копию из корзины Windows.".to_string())
    }

    pub fn discard_favorite_undo(&self, _id: &str) -> Result<(), String> {
        Ok(())
    }

    pub fn restore_trash(
        &self,
        path: &str,
        mode: &str,
        chosen_directory: Option<&str>,
    ) -> Result<crate::file_ops::RestoreTrashResult, String> {
        let trash_file = PathBuf::from(path);
        let trash_parent = trash_file.parent().map(|parent| parent.to_path_buf());
        let (origin_log, target_origin, renamed) = if mode == "parent" {
            let target = crate::file_ops::trash_folder::parent_restore_target(&trash_file)?;
            (target.display().to_string(), target, false)
        } else {
            let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
            let origin = resolve_trash_origin(&db, path)?;
            drop(db);
            let origin_path = PathBuf::from(&origin);
            let target = if mode == "chosen" {
                let dir = chosen_directory.ok_or_else(|| "origin_missing".to_string())?;
                let name = origin_path
                    .file_name()
                    .ok_or_else(|| "Некорректное исходное имя".to_string())?;
                PathBuf::from(dir).join(name)
            } else {
                origin_path
            };
            (origin.clone(), target, mode == "renamed")
        };
        let mut lock_paths = vec![trash_file.clone(), target_origin.clone()];
        if let Some(parent) = trash_parent.clone() {
            lock_paths.push(parent);
        }
        let _lock = crate::file_ops::try_lock_paths(lock_paths)?;
        let op_id = new_file_op_id("restore");
        let (size, modified, name) = path_stamp(&trash_file);
        {
            let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
            crate::database::insert_pending_op(
                &db,
                &crate::database::FileOpLog {
                    id: op_id.clone(),
                    op_type: crate::database::OP_RESTORE_FROM_LOCAL_TRASH.to_string(),
                    source_path: path.to_string(),
                    destination_path: Some(target_origin.display().to_string()),
                    origin_path: Some(origin_log.clone()),
                    source_name: name,
                    source_size: size,
                    source_modified_at: modified,
                    status: crate::database::ST_PENDING.to_string(),
                    error_code: None,
                    error_message: None,
                },
            )?;
        }
        let restored = match crate::file_ops::restore_recorded_file(
            Path::new(path),
            &target_origin,
            renamed,
        ) {
            Ok(path) => path,
            Err(err) => {
                let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
                let _ = crate::database::finish_op(
                    &db,
                    &op_id,
                    crate::database::ST_FAILED,
                    None,
                    Some("restore_failed"),
                    Some(&err),
                );
                return Err(err);
            }
        };
        let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
        crate::database::delete_trash(&db, path)?;
        let _ = crate::database::finish_op(
            &db,
            &op_id,
            crate::database::ST_COMPLETED,
            Some(&restored.display().to_string()),
            None,
            None,
        );
        drop(db);
        let removed_service_folder = trash_parent.as_deref().and_then(|parent| {
            match crate::file_ops::remove_service_folder_if_empty(parent) {
                Ok(value) => value,
                Err(_) => None,
            }
        });
        if let Some(location) = &removed_service_folder {
            let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
            let _ = crate::database::purge_paths_under(&db, &location.folder_path);
        }
        Ok(crate::file_ops::RestoreTrashResult {
            restored_path: crate::file_ops::path_string_for_app(&restored),
            removed_service_folder,
        })
    }

    pub fn recycle_trash_file(
        &self,
        path: &str,
    ) -> Result<crate::file_ops::RecycleItemResult, String> {
        let authorized = crate::file_ops::recycle::authorize_trash_file(Path::new(path))
            .map_err(|err| err.message)?;
        let _lock = crate::file_ops::try_lock_paths([&authorized])?;
        let op_id = new_file_op_id("recycle-file");
        let (size, modified, name) = path_stamp(&authorized);
        {
            let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
            crate::database::insert_pending_op(
                &db,
                &crate::database::FileOpLog {
                    id: op_id.clone(),
                    op_type: crate::database::OP_MOVE_TO_WINDOWS_RECYCLE.to_string(),
                    source_path: authorized.display().to_string(),
                    destination_path: None,
                    origin_path: crate::database::trash_origin(&db, path).ok().flatten(),
                    source_name: name,
                    source_size: size,
                    source_modified_at: modified,
                    status: crate::database::ST_PENDING.to_string(),
                    error_code: None,
                    error_message: None,
                },
            )?;
        }
        match crate::file_ops::recycle_path(&authorized) {
            Ok(crate::file_ops::RecycleStatus::Recycled) => {}
            Ok(crate::file_ops::RecycleStatus::Ambiguous) => {
                let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
                let _ = crate::database::finish_op(
                    &db,
                    &op_id,
                    crate::database::ST_NEEDS_RECONCILIATION,
                    None,
                    Some("ambiguous"),
                    Some("Результат корзины Windows неоднозначен"),
                );
                return Err(
                    "Результат корзины Windows неоднозначен. Файл оставлен на месте.".to_string(),
                );
            }
            Err(err) => {
                let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
                let _ = crate::database::finish_op(
                    &db,
                    &op_id,
                    crate::database::ST_FAILED,
                    None,
                    Some(err.code),
                    Some(&err.message),
                );
                return Err(err.message);
            }
        }
        let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
        let _ = crate::database::delete_trash(&db, path);
        let _ = crate::database::delete_trash(&db, &authorized.display().to_string());
        let _ = crate::database::finish_op(
            &db,
            &op_id,
            crate::database::ST_COMPLETED,
            None,
            None,
            None,
        );
        drop(db);
        let removed_service_folder = authorized.parent().and_then(|parent| {
            match crate::file_ops::remove_service_folder_if_empty(parent) {
                Ok(value) => value,
                Err(_) => None,
            }
        });
        if let Some(location) = &removed_service_folder {
            let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
            let _ = crate::database::purge_paths_under(&db, &location.folder_path);
        }
        crate::scanner::drop_listing_cache(&authorized);
        if let Some(parent) = authorized.parent() {
            crate::scanner::drop_listing_cache(parent);
        }
        Ok(crate::file_ops::RecycleItemResult {
            path: crate::file_ops::path_string_for_app(&authorized),
            status: "recycled".to_string(),
            removed_service_folder,
        })
    }

    pub fn recycle_trash_folder(
        &self,
        path: &str,
        state_token: &str,
    ) -> Result<crate::file_ops::RecycleItemResult, String> {
        crate::file_ops::trash_folder::verify_local_trash_state(path, state_token)?;
        let authorized = crate::file_ops::recycle::authorize_trash_folder(Path::new(path))
            .map_err(|err| err.message)?;
        let _lock = crate::file_ops::try_lock_paths([&authorized])?;
        let op_id = new_file_op_id("recycle-folder");
        {
            let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
            crate::database::insert_pending_op(
                &db,
                &crate::database::FileOpLog {
                    id: op_id.clone(),
                    op_type: crate::database::OP_MOVE_TO_WINDOWS_RECYCLE.to_string(),
                    source_path: authorized.display().to_string(),
                    destination_path: None,
                    origin_path: None,
                    source_name: authorized
                        .file_name()
                        .and_then(|name| name.to_str())
                        .map(|name| name.to_string()),
                    source_size: None,
                    source_modified_at: None,
                    status: crate::database::ST_PENDING.to_string(),
                    error_code: None,
                    error_message: None,
                },
            )?;
        }
        match crate::file_ops::recycle_path(&authorized) {
            Ok(crate::file_ops::RecycleStatus::Recycled) => {}
            Ok(crate::file_ops::RecycleStatus::Ambiguous) => {
                let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
                let _ = crate::database::finish_op(
                    &db,
                    &op_id,
                    crate::database::ST_NEEDS_RECONCILIATION,
                    None,
                    Some("ambiguous"),
                    Some("Результат корзины Windows неоднозначен"),
                );
                return Err(
                    "Результат корзины Windows неоднозначен. Папка оставлена на месте.".to_string(),
                );
            }
            Err(err) => {
                let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
                let _ = crate::database::finish_op(
                    &db,
                    &op_id,
                    crate::database::ST_FAILED,
                    None,
                    Some(err.code),
                    Some(&err.message),
                );
                return Err(err.message);
            }
        }
        let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
        let _ = crate::database::purge_paths_under(&db, &authorized.display().to_string());
        let _ = crate::database::finish_op(
            &db,
            &op_id,
            crate::database::ST_COMPLETED,
            None,
            None,
            None,
        );
        drop(db);
        crate::scanner::drop_listing_cache(&authorized);
        if let Some(parent) = authorized.parent() {
            crate::scanner::drop_listing_cache(parent);
        }
        let removed_service_folder =
            authorized
                .parent()
                .map(|parent| crate::file_ops::ServiceFolderLocation {
                    parent_directory: crate::file_ops::path_string_for_app(parent),
                    folder_path: crate::file_ops::path_string_for_app(&authorized),
                });
        Ok(crate::file_ops::RecycleItemResult {
            path: crate::file_ops::path_string_for_app(&authorized),
            status: "recycled".to_string(),
            removed_service_folder,
        })
    }

    pub fn favorite_folders(&self) -> Result<Vec<crate::scanner::FolderShortcut>, String> {
        let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
        crate::library::favorites(&db)
    }

    pub fn rotate_display_clockwise(&self, path: &str) -> Result<u8, String> {
        let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
        crate::library::rotate_clockwise(&db, path)
    }

    pub fn list_display_rotations(
        &self,
        paths: &[String],
    ) -> Result<Vec<crate::library::DisplayRotation>, String> {
        let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
        crate::library::list_display_rotations(&db, paths)
    }

    pub fn viewer_source(
        &self,
        path: &str,
        size: u64,
        modified_at: i64,
        preview_only: bool,
    ) -> Result<ViewerSource, String> {
        let format = formats::from_path(Path::new(path));
        if !preview_only && format.is_some_and(|format| format.webview_native()) {
            return Ok(ViewerSource {
                kind: "native".into(),
                path: path.to_string(),
            });
        }
        let db = self.inner.db.lock().unwrap_or_else(|err| err.into_inner());
        for tier in [1024u32, 512, 256] {
            if let Ok(Some(thumb)) = cache::cached_thumb(&db, path, size, modified_at, tier) {
                return Ok(ViewerSource {
                    kind: "prepared".into(),
                    path: thumb,
                });
            }
        }
        Ok(ViewerSource {
            kind: "pending".into(),
            path: String::new(),
        })
    }

    pub fn viewer_frame(
        &self,
        path: &str,
        size: u64,
        modified_at: i64,
        long_edge: u32,
    ) -> viewer::ViewerOffer {
        viewer::offer(&self.inner, path, size, modified_at, long_edge)
    }

    fn watch_folder(&self, folder: &str, _session: u64) {
        let (tx, rx) = std::sync::mpsc::channel();
        let watcher = notify::recommended_watcher(move |result: Result<Event, notify::Error>| {
            if let Ok(event) = result {
                if event.kind.is_create() || event.kind.is_modify() || event.kind.is_remove() {
                    let _ = tx.send(());
                }
            }
        });
        let Ok(mut watcher) = watcher else {
            return;
        };
        if watcher
            .watch(Path::new(folder), RecursiveMode::NonRecursive)
            .is_err()
        {
            return;
        }
        *self
            .inner
            .watcher
            .lock()
            .unwrap_or_else(|err| err.into_inner()) = Some(watcher);
        let app = self.inner.app.clone();
        let inner = Arc::clone(&self.inner);
        let watched_folder = folder.to_string();
        thread::spawn(move || {
            while rx.recv().is_ok() {
                thread::sleep(Duration::from_millis(400));
                while rx.try_recv().is_ok() {}
                let (live_session, still_open) = {
                    let board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
                    (
                        board.session,
                        open_folder_matches(&board.folder, &watched_folder),
                    )
                };
                if !still_open {
                    continue;
                }
                let _ = app.emit(
                    "folder-changed",
                    FolderChanged {
                        folder: watched_folder.clone(),
                        session: live_session,
                    },
                );
            }
        });
    }
}

fn open_folder_matches(board_folder: &str, watched_folder: &str) -> bool {
    if board_folder.is_empty() || watched_folder.is_empty() {
        return false;
    }
    let norm = |text: &str| {
        text.replace('/', "\\")
            .trim_end_matches('\\')
            .to_lowercase()
    };
    norm(board_folder) == norm(watched_folder)
}

/// Shares the thumbnail read slots so a file copy yields while visible previews are missing.
#[derive(Clone)]
pub struct DiskGate {
    inner: Arc<Inner>,
}

impl DiskGate {
    pub fn copy_slots(&self, path: &Path) -> usize {
        let override_profile = self
            .inner
            .board
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .profile_override;
        storage::profile_for(path, override_profile)
            .read_slots()
            .min(2)
            .max(1)
    }
}

impl crate::file_ops::IoGate for DiskGate {
    fn wait_visible(&self, cancel: &AtomicBool) -> bool {
        while !cancel.load(Ordering::Relaxed) {
            let pending = {
                let board = self
                    .inner
                    .board
                    .lock()
                    .unwrap_or_else(|err| err.into_inner());
                board.scrolling || visible_missing_preview(&board)
            };
            if !pending {
                return true;
            }
            thread::sleep(Duration::from_millis(30));
        }
        false
    }

    fn with_read<T>(&self, work: impl FnOnce() -> T) -> T {
        let _slot = ReadSlot::acquire(&self.inner);
        work()
    }
}

enum HeaderPlan {
    Read { jobs: Vec<HeaderJob>, wake: bool },
    Pause,
    Stop,
}

struct HeaderJob {
    index: usize,
    path: String,
    size: u64,
    modified_at: i64,
}

fn metadata_pass(inner: Arc<Inner>, generation: u64) {
    let mut batch = Vec::new();
    loop {
        if generation_changed(&inner, generation) {
            return;
        }
        match header_plan(&inner, generation) {
            HeaderPlan::Stop => break,
            HeaderPlan::Pause => {
                let timed_out = wait_for_workers(&inner, generation);
                if timed_out
                    && !visible_missing_preview_now(&inner, generation)
                    && !disk_upgrade_pending_now(&inner, generation)
                {
                    if let Some(job) = trickle_header(&inner, generation) {
                        publish_header(&inner, generation, &job);
                    }
                }
            }
            HeaderPlan::Read { jobs, wake } => {
                for job in jobs {
                    if generation_changed(&inner, generation) {
                        return;
                    }
                    let meta = read_meta(&inner, &job);
                    if claim_header(&inner, generation, job.index) {
                        batch.push(meta_event(job.path, meta.width, meta.height));
                    }
                    if batch.len() >= 32 {
                        emit_meta(&inner, generation, std::mem::take(&mut batch));
                    }
                }
                if !batch.is_empty() {
                    emit_meta(&inner, generation, std::mem::take(&mut batch));
                }
                if wake {
                    inner.wake.notify_all();
                }
            }
        }
    }
    {
        let mut board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
        if board.generation == generation {
            board.meta_done = true;
        }
    }
    inner.wake.notify_all();
}

/// Read sizes for the visible window before yielding the disk to thumbnail decodes.
/// Set to false to restore the previous header pass, which paused whenever a visible preview was missing.
const GEOMETRY_FIRST_HEADERS: bool = true;
const GEOMETRY_FALLBACK: usize = 256;
const HEADER_BATCH: usize = 32;
const HEADER_ATTEMPTS: u32 = 1;
const HEADER_TIMEOUT: Duration = Duration::from_millis(1500);
const FALLBACK_WIDTH: u32 = 3;
const FALLBACK_HEIGHT: u32 = 2;

fn clamp_index_range(start: usize, end: usize, len: usize) -> (usize, usize) {
    let start = start.min(len);
    let end = end.min(len).max(start);
    (start, end)
}

fn geometry_window(board: &Board) -> (usize, usize) {
    clamp_index_range(board.geometry_start, board.geometry_end, board.items.len())
}

fn geometry_headers_pending(board: &Board) -> bool {
    let (start, end) = geometry_window(board);
    (start..end).any(|index| board.items.get(index).is_some_and(|item| !item.header_done))
}

fn collect_header_jobs(board: &Board, start: usize, end: usize, limit: usize) -> Vec<HeaderJob> {
    let (start, end) = clamp_index_range(start, end, board.items.len());
    let mut jobs = Vec::new();
    for index in start..end {
        let item = &board.items[index];
        if item.header_done || item.busy {
            continue;
        }
        jobs.push(header_job(board, index));
        if jobs.len() >= limit {
            break;
        }
    }
    jobs
}

fn header_plan(inner: &Inner, generation: u64) -> HeaderPlan {
    let board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    if board.generation != generation {
        return HeaderPlan::Stop;
    }
    let (geo_start, geo_end) = geometry_window(&board);
    let first = collect_header_jobs(&board, geo_start, geo_end, HEADER_BATCH);
    if GEOMETRY_FIRST_HEADERS && !first.is_empty() {
        return HeaderPlan::Read {
            jobs: first,
            wake: false,
        };
    }
    if geometry_headers_pending(&board) {
        return HeaderPlan::Pause;
    }
    if visible_missing_preview(&board) || disk_upgrade_pending(&board) {
        return HeaderPlan::Pause;
    }
    let (near_start, near_end) = nearby_window(&board);
    let near = collect_header_jobs(&board, near_start, near_end, HEADER_BATCH);
    if !near.is_empty() {
        return HeaderPlan::Read {
            jobs: near,
            wake: false,
        };
    }
    let rest = collect_header_jobs(&board, 0, board.items.len(), HEADER_BATCH);
    if rest.is_empty() {
        HeaderPlan::Stop
    } else {
        HeaderPlan::Read {
            jobs: rest,
            wake: true,
        }
    }
}

fn visible_missing_preview(board: &Board) -> bool {
    (board.visible_start..board.visible_end).any(|index| {
        board
            .items
            .get(index)
            .is_some_and(|item| !item.failed && !item.ready[0])
    })
}

fn visible_missing_preview_now(inner: &Inner, generation: u64) -> bool {
    let board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    board.generation == generation && visible_missing_preview(&board)
}

fn disk_upgrade_pending_now(inner: &Inner, generation: u64) -> bool {
    let board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    board.generation == generation && disk_upgrade_pending(&board)
}

fn disk_upgrade_pending(board: &Board) -> bool {
    (board.visible_start..board.visible_end).any(|index| {
        board.items.get(index).is_some_and(|item| {
            item.cache_checked
                && item.ready[0]
                && !item.ready[1]
                && !item.bitmap_held
                && !item.failed
        })
    })
}

struct HeldBitmap {
    rgb: image::RgbImage,
    width: u32,
    height: u32,
    orientation: u8,
}

fn prime_cache(inner: &Inner, generation: u64, start: usize, end: usize) {
    let pending = {
        let board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
        if board.generation != generation {
            return;
        }
        let end = end.min(board.items.len());
        let start = start.min(end);
        (start..end)
            .filter_map(|index| {
                let item = board.items.get(index)?;
                if item.cache_checked || item.size == 0 {
                    None
                } else {
                    Some((index, item.path.clone(), item.size as i64, item.modified_at))
                }
            })
            .collect::<Vec<_>>()
    };
    if pending.is_empty() {
        return;
    }
    let sources: Vec<(String, i64, i64)> = pending
        .iter()
        .map(|(_, path, size, modified)| (path.clone(), *size, *modified))
        .collect();
    let db = inner.db.lock().unwrap_or_else(|err| err.into_inner());
    let thumbs = cache::thumbs_for_sources(&db, &sources).unwrap_or_default();
    let metas = cache::meta_for_sources(&db, &sources).unwrap_or_default();
    let fails = cache::fails_for_sources(&db, &sources).unwrap_or_default();
    drop(db);
    let mut thumb_map: HashMap<&str, Vec<&cache::WindowThumb>> = HashMap::new();
    for thumb in &thumbs {
        thumb_map
            .entry(thumb.source_path.as_str())
            .or_default()
            .push(thumb);
    }
    let meta_map: HashMap<&str, (u32, u32)> = metas
        .iter()
        .map(|(path, width, height)| (path.as_str(), (*width, *height)))
        .collect();
    let fail_map: HashMap<&str, &str> = fails
        .iter()
        .map(|(path, kind)| (path.as_str(), kind.as_str()))
        .collect();
    for (index, path, _, _) in &pending {
        if let Some(kind) = fail_map.get(path.as_str()) {
            mark_failed(inner, generation, *index);
            emit_fail(
                inner,
                generation,
                fail_event(path.clone(), (*kind).to_string()),
            );
        }
        if let Some((width, height)) = meta_map.get(path.as_str()) {
            publish_header_sizes(inner, generation, *index, path.clone(), *width, *height);
        } else if fail_map.contains_key(path.as_str()) {
            publish_fallback_geometry(inner, generation, *index, path.clone());
        }
        if let Some(rows) = thumb_map.get(path.as_str()) {
            let mut ordered = rows.clone();
            ordered.sort_by_key(|row| row.tier);
            for row in ordered {
                mark_ready(inner, generation, *index, row.tier);
                emit_thumb(
                    inner,
                    generation,
                    thumb_event(path.clone(), row.tier, row.thumbnail_path.clone()),
                );
            }
        }
        let mut board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
        if board.generation == generation {
            if let Some(item) = board.items.get_mut(*index) {
                item.cache_checked = true;
            }
        }
    }
}

fn header_job(board: &Board, index: usize) -> HeaderJob {
    let item = &board.items[index];
    HeaderJob {
        index,
        path: item.path.clone(),
        size: item.size,
        modified_at: item.modified_at,
    }
}

fn clear_busy(inner: &Inner, generation: u64, index: usize) {
    let mut board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    if board.generation == generation {
        release_busy(&mut board, index);
    }
}

fn release_busy(board: &mut Board, index: usize) {
    let Some(item) = board.items.get_mut(index) else {
        return;
    };
    if item.busy && item.inflight_priority >= 5 {
        board.background_inflight = board.background_inflight.saturating_sub(1);
    }
    item.busy = false;
    item.inflight_priority = 0;
}

fn nearby_window(board: &Board) -> (usize, usize) {
    let (back, fore) = match board.scroll_ahead.cmp(&0) {
        std::cmp::Ordering::Greater => (8usize, 40usize),
        std::cmp::Ordering::Less => (40, 8),
        std::cmp::Ordering::Equal => (24, 24),
    };
    let start = board.visible_start.saturating_sub(back);
    let end = (board.visible_end + fore).min(board.items.len());
    (start, end)
}

fn wait_for_workers(inner: &Inner, generation: u64) -> bool {
    let board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    if board.generation != generation {
        return false;
    }
    let waited = inner
        .wake
        .wait_timeout(board, Duration::from_millis(250))
        .unwrap_or_else(|err| err.into_inner());
    waited.1.timed_out()
}

fn trickle_header(inner: &Inner, generation: u64) -> Option<HeaderJob> {
    let board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    if board.generation != generation || board.reads_in_use > 0 || !interactive_waiting(&board) {
        return None;
    }
    let (start, end) = nearby_window(&board);
    (0..board.items.len()).find_map(|index| {
        if index >= start && index < end {
            return None;
        }
        let item = &board.items[index];
        if item.header_done || item.busy {
            None
        } else {
            Some(header_job(&board, index))
        }
    })
}

fn publish_header(inner: &Inner, generation: u64, job: &HeaderJob) {
    if generation_changed(inner, generation) {
        return;
    }
    let meta = read_meta(inner, job);
    publish_header_sizes(
        inner,
        generation,
        job.index,
        job.path.clone(),
        meta.width,
        meta.height,
    );
}

fn read_meta(inner: &Inner, job: &HeaderJob) -> HeaderMeta {
    let (cached, failed) = {
        let db = inner.db.lock().unwrap_or_else(|err| err.into_inner());
        let cached = match cache::cached_meta(&db, &job.path, job.size, job.modified_at) {
            Ok(Some((width, height))) => Some(HeaderMeta {
                width,
                height,
                orientation: 1,
            }),
            _ => None,
        };
        let failed = if cached.is_some() {
            false
        } else {
            cache::cached_fail(&db, &job.path, job.size, job.modified_at)
                .ok()
                .flatten()
                .is_some()
        };
        (cached, failed)
    };
    if let Some(meta) = cached {
        return meta;
    }
    if failed {
        return HeaderMeta {
            width: FALLBACK_WIDTH,
            height: FALLBACK_HEIGHT,
            orientation: 1,
        };
    }
    let read = {
        let _slot = ReadSlot::acquire(inner);
        read_header_limited(Path::new(&job.path))
    };
    match read {
        Ok(meta) => {
            let db = inner.db.lock().unwrap_or_else(|err| err.into_inner());
            let _ = cache::save_meta(
                &db,
                &job.path,
                job.size,
                job.modified_at,
                meta.width,
                meta.height,
                meta.orientation,
            );
            meta
        }
        Err(_) => HeaderMeta {
            width: FALLBACK_WIDTH,
            height: FALLBACK_HEIGHT,
            orientation: 1,
        },
    }
}

fn header_needs_limit(path: &Path) -> bool {
    matches!(
        formats::from_path(path),
        Some(
            formats::Format::Heic
                | formats::Format::Heif
                | formats::Format::Raw
                | formats::Format::Avif
        )
    )
}

fn read_header_limited(path: &Path) -> Result<HeaderMeta, String> {
    const _: () = assert!(HEADER_ATTEMPTS == 1);
    if !header_needs_limit(path) {
        return std::panic::catch_unwind(AssertUnwindSafe(|| metadata::read_header(path)))
            .unwrap_or_else(|_| Err("metadata reader panicked".to_string()));
    }
    let (tx, rx) = mpsc::sync_channel(1);
    let job_path = path.to_path_buf();
    let spawned = thread::Builder::new()
        .name("header-read".into())
        .spawn(move || {
            let result =
                std::panic::catch_unwind(AssertUnwindSafe(|| metadata::read_header(&job_path)))
                    .unwrap_or_else(|_| Err("metadata reader panicked".to_string()));
            let _ = tx.send(result);
        });
    if spawned.is_err() {
        return Err("metadata worker failed to start".to_string());
    }
    match rx.recv_timeout(HEADER_TIMEOUT) {
        Ok(Ok(meta)) => Ok(meta),
        Ok(Err(err)) => Err(err),
        Err(_) => Err("metadata read timed out".to_string()),
    }
}

fn cached_geometry(inner: &Inner, path: &str, size: u64, modified_at: i64) -> Option<(u32, u32)> {
    let db = inner.db.lock().unwrap_or_else(|err| err.into_inner());
    cache::cached_meta(&db, path, size, modified_at)
        .ok()
        .flatten()
}

fn claim_item_header(item: &mut Item) -> bool {
    if item.header_done {
        return false;
    }
    item.header_done = true;
    true
}

fn claim_header(inner: &Inner, generation: u64, index: usize) -> bool {
    let mut board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    if board.generation != generation {
        return false;
    }
    board.items.get_mut(index).is_some_and(claim_item_header)
}

fn publish_header_sizes(
    inner: &Inner,
    generation: u64,
    index: usize,
    path: String,
    width: u32,
    height: u32,
) {
    if claim_header(inner, generation, index) {
        emit_meta(inner, generation, vec![meta_event(path, width, height)]);
    }
}

fn publish_fallback_geometry(inner: &Inner, generation: u64, index: usize, path: String) {
    publish_header_sizes(
        inner,
        generation,
        index,
        path,
        FALLBACK_WIDTH,
        FALLBACK_HEIGHT,
    );
}

fn produce(inner: &Inner, job: &Job) -> Result<(), DecodeError> {
    yield_if_needed(inner, job)?;
    let path = Path::new(&job.path);
    let format = formats::from_path(path);
    if format == Some(formats::Format::Video) {
        // No read slot: Quick Look does its own I/O and a broken file can take seconds.
        let source = thumbnail::decode_path(path, format)?;
        return publish_tiers(inner, job, source);
    }
    if format.map(formats::Format::backend) == Some(formats::Backend::Raw) {
        let preview = {
            let _slot = acquire_read(inner, job)?;
            thumbnail::decode_path(path, format)
        };
        return match preview {
            Ok(source) => publish_tiers(inner, job, source),
            Err(err) if err.kind == FailureKind::NeedsDevelop => {
                if !allow_heavy(inner, job.generation, job.index) {
                    return Err(DecodeError::new(
                        FailureKind::NeedsDevelop,
                        "RAW develop skipped, viewport moved",
                    ));
                }
                let pixels = {
                    let _slot = acquire_read(inner, job)?;
                    thumbnail::raw_header(path)
                        .map(|meta| u64::from(meta.width).saturating_mul(u64::from(meta.height)))
                        .unwrap_or(16_000_000)
                };
                let _budget = thumbnail::HeavyHold::reserve(thumbnail::bitmap_estimate(pixels))
                    .ok_or_else(|| {
                        DecodeError::new(
                            FailureKind::NeedsDevelop,
                            "RAW develop skipped, memory budget",
                        )
                    })?;
                let _heavy = HeavySlot::acquire_while(inner, || {
                    allow_heavy(inner, job.generation, job.index)
                })
                .ok_or_else(|| {
                    DecodeError::new(
                        FailureKind::NeedsDevelop,
                        "RAW develop skipped, viewport moved",
                    )
                })?;
                if !allow_heavy(inner, job.generation, job.index) {
                    return Err(DecodeError::new(
                        FailureKind::NeedsDevelop,
                        "RAW develop skipped, viewport moved",
                    ));
                }
                let _slot = acquire_read(inner, job)?;
                let source = thumbnail::develop_raw_path(path)?;
                publish_tiers(inner, job, source)
            }
            Err(err) => Err(err),
        };
    }
    if !still_wanted(inner, job) {
        return Err(DecodeError::new(FailureKind::Failed, "viewport moved"));
    }
    let tier = job.tiers.first().copied().unwrap_or(256);
    if tier >= 512 {
        if let Some(held) = take_held(inner, job) {
            if tier == 512 || held.rgb.width().max(held.rgb.height()) >= tier {
                let bytes = thumbnail::encode_bitmap(&held.rgb, tier)?;
                emit_encoded(
                    inner,
                    job,
                    tier,
                    &bytes,
                    held.width,
                    held.height,
                    held.orientation,
                    false,
                );
                return Ok(());
            }
        }
    }
    if format == Some(formats::Format::Jpeg) {
        return produce_jpeg(inner, job, path, tier);
    }
    let bytes = {
        let _slot = acquire_read(inner, job)?;
        Arc::new(std::fs::read(path).map_err(DecodeError::io)?)
    };
    if !still_wanted(inner, job) {
        return Err(DecodeError::new(FailureKind::Failed, "viewport moved"));
    }
    let source = thumbnail::decode_owned(bytes, format)?;
    if tier == 256 {
        let (width, height, orientation, rgb) = thumbnail::bitmap_for_tier(source, 512)?;
        let encoded = thumbnail::encode_bitmap(&rgb, 256)?;
        if job.hold_bitmap {
            store_held(inner, job, rgb, width, height, orientation);
        }
        emit_encoded(inner, job, 256, &encoded, width, height, orientation, false);
        return Ok(());
    }
    publish_tiers(inner, job, source)
}

fn produce_jpeg(inner: &Inner, job: &Job, path: &Path, tier: u32) -> Result<(), DecodeError> {
    yield_if_needed(inner, job)?;
    let embedded = {
        let _slot = acquire_read(inner, job)?;
        thumbnail::embedded_jpeg(path).filter(|bytes| thumbnail::embedded_covers(bytes, tier))
    };
    if let Some(preview) = embedded {
        let mut source = thumbnail::decode(&preview, Some(formats::Format::Jpeg))?;
        let header = {
            let _slot = acquire_read(inner, job)?;
            crate::metadata::read_header(path).ok()
        };
        let use_embedded = match &header {
            Some(meta) => {
                source.orientation = thumbnail::embedded_orientation(
                    source.orientation,
                    source.image.width(),
                    source.image.height(),
                    meta.orientation,
                    meta.width,
                    meta.height,
                );
                thumbnail::embedded_preview_trusted(
                    source.image.width(),
                    source.image.height(),
                    source.orientation,
                    meta.width,
                    meta.height,
                    meta.orientation,
                )
            }
            None => false,
        };
        if use_embedded {
            let (width, height, orientation, rgb) = thumbnail::bitmap_for_tier(source, tier)?;
            let (meta_w, meta_h) = match header {
                Some(meta) => (meta.width, meta.height),
                None => (width, height),
            };
            let bytes = thumbnail::encode_bitmap(&rgb, tier)?;
            emit_encoded(
                inner,
                job,
                tier,
                &bytes,
                meta_w,
                meta_h,
                orientation,
                true,
            );
            if tier <= 256 {
                set_hold_flags(inner, job, true, false);
            }
            return Ok(());
        }
    }
    if !generation_current(inner, job) {
        return Err(DecodeError::new(FailureKind::Failed, "viewport moved"));
    }
    let file_bytes = {
        let _slot = acquire_read(inner, job)?;
        std::fs::read(path).map_err(DecodeError::io)?
    };
    // Bytes are already in RAM — finish this decode even if the viewport moved.
    // Still abort on folder/session generation change.
    if !generation_current(inner, job) {
        return Err(DecodeError::new(FailureKind::Failed, "viewport moved"));
    }
    let target = if tier <= 256 { 512 } else { tier };
    let source = match thumbnail::decode_jpeg_scaled(&file_bytes, target) {
        Ok(source) => source,
        Err(err) if err.kind == FailureKind::Unsupported => {
            thumbnail::decode(&file_bytes, Some(formats::Format::Jpeg))?
        }
        Err(err) => return Err(err),
    };
    if tier <= 256 {
        let (width, height, orientation, rgb) = thumbnail::bitmap_for_tier(source, 512)?;
        let encoded = thumbnail::encode_bitmap(&rgb, 256)?;
        if job.hold_bitmap {
            store_held(inner, job, rgb, width, height, orientation);
        }
        emit_encoded(inner, job, 256, &encoded, width, height, orientation, false);
        return Ok(());
    }
    publish_tiers(inner, job, source)
}

fn store_held(
    inner: &Inner,
    job: &Job,
    rgb: image::RgbImage,
    width: u32,
    height: u32,
    orientation: u8,
) {
    inner
        .held
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .insert(
            (job.generation, job.index),
            HeldBitmap {
                rgb,
                width,
                height,
                orientation,
            },
        );
    set_hold_flags(inner, job, false, true);
}

fn take_held(inner: &Inner, job: &Job) -> Option<HeldBitmap> {
    let held = inner
        .held
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .remove(&(job.generation, job.index));
    if held.is_some() {
        set_hold_flags(inner, job, false, false);
    }
    held
}

fn set_hold_flags(inner: &Inner, job: &Job, preview_only: bool, bitmap_held: bool) {
    let mut board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    if board.generation != job.generation {
        return;
    }
    if let Some(item) = board.items.get_mut(job.index) {
        item.preview_only = preview_only;
        item.bitmap_held = bitmap_held;
    }
}

fn emit_encoded(
    inner: &Inner,
    job: &Job,
    tier: u32,
    bytes: &[u8],
    pixel_w: u32,
    pixel_h: u32,
    orientation: u8,
    publish_geometry: bool,
) {
    let dest = thumbnail::thumb_path(&job.path, job.size, job.modified_at, tier);
    let thumb = {
        let _write = inner.write.lock().unwrap_or_else(|err| err.into_inner());
        if thumbnail::write_atomic(&dest, bytes).is_err() {
            return;
        }
        dest.to_string_lossy().into_owned()
    };
    {
        let db = inner.db.lock().unwrap_or_else(|err| err.into_inner());
        if cache::publish_thumbnail(
            &db,
            &job.path,
            job.size,
            job.modified_at,
            pixel_w,
            pixel_h,
            orientation,
            tier,
            &thumb,
            bytes.len() as i64,
            publish_geometry,
        )
        .is_err()
        {
            cache::discard_thumbnail_file(&thumb);
            return;
        }
    }
    if publish_geometry {
        publish_header_sizes(
            inner,
            job.generation,
            job.index,
            job.path.clone(),
            pixel_w,
            pixel_h,
        );
    }
    mark_ready(inner, job.generation, job.index, tier);
    emit_thumb(
        inner,
        job.generation,
        thumb_event(job.path.clone(), tier, thumb),
    );
}

fn publish_tiers(inner: &Inner, job: &Job, source: thumbnail::Source) -> Result<(), DecodeError> {
    let mut meta_sent = false;
    thumbnail::render_each(
        source,
        &job.tiers,
        |tier, bytes, pixel_w, pixel_h, orientation| {
            if tier > 256 && !generation_current(inner, job) {
                return;
            }
            let dest = thumbnail::thumb_path(&job.path, job.size, job.modified_at, tier);
            let thumb = {
                let _write = inner.write.lock().unwrap_or_else(|err| err.into_inner());
                if thumbnail::write_atomic(&dest, &bytes).is_err() {
                    return;
                }
                dest.to_string_lossy().into_owned()
            };
            {
                let db = inner.db.lock().unwrap_or_else(|err| err.into_inner());
                if cache::publish_thumbnail(
                    &db,
                    &job.path,
                    job.size,
                    job.modified_at,
                    pixel_w,
                    pixel_h,
                    orientation,
                    tier,
                    &thumb,
                    bytes.len() as i64,
                    false,
                )
                .is_err()
                {
                    cache::discard_thumbnail_file(&thumb);
                    return;
                }
            }
            if !meta_sent {
                meta_sent = true;
                if let Some((width, height)) =
                    cached_geometry(inner, &job.path, job.size, job.modified_at)
                {
                    publish_header_sizes(
                        inner,
                        job.generation,
                        job.index,
                        job.path.clone(),
                        width,
                        height,
                    );
                }
            }
            mark_ready(inner, job.generation, job.index, tier);
            emit_thumb(
                inner,
                job.generation,
                thumb_event(job.path.clone(), tier, thumb),
            );
        },
    )
    .map(|_| ())
}

fn allow_heavy(inner: &Inner, generation: u64, index: usize) -> bool {
    let board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    if board.generation != generation {
        return false;
    }
    let (start, end) = nearby_window(&board);
    (index >= start && index < end) || !board.scrolling
}

fn worker(inner: Arc<Inner>) {
    loop {
        let job = next_job(&inner);
        if job.cache_only {
            inner.wake.notify_all();
            continue;
        }
        if !still_wanted(&inner, &job) {
            note_cancelled(&inner, job.generation);
            clear_busy(&inner, job.generation, job.index);
            inner.wake.notify_all();
            continue;
        }
        let Some(_claimed) = hover::ClaimGuard::try_new(&inner, &job.path) else {
            clear_busy(&inner, job.generation, job.index);
            let board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
            let _ = inner
                .wake
                .wait_timeout(board, Duration::from_millis(200))
                .unwrap_or_else(|err| err.into_inner());
            continue;
        };
        let outcome = std::panic::catch_unwind(AssertUnwindSafe(|| produce(&inner, &job)))
            .unwrap_or_else(|_| Err(DecodeError::new(FailureKind::Failed, "decoder panicked")));
        if let Err(err) = outcome {
            if err.message.contains("viewport moved") {
                note_cancelled(&inner, job.generation);
                clear_busy(&inner, job.generation, job.index);
                inner.wake.notify_all();
                continue;
            }
            eprintln!(
                "thumbnail {}: {} ({})",
                job.path,
                err.message,
                err.kind.as_str()
            );
            if err.kind == FailureKind::NeedsDevelop && err.message.contains("skipped") {
                defer_heavy(&inner, job.generation, job.index);
                inner.wake.notify_all();
                continue;
            }
            {
                let db = inner
                    .db
                    .lock()
                    .unwrap_or_else(|inner_err| inner_err.into_inner());
                let _ = cache::save_fail(
                    &db,
                    &job.path,
                    job.size,
                    job.modified_at,
                    err.kind.as_str(),
                    &err.message,
                );
            }
            mark_failed(&inner, job.generation, job.index);
            emit_fail(
                &inner,
                job.generation,
                fail_event(job.path.clone(), err.kind.as_str().to_string()),
            );
            publish_fallback_geometry(&inner, job.generation, job.index, job.path.clone());
            inner.wake.notify_all();
            continue;
        }
        clear_busy(&inner, job.generation, job.index);
        if job.priority >= 5 {
            {
                let mut board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
                if board.generation == job.generation {
                    board.background_completed = board.background_completed.saturating_add(1);
                }
            }
            let tier = job.tiers.first().copied().unwrap_or(256);
            let kept = {
                let db = inner.db.lock().unwrap_or_else(|err| err.into_inner());
                cache::cached_thumb(&db, &job.path, job.size, job.modified_at, tier)
                    .ok()
                    .flatten()
                    .is_some()
            };
            if !kept {
                note_cache_capped(&inner, job.generation, job.index);
            }
        }
        let (scrolling, folder) = {
            let board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
            (board.scrolling, board.folder.clone())
        };
        if !scrolling {
            let db = inner.db.lock().unwrap_or_else(|err| err.into_inner());
            let _ = cache::maintain_with(&db, &folder);
        }
        inner.wake.notify_all();
    }
}

struct Job {
    generation: u64,
    viewport_gen: u64,
    viewer_gen: u64,
    index: usize,
    path: String,
    size: u64,
    modified_at: i64,
    tiers: Vec<u32>,
    cache_only: bool,
    priority: u8,
    hold_bitmap: bool,
}

fn finished_job(
    generation: u64,
    viewport_gen: u64,
    viewer_gen: u64,
    index: usize,
    path: String,
    size: u64,
    modified_at: i64,
    tiers: Vec<u32>,
    cache_only: bool,
    priority: u8,
) -> Job {
    Job {
        generation,
        viewport_gen,
        viewer_gen,
        index,
        path,
        size,
        modified_at,
        tiers,
        cache_only,
        priority,
        hold_bitmap: priority < 5,
    }
}

fn still_wanted(inner: &Inner, job: &Job) -> bool {
    let board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    job_still_wanted(&board, job)
}

fn generation_current(inner: &Inner, job: &Job) -> bool {
    let board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    board.generation == job.generation
}

fn job_still_wanted(board: &Board, job: &Job) -> bool {
    if board.generation != job.generation {
        return false;
    }
    if board.viewer_index == Some(job.index) {
        return true;
    }
    if job.priority >= 5 {
        return true;
    }
    if board.viewport_gen == job.viewport_gen && board.viewer_gen == job.viewer_gen {
        return true;
    }
    viewer_covers(board, job.index) || in_nearby(board, job.index)
}

fn next_job(inner: &Inner) -> Job {
    let mut board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    loop {
        if let Some((index, priority)) = pick_index(&board) {
            let generation = board.generation;
            let viewport_gen = board.viewport_gen;
            let viewer_gen = board.viewer_gen;
            let want_1024 = board.viewer_index == Some(index)
                || (priority == 4
                    && board.requested_tier >= 1024
                    && index >= board.visible_start
                    && index < board.visible_end);
            let item = &mut board.items[index];
            let path = item.path.clone();
            let size = item.size;
            let modified_at = item.modified_at;
            let cache_checked = item.cache_checked;
            let ready = item.ready;
            item.busy = true;
            item.inflight_priority = priority;
            if priority >= 5 {
                board.background_inflight += 1;
                board.noncritical_since_background = 0;
            } else if priority >= 2 {
                board.noncritical_since_background =
                    board.noncritical_since_background.saturating_add(1);
            }
            drop(board);
            if cache_checked {
                let tier = tier_for(priority, ready, want_1024);
                if let Some(tier) = tier {
                    if priority >= 5 && cache_is_full(inner) {
                        note_cache_capped(inner, generation, index);
                        return finished_job(
                            generation,
                            viewport_gen,
                            viewer_gen,
                            index,
                            path,
                            size,
                            modified_at,
                            Vec::new(),
                            true,
                            priority,
                        );
                    }
                    let job = finished_job(
                        generation,
                        viewport_gen,
                        viewer_gen,
                        index,
                        path.clone(),
                        size,
                        modified_at,
                        vec![tier],
                        false,
                        priority,
                    );
                    if !still_wanted(inner, &job) {
                        clear_busy(inner, generation, index);
                        return finished_job(
                            generation,
                            viewport_gen,
                            viewer_gen,
                            index,
                            path,
                            size,
                            modified_at,
                            Vec::new(),
                            true,
                            priority,
                        );
                    }
                    note_cache_miss(inner, generation);
                    return job;
                }
                clear_busy(inner, generation, index);
                return finished_job(
                    generation,
                    viewport_gen,
                    viewer_gen,
                    index,
                    path,
                    size,
                    modified_at,
                    Vec::new(),
                    true,
                    priority,
                );
            }
            let mut tiers = Vec::new();
            let mut cached = Vec::new();
            let cached_size = {
                let db = inner.db.lock().unwrap_or_else(|err| err.into_inner());
                if let Ok(Some((kind, _))) = cache::cached_fail(&db, &path, size, modified_at) {
                    drop(db);
                    mark_failed(inner, generation, index);
                    emit_fail(inner, generation, fail_event(path.clone(), kind));
                    publish_fallback_geometry(inner, generation, index, path.clone());
                    return finished_job(
                        generation,
                        viewport_gen,
                        viewer_gen,
                        index,
                        path,
                        size,
                        modified_at,
                        Vec::new(),
                        true,
                        priority,
                    );
                }
                let known = cache::cached_meta(&db, &path, size, modified_at)
                    .ok()
                    .flatten();
                let mut ready = [false; 3];
                for tier in [256u32, 512, 1024] {
                    if tier == 1024 && !want_1024 {
                        continue;
                    }
                    if let Ok(Some(thumb)) =
                        cache::cached_thumb(&db, &path, size, modified_at, tier)
                    {
                        if let Some(slot) = tier_slot(tier) {
                            ready[slot] = true;
                        }
                        cached.push((tier, thumb));
                    }
                }
                if cached.is_empty() {
                    if let Ok(Some(snap)) =
                        crate::database::favorite_snapshot_for_copy(&db, &path)
                    {
                        if snap.copy_size == Some(size) && snap.origin_size == size {
                            let _ = cache::alias_thumbnails_from_origin(
                                &db,
                                &snap.origin_path,
                                snap.origin_size,
                                snap.origin_modified_at,
                                &path,
                                size,
                                modified_at,
                            );
                            for tier in [256u32, 512, 1024] {
                                if tier == 1024 && !want_1024 {
                                    continue;
                                }
                                if let Ok(Some(thumb)) =
                                    cache::cached_thumb(&db, &path, size, modified_at, tier)
                                {
                                    if let Some(slot) = tier_slot(tier) {
                                        ready[slot] = true;
                                    }
                                    cached.push((tier, thumb));
                                }
                            }
                        }
                    }
                }
                if let Some(tier) = tier_for(priority, ready, want_1024) {
                    tiers.push(tier);
                }
                known
            };
            if let Some((width, height)) = cached_size {
                publish_header_sizes(inner, generation, index, path.clone(), width, height);
            }
            {
                let mut board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
                if board.generation == generation {
                    if cached.is_empty() {
                        board.cache_misses = board.cache_misses.saturating_add(1);
                    } else {
                        board.cache_hits = board.cache_hits.saturating_add(cached.len() as u64);
                    }
                    if let Some(item) = board.items.get_mut(index) {
                        item.cache_checked = true;
                    }
                }
            }
            for (tier, thumb) in cached {
                mark_ready(inner, generation, index, tier);
                emit_thumb(inner, generation, thumb_event(path.clone(), tier, thumb));
            }
            tiers.sort_unstable();
            tiers.dedup();
            if let Some(first) = tiers.first().copied() {
                tiers = vec![first];
            }
            let job = finished_job(
                generation,
                viewport_gen,
                viewer_gen,
                index,
                path.clone(),
                size,
                modified_at,
                tiers.clone(),
                tiers.is_empty(),
                priority,
            );
            if tiers.is_empty() || !still_wanted(inner, &job) {
                clear_busy(inner, generation, index);
                return finished_job(
                    generation,
                    viewport_gen,
                    viewer_gen,
                    index,
                    path,
                    size,
                    modified_at,
                    Vec::new(),
                    true,
                    priority,
                );
            }
            if priority >= 5 && cache_is_full(inner) {
                note_cache_capped(inner, generation, index);
                return finished_job(
                    generation,
                    viewport_gen,
                    viewer_gen,
                    index,
                    path,
                    size,
                    modified_at,
                    Vec::new(),
                    true,
                    priority,
                );
            }
            return job;
        }
        refresh_pass(&mut board);
        board = inner
            .wake
            .wait(board)
            .unwrap_or_else(|err| err.into_inner());
    }
}

fn interactive_waiting(board: &Board) -> bool {
    pick_p0(board).is_some()
        || pick_visible_missing(board).is_some()
        || pick_direction(board).is_some()
        || pick_overscan(board).is_some()
        || pick_upgrade(board).is_some()
}

fn grid_blocks_hover_board(board: &Board) -> bool {
    board.scrolling
        || pick_p0(board).is_some()
        || pick_visible_missing(board).is_some()
        || geometry_headers_pending(board)
}

fn grid_blocks_hover(inner: &Inner) -> bool {
    let board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    grid_blocks_hover_board(&board)
}

fn pick_index(board: &Board) -> Option<(usize, u8)> {
    if board.priming || board.items.is_empty() {
        return None;
    }
    if let Some(index) = pick_p0(board) {
        return Some((index, 0));
    }
    if geometry_headers_pending(board) {
        return None;
    }
    if let Some(index) = pick_visible_missing(board) {
        return Some((index, 1));
    }
    // Fair-share: after enough P2/P3/P4 work, insert one P5 so the folder fill cannot starve.
    if board.noncritical_since_background >= FAIR_SHARE_EVERY {
        if let Some(index) = pick_background(board) {
            return Some((index, 5));
        }
    }
    match board.load_mode {
        LoadMode::Idle => {
            if let Some(index) = pick_upgrade(board) {
                return Some((index, 4));
            }
            if let Some(index) = pick_direction(board) {
                return Some((index, 2));
            }
            if let Some(index) = pick_overscan(board) {
                return Some((index, 3));
            }
        }
        LoadMode::Scrolling => {
            if let Some(index) = pick_direction(board) {
                return Some((index, 2));
            }
            if let Some(index) = pick_overscan(board) {
                return Some((index, 3));
            }
            if let Some(index) = pick_upgrade(board) {
                return Some((index, 4));
            }
        }
        LoadMode::FastScrolling => {
            if let Some(index) = pick_direction(board) {
                return Some((index, 2));
            }
            if let Some(index) = pick_overscan(board) {
                return Some((index, 3));
            }
        }
    }
    pick_background(board).map(|index| (index, 5))
}

fn viewport_base_ready(board: &Board) -> bool {
    let range = visible_range(board);
    if range.start == range.end {
        return true;
    }
    (range.start..range.end).all(|index| {
        board
            .items
            .get(index)
            .is_some_and(|item| item.failed || item.cache_blocked || best_tier(item) >= 256)
    })
}

fn viewport_quality_ready(board: &Board) -> bool {
    let range = visible_range(board);
    if range.start == range.end {
        return true;
    }
    let want = board.requested_tier.max(256);
    (range.start..range.end).all(|index| {
        board
            .items
            .get(index)
            .is_some_and(|item| item.failed || item.cache_blocked || best_tier(item) >= want)
    })
}

fn focus_range(board: &Board) -> std::ops::Range<usize> {
    board.focus_start..board.focus_end.max(board.focus_start)
}

fn visible_range(board: &Board) -> std::ops::Range<usize> {
    board.visible_start..board.visible_end.max(board.visible_start)
}

fn pick_p0(board: &Board) -> Option<usize> {
    let index = board.viewer_index?;
    if cache_pending(board, index) || needs_256(board, index) {
        Some(index)
    } else {
        None
    }
}

fn pick_visible_missing(board: &Board) -> Option<usize> {
    let focus = focus_range(board);
    let visible = visible_range(board);
    for index in focus.clone() {
        if cache_pending(board, index) {
            return Some(index);
        }
    }
    for index in visible.clone() {
        if focus.contains(&index) {
            continue;
        }
        if cache_pending(board, index) {
            return Some(index);
        }
    }
    for index in focus {
        if needs_256(board, index) {
            return Some(index);
        }
    }
    for index in visible {
        if needs_256(board, index) {
            return Some(index);
        }
    }
    None
}

fn pick_direction(board: &Board) -> Option<usize> {
    if let Some(index) = viewer_steps(board, true, board.viewer_ahead as usize, false) {
        return Some(index);
    }
    let (start, end) = ahead_span(board);
    first_base(board, start, end)
}

fn pick_overscan(board: &Board) -> Option<usize> {
    if let Some(index) = viewer_steps(board, false, 2, false) {
        return Some(index);
    }
    let (start, end) = behind_span(board);
    first_base(board, start, end)
}

fn pick_upgrade(board: &Board) -> Option<usize> {
    if let Some(index) = board.viewer_index {
        if needs_upgrade(board, index) {
            return Some(index);
        }
    }
    for index in focus_range(board) {
        if needs_upgrade(board, index) {
            return Some(index);
        }
    }
    for index in visible_range(board) {
        if needs_upgrade(board, index) {
            return Some(index);
        }
    }
    if !board.viewer_fast {
        return viewer_steps(board, true, 2, true);
    }
    None
}

fn first_base(board: &Board, start: usize, end: usize) -> Option<usize> {
    let end = end.min(board.items.len());
    let start = start.min(end);
    for index in start..end {
        if cache_pending(board, index) {
            return Some(index);
        }
    }
    for index in start..end {
        if needs_256(board, index) {
            return Some(index);
        }
    }
    None
}

fn ahead_span(board: &Board) -> (usize, usize) {
    let len = board.items.len();
    if board.scroll_ahead < 0 {
        (board.visible_start.saturating_sub(40), board.visible_start)
    } else if board.scroll_ahead > 0 {
        (board.visible_end, (board.visible_end + 40).min(len))
    } else {
        (board.visible_end, (board.visible_end + 24).min(len))
    }
}

fn behind_span(board: &Board) -> (usize, usize) {
    let len = board.items.len();
    if board.scroll_ahead < 0 {
        (board.visible_end, (board.visible_end + 8).min(len))
    } else if board.scroll_ahead > 0 {
        (board.visible_start.saturating_sub(8), board.visible_start)
    } else {
        (board.visible_start.saturating_sub(24), board.visible_start)
    }
}

fn viewer_steps(board: &Board, forward: bool, depth: usize, upgrade: bool) -> Option<usize> {
    let origin = board.viewer_index?;
    if depth == 0 {
        return None;
    }
    let step: isize = if forward == (board.viewer_dir >= 0) {
        1
    } else {
        -1
    };
    let mut cursor = origin as isize;
    let len = board.items.len() as isize;
    for _ in 0..depth {
        cursor += step;
        if cursor < 0 || cursor >= len {
            break;
        }
        let index = cursor as usize;
        if upgrade {
            if needs_neighbor_upgrade(board, index) {
                return Some(index);
            }
        } else if cache_pending(board, index) || needs_256(board, index) {
            return Some(index);
        }
    }
    None
}

fn viewer_covers(board: &Board, index: usize) -> bool {
    let Some(origin) = board.viewer_index else {
        return false;
    };
    let ahead = board.viewer_ahead as usize;
    let forward = if board.viewer_dir >= 0 {
        index > origin && index <= origin.saturating_add(ahead)
    } else {
        index < origin && index + ahead >= origin
    };
    let backward = if board.viewer_dir >= 0 {
        index < origin && index + 2 >= origin
    } else {
        index > origin && index <= origin.saturating_add(2)
    };
    forward || backward
}

fn in_nearby(board: &Board, index: usize) -> bool {
    let (start, end) = nearby_window(board);
    index >= start && index < end
}

fn pick_background(board: &Board) -> Option<usize> {
    let len = board.items.len();
    if len == 0 || board.cache_capped || board.viewer_wants_read {
        return None;
    }
    if board.background_inflight >= board.read_slots.max(1) {
        return None;
    }
    let origin = board.background_index % len;
    for offset in 0..len {
        let index = (origin + offset) % len;
        if cache_pending(board, index) || needs_base(board, index) {
            return Some(index);
        }
    }
    None
}

fn cache_pending(board: &Board, index: usize) -> bool {
    board
        .items
        .get(index)
        .is_some_and(|item| !item.busy && !item.failed && !item.cache_checked)
}

fn tier_for(priority: u8, ready: [bool; 3], want_1024: bool) -> Option<u32> {
    if priority == 4 {
        return next_missing_tier(ready, want_1024);
    }
    if ready[0] || ready[1] || ready[2] {
        None
    } else {
        Some(256)
    }
}

fn next_missing_tier(ready: [bool; 3], want_1024: bool) -> Option<u32> {
    let have = if ready[2] {
        1024
    } else if ready[1] {
        512
    } else if ready[0] {
        256
    } else {
        0
    };
    if have == 0 {
        Some(256)
    } else if have < 512 {
        Some(512)
    } else if want_1024 && have < 1024 {
        Some(1024)
    } else {
        None
    }
}

fn best_tier(item: &Item) -> u32 {
    if item.ready[2] {
        1024
    } else if item.ready[1] {
        512
    } else if item.ready[0] {
        256
    } else {
        0
    }
}

fn target_tier(board: &Board, index: usize, urgent: bool) -> u32 {
    let for_viewer = board.viewer_index == Some(index);
    if for_viewer
        || (urgent
            && board.requested_tier >= 1024
            && index >= board.visible_start
            && index < board.visible_end)
    {
        return 1024;
    }
    if urgent {
        return board.requested_tier.max(256);
    }
    512
}

fn needs_base(board: &Board, index: usize) -> bool {
    let Some(item) = board.items.get(index) else {
        return false;
    };
    if item.busy || item.failed || item.cache_blocked || !item.cache_checked {
        return false;
    }
    if item.deferred_heavy && board.scrolling && !in_nearby(board, index) {
        return false;
    }
    best_tier(item) == 0
}

fn needs_neighbor_upgrade(board: &Board, index: usize) -> bool {
    eligible(board, index)
        && board.items.get(index).is_some_and(|item| {
            let best = best_tier(item);
            best > 0 && best < 512
        })
}

fn needs_256(board: &Board, index: usize) -> bool {
    eligible(board, index)
        && board
            .items
            .get(index)
            .is_some_and(|item| best_tier(item) == 0)
}

fn needs_upgrade(board: &Board, index: usize) -> bool {
    let Some(item) = board.items.get(index) else {
        return false;
    };
    if !eligible(board, index) {
        return false;
    }
    let best = best_tier(item);
    best > 0 && best < target_tier(board, index, true)
}

fn eligible(board: &Board, index: usize) -> bool {
    let Some(item) = board.items.get(index) else {
        return false;
    };
    if item.busy || item.failed || !item.cache_checked {
        return false;
    }
    if item.deferred_heavy {
        let (start, end) = nearby_window(board);
        if board.scrolling && !(index >= start && index < end) {
            return false;
        }
    }
    true
}

fn tier_slot(tier: u32) -> Option<usize> {
    match tier {
        256 => Some(0),
        512 => Some(1),
        1024 => Some(2),
        _ => None,
    }
}

fn mark_ready(inner: &Inner, generation: u64, index: usize, tier: u32) {
    let mut board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    if board.generation != generation {
        return;
    }
    let became_base = if let Some(item) = board.items.get_mut(index) {
        let was_base = item.ready[0];
        if let Some(slot) = tier_slot(tier) {
            item.ready[slot] = true;
        }
        item.ready[0] && !was_base
    } else {
        false
    };
    if became_base {
        note_base_progress(&mut board);
        advance_background_cursor(&mut board);
    }
}

fn note_base_progress(board: &mut Board) {
    board.base_ready = board.base_ready.saturating_add(1);
    let elapsed = board.rate_at.elapsed().as_secs_f32();
    if elapsed >= 2.0 {
        let done = board.base_ready.saturating_sub(board.rate_ready);
        board.background_per_sec = done as f32 / elapsed;
        board.rate_at = Instant::now();
        board.rate_ready = board.base_ready;
    }
}

fn advance_background_cursor(board: &mut Board) {
    let len = board.items.len();
    if len == 0 {
        return;
    }
    let mut cursor = board.background_index % len;
    for _ in 0..len {
        let settled = board.items[cursor].failed
            || board.items[cursor].cache_blocked
            || board.items[cursor].ready[0];
        if !settled {
            break;
        }
        cursor = (cursor + 1) % len;
    }
    board.background_index = cursor;
}

fn defer_heavy(inner: &Inner, generation: u64, index: usize) {
    let mut board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    if board.generation == generation {
        if let Some(item) = board.items.get_mut(index) {
            item.deferred_heavy = true;
        }
        release_busy(&mut board, index);
    }
}

fn mark_failed(inner: &Inner, generation: u64, index: usize) {
    let mut board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    if board.generation == generation {
        if let Some(item) = board.items.get_mut(index) {
            item.failed = true;
        }
        release_busy(&mut board, index);
        advance_background_cursor(&mut board);
    }
}

fn generation_changed(inner: &Inner, generation: u64) -> bool {
    inner
        .board
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .generation
        != generation
}

fn session_if_current(board: &Board, generation: u64) -> Option<u64> {
    if board.generation == generation {
        Some(board.session)
    } else {
        None
    }
}

fn live_session(inner: &Inner, generation: u64) -> Option<u64> {
    let board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    session_if_current(&board, generation)
}

fn emit_meta(inner: &Inner, generation: u64, mut events: Vec<MetaEvent>) {
    let Some(session) = live_session(inner, generation) else {
        return;
    };
    if events.is_empty() {
        return;
    }
    for event in &mut events {
        event.session = session;
    }
    let _ = inner.app.emit("metadata-batch", events);
}

fn emit_thumb(inner: &Inner, generation: u64, mut event: ThumbEvent) {
    let Some(session) = live_session(inner, generation) else {
        return;
    };
    event.session = session;
    let _ = inner.app.emit("thumbnail-ready", event);
}

fn emit_fail(inner: &Inner, generation: u64, mut event: FailEvent) {
    let Some(session) = live_session(inner, generation) else {
        return;
    };
    event.session = session;
    let _ = inner.app.emit("thumbnail-failed", event);
}

fn meta_event(path: String, width: u32, height: u32) -> MetaEvent {
    MetaEvent {
        session: 0,
        path,
        width,
        height,
    }
}

fn thumb_event(path: String, tier: u32, thumbnail_path: String) -> ThumbEvent {
    ThumbEvent {
        session: 0,
        path,
        tier,
        thumbnail_path,
    }
}

fn fail_event(path: String, reason: String) -> FailEvent {
    FailEvent {
        session: 0,
        path,
        reason,
    }
}

fn should_yield(board: &Board, job: &Job) -> bool {
    if board.generation != job.generation {
        return true;
    }
    if job.priority == 0 {
        return false;
    }
    if geometry_headers_pending(board) {
        return true;
    }
    if board.viewer_wants_read && job.priority >= 2 {
        return true;
    }
    if pick_p0(board).is_some() {
        return true;
    }
    // P5 yields only for critical visible/viewer work — not for optional P4 upgrades.
    if job.priority >= 5 {
        return pick_visible_missing(board).is_some();
    }
    if job.priority >= 4
        && (pick_visible_missing(board).is_some()
            || pick_direction(board).is_some()
            || pick_overscan(board).is_some())
    {
        return true;
    }
    false
}

fn read_slots_for(folder: &str, profile_override: Option<StorageProfile>) -> usize {
    if let Some(profile) = profile_override {
        return profile.read_slots();
    }
    if folder.is_empty() {
        return StorageProfile::Hdd.read_slots();
    }
    storage::profile_for(Path::new(folder), None).read_slots()
}

fn yield_if_needed(inner: &Inner, job: &Job) -> Result<(), DecodeError> {
    let board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    if should_yield(&board, job) {
        let generation = job.generation;
        let count_yield = job.priority >= 5;
        drop(board);
        if count_yield {
            note_background_yield(inner, generation);
        }
        Err(DecodeError::new(FailureKind::Failed, "viewport moved"))
    } else {
        Ok(())
    }
}

fn acquire_read<'a>(inner: &'a Inner, job: &Job) -> Result<ReadSlot<'a>, DecodeError> {
    let mut board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    loop {
        let yield_now = should_yield(&board, job);
        if yield_now || !job_still_wanted(&board, job) {
            let generation = job.generation;
            let count_yield = job.priority >= 5 && yield_now;
            drop(board);
            if count_yield {
                note_background_yield(inner, generation);
            }
            return Err(DecodeError::new(FailureKind::Failed, "viewport moved"));
        }
        if board.reads_in_use < board.read_slots.max(1) {
            board.reads_in_use += 1;
            return Ok(ReadSlot {
                inner,
                for_viewer: false,
            });
        }
        board = inner
            .read_wake
            .wait(board)
            .unwrap_or_else(|err| err.into_inner());
    }
}

fn note_background_yield(inner: &Inner, generation: u64) {
    let mut board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    if board.generation == generation {
        board.background_yields = board.background_yields.saturating_add(1);
    }
}

fn cache_is_full(inner: &Inner) -> bool {
    let db = inner.db.lock().unwrap_or_else(|err| err.into_inner());
    cache::usage(&db)
        .map(|usage| usage.used_bytes >= usage.limit_bytes)
        .unwrap_or(false)
}

fn note_cache_miss(inner: &Inner, generation: u64) {
    let mut board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    if board.generation == generation {
        board.cache_misses = board.cache_misses.saturating_add(1);
    }
}

fn note_cancelled(inner: &Inner, generation: u64) {
    let mut board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    if board.generation == generation {
        board.cancelled = board.cancelled.saturating_add(1);
    }
}

fn note_cache_capped(inner: &Inner, generation: u64, index: usize) {
    let mut board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    if board.generation != generation {
        return;
    }
    board.cache_capped = true;
    if let Some(item) = board.items.get_mut(index) {
        item.cache_blocked = true;
    }
    release_busy(&mut board, index);
    advance_background_cursor(&mut board);
}

fn refresh_pass(board: &mut Board) {
    if board.items.is_empty() {
        board.pass = Pass::Idle;
        return;
    }
    if pick_p0(board).is_some()
        || pick_visible_missing(board).is_some()
        || pick_direction(board).is_some()
        || pick_overscan(board).is_some()
    {
        board.pass = Pass::Paused;
        return;
    }
    let upgrading = pick_upgrade(board).is_some();
    let background = !board.cache_capped
        && board
            .items
            .iter()
            .enumerate()
            .any(|(index, _)| cache_pending(board, index) || needs_base(board, index));
    board.pass = if upgrading || background {
        Pass::Running
    } else {
        Pass::Completed
    };
}

struct ReadSlot<'a> {
    inner: &'a Inner,
    for_viewer: bool,
}

impl<'a> ReadSlot<'a> {
    fn acquire(inner: &'a Inner) -> Self {
        Self::acquire_kind(inner, false)
    }

    fn acquire_for_viewer(inner: &'a Inner) -> Self {
        {
            let mut board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
            board.viewer_wants_read = true;
        }
        inner.read_wake.notify_all();
        inner.wake.notify_all();
        Self::acquire_kind(inner, true)
    }

    fn acquire_kind(inner: &'a Inner, for_viewer: bool) -> Self {
        let mut board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
        while board.reads_in_use >= board.read_slots.max(1) {
            board = inner
                .read_wake
                .wait(board)
                .unwrap_or_else(|err| err.into_inner());
        }
        board.reads_in_use += 1;
        Self { inner, for_viewer }
    }
}

impl Drop for ReadSlot<'_> {
    fn drop(&mut self) {
        let mut board = self
            .inner
            .board
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        board.reads_in_use = board.reads_in_use.saturating_sub(1);
        if self.for_viewer {
            board.viewer_wants_read = false;
        }
        drop(board);
        self.inner.read_wake.notify_one();
        if self.for_viewer {
            self.inner.wake.notify_all();
        }
    }
}

struct HeavySlot<'a> {
    inner: &'a Inner,
}

impl<'a> HeavySlot<'a> {
    fn acquire_while(inner: &'a Inner, mut allow: impl FnMut() -> bool) -> Option<Self> {
        loop {
            if !allow() {
                return None;
            }
            let mut board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
            if board.heavy_in_use < 1 {
                board.heavy_in_use += 1;
                return Some(Self { inner });
            }
            let (guard, _) = inner
                .heavy_wake
                .wait_timeout(board, Duration::from_millis(200))
                .unwrap_or_else(|err| err.into_inner());
            drop(guard);
        }
    }
}

impl Drop for HeavySlot<'_> {
    fn drop(&mut self) {
        let mut board = self
            .inner
            .board
            .lock()
            .unwrap_or_else(|err| err.into_inner());
        board.heavy_in_use = board.heavy_in_use.saturating_sub(1);
        self.inner.heavy_wake.notify_one();
    }
}

#[cfg(test)]
mod pick_tests {
    use super::{
        cache_pending, claim_item_header, collect_header_jobs, finished_job,
        geometry_headers_pending, geometry_window, grid_blocks_hover_board, new_item,
        pick_background, pick_index, pick_upgrade, pick_visible_missing, read_slots_for,
        refresh_pass, session_if_current, should_yield, viewport_base_ready,
        viewport_quality_ready, Board, Item, LoadMode, Pass, FAIR_SHARE_EVERY, HEADER_ATTEMPTS,
        HEADER_BATCH,
    };
    use crate::storage::StorageProfile;
    use std::time::Instant;

    fn blank(name: &str) -> Item {
        Item {
            path: name.to_string(),
            size: 1,
            modified_at: 1,
            busy: false,
            failed: false,
            header_done: false,
            cache_checked: false,
            preview_only: false,
            bitmap_held: false,
            ready: [false; 3],
            deferred_heavy: false,
            cache_blocked: false,
            inflight_priority: 0,
        }
    }

    fn sample() -> Board {
        Board {
            generation: 1,
            session: 7,
            folder: String::new(),
            items: (0..40).map(|index| blank(&index.to_string())).collect(),
            visible_start: 10,
            visible_end: 14,
            focus_start: 10,
            focus_end: 12,
            viewport_gen: 1,
            requested_tier: 512,
            background_index: 14,
            background_inflight: 0,
            pass: Pass::Running,
            cache_capped: false,
            viewer_gen: 1,
            viewer_fast: false,
            viewer_dir: 1,
            cache_hits: 0,
            cache_misses: 0,
            cancelled: 0,
            base_ready: 0,
            rate_ready: 0,
            rate_at: Instant::now(),
            background_per_sec: 0.0,
            meta_done: false,
            scrolling: false,
            load_mode: LoadMode::Idle,
            noncritical_since_background: 0,
            background_completed: 0,
            background_yields: 0,
            profile_override: None,
            read_slots: 1,
            reads_in_use: 0,
            heavy_in_use: 0,
            viewer_wants_read: false,
            viewer_index: None,
            viewer_ahead: 5,
            scroll_ahead: 0,
            priming: false,
            geometry_start: 0,
            geometry_end: 0,
        }
    }

    #[test]
    fn cache_in_the_focus_row_precedes_decode_and_overscan() {
        let mut board = sample();
        board.items[11].cache_checked = true;
        assert!(cache_pending(&board, 10));
        assert_eq!(pick_visible_missing(&board), Some(10));
        assert_eq!(pick_index(&board), Some((10, 1)));

        board.items[10].cache_checked = true;
        board.items[10].ready = [true, true, false];
        board.items[12].cache_checked = true;
        board.items[12].ready = [true, true, false];
        board.items[13].cache_checked = true;
        board.items[13].ready = [true, true, false];
        assert_eq!(pick_visible_missing(&board), Some(11));
    }

    #[test]
    fn a_missing_visible_thumb_precedes_an_upgrade() {
        let mut board = sample();
        for index in 10..14 {
            board.items[index].cache_checked = true;
            board.items[index].header_done = true;
            board.items[index].ready = [true, true, false];
        }
        board.items[11].ready = [false; 3];
        assert_eq!(pick_index(&board), Some((11, 1)));
    }

    #[test]
    fn the_open_photo_precedes_a_visible_cache_check() {
        let mut board = sample();
        board.viewer_index = Some(30);
        assert_eq!(pick_index(&board), Some((30, 0)));
    }

    #[test]
    fn idle_visible_upgrade_precedes_nearby_prefetch() {
        let mut board = sample();
        board.load_mode = LoadMode::Idle;
        for item in &mut board.items {
            item.cache_checked = true;
            item.header_done = true;
            item.ready = [true, true, false];
        }
        for index in 10..14 {
            board.items[index].ready = [true, false, false];
        }
        board.items[20].ready = [false; 3];
        assert_eq!(pick_index(&board), Some((10, 4)));
    }

    #[test]
    fn scrolling_nearby_prefetch_precedes_visible_upgrade() {
        let mut board = sample();
        board.load_mode = LoadMode::Scrolling;
        board.scrolling = true;
        board.scroll_ahead = 1;
        for item in &mut board.items {
            item.cache_checked = true;
            item.header_done = true;
            item.ready = [true, true, false];
        }
        for index in 10..14 {
            board.items[index].ready = [true, false, false];
        }
        board.items[20].ready = [false; 3];
        assert_eq!(pick_index(&board), Some((20, 2)));
    }

    #[test]
    fn fast_scrolling_skips_visible_upgrade() {
        let mut board = sample();
        board.load_mode = LoadMode::FastScrolling;
        board.scrolling = true;
        board.scroll_ahead = 1;
        for item in &mut board.items {
            item.cache_checked = true;
            item.header_done = true;
            item.ready = [true, true, false];
        }
        for index in 10..14 {
            board.items[index].ready = [true, false, false];
        }
        assert!(pick_upgrade(&board).is_some());
        // Prefetch ahead hole → P2, never the visible P4 upgrade.
        board.items[20].ready = [false; 3];
        assert_eq!(pick_index(&board), Some((20, 2)));
        // Prefetch saturated; index 0 is outside the asymmetric window → P5, still not P4.
        board.items[20].ready = [true, true, false];
        board.items[0].ready = [false; 3];
        assert_eq!(pick_index(&board), Some((0, 5)));
    }

    #[test]
    fn fair_share_inserts_background_during_upgrade_stream() {
        let mut board = sample();
        board.load_mode = LoadMode::Idle;
        board.noncritical_since_background = FAIR_SHARE_EVERY;
        for item in &mut board.items {
            item.cache_checked = true;
            item.header_done = true;
            item.ready = [true, true, false];
        }
        for index in 10..14 {
            board.items[index].ready = [true, false, false];
        }
        board.items[30].ready = [false; 3];
        assert!(pick_upgrade(&board).is_some());
        assert_eq!(pick_index(&board), Some((30, 5)));
    }

    #[test]
    fn background_does_not_outrank_visible_missing() {
        let mut board = sample();
        board.load_mode = LoadMode::Idle;
        board.noncritical_since_background = FAIR_SHARE_EVERY;
        for item in &mut board.items {
            item.cache_checked = true;
            item.header_done = true;
            item.ready = [true, true, false];
        }
        board.items[11].ready = [false; 3];
        board.items[30].ready = [false; 3];
        assert_eq!(pick_index(&board), Some((11, 1)));
    }

    #[test]
    fn background_p5_does_not_yield_only_for_optional_upgrade() {
        let mut board = sample();
        for item in &mut board.items {
            item.cache_checked = true;
            item.header_done = true;
            item.ready = [true, true, false];
        }
        for index in 10..14 {
            board.items[index].ready = [true, false, false];
        }
        let background = finished_job(1, 1, 1, 20, "bg".into(), 1, 1, vec![256], false, 5);
        assert!(pick_upgrade(&board).is_some());
        assert!(!should_yield(&board, &background));
    }

    #[test]
    fn viewport_ready_helpers_track_base_and_quality() {
        let mut board = sample();
        for item in &mut board.items {
            item.cache_checked = true;
            item.header_done = true;
            item.ready = [true, true, false];
        }
        board.requested_tier = 512;
        assert!(viewport_base_ready(&board));
        assert!(viewport_quality_ready(&board));
        board.items[11].ready = [true, false, false];
        assert!(viewport_base_ready(&board));
        assert!(!viewport_quality_ready(&board));
        board.items[12].ready = [false; 3];
        assert!(!viewport_base_ready(&board));
    }

    #[test]
    fn background_starts_below_the_viewport_without_a_header() {
        let mut board = sample();
        for item in &mut board.items {
            item.cache_checked = true;
            item.ready = [true, true, false];
        }
        board.items[39].ready = [false; 3];
        board.items[39].header_done = false;
        assert_eq!(pick_index(&board), Some((39, 5)));
        board.items[39].busy = true;
        assert_eq!(pick_index(&board), None);
    }

    #[test]
    fn a_settled_folder_does_not_keep_decoding() {
        let mut board = sample();
        for item in &mut board.items {
            item.cache_checked = true;
            item.header_done = true;
            item.ready = [true, true, false];
        }
        assert_eq!(pick_index(&board), None);
        refresh_pass(&mut board);
        assert_eq!(board.pass, Pass::Completed);
    }

    #[test]
    fn a_larger_cached_tier_covers_a_smaller_tile() {
        let mut board = sample();
        board.requested_tier = 256;
        for item in &mut board.items {
            item.cache_checked = true;
            item.header_done = true;
            item.ready = [false, true, false];
        }
        assert_eq!(pick_index(&board), None);
    }

    #[test]
    fn an_open_viewer_read_pauses_background_and_keeps_the_open_thumb() {
        let mut board = sample();
        assert!(pick_background(&board).is_some());
        board.viewer_wants_read = true;
        assert!(pick_background(&board).is_none());
        let background = finished_job(1, 1, 1, 20, "bg".into(), 1, 1, vec![256], false, 5);
        let open_thumb = finished_job(1, 1, 1, 11, "open".into(), 1, 1, vec![256], false, 0);
        let visible = finished_job(1, 1, 1, 12, "visible".into(), 1, 1, vec![256], false, 1);
        assert!(should_yield(&board, &background));
        assert!(!should_yield(&board, &open_thumb));
        assert!(!should_yield(&board, &visible));
    }

    #[test]
    fn photo_hover_is_not_blocked_by_upgrades_or_background_work() {
        let mut board = sample();
        board.meta_done = true;
        board.geometry_start = 0;
        board.geometry_end = board.items.len();
        for item in &mut board.items {
            item.cache_checked = true;
            item.header_done = true;
            item.ready = [true, false, false];
        }
        board.viewer_index = Some(20);
        board.background_index = 14;
        assert!(!grid_blocks_hover_board(&board));
        assert!(pick_upgrade(&board).is_some() || pick_background(&board).is_some());
    }

    #[test]
    fn a_stale_generation_does_not_keep_its_session() {
        let board = sample();
        assert_eq!(session_if_current(&board, 1), Some(7));
        assert_eq!(session_if_current(&board, 0), None);
        assert_eq!(session_if_current(&board, 2), None);
    }

    #[test]
    fn a_queue_reorder_keeps_the_directory_session() {
        let mut board = sample();
        board.generation = board.generation.wrapping_add(1);
        assert_eq!(session_if_current(&board, 2), Some(7));
        assert_eq!(session_if_current(&board, 1), None);
    }

    #[test]
    fn a_stale_directory_session_is_below_the_board_session() {
        let board = sample();
        assert!(3 < board.session);
        assert_eq!(board.session, 7);
    }

    #[test]
    fn read_slots_default_to_hdd_until_a_folder_is_known() {
        assert_eq!(read_slots_for("", None), StorageProfile::Hdd.read_slots());
        assert_eq!(
            read_slots_for("", Some(StorageProfile::Ssd)),
            StorageProfile::Ssd.read_slots()
        );
        assert_eq!(
            read_slots_for("Z:\\photos", Some(StorageProfile::Ssd)),
            StorageProfile::Ssd.read_slots()
        );
    }

    #[test]
    fn open_folder_matches_ignores_case_and_slashes() {
        assert!(super::open_folder_matches(r"C:\Photos", r"c:/photos/"));
        assert!(!super::open_folder_matches(r"C:\Photos", r"D:\Photos"));
        assert!(!super::open_folder_matches("", r"C:\Photos"));
    }

    #[test]
    fn clamp_index_range_stays_inside_the_listing() {
        assert_eq!(super::clamp_index_range(0, 80, 40), (0, 40));
        assert_eq!(super::clamp_index_range(12, 8, 40), (12, 12));
        assert_eq!(super::clamp_index_range(0, 17, 100), (0, 17));
    }

    #[test]
    fn first_geometry_window_is_independent_of_the_visible_decode_range() {
        let mut board = sample();
        board.visible_start = 0;
        board.visible_end = 32;
        board.geometry_start = 0;
        board.geometry_end = 36;
        assert_eq!(geometry_window(&board), (0, 36));
        assert_ne!(board.visible_end, geometry_window(&board).1);
    }

    #[test]
    fn geometry_headers_block_thumbnail_picks_but_keep_p0() {
        let mut board = sample();
        board.geometry_start = 0;
        board.geometry_end = 12;
        assert!(geometry_headers_pending(&board));
        assert_eq!(pick_index(&board), None);
        board.viewer_index = Some(30);
        assert_eq!(pick_index(&board), Some((30, 0)));
        for item in &mut board.items[..12] {
            item.header_done = true;
        }
        board.viewer_index = None;
        assert!(!geometry_headers_pending(&board));
        assert_eq!(pick_index(&board), Some((10, 1)));
    }

    #[test]
    fn visible_thumbs_yield_while_geometry_headers_are_pending() {
        let mut board = sample();
        board.geometry_end = 12;
        let visible = finished_job(1, 1, 1, 11, "visible".into(), 1, 1, vec![256], false, 1);
        let open = finished_job(1, 1, 1, 11, "open".into(), 1, 1, vec![256], false, 0);
        assert!(should_yield(&board, &visible));
        assert!(!should_yield(&board, &open));
    }

    #[test]
    fn header_jobs_skip_busy_files_and_keep_the_rest_of_the_window() {
        let mut board = sample();
        board.items[0].header_done = true;
        board.items[1].busy = true;
        let jobs = collect_header_jobs(&board, 0, 8, HEADER_BATCH);
        assert_eq!(jobs[0].index, 2);
        assert!(jobs.iter().all(|job| job.index != 1));
    }

    #[test]
    fn header_read_is_a_single_attempt() {
        assert_eq!(HEADER_ATTEMPTS, 1);
    }

    #[test]
    fn claim_header_is_idempotent_and_ignores_a_late_second_publish() {
        let mut item = new_item("a.jpg".into(), 1, 1);
        assert!(claim_item_header(&mut item));
        assert!(item.header_done);
        assert!(!claim_item_header(&mut item));
        assert!(item.header_done);
    }

    #[test]
    fn shrinking_the_geometry_window_updates_header_priority() {
        let mut board = sample();
        board.geometry_start = 0;
        board.geometry_end = board.items.len();
        assert_eq!(geometry_window(&board), (0, 40));
        assert!(geometry_headers_pending(&board));
        board.geometry_end = 8;
        assert_eq!(geometry_window(&board), (0, 8));
        let jobs = collect_header_jobs(
            &board,
            geometry_window(&board).0,
            geometry_window(&board).1,
            HEADER_BATCH,
        );
        assert!(jobs.iter().all(|job| job.index < 8));
        assert_eq!(jobs.len(), 8);
        for item in &mut board.items[..8] {
            item.header_done = true;
        }
        assert!(!geometry_headers_pending(&board));
        assert_eq!(pick_index(&board), Some((10, 1)));
    }
}

fn idle_loop(inner: Arc<Inner>) {
    loop {
        thread::sleep(Duration::from_secs(60));
        let scrolling = inner
            .board
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .scrolling;
        if scrolling {
            continue;
        }
        let folder = inner
            .board
            .lock()
            .unwrap_or_else(|err| err.into_inner())
            .folder
            .clone();
        let db = inner.db.lock().unwrap_or_else(|err| err.into_inner());
        let _ = cache::maintain_with(&db, &folder);
    }
}
