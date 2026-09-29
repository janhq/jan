//! Per-session git worktrees: the agent gets its own checkout of the user's
//! repository, on its own branch, so a run they do not like costs a
//! `git branch -D` rather than a revert of their working tree.
//!
//! This is isolation of the *files*, and it composes with the snapshots in
//! [`crate::core::agent::git`] rather than replacing them: checkpoints and
//! `rewind --workspace` still work, they just act on the worktree, because
//! `repo_root` resolves to the checkout the session actually runs in.
//!
//! Opt-in, most specific source first: `--worktree`/`--no-worktree`, then a
//! project's `[agent].worktree`, then `worktree` in `~/.jan/config.toml`. Off by
//! default, because turning it on moves every edit out of the directory the user
//! is looking at, which must be their decision rather than ours.
//!
//! The checkout lives under `~/.jan/worktrees/<repo-slug>/<id>`, outside the
//! repository. Inside it (`<project>/worktrees/...`) the agent's own
//! `find`/`grep`/`bash` would walk into a second copy of the tree whenever a
//! session ran in the main checkout, and `git clean` would delete it.
//!
//! What a session does *not* get is a way back: merging is the user's own `git`.
//! `/worktree` names the path, the branch and what changed in it; nothing here
//! writes to the user's branch or working tree.

use std::path::{Path, PathBuf};

use crate::core::agent::git;

/// A checkout a session works in, and the branch it is on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Worktree {
    pub path: PathBuf,
    pub branch: String,
}

/// Key under a thread's `metadata` recording the checkout it worked in, so a
/// resume reattaches to the same one instead of branching again.
pub const WORKTREE_KEY: &str = "worktree";

/// Off: the agent edits the user's own checkout, as it always has.
const DEFAULT_WORKTREE: bool = false;

/// How many ids to try before giving up, in case a directory is already there.
const ID_ATTEMPTS: usize = 4;

/// Resolve whether this session works in its own worktree, most specific source
/// first: the per-invocation flag, then the project's `[agent].worktree`, then
/// the user's global `worktree`, then the default.
pub fn resolve_enabled(flag: Option<bool>, configured: Option<bool>) -> bool {
    flag.or(configured)
        .or_else(crate::core::agent::global_config::worktree_setting)
        .unwrap_or(DEFAULT_WORKTREE)
}

/// `~/.jan/worktrees`, the user-wide home for agent checkouts.
pub fn worktrees_root() -> Result<PathBuf, String> {
    Ok(crate::core::agent::global_config::global_jan_dir()?.join("worktrees"))
}

/// Directory name for a repository: its own name plus a hash of its path, so two
/// checkouts of the same project do not share a worktree directory. The same
/// slug keys the project's store under `~/.jan/projects`.
pub fn repo_slug(repo: &Path) -> String {
    tauri_plugin_agent_tools::workspace::path_slug(repo)
}

/// Branch a session's worktree is checked out on. Namespaced under `jan/agent/`
/// so it is obvious in `git branch` whose it is, and cannot collide with a
/// branch the user maintains.
pub fn branch_for(id: &str) -> String {
    format!("jan/agent/{id}")
}

/// Read the pointer a thread recorded. Absent from a thread that never ran in a
/// worktree, which is every thread saved before this existed.
pub fn from_metadata(metadata: Option<&serde_json::Value>) -> Option<Worktree> {
    let entry = metadata?.get(WORKTREE_KEY)?;
    Some(Worktree {
        path: PathBuf::from(entry.get("path")?.as_str()?),
        branch: entry.get("branch")?.as_str()?.to_string(),
    })
}

/// The pointer to persist in a thread's `metadata`.
pub fn to_metadata(worktree: &Worktree) -> serde_json::Value {
    serde_json::json!({
        "path": worktree.path.to_string_lossy(),
        "branch": worktree.branch,
    })
}

