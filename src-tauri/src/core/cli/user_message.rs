//! The user-message wire shape, shared by the two paths that build one.
//!
//! A user message is either a plain string or an OpenAI content-part array
//! (text first, then `image_url` parts) -- the shape the desktop web-app sends,
//! which `upstream.rs` passes through verbatim. Two callers build one: the TUI,
//! which stages images a human attached, and the headless channel, which
//! forwards parts a client sent. The TUI's builder lives here so the channel
//! does not write the conversion a second time; the channel passes a client's
//! own parts through untouched and only *validates* them, using the MIME
//! allowlist and the `data:` URL reader below.

/// An image staged for the next user message: the basename shown in the
/// transcript, and the `data:<mime>;base64,...` URL that goes on the wire.
pub(crate) struct PendingImage {
    pub(crate) name: String,
    pub(crate) data_url: String,
}

/// Largest image a human may stage from a path or the clipboard, before base64
/// (which inflates it by 4/3). The headless channel caps its own input
/// separately and lower: a client is not a person attaching a screenshot.
pub(crate) const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

/// The image types a message may carry. One list, two readers: [`image_mime_of`]
/// maps a file extension onto it, and the headless channel validates a client's
/// stated MIME against it -- a client that names its own type gets no silent
/// fallback, because relabelling into a format the model was never sent is
/// worse than rejecting the line.
pub(crate) const IMAGE_MIME_TYPES: [&str; 4] =
    ["image/png", "image/jpeg", "image/gif", "image/webp"];

/// Infer an image MIME type from a file extension. `None` when the extension is
/// not a known image type.
pub(crate) fn image_mime_of(path: &str) -> Option<&'static str> {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    }
}

/// Infer an image MIME type from a file extension, defaulting to PNG.
pub(crate) fn image_mime(path: &str) -> &'static str {
    image_mime_of(path).unwrap_or("image/png")
}

/// Build the OpenAI-shaped user message: a plain string with no images, else a
/// content-part array (text first, then `image_url` parts).
pub(crate) fn build_user_message(text: &str, images: &[PendingImage]) -> serde_json::Value {
    if images.is_empty() {
        return serde_json::json!({ "role": "user", "content": text });
    }
    let mut parts = Vec::with_capacity(images.len() + 1);
    if !text.is_empty() {
        parts.push(serde_json::json!({ "type": "text", "text": text }));
    }
    for img in images {
        parts.push(serde_json::json!({
            "type": "image_url",
            "image_url": { "url": img.data_url, "detail": "auto" }
        }));
    }
    serde_json::json!({ "role": "user", "content": parts })
}

/// The text a user message carries, for the transcript and for reporting a
/// follow-up a run ended before reading. Handles both forms: the plain string,
/// and the `text` parts of a content-part array. An image part contributes no
/// text, so a message that is only an image reads as empty.
pub(crate) fn text_of_content(content: &serde_json::Value) -> String {
    match content {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(parts) => parts
            .iter()
            .filter(|p| p.get("type").and_then(|v| v.as_str()) == Some("text"))
            .filter_map(|p| p.get("text").and_then(|v| v.as_str()))
            .collect(),
        _ => String::new(),
    }
}

/// Split an `image_url` part's URL into its MIME type and base64 payload, and
/// report the decoded size -- measured arithmetically, so a 5 MB image is not
/// decoded into a second 5 MB buffer just to be measured.
///
/// Only the `data:` form is accepted: a path would work on one host only, and a
/// remote or containerised client could not send one at all.
pub(crate) fn data_url_mime_and_len(url: &str) -> Result<(&str, usize), String> {
    let rest = url
        .strip_prefix("data:")
        .ok_or_else(|| "image url must be a data: URL".to_string())?;
    let (meta, payload) = rest
        .split_once(',')
        .ok_or_else(|| "data: URL has no payload".to_string())?;
    let mime = meta
        .strip_suffix(";base64")
        .ok_or_else(|| "data: URL must be base64-encoded".to_string())?;
    if !IMAGE_MIME_TYPES.contains(&mime.to_ascii_lowercase().as_str()) {
        return Err(format!(
            "unsupported image type '{mime}' ({})",
            IMAGE_MIME_TYPES.join(", ")
        ));
    }
    Ok((mime, base64_decoded_len(payload)?))
}

