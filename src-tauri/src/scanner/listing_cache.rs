use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::{Arc, Condvar, LazyLock, Mutex};
use std::time::SystemTime;

use super::folder::{scan_directory, DirectoryView, ImageBatch, ImageFile};

const MAX_FOLDERS: usize = 8;
const MAX_BYTES: usize = 16 * 1024 * 1024;
const MAX_SCAN_ATTEMPTS: u32 = 3;

struct Entry {
    key: String,
    modified: i64,
    stamp: u64,
    view: DirectoryView,
    bytes: usize,
}

struct Flight {
    slot: Mutex<Option<Result<DirectoryView, String>>>,
    done: Condvar,
}

struct Lead {
    key: String,
    flight: Arc<Flight>,
    done: bool,
}

impl Drop for Lead {
    fn drop(&mut self) {
        if self.done {
            return;
        }
        finish(&self.flight, Err("folder listing stopped".to_string()));
        let mut cache = CACHE.lock().unwrap_or_else(|err| err.into_inner());
        cache.inflight.retain(|(path, _)| path != &self.key);
    }
}

struct Cache {
    entries: VecDeque<Entry>,
    inflight: Vec<(String, Arc<Flight>)>,
    generations: HashMap<String, u64>,
}

static CACHE: LazyLock<Mutex<Cache>> = LazyLock::new(|| {
    Mutex::new(Cache {
        entries: VecDeque::new(),
        inflight: Vec::new(),
        generations: HashMap::new(),
    })
});

pub(super) fn load(
    folder: &Path,
    on_batch: &mut dyn FnMut(&ImageBatch),
) -> Result<DirectoryView, String> {
    let key = cache_key(folder);
    for attempt in 0..MAX_SCAN_ATTEMPTS {
        let modified = dir_modified(folder);
        if let Some(view) = take_fresh(&key, modified, folder) {
            replay(&view, on_batch);
            return Ok(view);
        }

        let mut cache = CACHE.lock().unwrap_or_else(|err| err.into_inner());
        if cache.snapshot(&key, modified).is_some() {
            drop(cache);
            continue;
        }
        if let Some((_, existing)) = cache.inflight.iter().find(|(path, _)| path == &key) {
            let flight = Arc::clone(existing);
            drop(cache);
            let view = wait(&flight)?;
            if listing_matches_disk(folder, &view) {
                replay(&view, on_batch);
                return Ok(view);
            }
            continue;
        }
        let scan_generation = cache.generation(&key);
        let created = Arc::new(Flight {
            slot: Mutex::new(None),
            done: Condvar::new(),
        });
        cache.inflight.push((key.clone(), Arc::clone(&created)));
        drop(cache);

        let mut lead = Lead {
            key: key.clone(),
            flight: Arc::clone(&created),
            done: false,
        };
        let scanned = scan_directory(folder, on_batch);
        let view = match scanned {
            Ok(view) => view,
            Err(err) => {
                {
                    let mut cache = CACHE.lock().unwrap_or_else(|err| err.into_inner());
                    cache.inflight.retain(|(path, _)| path != &key);
                }
                finish(&created, Err(err.clone()));
                lead.done = true;
                return Err(err);
            }
        };
        let dir_mtime_after = dir_modified(folder);
        let store_stamp = view_listing_stamp(folder, &view);
        let disk_stamp = content_stamp(folder);
        let mut cache = CACHE.lock().unwrap_or_else(|err| err.into_inner());
        if cache.generation(&key) == scan_generation
            && dir_mtime_after == modified
            && store_stamp == disk_stamp
        {
            cache.store(key.clone(), modified, store_stamp, view.clone());
        }
        cache.inflight.retain(|(path, _)| path != &key);
        finish(&created, Ok(view.clone()));
        lead.done = true;

        if listing_matches_disk(folder, &view) {
            replay(&view, on_batch);
            return Ok(view);
        }
        if attempt + 1 >= MAX_SCAN_ATTEMPTS {
            replay(&view, on_batch);
            return Ok(view);
        }
    }
    scan_directory(folder, on_batch)
}

fn listing_matches_disk(folder: &Path, view: &DirectoryView) -> bool {
    view_listing_stamp(folder, view) == content_stamp(folder)
}

