//! Where a dispatched subagent works: its own git worktree, or the parent's
//! checkout, read-only unless it is a writer.
//!
//! Decided by the harness when the child is dispatched, never by a tool the
//! model calls. A child whose tool set can change files (`write`/`edit`) is a
//! *writer* and gets a fresh worktree on `jan/agent/<name>-<id>`, so parallel
//! writers never edit one checkout and none of them mixes its edits with the
//! user's uncommitted work. Every other child is a *reader*: it runs in the
//! checkout it was given with that checkout read-only, enforced by the file
//! tools and by a sandbox that is always on for it.
//!
//! A dispatch item's optional `workspace` overrides the default: `"new"`, a
//! fresh worktree; `"shared"`, the parent's checkout; the name of an earlier
//! subagent, that subagent's workspace; `{"ref": "<git ref>"}`, a fresh
//! worktree at that ref (fetched from `origin` when it is not local).
//!
//! Worktrees live under `~/.jan/worktrees/<project-slug>/`, never under `/tmp`
//! (the sandbox binds the session scratch over `/tmp`). The ledger here
//! remembers every child's workspace for the session, so a later dispatch can
//! name it, and at the session's end removes the worktrees that hold nothing:
//! no commit past their base and no uncommitted change, `ref` ones included
//! (a writer may have committed there). One git cannot read is kept.
//!
//! Only the CLI build creates worktrees; elsewhere every child works in its
//! parent's checkout, read-only unless it is a writer.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// The `workspace` a dispatch item asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceRequest {
    /// A fresh worktree from the parent checkout's `HEAD`.
    New,
    /// The parent's own checkout.
    Shared,
    /// The workspace of an earlier subagent of this session, by name.
    Reuse(String),
    /// A fresh worktree at a git ref.
    Ref(String),
}

/// Parse a dispatch item's `workspace` value. `None` when it is absent (the
/// writer/reader default applies).
pub(crate) fn parse_request(
    value: Option<&serde_json::Value>,
) -> Result<Option<WorkspaceRequest>, String> {
    let bad = || {
        "invalid 'workspace': use \"new\", \"shared\", the name of an earlier subagent, or \
         {\"ref\": \"<git ref>\"}"
            .to_string()
    };
    match value {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(s)) => match s.trim() {
            "new" => Ok(Some(WorkspaceRequest::New)),
            "shared" => Ok(Some(WorkspaceRequest::Shared)),
            name if is_worker_name(name) => Ok(Some(WorkspaceRequest::Reuse(name.to_string()))),
            _ => Err(bad()),
        },
        Some(serde_json::Value::Object(map)) if map.len() == 1 => match map.get("ref") {
            Some(serde_json::Value::String(r)) if is_ref(r.trim()) => {
                Ok(Some(WorkspaceRequest::Ref(r.trim().to_string())))
            }
            _ => Err(bad()),
        },
        Some(_) => Err(bad()),
    }
}

fn is_worker_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// A ref git would not read as an option and that names no path outside the
/// ref namespace; git itself rejects the rest when it resolves it.
fn is_ref(r: &str) -> bool {
    !r.is_empty() && !r.starts_with('-') && !r.chars().any(|c| c.is_whitespace() || c == '\0')
}

/// Whether a child with this final tool allowlist can change files. `None`
/// is the parent's whole toolset, which writes unless the parent denies both.
pub(crate) fn is_writer(
    allowed_tools: Option<&[String]>,
    permissions: &tauri_plugin_agent_tools::permissions::ToolPermissions,
) -> bool {
    ["write", "edit"].iter().any(|tool| {
        !permissions.is_denied(tool)
            && allowed_tools.is_none_or(|tools| tools.iter().any(|t| t == tool))
    })
}

/// A worktree the ledger created.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ChildWorktree {
    /// The checkout's top level.
    pub(crate) path: PathBuf,
    pub(crate) branch: String,
    /// The commit it was branched from.
    pub(crate) base: String,
    /// The `{"ref": ...}` it was made for, if any.
    pub(crate) from_ref: Option<String>,
    /// The main checkout's top level, which owns the registration.
    repo: PathBuf,
}

/// Where one child works.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ChildWorkspace {
    /// The child's `project_root`.
    pub(crate) root: PathBuf,
    /// Whether the child may change `root` (a reader may not).
    pub(crate) read_only: bool,
    /// The worktree `root` is in, when it is not the parent's checkout.
    pub(crate) worktree: Option<ChildWorktree>,
    /// Why a worktree that was wanted could not be made.
    pub(crate) fallback: Option<String>,
    /// Whether the parent's checkout had uncommitted changes the new worktree
    /// does not carry.
    pub(crate) left_changes: bool,
}

