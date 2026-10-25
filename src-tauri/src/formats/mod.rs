use std::io::Read;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Jpeg,
    Png,
    WebP,
    Gif,
    Bmp,
    Tiff,
    Ico,
    Tga,
    Hdr,
    Pnm,
    Qoi,
    Heic,
    Heif,
    Avif,
    Raw,
    Video,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    Common,
    Heif,
    Avif,
    Raw,
    /// Poster frame from the OS thumbnailer; the viewer plays the file itself.
    Video,
}

struct Spec {
    format: Format,
    extensions: &'static [&'static str],
    backend: Backend,
    webview_native: bool,
    /// Scanner lists the file. False means "known but not a gallery item yet".
    listed: bool,
}

const FORMATS: &[Spec] = &[
    Spec {
        format: Format::Jpeg,
        extensions: &["jpg", "jpeg", "jfif", "jpe"],
        backend: Backend::Common,
        webview_native: true,
        listed: true,
    },
    Spec {
        format: Format::Png,
        extensions: &["png"],
        backend: Backend::Common,
        webview_native: true,
        listed: true,
    },
    Spec {
        format: Format::WebP,
        extensions: &["webp"],
        backend: Backend::Common,
        webview_native: true,
        listed: true,
    },
    Spec {
        format: Format::Gif,
        extensions: &["gif"],
        backend: Backend::Common,
        webview_native: true,
        listed: true,
    },
    Spec {
        format: Format::Bmp,
        extensions: &["bmp", "dib"],
        backend: Backend::Common,
        webview_native: true,
        listed: true,
    },
    Spec {
        format: Format::Tiff,
        extensions: &["tif", "tiff"],
        backend: Backend::Common,
        webview_native: false,
        listed: true,
    },
    Spec {
        format: Format::Ico,
        extensions: &["ico"],
        backend: Backend::Common,
        webview_native: false,
        listed: true,
    },
    Spec {
        format: Format::Tga,
        extensions: &["tga"],
        backend: Backend::Common,
        webview_native: false,
        listed: true,
    },
    Spec {
        format: Format::Hdr,
        extensions: &["hdr"],
        backend: Backend::Common,
        webview_native: false,
        listed: true,
    },
    Spec {
        format: Format::Pnm,
        extensions: &["pnm", "pbm", "pgm", "ppm"],
        backend: Backend::Common,
        webview_native: false,
        listed: true,
    },
    Spec {
        format: Format::Qoi,
        extensions: &["qoi"],
        backend: Backend::Common,
        webview_native: false,
        listed: true,
    },
    Spec {
        format: Format::Heic,
        extensions: &["heic", "heics"],
        backend: Backend::Heif,
        webview_native: false,
        listed: true,
    },
    Spec {
        format: Format::Heif,
        extensions: &["heif", "heifs", "hif"],
        backend: Backend::Heif,
        webview_native: false,
        listed: true,
    },
    Spec {
        format: Format::Avif,
        extensions: &["avif", "avifs"],
        backend: Backend::Avif,
        webview_native: false,
        listed: true,
    },
    Spec {
        format: Format::Raw,
        extensions: &[
            "dng", "cr2", "cr3", "crw", "nef", "nrw", "arw", "sr2", "srf", "raf", "orf", "rw2",
            "pef", "srw", "3fr", "ari", "dcr", "erf", "kdc", "mef", "mos", "mrw", "iiq", "x3f",
        ],
        backend: Backend::Raw,
        webview_native: false,
        listed: true,
    },
    Spec {
        format: Format::Video,
        extensions: &["mov", "mp4", "m4v"],
        backend: Backend::Video,
        // Not "native": the viewer streams it in a <video>, never decodes it as an image.
        webview_native: false,
        // Poster frames come from Quick Look, which only exists on macOS.
        listed: cfg!(target_os = "macos"),
    },
];