fn take_fresh(key: &str, modified: i64, folder: &Path) -> Option<DirectoryView> {
    let found = {
        let cache = CACHE.lock().unwrap_or_else(|err| err.into_inner());
        cache.snapshot(key, modified)
    };
    let (view, stamp) = found?;
    let disk_stamp = content_stamp(folder);
    if disk_stamp != stamp || view_listing_stamp(folder, &view) != stamp {
        let mut cache = CACHE.lock().unwrap_or_else(|err| err.into_inner());
        cache.entries.retain(|entry| !(entry.key == key && entry.stamp == stamp));
        return None;
    }
    let mut cache = CACHE.lock().unwrap_or_else(|err| err.into_inner());
    if cache
        .entries
        .iter()
        .any(|entry| entry.key == key && entry.modified == modified && entry.stamp == stamp)
    {
        cache.touch(key);
        Some(view)
    } else {
        None
    }
}

impl Cache {
    fn generation(&self, key: &str) -> u64 {
        self.generations.get(key).copied().unwrap_or(0)
    }

    fn bump_generation(&mut self, key: &str) {
        let next = self.generation(key) + 1;
        self.generations.insert(key.to_string(), next);
    }

    fn touch(&mut self, key: &str) {
        if let Some(index) = self.entries.iter().position(|entry| entry.key == key) {
            if let Some(entry) = self.entries.remove(index) {
                self.entries.push_back(entry);
            }
        }
    }

    fn snapshot(&self, key: &str, modified: i64) -> Option<(DirectoryView, u64)> {
        self.entries
            .iter()
            .find(|entry| entry.key == key && entry.modified == modified)
            .map(|entry| (entry.view.clone(), entry.stamp))
    }

    fn store(&mut self, key: String, modified: i64, stamp: u64, view: DirectoryView) {
        self.entries.retain(|entry| entry.key != key);
        let bytes = estimate(&view);
        self.entries.push_back(Entry {
            key,
            modified,
            stamp,
            view,
            bytes,
        });
        while self.entries.len() > MAX_FOLDERS || self.total_bytes() > MAX_BYTES {
            if self.entries.len() <= 1 {
                break;
            }
            self.entries.pop_front();
        }
    }

    fn total_bytes(&self) -> usize {
        self.entries.iter().map(|entry| entry.bytes).sum()
    }
}

fn finish(flight: &Flight, result: Result<DirectoryView, String>) {
    let mut slot = flight.slot.lock().unwrap_or_else(|err| err.into_inner());
    *slot = Some(result);
    flight.done.notify_all();
}

fn wait(flight: &Flight) -> Result<DirectoryView, String> {
    let mut slot = flight.slot.lock().unwrap_or_else(|err| err.into_inner());
    while slot.is_none() {
        slot = flight.done.wait(slot).unwrap_or_else(|err| err.into_inner());
    }
    slot.clone().unwrap_or_else(|| Err("folder listing was dropped".to_string()))
}

fn replay(view: &DirectoryView, on_batch: &mut dyn FnMut(&ImageBatch)) {
    let Some(folder) = view.path.clone() else {
        return;
    };
    let names: Vec<ImageFile> = view
        .images
        .iter()
        .map(|file| ImageFile {
            name: file.name.clone(),
            path: file.path.clone(),
            size: 0,
            modified_at: 0,
        })
        .collect();
    emit_chunks(&folder, "names", &names, on_batch);
    emit_chunks(&folder, "stats", &view.images, on_batch);
}

fn emit_chunks(folder: &str, phase: &str, files: &[ImageFile], on_batch: &mut dyn FnMut(&ImageBatch)) {
    let mut batch = Vec::new();
    let mut sent = 0usize;
    for file in files {
        batch.push(file.clone());
        sent += 1;
        let limit = if sent <= 48 { 48 } else { 200 };
        if batch.len() >= limit {
            on_batch(&ImageBatch {
                folder: folder.to_string(),
                phase: phase.to_string(),
                files: std::mem::take(&mut batch),
                session: 0,
            });
        }
    }
    if !batch.is_empty() {
        on_batch(&ImageBatch {
            folder: folder.to_string(),
            phase: phase.to_string(),
            files: batch,
            session: 0,
        });
    }
}

