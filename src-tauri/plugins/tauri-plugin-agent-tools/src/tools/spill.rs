//! Scratch spill files: host-side writes into the session scratch.
//!
//! Two producers share this: truncated `bash` output (`handlers.rs`) and
//! subagent final answers (the CLI loop's `await_subagent` and the desktop's
//! `subagent_result_reserve`/`subagent_result_fill` commands). The scratch is
//! writable by the sandboxed shell, so every path here is symlink-defended: a
//! redirected subdirectory or a pre-planted file must never route our bytes
//! onto a host path.

use std::io::Write;
use std::path::{Path, PathBuf};

/// Scratch subdirectory holding subagent result files.
pub const SUBAGENT_DIR: &str = "subagents";

/// Bytes of a subagent's final answer kept inline in the `task`/`await`
/// tool result; anything past this lives only in the spill file. Roughly 2K
/// tokens: enough for any real summary, small enough that a child dumping a
/// whole file does not flood the parent's context.
pub const SUBAGENT_INLINE_MAX_BYTES: usize = 8 * 1024;

/// Validate-or-create `base/name` as a real, non-symlink directory.
///
/// The shell can write `base`, so it could have redirected `name` at a host
/// directory. Refuse (returning `None`) rather than write through a redirect.
/// `create_dir` (not `create_dir_all`) refuses to follow a planted symlink in
/// the path it creates, and the node is re-verified afterwards in case a
/// concurrent process swapped it between the create and the check.
pub fn validated_subdir(base: &Path, name: &str) -> Option<PathBuf> {
    let dir = base.join(name);
    match std::fs::symlink_metadata(&dir) {
        Ok(meta) if !meta.is_dir() => return None,
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if let Err(e) = std::fs::create_dir(&dir) {
                if e.kind() != std::io::ErrorKind::AlreadyExists {
                    return None;
                }
            }
        }
        Err(_) => return None,
    }
    match std::fs::symlink_metadata(&dir) {
        Ok(meta) if !meta.file_type().is_symlink() && meta.is_dir() => Some(dir),
        _ => None,
    }
}

/// Open a spill file atomically with `O_EXCL` so we never truncate or write
/// through an existing symlink the shell planted: `create_new` fails if the
/// path already exists (as a file or a symlink).
pub fn open_excl(path: &Path) -> std::io::Result<std::fs::File> {
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
}

/// A filesystem-safe stem from a caller-supplied id: everything outside
/// `[A-Za-z0-9._-]` collapses to `-`, leading dots are stripped so the name
/// can never be a dotfile or a `..` component, and an unusable id falls back
/// to a generic stem rather than failing the write.
fn sanitize_stem(id: &str) -> String {
    let mut stem: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '-'
            }
        })
        .collect();
    while stem.starts_with('.') {
        stem.remove(0);
    }
    stem.truncate(80);
    if stem.is_empty() {
        "result".to_string()
    } else {
        stem
    }
}

/// Claim `<scratch>/subagents/<id>.md` as an empty file, returning the host path.
///
/// Reserving is split from writing because a backgrounded subagent has to name
/// the file at dispatch -- the parent is told where the answer will land long
/// before there is an answer -- and the empty file is what stops a later
/// reservation taking the same name. `create_new` semantics mean an existing
/// name gets a `-2`, `-3`, ... suffix rather than being overwritten: two
/// children of one run may share a name, and neither result is the other's to
/// replace.
pub fn reserve_subagent_result(scratch: &Path, id: &str) -> Option<PathBuf> {
    let dir = validated_subdir(scratch, SUBAGENT_DIR)?;
    let stem = sanitize_stem(id);
    for n in 1..100 {
        let name = if n == 1 {
            format!("{stem}.md")
        } else {
            format!("{stem}-{n}.md")
        };
        let path = dir.join(name);
        match open_excl(&path) {
            Ok(_) => return Some(path),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return None,
        }
    }
    None
}

