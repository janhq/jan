use std::path::{Path, PathBuf};

/// True iff `raw` resolves to a path outside `project_root` and outside the
/// session scratch. Relative paths are resolved against `project_root`.
/// Canonicalizes (resolving `..` and symlinks) so string tricks and symlink
/// escapes are caught. For a not-yet-existing leaf (new-file writes), the
/// deepest existing ancestor is canonicalized and the remaining tail re-joined.
pub fn escapes_project(
    project_root: &Path,
    scratch: Option<&Path>,
    raw: &str,
) -> Result<bool, String> {
    escapes_roots_metered(project_root, scratch, &[], raw, &Meter::unlimited())
}

/// True iff `raw` escapes every root a *read* may legitimately reach: the
/// project, the scratch, or any attached read-only root.
///
/// Layered on [`escapes_project`] rather than replacing it, so the write path
/// keeps the exact check it has today and a read root can only ever widen what
/// reads reach, never what writes do.
///
/// A read root that cannot be canonicalized grants nothing -- same rule as the
/// scratch above. A vanished root must not silently open a path up.
pub fn escapes_read_roots(
    project_root: &Path,
    scratch: Option<&Path>,
    read_roots: &[PathBuf],
    raw: &str,
) -> Result<bool, String> {
    escapes_roots_metered(project_root, scratch, read_roots, raw, &Meter::unlimited())
}

/// True iff `raw` escapes every root a *write* may legitimately reach: the
/// project, the scratch, or any attached root the caller marked writable.
///
/// The mirror image of [`escapes_read_roots`], layered on [`escapes_project`]
/// for the same reason: a writable root can only ever widen what writes reach,
/// and a caller that passes none keeps today's exact check. A root that cannot
/// be canonicalized grants nothing.
pub fn escapes_write_roots(
    project_root: &Path,
    scratch: Option<&Path>,
    write_roots: &[PathBuf],
    raw: &str,
) -> Result<bool, String> {
    escapes_roots_metered(project_root, scratch, write_roots, raw, &Meter::unlimited())
}

/// [`escapes_project`] widened by `roots` (the read or the write roots),
/// charging `meter` for resolving `raw`; an error once it runs out, which
/// the gate must tell from an escape with [`Meter::spent`]. Only `raw` is
/// metered: it is what the model sends, while the roots are the user's and
/// cost one `canonicalize` each.
///
/// `raw` is resolved once, relative paths against the project root: they
/// belong to the workspace, never to an attached folder, or `write` and
/// `read` would disagree about what one path means.
pub fn escapes_roots_metered(
    project_root: &Path,
    scratch: Option<&Path>,
    roots: &[PathBuf],
    raw: &str,
    meter: &Meter,
) -> Result<bool, String> {
    let root = project_root
        .canonicalize()
        .map_err(|e| format!("project root {:?}: {e}", project_root))?;
    let abs = if Path::new(raw).is_absolute() {
        PathBuf::from(raw)
    } else {
        root.join(raw)
    };
    let resolved = canonicalize_metered(&abs, meter)?;
    // The scratch is the agent's own per-session area and is writable under
    // every backend at this same real path, so a path landing in it is not a
    // host escape even though it sits outside the project. Canonicalized, so
    // a symlink the shell planted in the scratch (or a root) cannot lead back
    // out. A scratch or root that cannot be canonicalized grants nothing: the
    // path stays an escape.
    let within = |dir: &Path| dir.canonicalize().is_ok_and(|dir| resolved.starts_with(dir));
    Ok(!resolved.starts_with(&root)
        && !scratch.is_some_and(within)
        && !roots.iter().any(|r| within(r)))
}

