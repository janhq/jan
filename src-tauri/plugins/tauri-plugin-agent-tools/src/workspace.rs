//! Path helpers for the two roots the agent works against.
//!
//! **Store root** -- holds `memory/` and `skills/`. Long-term: memories and
//! skills outlive any single conversation, so on the desktop this is a permanent
//! directory in the Jan data folder. A project (the CLI agent) keeps its store
//! at `~/.jan/projects/<slug>` instead; both are just a store root to
//! everything downstream.
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

/// Where projects' stores live under a Jan home: `<jan_home>/projects`.
const PROJECTS: &str = "projects";

/// The directory a project stored its state in before it moved out of the
/// project: `<project_root>/.jan`. Only the launch migration reads it.
pub const LEGACY_DIR: &str = ".jan";

/// `~/.jan`, the user-wide agent home, or `None` when the home directory is
/// unset or degenerate (a `/` home would put every project's state at the
/// filesystem root).
///
/// Test builds of this crate resolve a per-process temp directory instead, so
/// no test writes into the developer's real `~/.jan`.
pub fn jan_home() -> Option<PathBuf> {
    #[cfg(test)]
    {
        Some(std::env::temp_dir().join(format!("jan-test-home-{}", std::process::id())))
    }
    #[cfg(not(test))]
    {
        #[cfg(windows)]
        let raw = std::env::var_os("USERPROFILE");
        #[cfg(not(windows))]
        let raw = std::env::var_os("HOME");
        let home = PathBuf::from(raw?);
        if home.parent().is_none() || home.as_os_str().is_empty() {
            return None;
        }
        Some(home.join(".jan"))
    }
}

/// The directory every surface hides from the general tools and the sandboxed
/// shell: the Jan home, holding `config.toml` (provider keys, hooks) and every
/// project's store. Only while `sandbox` is on; an unconfined run is the user
/// opting out of containment. The memory/skill tools reach the store by name
/// and are unaffected.
pub fn hidden_root(sandbox: bool) -> Option<PathBuf> {
    if sandbox {
        jan_home()
    } else {
        None
    }
}

/// `<jan_home>/projects`.
pub fn projects_dir(jan_home: &Path) -> PathBuf {
    jan_home.join(PROJECTS)
}

/// FNV-1a of the path's bytes, 8 hex digits. `DefaultHasher` is explicitly not
/// stable across Rust releases, and a project must find its store (and a
/// session its worktree) again after a toolchain upgrade.
fn path_hash(path: &Path) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in path.to_string_lossy().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")[..8].to_string()
}

/// Directory name for a path: its own name plus a hash of the whole path, so
/// two checkouts of the same project never share a directory.
pub fn path_slug(path: &Path) -> String {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|n| !n.is_empty())
        .unwrap_or("repo");
    format!("{name}-{}", path_hash(path))
}

/// The main checkout a Jan subagent checkout at `top` (a `git clone --shared`
/// at `<jan home>/worktrees/<slug>/<id>`) borrows its objects from: the
/// `<main>/.git/objects` its alternates name, canonicalized. `None` for any
/// other repository.
///
/// A writer can rewrite its own alternates, so they are trusted only when they
/// name the project whose slug the clone was created under; otherwise a kept
/// checkout could steer later sessions into another project's store.
fn shared_clone_origin(top: &Path) -> Option<PathBuf> {
    let worktrees = jan_home()?.join("worktrees");
    let worktrees = worktrees.canonicalize().unwrap_or(worktrees);
    let slug_dir = top.parent()?;
    if slug_dir.parent()? != worktrees {
        return None;
    }
    let raw = std::fs::read_to_string(top.join(".git/objects/info/alternates")).ok()?;
    let objects = Path::new(raw.lines().next()?.trim());
    let git = objects.parent()?;
    if objects.file_name()? != "objects" || git.file_name()? != ".git" {
        return None;
    }
    // The alternates spell `main` however git was handed it (forward slashes
    // on Windows, an unresolved symlink), and the slug hashes that text.
    let main = git.parent()?;
    let main = main.canonicalize().unwrap_or_else(|_| main.to_path_buf());
    (slug_dir.file_name()? == path_slug(&main).as_str()).then_some(main)
}

/// The path a project's store is keyed on: the project root, canonicalized,
/// with a Jan subagent checkout or a linked git worktree mapped back onto its
/// main checkout.
///
/// Without the mapping, a session running in `~/.jan/worktrees/<slug>/<id>`
/// would get a fresh, empty store and lose the project's memory, skills and
/// config. A subdirectory of a worktree maps to the same subdirectory of the
/// main checkout. Read straight from the `.git` file or the alternates rather
/// than by running `git`, because this runs on every store lookup.
pub fn project_key(project_root: &Path) -> PathBuf {
    let root = project_root
        .canonicalize()
        .unwrap_or_else(|_| project_root.to_path_buf());
    for top in root.ancestors() {
        let dot_git = top.join(".git");
        if dot_git.is_dir() {
            return match (shared_clone_origin(top), root.strip_prefix(top)) {
                (Some(main), Ok(rel)) if rel.as_os_str().is_empty() => main,
                (Some(main), Ok(rel)) => main.join(rel),
                _ => root,
            };
        }
        if !dot_git.is_file() {
            continue;
        }
        // A linked worktree's `.git` is `gitdir: <main>/.git/worktrees/<name>`.
        let main = std::fs::read_to_string(&dot_git).ok().and_then(|raw| {
            let gitdir = PathBuf::from(raw.trim().strip_prefix("gitdir:")?.trim());
            let gitdir = if gitdir.is_absolute() { gitdir } else { top.join(gitdir) };
            let worktrees = gitdir.parent()?;
            if worktrees.file_name()? != "worktrees" {
                return None;
            }
            let common = worktrees.parent()?;
            if common.file_name()? != ".git" {
                return None;
            }
            common.parent().map(Path::to_path_buf)
        });
        return match (main, root.strip_prefix(top)) {
            (Some(main), Ok(rel)) if rel.as_os_str().is_empty() => main,
            (Some(main), Ok(rel)) => main.join(rel),
            _ => root,
        };
    }
    root
}

/// A project's store root under a given Jan home:
/// `<jan_home>/projects/<slug>`.
pub fn project_store_in(jan_home: &Path, project_root: &Path) -> PathBuf {
    projects_dir(jan_home).join(path_slug(&project_key(project_root)))
}

/// A project's store root: `~/.jan/projects/<slug>`, holding `agent.toml`,
/// `memory/`, `skills/`, `subagents/`, `plugins/` and threads.
///
/// Kept outside the project so the agent's own state never sits in the tree
/// its tools work on (nothing to hide, nothing to gitignore). With no usable
/// home directory it falls back to the legacy in-project location so the agent
/// still works.
pub fn project_store(project_root: &Path) -> PathBuf {
    project_store_at(jan_home().as_deref(), project_root)
}

/// [`project_store`] against an explicit Jan home, for callers that resolve the
/// home themselves (the app substitutes a temp home in its tests).
pub fn project_store_at(jan_home: Option<&Path>, project_root: &Path) -> PathBuf {
    match jan_home {
        Some(home) => project_store_in(home, project_root),
        None => legacy_project_store(project_root),
    }
}

/// Records which directory a store belongs to, since the slug alone only names
/// it. Read by the root memory index and by anything listing projects.
const PROJECT_META: &str = "project.json";

/// Record `project_root` in `<store>/project.json`. Rewritten only when it
/// changed, so a launch does not touch the file every time.
pub fn write_project_meta(store: &Path, project_root: &Path) -> std::io::Result<()> {
    let path = project_root.to_string_lossy().into_owned();
    if project_meta(store).as_deref() == Some(path.as_str()) {
        return Ok(());
    }
    std::fs::create_dir_all(store)?;
    let body = serde_json::json!({ "path": path });
    std::fs::write(store.join(PROJECT_META), format!("{body:#}\n"))
}

/// The project directory a store recorded, if any.
pub fn project_meta(store: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(store.join(PROJECT_META)).ok()?;
    let value: serde_json::Value = serde_json::from_str(&raw).ok()?;
    value.get("path")?.as_str().map(str::to_string)
}

/// The folder under the Jan cache root for sessions with no filesystem
/// project: desktop chat threads and Cowork sessions.
const CHAT_CACHE: &str = "chat";

/// `<project cache>/scratch`, the parent of every session scratch.
const SCRATCH: &str = "scratch";

/// The Jan cache root, `<OS cache dir>/jan` (`$XDG_CACHE_HOME` or `~/.cache`
/// on Linux, `~/Library/Caches` on macOS, `%LOCALAPPDATA%` on Windows).
///
/// Not the system temp dir: a scratch there is invisible at its own path to
/// anything outside a sandbox that mounts it elsewhere, and per-project
/// siblings here keep one project's files out of another's. With no cache dir
/// at all it falls back to the temp dir so the scratch still works (see
/// [`temp_cache_root_in`]).
///
/// Test builds of this crate resolve a per-process temp directory instead, so
/// no test writes into the developer's real cache.
pub fn jan_cache_root() -> PathBuf {
    #[cfg(test)]
    {
        std::env::temp_dir().join(format!("jan-test-cache-{}", std::process::id()))
    }
    #[cfg(not(test))]
    {
        match dirs::cache_dir() {
            Some(cache) => cache.join("jan"),
            None => temp_cache_root_in(&std::env::temp_dir()),
        }
    }
}

/// The cache root under the temp dir `temp`, for a machine with no OS cache
/// dir (no `HOME`). A shared `/tmp` is writable by every local user, so a
/// fixed `jan` there could have been made by another user, who would then
/// see every slug and could swap folders under it. Named per user instead
/// (`jan-<uid>`), and a name already taken by anything but a directory this
/// user owns is passed over for the next one. A name planted between this
/// check and its creation is caught there: [`ensure_scratch_dir_path`]
/// refuses a directory this user does not own, the root and every other
/// folder it creates on the way included. Windows keeps a plain `jan`:
/// its temp dir is already per user.
pub fn temp_cache_root_in(temp: &Path) -> PathBuf {
    #[cfg(unix)]
    {
        let base = format!("jan-{}", nix::unistd::getuid());
        let names = std::iter::once(base.clone()).chain((1..16).map(|n| format!("{base}-{n}")));
        let mut last = temp.join(&base);
        for name in names {
            last = temp.join(name);
            match std::fs::symlink_metadata(&last) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return last,
                Ok(meta) if meta.is_dir() && owned_by_me(&meta) => return last,
                _ => {}
            }
        }
        // Every candidate taken: the last one, which the ownership check at
        // creation refuses, so the scratch fails closed.
        last
    }
    #[cfg(not(unix))]
    {
        temp.join("jan")
    }
}

/// Whether `meta` (from `symlink_metadata`) belongs to this process's user.
#[cfg(unix)]
fn owned_by_me(meta: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    meta.uid() == nix::unistd::getuid().as_raw()
}

/// A project's folder under `cache_root`: `<cache_root>/<slug>`, with the
/// same slug as its store (`~/.jan/projects/<slug>`), so the two always name
/// one project the same way. `<cache_root>/chat` with no project.
pub fn project_cache_dir_in(cache_root: &Path, project_root: Option<&Path>) -> PathBuf {
    match project_root {
        Some(root) => cache_root.join(path_slug(&project_key(root))),
        None => cache_root.join(CHAT_CACHE),
    }
}