fn estimate(view: &DirectoryView) -> usize {
    let mut bytes = 256;
    for folder in &view.folders {
        bytes += folder.path.len() * 2 + folder.name.len() * 2 + 16;
    }
    for file in &view.images {
        bytes += file.path.len() * 2 + file.name.len() * 2 + 24;
    }
    bytes
}

fn view_listing_stamp(folder: &Path, view: &DirectoryView) -> u64 {
    let mut stamp = 0xcbf29ce484222325u64;
    for child in &view.folders {
        stamp ^= mix(&child.name, 0, 0, true);
    }
    for file in &view.images {
        stamp ^= mix(&file.name, file.size, file.modified_at, false);
    }
    stamp ^= role_file_stamp(folder);
    stamp
}

fn role_file_stamp(folder: &Path) -> u64 {
    if let Ok(meta) = std::fs::symlink_metadata(folder.join(".stitchvue.role")) {
        if meta.is_file() {
            let modified = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|time| time.as_millis() as i64)
                .unwrap_or(0);
            return mix(".stitchvue.role", meta.len(), modified, false);
        }
    }
    0
}

fn content_stamp(folder: &Path) -> u64 {
    let mut stamp = 0xcbf29ce484222325u64;
    let Ok(entries) = std::fs::read_dir(folder) else {
        return 0;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') || name.starts_with('$') {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            stamp ^= mix(&name, 0, 0, true);
            continue;
        }
        if !file_type.is_file() || !crate::formats::listed_image(Path::new(name.as_ref())) {
            continue;
        }
        let meta = entry.metadata().ok();
        let len = meta.as_ref().map(|meta| meta.len()).unwrap_or(0);
        let modified = meta
            .and_then(|meta| meta.modified().ok())
            .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|time| time.as_millis() as i64)
            .unwrap_or(0);
        stamp ^= mix(&name, len, modified, false);
    }
    stamp ^= role_file_stamp(folder);
    stamp
}

fn mix(name: &str, len: u64, modified: i64, is_dir: bool) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in name.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash ^= len;
    hash = hash.wrapping_mul(0x100000001b3);
    hash ^= modified as u64;
    hash = hash.wrapping_mul(0x100000001b3);
    hash ^= if is_dir { 1 } else { 2 };
    hash
}

