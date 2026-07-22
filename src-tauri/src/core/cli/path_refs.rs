//! Resolve `@path` file/directory references in user messages.
//!
//! When a user types `@path/to/file` in the TUI or headless task, the file or
//! directory is read and its content is injected into the message so the model
//! can see it directly.
//!
//! # Behaviour
//!
//! * Files are read as UTF-8 text (1 MB cap).
//! * Directories produce a listing of immediate children (20 KB cap).
//! * Images are noted inline as `(image: image/mime)` markers.
//! * Missing/unreadable items surface as inline error notices.
//! * `@http://` / `@https://` / `@file://` prefixed tokens are skipped.
//! * Once resolved, the `@path` tokens are removed from the text so the model
//!   sees the content directly via the injected block, not raw `@` tokens.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

/// Regex matching `@path` references.
/// The path stops at whitespace or common punctuation characters.
/// Regex matching `@path` references. Path stops at whitespace or common punctuation.
static REFERENCE_RE: LazyLock<regex::Regex> = LazyLock::new(|| {
    // Using a raw string with hash delimiters avoids escaping quotes and backticks.
    // The negated character class excludes tokens that would make bad paths.
    regex::Regex::new(r###"@([^\s,;:!?'"`\[\](){}<>)\)]+)"###).unwrap()
});

/// Maximum bytes we will read from a single file.
const MAX_FILE_BYTES: u64 = 1 * 1024 * 1024;

/// Maximum characters in a directory listing sent to the model.
const MAX_DIR_CHARS: usize = 20_000;

/// Image extensions.
const IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"];

// ── Public API ───────────────────────────────────────────────────────────────

/// Parse `@path` references from `text`.
///
/// Returns the raw path strings in order of appearance (deduplicated).
pub fn parse_references(text: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut refs = Vec::new();
    for cap in REFERENCE_RE.captures_iter(text) {
        let raw = cap[1].trim();
        if raw.is_empty()
            || raw.starts_with("http")
            || raw.starts_with("file://")
        {
            continue;
        }
        if seen.insert(raw.to_string()) {
            refs.push(raw.to_string());
        }
    }
    refs
}

/// Remove all `@path` references from `text` and normalise whitespace.
pub fn strip_references(text: &str) -> String {
    let cleaned = REFERENCE_RE.replace_all(text, "");
    let mut result = String::with_capacity(cleaned.len());
    let mut prev_space = false;
    for ch in cleaned.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                result.push(' ');
                prev_space = true;
            }
        } else {
            result.push(ch);
            prev_space = false;
        }
    }
    result.trim().to_string()
}

/// Resolve all @path references in `text` synchronously (blocking).
///
/// Returns `(cleaned_text, injected_content_block)`.
/// When no references are found, returns the original text unchanged with an
/// empty injected block.
pub fn resolve_references(text: &str, project_root: &Path) -> (String, String) {
    let refs = parse_references(text);
    if refs.is_empty() {
        return (text.to_string(), String::new());
    }

    let mut parts: Vec<String> = Vec::new();
    for raw in &refs {
        let abs = if raw.starts_with('/') {
            PathBuf::from(raw)
        } else {
            project_root.join(raw)
        };

        let metadata = match std::fs::metadata(&abs) {
            Ok(m) => m,
            Err(e) => {
                parts.push(format!("[{}: cannot access: {}]", raw, e));
                continue;
            }
        };

        if metadata.is_dir() {
            let entries = match std::fs::read_dir(&abs) {
                Ok(d) => d,
                Err(e) => {
                    parts.push(format!("[{}: cannot list: {}]", raw, e));
                    continue;
                }
            };
            let mut listing = String::new();
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                listing.push_str("  ");
                listing.push_str(&name);
                listing.push('\n');
            }
            if listing.len() > MAX_DIR_CHARS {
                listing.truncate(MAX_DIR_CHARS);
                listing.push_str("  ... (truncated)\n");
            }
            parts.push(format!(
                "Directory listing of {}:\n{}",
                abs.display(),
                listing
            ));
            continue;
        }

        if metadata.len() > MAX_FILE_BYTES {
            parts.push(format!(
                "[{}: file too large ({} bytes)]",
                raw,
                metadata.len()
            ));
            continue;
        }

        let ext = abs
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if IMAGE_EXTS.contains(&ext.as_str()) {
            parts.push(image_note(raw, &abs));
            continue;
        }

        match std::fs::read_to_string(&abs) {
            Ok(s) => {
                let content = if s.len() > MAX_FILE_BYTES as usize {
                    let mut t = s[..MAX_FILE_BYTES as usize].to_string();
                    t.push_str("\n\n... (truncated)");
                    t
                } else {
                    s
                };
                parts.push(format!(
                    "--- {} ---\n{}\n--- end {} ---",
                    abs.display(),
                    content,
                    abs.display()
                ));
            }
            Err(e) => {
                parts.push(format!("[{}: cannot read: {}]", raw, e));
            }
        }
    }

    let clean = strip_references(text);
    let block = parts.join("\n\n");
    (clean, block)
}

