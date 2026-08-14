//! Path helpers for the two roots the agent works against.
//!
//! **Store root** -- holds `memory/` and `skills/`. Long-term: memories and
//! skills outlive any single conversation, so on the desktop this is a permanent
//! directory in the Jan data folder. A project (dev's layout, and the CLI agent)
//! co-locates its store at `<project>/.jan/agent` instead; both are just a store
//! root to everything downstream.
//!
//! **Project root** -- the sandbox the filesystem tools (read/ls/find/grep, and
//! later write/edit/bash) are confined to. On the desktop this is ephemeral and
//! per-thread, so one conversation's scratch files are invisible to the next.
//!
//! The two are deliberately disjoint: the store is not reachable from the
//! project root, so `escapes_project` alone keeps the general filesystem tools
//! out of memory and skills, which are reachable only through the dedicated
//! `memory_*`/`skill_*` tools.
//!
//! These live here rather than in `tools::handlers` because `skills` needs the
//! name guard too; keeping them in `handlers` made `handlers` and `skills`
//! mutually dependent.

use std::path::{Path, PathBuf};

const THREADS: &str = "threads";

/// `<store_root>/<kind>`, for `kind` in `{memory, skills}`.
pub fn store_dir(store_root: &Path, kind: &str) -> PathBuf {
    store_root.join(kind)
}

/// A project's co-located store root: `<project_root>/.jan/agent`.
///
/// This is dev's per-project layout and what the CLI agent uses, where memory
/// and skills live inside the project being worked on.
pub fn project_store(project_root: &Path) -> PathBuf {
    project_root.join(".jan").join("agent")
}

/// The desktop's permanent store root: `<jan_data_folder>/agent-workspace`.
///
/// Never cleaned up -- this is what makes memories long-term. Resolving the Jan
/// data folder itself stays with the app (it owns the `JAN_DATA_FOLDER` override
/// and the configured `data_folder`); this crate only decides where inside it
/// the agent's directories live.
pub fn permanent_store(jan_data_folder: &Path) -> PathBuf {
    jan_data_folder.join("agent-workspace")
}

/// Where per-thread sandboxes live: `<permanent_store>/threads`.
///
/// A sibling of `memory/` and `skills/`, not a parent, so a thread's sandbox
/// root cannot contain the store and `escapes_project` refuses any path that
/// climbs out toward it.
pub fn threads_dir(jan_data_folder: &Path) -> PathBuf {
    permanent_store(jan_data_folder).join(THREADS)
}

/// A thread's ephemeral sandbox root:
/// `<jan_data_folder>/agent-workspace/threads/<thread_id>`.
pub fn thread_workspace(jan_data_folder: &Path, thread_id: &str) -> Result<PathBuf, String> {
    Ok(threads_dir(jan_data_folder).join(thread_segment(thread_id)?))
}

/// The session-scoped scratch directory: a subdirectory of the host temp
/// dir (e.g. `/tmp/jan-agent-<session>` on Linux) bound over the sandbox's
/// `/tmp` so `bash` scratch files persist across calls for one session.
///
/// Only the specific session subdir is bound, not the whole host `/tmp`, so
/// the sandboxed shell sees just its own scratch and none of the machine's
/// other temp files. On macOS and Windows the OS temp dir is already
/// host-backed and persists on its own, so this path is only consumed by the
/// Linux bubblewrap backend; it is still cleaned up with the session elsewhere.
pub fn scratch_dir(session: &str) -> PathBuf {
    std::env::temp_dir().join(format!("jan-agent-{session}"))
}

/// Create the session-scoped scratch directory (idempotent) and return it.
/// Must exist before the Linux sandbox binds it over `/tmp`. The caller owns
/// its teardown: thread deletion on the desktop, run end on the CLI, and
/// session end in the TUI.
pub async fn ensure_scratch_dir(session: &str) -> Result<PathBuf, String> {
    let dir = scratch_dir(session);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("ERROR: {e}"))?;
    Ok(dir)
}

/// Delete a session's scratch directory. Idempotent: a missing scratch is Ok.
pub async fn remove_scratch_dir(session: &str) -> Result<(), String> {
    let dir = scratch_dir(session);
    match tokio::fs::remove_dir_all(&dir).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("ERROR: {e}")),
    }
}

/// Create the permanent store and its `memory/`/`skills/` subdirectories,
/// returning the store root. Idempotent.
pub async fn ensure_permanent_store(jan_data_folder: &Path) -> Result<PathBuf, String> {
    let root = permanent_store(jan_data_folder);
    for kind in ["memory", "skills"] {
        tokio::fs::create_dir_all(store_dir(&root, kind))
            .await
            .map_err(|e| format!("ERROR: {e}"))?;
    }
    Ok(root)
}

