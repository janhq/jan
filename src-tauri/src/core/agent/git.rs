//! Git-backed workspace snapshots (ticket #164). The agent edits files in place
//! in the user's working directory; to make a run revertible we snapshot the
//! state after each turn and can restore it, Claude-Code style.
//!
//! Snapshots never scan the working tree. Each checkpoint stages only the exact
//! paths the caller reports as touched this turn (`edit`/`write` tool calls);
//! the base snapshot seeds from the current `HEAD` tree plus a `git diff
//! --name-only HEAD` (tracked files only -- no untracked-file walk). This keeps
//! cost bounded by what actually changed instead of the size of the repo, which
//! matters on large trees or ones with big non-ignored build/model directories.
//! A known trade-off: changes made by other means (a `bash` tool call, an
//! external editor) are not captured unless also reported via `changed`.
//!
//! Snapshots are kept OUT of the user's branch, HEAD, and index: we stage into a
//! throwaway index file (`GIT_INDEX_FILE`) and build commit objects with
//! `commit-tree`, reachable only from a hidden `refs/jan/agent/snapshots/<id>`
//! ref. The user's `git status`, current branch, and staged changes are never
//! touched. Shelling out keeps us free of a libgit2 dependency.

use std::path::Path;
#[cfg(any(feature = "cli", test))]
use std::path::PathBuf;
use std::process::Command;


/// Run `git` with literal args (callers pass their own `-C`). Returns trimmed
/// stdout on success, trimmed stderr (or a generic message) on failure.
fn git(args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .args(args)
        .output()
        .map_err(|e| format!("failed to launch git: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            format!("git {} failed", args.first().copied().unwrap_or(""))
        } else {
            stderr
        })
    }
}

/// Run a repo-scoped `git` (`-C <repo>`), optionally against a throwaway index,
/// with a fixed agent identity so `commit-tree` never needs user config and
/// never triggers commit signing.
#[cfg(feature = "cli")]
fn run(repo: &Path, index: Option<&Path>, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo).args(args);
    cmd.env("GIT_AUTHOR_NAME", "Jan Agent")
        .env("GIT_AUTHOR_EMAIL", "agent@jan.ai")
        .env("GIT_COMMITTER_NAME", "Jan Agent")
        .env("GIT_COMMITTER_EMAIL", "agent@jan.ai");
    if let Some(idx) = index {
        cmd.env("GIT_INDEX_FILE", idx);
    }
    let out = cmd.output().map_err(|e| format!("failed to launch git: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            format!("git {} failed", args.first().copied().unwrap_or(""))
        } else {
            stderr
        })
    }
}

/// A unique throwaway index path so one-off git operations (restore) never
/// disturb the real index.
#[cfg(feature = "cli")]
fn temp_index() -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    std::env::temp_dir().join(format!("jan-agent-idx-{}-{n}", std::process::id()))
}

/// A stable index path for a thread's snapshot chain, kept across calls (not
/// deleted after use). Reusing it lets `git add -A` compare against its own
/// prior stat cache instead of a fresh empty one, so unchanged files are only
/// stat'd (cheap) rather than re-hashed and re-inserted like every other file
/// touched this turn.
#[cfg(feature = "cli")]
fn snapshot_index(thread_id: &str) -> PathBuf {
    std::env::temp_dir().join(format!("jan-agent-snap-idx-{thread_id}"))
}

/// Hidden ref that keeps a thread's snapshot chain reachable across GC. One ref
/// per thread; each snapshot parents the previous, so the whole chain is live.
#[cfg(feature = "cli")]
pub(crate) fn snapshot_ref(thread_id: &str) -> String {
    format!("refs/jan/agent/snapshots/{thread_id}")
}

/// The repository top-level for `path`, or `None` when `path` is not inside a
/// git work tree (workspace-restore is unavailable then; the agent still edits
/// in place). Also `None` when `git` is not installed.
#[cfg(feature = "cli")]
pub(crate) fn repo_root(path: &Path) -> Option<PathBuf> {
    let p = path.to_string_lossy();
    git(&["-C", &p, "rev-parse", "--show-toplevel"])
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
}

