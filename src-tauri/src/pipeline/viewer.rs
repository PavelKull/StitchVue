use std::panic::AssertUnwindSafe;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::Emitter;

use super::{HeavySlot, Inner, ReadSlot};
use crate::formats::{self, Backend, Format};
use crate::thumbnail::{self, DecodeError, FailureKind};

const MAX_FILE_BYTES: u64 = 1024 * 1024 * 1024;
const KEEP_FILES: usize = 8;
const KEEP_BYTES: u64 = 256 * 1024 * 1024;
const SENSOR_PIXELS: u64 = 120_000_000;
const DEVELOP_GRACE: std::time::Duration = std::time::Duration::from_millis(400);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerOffer {
    pub preview_path: String,
    pub preview_edge: u32,
    pub native_path: String,
    pub sharp_path: String,
    pub sharp_edge: u32,
    pub token: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FrameEvent {
    path: String,
    frame_path: String,
    long_edge: u32,
    token: u64,
    session: u64,
}

struct Queued {
    path: String,
    size: u64,
    modified_at: i64,
    long_edge: u32,
}

pub struct Slot {
    pub token: u64,
    pub settled: u64,
    pub path: String,
    pub size: u64,
    pub modified_at: i64,
    pub long_edge: u32,
    pub open: bool,
    pub started: bool,
    pub developing: bool,
    queued: Option<Queued>,
}

impl Default for Slot {
    fn default() -> Self {
        Self {
            token: 0,
            settled: 0,
            path: String::new(),
            size: 0,
            modified_at: 0,
            long_edge: 0,
            open: false,
            started: false,
            developing: false,
            queued: None,
        }
    }
}

struct Job {
    token: u64,
    path: String,
    size: u64,
    modified_at: i64,
}

enum Step {
    Done,
    Again,
    HandedOff,
}

pub(super) struct DevelopRequest {
    token: u64,
    path: String,
    size: u64,
    modified_at: i64,
    grace: bool,
}

fn grace_before_develop(preview_published: bool) -> std::time::Duration {
    if preview_published {
        DEVELOP_GRACE
    } else {
        std::time::Duration::ZERO
    }
}

fn job_is_runnable(developing: bool, token: u64, settled: u64, has_path: bool) -> bool {
    has_path && token != settled && !developing
}

fn result_is_current(slot_token: u64, job_token: u64, same_path: bool) -> bool {
    slot_token == job_token && same_path
}

struct Cached {
    path: PathBuf,
    edge: u32,
    full: bool,
}

pub fn offer(
    inner: &Inner,
    path: &str,
    size: u64,
    modified_at: i64,
    long_edge: u32,
) -> ViewerOffer {
    let edge = long_edge.clamp(256, thumbnail::VIEWER_MAX_EDGE);
    let found = cached_offer(inner, path, size, modified_at, edge);
    if found.native || found.missing_format || found.covered {
        return found.offer;
    }
    let mut slot = inner.viewer.lock().unwrap_or_else(|err| err.into_inner());
    let working = slot.token != slot.settled
        && slot.path == path
        && slot.size == size
        && slot.modified_at == modified_at;
    slot.open = true;
    slot.queued = None;
    if working {
        slot.long_edge = slot.long_edge.max(edge);
        let mut offer = found.offer;
        offer.token = slot.token;
        return offer;
    }
    slot.started = false;
    slot.developing = false;
    slot.token = slot.token.wrapping_add(1).max(1);
    slot.settled = slot.token.wrapping_sub(1);
    slot.path = path.to_string();
    slot.size = size;
    slot.modified_at = modified_at;
    slot.long_edge = edge;
    let mut offer = found.offer;
    offer.token = slot.token;
    drop(slot);
    inner.viewer_wake.notify_one();
    offer
}

pub(super) fn prefetch(
    inner: &Inner,
    path: &str,
    size: u64,
    modified_at: i64,
    long_edge: u32,
) -> ViewerOffer {
    let edge = long_edge.clamp(256, thumbnail::VIEWER_MAX_EDGE);
    let found = cached_offer(inner, path, size, modified_at, edge);
    if found.native || found.missing_format || found.covered {
        return found.offer;
    }
    let mut slot = inner.viewer.lock().unwrap_or_else(|err| err.into_inner());
    let same = slot.token != slot.settled
        && slot.path == path
        && slot.size == size
        && slot.modified_at == modified_at;
    let open_busy = slot.token != slot.settled && slot.open && !same;
    let hover_started = slot.token != slot.settled && !slot.open && slot.started && !same;
    let mut offer = found.offer;
    match super::hover::photo_action(open_busy, hover_started, same, false) {
        super::hover::PhotoAction::Ready => offer,
        super::hover::PhotoAction::Join => {
            slot.long_edge = slot.long_edge.max(edge);
            offer.token = slot.token;
            offer
        }
        super::hover::PhotoAction::Queue => {
            slot.queued = Some(Queued {
                path: path.to_string(),
                size,
                modified_at,
                long_edge: edge,
            });
            offer
        }
        super::hover::PhotoAction::Start => {
            slot.open = false;
            slot.started = false;
            slot.developing = false;
            slot.token = slot.token.wrapping_add(1).max(1);
            slot.settled = slot.token.wrapping_sub(1);
            slot.path = path.to_string();
            slot.size = size;
            slot.modified_at = modified_at;
            slot.long_edge = edge;
            offer.token = slot.token;
            drop(slot);
            inner.viewer_wake.notify_one();
            offer
        }
    }
}

pub(super) fn cancel_hover(inner: &Inner) {
    let mut slot = inner.viewer.lock().unwrap_or_else(|err| err.into_inner());
    slot.queued = None;
    if slot.open || slot.started || slot.token == slot.settled {
        return;
    }
    slot.token = slot.token.wrapping_add(1).max(1);
    slot.settled = slot.token;
    slot.path.clear();
    slot.long_edge = 0;
    slot.started = false;
    slot.developing = false;
}

struct Found {
    offer: ViewerOffer,
    native: bool,
    missing_format: bool,
    covered: bool,
}

fn cached_offer(inner: &Inner, path: &str, size: u64, modified_at: i64, edge: u32) -> Found {
    let format = formats::from_path(Path::new(path));
    let native = format.is_some_and(Format::webview_native);
    let hash = thumbnail::identity_hash(path, size, modified_at);
    let cached = frames_for(hash);
    let sharp = covering(&cached, edge);
    if let Some(frame) = sharp {
        touch_cached(&frame.path);
    }
    let preview = preview_thumb(inner, path, size, modified_at);
    let covered = sharp.is_some_and(|frame| frame.edge >= edge || frame.full);
    if covered {
        inner
            .viewer_cache_hits
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
    Found {
        offer: ViewerOffer {
            preview_path: preview.0,
            preview_edge: preview.1,
            native_path: if native {
                path.to_string()
            } else {
                String::new()
            },
            sharp_path: sharp
                .map(|frame| frame.path.to_string_lossy().into_owned())
                .unwrap_or_default(),
            sharp_edge: sharp.map(|frame| frame.edge).unwrap_or(0),
            token: 0,
        },
        native,
        missing_format: format.is_none(),
        covered,
    }
}

pub fn run(inner: Arc<Inner>) {
    let develop = Arc::clone(&inner);
    std::thread::spawn(move || develop_loop(develop));
    loop {
        let job = wait_job(&inner);
        let token = job.token;
        let outcome = std::panic::catch_unwind(AssertUnwindSafe(|| prepare(&inner, &job)))
            .unwrap_or_else(|_| {
                Err(DecodeError::new(
                    FailureKind::Failed,
                    "viewer decoder panicked",
                ))
            });
        match outcome {
            Ok(Step::HandedOff) => continue,
            Ok(Step::Again) if live(&inner, &job) => continue,
            Ok(Step::Again) | Ok(Step::Done) => {}
            Err(err) => {
                eprintln!(
                    "viewer {}: {} ({})",
                    job.path,
                    err.message,
                    err.kind.as_str()
                );
            }
        }
        let mut slot = inner.viewer.lock().unwrap_or_else(|err| err.into_inner());
        if slot.token == token {
            slot.developing = false;
            slot.settled = token;
        }
        drop(slot);
        pump_queued(&inner);
    }
}

fn wait_job(inner: &Inner) -> Job {
    let mut slot = inner.viewer.lock().unwrap_or_else(|err| err.into_inner());
    loop {
        if job_is_runnable(
            slot.developing,
            slot.token,
            slot.settled,
            !slot.path.is_empty(),
        ) {
            return Job {
                token: slot.token,
                path: slot.path.clone(),
                size: slot.size,
                modified_at: slot.modified_at,
            };
        }
        slot = inner
            .viewer_wake
            .wait(slot)
            .unwrap_or_else(|err| err.into_inner());
    }
}

fn prepare(inner: &Inner, job: &Job) -> Result<Step, DecodeError> {
    if !live(inner, job) {
        return Ok(Step::Done);
    }
    let format = formats::from_path(Path::new(&job.path))
        .ok_or_else(|| DecodeError::new(FailureKind::Unsupported, "unknown image extension"))?;
    // Videos play from the file in a <video>; the grid poster is the only frame needed.
    if format.webview_native() || format.backend() == Backend::Video {
        return Ok(Step::Done);
    }
    let edge = fresh_edge(inner, job);
    if edge == 0 {
        return Ok(Step::Done);
    }
    let hash = thumbnail::identity_hash(&job.path, job.size, job.modified_at);
    if let Some(found) = covering(&frames_for(hash), edge) {
        touch_cached(&found.path);
        emit_ready(inner, job, found.path.clone(), found.edge);
        return Ok(Step::Done);
    }
    if !wait_if_hover(inner, job) || !mark_started(inner, job) {
        return Ok(Step::Done);
    }
    let claimed = match claim_decode(inner, job) {
        Some(guard) => guard,
        None => return Ok(Step::Done),
    };
    let step = match format.backend() {
        Backend::Raw => prepare_raw(inner, job, edge),
        Backend::Heif => prepare_decoded(inner, job, edge, true),
        Backend::Avif | Backend::Common => prepare_decoded(inner, job, edge, false),
        Backend::Video => Ok(Step::Done),
    };
    if matches!(step, Ok(Step::HandedOff)) {
        claimed.keep_until_develop();
    }
    step
}

fn prepare_decoded(inner: &Inner, job: &Job, edge: u32, heif: bool) -> Result<Step, DecodeError> {
    if job.size > MAX_FILE_BYTES {
        return Err(DecodeError::new(
            FailureKind::Unsupported,
            "image file exceeds the 1 GiB viewer limit",
        ));
    }
    let bytes = {
        let _slot = ReadSlot::acquire_for_viewer(inner);
        if !live(inner, job) {
            return Ok(Step::Done);
        }
        std::fs::read(&job.path).map_err(DecodeError::io)?
    };
    if !live(inner, job) {
        return Ok(Step::Done);
    }
    let _budget = match wait_budget(
        inner,
        job,
        decode_estimate(Path::new(&job.path), heif, &bytes),
    ) {
        Some(hold) => hold,
        None => return Ok(Step::Done),
    };
    let format = formats::from_path(Path::new(&job.path));
    let source = if heif {
        thumbnail::heif_decode_viewer(&bytes)?
    } else {
        thumbnail::decode_owned(Arc::new(bytes), format)?
    };
    let encoded = thumbnail::encode_viewer(source, edge)?;
    let produced = encoded.width.max(encoded.height);
    let full = produced + 32 < edge;
    publish(inner, job, encoded, full)?;
    let grown = fresh_edge(inner, job);
    if grown > produced.saturating_add(32) && !full && live(inner, job) {
        Ok(Step::Again)
    } else {
        Ok(Step::Done)
    }
}

fn prepare_raw(inner: &Inner, job: &Job, mut edge: u32) -> Result<Step, DecodeError> {
    let mut preview_published = false;
    let embedded = {
        let _slot = ReadSlot::acquire_for_viewer(inner);
        if !live(inner, job) {
            return Ok(Step::Done);
        }
        thumbnail::raw_embedded(Path::new(&job.path))
    };
    match embedded {
        Ok(source) => {
            preview_published = true;
            let preview_edge = source.image.width().max(source.image.height());
            edge = fresh_edge(inner, job).max(edge);
            if crate::thumbnail::raw_preview_covers(preview_edge, edge) {
                let encoded = thumbnail::encode_viewer(source, edge)?;
                let produced = encoded.width.max(encoded.height);
                publish(inner, job, encoded, false)?;
                let grown = fresh_edge(inner, job);
                if !live(inner, job) {
                    return Ok(Step::Done);
                }
                if grown > preview_edge || grown > produced.saturating_add(32) {
                    return Ok(Step::Again);
                }
                return Ok(Step::Done);
            }
            let fast =
                thumbnail::encode_viewer(source, preview_edge.min(thumbnail::VIEWER_MAX_EDGE))?;
            publish(inner, job, fast, false)?;
        }
        Err(err) if err.kind == FailureKind::NeedsDevelop => {}
        Err(err) => return Err(err),
    }
    if !live(inner, job) {
        return Ok(Step::Done);
    }
    if let Ok(meta) = thumbnail::raw_header(Path::new(&job.path)) {
        let pixels = u64::from(meta.width) * u64::from(meta.height);
        if pixels > SENSOR_PIXELS {
            return Err(DecodeError::new(
                FailureKind::Unsupported,
                "RAW sensor exceeds the viewer pixel cap",
            ));
        }
    }
    if !live(inner, job) {
        return Ok(Step::Done);
    }
    if post_develop(inner, job, preview_published) {
        Ok(Step::HandedOff)
    } else {
        Ok(Step::Done)
    }
}

fn publish(
    inner: &Inner,
    job: &Job,
    image: thumbnail::ViewerImage,
    full: bool,
) -> Result<(), DecodeError> {
    if !live(inner, job) {
        return Ok(());
    }
    let edge = image.width.max(image.height);
    let hash = thumbnail::identity_hash(&job.path, job.size, job.modified_at);
    let ext = if image.png { "png" } else { "jpg" };
    let name = if full {
        format!("{hash:016x}-full-{edge}.{ext}")
    } else {
        format!("{hash:016x}-{edge}.{ext}")
    };
    let dest = viewer_dir().join(name);
    thumbnail::write_atomic(&dest, &image.bytes)
        .map_err(|err| DecodeError::new(FailureKind::Io, err))?;
    trim_cache(&dest);
    emit_ready(inner, job, dest, edge);
    Ok(())
}

fn emit_ready(inner: &Inner, job: &Job, path: PathBuf, edge: u32) {
    if !live(inner, job) {
        return;
    }
    let session = inner
        .board
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .session;
    let _ = inner.app.emit(
        "viewer-frame-ready",
        FrameEvent {
            path: job.path.clone(),
            frame_path: path.to_string_lossy().into_owned(),
            long_edge: edge,
            token: job.token,
            session,
        },
    );
}

fn preview_thumb(inner: &Inner, path: &str, size: u64, modified_at: i64) -> (String, u32) {
    let db = inner.db.lock().unwrap_or_else(|err| err.into_inner());
    for tier in [1024u32, 512, 256] {
        if let Ok(Some(thumb)) = crate::cache::cached_thumb(&db, path, size, modified_at, tier) {
            return (thumb, tier);
        }
    }
    (String::new(), 0)
}

fn pump_queued(inner: &Inner) {
    let mut slot = inner.viewer.lock().unwrap_or_else(|err| err.into_inner());
    if slot.token != slot.settled {
        return;
    }
    let Some(next) = slot.queued.take() else {
        return;
    };
    slot.open = false;
    slot.started = false;
    slot.developing = false;
    slot.token = slot.token.wrapping_add(1).max(1);
    slot.settled = slot.token.wrapping_sub(1);
    slot.path = next.path;
    slot.size = next.size;
    slot.modified_at = next.modified_at;
    slot.long_edge = next.long_edge;
    drop(slot);
    inner.viewer_wake.notify_one();
}

fn wait_if_hover(inner: &Inner, job: &Job) -> bool {
    loop {
        {
            let slot = inner.viewer.lock().unwrap_or_else(|err| err.into_inner());
            if slot.token != job.token || slot.path != job.path {
                return false;
            }
            if slot.open {
                return true;
            }
        }
        if !super::grid_blocks_hover(inner) {
            return live(inner, job);
        }
        let board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
        let _ = inner
            .wake
            .wait_timeout(board, std::time::Duration::from_millis(150))
            .unwrap_or_else(|err| err.into_inner());
    }
}

fn mark_started(inner: &Inner, job: &Job) -> bool {
    let mut slot = inner.viewer.lock().unwrap_or_else(|err| err.into_inner());
    if slot.token != job.token || slot.path != job.path {
        return false;
    }
    slot.started = true;
    true
}

fn claim_decode<'a>(inner: &'a Inner, job: &Job) -> Option<super::hover::ClaimGuard<'a>> {
    loop {
        if !live(inner, job) {
            return None;
        }
        if let Some(guard) = super::hover::ClaimGuard::try_new(inner, &job.path) {
            return Some(guard);
        }
        let board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
        let _ = inner
            .wake
            .wait_timeout(board, std::time::Duration::from_millis(200))
            .unwrap_or_else(|err| err.into_inner());
    }
}

