use std::fs;
use std::path::{Component, Path, PathBuf};

use super::{is_reparse, normalize_key, read_service_role, same_path, ServiceRole, ROLE_FILE};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecycleStatus {
    Recycled,
    Ambiguous,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecycleError {
    pub code: &'static str,
    pub message: String,
}

impl RecycleError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

pub(crate) fn recycle_path(path: &Path) -> Result<RecycleStatus, RecycleError> {
    inspect_target(path)?;
    #[cfg(windows)]
    {
        let before = identity(path)?;
        let hresult = run_shell_recycle(path)?;
        verify_gone(path, before, hresult)
    }
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        #[allow(unused_mut)]
        let mut ctx = trash::TrashContext::default();
        #[cfg(target_os = "macos")]
        {
            use trash::macos::{DeleteMethod, TrashContextExtMacos};
            // NSFileManager: no Finder automation prompt, but no "Put Back" either.
            ctx.set_delete_method(DeleteMethod::NsFileManager);
        }
        // Linux: freedesktop.org Trash (~/.local/share/Trash or the volume's .Trash-UID).
        ctx.delete(path).map_err(|err| {
            RecycleError::new(
                "recycle_unavailable",
                format!("Не удалось переместить в Корзину: {err}"),
            )
        })?;
        Ok(if path_still_there(path) {
            RecycleStatus::Ambiguous
        } else {
            RecycleStatus::Recycled
        })
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        let _ = path;
        Err(RecycleError::new(
            "unsupported",
            "Корзина Windows доступна только в Windows.",
        ))
    }
}

pub fn inspect_target(path: &Path) -> Result<fs::Metadata, RecycleError> {
    if path.as_os_str().is_empty() {
        return Err(RecycleError::new("outside", "Некорректный путь"));
    }
    if is_drive_root(path) {
        return Err(RecycleError::new(
            "outside",
            format!(
                "Нельзя отправить корень диска в корзину: {}",
                path.display()
            ),
        ));
    }
    let meta = fs::symlink_metadata(path).map_err(|err| {
        RecycleError::new(
            "not_found",
            format!("Объект недоступен: {} ({err})", path.display()),
        )
    })?;
    if is_reparse(&meta) {
        return Err(RecycleError::new(
            "reparse",
            format!("Путь является ссылкой: {}", path.display()),
        ));
    }
    Ok(meta)
}

pub fn is_drive_root(path: &Path) -> bool {
    let components: Vec<_> = path.components().collect();
    match components.as_slice() {
        [Component::Prefix(_), Component::RootDir] | [Component::RootDir] => true,
        // Mount points: macOS /Volumes/<name>; Linux /mnt/<name>, /media/<name>,
        // /media/<user>/<name> and /run/media/<user>/<name>.
        [Component::RootDir, Component::Normal(dir), Component::Normal(_)] => {
            matches!(dir.to_str(), Some("Volumes" | "mnt" | "media"))
        }
        [Component::RootDir, Component::Normal(dir), Component::Normal(_), Component::Normal(_)] => {
            dir.to_str() == Some("media")
        }
        [Component::RootDir, Component::Normal(run), Component::Normal(media), Component::Normal(_), Component::Normal(_)] => {
            run.to_str() == Some("run") && media.to_str() == Some("media")
        }
        _ => false,
    }
}