/// Create a thread's sandbox root and return it. Idempotent.
///
/// The directory must exist before any tool runs: `escapes_project`
/// canonicalizes the root, and a missing root is treated as an escape, so every
/// call would otherwise be refused.
pub async fn ensure_thread_workspace(
    jan_data_folder: &Path,
    thread_id: &str,
) -> Result<PathBuf, String> {
    let dir = thread_workspace(jan_data_folder, thread_id)?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| format!("ERROR: {e}"))?;
    Ok(dir)
}

/// Delete a thread's sandbox. Idempotent: a missing sandbox is Ok.
pub async fn remove_thread_workspace(
    jan_data_folder: &Path,
    thread_id: &str,
) -> Result<(), String> {
    let dir = thread_workspace(jan_data_folder, thread_id)?;
    crate::tools::appcontainer::release(&dir);
    match tokio::fs::remove_dir_all(&dir).await {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("ERROR: {e}")),
    }
    // Wipe the session-scoped host-temp scratch keyed to the same thread id.
    let _ = remove_scratch_dir(thread_id).await;
    Ok(())
}

/// Delete every thread sandbox whose id is not in `keep`, returning how many
/// were removed.
///
/// Sandboxes are ephemeral, but a crash or a thread deleted while the app was
/// closed leaves one behind. Called at startup with the surviving thread ids so
/// leftovers cannot accumulate. An unreadable threads directory is not an error:
/// nothing has been created yet.
pub async fn sweep_thread_workspaces(
    jan_data_folder: &Path,
    keep: &[String],
) -> Result<usize, String> {
    let dir = threads_dir(jan_data_folder);
    let Ok(mut entries) = tokio::fs::read_dir(&dir).await else {
        return Ok(0);
    };
    // Compare against sanitized ids: the directory name is the sanitized form,
    // so a raw id would fail to match its own sandbox and delete a live one.
    let keep: std::collections::HashSet<String> = keep
        .iter()
        .filter_map(|id| thread_segment(id).ok())
        .collect();
    let mut removed = 0;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if keep.contains(&name) {
            continue;
        }
        crate::tools::appcontainer::release(&entry.path());
        if tokio::fs::remove_dir_all(entry.path()).await.is_ok() {
            removed += 1;
            // Wipe the session-scoped host-temp scratch keyed to this thread.
            let _ = remove_scratch_dir(&name).await;
        }
    }
    Ok(removed)
}

/// Sanitize a caller-supplied thread id into one safe path segment.
///
/// Stricter than [`workspace_filename`] on purpose: a thread id is generated,
/// never typed, so anything outside `[A-Za-z0-9._-]` is a bug or an attack. Dots
/// are allowed inside the id but a dot-only segment is not, which is what would
/// resolve to the threads directory itself or its parent.
pub fn thread_segment(thread_id: &str) -> Result<String, String> {
    let id = thread_id.trim();
    let ok = !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        && !id.chars().all(|c| c == '.');
    if !ok {
        return Err(format!("ERROR: invalid thread id '{thread_id}'"));
    }
    Ok(id.to_string())
}