impl Format {
    fn spec(self) -> &'static Spec {
        FORMATS
            .iter()
            .find(|spec| spec.format == self)
            .unwrap_or(&FORMATS[0])
    }

    pub fn backend(self) -> Backend {
        self.spec().backend
    }

    pub fn webview_native(self) -> bool {
        self.spec().webview_native
    }

    pub fn listed(self) -> bool {
        self.spec().listed
    }

    /// Decoded from the file path, never by reading the whole file into memory.
    pub fn decodes_from_path(self) -> bool {
        matches!(self.backend(), Backend::Raw | Backend::Video)
    }

    pub fn image_format(self) -> Option<image::ImageFormat> {
        match self {
            Self::Jpeg => Some(image::ImageFormat::Jpeg),
            Self::Png => Some(image::ImageFormat::Png),
            Self::WebP => Some(image::ImageFormat::WebP),
            Self::Gif => Some(image::ImageFormat::Gif),
            Self::Bmp => Some(image::ImageFormat::Bmp),
            Self::Tiff => Some(image::ImageFormat::Tiff),
            Self::Ico => Some(image::ImageFormat::Ico),
            Self::Tga => Some(image::ImageFormat::Tga),
            Self::Hdr => Some(image::ImageFormat::Hdr),
            Self::Pnm => Some(image::ImageFormat::Pnm),
            Self::Qoi => Some(image::ImageFormat::Qoi),
            Self::Heic | Self::Heif | Self::Avif | Self::Raw | Self::Video => None,
        }
    }
}

pub fn from_path(path: &Path) -> Option<Format> {
    let extension = path.extension()?.to_str()?;
    FORMATS
        .iter()
        .find(|spec| {
            spec.extensions
                .iter()
                .any(|candidate| extension.eq_ignore_ascii_case(candidate))
        })
        .map(|spec| spec.format)
}

pub fn listed_image(path: &Path) -> bool {
    from_path(path).is_some_and(Format::listed)
}

pub const SNIFF_LEN: usize = 32;

pub fn sniff(head: &[u8]) -> Option<Format> {
    if head.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some(Format::Jpeg);
    }
    if head.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some(Format::Png);
    }
    if head.starts_with(b"GIF87a") || head.starts_with(b"GIF89a") {
        return Some(Format::Gif);
    }
    if head.len() >= 12 && &head[0..4] == b"RIFF" && &head[8..12] == b"WEBP" {
        return Some(Format::WebP);
    }
    if head.starts_with(b"BM") {
        return Some(Format::Bmp);
    }
    if head.starts_with(b"II*\0") || head.starts_with(b"MM\0*") {
        return Some(Format::Tiff);
    }
    if head.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        return Some(Format::Ico);
    }
    if head.starts_with(b"qoif") {
        return Some(Format::Qoi);
    }
    if head.starts_with(b"#?RADIANCE") || head.starts_with(b"#?RGBE") {
        return Some(Format::Hdr);
    }
    if is_pnm(head) {
        return Some(Format::Pnm);
    }
    if head.len() >= 12 && &head[4..8] == b"ftyp" {
        return iso_brand(&head[8..12]);
    }
    if head.starts_with(b"FUJIFILM") {
        return Some(Format::Raw);
    }
    if head.starts_with(b"IIRO") || head.starts_with(b"MMOR") || head.starts_with(b"IIRS") {
        return Some(Format::Raw);
    }
    None
}

fn is_pnm(head: &[u8]) -> bool {
    matches!(
        head,
        [
            b'P',
            b'1' | b'2' | b'3' | b'4' | b'5' | b'6',
            b' ' | b'\n' | b'\r' | b'\t',
            ..
        ]
    )
}

fn iso_brand(brand: &[u8]) -> Option<Format> {
    match brand {
        b"heic" | b"heix" | b"hevc" | b"hevx" | b"heim" | b"heis" => Some(Format::Heic),
        b"mif1" | b"msf1" | b"heif" | b"heifs" => Some(Format::Heif),
        b"avif" | b"avis" | b"avio" => Some(Format::Avif),
        b"crx " => Some(Format::Raw),
        _ => None,
    }
}

