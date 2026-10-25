use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::{Inner, ReadSlot};
use crate::formats::{self, Format};
use crate::metadata;
use crate::thumbnail::{self, DecodeError, FailureKind};

const FIRST_CAP: usize = 48;
const WINDOW_CAP: usize = 96;
const FAIRNESS_FILES: u32 = 4;
const FAIRNESS_PAUSE: Duration = Duration::from_millis(400);

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Band {
    First,
    Extra,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Admit {
    Run,
    Wait,
    YieldBackground,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PhotoAction {
    Ready,
    Join,
    Start,
    Queue,
}

#[derive(Clone)]
pub(super) struct ScreenFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified_at: i64,
}

pub(super) struct ScreenPlan {
    pub files: Vec<ScreenFile>,
    pub first_end: usize,
}

struct HoverRequest {
    generation: u64,
    path: String,
    order: String,
    first: usize,
    extra: usize,
}

pub(super) struct HoverControl {
    pub generation: u64,
    pending: Option<HoverRequest>,
}

impl Default for HoverControl {
    fn default() -> Self {
        Self {
            generation: 0,
            pending: None,
        }
    }
}

pub(super) struct ClaimGuard<'a> {
    inner: &'a Inner,
    key: String,
}

impl<'a> ClaimGuard<'a> {
    pub(super) fn try_new(inner: &'a Inner, path: &str) -> Option<Self> {
        let key = claim_key(path);
        let mut decoding = inner.decoding.lock().unwrap_or_else(|err| err.into_inner());
        if !decoding.insert(key.clone()) {
            return None;
        }
        Some(Self { inner, key })
    }

    pub(super) fn keep_until_develop(self) {
        // The develop thread releases this path when the rawler call finishes.
        std::mem::forget(self);
    }
}

impl Drop for ClaimGuard<'_> {
    fn drop(&mut self) {
        release_claim(self.inner, &self.key);
    }
}

pub(super) fn release_claim(inner: &Inner, path: &str) {
    let key = claim_key(path);
    inner
        .decoding
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .remove(&key);
    inner.wake.notify_all();
}

pub(super) fn request(inner: &Inner, path: String, order: String, first: usize, extra: usize) {
    if path.trim().is_empty() {
        return;
    }
    let first = first.clamp(1, FIRST_CAP);
    let extra = extra.min(WINDOW_CAP.saturating_sub(first));
    let mut control = inner.hover.lock().unwrap_or_else(|err| err.into_inner());
    control.generation = control.generation.wrapping_add(1);
    let generation = control.generation;
    control.pending = Some(HoverRequest {
        generation,
        path,
        order,
        first,
        extra,
    });
    drop(control);
    wake(inner);
}

pub(super) fn cancel(inner: &Inner) {
    let mut control = inner.hover.lock().unwrap_or_else(|err| err.into_inner());
    control.generation = control.generation.wrapping_add(1);
    control.pending = None;
    drop(control);
    wake(inner);
}

pub(super) fn run(inner: Arc<Inner>) {
    loop {
        let request = wait_request(&inner);
        if generation_now(&inner) != request.generation || folder_is_open(&inner, &request.path) {
            continue;
        }
        let listed = crate::scanner::list_directory(Path::new(&request.path));
        if generation_now(&inner) != request.generation || folder_is_open(&inner, &request.path) {
            continue;
        }
        let view = match listed {
            Ok(view) => view,
            Err(err) => {
                eprintln!("hover list {}: {err}", request.path);
                continue;
            }
        };
        let plan = screen_window(
            &view
                .images
                .iter()
                .map(|file| ScreenFile {
                    name: file.name.clone(),
                    path: file.path.clone(),
                    size: file.size,
                    modified_at: file.modified_at,
                })
                .collect::<Vec<_>>(),
            &request.order,
            request.first,
            request.extra,
        );
        let mut burst = 0u32;
        for (index, file) in plan.files.iter().enumerate() {
            let band = if index < plan.first_end {
                Band::First
            } else {
                Band::Extra
            };
            if !wait_until_run(&inner, request.generation, &request.path, band, &mut burst) {
                break;
            }
            if !warm_file(&inner, request.generation, &request.path, file) {
                break;
            }
            burst = burst.saturating_add(1);
        }
    }
}

