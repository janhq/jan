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
    if builds_in_cache(ws) {
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

/// Whether a child in `ws` is given the shared build directory: any child
/// outside the plain writable checkout, readers in the parent's own checkout
/// included.
fn builds_in_cache(ws: &ChildWorkspace) -> bool {
    ws.worktree.is_some() || ws.read_only
}

/// What a child's args take from its workspace beyond `project_root`, read
/// from git by [`place`] when the child is dispatched.
#[derive(Debug)]
pub(crate) struct Placement {
    /// The child's own Session Start, when it is not in the parent's checkout.
    session_start: Option<crate::core::agent::context::SessionStart>,
    scope: ChildScope,
    /// The child's shared lock on the build directory (see
    /// [`hold_build_cache`]), which the child keeps until it is done.
    build_hold: Option<std::fs::File>,
}

/// Resolve the [`Placement`] of a child in `ws`: its checkout's branch and the
/// scope its tools enforce. Runs git, so the dispatch calls it on
/// the blocking pool and [`apply`], on the async child task, runs none. The
/// build lock is taken before the scope creates the build directory, so a
/// trim never moves it away between the two.
pub(crate) fn place(ws: &ChildWorkspace, parent_root: &Path) -> Placement {
    let build_hold = builds_in_cache(ws).then(|| hold_build_cache(parent_root)).flatten();
    Placement {
        session_start: ws.worktree.as_ref().map(|wt| {
            crate::core::agent::context::SessionStart::with_branch(worktree_branch(wt))
        }),
        scope: scope_for(ws, parent_root),
        build_hold,
    }
}

/// Point a child's run at its workspace: `project_root` (and so its prompt's
/// Working Directory and Runtime Environment blocks), its own Session Start
/// when it is not in the parent's checkout, and the scope its tools enforce.
/// Returns the child's build lock, which the caller holds until the child
/// has finished: dropping it lets a trim move the build directory away.
pub(crate) fn apply(
    args: &mut crate::core::agent::r#loop::OrchestrationArgs,
    ws: &ChildWorkspace,
    placement: Placement,
) -> Option<std::fs::File> {
    if let Some(start) = placement.session_start {
        args.session_start = Some(start);
    }
    args.project_root = Some(ws.root.clone());
    args.child_scope = Some(placement.scope);
    placement.build_hold
}

/// The lock file every build in the project's shared build directory holds
/// shared, and a trim or clear exclusive. Under `.meta`, out of every
/// child's write roots, so no child can replace it.
#[cfg(feature = "cli")]
const BUILD_LOCK: &str = "cargo-target.lock";

/// Take a shared lock on `root`'s project's build lock, for a child that
/// builds in the shared build directory: while any such lock is held, in
/// this process or another, [`trim_build_cache`] and [`clear_build_cache`]
/// leave the directory alone. Waits out a trim's brief exclusive hold (the
/// dispatch runs on the blocking pool). `None` when it cannot be locked: the
/// filesystem then cannot lock for a trim either, so none happens.
///
/// The hold lasts as long as the child's run. A build the child detached
/// itself (`nohup cargo build &`) outlives it, and a trim may then move the
/// directory under that build, which fails or rebuilds. Accepted: nothing
/// is lost but build time, and tracking every process a child leaves behind
/// is not something a lock file can do.
#[cfg(feature = "cli")]
fn hold_build_cache(root: &Path) -> Option<std::fs::File> {
    let file = open_build_lock(&project_worktrees_dir(root)?)?;
    fs4::FileExt::lock_shared(&file).ok()?;
    Some(file)
}

/// The build lock of the worktrees in `dir`, created if need be; never a
/// link, so nothing else is locked through it.
#[cfg(feature = "cli")]
fn open_build_lock(dir: &Path) -> Option<std::fs::File> {
    let meta = dir.join(META_DIR);
    std::fs::create_dir_all(&meta).ok()?;
    crate::core::agent::session_log::open_no_follow(
        std::fs::OpenOptions::new().write(true).create(true).truncate(false),
        &meta.join(BUILD_LOCK),
    )
    .ok()
}

/// The desktop gives no child the shared build directory.
#[cfg(not(feature = "cli"))]
fn hold_build_cache(_root: &Path) -> Option<std::fs::File> {
    None
}

/// The exclusive lock on the build lock of the worktrees in `dir`, taken
/// without waiting: `None` while any child builds there (or the filesystem
/// cannot lock, when no build can be shown to have stopped). Held across
/// the move of the build directory only.
#[cfg(feature = "cli")]
fn lock_build_cache(dir: &Path) -> Option<std::fs::File> {
    lock(open_build_lock(dir)?).ok()
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
    /// Worktrees a conversation end took and still holds, each with the
    /// generation of its newest mark (see [`Settling`]).
    #[cfg(feature = "cli")]
    settling: HashMap<PathBuf, u64>,
    /// The generation the last [`Settling`] mark took.
    #[cfg(feature = "cli")]
    marks: u64,
    /// The parent's checkout of the last assignment: whose project's shared
    /// build directory the session end may trim. The desktop makes no
    /// checkouts, so has no build directory to trim.
    #[cfg(feature = "cli")]
    root: Option<PathBuf>,
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
        #[cfg(feature = "cli")]
        {
            state.root = Some(parent_root.to_path_buf());
        }
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
        self.release(&wt.path, gone);
        gone
    }

    /// End a [`Self::claim`] of `path`; when it is `gone`, forget it and
    /// every name that pointed at it, dropping its lock.
    fn release(&self, path: &Path, gone: bool) {
        let mut state = self.state.lock().unwrap();
        state.removing.remove(path);
        if gone {
            state.holds.remove(path);
            state.created.retain(|c| c.path != path);
            state
                .by_name
                .retain(|_, ws| ws.worktree.as_ref().is_none_or(|w| w.path != path));
        }
    }
}

/// Remove the checkout `wt` when it holds nothing: no commit past its base on
/// any ref and no uncommitted change. One git cannot read counts as holding
/// work, since removal deletes it. Returns whether it went.
#[cfg(feature = "cli")]
fn remove_if_empty(wt: &ChildWorktree) -> bool {
    matches!(dispose(wt, false), Disposition::Removed { .. })
}

/// What [`dispose`] did with a checkout.
#[cfg(feature = "cli")]
enum Disposition {
    /// It went (see [`Gone`]). `brought` names its branch when it held
    /// commits, which are now only in the user's repository.
    Removed { gone: Gone, brought: Option<String> },
    /// It stays. `not_brought` says why its branch is not in the user's
    /// repository, when bringing it back failed.
    Kept { not_brought: Option<String> },
}

/// The one rule every settle and undo removes a checkout by. It may go when
/// it is clean (nothing uncommitted, no untracked file that is not ignored)
/// and either holds no commit past its base, or (with `bring`) its branch was
/// brought into the user's repository and that branch there reaches every
/// commit the checkout holds on any ref. Anything else stays: uncommitted
/// work, a branch that could not be brought back, commits off the branch,
/// and any checkout git cannot read, since removal deletes what it holds.
#[cfg(feature = "cli")]
fn dispose(wt: &ChildWorktree, bring: bool) -> Disposition {
    let keep = Disposition::Kept { not_brought: None };
    let first = classify(wt);
    // Everything it holds is in the user's repository already: no fetch is
    // needed, so none can fail and keep it.
    if let CheckoutState::Removable { commits } = first {
        return removed(wt, (commits > 0).then(|| wt.branch.clone()));
    }
    if !bring {
        return keep;
    }
    // Whatever the child committed, kept or not, so the user has the branch
    // to merge. One git cannot read fails here, and is kept.
    if let Err(why) = bring_back(wt) {
        return Disposition::Kept { not_brought: Some(why) };
    }
    // Only bringing the branch back can change where it stands.
    let now = match first {
        CheckoutState::Unbrought { .. } => classify(wt),
        other => other,
    };
    match now {
        CheckoutState::Removable { .. } => removed(wt, Some(wt.branch.clone())),
        _ => keep,
    }
}

/// Where a subagent checkout stands, for the user deciding what to prune.
#[cfg(feature = "cli")]
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub(crate) enum CheckoutState {
    /// A running subagent of this session works in it, or another live jan
    /// session owns it: never removed from here.
    InUse { by: InUseBy },
    /// Uncommitted work that is only in it: changed, untracked and ignored
    /// files that are not build output (see [`Checkout::uncommitted`]).
    /// `commits` past its base, of which `off_branch` are on no branch (a
    /// stash, a tag, a detached `HEAD`), which bringing its branch back does
    /// not carry. `build_output` names the ignored build output a forced
    /// removal deletes with it, relative to the checkout; it is measured
    /// only where a number is shown (see [`sizes`]), not by every classify.
    /// In `jan cli worktrees list --json` it is therefore an array of those
    /// paths (it used to be a byte count); the bytes are `build_output_bytes`.
    ///
    /// [`Checkout::uncommitted`]: crate::core::agent::git::Checkout::uncommitted
    Uncommitted { files: Vec<String>, commits: u64, off_branch: u64, build_output: Vec<String> },
    /// Clean, with commits its branch in the user's repository lacks.
    Unbrought { commits: u64 },
    /// Clean, and everything it committed (if anything) is in the user's
    /// repository: removing it loses nothing.
    Removable { commits: u64 },
    /// No longer what Jan made, or git cannot read it: never removed.
    Unreadable { why: String },
}

/// Who holds a checkout that is [`CheckoutState::InUse`].
#[cfg(feature = "cli")]
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum InUseBy {
    Child,
    Session,
    /// This session's conversation end is settling it (bringing its branch
    /// back), or holds it until the user is told it was kept.
    Settling,
}

/// How many uncommitted paths a description names before eliding the rest.
#[cfg(feature = "cli")]
const NAMED_FILES: usize = 3;

#[cfg(feature = "cli")]
impl CheckoutState {
    /// The state in words, for a list row.
    pub(crate) fn describe(&self) -> String {
        match self {
            Self::InUse { by: InUseBy::Child } => "in use by a running subagent".to_string(),
            Self::InUse { by: InUseBy::Session } => {
                "in use by another live jan session".to_string()
            }
            Self::InUse { by: InUseBy::Settling } => {
                "in use by this session, which is settling it".to_string()
            }
            Self::Uncommitted { files, commits, .. } => {
                let more = match files.len().saturating_sub(NAMED_FILES) {
                    0 => String::new(),
                    n => format!(" and {n} more"),
                };
                let named = files.iter().take(NAMED_FILES).cloned().collect::<Vec<_>>();
                let commits = match commits {
                    0 => String::new(),
                    n => format!("; {n} commit(s)"),
                };
                format!("holds uncommitted work: {}{more}{commits}", named.join(", "))
            }
            Self::Unbrought { .. } => format!("holds {}", self.loses().unwrap_or_default()),
            Self::Removable { commits: 0 } => "removable (no work in it)".to_string(),
            Self::Removable { commits } => {
                format!("removable ({commits} commit(s), all in your repository)")
            }
            Self::Unreadable { why } => format!("kept, git cannot read it: {why}"),
        }
    }

