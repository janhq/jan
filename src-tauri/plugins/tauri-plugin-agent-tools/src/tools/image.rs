//! Image detection for the `read` tool: a file whose bytes are a recognized
//! raster image is returned as an OpenAI `image_url` content part instead of a
//! text read. Detection goes by the file signature alone, so a misnamed image
//! still renders while a text or corrupt file named `.png` is never sent to the
//! model as a broken data URL.

/// The MIME type inferred for a byte prefix, or `None` when the bytes do not
/// match a supported image signature. Mirrors the TUI's accepted set
/// (`image_mime_of`): png, jpeg, gif, webp.
pub fn mime_from_signature(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if bytes.starts_with(b"\xff\xd8\xff") {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    // WebP: "RIFF" + 4 bytes size + "WEBP".
    if bytes.starts_with(b"RIFF") && bytes.len() >= 12 && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_recognizes_each_supported_format() {
        assert_eq!(mime_from_signature(b"\x89PNG\r\n\x1a\nrest"), Some("image/png"));
        assert_eq!(mime_from_signature(b"\xff\xd8\xffrest"), Some("image/jpeg"));
        assert_eq!(mime_from_signature(b"GIF89a rest"), Some("image/gif"));
        assert_eq!(mime_from_signature(b"GIF87a rest"), Some("image/gif"));
        assert_eq!(
            mime_from_signature(b"RIFF\x00\x00\x00\x00WEBPrest"),
            Some("image/webp")
        );
        assert_eq!(mime_from_signature(b"plain text"), None);
    }

    #[test]
    fn webp_requires_the_webp_fourcc() {
        assert_eq!(mime_from_signature(b"RIFF\x00\x00\x00\x00WAVErest"), None);
        assert_eq!(mime_from_signature(b"RIFF"), None);
    }
}