impl ChildWorkspace {
    /// The parent's checkout, as is.
    fn shared(root: &Path, read_only: bool) -> Self {
        Self {
            root: root.to_path_buf(),
            read_only,
            worktree: None,
            fallback: None,
            left_changes: false,
        }
    }

    /// The line the dispatch result carries for this child.
    pub(crate) fn note(&self) -> String {
        let fallback = self
            .fallback
            .as_deref()
            .map(|why| format!(" ({why}, so it uses your checkout)"))
            .unwrap_or_default();
        match (&self.worktree, self.read_only) {
            (Some(wt), read_only) => {
                let mode = if read_only { "read-only " } else { "" };
                let from = match &wt.from_ref {
                    Some(r) => format!("{r} at {}", short(&wt.base)),
                    None => short(&wt.base).to_string(),
                };
                let left = if self.left_changes {
                    "; uncommitted changes in your checkout are not in it"
                } else {
                    ""
                };
                format!(
                    "working in {mode}worktree {} (branch {}, from {from}){left}",
                    display(&self.root),
                    wt.branch
                )
            }
            (None, true) => format!("working read-only in {}{fallback}", display(&self.root)),
            (None, false) => format!("working in your checkout {}{fallback}", display(&self.root)),
        }
    }

    /// The short form a `SubagentStart` event and the TUI show.
    pub(crate) fn label(&self) -> String {
        let mode = if self.read_only { "read-only " } else { "" };
        match &self.worktree {
            Some(wt) => format!("{mode}{} ({})", display(&self.root), wt.branch),
            None => format!("{mode}{}", display(&self.root)),
        }
    }

    /// The line appended to the child's answer, so the parent reading it later
    /// knows which branch to merge.
    pub(crate) fn answer_footer(&self) -> Option<String> {
        let wt = self.worktree.as_ref().filter(|_| !self.read_only)?;
        Some(format!(
            "[worked in {} on branch {}]",
            display(&wt.path),
            wt.branch
        ))
    }
}

fn short(sha: &str) -> &str {
    &sha[..sha.len().min(9)]
}

fn display(path: &Path) -> String {
    let shown = match crate::core::agent::project::jan_home()
        .and_then(|home| home.parent().map(Path::to_path_buf))
    {
        Some(home) if !home.as_os_str().is_empty() => match path.strip_prefix(&home) {
            Ok(rest) => format!("~/{}", rest.display()),
            Err(_) => path.display().to_string(),
        },
        _ => path.display().to_string(),
    };
    shown.replace('\\', "/")
}

/// What a child's run is held to beyond its `project_root`: whether that root
/// is read-only, the extra directories its sandboxed shell may write, and the
/// environment its shell gets. `None` on a top-level run.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ChildScope {
    pub(crate) read_only: bool,
    pub(crate) write_roots: Vec<PathBuf>,
    pub(crate) env_set: Vec<(String, String)>,
}

/// `~/.jan/worktrees/<slug>` for the project `root` belongs to: its
/// subagents' worktrees and their shared build directory. Keyed like the
/// project store, so a session running in a Jan worktree finds the same one.
pub(crate) fn project_worktrees_dir(root: &Path) -> Option<PathBuf> {
    let key = tauri_plugin_agent_tools::workspace::project_key(root);
    Some(
        crate::core::agent::project::jan_home()?
            .join("worktrees")
            .join(tauri_plugin_agent_tools::workspace::path_slug(&key)),
    )
}

/// The one `CARGO_TARGET_DIR` every child of the project builds into, so a
/// fresh worktree does not start with a cold Rust build.
const CARGO_TARGET: &str = "cargo-target";

