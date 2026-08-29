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

/// Where Cowork session sandboxes live, a sibling of `threads/`.
///
/// Separate from `threads/` because a Cowork session is not a chat thread and
/// the two id spaces are independent. The separation is also what makes the
/// thread sweep safe: it reads only `threads_dir`, so it structurally cannot see
/// a session workspace, whatever `keep` list it is handed.
const SESSIONS: &str = "sessions";

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

/// Where per-session sandboxes live: `<permanent_store>/sessions`.
pub fn sessions_dir(jan_data_folder: &Path) -> PathBuf {
    permanent_store(jan_data_folder).join(SESSIONS)
}

/// A Cowork session's sandbox root:
/// `<jan_data_folder>/agent-workspace/sessions/<session_id>`.
pub fn session_workspace(jan_data_folder: &Path, session_id: &str) -> Result<PathBuf, String> {
    Ok(sessions_dir(jan_data_folder).join(thread_segment(session_id)?))
}

/// A thread's ephemeral sandbox root:
/// `<jan_data_folder>/agent-workspace/threads/<thread_id>`.
pub fn thread_workspace(jan_data_folder: &Path, thread_id: &str) -> Result<PathBuf, String> {
    Ok(threads_dir(jan_data_folder).join(thread_segment(thread_id)?))
}

/// Case-folded on Windows, where two spellings of one path are the same path
/// and a raw `starts_with` would let a rename past the check.
fn containment_key(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        raw.to_lowercase()
    } else {
        raw
    }
}

fn is_within(inner: &Path, outer: &Path) -> bool {
    let (inner, outer) = (containment_key(inner), containment_key(outer));
    inner == outer || inner.starts_with(&format!("{}/", outer.trim_end_matches('/')))
}

/// Validate a folder the user asked to attach read-only, returning its
/// canonical form.
///
/// Refused rather than silently degraded, because every rejection here is a
/// case where the mount would not mean what the UI says it means:
///
/// - a root that does not exist would have the sandbox fail later, at a point
///   the user cannot connect to their choice;
/// - a root containing the workspace would shadow it, and would also make
///   `escapes_project` start returning false for the whole tree;
/// - a root inside the workspace is already writable, so calling it read-only
///   would be a lie;
/// - a root containing the Jan data folder would re-expose `settings.json` and
///   the provider keys the mask exists to hide;
/// - the filesystem root has no meaningful "outside" left to protect.
pub fn validate_read_root(
    root: &Path,
    workspace: &Path,
    mask_root: Option<&Path>,
) -> Result<PathBuf, String> {
    let canonical = root
        .canonicalize()
        .map_err(|e| format!("attached folder {} is unreadable: {e}", root.display()))?;
    if !canonical.is_dir() {
        return Err(format!("{} is not a folder", canonical.display()));
    }
    if canonical.parent().is_none() {
        return Err("the filesystem root cannot be attached".to_string());
    }
    // The workspace may not exist yet on the first call; compare lexically
    // against whatever form we have rather than failing the attach for it.
    let workspace_key = workspace
        .canonicalize()
        .unwrap_or_else(|_| workspace.to_path_buf());
    if is_within(&workspace_key, &canonical) || is_within(&canonical, &workspace_key) {
        return Err(format!(
            "{} overlaps the agent workspace and cannot be mounted read-only",
            canonical.display()
        ));
    }
    if let Some(mask) = mask_root {
        let mask = mask.canonicalize().unwrap_or_else(|_| mask.to_path_buf());
        if is_within(&mask, &canonical) {
            return Err(format!(
                "{} contains the Jan data folder and cannot be attached",
                canonical.display()
            ));
        }
    }
    Ok(canonical)
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
                _ => {
                    return Err(format!(
                        "ERROR: scratch path {:?} is not a real directory",
                        dir
                    ))
                }
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
    ensure_workspace_at(thread_workspace(jan_data_folder, thread_id)?).await
}

/// Create a Cowork session's sandbox (idempotent) and return it.
pub async fn ensure_session_workspace(
    jan_data_folder: &Path,
    session_id: &str,
) -> Result<PathBuf, String> {
    ensure_workspace_at(session_workspace(jan_data_folder, session_id)?).await
}

async fn ensure_workspace_at(dir: PathBuf) -> Result<PathBuf, String> {
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
    remove_workspace_at(thread_workspace(jan_data_folder, thread_id)?, thread_id).await
}

/// Delete a Cowork session's sandbox. Idempotent: a missing sandbox is Ok.
pub async fn remove_session_workspace(
    jan_data_folder: &Path,
    session_id: &str,
) -> Result<(), String> {
    remove_workspace_at(session_workspace(jan_data_folder, session_id)?, session_id).await
}

