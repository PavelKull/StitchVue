use std::fs::File;
use std::io::Read;
use std::path::Path;

const HEADER_CAP: usize = 512 * 1024;

/// JPEG embedded in the EXIF thumbnail IFD, if it sits in the file header.
/// The main entropy scan is not read.
/// Long edge of a JPEG in memory, from the first SOF marker. No pixel decode.
pub fn jpeg_long_edge(buf: &[u8]) -> Option<u32> {
    if buf.len() < 4 || buf[0] != 0xFF || buf[1] != 0xD8 {
        return None;
    }
    let mut index = 2usize;
    while index + 9 <= buf.len() {
        if buf[index] != 0xFF {
            index += 1;
            continue;
        }
        let marker = buf[index + 1];
        if marker == 0xDA || marker == 0xD9 {
            break;
        }
        if marker == 0x00 || marker == 0xFF {
            index += 1;
            continue;
        }
        let len = u16::from_be_bytes([buf[index + 2], buf[index + 3]]) as usize;
        if len < 2 || index + 2 + len > buf.len() {
            break;
        }
        if is_sof(marker) && len >= 7 {
            let height = u16::from_be_bytes([buf[index + 5], buf[index + 6]]) as u32;
            let width = u16::from_be_bytes([buf[index + 7], buf[index + 8]]) as u32;
            if width == 0 || height == 0 {
                return None;
            }
            return Some(width.max(height));
        }
        index += 2 + len;
    }
    None
}

fn is_sof(marker: u8) -> bool {
    matches!(
        marker,
        0xC0 | 0xC1 | 0xC2 | 0xC3 | 0xC5 | 0xC6 | 0xC7 | 0xC9 | 0xCA | 0xCB | 0xCD | 0xCE | 0xCF
    )
}

/// Embedded EXIF thumb is enough for a 256 px tile when its long edge is at least 120 px.
/// A larger tile needs an embedded image at least as long as the requested tier.
pub fn embedded_covers(bytes: &[u8], tier: u32) -> bool {
    let Some(edge) = jpeg_long_edge(bytes) else {
        return false;
    };
    edge >= tier || (tier <= 256 && edge >= 120)
}

pub fn embedded_jpeg(path: &Path) -> Option<Vec<u8>> {
    let mut file = File::open(path).ok()?;
    let mut buf = vec![0u8; HEADER_CAP];
    let n = file.read(&mut buf).ok()?;
    embedded_jpeg_bytes(&buf[..n])
}

pub fn embedded_jpeg_bytes(buf: &[u8]) -> Option<Vec<u8>> {
    if buf.len() < 4 || buf[0] != 0xFF || buf[1] != 0xD8 {
        return None;
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
            let payload = &buf[index + 4..index + 2 + len];
            if let Some(rest) = payload.strip_prefix(b"Exif\0\0") {
                if let Some(thumb) = tiff_jpeg_thumb(rest) {
                    return Some(thumb);
                }
            }
        }
        index += 2 + len;
    }
    None
}

fn tiff_jpeg_thumb(exif: &[u8]) -> Option<Vec<u8>> {
    if exif.len() < 8 {
        return None;
    }
    let be = match &exif[0..2] {
        b"MM" => true,
        b"II" => false,
        _ => return None,
    };
    if read_u16(exif, 2, be)? != 42 {
        return None;
    }
    let ifd0 = read_u32(exif, 4, be)? as usize;
    let ifd1 = ifd_next(exif, ifd0, be)?;
    if ifd1 == 0 {
        return None;
    }
    let (offset, len) = jpeg_tags(exif, ifd1, be)?;
    let end = offset.checked_add(len)?;
    if end > exif.len() || len < 4 {
        return None;
    }
    let bytes = &exif[offset..end];
    if bytes[0] == 0xFF && bytes[1] == 0xD8 {
        Some(bytes.to_vec())
    } else {
        None
    }
}

fn jpeg_tags(exif: &[u8], ifd: usize, be: bool) -> Option<(usize, usize)> {
    let count = read_u16(exif, ifd, be)? as usize;
    let mut offset = None;
    let mut len = None;
    for entry in 0..count {
        let at = ifd + 2 + entry * 12;
        let tag = read_u16(exif, at, be)?;
        let value = read_u32(exif, at + 8, be)? as usize;
        if tag == 0x0201 {
            offset = Some(value);
        } else if tag == 0x0202 {
            len = Some(value);
        }
    }
    Some((offset?, len?))
}

fn ifd_next(exif: &[u8], ifd: usize, be: bool) -> Option<usize> {
    let count = read_u16(exif, ifd, be)? as usize;
    let next_at = ifd + 2 + count * 12;
    Some(read_u32(exif, next_at, be)? as usize)
}

fn read_u16(buf: &[u8], at: usize, be: bool) -> Option<u16> {
    let bytes = buf.get(at..at + 2)?;
    Some(if be {
        u16::from_be_bytes([bytes[0], bytes[1]])
    } else {
        u16::from_le_bytes([bytes[0], bytes[1]])
    })
}

fn read_u32(buf: &[u8], at: usize, be: bool) -> Option<u32> {
    let bytes = buf.get(at..at + 4)?;
    Some(if be {
        u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
    } else {
        u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]])
    })
}

#[cfg(test)]
mod tests {
    use super::embedded_jpeg_bytes;

    #[test]
    fn reads_the_exif_thumbnail_without_the_entropy_scan() {
        let thumb = [0xFF, 0xD8, 0xFF, 0xD9];
        let mut tiff = Vec::new();
        tiff.extend_from_slice(b"MM");
        tiff.extend_from_slice(&42u16.to_be_bytes());
        tiff.extend_from_slice(&8u32.to_be_bytes());
        tiff.extend_from_slice(&0u16.to_be_bytes());
        let ifd1 = 8 + 2 + 4;
        tiff.extend_from_slice(&(ifd1 as u32).to_be_bytes());
        tiff.extend_from_slice(&2u16.to_be_bytes());
        let jpeg_at = ifd1 + 2 + 2 * 12 + 4;
        tiff.extend_from_slice(&0x0201u16.to_be_bytes());
        tiff.extend_from_slice(&4u16.to_be_bytes());
        tiff.extend_from_slice(&1u32.to_be_bytes());
        tiff.extend_from_slice(&(jpeg_at as u32).to_be_bytes());
        tiff.extend_from_slice(&0x0202u16.to_be_bytes());
        tiff.extend_from_slice(&4u16.to_be_bytes());
        tiff.extend_from_slice(&1u32.to_be_bytes());
        tiff.extend_from_slice(&(thumb.len() as u32).to_be_bytes());
        tiff.extend_from_slice(&0u32.to_be_bytes());
        tiff.extend_from_slice(&thumb);
        let mut app1 = b"Exif\0\0".to_vec();
        app1.extend_from_slice(&tiff);
        let len = (app1.len() + 2) as u16;
        let mut jpeg = vec![0xFF, 0xD8, 0xFF, 0xE1];
        jpeg.extend_from_slice(&len.to_be_bytes());
        jpeg.extend_from_slice(&app1);
        jpeg.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x02, 0xFF, 0xD9]);
        assert_eq!(embedded_jpeg_bytes(&jpeg).as_deref(), Some(thumb.as_slice()));
    }
}