/// The current branch name for the repo containing `path`, or `None` when
/// `path` is not inside a git work tree, `git` is not installed, or `HEAD` is
/// detached (no symbolic branch). A detached `HEAD` yields the empty string
/// from `--abbrev-ref`, filtered out here.
pub(crate) fn current_branch(path: &Path) -> Option<String> {
    let p = path.to_string_lossy();
    git(&["-C", &p, "rev-parse", "--abbrev-ref", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != "HEAD")
}

/// The canonical empty tree object every git repo has, without needing a
/// commit to hash it from -- used as the base tree when `HEAD` is unborn.
#[cfg(feature = "cli")]
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/// Stage a single relative path into `idx`: `add` if it still exists on disk,
/// `rm --cached` (ignoring paths not currently tracked) if it was deleted.
/// Never touches any other path, so cost is O(1) per call, not O(repo size).
#[cfg(feature = "cli")]
fn stage_path(repo: &Path, idx: &Path, rel: &Path) -> Result<(), String> {
    let rel_str = rel.to_string_lossy();
    if repo.join(rel).exists() {
        run(repo, Some(idx), &["add", "--", &rel_str])?;
    } else {
        run(repo, Some(idx), &["rm", "--cached", "--ignore-unmatch", "--", &rel_str])?;
    }
    Ok(())
}

/// Snapshot the current state as a commit object, without touching the user's
/// branch/HEAD/index, and without ever scanning the whole working tree.
/// `parent` chains onto the previous snapshot; `None` for the base. `changed`
/// lists paths (relative to `repo`) touched since the previous snapshot in
/// this thread's chain -- only these are staged. Returns the snapshot sha.
///
/// `thread_id` keys a persistent throwaway index reused across a thread's
/// whole snapshot chain, seeded once (base) from `HEAD`'s tree (or the empty
/// tree for an unborn `HEAD`) plus any already-dirty tracked files (via `git
/// diff --name-only HEAD`, which compares only tracked paths -- no untracked
/// scan). Every later checkpoint reuses that same index and stages only
/// `changed`.
#[cfg(feature = "cli")]
pub(crate) fn snapshot(
    repo: &Path,
    parent: Option<&str>,
    msg: &str,
    thread_id: &str,
    changed: &[PathBuf],
) -> Result<String, String> {
    let idx = snapshot_index(thread_id);
    if !idx.exists() {
        let base_tree = run(repo, None, &["rev-parse", "--verify", "-q", "HEAD^{tree}"])
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| EMPTY_TREE.to_string());
        run(repo, Some(&idx), &["read-tree", &base_tree])?;
        if let Ok(dirty) = run(repo, None, &["diff", "--name-only", "HEAD"]) {
            for rel in dirty.lines().filter(|l| !l.is_empty()) {
                stage_path(repo, &idx, Path::new(rel))?;
            }
        }
    }
    for rel in changed {
        stage_path(repo, &idx, rel)?;
    }
    let tree = run(repo, Some(&idx), &["write-tree"])?;
    let mut args = vec!["commit-tree", &tree];
    if let Some(p) = parent {
        args.push("-p");
        args.push(p);
    }
    args.push("-m");
    args.push(msg);
    run(repo, None, &args)
}

/// Drop a thread's persistent snapshot index (e.g. once the thread is done or
/// after a workspace restore invalidates it). Safe to call even if it was
/// never created.
#[cfg(feature = "cli")]
pub(crate) fn cleanup_snapshot_index(thread_id: &str) {
    let _ = std::fs::remove_file(snapshot_index(thread_id));
}

/// Point the thread's snapshot ref at `sha` (create or update).
#[cfg(feature = "cli")]
pub(crate) fn update_ref(repo: &Path, thread_id: &str, sha: &str) -> Result<(), String> {
    run(repo, None, &["update-ref", &snapshot_ref(thread_id), sha]).map(|_| ())
}

/// Restore the working tree to snapshot `target`, discarding changes made after
/// it. `latest` (the newest snapshot) is used only to find files added since
/// `target` so they can be removed. Files matching `.gitignore` are untouched.
#[cfg(feature = "cli")]
pub(crate) fn restore(repo: &Path, target: &str, latest: &str) -> Result<(), String> {
    let idx = temp_index();
    let result = (|| {
        run(repo, Some(&idx), &["read-tree", target])?;
        run(repo, Some(&idx), &["checkout-index", "-a", "-f"])?;
        if target != latest {
            let added = run(
                repo,
                None,
                &["diff", "--name-only", "--diff-filter=A", target, latest],
            )?;
            for rel in added.lines().filter(|l| !l.is_empty()) {
                let _ = std::fs::remove_file(repo.join(rel));
            }
        }
        Ok(())
    })();
    let _ = std::fs::remove_file(&idx);
    result
}

