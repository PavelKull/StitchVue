use std::io::Read;
use std::path::Path;

use image::ImageDecoder;
use image::ImageReader;
use serde::Serialize;

use crate::formats::{self, Format};

#[derive(Debug, Clone, Copy)]
pub struct HeaderMeta {
    pub width: u32,
    pub height: u32,
    pub orientation: u8,
}

pub fn read_header(path: &Path) -> Result<HeaderMeta, String> {
    let candidate = formats::from_path(path);
    let first = read_as(path, candidate);
    if first.is_ok() {
        return first;
    }
    match formats::sniff_file(path) {
        Some(actual) if Some(actual) != candidate => read_as(path, Some(actual)),
        _ => first,
    }
}

fn read_as(path: &Path, format: Option<Format>) -> Result<HeaderMeta, String> {
    match format {
        Some(Format::Jpeg) => read_jpeg_header(path),
        Some(Format::Heic | Format::Heif) => crate::thumbnail::heif_header(path),
        Some(Format::Raw) => crate::thumbnail::raw_header(path),
        Some(Format::Avif) => crate::thumbnail::avif_header(path),
        // Geometry arrives with the Quick Look poster frame.
        Some(Format::Video) => Err(format!("no image header in video {}", path.display())),
        _ => read_common_header(path),
    }
}

fn read_common_header(path: &Path) -> Result<HeaderMeta, String> {
    let mut reader =
        ImageReader::open(path).map_err(|err| format!("open {}: {err}", path.display()))?;
    if let Some(format) = formats::from_path(path).and_then(Format::image_format) {
        reader.set_format(format);
    } else {
        reader = reader
            .with_guessed_format()
            .map_err(|err| format!("guess format {}: {err}", path.display()))?;
    }
    let mut decoder = reader
        .into_decoder()
        .map_err(|err| format!("header {}: {err}", path.display()))?;
    let (width, height) = decoder.dimensions();
    let orientation = decoder
        .orientation()
        .ok()
        .map(|value| value.to_exif())
        .unwrap_or(1);
    let (width, height) = oriented_size(width, height, orientation);
    Ok(HeaderMeta {
        width,
        height,
        orientation,
    })
}

pub fn oriented_size(width: u32, height: u32, orientation: u8) -> (u32, u32) {
    match orientation {
        5 | 6 | 7 | 8 => (height, width),
        _ => (width, height),
    }
}

fn read_jpeg_header(path: &Path) -> Result<HeaderMeta, String> {
    let mut file =
        std::fs::File::open(path).map_err(|err| format!("open {}: {err}", path.display()))?;
    let mut orientation = 1u8;
    let mut width = 0u32;
    let mut height = 0u32;
    let mut found = false;

    let mut start = [0u8; 2];
    file.read_exact(&mut start)
        .map_err(|err| format!("read {}: {err}", path.display()))?;
    if start != [0xFF, 0xD8] {
        return Err(format!("read {}: not a jpeg", path.display()));
    }

    loop {
        let marker = next_marker(&mut file, path)?;
        if marker == 0xD9 || marker == 0xDA {
            break;
        }
        if marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            continue;
        }
        let mut len_bytes = [0u8; 2];
        file.read_exact(&mut len_bytes)
            .map_err(|err| format!("read {}: {err}", path.display()))?;
        let len = u16::from_be_bytes(len_bytes) as usize;
        if len < 2 {
            return Err(format!("read {}: bad jpeg marker", path.display()));
        }
        let payload_len = len - 2;
        if is_sof(marker) {
            if payload_len < 5 {
                return Err(format!("read {}: short jpeg frame", path.display()));
            }
            let mut sof = [0u8; 5];
            file.read_exact(&mut sof)
                .map_err(|err| format!("read {}: {err}", path.display()))?;
            height = u16::from_be_bytes([sof[1], sof[2]]) as u32;
            width = u16::from_be_bytes([sof[3], sof[4]]) as u32;
            skip(&mut file, path, payload_len - 5)?;
            found = true;
            break;
        } else if marker == 0xE1 {
            let mut payload = vec![0u8; payload_len];
            file.read_exact(&mut payload)
                .map_err(|err| format!("read {}: {err}", path.display()))?;
            if let Some(value) = orientation_from_app1(&payload) {
                orientation = value;
            }
        } else {
            skip(&mut file, path, payload_len)?;
        }
    }

    if !found || width == 0 || height == 0 {
        return Err(format!("read {}: jpeg size not found", path.display()));
    }
    let (width, height) = oriented_size(width, height, orientation);
    Ok(HeaderMeta {
        width,
        height,
        orientation,
    })
}