/// [`project_cache_dir_in`] under the real [`jan_cache_root`].
pub fn project_cache_dir(project_root: Option<&Path>) -> PathBuf {
    project_cache_dir_in(&jan_cache_root(), project_root)
}

/// Where a project kept its store before the move: `<project_root>/.jan/agent`.
pub fn legacy_project_store(project_root: &Path) -> PathBuf {
    project_root.join(LEGACY_DIR).join("agent")
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

/// Case-folded on Windows and macOS, whose default filesystems treat two
/// spellings of one path as the same path, so a raw `starts_with` would let a
/// different spelling past the check (`canonicalize` keeps the caller's case
/// on macOS). On macOS the `/System/Volumes/Data` firmlink prefix is dropped
/// too: `/System/Volumes/Data/Users/u` is `/Users/u`, and `canonicalize`
/// leaves it as spelled.
fn containment_key(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('\\', "/");
    if cfg!(target_os = "macos") {
        strip_data_volume_prefix(&raw.to_lowercase()).to_string()
    } else if cfg!(windows) {
        raw.to_lowercase()
    } else {
        raw
    }
}

/// `key` (already lower-cased) without a leading `/system/volumes/data`.
fn strip_data_volume_prefix(key: &str) -> &str {
    const DATA_VOLUME: &str = "/system/volumes/data";
    match key.strip_prefix(DATA_VOLUME) {
        Some("") => "/",
        Some(rest) if rest.starts_with('/') => rest,
        _ => key,
    }
}

pub(crate) fn is_within(inner: &Path, outer: &Path) -> bool {
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

/// Supplies the Jan data folder the host app is configured with.
pub type DataFolderResolver = std::sync::Arc<dyn Fn() -> PathBuf + Send + Sync>;

static DATA_FOLDER_RESOLVER: std::sync::OnceLock<DataFolderResolver> = std::sync::OnceLock::new();

/// Install the process-wide data folder source. First call wins, like
/// `hooks::set_resolver`, so nothing can swap it out later.
pub fn set_data_folder_resolver(resolver: DataFolderResolver) {
    let _ = DATA_FOLDER_RESOLVER.set(resolver);
}

/// The Jan data folder an IPC command works in.
///
/// The commands take a `data_folder` argument, but it only stands in for what
/// the host already knows: everything containment rests on (the sandbox
/// location, the mask over settings and keys, the store) is derived from it,
/// so the host's value wins whenever one is installed. The argument is used
/// as-is only without a host, as in this crate's tests.
pub fn host_data_folder(requested: &str) -> PathBuf {
    pick_data_folder(
        DATA_FOLDER_RESOLVER.get().map(|resolve| resolve()),
        requested,
    )
}

fn pick_data_folder(host: Option<PathBuf>, requested: &str) -> PathBuf {
    host.unwrap_or_else(|| PathBuf::from(requested))
}

/// Home-relative folders an agent must never be handed write access to:
/// credentials, folders on `PATH`, shell and tool configuration, and the
/// places that run code at login. The shell rc files themselves sit directly in
/// the home folder, which is refused as a whole.
const PROTECTED_HOME_DIRS: &[&str] = &[
    ".ssh",
    ".gnupg",
    ".aws",
    ".kube",
    ".docker",
    // fish, git, autostart and systemd user units all live here.
    ".config",
    // .local/bin is on PATH; .local/share/applications holds launchers.
    ".local",
    "bin",
    ".cargo",
    ".oh-my-zsh",
    // Tool shims and global installs on PATH, and editor configuration.
    ".npm",
    ".nvm",
    ".bun",
    ".deno",
    ".vscode",
    "Applications",
    "Library/LaunchAgents",
    "Library/Keychains",
    "Library/Services",
    "Library/Application Scripts",
    // Every app's own data and configuration, Jan's included.
    "Library/Application Support",
    "AppData/Local/Microsoft/WindowsApps",
    // Per-user installs, Jan's own on Windows.
    "AppData/Local/Programs",
    "AppData/Roaming/Microsoft/Windows/Start Menu",
];

/// The user's home directory, or `None` when unset or degenerate.
pub fn user_home() -> Option<PathBuf> {
    #[cfg(windows)]
    let raw = std::env::var_os("USERPROFILE");
    #[cfg(not(windows))]
    let raw = std::env::var_os("HOME");
    let home = PathBuf::from(raw?);
    if home.parent().is_none() || home.as_os_str().is_empty() {
        return None;
    }
    Some(home.canonicalize().unwrap_or(home))
}

/// Check that an attached folder (already through [`validate_read_root`]) may
/// also be written.
///
/// Refused: the home directory itself or any folder above it, whose top level
/// holds the shell rc files and profile scripts; any folder inside, or
/// containing, a [`PROTECTED_HOME_DIRS`] entry (also where that entry is a
/// symlink); and the Jan data folder or any folder inside it. A writable attach
/// is the workspace root, writable by the file tools and the sandboxed shell
/// alike, so these would hand the agent persistence or credentials. Without a
/// home folder none of this can be checked, so the attach is refused.
pub fn validate_write_root(
    root: &Path,
    home: Option<&Path>,
    data_folder: &Path,
) -> Result<(), String> {
    let Some(home) = home else {
        return Err(
            "your home folder could not be determined, so no folder can be attached writable"
                .to_string(),
        );
    };
    let data = data_folder
        .canonicalize()
        .unwrap_or_else(|_| data_folder.to_path_buf());
    if is_within(root, &data) || is_within(root, data_folder) {
        return Err(format!(
            "{} is inside the Jan data folder and cannot be attached writable",
            root.display()
        ));
    }
    if is_within(home, root) {
        return Err(format!(
            "{} contains your home folder and cannot be attached writable; attach a project \
             folder inside it instead",
            root.display()
        ));
    }
    for rel in PROTECTED_HOME_DIRS {
        let protected = home.join(rel);
        // `root` is canonical, so also compare against where a symlinked
        // entry really points.
        let resolved = protected.canonicalize().ok();
        let overlaps = |p: &Path| is_within(root, p) || is_within(p, root);
        if overlaps(&protected) || resolved.as_deref().is_some_and(overlaps) {
            return Err(format!(
                "{} overlaps {} and cannot be attached writable",
                root.display(),
                protected.display()
            ));
        }
    }
    Ok(())
}

/// The session-scoped scratch directory: `<project cache>/scratch/<session>`,
/// where `<project cache>` is [`project_cache_dir_in`] (`<cache>/jan/<slug>`,
/// or `<cache>/jan/chat` for a desktop thread). `bash` scratch files persist
/// there across calls for one session and the filesystem tools may write it.
///
/// Every backend exposes it at this same real path (bubblewrap binds it onto
/// itself, Seatbelt grants it by rule, AppContainer by ACE), and
/// `TMPDIR`/`TMP`/`TEMP` name it too. One spelling works inside the sandbox,
/// in the filesystem tools and in an escalated command that runs unconfined;
/// a scratch mounted somewhere else inside the sandbox would not exist at that
/// name outside it.
///
/// Pure path arithmetic: `session` is not checked here. Anything that reaches
/// the filesystem with an id from outside goes through [`ensure_scratch_dir`],
/// [`remove_scratch_dir`] or [`trash_scratch_dir`], which accept only a valid
/// [`thread_segment`].
pub fn scratch_dir_in(project_cache: &Path, session: &str) -> PathBuf {
    project_cache.join(SCRATCH).join(session)
}

/// [`scratch_dir_in`] for an id that must first pass [`thread_segment`], so a
/// separator or a parent-dir component in it can never move the scratch out
/// of `scratch/`.
fn checked_scratch_dir(project_cache: &Path, session: &str) -> Result<PathBuf, String> {
    Ok(scratch_dir_in(project_cache, &thread_segment(session)?))
}

/// A desktop thread's scratch, `<cache>/jan/chat/scratch/<thread>`, checked.
fn thread_scratch_dir(thread_id: &str) -> Result<PathBuf, String> {
    checked_scratch_dir(&project_cache_dir(None), thread_id)
}

/// Create a desktop thread's scratch (idempotent) and return it.
///
/// Always under `<cache>/jan/chat`: a desktop thread has no filesystem
/// project (desktop projects are UI folders), and every command that reaches
/// a thread's scratch (subagent results, the blackboard, monitors, tool
/// calls, thread delete) knows only the thread id, so this is the one place
/// they all agree on. Must exist before a sandbox binds it. Thread deletion
/// owns its teardown.
pub async fn ensure_scratch_dir(thread_id: &str) -> Result<PathBuf, String> {
    ensure_scratch_dir_path(&thread_scratch_dir(thread_id)?).await
}

/// Create a scratch directory at an explicit path, hardening it against a
/// pre-planted symlink: the sandbox must never bind or trust an
/// attacker-selected directory as its sanctioned scratch. Refuses (fail
/// closed) when the target already exists as a symlink or is not a real
/// directory, and applies restrictive 0700 permissions on Unix so no other
/// local user can read the session's scratch files. Missing parents are
/// created one at a time, owner-only too: the cache root may be the temp-dir
/// fallback, where a world-readable `jan/` would list every project's slug.
/// The final component is made with a plain create (never "all") and
/// re-checked, so a parent symlink cannot redirect it unnoticed. On Unix it
/// must also belong to this user: one another user made (a shared temp dir)
/// is theirs to read and swap, whatever its mode.
pub async fn ensure_scratch_dir_path(dir: &Path) -> Result<PathBuf, String> {
    #[cfg(unix)]
    let mine = owned_by_me;
    #[cfg(not(unix))]
    let mine = |_: &std::fs::Metadata| true;
    match tokio::fs::symlink_metadata(dir).await {
        Ok(meta) => {
            if !meta.file_type().is_symlink() && meta.is_dir() && mine(&meta) {
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
                create_private_dirs(parent).await?;
            }
            // A concurrent creator is fine: re-verify the existing node is a
            // real directory.
            if let Err(e) = private_dir_builder().create(dir).await {
                if e.kind() != std::io::ErrorKind::AlreadyExists {
                    return Err(format!("ERROR: {e}"));
                }
            }
            // Re-verify after creation: a concurrent swap could have replaced
            // the freshly made directory with a symlink.
            match tokio::fs::symlink_metadata(dir).await {
                Ok(meta) if !meta.file_type().is_symlink() && meta.is_dir() && mine(&meta) => {}
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

/// Prefix of a scratch's lease file, `scratch/.lease-<session>`, beside the
/// scratch rather than in it: the sandbox can write the scratch but not its
/// parent, so a command cannot remove or lock its own lease. The leading dot
/// keeps it from ever reading as a session id.
const SCRATCH_LEASE_PREFIX: &str = ".lease-";

/// A run's hold on its scratch, which the startup sweep of every Jan process
/// respects: dropping it releases the lock.
#[derive(Debug)]
pub struct ScratchClaim {
    _lease: Option<std::fs::File>,
}

/// The lease file for the scratch at `dir`.
fn lease_path(dir: &Path) -> Option<PathBuf> {
    let name = dir.file_name()?.to_str()?;
    Some(dir.with_file_name(format!("{SCRATCH_LEASE_PREFIX}{name}")))
}

/// Open (creating it owner-only) the lease file at `path`, never through a
/// symlink planted there.
fn open_lease(path: &Path) -> Option<std::fs::File> {
    if std::fs::symlink_metadata(path).is_ok_and(|m| !m.is_file()) {
        return None;
    }
    let mut open = std::fs::OpenOptions::new();
    open.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        open.mode(0o600).custom_flags(nix::fcntl::OFlag::O_NOFOLLOW.bits());
    }
    open.open(path).ok()
}

/// Create the scratch at `dir` ([`ensure_scratch_dir_path`]) and claim it for
/// a run, so no Jan process's startup sweep deletes it while the run is live.
///
/// The keep list a sweep is given names only its own process's sessions, and
/// a scratch's own mtime does not change when files are written in its
/// subfolders, so another CLI/TUI session working for a week would otherwise
/// look abandoned. Two signals, because each covers what the other cannot:
/// - a shared advisory lock on the scratch's lease file (flock/LockFileEx via
///   `fs4`, already used for the memory store), held until the claim drops;
///   the OS releases it when the process dies, so a crashed session leaves
///   nothing that looks live. Shared, so a run's subagents can hold it too.
/// - the scratch's mtime, set to now, so an interactive session idle between
///   turns (no claim held) still reads as recently used for a week.
///
/// The lock is taken before the scratch is made or touched, and the sweep
/// re-reads the mtime after taking it exclusively, so a sweep can never
/// delete a scratch claimed while it was deciding. Both are best effort: a
/// filesystem without locks or times still gets its scratch.
pub async fn claim_scratch_dir(dir: &Path) -> Result<ScratchClaim, String> {
    if let Some(parent) = dir.parent() {
        create_private_dirs(parent).await?;
    }
    // Blocking: waits out a sweep deleting a stale scratch of the same name.
    let lease = match lease_path(dir) {
        Some(path) => tokio::task::spawn_blocking(move || lock_lease_shared(&path))
            .await
            .ok()
            .flatten(),
        None => None,
    };
    ensure_scratch_dir_path(dir).await?;
    touch_dir(dir);
    Ok(ScratchClaim { _lease: lease })
}

/// The lease at `path`, share-locked. A sweep unlinks a lease once it has
/// deleted the scratch, so a claim that waited behind it may hold a lock on a
/// file no longer there; it then retries on the one at the path now.
fn lock_lease_shared(path: &Path) -> Option<std::fs::File> {
    for _ in 0..3 {
        let file = open_lease(path)?;
        fs4::FileExt::lock_shared(&file).ok()?;
        if std::fs::symlink_metadata(path).is_ok() {
            return Some(file);
        }
    }
    None
}

/// The lease at `path`, exclusively locked without waiting, for a sweep about
/// to delete its scratch. `Err` while a live run holds it; `Ok(None)` when it
/// cannot be locked at all (no file, a filesystem without locks), which
/// leaves the mtime as the only signal, as before leases existed.
fn try_lock_lease(path: &Path) -> Result<Option<std::fs::File>, ()> {
    if std::fs::symlink_metadata(path).is_err() {
        return Ok(None);
    }
    let Some(file) = open_lease(path) else {
        return Ok(None);
    };
    match fs4::FileExt::try_lock(&file) {
        Ok(()) => Ok(Some(file)),
        Err(fs4::TryLockError::WouldBlock) => Err(()),
        Err(fs4::TryLockError::Error(_)) => Ok(None),
    }
}

/// Set `dir`'s mtime to now, ignoring failure (see [`claim_scratch_dir`]).
fn touch_dir(dir: &Path) {
    let mut open = std::fs::OpenOptions::new();
    open.read(true);
    // Windows opens a directory only with backup semantics
    // (FILE_FLAG_BACKUP_SEMANTICS), and setting its times needs write access.
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        open.write(true).custom_flags(0x0200_0000);
    }
    if let Ok(file) = open.open(dir) {
        let _ = file.set_modified(std::time::SystemTime::now());
    }
}

/// A builder for directories only their owner may enter (Unix; elsewhere the
/// profile directory's inherited ACL already is).
#[cfg(unix)]
fn private_dir_builder() -> tokio::fs::DirBuilder {
    let mut builder = tokio::fs::DirBuilder::new();
    builder.mode(0o700);
    builder
}

#[cfg(not(unix))]
fn private_dir_builder() -> tokio::fs::DirBuilder {
    tokio::fs::DirBuilder::new()
}

/// Create `dir` and any missing ancestors owner-only, leaving ancestors that
/// already exist (`~/.cache` itself) exactly as they are.
async fn create_private_dirs(dir: &Path) -> Result<(), String> {
    #[cfg(unix)]
    let trusted = |_: &Path, meta: &std::fs::Metadata| {
        use std::os::unix::fs::MetadataExt;
        owned_by_me(meta) || meta.uid() == 0
    };
    #[cfg(not(unix))]
    let trusted = |_: &Path, _: &std::fs::Metadata| true;
    #[cfg(unix)]
    let mine = |_: &Path, meta: &std::fs::Metadata| owned_by_me(meta);
    #[cfg(not(unix))]
    let mine = |_: &Path, _: &std::fs::Metadata| true;
    create_private_dirs_owned(dir, trusted, mine).await
}

/// [`create_private_dirs`] with its ownership tests. In a shared temp dir
/// another user can plant `/tmp/jan-<uid>` (before the walk, or between it
/// and the create) and would then own, and could swap, everything under it.
/// So the nearest ancestor that already exists must belong to a `trusted`
/// owner (this user, or root for `/tmp` and `/home` themselves), and each
/// ancestor this call had to create must be a real directory that is `mine`,
/// including one that turned out to exist already.
async fn create_private_dirs_owned(
    dir: &Path,
    trusted: impl Fn(&Path, &std::fs::Metadata) -> bool,
    mine: impl Fn(&Path, &std::fs::Metadata) -> bool,
) -> Result<(), String> {
    let mut missing = Vec::new();
    for ancestor in dir.ancestors() {
        match tokio::fs::symlink_metadata(ancestor).await {
            Ok(meta) if trusted(ancestor, &meta) => break,
            Ok(_) => {
                return Err(format!(
                    "ERROR: scratch path {:?} belongs to another user",
                    ancestor
                ))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => missing.push(ancestor),
            Err(e) => return Err(format!("ERROR: {e}")),
        }
    }
    for ancestor in missing.into_iter().rev() {
        if let Err(e) = private_dir_builder().create(ancestor).await {
            if e.kind() != std::io::ErrorKind::AlreadyExists {
                return Err(format!("ERROR: {e}"));
            }
        }
        match tokio::fs::symlink_metadata(ancestor).await {
            Ok(meta) if !meta.file_type().is_symlink() && meta.is_dir() && mine(ancestor, &meta) => {}
            _ => {
                return Err(format!(
                    "ERROR: scratch path {:?} is not a real directory",
                    ancestor
                ))
            }
        }
    }
    Ok(())
}

/// `<project cache>/pkg`, the project's package cache.
const PKG: &str = "pkg";

/// `CARGO_HOME` inside the package cache.
pub const PKG_CARGO_HOME: &str = "cargo";

/// A project's package cache, `<cache>/jan/<slug>/pkg`. Only for a project:
/// desktop chat has no network to fill one.
pub fn pkg_dir_in(project_cache: &Path) -> PathBuf {
    project_cache.join(PKG)
}

/// A prepared package cache: the folder a sandboxed command may write and
/// whose subfolders its package-manager env names (`proc::PKG_CACHE_ENV`),
/// plus the cargo config offered in it. `cargo_config` is `None` only for a
/// hand-built cache (tests); [`prepare_pkg_cache_in`] always offers one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PkgCache {
    pub root: PathBuf,
    pub cargo_config: Option<CargoConfig>,
}

/// The cargo config offered read-only at `<CARGO_HOME>/config.toml`: the
/// user's, or an empty one when they have none, so the name is always taken
/// by a read-only file rather than left free for a sandbox to plant.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CargoConfig {
    /// The source: `config.toml`, or legacy `config`, in the host's
    /// `CARGO_HOME`, or an empty file in the project's cache folder (outside
    /// the package cache, so no sandbox can write it). Bubblewrap binds it
    /// read-only over [`Self::copy`] and over [`Self::legacy`].
    pub host: PathBuf,
    /// `<pkg>/cargo/config.toml`. A read-only copy made at session start,
    /// which is what Seatbelt and AppContainer expose (they cannot mount), and
    /// bubblewrap's mount point.
    pub copy: PathBuf,
}

impl CargoConfig {
    /// `<pkg>/cargo/config`, the legacy name cargo prefers over
    /// `config.toml` when both exist, so it must not be writable either.
    pub fn legacy(&self) -> PathBuf {
        self.copy.with_file_name("config")
    }
}

/// The empty stand-in config's name in the project's cache folder.
const EMPTY_CARGO_CONFIG: &str = "cargo-config-empty.toml";

/// The host's cargo config: `config.toml` (or the legacy `config`) in
/// `cargo_home`, the host's `CARGO_HOME` or `~/.cargo`.
fn host_cargo_config(cargo_home: &Path) -> Option<PathBuf> {
    ["config.toml", "config"]
        .iter()
        .map(|name| cargo_home.join(name))
        .find(|path| path.is_file())
}

/// The host's `CARGO_HOME`, honoring an explicit one. `None` without a home.
fn host_cargo_home() -> Option<PathBuf> {
    match std::env::var_os("CARGO_HOME").filter(|v| !v.is_empty()) {
        Some(dir) => Some(PathBuf::from(dir)),
        None => user_home().map(|home| home.join(".cargo")),
    }
}

/// [`prepare_pkg_cache_in`] with the host's own cargo home.
pub async fn prepare_pkg_cache(project_cache: &Path) -> Result<PkgCache, String> {
    prepare_pkg_cache_in(project_cache, host_cargo_home().as_deref()).await
}

/// Create a project's package cache owner-only and symlink-hardened (as
/// [`ensure_scratch_dir_path`] does a scratch), and refresh its cargo config.
///
/// The sandbox's `CARGO_HOME` is `<pkg>/cargo`, never the user's: a sandbox
/// that could write `~/.cargo/registry/src` could tamper with sources a later
/// unsandboxed build compiles. So nothing else of the host's comes in: not
/// `credentials.toml` (a sandboxed command must not publish with the user's
/// token) and not `bin/` (installed tools stay on the host `PATH`). The user's
/// config does (mirrors, registries, `net.offline`), read-only, because cargo
/// config can name programs to run (`build.rustc-wrapper`,
/// `target.<triple>.runner`). It is copied afresh every session so host edits
/// apply; with no host config an empty one takes its place, so a copy left by
/// an earlier session (or written by its sandbox) never outlives the user's.
/// Toolchains are untouched: rustup keeps them in `RUSTUP_HOME`.
pub async fn prepare_pkg_cache_in(
    project_cache: &Path,
    host_cargo_home: Option<&Path>,
) -> Result<PkgCache, String> {
    let root = ensure_scratch_dir_path(&pkg_dir_in(project_cache)).await?;
    let cargo = ensure_scratch_dir_path(&root.join(PKG_CARGO_HOME)).await?;
    let copy = cargo.join("config.toml");
    let refresh_error = |path: &Path, e: std::io::Error| {
        format!("ERROR: cannot refresh {}: {e}", path.display())
    };
    // Cargo reads the legacy name too, so one a sandbox planted would apply.
    // An empty one is what bubblewrap leaves as the mount point it binds the
    // config over; it is kept, since deleting a file another live sandbox
    // has mounted over detaches that mount (Linux 3.18+) and would free the
    // name inside it. Empty, it holds nothing a planter could want.
    let legacy = cargo.join("config");
    let empty_file = |m: &std::fs::Metadata| m.is_file() && m.len() == 0;
    if !tokio::fs::symlink_metadata(&legacy).await.is_ok_and(|m| empty_file(&m)) {
        remove_read_only_file(&legacy).await.map_err(|e| refresh_error(&legacy, e))?;
    }
    let host = match host_cargo_home.and_then(host_cargo_config) {
        Some(host) => host,
        None => {
            let empty = project_cache.join(EMPTY_CARGO_CONFIG);
            write_read_only(&[], &empty).await.map_err(|e| refresh_error(&empty, e))?;
            empty
        }
    };
    let bytes = tokio::fs::read(&host).await.map_err(|e| refresh_error(&host, e))?;
    write_read_only(&bytes, &copy).await.map_err(|e| refresh_error(&copy, e))?;
    Ok(PkgCache { root, cargo_config: Some(CargoConfig { host, copy }) })
}

/// Remove `path` if it is there, whatever it is: the copy is read-only, and a
/// sandbox may have left a directory or symlink in its place. A read-only file
/// goes too: on Unix only the folder's mode matters, and std deletes one on
/// Windows since Rust 1.86.
async fn remove_read_only_file(path: &Path) -> std::io::Result<()> {
    match tokio::fs::symlink_metadata(path).await {
        Ok(meta) if meta.is_dir() => tokio::fs::remove_dir_all(path).await,
        Ok(_) => tokio::fs::remove_file(path).await,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// Write `bytes` to a new read-only file at `path`. The folder is writable by
/// every sandboxed command of the project, so the name may hold a symlink
/// planted after it was cleared: created exclusively and never through a
/// symlink, the open fails instead of truncating whatever file the link
/// names, and the mode is set through the handle, not the name.
fn create_read_only_new(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut open = std::fs::OpenOptions::new();
    open.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        open.mode(0o600).custom_flags(nix::fcntl::OFlag::O_NOFOLLOW.bits());
    }
    let mut file = open.open(path)?;
    file.write_all(bytes)?;
    let mut perms = file.metadata()?.permissions();
    perms.set_readonly(true);
    file.set_permissions(perms)
}

/// Write `bytes` to `dst` and mark it read-only. Through a fresh file and a
/// rename, so a concurrent session never reads a half-written config, and so
/// a symlink planted at `dst` is replaced rather than followed. Skipped when
/// `dst` already is a read-only regular file holding exactly `bytes` (every
/// session but the first after an edit): replacing a file a live sibling
/// sandbox has mounted over detaches that mount inside it (Linux 3.18+).
/// That still happens when the host config changes mid-session; the sibling
/// then sees the new, read-only-moded copy until its next session.
///
/// The read-only mark is the whole protection on AppContainer, which grants
/// by ACE and has no deny: the container holds full access on the package
/// cache, so it could clear the mark or replace the file. Accepted: the copy
/// configures only sandboxed cargo and is rewritten every session. Seatbelt
/// also denies writes to it by rule, and bubblewrap mounts the host file over
/// it read-only.
async fn write_read_only(bytes: &[u8], dst: &Path) -> std::io::Result<()> {
    if let Ok(meta) = tokio::fs::symlink_metadata(dst).await {
        if meta.is_file()
            && meta.permissions().readonly()
            && tokio::fs::read(dst).await.is_ok_and(|have| have == bytes)
        {
            return Ok(());
        }
    }
    // Unique per call: a parent run and its subagents share a process and may
    // prepare the same project's cache at once.
    static COPIES: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let n = COPIES.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = dst.with_extension(format!("tmp-{}-{n}", std::process::id()));
    remove_read_only_file(&tmp).await?;
    let (path, owned) = (tmp.clone(), bytes.to_vec());
    tokio::task::spawn_blocking(move || create_read_only_new(&path, &owned))
        .await
        .map_err(std::io::Error::other)??;
    // Replaced in one step where the OS allows it, so a sibling session's
    // bubblewrap never finds its mount point missing. Windows refuses to
    // rename over a read-only file; there the old copy goes first.
    if tokio::fs::rename(&tmp, dst).await.is_err() {
        remove_read_only_file(dst).await?;
        tokio::fs::rename(&tmp, dst).await?;
    }
    Ok(())
}

/// How long a scratch directory may sit untouched, with no live session
/// claiming it, before the startup sweep treats it as abandoned. A week
/// rather than a day: the live check is only as good as the caller's `keep`
/// list, and another Jan instance's live session is never in it.
const SCRATCH_STALE_AFTER: std::time::Duration = std::time::Duration::from_secs(7 * 24 * 60 * 60);

/// Delete abandoned scratch directories, returning how many were removed.
///
/// Every scratch has an owner that removes it (run end, thread deletion,
/// session end), but a kill -9 or a power loss leaves one behind with nobody
/// left to claim it, and unlike a temp dir the OS cache dir is never cleaned
/// for us. Scans every `<cache>/jan/*/scratch/`: an entry goes when its id is
/// not in `keep` (the caller's live sessions: the desktop's surviving thread
/// ids, a CLI run's own session) and it was last modified
/// [`SCRATCH_STALE_AFTER`] ago. Trash goes once it is [`TRASH_KEPT_FOR`] old.
///
/// Also collects the `jan-agent-*` scratches and `jan-trash-*` trash older
/// versions left in the system temp dir: nothing else would ever remove them
/// from a temp dir the OS does not clean (Windows, a persistent `/tmp`).
/// Failures are silent per entry: another user's `jan-agent-*` in a shared
/// `/tmp` is not ours to delete and simply fails the unlink.
pub async fn sweep_stale_scratch_dirs(keep: &[String]) -> usize {
    sweep_stale_scratch_dirs_in(&jan_cache_root(), keep).await
}

/// [`sweep_stale_scratch_dirs`] under an explicit Jan cache root, for callers
/// that resolve the root themselves (the app substitutes a temp root in its
/// tests).
pub async fn sweep_stale_scratch_dirs_in(cache_root: &Path, keep: &[String]) -> usize {
    sweep_scratch_in(cache_root, keep, SCRATCH_STALE_AFTER).await
        + sweep_legacy_scratch_in(&std::env::temp_dir(), SCRATCH_STALE_AFTER).await
}

/// [`sweep_stale_scratch_dirs`] over an explicit cache root, so tests never
/// collect another session's scratch.
async fn sweep_scratch_in(cache_root: &Path, keep: &[String], max_age: std::time::Duration) -> usize {
    let keep: std::collections::HashSet<&str> = keep.iter().map(String::as_str).collect();
    let Ok(mut projects) = tokio::fs::read_dir(cache_root).await else {
        return 0;
    };
    let mut removed = 0;
    while let Ok(Some(project)) = projects.next_entry().await {
        // `symlink_metadata` throughout: a symlink planted where a folder is
        // expected must not lead the sweep into deleting what it points at.
        let scratch = project.path().join(SCRATCH);
        match tokio::fs::symlink_metadata(&scratch).await {
            Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => {}
            _ => continue,
        }
        let Ok(mut entries) = tokio::fs::read_dir(&scratch).await else {
            continue;
        };
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if let Some(session) = name.strip_prefix(SCRATCH_LEASE_PREFIX) {
                remove_orphan_lease(&entry.path(), &scratch.join(session));
                continue;
            }
            let trash = name.starts_with(SCRATCH_TRASH_PREFIX);
            // Only names this module makes: anything else was not made here.
            if !trash && (keep.contains(name) || thread_segment(name).is_err()) {
                continue;
            }
            if trash {
                if remove_if_stale(&entry.path(), name, true, max_age).await {
                    removed += 1;
                }
                continue;
            }
            // Held exclusively across the age check and the delete, so a run
            // claiming this scratch meanwhile waits rather than losing it.
            let Some(lease) = lease_path(&entry.path()) else { continue };
            let Ok(lock) = try_lock_lease(&lease) else {
                continue; // a live run, in some Jan process, holds it
            };
            if remove_if_stale(&entry.path(), name, false, max_age).await {
                removed += 1;
                if lock.is_some() {
                    let _ = std::fs::remove_file(&lease);
                }
            }
        }
    }
    removed
}

/// Remove the lease at `lease` once its scratch is gone (trashed at session
/// end, or deleted by hand) and no run holds it.
fn remove_orphan_lease(lease: &Path, scratch: &Path) {
    if std::fs::symlink_metadata(scratch).is_ok() {
        return;
    }
    match std::fs::symlink_metadata(lease) {
        // Not something `open_lease` would make: unlink it, never follow it.
        Ok(meta) if !meta.is_file() => {
            if meta.file_type().is_symlink() {
                let _ = std::fs::remove_file(lease);
            }
        }
        Ok(_) => {
            if let Ok(Some(_lock)) = try_lock_lease(lease) {
                let _ = std::fs::remove_file(lease);
            }
        }
        Err(_) => {}
    }
}

/// The legacy layout: `jan-agent-<session>` and `jan-trash-*` directly in the
/// system temp dir. Age is the only signal there, as it always was.
async fn sweep_legacy_scratch_in(root: &Path, max_age: std::time::Duration) -> usize {
    let Ok(mut entries) = tokio::fs::read_dir(root).await else {
        return 0;
    };
    let mut removed = 0;
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let trash = name.starts_with(LEGACY_TRASH_PREFIX);
        if !name.starts_with(LEGACY_SCRATCH_PREFIX) && !trash {
            continue;
        }
        if remove_if_stale(&entry.path(), name, trash, max_age).await {
            removed += 1;
        }
    }
    removed
}

/// Delete the scratch or trash entry at `path` when it is stale, returning
/// whether it went. A symlink named like trash is unlinked (never followed);
/// one named like a scratch is not ours and is left alone.
async fn remove_if_stale(path: &Path, name: &str, trash: bool, max_age: std::time::Duration) -> bool {
    let Ok(meta) = tokio::fs::symlink_metadata(path).await else {
        return false;
    };
    if trash && meta.file_type().is_symlink() {
        let _ = tokio::fs::remove_file(path).await;
        return false;
    }
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return false;
    }
    // A trashed scratch is never in use (the rename that made it is atomic),
    // but it holds the session's subagent results, kept a while in case the
    // user wants one back.
    let stale = if trash {
        trash_expired(name, &meta)
    } else {
        meta.modified()
            .ok()
            .and_then(|m| m.elapsed().ok())
            .is_some_and(|age| age >= max_age)
    };
    stale && tokio::fs::remove_dir_all(path).await.is_ok()
}

/// Prefix of a scratch moved aside for deletion, next to the live ones in
/// `scratch/`. It starts with a dot, which [`thread_segment`] never accepts,
/// so no session id can ever be mistaken for trash and swept at any age.
const SCRATCH_TRASH_PREFIX: &str = ".trash-";

/// What older versions named a scratch and its trash in the system temp dir.
const LEGACY_SCRATCH_PREFIX: &str = "jan-agent-";
const LEGACY_TRASH_PREFIX: &str = "jan-trash-";

/// How long Jan's trash (a removed scratch, a subagent worktree that read as
/// empty) is kept before a startup sweep deletes it: long enough for a user
/// to notice something they wanted went with it.
pub const TRASH_KEPT_FOR: std::time::Duration = std::time::Duration::from_secs(7 * 24 * 60 * 60);

/// The name under which `stem` goes to trash: `<stem>-<nanoseconds since the
/// epoch>`. The time is in the name because a rename keeps the mtime of what
/// it moves, which says when it was last written, not trashed.
pub fn trash_name(stem: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    format!("{stem}-{nanos}")
}

/// Whether the trash entry `name` (made by [`trash_name`]) is at least
/// [`TRASH_KEPT_FOR`] old. One whose name carries no time goes by `meta`'s
/// mtime instead. A shorter number is not a time [`trash_name`] wrote (it
/// may be a hex suffix that happens to be all digits), and must not read as
/// one from 1970.
pub fn trash_expired(name: &str, meta: &std::fs::Metadata) -> bool {
    let stamp = name
        .rsplit_once('-')
        .filter(|(_, n)| n.len() >= 19)
        .and_then(|(_, n)| n.parse::<u64>().ok())
        .map(|n| std::time::UNIX_EPOCH + std::time::Duration::from_nanos(n));
    stamp
        .or_else(|| meta.modified().ok())
        .and_then(|at| at.elapsed().ok())
        .is_some_and(|age| age >= TRASH_KEPT_FOR)
}

/// Delete a desktop thread's scratch now. Idempotent: a missing scratch is
/// Ok. For an explicit delete (a thread or session the user removed): its
/// results and caches must not outlive it in the trash.
pub async fn remove_scratch_dir(thread_id: &str) -> Result<(), String> {
    let dir = thread_scratch_dir(thread_id)?;
    match tokio::fs::remove_dir_all(&dir).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("ERROR: {e}")),
    }
}