pub fn tree_has_reparse(root: &Path) -> Result<bool, RecycleError> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(current) = stack.pop() {
        let meta = fs::symlink_metadata(&current).map_err(|err| {
            RecycleError::new(
                "io_error",
                format!("Не удалось прочитать {}: {err}", current.display()),
            )
        })?;
        if is_reparse(&meta) {
            return Ok(true);
        }
        if !meta.is_dir() {
            continue;
        }
        let entries = fs::read_dir(&current).map_err(|err| {
            RecycleError::new(
                "io_error",
                format!("Не удалось прочитать {}: {err}", current.display()),
            )
        })?;
        for entry in entries {
            let entry = entry.map_err(|err| {
                RecycleError::new("io_error", format!("Не удалось прочитать каталог: {err}"))
            })?;
            let child = entry.path();
            let child_meta = fs::symlink_metadata(&child).map_err(|err| {
                RecycleError::new(
                    "io_error",
                    format!("Не удалось прочитать {}: {err}", child.display()),
                )
            })?;
            if is_reparse(&child_meta) {
                return Ok(true);
            }
            if child_meta.is_dir() {
                stack.push(child);
            }
        }
    }
    Ok(false)
}

pub fn authorize_trash_file(path: &Path) -> Result<PathBuf, RecycleError> {
    let meta = inspect_target(path)?;
    if !meta.is_file() {
        return Err(RecycleError::new(
            "not_image",
            "В корзину Windows из «Удаленное» можно отправить только файл.",
        ));
    }
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| RecycleError::new("outside", "Некорректное имя файла"))?;
    if name == ROLE_FILE || !crate::formats::listed_image(Path::new(name)) {
        return Err(RecycleError::new(
            "not_image",
            format!("Это не файл изображения: {name}"),
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| RecycleError::new("outside", "Нет родительской папки"))?;
    let parent_meta = fs::symlink_metadata(parent).map_err(|err| {
        RecycleError::new("outside", format!("Папка «Удаленное» недоступна: {err}"))
    })?;
    if is_reparse(&parent_meta) || !parent_meta.is_dir() {
        return Err(RecycleError::new(
            "reparse",
            "Папка «Удаленное» недоступна.",
        ));
    }
    if read_service_role(parent) != Some(ServiceRole::Trash) {
        return Err(RecycleError::new(
            "outside",
            "Файл не лежит в зарегистрированной папке «Удаленное».",
        ));
    }
    let canonical_parent = fs::canonicalize(parent).map_err(|err| {
        RecycleError::new("outside", format!("Папка «Удаленное» недоступна: {err}"))
    })?;
    if read_service_role(&canonical_parent) != Some(ServiceRole::Trash) {
        return Err(RecycleError::new(
            "outside",
            "Файл не лежит в зарегистрированной папке «Удаленное».",
        ));
    }
    Ok(canonical_parent.join(name))
}

pub fn authorize_trash_folder(path: &Path) -> Result<PathBuf, RecycleError> {
    let meta = inspect_target(path)?;
    if !meta.is_dir() {
        return Err(RecycleError::new("outside", "Нужна папка «Удаленное»."));
    }
    if read_service_role(path) != Some(ServiceRole::Trash) {
        return Err(RecycleError::new(
            "outside",
            "Удаление доступно только для зарегистрированной папки «Удаленное».",
        ));
    }
    if tree_has_reparse(path)? {
        return Err(RecycleError::new(
            "reparse",
            "В папке есть ссылка. Операция остановлена, ничего не удалено.",
        ));
    }
    let canonical = fs::canonicalize(path)
        .map_err(|err| RecycleError::new("outside", format!("Папка недоступна: {err}")))?;
    if is_drive_root(&canonical) {
        return Err(RecycleError::new("outside", "Нельзя удалить корень диска."));
    }
    if canonical.parent().is_none() {
        return Err(RecycleError::new("outside", "Нельзя удалить корень диска."));
    }
    if read_service_role(&canonical) != Some(ServiceRole::Trash) {
        return Err(RecycleError::new(
            "outside",
            "Удаление доступно только для зарегистрированной папки «Удаленное».",
        ));
    }
    Ok(canonical)
}

pub fn authorize_favorite_copy(copy: &Path, origin: &Path) -> Result<(), RecycleError> {
    let meta = inspect_target(copy)?;
    if !meta.is_file() {
        return Err(RecycleError::new(
            "not_image",
            "Копия избранного не является файлом.",
        ));
    }
    if same_path(copy, origin) {
        return Err(RecycleError::new(
            "outside",
            "Нельзя отправить в корзину оригинал вместо копии.",
        ));
    }
    let parent = copy
        .parent()
        .ok_or_else(|| RecycleError::new("outside", "Нет папки копии"))?;
    if read_service_role(parent) != Some(ServiceRole::Favorites) {
        return Err(RecycleError::new(
            "outside",
            "Файл не лежит в зарегистрированной папке «Избранное».",
        ));
    }
    Ok(())
}

struct Identity {
    is_dir: bool,
    size: Option<u64>,
}

fn identity(path: &Path) -> Result<Identity, RecycleError> {
    let meta = inspect_target(path)?;
    Ok(Identity {
        is_dir: meta.is_dir(),
        size: if meta.is_file() {
            Some(meta.len())
        } else {
            None
        },
    })
}

fn verify_gone(
    path: &Path,
    before: Identity,
    shell_ok: bool,
) -> Result<RecycleStatus, RecycleError> {
    match fs::symlink_metadata(path) {
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            if shell_ok {
                Ok(RecycleStatus::Recycled)
            } else {
                Ok(RecycleStatus::Ambiguous)
            }
        }
        Err(_) => Ok(RecycleStatus::Ambiguous),
        Ok(meta) => {
            if is_reparse(&meta) {
                return Ok(RecycleStatus::Ambiguous);
            }
            let same = meta.is_dir() == before.is_dir
                && (before.size.is_none() || before.size == Some(meta.len()));
            if same {
                Err(RecycleError::new(
                    "recycle_unavailable",
                    format!(
                        "Не удалось переместить в корзину Windows, объект остался на месте: {}",
                        path.display()
                    ),
                ))
            } else {
                Ok(RecycleStatus::Ambiguous)
            }
        }
    }
}

