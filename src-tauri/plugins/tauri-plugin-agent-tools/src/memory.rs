//! Long-term agent memory: flat `<name>.md` notes under `<store_root>/memory/`.
//!
//! Every function takes a store root rather than a project root, so the same
//! implementation serves the desktop's permanent store in the Jan data folder and
//! a project's co-located `<project>/.jan/agent` store. Memory deliberately
//! outlives the ephemeral per-thread sandbox the filesystem tools run in.
//!
//! This is the store the `memory_*` built-in tools read and write, and the same
//! one the management commands expose, so both share one implementation. It is
//! unrelated to the vector-db recall index, which is keyed by project and
//! populated by a separate indexing path.
//!
//! Error strings carry the `ERROR:` prefix the tool protocol expects; the
//! command layer strips it for display.

use std::path::{Path, PathBuf};

use crate::workspace::{store_dir, workspace_filename};

const KIND: &str = "memory";

/// `<store_root>/memory`.
pub fn memory_dir(store_root: &Path) -> PathBuf {
    store_dir(store_root, KIND)
}

fn target(store_root: &Path, name: &str) -> Result<PathBuf, String> {
    Ok(memory_dir(store_root).join(workspace_filename(name)?))
}

/// Note names (file stems), sorted. A missing directory yields an empty list
/// rather than an error: a store with no memory yet is not a failure.
pub async fn list(store: &Path) -> Vec<String> {
    let Ok(mut entries) = tokio::fs::read_dir(memory_dir(store)).await else {
        return Vec::new();
    };
    let mut names: Vec<String> = Vec::new();
    while let Ok(Some(e)) = entries.next_entry().await {
        let path = e.path();
        if path.extension().and_then(|x| x.to_str()) == Some("md") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                names.push(stem.to_string());
            }
        }
    }
    names.sort();
    names
}

pub async fn read(store: &Path, name: &str) -> Result<String, String> {
    let target = target(store, name)?;
    tokio::fs::read_to_string(&target)
        .await
        .map_err(|e| format!("ERROR: {e}"))
}

/// A memory note's summary line: the first non-empty, non-heading body line,
/// capped. Mirrors skills' catalog: models see one line per note at session
/// start and load the rest on demand with `memory_read`.
fn describe(content: &str) -> String {
    content
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|l| {
            if l.chars().count() > 120 {
                l.chars().take(120).collect::<String>()
            } else {
                l.to_string()
            }
        })
        .unwrap_or_default()
}

/// Memory notes worth advertising in the system prompt: name + summary line, in
/// sorted order, skipping notes with neither a name nor a summary. This is the
/// progressive-disclosure catalog - the model calls `memory_read` to load a
/// note on demand. Sync (std::fs) so the sync `context::load_memory_catalog`
/// can call it directly; the async `memory_*` tools share the same store.
pub fn catalog(store: &Path) -> Vec<(String, String)> {
    let dir = memory_dir(store);
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut notes: Vec<(String, String)> = rd
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let path = e.path();
            if path.extension().and_then(|x| x.to_str()) != Some("md") {
                return None;
            }
            let name = path.file_stem().and_then(|s| s.to_str());
            let body = std::fs::read_to_string(&path).ok();
            match (name, body) {
                (Some(name), Some(body)) => {
                    let description = describe(&body);
                    if name.is_empty() && description.is_empty() {
                        None
                    } else {
                        Some((name.to_string(), description))
                    }
                }
                _ => None,
            }
        })
        .collect();
    notes.sort_by(|a, b| a.0.cmp(&b.0));
    notes
}

/// Create or overwrite a note. Returns the filename written, so callers can
/// phrase their own result message. Parent directories are created as needed.
pub async fn write(store: &Path, name: &str, content: &str) -> Result<String, String> {
    let file = workspace_filename(name)?;
    let dir = memory_dir(store);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("ERROR: {e}"))?;
    tokio::fs::write(dir.join(&file), content)
        .await
        .map_err(|e| format!("ERROR: {e}"))?;
    Ok(file)
}

/// Delete a note. Idempotent: a missing note is Ok.
pub async fn delete(store: &Path, name: &str) -> Result<(), String> {
    let target = target(store, name)?;
    match tokio::fs::remove_file(&target).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("ERROR: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn unique_root() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!("jan_memory_test_{}_{}", std::process::id(), n))
    }

    #[tokio::test]
    async fn write_read_list_delete_roundtrip() {
        let root = unique_root();
        assert!(list(&root).await.is_empty(), "fresh project has no notes");

        assert_eq!(write(&root, "prefs", "body").await.unwrap(), "prefs.md");
        assert_eq!(read(&root, "prefs").await.unwrap(), "body");
        assert_eq!(list(&root).await, vec!["prefs"]);

        delete(&root, "prefs").await.unwrap();
        assert!(list(&root).await.is_empty());
        delete(&root, "prefs").await.unwrap(); // idempotent
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn list_is_sorted_and_ignores_non_markdown() {
        let root = unique_root();
        write(&root, "b", "b").await.unwrap();
        write(&root, "a", "a").await.unwrap();
        std::fs::write(memory_dir(&root).join("notes.txt"), "ignored").unwrap();

        assert_eq!(list(&root).await, vec!["a", "b"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn traversal_names_are_rejected() {
        let root = unique_root();
        for bad in ["../escape", "sub/x", "..", "", "."] {
            assert!(write(&root, bad, "x").await.is_err(), "write {bad:?}");
            assert!(read(&root, bad).await.is_err(), "read {bad:?}");
            assert!(delete(&root, bad).await.is_err(), "delete {bad:?}");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn read_missing_note_errors() {
        let root = unique_root();
        assert!(read(&root, "nope").await.is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn catalog_lists_sorted_notes_with_summaries() {
        let root = unique_root();
        std::fs::create_dir_all(memory_dir(&root)).unwrap();
        std::fs::write(
            memory_dir(&root).join("decisions.md"),
            "# Decisions\nWe use Yarn not npm.",
        )
        .unwrap();
        std::fs::write(memory_dir(&root).join("prefs.md"), "Keep it minimal.").unwrap();
        std::fs::write(memory_dir(&root).join("notes.txt"), "ignored").unwrap();

        let notes = catalog(&root);
        assert_eq!(
            notes,
            vec![
                ("decisions".to_string(), "We use Yarn not npm.".to_string()),
                ("prefs".to_string(), "Keep it minimal.".to_string()),
            ]
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn catalog_lists_notes_even_without_a_summary_line() {
        let root = unique_root();
        std::fs::create_dir_all(memory_dir(&root)).unwrap();
        std::fs::write(memory_dir(&root).join("empty.md"), "   \n# Only headings\n").unwrap();

        // A curated note is worth advertising by name even if it has no prose.
        assert_eq!(catalog(&root), vec![("empty".to_string(), String::new())]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn catalog_missing_dir_is_empty() {
        let root = unique_root();
        assert!(catalog(&root).is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
}