/// The scope a child in `ws` runs under: the shared build directory for any
/// child outside the plain writable checkout, the shared git dir for a writer
/// in a worktree (so its sandboxed `git commit` lands), and package caches in
/// the session scratch for a reader. `scratch` is that scratch, when the
/// session has one.
pub(crate) fn scope_for(
    ws: &ChildWorkspace,
    parent_root: &Path,
    scratch: Option<&Path>,
) -> ChildScope {
    let mut scope = ChildScope {
        read_only: ws.read_only,
        ..ChildScope::default()
    };
    if let Some(scratch) = scratch.filter(|_| ws.read_only) {
        let shown = tauri_plugin_agent_tools::tools::sandbox::scratch_display_path(
            Some(scratch),
            scratch,
        );
        scope.env_set.extend(reader_env(&shown));
    }
    if ws.worktree.is_some() || ws.read_only {
        if let Some(target) = project_worktrees_dir(parent_root).map(|d| d.join(CARGO_TARGET)) {
            if std::fs::create_dir_all(&target).is_ok() {
                scope.env_set.push((
                    "CARGO_TARGET_DIR".to_string(),
                    target.to_string_lossy().into_owned(),
                ));
                scope.write_roots.push(target);
            }
        }
    }
    if let Some(wt) = ws.worktree.as_ref().filter(|_| !ws.read_only) {
        if let Some(common) = git_common_dir(&wt.path) {
            scope.write_roots.push(common);
        }
    }
    scope
}

/// Point a child's run at its workspace: `project_root` (and so its prompt's
/// Working Directory and Runtime Environment blocks), its own Session Start
/// capture when it is not in the parent's checkout, and the scope its tools
/// enforce.
pub(crate) fn apply(
    args: &mut crate::core::agent::r#loop::OrchestrationArgs,
    ws: &ChildWorkspace,
    parent_root: &Path,
    scratch: Option<&Path>,
) {
    if ws.worktree.is_some() {
        args.session_start = Some(crate::core::agent::context::SessionStart::capture(Some(
            &ws.root,
        )));
    }
    args.project_root = Some(ws.root.clone());
    args.child_scope = Some(scope_for(ws, parent_root, scratch));
}

/// Package-manager caches a read-only child keeps in its scratch, since it
/// cannot write them into the project. `scratch_shell` is the scratch as the
/// shell names it.
fn reader_env(scratch_shell: &str) -> Vec<(String, String)> {
    let scratch = scratch_shell.trim_end_matches('/');
    vec![
        ("YARN_CACHE_FOLDER".to_string(), format!("{scratch}/yarn-cache")),
        ("COREPACK_HOME".to_string(), format!("{scratch}/corepack")),
    ]
}

/// The directory the parent's sandboxed tools may read its children's
/// worktrees through, created so the sandbox has something to bind. `None`
/// outside the CLI build or when there is no Jan home.
pub(crate) fn parent_read_root(root: &Path) -> Option<PathBuf> {
    if !cfg!(feature = "cli") {
        return None;
    }
    let dir = project_worktrees_dir(root)?;
    std::fs::create_dir_all(&dir).ok()?;
    dir.canonicalize().ok()
}

#[derive(Debug, Default)]
struct LedgerState {
    /// Every child's workspace, by worker name, for `workspace: "<name>"`.
    by_name: HashMap<String, ChildWorkspace>,
    /// Worktrees with a writer in them right now.
    busy: HashSet<PathBuf>,
    /// Worktrees this session created, in creation order.
    created: Vec<ChildWorktree>,
}

/// The session's record of its children's workspaces.
#[derive(Debug, Default)]
pub(crate) struct Ledger {
    state: Mutex<LedgerState>,
}

/// A writer's hold on its worktree, released when the child's task ends
/// (finished, failed or aborted).
#[derive(Debug)]
pub(crate) struct WriterLease {
    ledger: Arc<Ledger>,
    path: PathBuf,
}

impl Drop for WriterLease {
    fn drop(&mut self) {
        self.ledger.state.lock().unwrap().busy.remove(&self.path);
    }
}

