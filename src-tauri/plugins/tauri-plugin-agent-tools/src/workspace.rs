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

/// The session-scoped scratch directory: a subdirectory of the host temp dir
/// (e.g. `/tmp/jan-agent-<session>` on Linux), where `bash` scratch files
/// persist across calls for one session and the filesystem tools may write.
///
/// Every backend exposes it, but not the same way. Bubblewrap binds it over the
/// sandbox's `/tmp` -- only this session subdir, not the whole host `/tmp`, so
/// the shell sees its own scratch and none of the machine's other temp files --
/// and the tools remap `/tmp/...` back onto it. Seatbelt and AppContainer have
/// no mount, so it is reached by this real path and made writable by a policy
/// rule and an ACE respectively. Either way `TMPDIR`/`TMP`/`TEMP` point at it
/// (see `tools::jail::scratch_env_path`) and it is cleaned up with the session.
pub fn scratch_dir(session: &str) -> PathBuf {
    std::env::temp_dir().join(format!("jan-agent-{session}"))
}

/// Create the session-scoped scratch directory (idempotent) and return it.
/// Must exist before the Linux sandbox binds it over `/tmp`. The caller owns
/// its teardown: thread deletion on the desktop, run end on the CLI, and
/// session end in the TUI.
pub async fn ensure_scratch_dir(session: &str) -> Result<PathBuf, String> {
    ensure_scratch_dir_path(&scratch_dir(session)).await
}

/// Create a scratch directory at an explicit path, hardening it against a
/// pre-planted symlink: the sandbox must never bind or trust an
/// attacker-selected directory as its sanctioned scratch. Refuses (fail
/// closed) when the target already exists as a symlink or is not a real
/// directory, and applies restrictive 0700 permissions on Unix so no other
/// local user can read the session's scratch files. `create_dir` (not
/// `create_dir_all`) is used so the final component is created directly and a
/// parent symlink cannot redirect it.
pub async fn ensure_scratch_dir_path(dir: &Path) -> Result<PathBuf, String> {
    match tokio::fs::symlink_metadata(dir).await {
        Ok(meta) => {
            if !meta.file_type().is_symlink() && meta.is_dir() {
                // Already a real directory; keep it.
            } else {
                return Err(format!(
                    "ERROR: scratch path {:?} is not a real directory",
                    dir
                ));
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if let Some(parent) = dir.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|e| format!("ERROR: {e}"))?;
            }
            // `create_dir` (not `create_dir_all`) so the final component is made
            // directly and a parent symlink cannot redirect it. A concurrent
            // creator is fine: re-verify the existing node is a real directory.
            if let Err(e) = tokio::fs::create_dir(dir).await {
                if e.kind() != std::io::ErrorKind::AlreadyExists {
                    return Err(format!("ERROR: {e}"));
                }
            }
            // Re-verify after creation: a concurrent swap could have replaced
            // the freshly made directory with a symlink.
            match tokio::fs::symlink_metadata(dir).await {
                Ok(meta) if !meta.file_type().is_symlink() && meta.is_dir() => {}
                _ => return Err(format!("ERROR: scratch path {:?} is not a real directory", dir)),
            }
        }
        Err(e) => return Err(format!("ERROR: {e}")),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = tokio::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).await;
    }
    Ok(dir.to_path_buf())
}

/// How long a scratch directory may sit untouched before the startup sweep
/// treats it as abandoned. Age-based rather than "remove every scratch at
/// startup" so a second Jan instance cannot wipe the first one's live scratch.
const SCRATCH_STALE_AFTER: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);