/// Resolve a tool-supplied path to its on-disk location: absolute paths as
/// given, relative ones against the project. The scratch needs no mapping: the
/// sandbox exposes it at its real path, so the shell and the tools already
/// agree on its name.
pub fn resolve_path(project_root: &Path, raw: &str) -> PathBuf {
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

/// True iff `path` lexically sits inside the session scratch. Lexical on
/// purpose: it names a path the tools are about to create as well as one that
/// already exists.
pub fn in_scratch(scratch: Option<&Path>, path: &Path) -> bool {
    scratch.is_some_and(|s| lexical_normalize(path).starts_with(lexical_normalize(s)))
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

/// True iff a write to `raw` would land in a read-only `project_root`: inside
/// it and not in the session scratch (which a read-only subagent still writes
/// to). Fails closed: a path that cannot be resolved counts as inside.
pub fn in_read_only_root(project_root: &Path, scratch: Option<&Path>, raw: &str) -> bool {
    let target = resolve_path(project_root, raw);
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
pub fn in_hidden_root(project_root: &Path, hidden: &Path, raw: &str) -> bool {
    in_hidden_root_from(project_root, project_root, hidden, raw)
}

/// [`in_hidden_root`] with a relative `raw` resolved against `base` instead of
/// the project root: a shell that a `cd` moved elsewhere reads `.jan/...`
/// from there. The worktree exception stays keyed on `project_root`, since
/// that, not where the shell stands, is the agent's working tree.
pub fn in_hidden_root_from(project_root: &Path, base: &Path, hidden: &Path, raw: &str) -> bool {
    let meter = Meter::unlimited();
    HiddenRoot::new(project_root, base, hidden, &meter).is_some_and(|h| h.holds(raw, &meter))
}

/// The hidden root, its worktree exception (see [`in_hidden_root`]), the
/// base relative paths resolve against and the attached roots carved out of
/// it, resolved once: a caller checking many paths (every token of a
/// command) would otherwise re-resolve all of them for each, which from a
/// deep base cost every token a syscall per component of it.
pub struct HiddenRoot {
    hidden: PathBuf,
    /// The project root when it is a worktree inside `hidden`.
    worktree: Option<PathBuf>,
    base: Base,
    carve: Carve,
}

impl HiddenRoot {
    /// `None` when `hidden` cannot be resolved: then nothing is in it. No
    /// attached root is carved out until [`HiddenRoot::carving`] says so.
    pub fn new(project_root: &Path, base: &Path, hidden: &Path, meter: &Meter) -> Option<Self> {
        let hidden = canonicalize_metered(hidden, meter).ok()?;
        let worktree = meter
            .canonicalize(project_root)
            .ok()
            .flatten()
            .filter(|root| *root != hidden && root.starts_with(&hidden));
        let base = Base::new(project_root, base, meter);
        Some(Self { hidden, worktree, base, carve: Carve::default() })
    }

    /// This root with what [`shell_reads_attached_from`] lets through carved
    /// out of it: paths in `read_roots` and in none of `write_roots`. A tool
    /// that only reads passes no write roots.
    pub fn carving(self, read_roots: &[PathBuf], write_roots: &[PathBuf], meter: &Meter) -> Self {
        Self { carve: Carve::new(read_roots, write_roots, meter), ..self }
    }

    /// The resolved hidden root.
    pub fn path(&self) -> &Path {
        &self.hidden
    }

    /// [`in_hidden_root_from`] against this root and base, less the carve-out.
    /// False when `meter` runs out, which the caller must check.
    pub fn holds(&self, raw: &str, meter: &Meter) -> bool {
        let Ok(resolved) = self.base.resolve(raw, meter) else {
            return false;
        };
        resolved.starts_with(&self.hidden)
            && !self.worktree.as_ref().is_some_and(|w| resolved.starts_with(w))
            && !self.carve.covers(&self.base, raw, &resolved)
    }
}

/// The directory relative paths resolve against, resolved once.
struct Base {
    /// Canonical when it resolves; else as given, and each path is resolved
    /// from scratch.
    dir: Result<PathBuf, PathBuf>,
    /// The base is the project root: its relative paths belong to the
    /// project, never to an attached root. A literal comparison on purpose:
    /// the held cwd is always a physical path (`pwd -P`) and is cleared once
    /// it equals the canonical root, so a caller passes either the root
    /// itself or something else. A caller that spells the root differently
    /// gets no carve-out for relative paths from it, which fails closed.
    is_project: bool,
}

impl Base {
    fn new(project_root: &Path, base: &Path, meter: &Meter) -> Self {
        let dir = match meter.canonicalize(base) {
            Ok(Some(dir)) => Ok(dir),
            _ => Err(base.to_path_buf()),
        };
        Self { dir, is_project: base == project_root }
    }

    /// `raw` resolved against this base, every link followed.
    fn resolve(&self, raw: &str, meter: &Meter) -> Result<PathBuf, String> {
        match &self.dir {
            Ok(dir) if !Path::new(raw).is_absolute() => resolve_from(dir, raw, meter),
            Ok(dir) | Err(dir) => canonicalize_metered(&resolve_path(dir, raw), meter),
        }
    }
}

/// Attached roots a path in the Jan home may still be named in (see
/// [`shell_reads_attached_from`]), canonicalized once. A root that cannot
/// be canonicalized grants nothing.
#[derive(Default)]
struct Carve {
    read: Vec<PathBuf>,
    write: Vec<PathBuf>,
}

impl Carve {
    fn new(read_roots: &[PathBuf], write_roots: &[PathBuf], meter: &Meter) -> Self {
        // Charged on every decision that carves: two attached roots ~1900
        // deep would spend the budget alone, accepted as the user attaches them.
        let real = |roots: &[PathBuf]| -> Vec<PathBuf> {
            roots.iter().filter_map(|r| meter.canonicalize(r).ok().flatten()).collect()
        };
        Self { read: real(read_roots), write: real(write_roots) }
    }

    /// True iff `raw`, which resolved to `resolved` from `base`, is in a read
    /// root and in no write root.
    fn covers(&self, base: &Base, raw: &str, resolved: &Path) -> bool {
        if self.read.is_empty() || (!Path::new(raw).is_absolute() && base.is_project) {
            return false;
        }
        let within = |roots: &[PathBuf]| roots.iter().any(|r| resolved.starts_with(r));
        within(&self.read) && !within(&self.write)
    }
}

/// The path-like tokens of a shell command (best-effort), `~` and `$HOME`
/// expanded against the home `hidden` sits in, since that is the obvious way
/// to spell a path under it. The gate refuses a command when one of them is
/// in the hidden root; best-effort is enough only because the OS sandbox
/// masks the directory too (see [`super::jail::Policy::hide_root`]).
///
/// Every word is a token, the command name too: telling one from an argument
/// takes a shell parser, and each guess at one let a path through. A word
/// naming no path is harmless; one resolved under a held cwd in the home is
/// let through only by the gate's attached-root carve-out, and the shell is
/// never held anywhere else in the home (see `settle_shell_cwd`).
///
/// A backslash splits nothing, so a Windows path (`C:\Users\me\x`) stays one
/// token; a word with one is also checked unescaped, the way a POSIX shell
/// reads it (`\x` is `x`). A word with quotes in it is also checked with them
/// dropped, as the shell joins it: `"$PWD"/../x` is one path, not two.
///
/// A token spelling the shell's start directory some other way (see
/// [`start_dir_relative`]) is followed by the path it names from there, which
/// the caller resolves against the start dir like any relative token: read
/// as written, the host would resolve it against Jan's own process. The word
/// as written stays a token too: it may also be an ordinary relative path
/// (a `proc/` directory in the project), and an extra token only adds a
/// refusal.
///
/// `None` when the command is too complex to check in bounded time: more
/// than [`MAX_TOKENS`] tokens or [`MAX_TOKEN_BYTES`] of them, or one token
/// with more start-dir candidates than [`start_dir_past_links`] allows. The
/// caller resolves every token, so a scan without a bound would stall the
/// agent in the gate; it refuses the command instead, failing closed, and
/// the model can split or simplify it. What resolving the tokens costs is
/// bounded by the caller, with a [`Meter`].
pub fn hidden_tokens(hidden: &Path, command: &str) -> Option<Vec<String>> {
    let home = hidden.parent().map(|h| h.to_string_lossy().into_owned());
    let words = command.split(|c: char| c.is_whitespace() || ";|&><()\"'`=".contains(c));
    let joined = command
        .split(|c: char| c.is_whitespace() || ";|&><()`=".contains(c))
        .filter(|w| w.contains(['"', '\'']))
        .map(|w| w.replace(['"', '\''], ""));
    let tokens = words
        .map(str::to_string)
        .chain(joined)
        .filter(|t| !t.is_empty())
        .flat_map(|t| {
            let unescaped = t.contains('\\').then(|| unescape(&t));
            std::iter::once(t).chain(unescaped)
        })
        .map(|t| match &home {
            Some(home) => expand_home(&t, home),
            None => t,
        });
    let mut out = Vec::new();
    let mut bytes = 0;
    for t in tokens {
        let start = start_dir_relative(&t);
        let linked = start_dir_past_links(&t)?;
        for t in std::iter::once(t).chain(start).chain(linked) {
            bytes += t.len();
            out.push(t);
        }
        if out.len() > MAX_TOKENS || bytes > MAX_TOKEN_BYTES {
            return None;
        }
    }
    Some(out)
}

/// The most tokens [`hidden_tokens`] hands back for one command: half again
/// a 100k-word heredoc, far more than a model writes by hand. It bounds the
/// scan's memory; the gate's time to resolve them is bounded by
/// [`MAX_RESOLVE_COST`].
const MAX_TOKENS: usize = 150_000;

/// The most bytes of tokens [`hidden_tokens`] hands back for one command. A
/// few times the largest command a model plausibly writes, since quoted and
/// escaped words are counted twice. Like [`MAX_TOKENS`] it bounds the scan's
/// memory and time, not the resolving that follows.
const MAX_TOKEN_BYTES: usize = 4 << 20;

/// The most one gate decision may spend on all the paths it resolves
/// (command tokens and path arguments together), in path components the OS
/// walks, charged to one [`Meter`]: a path 2048 components deep, or a
/// 150k-word command run from a directory 25 levels deep. A path syscall
/// walks the path from the root, so the work is quadratic in a path's depth
/// whichever way it is resolved: one path a model can send, made of real
/// directories and `..`, took minutes, and so did many short tokens through
/// a link into a deep directory. Up to this budget it takes well under a
/// second in a release build.
pub const MAX_RESOLVE_COST: usize = 2048 * 2048;

/// What resolving `raw` against a directory `base_depth` components deep
/// costs, estimated from the text in the units of [`MAX_RESOLVE_COST`]: each
/// component of the full path is a step, and each step walks the path so
/// far. A bare word thus costs the depth of its directory; an absolute path
/// ignores the base.
///
/// Blind to links, so the gate uses it only as a cap, to refuse what is too
/// deep on its face before any syscall; the [`Meter`] is charged by the
/// walks, with what they really do.
pub fn resolve_cost(base_depth: usize, raw: &str) -> usize {
    let own = raw.bytes().filter(|b| *b == b'/' || *b == b'\\').count() + 1;
    let depth = if Path::new(raw).is_absolute() { own } else { own + base_depth };
    own.saturating_mul(depth)
}

/// The most candidates [`start_dir_past_links`] makes from one token. Each
/// is as long as the rest of the token, so without a cap a token of repeated
/// globs (`/proc/..` then `/*` many times, every glob a possible `cwd`)
/// makes candidates quadratic in its length. An ordinary path has none or
/// one or two.
const MAX_LINKED: usize = 16;

/// Words a POSIX shell expands to its current directory when it starts: the
/// start dir. `~-` and `$OLDPWD` name the previous one, which the cwd
/// wrapper sets to the start dir on every run (see
/// `handlers::posix_cwd_script`): after its `cd` the shell's own would name
/// the project root it was spawned in.
///
/// `~+0` and `~-0` are bash's directory-stack ends: the top is the current
/// directory, and the bottom is too while nothing was pushed (the stack is
/// that one entry), so at the start both name the start dir. A `pushd` or
/// `cd` in the same command moves them, as a `cd` moves `$PWD`.
///
/// Only these literal words are mapped. `$(pwd)`, backticks,
/// `${PWD%...}`-style expansions and the other stack entries (`~+N`, `~-N`,
/// `~N` for N > 0, which name directories only a `pushd` in the same
/// command put there) also spell a directory the gate cannot know and are
/// not: the same gap as any other `$VAR` the gate cannot evaluate, which the
/// OS sandbox masking the home covers for a confined run.
const START_DIR_WORDS: [&str; 8] =
    ["$PWD", "${PWD}", "~+", "~-", "~+0", "~-0", "$OLDPWD", "${OLDPWD}"];

/// Where a token's leading components put it, as far as
/// [`start_dir_relative`] cares.
enum Spot {
    /// The shell's start directory (or, failing closed, maybe it).
    Start,
    /// The filesystem root again, through `/proc/<pid>/root`.
    Root,
    Elsewhere,
}

/// True iff the component `part` may be `literal` once the shell expands it:
/// equal, or carrying a glob or an expansion that could turn into it
/// (`/proc/s*/cwd`, `/proc/self/$d`). Fails closed for a word the gate
/// cannot evaluate.
fn may_be(part: &str, literal: &str) -> bool {
    part == literal || part.contains(['*', '?', '[', '$', '{', '`'])
}

/// Where the components so far (`.`/`..` already applied) lead. Every
/// process's `cwd` and `root`, and every fd, are matched whatever names the
/// process (`self`, `$$`, a pid, `thread-self`, a task id): the gate cannot
/// tell which process a pid is, and the shell's own is one of them.
fn spot(parts: &[String]) -> Spot {
    let is = |i: usize, literal: &str| parts.get(i).is_some_and(|p| may_be(p, literal));
    let proc = is(0, "proc");
    // `/proc/<pid>` or `/proc/<pid>/task/<tid>`: what follows is the same.
    let base = if proc && parts.len() >= 5 && is(2, "task") { 4 } else { 2 };
    match parts.len() {
        2 if is(0, "dev") && ["stdin", "stdout", "stderr"].iter().any(|s| is(1, s)) => Spot::Start,
        3 if is(0, "dev") && is(1, "fd") => Spot::Start,
        n if proc && n == base + 1 && is(base, "cwd") => Spot::Start,
        n if proc && n == base + 1 && is(base, "root") => Spot::Root,
        n if proc && n == base + 2 && is(base, "fd") => Spot::Start,
        _ => Spot::Elsewhere,
    }
}

/// A shell token spelling a path through the shell's start directory, as the
/// same path relative to that directory; `None` for any other token. The
/// spellings: [`START_DIR_WORDS`] in front, `/proc/<pid>/cwd`, and a
/// directory fd opened on it (`exec 3<.` then `/dev/fd/3`, `/proc/<pid>/fd/3`,
/// `/dev/stdin`), the last two failing closed for an fd that names something
/// else.
///
/// The host would resolve each against Jan's own process, not the shell, so
/// `/proc/self/cwd/../.jan` from a shell held in `~/proj` would pass as a path
/// under Jan's cwd. Leading components are normalized lexically first, so
/// `/proc/self/../self/cwd` and `/proc/self/root/proc/self/cwd` (which
/// re-enters `/proc` from the root) are caught too; what follows the match is
/// kept as written, so a `..` there climbs from the start dir, as it does in
/// the shell. A relative token is walked as if from the root, since it may
/// climb there: at worst an ordinary `proc/x/cwd` directory is also checked
/// as the start dir, which only adds a refusal.
///
/// A token through `/proc/<pid>/root` that never reaches the start dir is
/// the absolute path it names under that root (`/proc/1/root/etc/x` is
/// `/etc/x`), which the host may not be allowed to resolve as written.
pub fn start_dir_relative(token: &str) -> Option<String> {
    use std::path::Component;
    let rel = |rest: &Path| {
        Some(match rest.as_os_str().is_empty() {
            true => ".".to_string(),
            false => rest.to_string_lossy().into_owned(),
        })
    };
    let mut components = Path::new(token).components();
    if let Some(Component::Normal(first)) = components.clone().next() {
        if START_DIR_WORDS.iter().any(|w| first == *w) {
            components.next();
            return rel(components.as_path());
        }
    }
    let mut parts: Vec<String> = Vec::new();
    let mut rerooted = false;
    while let Some(c) = components.next() {
        match c {
            Component::ParentDir => {
                parts.pop();
            }
            Component::Normal(name) => parts.push(name.to_string_lossy().into_owned()),
            Component::CurDir => {}
            // A root (or a Windows prefix) restarts the walk.
            _ => parts.clear(),
        }
        match spot(&parts) {
            Spot::Start => return rel(components.as_path()),
            Spot::Root => {
                parts.clear();
                rerooted = true;
            }
            Spot::Elsewhere => {}
        }
    }
    rerooted.then(|| format!("/{}", parts.join("/")))
}

/// The paths a token under `/proc` or `/dev` may name through the shell's
/// start dir once the kernel follows the links in it, which
/// [`start_dir_relative`] does not see: a `..` after a link (`/proc/net`,
/// `/proc/self`, `/proc/thread-self`, `/proc/mounts`, `/dev/fd`) climbs from
/// the link's target, not from where the token spells it, so
/// `/proc/net/../cwd` is `/proc/self/cwd` while it normalizes lexically to
/// `/proc/cwd`. Which components are links the gate cannot know without the
/// shell's `/proc`, so once a `..` follows a `proc` or `dev` component,
/// every later `cwd`, `fd/<n>` and `std*` component is taken as the start
/// dir and every `root` as the filesystem root, and what follows each is a
/// candidate. Fails closed; a token with no such `..` (`/proc/cpuinfo`,
/// `/proc/self/fd`, `/dev/null`) yields nothing, so ordinary reads are not
/// touched. The candidates are not walked again.
///
/// One candidate per matching component, each the rest of the token, is
/// quadratic in the token's length when many components match (every glob
/// may be a `cwd`). So past [`MAX_LINKED`] candidates this gives up with
/// `None`, which refuses the whole command (see [`hidden_tokens`]): what it
/// would have to check cannot be checked in bounded time.
fn start_dir_past_links(token: &str) -> Option<Vec<String>> {
    use std::path::Component;
    let parts: Vec<Component> = Path::new(token).components().collect();
    let name = |i: usize| match parts.get(i) {
        Some(Component::Normal(n)) => Some(n.to_string_lossy()),
        _ => None,
    };
    let is = |i: usize, literal: &str| name(i).is_some_and(|n| may_be(&n, literal));
    let Some(linked) = (0..parts.len()).find(|&i| is(i, "proc") || is(i, "dev")) else {
        return Some(Vec::new());
    };
    if !parts[linked..].contains(&Component::ParentDir) {
        return Some(Vec::new());
    }
    let rest = |from: usize| {
        let rest: PathBuf = parts.iter().skip(from).collect();
        match rest.as_os_str().is_empty() {
            true => ".".to_string(),
            false => rest.to_string_lossy().into_owned(),
        }
    };
    let std_stream = |i: usize| ["stdin", "stdout", "stderr"].iter().any(|s| is(i, s));
    let mut out = Vec::new();
    for i in linked + 1..parts.len() {
        if is(i, "cwd") || std_stream(i) {
            out.push(rest(i + 1));
        } else if is(i, "fd") && name(i + 1).is_some() {
            out.push(rest(i + 2));
        } else if is(i, "root") {
            out.push(format!("/{}", rest(i + 1)));
        }
        if out.len() > MAX_LINKED {
            return None;
        }
    }
    Some(out)
}

/// `word` with POSIX backslash escapes removed: each `\` keeps the character
/// after it and drops itself.
fn unescape(word: &str) -> String {
    let mut out = String::with_capacity(word.len());
    let mut chars = word.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => out.extend(chars.next()),
            _ => out.push(c),
        }
    }
    out
}

/// True iff the confined shell may name `raw` (relative to `base`, where a
/// `cd` left it) even though it is in the Jan home: it sits in an attached
/// read root the sandbox mounts read-only, which a root also marked writable
/// is not. From the project root itself a relative path belongs to the
/// project, never a root. The gate's carve-out ([`HiddenRoot::carving`]) and
/// the shell's choice of where it may stand both ask this, so the shell
/// never holds a directory the gate would then refuse every command in.
pub fn shell_reads_attached_from(
    project_root: &Path,
    base: &Path,
    read_roots: &[PathBuf],
    write_roots: &[PathBuf],
    raw: &str,
) -> bool {
    let meter = Meter::unlimited();
    let carve = Carve::new(read_roots, write_roots, &meter);
    let base = Base::new(project_root, base, &meter);
    base.resolve(raw, &meter).is_ok_and(|resolved| carve.covers(&base, raw, &resolved))
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
///
/// Linear in the path's length: below a component that does not exist (and
/// is no link) nothing exists either, so the rest is appended without a
/// syscall until a `..` climbs back out. A syscall per component on the whole
/// prefix made one deep missing path a model sent cost the gate minutes.
pub(crate) fn canonicalize_lenient(path: &Path) -> Result<PathBuf, String> {
    canonicalize_metered(path, &Meter::unlimited())
}

/// [`canonicalize_lenient`] charging `meter` for the work it does; an error
/// once the meter runs out.
///
/// On Linux a limited meter skips the whole-path `canonicalize` and the
/// probes for the existing prefix, and walks from the root: `realpath` there
/// is glibc making the walk's own lookups, a component at a time, so the
/// result is the same, but a failing call tells nothing of what it spent (a
/// link into a deep directory walks all of it before a missing leaf fails),
/// so it could not be charged. Elsewhere the calls are kept, since they also
/// spell the path as the roots are spelled (case; Windows applies `..`
/// lexically), and a failing one is charged by the input's depth: a link
/// there can cost more than it is charged.
pub(crate) fn canonicalize_metered(path: &Path, meter: &Meter) -> Result<PathBuf, String> {
    use std::path::Component;
    let walk_all = meter.walks_all();
    if !walk_all {
        if let Some(p) = meter.canonicalize(path)? {
            return Ok(p);
        }
    }
    let abs = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| format!("current dir: {e}"))?
            .join(path)
    };
    let parts: Vec<Component> = abs.components().collect();
    let (seeded, resolved) = match walk_all {
        true => (0, PathBuf::new()),
        false => existing_prefix(&parts, meter)?,
    };
    walk(path, resolved, &parts[seeded..], meter)
}