    /// What removing it would lose, when the user may still remove it after
    /// confirming; `None` when it loses nothing or may not be removed here.
    /// A removal brings its branch back first (see [`Self::brings_back`]),
    /// so the commits on it are not lost; an `Unbrought` one's are, since
    /// its branch could not be brought back.
    /// The build output it deletes as well is not named here: see
    /// [`CheckoutInfo::loses`], which has it measured.
    pub(crate) fn loses(&self) -> Option<String> {
        match self {
            Self::Uncommitted { files, off_branch, .. } => {
                let stashed = match off_branch {
                    0 => String::new(),
                    n => format!(" and {n} commit(s) on no branch"),
                };
                Some(format!("{} uncommitted file(s){stashed}", files.len()))
            }
            Self::Unbrought { commits } => {
                Some(format!("{commits} commit(s) not in your repository"))
            }
            _ => None,
        }
    }

    /// What a removal keeps by bringing the branch into the user's
    /// repository first, for the confirm; `None` when there is nothing to
    /// bring back.
    pub(crate) fn brings_back(&self) -> Option<String> {
        match self {
            Self::Uncommitted { commits, off_branch, .. } if commits > off_branch => Some(format!(
                "its branch ({} commit(s)) is brought back to your repository first",
                commits - off_branch
            )),
            _ => None,
        }
    }
}

/// `" plus ignored build output (<size>)"` when a forced removal deletes
/// `bytes` of it, else nothing: not work, but space the user should know
/// goes with the checkout rather than be surprised by.
#[cfg(feature = "cli")]
fn plus_build_output(bytes: u64) -> String {
    match bytes {
        0 => String::new(),
        n => format!(" plus ignored build output ({})", human_bytes(n)),
    }
}

/// Where a checkout stands under [`dispose`]'s rule, read without changing
/// anything: what `/worktrees` shows, and what every removal decides by.
#[cfg(feature = "cli")]
fn classify(wt: &ChildWorktree) -> CheckoutState {
    // A checkout that is no longer what Jan made is never removed: what it
    // holds cannot be read without trusting it.
    let checkout = match checkout(wt) {
        Ok(checkout) => checkout,
        Err(why) => return CheckoutState::Unreadable { why },
    };
    let commits = checkout.commits_anywhere(&wt.base);
    match checkout.work() {
        Ok(work) if work.is_empty() => {}
        Ok(work) => {
            // A submodule's work is not a path status lists: say so rather
            // than show no file.
            let files = match work.paths {
                files if !files.is_empty() => files,
                _ => vec!["a submodule".to_string()],
            };
            let build_output = work.build_output;
            let on_branch = checkout.commits_on(&wt.base, &format!("refs/heads/{}", wt.branch));
            let (commits, off_branch) = match (commits, on_branch) {
                // The branch is among the refs counted, so the rest are on
                // no branch.
                (Some(all), Some(on)) => (all, all.saturating_sub(on)),
                // Unknown is all off the branch: the confirm must not
                // promise to bring back what may not be there.
                (all, _) => (all.unwrap_or(0), all.unwrap_or(0)),
            };
            return CheckoutState::Uncommitted { files, commits, off_branch, build_output };
        }
        Err(why) => return CheckoutState::Unreadable { why },
    }
    match commits {
        Some(0) => CheckoutState::Removable { commits: 0 },
        Some(n) if in_users_branch(wt, &checkout) => CheckoutState::Removable { commits: n },
        Some(n) => CheckoutState::Unbrought { commits: n },
        None => CheckoutState::Unreadable { why: "git could not count its commits".to_string() },
    }
}

/// Move `wt` into the trash for [`dispose`], never deleting it: the trash
/// keeps it a week in case the check missed work. Kept when it cannot be
/// moved, which leaks it but loses nothing.
#[cfg(feature = "cli")]
fn removed(wt: &ChildWorktree, brought: Option<String>) -> Disposition {
    match move_to_trash(&wt.path) {
        Some(to) => Disposition::Removed { gone: Gone::Trashed(to), brought },
        None => Disposition::Kept { not_brought: None },
    }
}

/// Whether the user's branch `wt.branch` reaches every commit the checkout
/// holds, on any ref or `HEAD`: only then is nothing lost with the checkout.
/// The user's tip must be an object the checkout has, which a fetch it
/// fast-forwarded guarantees; a branch the user has since built on reads as
/// `None` here and keeps the checkout, which is the safe side.
#[cfg(feature = "cli")]
fn in_users_branch(wt: &ChildWorktree, checkout: &crate::core::agent::git::Checkout) -> bool {
    crate::core::agent::git::resolve_commit(&wt.repo, &format!("refs/heads/{}", wt.branch))
        .is_some_and(|tip| checkout.commits_anywhere(&tip) == Some(0))
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
    forget_meta_at(dir, &id.to_string_lossy());
}