/// Move a finished CLI/TUI session's scratch, under the project cache folder
/// `project_cache` ([`project_cache_dir_in`]), into trash. For the exit path
/// only. Idempotent: a missing scratch is Ok.
///
/// Read-only subagents keep package caches there, so deleting it can walk
/// tens of thousands of files while the user waits to exit. A rename is
/// instant, and a startup sweep empties the trash once it is old.
pub async fn trash_scratch_dir_in(project_cache: &Path, session: &str) -> Result<(), String> {
    trash_dir(&checked_scratch_dir(project_cache, session)?, session).await
}

/// Move `dir` into trash beside it, in its own `scratch/` folder: the same
/// filesystem, so the rename is atomic and instant, and the folder the sweep
/// already scans. Deleted in place when the rename fails (a handle still open
/// on Windows). A missing `dir` is Ok.
async fn trash_dir(dir: &Path, stem: &str) -> Result<(), String> {
    let Some(parent) = dir.parent() else {
        return Err(format!("ERROR: scratch path {dir:?} has no parent"));
    };
    let trash = parent.join(trash_name(&format!(
        "{SCRATCH_TRASH_PREFIX}{stem}-{}",
        std::process::id()
    )));
    if tokio::fs::rename(dir, &trash).await.is_ok() {
        return Ok(());
    }
    match tokio::fs::remove_dir_all(dir).await {
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
    // Wipe the cache scratch keyed to the same id.
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
        // Only names a valid id could have produced: anything else was not made
        // here, so it is left alone rather than swept.
        if keep.contains(&name) || thread_segment(&name).is_err() {
            continue;
        }
        crate::tools::appcontainer::release(&entry.path());
        if tokio::fs::remove_dir_all(entry.path()).await.is_ok() {
            removed += 1;
            // Wipe the cache scratch keyed to this id.
            let _ = remove_scratch_dir(&name).await;
        }
    }
    Ok(removed)
}

