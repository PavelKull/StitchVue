use std::collections::{HashSet, VecDeque};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;

mod content_hash;
mod favorite_duplicate_hint;
mod open_explorer;
pub(crate) mod fav_metrics;
pub(crate) mod favorite_perf;
pub(crate) mod favorites;
pub(crate) mod favorites_batch;
#[cfg(test)]
mod favorites_bench;
#[cfg(test)]
mod favorites_copy_recovery;
#[cfg(test)]
mod favorites_trash_lifecycle;
mod favorites_trash_lifecycle_final;
#[cfg(test)]
mod favorites_lifecycle;
mod locks;
#[cfg(test)]
mod p0_safe_favorites;
#[cfg(test)]
mod p4_dispatch;
#[cfg(test)]
mod p5_batch;
mod p1_identity_gate;
#[cfg(test)]
mod p2_reconcile_scope;
#[cfg(test)]
mod update_gate;
pub mod reconcile;
pub mod recycle;
pub(crate) mod trash_folder;

pub use favorites::RemoveFavoriteCopyResult;
pub use favorites_batch::{FavoriteBatchPathResult, FavoriteBatchRemoveItem, FavoriteCopyOrigin};
pub use open_explorer::open_folder_in_explorer;
// ServiceFolderCleanupResult is defined in this module.
pub use content_hash::sha256_file;
pub(crate) use favorite_duplicate_hint::favorite_duplicate_hints_for_paths;
pub use locks::{try_claim_favorite_removal, try_lock_paths};
pub(crate) use recycle::recycle_path;
pub use recycle::RecycleStatus;

pub const LOCAL_TRASH: &str = "Удаленное";
pub const LOCAL_FAVORITES: &str = "Избранное";
pub const LOCAL_FAVORITES_ALT: &str = "Избранная";
pub(crate) const ROLE_FILE: &str = ".stitchvue.role";
pub(crate) const COPY_CHUNK: usize = 1024 * 1024;
const MAX_SUFFIX: u32 = 10_000;
const RESULT_CACHE: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    MoveToLocalTrash,
    CopyToLocalFavorites,
}

impl Action {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "move_to_local_trash" => Some(Self::MoveToLocalTrash),
            "copy_to_local_favorites" => Some(Self::CopyToLocalFavorites),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::MoveToLocalTrash => "move_to_local_trash",
            Self::CopyToLocalFavorites => "copy_to_local_favorites",
        }
    }

    pub fn folder_name(self) -> &'static str {
        match self {
            Self::MoveToLocalTrash => LOCAL_TRASH,
            Self::CopyToLocalFavorites => LOCAL_FAVORITES,
        }
    }

    pub fn role(self) -> ServiceRole {
        match self {
            Self::MoveToLocalTrash => ServiceRole::Trash,
            Self::CopyToLocalFavorites => ServiceRole::Favorites,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceRole {
    Favorites,
    Trash,
}

impl ServiceRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Favorites => "favorites",
            Self::Trash => "trash",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim() {
            "favorites" => Some(Self::Favorites),
            "trash" => Some(Self::Trash),
            _ => None,
        }
    }
}

pub struct OperationRequest {
    pub operation_id: String,
    pub directory: String,
    pub action: Action,
    pub paths: Vec<String>,
}

pub fn file_op_log_id(operation_id: &str, source_path: &str) -> String {
    format!("{}:{}", operation_id, normalize_key(Path::new(source_path)))
}

/// Called after the copy target path is reserved and before irreversible IO (temp file / copy).
pub type PendingDestinationJournal = dyn Fn(&str, &str) + Sync;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOutcome {
    pub source_path: String,
    pub status: String,
    pub destination_path: Option<String>,
    pub renamed_due_to_collision: bool,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub attribute_note: Option<String>,
    /// SHA-256 of source bytes when copied for favorites (avoids re-reading origin).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_content_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOperationResult {
    pub operation_id: String,
    pub directory: String,
    pub action: String,
    pub state: String,
    pub requested: u32,
    pub outcomes: Vec<FileOutcome>,
    pub destination_folder: Option<String>,
    pub destination_created: bool,
    pub destination_role: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileOperationProgress {
    pub operation_id: String,
    pub directory: String,
    pub state: String,
    pub phase: String,
    pub processed: u32,
    pub total: u32,
    pub bytes_done: u64,
    pub bytes_total: u64,
}

pub enum Claim {
    Start(Arc<AtomicBool>),
    Replay(FileOperationResult),
    Busy,
}

struct Registry {
    active: std::collections::HashMap<String, Arc<AtomicBool>>,
    done: VecDeque<(String, FileOperationResult)>,
}

/// Блокирует новые `claim` на время download/install обновления.
static UPDATE_PREPARE: AtomicBool = AtomicBool::new(false);

fn registry() -> &'static Mutex<Registry> {
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        Mutex::new(Registry {
            active: std::collections::HashMap::new(),
            done: VecDeque::new(),
        })
    })
}

pub fn any_file_operation_in_progress() -> bool {
    let registry = registry().lock().unwrap_or_else(|err| err.into_inner());
    !registry.active.is_empty()
}

pub fn begin_app_update_prepare() -> Result<(), String> {
    let registry = registry().lock().unwrap_or_else(|err| err.into_inner());
    if !registry.active.is_empty() {
        return Err("file_operation_in_progress".to_string());
    }
    UPDATE_PREPARE.store(true, Ordering::SeqCst);
    if !registry.active.is_empty() {
        UPDATE_PREPARE.store(false, Ordering::SeqCst);
        return Err("update_prepare_failed".to_string());
    }
    Ok(())
}

pub fn end_app_update_prepare() {
    UPDATE_PREPARE.store(false, Ordering::SeqCst);
}

pub fn claim(operation_id: &str) -> Claim {
    if UPDATE_PREPARE.load(Ordering::SeqCst) {
        return Claim::Busy;
    }
    let mut registry = registry().lock().unwrap_or_else(|err| err.into_inner());
    if let Some((_, result)) = registry.done.iter().find(|(id, _)| id == operation_id) {
        return Claim::Replay(result.clone());
    }
    if registry.active.contains_key(operation_id) {
        return Claim::Busy;
    }
    let cancel = Arc::new(AtomicBool::new(false));
    registry
        .active
        .insert(operation_id.to_string(), Arc::clone(&cancel));
    Claim::Start(cancel)
}

pub fn complete(operation_id: &str, result: FileOperationResult) {
    let mut registry = registry().lock().unwrap_or_else(|err| err.into_inner());
    registry.active.remove(operation_id);
    registry.done.push_back((operation_id.to_string(), result));
    while registry.done.len() > RESULT_CACHE {
        registry.done.pop_front();
    }
}

pub fn abandon(operation_id: &str) {
    let mut registry = registry().lock().unwrap_or_else(|err| err.into_inner());
    registry.active.remove(operation_id);
}

pub fn cancel(operation_id: &str) -> bool {
    let registry = registry().lock().unwrap_or_else(|err| err.into_inner());
    registry.active.get(operation_id).is_some_and(|flag| {
        flag.store(true, Ordering::Relaxed);
        true
    })
}

pub trait IoGate: Send + Sync {
    fn wait_visible(&self, cancel: &AtomicBool) -> bool;
    fn with_read<T>(&self, work: impl FnOnce() -> T) -> T;
}

struct Job {
    requested: String,
    path: PathBuf,
}

struct NameLock {
    reserved: HashSet<String>,
}

struct Emitter<'a> {
    on_progress: &'a (dyn Fn(&FileOperationProgress) + Sync),
    operation_id: &'a str,
    directory: &'a str,
    total: u32,
    bytes_total: u64,
    processed: AtomicU32,
    bytes_done: AtomicU64,
    last_emit: Mutex<Instant>,
    state: Mutex<String>,
    phase: Mutex<String>,
}

impl Emitter<'_> {
    fn set_phase(&self, state: &str, phase: &str, force: bool) {
        *self.state.lock().unwrap_or_else(|err| err.into_inner()) = state.to_string();
        *self.phase.lock().unwrap_or_else(|err| err.into_inner()) = phase.to_string();
        self.emit(force);
    }

    fn add_bytes(&self, delta: u64) {
        self.bytes_done.fetch_add(delta, Ordering::Relaxed);
        self.emit(false);
    }

    fn finish_one(&self) {
        self.processed.fetch_add(1, Ordering::Relaxed);
        self.emit(true);
    }

    fn emit(&self, force: bool) {
        let mut last = self.last_emit.lock().unwrap_or_else(|err| err.into_inner());
        if !force && last.elapsed().as_millis() < 200 {
            return;
        }
        *last = Instant::now();
        let progress = FileOperationProgress {
            operation_id: self.operation_id.to_string(),
            directory: self.directory.to_string(),
            state: self
                .state
                .lock()
                .unwrap_or_else(|err| err.into_inner())
                .clone(),
            phase: self
                .phase
                .lock()
                .unwrap_or_else(|err| err.into_inner())
                .clone(),
            processed: self.processed.load(Ordering::Relaxed),
            total: self.total,
            bytes_done: self.bytes_done.load(Ordering::Relaxed),
            bytes_total: self.bytes_total,
        };
        drop(last);
        (self.on_progress)(&progress);
    }
}

#[derive(Clone)]
pub(crate) struct Fail {
    code: &'static str,
    message: String,
}

pub fn execute<G: IoGate>(
    gate: &G,
    request: &OperationRequest,
    copy_slots: usize,
    cancel: &AtomicBool,
    on_progress: &(dyn Fn(&FileOperationProgress) + Sync),
    pending_destination_journal: Option<&PendingDestinationJournal>,
    favorite_duplicate_hints: Option<
        &std::collections::HashMap<String, favorite_duplicate_hint::FavoriteDuplicateHint>,
    >,
) -> Result<FileOperationResult, String> {
    if request.paths.is_empty() {
        return Err("Нет выбранных файлов".to_string());
    }
    let directory = open_directory(&request.directory)?;
    if read_service_role(&directory).is_some() {
        return Err("Недоступно в служебной папке".to_string());
    }

    let mut seen = HashSet::new();
    let mut jobs = Vec::new();
    let mut early = Vec::new();
    for requested in &request.paths {
        let key = normalize_key(Path::new(requested));
        if !seen.insert(key) {
            continue;
        }
        match resolve_source(&directory, requested) {
            Ok(path) => jobs.push(Job {
                requested: requested.clone(),
                path,
            }),
            Err(fail) => early.push(failed_outcome(requested, fail)),
        }
    }

    let total = (early.len() + jobs.len()) as u32;
    let bytes_total = if request.action == Action::CopyToLocalFavorites {
        jobs.iter()
            .map(|job| fs::metadata(&job.path).map(|meta| meta.len()).unwrap_or(0))
            .sum()
    } else {
        0
    };
    let emitter = Emitter {
        on_progress,
        operation_id: &request.operation_id,
        directory: &request.directory,
        total,
        bytes_total,
        processed: AtomicU32::new(early.len() as u32),
        bytes_done: AtomicU64::new(0),
        last_emit: Mutex::new(Instant::now() - std::time::Duration::from_secs(1)),
        state: Mutex::new("validating".to_string()),
        phase: Mutex::new("validating".to_string()),
    };
    emitter.set_phase("validating", "validating", true);

    if jobs.is_empty() {
        emitter.set_phase("failed", "validating", true);
        return Ok(finish(request, early, None));
    }
    if cancel.load(Ordering::Relaxed) {
        let mut outcomes = early;
        for job in jobs {
            outcomes.push(cancelled_outcome(&job.requested));
        }
        emitter.set_phase("cancelled", "validating", true);
        return Ok(finish(request, outcomes, None));
    }

    let (destination, created) = match prepare_action_destination(
        &directory,
        request.action,
    ) {
        Ok(value) => value,
        Err(fail) => {
            let mut outcomes = early;
            for job in jobs {
                outcomes.push(failed_outcome(&job.requested, fail.clone()));
            }
            emitter.set_phase("failed", "validating", true);
            return Ok(finish(request, outcomes, None));
        }
    };
    let destination_info = DestinationNote {
        folder: path_string_for_app(&destination),
        created,
        role: request.action.role().as_str().to_string(),
    };

    let phase = match request.action {
        Action::MoveToLocalTrash => "moving",
        Action::CopyToLocalFavorites => "copying",
    };
    emitter.set_phase("running", phase, true);

    let slots = match request.action {
        Action::MoveToLocalTrash => 1,
        Action::CopyToLocalFavorites => copy_slots.clamp(1, 2),
    };
    let names = Mutex::new(NameLock {
        reserved: HashSet::new(),
    });
    let job_outcomes: Mutex<Vec<Option<FileOutcome>>> = Mutex::new(vec![None; jobs.len()]);
    let next = AtomicU32::new(0);
    let job_count = jobs.len() as u32;

    std::thread::scope(|scope| {
        for _ in 0..slots {
            scope.spawn(|| loop {
                let index = next.fetch_add(1, Ordering::Relaxed);
                if index >= job_count {
                    break;
                }
                let job = &jobs[index as usize];
                let outcome = if cancel.load(Ordering::Relaxed) {
                    cancelled_outcome(&job.requested)
                } else {
                    match request.action {
                        Action::MoveToLocalTrash => {
                            move_one(&job.requested, &job.path, &destination, cancel)
                        }
                        Action::CopyToLocalFavorites => copy_one(
                            gate,
                            &names,
                            &emitter,
                            &job.requested,
                            &job.path,
                            &destination,
                            cancel,
                            pending_destination_journal,
                            &request.operation_id,
                            favorite_duplicate_hints,
                        ),
                    }
                };
                job_outcomes.lock().unwrap_or_else(|err| err.into_inner())[index as usize] =
                    Some(outcome);
                emitter.finish_one();
            });
        }
    });

    let mut outcomes = early;
    let finished = std::mem::take(&mut *job_outcomes.lock().unwrap_or_else(|err| err.into_inner()));
    for (index, outcome) in finished.into_iter().enumerate() {
        outcomes.push(outcome.unwrap_or_else(|| cancelled_outcome(&jobs[index].requested)));
    }
    let state = final_state(&outcomes);
    emitter.set_phase(state, phase, true);
    invalidate_listing_caches(&request.directory, &outcomes);
    Ok(finish(request, outcomes, Some(destination_info)))
}