/// [`forget_meta`] by checkout id, for a checkout with no usable record.
fn forget_meta_at(dir: &Path, id: &str) {
    let _ = std::fs::remove_file(meta_file(dir, id, "json"));
    let _ = std::fs::remove_file(meta_file(dir, id, UNLOCKED_EXT));
    let _ = std::fs::remove_file(meta_file(dir, id, "lock"));
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

/// Get a checkout the user confirmed losing out of the way: renamed into the
/// project's trash first, so the caller can delete it there after dropping
/// its record, else deleted in place (something mounted there, a handle
/// still open on Windows). `None` when it is still there.
#[cfg(feature = "cli")]
fn trash(path: &Path) -> Option<Gone> {
    if let Some(to) = move_to_trash(path) {
        return Some(Gone::Trashed(to));
    }
    std::fs::remove_dir_all(path).is_ok().then_some(Gone::Deleted)
}

/// How [`trash`] got a directory out of the way.
#[cfg(feature = "cli")]
#[derive(Debug, Clone, PartialEq, Eq)]
enum Gone {
    /// Renamed to this path in the trash.
    Trashed(PathBuf),
    /// Deleted in place.
    Deleted,
}

/// Rename `path` into the trash beside it, never deleting anything. Where
/// it went, when it moved.
#[cfg(feature = "cli")]
fn move_to_trash(path: &Path) -> Option<PathBuf> {
    let (dir, id) = (path.parent()?, path.file_name()?);
    let bin = dir.join(TRASH_DIR);
    let to = bin.join(tauri_plugin_agent_tools::workspace::trash_name(&id.to_string_lossy()));
    (std::fs::create_dir_all(&bin).is_ok() && std::fs::rename(path, &to).is_ok()).then_some(to)
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
    /// Set while a ledger's conversation end owns it, so `/worktrees` names
    /// it as this session's rather than another live one's.
    mark: Option<Settling>,
}

/// A ledger's mark on a worktree its conversation end took: the session
/// still holds it (settling it, or until the user is told it was kept)
/// though it is no longer among the ledger's `created`. Unmarked on drop,
/// unless a newer mark took the same path meanwhile (a later conversation
/// end of a reused checkout): `generation` tells the two apart, so an old
/// mark dropping late never unmarks what the session still holds.
#[cfg(feature = "cli")]
#[derive(Debug)]
struct Settling {
    ledger: Arc<Ledger>,
    path: PathBuf,
    generation: u64,
}

#[cfg(feature = "cli")]
impl Drop for Settling {
    fn drop(&mut self) {
        let mut state = self.ledger.state.lock().unwrap();
        if state.settling.get(&self.path) == Some(&self.generation) {
            state.settling.remove(&self.path);
        }
    }
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
                Outcome::Brought(branch, bin) => {
                    settled.brought.push(branch);
                    settled.brought_to = Some(bin);
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
    /// The branches whose checkouts went once their commits were brought
    /// into the user's repository: where that work is now. Their checkouts
    /// wait in the trash at `brought_to`.
    brought: Vec<String>,
    brought_to: Option<PathBuf>,
    /// Set when the shared build directory was over its cap and cleared.
    cache_notice: Option<String>,
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
        self.kept_notice()
            .into_iter()
            .chain(self.brought_notice())
            .chain(self.trash_notice())
            .chain(self.cache_notice.clone())
            .collect()
    }

    /// The branches brought back whose checkouts went: the one place the
    /// user learns where that work is, so each is named once.
    /// The checkouts wait in the trash, since one may hold what the check
    /// missed, and the user must know where to look.
    fn brought_notice(&self) -> Option<String> {
        let bin = self.brought_to.as_deref().map(display).unwrap_or_default();
        let days = tauri_plugin_agent_tools::workspace::TRASH_KEPT_FOR.as_secs() / 86_400;
        match self.brought.as_slice() {
            [] => None,
            [one] => Some(format!(
                "brought back branch {one}, moved its worktree to {bin}; deleted after {days} days"
            )),
            many => Some(format!(
                "brought back {} branches, moved their worktrees to {bin}; deleted after {days} \
                 days\n{}",
                many.len(),
                many.join("\n")
            )),
        }
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
        // The checkout and its record are gone already, so an untold one is
        // not repeated: the branch itself stays in the user's repository.
        let rest = self.brought_notice().into_iter().chain(self.trash_notice());
        for notice in rest.chain(self.cache_notice.take()) {
            report(notice);
        }
    }

    /// The user has been told about the kept worktrees: no later sweep
    /// repeats them. Their locks drop once each is marked.
    fn mark_reported(&mut self) {
        for Owned { wt, hold, mark } in self.unmarked.drain(..) {
            let _ = write_meta(&wt, true);
            drop((hold, mark));
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
    /// Its commits were brought back on this branch of the user's
    /// repository, and the checkout went into the trash at this path.
    Brought(String, PathBuf),
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
    let Owned { wt, hold, mark } = one;
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
    let disposed = match wt.path.is_dir() {
        true => dispose(&wt, true),
        false => Disposition::Removed { gone: Gone::Deleted, brought: None },
    };
    let outcome = if let Disposition::Kept { not_brought } = disposed {
        let line = kept_line(&wt, not_brought.as_deref());
        if mark_when_told {
            if let Some(ledger) = ledger {
                ledger.state.lock().unwrap().removing.remove(&wt.path);
            }
            return Outcome::KeptUnmarked(line, Owned { wt, hold, mark });
        }
        // This process names it at its own end, so the user owns it now: no
        // later sweep reports it again.
        let _ = write_meta(&wt, true);
        Outcome::Kept(line)
    } else {
        forget_meta(&wt);
        match disposed {
            Disposition::Removed { gone: Gone::Trashed(to), brought } => {
                let bin = to.parent().map(Path::to_path_buf).unwrap_or(to);
                match brought {
                    Some(branch) => Outcome::Brought(branch, bin),
                    None => Outcome::Trashed(bin),
                }
            }
            _ => Outcome::Gone,
        }
    };
    if let Some(ledger) = ledger {
        ledger.state.lock().unwrap().removing.remove(&wt.path);
    }
    drop((hold, mark));
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
    ///
    /// Then, once no writer of this session is left building, the project's
    /// shared build directory is deleted if it outgrew its cap (see
    /// [`trim_build_cache`]).
    pub(crate) fn finish_session(self: &Arc<Self>) -> Settled {
        self.finish_with(crate::core::agent::project::subagent_build_cache_cap)
    }

    /// [`Self::finish_session`] with the build directory's cap, in bytes,
    /// read by `cap_of` from the project root, so a test can make it small.
    fn finish_with(self: &Arc<Self>, cap_of: impl FnOnce(&Path) -> u64) -> Settled {
        let mut settled = self.take(true).settle();
        let (root, idle) = {
            let state = self.state.lock().unwrap();
            (state.root.clone(), state.busy.is_empty() && state.removing.is_empty())
        };
        // A writer still in its worktree may be mid-build in that directory.
        if let Some(root) = root.filter(|_| idle) {
            settled.cache_notice = trim_build_cache(&root, cap_of(&root));
        }
        settled
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
            let mark = Some(self.mark(state, &wt.path));
            owned.push(Owned { wt, hold, mark });
        }
        Batch { ledger: Some(self.clone()), owned, report_busy: busy_too, mark_when_told: false }
    }

    /// Mark `path` as held by this ledger's conversation end, in its locked
    /// `state`, until the returned mark drops.
    fn mark(self: &Arc<Self>, state: &mut LedgerState, path: &Path) -> Settling {
        state.marks += 1;
        state.settling.insert(path.to_path_buf(), state.marks);
        Settling { ledger: self.clone(), path: path.to_path_buf(), generation: state.marks }
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
        // Once: a lock that is not free right now has a live owner, and
        // skipping is always safe.
        let Probe::Free(hold) = probe_lock(&dir, id) else { continue };
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
            Ok(m) if m.is_dir() && !meta.finished => {
                owned.push(Owned { wt, hold: Some(hold), mark: None })
            }
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
        let cap = crate::core::agent::project::subagent_build_cache_cap(&root);
        if let Some(notice) = trim_build_cache(&root, cap) {
            report(notice);
        }
    });
}

/// Delete `root`'s project's shared build directory when it is
/// larger than `cap` bytes (0 never), so it cannot grow without bound: the
/// next build starts cold. Never while any child of any process holds the
/// build lock (see [`hold_build_cache`]), readers without a checkout
/// included, nor while any live jan session (this one included) holds a
/// checkout of the project, since its next child may be building there.
/// The notice for the user when it was cleared. Walks the directory only up
/// to the cap, so a huge one costs little, and before taking the build lock,
/// so a dispatch never waits on the walk: the size only decides whether to
/// try, and the lock alone keeps a build from losing its directory mid-run.
/// A rename under the lock, then the moved cache is deleted on a thread of
/// its own: it holds nothing worth the trash's week, and the space is why
/// it was trimmed. Runs I/O: call it off the render loop.
#[cfg(feature = "cli")]
pub(crate) fn trim_build_cache(root: &Path, cap: u64) -> Option<String> {
    if cap == 0 {
        return None;
    }
    let dir = project_worktrees_dir(root)?;
    let target = dir.join(CARGO_TARGET);
    // A link there is not Jan's to move.
    if !std::fs::symlink_metadata(&target).is_ok_and(|m| m.is_dir()) || !larger_than(&target, cap)
    {
        return None;
    }
    let to = {
        let _building = lock_build_cache(&dir)?;
        // Checked again under the lock: a clear may have taken it meanwhile.
        if checkouts_in_use(&dir, &HashSet::new())
            || !std::fs::symlink_metadata(&target).is_ok_and(|m| m.is_dir())
        {
            return None;
        }
        move_to_trash(&target)?
    };
    // Should the thread not finish (the process exits first), the startup
    // sweep empties what is left after the trash's week.
    std::thread::spawn(move || {
        if let Err(e) = std::fs::remove_dir_all(&to) {
            log::warn!("agent: could not delete the trimmed build cache {}: {e}", to.display());
        }
    });
    Some(format!("subagent build cache over {}, cleared (next build starts cold)", size(cap)))
}

/// `cap` as the user set it: whole GB, else bytes (a test's tiny cap).
#[cfg(feature = "cli")]
fn size(cap: u64) -> String {
    match cap % (1 << 30) {
        0 => format!("{} GB", cap >> 30),
        _ => format!("{cap} bytes"),
    }
}

/// Whether any checkout among `dir`'s, but those named in `ours` (the
/// caller's own, whose locks it holds), is owned by a live session: its lock
/// is held, or it was reserved without one (nothing can show its owner has
/// gone). Taking a free lock here only to test it is harmless: a sweep that
/// meets it meanwhile skips that checkout until the next start.
#[cfg(feature = "cli")]
fn checkouts_in_use(dir: &Path, ours: &HashSet<String>) -> bool {
    let Ok(entries) = std::fs::read_dir(dir.join(META_DIR)) else { return false };
    entries.filter_map(Result::ok).any(|entry| {
        let name = entry.file_name();
        let Some(id) = name.to_str().and_then(|n| n.strip_suffix(".lock")) else {
            return false;
        };
        // Only checkout locks: the build lock sits beside them.
        is_checkout_id(id) && !ours.contains(id) && matches!(probe_lock(dir, id), Probe::Held)
    })
}

/// Who owns a checkout's lock, as [`probe_lock`] found it.
#[cfg(feature = "cli")]
enum Probe {
    /// No live owner: this lock, now taken, keeps every other sweep off it.
    Free(std::fs::File),
    /// A live owner holds it, it was reserved without a lock (nothing can
    /// show its owner has gone), or it cannot be read: unknown is held.
    Held,
    /// Its owner settled it and unlinked the lock meanwhile.
    Gone,
}

/// Try the lock of checkout `id` in `dir` once, without waiting. A lock
/// taken on a file that is no longer the one at its path is held: its owner
/// unlinked it (it settled the worktree) between the open and the lock, and
/// a new owner of a reused id made a fresh one that no one else sees.
#[cfg(feature = "cli")]
fn probe_lock(dir: &Path, id: &str) -> Probe {
    if meta_file(dir, id, UNLOCKED_EXT).exists() {
        return Probe::Held;
    }
    let path = meta_file(dir, id, "lock");
    match crate::core::agent::session_log::open_no_follow(
        std::fs::OpenOptions::new().write(true),
        &path,
    ) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Probe::Gone,
        Err(_) => Probe::Held,
        Ok(file) => match lock(file) {
            Ok(hold) if still_at(&hold, &path) => Probe::Free(hold),
            _ => Probe::Held,
        },
    }
}

/// Whether the files under `dir` add up to more than `cap` bytes. Stops as
/// soon as they do, so a tree far over the cap is not walked whole, and never
/// follows a link (what it names is not in the directory). Unreadable
/// entries count as empty: the cost is a trim that waits for the next end.
#[cfg(feature = "cli")]
fn larger_than(dir: &Path, cap: u64) -> bool {
    dir_size(dir, cap) > cap
}

/// The bytes of the files under `dir`, walked without following a link, and
/// only until they pass `stop_above` (the total so far is returned then).
#[cfg(feature = "cli")]
fn dir_size(dir: &Path, stop_above: u64) -> u64 {
    sizes(dir, &[], stop_above).0
}

/// [`dir_size`], and of that the bytes under `within` (paths relative to
/// `dir`, as [`CheckoutState::Uncommitted`] names build output), counted in
/// the same walk: a checkout listed is walked for its size anyway, so its
/// build output costs nothing more to measure.
#[cfg(feature = "cli")]
fn sizes(dir: &Path, within: &[String], stop_above: u64) -> (u64, u64) {
    let marked: HashSet<PathBuf> =
        within.iter().map(|p| dir.join(p.trim_end_matches('/'))).collect();
    let (mut total, mut inside) = (0u64, 0u64);
    let mut pending = vec![(dir.to_path_buf(), false)];
    while let Some((next, in_marked)) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&next) else { continue };
        for entry in entries.filter_map(Result::ok) {
            let Ok(meta) = entry.metadata() else { continue };
            let path = entry.path();
            // Hashing every path of a large tree is skipped when nothing is
            // marked, as for every plain size.
            let in_marked = in_marked || (!marked.is_empty() && marked.contains(&path));
            if meta.is_dir() {
                pending.push((path, in_marked));
            } else if meta.is_file() {
                total = total.saturating_add(meta.len());
                if in_marked {
                    inside = inside.saturating_add(meta.len());
                }
                if total > stop_above {
                    return (total, inside);
                }
            }
        }
    }
    (total, inside)
}

/// `bytes` for a person: whole bytes, else one decimal of the largest unit.
#[cfg(feature = "cli")]
pub(crate) fn human_bytes(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["KB", "MB", "GB", "TB"];
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    let mut value = bytes as f64 / 1024.0;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    format!("{value:.1} {}", UNITS[unit])
}

/// The live session asking `/worktrees` what it may prune, so its own
/// checkouts do not read as another session's and its running subagents
/// keep their checkouts and the build cache. `None` for `jan cli worktrees`,
/// which owns nothing.
#[cfg(feature = "cli")]
pub(crate) struct Session<'a> {
    pub(crate) ledger: &'a Ledger,
    /// Whether any subagent of the session is running right now: a reader
    /// builds in the shared build cache too, without a checkout of its own.
    /// Asked at each decision, not once when the job was queued, since a
    /// subagent may have started meanwhile.
    pub(crate) children_running: &'a dyn Fn() -> bool,
}

#[cfg(feature = "cli")]
impl Session<'_> {
    /// The ids of the checkouts this session made and still holds the locks
    /// of, those its conversation end is settling included.
    fn own_ids(&self) -> HashSet<String> {
        let state = self.ledger.state.lock().unwrap();
        let created = state.created.iter().map(|wt| wt.path.as_path());
        created.chain(state.settling.keys().map(PathBuf::as_path)).filter_map(id_of_path).collect()
    }

    /// Who of the session holds `path`, if anyone: a writer, any running
    /// subagent (a reader reusing a checkout holds no lease, so a running
    /// one may be reading any of the session's), or its conversation end.
    fn in_use(&self, path: &Path) -> Option<InUseBy> {
        let state = self.ledger.state.lock().unwrap();
        if state.settling.contains_key(path) {
            Some(InUseBy::Settling)
        } else if state.busy.contains(path) {
            Some(InUseBy::Child)
        } else {
            drop(state);
            (self.children_running)().then_some(InUseBy::Child)
        }
    }
}

#[cfg(feature = "cli")]
fn id_of_path(path: &Path) -> Option<String> {
    path.file_name().map(|id| id.to_string_lossy().into_owned())
}

/// One subagent checkout of the project, as `/worktrees` lists it.
#[cfg(feature = "cli")]
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub(crate) struct CheckoutInfo {
    pub(crate) id: String,
    pub(crate) path: PathBuf,
    pub(crate) branch: String,
    pub(crate) bytes: u64,
    /// Of `bytes`, those of the ignored build output its state names.
    pub(crate) build_output_bytes: u64,
    #[serde(flatten)]
    pub(crate) state: CheckoutState,
}