fn live(inner: &Inner, job: &Job) -> bool {
    let slot = inner.viewer.lock().unwrap_or_else(|err| err.into_inner());
    result_is_current(slot.token, job.token, slot.path == job.path)
}

fn fresh_edge(inner: &Inner, job: &Job) -> u32 {
    let slot = inner.viewer.lock().unwrap_or_else(|err| err.into_inner());
    if slot.token != job.token {
        0
    } else {
        slot.long_edge.clamp(256, thumbnail::VIEWER_MAX_EDGE)
    }
}

fn viewer_dir() -> PathBuf {
    crate::database::app_dir().join("cache").join("viewer")
}

fn covering(frames: &[Cached], edge: u32) -> Option<&Cached> {
    if let Some(frame) = frames
        .iter()
        .filter(|frame| frame.edge >= edge)
        .min_by_key(|frame| frame.edge)
    {
        return Some(frame);
    }
    frames.iter().find(|frame| frame.full)
}

fn frames_for(hash: u64) -> Vec<Cached> {
    let dir = viewer_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let prefix = format!("{hash:016x}-");
    entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name();
            let name = name.to_str()?;
            let (edge, full) = parse_frame_name(name)?;
            if !name.starts_with(&prefix) {
                return None;
            }
            Some(Cached {
                path: entry.path(),
                edge,
                full,
            })
        })
        .collect()
}