struct DestinationNote {
    folder: String,
    created: bool,
    role: String,
}

fn invalidate_listing_caches(directory: &str, outcomes: &[FileOutcome]) {
    let mut paths: HashSet<String> = HashSet::new();
    if !directory.is_empty() {
        paths.insert(directory.to_string());
    }
    for outcome in outcomes {
        if !matches!(
            outcome.status.as_str(),
            "moved" | "copied" | "already_exists"
        ) {
            continue;
        }
        if let Some(destination) = outcome.destination_path.as_deref() {
            if let Some(parent) = Path::new(destination).parent() {
                paths.insert(parent.display().to_string());
            }
        }
    }
    for path in paths {
        crate::scanner::drop_listing_cache(Path::new(&path));
    }
}

fn finish(
    request: &OperationRequest,
    outcomes: Vec<FileOutcome>,
    destination: Option<DestinationNote>,
) -> FileOperationResult {
    FileOperationResult {
        operation_id: request.operation_id.clone(),
        directory: request.directory.clone(),
        action: request.action.as_str().to_string(),
        state: final_state(&outcomes).to_string(),
        requested: outcomes.len() as u32,
        outcomes,
        destination_folder: destination.as_ref().map(|item| item.folder.clone()),
        destination_created: destination.as_ref().is_some_and(|item| item.created),
        destination_role: destination.map(|item| item.role),
    }
}

fn final_state(outcomes: &[FileOutcome]) -> &'static str {
    if outcomes.is_empty() {
        return "failed";
    }
    let mut success = 0;
    let mut failed = 0;
    let mut cancelled = 0;
    for outcome in outcomes {
        match outcome.status.as_str() {
            "moved" | "copied" | "already_exists" => success += 1,
            "cancelled" => cancelled += 1,
            _ => failed += 1,
        }
    }
    if failed > 0 && success > 0 {
        "partial"
    } else if failed > 0 {
        "failed"
    } else if cancelled > 0 {
        "cancelled"
    } else {
        "completed"
    }
}

fn move_one(
    requested: &str,
    source: &Path,
    destination: &Path,
    cancel: &AtomicBool,
) -> FileOutcome {
    if cancel.load(Ordering::Relaxed) {
        return cancelled_outcome(requested);
    }
    let Some(file_name) = source.file_name().and_then(|name| name.to_str()) else {
        return failed_outcome(requested, fail("outside", "Некорректное имя файла"));
    };
    let (stem, ext) = split_stem_ext(file_name);
    for index in 1..=MAX_SUFFIX {
        if cancel.load(Ordering::Relaxed) {
            return cancelled_outcome(requested);
        }
        let name = candidate_name(&stem, &ext, index);
        let target = destination.join(&name);
        match fs::symlink_metadata(&target) {
            Ok(meta) if is_reparse(&meta) => {
                return failed_outcome(
                    requested,
                    fail(
                        "reparse",
                        format!("Имя назначения является ссылкой: {name}"),
                    ),
                );
            }
            Ok(_) => continue,
            Err(err) if err.kind() == io::ErrorKind::NotFound => {}
            Err(err) => return failed_outcome(requested, io_fail(&target, &err)),
        }
        match move_noreplace(source, &target) {
            Ok(()) => {
                return success_outcome(requested, "moved", &target, index > 1, None, None);
            }
            Err(err) if is_already_exists(&err) => continue,
            Err(err) if err.raw_os_error() == Some(17) => {
                return failed_outcome(
                    requested,
                    fail(
                        "not_same_volume",
                        format!("Нельзя безопасно переместить файл: {file_name}"),
                    ),
                );
            }
            Err(err) => return failed_outcome(requested, io_fail(source, &err)),
        }
    }
    failed_outcome(
        requested,
        fail(
            "name_conflict",
            format!("Не удалось подобрать свободное имя для {file_name}"),
        ),
    )
}

fn journal_copy_destination(
    journal: Option<&PendingDestinationJournal>,
    operation_id: &str,
    requested: &str,
    target: &Path,
) {
    if let Some(record) = journal {
        let log_id = file_op_log_id(operation_id, requested);
        record(&log_id, &path_string_for_app(target));
    }
}

fn copy_one<G: IoGate>(
    gate: &G,
    names: &Mutex<NameLock>,
    emitter: &Emitter<'_>,
    requested: &str,
    source: &Path,
    destination: &Path,
    cancel: &AtomicBool,
    pending_destination_journal: Option<&PendingDestinationJournal>,
    operation_id: &str,
    favorite_duplicate_hints: Option<
        &std::collections::HashMap<String, favorite_duplicate_hint::FavoriteDuplicateHint>,
    >,
) -> FileOutcome {
    let duplicate_hint = favorite_duplicate_hints.and_then(|hints| {
        hints.get(&normalize_key(Path::new(requested)).to_ascii_lowercase())
    });
    if cancel.load(Ordering::Relaxed) {
        return cancelled_outcome(requested);
    }
    let Some(file_name) = source.file_name().and_then(|name| name.to_str()) else {
        return failed_outcome(requested, fail("outside", "Некорректное имя файла"));
    };
    let (stem, ext) = split_stem_ext(file_name);
    let original = destination.join(candidate_name(&stem, &ext, 1));
    if let Ok(meta) = fs::symlink_metadata(&original) {
        if is_reparse(&meta) {
            return failed_outcome(
                requested,
                fail(
                    "reparse",
                    format!("Имя назначения является ссылкой: {file_name}"),
                ),
            );
        }
        if meta.is_file() {
            emitter.set_phase("running", "checking_duplicates", false);
            if let Some(hint) = duplicate_hint {
                match favorite_duplicate_hint::try_confirm_duplicate_via_hint(
                    gate,
                    source,
                    &original,
                    hint,
                    cancel,
                ) {
                    Ok(Some(())) => {
                        journal_copy_destination(
                            pending_destination_journal,
                            operation_id,
                            requested,
                            &original,
                        );
                        return FileOutcome {
                            source_path: requested.to_string(),
                            status: "already_exists".to_string(),
                            destination_path: Some(path_string_for_app(&original)),
                            renamed_due_to_collision: false,
                            error_code: None,
                            error_message: None,
                            attribute_note: None,
                            source_content_sha256: Some(hint.content_sha256.clone()),
                        };
                    }
                    Ok(None) => {}
                    Err(fail) if fail.code == "cancelled" => return cancelled_outcome(requested),
                    Err(fail) => return failed_outcome(requested, fail),
                }
            }
            match files_identical(gate, source, &original, cancel) {
                Ok(true) => {
                    journal_copy_destination(
                        pending_destination_journal,
                        operation_id,
                        requested,
                        &original,
                    );
                    return FileOutcome {
                        source_path: requested.to_string(),
                        status: "already_exists".to_string(),
                        destination_path: Some(path_string_for_app(&original)),
                        renamed_due_to_collision: false,
                        error_code: None,
                        error_message: None,
                        attribute_note: None,
                        source_content_sha256: duplicate_hint
                            .map(|hint| hint.content_sha256.clone()),
                    };
                }
                Ok(false) => {}
                Err(fail) if fail.code == "cancelled" => return cancelled_outcome(requested),
                Err(fail) => return failed_outcome(requested, fail),
            }
        }
    }

    // Duplicate probe sets phase to checking_duplicates; restore before byte progress.
    emitter.set_phase("running", "copying", true);

    let claimed = {
        let mut planner = names.lock().unwrap_or_else(|err| err.into_inner());
        claim_free(&mut planner, destination, &stem, &ext)
    };
    let (mut target, mut renamed) = match claimed {
        Ok(value) => value,
        Err(fail) if fail.code == "cancelled" => return cancelled_outcome(requested),
        Err(fail) => return failed_outcome(requested, fail),
    };

    journal_copy_destination(
        pending_destination_journal,
        operation_id,
        requested,
        &target,
    );

    let temp = destination.join(temp_name());
    let guard = match create_temp(&temp) {
        Ok(guard) => guard,
        Err(fail) => return failed_outcome(requested, fail),
    };
    let source_hash = match copy_bytes(gate, source, &temp, cancel, true, |delta| {
        emitter.add_bytes(delta)
    }) {
        Ok(hash) => hash,
        Err(fail) => {
            return if fail.code == "cancelled" {
                cancelled_outcome(requested)
            } else {
                failed_outcome(requested, fail)
            };
        }
    };
    let attribute_note = copy_optional_attributes(source, &temp);

    loop {
        if cancel.load(Ordering::Relaxed) {
            return cancelled_outcome(requested);
        }
        match move_noreplace(&guard.0, &target) {
            Ok(()) => {
                return success_outcome(
                    requested,
                    "copied",
                    &target,
                    renamed,
                    attribute_note,
                    source_hash,
                );
            }
            Err(err) if is_already_exists(&err) => {
                let collision_is_duplicate = duplicate_hint
                    .and_then(|hint| {
                        favorite_duplicate_hint::try_confirm_duplicate_via_hint(
                            gate,
                            source,
                            &target,
                            hint,
                            cancel,
                        )
                        .ok()
                        .flatten()
                        .map(|_| true)
                    })
                    .unwrap_or(false)
                    || files_identical(gate, source, &target, cancel).ok() == Some(true);
                if collision_is_duplicate {
                    journal_copy_destination(
                        pending_destination_journal,
                        operation_id,
                        requested,
                        &target,
                    );
                    return FileOutcome {
                        source_path: requested.to_string(),
                        status: "already_exists".to_string(),
                        destination_path: Some(path_string_for_app(&target)),
                        renamed_due_to_collision: false,
                        error_code: None,
                        error_message: None,
                        attribute_note: None,
                        source_content_sha256: None,
                    };
                }
                let mut planner = names.lock().unwrap_or_else(|err| err.into_inner());
                if let Some(name) = target.file_name().and_then(|name| name.to_str()) {
                    planner.reserved.remove(name);
                }
                match claim_free(&mut planner, destination, &stem, &ext) {
                    Ok((next, next_renamed)) => {
                        target = next;
                        renamed = next_renamed;
                    }
                    Err(fail) => return failed_outcome(requested, fail),
                }
            }
            Err(err) => return failed_outcome(requested, io_fail(&target, &err)),
        }
    }
}