/// Reattach to `recorded` when it is still a checkout of `repo`, else branch a
/// new one from `base` (any commit-ish; `HEAD` when the caller has nothing
/// better).
///
/// A recorded worktree the user has since deleted is not an error: the session
/// gets a fresh one. Refusing to start over a directory the user chose to
/// remove would make `rm -rf` on a worktree break the thread it belonged to.
pub fn attach_or_create(
    repo: &Path,
    recorded: Option<&Worktree>,
    base: Option<&str>,
) -> Result<Worktree, String> {
    if let Some(worktree) = recorded {
        if worktree.path.is_dir() && git::worktree_registered(repo, &worktree.path) {
            return Ok(worktree.clone());
        }
    }
    // A registration whose directory is gone still claims its path, and would
    // make `worktree add` refuse it.
    git::worktree_prune(repo);

    let base = base
        .map(str::to_string)
        .or_else(|| git::head_sha(repo))
        .ok_or_else(|| {
            "this repository has no commits yet, so there is nothing to branch a worktree from"
                .to_string()
        })?;
    let root = worktrees_root()?.join(repo_slug(repo));
    let mut last = String::new();
    for _ in 0..ID_ATTEMPTS {
        let id: String = uuid::Uuid::new_v4().to_string().chars().take(8).collect();
        let path = root.join(&id);
        if path.exists() {
            continue;
        }
        let branch = branch_for(&id);
        match git::worktree_add(repo, &path, &branch, &base) {
            Ok(()) => return Ok(Worktree { path, branch }),
            Err(e) => last = e,
        }
    }
    Err(if last.is_empty() {
        "could not find a free worktree directory".to_string()
    } else {
        last
    })
}

/// Set up the checkout this session works in, or explain why it cannot.
///
/// `recorded` is the resumed thread's pointer, `base` the commit a fresh
/// checkout starts from. The error is for the surface to show: a session that
/// cannot get a worktree runs in the project directory rather than refusing to
/// start, because the fallback is exactly the behaviour every session had
/// before this feature.
pub fn for_session(
    project_root: &Path,
    recorded: Option<&Worktree>,
    base: Option<&str>,
) -> Result<Worktree, String> {
    let repo = git::repo_root(project_root).ok_or_else(|| {
        "not a git repository, so there is nothing to make a worktree from".to_string()
    })?;
    attach_or_create(&repo, recorded, base)
}

/// One-line description of a worktree for a banner or a status row.
pub fn summary(worktree: &Worktree) -> String {
    let changed = git::changed_paths(&worktree.path).len();
    let files = if changed == 1 { "file" } else { "files" };
    format!(
        "{} on {} ({changed} changed {files})",
        worktree.path.display(),
        worktree.branch
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_slug_is_stable_and_separates_two_checkouts_of_one_name() {
        let a = Path::new("/home/u/src/jan");
        let b = Path::new("/home/u/work/jan");
        assert_eq!(repo_slug(a), repo_slug(a), "stable across calls");
        assert!(repo_slug(a).starts_with("jan-"));
        assert_ne!(
            repo_slug(a),
            repo_slug(b),
            "two checkouts of the same project must not share a directory"
        );
    }

    /// The hash is persisted in thread metadata by way of the path, so it is a
    /// wire value: pin it rather than letting a refactor quietly move every
    /// existing session's worktree.
    #[test]
    fn the_slug_hash_is_pinned() {
        assert_eq!(repo_slug(Path::new("/home/u/src/jan")), "jan-582afba2");
    }

    #[test]
    fn enabled_follows_the_most_specific_source() {
        assert!(resolve_enabled(Some(true), Some(false)));
        assert!(!resolve_enabled(Some(false), Some(true)));
        assert!(resolve_enabled(None, Some(true)));
    }

    #[test]
    fn metadata_round_trips() {
        let worktree = Worktree {
            path: PathBuf::from("/home/u/.jan/worktrees/jan-abc/3f7a91c2"),
            branch: "jan/agent/3f7a91c2".to_string(),
        };
        let meta = serde_json::json!({ WORKTREE_KEY: to_metadata(&worktree) });
        assert_eq!(from_metadata(Some(&meta)), Some(worktree));
    }

    #[test]
    fn a_thread_with_no_pointer_reads_as_none() {
        assert_eq!(from_metadata(None), None);
        assert_eq!(from_metadata(Some(&serde_json::json!({}))), None);
        // A half-written pointer is not a worktree either.
        assert_eq!(
            from_metadata(Some(
                &serde_json::json!({ WORKTREE_KEY: { "path": "/tmp/x" } })
            )),
            None
        );
    }
}
