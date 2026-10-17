use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use image::{DynamicImage, RgbImage};

use crate::metadata::HeaderMeta;

use super::{DecodeError, FailureKind, Source};

const META_LIMIT: u64 = 4 * 1024 * 1024;
pub const MAX_PIXELS: u64 = 80_000_000;

pub fn decode(bytes: &[u8]) -> Result<Source, DecodeError> {
    decode_with(bytes, heic_rs::PixelLayout::Rgb8, false)
}

/// Viewer decode keeps an alpha plane when the file has one.
pub fn decode_viewer(bytes: &[u8]) -> Result<Source, DecodeError> {
    decode_with(bytes, heic_rs::PixelLayout::Rgba8, true)
}

fn decode_with(
    bytes: &[u8],
    layout: heic_rs::PixelLayout,
    alpha: bool,
) -> Result<Source, DecodeError> {
    let options = heic_rs::DecodeOptions {
        layout,
        apply_transforms: true,
        decode_alpha: alpha,
        max_pixels: Some(MAX_PIXELS),
        ..heic_rs::DecodeOptions::default()
    };
    let image = heic_rs::decode(bytes, &options).map_err(map_error)?;
    let image = match layout {
        heic_rs::PixelLayout::Rgba8 => {
            let rgba = image::RgbaImage::from_raw(image.width, image.height, image.data)
                .ok_or_else(|| {
                    DecodeError::new(FailureKind::Failed, "heic pixel buffer size mismatch")
                })?;
            DynamicImage::ImageRgba8(rgba)
        }
        _ => {
            let rgb =
                RgbImage::from_raw(image.width, image.height, image.data).ok_or_else(|| {
                    DecodeError::new(FailureKind::Failed, "heic pixel buffer size mismatch")
                })?;
            DynamicImage::ImageRgb8(rgb)
        }
    };
    Ok(Source {
        image,
        orientation: 1,
        icc: None,
    })
}

pub fn read_header(path: &Path) -> Result<HeaderMeta, String> {
    let bytes = collect_meta(path).map_err(|err| format!("heif {}: {err}", path.display()))?;
    let info = heic_rs::probe(&bytes).map_err(|err| format!("heif {}: {err}", path.display()))?;
    Ok(HeaderMeta {
        width: info.width,
        height: info.height,
        orientation: 1,
    })
}

fn map_error(err: heic_rs::Error) -> DecodeError {
    let kind = match err {
        heic_rs::Error::Unsupported(_) => FailureKind::Unsupported,
        heic_rs::Error::Truncated(_)
        | heic_rs::Error::Malformed(_)
        | heic_rs::Error::MissingBox(_)
        | heic_rs::Error::MissingItem(_)
        | heic_rs::Error::MissingParameterSet(_)
        | heic_rs::Error::CyclicDerivation(_) => FailureKind::Corrupted,
        heic_rs::Error::Io(_) => FailureKind::Io,
        _ => FailureKind::Failed,
    };
    DecodeError::new(kind, err.to_string())
}

pub(crate) fn collect_meta(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|err| err.to_string())?;
    let len = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    if len > 0 && len <= META_LIMIT {
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|err| err.to_string())?;
        return Ok(bytes);
    }
    let mut collected = Vec::new();
    let mut cursor = 0u64;
    loop {
        if cursor + 8 > len && len > 0 {
            break;
        }
        file.seek(SeekFrom::Start(cursor))
            .map_err(|err| err.to_string())?;
        let mut header = [0u8; 8];
        if file.read_exact(&mut header).is_err() {
            break;
        }
        let mut size = u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as u64;
        let kind = [header[4], header[5], header[6], header[7]];
        let mut header_len = 8u64;
        if size == 1 {
            let mut large = [0u8; 8];
            file.read_exact(&mut large).map_err(|err| err.to_string())?;
            size = u64::from_be_bytes(large);
            header_len = 16;
        } else if size == 0 {
            size = len.saturating_sub(cursor);
        }
        if size < header_len {
            return Err("bad ISOBMFF box size".into());
        }
        let skip = matches!(&kind, b"mdat" | b"free" | b"skip" | b"wide");
        if skip {
            cursor = cursor.saturating_add(size);
            continue;
        }
        if collected.len() as u64 + size > META_LIMIT {
            return Err("HEIF metadata boxes larger than 4 MiB".into());
        }
        file.seek(SeekFrom::Start(cursor))
            .map_err(|err| err.to_string())?;
        let mut box_bytes = vec![0u8; size as usize];
        file.read_exact(&mut box_bytes)
            .map_err(|err| err.to_string())?;
        collected.extend_from_slice(&box_bytes);
        cursor = cursor.saturating_add(size);
        if &kind == b"meta" {
            break;
        }
        if len > 0 && cursor >= len {
            break;
        }
    }
    if collected.is_empty() {
        return Err("no HEIF metadata boxes".into());
    }
    Ok(collected)
}