struct TempFile(PathBuf);

impl Drop for TempFile {
    fn drop(&mut self) {
        if self.0.as_os_str().is_empty() {
            return;
        }
        let _ = fs::remove_file(&self.0);
    }
}

fn create_temp(path: &Path) -> Result<TempFile, Fail> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|err| io_fail(path, &err))?;
    Ok(TempFile(path.to_path_buf()))
}

fn copy_bytes<G: IoGate>(
    gate: &G,
    source: &Path,
    temp: &Path,
    cancel: &AtomicBool,
    hash_source: bool,
    mut on_bytes: impl FnMut(u64),
) -> Result<Option<String>, Fail> {
    use sha2::{Digest, Sha256};
    let mut input = open_regular(source)?;
    let mut output = OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(temp)
        .map_err(|err| io_fail(temp, &err))?;
    let mut buffer = vec![0_u8; COPY_CHUNK];
    let mut hasher = if hash_source {
        Some(Sha256::new())
    } else {
        None
    };
    let hash_started = if hash_source {
        Some(Instant::now())
    } else {
        None
    };
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(fail("cancelled", "Операция отменена"));
        }
        if !gate.wait_visible(cancel) {
            return Err(fail("cancelled", "Операция отменена"));
        }
        let read = gate
            .with_read(|| -> io::Result<usize> {
                let amount = input.read(&mut buffer)?;
                if amount > 0 {
                    output.write_all(&buffer[..amount])?;
                }
                Ok(amount)
            })
            .map_err(|err| io_fail(source, &err))?;
        if cancel.load(Ordering::Relaxed) {
            return Err(fail("cancelled", "Операция отменена"));
        }
        if read == 0 {
            break;
        }
        if let Some(hasher) = hasher.as_mut() {
            hasher.update(&buffer[..read]);
        }
        on_bytes(read as u64);
    }
    output.sync_all().map_err(|err| io_fail(temp, &err))?;
    if let (Some(hasher), Some(started)) = (hasher, hash_started) {
        let digest = hasher.finalize();
        fav_metrics::record_sha256(started.elapsed());
        return Ok(Some(content_hash::format_sha256_digest(digest.as_ref())));
    }
    Ok(None)
}

fn files_identical<G: IoGate>(
    gate: &G,
    left: &Path,
    right: &Path,
    cancel: &AtomicBool,
) -> Result<bool, Fail> {
    let left_len = fs::metadata(left).map_err(|err| io_fail(left, &err))?.len();
    let right_len = fs::metadata(right)
        .map_err(|err| io_fail(right, &err))?
        .len();
    if left_len != right_len {
        return Ok(false);
    }
    let mut left_file = open_regular(left)?;
    let mut right_file = open_regular(right)?;
    let mut left_buf = vec![0_u8; COPY_CHUNK];
    let mut right_buf = vec![0_u8; COPY_CHUNK];
    loop {
        if cancel.load(Ordering::Relaxed) || !gate.wait_visible(cancel) {
            return Err(fail("cancelled", "Операция отменена"));
        }
        let (left_read, right_read) = gate
            .with_read(|| -> io::Result<(usize, usize)> {
                let left_read = read_full(&mut left_file, &mut left_buf)?;
                let right_read = read_full(&mut right_file, &mut right_buf)?;
                Ok((left_read, right_read))
            })
            .map_err(|err| io_fail(left, &err))?;
        if left_read != right_read || left_buf[..left_read] != right_buf[..right_read] {
            return Ok(false);
        }
        if left_read == 0 {
            return Ok(true);
        }
    }
}

fn read_full(file: &mut File, buffer: &mut [u8]) -> io::Result<usize> {
    let mut filled = 0;
    while filled < buffer.len() {
        match file.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(read) => filled += read,
            Err(err) if err.kind() == io::ErrorKind::Interrupted => continue,
            Err(err) => return Err(err),
        }
    }
    Ok(filled)
}

pub(crate) fn open_regular(path: &Path) -> Result<File, Fail> {
    let meta = fs::symlink_metadata(path).map_err(|err| io_fail(path, &err))?;
    if is_reparse(&meta) {
        return Err(fail(
            "reparse",
            format!("Файл является ссылкой: {}", path.display()),
        ));
    }
    if !meta.is_file() {
        return Err(fail(
            "not_image",
            format!("Это не файл изображения: {}", path.display()),
        ));
    }
    File::open(path).map_err(|err| io_fail(path, &err))
}

fn copy_optional_attributes(source: &Path, temp: &Path) -> Option<String> {
    let mut notes = Vec::new();
    match fs::metadata(source).and_then(|meta| meta.modified()) {
        Ok(modified) => {
            if let Err(err) = OpenOptions::new()
                .write(true)
                .open(temp)
                .and_then(|file| file.set_modified(modified))
            {
                notes.push(format!("время изменения не сохранено ({err})"));
            }
        }
        Err(err) => notes.push(format!("время изменения не прочитано ({err})")),
    }
    if let Err(err) = copy_windows_attributes(source, temp) {
        notes.push(format!("атрибуты файла не сохранены ({err})"));
    }
    if notes.is_empty() {
        None
    } else {
        Some(notes.join("; "))
    }
}

fn claim_free(
    planner: &mut NameLock,
    destination: &Path,
    stem: &str,
    ext: &str,
) -> Result<(PathBuf, bool), Fail> {
    for index in 1..=MAX_SUFFIX {
        let name = candidate_name(stem, ext, index);
        if planner.reserved.contains(&name) {
            continue;
        }
        let path = destination.join(&name);
        match fs::symlink_metadata(&path) {
            Ok(_) => continue,
            Err(err) if err.kind() == io::ErrorKind::NotFound => {
                planner.reserved.insert(name);
                return Ok((path, index > 1));
            }
            Err(err) => return Err(io_fail(&path, &err)),
        }
    }
    Err(fail(
        "name_conflict",
        format!("Не удалось подобрать свободное имя для {stem}"),
    ))
}

/// Raw `.stitchvue.role` marker. Does not by itself mean the folder is the
/// active favorites collection — that also requires a canonical name.
pub fn read_role_marker(dir: &Path) -> Option<ServiceRole> {
    let path = dir.join(ROLE_FILE);
    let meta = fs::symlink_metadata(&path).ok()?;
    if is_reparse(&meta) || !meta.is_file() {
        return None;
    }
    let text = fs::read_to_string(&path).ok()?;
    ServiceRole::parse(&text)
}

/// Active service role for this folder.
/// Favorites is active only with a canonical name (`Избранное` / `Избранная`)
/// plus a `favorites` marker. A leftover marker after rename is ignored.
pub fn read_service_role(dir: &Path) -> Option<ServiceRole> {
    let role = read_role_marker(dir)?;
    if role == ServiceRole::Favorites && !folder_has_favorites_canonical_name(dir) {
        return None;
    }
    Some(role)
}

pub fn write_service_role(dir: &Path, role: ServiceRole) -> Result<(), String> {
    if read_role_marker(dir) == Some(role) {
        return Ok(());
    }
    if read_role_marker(dir).is_some() {
        return Err("В папке уже записана другая роль.".to_string());
    }
    let path = dir.join(ROLE_FILE);
    match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut file) => {
            file.write_all(role.as_str().as_bytes())
                .map_err(|err| format!("Не удалось записать роль папки: {err}"))?;
            hide_marker(&path);
            Ok(())
        }
        Err(err) if err.kind() == io::ErrorKind::AlreadyExists => {
            if read_role_marker(dir) == Some(role) {
                Ok(())
            } else {
                Err("В папке уже записана другая роль.".to_string())
            }
        }
        Err(err) => Err(format!("Не удалось записать роль папки: {err}")),
    }
}

/// Remove `.stitchvue.role` only. Never touches user photos.
pub fn clear_service_role(dir: &Path) -> Result<(), String> {
    let path = dir.join(ROLE_FILE);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!(
            "Не удалось снять роль папки {}: {err}",
            path.display()
        )),
    }
}

pub fn is_active_favorites_folder(dir: &Path) -> bool {
    read_service_role(dir) == Some(ServiceRole::Favorites)
}

/// At most one active favorites folder per parent: canonical name + marker.
pub fn active_favorites_folder(parent: &Path) -> Option<PathBuf> {
    let preferred = parent.join(LOCAL_FAVORITES);
    if is_active_favorites_folder(&preferred) {
        return Some(preferred);
    }
    let alternate = parent.join(LOCAL_FAVORITES_ALT);
    if is_active_favorites_folder(&alternate) {
        return Some(alternate);
    }
    None
}

fn folder_has_favorites_canonical_name(dir: &Path) -> bool {
    dir.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(is_favorites_folder_name)
}

fn hide_marker(path: &Path) {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" {
            fn SetFileAttributesW(name: *const u16, attrs: u32) -> i32;
        }
        let wide: Vec<u16> = path
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            SetFileAttributesW(wide.as_ptr(), 2);
        }
    }
    #[cfg(not(windows))]
    {
        let _ = path;
    }
}

/// Empty or Windows-only debris — safe to mark as a StitchVue service folder.
fn service_folder_adoptable(dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let lossy = name.to_string_lossy();
        if lossy.eq_ignore_ascii_case("desktop.ini")
            || lossy.eq_ignore_ascii_case("thumbs.db")
        {
            continue;
        }
        return false;
    }
    true
}

fn prepare_destination(
    directory: &Path,
    folder_name: &str,
    role: ServiceRole,
) -> Result<(PathBuf, bool), Fail> {
    let dest = directory.join(folder_name);
    match fs::symlink_metadata(&dest) {
        Ok(meta) => {
            if is_reparse(&meta) {
                return Err(fail(
                    "destination_reparse",
                    format!("«{folder_name}» является ссылкой. Операция остановлена."),
                ));
            }
            if !meta.is_dir() {
                return Err(fail(
                    "destination_exists_file",
                    format!("«{folder_name}» существует и это не папка."),
                ));
            }
            let canonical = fs::canonicalize(&dest).map_err(|err| {
                fail("destination", format!("Не удалось открыть «{folder_name}»: {err}"))
            })?;
            if canonical
                .parent()
                .is_none_or(|parent| !same_path(parent, directory))
            {
                return Err(fail(
                    "destination",
                    format!("«{folder_name}» выходит за пределы открытой папки."),
                ));
            }
            match read_service_role(&canonical) {
                Some(existing) if existing == role => Ok((canonical, false)),
                Some(_) => Err(fail(
                    "destination_role_conflict",
                    format!(
                        "«{folder_name}» уже зарегистрирована с другой ролью. Операция остановлена."
                    ),
                )),
                None => {
                    if service_folder_adoptable(&canonical) {
                        write_service_role(&canonical, role)
                            .map_err(|message| fail("destination", message))?;
                        return Ok((canonical, false));
                    }
                    Err(fail(
                        "destination_unmarked",
                        format!(
                            "unmarked_conflict: папка «{folder_name}» уже существует и не является служебной. Операция остановлена."
                        ),
                    ))
                }
            }
        }
        Err(err) if err.kind() == io::ErrorKind::NotFound => match fs::create_dir(&dest) {
            Ok(()) => {
                if let Err(mark) = write_service_role(&dest, role) {
                    let _ = fs::remove_dir(&dest);
                    return Err(fail("destination", mark));
                }
                let canonical = fs::canonicalize(&dest).map_err(|err| {
                    fail("destination", format!("Не удалось открыть «{folder_name}»: {err}"))
                })?;
                Ok((canonical, true))
            }
            Err(create_err) if create_err.kind() == io::ErrorKind::AlreadyExists => {
                prepare_destination(directory, folder_name, role)
            }
            Err(create_err) => Err(fail(
                "destination",
                format!("Не удалось создать «{folder_name}»: {create_err}"),
            )),
        },
        Err(err) => Err(fail(
            "destination",
            format!("Не удалось открыть «{folder_name}»: {err}"),
        )),
    }
}