/// [`canonicalize_lenient`] of a relative `raw` under `dir`, a canonical
/// directory: walked from `dir` without resolving it again, so many paths
/// under one deep directory do not each pay for its depth.
fn resolve_from(dir: &Path, raw: &str, meter: &Meter) -> Result<PathBuf, String> {
    let parts: Vec<std::path::Component> = Path::new(raw).components().collect();
    walk(Path::new(raw), dir.to_path_buf(), &parts, meter)
}

/// A budget for the path lookups one gate decision makes, shared by every
/// path it resolves, in components the OS walks: a lookup of a path `k`
/// components deep walks `k`. Charged with what the walk really does, the
/// components of a link's target and the depth it lands at included, not
/// estimated from the text: a short token through a link into a deep
/// directory costs as much as that directory is deep, and thousands of
/// them took the gate minutes.
///
/// Shared through `&self` (a `Cell`), as the gate's checks are closures
/// over one meter. Once a charge fails the meter stays spent, so a caller
/// that saw a path fail to resolve can tell running out from a path that
/// does not resolve, with [`Meter::spent`].
pub struct Meter {
    used: std::cell::Cell<usize>,
    /// `None` for callers outside the gate, which are not metered.
    budget: Option<usize>,
}

impl Meter {
    /// A meter that refuses past `budget` components walked.
    pub fn new(budget: usize) -> Self {
        Self { used: std::cell::Cell::new(0), budget: Some(budget) }
    }

