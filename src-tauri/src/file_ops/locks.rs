use std::collections::HashSet;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use super::normalize_key;

fn held() -> &'static Mutex<HashSet<String>> {
    static HELD: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    HELD.get_or_init(|| Mutex::new(HashSet::new()))
}

pub struct PathLockGuard {
    keys: Vec<String>,
}

impl Drop for PathLockGuard {
    fn drop(&mut self) {
        let mut held = held().lock().unwrap_or_else(|err| err.into_inner());
        for key in &self.keys {
            held.remove(key);
        }
    }
}

pub fn try_lock_paths(paths: impl IntoIterator<Item = impl AsRef<Path>>) -> Result<PathLockGuard, String> {
    let mut keys: Vec<String> = paths
        .into_iter()
        .map(|path| normalize_key(path.as_ref()).to_ascii_lowercase())
        .filter(|key| !key.is_empty())
        .collect();
    keys.sort();
    keys.dedup();
    if keys.is_empty() {
        return Err("Нет путей для блокировки".to_string());
    }
    let mut held = held().lock().unwrap_or_else(|err| err.into_inner());
    for key in &keys {
        if conflicts(&held, key) {
            return Err("Конфликтующая файловая операция уже выполняется".to_string());
        }
    }
    for key in &keys {
        held.insert(key.clone());
    }
    Ok(PathLockGuard { keys })
}

fn conflicts(held: &HashSet<String>, key: &str) -> bool {
    held.iter().any(|existing| related(existing, key))
}

fn related(left: &str, right: &str) -> bool {
    left == right || is_ancestor(left, right) || is_ancestor(right, left)
}

fn is_ancestor(parent: &str, child: &str) -> bool {
    let prefix = format!("{parent}\\");
    child.starts_with(&prefix)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn same_file_and_parent_folder_conflict_unrelated_files_do_not() {
        let a = PathBuf::from(r"D:\photos\a.jpg");
        let b = PathBuf::from(r"D:\photos\b.jpg");
        let folder = PathBuf::from(r"D:\photos");
        let first = try_lock_paths([&a]).unwrap();
        assert!(try_lock_paths([&a]).is_err());
        assert!(try_lock_paths([&folder]).is_err());
        let second = try_lock_paths([&b]).unwrap();
        drop(first);
        drop(second);
        let folder_lock = try_lock_paths([&folder]).unwrap();
        assert!(try_lock_paths([&a]).is_err());
        drop(folder_lock);
    }
}