impl Ledger {
    /// Assign `name` its workspace and record it. A writer in a worktree gets
    /// the lease that keeps a second writer out until it is done.
    pub(crate) fn assign(
        self: &Arc<Self>,
        parent_root: &Path,
        name: &str,
        writer: bool,
        request: Option<&WorkspaceRequest>,
    ) -> Result<(ChildWorkspace, Option<WriterLease>), String> {
        let read_only = !writer;
        let ws = match request {
            Some(WorkspaceRequest::Shared) => ChildWorkspace::shared(parent_root, read_only),
            Some(WorkspaceRequest::Reuse(earlier)) => {
                let found = self.state.lock().unwrap().by_name.get(earlier).cloned();
                let mut ws = found.ok_or_else(|| {
                    format!(
                        "workspace '{earlier}' names no earlier subagent of this session; use \
                         \"new\", \"shared\", or the name of a subagent that has already been \
                         dispatched"
                    )
                })?;
                ws.read_only = read_only;
                ws.left_changes = false;
                ws
            }
            Some(WorkspaceRequest::New) => create(parent_root, name, None, read_only)?,
            Some(WorkspaceRequest::Ref(r)) => create(parent_root, name, Some(r), read_only)?,
            None if writer => create(parent_root, name, None, read_only)?,
            None => ChildWorkspace::shared(parent_root, read_only),
        };
        let mut state = self.state.lock().unwrap();
        let lease = match ws.worktree.as_ref().filter(|_| writer) {
            Some(wt) => {
                if !state.busy.insert(wt.path.clone()) {
                    return Err(format!(
                        "another subagent is still writing in {} (branch {}); wait for it to \
                         finish, or give this one workspace \"new\"",
                        display(&wt.path),
                        wt.branch
                    ));
                }
                Some(WriterLease {
                    ledger: self.clone(),
                    path: wt.path.clone(),
                })
            }
            None => None,
        };
        if let Some(wt) = &ws.worktree {
            if !state.created.iter().any(|c| c.path == wt.path) {
                state.created.push(wt.clone());
            }
        }
        state.by_name.insert(name.to_string(), ws.clone());
        Ok((ws, lease))
    }
}

/// A fresh worktree for `name`, or the parent's checkout when the project
/// cannot have one (the reason is kept for the dispatch note).
#[cfg(feature = "cli")]
fn create(
    parent_root: &Path,
    name: &str,
    git_ref: Option<&str>,
    read_only: bool,
) -> Result<ChildWorkspace, String> {
    use crate::core::agent::git;
    let fallback = |why: &str| ChildWorkspace {
        fallback: Some(why.to_string()),
        ..ChildWorkspace::shared(parent_root, read_only)
    };
    let Some(repo) = git::repo_root(parent_root) else {
        if git_ref.is_some() {
            return Err("workspace {\"ref\": ...} needs a git repository".to_string());
        }
        return Ok(fallback("not a git repository"));
    };
    let base = match git_ref {
        Some(r) => match git::resolve_commit(&repo, r) {
            Some(sha) => sha,
            None => git::fetch_commit(&repo, r)
                .map_err(|e| format!("could not find or fetch ref '{r}': {e}"))?,
        },
        None => match git::head_sha(&repo) {
            Some(sha) => sha,
            None => return Ok(fallback("the repository has no commits yet")),
        },
    };
    let dir = project_worktrees_dir(parent_root)
        .ok_or_else(|| "could not resolve the Jan home for worktrees".to_string())?;
    git::worktree_prune(&repo);
    let mut last = String::new();
    for _ in 0..4 {
        let hex: String = uuid::Uuid::new_v4().simple().to_string()[..4].to_string();
        let id = format!("{name}-{hex}");
        let path = dir.join(&id);
        if path.exists() {
            continue;
        }
        let branch = format!("jan/agent/{id}");
        match git::worktree_add(&repo, &path, &branch, &base) {
            Ok(()) => {
                let path = path.canonicalize().unwrap_or(path);
                // A subdirectory of the checkout maps to the same one in the
                // worktree, so relative paths mean what they did.
                let rel = parent_root
                    .canonicalize()
                    .ok()
                    .and_then(|r| {
                        let top = repo.canonicalize().ok()?;
                        r.strip_prefix(top).ok().map(Path::to_path_buf)
                    })
                    .unwrap_or_default();
                let root = if rel.as_os_str().is_empty() {
                    path.clone()
                } else {
                    path.join(rel)
                };
                return Ok(ChildWorkspace {
                    root,
                    read_only,
                    left_changes: git_ref.is_none() && !git::changed_paths(&repo).is_empty(),
                    worktree: Some(ChildWorktree {
                        path,
                        branch,
                        base,
                        from_ref: git_ref.map(str::to_string),
                        repo: repo.clone(),
                    }),
                    fallback: None,
                });
            }
            Err(e) => last = e,
        }
    }
    Err(format!("could not create a worktree: {last}"))
}

/// The desktop has no subagent worktrees: a child keeps its parent's
/// workspace, as before.
#[cfg(not(feature = "cli"))]
fn create(
    parent_root: &Path,
    _name: &str,
    _git_ref: Option<&str>,
    read_only: bool,
) -> Result<ChildWorkspace, String> {
    Ok(ChildWorkspace {
        fallback: Some("subagent worktrees are CLI-only".to_string()),
        ..ChildWorkspace::shared(parent_root, read_only)
    })
}