    fn unlimited() -> Self {
        Self { used: std::cell::Cell::new(0), budget: None }
    }

    /// True when walks charged to this meter make every lookup themselves
    /// rather than ask `realpath` (see [`canonicalize_metered`]).
    fn walks_all(&self) -> bool {
        self.budget.is_some() && cfg!(any(target_os = "linux", target_os = "android"))
    }

    /// True once a charge went past the budget.
    pub fn spent(&self) -> bool {
        self.budget.is_some_and(|b| self.used.get() > b)
    }

    /// Add `cost`; an error once the budget is exceeded.
    pub fn charge(&self, cost: usize) -> Result<(), String> {
        self.used.set(self.used.get().saturating_add(cost));
        match self.spent() {
            true => Err("too complex to resolve within the gate's budget".to_string()),
            false => Ok(()),
        }
    }

    /// `path.canonicalize()` charged: `Ok(None)` when it fails, an error
    /// when the meter runs out (and then no call is made). `realpath` looks
    /// up every prefix of the path, and after an absolute link every prefix
    /// of where it leads, so a result `d` deep from an input `n` deep costs
    /// about `1 + .. + n` plus `1 + .. + d`. A failed call is charged as if
    /// it reached the input's depth; one that failed deep inside a dangling
    /// link's target is paid for again by the walk that follows, which
    /// splices that target in and charges each of its components.
    fn canonicalize(&self, path: &Path) -> Result<Option<PathBuf>, String> {
        // Refused before the call: a spent meter must stop the work, not
        // just report it afterwards.
        self.charge(0)?;
        let prefixes = |k: usize| k.saturating_mul(k + 1) / 2;
        let n = prefixes(path.components().count());
        match path.canonicalize() {
            Ok(real) => {
                self.charge(n.saturating_add(prefixes(real.components().count())))?;
                Ok(Some(real))
            }
            Err(_) => self.charge(n).map(|()| None),
        }
    }
}