#[cfg(windows)]
fn run_shell_recycle(path: &Path) -> Result<bool, RecycleError> {
    let shell_path = path_for_shell_parsing(path);
    let wide = wide_path(&shell_path);
    let verify_path = path.to_path_buf();
    std::thread::spawn(move || shell_recycle_sta(&wide, &verify_path))
        .join()
        .map_err(|_| RecycleError::new("io_error", "Поток корзины Windows завершился с ошибкой."))?
}

/// `canonicalize` on Windows returns `\\?\` paths that `SHCreateItemFromParsingName` rejects with E_INVALIDARG.
#[cfg(windows)]
fn path_for_shell_parsing(path: &Path) -> PathBuf {
    PathBuf::from(super::path_string_for_app(path))
}

#[cfg(windows)]
fn wide_path(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(windows)]
fn recycle_diag(stage: &str, hresult: u32, kind: &str, verify_path: &Path) {
    #[cfg(debug_assertions)]
    {
        let prefix = verify_path
            .components()
            .take(2)
            .map(|part| part.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        eprintln!(
            "[stitchvue-recycle] stage={stage} kind={kind} hr=0x{hresult:08X} path_prefix={prefix}"
        );
    }
}

#[cfg(windows)]
fn shell_recycle_sta(wide: &[u16], verify_path: &Path) -> Result<bool, RecycleError> {
    use windows::core::PCWSTR;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        FileOperation, IFileOperation, IShellItem, SHCreateItemFromParsingName,
        FOFX_RECYCLEONDELETE, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT,
        FOF_WANTNUKEWARNING,
    };

    unsafe {
        let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if init.is_err() && init.0 as u32 != 0x80010106 {
            let hr = init.0 as u32;
            recycle_diag("CoInitializeEx", hr, "com_init", verify_path);
            return Err(RecycleError::new(
                "recycle_unavailable",
                format!(
                    "Не удалось инициализировать COM для корзины Windows (0x{:08X}).",
                    hr
                ),
            ));
        }
        let result = (|| {
            let op: IFileOperation =
                CoCreateInstance(&FileOperation, None, CLSCTX_ALL).map_err(|err| {
                    recycle_diag(
                        "CoCreateInstance",
                        err.code().0 as u32,
                        "file_operation",
                        verify_path,
                    );
                    RecycleError::new(
                        "recycle_unavailable",
                        format!("Корзина Windows недоступна: {err}"),
                    )
                })?;
            let flags = FOF_ALLOWUNDO
                | FOF_NOCONFIRMATION
                | FOF_NOERRORUI
                | FOF_SILENT
                | FOF_WANTNUKEWARNING
                | FOFX_RECYCLEONDELETE;
            op.SetOperationFlags(flags).map_err(|err| {
                recycle_diag(
                    "SetOperationFlags",
                    err.code().0 as u32,
                    "file_operation",
                    verify_path,
                );
                RecycleError::new(
                    "recycle_unavailable",
                    format!("Не удалось настроить корзину Windows: {err}"),
                )
            })?;
            let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None)
                .map_err(|err| {
                    recycle_diag(
                        "SHCreateItemFromParsingName",
                        err.code().0 as u32,
                        "shell_item",
                        verify_path,
                    );
                    RecycleError::new(
                        "not_found",
                        format!("Не удалось открыть объект для корзины: {err}"),
                    )
                })?;
            op.DeleteItem(&item, None).map_err(|err| {
                recycle_diag(
                    "DeleteItem",
                    err.code().0 as u32,
                    "file_operation",
                    verify_path,
                );
                map_shell_error(err, "Не удалось поставить объект в очередь корзины Windows")
            })?;
            op.PerformOperations().map_err(|err| {
                recycle_diag(
                    "PerformOperations",
                    err.code().0 as u32,
                    "file_operation",
                    verify_path,
                );
                map_shell_error(err, "Корзина Windows отклонила операцию")
            })?;
            if op
                .GetAnyOperationsAborted()
                .map(|flag| flag.as_bool())
                .unwrap_or(false)
            {
                return Err(RecycleError::new(
                    "cancelled",
                    "Операция корзины Windows отменена.",
                ));
            }
            Ok(true)
        })();
        CoUninitialize();
        result
    }
}

