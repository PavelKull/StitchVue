use std::path::PathBuf;

use super::folder::{list_directory, DirectoryView, FolderKind, FolderShortcut};

const PLACES: &[(&str, &str)] = &[
    ("desktop", "Desktop"),
    ("downloads", "Downloads"),
    ("documents", "Documents"),
    ("pictures", "Pictures"),
    ("videos", "Videos"),
    ("music", "Music"),
];

pub fn browse(path: Option<&str>) -> Result<DirectoryView, String> {
    match path {
        None => Ok(home_view()),
        Some(path) => list_directory(std::path::Path::new(path)),
    }
}

pub fn home_view() -> DirectoryView {
    let mut folders = Vec::new();
    for (place_code, folder_name) in PLACES {
        if let Some(path) = user_folder(folder_name) {
            folders.push(FolderShortcut {
                name: (*folder_name).to_string(),
                path: path.display().to_string(),
                kind: FolderKind::Place,
                media: None,
                service_role: None,
                place_code: Some((*place_code).to_string()),
                drive_letter: None,
                drive_kind: None,
            });
        }
    }
    if let Ok(drives) = list_drives() {
        folders.extend(drives);
    }

    DirectoryView {
        title: "This PC".to_string(),
        path: None,
        parent: None,
        folders,
        images: Vec::new(),
        unsupported_file_count: 0,
        service_role: None,
        place_code: Some("this-pc".to_string()),
    }
}

fn user_folder(name: &str) -> Option<PathBuf> {
    let profile = std::env::var_os("USERPROFILE")?;
    let direct = PathBuf::from(&profile).join(name);
    if direct.is_dir() {
        return Some(direct);
    }
    let onedrive = PathBuf::from(profile).join("OneDrive").join(name);
    onedrive.is_dir().then_some(onedrive)
}

#[cfg(windows)]
pub fn list_drives() -> Result<Vec<FolderShortcut>, String> {
    unsafe extern "system" {
        fn GetLogicalDrives() -> u32;
        fn GetDriveTypeW(root: *const u16) -> u32;
        fn GetLastError() -> u32;
        fn SetLastError(code: u32);
    }

    const DRIVE_REMOVABLE: u32 = 2;
    const DRIVE_FIXED: u32 = 3;
    const DRIVE_REMOTE: u32 = 4;
    const DRIVE_CDROM: u32 = 5;

    let mask = unsafe {
        SetLastError(0);
        GetLogicalDrives()
    };
    if mask == 0 {
        let code = unsafe { GetLastError() };
        if code != 0 {
            return Err(format!("GetLogicalDrives failed ({code})"));
        }
    }
    let mut drives = Vec::new();
    for index in 0..26 {
        if mask & (1 << index) == 0 {
            continue;
        }
        let letter = (b'A' + index) as char;
        let mut wide: Vec<u16> = format!("{letter}:\\").encode_utf16().collect();
        wide.push(0);
        let kind = unsafe { GetDriveTypeW(wide.as_ptr()) };
        if !matches!(
            kind,
            DRIVE_REMOVABLE | DRIVE_FIXED | DRIVE_REMOTE | DRIVE_CDROM
        ) {
            continue;
        }
        // Skip volume IOCTL / seek probes for remote and optical roots — they can stall
        // on disconnected network shares, and drive_media ignores those probes anyway.
        let (penalty, bus) = if matches!(kind, DRIVE_FIXED | DRIVE_REMOVABLE) {
            (fixed_seek_penalty(letter), volume_bus(letter))
        } else {
            (None, None)
        };
        let name = volume_label(letter).unwrap_or_default();
        drives.push(FolderShortcut {
            name,
            path: format!("{letter}:\\"),
            kind: FolderKind::Drive,
            media: Some(drive_media(kind, penalty, bus).to_string()),
            service_role: None,
            place_code: Some("drive".to_string()),
            drive_letter: Some(letter.to_string()),
            drive_kind: Some(drive_kind_name(kind).to_string()),
        });
    }
    Ok(drives)
}

#[cfg(windows)]
fn drive_kind_name(kind: u32) -> &'static str {
    const DRIVE_REMOVABLE: u32 = 2;
    const DRIVE_FIXED: u32 = 3;
    const DRIVE_REMOTE: u32 = 4;
    const DRIVE_CDROM: u32 = 5;
    match kind {
        DRIVE_FIXED => "fixed",
        DRIVE_REMOVABLE => "removable",
        DRIVE_REMOTE => "remote",
        DRIVE_CDROM => "optical",
        _ => "unknown",
    }
}