/// The walk of [`canonicalize_lenient`]: `parts` resolved one at a time onto
/// `resolved`, which exists and is canonical (or is empty, and `parts`
/// starts at a root). `path` names the whole path in an error.
fn walk(
    path: &Path,
    mut resolved: PathBuf,
    parts: &[std::path::Component],
    meter: &Meter,
) -> Result<PathBuf, String> {
    use std::path::Component;
    // Linux's MAXSYMLINKS: the most hops `open` itself would follow.
    const MAX_HOPS: usize = 40;
    // Components still to resolve, next one last so a link splices onto the end.
    let mut pending: Vec<std::ffi::OsString> =
        parts.iter().rev().map(|c| c.as_os_str().to_owned()).collect();
    let mut hops = 0;
    // How many trailing components of `resolved` are not on disk; 0 while
    // all of it exists (and is canonical).
    let mut missing = 0usize;
    // Components in `resolved`: what a lookup of it walks, and is charged.
    let mut depth = resolved.components().count();
    while let Some(raw) = pending.pop() {
        match Path::new(&raw).components().next() {
            Some(Component::Prefix(_) | Component::RootDir) => {
                resolved.push(&raw);
                missing = 0;
                if let Some(root) = meter.canonicalize(&resolved)? {
                    resolved = root;
                }
                depth = resolved.components().count();
            }
            Some(Component::ParentDir) => {
                if resolved.pop() {
                    depth = depth.saturating_sub(1);
                }
                missing = missing.saturating_sub(1);
            }
            Some(Component::Normal(name)) if missing > 0 => {
                // Appended by hand: `push` onto a verbatim Windows path (the
                // project root is one) re-collects all of it, which would make
                // the walk quadratic again. `resolved` ends in a name here, so
                // it needs the separator.
                let s = resolved.as_mut_os_string();
                s.push(std::path::MAIN_SEPARATOR_STR);
                s.push(name);
                missing += 1;
                depth += 1;
            }
            Some(Component::Normal(name)) => {
                resolved.push(name);
                depth += 1;
                meter.charge(depth)?;
                // `lstat` first: a name that is not there costs one syscall,
                // where `canonicalize` would read every ancestor again first.
                let Ok(meta) = std::fs::symlink_metadata(&resolved) else {
                    missing = 1;
                    continue;
                };
                if !meta.file_type().is_symlink() {
                    if !spell_as_on_disk(&mut resolved, meter)? {
                        missing = 1;
                    }
                    continue;
                }
                // Through a link the lookup walks wherever it leads, which
                // may be far deeper than the text: charged by the result.
                // Where the meter walks all, the target is spliced in and
                // walked instead: one `realpath` through a chain of links
                // into a deep directory took seconds before it could be
                // charged.
                if !meter.walks_all() {
                    if let Some(real) = meter.canonicalize(&resolved)? {
                        depth = real.components().count();
                        resolved = real;
                        continue;
                    }
                }
                hops += 1;
                if hops > MAX_HOPS {
                    return Err(format!("too many levels of symbolic links in {:?}", path));
                }
                meter.charge(depth)?;
                let target = std::fs::read_link(&resolved)
                    .map_err(|e| format!("read link {:?}: {e}", resolved))?;
                // The link's name gives way to its target, whose components
                // are charged as they are walked.
                resolved.pop();
                depth = depth.saturating_sub(1);
                // An absolute target restarts from its own root when its
                // RootDir component is popped; a relative one stays here.
                pending.extend(target.components().rev().map(|c| c.as_os_str().to_owned()));
            }
            Some(Component::CurDir) | None => {}
        }
    }
    Ok(resolved)
}

