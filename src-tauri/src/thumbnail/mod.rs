mod avif;
mod budget;
mod color;
mod common;
mod heif;
mod jpeg;
mod preview;
mod raw;
mod video;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::{DynamicImage, ImageEncoder, RgbImage};

use crate::formats::{self, Backend, Format};

const FLATTEN_BACKGROUND: [u8; 3] = [0x1b, 0x1f, 0x25];

pub const VIEWER_MAX_EDGE: u32 = 8192;

pub use budget::{bitmap_estimate, peak_estimate_bytes, Hold as HeavyHold};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureKind {
    Unsupported,
    Corrupted,
    Failed,
    Io,
    NeedsDevelop,
}

impl FailureKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unsupported => "unsupported",
            Self::Corrupted => "corrupted",
            Self::Failed => "failed",
            Self::Io => "io",
            Self::NeedsDevelop => "needs-develop",
        }
    }
}

#[derive(Debug, Clone)]
pub struct DecodeError {
    pub kind: FailureKind,
    pub message: String,
}

impl DecodeError {
    pub fn new(kind: FailureKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn io(err: std::io::Error) -> Self {
        let kind = if err.kind() == std::io::ErrorKind::UnexpectedEof {
            FailureKind::Corrupted
        } else {
            FailureKind::Io
        };
        Self::new(kind, err.to_string())
    }
}

impl From<image::ImageError> for DecodeError {
    fn from(err: image::ImageError) -> Self {
        let kind = match &err {
            image::ImageError::Unsupported(_) => FailureKind::Unsupported,
            image::ImageError::Decoding(_) | image::ImageError::Parameter(_) => {
                FailureKind::Corrupted
            }
            image::ImageError::IoError(io) if io.kind() == std::io::ErrorKind::UnexpectedEof => {
                FailureKind::Corrupted
            }
            image::ImageError::IoError(_) => FailureKind::Io,
            _ => FailureKind::Failed,
        };
        Self::new(kind, err.to_string())
    }
}

pub struct Source {
    pub image: DynamicImage,
    pub orientation: u8,
    pub icc: Option<Vec<u8>>,
}

/// EXIF thumbnail JPEGs often omit the orientation tag. Use the parent tag when the
/// thumb is still in sensor orientation. Skip it when a 90° tag would turn an
/// already-upright thumb sideways.
pub fn embedded_orientation(
    thumb_orientation: u8,
    thumb_width: u32,
    thumb_height: u32,
    parent_orientation: u8,
    display_width: u32,
    display_height: u32,
) -> u8 {
    if thumb_orientation > 1 || parent_orientation <= 1 {
        return thumb_orientation.max(1);
    }
    let swaps = matches!(parent_orientation, 5 | 6 | 7 | 8);
    if swaps && (thumb_width >= thumb_height) == (display_width >= display_height) {
        return 1;
    }
    parent_orientation
}

/// After baking, preview pixels should match the parent file display aspect.
pub fn embedded_preview_trusted(
    thumb_width: u32,
    thumb_height: u32,
    bake_orientation: u8,
    header_width: u32,
    header_height: u32,
    header_orientation: u8,
) -> bool {
    if header_width == 0 || header_height == 0 {
        return false;
    }
    let (display_w, display_h) =
        crate::metadata::oriented_size(header_width, header_height, header_orientation);
    let (baked_w, baked_h) =
        crate::metadata::oriented_size(thumb_width, thumb_height, bake_orientation);
    aspects_match(display_w, display_h, baked_w, baked_h)
}

fn aspects_match(w1: u32, h1: u32, w2: u32, h2: u32) -> bool {
    if w1 == 0 || h1 == 0 || w2 == 0 || h2 == 0 {
        return false;
    }
    let a = w1 as f64 / h1 as f64;
    let b = w2 as f64 / h2 as f64;
    let ratio = a / b;
    ratio > 0.9 && ratio < 1.11
}

pub struct Rendered {
    pub tiers: Vec<(u32, Vec<u8>)>,
    pub width: u32,
    pub height: u32,
    pub orientation: u8,
}

pub fn thumb_path(source: &str, size: u64, modified_at: i64, tier: u32) -> PathBuf {
    let name = format!(
        "{:016x}-{tier}.jpg",
        identity_hash(source, size, modified_at)
    );
    crate::database::app_dir()
        .join("cache")
        .join("thumbnails")
        .join(name)
}

pub fn heif_header(path: &Path) -> Result<crate::metadata::HeaderMeta, String> {
    heif::read_header(path)
}

pub fn avif_header(path: &Path) -> Result<crate::metadata::HeaderMeta, String> {
    avif::read_header(path)
}

pub fn raw_header(path: &Path) -> Result<crate::metadata::HeaderMeta, String> {
    raw::read_header(path)
}

pub fn develop_raw_path(path: &Path) -> Result<Source, DecodeError> {
    raw::develop_path(path)
}

pub fn raw_embedded(path: &Path) -> Result<Source, DecodeError> {
    raw::embedded_source(path)
}

pub fn heif_decode_viewer(bytes: &[u8]) -> Result<Source, DecodeError> {
    heif::decode_viewer(bytes)
}

pub use raw::embedded_covers_edge as raw_preview_covers;

pub fn embedded_jpeg(path: &Path) -> Option<Vec<u8>> {
    preview::embedded_jpeg(path)
}

pub fn embedded_covers(bytes: &[u8], tier: u32) -> bool {
    preview::embedded_covers(bytes, tier)
}

pub fn decode_jpeg_scaled(bytes: &[u8], target_long_edge: u32) -> Result<Source, DecodeError> {
    jpeg::decode_scaled(bytes, target_long_edge)
}

pub fn bitmap_for_tier(
    source: Source,
    max_tier: u32,
) -> Result<(u32, u32, u8, RgbImage), DecodeError> {
    let Source {
        mut image,
        orientation,
        icc,
    } = source;
    let (width, height) =
        crate::metadata::oriented_size(image.width(), image.height(), orientation);
    if image.width().max(image.height()) > max_tier {
        image = image.thumbnail(max_tier, max_tier);
    }
    let rgb = shrink(
        finish(std::mem::take(&mut image), orientation, icc.as_deref()),
        max_tier,
    );
    Ok((width, height, orientation, rgb))
}

pub fn encode_bitmap(rgb: &RgbImage, tier: u32) -> Result<Vec<u8>, DecodeError> {
    let scaled = shrink(rgb.clone(), tier);
    encode_jpeg(&scaled)
}

pub struct ViewerImage {
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub png: bool,
}

/// Scales to `long_edge` without going past [`VIEWER_MAX_EDGE`]. Alpha that is not fully opaque stays in a PNG.
pub fn encode_viewer(source: Source, long_edge: u32) -> Result<ViewerImage, DecodeError> {
    let Source {
        mut image,
        orientation,
        icc,
    } = source;
    if let Some(transform) = image::metadata::Orientation::from_exif(orientation) {
        image.apply_orientation(transform);
    }
    image = drop_opaque_alpha(image);
    let edge = long_edge.clamp(1, VIEWER_MAX_EDGE);
    if image.width().max(image.height()) > edge {
        image = image.thumbnail(edge, edge);
    }
    let (width, height) = (image.width(), image.height());
    if image.color().has_alpha() {
        let mut rgba = image.to_rgba8();
        if let Some(profile) = icc.as_deref() {
            let mut rgb = RgbImage::new(width, height);
            for (dst, src) in rgb.pixels_mut().zip(rgba.pixels()) {
                *dst = image::Rgb([src[0], src[1], src[2]]);
            }
            color::to_srgb(&mut rgb, profile);
            for (dst, src) in rgba.pixels_mut().zip(rgb.pixels()) {
                dst[0] = src[0];
                dst[1] = src[1];
                dst[2] = src[2];
            }
        }
        let mut bytes = Vec::new();
        PngEncoder::new(&mut bytes)
            .write_image(
                rgba.as_raw(),
                width,
                height,
                image::ExtendedColorType::Rgba8,
            )
            .map_err(|err| {
                DecodeError::new(FailureKind::Failed, format!("encode viewer png: {err}"))
            })?;
        return Ok(ViewerImage {
            bytes,
            width,
            height,
            png: true,
        });
    }
    let rgb = finish(image, 1, icc.as_deref());
    let bytes = encode_jpeg_quality(&rgb, 92)?;
    Ok(ViewerImage {
        bytes,
        width: rgb.width(),
        height: rgb.height(),
        png: false,
    })
}

fn drop_opaque_alpha(image: DynamicImage) -> DynamicImage {
    let DynamicImage::ImageRgba8(rgba) = image else {
        return image;
    };
    if rgba.pixels().any(|pixel| pixel[3] != 255) {
        return DynamicImage::ImageRgba8(rgba);
    }
    DynamicImage::ImageRgb8(DynamicImage::ImageRgba8(rgba).into_rgb8())
}

pub fn decode_path(path: &Path, candidate: Option<Format>) -> Result<Source, DecodeError> {
    match candidate.map(Format::backend) {
        Some(Backend::Raw) => raw::decode_path(path),
        Some(Backend::Video) => video::decode_path(path),
        _ => {
            let bytes = std::fs::read(path).map_err(DecodeError::io)?;
            decode_owned(Arc::new(bytes), candidate)
        }
    }
}

pub fn decode(bytes: &[u8], candidate: Option<Format>) -> Result<Source, DecodeError> {
    decode_owned(Arc::new(bytes.to_vec()), candidate)
}

pub fn decode_owned(bytes: Arc<Vec<u8>>, candidate: Option<Format>) -> Result<Source, DecodeError> {
    let head = &bytes[..bytes.len().min(formats::SNIFF_LEN)];
    let sniffed = formats::sniff(head);
    let format = match (sniffed, candidate) {
        (Some(_), Some(Format::Raw)) => Some(Format::Raw),
        (Some(actual), _) => Some(actual),
        (None, candidate) => candidate,
    };
    match format.map(Format::backend) {
        Some(Backend::Common) => common::decode_hinted(&bytes, format),
        Some(Backend::Heif) => heif::decode(&bytes),
        Some(Backend::Avif) => avif::decode(&bytes),
        Some(Backend::Raw) => raw::decode(bytes),
        Some(Backend::Video) => Err(DecodeError::new(
            FailureKind::Unsupported,
            "video poster frames decode from the file path",
        )),
        None => Err(DecodeError::new(
            FailureKind::Unsupported,
            "unknown image signature",
        )),
    }
}

pub fn render(source: Source, tiers: &[u32]) -> Result<Rendered, DecodeError> {
    let mut encoded = Vec::with_capacity(tiers.len());
    let (width, height, orientation) = render_each(source, tiers, |tier, bytes, _, _, _| {
        encoded.push((tier, bytes));
    })?;
    Ok(Rendered {
        tiers: encoded,
        width,
        height,
        orientation,
    })
}

/// Encodes smaller tiers first and calls `on_tier` before starting the next one,
/// so a 256 px preview can be shown while 512/1024 are still encoding.
pub fn render_each(
    source: Source,
    tiers: &[u32],
    mut on_tier: impl FnMut(u32, Vec<u8>, u32, u32, u8),
) -> Result<(u32, u32, u8), DecodeError> {
    let Source {
        mut image,
        orientation,
        icc,
    } = source;
    let (width, height) =
        crate::metadata::oriented_size(image.width(), image.height(), orientation);
    if tiers.is_empty() {
        return Ok((width, height, orientation));
    }
    let mut ascending: Vec<u32> = tiers.to_vec();
    ascending.sort_unstable();
    ascending.dedup();
    let max_tier = *ascending.last().unwrap_or(&256);
    if image.width().max(image.height()) > max_tier {
        image = image.thumbnail(max_tier, max_tier);
    }
    let base = shrink(
        finish(std::mem::take(&mut image), orientation, icc.as_deref()),
        max_tier,
    );
    for tier in ascending {
        let rgb = if tier == max_tier {
            base.clone()
        } else {
            shrink(base.clone(), tier)
        };
        let bytes = encode_jpeg(&rgb)?;
        on_tier(tier, bytes, width, height, orientation);
    }
    Ok((width, height, orientation))
}

fn shrink(rgb: RgbImage, tier: u32) -> RgbImage {
    if rgb.width().max(rgb.height()) <= tier {
        return rgb;
    }
    DynamicImage::ImageRgb8(rgb)
        .thumbnail(tier, tier)
        .into_rgb8()
}

fn finish(mut image: DynamicImage, orientation: u8, icc: Option<&[u8]>) -> RgbImage {
    if let Some(transform) = image::metadata::Orientation::from_exif(orientation) {
        image.apply_orientation(transform);
    }
    let mut rgb = if image.color().has_alpha() {
        flatten(&image)
    } else {
        image.into_rgb8()
    };
    if let Some(icc) = icc {
        color::to_srgb(&mut rgb, icc);
    }
    rgb
}

fn flatten(image: &DynamicImage) -> RgbImage {
    let rgba = image.to_rgba8();
    let mut out = RgbImage::new(rgba.width(), rgba.height());
    for (dst, src) in out.pixels_mut().zip(rgba.pixels()) {
        let alpha = u32::from(src[3]);
        for channel in 0..3 {
            let fg = u32::from(src[channel]);
            let bg = u32::from(FLATTEN_BACKGROUND[channel]);
            dst[channel] = ((fg * alpha + bg * (255 - alpha) + 127) / 255) as u8;
        }
    }
    out
}

fn encode_jpeg(image: &RgbImage) -> Result<Vec<u8>, DecodeError> {
    encode_jpeg_quality(image, 80)
}

fn encode_jpeg_quality(image: &RgbImage, quality: u8) -> Result<Vec<u8>, DecodeError> {
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, quality)
        .encode_image(image)
        .map_err(|err| DecodeError::new(FailureKind::Failed, format!("encode thumbnail: {err}")))?;
    Ok(bytes)
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("create_dir {}: {err}", parent.display()))?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|err| format!("write {}: {err}", tmp.display()))?;
    if path.exists() {
        std::fs::remove_file(path).map_err(|err| format!("remove {}: {err}", path.display()))?;
    }
    std::fs::rename(&tmp, path).map_err(|err| format!("rename {}: {err}", path.display()))?;
    Ok(())
}