#[cfg(feature = "cli")]
fn git_common_dir(path: &Path) -> Option<PathBuf> {
    crate::core::agent::git::git_common_dir(path)
}

#[cfg(not(feature = "cli"))]
fn git_common_dir(_path: &Path) -> Option<PathBuf> {
    None
}

#[cfg(feature = "cli")]
impl Ledger {
    /// End of session: remove every worktree that holds nothing (no commit
    /// past its base, no uncommitted change), `ref` ones included, and return
    /// a line for each one kept. A worktree a writer is still in is kept, and
    /// so is one git cannot read: removal is forced and deletes the branch,
    /// so "unknown" must never count as "clean".
    pub(crate) fn finish_session(&self) -> Vec<String> {
        use crate::core::agent::git;
        let mut state = self.state.lock().unwrap();
        let created = std::mem::take(&mut state.created);
        let mut kept = Vec::new();
        for wt in created {
            if !wt.path.is_dir() {
                continue;
            }
            let busy = state.busy.contains(&wt.path);
            let empty = git::commits_since(&wt.path, &wt.base) == Some(0)
                && git::try_changed_paths(&wt.path).is_ok_and(|c| c.is_empty());
            if !busy
                && empty
                && git::worktree_remove(&wt.repo, &wt.path, Some(&wt.branch)).is_ok()
            {
                continue;
            }
            kept.push(kept_line(&wt));
            state.created.push(wt);
        }
        state.by_name.clear();
        kept
    }

    /// The session's subagent worktrees still on disk, for `/worktree`.
    pub(crate) fn live(&self) -> Vec<String> {
        let state = self.state.lock().unwrap();
        state
            .created
            .iter()
            .filter(|wt| wt.path.is_dir())
            .map(kept_line)
            .collect()
    }
}

/// The session-end note naming the subagent worktrees left to merge.
#[cfg(feature = "cli")]
pub(crate) fn kept_notice(kept: &[String]) -> String {
    format!(
        "subagent worktrees kept (they hold work): {}",
        kept.join("; ")
    )
}

