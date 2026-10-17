use std::path::Path;
use std::sync::Arc;

use image::{DynamicImage, GenericImageView};
use rawler::decoders::RawDecodeParams;
use rawler::rawsource::RawSource;

use crate::metadata::HeaderMeta;

use super::{DecodeError, FailureKind, Source};

const PREVIEW_MIN_EDGE: u32 = 512;

pub fn develop_path(path: &Path) -> Result<Source, DecodeError> {
    with_file(path, |decoder, source, params| {
        let raw = decoder
            .raw_image(source, params, false)
            .map_err(map_error)?;
        let image = rawler::imgop::develop::RawDevelop::default()
            .develop_intermediate(&raw)
            .map_err(|err| DecodeError::new(FailureKind::Failed, err.to_string()))?
            .to_dynamic_image()
            .ok_or_else(|| {
                DecodeError::new(FailureKind::Failed, "RAW develop produced no bitmap")
            })?;
        Ok(Source {
            image,
            orientation: 1,
            icc: None,
        })
    })
}

pub fn embedded_covers_edge(preview_edge: u32, requested: u32) -> bool {
    preview_edge >= requested.max(1)
}

/// Largest embedded preview, including ones smaller than the gallery's 512 px floor.
pub fn embedded_source(path: &Path) -> Result<Source, DecodeError> {
    with_file(path, |decoder, source, params| {
        let preview = largest_embedded(decoder.as_ref(), source, params)?;
        let orientation = preview_orientation(decoder.as_ref(), source, params, &preview)?;
        Ok(Source {
            image: preview,
            orientation,
            icc: None,
        })
    })
}

pub fn decode_path(path: &Path) -> Result<Source, DecodeError> {
    with_file(path, |decoder, source, params| {
        let preview = best_preview(decoder.as_ref(), source, params)?;
        let orientation = preview_orientation(decoder.as_ref(), source, params, &preview)?;
        Ok(Source {
            image: preview,
            orientation,
            icc: None,
        })
    })
}

pub fn decode(bytes: Arc<Vec<u8>>) -> Result<Source, DecodeError> {
    with_source(
        RawSource::new_from_shared_vec(bytes),
        |decoder, source, params| {
            let preview = best_preview(decoder.as_ref(), source, params)?;
            let orientation = preview_orientation(decoder.as_ref(), source, params, &preview)?;
            Ok(Source {
                image: preview,
                orientation,
                icc: None,
            })
        },
    )
}

pub fn read_header(path: &Path) -> Result<HeaderMeta, String> {
    let source = RawSource::new(path).map_err(|err| err.to_string())?;
    let decoder = rawler::get_decoder(&source).map_err(|err| err.to_string())?;
    let params = RawDecodeParams::default();
    let meta = decoder
        .raw_metadata(&source, &params)
        .map_err(|err| err.to_string())?;
    let orientation = meta
        .exif
        .orientation
        .filter(|value| (1..=8).contains(value))
        .unwrap_or(1) as u8;
    // dummy=true parses size without filling a sensor bitmap.
    let dummy = decoder
        .raw_image(&source, &params, true)
        .map_err(|err| err.to_string())?;
    let (width, height) =
        crate::metadata::oriented_size(dummy.width as u32, dummy.height as u32, orientation);
    Ok(HeaderMeta {
        width,
        height,
        orientation,
    })
}

fn with_file<T>(
    path: &Path,
    job: impl FnOnce(
        &Box<dyn rawler::decoders::Decoder>,
        &RawSource,
        &RawDecodeParams,
    ) -> Result<T, DecodeError>,
) -> Result<T, DecodeError> {
    let source = RawSource::new(path).map_err(DecodeError::io)?;
    with_source(source, job)
}

fn with_source<T>(
    source: RawSource,
    job: impl FnOnce(
        &Box<dyn rawler::decoders::Decoder>,
        &RawSource,
        &RawDecodeParams,
    ) -> Result<T, DecodeError>,
) -> Result<T, DecodeError> {
    let decoder = rawler::get_decoder(&source).map_err(map_error)?;
    job(&decoder, &source, &RawDecodeParams::default())
}

fn best_preview(
    decoder: &dyn rawler::decoders::Decoder,
    source: &RawSource,
    params: &RawDecodeParams,
) -> Result<DynamicImage, DecodeError> {
    let preview = largest_embedded(decoder, source, params)?;
    if preview.dimensions().0.max(preview.dimensions().1) < PREVIEW_MIN_EDGE {
        return Err(DecodeError::new(
            FailureKind::NeedsDevelop,
            "RAW embedded preview is smaller than 512",
        ));
    }
    Ok(preview)
}

fn largest_embedded(
    decoder: &dyn rawler::decoders::Decoder,
    source: &RawSource,
    params: &RawDecodeParams,
) -> Result<DynamicImage, DecodeError> {
    let mut candidates = Vec::new();
    if let Some(image) = decoder.preview_image(source, params).map_err(map_error)? {
        candidates.push(image);
    }
    if let Some(image) = decoder.thumbnail_image(source, params).map_err(map_error)? {
        candidates.push(image);
    }
    candidates.sort_by_key(|image| image.dimensions().0.max(image.dimensions().1));
    candidates
        .pop()
        .ok_or_else(|| DecodeError::new(FailureKind::NeedsDevelop, "RAW has no embedded preview"))
}

fn preview_orientation(
    decoder: &dyn rawler::decoders::Decoder,
    source: &RawSource,
    params: &RawDecodeParams,
    preview: &DynamicImage,
) -> Result<u8, DecodeError> {
    let meta = decoder.raw_metadata(source, params).map_err(map_error)?;
    let orientation = meta
        .exif
        .orientation
        .filter(|value| (1..=8).contains(value))
        .unwrap_or(1) as u8;
    if orientation <= 1 {
        return Ok(1);
    }
    let dummy = decoder.raw_image(source, params, true).map_err(map_error)?;
    let (display_w, display_h) =
        crate::metadata::oriented_size(dummy.width as u32, dummy.height as u32, orientation);
    let (pw, ph) = preview.dimensions();
    let preview_landscape = pw >= ph;
    let display_landscape = display_w >= display_h;
    if preview_landscape == display_landscape {
        Ok(1)
    } else {
        Ok(orientation)
    }
}

fn map_error(err: rawler::RawlerError) -> DecodeError {
    DecodeError::new(FailureKind::Corrupted, err.to_string())
}

#[cfg(test)]
mod tests {
    use super::embedded_covers_edge;

    #[test]
    fn embedded_preview_is_enough_until_the_view_asks_for_more() {
        assert!(embedded_covers_edge(1620, 1080));
        assert!(embedded_covers_edge(5616, 4096));
        assert!(!embedded_covers_edge(1024, 1800));
        assert!(!embedded_covers_edge(0, 256));
    }
}