#[cfg(windows)]
fn volume_label(letter: char) -> Option<String> {
    unsafe extern "system" {
        fn GetVolumeInformationW(
            root: *const u16,
            volume_name: *mut u16,
            volume_name_size: u32,
            volume_serial: *mut u32,
            max_component: *mut u32,
            flags: *mut u32,
            fs_name: *mut u16,
            fs_name_size: u32,
        ) -> i32;
    }

    let mut root: Vec<u16> = format!("{letter}:\\").encode_utf16().collect();
    root.push(0);
    let mut name = [0u16; 261];
    let ok = unsafe {
        GetVolumeInformationW(
            root.as_ptr(),
            name.as_mut_ptr(),
            name.len() as u32,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
        )
    };
    if ok == 0 {
        return None;
    }
    let end = name
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(name.len());
    let label = String::from_utf16_lossy(&name[..end]).trim().to_string();
    (!label.is_empty()).then_some(label)
}

#[cfg(not(windows))]
pub fn list_drives() -> Result<Vec<FolderShortcut>, String> {
    Ok(Vec::new())
}

pub fn drive_media(kind: u32, penalty: Option<bool>, bus: Option<u32>) -> &'static str {
    const DRIVE_REMOVABLE: u32 = 2;
    const DRIVE_FIXED: u32 = 3;
    const DRIVE_REMOTE: u32 = 4;
    const DRIVE_CDROM: u32 = 5;
    const BUS_USB: u32 = 7;
    const BUS_SD: u32 = 12;
    const BUS_MMC: u32 = 13;
    const BUS_NVME: u32 = 17;

    if kind == DRIVE_REMOTE {
        return "nas";
    }
    if kind == DRIVE_CDROM {
        return "optical";
    }
    match bus {
        Some(BUS_SD | BUS_MMC) => return "sd",
        Some(BUS_USB) => return "removable",
        Some(BUS_NVME) => return "ssd",
        _ => {}
    }
    if kind == DRIVE_REMOVABLE {
        return "removable";
    }
    if kind == DRIVE_FIXED {
        return match penalty {
            Some(true) => "hdd",
            Some(false) => "ssd",
            None => "unknown",
        };
    }
    "unknown"
}

#[cfg(windows)]
fn volume_bus(letter: char) -> Option<u32> {
    crate::storage::volume_bus(&format!("{letter}:"))
}

#[cfg(windows)]
fn fixed_seek_penalty(letter: char) -> Option<bool> {
    match crate::storage::detect_volume(&format!("{letter}:")) {
        Some(crate::storage::StorageProfile::Hdd) => Some(true),
        Some(crate::storage::StorageProfile::Ssd) => Some(false),
        None => None,
    }
}

#[cfg(test)]
mod media_tests {
    use super::drive_media;

    #[test]
    fn classifies_drive_from_kind_bus_and_seek_penalty() {
        assert_eq!(drive_media(3, Some(true), None), "hdd");
        assert_eq!(drive_media(3, Some(false), None), "ssd");
        assert_eq!(drive_media(3, None, None), "unknown");
        assert_eq!(drive_media(2, None, None), "removable");
        assert_eq!(drive_media(4, Some(false), Some(7)), "nas");
        assert_eq!(drive_media(5, None, Some(7)), "optical");
        assert_eq!(drive_media(2, None, Some(12)), "sd");
        assert_eq!(drive_media(2, None, Some(13)), "sd");
        assert_eq!(drive_media(3, Some(true), Some(7)), "removable");
        assert_eq!(drive_media(3, Some(true), Some(17)), "ssd");
    }
}

#[cfg(test)]
mod home_tests {
    use super::FolderKind;
    use super::{home_view, PLACES};

    #[test]
    fn home_view_sets_place_codes() {
        let view = home_view();
        assert_eq!(view.place_code.as_deref(), Some("this-pc"));
        for folder in &view.folders {
            match folder.kind {
                FolderKind::Place => {
                    assert!(folder.place_code.is_some());
                    assert!(PLACES.iter().any(|(code, name)| {
                        folder.place_code.as_deref() == Some(*code) && folder.name == *name
                    }));
                }
                FolderKind::Drive => {
                    assert_eq!(folder.place_code.as_deref(), Some("drive"));
                    assert!(folder.drive_letter.is_some());
                    assert!(folder.drive_kind.is_some());
                }
                FolderKind::Folder => {}
            }
        }
    }
}