/// Delete abandoned scratch directories in the host temp dir, returning how many
/// were removed.
///
/// Every scratch has an owner that removes it (run end, thread deletion, session
/// end), but a kill -9 or a power loss leaves one behind with nobody left to
/// claim it: the id it is keyed to lives in the caller's state, not on disk, so
/// no `keep` list can be reconstructed the way [`sweep_thread_workspaces`] does
/// it. Age is the only signal available, so anything untouched for
/// [`SCRATCH_STALE_AFTER`] is collected. Called once at startup.
///
/// Failures are silent per entry: another user's `jan-agent-*` in a shared
/// `/tmp` is not ours to delete and simply fails the unlink.
pub async fn sweep_stale_scratch_dirs() -> usize {
    sweep_scratch_older_than(SCRATCH_STALE_AFTER).await
}

/// [`sweep_stale_scratch_dirs`] with an explicit age, so a test can collect a
/// scratch it just created instead of waiting a day.
async fn sweep_scratch_older_than(max_age: std::time::Duration) -> usize {
    let Ok(mut entries) = tokio::fs::read_dir(std::env::temp_dir()).await else {
        return 0;
    };
    let mut removed = 0;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if !name.starts_with("jan-agent-") {
            continue;
        }
        // `symlink_metadata`: a symlink named like a scratch is not one, and
        // following it would delete whatever it points at.
        let Ok(meta) = tokio::fs::symlink_metadata(entry.path()).await else {
            continue;
        };
        if meta.file_type().is_symlink() || !meta.is_dir() {
            continue;
        }
        let stale = meta
            .modified()
            .ok()
            .and_then(|m| m.elapsed().ok())
            .is_some_and(|age| age >= max_age);
        if stale && tokio::fs::remove_dir_all(entry.path()).await.is_ok() {
            removed += 1;
        }
    }
    removed
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

    /// A scratch whose owner died (kill -9, power loss) has nobody left to
    /// remove it and no `keep` list to rebuild, so the startup sweep collects it
    /// by age. Nothing else in the temp dir is touched, and a fresh scratch
    /// survives the real 24h threshold.
    #[tokio::test]
    async fn stale_scratch_dirs_are_swept_and_fresh_ones_are_not() {
        let session = format!("sweep-stale-{}", std::process::id());
        let orphan = ensure_scratch_dir(&session).await.unwrap();
        std::fs::write(orphan.join("spill.txt"), b"leaked").unwrap();
        let bystander = std::env::temp_dir().join(format!("not-a-scratch-{session}"));
        std::fs::create_dir_all(&bystander).unwrap();

        assert_eq!(sweep_stale_scratch_dirs().await, 0, "a fresh scratch is live");
        assert!(orphan.is_dir());

        assert!(sweep_scratch_older_than(std::time::Duration::ZERO).await >= 1);
        assert!(!orphan.exists(), "an abandoned scratch must be collected");
        assert!(bystander.is_dir(), "swept a directory that is not a scratch");

        let _ = std::fs::remove_dir_all(&bystander);
    }

    /// The scratch root must never be a pre-planted symlink to another
    /// directory: the sandbox binds it as `/tmp`, so trusting a redirect would
    /// sanction an attacker-selected directory as the session's scratch.
    #[cfg(unix)]
    #[tokio::test]
    async fn scratch_root_refuses_a_pre_planted_symlink() {
        let dir = unique_data_folder();
        let outside = unique_data_folder();
        std::os::unix::fs::symlink(&outside, &dir).unwrap();
        let r = ensure_scratch_dir_path(&dir).await;
        assert!(r.is_err(), "symlinked scratch root accepted: {:?}", r);
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// A freshly created scratch root is a real, restrictive directory.
    #[cfg(unix)]
    #[tokio::test]
    async fn scratch_root_creation_is_a_real_private_dir() {
        use std::os::unix::fs::PermissionsExt;
        let dir = unique_data_folder();
        let r = ensure_scratch_dir_path(&dir).await;
        assert_eq!(r.unwrap(), dir);
        let meta = std::fs::symlink_metadata(&dir).unwrap();
        assert!(!meta.file_type().is_symlink());
        assert!(meta.is_dir());
        assert_eq!(meta.permissions().mode() & 0o777, 0o700);
        let _ = std::fs::remove_dir_all(&dir);
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
