//! Where a dispatched subagent works: its own checkout, or the parent's
//! checkout, read-only unless it is a writer.
//!
//! Decided by the harness when the child is dispatched, never by a tool the
//! model calls. A child whose tool set can change files (`write`/`edit`) is a
//! *writer* and gets a fresh checkout on `jan/agent/<name>-<id>`, so parallel
//! writers never edit one checkout and none of them mixes its edits with the
//! user's uncommitted work. Every other child is a *reader*: it runs in the
//! checkout it was given with that checkout read-only, enforced by the file
//! tools and by a sandbox that is always on for it.
//!
//! A child's checkout (a "worktree" to the user) is a repository of its own,
//! made by `git clone --shared`: it borrows the user's objects read-only and
//! keeps its refs, index, config and hooks to itself, so a sandboxed child
//! never writes the user's `.git` (which git reads, unsandboxed, the next time
//! the user works). Its branch comes back as `jan/agent/<name>-<id>` in the
//! user's repository when the child finishes, by a fetch that runs none of
//! the child's config (see [`Checkout`](crate::core::agent::git::Checkout)).
//!
//! A dispatch item's optional `workspace` overrides the default: `"new"`, a
//! fresh checkout; `"shared"`, the parent's checkout; the name of an earlier
//! subagent, that subagent's workspace; `{"ref": "<git ref>"}`, a fresh
//! checkout at that ref (fetched from `origin` when it is not local).
//!
//! Checkouts live under `~/.jan/worktrees/<project-slug>/`, never under `/tmp`
//! (the sandbox gives the shell a private, throwaway `/tmp`). The ledger here
//! remembers every child's workspace for the session, so a later dispatch can
//! name it, and at the session's end removes the checkouts that hold nothing:
//! no commit past their base and no uncommitted change, `ref` ones included
//! (a writer may have committed there). One git cannot read is kept. A
//! conversation ending (`/new`, `/clear`, `/resume`) does the same for its
//! own worktrees.
//!
//! Beside the checkouts, out of every child's reach, `.meta/<id>.json` records
//! what Jan made and `.meta/<id>.lock` is held by the process that owns it, so
//! a startup sweep can settle what a crashed session left without touching a
//! live one's. Removed checkouts are renamed into `.trash`, which that sweep
//! empties, so nobody waits on deleting them.
//!
//! Only the CLI build creates checkouts and holds readers to a read-only
//! checkout; on the desktop every child works in its parent's checkout as it
//! always has (see [`READ_ONLY_READERS`]).

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
            Some(serde_json::Value::String(r))
                if crate::core::agent::git::is_plain_ref(r.trim()) =>
            {
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

/// A checkout the ledger created.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ChildWorktree {
    /// The checkout's top level.
    pub(crate) path: PathBuf,
    pub(crate) branch: String,
    /// The commit it was branched from.
    pub(crate) base: String,
    /// The `{"ref": ...}` it was made for, if any.
    pub(crate) from_ref: Option<String>,
    /// The main checkout's top level, which its branch is fetched back into.
    repo: PathBuf,
    /// The user's object directory it borrows, as recorded when it was made:
    /// its own alternates file is the child's to rewrite.
    objects: PathBuf,
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
    /// The parent's subdirectory of the repository when the worktree lacks
    /// it (untracked, ignored, or absent at the ref), so `root` is the
    /// worktree's top level instead.
    pub(crate) missing_subdir: Option<String>,
    /// Whether the `assign` that returned this made `worktree` for it, rather
    /// than handing out an earlier child's: only then may [`Ledger::undo`]
    /// remove it.
    fresh: bool,
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
            missing_subdir: None,
            fresh: false,
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
                let subdir = match &self.missing_subdir {
                    Some(rel) => format!(
                        "; your directory {rel} is not in this checkout, so it starts at the \
                         top level"
                    ),
                    None => String::new(),
                };
                format!(
                    "working in {mode}worktree {} (branch {}, from {from}){left}{subdir}",
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

    /// Bring a writer's branch from its checkout into the user's repository,
    /// where the parent merges it. `Some(why)` when it could not be. Runs git.
    pub(crate) fn bring_back(&self) -> Option<String> {
        let wt = self.worktree.as_ref().filter(|_| !self.read_only)?;
        bring_back(wt).err()
    }

    /// The line appended to the child's answer, so the parent reading it later
    /// knows which branch to merge, or why that branch is not in the user's
    /// repository (`problem`, from [`Self::bring_back`]).
    pub(crate) fn answer_footer(&self, problem: Option<&str>) -> Option<String> {
        let wt = self.worktree.as_ref().filter(|_| !self.read_only)?;
        let path = display(&wt.path);
        Some(match problem {
            None => format!("[worked in {path} on branch {}]", wt.branch),
            Some(why) => format!(
                "[worked in {path} on branch {}, which is only there: it could not be brought \
                 into your repository ({why})]",
                wt.branch
            ),
        })
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
    /// Directories its tools may read besides its workspace and write roots:
    /// the user's objects its checkout borrows.
    pub(crate) read_roots: Vec<PathBuf>,
    pub(crate) write_roots: Vec<PathBuf>,
    pub(crate) env_set: Vec<(String, String)>,
}

/// `~/.jan/worktrees/<slug>` for the repository `root` belongs to: its
/// subagents' worktrees and their shared build directory. Keyed on the main
/// checkout's top level, so a session running in a Jan worktree or in any
/// subdirectory finds the same one, and so the slug is the one `project_key`
/// checks a clone's alternates (which name that top level) against.
pub(crate) fn project_worktrees_dir(root: &Path) -> Option<PathBuf> {
    let key = tauri_plugin_agent_tools::workspace::project_key(root);
    let top = key.ancestors().find(|dir| dir.join(".git").exists()).unwrap_or(&key);
    Some(
        crate::core::agent::project::jan_home()?
            .join("worktrees")
            .join(tauri_plugin_agent_tools::workspace::path_slug(top)),
    )
}

/// The one `CARGO_TARGET_DIR` every child of the project builds into, so a
/// fresh worktree does not start with a cold Rust build.
const CARGO_TARGET: &str = "cargo-target";

/// The scope a child in `ws` runs under: the shared build directory for any
/// child outside the plain writable checkout. A writer is granted nothing of
/// the user's `.git`: its commits go to its own, inside its workspace.
/// Package caches need nothing here: a sandboxed child, reader or not, gets
/// the project's package cache like any run (its checkout keys to the same
/// project), which is how a reader that cannot write its checkout still
/// installs.
pub(crate) fn scope_for(ws: &ChildWorkspace, parent_root: &Path) -> ChildScope {
    let mut scope = ChildScope {
        read_only: ws.read_only,
        ..ChildScope::default()
    };
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
    if let Some(wt) = &ws.worktree {
        scope.read_roots.push(wt.objects.clone());
    }
    scope
}

/// What a child's args take from its workspace beyond `project_root`, read
/// from git by [`place`] when the child is dispatched.
#[derive(Debug, Clone)]
pub(crate) struct Placement {
    /// The child's own Session Start, when it is not in the parent's checkout.
    session_start: Option<crate::core::agent::context::SessionStart>,
    scope: ChildScope,
}

/// Resolve the [`Placement`] of a child in `ws`: its checkout's branch and the
/// scope its tools enforce. Runs git, so the dispatch calls it on
/// the blocking pool and [`apply`], on the async child task, runs none.
pub(crate) fn place(ws: &ChildWorkspace, parent_root: &Path) -> Placement {
    Placement {
        session_start: ws.worktree.as_ref().map(|wt| {
            crate::core::agent::context::SessionStart::with_branch(worktree_branch(wt))
        }),
        scope: scope_for(ws, parent_root),
    }
}

/// Point a child's run at its workspace: `project_root` (and so its prompt's
/// Working Directory and Runtime Environment blocks), its own Session Start
/// when it is not in the parent's checkout, and the scope its tools enforce.
pub(crate) fn apply(
    args: &mut crate::core::agent::r#loop::OrchestrationArgs,
    ws: &ChildWorkspace,
    placement: Placement,
) {
    if let Some(start) = placement.session_start {
        args.session_start = Some(start);
    }
    args.project_root = Some(ws.root.clone());
    args.child_scope = Some(placement.scope);
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
    dunce::canonicalize(&dir).ok()
}

/// Whether a reader's checkout is read-only. CLI-only: the desktop's Windows
/// sandbox (AppContainer) has no read-only workspace, so enforcing one there
/// would take the shell away from every reader child instead.
const READ_ONLY_READERS: bool = cfg!(feature = "cli");

#[derive(Debug, Default)]
struct LedgerState {
    /// Every child's workspace, by worker name, for `workspace: "<name>"`.
    by_name: HashMap<String, ChildWorkspace>,
    /// Worktrees with a writer in them right now.
    busy: HashSet<PathBuf>,
    /// Worktrees a sweep or undo is checking for removal right now, which no
    /// dispatch may be given: they may be gone before its child starts.
    removing: HashSet<PathBuf>,
    /// Worktrees this session created, in creation order.
    created: Vec<ChildWorktree>,
    /// The lock on each of `created`'s metadata, held so no other jan
    /// process's startup sweep takes a worktree this one still owns.
    holds: HashMap<PathBuf, std::fs::File>,
}

/// The session's record of its children's workspaces.
#[derive(Debug, Default)]
pub(crate) struct Ledger {
    state: Mutex<LedgerState>,
}

/// A writer's hold on its worktree, released when the child is done (it
/// finished, failed, was stopped or was torn down), before the child counts
/// as finished.
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
    /// the lease that keeps a second writer out until it is done: a second
    /// writer naming a busy worktree is refused, not queued.
    pub(crate) fn assign(
        self: &Arc<Self>,
        parent_root: &Path,
        name: &str,
        writer: bool,
        request: Option<&WorkspaceRequest>,
    ) -> Result<(ChildWorkspace, Option<WriterLease>), String> {
        let read_only = !writer && READ_ONLY_READERS;
        let (ws, hold) = match request {
            Some(WorkspaceRequest::Shared) => {
                (ChildWorkspace::shared(parent_root, read_only), None)
            }
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
                ws.fresh = false;
                (ws, None)
            }
            Some(WorkspaceRequest::New) => create(parent_root, name, None, read_only)?,
            Some(WorkspaceRequest::Ref(r)) => create(parent_root, name, Some(r), read_only)?,
            None if writer => create(parent_root, name, None, read_only)?,
            None => (ChildWorkspace::shared(parent_root, read_only), None),
        };
        let mut state = self.state.lock().unwrap();
        // A reuse was looked up under an earlier hold of the lock: a sweep may
        // have removed that worktree since (dropping it from `created`). Only
        // a worktree the ledger still records, and that is still on disk, is
        // handed out; never a path git has already deleted.
        if let (Some(WorkspaceRequest::Reuse(earlier)), Some(wt)) = (request, ws.worktree.as_ref()) {
            let recorded = state.created.iter().any(|c| c.path == wt.path);
            if !recorded || !wt.path.is_dir() {
                return Err(format!(
                    "refused: the worktree of '{earlier}' ({}) was removed, as it held no \
                     work. This subagent was not started. Give it workspace \"new\" instead",
                    display(&wt.path)
                ));
            }
        }
        if let Some(wt) = ws.worktree.as_ref().filter(|wt| state.removing.contains(&wt.path)) {
            return Err(format!(
                "refused: {} (branch {}) is being removed, as it held no work. This \
                 subagent was not started. Give it workspace \"new\" instead",
                display(&wt.path),
                wt.branch
            ));
        }
        let lease = match ws.worktree.as_ref().filter(|_| writer) {
            Some(wt) => {
                if !state.busy.insert(wt.path.clone()) {
                    return Err(format!(
                        "refused: another subagent is still writing in {} (branch {}), and \
                         only one writer may work in a worktree at a time. This subagent was \
                         not started. Dispatch it again once that one has finished, or give \
                         it workspace \"new\"",
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
            if let Some(hold) = hold {
                state.holds.insert(wt.path.clone(), hold);
            }
        }
        state.by_name.insert(name.to_string(), ws.clone());
        Ok((ws, lease))
    }

    /// Take back the assignment `ws` that `name`'s dispatch got and never
    /// used (the run was torn down before the child could start): forget the
    /// name, and remove the worktree only when that `assign` made it and it
    /// holds nothing. Everything else the session made stays, since a later
    /// dispatch may still name it. Call after the dispatch's lease is gone.
    pub(crate) fn undo(&self, name: &str, ws: &ChildWorkspace) {
        // Only while the name is still this dispatch's: an undo arriving after
        // the conversation ended must not drop the next one's same name.
        let mut state = self.state.lock().unwrap();
        if state.by_name.get(name) == Some(ws) {
            state.by_name.remove(name);
        }
        drop(state);
        if let Some(wt) = ws.worktree.as_ref().filter(|_| ws.fresh) {
            self.remove_unless_busy(wt);
        }
    }

    /// Mark `path` as being removed, unless a writer is in it or it already
    /// is. While marked, `assign` hands it to nobody, so the git that decides
    /// and does the removal runs without the ledger's lock: a lease dropping
    /// meanwhile never waits on it.
    fn claim(&self, path: &Path) -> bool {
        let mut state = self.state.lock().unwrap();
        !state.busy.contains(path) && state.removing.insert(path.to_path_buf())
    }

    /// Remove `wt` when no writer is in it and it holds nothing, forgetting it
    /// and every name that pointed at it. Returns whether it went.
    fn remove_unless_busy(&self, wt: &ChildWorktree) -> bool {
        if !self.claim(&wt.path) {
            return false;
        }
        let gone = remove_if_empty(wt);
        if gone {
            forget_meta(wt);
        }
        let mut state = self.state.lock().unwrap();
        state.removing.remove(&wt.path);
        if gone {
            state.holds.remove(&wt.path);
            state.created.retain(|c| c.path != wt.path);
            state
                .by_name
                .retain(|_, ws| ws.worktree.as_ref().is_none_or(|w| w.path != wt.path));
        }
        gone
    }
}

/// Remove the checkout `wt` when it holds nothing: no commit past its base on
/// any ref and no uncommitted change. One git cannot read counts as holding
/// work, since removal deletes it. Returns whether it went.
#[cfg(feature = "cli")]
fn remove_if_empty(wt: &ChildWorktree) -> bool {
    empty_into_trash(wt).is_some()
}

/// [`remove_if_empty`], saying how it went: `Some(true)` when it was moved
/// into trash, `Some(false)` when deleted in place, `None` when kept.
#[cfg(feature = "cli")]
fn empty_into_trash(wt: &ChildWorktree) -> Option<bool> {
    // A checkout that is no longer what Jan made is never removed: what it
    // holds cannot be read without trusting it.
    let checkout = checkout(wt).ok()?;
    if checkout.commits_anywhere(&wt.base) != Some(0) || checkout.is_clean() != Ok(true) {
        return None;
    }
    trash(&wt.path)
}

/// Where Jan keeps what it knows of each checkout of a project: beside the
/// checkouts, out of every child's write roots (a child can rewrite anything
/// in its own checkout, so nothing there may say what to fetch from).
const META_DIR: &str = ".meta";

/// Where removed checkouts wait to be deleted, beside them so the move is a
/// rename on one filesystem.
#[cfg(feature = "cli")]
const TRASH_DIR: &str = ".trash";

/// `<id>.<ext>` in the metadata directory of the checkouts in `dir`.
fn meta_file(dir: &Path, id: &str, ext: &str) -> PathBuf {
    dir.join(META_DIR).join(format!("{id}.{ext}"))
}

/// Beside a lock file its owner could not lock: the checkout is never a
/// sweep's to decide (see [`reserve`]).
const UNLOCKED_EXT: &str = "unlocked";

/// Drop what was recorded of `wt` once it is gone: the record, then its
/// lock, which only the holder of that lock may unlink (a new owner never
/// reopens an existing lock file, see [`reserve`]).
fn forget_meta(wt: &ChildWorktree) {
    let (Some(dir), Some(id)) = (wt.path.parent(), wt.path.file_name()) else { return };
    let id = id.to_string_lossy();
    let _ = std::fs::remove_file(meta_file(dir, &id, "json"));
    let _ = std::fs::remove_file(meta_file(dir, &id, UNLOCKED_EXT));
    let _ = std::fs::remove_file(meta_file(dir, &id, "lock"));
}

/// What Jan recorded about a subagent checkout when it made it, so a later
/// process can settle it after this one died.
#[cfg(feature = "cli")]
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct WorktreeMeta {
    branch: String,
    base: String,
    from_ref: Option<String>,
    repo: PathBuf,
    objects: PathBuf,
    /// Settled already: its kept line was shown once, so no sweep repeats it.
    finished: bool,
}

/// Record `wt` beside it, atomically, so a sweep never reads half a record.
#[cfg(feature = "cli")]
fn write_meta(wt: &ChildWorktree, finished: bool) -> std::io::Result<()> {
    let (Some(dir), Some(id)) = (wt.path.parent(), wt.path.file_name()) else {
        return Err(std::io::Error::other("a checkout path without a parent"));
    };
    let meta = WorktreeMeta {
        branch: wt.branch.clone(),
        base: wt.base.clone(),
        from_ref: wt.from_ref.clone(),
        repo: wt.repo.clone(),
        objects: wt.objects.clone(),
        finished,
    };
    let id = id.to_string_lossy();
    let tmp = meta_file(dir, &id, "json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(&meta).map_err(std::io::Error::other)?)?;
    std::fs::rename(&tmp, meta_file(dir, &id, "json"))
}

/// Take `file`'s advisory lock without waiting: the OS drops it when the
/// holder dies, so a lock that is free has no live owner. `flock` is per
/// open file, so this process's own second open is refused too.
#[cfg(feature = "cli")]
fn lock(file: std::fs::File) -> std::io::Result<std::fs::File> {
    fs4::FileExt::try_lock(&file).map_err(std::io::Error::from)?;
    Ok(file)
}

/// Claim checkout id `id` in `dir` before cloning into it: its lock file is
/// created, never opened if it exists (`AlreadyExists`), so two processes
/// picking the same id cannot both own it. `None` when it cannot be locked
/// for any reason but another owner (a filesystem without locks, or a
/// transient `ENOLCK`, which look the same): the file still reserves the id,
/// so writers keep working there, and a marker beside it keeps every sweep
/// off the checkout, since no lock can show its owner has gone.
#[cfg(feature = "cli")]
fn reserve(dir: &Path, id: &str) -> std::io::Result<Option<std::fs::File>> {
    reserve_with(dir, id, lock)
}

/// [`reserve`] with the lock call given, so a filesystem without locks can be
/// tested.
#[cfg(feature = "cli")]
fn reserve_with(
    dir: &Path,
    id: &str,
    lock: impl FnOnce(std::fs::File) -> std::io::Result<std::fs::File>,
) -> std::io::Result<Option<std::fs::File>> {
    std::fs::create_dir_all(dir.join(META_DIR))?;
    let path = meta_file(dir, id, "lock");
    let file = crate::core::agent::session_log::open_no_follow(
        std::fs::OpenOptions::new().write(true).create_new(true),
        &path,
    )?;
    match lock(file) {
        Ok(file) => Ok(Some(file)),
        Err(e) if e.kind() != std::io::ErrorKind::WouldBlock => {
            // No lock to prove this owner alive, so no sweep may decide the
            // checkout: a later lock on the file (the error was transient, or
            // another process's filesystem view has locks) would read it as
            // an orphan. Its own owner still settles it.
            if let Err(marked) = std::fs::write(meta_file(dir, id, UNLOCKED_EXT), b"") {
                let _ = std::fs::remove_file(&path);
                return Err(marked);
            }
            Ok(None)
        }
        Err(e) => {
            let _ = std::fs::remove_file(&path);
            Err(e)
        }
    }
}

/// Move a checkout that holds nothing out of the way at once, into the
/// project's trash: deleting in place walks every file a child left
/// (`node_modules`, build output) while the user waits, and the trash keeps
/// it a while in case the emptiness check missed work. Deletes in place when
/// the rename fails (something mounted there, a handle still open on
/// Windows). `Some(true)` when trashed, `Some(false)` when deleted, `None`
/// when it is still there.
#[cfg(feature = "cli")]
fn trash(path: &Path) -> Option<bool> {
    if let (Some(dir), Some(id)) = (path.parent(), path.file_name()) {
        let bin = dir.join(TRASH_DIR);
        let to = bin.join(tauri_plugin_agent_tools::workspace::trash_name(&id.to_string_lossy()));
        if std::fs::create_dir_all(&bin).is_ok() && std::fs::rename(path, to).is_ok() {
            return Some(true);
        }
    }
    std::fs::remove_dir_all(path).is_ok().then_some(false)
}

/// Delete what has been in the trash of `root`'s project for
/// [`TRASH_KEPT_FOR`](tauri_plugin_agent_tools::workspace::TRASH_KEPT_FOR).
/// Startup only, off the render loop. A failure is logged, not retried:
/// another jan's sweep may be deleting it too, and the next start tries again.
#[cfg(feature = "cli")]
pub(crate) fn empty_trash(root: &Path) {
    let Some(bin) = project_worktrees_dir(root).map(|d| d.join(TRASH_DIR)) else { return };
    let Ok(entries) = std::fs::read_dir(&bin) else { return };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        // Never follow a link: only what is in the trash itself goes.
        let Ok(meta) = std::fs::symlink_metadata(&path) else { continue };
        let name = entry.file_name();
        if !tauri_plugin_agent_tools::workspace::trash_expired(&name.to_string_lossy(), &meta) {
            continue;
        }
        let gone = if meta.is_dir() {
            std::fs::remove_dir_all(&path)
        } else {
            std::fs::remove_file(&path)
        };
        if let Err(e) = gone {
            log::warn!("agent: could not empty {} from trash: {e}", path.display());
        }
    }
}

/// How long bringing a branch into the user's repository may take.
#[cfg(feature = "cli")]
const BRING_BACK_LIMIT: std::time::Duration = std::time::Duration::from_secs(60);

/// Fetch `wt`'s branch into the user's repository when it holds commits, so
/// the parent can merge it. Nothing is created for a branch with none.
#[cfg(feature = "cli")]
fn bring_back(wt: &ChildWorktree) -> Result<(), String> {
    let checkout = checkout(wt)?;
    match checkout.commits_on(&wt.base, &format!("refs/heads/{}", wt.branch)) {
        Some(0) => Ok(()),
        Some(_) => checkout.fetch_branch(&wt.repo, &wt.branch, BRING_BACK_LIMIT),
        None => Err(format!("git could not read its branch {}", wt.branch)),
    }
}

/// The desktop makes no checkouts, so there is never a branch to bring back.
#[cfg(not(feature = "cli"))]
fn bring_back(_wt: &ChildWorktree) -> Result<(), String> {
    Ok(())
}

/// The branch checked out in `wt`, read without trusting its `.git`.
#[cfg(feature = "cli")]
fn worktree_branch(wt: &ChildWorktree) -> Option<String> {
    checkout(wt).ok()?.current_branch()
}

/// The desktop makes no worktrees.
#[cfg(not(feature = "cli"))]
fn worktree_branch(_wt: &ChildWorktree) -> Option<String> {
    None
}

/// `wt` as Jan's git must be run in it: opened only while it is still the
/// repository Jan made. Every git call Jan makes in a child's checkout goes
/// through here, unsandboxed, so it never honors what the child rewrote. The
/// error says why not, for the user.
#[cfg(feature = "cli")]
fn checkout(wt: &ChildWorktree) -> Result<crate::core::agent::git::Checkout, String> {
    crate::core::agent::git::Checkout::open(&wt.path, &wt.objects)
}

/// The desktop makes no worktrees, so there is never one to remove.
#[cfg(not(feature = "cli"))]
fn remove_if_empty(_wt: &ChildWorktree) -> bool {
    false
}

/// How long a `{"ref": ...}` dispatch waits on `origin` before failing, so
/// an unreachable or hung remote cannot hold the dispatch forever.
#[cfg(feature = "cli")]
const REF_FETCH_LIMIT: std::time::Duration = std::time::Duration::from_secs(60);

/// A fresh checkout for `name`, or the parent's checkout when the project
/// cannot have one (the reason is kept for the dispatch note). A checkout
/// comes with the lock on its metadata, which its owner holds while it lives.
#[cfg(feature = "cli")]
fn create(
    parent_root: &Path,
    name: &str,
    git_ref: Option<&str>,
    read_only: bool,
) -> Result<(ChildWorkspace, Option<std::fs::File>), String> {
    use crate::core::agent::git;
    let fallback = |why: &str| {
        let ws = ChildWorkspace {
            fallback: Some(why.to_string()),
            ..ChildWorkspace::shared(parent_root, read_only)
        };
        Ok((ws, None))
    };
    let Some(repo) = git::repo_root(parent_root) else {
        if git_ref.is_some() {
            return Err("workspace {\"ref\": ...} needs a git repository".to_string());
        }
        return fallback("not a git repository");
    };
    let base = match git_ref {
        Some(r) => match git::resolve_commit(&repo, r) {
            Some(sha) => sha,
            None => git::fetch_commit(&repo, r, REF_FETCH_LIMIT)
                .map_err(|e| format!("could not find or fetch ref '{r}': {e}"))?,
        },
        None => match git::head_sha(&repo) {
            Some(sha) => sha,
            None => return fallback("the repository has no commits yet"),
        },
    };
    let dir = project_worktrees_dir(parent_root)
        .ok_or_else(|| "could not resolve the Jan home for worktrees".to_string())?;
    let mut last = String::new();
    for _ in 0..4 {
        let hex: String = uuid::Uuid::new_v4().simple().to_string()[..4].to_string();
        let id = format!("{name}-{hex}");
        let path = dir.join(&id);
        if path.exists() {
            continue;
        }
        let hold = match reserve(&dir, &id) {
            Ok(hold) => hold,
            Err(e) => {
                last = format!("could not reserve {id}: {e}");
                continue;
            }
        };
        let branch = format!("jan/agent/{id}");
        match git::clone_shared(&repo, &path, &branch, &base) {
            Ok(objects) => {
                // dunce, not std: Windows' `\\?\` form is what git refuses as a
                // clone URL, and every later git call is handed this path.
                let path = dunce::canonicalize(&path).unwrap_or(path);
                // A subdirectory of the checkout maps to the same one in the
                // worktree, so relative paths mean what they did.
                let rel = dunce::canonicalize(parent_root)
                    .ok()
                    .and_then(|r| {
                        let top = dunce::canonicalize(&repo).ok()?;
                        r.strip_prefix(top).ok().map(Path::to_path_buf)
                    })
                    .unwrap_or_default();
                // It may not exist there: untracked or ignored in the parent's
                // checkout, or absent at the ref. A child must never be given a
                // root that is not a directory, so it starts at the top level.
                let sub = Some(&rel)
                    .filter(|rel| !rel.as_os_str().is_empty())
                    .map(|rel| path.join(rel));
                let missing = sub.as_ref().is_some_and(|sub| !sub.is_dir());
                let root = sub.filter(|_| !missing).unwrap_or_else(|| path.clone());
                let wt = ChildWorktree {
                    path,
                    branch,
                    base,
                    from_ref: git_ref.map(str::to_string),
                    repo: repo.clone(),
                    objects,
                };
                // Without a record no later sweep can settle it, but this
                // process still can: the checkout is usable either way.
                let _ = write_meta(&wt, false);
                let ws = ChildWorkspace {
                    root,
                    read_only,
                    left_changes: git_ref.is_none() && !git::changed_paths(&repo).is_empty(),
                    missing_subdir: missing
                        .then(|| rel.to_string_lossy().replace('\\', "/")),
                    worktree: Some(wt),
                    fallback: None,
                    fresh: true,
                };
                return Ok((ws, hold));
            }
            Err(e) => {
                let _ = std::fs::remove_file(meta_file(&dir, &id, "lock"));
                last = e;
            }
        }
    }
    Err(format!("could not create a checkout: {last}"))
}

/// The desktop has no subagent worktrees: a child keeps its parent's
/// workspace, as before.
#[cfg(not(feature = "cli"))]
fn create(
    parent_root: &Path,
    _name: &str,
    _git_ref: Option<&str>,
    read_only: bool,
) -> Result<(ChildWorkspace, Option<std::fs::File>), String> {
    let ws = ChildWorkspace {
        fallback: Some("subagent worktrees are CLI-only".to_string()),
        ..ChildWorkspace::shared(parent_root, read_only)
    };
    Ok((ws, None))
}

/// A worktree a cleanup decides on, with the lock that keeps every other jan
/// process's sweep off it until the decision is made.
#[cfg(feature = "cli")]
#[derive(Debug)]
struct Owned {
    wt: ChildWorktree,
    hold: Option<std::fs::File>,
}

/// Worktrees taken from a ledger (or found orphaned) to be settled, off the
/// render loop: removed when they hold nothing, else brought back and named.
#[cfg(feature = "cli")]
pub(crate) struct Batch {
    ledger: Option<Arc<Ledger>>,
    owned: Vec<Owned>,
    /// Name a worktree a writer is still in rather than leave it unreported:
    /// at the session's end nothing later would mention it.
    report_busy: bool,
    /// Leave a kept worktree unmarked until its notice is taken (see
    /// [`Settled::report`]): its report may never be shown, and the next
    /// start must then name it. Session end prints its own and marks at once.
    mark_when_told: bool,
}

#[cfg(feature = "cli")]
impl Batch {
    pub(crate) fn is_empty(&self) -> bool {
        self.owned.is_empty()
    }

    /// Settle every worktree at once, one thread each, so N kept ones cost
    /// the slowest one rather than the sum (bringing a branch back may take a
    /// fetch).
    pub(crate) fn settle(self) -> Settled {
        let Batch { ledger, owned, report_busy, mark_when_told } = self;
        let ledger = ledger.as_ref();
        let outcomes: Vec<Outcome> = std::thread::scope(|scope| {
            let settling: Vec<_> = owned
                .into_iter()
                .map(|one| {
                    scope.spawn(move || settle_one(ledger, one, report_busy, mark_when_told))
                })
                .collect();
            settling.into_iter().filter_map(|t| t.join().ok()).collect()
        });
        let mut settled = Settled::default();
        for outcome in outcomes {
            match outcome {
                Outcome::Kept(line) => settled.kept.push(line),
                Outcome::KeptUnmarked(line, one) => {
                    settled.kept.push(line);
                    settled.unmarked.push(one);
                }
                Outcome::Trashed(bin) => {
                    settled.trashed += 1;
                    settled.trash = Some(bin);
                }
                Outcome::Gone => {}
            }
        }
        settled
    }
}

/// What settling a batch did, for the notice that tells the user.
#[cfg(feature = "cli")]
#[derive(Debug, Default)]
pub(crate) struct Settled {
    /// A line per worktree that holds work, in order.
    pub(crate) kept: Vec<String>,
    /// How many empty ones went to the trash, and where it is: the
    /// emptiness check can miss work, and the user must know where to look.
    trashed: usize,
    trash: Option<PathBuf>,
    /// Kept orphans not yet marked reported, each still locked: a sweep marks
    /// them only once its notice is taken, so a run that ends before it can
    /// show it leaves them for the next start to report.
    unmarked: Vec<Owned>,
}

#[cfg(feature = "cli")]
impl Settled {
    /// The notices naming what was kept and where the empty ones went, each
    /// shown on its own: the trash line is not one of the kept worktrees.
    pub(crate) fn notices(&self) -> Vec<String> {
        self.kept_notice().into_iter().chain(self.trash_notice()).collect()
    }

    fn kept_notice(&self) -> Option<String> {
        (!self.kept.is_empty()).then(|| kept_notice(&self.kept))
    }

    fn trash_notice(&self) -> Option<String> {
        self.trash.as_ref().map(|bin| {
            let days = tauri_plugin_agent_tools::workspace::TRASH_KEPT_FOR.as_secs() / 86_400;
            format!(
                "{} empty worktree(s) moved to {}; deleted after {days} days",
                self.trashed,
                display(bin)
            )
        })
    }

    /// Hand each notice to `report`, which says whether it reached the user,
    /// and mark the kept worktrees reported only when theirs did: an untold
    /// one must come up again at the next start, or the user never learns it
    /// holds work.
    pub(crate) fn report(mut self, report: &mut impl FnMut(String) -> bool) {
        if self.kept_notice().is_some_and(&mut *report) {
            self.mark_reported();
        }
        if let Some(notice) = self.trash_notice() {
            report(notice);
        }
    }

    /// The user has been told about the kept worktrees: no later sweep
    /// repeats them. Their locks drop once each is marked.
    fn mark_reported(&mut self) {
        for Owned { wt, hold } in self.unmarked.drain(..) {
            let _ = write_meta(&wt, true);
            drop(hold);
        }
    }
}

/// How one worktree of a batch was settled.
#[cfg(feature = "cli")]
enum Outcome {
    /// It holds work (or a writer is still in it): its kept line.
    Kept(String),
    /// It holds work and is reported later: its kept line, and the worktree
    /// with its lock, to be marked reported once the user has been told.
    KeptUnmarked(String, Owned),
    /// It held nothing and went into the trash at this path.
    Trashed(PathBuf),
    /// It held nothing and is gone, or it stays the ledger's unreported.
    Gone,
}

/// Decide one worktree of a batch. With a ledger it is claimed first, as an
/// undo would, so the two never decide one worktree together; one it cannot
/// claim (a writer is back in it, or an undo is deciding it) stays the
/// ledger's, lock included, for the next end.
#[cfg(feature = "cli")]
fn settle_one(
    ledger: Option<&Arc<Ledger>>,
    one: Owned,
    report_busy: bool,
    mark_when_told: bool,
) -> Outcome {
    let Owned { wt, hold } = one;
    if let Some(ledger) = ledger {
        if !ledger.claim(&wt.path) {
            let mut state = ledger.state.lock().unwrap();
            let busy = state.busy.contains(&wt.path);
            if !state.created.iter().any(|c| c.path == wt.path) {
                state.created.push(wt.clone());
            }
            if let Some(hold) = hold {
                state.holds.insert(wt.path.clone(), hold);
            }
            drop(state);
            return match busy && report_busy {
                true => Outcome::Kept(kept_line(&wt, None)),
                false => Outcome::Gone,
            };
        }
    }
    let emptied = if wt.path.is_dir() { empty_into_trash(&wt) } else { Some(false) };
    let outcome = if let Some(trashed) = emptied {
        forget_meta(&wt);
        match (trashed, wt.path.parent()) {
            (true, Some(dir)) => Outcome::Trashed(dir.join(TRASH_DIR)),
            _ => Outcome::Gone,
        }
    } else {
        // Whatever the child committed before it was stopped, so the user
        // has the branch to merge.
        let brought = bring_back(&wt).err();
        let line = kept_line(&wt, brought.as_deref());
        if mark_when_told {
            if let Some(ledger) = ledger {
                ledger.state.lock().unwrap().removing.remove(&wt.path);
            }
            return Outcome::KeptUnmarked(line, Owned { wt, hold });
        }
        // This process names it at its own end, so the user owns it now: no
        // later sweep reports it again.
        let _ = write_meta(&wt, true);
        Outcome::Kept(line)
    };
    if let Some(ledger) = ledger {
        ledger.state.lock().unwrap().removing.remove(&wt.path);
    }
    drop(hold);
    outcome
}

#[cfg(feature = "cli")]
impl Ledger {
    /// End the conversation's hold on its worktrees: forget every name (a
    /// later conversation must not be handed these) and take every worktree
    /// no writer is in, so a settle running later never sees the next
    /// conversation's. A busy one stays recorded for the next end. Takes the
    /// ledger's lock only: no git, no I/O.
    pub(crate) fn end_conversation(self: &Arc<Self>) -> Batch {
        Batch { mark_when_told: true, ..self.take(false) }
    }

    /// End of session: remove every checkout that holds nothing (no commit
    /// past its base, no uncommitted change), `ref` ones included, and return
    /// a line for each one kept, after bringing its branch into the user's
    /// repository. A checkout a writer is still in is kept, and so is one git
    /// cannot read: removal deletes it, so "unknown" must never count as
    /// "clean".
    ///
    /// The ledger's lock is held only to take the worktrees and to record
    /// each decision, never across git, so leases and dispatches carry on
    /// meanwhile.
    pub(crate) fn finish_session(self: &Arc<Self>) -> Settled {
        self.take(true).settle()
    }

    fn take(self: &Arc<Self>, busy_too: bool) -> Batch {
        let mut guard = self.state.lock().unwrap();
        let state = &mut *guard;
        state.by_name.clear();
        let mut owned = Vec::new();
        for wt in std::mem::take(&mut state.created) {
            if !busy_too && state.busy.contains(&wt.path) {
                state.created.push(wt);
                continue;
            }
            let hold = state.holds.remove(&wt.path);
            owned.push(Owned { wt, hold });
        }
        Batch { ledger: Some(self.clone()), owned, report_busy: busy_too, mark_when_told: false }
    }

    /// The session's subagent worktrees still on disk, for `/worktree`. Runs
    /// git per worktree, outside the ledger's lock.
    pub(crate) fn live(&self) -> Vec<String> {
        let created = self.state.lock().unwrap().created.clone();
        created
            .iter()
            .filter(|wt| wt.path.is_dir())
            .map(|wt| kept_line(wt, None))
            .collect()
    }
}

/// The session-end note naming the subagent worktrees left to merge: a
/// headline, then one worktree per line, so a display can hang each under it.
#[cfg(feature = "cli")]
pub(crate) fn kept_notice(kept: &[String]) -> String {
    format!("subagent worktrees kept (they hold work)\n{}", kept.join("\n"))
}

/// Settle the subagent worktrees of `root`'s project that no live jan
/// process owns (a crashed or killed session left them): remove the empty
/// ones, bring back the branches of the rest and name them, once. Never
/// removes one git cannot read, never touches one whose lock is held or whose
/// record does not describe the checkout beside it, and ignores checkouts
/// made before records were kept. Runs git: call it on the blocking pool.
#[cfg(feature = "cli")]
pub(crate) fn sweep_orphans(root: &Path) -> Settled {
    let Some(dir) = project_worktrees_dir(root).and_then(|d| dunce::canonicalize(d).ok()) else {
        return Settled::default();
    };
    let Ok(entries) = std::fs::read_dir(dir.join(META_DIR)) else { return Settled::default() };
    let mut owned = Vec::new();
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name();
        let Some(id) = name.to_str().and_then(|n| n.strip_suffix(".lock")) else { continue };
        if !is_checkout_id(id) {
            continue;
        }
        // Reserved without a lock: nothing can show its owner is gone.
        if meta_file(&dir, id, UNLOCKED_EXT).exists() {
            continue;
        }
        // Once: a lock that is not free right now has a live owner, and
        // skipping is always safe.
        let Ok(hold) = crate::core::agent::session_log::open_no_follow(
            std::fs::OpenOptions::new().write(true),
            &entry.path(),
        )
        .and_then(lock) else {
            continue;
        };
        // The owner may have unlinked this lock (it settled the worktree)
        // between the open and the lock, and a new owner of a reused id made
        // a fresh one: the lock taken is then on a file no one else sees.
        if !still_at(&hold, &entry.path()) {
            continue;
        }
        let path = dir.join(id);
        let present = std::fs::symlink_metadata(&path);
        let meta = match std::fs::read(meta_file(&dir, id, "json")) {
            Ok(bytes) => bytes,
            // Reserved, then the process died before it recorded the clone.
            // A clone directory without a record cannot be checked, so stays.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if present.is_err() {
                    let _ = std::fs::remove_file(entry.path());
                }
                continue;
            }
            Err(_) => continue,
        };
        let Ok(meta) = serde_json::from_slice::<WorktreeMeta>(&meta) else { continue };
        let Some(wt) = recorded_worktree(&dir, id, meta.clone()) else { continue };
        match present {
            Err(_) => forget_meta(&wt),
            Ok(m) if m.is_dir() && !meta.finished => owned.push(Owned { wt, hold: Some(hold) }),
            Ok(_) => {}
        }
    }
    Batch { ledger: None, owned, report_busy: false, mark_when_told: true }.settle()
}

/// What a session start sweeps, without holding the start up: the stale and
/// trashed session scratches (every project's, a week stale, never `session`'s
/// own), `root`'s project's worktree trash, and the worktrees crashed sessions
/// left there. `report` gets each notice and says whether it was taken (a run
/// that already ended cannot show it).
///
/// A plain thread, not the runtime's: dropping a tokio runtime (which `main`
/// returning does) waits for its blocking tasks, so a sweep there would hold
/// exit until its git and deletes were done. A process may exit mid-sweep:
/// its locks drop with it, records and renames are atomic, and the next start
/// redoes what is left.
#[cfg(feature = "cli")]
pub(crate) fn spawn_startup_sweep(
    root: PathBuf,
    session: Option<String>,
    mut report: impl FnMut(String) -> bool + Send + 'static,
) {
    std::thread::spawn(move || {
        if let Ok(rt) = tokio::runtime::Builder::new_current_thread().enable_all().build() {
            let keep: Vec<String> = session.into_iter().collect();
            rt.block_on(tauri_plugin_agent_tools::workspace::sweep_stale_scratch_dirs_in(
                &crate::core::agent::project::jan_cache_root(),
                &keep,
            ));
        }
        empty_trash(&root);
        sweep_and_report(&root, &mut report);
    });
}

/// Settle `root`'s orphaned worktrees and report them (see
/// [`Settled::report`]).
#[cfg(feature = "cli")]
fn sweep_and_report(root: &Path, report: &mut impl FnMut(String) -> bool) {
    sweep_orphans(root).report(report);
}

/// Whether `file` is still the file at `path`, not one unlinked since it was
/// opened.
#[cfg(all(feature = "cli", unix))]
fn still_at(file: &std::fs::File, path: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    match (file.metadata(), std::fs::symlink_metadata(path)) {
        (Ok(open), Ok(named)) => open.dev() == named.dev() && open.ino() == named.ino(),
        _ => false,
    }
}

/// Not checked off Unix: std has no stable file index to compare. A swap
/// there leaves the new owner's worktree unswept (a leak, never a loss: a
/// sweep only removes a lock with no record and no checkout).
#[cfg(all(feature = "cli", not(unix)))]
fn still_at(_file: &std::fs::File, _path: &Path) -> bool {
    true
}

/// `<worker name>-<4 hex>`, the only ids [`create`] makes.
#[cfg(feature = "cli")]
fn is_checkout_id(id: &str) -> bool {
    id.rsplit_once('-').is_some_and(|(name, hex)| {
        is_worker_name(name) && hex.len() == 4 && hex.bytes().all(|b| b.is_ascii_hexdigit())
    })
}

/// The worktree `meta` records for checkout `id` in `dir`, when it describes
/// that checkout: its branch, a real base, and a repository whose checkouts
/// live in `dir` (a record naming another project is not acted on). What it
/// borrows is enforced later by [`checkout`], as for a live ledger's.
#[cfg(feature = "cli")]
fn recorded_worktree(dir: &Path, id: &str, meta: WorktreeMeta) -> Option<ChildWorktree> {
    let home = project_worktrees_dir(&meta.repo).and_then(|d| dunce::canonicalize(d).ok());
    (meta.branch == format!("jan/agent/{id}")
        && crate::core::agent::git::is_object_id(&meta.base)
        && home.as_deref() == Some(dir))
    .then(|| ChildWorktree {
        path: dir.join(id),
        branch: meta.branch,
        base: meta.base,
        from_ref: meta.from_ref,
        repo: meta.repo,
        objects: meta.objects,
    })
}

#[cfg(feature = "cli")]
fn kept_line(wt: &ChildWorktree, not_brought: Option<&str>) -> String {
    let held = match checkout(wt) {
        Err(why) => format!(
            "not read and not removed: {why}. Do not run git in it; inspect its .git, or \
             delete the directory"
        ),
        Ok(checkout) => {
            let mut held = match (checkout.commits_anywhere(&wt.base), checkout.try_changed_paths())
            {
                (Some(commits), Ok(changed)) => {
                    format!("{commits} commit(s), {} uncommitted file(s)", changed.len())
                }
                _ => "status unknown: git could not read it".to_string(),
            };
            if let Some(why) = not_brought {
                held.push_str(&format!("; its branch is not in your repository: {why}"));
            }
            held
        }
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
            json!({"ref": "+refs/heads/x:refs/heads/main"}),
            json!({"ref": "x:main"}),
            json!({"ref": "+x"}),
            json!({"ref": "a\u{1}b"}),
            json!({"ref": ""}),
            json!({"ref": "a", "extra": 1}),
            json!({"branch": "a"}),
        ] {
            assert!(parse_request(Some(&bad)).is_err(), "{bad}");
        }
    }

    /// The desktop has no read-only children: a reader there works in its
    /// parent's checkout with nothing added to its tools, exactly as before
    /// subagent workspaces (AppContainer has no read-only workspace, so
    /// enforcing one would take the shell away from every reader on Windows).
    #[cfg(not(feature = "cli"))]
    #[test]
    fn a_desktop_reader_child_is_held_to_nothing_new() {
        let root = std::env::temp_dir().join(format!("jan_child_ws_desk_{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "explore", false, None).unwrap();
        assert!(lease.is_none());
        assert!(!ws.read_only, "{ws:?}");
        assert_eq!(scope_for(&ws, &root), ChildScope::default());
        let _ = std::fs::remove_dir_all(&root);
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
        // Not `std::fs::canonicalize`: on Windows its `\\?\` form reaches git
        // as a clone URL ("hostname contains invalid characters").
        git(&dir, &["commit", "-q", "--no-gpg-sign", "-m", "a"])
            .then(|| dunce::canonicalize(&dir).ok())?
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
        assert!(wt.path.starts_with(dunce::canonicalize(project_worktrees_dir(&root).unwrap()).unwrap()));
        assert_eq!(
            crate::core::agent::git::current_branch(&wt.path).as_deref(),
            Some(wt.branch.as_str())
        );
        let note = writer.note();
        assert!(note.contains(&wt.branch) && note.contains("worktree"), "{note}");
        assert_eq!(writer.answer_footer(None).map(|f| f.contains(&wt.branch)), Some(true));

        let (reader, lease) = ledger.assign(&root, "explore", false, None).unwrap();
        assert!(lease.is_none());
        assert_eq!(reader, ChildWorkspace::shared(&root, true));
        assert!(reader.note().starts_with("working read-only in "), "{}", reader.note());
        let _ = ledger.finish_session();
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn two_concurrent_writers_never_share_and_reuse_of_a_busy_worktree_is_refused() {
        let Some(root) = repo("lease") else { return };
        let ledger = Arc::new(Ledger::default());
        let (a, lease_a) = ledger.assign(&root, "general", true, None).unwrap();
        let (b, _lease_b) = ledger.assign(&root, "general-2", true, None).unwrap();
        assert_ne!(a.root, b.root, "two writers, two checkouts");

        let reuse = WorkspaceRequest::Reuse("general".to_string());
        let err = ledger.assign(&root, "general-3", true, Some(&reuse)).unwrap_err();
        assert!(err.contains("still writing") && err.contains("not started"), "{err}");
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
        let clone = dunce::canonicalize(&clone).unwrap();
        assert_eq!(crate::core::agent::git::resolve_commit(&clone, "feature"), None);

        let ledger = Arc::new(Ledger::default());
        let req = WorkspaceRequest::Ref("feature".to_string());
        let (ws, lease) = ledger.assign(&clone, "review", false, Some(&req)).unwrap();
        let wt = ws.worktree.clone().expect("a ref gets a worktree");
        assert!(ws.read_only && lease.is_none(), "a reader there is still read-only");
        assert_eq!(wt.base, feature);
        assert!(ws.root.join("feature.txt").is_file());
        assert!(ws.note().contains("feature at"), "{}", ws.note());

        assert!(ledger.finish_session().kept.is_empty(), "an untouched ref worktree goes");
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

        let kept = ledger.finish_session().kept;
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

        let kept = ledger.finish_session().kept;
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

        let kept = ledger.finish_session().kept;
        assert_eq!(kept.len(), 2, "{kept:?}");
        assert!(!idle.root.exists());
        let idle_branch = &idle.worktree.as_ref().unwrap().branch;
        assert_eq!(crate::core::agent::git::resolve_commit(&root, idle_branch), None);
        assert!(committed.root.is_dir() && dirty.root.is_dir());
        assert!(kept.iter().any(|k| k.contains("1 commit(s)")), "{kept:?}");
        // Named once and handed to the user: the ledger holds none of them.
        assert!(ledger.live().is_empty(), "{:?}", ledger.live());
        let _ = std::fs::remove_dir_all(&committed.root);
        let _ = std::fs::remove_dir_all(&dirty.root);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A user's global config hiding untracked files from `git status`.
    const HIDE_UNTRACKED: &str = "[status]\n\tshowUntrackedFiles = no\n";

    /// A user who hides untracked files from `git status` must not lose a
    /// writer's new, never-added files: they are its deliverables.
    #[test]
    fn an_untracked_only_worktree_is_kept_when_status_hides_untracked_files() {
        let Some(root) = repo("untracked") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        std::fs::create_dir_all(ws.root.join("out")).unwrap();
        std::fs::write(ws.root.join("out/report.md"), "deliverable\n").unwrap();

        let kept = crate::core::agent::git::with_global_config(HIDE_UNTRACKED, || {
            ledger.finish_session().kept
        });
        assert_eq!(kept.len(), 1, "{kept:?}");
        assert!(ws.root.join("out/report.md").is_file());
        let _ = std::fs::remove_dir_all(&ws.root);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A writer that committed on its branch and then moved HEAD away (back to
    /// the base, detached) still holds that work on the branch: the sweep
    /// must not force-delete it.
    #[test]
    fn a_branch_holding_commits_is_kept_even_when_head_moved_away() {
        let Some(root) = repo("head-moved") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        let wt = ws.worktree.as_ref().unwrap();
        commit(&ws.root, "b.txt");
        assert!(git(&ws.root, &["switch", "-q", "--detach", &wt.base]));

        let kept = ledger.finish_session().kept;
        assert_eq!(kept.len(), 1, "{kept:?}");
        assert!(kept[0].contains("1 commit(s)"), "{kept:?}");
        assert!(ws.root.is_dir());
        assert!(crate::core::agent::git::resolve_commit(&root, &wt.branch).is_some());
        let _ = std::fs::remove_dir_all(&ws.root);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Undoing a dispatch the run never started takes back only what that
    /// dispatch got: its name, and the worktree its own `assign` made. An
    /// earlier reader's fresh worktree (which holds no lease) and an earlier
    /// writer's stay, and so do their names, for a later `workspace` to reuse.
    #[test]
    fn undo_removes_only_the_worktree_that_assignment_made() {
        let Some(root) = repo("undo") else { return };
        let ledger = Arc::new(Ledger::default());
        let new = WorkspaceRequest::New;
        let (reader, _) = ledger.assign(&root, "explore", false, Some(&new)).unwrap();
        let (writer, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);

        let (late, lease) = ledger.assign(&root, "late", true, None).unwrap();
        drop(lease);
        ledger.undo("late", &late);
        let late_wt = late.worktree.as_ref().unwrap();
        assert!(!late_wt.path.exists(), "the undone dispatch's worktree is removed");
        assert_eq!(crate::core::agent::git::resolve_commit(&root, &late_wt.branch), None);
        assert!(reader.root.is_dir() && writer.root.is_dir());
        assert_eq!(ledger.live().len(), 2, "{:?}", ledger.live());

        // An undone reuse hands nothing back: the worktree was not its own.
        let reuse = WorkspaceRequest::Reuse("general".to_string());
        let (borrowed, lease) = ledger.assign(&root, "late-2", true, Some(&reuse)).unwrap();
        drop(lease);
        ledger.undo("late-2", &borrowed);
        assert!(writer.root.is_dir(), "an earlier child's worktree survives");

        for earlier in ["explore", "general"] {
            let reuse = WorkspaceRequest::Reuse(earlier.to_string());
            assert!(ledger.assign(&root, "next", false, Some(&reuse)).is_ok(), "{earlier}");
        }
        for gone in ["late", "late-2"] {
            let reuse = WorkspaceRequest::Reuse(gone.to_string());
            assert!(ledger.assign(&root, "next", false, Some(&reuse)).is_err(), "{gone}");
        }
        let _ = ledger.finish_session();
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Make the first `git status` in the checkout at `path` block for two
    /// seconds from when it starts, so a sweep is slow without any test seam.
    /// Git only opens an exclude file (it sees a FIFO's size as 0 and never
    /// reads it), so only the open can block: `info/exclude`, opened first,
    /// says status has started, and the top-level `.gitignore`, opened next,
    /// is held two seconds from then. A timer started at setup would run
    /// alongside the others and make a serial settle look parallel. `false`
    /// where there is no `mkfifo`.
    #[cfg(unix)]
    fn slow_status(path: &Path) -> bool {
        let exclude = path.join(".git/info/exclude");
        let ignore = path.join(".gitignore");
        let _ = std::fs::remove_file(&exclude);
        let fifo = |p: &Path| Command::new("mkfifo").arg(p).status().is_ok_and(|s| s.success());
        if !fifo(&exclude) || !fifo(&ignore) {
            return false;
        }
        std::thread::spawn(move || {
            let started = std::fs::OpenOptions::new().write(true).open(&exclude);
            let _ = std::fs::remove_file(&exclude);
            let _ = std::fs::write(&exclude, "");
            drop(started);
            std::thread::sleep(std::time::Duration::from_secs(2));
            let held = std::fs::OpenOptions::new().write(true).open(&ignore);
            let _ = std::fs::remove_file(&ignore);
            drop(held);
        });
        true
    }

    /// The sweep runs git per checkout; a writer finishing meanwhile (its
    /// lease dropping, from an async task) must not wait for that git.
    #[cfg(unix)]
    #[test]
    fn a_lease_drop_does_not_wait_on_a_slow_sweep() {
        use std::time::{Duration, Instant};
        let Some(root) = repo("slow") else { return };
        let ledger = Arc::new(Ledger::default());
        let (idle, l1) = ledger.assign(&root, "general", true, None).unwrap();
        let (busy, l2) = ledger.assign(&root, "general-2", true, None).unwrap();
        drop(l1);
        commit(&busy.root, "b.txt");
        if !slow_status(&idle.root) {
            return;
        }
        let sweep = {
            let ledger = ledger.clone();
            std::thread::spawn(move || ledger.finish_session().kept)
        };
        std::thread::sleep(Duration::from_millis(500));
        let started = Instant::now();
        drop(l2);
        let waited = started.elapsed();
        let kept = sweep.join().unwrap();
        assert!(waited < Duration::from_secs(1), "the lease drop waited {waited:?}");
        assert!(!idle.root.exists(), "the idle worktree still goes");
        assert_eq!(kept.len(), 1, "the one holding a commit is kept: {kept:?}");
        let _ = std::fs::remove_dir_all(&busy.root);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A worktree the sweep has claimed for removal is not handed to a later
    /// dispatch, writer or reader: it may be gone by the time the child starts.
    #[test]
    fn a_worktree_being_removed_is_not_reused() {
        let Some(root) = repo("removing") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        let path = ws.worktree.as_ref().unwrap().path.clone();
        assert!(ledger.claim(&path));
        assert!(!ledger.claim(&path), "one removal at a time");
        let reuse = WorkspaceRequest::Reuse("general".to_string());
        for writer in [true, false] {
            let err = ledger.assign(&root, "next", writer, Some(&reuse)).unwrap_err();
            assert!(err.contains("being removed"), "{err}");
        }
        ledger.state.lock().unwrap().removing.remove(&path);
        let (again, lease) = ledger.assign(&root, "next", true, Some(&reuse)).unwrap();
        assert_eq!(again.root, ws.root);
        assert!(!ledger.claim(&path), "a busy worktree is never claimed");
        drop(lease);
        let _ = ledger.finish_session();
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A reuse looked up just before a sweep removed that worktree (the name
    /// still maps to it, but git deleted it and the ledger dropped it) is
    /// refused, never re-recorded or handed out as a missing directory.
    #[test]
    fn a_reuse_of_a_worktree_swept_meanwhile_is_refused() {
        let Some(root) = repo("swept") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        let wt = ws.worktree.clone().unwrap();
        // The sweep's effect, landing between the lookup and the record.
        assert!(remove_if_empty(&wt));
        ledger.state.lock().unwrap().created.retain(|c| c.path != wt.path);

        let reuse = WorkspaceRequest::Reuse("general".to_string());
        for writer in [true, false] {
            let err = ledger.assign(&root, "next", writer, Some(&reuse)).unwrap_err();
            assert!(err.contains("was removed"), "{err}");
        }
        assert!(ledger.live().is_empty(), "{:?}", ledger.live());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A session in a subdirectory the new checkout lacks (untracked there, or
    /// absent at the ref) starts its child at the worktree's top level and says
    /// so, rather than handing it a `project_root` that does not exist.
    #[test]
    fn a_subdirectory_missing_from_the_worktree_falls_back_to_its_top_level() {
        let Some(root) = repo("subdir") else { return };
        assert!(git(&root, &["branch", "old"]));
        std::fs::create_dir_all(root.join("tracked")).unwrap();
        commit(&root.join("tracked"), "t.txt");
        std::fs::create_dir_all(root.join("scratch")).unwrap();
        std::fs::write(root.join("scratch/u.txt"), "u\n").unwrap();
        let ledger = Arc::new(Ledger::default());

        let (here, _l) = ledger.assign(&root.join("tracked"), "a", true, None).unwrap();
        let wt = here.worktree.clone().unwrap();
        assert_eq!(here.root, wt.path.join("tracked"), "a tracked subdirectory maps across");
        // Filed under the repository's slug, the one its alternates name, or
        // `project_key` would not trust them and the child would get an
        // empty store.
        assert_eq!(project_worktrees_dir(&root.join("tracked")), project_worktrees_dir(&root));
        assert!(!here.note().contains("not in this checkout"), "{}", here.note());

        let (untracked, _l) = ledger.assign(&root.join("scratch"), "b", true, None).unwrap();
        let wt = untracked.worktree.clone().unwrap();
        assert_eq!(untracked.root, wt.path);
        assert!(untracked.note().contains("scratch is not in this checkout"), "{}", untracked.note());

        let old = WorkspaceRequest::Ref("old".to_string());
        let (at_ref, _) = ledger.assign(&root.join("tracked"), "c", false, Some(&old)).unwrap();
        let wt = at_ref.worktree.clone().unwrap();
        assert_eq!(at_ref.root, wt.path);
        assert!(at_ref.note().contains("tracked is not in this checkout"), "{}", at_ref.note());
        drop(_l);
        let _ = ledger.finish_session();
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
        apply(&mut args, &ws, place(&ws, &root));
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
        let parent_start = args.session_start.clone();
        apply(&mut args, &reader, place(&reader, &root));
        assert_eq!(args.project_root.as_deref(), Some(root.as_path()));
        assert_eq!(args.session_start, parent_start, "a reader keeps the parent's start");
        assert!(args.child_scope.as_ref().unwrap().read_only);
        let _ = ledger.finish_session();
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A writer can swap its checkout's `.git` for a file `gitdir: <a dir it
    /// made>` whose config runs a program (`core.fsmonitor`). Jan's own git in
    /// that checkout runs unsandboxed, so it must neither follow the redirect
    /// nor remove the checkout, and the session-end line must say why it was
    /// kept.
    #[test]
    fn a_checkout_whose_git_dir_was_swapped_for_a_pointer_is_never_followed() {
        let Some(root) = repo("redirect") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        let wt = ws.worktree.clone().unwrap();
        let marker = root.with_extension("pwned");
        let _ = std::fs::remove_file(&marker);
        let evil = wt.path.with_extension("evil.git");
        assert!(git(&wt.path, &["init", "-q", "--bare", &evil.to_string_lossy()]));
        let hook = wt.path.with_extension("fsmonitor.sh");
        std::fs::write(&hook, format!("#!/bin/sh\ntouch '{}'\nexit 1\n", marker.display()))
            .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let wt_dir = wt.path.to_string_lossy().into_owned();
        let hook_cmd = hook.to_string_lossy().into_owned();
        for (k, v) in [("core.bare", "false"), ("core.worktree", wt_dir.as_str()),
            ("core.fsmonitor", hook_cmd.as_str())]
        {
            assert!(git(&evil, &["config", k, v]));
        }
        std::fs::rename(wt.path.join(".git"), wt.path.with_extension("orig.git")).unwrap();
        std::fs::write(wt.path.join(".git"), format!("gitdir: {}\n", evil.display())).unwrap();

        let live = ledger.live();
        let kept = ledger.finish_session().kept;
        let ran = marker.exists();
        let still_there = wt.path.is_dir();
        let _ = std::fs::remove_file(&marker);
        let _ = std::fs::remove_file(&hook);
        let _ = std::fs::remove_dir_all(&evil);
        let _ = std::fs::remove_dir_all(wt.path.with_extension("orig.git"));
        let _ = std::fs::remove_dir_all(&wt.path);
        let _ = std::fs::remove_dir_all(&root);
        assert!(!ran, "Jan's git ran the redirected repository's fsmonitor");
        assert!(still_there, "a tampered checkout is never removed");
        assert_eq!(kept.len(), 1, "{kept:?}");
        for line in live.iter().chain(&kept) {
            assert!(line.contains(".git was replaced"), "{line}");
        }
    }

    /// A project root that went through `std::fs::canonicalize` (on Windows
    /// the `\\?\C:\...` form) still gets a worktree, and the path the ledger
    /// keeps and hands to git carries no such prefix. Only Windows has the
    /// prefix; elsewhere this checks the same flow with a plain path.
    #[test]
    fn a_verbatim_project_root_still_gets_a_plain_worktree_path() {
        let Some(root) = repo("verbatim") else { return };
        let verbatim = std::fs::canonicalize(&root).unwrap();
        let ledger = Arc::new(Ledger::default());
        let (ws, _lease) = ledger.assign(&verbatim, "general", true, None).unwrap();
        let wt = ws.worktree.clone().expect("a writer gets a worktree");
        assert!(!wt.path.to_string_lossy().starts_with(r"\\?\"), "{wt:?}");
        assert!(wt.path.join(".git").is_dir(), "{wt:?}");
        let scope = scope_for(&ws, &verbatim);
        assert!(scope.read_roots.contains(&root.join(".git/objects")), "{scope:?}");
        let _ = ledger.finish_session();
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_writer_is_granted_the_build_dir_and_read_access_to_the_borrowed_objects_only() {
        let Some(root) = repo("scope") else { return };
        let ledger = Arc::new(Ledger::default());
        let (w, _lease) = ledger.assign(&root, "general", true, None).unwrap();
        let scope = scope_for(&w, &root);
        assert!(!scope.read_only);
        // Its commits go to the repository it is, inside its workspace: none
        // of the user's `.git` is writable, only its objects readable.
        let target = project_worktrees_dir(&root).unwrap().join(CARGO_TARGET);
        assert_eq!(scope.write_roots, vec![target.clone()], "{scope:?}");
        assert_eq!(scope.read_roots, vec![root.join(".git/objects")], "{scope:?}");
        assert!(scope.env_set.iter().any(|(k, v)| k == "CARGO_TARGET_DIR" && Path::new(v) == target));

        let (r, _) = ledger.assign(&root, "explore", false, None).unwrap();
        let scope = scope_for(&r, &root);
        assert!(scope.read_only);
        assert_eq!(scope.write_roots, vec![target], "a reader never gets the git dir");
        assert!(scope.read_roots.is_empty(), "{scope:?}");
        // Package caches come from the run's own package cache, not the scope.
        assert!(!scope.env_set.iter().any(|(k, _)| k == "YARN_CACHE_FOLDER"), "{scope:?}");
        let _ = ledger.finish_session();
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Run `command` in `ws` the way its child's shell runs: sandboxed, under
    /// the scope [`scope_for`] gives it. `None` when no sandbox can start here.
    fn child_shell(ws: &ChildWorkspace, parent_root: &Path, command: &str) -> Option<String> {
        child_shell_seeing(ws, parent_root, &[], command)
    }

    /// [`child_shell`] with `visible` also mounted read-only, as the user's
    /// home is for a run with `home_readonly`.
    fn child_shell_seeing(
        ws: &ChildWorkspace,
        parent_root: &Path,
        visible: &[PathBuf],
        command: &str,
    ) -> Option<String> {
        use tauri_plugin_agent_tools::tools::{handlers::execute_builtin, jail, lookup, ToolContext};
        if !jail::backend().enforces() {
            eprintln!("skipping: no sandbox backend on this host");
            return None;
        }
        let scope = scope_for(ws, parent_root);
        let reads: Vec<PathBuf> = scope
            .write_roots
            .iter()
            .chain(&scope.read_roots)
            .chain(visible)
            .cloned()
            .collect();
        let store = std::env::temp_dir().join(format!("jan_child_store_{}", std::process::id()));
        let ctx = ToolContext::new(&ws.root, &store, &[])
            .with_sandbox(true)
            .with_read_roots(&reads)
            .with_write_roots(&scope.write_roots)
            .with_env_set(&scope.env_set);
        let args = serde_json::json!({"command": command, "timeout": 120});
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        Some(rt.block_on(execute_builtin(lookup("shell").unwrap(), &args, &ctx)).0)
    }

    /// Every entry under `dir` but those `skip` names: a file's contents, a
    /// symlink's target, a directory as itself.
    fn tree(dir: &Path, skip: &dyn Fn(&str) -> bool) -> std::collections::BTreeMap<String, String> {
        fn walk(
            top: &Path,
            dir: &Path,
            skip: &dyn Fn(&str) -> bool,
            out: &mut std::collections::BTreeMap<String, String>,
        ) {
            for entry in std::fs::read_dir(dir).unwrap().map(Result::unwrap) {
                let path = entry.path();
                let rel = path.strip_prefix(top).unwrap().to_string_lossy().replace('\\', "/");
                if skip(&rel) {
                    continue;
                }
                let meta = std::fs::symlink_metadata(&path).unwrap();
                if meta.file_type().is_symlink() {
                    let to = std::fs::read_link(&path).unwrap();
                    out.insert(rel, format!("-> {}", to.display()));
                } else if meta.is_dir() {
                    out.insert(rel, "dir".to_string());
                    walk(top, &path, skip, out);
                } else {
                    let bytes = std::fs::read(&path).unwrap();
                    out.insert(rel, String::from_utf8_lossy(&bytes).into_owned());
                }
            }
        }
        let mut out = std::collections::BTreeMap::new();
        walk(dir, dir, skip, &mut out);
        out
    }

    /// A writer's checkout is a repository of its own, so every git operation
    /// works there under the sandbox, the ones that rewrite `packed-refs` or
    /// repack included.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_sandboxed_writer_can_run_any_git_operation_in_its_checkout() {
        let Some(root) = repo("anyop") else { return };
        assert!(git(&root, &["tag", "v1"]));
        let ledger = Arc::new(Ledger::default());
        let (ws, _lease) = ledger.assign(&root, "general", true, None).unwrap();
        let id = "-c user.name=t -c user.email=t@t -c commit.gpgSign=false -c tag.gpgSign=false";
        let steps = [
            format!("echo b > b.txt && git add b.txt && git {id} commit -q -m b"),
            "git branch side && git branch -d side".to_string(),
            format!("git {id} tag -a -m t t1 && git tag -d t1"),
            "echo s >> b.txt && git stash -q && git stash pop -q && \
             ! git rev-parse -q --verify refs/stash && grep -q s b.txt"
                .to_string(),
            "git gc -q && git pack-refs --all && git repack -q -a -d".to_string(),
        ];
        let mut failed = Vec::new();
        for step in &steps {
            let Some(out) = child_shell(&ws, &root, step) else { return };
            if !out.contains("[exit 0]") {
                failed.push(format!("{step}: {out}"));
            }
        }
        let _ = ledger.finish_session();
        let _ = std::fs::remove_dir_all(&ws.worktree.as_ref().unwrap().path);
        let _ = std::fs::remove_dir_all(&root);
        assert!(failed.is_empty(), "{failed:#?}");
    }

    /// Nothing a sandboxed writer does reaches the user's `.git`: not a
    /// pointer file, not a symlink planted where the user's git appends a
    /// reflog or writes packs, not a replace ref, config or hook.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_sandboxed_writer_cannot_write_the_users_git_dir() {
        let Some(root) = repo("nouser") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, _lease) = ledger.assign(&root, "general", true, None).unwrap();
        let dot = root.join(".git");
        let outside = root.with_extension("outside");
        let _ = std::fs::remove_dir_all(&outside);
        std::fs::create_dir_all(&outside).unwrap();
        let head = crate::core::agent::git::head_sha(&root).unwrap();
        let g = dot.display();
        let o = outside.display();
        let attempts = [
            format!("echo /tmp/evil > {g}/commondir"),
            format!("mkdir -p {g}/logs && ln -sf {o}/bashrc {g}/logs/HEAD"),
            format!("ln -sf {o}/bashrc {g}/logs/refs/heads/main"),
            format!("mv {g}/objects/pack {g}/objects/pack.old"),
            format!("ln -s {o} {g}/objects/pack/evil"),
            format!("mkdir -p {g}/refs/replace && echo {head} > {g}/refs/replace/{head}"),
            format!("git --git-dir={g} update-ref refs/heads/evil {head}"),
            format!("echo '[core] fsmonitor = touch {o}/pwned' >> {g}/config"),
            format!("mkdir -p {g}/hooks && echo 'touch {o}/pwned' > {g}/hooks/post-commit"),
            format!("echo {o} > {g}/objects/info/alternates"),
        ];
        let before = tree(&dot, &|_| false);
        let mut wrote = Vec::new();
        for cmd in &attempts {
            // The user's repository visible to it, read-only: the most a
            // child is ever shown of it.
            let Some(out) = child_shell_seeing(&ws, &root, std::slice::from_ref(&root), cmd) else { return };
            if out.contains("[exit 0]") {
                wrote.push(format!("{cmd}: {out}"));
            }
        }
        let after = tree(&dot, &|_| false);
        let _ = ledger.finish_session();
        let _ = std::fs::remove_dir_all(&ws.worktree.as_ref().unwrap().path);
        let _ = std::fs::remove_dir_all(&outside);
        let _ = std::fs::remove_dir_all(&root);
        assert!(wrote.is_empty(), "these wrote the user's .git: {wrote:#?}");
        assert_eq!(after, before, "the user's .git changed");
    }

    /// Make `path` an executable script that touches `marker` when run.
    fn trap(path: &Path, marker: &Path) {
        std::fs::write(path, format!("#!/bin/sh\ntouch '{}'\ncat\n", marker.display())).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    /// Whatever a writer leaves in its own checkout's config, attributes,
    /// hooks or a repository nested in it, Jan's own git (the listing, the
    /// session-end sweep, bringing the branch back) runs none of it, and the
    /// user's repository gains the branch and nothing else.
    #[cfg(unix)]
    #[test]
    fn a_tampered_checkout_runs_nothing_when_jan_inspects_and_fetches_it() {
        let Some(root) = repo("tamper") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        let wt = ws.worktree.clone().unwrap();
        let c = wt.path.clone();
        let marker = root.with_extension("ran");
        let _ = std::fs::remove_file(&marker);
        let hook = root.with_extension("trap.sh");
        trap(&hook, &marker);
        let h = hook.display().to_string();
        // The child's own work, and a repository nested in it, committed.
        commit(&c, "b.txt");
        let sub = c.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        assert!(git(&sub, &["init", "-q"]));
        commit(&sub, "s.txt");
        assert!(git(&sub, &["config", "core.fsmonitor", &h]));
        assert!(git(&c, &["add", "sub"]));
        assert!(git(&c, &["commit", "-q", "--no-gpg-sign", "-m", "sub"]));
        std::fs::write(sub.join("s.txt"), "dirty\n").unwrap();
        let tip = crate::core::agent::git::head_sha(&c).unwrap();
        // Then config that runs a program the next time git looks.
        for (k, v) in [
            ("core.fsmonitor", h.as_str()),
            ("filter.jan.process", h.as_str()),
            ("filter.jan.clean", h.as_str()),
            ("filter.jan.required", "true"),
            ("core.hooksPath", root.parent().unwrap().to_str().unwrap()),
            ("remote.evil.url", root.to_str().unwrap()),
            ("remote.evil.uploadpack", h.as_str()),
            ("uploadpack.packObjectsHook", h.as_str()),
            ("core.alternateRefsCommand", h.as_str()),
        ] {
            let config = c.join(".git/config");
            let out = Command::new("git")
                .args(["config", "--file", &config.to_string_lossy(), k, v])
                .status()
                .unwrap();
            assert!(out.success(), "{k}");
        }
        std::fs::write(c.join(".gitattributes"), "* filter=jan\n").unwrap();
        std::fs::write(c.join("a.txt"), "edited\n").unwrap();
        // The branch's own ref, its reflog and the directories they sit in.
        let skip = |rel: &str| {
            rel.starts_with("objects/") || rel.ends_with("heads/jan") || rel.contains("jan/agent")
                || rel == "index"
        };
        let before = tree(&root.join(".git"), &skip);

        let live = ledger.live();
        let kept = ledger.finish_session().kept;
        let after = tree(&root.join(".git"), &skip);
        let ran = marker.exists();
        let branch = crate::core::agent::git::resolve_commit(&root, &wt.branch);
        let main_ok = git(&root, &["status", "--short"])
            && git(&root, &["log", "-1", "--oneline", &wt.branch])
            && git(&root, &["commit", "-q", "--allow-empty", "--no-gpg-sign", "-m", "m"]);
        let _ = std::fs::remove_dir_all(&c);
        let _ = std::fs::remove_file(&hook);
        let _ = std::fs::remove_file(&marker);
        let _ = std::fs::remove_dir_all(&root);
        assert!(!ran, "Jan's git ran a program the child configured");
        assert_eq!(kept.len(), 1, "{kept:?}");
        assert!(live[0].contains("2 commit(s)"), "{live:?}");
        assert_eq!(branch.as_deref(), Some(tip.as_str()), "the branch is in the user's repo");
        assert_eq!(after, before, "the user's .git changed beyond the branch");
        assert!(main_ok, "the user's checkout still works");
    }

    /// A finished writer's branch is in the user's repository, and its answer
    /// names it. A branch with no commits is not created there, and one the
    /// user has since moved is never overwritten: the footer says so instead.
    #[test]
    fn a_writers_branch_is_brought_back_and_never_overwrites_the_users() {
        let Some(root) = repo("bring") else { return };
        let ledger = Arc::new(Ledger::default());
        let (idle, l1) = ledger.assign(&root, "general", true, None).unwrap();
        let (done, l2) = ledger.assign(&root, "general-2", true, None).unwrap();
        let (clash, l3) = ledger.assign(&root, "general-3", true, None).unwrap();
        drop((l1, l2, l3));
        commit(&done.root, "b.txt");
        commit(&clash.root, "c.txt");
        let branch = |ws: &ChildWorkspace| ws.worktree.as_ref().unwrap().branch.clone();
        // The user got there first, on a branch of the same name.
        assert!(git(&root, &["branch", &branch(&clash)]));
        commit(&root, "u.txt");
        assert!(git(&root, &["branch", "-f", &branch(&clash), "HEAD"]));
        let user_tip = crate::core::agent::git::resolve_commit(&root, &branch(&clash));

        let none = idle.bring_back();
        let brought = done.bring_back();
        let refused = clash.bring_back();
        let git_head = |ws: &ChildWorkspace| crate::core::agent::git::head_sha(&ws.root);
        let in_repo = crate::core::agent::git::resolve_commit(&root, &branch(&done));
        let footer = done.answer_footer(brought.as_deref()).unwrap();
        let clash_footer = clash.answer_footer(refused.as_deref()).unwrap();
        let clash_now = crate::core::agent::git::resolve_commit(&root, &branch(&clash));
        let idle_branch = crate::core::agent::git::resolve_commit(&root, &branch(&idle));
        let reader = ChildWorkspace::shared(&root, true);
        let _ = ledger.finish_session();
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(none, None);
        assert_eq!(idle_branch, None, "a branch with no commits is not created");
        assert_eq!(brought, None);
        assert_eq!(in_repo, git_head(&done));
        assert!(footer.contains(&branch(&done)) && !footer.contains("could not"), "{footer}");
        assert!(refused.is_some(), "a branch the user moved is not overwritten");
        assert_eq!(clash_now, user_tip);
        assert!(clash_footer.contains("could not be brought"), "{clash_footer}");
        assert_eq!(reader.answer_footer(None), None);
        assert_eq!(reader.bring_back(), None);
    }

    /// Config git reads beyond the repository's own file (an `include`, the
    /// `extensions` a format version 1 turns on) cannot be emptied by an
    /// override, so such a checkout is neither read nor removed.
    #[test]
    fn a_checkout_whose_config_reaches_other_files_is_not_read() {
        for (key, value) in [
            ("include.path", "/etc/hostname"),
            ("includeIf.gitdir:/.path", "/etc/hostname"),
            ("extensions.partialClone", "evil"),
            ("core.repositoryformatversion", "1"),
        ] {
            let Some(root) = repo("config") else { return };
            let ledger = Arc::new(Ledger::default());
            let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
            drop(lease);
            let wt = ws.worktree.clone().unwrap();
            commit(&wt.path, "b.txt");
            let config = wt.path.join(".git/config");
            let set = Command::new("git")
                .args(["config", "--file", &config.to_string_lossy(), key, value])
                .status()
                .unwrap();
            assert!(set.success(), "{key}");

            let kept = ledger.finish_session().kept;
            let fetched = crate::core::agent::git::resolve_commit(&root, &wt.branch);
            let still_there = wt.path.is_dir();
            let _ = std::fs::remove_dir_all(&wt.path);
            let _ = std::fs::remove_dir_all(&root);
            assert!(still_there && fetched.is_none(), "{key}");
            assert_eq!(kept.len(), 1, "{key}: {kept:?}");
            assert!(kept[0].contains("not read and not removed"), "{key}: {kept:?}");
        }
    }

    /// A checkout whose alternates no longer name only the user's objects is
    /// neither fetched from nor removed, and the kept line says why.
    #[test]
    fn a_checkout_with_rewritten_alternates_is_not_fetched_from() {
        let Some(root) = repo("alternates") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        let wt = ws.worktree.clone().unwrap();
        commit(&wt.path, "b.txt");
        let alternates = wt.path.join(".git/objects/info/alternates");
        let mut text = std::fs::read_to_string(&alternates).unwrap_or_default();
        text.push_str("/etc\n");
        std::fs::write(&alternates, text).unwrap();

        let kept = ledger.finish_session().kept;
        let fetched = crate::core::agent::git::resolve_commit(&root, &wt.branch);
        let still_there = wt.path.is_dir();
        let _ = std::fs::remove_dir_all(&wt.path);
        let _ = std::fs::remove_dir_all(&root);
        assert!(still_there);
        assert_eq!(fetched, None, "nothing fetched from it");
        assert_eq!(kept.len(), 1, "{kept:?}");
        assert!(kept[0].contains("alternates"), "{kept:?}");
    }

    /// The `.meta` and `.trash` directories beside `root`'s checkouts.
    fn meta_of(root: &Path) -> PathBuf {
        dunce::canonicalize(project_worktrees_dir(root).unwrap()).unwrap().join(META_DIR)
    }

    fn trash_of(root: &Path) -> PathBuf {
        project_worktrees_dir(root).unwrap().join(TRASH_DIR)
    }

    fn id_of(ws: &ChildWorkspace) -> String {
        let wt = ws.worktree.as_ref().unwrap();
        wt.path.file_name().unwrap().to_string_lossy().into_owned()
    }

    /// A new conversation in the same process starts with no names: an
    /// earlier conversation's worktree, kept or removed, is not handed out.
    #[test]
    fn a_new_conversation_cannot_reuse_an_earlier_conversations_worktree_by_name() {
        let Some(root) = repo("names") else { return };
        let ledger = Arc::new(Ledger::default());
        let (kept, l1) = ledger.assign(&root, "general", true, None).unwrap();
        let (_idle, l2) = ledger.assign(&root, "explore", true, None).unwrap();
        drop((l1, l2));
        commit(&kept.root, "b.txt");
        assert_eq!(ledger.end_conversation().settle().kept.len(), 1);
        for earlier in ["general", "explore"] {
            let reuse = WorkspaceRequest::Reuse(earlier.to_string());
            let err = ledger.assign(&root, "next", true, Some(&reuse)).unwrap_err();
            assert!(err.contains("no earlier subagent"), "{earlier}: {err}");
        }
        assert!(ledger.live().is_empty(), "{:?}", ledger.live());
        let _ = std::fs::remove_dir_all(&kept.root);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A replaced conversation's kept worktree is marked reported only once
    /// its notice is taken: exit may stop waiting for it, and the next start
    /// must then name it.
    #[test]
    fn a_replaced_conversations_kept_worktree_is_marked_only_once_reported() {
        let Some(root) = repo("conv-unsent") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        commit(&ws.root, "b.txt");
        let untold = ledger.end_conversation().settle();
        assert_eq!(untold.kept.len(), 1);
        drop(untold);
        let named = sweep_orphans(&root).kept;
        let mut told = 0;
        sweep_and_report(&root, &mut |_| {
            told += 1;
            true
        });
        let after = sweep_orphans(&root).kept;
        let _ = std::fs::remove_dir_all(&ws.root);
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(named.len(), 1, "an untold one is named at the next start: {named:?}");
        assert!(after.is_empty(), "and once told, never again: {after:?}");
    }

    /// The batch is taken when the conversation ends; a worktree the next
    /// conversation makes before the batch is settled is not in it.
    #[test]
    fn ending_a_conversation_leaves_the_next_conversations_worktrees_alone() {
        let Some(root) = repo("next") else { return };
        let ledger = Arc::new(Ledger::default());
        let (old, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        let batch = ledger.end_conversation();
        let (new, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        assert!(batch.settle().kept.is_empty());
        assert!(!old.root.exists(), "the old conversation's empty worktree goes");
        assert!(new.root.is_dir(), "the new conversation's worktree stays");
        assert_eq!(ledger.live().len(), 1, "{:?}", ledger.live());
        let _ = ledger.finish_session();
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A stale dispatch of the old conversation undone after a switch takes
    /// back only its own worktree, never the new conversation's same name.
    #[test]
    fn a_late_undo_keeps_the_next_conversations_name() {
        let Some(root) = repo("late-undo") else { return };
        let ledger = Arc::new(Ledger::default());
        let (old, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        let batch = ledger.end_conversation();
        let (new, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        ledger.undo("general", &old);
        let reuse = WorkspaceRequest::Reuse("general".to_string());
        let again = ledger.assign(&root, "next", false, Some(&reuse)).map(|(ws, _)| ws.root);
        drop(batch.settle());
        let _ = ledger.finish_session();
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(again, Ok(new.root));
    }

    /// A writer still in its worktree when the conversation ends keeps it,
    /// unreported; the next end (or exit) settles it once the writer is gone.
    #[test]
    fn a_busy_worktree_survives_a_conversation_end_and_goes_at_the_next() {
        let Some(root) = repo("busyend") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        assert!(ledger.end_conversation().settle().kept.is_empty());
        assert!(ws.root.is_dir(), "a writer is still in it");
        drop(lease);
        assert!(ledger.finish_session().kept.is_empty());
        assert!(!ws.root.exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Removing an empty worktree is a rename into the project's trash, so
    /// no one waits for its files to be deleted. The trash keeps it a week,
    /// in case the emptiness check missed work; older trash goes.
    #[test]
    fn an_empty_worktree_is_moved_to_trash_not_deleted_in_place() {
        let Some(root) = repo("trash") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        let settled = ledger.finish_session();
        assert!(settled.kept.is_empty());
        let bin = display(&dunce::canonicalize(trash_of(&root)).unwrap());
        assert_eq!(
            settled.notices(),
            [format!("1 empty worktree(s) moved to {bin}; deleted after 7 days")]
        );
        assert!(!ws.root.exists());
        let trashed: Vec<PathBuf> = std::fs::read_dir(trash_of(&root))
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.file_name().unwrap().to_string_lossy().starts_with(&id_of(&ws)))
            .collect();
        assert_eq!(trashed.len(), 1, "{trashed:?}");
        assert!(trashed[0].join("a.txt").is_file());
        let old = trash_of(&root).join("general-0000-1000000000000000000");
        let unstamped = trash_of(&root).join("general-0000-12345678");
        std::fs::create_dir_all(&unstamped).unwrap();
        std::fs::create_dir_all(old.join("deep")).unwrap();
        empty_trash(&root);
        assert!(trashed[0].join("a.txt").is_file(), "fresh trash is kept");
        assert!(!old.exists(), "week-old trash goes");
        assert!(unstamped.is_dir(), "a fresh entry without a time goes by its mtime");
        let _ = std::fs::remove_dir_all(&unstamped);
        let _ = std::fs::remove_dir_all(&trashed[0]);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The fast emptiness check still sees a new directory as work.
    #[test]
    fn an_untracked_directory_keeps_a_worktree_under_the_fast_check() {
        let Some(root) = repo("untracked-dir") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        std::fs::create_dir_all(ws.root.join("node_modules/x")).unwrap();
        std::fs::write(ws.root.join("node_modules/x/y.js"), "y\n").unwrap();
        let kept = crate::core::agent::git::with_global_config(HIDE_UNTRACKED, || {
            ledger.finish_session().kept
        });
        assert_eq!(kept.len(), 1);
        assert!(ws.root.join("node_modules/x/y.js").is_file());
        let _ = std::fs::remove_dir_all(&ws.root);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// N kept worktrees cost about the slowest one, not the sum: each takes
    /// two seconds to read, three in a row would take six.
    #[cfg(unix)]
    #[test]
    fn kept_worktrees_are_settled_in_parallel() {
        use std::time::{Duration, Instant};
        let Some(root) = repo("parallel") else { return };
        let ledger = Arc::new(Ledger::default());
        let mut roots = Vec::new();
        for name in ["general", "general-2", "general-3"] {
            let (ws, lease) = ledger.assign(&root, name, true, None).unwrap();
            drop(lease);
            commit(&ws.root, "b.txt");
            if !slow_status(&ws.root) {
                return;
            }
            roots.push(ws.root);
        }
        let started = Instant::now();
        let kept = ledger.finish_session().kept;
        let took = started.elapsed();
        for dir in &roots {
            let _ = std::fs::remove_dir_all(dir);
        }
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(kept.len(), 3, "{kept:?}");
        assert!(took < Duration::from_secs(4), "settling took {took:?}");
    }

    /// What Jan needs to settle a worktree later is recorded beside it, where
    /// the child cannot rewrite it, and marked once the worktree was reported.
    #[test]
    fn each_worktree_records_its_metadata_beside_not_inside_its_checkout() {
        let Some(root) = repo("meta") else { return };
        let ledger = Arc::new(Ledger::default());
        let (kept, l1) = ledger.assign(&root, "general", true, None).unwrap();
        let (idle, l2) = ledger.assign(&root, "general-2", true, None).unwrap();
        drop((l1, l2));
        let wt = kept.worktree.clone().unwrap();
        let json = meta_of(&root).join(format!("{}.json", id_of(&kept)));
        assert!(!json.starts_with(&wt.path));
        let read = |p: &Path| -> WorktreeMeta {
            serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
        };
        let meta = read(&json);
        assert_eq!(meta.branch, wt.branch);
        assert_eq!(meta.base, wt.base);
        assert_eq!(meta.from_ref, wt.from_ref);
        assert_eq!(meta.repo, wt.repo);
        assert_eq!(meta.objects, wt.objects);
        assert!(!meta.finished);
        commit(&kept.root, "b.txt");
        assert_eq!(ledger.finish_session().kept.len(), 1);
        assert!(read(&json).finished, "a reported worktree is marked");
        for ext in ["json", "lock"] {
            let gone = meta_of(&root).join(format!("{}.{ext}", id_of(&idle)));
            assert!(!gone.exists(), "{}", gone.display());
        }
        let _ = std::fs::remove_dir_all(&kept.root);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A session that dies without settling (its locks drop with it) leaves
    /// worktrees the next start settles: the empty one goes, the branch of
    /// the committed one is brought back, and each is reported only once.
    #[test]
    fn a_startup_sweep_settles_what_a_crashed_session_left() {
        let Some(root) = repo("crash") else { return };
        let ledger = Arc::new(Ledger::default());
        let (idle, l1) = ledger.assign(&root, "general", true, None).unwrap();
        let (committed, l2) = ledger.assign(&root, "general-2", true, None).unwrap();
        let (dirty, l3) = ledger.assign(&root, "general-3", true, None).unwrap();
        drop((l1, l2, l3));
        commit(&committed.root, "b.txt");
        let tip = crate::core::agent::git::head_sha(&committed.root).unwrap();
        std::fs::write(dirty.root.join("a.txt"), "edited\n").unwrap();
        drop(ledger);

        let mut first = sweep_orphans(&root);
        let kept = std::mem::take(&mut first.kept);
        first.mark_reported();
        let again = sweep_orphans(&root).kept;
        let branch = &committed.worktree.as_ref().unwrap().branch;
        let fetched = crate::core::agent::git::resolve_commit(&root, branch);
        let survived = committed.root.is_dir() && dirty.root.is_dir();
        let idle_gone = !idle.root.exists();
        let _ = std::fs::remove_dir_all(&committed.root);
        let _ = std::fs::remove_dir_all(&dirty.root);
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(kept.len(), 2, "{kept:?}");
        assert!(idle_gone && survived);
        assert_eq!(fetched.as_deref(), Some(tip.as_str()));
        assert!(again.is_empty(), "reported once: {again:?}");
    }

    /// A run that ends before the sweep's notice can be shown (its sender is
    /// gone) has not told the user: the next start reports it again, and once
    /// it is told, never again.
    #[test]
    fn an_orphan_is_marked_reported_only_once_its_notice_is_taken() {
        let Some(root) = repo("crash-unsent") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        commit(&ws.root, "b.txt");
        drop(ledger);
        let sweep = |accept: bool| {
            let mut seen = Vec::new();
            sweep_and_report(&root, &mut |text| {
                seen.push(text);
                accept
            });
            seen
        };
        let dropped = sweep(false);
        let taken = sweep(true);
        let after = sweep(true);
        let _ = std::fs::remove_dir_all(&ws.root);
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(dropped.len(), 1, "{dropped:?}");
        assert_eq!(taken.len(), 1, "reported again: {taken:?}");
        assert!(after.is_empty(), "reported once taken: {after:?}");
    }

    /// Exit drops the runtime, which waits for every blocking task: a startup
    /// sweep still in git (or deleting old trash) must not be one of them.
    #[cfg(unix)]
    #[test]
    fn exit_does_not_wait_on_the_startup_sweep() {
        use std::time::{Duration, Instant};
        let Some(root) = repo("sweep-exit") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        drop(ledger);
        if !slow_status(&ws.root) {
            return;
        }
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async { spawn_startup_sweep(root.clone(), None, |_| true) });
        // Long enough for the sweep to be blocked in that status.
        std::thread::sleep(Duration::from_millis(500));
        let started = Instant::now();
        drop(rt);
        let took = started.elapsed();
        std::thread::sleep(Duration::from_secs(3));
        let _ = std::fs::remove_dir_all(&ws.root);
        let _ = std::fs::remove_dir_all(&root);
        assert!(took < Duration::from_secs(1), "exit waited {took:?}");
    }

    /// A worktree a live session holds (this process's own included) is
    /// never touched by a sweep.
    #[test]
    fn a_startup_sweep_skips_worktrees_a_live_session_owns() {
        let Some(root) = repo("live") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        assert!(sweep_orphans(&root).kept.is_empty());
        assert!(ws.root.is_dir(), "a live session's worktree stays");
        let _ = ledger.finish_session();
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A crashed session's checkout that git can no longer read is reported,
    /// not removed: what it holds is unknown.
    #[test]
    fn a_startup_sweep_never_removes_a_checkout_git_cannot_read() {
        let Some(root) = repo("crash-unread") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        drop(ledger);
        let alternates = ws.root.join(".git/objects/info/alternates");
        std::fs::write(&alternates, "/etc\n").unwrap();
        let kept = sweep_orphans(&root).kept;
        let still_there = ws.root.is_dir();
        let _ = std::fs::remove_dir_all(&ws.root);
        let _ = std::fs::remove_dir_all(&root);
        assert!(still_there);
        assert_eq!(kept.len(), 1, "{kept:?}");
        assert!(kept[0].contains("not read and not removed"), "{kept:?}");
    }

    /// Metadata that does not describe the checkout beside it (another
    /// branch, another project's repository) is not acted on at all.
    #[test]
    fn a_startup_sweep_ignores_metadata_that_points_elsewhere() {
        let Some(root) = repo("crash-forged") else { return };
        let Some(other) = repo("crash-other") else { return };
        let ledger = Arc::new(Ledger::default());
        let (a, l1) = ledger.assign(&root, "general", true, None).unwrap();
        let (b, l2) = ledger.assign(&root, "general-2", true, None).unwrap();
        drop((l1, l2));
        commit(&b.root, "b.txt");
        drop(ledger);
        let edit = |ws: &ChildWorkspace, change: &dyn Fn(&mut WorktreeMeta)| {
            let json = meta_of(&root).join(format!("{}.json", id_of(ws)));
            let mut meta: WorktreeMeta =
                serde_json::from_str(&std::fs::read_to_string(&json).unwrap()).unwrap();
            change(&mut meta);
            std::fs::write(&json, serde_json::to_string(&meta).unwrap()).unwrap();
        };
        edit(&a, &|m| m.branch = "main".to_string());
        edit(&b, &|m| m.repo = other.clone());
        let kept = sweep_orphans(&root).kept;
        let both = a.root.is_dir() && b.root.is_dir();
        let branch = &b.worktree.as_ref().unwrap().branch;
        let fetched = crate::core::agent::git::resolve_commit(&other, branch)
            .or_else(|| crate::core::agent::git::resolve_commit(&root, branch));
        let _ = std::fs::remove_dir_all(&a.root);
        let _ = std::fs::remove_dir_all(&b.root);
        let _ = std::fs::remove_dir_all(&other);
        let _ = std::fs::remove_dir_all(&root);
        assert!(kept.is_empty(), "{kept:?}");
        assert!(both, "nothing removed");
        assert_eq!(fetched, None, "nothing fetched");
    }

    /// Two processes picking the same id cannot both own it.
    #[test]
    fn an_id_is_reserved_once() {
        let Some(root) = repo("reserve") else { return };
        let dir = project_worktrees_dir(&root).unwrap();
        let id = format!("reserve-{:04x}", N.fetch_add(1, Ordering::SeqCst));
        let first = reserve(&dir, &id).unwrap();
        let err = reserve(&dir, &id).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::AlreadyExists);
        drop(first);
        let _ = std::fs::remove_file(dir.join(META_DIR).join(format!("{id}.lock")));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A lock file swapped for a new one after the sweep opened it is not the
    /// one it locked.
    #[cfg(unix)]
    #[test]
    fn a_lock_file_replaced_since_it_was_opened_is_not_still_there() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("general-0000.lock");
        std::fs::write(&path, "").unwrap();
        let open = std::fs::File::open(&path).unwrap();
        assert!(still_at(&open, &path));
        std::fs::remove_file(&path).unwrap();
        assert!(!still_at(&open, &path), "unlinked");
        std::fs::write(&path, "").unwrap();
        assert!(!still_at(&open, &path), "replaced");
    }

    /// Where the filesystem has no locks (some NFS, SMB, FUSE or WSL homes)
    /// the id is still reserved, unlocked: writers must keep working there,
    /// and a sweep that cannot lock a file leaves it alone. Only a lock that
    /// is taken means another owner, and another id.
    #[test]
    fn an_id_is_reserved_unlocked_where_locks_are_unsupported() {
        let Some(root) = repo("nolock") else { return };
        let dir = project_worktrees_dir(&root).unwrap();
        let lock_file = |id: &str| dir.join(META_DIR).join(format!("{id}.lock"));
        let id = format!("nolock-{:04x}", N.fetch_add(1, Ordering::SeqCst));
        let unsupported = |_| Err(std::io::Error::from(std::io::ErrorKind::Unsupported));
        let hold = reserve_with(&dir, &id, unsupported).unwrap();
        assert!(hold.is_none());
        assert!(lock_file(&id).is_file(), "the id stays reserved");
        let taken = format!("nolock-{:04x}", N.fetch_add(1, Ordering::SeqCst));
        let busy = |_| Err(std::io::Error::from(std::io::ErrorKind::WouldBlock));
        let err = reserve_with(&dir, &taken, busy).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::WouldBlock);
        assert!(!lock_file(&taken).exists());
        let _ = std::fs::remove_file(lock_file(&id));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A lock that fails for any reason but another owner (`ENOLCK`, which
    /// is both what an NFS home without a lock daemon returns and a transient
    /// shortage) reserves the id unlocked and marks it so: whether or not a
    /// later lock would succeed, no sweep may take that checkout.
    #[cfg(unix)]
    #[test]
    fn a_failed_lock_reserves_the_id_and_marks_it_unsweepable() {
        let Some(root) = repo("enolck") else { return };
        let dir = project_worktrees_dir(&root).unwrap();
        let id = format!("enolck-{:04x}", N.fetch_add(1, Ordering::SeqCst));
        let enolck = |_| Err(std::io::Error::from_raw_os_error(libc::ENOLCK));
        let hold = reserve_with(&dir, &id, enolck).unwrap();
        let reserved = meta_file(&dir, &id, "lock").is_file();
        let marked = meta_file(&dir, &id, UNLOCKED_EXT).is_file();
        let _ = std::fs::remove_dir_all(&root);
        assert!(hold.is_none());
        assert!(reserved && marked, "reserved and marked");
    }

    /// A checkout reserved without a lock is live as far as any sweep can
    /// tell, even one that can lock its file later: it is never taken for an
    /// orphan.
    #[test]
    fn a_sweep_never_takes_a_checkout_reserved_without_a_lock() {
        let Some(root) = repo("nolock-sweep") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        commit(&ws.root, "b.txt");
        let dir = meta_of(&root).parent().unwrap().to_path_buf();
        let id = id_of(&ws);
        // As the reservation would have been made where locks are unsupported.
        let lock_file = meta_file(&dir, &id, "lock");
        std::fs::remove_file(&lock_file).unwrap();
        let unsupported = |_| Err(std::io::Error::from(std::io::ErrorKind::Unsupported));
        assert!(reserve_with(&dir, &id, unsupported).unwrap().is_none());
        // The writer's process died: no lock on the new file, which a sweep on
        // a filesystem with locks can now take.
        drop(ledger);
        let kept = sweep_orphans(&root).kept;
        let there = ws.root.is_dir();
        let _ = std::fs::remove_dir_all(&ws.root);
        let _ = std::fs::remove_dir_all(&root);
        assert!(kept.is_empty(), "{kept:?}");
        assert!(there, "never touched");
    }
}