/// Sanitize a caller-supplied entry name into a safe `<stem>.md` filename.
/// Rejects path separators and `..` so the result can never escape the
/// store directory. `.md` is appended if absent.
pub fn workspace_filename(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    let stem = trimmed.strip_suffix(".md").unwrap_or(trimmed);
    // Checked on the stem, not the input: otherwise a bare "." passes and the
    // guard emits "..md", a name it would itself reject as input.
    if stem.is_empty()
        || stem.contains('/')
        || stem.contains('\\')
        || stem.contains("..")
        || stem.chars().all(|c| c == '.')
    {
        return Err(format!("ERROR: invalid name '{name}'"));
    }
    Ok(format!("{stem}.md"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn unique_data_folder() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!("jan_ws_test_{}_{}", std::process::id(), n))
    }

    #[test]
    fn permanent_store_holds_memory_and_skills() {
        let store = permanent_store(Path::new("/data"));
        assert_eq!(store, Path::new("/data/agent-workspace"));
        assert_eq!(
            store_dir(&store, "memory"),
            Path::new("/data/agent-workspace/memory")
        );
    }

    /// dev's layout: a project keeps its store inside itself.
    #[test]
    fn project_store_is_under_jan_agent() {
        assert_eq!(
            store_dir(&project_store(Path::new("/p")), "memory"),
            Path::new("/p/.jan/agent/memory")
        );
    }

    /// The whole point of the split: a thread sandbox is a sibling of the store,
    /// so no relative path from inside it stays within the sandbox and reaches
    /// memory. `escapes_project` refuses the climb.
    #[test]
    fn thread_workspace_does_not_contain_the_store() {
        let data = Path::new("/data");
        let thread = thread_workspace(data, "abc-123").unwrap();
        assert_eq!(thread, Path::new("/data/agent-workspace/threads/abc-123"));
        assert!(!store_dir(&permanent_store(data), "memory").starts_with(&thread));
    }

    #[tokio::test]
    async fn scratch_dir_lifecycle_is_session_keyed_and_removable() {
        let session = "t1";
        let scratch = scratch_dir(session);
        assert!(!scratch.exists());

        let created = ensure_scratch_dir(session).await.unwrap();
        assert_eq!(created, scratch);
        assert!(scratch.is_dir());

        std::fs::write(scratch.join("f"), b"x").unwrap();
        remove_scratch_dir(session).await.unwrap();
        assert!(!scratch.exists());
        // Idempotent.
        remove_scratch_dir(session).await.unwrap();
    }

    #[test]
    fn thread_segment_rejects_traversal_and_separators() {
        for bad in [
            "", "  ", ".", "..", "...", "../x", "a/b", "a\\b", "a b", "a;b", "a$b", "évil",
        ] {
            assert!(
                thread_segment(bad).is_err(),
                "expected {bad:?} to be rejected"
            );
        }
        assert!(thread_segment(&"a".repeat(129)).is_err(), "over-long id");
    }

    #[test]
    fn thread_segment_accepts_generated_ids() {
        for ok in [
            "01H8XGJWBWBAQ",
            "3f2a9c1e-1234-4c9a-9b7e-000000000000",
            "thread_42",
            "v1.2",
        ] {
            assert_eq!(thread_segment(ok).unwrap(), ok);
        }
        assert_eq!(thread_segment("  padded  ").unwrap(), "padded");
    }

    #[tokio::test]
    async fn ensure_permanent_store_creates_both_kinds() {
        let data = unique_data_folder();
        let root = ensure_permanent_store(&data).await.unwrap();
        assert!(store_dir(&root, "memory").is_dir());
        assert!(store_dir(&root, "skills").is_dir());
        let _ = std::fs::remove_dir_all(&data);
    }

    #[tokio::test]
    async fn thread_workspace_lifecycle_is_idempotent() {
        let data = unique_data_folder();
        let dir = ensure_thread_workspace(&data, "t1").await.unwrap();
        assert!(dir.is_dir());
        ensure_thread_workspace(&data, "t1").await.unwrap();

        remove_thread_workspace(&data, "t1").await.unwrap();
        assert!(!dir.exists());
        remove_thread_workspace(&data, "t1").await.unwrap();
        let _ = std::fs::remove_dir_all(&data);
    }

    #[tokio::test]
    async fn sweep_removes_only_unknown_threads() {
        let data = unique_data_folder();
        for id in ["live", "dead", "also-dead"] {
            ensure_thread_workspace(&data, id).await.unwrap();
        }
        let removed = sweep_thread_workspaces(&data, &["live".to_string()])
            .await
            .unwrap();
        assert_eq!(removed, 2);
        assert!(thread_workspace(&data, "live").unwrap().is_dir());
        assert!(!thread_workspace(&data, "dead").unwrap().exists());
        let _ = std::fs::remove_dir_all(&data);
    }

    /// The store sits beside `threads/`, so a sweep must never touch it.
    #[tokio::test]
    async fn sweep_leaves_memory_and_skills_alone() {
        let data = unique_data_folder();
        let store = ensure_permanent_store(&data).await.unwrap();
        ensure_thread_workspace(&data, "dead").await.unwrap();

        sweep_thread_workspaces(&data, &[]).await.unwrap();
        assert!(store_dir(&store, "memory").is_dir());
        assert!(store_dir(&store, "skills").is_dir());
        let _ = std::fs::remove_dir_all(&data);
    }

    #[tokio::test]
    async fn sweep_on_a_fresh_install_is_not_an_error() {
        let data = unique_data_folder();
        assert_eq!(sweep_thread_workspaces(&data, &[]).await.unwrap(), 0);
    }

    #[test]
    fn filename_appends_md_once() {
        assert_eq!(workspace_filename("notes").unwrap(), "notes.md");
        assert_eq!(workspace_filename("notes.md").unwrap(), "notes.md");
        assert_eq!(workspace_filename("  notes  ").unwrap(), "notes.md");
    }

    #[test]
    fn filename_rejects_escapes() {
        for bad in ["", "  ", "../x", "a/b", "a\\b", "..", "a/../b", "a..b"] {
            assert!(
                workspace_filename(bad).is_err(),
                "expected {bad:?} to be rejected"
            );
        }
    }

    /// Dot-only and empty-stem names are rejected rather than turned into a
    /// hidden file. A bare "." used to yield "..md" -- contained, but a name the
    /// guard would reject as input.
    #[test]
    fn filename_rejects_dot_only_and_empty_stem() {
        for bad in [".", "..", "...", ".md", "  .md  "] {
            assert!(
                workspace_filename(bad).is_err(),
                "expected {bad:?} to be rejected"
            );
        }
    }
}