async fn remove_workspace_at(dir: PathBuf, id: &str) -> Result<(), String> {
    crate::tools::appcontainer::release(&dir);
    match tokio::fs::remove_dir_all(&dir).await {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("ERROR: {e}")),
    }
    // Wipe the host-temp scratch keyed to the same id.
    let _ = remove_scratch_dir(id).await;
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
    sweep_workspaces_in(threads_dir(jan_data_folder), keep).await
}

/// Delete every Cowork session sandbox whose id is not in `keep`.
///
/// Reads only `sessions_dir`, so it can never reach a chat thread's sandbox, and
/// the thread sweep can never reach a session's.
pub async fn sweep_session_workspaces(
    jan_data_folder: &Path,
    keep: &[String],
) -> Result<usize, String> {
    sweep_workspaces_in(sessions_dir(jan_data_folder), keep).await
}

async fn sweep_workspaces_in(dir: PathBuf, keep: &[String]) -> Result<usize, String> {
    // An empty keep list means "delete everything here", which is never what a
    // caller wants and is exactly what a failed load or a first-run race
    // produces. The sandbox may hold the only copy of the agent's work, so this
    // fails safe: callers that genuinely want a full wipe remove ids one by one.
    if keep.is_empty() {
        return Ok(0);
    }
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
            // Wipe the host-temp scratch keyed to this id.
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

/// Serialises tests that touch the *global* scratch namespace.
///
/// `sweep_scratch_older_than` collects every scratch dir in the shared host temp
/// dir, so running it beside a test that needs its own scratch alive is a race:
/// the sweep deletes the directory the other test is mid-way through using. Any
/// test that either sweeps or depends on a live scratch takes this first.
#[cfg(test)]
pub(crate) static SCRATCH_NAMESPACE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Take [`SCRATCH_NAMESPACE_LOCK`], ignoring poisoning: a panic in one test must
/// not cascade into unrelated failures in every other one.
#[cfg(test)]
pub(crate) fn lock_scratch_namespace() -> std::sync::MutexGuard<'static, ()> {
    SCRATCH_NAMESPACE_LOCK
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn tmp_root(tag: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!("jan_{tag}_{}_{}", std::process::id(), n))
    }

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
    #[allow(clippy::await_holding_lock)]
    async fn stale_scratch_dirs_are_swept_and_fresh_ones_are_not() {
        let session = format!("sweep-stale-{}", std::process::id());
        let _guard = lock_scratch_namespace();
        let orphan = ensure_scratch_dir(&session).await.unwrap();
        std::fs::write(orphan.join("spill.txt"), b"leaked").unwrap();
        let bystander = std::env::temp_dir().join(format!("not-a-scratch-{session}"));
        std::fs::create_dir_all(&bystander).unwrap();

        assert_eq!(
            sweep_stale_scratch_dirs().await,
            0,
            "a fresh scratch is live"
        );
        assert!(orphan.is_dir());

        assert!(sweep_scratch_older_than(std::time::Duration::ZERO).await >= 1);
        assert!(!orphan.exists(), "an abandoned scratch must be collected");
        assert!(
            bystander.is_dir(),
            "swept a directory that is not a scratch"
        );

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
    // Every rejection here is a case where the mount would not mean what the UI
    // says it means, so each is refused rather than silently degraded.
    #[test]
    fn validate_read_root_accepts_a_plain_sibling_folder() {
        let base = tmp_root("vrr_ok");
        let ws = base.join("agent-workspace/threads/t1");
        let repo = base.join("repo");
        std::fs::create_dir_all(&ws).unwrap();
        std::fs::create_dir_all(&repo).unwrap();
        let out = validate_read_root(&repo, &ws, None).unwrap();
        assert_eq!(out, repo.canonicalize().unwrap());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn validate_read_root_refuses_a_folder_that_does_not_exist() {
        let base = tmp_root("vrr_missing");
        let ws = base.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        assert!(validate_read_root(&base.join("nope"), &ws, None).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn validate_read_root_refuses_a_file() {
        let base = tmp_root("vrr_file");
        let ws = base.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let file = base.join("a.txt");
        std::fs::write(&file, b"x").unwrap();
        assert!(validate_read_root(&file, &ws, None).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    /// A root containing the workspace would shadow it and would also make
    /// `escapes_project` start returning false for the whole tree.
    #[test]
    fn validate_read_root_refuses_an_ancestor_of_the_workspace() {
        let base = tmp_root("vrr_ancestor");
        let ws = base.join("agent-workspace/threads/t1");
        std::fs::create_dir_all(&ws).unwrap();
        assert!(validate_read_root(&base, &ws, None).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    /// A "read-only" root inside the writable workspace is a lie: writes there
    /// are already allowed.
    #[test]
    fn validate_read_root_refuses_a_descendant_of_the_workspace() {
        let base = tmp_root("vrr_descendant");
        let ws = base.join("ws");
        let inner = ws.join("inner");
        std::fs::create_dir_all(&inner).unwrap();
        assert!(validate_read_root(&inner, &ws, None).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    /// Attaching a folder that contains the Jan data folder would re-expose
    /// settings.json and the provider keys the mask exists to hide.
    #[test]
    fn validate_read_root_refuses_a_root_containing_the_data_folder() {
        let base = tmp_root("vrr_mask");
        let data = base.join("jan-data");
        let ws = data.join("agent-workspace/threads/t1");
        std::fs::create_dir_all(&ws).unwrap();
        assert!(validate_read_root(&base, &ws, Some(&data)).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn validate_read_root_refuses_the_filesystem_root() {
        let base = tmp_root("vrr_fsroot");
        let ws = base.join("ws");
        std::fs::create_dir_all(&ws).unwrap();
        let root = if cfg!(windows) { "C:\\\\" } else { "/" };
        assert!(validate_read_root(Path::new(root), &ws, None).is_err());
        let _ = std::fs::remove_dir_all(&base);
    }
    // ---- session sandboxes -------------------------------------------------

    #[tokio::test]
    async fn sessions_live_beside_threads_not_inside_them() {
        let data = unique_data_folder();
        let t = ensure_thread_workspace(&data, "id-1").await.unwrap();
        let s = ensure_session_workspace(&data, "id-1").await.unwrap();
        assert_ne!(t, s, "the same id in each space is two directories");
        assert!(!s.starts_with(&t));
        assert!(!t.starts_with(&s));
        assert_eq!(s.parent().unwrap(), sessions_dir(&data));
        let _ = std::fs::remove_dir_all(&data);
    }

    /// The reason for the separate namespace: the thread sweep is handed the
    /// live *thread* ids, which say nothing about which sessions exist. Sharing
    /// one directory would have it delete every session's work.
    #[tokio::test]
    async fn the_two_sweeps_cannot_reach_each_other() {
        let data = unique_data_folder();
        ensure_thread_workspace(&data, "thread-live").await.unwrap();
        let session = ensure_session_workspace(&data, "session-live")
            .await
            .unwrap();
        std::fs::write(session.join("work.txt"), b"the only copy").unwrap();

        // A thread sweep that knows nothing about sessions.
        sweep_thread_workspaces(&data, &["thread-live".to_string()])
            .await
            .unwrap();
        assert!(session.join("work.txt").exists(), "session work survived");

        // And the reverse.
        sweep_session_workspaces(&data, &["session-live".to_string()])
            .await
            .unwrap();
        assert!(thread_workspace(&data, "thread-live").unwrap().is_dir());

        let _ = std::fs::remove_dir_all(&data);
    }

    #[tokio::test]
    async fn a_session_sweep_collects_only_dead_sessions() {
        let data = unique_data_folder();
        ensure_session_workspace(&data, "live").await.unwrap();
        ensure_session_workspace(&data, "dead").await.unwrap();
        let removed = sweep_session_workspaces(&data, &["live".to_string()])
            .await
            .unwrap();
        assert_eq!(removed, 1);
        assert!(session_workspace(&data, "live").unwrap().is_dir());
        assert!(!session_workspace(&data, "dead").unwrap().exists());
        let _ = std::fs::remove_dir_all(&data);
    }

    /// An empty keep list is what a failed load or a first-run race produces,
    /// and the sandbox may hold the only copy of the agent's work. Deleting
    /// everything is never the intent, so it fails safe.
    #[tokio::test]
    async fn an_empty_keep_list_wipes_nothing() {
        let data = unique_data_folder();
        let t = ensure_thread_workspace(&data, "t").await.unwrap();
        let s = ensure_session_workspace(&data, "s").await.unwrap();

        assert_eq!(sweep_thread_workspaces(&data, &[]).await.unwrap(), 0);
        assert_eq!(sweep_session_workspaces(&data, &[]).await.unwrap(), 0);
        assert!(t.is_dir(), "thread sandbox survived an empty keep list");
        assert!(s.is_dir(), "session sandbox survived an empty keep list");

        let _ = std::fs::remove_dir_all(&data);
    }

    #[tokio::test]
    async fn session_workspace_lifecycle_is_idempotent() {
        let data = unique_data_folder();
        let dir = ensure_session_workspace(&data, "s1").await.unwrap();
        assert!(dir.is_dir());
        ensure_session_workspace(&data, "s1").await.unwrap();
        remove_session_workspace(&data, "s1").await.unwrap();
        assert!(!dir.exists());
        remove_session_workspace(&data, "s1").await.unwrap();
        let _ = std::fs::remove_dir_all(&data);
    }

    #[test]
    fn session_ids_are_sanitized_like_thread_ids() {
        for bad in ["../escape", "a/b", "..", ""] {
            assert!(
                session_workspace(Path::new("/data"), bad).is_err(),
                "expected {bad:?} to be rejected"
            );
        }
    }
}
