use std::io::Cursor;

use image::{DynamicImage, RgbImage};

use crate::metadata;

use super::{DecodeError, FailureKind, Source};

/// Largest JPEG DCT divisor (1, 2, 4, 8) whose long edge is still at least `target_long`.
pub fn idct_divisor(width: u32, height: u32, target_long: u32) -> u32 {
    let long = width.max(height).max(1);
    let target = target_long.max(1);
    let mut divisor = 1u32;
    while divisor < 8 && long / (divisor * 2) >= target {
        divisor *= 2;
    }
    divisor
}

pub fn decode_scaled(bytes: &[u8], target_long_edge: u32) -> Result<Source, DecodeError> {
    let orientation = metadata::jpeg_orientation(bytes);
    let mut decoder = jpeg_decoder::Decoder::new(Cursor::new(bytes));
    decoder
        .read_info()
        .map_err(|err| DecodeError::new(FailureKind::Corrupted, err.to_string()))?;
    let info = decoder
        .info()
        .ok_or_else(|| DecodeError::new(FailureKind::Corrupted, "jpeg has no frame"))?;
    let width = u32::from(info.width);
    let height = u32::from(info.height);
    if width == 0 || height == 0 {
        return Err(DecodeError::new(
            FailureKind::Corrupted,
            "jpeg has no frame size",
        ));
    }
    let divisor = idct_divisor(width, height, target_long_edge);
    let request_w = (width / divisor).max(1).min(u32::from(u16::MAX)) as u16;
    let request_h = (height / divisor).max(1).min(u32::from(u16::MAX)) as u16;
    decoder
        .scale(request_w, request_h)
        .map_err(|err| DecodeError::new(FailureKind::Failed, err.to_string()))?;
    let icc = decoder.icc_profile();
    let pixels = decoder
        .decode()
        .map_err(|err| DecodeError::new(FailureKind::Corrupted, err.to_string()))?;
    let decoded = decoder
        .info()
        .ok_or_else(|| DecodeError::new(FailureKind::Failed, "jpeg decoder dropped image info"))?;
    let image = image_from_pixels(decoded.width, decoded.height, decoded.pixel_format, pixels)?;
    Ok(Source {
        image,
        orientation,
        icc,
    })
}

fn image_from_pixels(
    width: u16,
    height: u16,
    format: jpeg_decoder::PixelFormat,
    pixels: Vec<u8>,
) -> Result<DynamicImage, DecodeError> {
    let width = u32::from(width);
    let height = u32::from(height);
    match format {
        jpeg_decoder::PixelFormat::RGB24 => {
            let rgb = RgbImage::from_raw(width, height, pixels).ok_or_else(|| {
                DecodeError::new(
                    FailureKind::Corrupted,
                    "jpeg rgb buffer does not match the frame",
                )
            })?;
            Ok(DynamicImage::ImageRgb8(rgb))
        }
        jpeg_decoder::PixelFormat::L8 => {
            let mut rgb = Vec::with_capacity(pixels.len() * 3);
            for gray in pixels {
                rgb.extend_from_slice(&[gray, gray, gray]);
            }
            let rgb = RgbImage::from_raw(width, height, rgb).ok_or_else(|| {
                DecodeError::new(
                    FailureKind::Corrupted,
                    "jpeg gray buffer does not match the frame",
                )
            })?;
            Ok(DynamicImage::ImageRgb8(rgb))
        }
        jpeg_decoder::PixelFormat::L16 | jpeg_decoder::PixelFormat::CMYK32 => {
            Err(DecodeError::new(
                FailureKind::Unsupported,
                "jpeg pixel format is decoded by the full decoder",
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::idct_divisor;

    #[test]
    fn divisor_keeps_the_long_edge_at_least_the_tile() {
        assert_eq!(idct_divisor(6000, 4000, 512), 8);
        assert_eq!(idct_divisor(1600, 1200, 512), 2);
        assert_eq!(idct_divisor(800, 600, 512), 1);
        assert_eq!(idct_divisor(400, 300, 512), 1);
    }
}