pub(super) fn admit(
    band: Band,
    scrolling: bool,
    visible_hot: bool,
    neighbor_hot: bool,
    burst: u32,
    background_pending: bool,
) -> Admit {
    if scrolling || visible_hot {
        Admit::Wait
    } else if burst >= FAIRNESS_FILES && background_pending {
        Admit::YieldBackground
    } else if band == Band::Extra && neighbor_hot {
        Admit::Wait
    } else {
        Admit::Run
    }
}

pub fn photo_action(
    open_busy: bool,
    hover_started: bool,
    same_path: bool,
    covered: bool,
) -> PhotoAction {
    if covered {
        PhotoAction::Ready
    } else if same_path {
        PhotoAction::Join
    } else if open_busy || hover_started {
        PhotoAction::Queue
    } else {
        PhotoAction::Start
    }
}

pub(super) fn screen_window(
    files: &[ScreenFile],
    order: &str,
    first: usize,
    extra: usize,
) -> ScreenPlan {
    let first = first.clamp(1, FIRST_CAP);
    let extra = extra.min(WINDOW_CAP.saturating_sub(first));
    let mut files = files.to_vec();
    sort_files(&mut files, order);
    let keep = first.saturating_add(extra).min(files.len());
    files.truncate(keep);
    ScreenPlan {
        first_end: first.min(files.len()),
        files,
    }
}

fn sort_files(files: &mut [ScreenFile], order: &str) {
    let (key, desc) = match order {
        "date-asc" => ("date", false),
        "name-asc" => ("name", false),
        "name-desc" => ("name", true),
        _ => ("date", true),
    };
    files.sort_by(|left, right| {
        let ordering = if key == "name" {
            natural_cmp(&left.name, &right.name)
        } else {
            left.modified_at
                .cmp(&right.modified_at)
                .then_with(|| natural_cmp(&left.name, &right.name))
        };
        let ordering = if desc { ordering.reverse() } else { ordering };
        ordering.then_with(|| claim_key(&left.path).cmp(&claim_key(&right.path)))
    });
}

fn natural_cmp(left: &str, right: &str) -> std::cmp::Ordering {
    let left = left.to_lowercase();
    let right = right.to_lowercase();
    let mut left_chars = left.chars().peekable();
    let mut right_chars = right.chars().peekable();
    loop {
        match (left_chars.peek().copied(), right_chars.peek().copied()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some(a), Some(b)) if a.is_ascii_digit() && b.is_ascii_digit() => {
                let left_number = take_number(&mut left_chars);
                let right_number = take_number(&mut right_chars);
                let ordering = left_number.cmp(&right_number);
                if ordering != std::cmp::Ordering::Equal {
                    return ordering;
                }
            }
            (Some(_), Some(_)) => {
                let ordering = left_chars.next().cmp(&right_chars.next());
                if ordering != std::cmp::Ordering::Equal {
                    return ordering;
                }
            }
        }
    }
}

fn take_number(chars: &mut std::iter::Peekable<std::str::Chars<'_>>) -> u64 {
    let mut number = 0u64;
    while let Some(ch) = chars.peek().copied() {
        if !ch.is_ascii_digit() {
            break;
        }
        chars.next();
        number = number
            .saturating_mul(10)
            .saturating_add(u64::from(ch as u8 - b'0'));
    }
    number
}

fn warm_file(inner: &Inner, generation: u64, folder: &str, file: &ScreenFile) -> bool {
    if file.size == 0 || file.path.is_empty() {
        return generation_now(inner) == generation;
    }
    if has_thumb(inner, file) {
        return true;
    }
    if !header_ready(inner, file) && !read_header(inner, generation, folder, file) {
        return false;
    }
    if has_thumb(inner, file) || cache_blocked(inner) || failed_before(inner, file) {
        return generation_now(inner) == generation && !folder_is_open(inner, folder);
    }
    let Some(guard) = ClaimGuard::try_new(inner, &file.path) else {
        wait_board(inner, Duration::from_millis(200));
        return generation_now(inner) == generation;
    };
    loop {
        if generation_now(inner) != generation || folder_is_open(inner, folder) {
            drop(guard);
            return false;
        }
        let decoded =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| decode_tile(inner, file)));
        match decoded.unwrap_or(Err(DecodeError::new(
            FailureKind::Failed,
            "hover decoder panicked",
        ))) {
            Ok(()) => break,
            Err(err) if err.message.contains("hover read yielded") => {
                wait_board(inner, Duration::from_millis(150))
            }
            Err(err) if err.kind == FailureKind::NeedsDevelop => break,
            Err(err) => {
                let db = inner
                    .db
                    .lock()
                    .unwrap_or_else(|lock_err| lock_err.into_inner());
                let _ = crate::cache::save_fail(
                    &db,
                    &file.path,
                    file.size,
                    file.modified_at,
                    err.kind.as_str(),
                    &err.message,
                );
                break;
            }
        }
    }
    drop(guard);
    generation_now(inner) == generation && !folder_is_open(inner, folder)
}