fn is_sof(marker: u8) -> bool {
    matches!(
        marker,
        0xC0 | 0xC1 | 0xC2 | 0xC3 | 0xC5 | 0xC6 | 0xC7 | 0xC9 | 0xCA | 0xCB | 0xCD | 0xCE | 0xCF
    )
}

fn next_marker(file: &mut impl Read, path: &Path) -> Result<u8, String> {
    let mut byte = [0u8; 1];
    loop {
        file.read_exact(&mut byte)
            .map_err(|err| format!("read {}: {err}", path.display()))?;
        if byte[0] == 0xFF {
            break;
        }
    }
    loop {
        file.read_exact(&mut byte)
            .map_err(|err| format!("read {}: {err}", path.display()))?;
        if byte[0] != 0xFF {
            return Ok(byte[0]);
        }
    }
}

fn skip(file: &mut impl Read, path: &Path, mut remaining: usize) -> Result<(), String> {
    let mut buf = [0u8; 8192];
    while remaining > 0 {
        let chunk = remaining.min(buf.len());
        file.read_exact(&mut buf[..chunk])
            .map_err(|err| format!("read {}: {err}", path.display()))?;
        remaining -= chunk;
    }
    Ok(())
}

fn orientation_from_app1(payload: &[u8]) -> Option<u8> {
    let rest = payload.strip_prefix(b"Exif\0\0")?;
    orientation_from_tiff(rest)
}

/// EXIF orientation from a JPEG already in memory. `1` when the tag is absent.
pub fn jpeg_orientation(buf: &[u8]) -> u8 {
    if buf.len() < 4 || buf[0] != 0xFF || buf[1] != 0xD8 {
        return 1;
    }
    let mut index = 2usize;
    while index + 4 <= buf.len() {
        if buf[index] != 0xFF {
            index += 1;
            continue;
        }
        let marker = buf[index + 1];
        if marker == 0x00 || marker == 0xFF {
            index += 1;
            continue;
        }
        if marker == 0xDA || marker == 0xD9 {
            break;
        }
        let len = u16::from_be_bytes([buf[index + 2], buf[index + 3]]) as usize;
        if len < 2 || index + 2 + len > buf.len() {
            break;
        }
        if marker == 0xE1 {
            if let Some(value) = orientation_from_app1(&buf[index + 4..index + 2 + len]) {
                return value;
            }
        }
        index += 2 + len;
    }
    1
}