#[cfg(feature = "cli")]
impl CheckoutInfo {
    /// [`CheckoutState::loses`], with the build output a forced removal
    /// deletes as well, for the confirm.
    pub(crate) fn loses(&self) -> Option<String> {
        let loses = self.state.loses()?;
        Some(format!("{loses}{}", plus_build_output(self.build_output_bytes)))
    }

    /// The row `jan cli worktrees list` prints.
    pub(crate) fn line(&self) -> String {
        format!("{}  {}  {}", self.branch, human_bytes(self.bytes), self.state.describe())
    }
}

/// What the project's subagents left on disk under its worktrees directory.
#[cfg(feature = "cli")]
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
pub(crate) struct WorktreesReport {
    /// `~/.jan/worktrees/<slug>`, `None` without a Jan home.
    pub(crate) dir: Option<PathBuf>,
    pub(crate) checkouts: Vec<CheckoutInfo>,
    /// The shared build cache's size, `None` when there is none.
    pub(crate) build_cache_bytes: Option<u64>,
    /// What already-removed checkouts and caches hold until the trash is
    /// emptied at a later start.
    pub(crate) trash_bytes: u64,
}

#[cfg(feature = "cli")]
impl WorktreesReport {
    /// The checkouts a safe prune would remove now, and their total size.
    pub(crate) fn removable(&self) -> (usize, u64) {
        let ones = self.checkouts.iter().filter(|c| matches!(c.state, CheckoutState::Removable { .. }));
        ones.fold((0, 0), |(n, bytes), c| (n + 1, bytes + c.bytes))
    }

    /// The report as `jan cli worktrees list` prints it.
    pub(crate) fn lines(&self) -> Vec<String> {
        let mut lines: Vec<String> = match &self.dir {
            Some(dir) => vec![format!("subagent worktrees in {}", display(dir))],
            None => return vec!["no Jan home: there are no subagent worktrees".to_string()],
        };
        if self.checkouts.is_empty() {
            lines.push("  no subagent checkouts".to_string());
        }
        lines.extend(self.checkouts.iter().map(|c| format!("  {}", c.line())));
        lines.push(match self.build_cache_bytes {
            Some(bytes) => format!("build cache  {}", human_bytes(bytes)),
            None => "build cache  none".to_string(),
        });
        if self.trash_bytes > 0 {
            let days = tauri_plugin_agent_tools::workspace::TRASH_KEPT_FOR.as_secs() / 86_400;
            lines.push(format!(
                "trash        {} (deleted after {days} days)",
                human_bytes(self.trash_bytes)
            ));
        }
        lines
    }
}

/// How a found checkout is held while it is looked at or pruned.
#[cfg(feature = "cli")]
enum Hold {
    /// The asking session made it and holds its lock.
    Ours,
    /// No live session owns it: this lock keeps every sweep off it meanwhile.
    Locked(std::fs::File),
    /// Another live session owns it.
    Theirs,
}

#[cfg(feature = "cli")]
struct Found {
    id: String,
    wt: ChildWorktree,
    hold: Hold,
}

#[cfg(feature = "cli")]
impl Found {
    /// Where it stands, without changing anything.
    fn state(&self, session: Option<&Session>) -> CheckoutState {
        let ours = match (&self.hold, session) {
            (Hold::Ours, Some(session)) => session.in_use(&self.wt.path),
            _ => None,
        };
        match (&self.hold, ours) {
            (Hold::Theirs, _) => CheckoutState::InUse { by: InUseBy::Session },
            (_, Some(by)) => CheckoutState::InUse { by },
            _ => classify(&self.wt),
        }
    }
}

/// The project's canonical worktrees directory, as records name it.
#[cfg(feature = "cli")]
fn worktrees_dir(root: &Path) -> Option<PathBuf> {
    project_worktrees_dir(root).and_then(|d| dunce::canonicalize(d).ok())
}

/// Every recorded checkout in `dir`, in id order, each held as [`Hold`]
/// says. One without a record that describes it is not Jan's to judge, so is
/// left out, as the startup sweep leaves it.
#[cfg(feature = "cli")]
fn found_checkouts(dir: &Path, session: Option<&Session>) -> Vec<Found> {
    let ours = session.map(Session::own_ids).unwrap_or_default();
    let Ok(entries) = std::fs::read_dir(dir.join(META_DIR)) else { return Vec::new() };
    let mut found = Vec::new();
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name();
        let Some(id) = name.to_str().and_then(|n| n.strip_suffix(".lock")) else { continue };
        if !is_checkout_id(id) || !std::fs::symlink_metadata(dir.join(id)).is_ok_and(|m| m.is_dir())
        {
            continue;
        }
        let Some(wt) = std::fs::read(meta_file(dir, id, "json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<WorktreeMeta>(&bytes).ok())
            .and_then(|meta| recorded_worktree(dir, id, meta))
        else {
            continue;
        };
        let hold = if ours.contains(id) {
            Hold::Ours
        } else {
            match probe_lock(dir, id) {
                Probe::Free(hold) => Hold::Locked(hold),
                Probe::Held => Hold::Theirs,
                Probe::Gone => continue,
            }
        };
        found.push(Found { id: id.to_string(), wt, hold });
    }
    found.sort_by(|a, b| a.id.cmp(&b.id));
    found
}

/// List `root`'s project's subagent checkouts, its shared build cache and
/// its trash, with their sizes and where each checkout stands. Runs git and
/// walks every checkout: call it off the render loop.
#[cfg(feature = "cli")]
pub(crate) fn list_worktrees(root: &Path, session: Option<&Session>) -> WorktreesReport {
    let Some(dir) = worktrees_dir(root) else {
        return WorktreesReport { dir: project_worktrees_dir(root), ..WorktreesReport::default() };
    };
    let checkouts = found_checkouts(&dir, session)
        .iter()
        .map(|found| {
            let state = found.state(session);
            let built = match &state {
                CheckoutState::Uncommitted { build_output, .. } => build_output.as_slice(),
                _ => &[],
            };
            // One walk for the size shown and the build output the confirm
            // names: no file is read twice.
            let (bytes, build_output_bytes) = sizes(&found.wt.path, built, u64::MAX);
            CheckoutInfo {
                id: found.id.clone(),
                path: found.wt.path.clone(),
                branch: found.wt.branch.clone(),
                bytes,
                build_output_bytes,
                state,
            }
        })
        .collect();
    let target = dir.join(CARGO_TARGET);
    let build_cache_bytes = std::fs::symlink_metadata(&target)
        .is_ok_and(|m| m.is_dir())
        .then(|| dir_size(&target, u64::MAX));
    WorktreesReport {
        trash_bytes: dir_size(&dir.join(TRASH_DIR), u64::MAX),
        dir: Some(dir),
        checkouts,
        build_cache_bytes,
    }
}

/// Which checkouts a prune removes.
#[cfg(feature = "cli")]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Prune {
    /// Every checkout session end would remove (see [`dispose`]).
    Safe,
    /// Every checkout that is not in use, its uncommitted work and unbrought
    /// commits included: the user confirmed the loss.
    All,
    /// The checkout with this id, by the safe rule, or (`force`) whatever it
    /// holds once the user confirmed the loss.
    One { id: String, force: bool },
}

/// What a prune did, for the notice that tells the user.
#[cfg(feature = "cli")]
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Pruned {
    /// The branches of the checkouts removed.
    pub(crate) removed: Vec<String>,
    /// Of those, the branches whose commits were brought into the user's
    /// repository first: where that work is now.
    pub(crate) brought: Vec<String>,
    /// A line per checkout kept, saying why.
    pub(crate) kept: Vec<String>,
    /// The bytes deleted: a forced removal's, once its delete succeeded.
    pub(crate) freed: u64,
    /// The bytes moved to the trash (a safe removal's, or a forced one whose
    /// delete failed), which a later start empties, and where it is.
    pub(crate) trashed: u64,
    pub(crate) trash: Option<PathBuf>,
    /// Of the bytes removed, those of ignored build output a forced removal
    /// of uncommitted work took with it, named as the confirm named it.
    pub(crate) build_output: u64,
}

#[cfg(feature = "cli")]
impl Pruned {
    /// The notice for the user: what went, the space it freed or where it
    /// waits, what stayed.
    pub(crate) fn notice(&self) -> String {
        let mut text = match self.removed.len() {
            0 => "no subagent worktree removed".to_string(),
            n => format!("removed {n} subagent worktree(s)"),
        };
        text.push_str(&plus_build_output(self.build_output));
        if self.freed > 0 {
            text.push_str(&format!(", freed {}", human_bytes(self.freed)));
        }
        if let Some(bin) = self.trash.as_ref().filter(|_| self.trashed > 0) {
            let days = tauri_plugin_agent_tools::workspace::TRASH_KEPT_FOR.as_secs() / 86_400;
            text.push_str(&format!(
                "; moved {} to {}, deleted after {days} days",
                human_bytes(self.trashed),
                display(bin)
            ));
        }
        if !self.brought.is_empty() {
            text.push_str(&format!("\nbrought back first: {}", self.brought.join(", ")));
        }
        for line in &self.kept {
            text.push_str(&format!("\nkept {line}"));
        }
        text
    }
}

/// Remove `root`'s project's subagent checkouts that `which` names, never
/// one a running subagent of `session` or another live session holds, nor
/// one git cannot read. What the safe rule removes goes to the trash, as at
/// session end: the check may miss work. What a forced prune removes is
/// deleted at once: the user confirmed the loss and asked for the space.
/// Runs git and deletes: call it off the render loop.
#[cfg(feature = "cli")]
pub(crate) fn prune_worktrees(root: &Path, session: Option<&Session>, which: &Prune) -> Pruned {
    let mut pruned = Pruned::default();
    let Some(dir) = worktrees_dir(root) else { return pruned };
    for found in found_checkouts(&dir, session) {
        let force = match which {
            Prune::Safe => false,
            Prune::All => true,
            Prune::One { id, force } if *id == found.id => *force,
            Prune::One { .. } => continue,
        };
        prune_one(found, session, force, &mut pruned);
    }
    pruned
}