/// Respell `path`, a canonical directory joined with a name on disk that is
/// no link, the way `canonicalize` would; false if that fails. On Linux it is
/// already spelled so (`realpath` only follows links), and skipping the call
/// saves a syscall per component of the whole prefix: a command of many
/// `dir/..` steps paid seconds for it.
#[cfg(any(target_os = "linux", target_os = "android"))]
fn spell_as_on_disk(path: &mut PathBuf, meter: &Meter) -> Result<bool, String> {
    let _ = (path, meter);
    Ok(true)
}

/// [`spell_as_on_disk`] where the disk may be case-insensitive (macOS,
/// Windows): `canonicalize` spells the name as stored, which is how the
/// roots it is compared with are spelled.
#[cfg(not(any(target_os = "linux", target_os = "android")))]
fn spell_as_on_disk(path: &mut PathBuf, meter: &Meter) -> Result<bool, String> {
    Ok(match meter.canonicalize(path)? {
        Some(real) => {
            *path = real;
            true
        }
        None => false,
    })
}

/// How many of `parts` (an absolute path's components) the OS resolves, up
/// to the first `..`, and their real path; `(0, empty)` when none does. The
/// walk in [`canonicalize_lenient`] starts from there: walked from the root,
/// each existing component costs a `canonicalize` of its whole prefix, so
/// every word of a command (a new leaf, as most are) paid that once per
/// ancestor of the project root.
///
/// A binary search, as the OS resolves a path one component at a time: once
/// a prefix fails every longer one does. That holds only without a `..`,
/// which Windows applies lexically before it opens anything, hence the cut.
/// Each probe stops at the first missing component, so it costs no more
/// than the existing part however long the path is. The deepest candidate
/// is probed first: for a new leaf, the usual miss, that is its directory,
/// found in one probe.
fn existing_prefix(
    parts: &[std::path::Component],
    meter: &Meter,
) -> Result<(usize, PathBuf), String> {
    use std::path::Component;
    let mut lead = parts.iter().take_while(|c| **c != Component::ParentDir).count();
    // The caller already tried the whole path.
    if lead == parts.len() {
        lead -= 1;
    }
    // Never a bare Windows prefix (`C:`): that names the drive's cwd.
    let root = parts
        .iter()
        .take_while(|c| matches!(c, Component::Prefix(_) | Component::RootDir))
        .count()
        .max(1);
    let real = |n: usize| meter.canonicalize(&parts[..n].iter().collect::<PathBuf>());
    if lead < root {
        return Ok((0, PathBuf::new()));
    }
    if let Some(path) = real(lead)? {
        return Ok((lead, path));
    }
    let (mut found, mut lo, mut hi) = ((0, PathBuf::new()), root, lead - 1);
    while lo <= hi {
        let mid = lo + (hi - lo) / 2;
        match real(mid)? {
            Some(path) => {
                found = (mid, path);
                lo = mid + 1;
            }
            None => hi = mid - 1,
        }
    }
    Ok(found)
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

    /// A test dir that is *not* under the host temp dir, as the real scratch
    /// (in the OS cache dir) is not, so a `/tmp` path can be told apart from
    /// it. Lives under the crate's `target/`, which is already build output.
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

    /// Nothing is mounted over `/tmp` any more, so a `/tmp/...` path is a
    /// plain host path: outside the project and the scratch it is an escape,
    /// and it resolves to itself rather than into the scratch.
    #[test]
    #[cfg(target_os = "linux")]
    fn tmp_is_a_plain_host_path_even_with_a_scratch() {
        let root = unique_root_outside_tmp();
        let scratch = unique_root_outside_tmp();
        assert_eq!(
            escapes_project(&root, Some(&scratch), "/tmp/ok.txt"),
            Ok(true),
            "the host /tmp is not the scratch"
        );
        assert_eq!(resolve_path(&root, "/tmp/a.txt"), Path::new("/tmp/a.txt"));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&scratch);
    }

    /// The scratch, reached by its real path, is the agent's own area on
    /// every platform, so it must not read as an escape. The scratch sits
    /// outside the host temp dir, as the real one (in the OS cache dir) does.
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

    /// The scratch check resolves symlinks: the shell can plant one inside
    /// the scratch, and a link is a single component that resolves elsewhere.
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

    /// `in_scratch` is lexical and component-wise: a sibling that merely
    /// shares the scratch's name as a prefix is not inside it.
    #[test]
    fn in_scratch_is_component_wise() {
        let scratch = PathBuf::from(if cfg!(windows) {
            r"C:\cache\jan\chat\scratch\s1"
        } else {
            "/cache/jan/chat/scratch/s1"
        });
        let file = scratch.join("out.txt");
        assert!(in_scratch(Some(&scratch), &file));
        assert!(in_scratch(Some(&scratch), &scratch));
        assert!(!in_scratch(Some(&scratch), &scratch.with_file_name("s10").join("x")));
        assert!(!in_scratch(Some(&scratch), Path::new("/elsewhere/out.txt")));
        assert!(!in_scratch(None, &file));
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
        assert_eq!(escapes_write_roots(&root, None, &[], "notes.md"), Ok(true));
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
        assert!(!escapes_read_roots(&ws, None, &roots, &target).unwrap());

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
        assert!(escapes_read_roots(&ws, None, &roots, &target).unwrap());
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
        assert!(escapes_read_roots(&ws, None, &roots, &target).unwrap());
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
        assert!(escapes_read_roots(&ws, None, &roots, "only-in-repo.txt").is_ok());
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
        assert!(in_hidden_root(&home, &jan, ".jan/config.toml"));
        assert!(in_hidden_root(&home, &jan, "./.jan/../.jan/config.toml"));
        assert!(in_hidden_root(&home, &jan, jan.join("config.toml").to_str().unwrap()));
        assert!(in_hidden_root(&home, &jan, ".jan"));
        assert!(in_hidden_root(&home, &jan, ".jan/projects/p-1/agent.toml"));
        // Not yet existing files are hidden too, so a write cannot create one.
        assert!(in_hidden_root(&home, &jan, ".jan/hooks.toml"));
        assert!(!in_hidden_root(&home, &jan, "JAN.md"));
        assert!(!in_hidden_root(&home, &jan, ".janitor"));
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
        assert!(!in_hidden_root(&wt, &jan, "src/main.rs"));
        assert!(!in_hidden_root(&wt, &jan, wt.to_str().unwrap()));
        assert!(in_hidden_root(&wt, &jan, "../../../config.toml"));
        assert!(in_hidden_root(&wt, &jan, jan.join("config.toml").to_str().unwrap()));
        let _ = std::fs::remove_dir_all(&home);
    }

    fn command_touches_hidden_root(project: &Path, hidden: &Path, cmd: &str) -> bool {
        hidden_tokens(hidden, cmd)
            .unwrap()
            .iter()
            .any(|t| in_hidden_root(project, hidden, t))
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
            assert!(command_touches_hidden_root(&project, &jan, cmd), "{cmd}");
        }
        let abs = format!("cat '{}'", jan.join("config.toml").display());
        assert!(command_touches_hidden_root(&project, &jan, &abs));
        assert!(!command_touches_hidden_root(&project, &jan, "cat ~/.bashrc"));
        assert!(!command_touches_hidden_root(&project, &jan, "ls -la src"));
        let _ = std::fs::remove_dir_all(&home);
    }

    /// Every word is a token, whatever shell syntax surrounds it: quotes,
    /// escapes, redirects, substitutions, expansions, arrays, assignments,
    /// extglobs, tests and heredocs. Telling a command name from an argument
    /// takes a shell parser, and each guess at one hid a path.
    #[test]
    fn hidden_tokens_keep_words_after_quoted_or_closing_separators() {
        let home = unique_root();
        let jan = home.join(".jan");
        std::fs::create_dir_all(&jan).unwrap();
        let project = home.join("proj");
        std::fs::create_dir_all(&project).unwrap();
        for command in [
            "grep -E \"a|b\" .jan",
            "cat 'x;' .jan",
            "tar czf /tmp/k.tgz \"$(true)\" .jan",
            "cd \"$(true)\".jan && cat config.toml",
            "GIT_DIR=\".jan\" git log",
            "ls &>/dev/null .jan",
            "echo \\; .jan",
            "tar czf - -T - <<E\n.jan\nE",
            "tar czf - -T - <<-'E'\n\t.jan\n\tE\nls",
            "tar czf backup-\"$(date +%F)\".tgz .jan",
            "cat `true` .jan",
            "ls >|/dev/null .jan",
            "ls 2>&1 .jan",
            "echo \"`true`\" .jan",
            "x`true` .jan",
            "cat \\.jan",
            "cat \"$HOME/.jan\"",
            "'.jan'",
            "x=(.jan)",
            "cat <<<.jan",
            "echo \"\\\\$(true)\" .jan",
            "true || cat .jan",
            "sh -c 'cat .jan/config.toml'",
            "a=(\n  .jan/k\n)",
            "cat ${f%;} .jan",
            "ls ${x:-|} .jan",
            "NODE_OPTIONS=--require=.jan/x.js node a.js",
            "X+=~/.jan/k cmd",
            "X+=.jan cmd",
            "ls @(.jan|x)",
            "[[ -n x && .jan -nt y ]]",
            "tar czf - -T - <<\"E\\\\x\"\nEx\n.jan\nE\\\\x",
            "<<E\nx\\\nE\n.jan\nE",
        ] {
            let tokens = hidden_tokens(&jan, command).unwrap();
            assert!(
                tokens.iter().any(|t| in_hidden_root_from(&project, &home, &jan, t)),
                "{command:?}: {tokens:?}"
            );
        }
        // A Windows path stays whole: a backslash separates its components
        // there, which is how it resolves into the home on Windows.
        for (command, token) in [
            ("Get-Content .jan\\config.toml", ".jan\\config.toml"),
            ("type C:\\Users\\me\\.jan\\config.toml", "C:\\Users\\me\\.jan\\config.toml"),
        ] {
            let tokens = hidden_tokens(&jan, command).unwrap();
            assert!(tokens.iter().any(|t| t == token), "{command:?}: {tokens:?}");
        }
        #[cfg(windows)]
        assert!(hidden_tokens(&jan, "Get-Content .jan\\config.toml")
            .unwrap()
            .iter()
            .any(|t| in_hidden_root_from(&project, &home, &jan, t)));
        // Command names are tokens too: from a cwd in the home they resolve
        // there, and only the gate's carve-out lets them through.
        assert_eq!(
            hidden_tokens(Path::new("/h/.jan"), "cd /p && ls src | git diff; F=~/.jan/c cat")
                .unwrap(),
            ["cd", "/p", "ls", "src", "git", "diff", "F", "/h/.jan/c", "cat"]
        );
        let _ = std::fs::remove_dir_all(&home);
    }

    /// A command whose tokens would take the gate too long to resolve is
    /// reported as uncheckable (`None`), which the gate refuses; an ordinary
    /// long command, and a `..` under `/proc` with a few globs, is scanned.
    #[test]
    fn hidden_tokens_give_up_on_a_command_too_complex_to_check() {
        let jan = Path::new("/h/.jan");
        let many = "a ".repeat(MAX_TOKENS + 1);
        assert_eq!(hidden_tokens(jan, &many), None);
        let long = format!("cat {}", "x".repeat(MAX_TOKEN_BYTES + 1));
        assert_eq!(hidden_tokens(jan, &long), None);
        // A deep path is the gate's budget to refuse (`resolve_cost`), not
        // the scan's: the scan hands it back whole.
        let deep = format!("cat {}", "a/".repeat(100_000));
        assert_eq!(hidden_tokens(jan, &deep).map(|t| t.len()), Some(2));
        let shallow = format!("cat {}", "a/".repeat(1000));
        assert!(hidden_tokens(jan, &shallow).is_some());
        let globs = |n: usize| format!("cat /proc/..{}", "/*".repeat(n));
        assert_eq!(hidden_tokens(jan, &globs(MAX_LINKED + 1)), None);
        // The two words, `start_dir_relative`'s one and a candidate per glob.
        let tokens = hidden_tokens(jan, &globs(3)).unwrap();
        assert_eq!(tokens.len(), 2 + 1 + 3, "{tokens:?}");
        let script = "cat <<E > notes.md\nsome ordinary words\nE\n".repeat(2000);
        assert!(hidden_tokens(jan, &script).is_some());
    }

    /// A path that stops existing early costs no syscall per missing
    /// component, so its resolution is linear in its length: a quadratic walk
    /// took minutes on a path of this shape, which a model can send as one
    /// tool argument.
    #[test]
    fn a_deep_missing_path_resolves_in_linear_time() {
        let root = unique_root();
        let comp = format!("{}/", "a".repeat(63));
        let deep = root.join("missing").join(comp.repeat(DEEP));
        let start = std::time::Instant::now();
        let resolved = canonicalize_lenient(&deep).unwrap();
        let took = start.elapsed();
        assert!(took < std::time::Duration::from_secs(5), "{took:?}");
        assert_eq!(resolved, root.canonicalize().unwrap().join("missing").join(comp.repeat(DEEP)));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Components after a missing one that climb back out of it with `..`
    /// reach the disk again, so a link there is still followed.
    #[cfg(unix)]
    #[test]
    fn a_climb_out_of_a_missing_tail_follows_links_again() {
        let root = unique_root();
        let outside = unique_root();
        std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
        let climb = format!("missing/{}{}link/x", "a/".repeat(1000), "../".repeat(1001));
        assert_eq!(
            canonicalize_lenient(&root.join(&climb)).unwrap(),
            outside.canonicalize().unwrap().join("x")
        );
        assert_eq!(escapes_project(&root, None, &climb), Ok(true));
        // One `..` short stays in the missing tail, where nothing is a link.
        let short = format!("missing/{}{}link/x", "a/".repeat(1000), "../".repeat(1000));
        assert_eq!(
            canonicalize_lenient(&root.join(&short)).unwrap(),
            root.canonicalize().unwrap().join("missing/link/x")
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// The gate's metered walk skips the whole-path `canonicalize` and the
    /// prefix probes, but must land where the unmetered one does: through
    /// links absolute, relative and dangling, a regular file mid-path, `..`
    /// after a link and a missing tail.
    #[cfg(unix)]
    #[test]
    fn the_metered_walk_resolves_as_the_unmetered_one() {
        use std::os::unix::fs::symlink;
        let root = unique_root();
        let outside = unique_root();
        std::fs::create_dir_all(root.join("a/b")).unwrap();
        std::fs::write(root.join("a/f"), b"x").unwrap();
        symlink(&outside, root.join("abs")).unwrap();
        symlink("a/b", root.join("rel")).unwrap();
        symlink("../nowhere/x", root.join("a/dangling")).unwrap();
        symlink("loop", root.join("loop")).unwrap();
        let raws = [
            "", "a", "a/b", "a/f", "a/f/x", "a/f/../b", "abs", "abs/new", "abs/..",
            "rel/../f", "rel/../../a", "a/dangling", "a/dangling/y", "loop", "missing/x/..",
            "missing/../rel/z", "./a//b/./", "../",
        ];
        for raw in raws {
            let path = root.join(raw);
            let meter = Meter::new(MAX_RESOLVE_COST);
            assert_eq!(canonicalize_metered(&path, &meter), canonicalize_lenient(&path), "{raw}");
            assert!(!meter.spent(), "{raw}");
        }
        // A spent meter refuses rather than answering.
        let meter = Meter::new(1);
        assert!(canonicalize_metered(&root.join("a/b"), &meter).is_err());
        assert!(meter.spent());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// Components in the path of the timing test, 63 bytes each: a 4 MB path,
    /// just under the scan's byte cap, which a quadratic walk took minutes on.
    const DEEP: usize = 65_000;

    /// The cost is quadratic in a path's own depth and charges a bare word
    /// the depth of the directory it is resolved in.
    #[test]
    fn resolve_cost_grows_with_depth() {
        assert_eq!(resolve_cost(10, "word"), 11);
        assert_eq!(resolve_cost(10, "src/a/b/c.rs"), 4 * 14);
        assert_eq!(resolve_cost(10, "/usr/lib/x.so"), 4 * 4);
        assert!(resolve_cost(0, &"a/".repeat(2048)) > MAX_RESOLVE_COST);
        assert!(resolve_cost(10, &"a/".repeat(2000)) <= MAX_RESOLVE_COST);
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
}