fn prepare_action_destination(
    directory: &Path,
    action: Action,
) -> Result<(PathBuf, bool), Fail> {
    let role = action.role();
    let primary = action.folder_name();
    match prepare_destination(directory, primary, role) {
        Ok(value) => Ok(value),
        Err(primary_fail)
            if action == Action::CopyToLocalFavorites
                && primary_fail.code == "destination_unmarked" =>
        {
            match prepare_destination(directory, LOCAL_FAVORITES_ALT, role) {
                Ok(value) => Ok(value),
                Err(alt_fail) if alt_fail.code == "destination_unmarked" => Err(fail(
                    "destination_unmarked",
                    format!(
                        "unmarked_conflict: папки «{LOCAL_FAVORITES}» и «{LOCAL_FAVORITES_ALT}» уже заняты."
                    ),
                )),
                Err(other) => Err(other),
            }
        }
        Err(other) => Err(other),
    }
}

fn open_directory(raw: &str) -> Result<PathBuf, String> {
    if raw.is_empty() || raw.contains('\0') {
        return Err("Некорректный путь папки.".to_string());
    }
    let path = Path::new(raw);
    let meta = fs::symlink_metadata(path).map_err(|err| format!("Папка недоступна: {err}"))?;
    if is_reparse(&meta) {
        return Err("Открытая папка является ссылкой. Операция остановлена.".to_string());
    }
    if !meta.is_dir() {
        return Err("Открытый путь не является папкой.".to_string());
    }
    fs::canonicalize(path).map_err(|err| format!("Папка недоступна: {err}"))
}

fn resolve_source(directory: &Path, requested: &str) -> Result<PathBuf, Fail> {
    if requested.is_empty() || requested.contains('\0') || has_disallowed_path_syntax(requested) {
        return Err(fail("outside", "Некорректный путь файла"));
    }
    let raw = PathBuf::from(requested);
    if raw
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(fail("outside", "Путь выходит за пределы открытой папки"));
    }
    let absolute = if raw.is_absolute() {
        raw
    } else if raw.components().count() == 1 {
        directory.join(&raw)
    } else {
        return Err(fail("outside", "Файл должен лежать в открытой папке"));
    };
    let Some(name) = absolute.file_name().and_then(|name| name.to_str()) else {
        return Err(fail("outside", "Некорректное имя файла"));
    };
    if name.is_empty() || name == "." || name == ".." || name.contains([':', '\\', '/']) {
        return Err(fail("outside", "Некорректное имя файла"));
    }
    let Some(parent) = absolute.parent() else {
        return Err(fail("outside", "Файл должен лежать в открытой папке"));
    };
    let parent = fs::canonicalize(parent)
        .map_err(|_| fail("outside", "Файл должен лежать в открытой папке"))?;
    if !same_path(&parent, directory) {
        return Err(fail("outside", "Файл должен лежать в открытой папке"));
    }
    let candidate = directory.join(name);
    let meta = fs::symlink_metadata(&candidate).map_err(|err| io_fail(&candidate, &err))?;
    if is_reparse(&meta) {
        return Err(fail("reparse", format!("Файл является ссылкой: {name}")));
    }
    if !meta.is_file() {
        return Err(fail(
            "not_image",
            format!("Это не файл изображения: {name}"),
        ));
    }
    if !crate::formats::listed_image(Path::new(name)) {
        return Err(fail(
            "not_image",
            format!("Формат не поддерживается: {name}"),
        ));
    }
    let final_path = fs::canonicalize(&candidate).map_err(|err| io_fail(&candidate, &err))?;
    if final_path
        .parent()
        .is_none_or(|parent| !same_path(parent, directory))
    {
        return Err(fail("outside", "Файл выходит за пределы открытой папки"));
    }
    Ok(final_path)
}

pub fn is_favorites_folder_name(name: &str) -> bool {
    let folded = name.to_lowercase();
    folded == LOCAL_FAVORITES.to_lowercase() || folded == LOCAL_FAVORITES_ALT.to_lowercase()
}

pub fn is_trash_folder_name(name: &str) -> bool {
    let folded = name.to_lowercase();
    folded == "удаленное" || folded == "корзина"
}

pub fn is_service_folder_name(name: &str) -> bool {
    is_trash_folder_name(name) || is_favorites_folder_name(name)
}

pub const COPY_CHANGED: &str = "Копия в избранном изменена. Файл не удалён.";

pub fn confirm_copy_unchanged(
    copy: &Path,
    recorded_size: u64,
    recorded_modified_ms: i64,
) -> Result<(), String> {
    let meta = fs::symlink_metadata(copy).map_err(|err| format!("copy missing: {err}"))?;
    if is_reparse(&meta) || !meta.is_file() {
        return Err("Нельзя удалить этот путь".to_string());
    }
    if meta.len() != recorded_size {
        return Err(COPY_CHANGED.to_string());
    }
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64);
    match modified_ms {
        Some(modified) if (modified - recorded_modified_ms).abs() <= 2_000 => Ok(()),
        _ => Err(COPY_CHANGED.to_string()),
    }
}

#[derive(Debug, Clone)]
pub struct TrashCandidate {
    pub trash_path: String,
    pub origin_path: String,
    pub source_size: Option<u64>,
}

pub fn match_renamed_trash(
    folder: &Path,
    file: &Path,
    rows: &[TrashCandidate],
) -> Option<TrashCandidate> {
    let file_size = fs::metadata(file).ok()?.len();
    let mut orphans = Vec::new();
    for row in rows {
        let trash = Path::new(&row.trash_path);
        let Some(parent) = trash.parent() else {
            continue;
        };
        if !same_path(parent, folder)
            || fs::symlink_metadata(trash).is_ok()
            || row.source_size != Some(file_size)
        {
            continue;
        }
        orphans.push(row.clone());
    }
    if orphans.len() != 1 {
        return None;
    }
    let live: Vec<String> = rows
        .iter()
        .filter(|row| {
            let trash = Path::new(&row.trash_path);
            trash
                .parent()
                .is_some_and(|parent| same_path(parent, folder))
                && fs::symlink_metadata(trash).is_ok()
        })
        .map(|row| normalize_key(Path::new(&row.trash_path)))
        .collect();
    let mut unclaimed = 0_u32;
    let entries = fs::read_dir(folder).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if is_reparse(&meta) || !meta.is_file() || meta.len() != file_size {
            continue;
        }
        if live.iter().any(|key| key == &normalize_key(&path)) {
            continue;
        }
        unclaimed += 1;
    }
    if unclaimed == 1 {
        orphans.pop()
    } else {
        None
    }
}

pub fn restore_recorded_file(
    trash: &Path,
    origin: &Path,
    renamed: bool,
) -> Result<PathBuf, String> {
    let trash_meta =
        fs::symlink_metadata(trash).map_err(|err| format!("Файл корзины не найден: {err}"))?;
    if is_reparse(&trash_meta) || !trash_meta.is_file() {
        return Err("Нельзя восстановить этот путь".to_string());
    }
    let trash_parent = trash
        .parent()
        .ok_or_else(|| "Нет папки корзины".to_string())?;
    if read_service_role(trash_parent) != Some(ServiceRole::Trash) {
        return Err("Файл не лежит в папке «Удаленное»".to_string());
    }
    let destination_dir = origin
        .parent()
        .ok_or_else(|| "origin_missing".to_string())?;
    let dir_meta =
        fs::symlink_metadata(destination_dir).map_err(|_| "origin_missing".to_string())?;
    if is_reparse(&dir_meta) || !dir_meta.is_dir() {
        return Err("origin_missing".to_string());
    }
    let file_name = origin
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Некорректное исходное имя".to_string())?;
    let (stem, ext) = split_stem_ext(file_name);
    let target = if renamed {
        let mut chosen = destination_dir.join(candidate_name(&stem, &ext, 2));
        for index in 2..=MAX_SUFFIX {
            let candidate = destination_dir.join(candidate_name(&stem, &ext, index));
            if fs::symlink_metadata(&candidate).is_err() {
                chosen = candidate;
                break;
            }
        }
        chosen
    } else {
        destination_dir.join(file_name)
    };
    if fs::symlink_metadata(&target).is_ok() {
        return Err("name_taken".to_string());
    }
    move_noreplace(trash, &target).map_err(|err| {
        if is_already_exists(&err) {
            "name_taken".to_string()
        } else {
            format!("Не удалось восстановить файл: {err}")
        }
    })?;
    Ok(target)
}

pub fn candidate_name(stem: &str, ext: &str, index: u32) -> String {
    if index <= 1 {
        if ext.is_empty() {
            stem.to_string()
        } else {
            format!("{stem}.{ext}")
        }
    } else if ext.is_empty() {
        format!("{stem} ({index})")
    } else {
        format!("{stem} ({index}).{ext}")
    }
}

pub fn split_stem_ext(file_name: &str) -> (String, String) {
    match file_name.rfind('.') {
        Some(dot) if dot > 0 => (
            file_name[..dot].to_string(),
            file_name[dot + 1..].to_string(),
        ),
        _ => (file_name.to_string(), String::new()),
    }
}

fn temp_name() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_nanos())
        .unwrap_or(0);
    format!(".stitchvue-{}-{n}-{nanos}.tmp", std::process::id())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderMenuOptions {
    pub can_rename: bool,
    pub can_delete_empty_service: bool,
    pub can_recycle_trash_folder: bool,
}

pub fn folder_menu_options(
    parent_directory: &str,
    folder_path: &str,
) -> Result<FolderMenuOptions, String> {
    let (_parent, child) = resolve_child_folder(parent_directory, folder_path)?;
    let role = read_service_role(&child);
    let can_delete = role.is_some() && service_folder_empty_for_delete(&child)?;
    let can_recycle_trash = role == Some(ServiceRole::Trash);
    Ok(FolderMenuOptions {
        can_rename: true,
        can_delete_empty_service: can_delete,
        can_recycle_trash_folder: can_recycle_trash,
    })
}

pub fn describe_local_trash_folder(
    folder_path: &str,
) -> Result<trash_folder::LocalTrashFolderSnapshot, String> {
    trash_folder::describe_local_trash_folder(folder_path)
}

pub fn trash_entry_origin(path: &str) -> Result<Option<String>, String> {
    let db = crate::database::open()?;
    if let Some(origin) = crate::database::trash_origin(&db, path)? {
        return Ok(Some(origin));
    }
    crate::database::origin_from_log(&db, path)
}

pub use trash_folder::LocalTrashFolderSnapshot;