fn orientation_from_tiff(tiff: &[u8]) -> Option<u8> {
    if tiff.len() < 8 {
        return None;
    }
    let little = match &tiff[0..2] {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let u16_at = |offset: usize| -> Option<u16> {
        let bytes = tiff.get(offset..offset + 2)?;
        Some(if little {
            u16::from_le_bytes([bytes[0], bytes[1]])
        } else {
            u16::from_be_bytes([bytes[0], bytes[1]])
        })
    };
    let u32_at = |offset: usize| -> Option<u32> {
        let bytes = tiff.get(offset..offset + 4)?;
        Some(if little {
            u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
        } else {
            u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
        })
    };
    if u16_at(2)? != 42 {
        return None;
    }
    let mut offset = u32_at(4)? as usize;
    for _ in 0..8 {
        if offset + 2 > tiff.len() {
            return None;
        }
        let count = u16_at(offset)? as usize;
        let entries = offset + 2;
        for index in 0..count {
            let entry = entries + index * 12;
            if entry + 10 > tiff.len() {
                return None;
            }
            if u16_at(entry)? == 0x0112 {
                let value = u16_at(entry + 8)?;
                if (1..=8).contains(&value) {
                    return Some(value as u8);
                }
            }
        }
        let next_at = entries + count * 12;
        let next = u32_at(next_at)? as usize;
        if next == 0 {
            break;
        }
        offset = next;
    }
    None
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhotoProperties {
    pub name: String,
    pub path: String,
    pub extension: String,
    pub size: u64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub modified_at: Option<i64>,
    pub created_at: Option<i64>,
    pub captured_at: Option<String>,
    pub orientation: Option<u8>,
    pub camera: Option<String>,
    pub lens: Option<String>,
    pub iso: Option<String>,
    pub exposure: Option<String>,
    pub aperture: Option<String>,
    pub gps: Option<String>,
    pub color_profile: Option<String>,
}

pub fn photo_properties(path: &Path) -> Result<PhotoProperties, String> {
    let meta =
        std::fs::metadata(path).map_err(|err| format!("metadata {}: {err}", path.display()))?;
    if !meta.is_file() {
        return Err(format!("not a file: {}", path.display()));
    }
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_default();
    let header = read_header(path).ok();
    let notes = if extension.eq_ignore_ascii_case("jpg") || extension.eq_ignore_ascii_case("jpeg") {
        jpeg_sidecar(path)
    } else {
        JpegSidecar::default()
    };
    let exif = notes
        .exif
        .as_deref()
        .map(notes_from_app1)
        .unwrap_or_default();
    Ok(PhotoProperties {
        name,
        path: path.display().to_string(),
        extension,
        size: meta.len(),
        width: header.as_ref().map(|item| item.width),
        height: header.as_ref().map(|item| item.height),
        modified_at: system_millis(meta.modified().ok()),
        created_at: system_millis(meta.created().ok()),
        captured_at: exif.captured_at,
        orientation: header.map(|item| item.orientation),
        camera: exif.camera,
        lens: exif.lens,
        iso: exif.iso,
        exposure: exif.exposure,
        aperture: exif.aperture,
        gps: None,
        color_profile: notes.icc.then_some("ICC".to_string()),
    })
}

fn system_millis(time: Option<std::time::SystemTime>) -> Option<i64> {
    time.and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|time| time.as_millis() as i64)
}

#[derive(Default)]
struct JpegSidecar {
    exif: Option<Vec<u8>>,
    icc: bool,
}

fn jpeg_sidecar(path: &Path) -> JpegSidecar {
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(_) => return JpegSidecar::default(),
    };
    let mut start = [0u8; 2];
    if file.read_exact(&mut start).is_err() || start != [0xFF, 0xD8] {
        return JpegSidecar::default();
    }
    let mut notes = JpegSidecar::default();
    loop {
        let Ok(marker) = next_marker(&mut file, path) else {
            break;
        };
        if marker == 0xD9 || marker == 0xDA {
            break;
        }
        if marker == 0x01 || (0xD0..=0xD7).contains(&marker) {
            continue;
        }
        let mut len_bytes = [0u8; 2];
        if file.read_exact(&mut len_bytes).is_err() {
            break;
        }
        let len = u16::from_be_bytes(len_bytes) as usize;
        if len < 2 {
            break;
        }
        let payload_len = len - 2;
        if marker == 0xE1 || marker == 0xE2 {
            let mut payload = vec![0u8; payload_len];
            if file.read_exact(&mut payload).is_err() {
                break;
            }
            if marker == 0xE1 && notes.exif.is_none() && payload.starts_with(b"Exif\0\0") {
                notes.exif = Some(payload);
            } else if marker == 0xE2 && payload.starts_with(b"ICC_PROFILE") {
                notes.icc = true;
            }
        } else if skip(&mut file, path, payload_len).is_err() {
            break;
        }
    }
    notes
}

#[derive(Default)]
struct ExifNotes {
    captured_at: Option<String>,
    camera: Option<String>,
    lens: Option<String>,
    iso: Option<String>,
    exposure: Option<String>,
    aperture: Option<String>,
}

fn notes_from_app1(payload: &[u8]) -> ExifNotes {
    let Some(tiff) = payload.strip_prefix(b"Exif\0\0") else {
        return ExifNotes::default();
    };
    notes_from_tiff(tiff)
}