/// Names Windows maps to a device in every directory, in any case and also
/// with an extension (`nul.txt`). Checked on every OS so an id accepted on one
/// works on all of them.
pub(crate) fn is_windows_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    match stem.as_bytes() {
        [a, b, c] => matches!(&[*a, *b, *c], b"CON" | b"PRN" | b"AUX" | b"NUL"),
        [a, b, c, d] => matches!(&[*a, *b, *c], b"COM" | b"LPT") && d.is_ascii_digit(),
        _ => false,
    }
}

/// Sanitize a caller-supplied thread id into one safe path segment.
///
/// Stricter than [`workspace_filename`] on purpose: a thread id is generated,
/// never typed, so anything outside `[A-Za-z0-9_-]` is a bug. No dots and no
/// trimming, so `.`/`..` can never be produced. Kept identical to the desktop's
/// `validate_thread_id` (`src-tauri/src/core/threads/utils.rs`): an id one side
/// accepts the other must too.
pub fn thread_segment(thread_id: &str) -> Result<String, String> {
    let id = thread_id;
    let ok = !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
        && !is_windows_device_name(id);
    if !ok {
        return Err(format!("ERROR: invalid thread id '{thread_id}'"));
    }
    Ok(id.to_string())
}

/// Sanitize a caller-supplied entry name into a safe `<stem>.md` filename.
/// Rejects path separators and `..` so the result can never escape the
/// store directory, NUL and Windows device names on every OS, and on Windows a
/// `:` (`C:x` is drive-relative and replaces the base it is joined to, `a:b`
/// names a data stream). `.md` is appended if absent.
pub fn workspace_filename(name: &str) -> Result<String, String> {
    workspace_filename_on(name, cfg!(windows))
}