/// Synchronous file search for path-hint autocomplete.
///
/// Searches `root_dir` for files/directories whose path or name contains
/// `query` (case-insensitive). Returns `(relative_path, basename, is_dir)`
/// tuples, up to `max_results`. Performs a limited walk (up to 3 levels deep)
/// so it returns quickly enough for interactive use.
pub fn search_files_sync(
    root_dir: &Path,
    query: &str,
    max_results: usize,
) -> Vec<(String, String, bool)> {
    let mut results = Vec::new();
    let query_lower = query.to_lowercase();

    // If the query contains slashes, use the last segment as the name filter
    // and the prefix as the subdirectory to search.
    let (search_dir, name_filter) = if let Some(last_slash) = query.rfind('/') {
        let dir_part = &query[..last_slash];
        let name_part = &query[last_slash + 1..];
        let subdir = root_dir.join(dir_part);
        (subdir, name_part.to_lowercase())
    } else {
        (root_dir.to_path_buf(), query_lower.clone())
    };

    // Search the search_dir's immediate children
    let entries = match std::fs::read_dir(&search_dir) {
        Ok(d) => d,
        Err(_) => return results,
    };

    for entry in entries.flatten() {
        if results.len() >= max_results {
            break;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let name_lower = name.to_lowercase();
        if !name_lower.contains(&name_filter) {
            continue;
        }
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let full_path = entry.path();
        let rel = full_path
            .strip_prefix(root_dir)
            .unwrap_or(&full_path)
            .to_string_lossy()
            .into_owned();
        results.push((rel, name, is_dir));
    }

    // Sort: directories first, then by name
    results.sort_by(|a, b| {
        b.2.cmp(&a.2).then(a.1.cmp(&b.1))
    });

    if results.len() > max_results {
        results.truncate(max_results);
    }
    results
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/// Read an image file and return a text note with mime type.
fn image_note(raw: &str, abs: &Path) -> String {
    let ext = abs
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mime = image_mime(&ext);
    let mut f = match std::fs::File::open(abs) {
        Ok(f) => f,
        Err(_) => return format!("[{}: cannot read image]", raw),
    };
    let mut buf = Vec::new();
    if f.read_to_end(&mut buf).is_ok() {
        format!("{} (image: {}, {} bytes)", abs.display(), mime, buf.len())
    } else {
        format!("[{}: cannot read image]", raw)
    }
}

fn image_mime(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => "image/png",
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_references() {
        let refs = parse_references("check @src/main.ts and @README.md");
        assert_eq!(refs, vec!["src/main.ts", "README.md"]);

        let refs = parse_references("@http://example.com");
        assert!(refs.is_empty());
    }

    #[test]
    fn test_parse_deduplicates() {
        let refs = parse_references("@a @b @a");
        assert_eq!(refs, vec!["a", "b"]);
    }

    #[test]
    fn test_strip_references() {
        let cleaned = strip_references("see @src/main.ts and @README.md");
        assert_eq!(cleaned, "see and");

        let cleaned = strip_references("no refs here");
        assert_eq!(cleaned, "no refs here");
    }

    #[test]
    fn test_resolve_references_inject() {
        let dir = std::env::temp_dir().join("path_ref_test_inject");
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(dir.join("hello.txt"), b"hello world").unwrap();

        let (clean, block) = resolve_references("read @hello.txt", &dir);
        assert_eq!(clean, "read");
        assert!(block.contains("hello world"));
        assert!(block.contains("hello.txt"));
    }

    #[test]
    fn test_resolve_references_no_refs() {
        let dir = std::env::temp_dir().join("path_ref_test_none");
        let (clean, block) = resolve_references("plain text", &dir);
        assert_eq!(clean, "plain text");
        assert!(block.is_empty());
    }
}
