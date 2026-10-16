use std::sync::{Arc, Mutex};

use image::RgbImage;
use moxcms::{ColorProfile, DataColorSpace, Layout, Transform8BitExecutor, TransformOptions, Xyzd};

const CACHE_LIMIT: usize = 16;

type Cached = Option<Arc<Transform8BitExecutor>>;

static TRANSFORMS: Mutex<Vec<(u64, Cached)>> = Mutex::new(Vec::new());

pub fn to_srgb(image: &mut RgbImage, icc: &[u8]) {
    let Some(transform) = transform_for(icc) else {
        return;
    };
    let source = image.as_raw().clone();
    let _ = transform.transform(&source, image);
}

fn transform_for(icc: &[u8]) -> Cached {
    let key = fnv(icc);
    {
        let cache = TRANSFORMS.lock().unwrap_or_else(|err| err.into_inner());
        if let Some((_, cached)) = cache.iter().find(|(hash, _)| *hash == key) {
            return cached.clone();
        }
    }
    let built = build(icc);
    let mut cache = TRANSFORMS.lock().unwrap_or_else(|err| err.into_inner());
    if cache.len() >= CACHE_LIMIT {
        cache.remove(0);
    }
    cache.push((key, built.clone()));
    built
}

fn build(icc: &[u8]) -> Cached {
    let profile = ColorProfile::new_from_slice(icc).ok()?;
    if profile.color_space != DataColorSpace::Rgb {
        return None;
    }
    let srgb = ColorProfile::new_srgb();
    if profile.is_matrix_shaper() && same_primaries(&profile, &srgb) {
        return None;
    }
    profile
        .create_transform_8bit(Layout::Rgb, &srgb, Layout::Rgb, TransformOptions::default())
        .ok()
}

#[cfg(test)]
pub fn is_identity(icc: &[u8]) -> bool {
    build(icc).is_none()
}

fn same_primaries(left: &ColorProfile, right: &ColorProfile) -> bool {
    let close = |a: Xyzd, b: Xyzd| {
        (a.x - b.x).abs() < 2e-3 && (a.y - b.y).abs() < 2e-3 && (a.z - b.z).abs() < 2e-3
    };
    close(left.red_colorant, right.red_colorant)
        && close(left.green_colorant, right.green_colorant)
        && close(left.blue_colorant, right.blue_colorant)
}

fn fnv(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

/// PQ (SMPTE ST 2084) and HLG codes are not display sRGB.
/// WebView2 has no HDR surface here, so these become a display-referred sRGB image.
pub fn map_hdr_rgb(image: &mut RgbImage, transfer: u8, bt2020: bool) {
    if !is_hdr_transfer(transfer) {
        return;
    }
    for pixel in image.pixels_mut() {
        let mapped = map_hdr_pixel(pixel.0[0], pixel.0[1], pixel.0[2], transfer, bt2020);
        pixel.0 = mapped;
    }
}

pub fn map_hdr_rgba(image: &mut image::RgbaImage, transfer: u8, bt2020: bool) {
    if !is_hdr_transfer(transfer) {
        return;
    }
    for pixel in image.pixels_mut() {
        let mapped = map_hdr_pixel(pixel.0[0], pixel.0[1], pixel.0[2], transfer, bt2020);
        pixel.0[0] = mapped[0];
        pixel.0[1] = mapped[1];
        pixel.0[2] = mapped[2];
    }
}

pub fn is_hdr_transfer(transfer: u8) -> bool {
    transfer == 16 || transfer == 18
}

fn map_hdr_pixel(r: u8, g: u8, b: u8, transfer: u8, bt2020: bool) -> [u8; 3] {
    let (lr, lg, lb) = if transfer == 16 {
        (pq_nits(r), pq_nits(g), pq_nits(b))
    } else {
        (hlg_scene(r), hlg_scene(g), hlg_scene(b))
    };
    let (lr, lg, lb) = if bt2020 {
        bt2020_to_709(lr, lg, lb)
    } else {
        (lr, lg, lb)
    };
    [
        display_channel(lr),
        display_channel(lg),
        display_channel(lb),
    ]
}

fn pq_nits(code: u8) -> f32 {
    let n = f32::from(code) / 255.0;
    let m1 = 0.1593017578125_f32;
    let m2 = 78.84375_f32;
    let c1 = 0.8359375_f32;
    let c2 = 18.8515625_f32;
    let c3 = 18.6875_f32;
    let np = n.powf(1.0 / m2);
    let num = (np - c1).max(0.0);
    let den = (c2 - c3 * np).max(1.0e-6);
    (num / den).powf(1.0 / m1) * 10_000.0
}

fn hlg_scene(code: u8) -> f32 {
    let e = f32::from(code) / 255.0;
    let a = 0.17883277_f32;
    let b = 0.28466892_f32;
    let c = 0.55991073_f32;
    let scene = if e <= 0.5 {
        (e * e) / 3.0
    } else {
        ((e - c) / a).exp() + b
    };
    scene * 100.0
}

fn bt2020_to_709(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let rl = 1.6605 * r - 0.5876 * g - 0.0728 * b;
    let gl = -0.1246 * r + 1.1329 * g - 0.0083 * b;
    let bl = -0.0182 * r - 0.1006 * g + 1.1187 * b;
    (rl.max(0.0), gl.max(0.0), bl.max(0.0))
}

fn display_channel(nits: f32) -> u8 {
    let x = nits / 203.0;
    let compressed = x / (1.0 + x);
    let gamma = compressed.clamp(0.0, 1.0).powf(1.0 / 2.2);
    (gamma * 255.0).round().clamp(0.0, 255.0) as u8
}

#[cfg(test)]
mod hdr_tests {
    use super::map_hdr_pixel;

    #[test]
    fn pq_black_stays_black_and_highlights_are_not_the_code_value() {
        assert_eq!(map_hdr_pixel(0, 0, 0, 16, false), [0, 0, 0]);
        let mid = map_hdr_pixel(140, 140, 140, 16, false);
        assert!(mid[0] > 80, "{mid:?}");
        let white = map_hdr_pixel(255, 255, 255, 16, false);
        assert!(white[0] > 230, "{white:?}");
    }

    #[test]
    fn srgb_transfer_is_not_treated_as_hdr() {
        assert!(!super::is_hdr_transfer(1));
        assert!(!super::is_hdr_transfer(13));
        assert!(super::is_hdr_transfer(16));
        assert!(super::is_hdr_transfer(18));
    }
}