fn parse_frame_name(name: &str) -> Option<(u32, bool)> {
    let stem = name.split('.').next()?;
    let mut parts = stem.split('-');
    let _hash = parts.next()?;
    let marker = parts.next()?;
    if marker == "full" {
        let edge = parts.next()?.parse().ok()?;
        Some((edge, true))
    } else {
        let edge = marker.parse().ok()?;
        Some((edge, false))
    }
}

fn trim_cache(keep: &Path) {
    let dir = viewer_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    let mut files: Vec<(PathBuf, u64, std::time::SystemTime)> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let path = entry.path();
            if path == keep {
                return None;
            }
            let meta = entry.metadata().ok()?;
            Some((
                path,
                meta.len(),
                meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH),
            ))
        })
        .collect();
    files.sort_by_key(|file| file.2);
    let mut count = files.len() + 1;
    let mut bytes: u64 = files.iter().map(|file| file.1).sum();
    for (path, len, _) in files {
        if count <= KEEP_FILES && bytes <= KEEP_BYTES {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            count = count.saturating_sub(1);
            bytes = bytes.saturating_sub(len);
        }
    }
}

fn touch_cached(path: &Path) {
    let Ok(file) = std::fs::OpenOptions::new().write(true).open(path) else {
        return;
    };
    let _ = file.set_modified(std::time::SystemTime::now());
}

