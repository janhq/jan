use std::path::{Path, PathBuf};

/// The attached folders a tool call may reach besides the project: `read` is
/// every attached root (readable), `write` the subset also writable (see
/// [`super::ToolContext::write_roots`], always a subset of `read`).
///
/// Carried alongside the project root and scratch wherever a raw path is
/// resolved, because on Linux they decide what an absolute `/tmp/...` path
/// means: see [`resolve_path`].
#[derive(Debug, Clone, Copy)]
pub struct Attached<'a> {
    pub read: &'a [PathBuf],
    pub write: &'a [PathBuf],
}

impl<'a> Attached<'a> {
    /// No attached folders: only the project root can shadow the scratch.
    pub const NONE: Attached<'static> = Attached { read: &[], write: &[] };

    pub fn new(read: &'a [PathBuf], write: &'a [PathBuf]) -> Self {
        Self { read, write }
    }

    /// Readable roots only, for the read-side tools that never see `write_roots`.
    pub fn reads(read: &'a [PathBuf]) -> Self {
        Self { read, write: &[] }
    }
}

/// True iff `raw` resolves to a path outside `project_root` and outside the
/// session scratch. Relative paths are resolved against `project_root`.
/// Canonicalizes (resolving `..` and symlinks) so string tricks and symlink
/// escapes are caught. For a not-yet-existing leaf (new-file writes), the
/// deepest existing ancestor is canonicalized and the remaining tail re-joined.
///
/// Knows no attached folders: a caller that has some uses
/// [`escapes_read_roots`] / [`escapes_write_roots`], which share this check.
pub fn escapes_project(
    project_root: &Path,
    scratch: Option<&Path>,
    raw: &str,
) -> Result<bool, String> {
    escapes_project_with(project_root, scratch, Attached::NONE, raw)
}

fn escapes_project_with(
    project_root: &Path,
    scratch: Option<&Path>,
    attached: Attached<'_>,
    raw: &str,
) -> Result<bool, String> {
    // Absolute `/tmp` paths map into the session scratch (see [`resolve_path`]),
    // which is the agent's own area -- but only once the mapped path is checked
    // against it. Clamping `..` happens lexically, so a symlink planted in the
    // scratch (the shell can make one: `/tmp` is the scratch bind) would
    // otherwise resolve straight back out to the host. Canonicalize what the
    // clamp produced and require it to still be inside. A path the project or
    // an attached folder is mounted over is not in the scratch at all, and
    // falls through to the root checks below.
    if cfg!(target_os = "linux") {
        if let Some(scratch) = scratch {
            if tmp_relative(raw).is_some() && !shadows_scratch(project_root, attached, raw) {
                let scratch_root = scratch
                    .canonicalize()
                    .map_err(|e| format!("scratch root {:?}: {e}", scratch))?;
                let resolved = canonicalize_lenient(&resolve_path(
                    project_root,
                    Some(scratch),
                    attached,
                    raw,
                ))?;
                return Ok(!resolved.starts_with(&scratch_root));
            }
        }
    }
    let root = project_root
        .canonicalize()
        .map_err(|e| format!("project root {:?}: {e}", project_root))?;
    let abs = if Path::new(raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        root.join(raw)
    };
    let resolved = canonicalize_lenient(&abs)?;
    if resolved.starts_with(&root) {
        return Ok(false);
    }
    // The scratch is the agent's own per-session area and is writable under
    // every backend, so a path landing in it is not a host escape even though it
    // sits outside the project. On Linux it is normally reached through the
    // `/tmp` branch above; macOS and Windows have no bind mount, so the shell
    // and the filesystem tools both address it by this real path. A scratch that
    // cannot be canonicalized grants nothing: the path stays an escape.
    if let Some(scratch) = scratch {
        if let Ok(scratch) = scratch.canonicalize() {
            return Ok(!resolved.starts_with(&scratch));
        }
    }
    Ok(true)
}

