use image::{DynamicImage, ImageDecoder, ImageReader, Limits};

use crate::formats::Format;

use super::{DecodeError, Source};

/// Untrusted files stop at 16384 px on a side. The crate's 512 MiB allocation cap stays.
pub fn decode_limits() -> Limits {
    let mut limits = Limits::default();
    limits.max_image_width = Some(16_384);
    limits.max_image_height = Some(16_384);
    limits
}

pub fn decode_hinted(bytes: &[u8], hint: Option<Format>) -> Result<Source, DecodeError> {
    let cursor = std::io::Cursor::new(bytes);
    let mut reader = match hint.and_then(Format::image_format) {
        Some(format) => ImageReader::with_format(cursor, format),
        None => ImageReader::new(cursor)
            .with_guessed_format()
            .map_err(DecodeError::io)?,
    };
    reader.limits(decode_limits());
    let mut decoder = reader.into_decoder()?;
    let orientation = decoder
        .orientation()
        .map(|value| value.to_exif())
        .unwrap_or(1);
    let icc = decoder.icc_profile().ok().flatten();
    let image = DynamicImage::from_decoder(decoder)?;
    Ok(Source {
        image,
        orientation,
        icc,
    })
}