pub fn sniff_file(path: &Path) -> Option<Format> {
    let mut head = [0u8; SNIFF_LEN];
    let mut file = std::fs::File::open(path).ok()?;
    let mut filled = 0;
    while filled < head.len() {
        match file.read(&mut head[filled..]) {
            Ok(0) => break,
            Ok(read) => filled += read,
            Err(_) => return None,
        }
    }
    sniff(&head[..filled])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_lookup_ignores_case_and_rejects_unknown() {
        assert_eq!(from_path(Path::new("a.JPG")), Some(Format::Jpeg));
        assert_eq!(from_path(Path::new("a.jfif")), Some(Format::Jpeg));
        assert_eq!(from_path(Path::new("a.Tiff")), Some(Format::Tiff));
        assert_eq!(from_path(Path::new("IMG_0001.HEIC")), Some(Format::Heic));
        assert_eq!(from_path(Path::new("shot.hif")), Some(Format::Heif));
        assert_eq!(from_path(Path::new("pic.avif")), Some(Format::Avif));
        assert!(Format::Avif.listed());
        assert!(Format::Heic.listed());
        assert_eq!(from_path(Path::new("DSC_0001.CR3")), Some(Format::Raw));
        assert_eq!(from_path(Path::new("img.dng")), Some(Format::Raw));
        assert_eq!(from_path(Path::new("icon.ICO")), Some(Format::Ico));
        assert_eq!(from_path(Path::new("scan.tga")), Some(Format::Tga));
        assert_eq!(from_path(Path::new("plate.hdr")), Some(Format::Hdr));
        assert_eq!(from_path(Path::new("frame.ppm")), Some(Format::Pnm));
        assert_eq!(from_path(Path::new("pixel.qoi")), Some(Format::Qoi));
        assert!(!Format::Ico.webview_native());
        assert!(!Format::Tiff.webview_native());
        assert!(Format::WebP.webview_native());
        assert_eq!(from_path(Path::new("IMG_0001.MOV")), Some(Format::Video));
        assert_eq!(from_path(Path::new("clip.mp4")), Some(Format::Video));
        assert!(!Format::Video.webview_native());
        assert!(Format::Video.decodes_from_path());
        assert_eq!(Format::Video.listed(), cfg!(target_os = "macos"));
        assert_eq!(from_path(Path::new("notes.txt")), None);
        assert_eq!(from_path(Path::new("no_extension")), None);
    }

    #[test]
    fn sniff_recognizes_common_signatures() {
        assert_eq!(sniff(&[0xFF, 0xD8, 0xFF, 0xE0]), Some(Format::Jpeg));
        assert_eq!(sniff(b"\x89PNG\r\n\x1a\n...."), Some(Format::Png));
        assert_eq!(sniff(b"RIFF\0\0\0\0WEBPVP8 "), Some(Format::WebP));
        assert_eq!(sniff(b"GIF89a"), Some(Format::Gif));
        assert_eq!(sniff(b"II*\0\x08\0\0\0"), Some(Format::Tiff));
        let mut heic = [0u8; 12];
        heic[4..12].copy_from_slice(b"ftypheic");
        assert_eq!(sniff(&heic), Some(Format::Heic));
        let mut avif = [0u8; 12];
        avif[4..12].copy_from_slice(b"ftypavif");
        assert_eq!(sniff(&avif), Some(Format::Avif));
        let mut cr3 = [0u8; 12];
        cr3[4..12].copy_from_slice(b"ftypcrx ");
        assert_eq!(sniff(&cr3), Some(Format::Raw));
        assert_eq!(sniff(b"FUJIFILMCCD-RAW "), Some(Format::Raw));
        assert_eq!(
            sniff(&[0x00, 0x00, 0x01, 0x00, 0x01, 0x00]),
            Some(Format::Ico)
        );
        assert_eq!(sniff(b"qoif........"), Some(Format::Qoi));
        assert_eq!(sniff(b"#?RADIANCE\n"), Some(Format::Hdr));
        assert_eq!(sniff(b"P6\n4 4\n255\n"), Some(Format::Pnm));
        assert_eq!(sniff(b"DDS \0\0\0\0"), None);
        assert_eq!(sniff(b""), None);
        assert_eq!(sniff(b"hello world"), None);
    }
}