pub(super) fn cache_key(folder: &Path) -> String {
    folder.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

pub(super) fn drop_listing(folder: &Path) {
    let key = cache_key(folder);
    let mut cache = CACHE.lock().unwrap_or_else(|err| err.into_inner());
    cache.entries.retain(|entry| entry.key != key);
    cache.inflight.retain(|(path, _)| path != &key);
    cache.bump_generation(&key);
}

fn dir_modified(folder: &Path) -> i64 {
    std::fs::metadata(folder)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|time| time.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::{Arc, Barrier};
    use std::thread;

    #[test]
    fn a_second_open_reuses_the_listing_until_the_folder_changes() {
        let root = std::env::temp_dir().join(format!("stitchvue-list-cache-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("a.jpg"), b"x").unwrap();

        let first = scan_directory(&root, &mut |_| {}).unwrap();
        {
            let mut cache = CACHE.lock().unwrap();
            let stamp = view_listing_stamp(&root, &first);
            assert_eq!(stamp, content_stamp(&root));
            cache.store(cache_key(&root), dir_modified(&root), stamp, first.clone());
        }
        let mut batches = 0;
        let second = load(&root, &mut |_| {
            batches += 1;
        })
        .unwrap();
        assert_eq!(second.images.len(), 1);
        assert!(batches >= 1);

        fs::write(root.join("b.jpg"), b"y").unwrap();
        let third = load(&root, &mut |_| {}).unwrap();
        assert_eq!(third.images.len(), 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_edited_file_is_not_served_from_the_old_listing() {
        let root = std::env::temp_dir().join(format!("stitchvue-list-edit-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let file = root.join("a.jpg");
        fs::write(&file, b"x").unwrap();
        let first = load(&root, &mut |_| {}).unwrap();
        assert_eq!(first.images[0].size, 1);

        let directory_modified = dir_modified(&root);
        fs::write(&file, b"yyyy").unwrap();
        restore_directory_mtime(&root, directory_modified);
        assert_eq!(dir_modified(&root), directory_modified);

        let second = load(&root, &mut |_| {}).unwrap();
        assert_eq!(second.images[0].size, 4);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_validated_listing_hit_matches_the_cold_scan() {
        let root = std::env::temp_dir().join(format!("stitchvue-list-hit-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        for index in 0..2_000 {
            fs::write(root.join(format!("img-{index:04}.jpg")), b"x").unwrap();
        }
        let started = std::time::Instant::now();
        let cold = load(&root, &mut |_| {}).unwrap();
        let cold_ms = started.elapsed().as_secs_f64() * 1000.0;
        let started = std::time::Instant::now();
        let warm = load(&root, &mut |_| {}).unwrap();
        let warm_ms = started.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(cold.images.len(), 2_000);
        assert_eq!(warm.images.len(), 2_000);
        assert_eq!(warm.images[0].size, cold.images[0].size);
        eprintln!("listing cold {cold_ms:.2} ms, validated hit {warm_ms:.2} ms, files 2000");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_partial_listing_is_not_served_when_disk_has_more_files() {
        let root = std::env::temp_dir().join(format!("stitchvue-list-partial-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("a.jpg"), b"x").unwrap();
        fs::write(root.join("b.jpg"), b"y").unwrap();

        let mut partial = scan_directory(&root, &mut |_| {}).unwrap();
        assert_eq!(partial.images.len(), 2);
        partial.images.pop();
        let bad_stamp = content_stamp(&root);
        assert_ne!(view_listing_stamp(&root, &partial), bad_stamp);
        {
            let mut cache = CACHE.lock().unwrap();
            cache.store(
                cache_key(&root),
                dir_modified(&root),
                bad_stamp,
                partial.clone(),
            );
        }

        let listed = load(&root, &mut |_| {}).unwrap();
        assert_eq!(listed.images.len(), 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn invalidation_during_inflight_prevents_stale_cache_store() {
        let root = std::env::temp_dir().join(format!("stitchvue-list-gen-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("a.jpg"), b"x").unwrap();

        let barrier = Arc::new(Barrier::new(2));
        let root_for_thread = root.clone();
        let root_for_load = root.clone();
        let barrier_for_writer = Arc::clone(&barrier);
        let writer = thread::spawn(move || {
            barrier_for_writer.wait();
            fs::write(root_for_thread.join("b.jpg"), b"y").unwrap();
        });

        let listed = {
            let barrier_for_load = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier_for_load.wait();
                drop_listing(&root_for_load);
                load(&root_for_load, &mut |_| {}).unwrap()
            })
            .join()
            .unwrap()
        };
        writer.join().unwrap();

        assert_eq!(listed.images.len(), 2);
        let warm = load(&root, &mut |_| {}).unwrap();
        assert_eq!(warm.images.len(), 2);
        let _ = fs::remove_dir_all(&root);
    }
}

#[cfg(test)]
fn restore_directory_mtime(path: &Path, unix_millis: i64) {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        const FILE_WRITE_ATTRIBUTES: u32 = 0x0100;
        const FILE_SHARE_ALL: u32 = 0x7;
        const OPEN_EXISTING: u32 = 3;
        const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
        #[repr(C)]
        struct FileTime {
            low: u32,
            high: u32,
        }
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
            fn SetFileTime(
                file: *mut std::ffi::c_void,
                created: *const FileTime,
                accessed: *const FileTime,
                written: *const FileTime,
            ) -> i32;
            fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
        }
        let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
        wide.push(0);
        let ticks = (unix_millis.max(0) as u64).saturating_add(11_644_473_600_000) * 10_000;
        let written = FileTime {
            low: ticks as u32,
            high: (ticks >> 32) as u32,
        };
        unsafe {
            let handle = CreateFileW(
                wide.as_ptr(),
                FILE_WRITE_ATTRIBUTES,
                FILE_SHARE_ALL,
                std::ptr::null_mut(),
                OPEN_EXISTING,
                FILE_FLAG_BACKUP_SEMANTICS,
                std::ptr::null_mut(),
            );
            let invalid = -1isize as *mut std::ffi::c_void;
            if !handle.is_null() && handle != invalid {
                let _ = SetFileTime(handle, std::ptr::null(), std::ptr::null(), &written);
                let _ = CloseHandle(handle);
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (path, unix_millis);
    }
}