/// [`prune_worktrees`] for one checkout.
#[cfg(feature = "cli")]
fn prune_one(found: Found, session: Option<&Session>, force: bool, pruned: &mut Pruned) {
    let Found { wt, hold, .. } = found;
    let kept = |state: CheckoutState| format!("{} ({})", wt.branch, state.describe());
    let ledger = match (&hold, session) {
        (Hold::Theirs, _) => {
            return pruned.kept.push(kept(CheckoutState::InUse { by: InUseBy::Session }));
        }
        // Claimed, as a session end claims it, so no dispatch is handed it
        // while it goes; a writer in it refuses the claim.
        (Hold::Ours, Some(session)) => {
            let by = session.in_use(&wt.path);
            let claimed = || session.ledger.claim(&wt.path);
            if let Some(by) = by.or_else(|| (!claimed()).then_some(InUseBy::Child)) {
                return pruned.kept.push(kept(CheckoutState::InUse { by }));
            }
            Some(session.ledger)
        }
        _ => None,
    };
    // Sized only once it is known to go, and in the walk that also finds
    // its build output: a kept checkout is not walked at all.
    let (mut bytes, mut build_output) = (0, 0);
    let (gone, brought) = match dispose(&wt, true) {
        Disposition::Removed { gone, brought } => {
            // Moved, not deleted: what is in the trash is what went.
            if let Gone::Trashed(to) = &gone {
                bytes = dir_size(to, u64::MAX);
            }
            (Some(gone), brought)
        }
        Disposition::Kept { not_brought } => match classify(&wt) {
            // The confirm promised an uncommitted checkout's branch is
            // brought back first: when it could not be, its commits would be
            // lost too, which the user did not confirm. When it was, the
            // notice names it, as the confirm did.
            CheckoutState::Uncommitted { commits, off_branch, build_output: built, .. }
                if force && not_brought.is_none() =>
            {
                (bytes, build_output) = sizes(&wt.path, &built, u64::MAX);
                (trash(&wt.path), (commits > off_branch).then(|| wt.branch.clone()))
            }
            CheckoutState::Unbrought { .. } | CheckoutState::Removable { .. } if force => {
                bytes = dir_size(&wt.path, u64::MAX);
                (trash(&wt.path), None)
            }
            // Everything in it is in the user's repository, so only the move
            // into the trash can have failed.
            CheckoutState::Removable { .. } => {
                pruned.kept.push(format!("{} (could not be moved to the trash)", wt.branch));
                (None, None)
            }
            state => {
                let why = not_brought
                    .map(|why| format!("; its branch could not be brought back: {why}"))
                    .unwrap_or_default();
                pruned.kept.push(format!("{} ({}{why})", wt.branch, state.describe()));
                (None, None)
            }
        },
    };
    if gone.is_some() {
        forget_meta(&wt);
    }
    if let Some(ledger) = ledger {
        ledger.release(&wt.path, gone.is_some());
    }
    // Only now may a sweep take it: the decision and the removal are done.
    if let Hold::Locked(lock) = hold {
        drop(lock);
    }
    let Some(gone) = gone else { return };
    // The user confirmed the loss and asked for the space: delete it now.
    // Once its record is gone the trash entry is nobody's, so a failed
    // delete is left for the startup sweep to empty, and counted there.
    let left = match gone {
        Gone::Trashed(to) if force && std::fs::remove_dir_all(&to).is_err() => Some(to),
        Gone::Trashed(to) if !force => Some(to),
        _ => None,
    };
    match left.as_deref().and_then(Path::parent) {
        Some(bin) => {
            pruned.trashed += bytes;
            pruned.trash = Some(bin.to_path_buf());
        }
        None => pruned.freed += bytes,
    }
    pruned.removed.push(wt.branch.clone());
    pruned.brought.extend(brought);
    pruned.build_output += build_output;
}

/// Delete `root`'s project's shared build cache now, returning the bytes
/// freed. Refused while a build may be running in it: a running subagent of
/// `session`, any child of any process holding the build lock, or any other
/// live session that holds a checkout of the project (the same checks as
/// [`trim_build_cache`]). Call it off the render loop.
#[cfg(feature = "cli")]
pub(crate) fn clear_build_cache(root: &Path, session: Option<&Session>) -> Result<u64, String> {
    let dir = worktrees_dir(root).ok_or("there is no subagent build cache")?;
    let target = dir.join(CARGO_TARGET);
    if !std::fs::symlink_metadata(&target).is_ok_and(|m| m.is_dir()) {
        return Err("there is no subagent build cache".to_string());
    }
    let ours = match session {
        // A reader builds there too, without a lease, so any running
        // subagent counts.
        Some(s) if (s.children_running)() || !s.ledger.state.lock().unwrap().busy.is_empty() => {
            return Err(BUILDING.to_string());
        }
        Some(s) => s.own_ids(),
        None => HashSet::new(),
    };
    let to = {
        let Some(_building) = lock_build_cache(&dir) else {
            return Err(BUILDING.to_string());
        };
        if checkouts_in_use(&dir, &ours) {
            return Err("another live jan session has a subagent checkout of this project \
                        and may be building there"
                .to_string());
        }
        move_to_trash(&target).ok_or("could not move the build cache out of the way")?
    };
    // Measured once moved and the lock let go, so no dispatch waits on the
    // walk; nothing builds in the trash, so the size is exact.
    let bytes = dir_size(&to, u64::MAX);
    // Deleted now, not after the trash's week: the user asked for the space.
    let _ = std::fs::remove_dir_all(to);
    Ok(bytes)
}