pub(crate) fn identity_hash(source: &str, size: u64, modified_at: i64) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in format!("{source}\0{size}\0{modified_at}").bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures;
    use image::ImageFormat;

    fn thumbs(bytes: &[u8], candidate: Option<Format>) -> Rendered {
        let source = decode(bytes, candidate).unwrap();
        render(source, &[256, 512]).unwrap()
    }

    fn decoded_tier(rendered: &Rendered, tier: u32) -> RgbImage {
        let (_, bytes) = rendered.tiers.iter().find(|(t, _)| *t == tier).unwrap();
        image::load_from_memory(bytes).unwrap().into_rgb8()
    }

    #[test]
    fn common_formats_produce_both_tiers_from_one_decode() {
        let image = fixtures::gradient(1200, 800);
        let cases = [
            (fixtures::jpeg(&image, None, None), Format::Jpeg),
            (fixtures::encoded(&image, ImageFormat::Png), Format::Png),
            (fixtures::encoded(&image, ImageFormat::WebP), Format::WebP),
            (fixtures::encoded(&image, ImageFormat::Gif), Format::Gif),
            (fixtures::encoded(&image, ImageFormat::Bmp), Format::Bmp),
            (fixtures::encoded(&image, ImageFormat::Tiff), Format::Tiff),
        ];
        for (bytes, format) in cases {
            let rendered = thumbs(&bytes, Some(format));
            assert_eq!((rendered.width, rendered.height), (1200, 800), "{format:?}");
            assert_eq!(rendered.tiers.len(), 2, "{format:?}");
            assert_eq!(
                decoded_tier(&rendered, 512).dimensions(),
                (512, 341),
                "{format:?}"
            );
            assert_eq!(
                decoded_tier(&rendered, 256).dimensions(),
                (256, 171),
                "{format:?}"
            );
        }
    }

    #[test]
    fn viewer_frame_follows_the_requested_edge_past_1024() {
        let image = fixtures::gradient(2400, 1600);
        let bytes = fixtures::encoded(&image, ImageFormat::Tiff);
        let source = decode(&bytes, Some(Format::Tiff)).unwrap();
        let frame = encode_viewer(source, 1800).unwrap();
        let long = frame.width.max(frame.height);
        assert!(long > 1024, "{long}");
        assert!(long <= 1800, "{long}");
        assert!(!frame.png);
    }

    #[test]
    fn viewer_frame_keeps_partial_transparency() {
        let mut rgba = image::RgbaImage::from_pixel(32, 32, image::Rgba([255, 0, 0, 255]));
        rgba.put_pixel(1, 1, image::Rgba([0, 255, 0, 0]));
        let source = Source {
            image: DynamicImage::ImageRgba8(rgba),
            orientation: 1,
            icc: None,
        };
        let frame = encode_viewer(source, 1024).unwrap();
        assert!(frame.png);
        let decoded = image::load_from_memory(&frame.bytes).unwrap().to_rgba8();
        assert_eq!(decoded.get_pixel(1, 1).0[3], 0);
    }

    #[test]
    fn added_common_formats_decode_to_a_thumbnail() {
        let image = fixtures::gradient(320, 200);
        let hdr = {
            let float = DynamicImage::ImageRgb8(image.clone()).into_rgb32f();
            let mut bytes = std::io::Cursor::new(Vec::new());
            DynamicImage::ImageRgb32F(float)
                .write_to(&mut bytes, ImageFormat::Hdr)
                .unwrap();
            bytes.into_inner()
        };
        let cases = [
            (fixtures::encoded(&image, ImageFormat::Tga), Format::Tga),
            (hdr, Format::Hdr),
            (fixtures::encoded(&image, ImageFormat::Pnm), Format::Pnm),
            (fixtures::encoded(&image, ImageFormat::Qoi), Format::Qoi),
        ];
        for (bytes, format) in cases {
            let rendered = thumbs(&bytes, Some(format));
            assert_eq!((rendered.width, rendered.height), (320, 200), "{format:?}");
            assert!(!rendered.tiers.is_empty(), "{format:?}");
        }
        let icon =
            image::RgbaImage::from_fn(64, 48, |x, y| image::Rgba([x as u8, y as u8, 128, 255]));
        let mut icon_bytes = std::io::Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(icon)
            .write_to(&mut icon_bytes, ImageFormat::Ico)
            .unwrap();
        let rendered = thumbs(&icon_bytes.into_inner(), Some(Format::Ico));
        assert_eq!((rendered.width, rendered.height), (64, 48));
    }

    #[test]
    fn oversized_dimension_is_an_error() {
        let mut png = fixtures::encoded(&fixtures::gradient(8, 8), ImageFormat::Png);
        // IHDR width/height sit at bytes 16..24 of a standard PNG.
        if png.len() > 24 && &png[12..16] == b"IHDR" {
            png[16..20].copy_from_slice(&20_000u32.to_be_bytes());
            png[20..24].copy_from_slice(&20_000u32.to_be_bytes());
        }
        let outcome = std::panic::catch_unwind(|| decode(&png, Some(Format::Png)));
        assert!(outcome.is_ok(), "decoder panicked");
        assert!(outcome.unwrap().is_err());
    }

    #[test]
    fn exif_orientation_is_baked_into_pixels_and_size() {
        let bytes = fixtures::jpeg(
            &fixtures::gradient(1200, 800),
            Some(fixtures::exif_orientation(6)),
            None,
        );
        let rendered = thumbs(&bytes, Some(Format::Jpeg));
        assert_eq!((rendered.width, rendered.height), (800, 1200));
        assert_eq!(decoded_tier(&rendered, 512).dimensions(), (341, 512));
    }

    #[test]
    fn embedded_thumb_uses_the_parent_orientation_unless_it_is_already_upright() {
        assert_eq!(embedded_orientation(1, 160, 120, 6, 3000, 4000), 6);
        assert_eq!(embedded_orientation(1, 120, 160, 6, 3000, 4000), 1);
        assert_eq!(embedded_orientation(1, 160, 120, 3, 4000, 3000), 3);
        assert_eq!(embedded_orientation(6, 160, 120, 6, 3000, 4000), 6);
    }

    #[test]
    fn embedded_preview_trust_requires_header_aspect_match() {
        assert!(embedded_preview_trusted(160, 120, 6, 4000, 3000, 6));
        assert!(!embedded_preview_trusted(160, 120, 1, 4000, 3000, 6));
        assert!(!embedded_preview_trusted(160, 120, 6, 0, 0, 1));
    }

    #[test]
    fn transparent_pixels_flatten_to_the_tile_color() {
        let rgba = image::RgbaImage::from_pixel(64, 64, image::Rgba([255, 0, 0, 0]));
        let rendered = thumbs(&fixtures::png_rgba(&rgba, None), Some(Format::Png));
        let pixel = decoded_tier(&rendered, 256).get_pixel(32, 32).0;
        for (got, want) in pixel.iter().zip(FLATTEN_BACKGROUND) {
            assert!(got.abs_diff(want) <= 3, "{pixel:?}");
        }
    }

    #[test]
    fn display_p3_profile_is_converted_to_srgb() {
        let rgba = image::RgbaImage::from_pixel(64, 64, image::Rgba([200, 100, 50, 255]));
        let tagged = thumbs(
            &fixtures::png_rgba(&rgba, Some(fixtures::display_p3_icc())),
            Some(Format::Png),
        );
        let untagged = thumbs(&fixtures::png_rgba(&rgba, None), Some(Format::Png));
        let p3 = decoded_tier(&tagged, 256).get_pixel(32, 32).0;
        let plain = decoded_tier(&untagged, 256).get_pixel(32, 32).0;
        assert!(
            p3[0] > plain[0] + 5 && p3[2] + 5 < plain[2],
            "P3 {p3:?} vs untagged {plain:?}"
        );
        assert!(color::is_identity(
            &moxcms::ColorProfile::new_srgb().encode().unwrap()
        ));
        assert!(!color::is_identity(&fixtures::display_p3_icc()));
    }

    #[test]
    fn wrong_extension_is_routed_by_signature() {
        let png = fixtures::encoded(&fixtures::gradient(300, 200), ImageFormat::Png);
        let rendered = thumbs(&png, Some(Format::Jpeg));
        assert_eq!((rendered.width, rendered.height), (300, 200));
    }

    #[test]
    fn broken_inputs_are_errors_not_panics() {
        let jpeg = fixtures::jpeg(&fixtures::gradient(800, 600), None, None);
        let truncated = &jpeg[..jpeg.len() / 3];
        let cases: [(&[u8], Option<Format>); 4] = [
            (&[], Some(Format::Jpeg)),
            (truncated, Some(Format::Jpeg)),
            (b"definitely not an image", Some(Format::Png)),
            (&jpeg[..20], Some(Format::Jpeg)),
        ];
        for (bytes, candidate) in cases {
            let outcome = decode(bytes, candidate).and_then(|source| render(source, &[256, 512]));
            if let Err(err) = &outcome {
                assert_ne!(err.kind, FailureKind::Io, "{}", err.message);
            }
        }
        assert_eq!(
            decode(&[], None).err().map(|err| err.kind),
            Some(FailureKind::Unsupported)
        );
    }

    fn local_images(subdir: &str, extension: &str) -> Vec<std::path::PathBuf> {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("fixtures-local")
            .join(subdir);
        let Ok(entries) = std::fs::read_dir(dir) else {
            return Vec::new();
        };
        let mut files: Vec<_> = entries
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| {
                path.extension()
                    .and_then(|ext| ext.to_str())
                    .is_some_and(|ext| ext.eq_ignore_ascii_case(extension))
            })
            .collect();
        files.sort();
        files
    }

    fn local_heic() -> Vec<std::path::PathBuf> {
        local_images("heic", "heic")
    }

    #[test]
    fn heic_samples_decode_when_corpus_present() {
        let files = local_heic();
        if files.is_empty() {
            return;
        }
        let mut decoded = 0;
        for path in files {
            let bytes = std::fs::read(&path).unwrap();
            if formats::sniff(&bytes).unwrap_or(Format::Heic) == Format::Avif {
                continue;
            }
            let meta = heif::read_header(&path).unwrap();
            let rendered = thumbs(&bytes, Some(Format::Heic));
            assert_eq!(rendered.width, meta.width, "{}", path.display());
            assert_eq!(rendered.height, meta.height, "{}", path.display());
            assert_eq!(rendered.orientation, 1);
            decoded += 1;
        }
        assert!(decoded >= 1, "expected at least one HEVC HEIC sample");
    }

    #[test]
    fn truncated_heic_is_isolated() {
        let Some(path) = local_heic().into_iter().next() else {
            return;
        };
        let bytes = std::fs::read(path).unwrap();
        let cut = bytes.len() / 4;
        assert!(decode(&bytes[..cut], Some(Format::Heic)).is_err());
    }

    #[test]
    fn avif_samples_decode_when_corpus_present() {
        let files = local_images("avif", "avif");
        if files.is_empty() {
            return;
        }
        let mut decoded = 0;
        for path in files {
            let bytes = std::fs::read(&path).unwrap();
            let meta = avif::read_header(&path).unwrap();
            let rendered = thumbs(&bytes, Some(Format::Avif));
            assert_eq!(rendered.width, meta.width, "{}", path.display());
            assert_eq!(rendered.height, meta.height, "{}", path.display());
            decoded += 1;
        }
        assert!(decoded >= 1, "expected at least one AVIF sample");
    }

    #[test]
    fn truncated_avif_is_isolated() {
        match decode(b"definitely not avif", Some(Format::Avif)) {
            Ok(_) => panic!("expected an error"),
            Err(err) => assert_ne!(err.kind, FailureKind::Io),
        }
    }
}