#[cfg(all(test, feature = "cli"))]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;
    use std::sync::atomic::AtomicU32;

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// Init a throwaway repo with one commit, or `None` if git is unavailable so
    /// the suite skips instead of failing on a box without git.
    fn init_repo() -> Option<PathBuf> {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!("jan_snap_test_{}_{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).ok()?;
        let r = root.to_string_lossy().to_string();
        git(&["-C", &r, "init", "-q"]).ok()?;
        std::fs::write(root.join(".gitignore"), "ignored/\n").ok()?;
        std::fs::write(root.join("a.txt"), "one\n").ok()?;
        run(&root, None, &["add", "-A"]).ok()?;
        // --no-gpg-sign: this is a throwaway test repo, so signing (which
        // needs the developer's own key/passphrase and would hang or fail on
        // a box without one configured) is irrelevant and must be off.
        run(&root, None, &["commit", "-q", "-m", "init", "--no-gpg-sign"]).ok()?;
        repo_root(&root)
    }

    #[test]
    fn snapshot_restore_roundtrip() {
        let Some(root) = init_repo() else { return };

        let thread_id = "test-thread";
        let base = snapshot(&root, None, "base", thread_id, &[]).expect("base snapshot");

        // Mutate: edit a file, add a new one, and drop something into an ignored dir.
        std::fs::write(root.join("a.txt"), "two\n").unwrap();
        std::fs::write(root.join("b.txt"), "new\n").unwrap();
        std::fs::create_dir_all(root.join("ignored")).unwrap();
        std::fs::write(root.join("ignored/keep.txt"), "keep\n").unwrap();

        let changed = [PathBuf::from("a.txt"), PathBuf::from("b.txt")];
        let turn =
            snapshot(&root, Some(&base), "turn 1", thread_id, &changed).expect("turn snapshot");
        assert_ne!(turn, base);

        // Restore to base: a.txt reverts, b.txt (added) is removed, ignored file stays.
        restore(&root, &base, &turn).expect("restore");
        assert_eq!(std::fs::read_to_string(root.join("a.txt")).unwrap(), "one\n");
        assert!(!root.join("b.txt").exists(), "added file must be removed");
        assert!(
            root.join("ignored/keep.txt").exists(),
            "gitignored file must be left alone"
        );
        cleanup_snapshot_index(thread_id);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn snapshot_is_invisible_to_user_state() {
        let Some(root) = init_repo() else { return };
        let thread_id = "test-thread-2";
        std::fs::write(root.join("a.txt"), "dirty\n").unwrap();
        let _ = snapshot(&root, None, "s", thread_id, &[]).expect("snapshot");
        // The user's index/branch are untouched: HEAD still the init commit and the
        // working change is still unstaged.
        let staged = run(&root, None, &["diff", "--cached", "--name-only"]).unwrap();
        assert!(staged.is_empty(), "snapshot must not stage anything");
        cleanup_snapshot_index(thread_id);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn base_snapshot_picks_up_preexisting_dirty_tracked_file() {
        let Some(root) = init_repo() else { return };
        let thread_id = "test-thread-dirty-base";

        // Dirty *before* the agent starts -- no tool call reported it, so the
        // base must still capture it via the tracked-only diff, not `changed`.
        std::fs::write(root.join("a.txt"), "dirty-at-start\n").unwrap();
        let base = snapshot(&root, None, "base", thread_id, &[]).expect("base snapshot");

        let head_tree = run(&root, None, &["rev-parse", "HEAD^{tree}"]).unwrap();
        let base_tree = run(&root, None, &["rev-parse", &format!("{base}^{{tree}}")]).unwrap();
        assert_ne!(base_tree, head_tree, "base tree must include the pre-existing dirty edit");

        cleanup_snapshot_index(thread_id);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn checkpoint_only_stages_reported_paths() {
        let Some(root) = init_repo() else { return };
        let thread_id = "test-thread-3";

        let base = snapshot(&root, None, "base", thread_id, &[]).expect("base snapshot");
        let idx = snapshot_index(thread_id);
        assert!(idx.exists(), "base snapshot should persist its index");

        // Two files change on disk, but only one is reported as touched; the
        // checkpoint must reflect just that one.
        std::fs::write(root.join("a.txt"), "two\n").unwrap();
        std::fs::write(root.join("untouched.txt"), "not reported\n").unwrap();
        let changed = [PathBuf::from("a.txt")];
        let turn =
            snapshot(&root, Some(&base), "turn 1", thread_id, &changed).expect("turn snapshot");
        assert_ne!(turn, base);

        let listed = run(&root, None, &["ls-tree", "-r", "--name-only", &turn]).unwrap();
        assert!(listed.lines().any(|l| l == "a.txt"));
        assert!(
            !listed.lines().any(|l| l == "untouched.txt"),
            "unreported path must not be staged even though it changed on disk"
        );

        cleanup_snapshot_index(thread_id);
        assert!(!idx.exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn repo_root_is_none_outside_git() {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("jan_nogit_{}_{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        if repo_root(&std::env::temp_dir()).is_none() {
            assert!(repo_root(&dir).is_none());
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