/// Why the build cache was not cleared while a subagent may build in it.
#[cfg(feature = "cli")]
const BUILDING: &str =
    "a subagent is running and may be building there; try again once it has finished";

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
            let mut held = match (checkout.commits_anywhere(&wt.base), checkout.uncommitted()) {
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
    /// branch; session end must not lose those commits (they are brought
    /// back before the checkout goes), nor drop uncommitted edits made there.
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
        assert_eq!(kept.len(), 1, "{kept:?}");
        assert!(!committed.root.exists(), "its commits are in the user's repo");
        assert!(dirty.root.is_dir());
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

    /// Only a checkout whose work is all in the user's repository goes: one
    /// with no commits, or one whose commits were brought back.
    #[test]
    fn session_end_removes_only_clean_worktrees_whose_work_is_in_the_repo() {
        let Some(root) = repo("cleanup") else { return };
        let ledger = Arc::new(Ledger::default());
        let (idle, l1) = ledger.assign(&root, "general", true, None).unwrap();
        let (committed, l2) = ledger.assign(&root, "general-2", true, None).unwrap();
        let (dirty, l3) = ledger.assign(&root, "general-3", true, None).unwrap();
        drop((l1, l2, l3));
        commit(&committed.root, "b.txt");
        std::fs::write(dirty.root.join("a.txt"), "edited\n").unwrap();

        let kept = ledger.finish_session().kept;
        assert_eq!(kept.len(), 1, "{kept:?}");
        assert!(!idle.root.exists() && !committed.root.exists());
        let idle_branch = &idle.worktree.as_ref().unwrap().branch;
        assert_eq!(crate::core::agent::git::resolve_commit(&root, idle_branch), None);
        let branch = &committed.worktree.as_ref().unwrap().branch;
        assert!(crate::core::agent::git::resolve_commit(&root, branch).is_some());
        assert!(dirty.root.is_dir());
        assert!(kept[0].contains("1 uncommitted file(s)"), "{kept:?}");
        // Named once and handed to the user: the ledger holds none of them.
        assert!(ledger.live().is_empty(), "{:?}", ledger.live());
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
    /// the base, detached) still holds that work on the branch: it is brought
    /// back before the checkout goes, never lost with it.
    #[test]
    fn a_branch_holding_commits_is_brought_back_even_when_head_moved_away() {
        let Some(root) = repo("head-moved") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        let wt = ws.worktree.as_ref().unwrap();
        commit(&ws.root, "b.txt");
        assert!(git(&ws.root, &["switch", "-q", "--detach", &wt.base]));
        let tip = crate::core::agent::git::resolve_commit(&ws.root, &wt.branch);

        let kept = ledger.finish_session().kept;
        assert!(kept.is_empty(), "{kept:?}");
        assert!(!ws.root.exists());
        assert_eq!(crate::core::agent::git::resolve_commit(&root, &wt.branch), tip);
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
        let done_head = crate::core::agent::git::head_sha(&done.root);
        let in_repo = crate::core::agent::git::resolve_commit(&root, &branch(&done));
        let footer = done.answer_footer(brought.as_deref()).unwrap();
        let clash_footer = clash.answer_footer(refused.as_deref()).unwrap();
        let clash_now = crate::core::agent::git::resolve_commit(&root, &branch(&clash));
        let idle_branch = crate::core::agent::git::resolve_commit(&root, &branch(&idle));
        let reader = ChildWorkspace::shared(&root, true);
        let _ = ledger.finish_session();
        let _ = std::fs::remove_dir_all(&clash.root);
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(none, None);
        assert_eq!(idle_branch, None, "a branch with no commits is not created");
        assert_eq!(brought, None);
        assert_eq!(in_repo, done_head);
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

    /// A writer's committed, clean checkout is removed once its branch is in
    /// the user's repository, whether its finish brought it back or the
    /// settle did, and the user is told the branch, once.
    #[test]
    fn a_committed_checkout_whose_branch_was_brought_back_is_trashed_and_named() {
        let Some(root) = repo("brought") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        commit(&ws.root, "b.txt");
        let tip = crate::core::agent::git::head_sha(&ws.root).unwrap();
        assert_eq!(ws.bring_back(), None, "as the writer's finish does");
        let branch = ws.worktree.as_ref().unwrap().branch.clone();

        let settled = ledger.finish_session();
        let in_repo = crate::core::agent::git::resolve_commit(&root, &branch);
        let gone = !ws.root.exists();
        let _ = std::fs::remove_dir_all(&root);
        assert!(settled.kept.is_empty(), "{:?}", settled.kept);
        assert!(gone, "its worktree goes");
        assert_eq!(in_repo.as_deref(), Some(tip.as_str()), "its work is on the branch");
        let bin = display(&dunce::canonicalize(trash_of(&root)).unwrap());
        assert_eq!(
            settled.notices(),
            [format!(
                "brought back branch {branch}, moved its worktree to {bin}; deleted after 7 days"
            )]
        );
    }

    /// Commit `.gitignore` with `rules` in the checkout `ws`, as a child would.
    fn commit_ignore(ws: &ChildWorkspace, rules: &str) {
        std::fs::write(ws.root.join(".gitignore"), rules).unwrap();
        assert!(git(&ws.root, &["add", ".gitignore"]));
        assert!(git(&ws.root, &["commit", "-q", "--no-gpg-sign", "-m", "ignore"]));
    }

    /// An ignored file that is not build output (a `.env`, local config) is
    /// only in the checkout: a brought-back checkout holding one is kept and
    /// listed with the file named, while one holding only ignored build
    /// output goes, into the trash rather than deleted.
    #[test]
    fn a_brought_back_checkout_keeps_ignored_files_but_not_build_output() {
        let Some(root) = repo("ignored") else { return };
        let ledger = Arc::new(Ledger::default());
        let (env, l1) = ledger.assign(&root, "general", true, None).unwrap();
        let (built, l2) = ledger.assign(&root, "general-2", true, None).unwrap();
        drop((l1, l2));
        commit_ignore(&env, ".env\ntarget/\n");
        std::fs::write(env.root.join(".env"), "KEY=1\n").unwrap();
        commit_ignore(&built, "target/\n");
        std::fs::create_dir_all(built.root.join("target/debug")).unwrap();
        std::fs::write(built.root.join("target/debug/app"), "x").unwrap();
        // As each writer's finish does.
        assert_eq!((env.bring_back(), built.bring_back()), (None, None));

        let session = Session { ledger: &ledger, children_running: &|| false };
        let listed = list_worktrees(&root, Some(&session));
        let settled = ledger.finish_with(|_| 0);
        let env_kept = env.root.join(".env").is_file();
        let built_gone = !built.root.exists();
        let trashed = std::fs::read_dir(trash_of(&root)).map_or(0, |e| e.count());
        let _ = std::fs::remove_dir_all(&env.root);
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(
            state_of(&listed, &env),
            &CheckoutState::Uncommitted {
                files: vec![".env".to_string()],
                commits: 1,
                off_branch: 0,
                build_output: vec![]
            }
        );
        assert_eq!(state_of(&listed, &built), &CheckoutState::Removable { commits: 1 });
        let shown = state_of(&listed, &env).describe();
        assert!(shown.starts_with("holds uncommitted work") && shown.contains(".env"), "{shown}");
        assert!(env_kept, "the .env is still there");
        assert_eq!(settled.kept.len(), 1, "{:?}", settled.kept);
        assert!(settled.kept[0].contains("1 uncommitted file(s)"), "{:?}", settled.kept);
        assert!(built_gone && trashed == 1, "build output alone does not keep it");
    }

    /// What is inside an ignored build-output directory is looked at: a
    /// `.env` in an ignored `build/`, or a repository cloned under an ignored
    /// `node_modules/`, keeps the checkout and is listed; the confirm and a
    /// forced prune's notice name the build output deleted with it.
    #[test]
    fn work_inside_ignored_build_output_keeps_the_checkout() {
        let Some(root) = repo("inside-ignored") else { return };
        let ledger = Arc::new(Ledger::default());
        let (env, l1) = ledger.assign(&root, "general", true, None).unwrap();
        let (nested, l2) = ledger.assign(&root, "general-2", true, None).unwrap();
        drop((l1, l2));
        commit_ignore(&env, "build/\n");
        std::fs::create_dir_all(env.root.join("build/out")).unwrap();
        std::fs::write(env.root.join("build/out/app.js"), "x".repeat(100)).unwrap();
        std::fs::write(env.root.join("build/out/.env"), "KEY=1\n").unwrap();
        commit_ignore(&nested, "node_modules/\n");
        std::fs::create_dir_all(nested.root.join("node_modules/x/.git")).unwrap();
        assert_eq!((env.bring_back(), nested.bring_back()), (None, None));

        let session = Session { ledger: &ledger, children_running: &|| false };
        let listed = list_worktrees(&root, Some(&session));
        let forced = Prune::One { id: id_of(&env), force: true };
        let pruned = prune_worktrees(&root, Some(&session), &forced);
        let settled = ledger.finish_with(|_| 0);
        let nested_kept = nested.root.join("node_modules/x/.git").is_dir();
        let _ = std::fs::remove_dir_all(&nested.root);
        let _ = std::fs::remove_dir_all(&root);
        let env_state = state_of(&listed, &env);
        assert_eq!(
            env_state,
            &CheckoutState::Uncommitted {
                files: vec!["build/out/.env".to_string()],
                commits: 1,
                off_branch: 0,
                build_output: vec!["build/".to_string()]
            }
        );
        let env_info = listed.checkouts.iter().find(|c| &c.state == env_state).unwrap();
        assert_eq!(
            env_info.loses().as_deref(),
            Some("1 uncommitted file(s) plus ignored build output (106 B)")
        );
        let nested_state = state_of(&listed, &nested);
        assert!(nested_state.describe().contains("node_modules/x/"), "{nested_state:?}");
        assert!(nested_kept, "a nested repository under node_modules keeps it");
        assert_eq!(settled.kept.len(), 1, "{:?}", settled.kept);
        assert_eq!(pruned.build_output, 106, "{pruned:?}");
        let notice = pruned.notice();
        assert!(
            notice.starts_with(
                "removed 1 subagent worktree(s) plus ignored build output (106 B), freed "
            ),
            "{notice}"
        );
    }

    /// A forced prune of an uncommitted checkout brings its branch back first
    /// and says so, as the confirm promised.
    #[test]
    fn a_forced_prune_of_uncommitted_work_names_the_branch_it_brought_back() {
        let Some(root) = repo("prune-brought") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        commit(&ws.root, "b.txt");
        std::fs::write(ws.root.join("a.txt"), "edited\n").unwrap();
        let session = Session { ledger: &ledger, children_running: &|| false };
        let forced = Prune::One { id: id_of(&ws), force: true };
        let pruned = prune_worktrees(&root, Some(&session), &forced);
        let branch = ws.worktree.as_ref().unwrap().branch.clone();
        let there = crate::core::agent::git::resolve_commit(&root, &branch);
        let _ = ledger.finish_with(|_| 0);
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(pruned.removed, std::slice::from_ref(&branch), "{pruned:?}");
        assert!(there.is_some());
        assert_eq!(pruned.brought, [branch], "{pruned:?}");
    }

    /// A mark taken again on the same path (a later conversation end) is not
    /// undone when the earlier one drops.
    #[test]
    fn an_old_settling_mark_never_removes_a_newer_one() {
        let ledger = Arc::new(Ledger::default());
        let path = Path::new("/w/general-0001");
        let mut state = ledger.state.lock().unwrap();
        let old = ledger.mark(&mut state, path);
        let new = ledger.mark(&mut state, path);
        drop(state);
        let session = Session { ledger: &ledger, children_running: &|| false };
        drop(old);
        assert_eq!(session.in_use(path), Some(InUseBy::Settling), "the newer mark stays");
        drop(new);
        assert_eq!(session.in_use(path), None);
    }

    /// A child can write its checkout's `.git/info/exclude`: what that hides
    /// is still the child's, so the checkout does not read as clean.
    #[test]
    fn a_file_hidden_by_the_checkouts_own_exclude_keeps_it() {
        let Some(root) = repo("info-exclude") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        commit(&ws.root, "b.txt");
        std::fs::write(ws.root.join(".git/info/exclude"), "notes.md\n").unwrap();
        std::fs::write(ws.root.join("notes.md"), "mine\n").unwrap();
        let kept = ledger.finish_session().kept;
        let there = ws.root.join("notes.md").is_file();
        let _ = std::fs::remove_dir_all(&ws.root);
        let _ = std::fs::remove_dir_all(&root);
        assert!(there);
        assert_eq!(kept.len(), 1, "{kept:?}");
    }

    /// A branch already in the user's repository needs no bringing back, so a
    /// failed bring-back never keeps a checkout that holds nothing else, nor
    /// lists it as kept while calling it removable.
    #[test]
    fn a_checkout_whose_branch_is_already_in_the_repository_goes_without_a_fetch() {
        let Some(root) = repo("already") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        commit(&ws.root, "b.txt");
        assert_eq!(ws.bring_back(), None);
        // Any fetch from the checkout into the user's repository now fails.
        let from = ws.root.join(".git").to_string_lossy().into_owned();
        let nowhere = format!("url.{}.insteadOf", root.join("nowhere").display());
        assert!(git(&root, &["config", &nowhere, &from]));
        let session = Session { ledger: &ledger, children_running: &|| false };
        let pruned = prune_worktrees(&root, Some(&session), &Prune::Safe);
        let gone = !ws.root.exists();
        let _ = ledger.finish_with(|_| 0);
        let _ = std::fs::remove_dir_all(&root);
        assert!(gone && pruned.kept.is_empty(), "{pruned:?}");
        assert_eq!(pruned.removed.len(), 1, "{pruned:?}");
    }

    /// The settle brings a committed branch back itself; with two, one
    /// headline names both.
    #[test]
    fn the_settle_brings_branches_back_before_removing_their_checkouts() {
        let Some(root) = repo("brought-two") else { return };
        let ledger = Arc::new(Ledger::default());
        let (a, l1) = ledger.assign(&root, "general", true, None).unwrap();
        let (b, l2) = ledger.assign(&root, "general-2", true, None).unwrap();
        drop((l1, l2));
        commit(&a.root, "a2.txt");
        commit(&b.root, "b.txt");
        let branch = |ws: &ChildWorkspace| ws.worktree.as_ref().unwrap().branch.clone();
        let settled = ledger.end_conversation().settle();
        let fetched = [&a, &b].map(|ws| crate::core::agent::git::resolve_commit(&root, &branch(ws)));
        let gone = !a.root.exists() && !b.root.exists();
        let _ = std::fs::remove_dir_all(&root);
        assert!(settled.kept.is_empty(), "{:?}", settled.kept);
        assert!(gone);
        assert!(fetched.iter().all(Option::is_some), "{fetched:?}");
        let notices = settled.notices();
        assert_eq!(notices.len(), 1, "{notices:?}");
        assert!(notices[0].starts_with("brought back 2 branches, moved their worktrees to "));
        assert!(notices[0].contains("; deleted after 7 days\n"), "{notices:?}");
        assert!(notices[0].contains(&branch(&a)) && notices[0].contains(&branch(&b)));
    }

    /// Uncommitted work is only in the checkout: it stays, though its
    /// committed branch is brought back.
    #[test]
    fn a_committed_checkout_with_uncommitted_changes_is_kept() {
        let Some(root) = repo("brought-dirty") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        commit(&ws.root, "b.txt");
        std::fs::write(ws.root.join("a.txt"), "edited\n").unwrap();
        let branch = ws.worktree.as_ref().unwrap().branch.clone();
        let kept = ledger.finish_session().kept;
        let fetched = crate::core::agent::git::resolve_commit(&root, &branch);
        let there = ws.root.join("a.txt").is_file();
        let _ = std::fs::remove_dir_all(&ws.root);
        let _ = std::fs::remove_dir_all(&root);
        assert!(there);
        assert_eq!(kept.len(), 1, "{kept:?}");
        assert!(kept[0].contains("1 commit(s), 1 uncommitted file(s)"), "{kept:?}");
        assert!(fetched.is_some(), "the commits are brought back anyway");
    }

    /// A branch that could not be brought back (the user's branch of that
    /// name moved on) is only in the checkout, which stays.
    #[test]
    fn a_checkout_whose_branch_could_not_be_brought_back_is_kept() {
        let Some(root) = repo("brought-clash") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        commit(&ws.root, "b.txt");
        let branch = ws.worktree.as_ref().unwrap().branch.clone();
        commit(&root, "u.txt");
        assert!(git(&root, &["branch", &branch]));
        let kept = ledger.finish_session().kept;
        let there = ws.root.is_dir();
        let _ = std::fs::remove_dir_all(&ws.root);
        let _ = std::fs::remove_dir_all(&root);
        assert!(there);
        assert_eq!(kept.len(), 1, "{kept:?}");
        assert!(kept[0].contains("its branch is not in your repository"), "{kept:?}");
    }

    /// A crashed session's committed, clean checkout is settled by the next
    /// start under the same rule: branch brought back, checkout removed.
    #[test]
    fn a_startup_sweep_trashes_an_orphan_once_its_branch_is_brought_back() {
        let Some(root) = repo("crash-brought") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        commit(&ws.root, "b.txt");
        let tip = crate::core::agent::git::head_sha(&ws.root).unwrap();
        let branch = ws.worktree.as_ref().unwrap().branch.clone();
        drop(ledger);
        let mut told = Vec::new();
        sweep_and_report(&root, &mut |text| {
            told.push(text);
            true
        });
        let fetched = crate::core::agent::git::resolve_commit(&root, &branch);
        let gone = !ws.root.exists();
        let record = meta_of(&root).join(format!("{}.json", id_of(&ws))).exists();
        let bin = display(&dunce::canonicalize(trash_of(&root)).unwrap());
        let _ = std::fs::remove_dir_all(&root);
        assert!(gone && !record);
        assert_eq!(fetched.as_deref(), Some(tip.as_str()));
        assert_eq!(
            told,
            [format!(
                "brought back branch {branch}, moved its worktree to {bin}; deleted after 7 days"
            )]
        );
    }

    /// Fill `root`'s project's shared build directory with `bytes` of output.
    fn fill_build_cache(root: &Path, bytes: usize) -> PathBuf {
        let target = project_worktrees_dir(root).unwrap().join(CARGO_TARGET);
        std::fs::create_dir_all(target.join("debug/deps")).unwrap();
        std::fs::write(target.join("debug/deps/lib.rlib"), vec![0u8; bytes]).unwrap();
        target
    }

    /// What of the trash's entries came from the build directory.
    fn trashed_caches(root: &Path) -> usize {
        std::fs::read_dir(trash_of(root)).map_or(0, |entries| {
            entries
                .filter_map(Result::ok)
                .filter(|e| e.file_name().to_string_lossy().starts_with(CARGO_TARGET))
                .count()
        })
    }

    /// A build directory over the cap is deleted when the session ends (not
    /// left in the trash), and the user is told once; one under it stays.
    #[test]
    fn a_build_cache_over_its_cap_is_deleted_at_session_end() {
        let Some(root) = repo("cache-over") else { return };
        let ledger = Arc::new(Ledger::default());
        let (_ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        let target = fill_build_cache(&root, 4096);
        let settled = ledger.finish_with(|_| 1024);
        let gone = !target.exists();
        use std::time::{Duration, Instant};
        // Deleted on a background thread, not left in the trash for a week.
        let deadline = Instant::now() + Duration::from_secs(10);
        while trashed_caches(&root) > 0 && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        let trashed = trashed_caches(&root);
        let _ = std::fs::remove_dir_all(&root);
        assert!(gone && trashed == 0, "gone {gone}, trashed {trashed}");
        let notices = settled.notices();
        let cleared: Vec<_> = notices.iter().filter(|n| n.contains("build cache")).collect();
        assert_eq!(
            cleared,
            ["subagent build cache over 1024 bytes, cleared (next build starts cold)"],
            "{notices:?}"
        );
    }

    #[test]
    fn a_build_cache_under_its_cap_or_with_no_cap_is_kept() {
        let Some(root) = repo("cache-under") else { return };
        for cap in [1 << 20, 0] {
            let ledger = Arc::new(Ledger::default());
            let (_ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
            drop(lease);
            let target = fill_build_cache(&root, 4096);
            let settled = ledger.finish_with(|_| cap);
            assert!(target.join("debug/deps/lib.rlib").is_file(), "cap {cap}");
            assert!(settled.notices().iter().all(|n| !n.contains("build cache")), "cap {cap}");
            assert_eq!(trim_build_cache(&root, cap), None, "cap {cap}");
            assert!(target.is_dir(), "cap {cap}");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A child still building when the session ends (its writer holds its
    /// worktree) keeps the build directory it is writing into.
    #[test]
    fn a_build_cache_is_not_trimmed_while_a_child_is_busy() {
        let Some(root) = repo("cache-busy") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        let target = fill_build_cache(&root, 4096);
        let busy = ledger.finish_with(|_| 1024);
        let kept = target.is_dir();
        drop(lease);
        let after = ledger.finish_with(|_| 1024);
        let _ = std::fs::remove_dir_all(&ws.root);
        let _ = std::fs::remove_dir_all(&root);
        assert!(kept, "a busy child's build directory stays");
        assert!(busy.notices().iter().all(|n| !n.contains("build cache")));
        assert!(after.notices().iter().any(|n| n.contains("build cache")), "then it goes");
    }

    /// The startup sweep trims too, but never under a live session of
    /// another process (or this one) that holds a checkout of the project.
    #[test]
    fn the_startup_trim_spares_a_build_cache_a_live_session_may_use() {
        let Some(root) = repo("cache-sweep") else { return };
        let target = fill_build_cache(&root, 4096);
        let ledger = Arc::new(Ledger::default());
        let (_ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        let live = trim_build_cache(&root, 1024);
        let kept = target.is_dir();
        let _ = ledger.finish_with(|_| 0);
        let orphaned = trim_build_cache(&root, 1024);
        let gone = !target.exists();
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(live, None);
        assert!(kept);
        assert!(orphaned.is_some_and(|n| n.contains("cleared")) && gone);
    }

    /// The size walk stops once the cap is passed, and never follows a link.
    #[cfg(unix)]
    #[test]
    fn the_size_walk_is_bounded_and_follows_no_link() {
        let Some(root) = repo("cache-walk") else { return };
        let target = fill_build_cache(&root, 100);
        std::os::unix::fs::symlink(&root, target.join("link")).unwrap();
        std::fs::write(root.join("big"), vec![0u8; 8192]).unwrap();
        let over = |cap| larger_than(&target, cap);
        let (small, big) = (over(99), over(100));
        let _ = std::fs::remove_dir_all(&root);
        assert!(small, "100 bytes is over a 99-byte cap");
        assert!(!big, "and not over 100, the linked repository not counted");
    }

    /// A project with a checkout in each state `/worktrees` shows: in use by
    /// a writer of `ledger`, by another live session (`other`), with
    /// uncommitted work, with commits not in the user's repository, and
    /// removable. Returns the workspaces in that order and the writer's lease.
    fn every_state(
        root: &Path,
        ledger: &Arc<Ledger>,
        other: &Arc<Ledger>,
    ) -> ([ChildWorkspace; 5], Option<WriterLease>) {
        let (busy, lease) = ledger.assign(root, "busy", true, None).unwrap();
        let (theirs, l1) = other.assign(root, "theirs", true, None).unwrap();
        let (dirty, l2) = ledger.assign(root, "dirty", true, None).unwrap();
        let (committed, l3) = ledger.assign(root, "committed", true, None).unwrap();
        let (idle, l4) = ledger.assign(root, "idle", true, None).unwrap();
        drop((l1, l2, l3, l4));
        std::fs::write(dirty.root.join("a.txt"), "edited\n").unwrap();
        commit(&committed.root, "b.txt");
        ([busy, theirs, dirty, committed, idle], lease)
    }

    fn state_of<'a>(report: &'a WorktreesReport, ws: &ChildWorkspace) -> &'a CheckoutState {
        let branch = &ws.worktree.as_ref().unwrap().branch;
        &report.checkouts.iter().find(|c| &c.branch == branch).expect("listed").state
    }

    /// Each checkout is listed under the state that decides what may be done
    /// with it, with its size; the build cache with its own.
    #[test]
    fn the_list_names_each_checkouts_state_and_size() {
        let Some(root) = repo("list") else { return };
        let (ledger, other) = (Arc::new(Ledger::default()), Arc::new(Ledger::default()));
        let (ws, lease) = every_state(&root, &ledger, &other);
        fill_build_cache(&root, 4096);
        let session = Session { ledger: &ledger, children_running: &|| false };
        let report = list_worktrees(&root, Some(&session));
        let headless = list_worktrees(&root, None);
        drop(lease);
        let _ = ledger.finish_with(|_| 0);
        let _ = other.finish_with(|_| 0);
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(report.checkouts.len(), 5, "{report:?}");
        assert_eq!(state_of(&report, &ws[0]), &CheckoutState::InUse { by: InUseBy::Child });
        assert_eq!(state_of(&report, &ws[1]), &CheckoutState::InUse { by: InUseBy::Session });
        assert_eq!(
            state_of(&report, &ws[2]),
            &CheckoutState::Uncommitted {
                files: vec!["a.txt".to_string()],
                commits: 0,
                off_branch: 0,
                build_output: vec![]
            }
        );
        assert_eq!(state_of(&report, &ws[3]), &CheckoutState::Unbrought { commits: 1 });
        assert_eq!(state_of(&report, &ws[4]), &CheckoutState::Removable { commits: 0 });
        assert!(report.checkouts.iter().all(|c| c.bytes > 0), "{report:?}");
        assert_eq!(report.build_cache_bytes, Some(4096));
        assert_eq!(report.removable().0, 1);
        // Headless owns nothing: this session's checkouts are another's.
        for one in &ws {
            assert_eq!(state_of(&headless, one), &CheckoutState::InUse { by: InUseBy::Session });
        }
        let lines = report.lines().join("\n");
        assert!(lines.contains("build cache  4.0 KB"), "{lines}");
        assert!(lines.contains("holds uncommitted work: a.txt"), "{lines}");
    }

    /// The safe prune removes what session end would (bringing a committed
    /// branch back first), and never a checkout a running subagent or
    /// another live session holds, nor one with uncommitted work.
    #[test]
    fn a_safe_prune_removes_only_what_session_end_would() {
        let Some(root) = repo("prune-safe") else { return };
        let (ledger, other) = (Arc::new(Ledger::default()), Arc::new(Ledger::default()));
        let (ws, lease) = every_state(&root, &ledger, &other);
        let session = Session { ledger: &ledger, children_running: &|| false };
        let pruned = prune_worktrees(&root, Some(&session), &Prune::Safe);
        let there = ws.each_ref().map(|w| w.root.is_dir());
        let branch = |w: &ChildWorkspace| w.worktree.as_ref().unwrap().branch.clone();
        let brought = crate::core::agent::git::resolve_commit(&root, &branch(&ws[3]));
        let live = ledger.live().len();
        let trashed = std::fs::read_dir(trash_of(&root)).map_or(0, |e| e.count());
        drop(lease);
        let _ = ledger.finish_with(|_| 0);
        let _ = other.finish_with(|_| 0);
        let _ = std::fs::remove_dir_all(&ws[2].root);
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(there, [true, true, true, false, false], "{pruned:?}");
        assert!(brought.is_some(), "its commits were brought back before it went");
        assert_eq!(pruned.removed.len(), 2, "{pruned:?}");
        assert_eq!(pruned.brought, [branch(&ws[3])]);
        assert_eq!(pruned.kept.len(), 3, "{pruned:?}");
        // Moved to the trash, as session end does, not deleted.
        assert!(pruned.freed == 0 && pruned.trashed > 0, "{pruned:?}");
        assert_eq!(trashed, 2);
        assert_eq!(live, 2, "the ledger forgets what went (theirs is another's)");
        assert!(pruned.notice().starts_with("removed 2 subagent worktree(s); moved "));
    }

    /// A checkout a running subagent works in is never removed, whatever is
    /// asked: not by the safe prune, not by a forced one, not by name.
    #[test]
    fn a_checkout_in_use_by_a_live_child_is_never_removed() {
        let Some(root) = repo("prune-busy") else { return };
        let ledger = Arc::new(Ledger::default());
        let (busy, lease) = ledger.assign(&root, "busy", true, None).unwrap();
        let (reused, l2) = ledger.assign(&root, "reused", true, None).unwrap();
        drop(l2);
        let id = id_of(&busy);
        // A reader holds no lease: while any subagent runs, none of the
        // session's checkouts goes.
        let running = Session { ledger: &ledger, children_running: &|| true };
        let pruned = prune_worktrees(&root, Some(&running), &Prune::All);
        assert!(reused.root.is_dir() && pruned.removed.is_empty(), "{pruned:?}");
        let session = Session { ledger: &ledger, children_running: &|| false };
        for which in [Prune::Safe, Prune::All, Prune::One { id: id.clone(), force: true }] {
            let pruned = prune_worktrees(&root, Some(&session), &which);
            assert!(busy.root.is_dir(), "{which:?}");
            assert!(!pruned.removed.contains(&busy.worktree.as_ref().unwrap().branch));
        }
        assert!(!reused.root.exists(), "the idle one went once nothing ran");
        drop(lease);
        let _ = ledger.finish_with(|_| 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// After the user confirms the loss, one checkout with uncommitted work
    /// goes by name (its committed branch still brought back first), and
    /// `All` takes every one not in use.
    #[test]
    fn a_confirmed_prune_removes_work_but_never_another_sessions_checkout() {
        let Some(root) = repo("prune-force") else { return };
        let (ledger, other) = (Arc::new(Ledger::default()), Arc::new(Ledger::default()));
        let (ws, lease) = every_state(&root, &ledger, &other);
        let session = Session { ledger: &ledger, children_running: &|| false };
        let unforced = Prune::One { id: id_of(&ws[2]), force: false };
        let kept = prune_worktrees(&root, Some(&session), &unforced);
        let dirty_kept = ws[2].root.is_dir();
        let forced = Prune::One { id: id_of(&ws[2]), force: true };
        let one = prune_worktrees(&root, Some(&session), &forced);
        let dirty_gone = !ws[2].root.exists();
        let all = prune_worktrees(&root, Some(&session), &Prune::All);
        let there = ws.each_ref().map(|w| w.root.is_dir());
        drop(lease);
        let _ = ledger.finish_with(|_| 0);
        let _ = other.finish_with(|_| 0);
        let _ = std::fs::remove_dir_all(&root);
        assert!(dirty_kept && kept.removed.is_empty(), "{kept:?}");
        assert!(dirty_gone && one.removed.len() == 1, "{one:?}");
        assert!(one.freed > 0 && one.trashed == 0, "deleted at once: {one:?}");
        assert_eq!(there, [true, true, false, false, false], "{all:?}");
        assert_eq!(all.removed.len(), 2, "{all:?}");
    }

    /// Clearing the build cache deletes it and says how much it freed, but
    /// not while a subagent of this session or another live session may be
    /// building in it.
    #[test]
    fn the_build_cache_is_cleared_only_when_no_build_may_run() {
        let Some(root) = repo("clear-cache") else { return };
        let target = fill_build_cache(&root, 4096);
        let (ledger, other) = (Arc::new(Ledger::default()), Arc::new(Ledger::default()));
        let (_mine, lease) = ledger.assign(&root, "general", true, None).unwrap();
        let session = Session { ledger: &ledger, children_running: &|| false };
        let busy = clear_build_cache(&root, Some(&session));
        drop(lease);
        let running = Session { ledger: &ledger, children_running: &|| true };
        let reading = clear_build_cache(&root, Some(&running));
        let (_theirs, l2) = other.assign(&root, "general", true, None).unwrap();
        drop(l2);
        let elsewhere = clear_build_cache(&root, Some(&session));
        let kept = target.join("debug/deps/lib.rlib").is_file();
        let _ = other.finish_with(|_| 0);
        // This session's own idle checkout does not hold the cache back.
        let cleared = clear_build_cache(&root, Some(&session));
        let gone = !target.exists();
        let trashed = trashed_caches(&root);
        let again = clear_build_cache(&root, None);
        let _ = ledger.finish_with(|_| 0);
        let _ = std::fs::remove_dir_all(&root);
        assert!(busy.is_err() && reading.is_err(), "{busy:?} {reading:?}");
        assert!(elsewhere.is_err_and(|e| e.contains("another live jan session")));
        assert!(kept);
        assert_eq!(cleared, Ok(4096));
        assert!(gone && trashed == 0, "deleted, not left in the trash");
        assert!(again.is_err_and(|e| e.contains("no subagent build cache")));
    }

    /// Any child given the build directory (a reader in the parent's own
    /// checkout too, which holds no checkout lock) holds the build lock
    /// shared, from another process as from this one: while it does, neither
    /// the trim nor the clear touches the directory; once it lets go, both may.
    #[test]
    fn the_build_cache_is_neither_trimmed_nor_cleared_while_a_child_holds_it() {
        let Some(root) = repo("build-lock") else { return };
        let target = fill_build_cache(&root, 4096);
        let reader = ChildWorkspace::shared(&root, true);
        let placement = place(&reader, &root);
        let mut args = crate::core::agent::subagent::tests::max_par_args(&root);
        let hold = apply(&mut args, &reader, placement);
        assert!(hold.is_some(), "a reader building in the cache holds its lock");
        let trimmed = trim_build_cache(&root, 1024);
        let cleared = clear_build_cache(&root, None);
        let kept = target.join("debug/deps/lib.rlib").is_file();
        drop(hold);
        // Another process's child: its own open of the lock file, held shared.
        let other = open_build_lock(&project_worktrees_dir(&root).unwrap()).unwrap();
        fs4::FileExt::lock_shared(&other).unwrap();
        let elsewhere = clear_build_cache(&root, None);
        drop(other);
        let free = trim_build_cache(&root, 1024);
        let gone = !target.exists();
        let refilled = fill_build_cache(&root, 4096);
        let cleared_free = clear_build_cache(&root, None);
        let gone_again = !refilled.exists();
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(trimmed, None);
        assert!(cleared.is_err() && elsewhere.is_err(), "{cleared:?} {elsewhere:?}");
        assert!(kept);
        assert!(free.is_some() && gone, "{free:?}");
        assert_eq!(cleared_free, Ok(4096));
        assert!(gone_again);
    }

    /// A checkout this session kept at a conversation end is still held by
    /// it until the user is told: `/worktrees` says so, rather than calling
    /// it another session's, and prunes it as nobody's once told.
    #[test]
    fn a_checkout_held_after_a_conversation_end_is_labelled_as_this_sessions() {
        let Some(root) = repo("settling") else { return };
        let ledger = Arc::new(Ledger::default());
        let (ws, lease) = ledger.assign(&root, "general", true, None).unwrap();
        drop(lease);
        std::fs::write(ws.root.join("a.txt"), "edited\n").unwrap();
        let settled = ledger.end_conversation().settle();
        let session = Session { ledger: &ledger, children_running: &|| false };
        let held = list_worktrees(&root, Some(&session));
        let pruned = prune_worktrees(&root, Some(&session), &Prune::All);
        let there = ws.root.is_dir();
        settled.report(&mut |_| true);
        let told = list_worktrees(&root, Some(&session));
        let _ = std::fs::remove_dir_all(&ws.root);
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(state_of(&held, &ws), &CheckoutState::InUse { by: InUseBy::Settling });
        assert!(state_of(&held, &ws).describe().contains("this session"));
        assert!(there && pruned.removed.is_empty(), "{pruned:?}");
        assert!(matches!(state_of(&told, &ws), CheckoutState::Uncommitted { .. }), "{told:?}");
    }

    /// The confirm names only what is really lost: a removal brings an
    /// uncommitted checkout's branch back first, so only its files (and any
    /// commit on no branch) are lost; an unbrought one loses its commits.
    #[test]
    fn the_loss_named_counts_only_what_a_removal_cannot_bring_back() {
        let files = vec!["a.txt".to_string(), ".env".to_string()];
        let dirty = CheckoutState::Uncommitted {
            files: files.clone(),
            commits: 3,
            off_branch: 0,
            build_output: vec![],
        };
        assert_eq!(dirty.loses().as_deref(), Some("2 uncommitted file(s)"));
        assert_eq!(
            dirty.brings_back().as_deref(),
            Some("its branch (3 commit(s)) is brought back to your repository first")
        );
        let stashed = CheckoutState::Uncommitted {
            files: files.clone(),
            commits: 3,
            off_branch: 1,
            build_output: vec![],
        };
        assert_eq!(
            stashed.loses().as_deref(),
            Some("2 uncommitted file(s) and 1 commit(s) on no branch")
        );
        let only_files =
            CheckoutState::Uncommitted { files, commits: 0, off_branch: 0, build_output: vec![] };
        assert_eq!(only_files.brings_back(), None);
        let ahead = CheckoutState::Unbrought { commits: 2 };
        assert_eq!(ahead.loses().as_deref(), Some("2 commit(s) not in your repository"));
        assert_eq!(ahead.brings_back(), None);
    }

    /// A checkout's size and its build output's are counted in one walk,
    /// a named file as well as a named directory.
    #[test]
    fn build_output_is_measured_in_the_walk_that_sizes_the_checkout() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("build/out")).unwrap();
        std::fs::write(dir.path().join("build/out/app.js"), "x".repeat(100)).unwrap();
        std::fs::write(dir.path().join("x.o"), "x".repeat(10)).unwrap();
        std::fs::write(dir.path().join("a.txt"), "x").unwrap();
        let built = vec!["build/".to_string(), "x.o".to_string()];
        assert_eq!(sizes(dir.path(), &built, u64::MAX), (111, 110));
        assert_eq!(sizes(dir.path(), &[], u64::MAX), (111, 0));
        assert_eq!(dir_size(dir.path(), u64::MAX), 111);
    }

    #[test]
    fn sizes_read_as_a_person_would_say_them() {
        assert_eq!(human_bytes(0), "0 B");
        assert_eq!(human_bytes(1023), "1023 B");
        assert_eq!(human_bytes(1536), "1.5 KB");
        assert_eq!(human_bytes(20 << 30), "20.0 GB");
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
        std::fs::write(kept.root.join("a.txt"), "edited\n").unwrap();
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
        std::fs::write(ws.root.join("a.txt"), "edited\n").unwrap();
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
            std::fs::write(ws.root.join("a.txt"), "edited\n").unwrap();
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
        std::fs::write(kept.root.join("a.txt"), "edited\n").unwrap();
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
    /// the committed one is brought back though it is kept for its
    /// uncommitted edit, and each kept one is reported only once.
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
        std::fs::write(committed.root.join("b.txt"), "edited\n").unwrap();
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
        std::fs::write(ws.root.join("a.txt"), "edited\n").unwrap();
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