pub fn rename_child_folder(
    parent_directory: &str,
    folder_path: &str,
    new_name: &str,
) -> Result<String, String> {
    let (parent, child) = resolve_child_folder(parent_directory, folder_path)?;
    let new_name = validate_folder_name(new_name)?;
    let current_name = child
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Некорректное имя папки.".to_string())?;
    if current_name.eq_ignore_ascii_case(&new_name) {
        return Ok(child.display().to_string());
    }
    let destination = parent.join(&new_name);
    match fs::symlink_metadata(&destination) {
        Ok(_) => return Err(format!("«{new_name}» уже существует.")),
        Err(err) if err.kind() == io::ErrorKind::NotFound => {}
        Err(err) => return Err(io_fail(&destination, &err).message.clone()),
    }
    let was_active_favorites = is_active_favorites_folder(&child);
    fs::rename(&child, &destination)
        .map_err(|err| format!("Не удалось переименовать папку: {err}"))?;
    if was_active_favorites && !is_favorites_folder_name(&new_name) {
        let _ = clear_service_role(&destination);
    }
    if let Some(parent_path) = destination.parent() {
        crate::scanner::drop_listing_cache(parent_path);
    }
    crate::scanner::drop_listing_cache(&child);
    crate::scanner::drop_listing_cache(&destination);
    Ok(destination.display().to_string())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceFolderLocation {
    pub parent_directory: String,
    pub folder_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreTrashResult {
    pub restored_path: String,
    pub removed_service_folder: Option<ServiceFolderLocation>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecycleItemResult {
    pub path: String,
    pub status: String,
    pub removed_service_folder: Option<ServiceFolderLocation>,
}

pub fn remove_empty_service_folder(
    parent_directory: &str,
    folder_path: &str,
) -> Result<ServiceFolderLocation, String> {
    match cleanup_empty_service_folder(parent_directory, folder_path) {
        outcome if outcome.status == "removed" => outcome
            .location
            .ok_or_else(|| "Папка не удалена.".to_string()),
        outcome if outcome.status == "not_empty" => {
            Err("Папку можно удалить только если в ней нет фотографий.".to_string())
        }
        outcome if outcome.status == "already_gone" => Err("Папка недоступна.".to_string()),
        outcome => Err(outcome
            .message
            .unwrap_or_else(|| "Не удалось удалить папку.".to_string())),
    }
}

/// Structured cleanup for «Избранное» / «Удаленное»: distinguishes removed, not empty, already gone.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceFolderCleanupResult {
    pub status: String,
    pub location: Option<ServiceFolderLocation>,
    pub message: Option<String>,
}

pub fn cleanup_empty_service_folder(
    parent_directory: &str,
    folder_path: &str,
) -> ServiceFolderCleanupResult {
    let expected = expected_service_location(parent_directory, folder_path);
    match resolve_child_folder(parent_directory, folder_path) {
        Ok((parent, child)) => match cleanup_service_folder_dir(&child) {
            CleanupDetail::Removed(location) => {
                crate::scanner::drop_listing_cache(&parent);
                crate::scanner::drop_listing_cache(&child);
                ServiceFolderCleanupResult {
                    status: "removed".to_string(),
                    location: Some(location),
                    message: None,
                }
            }
            CleanupDetail::NotEmpty => ServiceFolderCleanupResult {
                status: "not_empty".to_string(),
                location: expected,
                message: None,
            },
            CleanupDetail::AlreadyGone(location) => ServiceFolderCleanupResult {
                status: "already_gone".to_string(),
                location: Some(location),
                message: None,
            },
            CleanupDetail::Failed(message) => ServiceFolderCleanupResult {
                status: "failed".to_string(),
                location: expected,
                message: Some(message),
            },
        },
        Err(err) => {
            if path_missing_error(&err) {
                ServiceFolderCleanupResult {
                    status: "already_gone".to_string(),
                    location: expected,
                    message: None,
                }
            } else {
                ServiceFolderCleanupResult {
                    status: "failed".to_string(),
                    location: expected,
                    message: Some(err),
                }
            }
        }
    }
}

fn expected_service_location(
    parent_directory: &str,
    folder_path: &str,
) -> Option<ServiceFolderLocation> {
    if parent_directory.is_empty() || folder_path.is_empty() {
        return None;
    }
    Some(ServiceFolderLocation {
        parent_directory: path_string_for_app(Path::new(parent_directory)),
        folder_path: path_string_for_app(Path::new(folder_path)),
    })
}

fn path_missing_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("не удается найти")
        || lower.contains("cannot find")
        || lower.contains("not found")
        || lower.contains("os error 2")
        || lower.contains("системe не удается найти")
        || lower.contains("the system cannot find")
}

enum CleanupDetail {
    Removed(ServiceFolderLocation),
    NotEmpty,
    AlreadyGone(ServiceFolderLocation),
    Failed(String),
}

fn cleanup_service_folder_dir(dir: &Path) -> CleanupDetail {
    let location = match dir.parent() {
        Some(parent) => ServiceFolderLocation {
            parent_directory: path_string_for_app(parent),
            folder_path: path_string_for_app(dir),
        },
        None => {
            return CleanupDetail::Failed("Нет родительской папки.".to_string());
        }
    };
    match fs::symlink_metadata(dir) {
        Err(err) if err.kind() == io::ErrorKind::NotFound => CleanupDetail::AlreadyGone(location),
        Err(err) => CleanupDetail::Failed(format!("Папка недоступна: {err}")),
        Ok(meta) => {
            if is_reparse(&meta) {
                return CleanupDetail::Failed(
                    "Папка является ссылкой. Операция остановлена.".to_string(),
                );
            }
            if !meta.is_dir() {
                return CleanupDetail::Failed("Выбранный путь не является папкой.".to_string());
            }
            if read_service_role(dir).is_none() {
                return CleanupDetail::Failed(
                    "Удаление доступно только для папок «Избранное» и «Удаленное».".to_string(),
                );
            }
            match service_folder_empty_for_delete(dir) {
                Ok(false) => CleanupDetail::NotEmpty,
                Ok(true) => match remove_empty_service_folder_at(dir) {
                    Ok(()) => {
                        if let Some(parent) = dir.parent() {
                            crate::scanner::drop_listing_cache(parent);
                        }
                        crate::scanner::drop_listing_cache(dir);
                        CleanupDetail::Removed(location)
                    }
                    Err(err) => {
                        if !dir.exists() {
                            CleanupDetail::AlreadyGone(location)
                        } else {
                            CleanupDetail::Failed(err)
                        }
                    }
                },
                Err(err) => {
                    if !dir.exists() {
                        CleanupDetail::AlreadyGone(location)
                    } else {
                        CleanupDetail::Failed(err)
                    }
                }
            }
        }
    }
}

/// Removes a service folder that only contains `.stitchvue.role` (no photos). No-op if not empty.
pub fn remove_service_folder_if_empty(dir: &Path) -> Result<Option<ServiceFolderLocation>, String> {
    if !dir.exists() {
        return Ok(None);
    }
    if read_service_role(dir).is_none() {
        return Ok(None);
    }
    match cleanup_service_folder_dir(dir) {
        CleanupDetail::Removed(location) => Ok(Some(location)),
        CleanupDetail::NotEmpty => Ok(None),
        CleanupDetail::AlreadyGone(_) => Ok(None),
        CleanupDetail::Failed(message) => Err(message),
    }
}

/// Favorites/trash cleanup with an explicit status for the UI (removed / not_empty / already_gone / failed).
pub fn cleanup_service_folder_at(dir: &Path) -> ServiceFolderCleanupResult {
    match cleanup_service_folder_dir(dir) {
        CleanupDetail::Removed(location) => ServiceFolderCleanupResult {
            status: "removed".to_string(),
            location: Some(location),
            message: None,
        },
        CleanupDetail::NotEmpty => ServiceFolderCleanupResult {
            status: "not_empty".to_string(),
            location: dir.parent().map(|parent| ServiceFolderLocation {
                parent_directory: path_string_for_app(parent),
                folder_path: path_string_for_app(dir),
            }),
            message: None,
        },
        CleanupDetail::AlreadyGone(location) => ServiceFolderCleanupResult {
            status: "already_gone".to_string(),
            location: Some(location),
            message: None,
        },
        CleanupDetail::Failed(message) => ServiceFolderCleanupResult {
            status: "failed".to_string(),
            location: dir.parent().map(|parent| ServiceFolderLocation {
                parent_directory: path_string_for_app(parent),
                folder_path: path_string_for_app(dir),
            }),
            message: Some(message),
        },
    }
}

fn remove_empty_service_folder_at(child: &Path) -> Result<(), String> {
    if read_service_role(child).is_none() {
        return Err("Удаление доступно только для папок «Избранное» и «Удаленное».".to_string());
    }
    if !service_folder_empty_for_delete(child)? {
        return Err("Папку можно удалить только если в ней нет фотографий.".to_string());
    }
    let marker = child.join(ROLE_FILE);
    if fs::symlink_metadata(&marker).is_ok() {
        fs::remove_file(&marker).map_err(|err| format!("Не удалось удалить папку: {err}"))?;
    }
    fs::remove_dir(child).map_err(|err| format!("Не удалось удалить папку: {err}"))?;
    Ok(())
}

fn resolve_child_folder(
    parent_directory: &str,
    folder_path: &str,
) -> Result<(PathBuf, PathBuf), String> {
    let parent = open_directory(parent_directory)?;
    if folder_path.is_empty()
        || folder_path.contains('\0')
        || has_disallowed_path_syntax(folder_path)
    {
        return Err("Некорректный путь папки.".to_string());
    }
    let raw = PathBuf::from(folder_path);
    let absolute = if raw.is_absolute() {
        raw
    } else {
        parent.join(&raw)
    };
    let child = fs::canonicalize(&absolute).map_err(|err| format!("Папка недоступна: {err}"))?;
    let child_parent = child
        .parent()
        .ok_or_else(|| "Папка должна лежать в выбранном каталоге.".to_string())?;
    if !same_path(child_parent, &parent) {
        return Err("Папка должна лежать в выбранном каталоге.".to_string());
    }
    let meta = fs::symlink_metadata(&child).map_err(|err| format!("Папка недоступна: {err}"))?;
    if is_reparse(&meta) {
        return Err("Папка является ссылкой. Операция остановлена.".to_string());
    }
    if !meta.is_dir() {
        return Err("Выбранный путь не является папкой.".to_string());
    }
    Ok((parent, child))
}

fn validate_folder_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err("Введите имя папки.".to_string());
    }
    if trimmed.contains(['\\', '/', ':', '*', '?', '"', '<', '>', '|']) {
        return Err("Имя содержит недопустимые символы.".to_string());
    }
    if trimmed.ends_with('.') || trimmed.ends_with(' ') {
        return Err("Имя не может заканчиваться точкой или пробелом.".to_string());
    }
    Ok(trimmed.to_string())
}

fn service_folder_empty_for_delete(dir: &Path) -> Result<bool, String> {
    let entries = fs::read_dir(dir).map_err(|err| format!("Папка недоступна: {err}"))?;
    for entry in entries {
        let entry = entry.map_err(|err| format!("Папка недоступна: {err}"))?;
        let file_type = entry
            .file_type()
            .map_err(|err| format!("Папка недоступна: {err}"))?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if file_type.is_dir() {
            return Ok(false);
        }
        if name == ROLE_FILE {
            continue;
        }
        if crate::formats::listed_image(Path::new(name.as_ref())) {
            return Ok(false);
        }
        return Ok(false);
    }
    Ok(true)
}

/// Rejects empty/NUL paths, ADS (`file:stream`), device namespace (`\\.\`), and other non-drive colons.
/// Allows ordinary, extended-length (`\\?\C:\…`), UNC, and extended UNC (`\\?\UNC\…`) paths.
pub(crate) fn has_disallowed_path_syntax(value: &str) -> bool {
    if value.is_empty() || value.contains('\0') {
        return true;
    }
    // Streams and device namespaces are Windows-only; `:` is a normal name character elsewhere.
    if !cfg!(windows) {
        return false;
    }
    if value.starts_with(r"\\.\") || value.starts_with("//./") {
        return true;
    }
    let for_colon = if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return rest.contains(':');
    } else if let Some(rest) = value.strip_prefix(r"\\?\") {
        // Only drive-letter extended paths are accepted here (`\\?\C:\…`).
        // `\\?\GLOBALROOT\…`, volume GUID paths, etc. are rejected.
        let bytes = rest.as_bytes();
        if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
            rest
        } else {
            return true;
        }
    } else if value.starts_with(r"\\") || value.starts_with("//") {
        return value.contains(':');
    } else {
        value
    };
    let mut chars = for_colon.chars();
    match (chars.next(), chars.next()) {
        (Some(letter), Some(':')) if letter.is_ascii_alphabetic() => chars.any(|ch| ch == ':'),
        _ => for_colon.contains(':'),
    }
}

/// Drop `\\?\` / `\\?\UNC\` for React and APIs that reject extended prefixes.
/// Security checks still use resolved `Path` values, not this string alone.
pub(crate) fn path_string_for_app(path: &Path) -> String {
    if !cfg!(windows) {
        return path.to_string_lossy().into_owned();
    }
    let text = path.to_string_lossy().replace('/', "\\");
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        text
    }
}

/// Comparison key only, never a real path: separators are folded to `\` on every OS.
pub(crate) fn normalize_key(path: &Path) -> String {
    let text = path_string_for_app(path).replace('/', "\\");
    text.trim_end_matches('\\').to_string()
}

pub(crate) fn same_path(left: &Path, right: &Path) -> bool {
    normalize_key(left).eq_ignore_ascii_case(&normalize_key(right))
}

pub(crate) fn is_reparse(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}

fn is_already_exists(err: &io::Error) -> bool {
    err.kind() == io::ErrorKind::AlreadyExists || matches!(err.raw_os_error(), Some(80 | 183))
}