/// Fill a path [`reserve_subagent_result`] handed out. The shell could have
/// swapped our empty file for a link in the meantime, so the same fail-closed
/// re-check applies: write only to a real file, never through a redirect.
pub fn fill_subagent_result(path: &Path, text: &str) -> bool {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => {}
        _ => return false,
    }
    match open_truncating(path) {
        Ok(mut file) => file.write_all(text.as_bytes()).is_ok(),
        Err(_) => false,
    }
}

/// `create(false)`: the file must be the one we reserved, so a path that has
/// since been removed is a failure rather than something to recreate.
fn open_truncating(path: &Path) -> std::io::Result<std::fs::File> {
    std::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .create(false)
        .open(path)
}

/// Fill a reservation named by file name alone -- the shape a caller outside
/// this process (the Cowork loop, over the plugin boundary) can hand back.
///
/// The name is validated to one safe component and re-resolved under the
/// scratch's own `subagents/`, so nothing the caller says can aim the write
/// somewhere else. The directory is re-validated too: [`fill_subagent_result`]
/// only vouches for the leaf, and a `subagents/` swapped for a link would
/// otherwise resolve the leaf on the far side of it.
pub fn fill_named_subagent_result(scratch: &Path, file: &str, text: &str) -> bool {
    if !is_result_file_name(file) {
        return false;
    }
    match validated_subdir(scratch, SUBAGENT_DIR) {
        Some(dir) => fill_subagent_result(&dir.join(file), text),
        None => false,
    }
}

