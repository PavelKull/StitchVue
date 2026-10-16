use std::io::Cursor;
use std::path::PathBuf;

use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::PngEncoder;
use image::{DynamicImage, ImageEncoder, ImageFormat, RgbImage, RgbaImage};

pub fn gradient(width: u32, height: u32) -> RgbImage {
    RgbImage::from_fn(width, height, |x, y| {
        image::Rgb([(x * 255 / width) as u8, (y * 255 / height) as u8, 128])
    })
}

pub fn exif_orientation(value: u16) -> Vec<u8> {
    let mut tiff = vec![b'I', b'I', 42, 0, 8, 0, 0, 0, 1, 0];
    tiff.extend_from_slice(&0x0112u16.to_le_bytes());
    tiff.extend_from_slice(&3u16.to_le_bytes());
    tiff.extend_from_slice(&1u32.to_le_bytes());
    tiff.extend_from_slice(&value.to_le_bytes());
    tiff.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
    tiff
}

pub fn jpeg(image: &RgbImage, exif: Option<Vec<u8>>, icc: Option<Vec<u8>>) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut bytes, 90);
    if let Some(exif) = exif {
        encoder.set_exif_metadata(exif).unwrap();
    }
    if let Some(icc) = icc {
        encoder.set_icc_profile(icc).unwrap();
    }
    encoder.encode_image(image).unwrap();
    bytes
}

pub fn png_rgba(image: &RgbaImage, icc: Option<Vec<u8>>) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut encoder = PngEncoder::new(&mut bytes);
    if let Some(icc) = icc {
        encoder.set_icc_profile(icc).unwrap();
    }
    encoder
        .write_image(image.as_raw(), image.width(), image.height(), image::ExtendedColorType::Rgba8)
        .unwrap();
    bytes
}

pub fn encoded(image: &RgbImage, format: ImageFormat) -> Vec<u8> {
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(image.clone())
        .write_to(&mut bytes, format)
        .unwrap();
    bytes.into_inner()
}

pub fn display_p3_icc() -> Vec<u8> {
    moxcms::ColorProfile::new_display_p3().encode().unwrap()
}

pub struct TempDir(pub PathBuf);

impl TempDir {
    pub fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "stitchvue-{label}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    pub fn write(&self, name: &str, bytes: &[u8]) -> PathBuf {
        let path = self.0.join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
