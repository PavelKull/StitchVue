use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageProfile {
    Hdd,
    Ssd,
}

impl StorageProfile {
    pub fn read_slots(self) -> usize {
        match self {
            Self::Hdd => 1,
            Self::Ssd => 4,
        }
    }
}

static CACHE: Mutex<Option<HashMap<String, StorageProfile>>> = Mutex::new(None);

pub fn profile_for(path: &Path, override_profile: Option<StorageProfile>) -> StorageProfile {
    if let Some(profile) = override_profile {
        return profile;
    }
    let Some(volume) = volume_key(path) else {
        return unprobed_profile(path);
    };
    let mut cache = CACHE.lock().unwrap_or_else(|err| err.into_inner());
    let cache = cache.get_or_insert_with(HashMap::new);
    if let Some(profile) = cache.get(&volume) {
        return *profile;
    }
    let profile = detect_volume(&volume).unwrap_or(StorageProfile::Hdd);
    cache.insert(volume, profile);
    profile
}

/// No drive probe outside Windows. The system disk is assumed to be an SSD (every
/// current Mac, most Linux machines); mounted volumes keep the cautious HDD profile
/// unless overridden in settings.
// ponytail: path heuristic. Probe IOKit "Solid State" (macOS) or
// /sys/dev/block/<dev>/queue/rotational (Linux) if it guesses wrong too often.
fn unprobed_profile(path: &Path) -> StorageProfile {
    const MOUNTS: &[&str] = if cfg!(target_os = "macos") {
        &["/Volumes"]
    } else {
        &["/media", "/run/media", "/mnt"]
    };
    let unix = cfg!(any(target_os = "macos", target_os = "linux"));
    if unix && path.has_root() && !MOUNTS.iter().any(|mount| path.starts_with(mount)) {
        StorageProfile::Ssd
    } else {
        StorageProfile::Hdd
    }
}

fn volume_key(path: &Path) -> Option<String> {
    let text = path.to_string_lossy();
    let mut chars = text.chars();
    let letter = chars.next()?.to_ascii_uppercase();
    if letter.is_ascii_alphabetic() && chars.next() == Some(':') {
        Some(format!("{letter}:"))
    } else {
        None
    }
}

#[cfg(windows)]
pub(crate) fn detect_volume(volume: &str) -> Option<StorageProfile> {
    let mut descriptor = [0u8; 12];
    let returned = query_storage(volume, 7, &mut descriptor)?;
    if returned < 9 {
        return None;
    }
    Some(if descriptor[8] == 0 {
        StorageProfile::Ssd
    } else {
        StorageProfile::Hdd
    })
}

/// `STORAGE_BUS_TYPE` from `StorageDeviceProperty`. `None` when the volume cannot be opened.
#[cfg(windows)]
pub(crate) fn volume_bus(volume: &str) -> Option<u32> {
    const BUS_OFFSET: usize = 28;
    let mut descriptor = [0u8; 64];
    let returned = query_storage(volume, 0, &mut descriptor)?;
    if returned < BUS_OFFSET + 4 {
        return None;
    }
    Some(u32::from_le_bytes(
        descriptor[BUS_OFFSET..BUS_OFFSET + 4].try_into().ok()?,
    ))
}

#[cfg(windows)]
fn query_storage(volume: &str, property_id: i32, output: &mut [u8]) -> Option<usize> {
    unsafe extern "system" {
        fn CreateFileW(
            name: *const u16,
            access: u32,
            share: u32,
            security: *mut core::ffi::c_void,
            disposition: u32,
            flags: u32,
            template: *mut core::ffi::c_void,
        ) -> *mut core::ffi::c_void;
        fn DeviceIoControl(
            handle: *mut core::ffi::c_void,
            code: u32,
            input: *const core::ffi::c_void,
            input_size: u32,
            output: *mut core::ffi::c_void,
            output_size: u32,
            returned: *mut u32,
            overlapped: *mut core::ffi::c_void,
        ) -> i32;
        fn CloseHandle(handle: *mut core::ffi::c_void) -> i32;
    }

    const FILE_SHARE_READ: u32 = 1;
    const FILE_SHARE_WRITE: u32 = 2;
    const FILE_SHARE_DELETE: u32 = 4;
    const OPEN_EXISTING: u32 = 3;
    const IOCTL_STORAGE_QUERY_PROPERTY: u32 = 0x002D_1400;

    #[repr(C)]
    struct Query {
        property_id: i32,
        query_type: i32,
        additional: [u8; 1],
    }

    let device = format!("\\\\.\\{volume}");
    let mut wide: Vec<u16> = device.encode_utf16().collect();
    wide.push(0);
    // Zero access: GENERIC_READ is denied for a normal user, and these queries only need metadata.
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            core::ptr::null_mut(),
            OPEN_EXISTING,
            0,
            core::ptr::null_mut(),
        )
    };
    if handle.is_null() || handle == (-1isize as *mut core::ffi::c_void) {
        return None;
    }
    let query = Query {
        property_id,
        query_type: 0,
        additional: [0],
    };
    let mut returned = 0u32;
    let ok = unsafe {
        DeviceIoControl(
            handle,
            IOCTL_STORAGE_QUERY_PROPERTY,
            &query as *const Query as *const core::ffi::c_void,
            std::mem::size_of::<Query>() as u32,
            output.as_mut_ptr() as *mut core::ffi::c_void,
            output.len() as u32,
            &mut returned,
            core::ptr::null_mut(),
        )
    };
    unsafe {
        CloseHandle(handle);
    }
    (ok != 0).then_some(returned as usize)
}

#[cfg(not(windows))]
pub(crate) fn detect_volume(_volume: &str) -> Option<StorageProfile> {
    None
}

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
mod tests {
    use super::{profile_for, StorageProfile};
    use std::path::Path;

    #[test]
    fn system_disk_is_ssd_and_mounted_volumes_stay_cautious() {
        let profile = |path: &str| profile_for(Path::new(path), None);
        assert_eq!(profile("/Users/me/Pictures"), StorageProfile::Ssd);
        let mounted = if cfg!(target_os = "macos") {
            "/Volumes/Archive/Photos"
        } else {
            "/media/me/Archive/Photos"
        };
        assert_eq!(profile(mounted), StorageProfile::Hdd);
        assert_eq!(
            profile_for(Path::new("/Volumes/Archive"), Some(StorageProfile::Ssd)),
            StorageProfile::Ssd
        );
    }
}