/// A name [`reserve_subagent_result`] could have produced: one component, the
/// `sanitize_stem` charset, and a `.md` tail (which is also what rules out
/// `.` and `..`).
fn is_result_file_name(name: &str) -> bool {
    name.len() <= 128
        && name.ends_with(".md")
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// The model-facing `task`/`await_subagent` result for a child's final answer.
///
/// With no spill file the text passes through unchanged (the unconfined CLI has
/// no scratch by design). With one, a short answer is returned whole plus a
/// note naming the file; a long answer keeps its head -- a report leads with
/// its summary, unlike command output whose errors trail -- and the note says
/// how to read the rest.
pub fn compose_subagent_result(text: &str, display_path: Option<&str>) -> String {
    let Some(path) = display_path else {
        return text.to_string();
    };
    if text.len() <= SUBAGENT_INLINE_MAX_BYTES {
        return format!("{text}\n\n[full result saved to {path}]");
    }
    let mut cut = SUBAGENT_INLINE_MAX_BYTES;
    while cut > 0 && !text.is_char_boundary(cut) {
        cut -= 1;
    }
    format!(
        "{}\n\n[result truncated at {cut} of {} bytes; full result saved to {path}. Use the \
         read tool (with offset/limit) on that path to see the rest]",
        &text[..cut],
        text.len(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "jan-spill-test-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// The dispatch-time path is the one the answer lands in, and a second
    /// reservation cannot take it even while it is still empty.
    #[test]
    fn a_reserved_path_is_held_until_it_is_filled() {
        let scratch = tmp("reserve");
        let a = reserve_subagent_result(&scratch, "sub-a-1").unwrap();
        let b = reserve_subagent_result(&scratch, "sub-a-1").unwrap();
        assert_eq!(a, scratch.join("subagents/sub-a-1.md"));
        assert_eq!(b, scratch.join("subagents/sub-a-1-2.md"));
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "");
        assert!(fill_subagent_result(&a, "the answer"));
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "the answer");
        // Never recreated: a reservation that vanished is a failure, not an
        // invitation to write somewhere new.
        std::fs::remove_file(&b).unwrap();
        assert!(!fill_subagent_result(&b, "x"));
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[cfg(unix)]
    #[test]
    fn refuses_to_fill_through_a_swapped_link() {
        let scratch = tmp("swap");
        let host = tmp("swap-host").join("secret");
        std::fs::write(&host, "original").unwrap();
        let path = reserve_subagent_result(&scratch, "sub-a-1").unwrap();
        std::fs::remove_file(&path).unwrap();
        std::os::unix::fs::symlink(&host, &path).unwrap();
        assert!(!fill_subagent_result(&path, "overwritten"));
        assert_eq!(std::fs::read_to_string(&host).unwrap(), "original");
        let _ = std::fs::remove_dir_all(&scratch);
        let _ = std::fs::remove_dir_all(host.parent().unwrap());
    }

    #[test]
    fn sanitizes_hostile_ids() {
        assert_eq!(sanitize_stem("../../etc/passwd"), "-..-etc-passwd");
        assert_eq!(sanitize_stem("..."), "result");
        assert_eq!(sanitize_stem(""), "result");
        let scratch = tmp("hostile");
        let p = reserve_subagent_result(&scratch, "a/b\\c").unwrap();
        assert!(p.starts_with(scratch.join(SUBAGENT_DIR)));
        assert_eq!(p.file_name().unwrap().to_str().unwrap(), "a-b-c.md");
        let _ = std::fs::remove_dir_all(&scratch);
    }

    /// The file name crosses the plugin boundary and comes back, so it is
    /// re-validated rather than trusted: only a name a reservation could have
    /// produced, resolved under the scratch's own directory.
    #[test]
    fn a_returned_file_name_cannot_aim_the_write_elsewhere() {
        let scratch = tmp("named");
        let reserved = reserve_subagent_result(&scratch, "sub-a-1").unwrap();
        assert!(fill_named_subagent_result(&scratch, "sub-a-1.md", "answer"));
        assert_eq!(std::fs::read_to_string(&reserved).unwrap(), "answer");

        for hostile in [
            "../../etc/passwd",
            "../sub-a-1.md",
            "sub-a-1.md/../../x.md",
            ".hidden.md",
            "sub-a-1.txt",
            "",
        ] {
            assert!(
                !fill_named_subagent_result(&scratch, hostile, "x"),
                "accepted {hostile:?}"
            );
        }
        // A well-formed name that was never reserved is still refused: fill
        // never creates.
        assert!(!fill_named_subagent_result(
            &scratch,
            "never-reserved.md",
            "x"
        ));
        let _ = std::fs::remove_dir_all(&scratch);
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_redirected_subagents_dir() {
        let scratch = tmp("redirect");
        let target = tmp("redirect-target");
        std::os::unix::fs::symlink(&target, scratch.join(SUBAGENT_DIR)).unwrap();
        assert!(reserve_subagent_result(&scratch, "id").is_none());
        let _ = std::fs::remove_dir_all(&scratch);
        let _ = std::fs::remove_dir_all(&target);
    }

    #[test]
    fn short_results_stay_whole_with_a_pointer() {
        let out = compose_subagent_result("the answer", Some("/tmp/subagents/r.md"));
        assert_eq!(
            out,
            "the answer\n\n[full result saved to /tmp/subagents/r.md]"
        );
        assert_eq!(compose_subagent_result("plain", None), "plain");
    }

    #[test]
    fn long_results_keep_their_head_and_name_the_file() {
        let text = "x".repeat(SUBAGENT_INLINE_MAX_BYTES + 100);
        let out = compose_subagent_result(&text, Some("/tmp/subagents/r.md"));
        assert!(out.starts_with(&"x".repeat(SUBAGENT_INLINE_MAX_BYTES)));
        assert!(out.contains("truncated at 8192 of 8292 bytes"));
        assert!(out.contains("full result saved to /tmp/subagents/r.md"));
        // The head is cut at a char boundary even for multi-byte text.
        let uni = "é".repeat(SUBAGENT_INLINE_MAX_BYTES);
        let composed = compose_subagent_result(&uni, Some("p"));
        assert!(composed.contains("truncated at 8192 of 16384 bytes"));
    }
}
