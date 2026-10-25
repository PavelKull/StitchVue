use std::fs;
use std::io;
use std::path::Path;

use super::{has_disallowed_path_syntax, path_string_for_app};

/// Открывает существующую папку в Проводнике Windows. Путь не проходит через `cmd`.
pub fn open_folder_in_explorer(raw: &str) -> Result<(), String> {
    let argument = explorer_folder_argument(raw)?;
    spawn_explorer(&argument)
}

/// Канонический Win32-путь для `explorer.exe` (без `\\?\`).
pub(crate) fn explorer_folder_argument(raw: &str) -> Result<String, String> {
    if has_disallowed_path_syntax(raw) {
        return Err("outside".to_string());
    }
    let canonical = fs::canonicalize(Path::new(raw)).map_err(map_io)?;
    let meta = fs::metadata(&canonical).map_err(map_io)?;
    if !meta.is_dir() {
        return Err("not_found".to_string());
    }
    Ok(explorer_win32_argument(&canonical))
}

fn explorer_win32_argument(path: &Path) -> String {
    let text = path_string_for_app(path);
    // `C:` для Проводника — текущий каталог диска, а не корень.
    if text.len() == 2 && text.as_bytes()[1] == b':' {
        format!("{text}\\")
    } else {
        text
    }
}

fn map_io(err: io::Error) -> String {
    match err.kind() {
        io::ErrorKind::NotFound => "not_found".to_string(),
        io::ErrorKind::PermissionDenied => "access_denied".to_string(),
        _ => "io_error".to_string(),
    }
}

fn spawn_explorer(argument: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new(explorer_exe())
            .arg(argument)
            .spawn()
            .map_err(|_| "io_error".to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(finder_args(argument))
            .spawn()
            .map_err(|_| "io_error".to_string())?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        // Directories always open in the file manager; there are no app bundles here.
        std::process::Command::new("xdg-open")
            .arg(argument)
            .spawn()
            .map_err(|_| "io_error".to_string())?;
        Ok(())
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        let _ = argument;
        Err("unsupported".to_string())
    }
}

/// Plain `open` launches bundles (`X.app` is a directory), so anything that may be a
/// package is only revealed in Finder (`-R`), never opened.
// ponytail: extension / `Contents` heuristic, NSWorkspace isFilePackageAtPath if it misses one.
#[cfg(target_os = "macos")]
fn finder_args(argument: &str) -> Vec<&str> {
    let path = Path::new(argument);
    if path.extension().is_some() || path.join("Contents").exists() {
        vec!["-R", argument]
    } else {
        vec![argument]
    }
}

#[cfg(windows)]
fn explorer_exe() -> std::path::PathBuf {
    match std::env::var_os("WINDIR") {
        Some(windir) => std::path::PathBuf::from(windir).join("explorer.exe"),
        None => std::path::PathBuf::from(r"C:\Windows\explorer.exe"),
    }
}

#[cfg(test)]
mod tests {
    use super::explorer_folder_argument;
    use super::super::path_string_for_app;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn sandbox() -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "stitchvue-explorer-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn explorer_argument_accepts_real_directory() {
        let root = sandbox();
        let got = explorer_folder_argument(&root.to_string_lossy()).unwrap();
        let canonical = fs::canonicalize(&root).unwrap();
        assert_eq!(got, path_string_for_app(&canonical));
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn finder_only_reveals_possible_packages() {
        use super::finder_args;
        let root = sandbox();
        let plain = root.join("Trip");
        let bundle = root.join("Vacation.app");
        let bare_bundle = root.join("Vacation");
        fs::create_dir(&plain).unwrap();
        fs::create_dir(&bundle).unwrap();
        fs::create_dir_all(bare_bundle.join("Contents")).unwrap();
        let args = |path: &PathBuf| {
            let text = path.to_string_lossy().into_owned();
            finder_args(&text).len()
        };
        assert_eq!(args(&plain), 1);
        assert_eq!(args(&bundle), 2);
        assert_eq!(args(&bare_bundle), 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn explorer_argument_rejects_file() {
        let root = sandbox();
        let file = root.join("photo.jpg");
        fs::write(&file, b"x").unwrap();
        assert_eq!(
            explorer_folder_argument(&file.to_string_lossy()).unwrap_err(),
            "not_found"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn explorer_argument_rejects_missing_path() {
        let root = sandbox();
        let missing = root.join("gone");
        assert_eq!(
            explorer_folder_argument(&missing.to_string_lossy()).unwrap_err(),
            "not_found"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn explorer_argument_rejects_empty_and_nul() {
        assert_eq!(explorer_folder_argument("").unwrap_err(), "outside");
        assert_eq!(explorer_folder_argument("C:\\a\0b").unwrap_err(), "outside");
    }
}