fn read_header(inner: &Inner, generation: u64, folder: &str, file: &ScreenFile) -> bool {
    loop {
        if generation_now(inner) != generation || folder_is_open(inner, folder) {
            return false;
        }
        match take_slot(inner) {
            None => wait_board(inner, Duration::from_millis(150)),
            Some(slot) => {
                let meta = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    metadata::read_header(Path::new(&file.path))
                }));
                drop(slot);
                if let Ok(Ok(meta)) = meta {
                    let db = inner.db.lock().unwrap_or_else(|err| err.into_inner());
                    let _ = crate::cache::save_meta(
                        &db,
                        &file.path,
                        file.size,
                        file.modified_at,
                        meta.width,
                        meta.height,
                        meta.orientation,
                    );
                }
                return true;
            }
        }
    }
}

fn decode_tile(inner: &Inner, file: &ScreenFile) -> Result<(), DecodeError> {
    let path = Path::new(&file.path);
    let format = formats::from_path(path);
    if format == Some(Format::Video) {
        // No read slot: Quick Look does its own I/O and a broken file can take seconds.
        let source = thumbnail::decode_path(path, format)?;
        return store_tile(inner, file, source);
    }
    if format.map(Format::backend) == Some(formats::Backend::Raw) {
        let source = {
            let _slot = take_slot(inner)
                .ok_or_else(|| DecodeError::new(FailureKind::Failed, "hover read yielded"))?;
            thumbnail::decode_path(path, format)
        }?;
        return store_tile(inner, file, source);
    }
    if format == Some(Format::Jpeg) {
        let embedded = {
            let _slot = take_slot(inner)
                .ok_or_else(|| DecodeError::new(FailureKind::Failed, "hover read yielded"))?;
            thumbnail::embedded_jpeg(path).filter(|bytes| thumbnail::embedded_covers(bytes, 256))
        };
        if let Some(preview) = embedded {
            let mut source = thumbnail::decode(&preview, Some(Format::Jpeg))?;
            let use_embedded = match crate::metadata::read_header(path) {
                Ok(meta) => {
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
                Err(_) => false,
            };
            if use_embedded {
                return store_tile(inner, file, source);
            }
        }
        let bytes = {
            let _slot = take_slot(inner)
                .ok_or_else(|| DecodeError::new(FailureKind::Failed, "hover read yielded"))?;
            std::fs::read(path).map_err(DecodeError::io)?
        };
        let source = match thumbnail::decode_jpeg_scaled(&bytes, 512) {
            Ok(source) => source,
            Err(err) if err.kind == FailureKind::Unsupported => {
                thumbnail::decode(&bytes, Some(Format::Jpeg))?
            }
            Err(err) => return Err(err),
        };
        let (width, height, orientation, rgb) = thumbnail::bitmap_for_tier(source, 512)?;
        let encoded = thumbnail::encode_bitmap(&rgb, 256)?;
        store_bytes(inner, file, 256, &encoded, width, height, orientation);
        return Ok(());
    }
    let bytes = {
        let _slot = take_slot(inner)
            .ok_or_else(|| DecodeError::new(FailureKind::Failed, "hover read yielded"))?;
        std::fs::read(path).map_err(DecodeError::io)?
    };
    let source = thumbnail::decode_owned(std::sync::Arc::new(bytes), format)?;
    store_tile(inner, file, source)
}

fn store_tile(
    inner: &Inner,
    file: &ScreenFile,
    source: thumbnail::Source,
) -> Result<(), DecodeError> {
    let mut stored = false;
    thumbnail::render_each(source, &[256], |tier, bytes, width, height, orientation| {
        store_bytes(inner, file, tier, &bytes, width, height, orientation);
        stored = true;
    })?;
    if stored {
        Ok(())
    } else {
        Err(DecodeError::new(
            FailureKind::Failed,
            "hover thumbnail was empty",
        ))
    }
}

fn store_bytes(
    inner: &Inner,
    file: &ScreenFile,
    tier: u32,
    bytes: &[u8],
    width: u32,
    height: u32,
    orientation: u8,
) {
    let dest = thumbnail::thumb_path(&file.path, file.size, file.modified_at, tier);
    let thumb = {
        let _write = inner.write.lock().unwrap_or_else(|err| err.into_inner());
        if thumbnail::write_atomic(&dest, bytes).is_err() {
            return;
        }
        dest.to_string_lossy().into_owned()
    };
    let db = inner.db.lock().unwrap_or_else(|err| err.into_inner());
    if crate::cache::publish_thumbnail(
        &db,
        &file.path,
        file.size,
        file.modified_at,
        width,
        height,
        orientation,
        tier,
        &thumb,
        bytes.len() as i64,
        false,
    )
    .is_err()
    {
        crate::cache::discard_thumbnail_file(&thumb);
    }
}

fn take_slot(inner: &Inner) -> Option<ReadSlot<'_>> {
    let mut board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    loop {
        if super::grid_blocks_hover_board(&board) || board.viewer_wants_read {
            inner.read_wake.notify_one();
            return None;
        }
        if board.reads_in_use < board.read_slots.max(1) {
            board.reads_in_use += 1;
            return Some(ReadSlot {
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

fn has_thumb(inner: &Inner, file: &ScreenFile) -> bool {
    let db = inner.db.lock().unwrap_or_else(|err| err.into_inner());
    for tier in [1024u32, 512, 256] {
        if crate::cache::cached_thumb(&db, &file.path, file.size, file.modified_at, tier)
            .ok()
            .flatten()
            .is_some()
        {
            return true;
        }
    }
    false
}

fn header_ready(inner: &Inner, file: &ScreenFile) -> bool {
    let db = inner.db.lock().unwrap_or_else(|err| err.into_inner());
    crate::cache::cached_meta(&db, &file.path, file.size, file.modified_at)
        .ok()
        .flatten()
        .is_some()
}

fn failed_before(inner: &Inner, file: &ScreenFile) -> bool {
    let db = inner.db.lock().unwrap_or_else(|err| err.into_inner());
    crate::cache::cached_fail(&db, &file.path, file.size, file.modified_at)
        .ok()
        .flatten()
        .is_some()
}

fn cache_blocked(inner: &Inner) -> bool {
    super::cache_is_full(inner)
}

fn wait_until_run(
    inner: &Inner,
    generation: u64,
    folder: &str,
    band: Band,
    burst: &mut u32,
) -> bool {
    loop {
        if generation_now(inner) != generation || folder_is_open(inner, folder) {
            return false;
        }
        let snap = snapshot(inner);
        match admit(
            band,
            snap.scrolling,
            snap.visible_hot,
            snap.neighbor_hot,
            *burst,
            snap.background_pending,
        ) {
            Admit::Run => return true,
            Admit::Wait => wait_board(inner, Duration::from_millis(150)),
            Admit::YieldBackground => {
                *burst = 0;
                let started = Instant::now();
                let mark = (snap.base_ready, snap.background_index);
                while started.elapsed() < FAIRNESS_PAUSE {
                    wait_board(inner, Duration::from_millis(50));
                    if generation_now(inner) != generation {
                        return false;
                    }
                    let next = snapshot(inner);
                    if next.visible_hot
                        || next.scrolling
                        || (next.base_ready, next.background_index) != mark
                    {
                        break;
                    }
                }
            }
        }
    }
}

struct Snap {
    scrolling: bool,
    visible_hot: bool,
    neighbor_hot: bool,
    background_pending: bool,
    base_ready: u32,
    background_index: usize,
}

fn snapshot(inner: &Inner) -> Snap {
    let board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    Snap {
        scrolling: board.scrolling,
        visible_hot: super::pick_p0(&board).is_some()
            || super::pick_visible_missing(&board).is_some(),
        neighbor_hot: super::pick_direction(&board).is_some()
            || super::pick_overscan(&board).is_some(),
        background_pending: super::pick_background(&board).is_some(),
        base_ready: board.base_ready,
        background_index: board.background_index,
    }
}

fn wait_request(inner: &Inner) -> HoverRequest {
    let mut control = inner.hover.lock().unwrap_or_else(|err| err.into_inner());
    loop {
        if let Some(request) = control.pending.take() {
            return request;
        }
        control = inner
            .hover_wake
            .wait(control)
            .unwrap_or_else(|err| err.into_inner());
    }
}

fn generation_now(inner: &Inner) -> u64 {
    inner
        .hover
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .generation
}

fn folder_is_open(inner: &Inner, path: &str) -> bool {
    let board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    !board.folder.is_empty() && claim_key(&board.folder) == claim_key(path)
}

fn wait_board(inner: &Inner, pause: Duration) {
    let board = inner.board.lock().unwrap_or_else(|err| err.into_inner());
    let _ = inner
        .wake
        .wait_timeout(board, pause)
        .unwrap_or_else(|err| err.into_inner());
}

fn wake(inner: &Inner) {
    inner.wake.notify_all();
    inner.hover_wake.notify_all();
    inner.read_wake.notify_all();
}

fn claim_key(path: &str) -> String {
    path.replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str, modified: i64) -> ScreenFile {
        ScreenFile {
            name: name.to_string(),
            path: format!("C:\\photos\\{name}"),
            size: 10,
            modified_at: modified,
        }
    }

    #[test]
    fn the_first_screen_follows_newest_first_and_stays_capped() {
        let files = vec![
            file("img2.jpg", 10),
            file("img10.jpg", 30),
            file("img1.jpg", 20),
        ];
        let plan = screen_window(&files, "date-desc", 2, 8);
        assert_eq!(plan.first_end, 2);
        assert_eq!(plan.files.len(), 3);
        assert_eq!(plan.files[0].name, "img10.jpg");
        assert_eq!(plan.files[1].name, "img1.jpg");
    }

    #[test]
    fn name_order_sorts_numbers_inside_the_filename() {
        let files = vec![file("img10.jpg", 1), file("img2.jpg", 1)];
        let plan = screen_window(&files, "name-asc", 8, 0);
        assert_eq!(plan.files[0].name, "img2.jpg");
        assert_eq!(plan.files[1].name, "img10.jpg");
    }

    #[test]
    fn a_window_never_asks_for_the_whole_folder() {
        let files: Vec<_> = (0..500)
            .map(|index| file(&format!("f{index}.jpg"), index))
            .collect();
        let plan = screen_window(&files, "date-desc", 10_000, 10_000);
        assert!(plan.files.len() <= WINDOW_CAP);
        assert!(plan.first_end <= FIRST_CAP);
    }

    #[test]
    fn visible_work_and_scrolling_hold_a_hover_folder() {
        assert_eq!(
            admit(Band::First, true, false, false, 0, false),
            Admit::Wait
        );
        assert_eq!(
            admit(Band::First, false, true, false, 0, false),
            Admit::Wait
        );
        assert_eq!(admit(Band::First, false, false, true, 0, true), Admit::Run);
    }

    #[test]
    fn extra_screens_wait_for_the_open_folder_neighbors() {
        assert_eq!(
            admit(Band::Extra, false, false, true, 0, false),
            Admit::Wait
        );
        assert_eq!(
            admit(Band::Extra, false, false, false, 0, false),
            Admit::Run
        );
    }

    #[test]
    fn a_long_hover_lets_background_run() {
        assert_eq!(
            admit(Band::First, false, false, false, FAIRNESS_FILES, true),
            Admit::YieldBackground
        );
        assert_eq!(
            admit(Band::First, false, false, false, FAIRNESS_FILES, false),
            Admit::Run
        );
    }

    #[test]
    fn a_covered_photo_is_not_decoded_again() {
        assert_eq!(photo_action(false, false, false, true), PhotoAction::Ready);
        assert_eq!(photo_action(true, false, true, false), PhotoAction::Join);
    }

    #[test]
    fn a_started_hover_photo_is_queued_instead_of_replaced() {
        assert_eq!(photo_action(false, true, false, false), PhotoAction::Queue);
        assert_eq!(photo_action(true, false, false, false), PhotoAction::Queue);
        assert_eq!(photo_action(false, false, false, false), PhotoAction::Start);
    }
}
