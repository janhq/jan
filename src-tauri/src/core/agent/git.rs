//! Git-backed workspace snapshots. The agent edits files in place in the
//! directory it works in; to make a run revertible we snapshot the state after
//! each turn and can restore it, Claude-Code style.
//!
//! That directory is the user's own checkout by default, and a dedicated
//! worktree when the session asked for one (`core::cli::worktree`), which the
//! snapshots follow: the worktree isolates the files, these snapshots make the
//! turns inside it revertible. The worktree primitives below are the git side
//! of that, kept here because this module owns every `git` invocation.
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
#[cfg(feature = "cli")]
use std::path::PathBuf;
use std::process::Command;

/// A `git` command, resolved by [`jan_utils::git_program`] so Windows never
/// runs a `git.exe` from Jan's own folder.
fn git_command() -> Result<Command, String> {
    jan_utils::git_program()
        .map(Command::new)
        .map_err(|e| format!("failed to launch git: {e}"))
}

/// Run `git` with literal args (callers pass their own `-C`). Returns trimmed
/// stdout on success, trimmed stderr (or a generic message) on failure.
fn git(args: &[&str]) -> Result<String, String> {
    let out = git_command()?
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
    let mut cmd = repo_command(repo, args)?;
    if let Some(idx) = index {
        cmd.env("GIT_INDEX_FILE", idx);
    }
    let out = cmd.output().map_err(|e| format!("failed to launch git: {e}"))?;
    outcome(&out, args)
}

/// `git -C <repo> <args>` with the fixed agent identity [`run`] describes.
#[cfg(feature = "cli")]
fn repo_command(repo: &Path, args: &[&str]) -> Result<Command, String> {
    let mut cmd = git_command()?;
    cmd.arg("-C").arg(repo).args(args);
    cmd.env("GIT_AUTHOR_NAME", "Jan Agent")
        .env("GIT_AUTHOR_EMAIL", "agent@jan.ai")
        .env("GIT_COMMITTER_NAME", "Jan Agent")
        .env("GIT_COMMITTER_EMAIL", "agent@jan.ai");
    Ok(cmd)
}

/// [`run`] for a command that talks to a remote, which may never answer:
/// past `limit` the command and every helper it started (a remote helper, an
/// `ext::` transport's shell) are killed and this errors. It never prompts,
/// since nobody is at a terminal to answer.
#[cfg(feature = "cli")]
fn run_limited(repo: &Path, args: &[&str], limit: std::time::Duration) -> Result<String, String> {
    use std::io::Read;
    use std::process::Stdio;
    let mut cmd = repo_command(repo, args)?;
    cmd.env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Its own process group, so a timeout reaches the helpers too: killing
    // only git would leave them running, holding its pipes open.
    #[cfg(unix)]
    std::os::unix::process::CommandExt::process_group(&mut cmd, 0);
    let mut child = cmd.spawn().map_err(|e| format!("failed to launch git: {e}"))?;
    // Drained while it runs, or a chatty command fills a pipe and never exits.
    let drain = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut pipe) = pipe {
                let _ = pipe.read_to_end(&mut buf);
            }
            buf
        })
    };
    let stdout = drain(child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let stderr = drain(child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>));
    let deadline = std::time::Instant::now() + limit;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            waited => {
                kill_tree(&mut child);
                // The drain threads are left to finish on their own: a helper
                // outside the group could still hold a pipe open.
                return Err(match waited {
                    Err(e) => format!("failed to wait for git: {e}"),
                    _ => format!(
                        "git {} timed out after {}s",
                        args.first().copied().unwrap_or(""),
                        limit.as_secs()
                    ),
                });
            }
        }
    };
    let out = std::process::Output {
        status,
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
    };
    outcome(&out, args)
}

