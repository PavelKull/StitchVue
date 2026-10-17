use std::path::Path;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FolderKind {
    Place,
    Folder,
    Drive,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderShortcut {
    pub name: String,
    pub path: String,
    pub kind: FolderKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub place_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drive_letter: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drive_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageBatch {
    pub folder: String,
    pub phase: String,
    pub files: Vec<ImageFile>,
    #[serde(default)]
    pub session: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryView {
    pub title: String,
    pub path: Option<String>,
    pub parent: Option<String>,
    pub folders: Vec<FolderShortcut>,
    pub images: Vec<ImageFile>,
    /// Non-image files in this directory (one level, same rules as listing).
    pub unsupported_file_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub place_code: Option<String>,
}

pub fn list_subfolders(folder: &Path) -> Result<Vec<FolderShortcut>, String> {
    if !folder.is_dir() {
        return Err(format!("not a directory: {}", folder.display()));
    }
    let entries =
        std::fs::read_dir(folder).map_err(|err| format!("read_dir {}: {err}", folder.display()))?;
    let mut folders = Vec::new();
    for entry in entries {
        let Ok(entry) = entry else {
            continue;
        };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name.starts_with('$') {
            continue;
        }
        let path = entry.path();
        folders.push(FolderShortcut {
            service_role: listed_service_role(&path, &name),
            name,
            path: path.to_string_lossy().into_owned(),
            kind: FolderKind::Folder,
            media: None,
            place_code: None,
            drive_letter: None,
            drive_kind: None,
        });
    }
    folders.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(folders)
}

pub fn list_directory(folder: &Path) -> Result<DirectoryView, String> {
    list_directory_with(folder, &mut |_| {})
}

pub fn list_directory_with(
    folder: &Path,
    on_batch: &mut dyn FnMut(&ImageBatch),
) -> Result<DirectoryView, String> {
    super::listing_cache::load(folder, on_batch)
}

pub(super) fn scan_directory(
    folder: &Path,
    on_batch: &mut dyn FnMut(&ImageBatch),
) -> Result<DirectoryView, String> {
    if !folder.is_dir() {
        return Err(format!("not a directory: {}", folder.display()));
    }

    let entries =
        std::fs::read_dir(folder).map_err(|err| format!("read_dir {}: {err}", folder.display()))?;

    let folder_path = folder.display().to_string();
    let mut folders = Vec::new();
    let mut names = Vec::new();
    let mut name_batch = Vec::new();
    let mut unsupported_file_count = 0u32;
    for entry in entries {
        let Ok(entry) = entry else {
            continue;
        };
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name.starts_with('$') {
            continue;
        }

        let path = entry.path().to_string_lossy().into_owned();
        if file_type.is_dir() {
            folders.push(FolderShortcut {
                service_role: listed_service_role(Path::new(&path), &name),
                name,
                path,
                kind: FolderKind::Folder,
                media: None,
                place_code: None,
                drive_letter: None,
                drive_kind: None,
            });
        } else if file_type.is_file() {
            if !is_image_name(&name) {
                unsupported_file_count += 1;
                continue;
            }
            let file = ImageFile {
                name,
                path,
                size: 0,
                modified_at: 0,
            };
            name_batch.push(file.clone());
            names.push(file);
            let name_limit = if names.len() <= 48 { 48 } else { 200 };
            if name_batch.len() >= name_limit {
                on_batch(&ImageBatch {
                    folder: folder_path.clone(),
                    phase: "names".to_string(),
                    files: std::mem::take(&mut name_batch),
                    session: 0,
                });
            }
        }
    }
    if !name_batch.is_empty() {
        on_batch(&ImageBatch {
            folder: folder_path.clone(),
            phase: "names".to_string(),
            files: std::mem::take(&mut name_batch),
            session: 0,
        });
    }

    let mut images = Vec::with_capacity(names.len());
    let mut stat_batch = Vec::new();
    for file in names {
        let meta = std::fs::metadata(&file.path).ok();
        let size = meta.as_ref().map(|meta| meta.len()).unwrap_or(0);
        let modified_at = meta
            .and_then(|meta| meta.modified().ok())
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|time| time.as_millis() as i64)
            .unwrap_or(0);
        let file = ImageFile {
            size,
            modified_at,
            ..file
        };
        stat_batch.push(file.clone());
        images.push(file);
        let stat_limit = if images.len() <= 48 { 48 } else { 200 };
        if stat_batch.len() >= stat_limit {
            on_batch(&ImageBatch {
                folder: folder_path.clone(),
                phase: "stats".to_string(),
                files: std::mem::take(&mut stat_batch),
                session: 0,
            });
        }
    }
    if !stat_batch.is_empty() {
        on_batch(&ImageBatch {
            folder: folder_path.clone(),
            phase: "stats".to_string(),
            files: stat_batch,
            session: 0,
        });
    }

    sort_by_name(&mut folders, |item| &item.name);
    sort_by_name(&mut images, |item| &item.name);

    let parent = folder.parent().and_then(|parent| {
        if parent.as_os_str().is_empty() || !parent.is_dir() {
            None
        } else {
            Some(parent.display().to_string())
        }
    });

    Ok(DirectoryView {
        title: folder_title(folder),
        path: Some(folder.display().to_string()),
        parent,
        folders,
        images,
        unsupported_file_count,
        service_role: crate::file_ops::read_service_role(folder)
            .map(|role| role.as_str().to_string()),
        place_code: None,
    })
}

fn listed_service_role(path: &Path, name: &str) -> Option<String> {
    if !crate::file_ops::is_service_folder_name(name) {
        return None;
    }
    crate::file_ops::read_service_role(path).map(|role| role.as_str().to_string())
}

pub fn folder_title(folder: &Path) -> String {
    folder
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| folder.display().to_string())
}

fn sort_by_name<T>(items: &mut [T], name: impl Fn(&T) -> &str) {
    items.sort_by(|left, right| name(left).to_lowercase().cmp(&name(right).to_lowercase()));
}

fn is_image_name(name: &str) -> bool {
    crate::formats::listed_image(Path::new(name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn lists_images_and_child_folders_one_level_deep() {
        let root = std::env::temp_dir().join(format!("stitchvue-scan-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("a.JPG"), b"x").unwrap();
        fs::write(root.join("phone.HEIC"), b"x").unwrap();
        fs::write(root.join("shot.CR3"), b"x").unwrap();
        fs::write(root.join("clip.avif"), b"x").unwrap();
        fs::write(root.join("notes.txt"), b"x").unwrap();
        fs::write(root.join(".hidden.png"), b"x").unwrap();
        fs::write(root.join("nested").join("b.png"), b"x").unwrap();

        let view = list_directory(&root).unwrap();
        assert_eq!(view.images.len(), 4);
        let names: Vec<_> = view.images.iter().map(|file| file.name.as_str()).collect();
        assert_eq!(names, ["a.JPG", "clip.avif", "phone.HEIC", "shot.CR3"]);
        assert_eq!(view.folders.len(), 1);
        assert_eq!(view.folders[0].name, "nested");
        assert_eq!(view.unsupported_file_count, 1);
        let children = list_subfolders(&root).unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0].name, "nested");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn renamed_favorites_folder_is_listed_as_ordinary() {
        let root = std::env::temp_dir().join(format!("stitchvue-scan-fav-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let favorites = root.join(crate::file_ops::LOCAL_FAVORITES);
        fs::create_dir_all(&favorites).unwrap();
        crate::file_ops::write_service_role(&favorites, crate::file_ops::ServiceRole::Favorites)
            .unwrap();
        fs::write(favorites.join("a.jpg"), b"x").unwrap();
        let view = list_directory(&root).unwrap();
        assert_eq!(view.folders[0].service_role.as_deref(), Some("favorites"));
        let renamed = root.join("Лучшие фото");
        fs::rename(&favorites, &renamed).unwrap();
        let after = list_directory(&root).unwrap();
        let folder = after
            .folders
            .iter()
            .find(|item| item.name == "Лучшие фото")
            .unwrap();
        assert!(folder.service_role.is_none());
        assert!(list_directory(&renamed).unwrap().service_role.is_none());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    #[ignore = "stage 15 disk timing"]
    fn times_one_level_listing() {
        for count in [100usize, 1_000, 10_000, 50_000] {
            let root = std::env::temp_dir()
                .join(format!("stitchvue-bench-{count}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&root);
            fs::create_dir_all(&root).unwrap();
            for index in 0..count {
                fs::write(root.join(format!("img-{index:05}.jpg")), b"x").unwrap();
            }
            let start = std::time::Instant::now();
            let view = list_directory(&root).unwrap();
            let elapsed = start.elapsed();
            assert_eq!(view.images.len(), count);
            eprintln!(
                "list_directory {count} files: {elapsed:?} in {}",
                root.display()
            );
            let _ = fs::remove_dir_all(&root);
        }
    }
}
