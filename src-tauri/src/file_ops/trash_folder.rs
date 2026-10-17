use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::recycle::authorize_trash_folder;
use super::{is_reparse, read_service_role, ServiceRole, ROLE_FILE};
use crate::formats;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTrashFolderSnapshot {
    pub photo_count: u32,
    pub other_file_count: u32,
    pub subdirectory_count: u32,
    pub state_token: String,
}

struct Inventory {
    photos: u32,
    other_files: u32,
    subdirs: u32,
    hasher: DefaultHasher,
}

impl Inventory {
    fn new() -> Self {
        Self {
            photos: 0,
            other_files: 0,
            subdirs: 0,
            hasher: DefaultHasher::new(),
        }
    }

    fn note_entry(&mut self, relative: &str, is_dir: bool, size: u64, modified_ms: i64) {
        relative.hash(&mut self.hasher);
        is_dir.hash(&mut self.hasher);
        size.hash(&mut self.hasher);
        modified_ms.hash(&mut self.hasher);
    }
}

pub fn describe_local_trash_folder(folder_path: &str) -> Result<LocalTrashFolderSnapshot, String> {
    let authorized = authorize_trash_folder(Path::new(folder_path)).map_err(|err| err.message)?;
    let inventory = scan_folder(&authorized, "")?;
    let token = format!("{:016x}", inventory.hasher.finish());
    Ok(LocalTrashFolderSnapshot {
        photo_count: inventory.photos,
        other_file_count: inventory.other_files,
        subdirectory_count: inventory.subdirs,
        state_token: token,
    })
}

pub fn verify_local_trash_state(folder_path: &str, state_token: &str) -> Result<(), String> {
    let snapshot = describe_local_trash_folder(folder_path)?;
    if snapshot.state_token != state_token {
        return Err("state_changed".to_string());
    }
    Ok(())
}

fn scan_folder(dir: &Path, prefix: &str) -> Result<Inventory, String> {
    let mut inventory = Inventory::new();
    let entries = fs::read_dir(dir).map_err(|err| format!("Папка недоступна: {err}"))?;
    for entry in entries {
        let entry = entry.map_err(|err| format!("Папка недоступна: {err}"))?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == ROLE_FILE {
            continue;
        }
        let path = entry.path();
        let meta = fs::symlink_metadata(&path)
            .map_err(|err| format!("Не удалось прочитать {name}: {err}"))?;
        if is_reparse(&meta) {
            return Err(format!(
                "Папка содержит ссылку: {name}. Подсчёт остановлен."
            ));
        }
        let relative = if prefix.is_empty() {
            name.to_string()
        } else {
            format!("{prefix}\\{name}")
        };
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or(0);
        inventory.note_entry(&relative, meta.is_dir(), meta.len(), modified_ms);
        if meta.is_dir() {
            inventory.subdirs += 1;
            let nested = scan_folder(&path, &relative)?;
            inventory.photos += nested.photos;
            inventory.other_files += nested.other_files;
            inventory.subdirs += nested.subdirs;
            continue;
        }
        if formats::listed_image(Path::new(name.as_ref())) {
            inventory.photos += 1;
        } else {
            inventory.other_files += 1;
        }
    }
    Ok(inventory)
}

pub fn parent_restore_target(trash_file: &Path) -> Result<PathBuf, String> {
    let trash_parent = trash_file
        .parent()
        .ok_or_else(|| "origin_unknown".to_string())?;
    if read_service_role(trash_parent) != Some(ServiceRole::Trash) {
        return Err("origin_unknown".to_string());
    }
    let album = trash_parent
        .parent()
        .ok_or_else(|| "origin_unknown".to_string())?;
    let name = trash_file
        .file_name()
        .ok_or_else(|| "Некорректное имя файла".to_string())?;
    Ok(album.join(name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_ops::{write_service_role, ServiceRole, LOCAL_TRASH};
    use std::sync::atomic::{AtomicU64, Ordering};

    fn sandbox() -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "stitchvue-trash-inv-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn token_changes_when_a_file_is_added() {
        let root = sandbox();
        let trash = root.join(LOCAL_TRASH);
        fs::create_dir(&trash).unwrap();
        write_service_role(&trash, ServiceRole::Trash).unwrap();
        fs::write(trash.join("a.jpg"), b"a").unwrap();
        let first = describe_local_trash_folder(&trash.display().to_string()).unwrap();
        assert_eq!(first.photo_count, 1);
        fs::write(trash.join("b.jpg"), b"b").unwrap();
        let second = describe_local_trash_folder(&trash.display().to_string()).unwrap();
        assert_eq!(second.photo_count, 2);
        assert_ne!(first.state_token, second.state_token);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn counts_nested_photos_and_subdirectories() {
        let root = sandbox();
        let trash = root.join(LOCAL_TRASH);
        fs::create_dir(&trash).unwrap();
        write_service_role(&trash, ServiceRole::Trash).unwrap();
        fs::create_dir(trash.join("nested")).unwrap();
        fs::write(trash.join("nested").join("inner.jpg"), b"x").unwrap();
        fs::write(trash.join("notes.txt"), b"t").unwrap();
        let snap = describe_local_trash_folder(&trash.display().to_string()).unwrap();
        assert_eq!(snap.photo_count, 1);
        assert_eq!(snap.other_file_count, 1);
        assert_eq!(snap.subdirectory_count, 1);
        let _ = fs::remove_dir_all(&root);
    }
}