pub fn error_code(err: &io::Error) -> &'static str {
    match err.raw_os_error() {
        Some(32 | 33) => "locked",
        Some(112 | 39) => "no_space",
        Some(5) => "access_denied",
        Some(2 | 3) => "not_found",
        Some(17) => "not_same_volume",
        Some(80 | 183) => "name_conflict",
        _ => match err.kind() {
            io::ErrorKind::NotFound => "not_found",
            io::ErrorKind::PermissionDenied => "access_denied",
            io::ErrorKind::AlreadyExists => "name_conflict",
            _ => "io_error",
        },
    }
}

pub(crate) fn io_fail(path: &Path, err: &io::Error) -> Fail {
    let code = error_code(err);
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string());
    let message = match code {
        "locked" => format!("Файл занят другой программой: {name}"),
        "no_space" => format!("Недостаточно места на диске: {name}"),
        "access_denied" => format!("Нет доступа к файлу: {name}"),
        "not_found" => format!("Файл не найден: {name}"),
        "not_same_volume" => format!("Нельзя безопасно переместить файл: {name}"),
        "name_conflict" => format!("Не удалось записать файл без замены: {name}"),
        _ => format!("{name}: {err}"),
    };
    Fail { code, message }
}

pub(crate) fn fail(code: &'static str, message: impl Into<String>) -> Fail {
    Fail {
        code,
        message: message.into(),
    }
}

fn failed_outcome(source: &str, fail: Fail) -> FileOutcome {
    FileOutcome {
        source_path: source.to_string(),
        status: "failed".to_string(),
        destination_path: None,
        renamed_due_to_collision: false,
        error_code: Some(fail.code.to_string()),
        error_message: Some(fail.message),
        attribute_note: None,
        source_content_sha256: None,
    }
}

fn cancelled_outcome(source: &str) -> FileOutcome {
    FileOutcome {
        source_path: source.to_string(),
        status: "cancelled".to_string(),
        destination_path: None,
        renamed_due_to_collision: false,
        error_code: Some("cancelled".to_string()),
        error_message: Some("Операция отменена".to_string()),
        attribute_note: None,
        source_content_sha256: None,
    }
}

fn success_outcome(
    source: &str,
    status: &str,
    destination: &Path,
    renamed: bool,
    attribute_note: Option<String>,
    source_content_sha256: Option<String>,
) -> FileOutcome {
    FileOutcome {
        source_path: source.to_string(),
        status: status.to_string(),
        destination_path: Some(path_string_for_app(destination)),
        renamed_due_to_collision: renamed,
        error_code: None,
        error_message: None,
        attribute_note,
        source_content_sha256,
    }
}

/// `std::fs::rename` on Windows passes `MOVEFILE_COPY_ALLOWED`, which can copy and
/// delete across volumes. Flags stay at 0: same-volume rename, fail if the target exists.
fn move_noreplace(from: &Path, to: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let from_wide: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
        let to_wide: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
        let ok = unsafe { MoveFileExW(from_wide.as_ptr(), to_wide.as_ptr(), 0) };
        if ok == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
    #[cfg(not(windows))]
    {
        if fs::symlink_metadata(to).is_ok() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "target exists",
            ));
        }
        fs::rename(from, to)
    }
}