fn notes_from_tiff(tiff: &[u8]) -> ExifNotes {
    let mut notes = ExifNotes::default();
    if tiff.len() < 8 {
        return notes;
    }
    let little = match &tiff[0..2] {
        b"II" => true,
        b"MM" => false,
        _ => return notes,
    };
    let u16_at = |offset: usize| -> Option<u16> {
        let bytes = tiff.get(offset..offset + 2)?;
        Some(if little {
            u16::from_le_bytes([bytes[0], bytes[1]])
        } else {
            u16::from_be_bytes([bytes[0], bytes[1]])
        })
    };
    let u32_at = |offset: usize| -> Option<u32> {
        let bytes = tiff.get(offset..offset + 4)?;
        Some(if little {
            u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
        } else {
            u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
        })
    };
    if u16_at(2) != Some(42) {
        return notes;
    }
    let mut pending = vec![u32_at(4).unwrap_or(0) as usize];
    let mut seen = 0;
    while let Some(offset) = pending.pop() {
        seen += 1;
        if seen > 6 || offset + 2 > tiff.len() {
            continue;
        }
        let Some(count) = u16_at(offset) else {
            continue;
        };
        let entries = offset + 2;
        for index in 0..count as usize {
            let entry = entries + index * 12;
            if entry + 12 > tiff.len() {
                break;
            }
            let Some(tag) = u16_at(entry) else {
                continue;
            };
            let kind = u16_at(entry + 2).unwrap_or(0);
            let count = u32_at(entry + 4).unwrap_or(0);
            let raw = u32_at(entry + 8).unwrap_or(0);
            if tag == 0x8769 {
                pending.push(raw as usize);
                continue;
            }
            if tag == 0x9003 {
                notes.captured_at = ascii_at(tiff, kind, count, raw, little);
            } else if tag == 0x010F {
                notes.camera = join_camera(
                    ascii_at(tiff, kind, count, raw, little),
                    notes.camera.take(),
                );
            } else if tag == 0x0110 {
                notes.camera = join_camera(
                    notes.camera.take(),
                    ascii_at(tiff, kind, count, raw, little),
                );
            } else if tag == 0xA434 {
                notes.lens = ascii_at(tiff, kind, count, raw, little);
            } else if tag == 0x8827 {
                notes.iso = Some(raw.to_string());
            } else if tag == 0x829A {
                notes.exposure = rational_text(tiff, raw as usize, little);
            } else if tag == 0x829D {
                notes.aperture =
                    rational_text(tiff, raw as usize, little).map(|value| format!("f/{value}"));
            }
        }
    }
    notes
}

fn join_camera(make: Option<String>, model: Option<String>) -> Option<String> {
    match (make, model) {
        (Some(make), Some(model)) => Some(format!("{make} {model}")),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

fn ascii_at(tiff: &[u8], kind: u16, count: u32, raw: u32, little: bool) -> Option<String> {
    if kind != 2 || count == 0 {
        return None;
    }
    let bytes = if count <= 4 {
        let packed = if little {
            raw.to_le_bytes()
        } else {
            raw.to_be_bytes()
        };
        packed[..count as usize].to_vec()
    } else {
        let start = raw as usize;
        let end = start + count as usize;
        tiff.get(start..end)?.to_vec()
    };
    let end = bytes
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(bytes.len());
    let text = String::from_utf8_lossy(&bytes[..end]).trim().to_string();
    (!text.is_empty()).then_some(text)
}

fn rational_text(tiff: &[u8], offset: usize, little: bool) -> Option<String> {
    let bytes = tiff.get(offset..offset + 8)?;
    let read = |slice: &[u8]| {
        if little {
            u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]])
        } else {
            u32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]])
        }
    };
    let num = read(&bytes[0..4]);
    let den = read(&bytes[4..8]);
    if den == 0 {
        return None;
    }
    if den == 1 {
        return Some(num.to_string());
    }
    Some(format!("{num}/{den}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn swaps_size_for_sideways_orientation() {
        assert_eq!(oriented_size(4000, 3000, 6), (3000, 4000));
        assert_eq!(oriented_size(4000, 3000, 1), (4000, 3000));
    }

    #[test]
    fn reads_capture_date_from_exif_ifd() {
        let tiff = [
            b'I', b'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x03, 0x90, 2, 0, 20, 0, 0, 0, 26, 0, 0, 0, 0, 0,
            0, 0, b'2', b'0', b'2', b'4', b':', b'0', b'1', b':', b'0', b'2', b' ', b'0', b'3',
            b':', b'0', b'4', b':', b'0', b'5', 0,
        ];
        let payload = [b"Exif\0\0".as_slice(), tiff.as_slice()].concat();
        assert_eq!(
            notes_from_app1(&payload).captured_at.as_deref(),
            Some("2024:01:02 03:04:05")
        );
    }

    #[test]
    fn reads_orientation_tag_from_tiff_header() {
        let tiff = [
            b'I', b'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0,
            0,
        ];
        assert_eq!(orientation_from_tiff(&tiff), Some(6));
    }
}