#[cfg(feature = "cli")]
fn kept_line(wt: &ChildWorktree) -> String {
    use crate::core::agent::git;
    let held = match (
        git::commits_since(&wt.path, &wt.base),
        git::try_changed_paths(&wt.path),
    ) {
        (Some(commits), Ok(changed)) => {
            format!("{commits} commit(s), {} uncommitted file(s)", changed.len())
        }
        _ => "status unknown: git could not read it".to_string(),
    };
    format!("{} on {} ({held})", display(&wt.path), wt.branch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_workspace_field_parses_every_documented_shape() {
        assert_eq!(parse_request(None), Ok(None));
        assert_eq!(parse_request(Some(&json!(null))), Ok(None));
        assert_eq!(parse_request(Some(&json!("new"))), Ok(Some(WorkspaceRequest::New)));
        assert_eq!(parse_request(Some(&json!("shared"))), Ok(Some(WorkspaceRequest::Shared)));
        assert_eq!(
            parse_request(Some(&json!("general-2"))),
            Ok(Some(WorkspaceRequest::Reuse("general-2".to_string())))
        );
        assert_eq!(
            parse_request(Some(&json!({"ref": "pull/9486/head"}))),
            Ok(Some(WorkspaceRequest::Ref("pull/9486/head".to_string())))
        );
        for bad in [
            json!(""),
            json!("../x"),
            json!(3),
            json!({"ref": "--upload-pack=x"}),
            json!({"ref": ""}),
            json!({"ref": "a", "extra": 1}),
            json!({"branch": "a"}),
        ] {
            assert!(parse_request(Some(&bad)).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_writer_is_a_child_that_can_write_or_edit() {
        use tauri_plugin_agent_tools::permissions::ToolPermissions;
        let all = ToolPermissions::allow_all();
        let names = |t: &[&str]| t.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(is_writer(None, &all));
        assert!(is_writer(Some(&names(&["read", "edit"])), &all));
        assert!(!is_writer(Some(&names(&["read", "ls", "shell"])), &all));
        let denied = ToolPermissions::new(
            tauri_plugin_agent_tools::permissions::PermissionDefault::Allow,
            &[],
            &names(&["write", "edit"]),
            &[],
        );
        assert!(!is_writer(None, &denied));
    }
}

#[cfg(all(test, feature = "cli"))]
mod git_tests {
    use super::*;
    use std::process::Command;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static N: AtomicUsize = AtomicUsize::new(0);

    fn git(dir: &Path, args: &[&str]) -> bool {
        Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// A repository with one commit, or `None` without git.
    fn repo(tag: &str) -> Option<PathBuf> {
        let dir = std::env::temp_dir().join(format!(
            "jan_child_ws_{tag}_{}_{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).ok()?;
        if !git(&dir, &["init", "-q", "-b", "main"]) {
            return None;
        }
        std::fs::write(dir.join("a.txt"), "a\n").ok()?;
        git(&dir, &["add", "a.txt"]);
        git(&dir, &["commit", "-q", "--no-gpg-sign", "-m", "a"]).then(|| dir.canonicalize().ok())?
    }

    fn commit(dir: &Path, file: &str) {
        std::fs::write(dir.join(file), "x\n").unwrap();
        assert!(git(dir, &["add", file]));
        assert!(git(dir, &["commit", "-q", "--no-gpg-sign", "-m", file]));
    }

    #[test]
    fn a_writer_gets_its_own_worktree_and_a_reader_the_checkout_read_only() {
        let Some(root) = repo("default") else { return };
        let ledger = Arc::new(Ledger::default());
        let (writer, lease) = ledger.assign(&root, "general", true, None).unwrap();
        let wt = writer.worktree.clone().expect("a writer gets a worktree");
        assert!(lease.is_some());
        assert!(!writer.read_only);
        assert_eq!(writer.root, wt.path);
        assert!(wt.branch.starts_with("jan/agent/general-"), "{}", wt.branch);
        assert!(wt.path.starts_with(project_worktrees_dir(&root).unwrap().canonicalize().unwrap()));
        assert_eq!(
            crate::core::agent::git::current_branch(&wt.path).as_deref(),
            Some(wt.branch.as_str())
        );
        let note = writer.note();
        assert!(note.contains(&wt.branch) && note.contains("worktree"), "{note}");
        assert_eq!(writer.answer_footer().map(|f| f.contains(&wt.branch)), Some(true));

        let (reader, lease) = ledger.assign(&root, "explore", false, None).unwrap();
        assert!(lease.is_none());
        assert_eq!(reader, ChildWorkspace::shared(&root, true));
        assert!(reader.note().starts_with("working read-only in "), "{}", reader.note());
        let _ = ledger.finish_session();
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn two_concurrent_writers_never_share_and_reuse_by_name_waits_its_turn() {
        let Some(root) = repo("lease") else { return };
        let ledger = Arc::new(Ledger::default());
        let (a, lease_a) = ledger.assign(&root, "general", true, None).unwrap();
        let (b, _lease_b) = ledger.assign(&root, "general-2", true, None).unwrap();
        assert_ne!(a.root, b.root, "two writers, two checkouts");

        let reuse = WorkspaceRequest::Reuse("general".to_string());
        let err = ledger.assign(&root, "general-3", true, Some(&reuse)).unwrap_err();
        assert!(err.contains("still writing"), "{err}");
        // A reader may look at it meanwhile, read-only.
        let (look, _) = ledger.assign(&root, "review", false, Some(&reuse)).unwrap();
        assert_eq!(look.root, a.root);
        assert!(look.read_only);

        drop(lease_a);
        let (again, lease) = ledger.assign(&root, "general-3", true, Some(&reuse)).unwrap();
        assert_eq!(again.root, a.root, "sequential reuse gets the same checkout");
        assert!(!again.read_only && lease.is_some());
        drop(lease);
        assert!(ledger
            .assign(&root, "x", true, Some(&WorkspaceRequest::Reuse("nobody".into())))
            .unwrap_err()
            .contains("no earlier subagent"));
        let _ = ledger.finish_session();
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_ref_worktree_is_checked_out_at_the_ref_fetching_it_when_needed() {
        let Some(upstream) = repo("upstream") else { return };
        assert!(git(&upstream, &["checkout", "-q", "-b", "feature"]));
        commit(&upstream, "feature.txt");
        let feature = crate::core::agent::git::head_sha(&upstream).unwrap();
        assert!(git(&upstream, &["checkout", "-q", "main"]));

        let clone = upstream.with_extension("clone");
        let _ = std::fs::remove_dir_all(&clone);
        assert!(git(
            upstream.parent().unwrap(),
            &["clone", "-q", "--single-branch", "-b", "main", &upstream.to_string_lossy(), &clone.to_string_lossy()]
        ));
        let clone = clone.canonicalize().unwrap();
        assert_eq!(crate::core::agent::git::resolve_commit(&clone, "feature"), None);

        let ledger = Arc::new(Ledger::default());
        let req = WorkspaceRequest::Ref("feature".to_string());
        let (ws, lease) = ledger.assign(&clone, "review", false, Some(&req)).unwrap();
        let wt = ws.worktree.clone().expect("a ref gets a worktree");
        assert!(ws.read_only && lease.is_none(), "a reader there is still read-only");
        assert_eq!(wt.base, feature);
        assert!(ws.root.join("feature.txt").is_file());
        assert!(ws.note().contains("feature at"), "{}", ws.note());

        assert!(ledger.finish_session().is_empty(), "an untouched ref worktree goes");
        assert!(!wt.path.exists());
        let _ = std::fs::remove_dir_all(&clone);
        let _ = std::fs::remove_dir_all(&upstream);
    }

    /// A writer working in a `ref` worktree commits on its `jan/agent/...`
    /// branch; session end must not delete that branch and lose the commits,
    /// nor drop uncommitted edits made there.
    #[test]
    fn a_ref_worktree_that_holds_work_is_kept_at_session_end() {
        let Some(root) = repo("refwork") else { return };
        assert!(git(&root, &["branch", "feature"]));
        let ledger = Arc::new(Ledger::default());
        let req = WorkspaceRequest::Ref("feature".to_string());
        let (committed, l1) = ledger.assign(&root, "general", true, Some(&req)).unwrap();
        let (dirty, l2) = ledger.assign(&root, "general-2", true, Some(&req)).unwrap();
        let (idle, l3) = ledger.assign(&root, "general-3", true, Some(&req)).unwrap();
        drop((l1, l2, l3));
        commit(&committed.root, "b.txt");
        let tip = crate::core::agent::git::head_sha(&committed.root).unwrap();
        std::fs::write(dirty.root.join("a.txt"), "edited\n").unwrap();

        let kept = ledger.finish_session();
        assert_eq!(kept.len(), 2, "{kept:?}");
        assert!(committed.root.is_dir() && dirty.root.is_dir());
        assert!(!idle.root.exists(), "an untouched ref worktree still goes");
        let branch = &committed.worktree.as_ref().unwrap().branch;
        assert_eq!(
            crate::core::agent::git::resolve_commit(&root, branch).as_deref(),
            Some(tip.as_str()),
            "the writer's commit is still on its branch"
        );
        let _ = std::fs::remove_dir_all(&committed.root);
        let _ = std::fs::remove_dir_all(&dirty.root);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// `git status` failing says nothing about whether the checkout is clean,
    /// so the worktree is kept and the kept line says why.
    #[test]
    fn a_worktree_whose_status_cannot_be_read_is_kept() {
        let Some(root) = repo("badstatus") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        std::fs::write(ws.root.join("a.txt"), "edited\n").unwrap();
        let out = Command::new("git")
            .arg("-C")
            .arg(&ws.root)
            .args(["rev-parse", "--git-path", "index"])
            .output()
            .unwrap();
        let index = PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());
        let index = if index.is_absolute() { index } else { ws.root.join(index) };
        std::fs::write(&index, "not an index").unwrap();

        let kept = ledger.finish_session();
        assert!(ws.root.join("a.txt").is_file(), "the edit survives");
        assert_eq!(kept.len(), 1, "{kept:?}");
        assert!(kept[0].contains("status unknown"), "{kept:?}");
        let _ = std::fs::remove_dir_all(&ws.root);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn session_end_removes_only_clean_commitless_worktrees() {
        let Some(root) = repo("cleanup") else { return };
        let ledger = Arc::new(Ledger::default());
        let (idle, l1) = ledger.assign(&root, "general", true, None).unwrap();
        let (committed, l2) = ledger.assign(&root, "general-2", true, None).unwrap();
        let (dirty, l3) = ledger.assign(&root, "general-3", true, None).unwrap();
        drop((l1, l2, l3));
        commit(&committed.root, "b.txt");
        std::fs::write(dirty.root.join("a.txt"), "edited\n").unwrap();

        let kept = ledger.finish_session();
        assert_eq!(kept.len(), 2, "{kept:?}");
        assert!(!idle.root.exists());
        let idle_branch = &idle.worktree.as_ref().unwrap().branch;
        assert_eq!(crate::core::agent::git::resolve_commit(&root, idle_branch), None);
        assert!(committed.root.is_dir() && dirty.root.is_dir());
        assert!(kept.iter().any(|k| k.contains("1 commit(s)")), "{kept:?}");
        assert_eq!(ledger.live().len(), 2);
        let _ = std::fs::remove_dir_all(&committed.root);
        let _ = std::fs::remove_dir_all(&dirty.root);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn outside_git_every_child_shares_the_checkout_and_readers_stay_read_only() {
        let dir = std::env::temp_dir().join(format!("jan_child_ws_nogit_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        if crate::core::agent::git::repo_root(&dir).is_some() {
            return;
        }
        let ledger = Arc::new(Ledger::default());
        let (w, lease) = ledger.assign(&dir, "general", true, None).unwrap();
        assert!(w.worktree.is_none() && !w.read_only && lease.is_none());
        assert!(w.note().contains("not a git repository"), "{}", w.note());
        let (r, _) = ledger.assign(&dir, "explore", false, Some(&WorkspaceRequest::New)).unwrap();
        assert!(r.read_only);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A writer child's `project_root`, and through it its Working Directory
    /// and Runtime Environment blocks, and its Session Start branch are its
    /// worktree's, not the parent's.
    #[test]
    fn a_writer_childs_args_point_at_its_worktree() {
        let Some(root) = repo("apply") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, _lease) = ledger.assign(&root, "general", true, None).unwrap();
        let wt = ws.worktree.clone().unwrap();
        let mut args = crate::core::agent::subagent::tests::max_par_args(&root);
        args.session_start = Some(crate::core::agent::context::SessionStart::capture(Some(&root)));
        apply(&mut args, &ws, &root, None);
        assert_eq!(args.project_root.as_deref(), Some(wt.path.as_path()));
        let start = args.session_start.as_ref().unwrap().block();
        assert!(start.contains(&wt.branch), "{start}");
        assert!(!args.child_scope.as_ref().unwrap().read_only);
        let prompt = crate::core::agent::context::compose_system_prompt(
            None,
            args.project_root.as_deref().unwrap(),
            None,
            false,
            &Default::default(),
            args.session_start.as_ref(),
            false,
        )
        .unwrap()
        .prefix;
        let shown = wt.path.to_string_lossy().replace('\\', "/");
        assert!(prompt.contains(&format!("Work directory: `{shown}`")), "{prompt}");
        assert!(prompt.contains(&format!("Current project directory: `{}`", wt.path.display())));

        let (reader, _) = ledger.assign(&root, "explore", false, None).unwrap();
        let mut args = crate::core::agent::subagent::tests::max_par_args(&root);
        apply(&mut args, &reader, &root, None);
        assert_eq!(args.project_root.as_deref(), Some(root.as_path()));
        assert!(args.child_scope.as_ref().unwrap().read_only);
        let _ = ledger.finish_session();
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_worktree_writer_may_write_the_shared_git_dir_and_build_dir() {
        let Some(root) = repo("scope") else { return };
        let ledger = Arc::new(Ledger::default());
        let (w, _lease) = ledger.assign(&root, "general", true, None).unwrap();
        let scope = scope_for(&w, &root, None);
        assert!(!scope.read_only);
        assert!(scope.write_roots.contains(&root.join(".git")), "{scope:?}");
        let target = project_worktrees_dir(&root).unwrap().join(CARGO_TARGET);
        assert!(scope.write_roots.contains(&target), "{scope:?}");
        assert!(scope.env_set.iter().any(|(k, v)| k == "CARGO_TARGET_DIR" && Path::new(v) == target));

        let (r, _) = ledger.assign(&root, "explore", false, None).unwrap();
        let scratch = std::env::temp_dir().join(format!("jan_child_scratch_{}", std::process::id()));
        let scope = scope_for(&r, &root, Some(&scratch));
        assert!(scope.read_only);
        assert_eq!(scope.write_roots, vec![target], "a reader never gets the git dir");
        let yarn = scope.env_set.iter().find(|(k, _)| k == "YARN_CACHE_FOLDER");
        assert!(yarn.is_some_and(|(_, v)| v.ends_with("/yarn-cache")), "{scope:?}");
        assert!(scope.env_set.iter().any(|(k, _)| k == "COREPACK_HOME"), "{scope:?}");
        let _ = ledger.finish_session();
        let _ = std::fs::remove_dir_all(&root);
    }
}
