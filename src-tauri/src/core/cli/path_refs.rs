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
//! * `user@host`, emails and bare IPv4 tokens are not references and pass
//!   through untouched.
//! * Once resolved, the `@path` tokens are removed from the text so the model
//!   sees the content directly via the injected block, not raw `@` tokens.

use once_cell::sync::Lazy;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Regex scanning `@token` candidates in text; `ref_matches` applies the
/// reference rules (boundary, URL, IPv4) on top of this token scan.
///
/// Two alternatives:
/// * `@"path with spaces"` - double-quoted, allows whitespace inside
/// * `@path` - unquoted, whitespace terminates the token
static REFERENCE_RE: Lazy<regex::Regex> = Lazy::new(|| {
    // Using a raw string with hash delimiters avoids escaping quotes and backticks.
    regex::Regex::new(r###"@\"[^\"]+\"|@[^\s,;:!?'"`\[\](){}<>)\)]+"###).unwrap()
});

/// True when `at_idx` in `text` is the start of a reference token: the `@` is
/// at the start of the text, or the char immediately before it is not a word
/// character (ASCII letter/digit/underscore). This keeps `user@host` and
/// `foo@bar.com` from being read as `@path` references while `@path`,
/// `(@path)` and text in scripts without spaces still resolve.
/// Non-ASCII letters (e.g. `看@path`) deliberately count as boundaries so CJK
/// text can reference files without a preceding space.
fn is_ref_start(text: &str, at_idx: usize) -> bool {
    match text[..at_idx].chars().next_back() {
        None => true,
        Some(c) => !(c.is_ascii_alphanumeric() || c == '_'),
    }
}

/// True for tokens shaped like an IPv4 address (`1.2.3.4`), which are never
/// file paths. A trailing period (sentence punctuation) is ignored.
fn is_ipv4_like(raw: &str) -> bool {
    let raw = raw.trim_end_matches('.');
    let octets: Vec<&str> = raw.split('.').collect();
    octets.len() == 4
        && octets
            .iter()
            .all(|o| !o.is_empty() && o.len() <= 3 && o.bytes().all(|b| b.is_ascii_digit()))
}

/// Iterate over `@token` spans in `text` that qualify as file references: the
/// `@` must start a token (not be glued to a preceding word char) and the
/// token must look like a path (not an `http`/`file://` URL or bare IPv4).
fn ref_matches(text: &str) -> impl Iterator<Item = regex::Match<'_>> {
    REFERENCE_RE.find_iter(text).filter(|m| {
        let raw = &text[m.start() + 1..m.end()];
        is_ref_start(text, m.start())
            && !raw.starts_with("http")
            && !raw.starts_with("file://")
            && !is_ipv4_like(raw)
    })
}

/// Maximum bytes we will read from a single file.
const MAX_FILE_BYTES: u64 = 1024 * 1024;

/// Maximum characters in a directory listing sent to the model.
const MAX_DIR_CHARS: usize = 20_000;

/// Image extensions.
const IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"];

// ── Public API ───────────────────────────────────────────────────────────────

/// Index of the last `@` in `text` that starts a reference token, if any.
/// Uses the same rules as `ref_matches`; a trailing bare `@` (empty query)
/// still counts so the TUI hint popup can open with an empty search.
///
/// Also handles unterminated quoted references: `@"query` (no closing quote)
/// counts so the TUI hint popup can show completions while the user types.
pub fn last_ref_start(text: &str) -> Option<usize> {
    if let Some(idx) = text.len().checked_sub(1) {
        if text.ends_with('@') && is_ref_start(text, idx) {
            return Some(idx);
        }
    }
    // Check for unterminated quoted reference: @"<text> with no closing "
    // after the last @. The regex requires a closing quote, so this is a
    // separate check for the TUI hint popup.
    if let Some(at_pos) = text.rfind('@') {
        if is_ref_start(text, at_pos) {
            let after = &text[at_pos + 1..];
            if after.starts_with('"') && !after[1..].contains('"') {
                return Some(at_pos);
            }
        }
    }
    ref_matches(text).map(|m| m.start()).last()
}

/// Parse `@path` references from `text`.
///
/// Returns the raw path strings in order of appearance (deduplicated).
/// Quoted references (`@"path with spaces"`) have their surrounding quotes
/// stripped so the path is usable as a filesystem path.
fn parse_references(text: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut refs = Vec::new();
    for m in ref_matches(text) {
        let raw = &text[m.start() + 1..m.end()];
        // Strip surrounding double quotes from @"..." references.
        let raw = raw
            .strip_prefix('"')
            .and_then(|r| r.strip_suffix('"'))
            .unwrap_or(raw);
        if seen.insert(raw.to_string()) {
            refs.push(raw.to_string());
        }
    }
    refs
}