#[cfg(windows)]
fn copy_windows_attributes(source: &Path, temp: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    const PRESERVE: u32 = 0x1 | 0x2 | 0x4 | 0x20;
    let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let attrs = unsafe { GetFileAttributesW(source_wide.as_ptr()) };
    if attrs == u32::MAX {
        return Err(io::Error::last_os_error());
    }
    let preserved = attrs & PRESERVE;
    if preserved == 0 {
        return Ok(());
    }
    let temp_wide: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
    let ok = unsafe { SetFileAttributesW(temp_wide.as_ptr(), preserved) };
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn copy_windows_attributes(_source: &Path, _temp: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(windows)]
unsafe extern "system" {
    fn MoveFileExW(existing: *const u16, new_name: *const u16, flags: u32) -> i32;
    fn GetFileAttributesW(name: *const u16) -> u32;
    fn SetFileAttributesW(name: *const u16, attrs: u32) -> i32;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::OpenOptions;
    use std::sync::atomic::AtomicUsize;

    struct DirectIo;

    impl IoGate for DirectIo {
        fn wait_visible(&self, cancel: &AtomicBool) -> bool {
            !cancel.load(Ordering::Relaxed)
        }

        fn with_read<T>(&self, work: impl FnOnce() -> T) -> T {
            work()
        }
    }

    struct StutterGate {
        reads_before_pause: usize,
        reads: AtomicUsize,
        writer_signal: Arc<AtomicBool>,
        writer_finished: Arc<AtomicBool>,
    }

    impl IoGate for StutterGate {
        fn wait_visible(&self, cancel: &AtomicBool) -> bool {
            !cancel.load(Ordering::Relaxed)
        }

        fn with_read<T>(&self, work: impl FnOnce() -> T) -> T {
            let result = work();
            let hit = self.reads.fetch_add(1, Ordering::Relaxed);
            if hit == self.reads_before_pause {
                self.writer_signal.store(true, Ordering::Relaxed);
                while !self.writer_finished.load(Ordering::Relaxed) {
                    std::thread::yield_now();
                }
            }
            result
        }
    }

    struct CancelGate {
        cancel: Arc<AtomicBool>,
        hits: AtomicUsize,
    }

    impl IoGate for CancelGate {
        fn wait_visible(&self, cancel: &AtomicBool) -> bool {
            !cancel.load(Ordering::Relaxed)
        }

        fn with_read<T>(&self, work: impl FnOnce() -> T) -> T {
            let hit = self.hits.fetch_add(1, Ordering::Relaxed);
            if hit >= 1 {
                self.cancel.store(true, Ordering::Relaxed);
            }
            work()
        }
    }

    fn sandbox() -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "stitchvue-ops-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn write_image(path: &Path, bytes: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, bytes).unwrap();
    }

    fn run(
        dir: &Path,
        action: Action,
        paths: Vec<String>,
        slots: usize,
        cancel: &AtomicBool,
    ) -> FileOperationResult {
        let request = OperationRequest {
            operation_id: format!("op-{}", paths.len()),
            directory: dir.display().to_string(),
            action,
            paths,
        };
        execute(&DirectIo, &request, slots, cancel, &|_progress| {}, None, None).unwrap()
    }

    #[test]
    fn duplicate_operation_id_replays_cached_result() {
        let root = sandbox();
        let source = root.join("once.jpg");
        write_image(&source, b"x");
        let request = OperationRequest {
            operation_id: "dup-op".to_string(),
            directory: root.display().to_string(),
            action: Action::CopyToLocalFavorites,
            paths: vec![source.display().to_string()],
        };
        let cancel = AtomicBool::new(false);
        let first = execute(&DirectIo, &request, 1, &cancel, &|_| {}, None, None).unwrap();
        assert_eq!(first.state, "completed");
        let second = execute(&DirectIo, &request, 1, &cancel, &|_| {}, None, None).unwrap();
        assert_eq!(second.state, "completed");
        assert_eq!(second.outcomes.len(), first.outcomes.len());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn suffix_keeps_the_last_extension() {
        assert_eq!(candidate_name("photo", "jpg", 1), "photo.jpg");
        assert_eq!(candidate_name("photo", "jpg", 2), "photo (2).jpg");
        assert_eq!(candidate_name("scan.final", "png", 2), "scan.final (2).png");
        assert_eq!(
            split_stem_ext("scan.final.png"),
            ("scan.final".to_string(), "png".to_string())
        );
    }

    #[test]
    fn maps_disk_full_and_sharing_violation() {
        assert_eq!(error_code(&io::Error::from_raw_os_error(112)), "no_space");
        assert_eq!(error_code(&io::Error::from_raw_os_error(32)), "locked");
        assert_eq!(
            error_code(&io::Error::from_raw_os_error(5)),
            "access_denied"
        );
    }

    #[test]
    fn move_creates_trash_and_does_not_erase_bytes() {
        let root = sandbox();
        let source = root.join("a.jpg");
        write_image(&source, b"original-bytes");
        let result = run(
            &root,
            Action::MoveToLocalTrash,
            vec![source.display().to_string()],
            1,
            &AtomicBool::new(false),
        );
        assert_eq!(result.state, "completed");
        assert_eq!(result.outcomes[0].status, "moved");
        assert!(!source.exists());
        let moved = root.join(LOCAL_TRASH).join("a.jpg");
        assert_eq!(fs::read(&moved).unwrap(), b"original-bytes");
        let again_source = root.join("b.jpg");
        write_image(&again_source, b"second");
        let second = run(
            &root,
            Action::MoveToLocalTrash,
            vec![again_source.display().to_string()],
            1,
            &AtomicBool::new(false),
        );
        assert_eq!(second.outcomes[0].status, "moved");
        assert!(root.join(LOCAL_TRASH).join("b.jpg").is_file());
        assert!(root.join(LOCAL_TRASH).is_dir());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn move_identical_content_still_keeps_a_separate_file() {
        let root = sandbox();
        let trash = root.join(LOCAL_TRASH);
        fs::create_dir(&trash).unwrap();
        write_service_role(&trash, ServiceRole::Trash).unwrap();
        write_image(&trash.join("photo.jpg"), b"same-bytes");
        let source = root.join("photo.jpg");
        write_image(&source, b"same-bytes");
        let result = run(
            &root,
            Action::MoveToLocalTrash,
            vec![source.display().to_string()],
            1,
            &AtomicBool::new(false),
        );
        assert_eq!(result.outcomes[0].status, "moved");
        assert!(result.outcomes[0].renamed_due_to_collision);
        assert!(!source.exists());
        assert_eq!(fs::read(trash.join("photo.jpg")).unwrap(), b"same-bytes");
        assert_eq!(
            fs::read(trash.join("photo (2).jpg")).unwrap(),
            b"same-bytes"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_identical_bytes_is_not_an_error_and_source_stays() {
        let root = sandbox();
        let favorites = root.join(LOCAL_FAVORITES);
        fs::create_dir(&favorites).unwrap();
        write_service_role(&favorites, ServiceRole::Favorites).unwrap();
        write_image(&favorites.join("photo.jpg"), b"same-bytes");
        let source = root.join("photo.jpg");
        write_image(&source, b"same-bytes");
        let result = run(
            &root,
            Action::CopyToLocalFavorites,
            vec![source.display().to_string()],
            1,
            &AtomicBool::new(false),
        );
        assert_eq!(result.outcomes[0].status, "already_exists");
        assert_eq!(result.state, "completed");
        assert_eq!(fs::read(&source).unwrap(), b"same-bytes");
        assert!(favorites.join("photo (2).jpg").exists() == false);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn origin_mutation_during_copy_yields_non_matching_hash() {
        let root = sandbox();
        let source = root.join("mutate-during.jpg");
        let body_a: Vec<u8> = vec![7_u8; 3 * 1024 * 1024];
        let body_b: Vec<u8> = vec![9_u8; 3 * 1024 * 1024];
        write_image(&source, &body_a);
        let original_hash = crate::file_ops::content_hash::sha256_file(&source).unwrap();
        let writer_signal = Arc::new(AtomicBool::new(false));
        let writer_finished = Arc::new(AtomicBool::new(false));
        let gate = StutterGate {
            reads_before_pause: 0, // after first 1 MiB chunk
            reads: AtomicUsize::new(0),
            writer_signal: Arc::clone(&writer_signal),
            writer_finished: Arc::clone(&writer_finished),
        };
        let writer = std::thread::spawn({
            let source = source.clone();
            let writer_signal = Arc::clone(&writer_signal);
            let writer_finished = Arc::clone(&writer_finished);
            move || {
                while !writer_signal.load(Ordering::Relaxed) {
                    std::thread::yield_now();
                }
                write_image(&source, &body_b);
                writer_finished.store(true, Ordering::Relaxed);
            }
        });
        let request = OperationRequest {
            operation_id: "mutate-during".to_string(),
            directory: root.display().to_string(),
            action: Action::CopyToLocalFavorites,
            paths: vec![source.display().to_string()],
        };
        let cancel = AtomicBool::new(false);
        let result = execute(&gate, &request, 1, &cancel, &|_| {}, None, None).unwrap();
        writer.join().unwrap();
        assert_eq!(result.outcomes[0].status, "copied");
        let hash = result.outcomes[0].source_content_sha256.as_deref().unwrap();
        assert_ne!(hash, original_hash.as_str());
        assert_ne!(
            hash,
            crate::file_ops::content_hash::sha256_file(&source)
                .unwrap()
                .as_str()
        );
        let _ = fs::remove_dir_all(&root);
    }

    fn copy_to_favorites_records_streaming_sha256_of_source_bytes() {
        let root = sandbox();
        let source = root.join("hash-me.jpg");
        write_image(&source, b"stitchvue-fav-hash");
        let expected = crate::file_ops::content_hash::sha256_file(&source).unwrap();
        let result = run(
            &root,
            Action::CopyToLocalFavorites,
            vec![source.display().to_string()],
            1,
            &AtomicBool::new(false),
        );
        assert_eq!(result.outcomes[0].status, "copied");
        assert_eq!(
            result.outcomes[0].source_content_sha256.as_deref(),
            Some(expected.as_str())
        );
        let dest = root.join(LOCAL_FAVORITES).join("hash-me.jpg");
        assert_eq!(fs::read(&dest).unwrap(), b"stitchvue-fav-hash");
        assert_eq!(
            crate::file_ops::content_hash::sha256_file(&dest).unwrap(),
            expected
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_same_size_and_mtime_with_different_bytes_gets_a_suffix() {
        let root = sandbox();
        let favorites = root.join(LOCAL_FAVORITES);
        fs::create_dir(&favorites).unwrap();
        write_service_role(&favorites, ServiceRole::Favorites).unwrap();
        let existing = favorites.join("photo.jpg");
        write_image(&existing, b"aaaa");
        let source = root.join("photo.jpg");
        write_image(&source, b"bbbb");
        let modified = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
        OpenOptions::new()
            .write(true)
            .open(&existing)
            .unwrap()
            .set_modified(modified)
            .unwrap();
        OpenOptions::new()
            .write(true)
            .open(&source)
            .unwrap()
            .set_modified(modified)
            .unwrap();
        let result = run(
            &root,
            Action::CopyToLocalFavorites,
            vec![source.display().to_string()],
            2,
            &AtomicBool::new(false),
        );
        assert_eq!(result.outcomes[0].status, "copied");
        assert!(result.outcomes[0].renamed_due_to_collision);
        assert_eq!(fs::read(&source).unwrap(), b"bbbb");
        assert_eq!(fs::read(&existing).unwrap(), b"aaaa");
        assert_eq!(fs::read(favorites.join("photo (2).jpg")).unwrap(), b"bbbb");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copy_does_not_replace_an_existing_different_file() {
        let root = sandbox();
        let source = root.join("scan.final.png");
        write_image(&source, b"new-bytes");
        let result = run(
            &root,
            Action::CopyToLocalFavorites,
            vec![source.display().to_string(), source.display().to_string()],
            2,
            &AtomicBool::new(false),
        );
        assert_eq!(result.outcomes.len(), 1);
        assert_eq!(result.outcomes[0].status, "copied");
        assert_eq!(fs::read(&source).unwrap(), b"new-bytes");
        assert_eq!(
            fs::read(root.join(LOCAL_FAVORITES).join("scan.final.png")).unwrap(),
            b"new-bytes"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copies_one_hundred_files_and_moves_them_back_via_trash() {
        let root = sandbox();
        let mut paths = Vec::new();
        for index in 0..100 {
            let path = root.join(format!("img-{index}.jpg"));
            write_image(&path, format!("body-{index}").as_bytes());
            paths.push(path.display().to_string());
        }
        let copied = run(
            &root,
            Action::CopyToLocalFavorites,
            paths.clone(),
            2,
            &AtomicBool::new(false),
        );
        assert_eq!(copied.state, "completed");
        assert_eq!(copied.outcomes.len(), 100);
        assert!(root.join("img-0.jpg").is_file());
        assert!(root.join(LOCAL_FAVORITES).join("img-99.jpg").is_file());
        let moved = run(
            &root,
            Action::MoveToLocalTrash,
            paths,
            1,
            &AtomicBool::new(false),
        );
        assert_eq!(
            moved
                .outcomes
                .iter()
                .filter(|item| item.status == "moved")
                .count(),
            100
        );
        assert!(!root.join("img-0.jpg").exists());
        assert!(root.join(LOCAL_TRASH).join("img-0.jpg").is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_parent_segments_nested_files_and_non_images() {
        let root = sandbox();
        let nested = root.join("nested");
        fs::create_dir(&nested).unwrap();
        write_image(&nested.join("inner.jpg"), b"inner");
        write_image(&root.join("notes.txt"), b"text");
        let outside =
            std::env::temp_dir().join(format!("stitchvue-outside-{}.jpg", std::process::id()));
        write_image(&outside, b"secret");
        let escaped = root.join("..").join(outside.file_name().unwrap());
        let result = run(
            &root,
            Action::MoveToLocalTrash,
            vec![
                nested.join("inner.jpg").display().to_string(),
                root.join("notes.txt").display().to_string(),
                escaped.display().to_string(),
                root.join("missing.jpg").display().to_string(),
            ],
            1,
            &AtomicBool::new(false),
        );
        assert!(result.outcomes.iter().all(|item| item.status == "failed"));
        assert!(!root.join(LOCAL_TRASH).exists());
        assert!(nested.join("inner.jpg").is_file());
        assert!(outside.is_file());
        let _ = fs::remove_file(&outside);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn service_folder_blocks_both_actions() {
        let root = sandbox();
        let trash = root.join("корзина");
        fs::create_dir(&trash).unwrap();
        write_service_role(&trash, ServiceRole::Trash).unwrap();
        write_image(&trash.join("a.jpg"), b"x");
        let request = OperationRequest {
            operation_id: "svc".to_string(),
            directory: trash.display().to_string(),
            action: Action::CopyToLocalFavorites,
            paths: vec![trash.join("a.jpg").display().to_string()],
        };
        let error = execute(
            &DirectIo,
            &request,
            1,
            &AtomicBool::new(false),
            &|_progress| {},
            None,
            None,
        )
        .unwrap_err();
        assert!(error.contains("служебн"));
        assert!(trash.join("a.jpg").is_file());
        assert!(!trash.join(LOCAL_FAVORITES).exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn empty_service_folder_is_removed_after_last_photo() {
        let root = sandbox();
        let favorites = root.join(LOCAL_FAVORITES);
        fs::create_dir(&favorites).unwrap();
        write_service_role(&favorites, ServiceRole::Favorites).unwrap();
        write_image(&favorites.join("only.jpg"), b"one");
        fs::remove_file(favorites.join("only.jpg")).unwrap();
        let removed = remove_service_folder_if_empty(&favorites).unwrap();
        assert!(removed.is_some());
        assert!(!favorites.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cleanup_reports_not_empty_when_foreign_files_remain() {
        let root = sandbox();
        let favorites = root.join(LOCAL_FAVORITES);
        fs::create_dir(&favorites).unwrap();
        write_service_role(&favorites, ServiceRole::Favorites).unwrap();
        File::create(favorites.join("notes.txt"))
            .unwrap()
            .write_all(b"keep")
            .unwrap();
        let outcome = cleanup_empty_service_folder(
            &root.display().to_string(),
            &favorites.display().to_string(),
        );
        assert_eq!(outcome.status, "not_empty");
        assert!(favorites.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cleanup_reports_already_gone_for_missing_favorites() {
        let root = sandbox();
        let favorites = root.join(LOCAL_FAVORITES);
        let outcome = cleanup_empty_service_folder(
            &root.display().to_string(),
            &favorites.display().to_string(),
        );
        assert_eq!(outcome.status, "already_gone");
        assert!(outcome.location.is_some());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cleanup_reports_not_empty_for_nested_directory() {
        let root = sandbox();
        let favorites = root.join(LOCAL_FAVORITES);
        fs::create_dir(&favorites).unwrap();
        write_service_role(&favorites, ServiceRole::Favorites).unwrap();
        fs::create_dir(favorites.join("nested")).unwrap();
        let outcome = cleanup_service_folder_at(&favorites);
        assert_eq!(outcome.status, "not_empty");
        assert!(favorites.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn folder_name_alone_is_not_a_service_role() {
        let root = sandbox();
        let named = root.join("Избранное");
        fs::create_dir(&named).unwrap();
        write_image(&named.join("a.jpg"), b"plain");
        let copied = run(
            &named,
            Action::CopyToLocalFavorites,
            vec![named.join("a.jpg").display().to_string()],
            1,
            &AtomicBool::new(false),
        );
        assert_eq!(copied.outcomes[0].status, "copied");
        assert!(read_service_role(&named).is_none());
        assert_eq!(
            read_service_role(&named.join(LOCAL_FAVORITES)),
            Some(ServiceRole::Favorites)
        );
        assert!(copied.destination_created);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn destination_file_is_not_replaced_with_another_folder_name() {
        let root = sandbox();
        write_image(&root.join(LOCAL_TRASH), b"not-a-folder");
        write_image(&root.join("a.jpg"), b"keep");
        let result = run(
            &root,
            Action::MoveToLocalTrash,
            vec![root.join("a.jpg").display().to_string()],
            1,
            &AtomicBool::new(false),
        );
        assert_eq!(result.outcomes[0].status, "failed");
        assert_eq!(fs::read(root.join("a.jpg")).unwrap(), b"keep");
        assert_eq!(fs::read(root.join(LOCAL_TRASH)).unwrap(), b"not-a-folder");
        assert!(!root.join(format!("{LOCAL_TRASH} (2)")).exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn cancelled_copy_publishes_nothing_and_leaves_the_source() {
        let root = sandbox();
        let source = root.join("big.jpg");
        write_image(&source, b"abcdef");
        let cancel = Arc::new(AtomicBool::new(false));
        let gate = CancelGate {
            cancel: Arc::clone(&cancel),
            hits: AtomicUsize::new(0),
        };
        let request = OperationRequest {
            operation_id: "cancel".to_string(),
            directory: root.display().to_string(),
            action: Action::CopyToLocalFavorites,
            paths: vec![source.display().to_string()],
        };
        let result = execute(&gate, &request, 1, &cancel, &|_progress| {}, None, None).unwrap();
        assert_eq!(result.outcomes[0].status, "cancelled");
        assert_eq!(fs::read(&source).unwrap(), b"abcdef");
        let favorites = root.join(LOCAL_FAVORITES);
        if favorites.exists() {
            let published = fs::read_dir(&favorites).unwrap().any(|entry| {
                entry
                    .ok()
                    .is_some_and(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
            });
            assert!(!published);
            let temps = fs::read_dir(&favorites).unwrap().any(|entry| {
                entry.ok().is_some_and(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with(".stitchvue-")
                })
            });
            assert!(!temps);
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn empty_unmarked_favorites_folder_is_adopted() {
        let root = sandbox();
        let named = root.join(LOCAL_FAVORITES);
        fs::create_dir(&named).unwrap();
        write_image(&root.join("a.jpg"), b"origin");
        let result = run(
            &root,
            Action::CopyToLocalFavorites,
            vec![root.join("a.jpg").display().to_string()],
            1,
            &AtomicBool::new(false),
        );
        assert_eq!(result.outcomes[0].status, "copied");
        assert_eq!(read_service_role(&named), Some(ServiceRole::Favorites));
        assert!(!result.destination_created);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn favorites_uses_alternate_name_when_primary_is_occupied() {
        let root = sandbox();
        let blocked = root.join(LOCAL_FAVORITES);
        fs::create_dir(&blocked).unwrap();
        write_image(&blocked.join("keep.jpg"), b"keep");
        write_image(&root.join("a.jpg"), b"fav");
        let result = run(
            &root,
            Action::CopyToLocalFavorites,
            vec![root.join("a.jpg").display().to_string()],
            1,
            &AtomicBool::new(false),
        );
        assert_eq!(result.outcomes[0].status, "copied");
        assert!(read_service_role(&blocked).is_none());
        let alt = root.join(LOCAL_FAVORITES_ALT);
        assert_eq!(read_service_role(&alt), Some(ServiceRole::Favorites));
        assert_eq!(fs::read(alt.join("a.jpg")).unwrap(), b"fav");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn unmarked_existing_folder_is_not_claimed() {
        let root = sandbox();
        let named = root.join(LOCAL_TRASH);
        fs::create_dir(&named).unwrap();
        write_image(&named.join("keep.jpg"), b"user");
        write_image(&root.join("a.jpg"), b"keep-origin");
        let result = run(
            &root,
            Action::MoveToLocalTrash,
            vec![root.join("a.jpg").display().to_string()],
            1,
            &AtomicBool::new(false),
        );
        assert_eq!(result.outcomes[0].status, "failed");
        assert_eq!(
            result.outcomes[0].error_code.as_deref(),
            Some("destination_unmarked")
        );
        assert!(result.outcomes[0]
            .error_message
            .as_deref()
            .is_some_and(
                |text| text.contains("unmarked_conflict") || text.contains("не является служебной")
            ));
        assert_eq!(fs::read(root.join("a.jpg")).unwrap(), b"keep-origin");
        assert!(read_service_role(&named).is_none());
        assert_eq!(fs::read(named.join("keep.jpg")).unwrap(), b"user");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn missing_source_does_not_create_the_destination_folder() {
        let root = sandbox();
        let result = run(
            &root,
            Action::CopyToLocalFavorites,
            vec![root.join("gone.jpg").display().to_string()],
            1,
            &AtomicBool::new(false),
        );
        assert_eq!(result.outcomes[0].status, "failed");
        assert!(!root.join(LOCAL_FAVORITES).exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    #[test]
    fn locked_file_stays_in_place() {
        let root = sandbox();
        let source = root.join("locked.jpg");
        write_image(&source, b"locked");
        let handle = lock_exclusive(&source);
        let result = run(
            &root,
            Action::MoveToLocalTrash,
            vec![source.display().to_string()],
            1,
            &AtomicBool::new(false),
        );
        assert_eq!(result.outcomes[0].status, "failed");
        assert_eq!(result.outcomes[0].error_code.as_deref(), Some("locked"));
        drop(handle);
        assert_eq!(fs::read(&source).unwrap(), b"locked");
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    #[test]
    fn junction_destination_and_parent_escape_are_rejected() {
        let root = sandbox();
        let real = root.join("real-target");
        fs::create_dir(&real).unwrap();
        let link = root.join(LOCAL_TRASH);
        let created = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&real)
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if !created {
            let _ = fs::remove_dir_all(&root);
            return;
        }
        let source = root.join("a.jpg");
        write_image(&source, b"stay");
        let result = run(
            &root,
            Action::MoveToLocalTrash,
            vec![source.display().to_string()],
            1,
            &AtomicBool::new(false),
        );
        assert_eq!(result.outcomes[0].status, "failed");
        assert_eq!(fs::read(&source).unwrap(), b"stay");
        assert!(fs::read_dir(&real).unwrap().next().is_none());

        let via = root.join("via-link");
        let via_created = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&via)
            .arg(&root)
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
        if via_created {
            let request = OperationRequest {
                operation_id: "junction-dir".to_string(),
                directory: via.display().to_string(),
                action: Action::MoveToLocalTrash,
                paths: vec![source.display().to_string()],
            };
            let error = execute(
                &DirectIo,
                &request,
                1,
                &AtomicBool::new(false),
                &|_progress| {},
                None,
                None,
            )
            .unwrap_err();
            assert!(error.contains("ссылк"));
            assert_eq!(fs::read(&source).unwrap(), b"stay");
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    struct LockHandle(*mut std::ffi::c_void);

    #[cfg(windows)]
    impl Drop for LockHandle {
        fn drop(&mut self) {
            if !self.0.is_null() && self.0 != (-1isize as *mut std::ffi::c_void) {
                unsafe { CloseHandle(self.0) };
            }
        }
    }

    #[test]
    fn changed_copy_is_kept() {
        let root = sandbox();
        let copy = root.join("a.jpg");
        write_image(&copy, b"same");
        let modified = fs::metadata(&copy).unwrap().modified().unwrap();
        let ms = modified.duration_since(UNIX_EPOCH).unwrap().as_millis() as i64;
        assert!(confirm_copy_unchanged(&copy, 4, ms).is_ok());
        write_image(&copy, b"changed-bytes");
        let err = confirm_copy_unchanged(&copy, 4, ms).unwrap_err();
        assert!(err.contains("изменена"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn renamed_trash_matches_only_one_missing_file_of_the_same_size() {
        let root = sandbox();
        let trash = root.join(LOCAL_TRASH);
        fs::create_dir(&trash).unwrap();
        let renamed = trash.join("photo-renamed.jpg");
        write_image(&renamed, b"abcd");
        let row = TrashCandidate {
            trash_path: trash.join("photo.jpg").display().to_string(),
            origin_path: root.join("photo.jpg").display().to_string(),
            source_size: Some(4),
        };
        let matched = match_renamed_trash(&trash, &renamed, &[row.clone()]).unwrap();
        assert_eq!(matched.origin_path, row.origin_path);
        let other = TrashCandidate {
            trash_path: trash.join("other.jpg").display().to_string(),
            origin_path: root.join("other.jpg").display().to_string(),
            source_size: Some(4),
        };
        assert!(match_renamed_trash(&trash, &renamed, &[row, other]).is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    fn lock_exclusive(path: &Path) -> LockHandle {
        use std::os::windows::ffi::OsStrExt;
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                0x8000_0000,
                0,
                std::ptr::null_mut(),
                3,
                0,
                std::ptr::null_mut(),
            )
        };
        assert!(!handle.is_null() && handle != (-1isize as *mut std::ffi::c_void));
        LockHandle(handle)
    }

    #[test]
    fn path_syntax_allows_drive_extended_and_unc_forms() {
        assert!(!has_disallowed_path_syntax(r"C:\Photos\Album\image.jpg"));
        assert!(!has_disallowed_path_syntax(
            r"\\?\C:\Photos\Album\image.jpg"
        ));
        assert!(!has_disallowed_path_syntax(
            r"\\server\share\Photos\image.jpg"
        ));
        assert!(!has_disallowed_path_syntax(
            r"\\?\UNC\server\share\Photos\image.jpg"
        ));
        assert!(!has_disallowed_path_syntax(
            r"D:\Фото\Альбом с пробелом\фото.jpg"
        ));
        assert!(!has_disallowed_path_syntax(&format!(
            r"\\?\C:\{}",
            "a".repeat(300)
        )));
    }

    #[cfg(not(windows))]
    #[test]
    fn path_syntax_allows_colons_in_unix_names() {
        assert!(!has_disallowed_path_syntax("/home/me/Photos/12:30 Party/a.jpg"));
        assert!(has_disallowed_path_syntax(""));
        assert!(has_disallowed_path_syntax("/home/me/a\0b.jpg"));
    }

    #[cfg(windows)]
    #[test]
    fn path_syntax_rejects_empty_nul_ads_and_device_namespace() {
        assert!(has_disallowed_path_syntax(""));
        assert!(has_disallowed_path_syntax("C:\\a\0b.jpg"));
        assert!(has_disallowed_path_syntax(
            r"C:\Photos\image.jpg:Zone.Identifier"
        ));
        assert!(has_disallowed_path_syntax(
            r"\\?\C:\Photos\image.jpg:stream"
        ));
        assert!(has_disallowed_path_syntax(r"\\.\C:\Photos\image.jpg"));
        assert!(has_disallowed_path_syntax(r"\\.\PhysicalDrive0"));
        assert!(has_disallowed_path_syntax(
            r"\\?\GLOBALROOT\Device\Harddisk0"
        ));
        assert!(has_disallowed_path_syntax(
            r"\\?\Volume{00000000-0000-0000-0000-000000000000}\a.jpg"
        ));
    }

    // Windows path fixtures (drive letters, `\\?\`, UNC).
    #[cfg(windows)]
    #[test]
    fn normalize_key_equates_extended_and_ordinary_drive_paths() {
        let ordinary = Path::new(r"C:\Photos\Album\image.jpg");
        let extended = Path::new(r"\\?\C:\Photos\Album\image.jpg");
        assert!(same_path(ordinary, extended));
        let unc = Path::new(r"\\server\share\Photos\image.jpg");
        let unc_ext = Path::new(r"\\?\UNC\server\share\Photos\image.jpg");
        assert!(same_path(unc, unc_ext));
    }

    // Windows path fixtures (drive letters, `\\?\`, UNC).
    #[cfg(windows)]
    #[test]
    fn path_string_for_app_strips_extended_prefix() {
        assert_eq!(
            path_string_for_app(Path::new(r"\\?\C:\Photos\a.jpg")),
            r"C:\Photos\a.jpg"
        );
        assert_eq!(
            path_string_for_app(Path::new(r"\\?\UNC\server\share\a.jpg")),
            r"\\server\share\a.jpg"
        );
    }

    #[test]
    fn missing_favorites_folder_is_recreated_on_copy() {
        let root = sandbox();
        let source = root.join("photo.jpg");
        write_image(&source, b"fav-bytes");
        assert!(!root.join(LOCAL_FAVORITES).exists());
        let result = run(
            &root,
            Action::CopyToLocalFavorites,
            vec![source.display().to_string()],
            1,
            &AtomicBool::new(false),
        );
        assert_eq!(result.outcomes[0].status, "copied");
        assert!(result.destination_created);
        let favorites = root.join(LOCAL_FAVORITES);
        assert!(favorites.is_dir());
        assert_eq!(read_service_role(&favorites), Some(ServiceRole::Favorites));
        assert_eq!(fs::read(favorites.join("photo.jpg")).unwrap(), b"fav-bytes");
        assert_eq!(fs::read(&source).unwrap(), b"fav-bytes");
        let again = run(
            &root,
            Action::CopyToLocalFavorites,
            vec![source.display().to_string()],
            1,
            &AtomicBool::new(false),
        );
        assert_eq!(again.outcomes[0].status, "already_exists");
        assert!(!favorites.join("photo (2).jpg").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    #[test]
    fn favorite_after_remove_works_with_extended_listed_paths() {
        let root = sandbox();
        let source = root.join("photo.jpg");
        write_image(&source, b"fav-bytes");
        let favorites = root.join(LOCAL_FAVORITES);
        fs::create_dir(&favorites).unwrap();
        write_service_role(&favorites, ServiceRole::Favorites).unwrap();

        let removed = remove_empty_service_folder(
            &root.display().to_string(),
            &favorites.display().to_string(),
        )
        .unwrap();
        assert!(
            !removed.parent_directory.starts_with(r"\\?\"),
            "UI parent must not keep extended prefix: {}",
            removed.parent_directory
        );
        assert!(!favorites.exists());

        let canonical_parent = fs::canonicalize(&root).unwrap();
        let extended_file = canonical_parent.join("photo.jpg").display().to_string();
        assert!(extended_file.starts_with(r"\\?\"));
        let result = run(
            Path::new(&removed.parent_directory),
            Action::CopyToLocalFavorites,
            vec![extended_file],
            1,
            &AtomicBool::new(false),
        );
        assert_eq!(result.outcomes[0].status, "copied");
        assert!(result.destination_created);
        let recreated = root.join(LOCAL_FAVORITES);
        assert!(recreated.is_dir());
        assert_eq!(read_service_role(&recreated), Some(ServiceRole::Favorites));
        assert_eq!(fs::read(recreated.join("photo.jpg")).unwrap(), b"fav-bytes");
        assert_eq!(fs::read(&source).unwrap(), b"fav-bytes");
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    #[test]
    fn resolve_source_accepts_canonicalize_extended_path() {
        let root = sandbox();
        let source = root.join("photo.jpg");
        write_image(&source, b"x");
        let directory = fs::canonicalize(&root).unwrap();
        let requested = directory.join("photo.jpg").display().to_string();
        assert!(requested.starts_with(r"\\?\"));
        let resolved = match resolve_source(&directory, &requested) {
            Ok(path) => path,
            Err(fail) => panic!("extended path must resolve: {}", fail.message),
        };
        assert!(same_path(&resolved, &directory.join("photo.jpg")));
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    unsafe extern "system" {
        fn CreateFileW(
            name: *const u16,
            access: u32,
            share: u32,
            security: *mut std::ffi::c_void,
            disposition: u32,
            flags: u32,
            template: *mut std::ffi::c_void,
        ) -> *mut std::ffi::c_void;
        fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
    }
}