#[cfg(windows)]
fn map_shell_error(err: windows::core::Error, prefix: &str) -> RecycleError {
    let code = err.code().0 as u32;
    let text = err.message();
    let kind = match code {
        0x800704C7 | 0x80270000 => "cancelled",
        0x80070005 | 0x80070013 => "access_denied",
        0x80070003 | 0x80070015 => "not_found",
        _ if text.to_ascii_lowercase().contains("recycle") => "recycle_unavailable",
        _ => "recycle_unavailable",
    };
    RecycleError::new(kind, format!("{prefix}: {text} (0x{code:08X})"))
}

pub fn path_still_there(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

#[allow(dead_code)]
pub fn same_normalized(left: &Path, right: &Path) -> bool {
    normalize_key(left).eq_ignore_ascii_case(&normalize_key(right))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::file_ops::{write_service_role, LOCAL_TRASH};
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn sandbox() -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "stitchvue-recycle-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn refuses_drive_root_and_unmarked_folder() {
        if cfg!(windows) {
            assert!(is_drive_root(Path::new(r"D:\")));
            assert!(!is_drive_root(Path::new(r"D:\photos")));
        } else {
            assert!(is_drive_root(Path::new("/")));
            assert!(is_drive_root(Path::new("/Volumes/Photos")));
            assert!(!is_drive_root(Path::new("/Volumes/Photos/2024")));
            assert!(is_drive_root(Path::new("/mnt/nas")));
            assert!(is_drive_root(Path::new("/media/me/USB")));
            assert!(is_drive_root(Path::new("/run/media/me/USB")));
            assert!(!is_drive_root(Path::new("/media/me/USB/DCIM")));
            assert!(!is_drive_root(Path::new("/home/me/Pictures")));
        }
        let root = sandbox();
        let named = root.join(LOCAL_TRASH);
        fs::create_dir(&named).unwrap();
        fs::write(named.join("a.jpg"), b"x").unwrap();
        assert!(authorize_trash_folder(&named).is_err());
        assert!(authorize_trash_file(&named.join("a.jpg")).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn favorite_copy_cannot_be_the_origin() {
        let root = sandbox();
        let favorites = root.join("Избранное");
        fs::create_dir(&favorites).unwrap();
        write_service_role(&favorites, ServiceRole::Favorites).unwrap();
        let origin = root.join("a.jpg");
        let copy = favorites.join("a.jpg");
        fs::write(&origin, b"orig").unwrap();
        fs::write(&copy, b"copy").unwrap();
        assert!(authorize_favorite_copy(&copy, &origin).is_ok());
        assert!(authorize_favorite_copy(&origin, &origin).is_err());
        assert!(authorize_favorite_copy(&origin, &copy).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    #[test]
    fn path_for_shell_parsing_strips_extended_prefix() {
        let drive = PathBuf::from(r"\\?\C:\temp\photo.jpg");
        assert_eq!(
            path_for_shell_parsing(&drive),
            PathBuf::from(r"C:\temp\photo.jpg")
        );
        let unc = PathBuf::from(r"\\?\UNC\server\share\file.jpg");
        assert_eq!(
            path_for_shell_parsing(&unc),
            PathBuf::from(r"\\server\share\file.jpg")
        );
    }

    #[test]
    fn authorizes_registered_trash_file() {
        let root = sandbox();
        let trash = root.join(LOCAL_TRASH);
        fs::create_dir(&trash).unwrap();
        write_service_role(&trash, ServiceRole::Trash).unwrap();
        fs::write(trash.join("a.jpg"), b"photo").unwrap();
        assert!(authorize_trash_file(&trash.join("a.jpg")).is_ok());
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(windows)]
    #[test]
    fn recycles_canonical_extended_path_and_cyrillic_name() {
        let root = sandbox();
        let file = root.join("фото тест.jpg");
        fs::write(&file, b"recycle-probe").unwrap();
        let canonical = fs::canonicalize(&file).unwrap();
        let result = recycle_path(&canonical);
        assert!(
            matches!(
                result,
                Ok(RecycleStatus::Recycled) | Ok(RecycleStatus::Ambiguous)
            ),
            "canonical recycle failed: {:?}",
            result
        );
        if matches!(result, Ok(RecycleStatus::Recycled)) {
            assert!(!canonical.exists());
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(any(windows, target_os = "macos", target_os = "linux"))]
    #[test]
    fn recycles_a_temp_file_and_a_temp_folder_without_erase_on_error() {
        let root = sandbox();
        let file = root.join("stitchvue-recycle-probe.jpg");
        fs::write(&file, b"recycle-probe").unwrap();
        match recycle_path(&file) {
            Ok(RecycleStatus::Recycled) => assert!(!file.exists()),
            Ok(RecycleStatus::Ambiguous) => {}
            Err(err) => {
                assert!(
                    file.exists(),
                    "file must remain after recycle error: {}",
                    err.message
                );
            }
        }
        let folder = root.join("stitchvue-recycle-folder");
        fs::create_dir(&folder).unwrap();
        fs::write(folder.join("inside.jpg"), b"nested").unwrap();
        match recycle_path(&folder) {
            Ok(RecycleStatus::Recycled) => assert!(!folder.exists()),
            Ok(RecycleStatus::Ambiguous) => {}
            Err(err) => {
                assert!(
                    folder.exists(),
                    "folder must remain after recycle error: {}",
                    err.message
                );
                assert_eq!(fs::read(folder.join("inside.jpg")).unwrap(), b"nested");
            }
        }
        let _ = fs::remove_dir_all(&root);
    }
}
