use std::io::Read;
use std::path::Path;

use image::{DynamicImage, RgbImage, RgbaImage};

use crate::metadata::HeaderMeta;

use super::heif;
use super::{color, DecodeError, FailureKind, Source};

const META_LIMIT: u64 = 4 * 1024 * 1024;
const MAX_PIXELS: u32 = 64_000_000;

fn config() -> zenavif::DecoderConfig {
    zenavif::DecoderConfig::new()
        .threads(1)
        .apply_grain(false)
        .prefer_8bit(true)
        .frame_size_limit(MAX_PIXELS)
}

pub fn decode(bytes: &[u8]) -> Result<Source, DecodeError> {
    let mut decoder = zenavif::ManagedAvifDecoder::new(bytes, &config()).map_err(map_new_error)?;
    let (buffer, info) = decoder
        .decode_full(&zenavif::Unstoppable)
        .map_err(map_new_error)?;
    let mut image = into_image(buffer)?;
    image = apply_transforms(image, &info);
    if color::is_hdr_transfer(info.transfer_characteristics.0) {
        let bt2020 = info.color_primaries.0 == 9;
        match &mut image {
            DynamicImage::ImageRgb8(rgb) => {
                color::map_hdr_rgb(rgb, info.transfer_characteristics.0, bt2020)
            }
            DynamicImage::ImageRgba8(rgba) => {
                color::map_hdr_rgba(rgba, info.transfer_characteristics.0, bt2020)
            }
            _ => {}
        }
    }
    Ok(Source {
        image,
        orientation: 1,
        icc: info.icc_profile,
    })
}

pub fn read_header(path: &Path) -> Result<HeaderMeta, String> {
    let first = heif::collect_meta(path).or_else(|_| read_capped(path))?;
    match probe(&first) {
        Ok(meta) => Ok(meta),
        Err(first_err) => {
            let capped = read_capped(path)?;
            probe(&capped).map_err(|err| format!("{first_err}; retry: {err}"))
        }
    }
}

fn probe(bytes: &[u8]) -> Result<HeaderMeta, String> {
    let decoder =
        zenavif::ManagedAvifDecoder::new(bytes, &config()).map_err(|err| err.to_string())?;
    let info = decoder.probe_info().map_err(|err| err.to_string())?;
    let (width, height) = oriented_pixels(info.width, info.height, info.rotation);
    Ok(HeaderMeta {
        width,
        height,
        orientation: 1,
    })
}

fn read_capped(path: &Path) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(path).map_err(|err| err.to_string())?;
    let len = file
        .metadata()
        .map(|meta| meta.len())
        .unwrap_or(0)
        .min(META_LIMIT);
    let mut bytes = Vec::new();
    bytes
        .try_reserve(len as usize)
        .map_err(|err| err.to_string())?;
    file.take(META_LIMIT)
        .read_to_end(&mut bytes)
        .map_err(|err| err.to_string())?;
    Ok(bytes)
}

fn into_image(buffer: zenavif::PixelBuffer) -> Result<DynamicImage, DecodeError> {
    let width = buffer.width();
    let height = buffer.height();
    let has_alpha = buffer.has_alpha();
    let gray = buffer.is_grayscale();
    let bytes = buffer.copy_to_contiguous_bytes();
    let pixels = (width as usize).saturating_mul(height as usize);
    if gray && !has_alpha && bytes.len() == pixels {
        let luma = image::GrayImage::from_raw(width, height, bytes).ok_or_else(|| {
            DecodeError::new(FailureKind::Failed, "avif gray buffer size mismatch")
        })?;
        return Ok(DynamicImage::ImageLuma8(luma));
    }
    if has_alpha && bytes.len() == pixels * 4 {
        let rgba = RgbaImage::from_raw(width, height, bytes).ok_or_else(|| {
            DecodeError::new(FailureKind::Failed, "avif rgba buffer size mismatch")
        })?;
        return Ok(DynamicImage::ImageRgba8(rgba));
    }
    if bytes.len() == pixels * 3 {
        let rgb = RgbImage::from_raw(width, height, bytes).ok_or_else(|| {
            DecodeError::new(FailureKind::Failed, "avif rgb buffer size mismatch")
        })?;
        return Ok(DynamicImage::ImageRgb8(rgb));
    }
    Err(DecodeError::new(
        FailureKind::Failed,
        format!(
            "avif unexpected buffer {} bytes for {width}x{height} alpha={has_alpha} gray={gray}",
            bytes.len()
        ),
    ))
}

fn apply_transforms(mut image: DynamicImage, info: &zenavif::ImageInfo) -> DynamicImage {
    if let Some(rotation) = info.rotation {
        image = match rotation.angle {
            90 => image.rotate270(),
            180 => image.rotate180(),
            270 => image.rotate90(),
            _ => image,
        };
    }
    if let Some(mirror) = info.mirror {
        image = match mirror.axis {
            0 => image.flipv(),
            1 => image.fliph(),
            _ => image,
        };
    }
    image
}

fn oriented_pixels(
    width: u32,
    height: u32,
    rotation: Option<zenavif::ImageRotation>,
) -> (u32, u32) {
    match rotation.map(|value| value.angle).unwrap_or(0) {
        90 | 270 => (height, width),
        _ => (width, height),
    }
}

fn map_new_error(err: impl std::fmt::Display) -> DecodeError {
    let message = err.to_string();
    let kind = if message.contains("Unsupported") {
        FailureKind::Unsupported
    } else if message.contains("Parse")
        || message.contains("Decode")
        || message.contains("too large")
        || message.contains("Malformed")
    {
        FailureKind::Corrupted
    } else {
        FailureKind::Failed
    };
    DecodeError::new(kind, message)
}

#[cfg(test)]
mod tests {
    /// Same reduction zenavif uses for `prefer_8bit`: scale to u16 with LSB
    /// replication, then keep the high byte. 10-bit 1023 and 12-bit 4095 both land on 255.
    fn sdr_high_byte(sample: u16, bits: u8) -> u8 {
        let shift = 16 - bits;
        let wide = (u32::from(sample) << shift) | (u32::from(sample) >> (bits - shift));
        (wide >> 8) as u8
    }

    #[test]
    fn ten_and_twelve_bit_full_scale_keeps_the_high_byte() {
        assert_eq!(sdr_high_byte(0, 10), 0);
        assert_eq!(sdr_high_byte(512, 10), 128);
        assert_eq!(sdr_high_byte(1023, 10), 255);
        assert_eq!(sdr_high_byte(0, 12), 0);
        assert_eq!(sdr_high_byte(2048, 12), 128);
        assert_eq!(sdr_high_byte(4095, 12), 255);
    }
}