fn wait_grace(inner: &Inner, job: &Job, grace: std::time::Duration) -> bool {
    if grace.is_zero() {
        return live(inner, job);
    }
    let start = std::time::Instant::now();
    while start.elapsed() < grace {
        if !live(inner, job) {
            return false;
        }
        let left = grace.saturating_sub(start.elapsed());
        std::thread::sleep(std::time::Duration::from_millis(50).min(left));
    }
    live(inner, job)
}

fn decode_estimate(path: &Path, heif: bool, bytes: &[u8]) -> u64 {
    let pixels = if heif {
        header_pixels(thumbnail::heif_header(path).ok())
    } else if formats::from_path(path).is_some_and(|format| format.backend() == Backend::Avif) {
        header_pixels(thumbnail::avif_header(path).ok())
    } else {
        common_pixels(bytes, formats::from_path(path))
    };
    match pixels {
        Some(pixels) => thumbnail::bitmap_estimate(pixels),
        None => (bytes.len() as u64).saturating_mul(16).max(1),
    }
}

fn header_pixels(meta: Option<crate::metadata::HeaderMeta>) -> Option<u64> {
    let meta = meta?;
    Some(u64::from(meta.width).saturating_mul(u64::from(meta.height)))
}

fn common_pixels(bytes: &[u8], format: Option<Format>) -> Option<u64> {
    let cursor = std::io::Cursor::new(bytes);
    let reader = match format.and_then(Format::image_format) {
        Some(hint) => image::ImageReader::with_format(cursor, hint),
        None => image::ImageReader::new(cursor).with_guessed_format().ok()?,
    };
    let (width, height) = reader.into_dimensions().ok()?;
    Some(u64::from(width).saturating_mul(u64::from(height)))
}