/// Kill `child` and the process group it leads, then reap it.
#[cfg(feature = "cli")]
fn kill_tree(child: &mut std::process::Child) {
    #[cfg(unix)]
    if let Ok(id) = i32::try_from(child.id()) {
        let _ = nix::sys::signal::killpg(
            nix::unistd::Pid::from_raw(id),
            nix::sys::signal::Signal::SIGKILL,
        );
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Trimmed stdout of a git that succeeded, else its trimmed stderr (or a
/// generic message naming the subcommand).
#[cfg(feature = "cli")]
fn outcome(out: &std::process::Output, args: &[&str]) -> Result<String, String> {
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
/// touched this turn. The id goes into a file name, so it must pass
/// [`validate_index_key`].
#[cfg(feature = "cli")]
fn snapshot_index(thread_id: &str) -> Result<PathBuf, String> {
    validate_index_key(thread_id)?;
    Ok(std::env::temp_dir().join(format!("jan-agent-snap-idx-{thread_id}")))
}

/// Prefix of the one-shot index key a fork uses for its source thread.
#[cfg(feature = "cli")]
pub(crate) const FORK_BASE_KEY_PREFIX: &str = "fork-base-";

/// A snapshot index key is a thread id, or [`FORK_BASE_KEY_PREFIX`] followed
/// by one. The id part must pass
/// [`validate_thread_id`](crate::core::threads::utils::validate_thread_id), so
/// the prefix does not count against its length limit.
#[cfg(feature = "cli")]
fn validate_index_key(key: &str) -> Result<(), String> {
    let id = key.strip_prefix(FORK_BASE_KEY_PREFIX).unwrap_or(key);
    crate::core::threads::utils::validate_thread_id(id)
}

/// Hidden ref that keeps a thread's snapshot chain reachable across GC. One ref
/// per thread; each snapshot parents the previous, so the whole chain is live.
/// The id goes into a ref name, so it must pass
/// [`validate_thread_id`](crate::core::threads::utils::validate_thread_id).
#[cfg(feature = "cli")]
pub(crate) fn snapshot_ref(thread_id: &str) -> Result<String, String> {
    crate::core::threads::utils::validate_thread_id(thread_id)?;
    Ok(format!("refs/jan/agent/snapshots/{thread_id}"))
}

/// True when git tracks any file under `path` (a directory in a work tree).
/// `false` outside a repo, for an untracked or ignored directory, and when `git`
/// is not installed -- callers use it to avoid deleting files a team shares.
pub(crate) fn tracks_any(path: &Path) -> bool {
    let (Some(dir), Some(name)) = (path.parent(), path.file_name()) else {
        return false;
    };
    let dir = dir.to_string_lossy();
    let name = name.to_string_lossy();
    git(&["-C", &dir, "ls-files", "--", &name])
        .map(|out| !out.is_empty())
        .unwrap_or(false)
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
/// `force_add` is reserved for paths proven tracked by `git diff --name-only
/// HEAD`: a later .gitignore rule must not prevent the base snapshot from
/// preserving their dirty state. Never touches any other path, so cost is O(1)
/// per call, not O(repo size).
#[cfg(feature = "cli")]
fn stage_path(repo: &Path, idx: &Path, rel: &Path, force_add: bool) -> Result<(), String> {
    let rel_str = rel.to_string_lossy();
    if repo.join(rel).exists() {
        if force_add {
            run(repo, Some(idx), &["add", "-f", "--", &rel_str])?;
        } else {
            run(repo, Some(idx), &["add", "--", &rel_str])?;
        }
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
    if let Some(p) = parent {
        require_object_id(p)?;
    }
    let idx = snapshot_index(thread_id)?;
    if !idx.exists() {
        let base_tree = run(repo, None, &["rev-parse", "--verify", "-q", "HEAD^{tree}"])
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| EMPTY_TREE.to_string());
        run(repo, Some(&idx), &["read-tree", &base_tree])?;
        if let Ok(dirty) = run(repo, None, &["diff", "--name-only", "HEAD"]) {
            for rel in dirty.lines().filter(|l| !l.is_empty()) {
                stage_path(repo, &idx, Path::new(rel), true)?;
            }
        }
    }
    for rel in changed {
        stage_path(repo, &idx, rel, false)?;
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
    if let Ok(idx) = snapshot_index(thread_id) {
        let _ = std::fs::remove_file(idx);
    }
}

/// Whether `s` is a full git object id: 40 (SHA-1) or 64 (SHA-256) lowercase
/// hex digits. Snapshot ids are read back from thread metadata on disk, so
/// every one is checked before it reaches a git command line, where a value
/// like `--index-output=<path>` would be taken as an option.
#[cfg(feature = "cli")]
pub(crate) fn is_object_id(s: &str) -> bool {
    matches!(s.len(), 40 | 64) && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// `Ok` when `sha` is a full object id (see [`is_object_id`]).
#[cfg(feature = "cli")]
fn require_object_id(sha: &str) -> Result<(), String> {
    if is_object_id(sha) {
        Ok(())
    } else {
        Err(format!("not a snapshot id: {sha:?}"))
    }
}

/// Point the thread's snapshot ref at `sha` (create or update).
#[cfg(feature = "cli")]
pub(crate) fn update_ref(repo: &Path, thread_id: &str, sha: &str) -> Result<(), String> {
    require_object_id(sha)?;
    run(repo, None, &["update-ref", &snapshot_ref(thread_id)?, sha]).map(|_| ())
}

/// Restore the working tree to snapshot `target`, discarding changes made after
/// it. `latest` (the newest snapshot) is used only to find files added since
/// `target` so they can be removed. Files matching `.gitignore` are untouched.
#[cfg(feature = "cli")]
pub(crate) fn restore(repo: &Path, target: &str, latest: &str) -> Result<(), String> {
    require_object_id(target)?;
    require_object_id(latest)?;
    let idx = temp_index();
    let result = (|| {
        run(repo, Some(&idx), &["read-tree", target])?;
        run(repo, Some(&idx), &["checkout-index", "-a", "-f"])?;
        if target != latest {
            let added = run(
                repo,
                None,
                &["diff", "--name-only", "--diff-filter=A", target, latest, "--"],
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

/// `HEAD`'s commit sha, or `None` on an unborn branch (or no git).
#[cfg(feature = "cli")]
pub(crate) fn head_sha(repo: &Path) -> Option<String> {
    run(repo, None, &["rev-parse", "HEAD"])
        .ok()
        .filter(|s| !s.is_empty())
}

/// Create a worktree at `path`, checking out a new branch `branch` starting at
/// `base` (a full commit id). The parent directory is created first: `git
/// worktree add` requires the path's parent to exist but refuses the path
/// itself to.
#[cfg(feature = "cli")]
pub(crate) fn worktree_add(
    repo: &Path,
    path: &Path,
    branch: &str,
    base: &str,
) -> Result<(), String> {
    require_object_id(base)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    run(
        repo,
        None,
        &[
            "worktree",
            "add",
            "-b",
            branch,
            "--",
            &path.to_string_lossy(),
            base,
        ],
    )
    .map(|_| ())
}

/// The worktree checkouts registered with `repo`, main worktree included.
///
/// Parsed from `--porcelain`, whose `worktree <path>` lines are the stable
/// machine-readable form; the human listing pads the path with the sha and
/// branch, which a path containing spaces makes ambiguous.
#[cfg(feature = "cli")]
pub(crate) fn worktree_paths(repo: &Path) -> Vec<PathBuf> {
    run(repo, None, &["worktree", "list", "--porcelain"])
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.strip_prefix("worktree "))
        .map(PathBuf::from)
        .collect()
}

/// Whether `path` is a checkout `repo` still knows about. Compared after
/// canonicalization, because git reports the resolved path and the caller's
/// copy came from a config file or a thread record.
#[cfg(feature = "cli")]
pub(crate) fn worktree_registered(repo: &Path, path: &Path) -> bool {
    let Ok(want) = path.canonicalize() else {
        return false;
    };
    worktree_paths(repo)
        .iter()
        .filter_map(|p| p.canonicalize().ok())
        .any(|p| p == want)
}

/// Whether a model-supplied ref (a dispatch's `{"ref": ...}`) is a plain
/// name git can neither read as an option nor as a refspec: no leading `-`
/// or `+`, no `:` (a `src:dst` refspec would let a fetch move any local
/// branch), no whitespace or control characters.
pub(crate) fn is_plain_ref(r: &str) -> bool {
    !r.is_empty()
        && !r.starts_with(['-', '+'])
        && !r.chars().any(|c| c == ':' || c.is_whitespace() || c.is_control())
}

/// The commit `rev` names in `repo`, or `None` when it names none or is not a
/// [plain ref](is_plain_ref).
#[cfg(feature = "cli")]
pub(crate) fn resolve_commit(repo: &Path, rev: &str) -> Option<String> {
    if !is_plain_ref(rev) {
        return None;
    }
    let spec = format!("{rev}^{{commit}}");
    run(repo, None, &["rev-parse", "--verify", "--quiet", "--end-of-options", &spec])
        .ok()
        .filter(|sha| is_object_id(sha))
}

/// Fetch `rev` from `origin` into `FETCH_HEAD` and return the commit it named,
/// for a ref the local repository does not have (`pull/9486/head`).
///
/// `rev` must be a [plain ref](is_plain_ref) that `git check-ref-format`
/// accepts, so it is never a refspec with a destination. `--refmap=` turns off
/// the remote-tracking update a configured `remote.origin.fetch` would make:
/// `FETCH_HEAD` is the only ref this writes.
#[cfg(feature = "cli")]
pub(crate) fn fetch_commit(
    repo: &Path,
    rev: &str,
    limit: std::time::Duration,
) -> Result<String, String> {
    if !is_plain_ref(rev) {
        return Err(format!("not a git ref: {rev:?}"));
    }
    run(repo, None, &["check-ref-format", "--allow-onelevel", rev])
        .map_err(|_| format!("not a git ref: {rev:?}"))?;
    run_limited(
        repo,
        &["fetch", "--quiet", "--no-tags", "--refmap=", "origin", "--", rev],
        limit,
    )?;
    resolve_commit(repo, "FETCH_HEAD").ok_or_else(|| format!("fetching {rev} named no commit"))
}

/// The git directory every checkout of `repo` shares (objects, refs, the
/// per-worktree admin dirs), canonicalized. A linked worktree's commit writes
/// here, not into the checkout, which is why a sandboxed writer needs it.
#[cfg(feature = "cli")]
pub(crate) fn git_common_dir(repo: &Path) -> Option<PathBuf> {
    let raw = run(repo, None, &["rev-parse", "--git-common-dir"]).ok()?;
    let dir = PathBuf::from(raw);
    let dir = if dir.is_absolute() { dir } else { repo.join(dir) };
    dir.canonicalize().ok()
}

/// Commits on `HEAD` of `worktree` that `base` does not have, or `None` when
/// git cannot say (then the caller must assume there is work to keep).
#[cfg(feature = "cli")]
pub(crate) fn commits_since(worktree: &Path, base: &str) -> Option<u64> {
    require_object_id(base).ok()?;
    run(worktree, None, &["rev-list", "--count", &format!("{base}..HEAD")])
        .ok()?
        .parse()
        .ok()
}

/// Remove the checkout at `path` and delete its `branch` (none for a detached
/// one), the inverse of [`worktree_add`]. Forced, because the caller has
/// already decided the checkout holds nothing worth keeping.
#[cfg(feature = "cli")]
pub(crate) fn worktree_remove(
    repo: &Path,
    path: &Path,
    branch: Option<&str>,
) -> Result<(), String> {
    run(
        repo,
        None,
        &["worktree", "remove", "--force", "--", &path.to_string_lossy()],
    )?;
    match branch {
        Some(branch) => run(repo, None, &["branch", "-D", "--", branch]).map(|_| ()),
        None => Ok(()),
    }
}

/// Forget worktree registrations whose directory the user has deleted. Without
/// this, `worktree add` refuses a path that a stale registration still claims.
#[cfg(feature = "cli")]
pub(crate) fn worktree_prune(repo: &Path) {
    let _ = run(repo, None, &["worktree", "prune"]);
}

/// Paths changed in a worktree relative to its own `HEAD`, staged, unstaged and
/// untracked alike (`status --porcelain`, whose status letters are stripped).
/// This is the "what has the agent done in there" summary, not a diff.
///
/// The status field is split off at its first space rather than by a fixed
/// width: `run` trims the output, so the leading space of an unstaged-only
/// line (` M a.txt`) is gone by the time this sees it and a fixed offset would
/// eat the first character of that one path.
#[cfg(feature = "cli")]
pub(crate) fn changed_paths(worktree: &Path) -> Vec<String> {
    try_changed_paths(worktree).unwrap_or_default()
}

/// [`changed_paths`], but a `git status` that fails is an error rather than
/// an empty list: a caller deciding whether a checkout may be deleted must not
/// read "git could not tell" as "clean".
#[cfg(feature = "cli")]
pub(crate) fn try_changed_paths(worktree: &Path) -> Result<Vec<String>, String> {
    Ok(run(worktree, None, &["status", "--porcelain"])?
        .lines()
        .filter_map(|l| l.trim_start().split_once(' '))
        // A rename reads `R old -> new`; the new name is the path on disk, and
        // the old one no longer exists, so staging it would be a delete.
        .map(|(_, path)| match path.trim().split_once(" -> ") {
            Some((_, to)) => to.to_string(),
            None => path.trim().to_string(),
        })
        .filter(|s| !s.is_empty())
        .collect())
}

#[cfg(all(test, feature = "cli"))]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU32;
    use std::sync::atomic::Ordering;

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    const LIMIT: std::time::Duration = std::time::Duration::from_secs(60);

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
    fn a_worktree_is_added_registered_and_reports_its_changes() {
        let Some(root) = init_repo() else { return };
        let wt = root.parent().unwrap().join(format!(
            "{}-wt",
            root.file_name().unwrap().to_string_lossy()
        ));
        let _ = std::fs::remove_dir_all(&wt);

        let head = head_sha(&root).expect("a repo with one commit has a HEAD");
        worktree_add(&root, &wt, "jan/agent/test1", &head).expect("worktree add");

        assert!(wt.join("a.txt").is_file(), "the tree was checked out");
        assert!(worktree_registered(&root, &wt));
        assert!(
            worktree_paths(&root).len() >= 2,
            "the main checkout and the new one"
        );
        assert_eq!(
            current_branch(&wt).as_deref(),
            Some("jan/agent/test1"),
            "the worktree is on its own branch"
        );
        // The main checkout is untouched by work done in the worktree.
        assert!(changed_paths(&wt).is_empty());
        std::fs::write(wt.join("a.txt"), "edited\n").unwrap();
        std::fs::write(wt.join("new.txt"), "added\n").unwrap();
        let mut changed = changed_paths(&wt);
        changed.sort();
        assert_eq!(changed, vec!["a.txt".to_string(), "new.txt".to_string()]);
        assert!(
            changed_paths(&root).is_empty(),
            "the user's checkout is clean"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("a.txt")).unwrap(),
            "one\n"
        );

        // A worktree the user deleted is forgotten, so its path is reusable.
        std::fs::remove_dir_all(&wt).unwrap();
        worktree_prune(&root);
        assert!(!worktree_registered(&root, &wt));
    }

    /// A worktree can start from any commit, which is how a fork of a session
    /// picks up where that conversation left off instead of at `HEAD`.
    #[test]
    fn a_worktree_can_branch_from_a_snapshot_commit() {
        let Some(root) = init_repo() else { return };
        std::fs::write(root.join("a.txt"), "two\n").unwrap();
        let snap =
            snapshot(&root, None, "turn 1", "t1", &[PathBuf::from("a.txt")]).expect("snapshot");
        std::fs::write(root.join("a.txt"), "three\n").unwrap();

        let wt = root.parent().unwrap().join(format!(
            "{}-snapwt",
            root.file_name().unwrap().to_string_lossy()
        ));
        let _ = std::fs::remove_dir_all(&wt);
        worktree_add(&root, &wt, "jan/agent/test2", &snap).expect("worktree add at a snapshot");
        assert_eq!(
            std::fs::read_to_string(wt.join("a.txt")).unwrap(),
            "two\n",
            "the branch starts from the snapshot, not HEAD and not the live tree"
        );
        let _ = std::fs::remove_dir_all(&wt);
    }

    #[test]
    fn object_ids_are_full_lowercase_hex() {
        assert!(is_object_id(&"a".repeat(40)));
        assert!(is_object_id(&"0123456789abcdef".repeat(4)));
        assert!(is_object_id(EMPTY_TREE));
        for bad in [
            "",
            "cafe",
            "--index-output=/tmp/x",
            "-q",
            "HEAD",
            "main",
            &"A".repeat(40),
            &"a".repeat(39),
            &"a".repeat(41),
            &"g".repeat(40),
            &format!("{}^{{tree}}", "a".repeat(40)),
        ] {
            assert!(!is_object_id(bad), "{bad}");
        }
    }

    /// An id read back from thread metadata never reaches git as an option.
    #[test]
    fn snapshot_ids_that_are_not_object_ids_are_refused() {
        let Some(root) = init_repo() else { return };
        let out = root.join("index-output");
        let hostile = format!("--index-output={}", out.display());
        let head = head_sha(&root).unwrap();
        assert!(restore(&root, &hostile, &head).is_err());
        assert!(restore(&root, &head, &hostile).is_err());
        assert!(restore(&root, "HEAD", "HEAD").is_err());
        assert!(snapshot(&root, Some(&hostile), "m", "t-bad", &[]).is_err());
        assert!(update_ref(&root, "t-bad", &hostile).is_err());
        let wt = root.join("wt");
        assert!(worktree_add(&root, &wt, "jan/agent/bad", &hostile).is_err());
        assert!(!out.exists());
        assert!(!wt.exists());
        // A real id still works for restore.
        restore(&root, &head, &head).expect("restore to HEAD");
        let _ = std::fs::remove_dir_all(&root);
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
        assert_ne!(
            base_tree, head_tree,
            "base tree must include the pre-existing dirty edit"
        );

        cleanup_snapshot_index(thread_id);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn base_snapshot_includes_dirty_tracked_file_that_became_ignored() {
        let Some(root) = init_repo() else { return };
        let thread_id = "test-thread-dirty-now-ignored";
        cleanup_snapshot_index(thread_id);

        // Generated files can be committed before their directory is added to
        // .gitignore. Git rejects a normal `add` for a dirty file under that
        // newly ignored directory, even though the file is already tracked.
        let generated = root.join("generated");
        std::fs::create_dir_all(&generated).unwrap();
        std::fs::write(generated.join("a.txt"), "committed\n").unwrap();
        run(&root, None, &["add", "-f", "--", "generated/a.txt"]).unwrap();
        run(
            &root,
            None,
            &["commit", "-q", "-m", "generated", "--no-gpg-sign"],
        )
        .unwrap();
        std::fs::write(root.join(".gitignore"), "ignored/\ngenerated/\n").unwrap();
        std::fs::write(generated.join("a.txt"), "dirty-and-now-ignored\n").unwrap();
        let base = snapshot(&root, None, "base", thread_id, &[]).expect("base snapshot");

        let base_contents =
            run(&root, None, &["show", &format!("{base}:generated/a.txt")]).unwrap();
        assert_eq!(base_contents, "dirty-and-now-ignored");

        cleanup_snapshot_index(thread_id);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn snapshot_index_rejects_ids_that_are_not_a_plain_name() {
        for bad in ["", "../x", "a/b", r"a\b", "..", "C:x", "a.b"] {
            assert!(snapshot_index(bad).is_err(), "{bad:?} should be rejected");
        }
        let idx = snapshot_index("fork-base-0f8c2a3e-1b2c-4d5e-8f90-123456789abc").unwrap();
        assert_eq!(idx.parent(), Some(std::env::temp_dir().as_path()));
        // A rejected id fails the snapshot instead of writing elsewhere.
        assert!(snapshot(Path::new("."), None, "m", "../x", &[]).is_err());
        // The fork-base prefix does not count against the id's length limit,
        // but the id after it is still checked.
        let long_id = "a".repeat(128);
        assert!(snapshot_index(&format!("{FORK_BASE_KEY_PREFIX}{long_id}")).is_ok());
        assert!(snapshot_index(&format!("{FORK_BASE_KEY_PREFIX}../x")).is_err());
        assert!(snapshot_index(FORK_BASE_KEY_PREFIX).is_err());
    }

    #[test]
    fn snapshot_ref_rejects_ids_that_are_not_a_plain_name() {
        for bad in ["", "../x", "a/b", "a..b", "a b", "x^{tree}", "a:b", "nul"] {
            assert!(snapshot_ref(bad).is_err(), "{bad:?} should be rejected");
        }
        assert_eq!(
            snapshot_ref("0f8c2a3e-1b2c-4d5e-8f90-123456789abc").unwrap(),
            "refs/jan/agent/snapshots/0f8c2a3e-1b2c-4d5e-8f90-123456789abc"
        );
        let Some(root) = init_repo() else { return };
        assert!(update_ref(&root, "../../heads/main", "HEAD").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn checkpoint_only_stages_reported_paths() {
        let Some(root) = init_repo() else { return };
        let thread_id = "test-thread-3";

        let base = snapshot(&root, None, "base", thread_id, &[]).expect("base snapshot");
        let idx = snapshot_index(thread_id).unwrap();
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

    /// A fetch ref comes from the model, so a refspec (`src:dst`, a leading
    /// `+`) is refused before git sees it, and a plain ref lands in
    /// `FETCH_HEAD` only: no local branch or remote-tracking ref moves.
    #[test]
    fn fetch_commit_refuses_refspecs_and_moves_no_local_ref() {
        let Some(upstream) = init_repo() else { return };
        let trunk = current_branch(&upstream).unwrap();
        run(&upstream, None, &["checkout", "-q", "-b", "x"]).unwrap();
        std::fs::write(upstream.join("x.txt"), "x\n").unwrap();
        run(&upstream, None, &["add", "x.txt"]).unwrap();
        run(&upstream, None, &["commit", "-q", "-m", "x", "--no-gpg-sign"]).unwrap();
        let x = head_sha(&upstream).unwrap();
        run(&upstream, None, &["checkout", "-q", &trunk]).unwrap();
        let clone = upstream.with_extension("clone");
        let _ = std::fs::remove_dir_all(&clone);
        let (from, to) = (upstream.to_string_lossy(), clone.to_string_lossy());
        git(&["clone", "-q", "--single-branch", "-b", &trunk, &from, &to]).unwrap();
        // The usual wildcard refspec, under which a plain `git fetch origin x`
        // would also move `refs/remotes/origin/x`.
        let wide = "+refs/heads/*:refs/remotes/origin/*";
        run(&clone, None, &["config", "remote.origin.fetch", wide]).unwrap();
        run(&clone, None, &["branch", "victim"]).unwrap();
        let before = head_sha(&clone).unwrap();

        for bad in [
            "+refs/heads/x:refs/heads/victim",
            "x:victim",
            "refs/heads/x:refs/heads/victim",
            "+x",
            "x:",
            "x\u{7}",
        ] {
            assert!(fetch_commit(&clone, bad, LIMIT).is_err(), "{bad:?} must be refused");
            assert_eq!(
                resolve_commit(&clone, "refs/heads/victim").as_deref(),
                Some(before.as_str()),
                "{bad:?} moved a local branch"
            );
        }
        assert_eq!(fetch_commit(&clone, "x", LIMIT).as_deref(), Ok(x.as_str()));
        assert_eq!(resolve_commit(&clone, "refs/heads/x"), None, "no local branch made");
        assert_eq!(resolve_commit(&clone, "refs/remotes/origin/x"), None);
        assert_eq!(resolve_commit(&clone, "refs/heads/victim").as_deref(), Some(before.as_str()));
        let _ = std::fs::remove_dir_all(&clone);
        let _ = std::fs::remove_dir_all(&upstream);
    }

    /// A fetch from a remote that never answers gives up at its limit with an
    /// error saying so, rather than holding the dispatch that asked for it.
    #[test]
    fn a_fetch_from_a_remote_that_never_answers_times_out() {
        let Some(root) = init_repo() else { return };
        run(&root, None, &["config", "protocol.ext.allow", "always"]).unwrap();
        run(&root, None, &["remote", "add", "origin", "ext::sh -c sleep% 600"]).unwrap();
        let started = std::time::Instant::now();
        let err = fetch_commit(&root, "pull/1/head", std::time::Duration::from_secs(2))
            .unwrap_err();
        assert!(started.elapsed() < std::time::Duration::from_secs(20), "{:?}", started.elapsed());
        assert!(err.contains("timed out after 2s"), "{err}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The primitives a subagent worktree's life is built from: resolve a ref
    /// to the commit it names, count what was committed on top of a base, find
    /// the shared git dir a sandboxed `git commit` writes into, and remove the
    /// checkout plus its branch again.
    #[test]
    fn a_child_worktree_can_be_resolved_counted_and_removed() {
        let Some(root) = init_repo() else { return };
        let head = head_sha(&root).unwrap();
        assert_eq!(resolve_commit(&root, "HEAD").as_deref(), Some(head.as_str()));
        assert_eq!(resolve_commit(&root, "no-such-ref"), None);
        // A ref is never read as an option, whatever it is spelled as.
        assert_eq!(resolve_commit(&root, "--output=x"), None);

        let common = git_common_dir(&root).expect("a repo has a common dir");
        assert_eq!(common, root.join(".git").canonicalize().unwrap());

        let wt = root.parent().unwrap().join(format!(
            "{}-child",
            root.file_name().unwrap().to_string_lossy()
        ));
        let _ = std::fs::remove_dir_all(&wt);
        worktree_add(&root, &wt, "jan/agent/child-1", &head).unwrap();
        assert_eq!(git_common_dir(&wt), Some(common), "a linked worktree shares it");
        assert_eq!(commits_since(&wt, &head), Some(0));
        std::fs::write(wt.join("b.txt"), "b\n").unwrap();
        run(&wt, None, &["add", "b.txt"]).unwrap();
        run(&wt, None, &["commit", "-q", "-m", "b", "--no-gpg-sign"]).unwrap();
        assert_eq!(commits_since(&wt, &head), Some(1));

        worktree_remove(&root, &wt, Some("jan/agent/child-1")).unwrap();
        assert!(!wt.exists());
        assert!(!worktree_registered(&root, &wt));
        assert_eq!(resolve_commit(&root, "jan/agent/child-1"), None, "branch deleted");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// `current_branch` re-reads `HEAD` live rather than caching it, so a
    /// checkout made after the first call (e.g. by another process while the
    /// TUI is open) is picked up on the next call.
    #[test]
    fn current_branch_reflects_a_checkout_made_after_the_first_read() {
        let Some(root) = init_repo() else { return };
        let r = root.to_string_lossy().to_string();

        let first = current_branch(&root);
        assert!(first.is_some(), "a fresh init_repo commit has a branch");

        git(&["-C", &r, "checkout", "-q", "-b", "feature/other"]).expect("checkout");
        let second = current_branch(&root);
        assert_eq!(second.as_deref(), Some("feature/other"));
        assert_ne!(first, second, "the branch must change after an external checkout");

        let _ = std::fs::remove_dir_all(&root);
    }
}