/// Decoded size of a base64 payload without decoding it. `4/3` of the payload is
/// the real size, which is what the caps are measured against: the line cap is a
/// weak proxy for it, since base64 inflates whatever it encodes.
pub(crate) fn base64_decoded_len(payload: &str) -> Result<usize, String> {
    if payload.len() % 4 != 0 {
        return Err("base64 payload length is not a multiple of 4".to_string());
    }
    let padding = payload.bytes().rev().take_while(|b| *b == b'=').count();
    if padding > 2 {
        return Err("base64 payload has too much padding".to_string());
    }
    if !payload
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=')
    {
        return Err("base64 payload has a character outside the alphabet".to_string());
    }
    Ok(payload.len() / 4 * 3 - padding)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image(name: &str, url: &str) -> PendingImage {
        PendingImage {
            name: name.to_string(),
            data_url: url.to_string(),
        }
    }

    #[test]
    fn a_message_without_images_stays_a_plain_string() {
        assert_eq!(
            build_user_message("hello", &[]),
            serde_json::json!({ "role": "user", "content": "hello" })
        );
    }

    #[test]
    fn a_message_with_images_is_text_first_then_image_parts() {
        let message = build_user_message("what is this?", &[image("a.png", "data:image/png;base64,AA")]);
        assert_eq!(
            message,
            serde_json::json!({
                "role": "user",
                "content": [
                    { "type": "text", "text": "what is this?" },
                    { "type": "image_url", "image_url": { "url": "data:image/png;base64,AA", "detail": "auto" } }
                ]
            })
        );
    }

    #[test]
    fn empty_text_is_omitted_when_an_image_carries_the_message() {
        let message = build_user_message("", &[image("a.png", "data:image/png;base64,AA")]);
        let parts = message["content"].as_array().expect("parts");
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0]["type"], "image_url");
    }

    #[test]
    fn text_of_content_reads_both_forms() {
        assert_eq!(text_of_content(&serde_json::json!("plain")), "plain");
        assert_eq!(
            text_of_content(&serde_json::json!([
                { "type": "text", "text": "look " },
                { "type": "image_url", "image_url": { "url": "data:image/png;base64,AA" } },
                { "type": "text", "text": "here" }
            ])),
            "look here"
        );
    }

    #[test]
    fn a_data_url_yields_its_mime_and_decoded_length() {
        // "QUJD" is "ABC": 3 bytes.
        assert_eq!(
            data_url_mime_and_len("data:image/png;base64,QUJD").unwrap(),
            ("image/png", 3)
        );
        // "QQ==" is "A": 1 byte, two padding bytes.
        assert_eq!(
            data_url_mime_and_len("data:image/jpeg;base64,QQ==").unwrap(),
            ("image/jpeg", 1)
        );
    }

    #[test]
    fn only_the_four_declared_mime_types_are_accepted() {
        for refused in [
            "data:image/svg+xml;base64,QUJD",
            "data:text/plain;base64,QUJD",
            "data:application/pdf;base64,QUJD",
        ] {
            let err = data_url_mime_and_len(refused).expect_err(refused);
            assert!(err.contains("unsupported image type"), "{refused}: {err}");
        }
    }

    #[test]
    fn paths_and_malformed_data_urls_are_refused() {
        for (url, marker) in [
            ("/tmp/shot.png", "must be a data: URL"),
            ("data:image/png;base64", "has no payload"),
            ("data:image/png,QUJD", "must be base64-encoded"),
            ("data:image/png;base64,QQQ", "not a multiple of 4"),
            ("data:image/png;base64,Q!==", "outside the alphabet"),
            ("data:image/png;base64,A===", "too much padding"),
        ] {
            let err = data_url_mime_and_len(url).expect_err(url);
            assert!(err.contains(marker), "{url}: {err} lacks {marker}");
        }
    }
}