/// [`workspace_filename`] with the Windows-only `:` rule as a flag, so both
/// platforms' behaviour can be tested on any host.
fn workspace_filename_on(name: &str, reject_colon: bool) -> Result<String, String> {
    let trimmed = name.trim();
    let stem = trimmed.strip_suffix(".md").unwrap_or(trimmed);
    // Checked on the stem, not the input: otherwise a bare "." passes and the
    // guard emits "..md", a name it would itself reject as input.
    if stem.is_empty()
        || stem.contains('/')
        || stem.contains('\\')
        || stem.contains("..")
        || stem.contains('\0')
        || (reject_colon && stem.contains(':'))
        || stem.chars().all(|c| c == '.')
        || is_windows_device_name(stem)
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

    /// A project's store lives under the Jan home, never inside the project.
    #[test]
    fn project_store_is_under_jan_home_projects() {
        let home = Path::new("/home/u/.jan");
        let store = project_store_in(home, Path::new("/nonexistent/src/jan"));
        assert_eq!(store, Path::new("/home/u/.jan/projects/jan-f1654549"));
        assert!(!project_store(Path::new("/p")).starts_with("/p"));
    }

    /// The slug is persisted as a directory name, so it is a wire value: pin it
    /// rather than letting a refactor quietly orphan every existing store.
    #[test]
    fn the_slug_hash_is_pinned() {
        assert_eq!(path_slug(Path::new("/home/u/src/jan")), "jan-582afba2");
    }

    /// A session in a linked worktree must share its main checkout's store.
    #[test]
    fn a_linked_worktree_keys_on_its_main_checkout() {
        let base = unique_data_folder();
        let main = base.join("main");
        std::fs::create_dir_all(main.join(".git").join("worktrees").join("w1")).unwrap();
        std::fs::create_dir_all(main.join("sub")).unwrap();
        let wt = base.join("wt");
        std::fs::create_dir_all(wt.join("sub")).unwrap();
        let gitdir = main.canonicalize().unwrap().join(".git/worktrees/w1");
        std::fs::write(wt.join(".git"), format!("gitdir: {}\n", gitdir.display())).unwrap();

        let main_key = project_key(&main);
        assert_eq!(project_key(&wt), main_key);
        assert_eq!(project_key(&wt.join("sub")), project_key(&main.join("sub")));
        assert_ne!(project_key(&main.join("sub")), main_key);
        let _ = std::fs::remove_dir_all(&base);
    }

    /// A Jan subagent checkout (`git clone --shared` under the Jan home's
    /// `worktrees/`) shares its main checkout's store too; the same clone made
    /// anywhere else is a project of its own.
    #[test]
    fn a_shared_clone_under_the_jan_worktrees_keys_on_its_main_checkout() {
        let main = unique_data_folder().join("main");
        std::fs::create_dir_all(main.join(".git/objects")).unwrap();
        let worktrees = jan_home().unwrap().join("worktrees");
        // Unique ids: the Jan home is shared by every test in this process.
        let id = unique_data_folder().file_name().unwrap().to_owned();
        let slug_dir = worktrees.join(path_slug(&main.canonicalize().unwrap()));
        let clone = slug_dir.join(&id);
        // A writer that rewrote its alternates to name a project other than
        // the one its slug directory belongs to.
        let forged = worktrees.join("other-0").join(&id);
        let elsewhere = unique_data_folder().join("clone");
        for dir in [&clone, &forged, &elsewhere] {
            std::fs::create_dir_all(dir.join(".git/objects/info")).unwrap();
            std::fs::write(
                dir.join(".git/objects/info/alternates"),
                format!("{}\n", main.join(".git/objects").display()),
            )
            .unwrap();
            std::fs::create_dir_all(dir.join("sub")).unwrap();
        }
        let main = main.canonicalize().unwrap();
        // The store slug hashes the path's text, which `Path` equality does not
        // compare: a trailing slash or another spelling of `main` would pass
        // `==` and still land in a different, empty store.
        assert_eq!(project_key(&clone).as_os_str(), main.as_os_str());
        assert_eq!(path_slug(&project_key(&clone)), path_slug(&main));
        assert_eq!(
            project_key(&clone.join("sub")).as_os_str(),
            main.join("sub").as_os_str()
        );
        assert_eq!(project_key(&elsewhere), elsewhere.canonicalize().unwrap());
        assert_eq!(project_key(&forged), forged.canonicalize().unwrap());
        let _ = std::fs::remove_dir_all(&slug_dir);
        let _ = std::fs::remove_dir_all(forged.parent().unwrap());
        let _ = std::fs::remove_dir_all(elsewhere.parent().unwrap());
        let _ = std::fs::remove_dir_all(main.parent().unwrap());
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

    /// The cache layout: one folder per project under the Jan cache root,
    /// named with the very slug the project's store uses, so `~/.jan/projects/<slug>`
    /// and `<cache>/jan/<slug>` always name one project the same way.
    #[test]
    fn a_project_cache_uses_the_store_slug() {
        let home = Path::new("/home/u/.jan");
        let cache = Path::new("/home/u/.cache/jan");
        let project = unique_data_folder();
        std::fs::create_dir_all(&project).unwrap();
        let dir = project_cache_dir_in(cache, Some(&project));
        let store = project_store_in(home, &project);
        assert_eq!(dir.parent(), Some(cache));
        assert_eq!(dir.file_name(), store.file_name());
        assert_eq!(
            scratch_dir_in(&dir, "s1"),
            cache.join(store.file_name().unwrap()).join("scratch/s1")
        );
        let _ = std::fs::remove_dir_all(&project);
    }

    /// A linked worktree of a project shares its cache folder, as it shares
    /// its store.
    #[test]
    fn a_linked_worktree_shares_its_main_checkouts_cache() {
        let base = unique_data_folder();
        let main = base.join("main");
        std::fs::create_dir_all(main.join(".git/worktrees/w1")).unwrap();
        let wt = base.join("wt");
        std::fs::create_dir_all(&wt).unwrap();
        let gitdir = main.canonicalize().unwrap().join(".git/worktrees/w1");
        std::fs::write(wt.join(".git"), format!("gitdir: {}\n", gitdir.display())).unwrap();
        let cache = Path::new("/c/jan");
        assert_eq!(
            project_cache_dir_in(cache, Some(&wt)),
            project_cache_dir_in(cache, Some(&main))
        );
        let _ = std::fs::remove_dir_all(&base);
    }

    /// No filesystem project (a desktop thread): the fixed `chat` sibling.
    #[test]
    fn a_session_with_no_project_uses_the_chat_folder() {
        let cache = Path::new("/c/jan");
        assert_eq!(project_cache_dir_in(cache, None), Path::new("/c/jan/chat"));
        assert_eq!(
            scratch_dir_in(&project_cache_dir_in(cache, None), "t1"),
            Path::new("/c/jan/chat/scratch/t1")
        );
        // The real helpers agree with the explicit-root ones.
        assert_eq!(project_cache_dir(None), jan_cache_root().join("chat"));
        assert_eq!(
            thread_scratch_dir("t1").unwrap(),
            jan_cache_root().join("chat/scratch/t1")
        );
    }

    /// A desktop thread's scratch is created, keyed by its id under `chat/`,
    /// and removed with it.
    #[tokio::test]
    async fn scratch_dir_lifecycle_is_session_keyed_and_removable() {
        let session = format!("t1-{}", std::process::id());
        let scratch = thread_scratch_dir(&session).unwrap();
        assert!(!scratch.exists());

        let created = ensure_scratch_dir(&session).await.unwrap();
        assert_eq!(created, scratch);
        assert!(scratch.is_dir());
        assert!(scratch.starts_with(jan_cache_root().join("chat").join("scratch")));

        std::fs::write(scratch.join("f"), b"x").unwrap();
        remove_scratch_dir(&session).await.unwrap();
        assert!(!scratch.exists());
        // Idempotent.
        remove_scratch_dir(&session).await.unwrap();
    }

    /// Backdate `path`'s mtime by `age`, so the real 7-day threshold can be
    /// exercised without waiting a week.
    fn age_by(path: &Path, age: std::time::Duration) {
        let when = std::time::SystemTime::now() - age;
        let mut open = std::fs::OpenOptions::new();
        open.read(true);
        // Windows opens a directory only with backup semantics, and setting
        // its times needs write access.
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            open.write(true).custom_flags(0x0200_0000);
        }
        open.open(path).unwrap().set_modified(when).unwrap();
    }

    const EIGHT_DAYS: std::time::Duration = std::time::Duration::from_secs(8 * 24 * 60 * 60);

    /// A scratch whose owner died (kill -9, power loss) is collected at the
    /// next start once it is a week old and no live session claims it, in
    /// every project's folder. A live one (in `keep`) and a fresh one stay,
    /// whatever their age; anything not named like a scratch is left alone.
    #[tokio::test]
    async fn the_startup_sweep_removes_only_stale_scratch_no_session_claims() {
        let cache = tmp_root("scratch_sweep");
        let a = project_cache_dir_in(&cache, None);
        let b = cache.join("proj-1234abcd");
        let crashed = scratch_dir_in(&a, "crashed");
        let live = scratch_dir_in(&a, "live");
        let fresh = scratch_dir_in(&b, "fresh");
        let other_crashed = scratch_dir_in(&b, "gone");
        for dir in [&crashed, &live, &fresh, &other_crashed] {
            ensure_scratch_dir_path(dir).await.unwrap();
            std::fs::write(dir.join("spill.txt"), b"x").unwrap();
        }
        let bystander = a.join("scratch").join("not.a.scratch");
        std::fs::create_dir_all(&bystander).unwrap();
        for dir in [&crashed, &live, &other_crashed, &bystander] {
            age_by(dir, EIGHT_DAYS);
        }

        let keep = vec!["live".to_string()];
        assert_eq!(sweep_scratch_in(&cache, &keep, SCRATCH_STALE_AFTER).await, 2);
        assert!(!crashed.exists() && !other_crashed.exists(), "stale scratch goes");
        assert!(live.join("spill.txt").is_file(), "a live session's scratch stays");
        assert!(fresh.join("spill.txt").is_file(), "a fresh scratch stays");
        assert!(bystander.is_dir(), "swept a directory that is not a scratch");
        let _ = std::fs::remove_dir_all(&cache);
    }

    /// With no OS cache dir the cache root falls back to the shared temp dir,
    /// so it is named per user, and a name already taken by something that is
    /// not this user's own directory (planted by another local user, or a
    /// symlink) is passed over rather than trusted.
    #[cfg(unix)]
    #[test]
    fn the_temp_fallback_is_per_user_and_skips_what_is_not_ours() {
        let temp = tmp_root("temp_fallback");
        std::fs::create_dir_all(&temp).unwrap();
        let uid = nix::unistd::getuid();
        let first = temp_cache_root_in(&temp);
        assert_eq!(first, temp.join(format!("jan-{uid}")));
        // Ours already: reused.
        std::fs::create_dir(&first).unwrap();
        assert_eq!(temp_cache_root_in(&temp), first);
        // Not a directory of ours: skipped.
        std::fs::remove_dir(&first).unwrap();
        std::os::unix::fs::symlink(&temp, &first).unwrap();
        let next = temp_cache_root_in(&temp);
        assert_ne!(next, first);
        assert!(next.file_name().unwrap().to_string_lossy().starts_with(&format!("jan-{uid}-")));
        let _ = std::fs::remove_dir_all(&temp);
    }

    /// Another live session's scratch (another CLI/TUI process, so not in this
    /// one's `keep`) survives the sweep while its run holds a claim, however
    /// old its mtime; once released it goes, lease file and all.
    #[tokio::test]
    async fn a_claimed_scratch_survives_the_sweep() {
        let cache = tmp_root("scratch_sweep_claim");
        let scratch = scratch_dir_in(&project_cache_dir_in(&cache, None), "other-live");
        ensure_scratch_dir_path(&scratch).await.unwrap();
        let claim = claim_scratch_dir(&scratch).await.unwrap();
        // A run that has gone on for over a week, writing only in subfolders.
        age_by(&scratch, EIGHT_DAYS);
        assert_eq!(sweep_scratch_in(&cache, &[], SCRATCH_STALE_AFTER).await, 0);
        assert!(scratch.is_dir(), "a claimed scratch must survive");
        drop(claim);
        assert_eq!(sweep_scratch_in(&cache, &[], SCRATCH_STALE_AFTER).await, 1);
        assert!(!scratch.exists());
        let leftovers: Vec<_> = std::fs::read_dir(scratch.parent().unwrap())
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .collect();
        assert!(leftovers.is_empty(), "the lease goes with its scratch: {leftovers:?}");
        let _ = std::fs::remove_dir_all(&cache);
    }

    /// Claiming a scratch at the start of each turn marks it fresh, so an
    /// interactive session idle between turns is not swept for a week after
    /// its last one; a lease left by a scratch that is gone is collected.
    #[tokio::test]
    async fn claiming_a_scratch_marks_it_fresh() {
        let cache = tmp_root("scratch_sweep_touch");
        let project = project_cache_dir_in(&cache, None);
        let scratch = scratch_dir_in(&project, "idle");
        ensure_scratch_dir_path(&scratch).await.unwrap();
        age_by(&scratch, EIGHT_DAYS);
        drop(claim_scratch_dir(&scratch).await.unwrap());
        assert_eq!(sweep_scratch_in(&cache, &[], SCRATCH_STALE_AFTER).await, 0);
        assert!(scratch.is_dir(), "a scratch claimed just now is fresh");

        let gone = scratch_dir_in(&project, "gone");
        ensure_scratch_dir_path(&gone).await.unwrap();
        drop(claim_scratch_dir(&gone).await.unwrap());
        std::fs::remove_dir_all(&gone).unwrap();
        sweep_scratch_in(&cache, &[], SCRATCH_STALE_AFTER).await;
        let names: Vec<String> = std::fs::read_dir(project.join(SCRATCH))
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(names.iter().all(|n| !n.contains("gone")), "{names:?}");
        let _ = std::fs::remove_dir_all(&cache);
    }

    /// The sweep must not follow a symlink planted where a project's
    /// `scratch/` folder or a scratch would be.
    #[cfg(unix)]
    #[tokio::test]
    async fn the_startup_sweep_never_follows_a_symlink() {
        let cache = tmp_root("scratch_sweep_link");
        let victim = tmp_root("scratch_sweep_victim");
        std::fs::create_dir_all(victim.join("old")).unwrap();
        age_by(&victim.join("old"), EIGHT_DAYS);
        std::fs::create_dir_all(cache.join("p-1")).unwrap();
        std::os::unix::fs::symlink(&victim, cache.join("p-1").join("scratch")).unwrap();
        let scratch = cache.join("p-2").join("scratch");
        std::fs::create_dir_all(&scratch).unwrap();
        std::os::unix::fs::symlink(victim.join("old"), scratch.join("linked")).unwrap();
        assert_eq!(sweep_scratch_in(&cache, &[], std::time::Duration::ZERO).await, 0);
        assert!(victim.join("old").is_dir());
        let _ = std::fs::remove_dir_all(&cache);
        let _ = std::fs::remove_dir_all(&victim);
    }

    /// Older versions kept the scratch in the system temp dir; those are still
    /// collected by age so an upgrade does not leak them.
    #[tokio::test]
    async fn legacy_temp_scratch_is_still_swept() {
        let root = tmp_root("legacy_sweep");
        let orphan = root.join("jan-agent-orphan");
        let recent = root.join("jan-agent-recent");
        for dir in [&orphan, &recent] {
            ensure_scratch_dir_path(dir).await.unwrap();
        }
        age_by(&orphan, EIGHT_DAYS);
        let old_trash = root.join("jan-trash-old-1-1000000000000000000");
        std::fs::create_dir_all(&old_trash).unwrap();
        let bystander = root.join("not-a-scratch");
        std::fs::create_dir_all(&bystander).unwrap();
        age_by(&bystander, EIGHT_DAYS);
        assert_eq!(sweep_legacy_scratch_in(&root, SCRATCH_STALE_AFTER).await, 2);
        assert!(!orphan.exists() && !old_trash.exists());
        assert!(recent.is_dir() && bystander.is_dir());
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Exit must not wait for a scratch full of package caches to be deleted:
    /// it is moved aside, whole, beside where it was (same `scratch/` folder,
    /// so the same filesystem).
    #[tokio::test]
    async fn trashing_a_scratch_moves_it_beside_itself() {
        let cache = tmp_root("scratch_trash");
        let scratch = scratch_dir_in(&cache.join("p-1"), "s1");
        ensure_scratch_dir_path(&scratch).await.unwrap();
        std::fs::write(scratch.join("cache.bin"), b"x").unwrap();
        trash_dir(&scratch, "s1").await.unwrap();
        assert!(!scratch.exists());
        let trashed: Vec<PathBuf> = std::fs::read_dir(scratch.parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        assert_eq!(trashed.len(), 1, "{trashed:?}");
        let name = trashed[0].file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.starts_with(SCRATCH_TRASH_PREFIX), "{name}");
        assert!(thread_segment(&name).is_err(), "trash can never pass for a session id");
        assert!(trashed[0].join("cache.bin").is_file());
        // Idempotent: a scratch already gone is Ok.
        trash_dir(&scratch, "s1").await.unwrap();
        let _ = std::fs::remove_dir_all(&cache);
    }

    /// The real exit path: a CLI session's scratch under its project's folder
    /// goes to trash there.
    #[tokio::test]
    async fn a_cli_session_scratch_is_trashed_in_its_project_folder() {
        let project = unique_data_folder();
        std::fs::create_dir_all(&project).unwrap();
        let session = format!("cli-exit-{}", std::process::id());
        let cache = project_cache_dir(Some(&project));
        let scratch = ensure_scratch_dir_path(&scratch_dir_in(&cache, &session))
            .await
            .unwrap();
        trash_scratch_dir_in(&cache, &session).await.unwrap();
        assert!(!scratch.exists());
        let parent = scratch.parent().unwrap();
        assert_eq!(std::fs::read_dir(parent).unwrap().count(), 1);
        let _ = std::fs::remove_dir_all(&cache);
        let _ = std::fs::remove_dir_all(&project);
    }

    /// A trashed scratch is kept a week (it holds the session's subagent
    /// results), then the startup sweep empties it; a fresh live scratch and
    /// a bystander stay, and a symlink named like trash is unlinked without
    /// following it.
    #[tokio::test]
    async fn trash_is_kept_a_week_then_emptied_by_the_startup_sweep() {
        let cache = tmp_root("scratch_trash_sweep");
        let project = cache.join("p-1");
        let live = scratch_dir_in(&project, "live");
        ensure_scratch_dir_path(&live).await.unwrap();
        let ended = scratch_dir_in(&project, "ended");
        ensure_scratch_dir_path(&ended).await.unwrap();
        trash_dir(&ended, "ended").await.unwrap();
        let root = project.join("scratch");
        let trash = root.join(format!("{SCRATCH_TRASH_PREFIX}old-1-1000000000000000000"));
        std::fs::create_dir_all(trash.join("deep")).unwrap();
        std::fs::write(trash.join("deep/f"), b"x").unwrap();
        let bystander = cache.join("not-a-scratch");
        std::fs::create_dir_all(&bystander).unwrap();
        std::fs::write(bystander.join("keep"), b"x").unwrap();
        let link = root.join(format!("{SCRATCH_TRASH_PREFIX}link"));
        #[cfg(unix)]
        std::os::unix::fs::symlink(&bystander, &link).unwrap();

        assert_eq!(sweep_scratch_in(&cache, &[], SCRATCH_STALE_AFTER).await, 1);
        assert!(!trash.exists(), "week-old trash goes");
        let fresh = std::fs::read_dir(&root)
            .unwrap()
            .filter(|e| {
                let name = e.as_ref().unwrap().file_name();
                name.to_string_lossy().starts_with(&format!("{SCRATCH_TRASH_PREFIX}ended-"))
            })
            .count();
        assert_eq!(fresh, 1, "fresh trash is kept");
        assert!(live.is_dir(), "a fresh scratch is live");
        assert!(bystander.join("keep").is_file(), "nothing outside trash is touched");
        #[cfg(unix)]
        assert!(std::fs::symlink_metadata(&link).is_err());
        let _ = std::fs::remove_dir_all(&cache);
    }

    /// A session scratch as subagents leave it: session files under
    /// `subagents/` and results on `blackboard/`.
    fn seed_subagent_files(scratch: &Path) -> [PathBuf; 2] {
        let session = scratch.join("subagents").join("explore-session.jsonl");
        let result = scratch.join("blackboard").join("explore.md");
        for file in [&session, &result] {
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, b"x").unwrap();
        }
        [session, result]
    }

    /// Session exit: a subagent's session file and its blackboard entry go
    /// with the scratch.
    #[tokio::test]
    async fn subagent_files_go_with_the_scratch_on_session_exit() {
        let session = format!("sub-exit-{}", std::process::id());
        let scratch = ensure_scratch_dir(&session).await.unwrap();
        let files = seed_subagent_files(&scratch);
        trash_scratch_dir_in(&project_cache_dir(None), &session).await.unwrap();
        assert!(files.iter().all(|f| !f.exists()) && !scratch.exists());
    }

    /// Thread delete: removing the thread's sandbox wipes the scratch keyed
    /// to the same id, subagent files included.
    #[tokio::test]
    async fn subagent_files_go_with_the_scratch_on_thread_delete() {
        let data = unique_data_folder();
        let thread = format!("sub-delete-{}", std::process::id());
        ensure_thread_workspace(&data, &thread).await.unwrap();
        let scratch = ensure_scratch_dir(&thread).await.unwrap();
        let files = seed_subagent_files(&scratch);
        remove_thread_workspace(&data, &thread).await.unwrap();
        assert!(files.iter().all(|f| !f.exists()) && !scratch.exists());
        let _ = std::fs::remove_dir_all(&data);
    }

    /// An explicit delete is a delete: the thread's scratch is not parked in
    /// the trash for a week, where its results and caches would outlive it.
    #[tokio::test]
    async fn thread_delete_leaves_no_scratch_in_the_trash() {
        let data = unique_data_folder();
        let thread = format!("no-trash-delete-{}", std::process::id());
        ensure_thread_workspace(&data, &thread).await.unwrap();
        let scratch = ensure_scratch_dir(&thread).await.unwrap();
        std::fs::write(scratch.join("f"), b"x").unwrap();
        remove_thread_workspace(&data, &thread).await.unwrap();
        let trashed = format!("{SCRATCH_TRASH_PREFIX}{thread}-");
        let left: Vec<_> = std::fs::read_dir(scratch.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().starts_with(&trashed))
            .collect();
        assert!(left.is_empty(), "{left:?}");
        let _ = std::fs::remove_dir_all(&data);
    }

    /// Crash: a scratch nobody removed is collected by the stale sweep with its
    /// subagent files, and a fresh one keeps them.
    #[tokio::test]
    async fn subagent_files_in_an_abandoned_scratch_are_swept() {
        let cache = tmp_root("subagent_sweep");
        let orphan = scratch_dir_in(&cache.join("chat"), "crashed");
        ensure_scratch_dir_path(&orphan).await.unwrap();
        let files = seed_subagent_files(&orphan);
        assert_eq!(sweep_scratch_in(&cache, &[], SCRATCH_STALE_AFTER).await, 0);
        assert!(files.iter().all(|f| f.exists()), "a fresh scratch keeps its files");
        age_by(&orphan, EIGHT_DAYS);
        assert_eq!(sweep_scratch_in(&cache, &[], SCRATCH_STALE_AFTER).await, 1);
        assert!(files.iter().all(|f| !f.exists()) && !orphan.exists());
        let _ = std::fs::remove_dir_all(&cache);
    }

    /// The scratch root must never be a pre-planted symlink to another
    /// directory: the sandbox binds it writable at its own path, so trusting a
    /// redirect would sanction an attacker-selected directory as the scratch.
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

    /// A freshly created scratch root is a real, restrictive directory, and
    /// the parents Jan had to create for it (`jan/<slug>/scratch`) are
    /// owner-only too; a parent that already existed keeps its mode.
    #[cfg(unix)]
    #[tokio::test]
    async fn scratch_root_creation_is_a_real_private_dir() {
        use std::os::unix::fs::PermissionsExt;
        let base = unique_data_folder();
        std::fs::create_dir_all(&base).unwrap();
        std::fs::set_permissions(&base, std::fs::Permissions::from_mode(0o755)).unwrap();
        let dir = scratch_dir_in(&base.join("jan").join("p-1"), "s1");
        let r = ensure_scratch_dir_path(&dir).await;
        assert_eq!(r.unwrap(), dir);
        let meta = std::fs::symlink_metadata(&dir).unwrap();
        assert!(!meta.file_type().is_symlink());
        assert!(meta.is_dir());
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        for created in [dir.as_path(), dir.parent().unwrap(), &base.join("jan/p-1"), &base.join("jan")] {
            assert_eq!(mode(created), 0o700, "{created:?}");
        }
        assert_eq!(mode(&base), 0o755, "an existing parent is left alone");
        let _ = std::fs::remove_dir_all(&base);
    }

    /// A folder on the way to the scratch that is not this user's is refused,
    /// even when it is one Jan meant to create: a `/tmp/jan-<uid>` another
    /// user planted just before the create reads as "already exists", and
    /// adopting it would let them swap everything under it. Another user's
    /// node cannot be made without root, so `mine` stands in for ownership.
    #[tokio::test]
    async fn a_created_parent_that_is_not_mine_is_refused() {
        let base = unique_data_folder();
        std::fs::create_dir_all(&base).unwrap();
        let root = base.join("jan-1000");
        let parent = root.join("p-1").join("scratch");

        let yes = |_: &Path, _: &std::fs::Metadata| true;
        let not_root = |p: &Path, _: &std::fs::Metadata| p != root;

        // Planted between the walk and the create: refused once created.
        let r = create_private_dirs_owned(&parent, yes, not_root).await;
        assert!(r.is_err(), "another user's root was adopted");
        assert!(!root.join("p-1").exists(), "nothing created under a refused root");

        // Planted before the walk: the existing root is refused as found.
        let r = create_private_dirs_owned(&parent, not_root, yes).await;
        assert!(r.is_err(), "an existing root of another user's was adopted");
        assert!(!root.join("p-1").exists(), "nothing created under a refused root");

        // Mine, the same tree is accepted, the root now existing included.
        let r = create_private_dirs_owned(&parent, yes, yes).await;
        assert!(r.is_ok(), "{r:?}");
        assert!(parent.is_dir());
        let _ = std::fs::remove_dir_all(&base);
    }

    /// A symlink planted at the temp copy's name is refused, never followed:
    /// the file it names keeps its contents and stays writable.
    #[cfg(unix)]
    #[test]
    fn the_read_only_copy_never_writes_through_a_planted_symlink() {
        let base = unique_data_folder();
        std::fs::create_dir_all(&base).unwrap();
        let victim = base.join("victim");
        std::fs::write(&victim, "mine").unwrap();
        let planted = base.join("config.tmp-1-0");
        std::os::unix::fs::symlink(&victim, &planted).unwrap();
        assert!(create_read_only_new(&planted, b"[net]").is_err());
        assert_eq!(std::fs::read_to_string(&victim).unwrap(), "mine");
        assert!(!std::fs::metadata(&victim).unwrap().permissions().readonly());

        let fresh = base.join("config.tmp-1-1");
        create_read_only_new(&fresh, b"[net]").unwrap();
        assert_eq!(std::fs::read(&fresh).unwrap(), b"[net]");
        assert!(std::fs::metadata(&fresh).unwrap().permissions().readonly());
        let _ = std::fs::remove_dir_all(&base);
    }

    /// The package cache is `<project cache>/pkg`, private, with a cargo home
    /// that holds a read-only copy of the user's config and nothing else of
    /// theirs: no credentials, no installed binaries.
    #[tokio::test]
    async fn pkg_cache_holds_only_a_read_only_cargo_config() {
        let base = unique_data_folder();
        let host = base.join("host-cargo");
        std::fs::create_dir_all(host.join("bin")).unwrap();
        std::fs::write(host.join("config.toml"), "[net]\noffline = true\n").unwrap();
        std::fs::write(host.join("credentials.toml"), "token = \"secret\"\n").unwrap();
        std::fs::write(host.join("bin/tool"), "").unwrap();
        let project = base.join("cache/jan/p-1");

        let pkg = prepare_pkg_cache_in(&project, Some(&host)).await.unwrap();
        assert_eq!(pkg.root, project.join("pkg"));
        let cargo = pkg.root.join("cargo");
        let config = pkg.cargo_config.clone().expect("config offered");
        assert_eq!(config.host, host.join("config.toml"));
        assert_eq!(config.copy, cargo.join("config.toml"));
        assert_eq!(std::fs::read_to_string(&config.copy).unwrap(), "[net]\noffline = true\n");
        assert!(std::fs::metadata(&config.copy).unwrap().permissions().readonly());
        let names: Vec<_> = std::fs::read_dir(&cargo)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["config.toml".to_string()], "{names:?}");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for dir in [&pkg.root, &cargo] {
                let mode = std::fs::metadata(dir).unwrap().permissions().mode() & 0o777;
                assert_eq!(mode, 0o700, "{dir:?}");
            }
        }

        // Re-copied each session, so a host edit applies; a host with no config
        // gets an empty one (so the sandbox finds both names read-only rather
        // than free to plant), outside the package cache, where no sandbox
        // can write it; and a planted legacy `config` is cleared.
        std::fs::write(host.join("config.toml"), "[net]\noffline = false\n").unwrap();
        let again = prepare_pkg_cache_in(&project, Some(&host)).await.unwrap();
        let copy = again.cargo_config.unwrap().copy;
        assert_eq!(std::fs::read_to_string(&copy).unwrap(), "[net]\noffline = false\n");
        std::fs::write(cargo.join("config"), "planted").unwrap();
        std::fs::remove_file(host.join("config.toml")).unwrap();
        for host_home in [Some(host.as_path()), None] {
            let none = prepare_pkg_cache_in(&project, host_home).await.unwrap();
            let empty = none.cargo_config.expect("an empty config stands in");
            assert!(!empty.host.starts_with(&none.root), "{:?}", empty.host);
            assert!(empty.host.starts_with(&project), "{:?}", empty.host);
            assert_eq!(std::fs::read(&empty.host).unwrap(), b"");
            assert_eq!(std::fs::read(&copy).unwrap(), b"");
            assert!(!cargo.join("config").exists());
        }
        let _ = std::fs::remove_dir_all(&base);
    }

    /// A host with only the legacy `config` name still gets it offered, under
    /// the name cargo prefers.
    #[tokio::test]
    async fn pkg_cache_offers_a_legacy_cargo_config() {
        let base = unique_data_folder();
        let host = base.join("host-cargo");
        std::fs::create_dir_all(&host).unwrap();
        std::fs::write(host.join("config"), "legacy").unwrap();
        let pkg = prepare_pkg_cache_in(&base.join("p"), Some(&host)).await.unwrap();
        let config = pkg.cargo_config.unwrap();
        assert_eq!(config.host, host.join("config"));
        assert_eq!(config.copy.file_name().unwrap(), "config.toml");
        let _ = std::fs::remove_dir_all(&base);
    }

    /// Two projects never share a package cache.
    #[test]
    fn projects_get_distinct_pkg_dirs() {
        let cache = Path::new("/c/jan");
        let a = unique_data_folder();
        let b = unique_data_folder();
        let pa = pkg_dir_in(&project_cache_dir_in(cache, Some(&a)));
        let pb = pkg_dir_in(&project_cache_dir_in(cache, Some(&b)));
        assert_ne!(pa, pb);
        assert!(pa.starts_with(cache) && pa.ends_with("pkg"));
    }

    /// A symlink planted where the package cache goes is refused, as for the
    /// scratch: the sandbox must never bind an attacker-chosen folder.
    #[cfg(unix)]
    #[tokio::test]
    async fn pkg_cache_refuses_a_pre_planted_symlink() {
        let base = unique_data_folder();
        let outside = unique_data_folder();
        std::fs::create_dir_all(&base).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, base.join("pkg")).unwrap();
        assert!(prepare_pkg_cache_in(&base, None).await.is_err());
        let _ = std::fs::remove_dir_all(&base);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn thread_segment_rejects_traversal_and_separators() {
        for bad in [
            "", "  ", ".", "..", "...", "../x", "a/b", "a\\b", "a b", "a;b", "a$b", "évil",
            "v1.2", "a.", " padded", "padded ", "C:x", "a\0b",
        ] {
            assert!(
                thread_segment(bad).is_err(),
                "expected {bad:?} to be rejected"
            );
        }
        // Windows device names, in any case and with an extension.
        for bad in ["CON", "nul", "Aux", "com1", "LPT9", "nul.txt", "CON.tar.gz"] {
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
            "temporary-chat",
            "CONSOLE",
            "COM10",
            "con_1",
        ] {
            assert_eq!(thread_segment(ok).unwrap(), ok);
        }
    }

    #[tokio::test]
    async fn scratch_dir_refuses_an_id_that_is_not_one_segment() {
        for bad in ["../x", "..", "a/b", "a\\b", "", "nul"] {
            assert!(ensure_scratch_dir(bad).await.is_err(), "{bad:?}");
            assert!(remove_scratch_dir(bad).await.is_err(), "{bad:?}");
            assert!(trash_scratch_dir_in(Path::new("/c"), bad).await.is_err(), "{bad:?}");
        }
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

    #[test]
    fn filename_rejects_nul_device_names_and_windows_drive_prefixes() {
        for bad in ["a\0b", "nul", "CON.md", "com1", "aux.txt"] {
            for reject_colon in [true, false] {
                assert!(workspace_filename_on(bad, reject_colon).is_err(), "{bad:?}");
            }
            assert!(crate::skills::safe_stem(bad).is_err(), "{bad:?}");
        }
        // `:` is refused on Windows only: elsewhere it is an ordinary character
        // that existing names may already use.
        for colon in ["C:x", "c:", "a:b", "C:x.md"] {
            assert!(workspace_filename_on(colon, true).is_err(), "{colon:?} on Windows");
            assert!(workspace_filename_on(colon, false).is_ok(), "{colon:?} elsewhere");
            assert_eq!(workspace_filename(colon).is_err(), cfg!(windows), "{colon:?}");
        }
        assert_eq!(workspace_filename("console").unwrap(), "console.md");
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
    #[test]
    fn host_data_folder_wins_over_the_requested_one() {
        let host = PathBuf::from("/host/Jan/data");
        assert_eq!(
            pick_data_folder(Some(host.clone()), "/Users/x/Library/LaunchAgents"),
            host
        );
        assert_eq!(pick_data_folder(Some(host.clone()), ""), host);
        // No host installed (this crate's tests): the argument is all there is.
        assert_eq!(
            pick_data_folder(None, "/tmp/data"),
            PathBuf::from("/tmp/data")
        );
    }

    const DATA: &str = "/srv/jan-data";

    fn write_root(root: &str, home: &str) -> Result<(), String> {
        validate_write_root(Path::new(root), Some(Path::new(home)), Path::new(DATA))
    }

    #[test]
    fn validate_write_root_refuses_home_and_its_ancestors() {
        assert!(write_root("/home/u", "/home/u").is_err());
        assert!(write_root("/home", "/home/u").is_err());
    }

    #[test]
    fn validate_write_root_refuses_protected_folders() {
        for bad in [
            "/home/u/.ssh",
            "/home/u/.config",
            "/home/u/.config/autostart",
            "/home/u/.config/systemd/user",
            "/home/u/.config/fish",
            "/home/u/.local",
            "/home/u/.local/bin",
            "/home/u/.local/share/applications",
            "/home/u/bin",
            "/home/u/.cargo/bin",
            "/home/u/.oh-my-zsh/custom",
            "/home/u/Library",
            "/home/u/Library/LaunchAgents",
            "/home/u/Library/LaunchAgents/sub",
            "/home/u/Library/Services",
            "/home/u/Library/Application Scripts/com.example",
            "/home/u/AppData/Local/Microsoft/WindowsApps",
            "/home/u/AppData/Roaming/Microsoft/Windows/Start Menu",
            "/home/u/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup",
            "/home/u/Applications",
            "/home/u/Applications/Tool.app",
            "/home/u/Library/Application Support",
            "/home/u/Library/Application Support/Jan/data",
            "/home/u/Library/Application Support/Code/User",
            "/home/u/AppData/Local/Programs",
            "/home/u/AppData/Local/Programs/Jan",
            "/home/u/.vscode/extensions",
            "/home/u/.npm",
            "/home/u/.nvm/versions",
            "/home/u/.bun/bin",
            "/home/u/.deno",
        ] {
            assert!(
                write_root(bad, "/home/u").is_err(),
                "{bad} should be refused"
            );
        }
    }

    #[test]
    fn validate_write_root_accepts_a_project_folder() {
        for ok in [
            "/home/u/projects/site",
            "/home/u/Documents/deck",
            "/home/u/.configs-backup",
            "/home/u/Library-notes",
            "/home/u/binaries",
            "/srv/work",
            "/srv/jan-data-export",
        ] {
            assert!(write_root(ok, "/home/u").is_ok(), "{ok} should be accepted");
        }
    }

    #[test]
    fn validate_write_root_refuses_when_home_is_unknown() {
        let data = Path::new(DATA);
        assert!(validate_write_root(Path::new("/srv/work"), None, data).is_err());
    }

    #[test]
    fn validate_write_root_refuses_the_data_folder_and_inside_it() {
        assert!(write_root(DATA, "/home/u").is_err());
        assert!(write_root("/srv/jan-data/threads", "/home/u").is_err());
    }

    // APFS and NTFS are case-insensitive by default, and `canonicalize` keeps
    // the spelling the caller used.
    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn validate_write_root_ignores_case_where_the_filesystem_does() {
        for bad in [
            "/home/u/.SSH",
            "/home/u/library/launchagents",
            "/HOME/U",
            "/SRV/JAN-DATA/x",
        ] {
            assert!(
                write_root(bad, "/home/u").is_err(),
                "{bad} should be refused"
            );
        }
    }

    /// `/System/Volumes/Data/...` is the same folder as `/...` on macOS.
    #[cfg(target_os = "macos")]
    #[test]
    fn validate_write_root_sees_through_the_data_volume_firmlink() {
        for bad in [
            "/System/Volumes/Data/Users/u",
            "/System/Volumes/Data/Users",
            "/System/Volumes/Data",
            "/system/volumes/data/Users/u/.ssh",
            "/System/Volumes/Data/Users/u/Library/LaunchAgents",
            "/System/Volumes/Data/srv/jan-data/threads",
        ] {
            assert!(write_root(bad, "/Users/u").is_err(), "{bad} should be refused");
        }
        // And the other way round: a home spelled through the firmlink.
        assert!(write_root("/Users/u/.ssh", "/System/Volumes/Data/Users/u").is_err());
        assert!(write_root("/System/Volumes/Data/Users/u/projects/site", "/Users/u").is_ok());
        assert!(write_root("/System/Volumes/DataX/u", "/Users/u").is_ok());
    }

    #[test]
    fn data_volume_prefix_is_dropped_only_as_a_whole_component() {
        assert_eq!(strip_data_volume_prefix("/system/volumes/data/users/u"), "/users/u");
        assert_eq!(strip_data_volume_prefix("/system/volumes/data"), "/");
        assert_eq!(strip_data_volume_prefix("/system/volumes/datax"), "/system/volumes/datax");
        assert_eq!(strip_data_volume_prefix("/users/u"), "/users/u");
    }

    #[cfg(unix)]
    #[test]
    fn validate_write_root_follows_a_symlinked_protected_folder() {
        let base = tmp_root("write_root_symlink");
        let home = base.join("home");
        let real = base.join("dotfiles").join("config");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::create_dir_all(real.join("fish")).unwrap();
        std::os::unix::fs::symlink(&real, home.join(".config")).unwrap();
        let (home, real) = (home.canonicalize().unwrap(), real.canonicalize().unwrap());
        let data = base.join("data");
        for bad in [
            real.clone(),
            real.join("fish"),
            real.parent().unwrap().to_path_buf(),
        ] {
            assert!(
                validate_write_root(&bad, Some(&home), &data).is_err(),
                "{} should be refused",
                bad.display()
            );
        }
        let project = base.join("project");
        assert!(validate_write_root(&project, Some(&home), &data).is_ok());
        let _ = std::fs::remove_dir_all(&base);
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
