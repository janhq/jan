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
///
/// It never talks to the user's terminal: `GIT_TERMINAL_PROMPT=0` and (unix)
/// its own session, so neither git nor anything it runs (a credential helper,
/// ssh asking to trust a host key) can open `/dev/tty`. Under the TUI such a
/// prompt would wait behind the TUI's screen, with the TUI and git both
/// reading the same keystrokes; now the command fails with git's own error.
/// For a git that may prompt, see [`git_command_on_terminal`].
pub(crate) fn git_command() -> Result<Command, String> {
    let mut cmd = git_command_on_terminal()?;
    cmd.stdin(std::process::Stdio::null())
        .env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(unix)]
    tauri_plugin_agent_tools::tools::proc::detach_std_from_terminal(&mut cmd);
    Ok(cmd)
}

/// A plain `git` that shares Jan's terminal, so it can ask for credentials
/// there. Only for a caller that knows nothing else is using the terminal --
/// a plain `jan plugin install`, never the TUI.
pub(crate) fn git_command_on_terminal() -> Result<Command, String> {
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
    // `git_command` already gives git no stdin, no prompt and (unix) a session
    // of its own, whose group a timeout kills so the helpers die with it
    // instead of holding its pipes open. Adding `process_group(0)` here would
    // make that `setsid` fail and the spawn with it.
    let mut cmd = repo_command(repo, args)?;
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
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

/// Kill `child` and every helper it spawned (its process group on Unix, its
/// process tree on Windows, where `git-remote-https` would otherwise outlive a
/// timed-out fetch), then reap it.
#[cfg(feature = "cli")]
fn kill_tree(child: &mut std::process::Child) {
    tauri_plugin_agent_tools::tools::proc::kill_tree(child.id());
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

/// A path git printed, as this platform names it: any bytes on Unix, valid
/// UTF-8 elsewhere (git writes paths as UTF-8 there).
#[cfg(feature = "cli")]
fn os_path(bytes: &[u8]) -> Option<PathBuf> {
    #[cfg(unix)]
    {
        Some(PathBuf::from(<std::ffi::OsStr as std::os::unix::ffi::OsStrExt>::from_bytes(bytes)))
    }
    #[cfg(not(unix))]
    {
        std::str::from_utf8(bytes).ok().map(PathBuf::from)
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

/// Most lines of `git status` / diff stat a continuation state carries. A run
/// that regenerated a build tree can list thousands of paths, and the state is
/// re-sent on every request after the compaction that wrote it.
const WORKSPACE_STATUS_LINES: usize = 80;

/// `git status --short` plus `git diff --stat HEAD` for the work tree holding
/// `path`, for a compaction's Files touched: the write/edit ledger cannot see
/// what a `shell` call changed, and git can. `None` outside a work tree or
/// with no change. Long output keeps its head and says how much was cut.
pub(crate) fn workspace_status(path: &Path) -> Option<String> {
    let p = path.to_string_lossy();
    let status = git(&["-C", &p, "status", "--short", "--untracked-files=normal"]).ok()?;
    if status.trim().is_empty() {
        return None;
    }
    // No stat on an unborn HEAD: `status` already lists every path.
    let stat = git(&["-C", &p, "diff", "--stat", "HEAD"]).unwrap_or_default();
    let clip = |text: &str| {
        let lines: Vec<&str> = text.lines().collect();
        if lines.len() <= WORKSPACE_STATUS_LINES {
            return text.to_string();
        }
        format!(
            "{}\n[... {} more lines]",
            lines[..WORKSPACE_STATUS_LINES].join("\n"),
            lines.len() - WORKSPACE_STATUS_LINES
        )
    };
    let mut out = format!("Workspace `git status --short`:\n{}", clip(&status));
    if !stat.trim().is_empty() {
        out.push_str(&format!("\nDiff stat against HEAD:\n{}", clip(&stat)));
    }
    Some(out)
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

/// A path in the form git expects from this host. Windows `canonicalize`, and
/// every path derived from it, is a verbatim `\\?\C:\...` path: git accepts one
/// after `-C`, but `worktree add` cannot create directories under it
/// (`Invalid argument`), so a caller that keeps canonical paths fails or works
/// depending on which subcommand sees the path first.
#[cfg(feature = "cli")]
fn native_path(path: &Path) -> String {
    let s = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{rest}");
        }
        if let Some(rest) = s.strip_prefix(r"\\?\") {
            return rest.to_string();
        }
    }
    s.into_owned()
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
    let path = native_path(path);
    run(
        repo,
        None,
        &["worktree", "add", "-b", branch, "--", &path, base],
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
    let Ok(want) = dunce::canonicalize(path) else {
        return false;
    };
    worktree_paths(repo)
        .iter()
        .filter_map(|p| dunce::canonicalize(p).ok())
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

/// Fetch `rev` from `origin` and return the commit it named, for a ref the
/// local repository does not have (`pull/9486/head`).
///
/// `rev` must be a [plain ref](is_plain_ref) that `git check-ref-format`
/// accepts, so it is never a refspec with a destination of its own. The
/// destination is a ref private to this call, read and deleted again:
/// `FETCH_HEAD` is shared by every fetch in the repository, so a concurrent
/// one could replace it between this fetch and its resolution, and
/// `--no-write-fetch-head` leaves it to them. `--refmap=` turns off the
/// remote-tracking update a configured `remote.origin.fetch` would make.
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
    static FETCH_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = FETCH_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dest = format!("refs/jan/fetch/{}-{seq}", std::process::id());
    let spec = format!("{rev}:{dest}");
    let fetched = run_limited(
        repo,
        &[
            "fetch",
            "--quiet",
            "--no-tags",
            "--no-write-fetch-head",
            "--refmap=",
            "origin",
            "--",
            &spec,
        ],
        limit,
    )
    .and_then(|_| {
        resolve_commit(repo, &dest).ok_or_else(|| format!("fetching {rev} named no commit"))
    });
    // Also after a failure: a fetch cut off at its limit may have written it.
    let _ = run(repo, None, &["update-ref", "-d", &dest]);
    fetched
}

/// How long each git in [`tidy_facts`] may take. All of it is local, so a
/// git still running past this is stuck (a lock, a huge repo on a slow
/// disk), and the tidy is better off without its facts than waiting.
#[cfg(feature = "cli")]
const TIDY_FACTS_GIT_LIMIT: std::time::Duration = std::time::Duration::from_secs(5);
/// The most branches each of [`tidy_facts`]'s two branch lists shows.
#[cfg(feature = "cli")]
const TIDY_FACTS_BRANCHES: usize = 60;
/// The most worktrees [`tidy_facts`] lists.
#[cfg(feature = "cli")]
const TIDY_FACTS_WORKTREES: usize = 20;
/// How far back [`tidy_facts`] reads the default branch for PR numbers.
#[cfg(feature = "cli")]
const TIDY_FACTS_LOG_DEPTH: &str = "500";
/// PR numbers per line of [`tidy_facts`]'s compact list.
#[cfg(feature = "cli")]
const TIDY_FACTS_PRS_PER_LINE: usize = 20;
/// The hard ceiling on [`tidy_facts`]'s block, whatever the lists add up to:
/// it rides in a small model's task, next to the notes it has to read.
#[cfg(feature = "cli")]
const TIDY_FACTS_MAX_LINES: usize = 200;

/// What the memory tidy is told about `repo` so it can judge whether a note
/// tracks finished work: the default branch and its head, which branches
/// it contains, the registered worktrees (one gone from disk flagged), and
/// the PR numbers squash merges and reverts left in its recent log.
///
/// Jan runs these itself, from a fixed list, so the tidy never needs a
/// shell. Everything is local: no fetch, no `gh`, so a remote-tracking
/// branch is only as fresh as the user's last fetch. `None` when `repo` is
/// not in a git work tree, has no default branch, or git fails, so the tidy
/// simply runs without it.
#[cfg(feature = "cli")]
pub(crate) fn tidy_facts(repo: &Path, today: &str) -> Option<String> {
    let git = |args: &[&str]| run_limited(repo, args, TIDY_FACTS_GIT_LIMIT).ok();
    git(&["rev-parse", "--show-toplevel"])?;
    let default = default_branch(&git)?;
    // `--` so a work-tree path named like the branch cannot be read instead.
    let head = git(&["log", "-1", "--date=short", "--format=%h %ad %s", &default, "--"])?;
    let merged_arg = format!("--merged={default}");
    let at_head_arg = format!("--points-at={default}");
    let refs = |extra: &[&str]| -> Option<Vec<String>> {
        let mut args = vec!["for-each-ref", "--sort=-committerdate"];
        args.extend_from_slice(extra);
        args.extend(["--format=%(refname)%09%(symref)", "refs/heads", "refs/remotes"]);
        Some(branch_names(&git(&args)?, &default))
    };
    let all = refs(&[])?;
    let merged = refs(&[merged_arg.as_str()])?;
    let open: Vec<String> = all.into_iter().filter(|b| !merged.contains(b)).collect();
    // A branch at the default's very head has no commits of its own (just
    // cut, or an agent worktree's), so it says nothing about landed work.
    let at_head = refs(&[at_head_arg.as_str()])?;
    let merged: Vec<String> = merged.into_iter().filter(|b| !at_head.contains(b)).collect();
    let worktrees = worktree_lines(&git(&["worktree", "list", "--porcelain"])?);
    let subjects =
        git(&["log", "-n", TIDY_FACTS_LOG_DEPTH, "--format=%s", &default, "--"])?;
    let prs = pr_numbers(&subjects);

    let mut out = vec![
        "Facts Jan gathered from the project's local git (no fetch, so remote branches are as of \
         the last fetch):"
            .to_string(),
        format!("Today: {today}"),
        format!("Default branch: {default}, head {head}"),
        // Containment is all git can say: a branch cut from an older commit
        // and never worked on is contained too, so this is not "landed".
        format!(
            "Branches whose tip is contained in {default} (fully merged, or created there with \
             no commits of their own yet), most recent first:"
        ),
    ];
    push_capped(&mut out, &merged, TIDY_FACTS_BRANCHES);
    // Squash and rebase merges land a branch's work without its commits, so
    // this list is "not merged by commit", never "still open".
    out.push(format!(
        "Branches not merged into {default} by commit (a squash-merged branch still lands here: \
         check the PR numbers below), most recent first:"
    ));
    push_capped(&mut out, &open, TIDY_FACTS_BRANCHES);
    out.push("Worktrees registered with git:".to_string());
    push_capped(&mut out, &worktrees, TIDY_FACTS_WORKTREES);
    out.push(format!(
        "PR numbers in the subjects of {default}'s last {TIDY_FACTS_LOG_DEPTH} commits, newest \
         first (a squash merge reads `subject (#123)`; the surest sign a PR landed):"
    ));
    if prs.landed.is_empty() {
        out.push("  (none)".to_string());
    }
    push_pr_lines(&mut out, &prs.landed);
    if !prs.reverted.is_empty() {
        out.push(
            "PRs reverted in that log (their work did NOT land, or was undone):".to_string(),
        );
        push_pr_lines(&mut out, &prs.reverted);
    }
    if out.len() > TIDY_FACTS_MAX_LINES {
        out.truncate(TIDY_FACTS_MAX_LINES - 1);
        out.push("... (truncated)".to_string());
    }
    // A branch or path is the user's bytes; the block goes into a prompt.
    Some(out.join("\n").replace(|c: char| c.is_control() && c != '\n', "?"))
}

/// The branch [`tidy_facts`] treats as the default: the remote's own
/// (`origin/HEAD`), else a local `main` or `master`, else their
/// remote-tracking twins. Never just what is checked out: "merged into
/// a feature branch" would read as landed when it is not.
#[cfg(feature = "cli")]
fn default_branch(git: &impl Fn(&[&str]) -> Option<String>) -> Option<String> {
    // `symbolic-ref` answers even when the target is gone (the remote renamed
    // its default and a prune deleted the old one), so the target must also
    // resolve, or every later `git log` on it fails and the facts are lost.
    let resolves = |full: &str| git(&["rev-parse", "--verify", "--quiet", full]).is_some();
    let remote = git(&["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
    if let Some(remote) = remote.filter(|r| !r.is_empty()) {
        if resolves("refs/remotes/origin/HEAD") {
            return Some(remote);
        }
    }
    let known = ["main", "master", "origin/main", "origin/master"].into_iter().find(|b| {
        let full = match b.strip_prefix("origin/") {
            Some(name) => format!("refs/remotes/origin/{name}"),
            None => format!("refs/heads/{b}"),
        };
        resolves(&full)
    });
    known.map(str::to_string)
}

/// Branch names from `for-each-ref`'s `<refname>\t<symref>` lines, as
/// `git branch -a` names them (`feat/x`, `origin/feat/x`), without symbolic
/// refs (`origin/HEAD`) or the default branch itself.
#[cfg(feature = "cli")]
fn branch_names(listing: &str, default: &str) -> Vec<String> {
    listing
        .lines()
        // The output is trimmed, so the last line's empty symref takes its
        // tab with it.
        .map(|l| l.split_once('\t').unwrap_or((l, "")))
        .filter(|(_, symref)| symref.is_empty())
        .filter_map(|(r, _)| r.strip_prefix("refs/heads/").or(r.strip_prefix("refs/remotes/")))
        .filter(|b| *b != default)
        .map(str::to_string)
        .collect()
}

/// `<path> [<branch>]` per worktree in a `worktree list --porcelain`
/// listing, flagged when the directory is gone: a note naming a worktree
/// can then be judged against what is still on disk.
#[cfg(feature = "cli")]
fn worktree_lines(porcelain: &str) -> Vec<String> {
    porcelain
        .split("\n\n")
        .filter_map(|block| {
            let path = block.lines().find_map(|l| l.strip_prefix("worktree "))?;
            let branch = block
                .lines()
                .find_map(|l| l.strip_prefix("branch "))
                .map(|b| b.strip_prefix("refs/heads/").unwrap_or(b))
                .unwrap_or("detached");
            let gone = if Path::new(path).exists() { "" } else { " (missing on disk)" };
            Some(format!("{path} [{branch}]{gone}"))
        })
        .collect()
}

/// The PR numbers in a log's subjects, each once, in the order first seen.
#[cfg(feature = "cli")]
#[derive(Debug, Default)]
struct PrNumbers {
    /// Squash merges' PRs (`subject (#9497)`), less any reverted.
    landed: Vec<String>,
    /// PRs a GitHub revert undid (`Revert "subject (#9497)" (#9500)`).
    reverted: Vec<String>,
}

/// Sort `subjects`' PR numbers into landed and reverted. Only a subject's
/// trailing `(#N)` is its own PR: one earlier in the text is a mention, and
/// the one inside a revert's quotes is the PR it undid. A reverted PR is
/// never landed, even with its own merge in the log too.
#[cfg(feature = "cli")]
fn pr_numbers(subjects: &str) -> PrNumbers {
    let mut prs = PrNumbers::default();
    let add = |list: &mut Vec<String>, n: &str| {
        if !list.iter().any(|seen| seen == n) {
            list.push(n.to_string());
        }
    };
    for subject in subjects.lines() {
        if let Some(n) = trailing_pr(subject) {
            add(&mut prs.landed, n);
        }
        let quoted = subject.strip_prefix("Revert \"").and_then(|r| r.rsplit_once('"'));
        if let Some(n) = quoted.and_then(|(inner, _)| trailing_pr(inner)) {
            add(&mut prs.reverted, n);
        }
    }
    prs.landed.retain(|n| !prs.reverted.contains(n));
    prs
}

/// The `N` of a subject ending in `(#N)`.
#[cfg(feature = "cli")]
fn trailing_pr(subject: &str) -> Option<&str> {
    let (_, number) = subject.trim_end().strip_suffix(')')?.rsplit_once("(#")?;
    (!number.is_empty() && number.bytes().all(|b| b.is_ascii_digit())).then_some(number)
}

/// Append PR numbers to `out` as compact `#N` lines.
#[cfg(feature = "cli")]
fn push_pr_lines(out: &mut Vec<String>, numbers: &[String]) {
    for chunk in numbers.chunks(TIDY_FACTS_PRS_PER_LINE) {
        let line: Vec<String> = chunk.iter().map(|n| format!("#{n}")).collect();
        out.push(format!("  {}", line.join(" ")));
    }
}

/// Append `items` to `out` as a bulleted list of at most `cap`, saying how
/// many were left out, or `(none)`.
#[cfg(feature = "cli")]
fn push_capped(out: &mut Vec<String>, items: &[String], cap: usize) {
    if items.is_empty() {
        out.push("  (none)".to_string());
    }
    out.extend(items.iter().take(cap).map(|i| format!("  - {i}")));
    if items.len() > cap {
        out.push(format!("  ... {} more not listed (truncated)", items.len() - cap));
    }
}

/// Forget worktree registrations whose directory the user has deleted. Without
/// this, `worktree add` refuses a path that a stale registration still claims.
#[cfg(feature = "cli")]
pub(crate) fn worktree_prune(repo: &Path) {
    let _ = run(repo, None, &["worktree", "prune"]);
}

/// Make `path` a repository of its own on a new `branch` at `base` (a full
/// commit id) and return the object directory it borrows from `repo` (`git
/// clone --shared`: its `objects/info/alternates` names it). Unlike a linked
/// worktree it shares no git dir with `repo`, so whoever works in it never
/// writes the user's `.git`; the branch reaches `repo` only through
/// [`Checkout::fetch_branch`]. The parent directory is created first; `path`
/// must not exist.
#[cfg(feature = "cli")]
pub(crate) fn clone_shared(
    repo: &Path,
    path: &Path,
    branch: &str,
    base: &str,
) -> Result<PathBuf, String> {
    require_object_id(base)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let made = run(
        repo,
        None,
        &[
            "clone",
            "--shared",
            "--no-checkout",
            "--no-tags",
            "--quiet",
            "--",
            &repo.to_string_lossy(),
            &path.to_string_lossy(),
        ],
    )
    .and_then(|_| run(path, None, &["checkout", "-q", "-b", branch, base, "--"]))
    .and_then(|_| only_branch(path, branch))
    .and_then(|_| match alternates(path)?.as_slice() {
        [objects] => Ok(objects.clone()),
        other => Err(format!("the clone borrows {} object directories, not one", other.len())),
    });
    if made.is_err() {
        let _ = std::fs::remove_dir_all(path);
    }
    made
}

/// Leave a fresh clone with `branch` and nothing else: the clone's copy of the
/// user's current branch and its remote-tracking refs would read as work it
/// holds once the user's repository moves on, and the remote would point the
/// child back at the repository it must not write.
#[cfg(feature = "cli")]
fn only_branch(path: &Path, branch: &str) -> Result<(), String> {
    let heads = run(path, None, &["for-each-ref", "--format=%(refname:short)", "refs/heads"])?;
    for other in heads.lines().filter(|b| *b != branch) {
        run(path, None, &["branch", "-D", "--", other])?;
    }
    run(path, None, &["remote", "remove", "origin"]).map(|_| ())
}

/// The object directories the repository at `checkout` borrows, as its
/// `objects/info/alternates` names them (canonicalized when they exist).
#[cfg(feature = "cli")]
fn alternates(checkout: &Path) -> Result<Vec<PathBuf>, String> {
    let file = checkout.join(".git/objects/info/alternates");
    match std::fs::read_to_string(&file) {
        Ok(raw) => Ok(raw
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(|l| dunce::canonicalize(l).unwrap_or_else(|_| PathBuf::from(l)))
            .collect()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("could not read {}: {e}", file.display())),
    }
}

/// Whether `key` (as `git config --list` spells it) is one a clone and
/// everyday work in it leave behind and that cannot name a program. Every
/// other key of a child's config is emptied for Jan's own git: whatever it is
/// (`filter.*`, `diff.*`, `merge.*`, `credential.*`, `remote.*.uploadpack`,
/// `core.sshCommand`, ...), it may be a command git would run.
///
/// The numeric and size tuning keys are left alone for a second reason: git
/// parses them as numbers and dies on the empty value that would neutralise
/// them (`bad numeric config value '' for 'core.compression'`), which would
/// fail every one of Jan's reads of the checkout. A number cannot run
/// anything. Only keys with no subsection are listed: `diff.<driver>.*` and
/// `gc.<pattern>.*` are not these.
#[cfg(feature = "cli")]
fn inert_config(key: &str) -> bool {
    let Some((section, rest)) = key.split_once('.') else { return false };
    let name = rest.rsplit_once('.').map_or(rest, |(_, name)| name);
    let everyday = match section {
        "core" => matches!(
            name,
            "repositoryformatversion" | "filemode" | "bare" | "logallrefupdates" | "symlinks"
                | "ignorecase" | "precomposeunicode" | "autocrlf" | "eol" | "safecrlf"
        ),
        "user" | "branch" => true,
        "remote" => matches!(name, "url" | "pushurl" | "fetch" | "push" | "tagopt"),
        _ => false,
    };
    everyday || is_numeric_tuning(section, rest)
}

/// A `section.name` key (no subsection) that holds only a number or a size:
/// compression levels, cache and pack limits, thread counts, rename limits.
#[cfg(feature = "cli")]
fn is_numeric_tuning(section: &str, name: &str) -> bool {
    match section {
        "core" => matches!(
            name,
            "compression" | "loosecompression" | "bigfilethreshold" | "packedgitlimit"
                | "packedgitwindowsize" | "deltabasecachelimit" | "abbrev"
        ),
        "gc" => matches!(name, "auto" | "autopacklimit"),
        "pack" => matches!(
            name,
            "threads" | "window" | "depth" | "compression" | "windowmemory" | "deltacachesize"
                | "deltacachelimit" | "packsizelimit"
        ),
        "diff" => name == "renamelimit",
        _ => false,
    }
}

/// A repository made by [`clone_shared`] that its child has worked in, opened
/// only while it is still what Jan made. Jan's git runs unsandboxed where the
/// child's was confined to this checkout, and the child controls everything
/// in its `.git`: its config can name programs git then runs, its `.git` can
/// be a file, or hold a `commondir`, pointing at another repository, and its
/// alternates can pull in any directory's objects. [`Checkout::open`] refuses
/// a checkout whose `.git` or alternates changed, or whose config reaches
/// beyond itself, and every command of a checkout empties the rest of that
/// config, names its git dir and work tree itself, honors no `replace` ref,
/// starts only the `file` transport and never looks inside a nested
/// repository.
#[cfg(feature = "cli")]
#[derive(Debug, Clone)]
pub(crate) struct Checkout {
    path: PathBuf,
    /// The `key=` overrides that empty every setting of the child's config
    /// that could name a program, read once by [`Checkout::open`].
    overrides: Vec<String>,
}

#[cfg(feature = "cli")]
impl Checkout {
    /// The clone at `path` (its top level) that borrows exactly `objects`, or
    /// an error naming what changed, for the user.
    pub(crate) fn open(path: &Path, objects: &Path) -> Result<Self, String> {
        let dot = path.join(".git");
        let plain = |p: &Path, dir: bool| {
            std::fs::symlink_metadata(p).is_ok_and(|m| if dir { m.is_dir() } else { m.is_file() })
        };
        if !plain(&dot, true) || !plain(&dot.join("objects"), true) || !plain(&dot.join("config"), false)
        {
            return Err("its .git was replaced: it is no longer a plain directory".to_string());
        }
        // Each of these makes git read another repository's config or objects.
        for pointer in ["commondir", "objects/info/http-alternates"] {
            if dot.join(pointer).exists() {
                return Err(format!("its .git has a {pointer} file, which redirects git"));
            }
        }
        if alternates(path)? != [objects.to_path_buf()] {
            return Err(format!(
                "its object alternates were rewritten: it must borrow only {}",
                objects.display()
            ));
        }
        // `--file` reads that one file, follows no `include` and starts nothing.
        let listed = git_command()?
            .args(["config", "--file"])
            .arg(dot.join("config"))
            .args(["--list", "-z"])
            .output()
            .map_err(|e| format!("failed to launch git: {e}"))?;
        if !listed.status.success() {
            return Err("its git config cannot be read".to_string());
        }
        let mut overrides = Vec::new();
        for entry in String::from_utf8_lossy(&listed.stdout).split('\0').filter(|e| !e.is_empty()) {
            let (key, value) = entry.split_once('\n').unwrap_or((entry, ""));
            // These read more files (another config, `config.worktree`) than
            // were looked at here.
            if key.starts_with("include.")
                || key.starts_with("includeif.")
                || key.starts_with("extensions.")
            {
                return Err(format!("its git config sets {key}, which makes git read more"));
            }
            if key == "core.repositoryformatversion" && value != "0" {
                return Err("its repository format is not the one Jan made".to_string());
            }
            if inert_config(key) {
                continue;
            }
            // `-c key=value` splits at the first `=`, so such a key cannot be
            // emptied.
            if key.contains('=') {
                return Err(format!("its git config sets {key}, which git cannot be told to ignore"));
            }
            let pair = format!("{key}=");
            if !overrides.contains(&pair) {
                overrides.push(pair);
            }
        }
        Ok(Self { path: path.to_path_buf(), overrides })
    }

    /// The options every git of Jan's in the checkout takes, ahead of the
    /// subcommand: the child's config emptied of anything that could run,
    /// then what no config may turn back on.
    fn hardened(&self) -> Vec<String> {
        let null = if cfg!(windows) { "NUL" } else { "/dev/null" };
        let mut opts = vec!["--no-replace-objects".to_string(), "--no-optional-locks".to_string()];
        for pair in &self.overrides {
            opts.extend(["-c".to_string(), pair.clone()]);
        }
        opts.extend([
            "-c".to_string(),
            "core.fsmonitor=false".to_string(),
            "-c".to_string(),
            format!("core.hooksPath={null}"),
        ]);
        opts
    }

    /// `git <args>` in the checkout, its git dir and work tree named
    /// explicitly.
    fn run(&self, args: &[&str]) -> Result<String, String> {
        let out = self.output(args)?;
        outcome(&out, args)
    }

    /// [`Self::run`] with stdout as git wrote it: paths are bytes, and a
    /// lossy decoding can name a file that does not exist.
    fn run_raw(&self, args: &[&str]) -> Result<Vec<u8>, String> {
        let out = self.output(args)?;
        outcome(&out, args)?;
        Ok(out.stdout)
    }

    fn output(&self, args: &[&str]) -> Result<std::process::Output, String> {
        let opts = self.hardened();
        let mut full: Vec<&str> = opts.iter().map(String::as_str).collect();
        full.extend_from_slice(args);
        let mut cmd = repo_command(&self.path, &full)?;
        cmd.env("GIT_DIR", self.path.join(".git"))
            .env("GIT_WORK_TREE", &self.path);
        cmd.output().map_err(|e| format!("failed to launch git: {e}"))
    }

    /// The branch checked out there, `None` when detached or unreadable.
    pub(crate) fn current_branch(&self) -> Option<String> {
        self.run(&["rev-parse", "--abbrev-ref", "HEAD"])
            .ok()
            .filter(|s| !s.is_empty() && s != "HEAD")
    }

    /// Commits reachable from `tip` (a branch or `HEAD`) but not from
    /// `base`. `None` when git cannot say, which callers must never read as
    /// zero.
    pub(crate) fn commits_on(&self, base: &str, tip: &str) -> Option<u64> {
        require_object_id(base).ok()?;
        if tip.starts_with('-') {
            return None;
        }
        self.run(&["rev-list", "--count", &format!("{base}..{tip}"), "--"])
            .ok()?
            .parse()
            .ok()
    }

    /// Commits any ref of the checkout (or `HEAD`) reaches that `base` does
    /// not: everything the child committed, on whatever branch, stash or tag.
    /// `None` when git cannot say.
    pub(crate) fn commits_anywhere(&self, base: &str) -> Option<u64> {
        require_object_id(base).ok()?;
        self.run(&["rev-list", "--count", "--all", "--not", base, "--"]).ok()?.parse().ok()
    }

    /// [`try_changed_paths`] for this checkout. A nested repository (or a
    /// recorded submodule) is never opened: its own config can name a program
    /// (`core.fsmonitor`) that its status would run.
    pub(crate) fn try_changed_paths(&self) -> Result<Vec<String>, String> {
        changed_paths_with(|args| {
            let mut full = args.to_vec();
            full.push("--ignore-submodules=all");
            self.run(&full)
        })
    }

    /// Whether the checkout has no uncommitted change. `Err` when git cannot
    /// tell, which a caller deciding on removal must never read as clean.
    pub(crate) fn is_clean(&self) -> Result<bool, String> {
        Ok(!self.holds_submodule_work()? && clean_with(|args| self.run(args))?)
    }

    /// Whether a submodule holds anything: status never looks inside one (see
    /// [`Checkout::try_changed_paths`]), and `rev-list --all` does not see
    /// the commits in `.git/modules`. A clone leaves `.git/modules` absent
    /// and each submodule's directory empty, so anything there is the
    /// child's: an initialised submodule, or a repository at its path.
    fn holds_submodule_work(&self) -> Result<bool, String> {
        let filled = |dir: &Path| match std::fs::read_dir(dir) {
            Ok(mut entries) => Ok(entries.next().is_some()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(format!("could not read {}: {e}", dir.display())),
        };
        if filled(&self.path.join(".git/modules"))? {
            return Ok(true);
        }
        // `<mode> <object> <stage>\t<path>`; mode 160000 is a submodule.
        let listed = self.run_raw(&["ls-files", "--stage", "-z"])?;
        for entry in listed.split(|&b| b == 0) {
            let Some(tab) = entry.iter().position(|&b| b == b'\t') else { continue };
            if !entry.starts_with(b"160000 ") {
                continue;
            }
            // A path this platform cannot name is unknown, never clean.
            let Some(path) = os_path(&entry[tab + 1..]) else { return Ok(true) };
            let at = self.path.join(path);
            match std::fs::symlink_metadata(&at) {
                Ok(m) if m.is_dir() => {
                    if filled(&at)? {
                        return Ok(true);
                    }
                }
                Ok(_) => return Ok(true),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("could not read {}: {e}", at.display())),
            }
        }
        Ok(false)
    }

    /// Fetch `branch` into `repo` under the same name: the child's commits
    /// become a branch of the user's repository. Not forced, so a branch the
    /// user has since built on is never overwritten (the fetch fails instead),
    /// and only that one ref comes. Objects are checked as they arrive.
    /// Bounded by `limit`, like any fetch.
    pub(crate) fn fetch_branch(
        &self,
        repo: &Path,
        branch: &str,
        limit: std::time::Duration,
    ) -> Result<(), String> {
        let spec = format!("refs/heads/{branch}:refs/heads/{branch}");
        let dot = self.path.join(".git").to_string_lossy().into_owned();
        let opts = self.hardened();
        let mut args: Vec<&str> = opts.iter().map(String::as_str).collect();
        // Only the `file` transport, so no helper (`ext::`, a remote helper)
        // is ever started; the `-c`s reach the `upload-pack` git runs in the
        // checkout through the environment.
        args.extend([
            "-c",
            "protocol.allow=never",
            "-c",
            "protocol.file.allow=always",
            "-c",
            "transfer.fsckObjects=true",
            "fetch",
            "--quiet",
            "--no-tags",
            "--no-write-fetch-head",
            "--refmap=",
            "--no-recurse-submodules",
            "--",
            &dot,
            &spec,
        ]);
        run_limited(repo, &args, limit).map(|_| ())
    }
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
///
/// `--untracked-files=all` overrides a user's `status.showUntrackedFiles=no`,
/// under which a checkout holding only new files would read as clean and be
/// force-deleted with them.
#[cfg(feature = "cli")]
pub(crate) fn try_changed_paths(worktree: &Path) -> Result<Vec<String>, String> {
    changed_paths_with(|args| run(worktree, None, args))
}

/// The status [`Checkout::is_clean`] runs, split out so its arguments are
/// testable. `--untracked-files=normal` shows a new directory as one `?? dir/`
/// line instead of walking every file a child left in it (`node_modules`,
/// build output), and still overrides a user's `status.showUntrackedFiles=no`,
/// under which new files would read as clean and be deleted. The user's
/// global excludes file is emptied too: what it hides is still the child's.
#[cfg(feature = "cli")]
fn clean_with(git: impl Fn(&[&str]) -> Result<String, String>) -> Result<bool, String> {
    let args = [
        "-c",
        "core.excludesFile=",
        "status",
        "--porcelain",
        "--untracked-files=normal",
        "--ignore-submodules=all",
    ];
    Ok(git(&args)?.trim().is_empty())
}

#[cfg(feature = "cli")]
fn changed_paths_with(
    git: impl Fn(&[&str]) -> Result<String, String>,
) -> Result<Vec<String>, String> {
    Ok(git(&["status", "--porcelain", "--untracked-files=all"])?
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

/// Run `f` with `config` as the user's global git config, as a user's own
/// `~/.gitconfig` reaches every git Jan runs (repo config does not reach a
/// clone). Tests run with one thread, so the variable is safe to set; it is
/// put back even when `f` panics.
#[cfg(all(test, feature = "cli"))]
pub(crate) fn with_global_config<R>(config: &str, f: impl FnOnce() -> R) -> R {
    struct Restore(Option<std::ffi::OsString>, tempfile::NamedTempFile);
    impl Drop for Restore {
        fn drop(&mut self) {
            match self.0.take() {
                Some(value) => std::env::set_var("GIT_CONFIG_GLOBAL", value),
                None => std::env::remove_var("GIT_CONFIG_GLOBAL"),
            }
        }
    }
    let file = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(file.path(), config).unwrap();
    let restore = Restore(std::env::var_os("GIT_CONFIG_GLOBAL"), file);
    std::env::set_var("GIT_CONFIG_GLOBAL", restore.1.path());
    f()
}

#[cfg(all(test, feature = "cli"))]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU32;
    use std::sync::atomic::Ordering;

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// A file's text with line endings normalized. Git for Windows checks a
    /// tracked text file out as CRLF under its default `core.autocrlf=true`, so
    /// a byte-exact comparison only passes on the machine that wrote the file.
    /// These tests care which version of the file landed, not its EOL style.
    fn text(path: PathBuf) -> String {
        std::fs::read_to_string(path)
            .expect("readable file")
            .replace("\r\n", "\n")
    }

    /// A thread id unique to this test run. A thread's snapshot index lives in
    /// the system temp dir and outlives the run, so a fixed id makes the next
    /// run read an index that points at objects of a repo that is gone and fail
    /// with "is not a valid object" before the test's own logic runs.
    fn fresh_thread_id(tag: &str) -> String {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        format!("{tag}-{}-{n}", std::process::id())
    }

    /// git, and whatever it runs (credential helpers, ssh, aliases), cannot
    /// prompt on the TUI's terminal. The `/dev/tty` probe is only meaningful
    /// when the test runner has a terminal (it says "opened" for a git that
    /// shares Jan's session); `GIT_TERMINAL_PROMPT` is checked regardless.
    #[cfg(unix)]
    #[test]
    fn git_never_prompts_on_the_terminal() {
        let Ok(mut cmd) = git_command() else { return };
        let probe = "!echo \"prompt=$GIT_TERMINAL_PROMPT\"; \
                     if (: </dev/tty) 2>/dev/null; then echo opened; else echo denied; fi";
        let Ok(out) = cmd.args(["-c", &format!("alias.probe={probe}"), "probe"]).output() else {
            return;
        };
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "prompt=0\ndenied");
    }

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

    /// A file changed by a shell command (no write/edit call involved) and a
    /// new one both show up, which is what the write/edit ledger cannot see.
    #[test]
    fn workspace_status_reports_edits_made_outside_the_file_tools() {
        let Some(root) = init_repo() else { return };
        assert!(workspace_status(&root).is_none(), "a clean tree reports nothing");
        let out = std::process::Command::new("sh")
            .arg("-c")
            .arg("echo two >> a.txt && echo new > shell_made.txt")
            .current_dir(&root)
            .output()
            .unwrap();
        assert!(out.status.success());
        let status = workspace_status(&root).expect("a dirty tree reports");
        assert!(status.contains("M a.txt"), "{status}");
        assert!(status.contains("?? shell_made.txt"), "{status}");
        assert!(status.contains("Diff stat"), "{status}");
        let _ = std::fs::remove_dir_all(&root);
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
        assert_eq!(text(root.join("a.txt")), "one\n");

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
            text(wt.join("a.txt")),
            "two\n",
            "the branch starts from the snapshot, not HEAD and not the live tree"
        );
        let _ = std::fs::remove_dir_all(&wt);
    }

    #[cfg(windows)]
    #[test]
    fn native_path_strips_the_verbatim_prefix() {
        assert_eq!(native_path(Path::new(r"\\?\C:\tmp\x")), r"C:\tmp\x");
        assert_eq!(
            native_path(Path::new(r"\\?\UNC\srv\share\x")),
            r"\\srv\share\x"
        );
        assert_eq!(native_path(Path::new(r"C:\tmp\x")), r"C:\tmp\x");
    }

    /// `std::fs::canonicalize` yields a verbatim `\\?\C:\...` path on Windows,
    /// and `git worktree add` refuses to create directories under one
    /// (`could not create leading directories ... Invalid argument`) while
    /// every other git call accepts it. Jan stores canonical paths for child
    /// workspaces, so a worktree created from one must still be created.
    #[cfg(windows)]
    #[test]
    fn worktree_add_accepts_a_canonicalized_path() {
        let Some(root) = init_repo() else { return };
        let root = root.canonicalize().expect("canonical root");
        assert!(
            root.to_string_lossy().starts_with(r"\\?\"),
            "the test needs a verbatim path to reach the bug: {root:?}"
        );

        let wt = root.parent().unwrap().join(format!(
            "{}-canon-wt",
            root.file_name().unwrap().to_string_lossy()
        ));
        let _ = std::fs::remove_dir_all(&wt);
        let head = head_sha(&root).expect("a repo with one commit has a HEAD");
        worktree_add(&root, &wt, "jan/agent/canon", &head)
            .expect("worktree add from a canonical path");
        assert!(wt.join("a.txt").is_file(), "the tree was checked out");

        let _ = std::fs::remove_dir_all(&wt);
        let _ = std::fs::remove_dir_all(&root);
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

        let id = fresh_thread_id("test-thread");
        let thread_id = id.as_str();
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
        assert_eq!(text(root.join("a.txt")), "one\n");
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
        let id = fresh_thread_id("test-thread-2");
        let thread_id = id.as_str();
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
        let id = fresh_thread_id("test-thread-dirty-base");
        let thread_id = id.as_str();

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
        let id = fresh_thread_id("test-thread-dirty-now-ignored");
        let thread_id = id.as_str();
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
        let id = fresh_thread_id("test-thread-3");
        let thread_id = id.as_str();

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

    /// Concurrent fetches in one repository would share `FETCH_HEAD`, so one
    /// could resolve the commit another fetched. A fetch therefore resolves
    /// from a ref of its own and leaves `FETCH_HEAD`, and no ref, behind.
    #[test]
    fn fetch_commit_neither_reads_nor_writes_the_shared_fetch_head() {
        let Some(upstream) = init_repo() else { return };
        let trunk = current_branch(&upstream).unwrap();
        let base = head_sha(&upstream).unwrap();
        run(&upstream, None, &["checkout", "-q", "-b", "x"]).unwrap();
        std::fs::write(upstream.join("x.txt"), "x\n").unwrap();
        run(&upstream, None, &["add", "x.txt"]).unwrap();
        run(&upstream, None, &["commit", "-q", "-m", "x", "--no-gpg-sign"]).unwrap();
        let x = head_sha(&upstream).unwrap();
        run(&upstream, None, &["checkout", "-q", &trunk]).unwrap();
        let clone = upstream.with_extension("fetchhead");
        let _ = std::fs::remove_dir_all(&clone);
        let (from, to) = (upstream.to_string_lossy(), clone.to_string_lossy());
        git(&["clone", "-q", "--single-branch", "-b", &trunk, &from, &to]).unwrap();
        // What another fetch running alongside left there.
        let other = format!("{base}\t\tbranch 'other' of elsewhere\n");
        let fetch_head = clone.join(".git/FETCH_HEAD");
        std::fs::write(&fetch_head, &other).unwrap();

        assert_eq!(fetch_commit(&clone, "x", LIMIT).as_deref(), Ok(x.as_str()));
        assert_eq!(std::fs::read_to_string(&fetch_head).unwrap(), other);
        let left = run(&clone, None, &["for-each-ref", "refs/jan/"]).unwrap();
        assert!(left.is_empty(), "{left}");
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

    /// The primitives a subagent checkout's life is built from: resolve a ref
    /// to the commit it names, make a clone of its own that borrows only the
    /// user's objects, count what was committed in it, and bring its branch
    /// back into the user's repository.
    #[test]
    fn a_child_checkout_can_be_made_counted_and_brought_back() {
        let Some(root) = init_repo() else { return };
        let head = head_sha(&root).unwrap();
        assert_eq!(resolve_commit(&root, "HEAD").as_deref(), Some(head.as_str()));
        assert_eq!(resolve_commit(&root, "no-such-ref"), None);
        // A ref is never read as an option, whatever it is spelled as.
        assert_eq!(resolve_commit(&root, "--output=x"), None);

        let wt = root.parent().unwrap().join(format!(
            "{}-child",
            root.file_name().unwrap().to_string_lossy()
        ));
        let _ = std::fs::remove_dir_all(&wt);
        let objects = clone_shared(&root, &wt, "jan/agent/child-1", &head).unwrap();
        assert_eq!(objects, dunce::canonicalize(root.join(".git/objects")).unwrap());
        let wt = dunce::canonicalize(&wt).unwrap();
        assert!(wt.join(".git").is_dir(), "a repository of its own, not a linked worktree");
        assert!(!wt.join(".git/commondir").exists());
        let heads = run(&wt, None, &["for-each-ref", "--format=%(refname)"]).unwrap();
        assert_eq!(heads, "refs/heads/jan/agent/child-1", "no other branch, no remote refs");
        assert!(run(&wt, None, &["remote"]).unwrap().is_empty());

        let child = Checkout::open(&wt, &objects).unwrap();
        assert_eq!(child.current_branch().as_deref(), Some("jan/agent/child-1"));
        assert_eq!(child.commits_on(&head, "HEAD"), Some(0));
        std::fs::write(wt.join("b.txt"), "b\n").unwrap();
        run(&wt, None, &["add", "b.txt"]).unwrap();
        run(&wt, None, &["commit", "-q", "-m", "b", "--no-gpg-sign"]).unwrap();
        assert_eq!(child.commits_on(&head, "HEAD"), Some(1));
        assert_eq!(child.commits_on(&head, "refs/heads/jan/agent/child-1"), Some(1));
        assert_eq!(child.commits_on(&head, "--all"), None, "never an option");
        assert_eq!(child.commits_anywhere(&head), Some(1));
        std::fs::write(wt.join("c.txt"), "c\n").unwrap();
        assert_eq!(child.try_changed_paths(), Ok(vec!["c.txt".to_string()]));

        assert_eq!(resolve_commit(&root, "jan/agent/child-1"), None, "not there yet");
        child.fetch_branch(&root, "jan/agent/child-1", LIMIT).unwrap();
        let tip = head_sha(&wt).unwrap();
        assert_eq!(resolve_commit(&root, "jan/agent/child-1").as_deref(), Some(tip.as_str()));
        assert!(run(&root, None, &["for-each-ref", "refs/jan/"]).unwrap().is_empty());

        // A `.git` swapped for a file, a `commondir`, rewritten alternates and
        // a config that includes another file are each refused before any git
        // runs in it.
        let dot = wt.join(".git");
        let elsewhere = wt.join("elsewhere");
        std::fs::create_dir_all(&elsewhere).unwrap();
        let alternates = dot.join("objects/info/alternates");
        let good = std::fs::read_to_string(&alternates).unwrap();
        std::fs::write(&alternates, format!("{good}{}\n", elsewhere.display())).unwrap();
        let err = Checkout::open(&wt, &objects).unwrap_err();
        assert!(err.contains("alternates"), "{err}");
        std::fs::write(&alternates, &good).unwrap();
        std::fs::write(dot.join("commondir"), "/elsewhere\n").unwrap();
        assert!(Checkout::open(&wt, &objects).unwrap_err().contains("commondir"));
        std::fs::remove_file(dot.join("commondir")).unwrap();
        run(&wt, None, &["config", "include.path", "/elsewhere"]).unwrap();
        assert!(Checkout::open(&wt, &objects).unwrap_err().contains("include"));
        run(&wt, None, &["config", "--unset", "include.path"]).unwrap();
        assert!(Checkout::open(&wt, &objects).is_ok());
        let moved = wt.with_extension("moved");
        std::fs::rename(&dot, &moved).unwrap();
        std::fs::write(&dot, "gitdir: /elsewhere\n").unwrap();
        let err = Checkout::open(&wt, &objects).unwrap_err();
        assert!(err.contains(".git was replaced"), "{err}");
        let _ = std::fs::remove_dir_all(&moved);
        let _ = std::fs::remove_dir_all(&wt);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A child may tune git in its own checkout. Numeric and size keys cannot
    /// be emptied (git dies on `core.abbrev=`), and none of them names a
    /// program, so they are left alone while program-naming keys still are
    /// emptied. Otherwise every read fails and the child's branch is never
    /// brought back.
    #[test]
    fn a_numeric_tuning_key_in_the_child_checkout_does_not_break_jans_git() {
        let Some(root) = init_repo() else { return };
        let head = head_sha(&root).unwrap();
        let wt = root.parent().unwrap().join(format!(
            "{}-tuned",
            root.file_name().unwrap().to_string_lossy()
        ));
        let _ = std::fs::remove_dir_all(&wt);
        let objects = clone_shared(&root, &wt, "jan/agent/tuned-1", &head).unwrap();
        let wt = dunce::canonicalize(&wt).unwrap();
        for (key, value) in [
            ("core.compression", "9"),
            ("core.looseCompression", "1"),
            ("core.bigFileThreshold", "1m"),
            ("core.packedGitLimit", "256m"),
            ("core.deltaBaseCacheLimit", "64m"),
            ("core.abbrev", "12"),
            ("gc.auto", "0"),
            ("pack.threads", "2"),
            ("diff.renameLimit", "500"),
            ("core.sshCommand", "touch /tmp/never-run"),
        ] {
            run(&wt, None, &["config", key, value]).unwrap();
        }

        let child = Checkout::open(&wt, &objects).unwrap();
        assert_eq!(child.commits_anywhere(&head), Some(0));
        assert_eq!(child.current_branch().as_deref(), Some("jan/agent/tuned-1"));
        std::fs::write(wt.join("t.txt"), "t\n").unwrap();
        run(&wt, None, &["add", "t.txt"]).unwrap();
        run(&wt, None, &["commit", "-q", "-m", "t", "--no-gpg-sign"]).unwrap();
        assert_eq!(child.commits_anywhere(&head), Some(1));
        child.fetch_branch(&root, "jan/agent/tuned-1", LIMIT).unwrap();
        let tip = head_sha(&wt).unwrap();
        assert_eq!(resolve_commit(&root, "jan/agent/tuned-1").as_deref(), Some(tip.as_str()));

        let hardened = child.hardened();
        assert!(hardened.contains(&"core.sshcommand=".to_string()), "{hardened:?}");
        assert!(!hardened.iter().any(|o| o.starts_with("core.abbrev")), "{hardened:?}");
        let _ = std::fs::remove_dir_all(&wt);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The emptiness check asks git to show a new directory as one line rather
    /// than walk it, and an unreadable status is never "clean".
    #[test]
    fn the_emptiness_check_lists_untracked_files_normally() {
        let seen = std::cell::RefCell::new(Vec::new());
        let answer = |out: Result<&str, &str>| {
            clean_with(|args| {
                seen.borrow_mut().extend(args.iter().map(|a| a.to_string()));
                out.map(str::to_string).map_err(str::to_string)
            })
        };
        assert_eq!(answer(Ok("")), Ok(true));
        assert!(seen.borrow().iter().any(|a| a == "--untracked-files=normal"), "{seen:?}");
        assert!(seen.borrow().iter().any(|a| a == "core.excludesFile="), "{seen:?}");
        assert!(!seen.borrow().iter().any(|a| a == "--untracked-files=all"), "{seen:?}");
        assert_eq!(answer(Ok("?? node_modules/")), Ok(false));
        assert!(answer(Err("broken")).is_err());
    }

    /// A new directory full of files is work, even for a user who hides
    /// untracked files from `git status`.
    #[test]
    fn is_clean_sees_a_new_directory_as_work_when_status_hides_untracked_files() {
        let Some(root) = init_repo() else { return };
        let head = head_sha(&root).unwrap();
        let wt = root.with_extension("clean");
        let _ = std::fs::remove_dir_all(&wt);
        let objects = clone_shared(&root, &wt, "jan/agent/clean-1", &head).unwrap();
        let wt = dunce::canonicalize(&wt).unwrap();
        let child = Checkout::open(&wt, &objects).unwrap();
        assert_eq!(child.is_clean(), Ok(true));
        let deep = wt.join("node_modules/a/b");
        std::fs::create_dir_all(&deep).unwrap();
        for i in 0..500 {
            std::fs::write(deep.join(format!("{i}.js")), "x").unwrap();
        }
        let hidden = "[status]\n\tshowUntrackedFiles = no\n";
        assert_eq!(with_global_config(hidden, || child.is_clean()), Ok(false));
        let _ = std::fs::remove_dir_all(&wt);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Files only the user's own global excludes file hides are still the
    /// child's work: that file is not the checkout's to decide by.
    #[test]
    fn is_clean_sees_files_the_users_global_excludes_hide() {
        let Some(root) = init_repo() else { return };
        let head = head_sha(&root).unwrap();
        let wt = root.with_extension("excludes");
        let _ = std::fs::remove_dir_all(&wt);
        let objects = clone_shared(&root, &wt, "jan/agent/excludes-1", &head).unwrap();
        let wt = dunce::canonicalize(&wt).unwrap();
        let child = Checkout::open(&wt, &objects).unwrap();
        std::fs::create_dir_all(wt.join("out")).unwrap();
        std::fs::write(wt.join("out/report.md"), "x").unwrap();
        let excludes = root.with_extension("excludes-file");
        std::fs::write(&excludes, "out/\n").unwrap();
        let config = format!("[core]\n\texcludesFile = {}\n", excludes.display());
        assert_eq!(with_global_config(&config, || child.is_clean()), Ok(false));
        let _ = std::fs::remove_file(&excludes);
        let _ = std::fs::remove_dir_all(&wt);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A submodule's own repository is never looked into (its config could
    /// run a program), so one that holds anything counts as work: commits
    /// in `.git/modules`, or a repository checked out at a submodule's path.
    #[test]
    fn a_submodule_repository_counts_as_work() {
        let Some(root) = init_repo() else { return };
        let r = root.to_string_lossy().to_string();
        let head = head_sha(&root).unwrap();
        let link = format!("160000,{head},sub");
        git(&["-C", &r, "update-index", "--add", "--cacheinfo", &link]).unwrap();
        run(&root, None, &["commit", "-q", "-m", "sub", "--no-gpg-sign"]).unwrap();
        let head = head_sha(&root).unwrap();
        let wt = root.with_extension("modules");
        let _ = std::fs::remove_dir_all(&wt);
        let objects = clone_shared(&root, &wt, "jan/agent/modules-1", &head).unwrap();
        let wt = dunce::canonicalize(&wt).unwrap();
        let child = Checkout::open(&wt, &objects).unwrap();
        assert_eq!(child.is_clean(), Ok(true), "an empty submodule path is nothing");

        std::fs::create_dir_all(wt.join(".git/modules/sub")).unwrap();
        std::fs::write(wt.join(".git/modules/sub/HEAD"), "x").unwrap();
        assert_eq!(child.is_clean(), Ok(false), "an initialised submodule");
        std::fs::remove_dir_all(wt.join(".git/modules")).unwrap();
        assert_eq!(child.is_clean(), Ok(true));

        std::fs::create_dir_all(wt.join("sub/.git")).unwrap();
        assert_eq!(child.is_clean(), Ok(false), "a repository at the submodule");
        let _ = std::fs::remove_dir_all(&wt);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A submodule path that is not UTF-8 is checked as the bytes git gave,
    /// not a lossy decoding of them that names a path which does not exist:
    /// a filled one still counts as work.
    #[cfg(unix)]
    #[test]
    fn a_filled_submodule_at_a_non_utf8_path_counts_as_work() {
        use std::os::unix::ffi::OsStrExt;
        let Some(root) = init_repo() else { return };
        let r = root.to_string_lossy().to_string();
        let head = head_sha(&root).unwrap();
        let name = std::ffi::OsStr::from_bytes(b"sub-\xff");
        // `update-index --index-info` reads raw path bytes from stdin.
        let mut add = std::process::Command::new("git")
            .args(["-C", &r, "update-index", "--index-info"])
            .stdin(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let mut line = format!("160000 {head}\t").into_bytes();
        line.extend_from_slice(name.as_bytes());
        line.push(b'\n');
        std::io::Write::write_all(add.stdin.as_mut().unwrap(), &line).unwrap();
        drop(add.stdin.take());
        assert!(add.wait().unwrap().success());
        run(&root, None, &["commit", "-q", "-m", "sub", "--no-gpg-sign"]).unwrap();
        let head = head_sha(&root).unwrap();
        let wt = root.with_extension("rawsub");
        let _ = std::fs::remove_dir_all(&wt);
        let objects = clone_shared(&root, &wt, "jan/agent/rawsub-1", &head).unwrap();
        let wt = dunce::canonicalize(&wt).unwrap();
        let child = Checkout::open(&wt, &objects).unwrap();
        assert_eq!(child.is_clean(), Ok(true), "an empty submodule path is nothing");
        std::fs::create_dir_all(wt.join(name)).unwrap();
        std::fs::write(wt.join(name).join("work.txt"), "x").unwrap();
        let clean = child.is_clean();
        let _ = std::fs::remove_dir_all(&wt);
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(clean, Ok(false), "a filled submodule at a non-UTF-8 path");
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

    /// Commit an empty change with `subject` on whatever is checked out.
    fn commit(root: &Path, subject: &str) {
        run(root, None, &["commit", "-q", "--allow-empty", "--no-gpg-sign", "-m", subject])
            .expect("commit");
    }

    /// The memory tidy's facts name the default branch and its head, sort the
    /// branches by whether the default branch contains them, list the
    /// worktrees (a gone one flagged) and the PR numbers squash merges left in
    /// the log. A branch cut at the default's head has no commits of its own,
    /// so it is in no list; one cut at an older commit is contained, and its
    /// label says that may mean nothing landed.
    #[test]
    fn the_tidy_facts_say_what_landed_on_the_default_branch() {
        let Some(root) = init_repo() else { return };
        let r = root.to_string_lossy().to_string();
        git(&["-C", &r, "branch", "-M", "main"]).expect("rename");
        git(&["-C", &r, "checkout", "-q", "-b", "feat/landed"]).expect("checkout");
        commit(&root, "landed work");
        git(&["-C", &r, "checkout", "-q", "main"]).expect("checkout");
        git(&["-C", &r, "merge", "-q", "--ff-only", "feat/landed"]).expect("merge");
        git(&["-C", &r, "branch", "feat/older-start"]).expect("branch");
        commit(&root, "feat: squashed (#9497)");
        commit(&root, "feat: undone (#30)");
        commit(&root, "Revert \"feat: undone (#30)\" (#31)");
        commit(&root, "fix: another (#12)");
        git(&["-C", &r, "branch", "feat/fresh"]).expect("branch");
        git(&["-C", &r, "checkout", "-q", "-b", "feat/open"]).expect("checkout");
        commit(&root, "open work (#77)");
        git(&["-C", &r, "checkout", "-q", "main"]).expect("checkout");
        let wt = root.parent().unwrap().join(format!(
            "{}-factswt",
            root.file_name().unwrap().to_string_lossy()
        ));
        let _ = std::fs::remove_dir_all(&wt);
        let head = head_sha(&root).unwrap();
        worktree_add(&root, &wt, "jan/agent/facts", &head).expect("worktree add");
        std::fs::remove_dir_all(&wt).unwrap();

        let facts = tidy_facts(&root, "2026-11-03").expect("a repo has facts");
        assert!(facts.contains("Today: 2026-11-03"), "{facts}");
        assert!(facts.contains("Default branch: main, head "), "{facts}");
        assert!(facts.contains("fix: another (#12)"), "the head's subject: {facts}");
        // Squash merges leave a landed branch unmerged by commit, so that
        // list must not read as "still open".
        assert!(
            facts.contains("Branches not merged into main by commit (a squash-merged branch \
                 still lands here: check the PR numbers below)"),
            "{facts}"
        );
        assert!(facts.contains("the surest sign a PR landed"), "{facts}");
        assert!(
            facts.contains("Branches whose tip is contained in main (fully merged, or created \
                 there with no commits of their own yet), most recent first:"),
            "{facts}"
        );
        assert!(!facts.contains("their work landed"), "{facts}");
        let (merged, rest) = facts.split_once("not merged into").expect("both lists");
        assert!(merged.contains("  - feat/landed\n"), "{facts}");
        assert!(merged.contains("  - feat/older-start\n"), "{facts}");
        assert!(rest.contains("  - feat/open\n"), "{facts}");
        assert!(!merged.contains("feat/open"), "{facts}");
        assert!(!facts.contains("feat/fresh"), "no commits of its own: {facts}");
        assert!(!facts.contains("  - jan/agent/facts"), "a worktree branch at head: {facts}");
        assert!(!facts.contains("  - main\n"), "the default branch is not listed: {facts}");
        let gone = format!("{} [jan/agent/facts] (missing on disk)", wt.display());
        assert!(facts.contains(&gone), "{facts}");
        assert!(facts.contains(&format!("{} [main]\n", root.display())), "{facts}");
        assert!(
            facts.contains("  #12 #31 #9497\n"),
            "newest first, reverted #30 and branch-only #77 left out: {facts}"
        );
        assert!(
            facts.ends_with("PRs reverted in that log (their work did NOT land, or was undone):\n  \
                 #30"),
            "{facts}"
        );
        assert!(!facts.contains("#77"), "{facts}");
        assert!(facts.is_ascii() && !facts.contains("truncated"), "{facts}");
        worktree_prune(&root);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The remote's default branch wins over a local `main`, which may be stale.
    #[test]
    fn the_tidy_facts_prefer_the_remotes_default_branch() {
        let Some(root) = init_repo() else { return };
        let r = root.to_string_lossy().to_string();
        git(&["-C", &r, "branch", "-M", "main"]).expect("rename");
        let head = head_sha(&root).unwrap();
        run(&root, None, &["update-ref", "refs/remotes/origin/trunk", &head]).expect("ref");
        run(
            &root,
            None,
            &["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk"],
        )
        .expect("origin/HEAD");
        // Moved off the remote's head, which a listed branch must not share.
        commit(&root, "local only");
        let facts = tidy_facts(&root, "2026-11-03").expect("facts");
        assert!(facts.contains("Default branch: origin/trunk, head "), "{facts}");
        assert!(facts.contains("  - main\n"), "a local branch is listed: {facts}");
        assert!(!facts.contains("origin/HEAD"), "{facts}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// An `origin/HEAD` left pointing at a pruned branch (the remote renamed
    /// its default) falls through to a local `main` instead of dropping the
    /// facts.
    #[test]
    fn the_tidy_facts_skip_a_dangling_origin_head() {
        let Some(root) = init_repo() else { return };
        let r = root.to_string_lossy().to_string();
        git(&["-C", &r, "branch", "-M", "main"]).expect("rename");
        run(
            &root,
            None,
            &["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master"],
        )
        .expect("dangling origin/HEAD");
        let facts = tidy_facts(&root, "2026-11-03").expect("facts from the local main");
        assert!(facts.contains("Default branch: main, head "), "{facts}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A long branch list is cut and says so, and the whole block stays
    /// within its line budget.
    #[test]
    fn the_tidy_facts_truncate_and_say_so() {
        let Some(root) = init_repo() else { return };
        let r = root.to_string_lossy().to_string();
        git(&["-C", &r, "branch", "-M", "main"]).expect("rename");
        let head = head_sha(&root).unwrap();
        let total = TIDY_FACTS_BRANCHES + 5;
        // Loose ref files: one `git branch` per branch would spawn git a
        // hundred times for no extra coverage.
        let heads = root.join(".git/refs/heads");
        for i in 0..total {
            std::fs::write(heads.join(format!("b{i:03}")), format!("{head}\n")).unwrap();
        }
        // Branches at the default's head are left out, so move it on.
        commit(&root, "later");
        let facts = tidy_facts(&root, "2026-11-03").expect("facts");
        let listed = facts.lines().filter(|l| l.starts_with("  - b")).count();
        assert_eq!(listed, TIDY_FACTS_BRANCHES, "{facts}");
        assert!(facts.contains("... 5 more not listed (truncated)"), "{facts}");
        assert!(facts.lines().count() <= TIDY_FACTS_MAX_LINES, "{facts}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// With no `origin/HEAD`, `main` or `master` there is no branch whose
    /// merges mean "landed", so no block rather than one keyed to whatever
    /// happens to be checked out.
    #[test]
    fn the_tidy_facts_are_omitted_without_a_default_branch() {
        let Some(root) = init_repo() else { return };
        let r = root.to_string_lossy().to_string();
        git(&["-C", &r, "branch", "-M", "feat/only"]).expect("rename");
        assert_eq!(tidy_facts(&root, "2026-11-03"), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Outside a repository there is nothing to say, so no block at all.
    #[test]
    fn the_tidy_facts_are_omitted_outside_a_repository() {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("jan_facts_norepo_{}_{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(tidy_facts(&dir, "2026-11-03"), None);
        assert_eq!(tidy_facts(&dir.join("missing"), "2026-11-03"), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The last branch counts too, though trimming took its tab.
    #[test]
    fn branch_names_keep_the_last_line_and_skip_symrefs() {
        let listing = "refs/heads/main\t\nrefs/remotes/origin/HEAD\trefs/remotes/origin/main\n\
                       refs/remotes/origin/feat/x\t\nrefs/heads/last";
        assert_eq!(branch_names(listing, "main"), ["origin/feat/x", "last"]);
    }

    /// Only a subject's trailing `(#N)` is its squash merge's PR; one named
    /// earlier in the subject is just mentioned.
    #[test]
    fn pr_numbers_are_read_from_squash_merge_subjects() {
        let prs = pr_numbers("a (#1)\nb (#22) (#3)\nc #4\nd (#)\ne (#5x)\nf (#1)\ng (#6) ");
        assert_eq!(prs.landed, ["1", "3", "6"]);
        assert!(prs.reverted.is_empty());
    }

    /// A GitHub revert names the reverted PR inside its quotes: that one is
    /// reverted, not landed, even when its own merge is in the log too. The
    /// revert's own PR did land.
    #[test]
    fn pr_numbers_set_reverted_prs_apart() {
        let log = "Revert \"feat: x (#123)\" (#124)\nfeat: x (#123)\nRevert \"fix: y (#9)\"\n\
                   Revert \"no number\" (#50)\nfeat: z (#7)";
        let prs = pr_numbers(log);
        assert_eq!(prs.landed, ["124", "50", "7"]);
        assert_eq!(prs.reverted, ["123", "9"]);
    }

    /// A work-tree file named like the default branch must not make git read
    /// the branch as a path.
    #[test]
    fn the_tidy_facts_survive_a_file_named_like_the_default_branch() {
        let Some(root) = init_repo() else { return };
        let r = root.to_string_lossy().to_string();
        git(&["-C", &r, "branch", "-M", "main"]).expect("rename");
        commit(&root, "feat: kept (#5)");
        std::fs::write(root.join("main"), "x").unwrap();
        let facts = tidy_facts(&root, "2026-11-03");
        let _ = std::fs::remove_dir_all(&root);
        let facts = facts.expect("facts despite the file");
        assert!(facts.contains("Default branch: main, head "), "{facts}");
        assert!(facts.contains("  #5"), "{facts}");
        assert!(!facts.contains("PRs reverted"), "no reverts, no line: {facts}");
    }
}