fn wait_budget(inner: &Inner, job: &Job, estimate: u64) -> Option<thumbnail::HeavyHold> {
    loop {
        if !live(inner, job) {
            return None;
        }
        if let Some(hold) = thumbnail::HeavyHold::reserve(estimate.max(1)) {
            return Some(hold);
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}

fn post_develop(inner: &Inner, job: &Job, grace: bool) -> bool {
    {
        let mut slot = inner.viewer.lock().unwrap_or_else(|err| err.into_inner());
        if !result_is_current(slot.token, job.token, slot.path == job.path) {
            return false;
        }
        slot.developing = true;
    }
    let request = DevelopRequest {
        token: job.token,
        path: job.path.clone(),
        size: job.size,
        modified_at: job.modified_at,
        grace,
    };
    let mut mail = inner
        .develop_mail
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    if let Some(previous) = mail.replace(request) {
        if previous.path != job.path {
            super::hover::release_claim(inner, &previous.path);
        }
    }
    drop(mail);
    inner.develop_wake.notify_one();
    true
}

fn develop_loop(inner: Arc<Inner>) {
    loop {
        let job = wait_develop(&inner);
        let outcome = std::panic::catch_unwind(AssertUnwindSafe(|| run_develop(&inner, &job)));
        match outcome {
            Ok(Ok(())) => {}
            Ok(Err(err)) => {
                eprintln!(
                    "viewer develop {}: {} ({})",
                    job.path,
                    err.message,
                    err.kind.as_str()
                );
            }
            Err(_) => eprintln!("viewer develop panicked: {}", job.path),
        }
        finish_develop(&inner, &job);
    }
}

fn wait_develop(inner: &Inner) -> DevelopRequest {
    let mut mail = inner
        .develop_mail
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    loop {
        if let Some(job) = mail.take() {
            return job;
        }
        mail = inner
            .develop_wake
            .wait(mail)
            .unwrap_or_else(|err| err.into_inner());
    }
}

fn run_develop(inner: &Inner, job: &DevelopRequest) -> Result<(), DecodeError> {
    let current = Job {
        token: job.token,
        path: job.path.clone(),
        size: job.size,
        modified_at: job.modified_at,
    };
    if !live(inner, &current) {
        return Ok(());
    }
    if !wait_grace(inner, &current, grace_before_develop(job.grace)) {
        return Ok(());
    }
    let pixels = thumbnail::raw_header(Path::new(&job.path))
        .map(|meta| u64::from(meta.width).saturating_mul(u64::from(meta.height)))
        .unwrap_or(16_000_000);
    if pixels > SENSOR_PIXELS {
        return Err(DecodeError::new(
            FailureKind::Unsupported,
            "RAW sensor exceeds the viewer pixel cap",
        ));
    }
    if !live(inner, &current) {
        return Ok(());
    }
    let _budget = match wait_budget(inner, &current, thumbnail::bitmap_estimate(pixels)) {
        Some(hold) => hold,
        None => return Ok(()),
    };
    if !live(inner, &current) {
        return Ok(());
    }
    let heavy = HeavySlot::acquire_while(inner, || live(inner, &current));
    if heavy.is_none() || !live(inner, &current) {
        return Ok(());
    }
    // rawler opens the file itself. Leaving ReadSlot free lets the viewer thread
    // load the newly opened frame's embedded preview while this develop finishes.
    let started = std::time::Instant::now();
    let source = thumbnail::develop_raw_path(Path::new(&job.path))?;
    inner.raw_develop_ms.store(
        started.elapsed().as_millis() as u64,
        std::sync::atomic::Ordering::Relaxed,
    );
    if !live(inner, &current) {
        return Ok(());
    }
    let encoded = thumbnail::encode_viewer(source, thumbnail::VIEWER_MAX_EDGE)?;
    publish(inner, &current, encoded, true)
}

fn finish_develop(inner: &Inner, job: &DevelopRequest) {
    super::hover::release_claim(inner, &job.path);
    let mut slot = inner.viewer.lock().unwrap_or_else(|err| err.into_inner());
    if result_is_current(slot.token, job.token, slot.path == job.path) {
        slot.developing = false;
        slot.settled = job.token;
    } else {
        inner
            .stale_tasks
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
    drop(slot);
    pump_queued(inner);
    inner.viewer_wake.notify_one();
}

#[cfg(test)]
mod tests {
    use super::{grace_before_develop, job_is_runnable, parse_frame_name, result_is_current};
    use std::time::Duration;

    #[test]
    fn frame_names_distinguish_a_scaled_jpeg_from_a_developed_cap() {
        assert_eq!(
            parse_frame_name("0123456789abcdef-1800.jpg"),
            Some((1800, false))
        );
        assert_eq!(
            parse_frame_name("0123456789abcdef-full-6144.png"),
            Some((6144, true))
        );
        assert_eq!(parse_frame_name("nope.jpg"), None);
    }

    #[test]
    fn a_new_open_runs_while_the_previous_develop_is_still_in_flight() {
        assert!(!job_is_runnable(true, 2, 1, true));
        assert!(job_is_runnable(false, 3, 1, true));
        assert!(!job_is_runnable(false, 3, 3, true));
        assert!(!job_is_runnable(false, 3, 1, false));
    }

    #[test]
    fn a_stale_develop_does_not_publish() {
        assert!(!result_is_current(4, 2, true));
        assert!(!result_is_current(2, 2, false));
        assert!(result_is_current(2, 2, true));
    }

    #[test]
    fn a_visible_preview_waits_before_the_heavy_develop() {
        assert_eq!(grace_before_develop(true), Duration::from_millis(400));
        assert_eq!(grace_before_develop(false), Duration::ZERO);
    }
}