/// Remove all `@path` references from `text` and normalise whitespace.
fn strip_references(text: &str) -> String {
    let mut kept = String::with_capacity(text.len());
    let mut last = 0;
    for m in ref_matches(text) {
        kept.push_str(&text[last..m.start()]);
        last = m.end();
    }
    kept.push_str(&text[last..]);

    let mut result = String::with_capacity(kept.len());
    let mut prev_space = false;
    for ch in kept.chars() {
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
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("hello.txt"), b"hello world").unwrap();

        let (clean, block) = resolve_references("read @hello.txt", root);
        assert_eq!(clean, "read");
        assert!(block.contains("hello world"));
        assert!(block.contains("hello.txt"));
    }

    #[test]
    fn test_resolve_references_no_refs() {
        let dir = tempfile::tempdir().unwrap();
        let (clean, block) = resolve_references("plain text", dir.path());
        assert_eq!(clean, "plain text");
        assert!(block.is_empty());
    }

    #[test]
    fn test_ssh_address_not_a_reference() {
        // Regression: `ssh username@44.50.0.89` must survive verbatim.
        let text = "please use bash to ssh username@44.50.0.89";
        assert!(parse_references(text).is_empty());

        let text = "please use bash to ssh alandao@44.50.0.89";
        assert!(parse_references(text).is_empty());

        let dir = tempfile::tempdir().unwrap();
        let (clean, block) = resolve_references(text, dir.path());
        assert_eq!(clean, text);
        assert!(block.is_empty());
    }

    #[test]
    fn test_email_not_a_reference() {
        let refs = parse_references("mail me at foo@bar.com please");
        assert!(refs.is_empty());
    }

    #[test]
    fn test_bare_ip_after_space_not_a_reference() {
        let refs = parse_references("use bash to ssh @44.50.0.89 now");
        assert!(refs.is_empty());

        // Sentence-final trailing period must not turn it into a path either.
        let refs = parse_references("please ping @44.50.0.89.");
        assert!(refs.is_empty());
    }

    #[test]
    fn test_reference_with_rest_of_query_survives() {
        // The reference resolves, and the rest of the query stays intact.
        let refs = parse_references("use @README.md to check the build steps");
        assert_eq!(refs, vec!["README.md"]);

        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("README.md"), b"build steps here").unwrap();
        let (clean, block) = resolve_references("use @README.md to check the build steps", root);
        assert_eq!(clean, "use to check the build steps");
        assert!(block.contains("build steps here"));
    }

    #[test]
    fn test_reference_with_hyphen() {
        let refs = parse_references("diff @my-file.txt against main");
        assert_eq!(refs, vec!["my-file.txt"]);
    }

    #[test]
    fn test_reference_still_parsed_with_boundaries() {
        let refs = parse_references("open @src/main.ts and (@README.md) and 看@docs/guide.md");
        assert_eq!(refs, vec!["src/main.ts", "README.md", "docs/guide.md"]);
    }

    #[test]
    fn test_strip_keeps_ssh_address() {
        let cleaned = strip_references("see @src/main.ts and ssh user@44.50.0.89");
        assert_eq!(cleaned, "see and ssh user@44.50.0.89");
    }

    #[test]
    fn test_last_ref_start() {
        assert_eq!(last_ref_start("ssh user@44.50.0.89"), None);
        assert_eq!(last_ref_start("mail foo@bar.com"), None);
        assert_eq!(last_ref_start("ping @44.50.0.89 now"), None);
        assert_eq!(
            last_ref_start("check @src/main.ts and ssh user@host"),
            Some("check ".len())
        );
        assert_eq!(last_ref_start("see (@README.md)"), Some("see (".len()));
        // Last of several qualifying references wins.
        assert_eq!(last_ref_start("check @a and @b"), Some("check @a and ".len()));
        // A bare trailing `@` is still a hint trigger (empty query).
        assert_eq!(last_ref_start("@"), Some(0));
        assert_eq!(last_ref_start("check @"), Some(6));
        // But a mid-word `@` never is, even at the end.
        assert_eq!(last_ref_start("ssh user@"), None);
    }

    #[test]
    fn test_quoted_reference_with_spaces() {
        let refs = parse_references("use @\"my file.txt\" now");
        assert_eq!(refs, vec!["my file.txt"]);
    }

    #[test]
    fn test_quoted_reference_resolve_and_strip() {
        let dir = std::env::temp_dir().join("path_ref_test_quoted");
        let _ = std::fs::create_dir_all(&dir);
        std::fs::write(dir.join("my file.txt"), b"space content").unwrap();
        let (clean, block) = resolve_references("read @\"my file.txt\" please", &dir);
        // strip_references normalizes whitespace after removal.
        assert_eq!(clean, "read please");
        assert!(block.contains("space content"));
    }

    #[test]
    fn test_quoted_reference_unterminated() {
        // Unterminated quote: the regex requires a closing quote, so this
        // does not match as a reference.
        let refs = parse_references("use @\"my file");
        assert!(refs.is_empty(), "unterminated quote must not be a reference");
    }

    #[test]
    fn test_last_ref_start_quoted() {
        assert_eq!(
            last_ref_start("check @\"src/main ts\" and foo"),
            Some("check ".len())
        );
    }

    #[test]
    fn test_strip_quoted_reference() {
        let cleaned = strip_references("see @\"my file.txt\" and done");
        assert_eq!(cleaned, "see and done");
    }
}