/// True iff `raw` escapes every root a *read* may legitimately reach: the
/// project, the scratch, or any attached read-only root.
///
/// Layered on [`escapes_project`] rather than replacing it, so the write path
/// keeps the exact check it has today and a read root can only ever widen what
/// reads reach, never what writes do.
///
/// A read root that cannot be canonicalized grants nothing — same rule as the
/// scratch above. A vanished root must not silently open a path up.
pub fn escapes_read_roots(
    project_root: &Path,
    scratch: Option<&Path>,
    attached: Attached<'_>,
    raw: &str,
) -> Result<bool, String> {
    let read_roots = attached.read;
    if !escapes_project_with(project_root, scratch, attached, raw)? {
        return Ok(false);
    }
    if read_roots.is_empty() {
        return Ok(true);
    }
    let abs = if Path::new(raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        // Relative paths belong to the workspace, never to an attached folder:
        // resolving them against a read root would make `write` and `read`
        // disagree about what one path means.
        project_root.join(raw)
    };
    let resolved = canonicalize_lenient(&abs)?;
    for root in read_roots {
        if let Ok(root) = root.canonicalize() {
            if resolved.starts_with(&root) {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

/// True iff `raw` escapes every root a *write* may legitimately reach: the
/// project, the scratch, or any attached root the caller marked writable.
///
/// The mirror image of [`escapes_read_roots`], layered on [`escapes_project`]
/// for the same reason: a writable root can only ever widen what writes reach,
/// and a caller that passes none keeps today's exact check. A root that cannot
/// be canonicalized grants nothing.
///
/// `attached.read` matters here too, though it grants nothing: a path inside a
/// read-only folder under `/tmp` must be judged where it really is (and refused),
/// not remapped into the scratch where the write would "succeed" unseen.
pub fn escapes_write_roots(
    project_root: &Path,
    scratch: Option<&Path>,
    attached: Attached<'_>,
    raw: &str,
) -> Result<bool, String> {
    let write_roots = attached.write;
    if !escapes_project_with(project_root, scratch, attached, raw)? {
        return Ok(false);
    }
    if write_roots.is_empty() {
        return Ok(true);
    }
    let abs = if Path::new(raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        // Relative paths belong to the workspace, never to an attached folder
        // -- the same rule reads follow, so one path means one place to both.
        project_root.join(raw)
    };
    let resolved = canonicalize_lenient(&abs)?;
    for root in write_roots {
        if let Ok(root) = root.canonicalize() {
            if resolved.starts_with(&root) {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

/// Resolve a tool-supplied path to its on-disk location, forwarding an absolute
/// `/tmp/...` path into the session scratch when one is set (and only on Linux,
/// where the bash sandbox binds the scratch over `/tmp`). This keeps every
/// filesystem tool reading and writing the same `/tmp` the shell sees. With no
/// scratch, `/tmp` stays a plain host path.
///
/// The scratch is treated like a chroot: no `..` component may climb above the
/// scratch root, matching how the sandbox's `/tmp` mount behaves (it is a mount
/// point, so `..` above it stays inside `/tmp`).
///
/// The one exception mirrors the mount table (`jail::bwrap_args`): the project
/// and every attached folder are bound at their own absolute path *after* the
/// scratch is bound over `/tmp`, so a path inside one of them under `/tmp` names
/// the real folder in the shell and must name it here too. See [`shadows_scratch`].
pub fn resolve_path(
    project_root: &Path,
    scratch: Option<&Path>,
    attached: Attached<'_>,
    raw: &str,
) -> PathBuf {
    if cfg!(target_os = "linux") {
        if let Some(rel) = tmp_relative(raw) {
            if let Some(scratch) = scratch {
                if !shadows_scratch(project_root, attached, raw) {
                    return clamp_scratch(scratch, &rel);
                }
            }
        }
    }
    if Path::new(raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        project_root.join(raw)
    }
}

/// Why `name` cannot safely be a file name on Windows, or `None` if it can.
///
/// The tools address files through a `\\?\` path (the project root is one), and
/// Windows skips its name normalisation for those. A name Win32 would have
/// rewritten is then created exactly as given: `aux` and `con.txt` are
/// reserved device names and `name.` loses its dot, so every ordinary Windows
/// tool (PowerShell, Explorer, `del`) reports the path as not found, and a
/// `:` addresses an NTFS alternate data stream that no directory listing shows.
/// The tool would still report success, so the model believes the file exists.
///
/// Platform-independent on purpose, so it is testable anywhere; callers gate it
/// with [`refuse_windows_name`].
pub fn windows_name_problem(name: &str) -> Option<&'static str> {
    if name.contains(':') {
        return Some("contains ':' (an NTFS alternate data stream, not a file)");
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return Some("ends with a dot or a space, which Windows silently strips");
    }
    // Reserved with or without an extension: `con.txt` is as reserved as `con`.
    let stem = name.split('.').next().unwrap_or(name).trim_end_matches(' ');
    let upper = stem.to_ascii_uppercase();
    // COM1-9 and LPT1-9; Windows also reserves the superscript digits.
    let numbered = ["COM", "LPT"].iter().any(|prefix| {
        let mut digit = upper.strip_prefix(prefix).into_iter().flat_map(str::chars);
        matches!(
            (digit.next(), digit.next()),
            (Some('1'..='9' | '\u{b9}' | '\u{b2}' | '\u{b3}'), None)
        )
    });
    let reserved =
        numbered || matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$");
    reserved.then_some("is a reserved Windows device name")
}

/// On Windows, the first component of `raw` that is not a valid file name, with
/// the reason; `None` elsewhere and for a path that is fine. Drive and root
/// components are not names, and `.`/`..` are resolved before they reach disk.
pub fn refuse_windows_name(raw: &str) -> Option<(String, &'static str)> {
    if !cfg!(windows) {
        return None;
    }
    use std::path::Component;
    Path::new(raw).components().find_map(|c| match c {
        Component::Normal(name) => {
            let name = name.to_string_lossy();
            windows_name_problem(&name).map(|why| (name.into_owned(), why))
        }
        _ => None,
    })
}

/// The spelling to hand a tool-facing path back to the model: the inverse of
/// [`resolve_path`]. On Linux a file inside the scratch is named `/tmp/...`, the
/// one name that works from both the filesystem tools (which remap it back) and
/// `bash` (where the scratch is mounted at `/tmp`); its host path would resolve
/// for the former and not exist for the latter. Where nothing is mounted over
/// `/tmp` (macOS, Windows) both surfaces use the real path, so that is the name.
/// Anything outside the scratch is shown as-is.
pub fn scratch_display_path(scratch: Option<&Path>, path: &Path) -> String {
    let target = lexical_normalize(path);
    if cfg!(target_os = "linux") {
        if let Some(rel) = scratch_tail(scratch, &target) {
            let rel = rel.to_string_lossy().replace('\\', "/");
            return if rel.is_empty() {
                "/tmp".to_string()
            } else {
                format!("/tmp/{rel}")
            };
        }
    }
    target.to_string_lossy().into_owned()
}

/// True iff `path` lexically sits inside the session scratch. Lexical on
/// purpose: it names a path the tools are about to create as well as one that
/// already exists.
pub fn in_scratch(scratch: Option<&Path>, path: &Path) -> bool {
    scratch_tail(scratch, &lexical_normalize(path)).is_some()
}

/// The scratch-relative tail of an already-normalized `path`, or `None` when it
/// is not in the scratch. `Some("")` for the scratch root itself.
fn scratch_tail(scratch: Option<&Path>, path: &Path) -> Option<PathBuf> {
    let scratch = lexical_normalize(scratch?);
    path.strip_prefix(&scratch).ok().map(Path::to_path_buf)
}

/// Resolve `.`/`..` without touching the filesystem, so a path is comparable to
/// the project root even when the target does not exist yet. Purely lexical:
/// `canonicalize` would also follow symlinks and fail on missing files.
pub fn lexical_normalize(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Join `rel` under `scratch`, clamping `..` so it can never climb above the
/// scratch root (chroot semantics). A leading `..` or `/tmp/..` therefore falls
/// back to the scratch root rather than escaping to the host temp.
fn clamp_scratch(scratch: &Path, rel: &str) -> PathBuf {
    let mut out = scratch.to_path_buf();
    for c in Path::new(rel).components() {
        match c {
            std::path::Component::ParentDir => {
                // Clamp: never pop past the scratch root.
                if out != scratch {
                    out.pop();
                }
            }
            std::path::Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// The `/tmp`-relative tail of an absolute `/tmp/...` path; `Some("")` for the
/// bare `/tmp` dir itself; `None` when `raw` is not such a path.
fn tmp_relative(raw: &str) -> Option<String> {
    let path = Path::new(raw);
    if !path.is_absolute() {
        return None;
    }
    // Match only the exact `/tmp` dir or a genuine `/tmp/...` descendant: a
    // raw string prefix would treat `/tmpx` and `/tmp-archive` as inside /tmp.
    if raw == "/tmp" {
        return Some(String::new());
    }
    Some(raw.strip_prefix("/tmp/")?.to_string())
}

/// True iff `raw`, an absolute `/tmp/...` path, lies inside the project or an
/// attached folder that is itself under `/tmp`, i.e. a mount the sandbox lays
/// over the scratch-backed `/tmp`. Such a path is the real host path in the
/// shell, so it must not be forwarded into the scratch.
///
/// Decided on the lexically normalized path (`..` resolved, so `/tmp/ws/../x`
/// is judged as `/tmp/x` and stays scratch). Each root counts under the one
/// spelling the policy names, because that is the only place the mount is laid
/// (`--bind ROOT ROOT`): if `/tmp/a` is a link to `/tmp/b`, the shell sees
/// `/tmp/a` as the folder and `/tmp/b` as scratch, so the file tools must too.
/// A root that no longer exists still shadows -- failing safe, since the root
/// checks grant nothing for it and the mount itself fails loudly. Roots named
/// outside `/tmp` are skipped, so a `/` root does not turn the whole scratch off.
fn shadows_scratch(project_root: &Path, attached: Attached<'_>, raw: &str) -> bool {
    let target = lexical_normalize(Path::new(raw));
    std::iter::once(project_root)
        .chain(attached.read.iter().map(PathBuf::as_path))
        .chain(attached.write.iter().map(PathBuf::as_path))
        .filter(|root| root.starts_with("/tmp"))
        .any(|root| target.starts_with(lexical_normalize(root)))
}

/// True iff `real`, the link-free path a `write`/`edit` is about to open, is in
/// an attached folder the caller did not make writable. Independent of write
/// confinement: an unconfined run may reach unrelated paths it has been
/// approved for, but an attached read-only folder stays read-only.
///
/// A writable root wins when it contains `real` too (a writable folder nested
/// in a read-only one), and the project and the scratch are never refused here
/// -- they are the run's own area even if a read-only folder encloses them.
/// A root that cannot be canonicalized contains nothing.
pub fn in_attached_read_only_root(
    project_root: &Path,
    scratch: Option<&Path>,
    attached: Attached<'_>,
    real: &Path,
) -> bool {
    let inside = |root: &Path| root.canonicalize().is_ok_and(|r| real.starts_with(r));
    if inside(project_root) || scratch.is_some_and(inside) {
        return false;
    }
    if attached.write.iter().any(|r| inside(r)) {
        return false;
    }
    attached.read.iter().any(|r| inside(r))
}

/// True iff a `write`/`edit` of `raw` would land in an attached folder the
/// caller did not make writable: the gate's form of the handlers' refusal, built
/// from the same pieces (`resolve_path`, `landing` over the write roots, then
/// [`in_attached_read_only_root`]) so the gate refuses exactly what the handler
/// would, and a writable override, the project and the scratch keep their
/// exemptions. A path that escapes every root is left to the escape check.
pub fn write_hits_read_only_root(
    project_root: &Path,
    scratch: Option<&Path>,
    attached: Attached<'_>,
    raw: &str,
) -> bool {
    let target = resolve_path(project_root, scratch, attached, raw);
    match landing(project_root, scratch, attached.write, &target) {
        Landing::Inside(real) | Landing::Outside(Some(real)) => {
            in_attached_read_only_root(project_root, scratch, attached, &real)
        }
        Landing::Escapes | Landing::Outside(None) => false,
    }
}

/// True iff a write to `raw` would land in a read-only `project_root`: inside
/// it and not in the session scratch (which a read-only subagent still writes
/// to). Fails closed: a path that cannot be resolved counts as inside.
pub fn in_read_only_root(
    project_root: &Path,
    scratch: Option<&Path>,
    attached: Attached<'_>,
    raw: &str,
) -> bool {
    let target = resolve_path(project_root, scratch, attached, raw);
    let Ok(resolved) = canonicalize_lenient(&target) else {
        return true;
    };
    if let Some(scratch) = scratch.and_then(|s| s.canonicalize().ok()) {
        if resolved.starts_with(&scratch) {
            return false;
        }
    }
    match project_root.canonicalize() {
        Ok(root) => resolved.starts_with(root),
        Err(_) => true,
    }
}

/// True iff `raw` resolves inside `hidden` (the Jan home, `~/.jan`), which holds
/// `config.toml` with provider keys and hooks plus every project's store. The
/// memory/skill tools reach the store by name and never come through here.
///
/// One exception: a project that itself lives under `hidden` (a Jan worktree in
/// `~/.jan/worktrees/`) is the agent's working tree, so paths inside it stay
/// reachable. The home itself as the project grants nothing.
pub fn in_hidden_root(
    project_root: &Path,
    scratch: Option<&Path>,
    attached: Attached<'_>,
    hidden: &Path,
    raw: &str,
) -> bool {
    let Ok(hidden) = canonicalize_lenient(hidden) else {
        return false;
    };
    let Ok(resolved) = canonicalize_lenient(&resolve_path(project_root, scratch, attached, raw))
    else {
        return false;
    };
    if !resolved.starts_with(&hidden) {
        return false;
    }
    match project_root.canonicalize() {
        Ok(root) if root != hidden && root.starts_with(&hidden) => !resolved.starts_with(&root),
        _ => true,
    }
}

/// The path-like tokens of a shell command (best-effort), `~` and `$HOME`
/// expanded against the home `hidden` sits in, since that is the obvious way
/// to spell a path under it. The gate refuses a command when one of them is
/// in the hidden root; best-effort is enough only because the OS sandbox
/// masks the directory too (see [`super::jail::Policy::hide_root`]).
pub fn hidden_tokens(hidden: &Path, command: &str) -> Vec<String> {
    let home = hidden.parent().map(|h| h.to_string_lossy().into_owned());
    command
        .split(|c: char| c.is_whitespace() || ";|&><()\"'`=".contains(c))
        .filter(|t| !t.is_empty())
        .map(|t| match &home {
            Some(home) => expand_home(t, home),
            None => t.to_string(),
        })
        .collect()
}

/// True iff `raw` resolves inside one of `roots` (canonicalized attached
/// folders). Relative paths belong to the project, never to a root.
pub fn in_attached_root(
    project_root: &Path,
    scratch: Option<&Path>,
    attached: Attached<'_>,
    roots: &[PathBuf],
    raw: &str,
) -> bool {
    if roots.is_empty() || !Path::new(raw).is_absolute() {
        return false;
    }
    let Ok(resolved) = canonicalize_lenient(&resolve_path(project_root, scratch, attached, raw))
    else {
        return false;
    };
    roots
        .iter()
        .filter_map(|r| r.canonicalize().ok())
        .any(|r| resolved.starts_with(r))
}

fn expand_home(token: &str, home: &str) -> String {
    for prefix in ["${HOME}", "$HOME", "~"] {
        if let Some(rest) = token.strip_prefix(prefix) {
            if rest.is_empty() || rest.starts_with('/') {
                return format!("{home}{rest}");
            }
        }
    }
    token.to_string()
}

/// `hidden` spelled under `base`, the way a directory walk rooted at `base`
/// names its entries, or `None` when the walk cannot reach it. Lets `ls`,
/// `find` and `grep` skip the Jan home with a prefix test per entry instead of
/// canonicalizing every file they visit.
pub fn hidden_under(base: &Path, hidden: &Path) -> Option<PathBuf> {
    let base_canon = base.canonicalize().ok()?;
    let hidden_canon = canonicalize_lenient(hidden).ok()?;
    let rest = hidden_canon.strip_prefix(&base_canon).ok()?;
    Some(base.join(rest))
}

/// True when `target` *claims* to be inside a trusted root but resolves outside
/// every one of them: the fail-closed re-check a handler runs immediately
/// before its final open, closing the window between the gate's
/// decision-time canonicalization and the handler's use of the raw path.
///
/// Containment, not symlink-avoidance: a link that stays beneath a trusted root
/// is ordinary and must keep working (a yarn workspace's
/// `node_modules/<pkg> -> ../../pkg` is one, and refusing those would make the
/// tools useless in a monorepo). Only a link whose target leaves the roots is an
/// escape.
///
/// A target that is not even lexically under a root is left alone: it is an
/// escape the gate already put to the user, and re-deciding it here would
/// override their approval. An unresolvable path fails closed.
///
/// Still a re-check, not a guarantee: a swap landing between this call and the
/// open is not covered. A handler that writes resolves once with [`landing`]
/// and opens the result through [`super::nofollow`], which closes that window.
pub fn symlink_escapes_root(project_root: &Path, scratch: Option<&Path>, target: &Path) -> bool {
    symlink_escapes_any_root(project_root, scratch, &[], target)
}

/// As [`symlink_escapes_root`], but also treating `read_roots` as trusted.
///
/// Passing the read roots is not optional once one is attached: a path inside
/// an attached folder is not lexically under the project or the scratch, so the
/// early return above would classify it as "already decided" and skip the check
/// entirely — leaving a link in the user's repo pointing at `~/.ssh` followed.
pub fn symlink_escapes_any_root(
    project_root: &Path,
    scratch: Option<&Path>,
    read_roots: &[PathBuf],
    target: &Path,
) -> bool {
    matches!(landing(project_root, scratch, read_roots, target), Landing::Escapes)
}

/// Where a handler's target really lands, see [`landing`].
#[derive(Debug, PartialEq, Eq)]
pub enum Landing {
    /// Under a trusted root, and resolves (every link followed) inside one.
    Inside(PathBuf),
    /// Claims a trusted root but resolves outside all of them, or cannot be
    /// resolved at all: refuse.
    Escapes,
    /// Not lexically under any root: an escape the gate already put to the
    /// user. Carries the real path when it resolves.
    Outside(Option<PathBuf>),
}

/// Resolve `target` once and classify it against the trusted roots.
///
/// A writer must open exactly the path this returns rather than re-resolving
/// `target`: two resolutions leave room for a link swapped in between to send
/// the second one somewhere the first was never checked against.
pub fn landing(
    project_root: &Path,
    scratch: Option<&Path>,
    roots: &[PathBuf],
    target: &Path,
) -> Landing {
    let mut all = vec![project_root];
    if let Some(s) = scratch {
        all.push(s);
    }
    for r in roots {
        all.push(r.as_path());
    }
    let normalized = lexical_normalize(target);
    if !all
        .iter()
        .any(|r| normalized.starts_with(lexical_normalize(r)))
    {
        return Landing::Outside(canonicalize_lenient(&normalized).ok());
    }
    let Ok(resolved) = canonicalize_lenient(&normalized) else {
        return Landing::Escapes;
    };
    if all
        .iter()
        .filter_map(|r| r.canonicalize().ok())
        .any(|r| resolved.starts_with(r))
    {
        Landing::Inside(resolved)
    } else {
        Landing::Escapes
    }
}

/// Canonicalize a path that may not fully exist, resolving `.`/`..` lexically
/// past the point where the path stops existing.
///
/// Walked one component at a time so every symlink on the way is followed,
/// including a dangling one: `canonicalize` fails on a link whose target does
/// not exist, yet a write through it creates that target. Re-appending such a
/// link by name would keep `notes.md -> ~/.ssh/authorized_keys` inside the
/// project. A link's target is spliced in place of its name instead, relative
/// targets against the link's own directory, as the kernel does. Too many hops
/// (a cycle) is an error, so callers fail closed.
fn canonicalize_lenient(path: &Path) -> Result<PathBuf, String> {
    use std::path::Component;
    // Linux's MAXSYMLINKS: the most hops `open` itself would follow.
    const MAX_HOPS: usize = 40;
    if let Ok(p) = path.canonicalize() {
        return Ok(p);
    }
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| format!("current dir: {e}"))?
            .join(path)
    };
    // Components still to resolve, next one last so a link splices onto the end.
    let mut pending: Vec<std::ffi::OsString> =
        abs.components().rev().map(|c| c.as_os_str().to_owned()).collect();
    let mut resolved = PathBuf::new();
    let mut hops = 0;
    while let Some(raw) = pending.pop() {
        match Path::new(&raw).components().next() {
            Some(Component::Prefix(_) | Component::RootDir) => {
                resolved.push(&raw);
                if let Ok(root) = resolved.canonicalize() {
                    resolved = root;
                }
            }
            Some(Component::ParentDir) => {
                resolved.pop();
            }
            Some(Component::Normal(name)) => {
                let candidate = resolved.join(name);
                if let Ok(real) = candidate.canonicalize() {
                    resolved = real;
                    continue;
                }
                let is_link = std::fs::symlink_metadata(&candidate)
                    .is_ok_and(|m| m.file_type().is_symlink());
                if !is_link {
                    // Does not exist: nothing below it can be a link either way.
                    resolved = candidate;
                    continue;
                }
                hops += 1;
                if hops > MAX_HOPS {
                    return Err(format!("too many levels of symbolic links in {:?}", path));
                }
                let target = std::fs::read_link(&candidate)
                    .map_err(|e| format!("read link {:?}: {e}", candidate))?;
                // An absolute target restarts from its own root when its
                // RootDir component is popped; a relative one stays here.
                pending.extend(target.components().rev().map(|c| c.as_os_str().to_owned()));
            }
            Some(Component::CurDir) | None => {}
        }
    }
    Ok(resolved)
}

#[cfg(test)]
mod windows_name_tests {
    use super::windows_name_problem as problem;

    #[test]
    fn reserved_device_names_are_refused_with_or_without_an_extension() {
        for n in [
            "con", "CON", "Prn", "aux", "NUL", "con.txt", "aux.tar.gz", "nul.", "CONIN$", "CONOUT$",
            "com1", "COM9", "lpt1", "LPT9", "com1.log", "com\u{b9}", "lpt\u{b2}.txt", "aux .txt",
        ] {
            assert!(problem(n).is_some(), "{n:?} should be refused");
        }
    }

    #[test]
    fn names_that_only_resemble_reserved_ones_are_fine() {
        for n in [
            "auxiliary", "console.log", "com0", "com10", "lpt0", "com", "lpt", "conf", "nulls.txt",
            "a.con", "my.aux", ".aux", "x.nul.y", "readme.md", ".gitignore", "a.b.c", "x y.txt",
        ] {
            assert_eq!(problem(n), None, "{n:?} should be accepted");
        }
    }

    #[test]
    fn trailing_dot_or_space_and_colon_are_refused() {
        for n in ["name.", "name ", "name.txt.", "a.txt:stream", "a.txt::$DATA", "C:x"] {
            assert!(problem(n).is_some(), "{n:?} should be refused");
        }
    }

    #[test]
    fn the_refusal_gives_a_reason_the_model_can_act_on() {
        assert!(problem("aux").unwrap().contains("reserved"));
        assert!(problem("a:b").unwrap().contains("stream"));
        assert!(problem("a.").unwrap().contains("dot or a space"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn unique_root() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir =
            std::env::temp_dir().join(format!("jan_sandbox_test_{}_{}", std::process::id(), n));
        std::fs::create_dir_all(&dir).expect("create test root");
        dir
    }

    /// A test dir that is *not* under the host temp dir, so a Linux run does not
    /// silently route through the `/tmp` bind branch. Lives under the crate's
    /// `target/`, which is already build output.
    fn unique_root_outside_tmp() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("sandbox-tests")
            .join(format!("{}_{}", std::process::id(), n));
        std::fs::create_dir_all(&dir).expect("create test scratch");
        dir
    }

    #[test]
    fn in_project_file_does_not_escape() {
        let root = unique_root();
        std::fs::write(root.join("inner.txt"), b"x").unwrap();
        assert_eq!(escapes_project(&root, None, "inner.txt"), Ok(false));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn nested_in_project_does_not_escape() {
        let root = unique_root();
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/inner.txt"), b"x").unwrap();
        assert_eq!(escapes_project(&root, None, "sub/inner.txt"), Ok(false));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn dotdot_escapes() {
        let root = unique_root();
        assert_eq!(escapes_project(&root, None, "../outside.txt"), Ok(true));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn absolute_outside_escapes() {
        let root = unique_root();
        let outside = std::env::temp_dir().join("definitely_outside_the_root.txt");
        assert_eq!(
            escapes_project(&root, None, outside.to_str().unwrap()),
            Ok(true)
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn absolute_inside_does_not_escape() {
        let root = unique_root();
        std::fs::write(root.join("inner.txt"), b"x").unwrap();
        let inside = root.join("inner.txt");
        assert_eq!(
            escapes_project(&root, None, inside.to_str().unwrap()),
            Ok(false)
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn new_file_in_project_dir_does_not_escape() {
        let root = unique_root();
        std::fs::create_dir_all(root.join("sub")).unwrap();
        assert_eq!(escapes_project(&root, None, "sub/newfile.txt"), Ok(false));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A symlink planted in the scratch (the shell can create one: `/tmp` is
    /// the scratch bind) must not turn `/tmp/...` into a way out. Clamping `..`
    /// is not enough -- the link is a single component that resolves elsewhere.
    #[test]
    #[cfg(target_os = "linux")]
    fn tmp_symlink_cannot_escape_the_scratch() {
        let root = unique_root();
        let scratch = unique_root();
        let outside = unique_root();
        std::os::unix::fs::symlink(&outside, scratch.join("esc")).unwrap();
        assert_eq!(
            escapes_project(&root, Some(&scratch), "/tmp/esc/pwned.txt"),
            Ok(true),
            "a symlink out of the scratch is an escape"
        );
        // A genuine scratch path is still not an escape.
        assert_eq!(
            escapes_project(&root, Some(&scratch), "/tmp/ok.txt"),
            Ok(false)
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&scratch);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// A scratch reached by its real path (no `/tmp` bind in front of it) is the
    /// agent's own area on every platform, so it must not read as an escape.
    /// The scratch here sits outside the host temp dir on purpose: on Linux a
    /// `/tmp`-prefixed path would be answered by the bind branch above instead,
    /// leaving the cross-platform branch untested on the one OS we can run.
    #[test]
    fn real_scratch_path_is_not_an_escape() {
        let root = unique_root();
        let scratch = unique_root_outside_tmp();
        let inside = scratch.join("notes.txt");
        assert_eq!(
            escapes_project(&root, Some(&scratch), inside.to_str().unwrap()),
            Ok(false),
            "a write into the session scratch is not a host escape"
        );
        assert_eq!(
            escapes_project(&root, Some(&scratch), scratch.to_str().unwrap()),
            Ok(false),
            "the scratch root itself is addressable"
        );
        // The allowance is the scratch, not its parent.
        let sibling = scratch.parent().unwrap().join("not_the_scratch.txt");
        assert_eq!(
            escapes_project(&root, Some(&scratch), sibling.to_str().unwrap()),
            Ok(true)
        );
        // And nothing changes for a caller with no scratch at all.
        assert_eq!(
            escapes_project(&root, None, inside.to_str().unwrap()),
            Ok(true)
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    /// The real-path branch resolves symlinks for the same reason the `/tmp`
    /// branch does: the shell can plant one inside the scratch.
    #[cfg(unix)]
    #[test]
    fn real_scratch_path_symlink_cannot_escape() {
        let root = unique_root();
        let scratch = unique_root_outside_tmp();
        let outside = unique_root();
        std::os::unix::fs::symlink(&outside, scratch.join("esc")).unwrap();
        let via_link = scratch.join("esc").join("pwned.txt");
        assert_eq!(
            escapes_project(&root, Some(&scratch), via_link.to_str().unwrap()),
            Ok(true),
            "a symlink out of the scratch is an escape"
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&scratch);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// The name handed back to the model: the `/tmp` alias only where something
    /// is actually mounted there, the real path everywhere else.
    #[test]
    fn scratch_is_displayed_under_the_name_the_shell_can_use() {
        let scratch = PathBuf::from(if cfg!(windows) {
            r"C:\Temp\jan-agent-s1"
        } else {
            "/var/scratch/jan-agent-s1"
        });
        let file = scratch.join("out.txt");
        assert!(in_scratch(Some(&scratch), &file));
        assert!(!in_scratch(Some(&scratch), Path::new("/elsewhere/out.txt")));
        assert!(!in_scratch(None, &file));
        if cfg!(target_os = "linux") {
            assert_eq!(scratch_display_path(Some(&scratch), &file), "/tmp/out.txt");
            assert_eq!(scratch_display_path(Some(&scratch), &scratch), "/tmp");
        } else {
            assert_eq!(
                scratch_display_path(Some(&scratch), &file),
                file.to_string_lossy()
            );
        }
        // Outside the scratch the path is only lexically normalized, which on
        // Windows also spells it with the native separator.
        let other = PathBuf::from("/elsewhere/out.txt");
        assert_eq!(
            scratch_display_path(Some(&scratch), &other),
            if cfg!(windows) {
                r"\elsewhere\out.txt"
            } else {
                "/elsewhere/out.txt"
            }
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_caught() {
        let root = unique_root();
        let outside = unique_root();
        std::fs::write(outside.join("secret.txt"), b"x").unwrap();
        let link = root.join("link");
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        assert_eq!(escapes_project(&root, None, "link/secret.txt"), Ok(true));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// A dangling link (its target does not exist yet) is still a link: a write
    /// through it creates the target. Resolving only the deepest existing
    /// ancestor and re-appending the rest lexically kept the in-project name,
    /// so `notes.md -> ~/.ssh/authorized_keys` passed as an in-project write.
    #[cfg(unix)]
    #[test]
    fn dangling_symlink_out_of_the_project_escapes() {
        let root = unique_root();
        let outside = unique_root();
        std::os::unix::fs::symlink(outside.join("authorized_keys"), root.join("notes.md"))
            .unwrap();
        // A dangling directory link: the tail hangs off a link that resolves nowhere.
        std::os::unix::fs::symlink(outside.join("no-such-dir"), root.join("d")).unwrap();
        // Relative targets resolve against the link's own directory.
        std::fs::create_dir_all(root.join("sub")).unwrap();
        let rel = Path::new("../..").join(outside.file_name().unwrap()).join("rel.txt");
        std::os::unix::fs::symlink(&rel, root.join("sub/rel.md")).unwrap();

        assert_eq!(escapes_project(&root, None, "notes.md"), Ok(true));
        assert_eq!(escapes_project(&root, None, "d/x.txt"), Ok(true));
        assert_eq!(escapes_project(&root, None, "sub/rel.md"), Ok(true));
        assert_eq!(escapes_project(&root, None, "missing/../notes.md"), Ok(true));
        assert_eq!(escapes_write_roots(&root, None, Attached::NONE, "notes.md"), Ok(true));
        assert!(symlink_escapes_root(&root, None, &root.join("notes.md")));
        assert!(symlink_escapes_root(&root, None, &root.join("d/x.txt")));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// A dangling link that stays inside the project is an ordinary write.
    #[cfg(unix)]
    #[test]
    fn dangling_symlink_inside_the_project_does_not_escape() {
        let root = unique_root();
        std::fs::create_dir_all(root.join("docs")).unwrap();
        std::os::unix::fs::symlink("docs/README.md", root.join("README.md")).unwrap();
        assert_eq!(escapes_project(&root, None, "README.md"), Ok(false));
        assert!(!symlink_escapes_root(&root, None, &root.join("README.md")));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A link cycle resolves to nothing: fail closed rather than loop.
    #[cfg(unix)]
    #[test]
    fn symlink_cycle_fails_closed() {
        let root = unique_root();
        std::os::unix::fs::symlink("b", root.join("a")).unwrap();
        std::os::unix::fs::symlink("a", root.join("b")).unwrap();
        assert!(escapes_project(&root, None, "a").is_err());
        assert!(symlink_escapes_root(&root, None, &root.join("a")));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The re-check flags only symlinks that *leave* the trusted roots. An
    /// in-root link (the shape every yarn workspace has) resolves back inside
    /// and must stay usable; a link out of the root is an escape; a path that
    /// was never under a root at all is the gate's business, not this check's.
    #[cfg(unix)]
    #[test]
    fn symlink_escape_recheck_allows_in_root_links() {
        let root = unique_root();
        let outside = unique_root();
        std::fs::create_dir_all(root.join("pkg")).unwrap();
        std::fs::write(root.join("pkg/index.js"), b"x").unwrap();
        std::fs::write(outside.join("secret.txt"), b"s").unwrap();

        let inward = root.join("linked");
        std::os::unix::fs::symlink(root.join("pkg"), &inward).unwrap();
        let outward = root.join("escape");
        std::os::unix::fs::symlink(&outside, &outward).unwrap();

        assert!(!symlink_escapes_root(&root, None, &inward.join("index.js")));
        assert!(symlink_escapes_root(
            &root,
            None,
            &outward.join("secret.txt")
        ));
        // A not-yet-existing leaf under a real directory is not an escape.
        assert!(!symlink_escapes_root(
            &root,
            None,
            &root.join("pkg/new.txt")
        ));
        // Outside both roots: the gate already decided, so this check abstains.
        assert!(!symlink_escapes_root(
            &root,
            None,
            &outside.join("secret.txt")
        ));
        // The scratch counts as a trusted root, so a link between the two is in.
        let scratch = unique_root();
        let cross = scratch.join("into-project");
        std::os::unix::fs::symlink(root.join("pkg"), &cross).unwrap();
        assert!(!symlink_escapes_root(
            &root,
            Some(&scratch),
            &cross.join("index.js")
        ));

        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    /// `/tmpx` and `/tmp-archive` are not descendants of `/tmp` and must not be
    /// silently redirected into the scratch. Unix only: the remap exists only
    /// where a sandbox mounts the scratch over `/tmp`, and on Windows `/tmp` is
    /// not an absolute path at all.
    #[cfg(unix)]
    #[test]
    fn tmp_lookalikes_are_not_remapped() {
        assert_eq!(tmp_relative("/tmp"), Some(String::new()));
        assert_eq!(tmp_relative("/tmp/"), Some(String::new()));
        assert_eq!(tmp_relative("/tmp/a.txt"), Some("a.txt".to_string()));
        assert_eq!(tmp_relative("/tmpx"), None);
        assert_eq!(tmp_relative("/tmp-archive/a.txt"), None);
    }
    // ---- read-only attached roots -------------------------------------------

    #[test]
    fn a_path_in_a_read_root_is_not_a_read_escape() {
        let ws = unique_root_outside_tmp();
        let repo = unique_root_outside_tmp();
        std::fs::write(repo.join("main.rs"), b"fn main() {}").unwrap();
        let roots = vec![repo.clone()];
        let target = repo.join("main.rs").to_string_lossy().into_owned();

        // Without the root it is an escape; with it, a legitimate read.
        assert!(escapes_project(&ws, None, &target).unwrap());
        assert!(!escapes_read_roots(&ws, None, Attached::reads(&roots), &target).unwrap());

        let _ = std::fs::remove_dir_all(&ws);
        let _ = std::fs::remove_dir_all(&repo);
    }

    // The whole point of the mount: reads widen, writes do not. `escapes_project`
    // is what the write path keeps using, so it must still call this an escape.
    #[test]
    fn a_write_into_a_read_root_is_still_an_escape() {
        let ws = unique_root_outside_tmp();
        let repo = unique_root_outside_tmp();
        let target = repo.join("new.txt").to_string_lossy().into_owned();
        assert!(escapes_project(&ws, None, &target).unwrap());
        let _ = std::fs::remove_dir_all(&ws);
        let _ = std::fs::remove_dir_all(&repo);
    }

    #[test]
    fn a_path_outside_every_root_is_still_an_escape() {
        let ws = unique_root_outside_tmp();
        let repo = unique_root_outside_tmp();
        let other = unique_root_outside_tmp();
        let roots = vec![repo.clone()];
        let target = other.join("secret").to_string_lossy().into_owned();
        assert!(escapes_read_roots(&ws, None, Attached::reads(&roots), &target).unwrap());
        for d in [&ws, &repo, &other] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    // A read root that vanished must grant nothing, matching the scratch rule.
    #[test]
    fn a_missing_read_root_grants_nothing() {
        let ws = unique_root_outside_tmp();
        let gone = unique_root_outside_tmp();
        let target = gone.join("x").to_string_lossy().into_owned();
        std::fs::remove_dir_all(&gone).unwrap();
        let roots = vec![gone];
        assert!(escapes_read_roots(&ws, None, Attached::reads(&roots), &target).unwrap());
        let _ = std::fs::remove_dir_all(&ws);
    }

    // Relative paths belong to the workspace. Resolving them against an attached
    // folder would make `read` and `write` disagree about what one path means.
    #[test]
    fn a_relative_path_still_resolves_against_the_workspace() {
        let ws = unique_root_outside_tmp();
        let repo = unique_root_outside_tmp();
        std::fs::write(repo.join("only-in-repo.txt"), b"x").unwrap();
        let roots = vec![repo.clone()];
        assert!(escapes_read_roots(&ws, None, Attached::reads(&roots), "only-in-repo.txt").is_ok());
        let _ = std::fs::remove_dir_all(&ws);
        let _ = std::fs::remove_dir_all(&repo);
    }

    // The hole this mount opens if the read roots are not passed: a link inside
    // the attached folder is not lexically under the workspace, so the plain
    // check returns "already decided" and never looks at where it points.
    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_a_read_root_is_caught() {
        let ws = unique_root_outside_tmp();
        let repo = unique_root_outside_tmp();
        let secret_dir = unique_root_outside_tmp();
        let secret = secret_dir.join("id_rsa");
        std::fs::write(&secret, b"key").unwrap();
        let link = repo.join("innocent.txt");
        std::os::unix::fs::symlink(&secret, &link).unwrap();
        let roots = vec![repo.clone()];

        assert!(
            symlink_escapes_any_root(&ws, None, &roots, &link),
            "a link leaving the attached folder must be refused"
        );
        assert!(
            !symlink_escapes_root(&ws, None, &link),
            "and the plain check is exactly why the roots must be passed"
        );
        for d in [&ws, &repo, &secret_dir] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    // A link that stays inside the attached folder is ordinary and must work --
    // every monorepo has them.
    #[cfg(unix)]
    #[test]
    fn a_symlink_inside_a_read_root_is_allowed() {
        let repo = unique_root_outside_tmp();
        let ws = unique_root_outside_tmp();
        let real = repo.join("real.txt");
        std::fs::write(&real, b"x").unwrap();
        let link = repo.join("link.txt");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let roots = vec![repo.clone()];
        assert!(!symlink_escapes_any_root(&ws, None, &roots, &link));
        let _ = std::fs::remove_dir_all(&repo);
        let _ = std::fs::remove_dir_all(&ws);
    }

    /// The home-as-project case from the #9065 review: the Jan home sits inside
    /// the project, and everything under it is hidden, not just config.toml.
    #[test]
    fn the_jan_home_is_hidden_when_the_project_contains_it() {
        let home = unique_root();
        let jan = home.join(".jan");
        std::fs::create_dir_all(jan.join("projects/p-1/memory")).unwrap();
        std::fs::write(jan.join("config.toml"), b"k").unwrap();
        assert!(in_hidden_root(&home, None, Attached::NONE, &jan, ".jan/config.toml"));
        assert!(in_hidden_root(&home, None, Attached::NONE, &jan, "./.jan/../.jan/config.toml"));
        assert!(in_hidden_root(&home, None, Attached::NONE, &jan, jan.join("config.toml").to_str().unwrap()));
        assert!(in_hidden_root(&home, None, Attached::NONE, &jan, ".jan"));
        assert!(in_hidden_root(&home, None, Attached::NONE, &jan, ".jan/projects/p-1/agent.toml"));
        // Not yet existing files are hidden too, so a write cannot create one.
        assert!(in_hidden_root(&home, None, Attached::NONE, &jan, ".jan/hooks.toml"));
        assert!(!in_hidden_root(&home, None, Attached::NONE, &jan, "JAN.md"));
        assert!(!in_hidden_root(&home, None, Attached::NONE, &jan, ".janitor"));
        let _ = std::fs::remove_dir_all(&home);
    }

    /// A Jan worktree is the agent's own working tree even though it lives
    /// under `~/.jan`; the rest of the home stays hidden from it.
    #[test]
    fn a_worktree_inside_the_jan_home_keeps_its_own_tree() {
        let home = unique_root();
        let jan = home.join(".jan");
        let wt = jan.join("worktrees/repo-1/feature");
        std::fs::create_dir_all(&wt).unwrap();
        std::fs::write(jan.join("config.toml"), b"k").unwrap();
        assert!(!in_hidden_root(&wt, None, Attached::NONE, &jan, "src/main.rs"));
        assert!(!in_hidden_root(&wt, None, Attached::NONE, &jan, wt.to_str().unwrap()));
        assert!(in_hidden_root(&wt, None, Attached::NONE, &jan, "../../../config.toml"));
        assert!(in_hidden_root(&wt, None, Attached::NONE, &jan, jan.join("config.toml").to_str().unwrap()));
        let _ = std::fs::remove_dir_all(&home);
    }

    fn command_touches_hidden_root(
        project: &Path,
        scratch: Option<&Path>,
        hidden: &Path,
        cmd: &str,
    ) -> bool {
        hidden_tokens(hidden, cmd)
            .iter()
            .any(|t| in_hidden_root(project, scratch, Attached::NONE, hidden, t))
    }

    #[test]
    fn command_scan_expands_home_spellings() {
        let home = unique_root();
        let jan = home.join(".jan");
        std::fs::create_dir_all(&jan).unwrap();
        std::fs::write(jan.join("config.toml"), b"k").unwrap();
        let project = home.join("proj");
        std::fs::create_dir_all(&project).unwrap();
        for cmd in [
            "cat ~/.jan/config.toml",
            "cat $HOME/.jan/config.toml",
            "grep key < ${HOME}/.jan/config.toml",
            "cat ../.jan/config.toml",
            "F=~/.jan/config.toml",
        ] {
            assert!(command_touches_hidden_root(&project, None, &jan, cmd), "{cmd}");
        }
        let abs = format!("cat '{}'", jan.join("config.toml").display());
        assert!(command_touches_hidden_root(&project, None, &jan, &abs));
        assert!(!command_touches_hidden_root(&project, None, &jan, "cat ~/.bashrc"));
        assert!(!command_touches_hidden_root(&project, None, &jan, "ls -la src"));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn hidden_under_spells_the_home_the_way_a_walk_does() {
        let home = unique_root();
        let jan = home.join(".jan");
        std::fs::create_dir_all(&jan).unwrap();
        assert_eq!(hidden_under(&home, &jan), Some(home.join(".jan")));
        let dot = home.join(".");
        assert_eq!(hidden_under(&dot, &jan), Some(dot.join(".jan")));
        let other = home.join("proj");
        std::fs::create_dir_all(&other).unwrap();
        assert_eq!(hidden_under(&other, &jan), None);
        let _ = std::fs::remove_dir_all(&home);
    }

    /// The scratch is shadowed under the spelling the policy names, because the
    /// mount is laid there only: with `/tmp/a -> /tmp/b` and `/tmp/a` attached,
    /// the shell sees the folder at `/tmp/a` and `/tmp/b` is plain scratch.
    #[test]
    #[cfg(unix)]
    fn shadows_scratch_by_the_named_spelling_only() {
        let tag = format!("jan_shadow_{}", std::process::id());
        let real = PathBuf::from(format!("/tmp/{tag}_real"));
        let link = PathBuf::from(format!("/tmp/{tag}_link"));
        let _ = std::fs::remove_dir_all(&real);
        let _ = std::fs::remove_file(&link);
        std::fs::create_dir_all(&real).unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let project = unique_root();
        let named_link = vec![link.clone()];
        let named_real = vec![real.clone()];
        let via_link = Attached::new(&named_link, &[]);
        let via_real = Attached::new(&named_real, &[]);
        let at = |p: &Path, f: &str| p.join(f).to_string_lossy().into_owned();

        // Named by the link: the link spelling shadows, the canonical one does not.
        assert!(shadows_scratch(&project, via_link, &at(&link, "x")));
        assert!(!shadows_scratch(&project, via_link, &at(&real, "x")));
        // Named canonically: the link spelling is only scratch.
        assert!(shadows_scratch(&project, via_real, &at(&real, "x")));
        assert!(!shadows_scratch(&project, via_real, &at(&link, "x")));
        // `..` is resolved first, so climbing out of the named root is scratch.
        assert!(!shadows_scratch(&project, via_link, &format!("{}/../x", link.display())));
        // A root that does not exist still shadows (fail safe), by name.
        let gone = vec![PathBuf::from(format!("/tmp/{tag}_gone"))];
        assert!(shadows_scratch(&project, Attached::new(&gone, &[]), &format!("/tmp/{tag}_gone/x")));

        let _ = std::fs::remove_file(&link);
        let _ = std::fs::remove_dir_all(&real);
        let _ = std::fs::remove_dir_all(&project);
    }

    /// The gate's predicate refuses exactly what the handlers refuse: a write
    /// into a read-only attached folder, not one a writable root overrides, nor
    /// the project, the scratch, or a path that escapes every root.
    #[test]
    fn write_hits_read_only_root_matches_the_handler_refusal() {
        let project = unique_root();
        let scratch = unique_root();
        let ro = unique_root();
        let rw = unique_root();
        let elsewhere = unique_root();
        std::fs::create_dir_all(ro.join("sub")).unwrap();
        let roots = vec![ro.clone(), rw.clone()];
        let writable = vec![rw.clone()];
        let a = Attached::new(&roots, &writable);
        let hits = |raw: &str| write_hits_read_only_root(&project, Some(&scratch), a, raw);
        let p = |base: &Path, f: &str| base.join(f).to_string_lossy().into_owned();

        assert!(hits(&p(&ro, "new.txt")));
        assert!(hits(&p(&ro, "sub/deep/new.txt")), "a not yet existing path still counts");
        assert!(hits(&format!("{}/sub/../new.txt", ro.display())));
        assert!(!hits(&p(&rw, "new.txt")), "a writable root is not read-only");
        assert!(!hits("notes.md"), "the project is the run's own area");
        assert!(!hits(&p(&project, "notes.md")));
        assert!(!hits(&p(&scratch, "out.txt")));
        assert!(!hits(&p(&elsewhere, "x.txt")), "an escape is the escape check's");
        // With nothing attached nothing is read-only.
        assert!(!write_hits_read_only_root(&project, Some(&scratch), Attached::NONE, &p(&ro, "x")));

        // A writable folder nested in a read-only one wins; its sibling does not.
        let nested = ro.join("rw_inside");
        std::fs::create_dir_all(&nested).unwrap();
        let nested_roots = vec![ro.clone(), nested.clone()];
        let nested_writable = vec![nested.clone()];
        let n = Attached::new(&nested_roots, &nested_writable);
        assert!(!write_hits_read_only_root(&project, Some(&scratch), n, &p(&nested, "ok.txt")));
        assert!(write_hits_read_only_root(&project, Some(&scratch), n, &p(&ro, "no.txt")));

        for d in [&project, &scratch, &ro, &rw, &elsewhere] {
            let _ = std::fs::remove_dir_all(d);
        }
    }
}
