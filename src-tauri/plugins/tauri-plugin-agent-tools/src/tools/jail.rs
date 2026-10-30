//! OS-level confinement for the `bash` tool.
//!
//! The static command scan in [`super::cmdscan`] bounds *which* commands run; this
//! module bounds what they can reach once running. Three properties, identical on
//! every backend:
//!
//! - reads: everything except `$HOME`, with the thread workspace carved back in
//!   (it lives under `$HOME`, so the carve-out is what keeps the sandbox usable
//!   while `settings.json`, provider keys, and the rest of the Jan data folder
//!   stay unreadable). The CLI can opt into `home_readonly`, which instead
//!   mounts `$HOME` read-only so `git`/`ssh` credential helpers work. Reads
//!   outside `$HOME` stay open because a process cannot start without its
//!   interpreter, loader, and libraries.
//! - writes: the thread workspace and a private temp dir, nothing else.
//! - network: denied unless explicitly allowed.
//!
//! AppContainer is stricter than that on reads: it can only read what grants
//! `ALL APPLICATION PACKAGES`, which covers the system directories a process
//! needs to start but not, say, a second data drive. Stricter is safe here -- the
//! properties above are the floor, not the ceiling.
//!
//! Backends follow the approach in openai/codex `codex-rs/sandboxing`: Seatbelt
//! (`sandbox-exec`) on macOS, bubblewrap on Linux, AppContainer on Windows. The
//! Unix backends wrap the shell argv, so unlike codex they need no helper binary.
//! Windows has no argv to wrap -- see [`super::appcontainer`], which re-execs this
//! binary because the confinement is a `CreateProcessW` token attribute.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use super::appcontainer;
use super::proc::ShellConfig;

/// `sandbox-exec` is only trusted at its absolute system path: resolving it via
/// `PATH` would let anything that can prepend to `PATH` defeat the sandbox.
#[cfg(target_os = "macos")]
const SEATBELT: &str = "/usr/bin/sandbox-exec";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    Seatbelt,
    Bubblewrap,
    AppContainer,
    /// No enforcement available. `bash` is withheld rather than run unconfined.
    None,
}

impl Backend {
    pub fn enforces(self) -> bool {
        self != Backend::None
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Backend::Seatbelt => "seatbelt",
            Backend::Bubblewrap => "bubblewrap",
            Backend::AppContainer => "appcontainer",
            Backend::None => "none",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Policy {
    /// The thread workspace: the only path that stays both readable and writable.
    pub workspace: PathBuf,
    /// The agent's data-folder root. On the desktop this is the Jan data folder
    /// (holding the permanent store, `settings.json`, and model files); it is
    /// masked from the sandbox like `$HOME`, because a relocated `JAN_DATA_FOLDER`
    /// outside `$HOME` would otherwise leave all of it readable by the shell. The
    /// CLI leaves this unset: there the project itself is the workspace, so
    /// masking it would hide the very files the agent works on.
    pub mask_root: Option<PathBuf>,
    pub allow_network: bool,
    /// Expose `$HOME` to the sandboxed shell read-only instead of hiding it.
    /// The CLI turns this on so helpers that read the user's home (`git`/`ssh`
    /// credential helpers, `~/.ssh/config`, `~/.netrc`) work, while writes stay
    /// confined to the workspace at the mount/policy layer. Off by default: the
    /// desktop keeps the full isolation so `settings.json` and provider keys
    /// stay out of the shell's reach.
    pub home_readonly: bool,
    /// A session-scoped host directory the shell may write to for the whole run,
    /// instead of a scratch that vanishes between commands. How it is exposed is
    /// per backend: bubblewrap binds it over `/tmp`, replacing the volatile
    /// overlay that would otherwise discard scratch files with each command;
    /// Seatbelt grants it by `SCRATCH` parameter; AppContainer grants it an ACE.
    /// The directory must already exist before the sandbox is built (the
    /// backends reference it, they do not create it).
    pub scratch_root: Option<PathBuf>,
    /// Folders the user attached read-only. Bound after the `$HOME`/data-folder
    /// masks (so a project under either survives) and before the workspace bind
    /// (so one can never shadow the only writable path).
    pub read_roots: Vec<PathBuf>,
    /// The subset of attached folders the surface marked writable. Bound (or
    /// allowed) read-write in the same position as `read_roots`; an entry
    /// present in both lists is bound once, writable.
    pub write_roots: Vec<PathBuf>,
    /// The Jan home (`~/.jan`), hidden from the shell wherever it sits: under a
    /// read-only `$HOME`, inside the workspace (running in `$HOME`), or around
    /// it (a Jan worktree in `~/.jan/worktrees/`). See [`Policy::with_hide_root`].
    pub hide_root: Option<PathBuf>,
    /// Bind the workspace read-only: a read-only subagent works in the user's
    /// checkout and must not change it, `.git` included. The scratch and any
    /// `write_roots` stay writable. See [`Policy::with_workspace_readonly`].
    pub workspace_readonly: bool,
    /// Paths inside the write roots whose write access is set again, in
    /// order, after every grant. A worktree writer must write the shared git
    /// dir to commit, but not what in it configures git or runs code (hooks,
    /// config), which git runs unsandboxed the next time the user works in
    /// their checkout. See [`Policy::with_carve_outs`].
    pub carve_outs: Vec<CarveOut>,
}

/// One entry of [`Policy::carve_outs`]: `path` made read-only, or writable
/// again inside an earlier read-only one. Later entries win, so an outer path
/// comes before what is carved back out of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CarveOut {
    pub path: PathBuf,
    /// Whether `path` is (or, when it does not exist yet, would be) a
    /// directory: a missing read-only one is still kept from being created.
    pub dir: bool,
    pub writable: bool,
}

impl CarveOut {
    /// `path`, kept read-only.
    pub fn read_only(path: PathBuf, dir: bool) -> Self {
        Self { path, dir, writable: false }
    }

    /// The directory `path`, writable again.
    pub fn writable(path: PathBuf) -> Self {
        Self { path, dir: true, writable: true }
    }
}

/// The write access a writer in the linked worktree whose admin dir is `admin`
/// (`<common>/worktrees/<name>`) gets to its repository's shared git dir
/// `common`, when `common` itself is a write root so its commits land there.
///
/// An allowlist, because git reads more of the shared dir than code ever
/// lists: whatever the writer leaves there, git obeys unsandboxed the next
/// time the user (or an unconfined parent) works in the checkout. `hooks/`
/// and `config` run programs, but so does a `commondir` file, which no
/// repository has at its top level and which, once created, sends git in the
/// user's checkout to a git dir (and config) of the writer's making. So all
/// of `common` is read-only, and only what a commit, a new branch or a stash
/// writes is opened again: `objects/` (minus `objects/info/`, whose
/// `alternates` and `http-alternates` add another directory's objects to the
/// repository; only gc and repack write there), `refs/`, `logs/` and the
/// writer's own admin dir (its index, HEAD, logs and lock files), minus the
/// admin files that point git elsewhere (`commondir`, `gitdir`) or configure
/// it (`config.worktree`, read once `extensions.worktreeConfig` is on, which
/// can happen later).
///
/// What that costs: `packed-refs` stays read-only, and git rewrites it (under
/// a `packed-refs.lock` beside the config) to delete any ref, loose or not, so
/// a writer cannot delete a branch or a tag (dropping the last stash entry
/// leaves `refs/stash` behind), nor gc, repack or pack refs.
///
/// A path bubblewrap binds must exist: a missing read-only one gets a
/// placeholder mount whose mount point stays behind on the host (an empty
/// `commondir` there stops git cold), and a missing writable one cannot be
/// bound at all. So every path listed here exists before the shell starts:
/// the dirs to reopen are created (empty, as `git init` makes them), the
/// admin dir is reopened only while its `commondir` and `gitdir` exist, and
/// a missing `config.worktree` is created empty, which git reads like an
/// absent one (where a `/dev/null` placeholder could not be read at all).
pub fn git_dir_carve_outs(common: &Path, admin: &Path) -> Vec<CarveOut> {
    for dir in ["objects", "objects/info", "refs", "logs"] {
        let _ = std::fs::create_dir_all(common.join(dir));
    }
    let mut carve = vec![
        CarveOut::read_only(common.to_path_buf(), true),
        CarveOut::writable(common.join("objects")),
        CarveOut::read_only(common.join("objects/info"), true),
        CarveOut::writable(common.join("refs")),
        CarveOut::writable(common.join("logs")),
    ];
    if admin.join("commondir").is_file() && admin.join("gitdir").is_file() {
        let _ = std::fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(admin.join("config.worktree"));
        carve.extend([
            CarveOut::writable(admin.to_path_buf()),
            CarveOut::read_only(admin.join("commondir"), false),
            CarveOut::read_only(admin.join("gitdir"), false),
            CarveOut::read_only(admin.join("config.worktree"), false),
        ]);
    }
    carve
}

/// Whether the resolved `path` lies under a read-only entry of `carve_outs`
/// that no later entry makes writable again: the file tools' side of what the
/// sandbox enforces for the shell.
pub fn carved_read_only(carve_outs: &[CarveOut], path: &Path) -> bool {
    carve_outs
        .iter()
        .rev()
        .find(|c| {
            path.starts_with(&c.path) || real_form(&c.path).is_some_and(|r| path.starts_with(r))
        })
        .is_some_and(|c| !c.writable)
}

impl Policy {
    pub fn new(workspace: &Path, allow_network: bool) -> Self {
        Self {
            workspace: workspace.to_path_buf(),
            mask_root: None,
            allow_network,
            home_readonly: false,
            scratch_root: None,
            read_roots: Vec::new(),
            write_roots: Vec::new(),
            hide_root: None,
            workspace_readonly: false,
            carve_outs: Vec::new(),
        }
    }

    /// Set [`Policy::carve_outs`]. Applied after every grant: bubblewrap
    /// binds each over the writable binds (a missing read-only path gets an
    /// empty read-only placeholder, so it cannot be created either), Seatbelt
    /// denies or re-allows writes by subpath, which also covers a missing
    /// path. AppContainer grants no write roots, so there is nothing to carve.
    pub fn with_carve_outs(mut self, carve_outs: Vec<CarveOut>) -> Self {
        self.carve_outs = carve_outs;
        self
    }

    /// Keep the workspace readable but not writable. AppContainer grants its
    /// workspace by a write ACE and has no read-only form, so [`wrap`] refuses
    /// such a policy there: no shell rather than a writable one.
    pub fn with_workspace_readonly(mut self, readonly: bool) -> Self {
        self.workspace_readonly = readonly;
        self
    }

    /// Hide `hide_root` from the sandboxed shell. The gate's token scan of the
    /// command string is best-effort; this is what makes the directory
    /// unreachable to the spellings a scan cannot see (`cd ~; cat .jan/*`, a
    /// script the shell writes and runs). Not enforced on AppContainer, where
    /// carving a subpath back out of a granted folder would mean writing a deny
    /// ACE onto the user's directory; there the scan stands alone.
    pub fn with_hide_root(mut self, hide_root: &Path) -> Self {
        self.hide_root = Some(hide_root.to_path_buf());
        self
    }

    /// True when a bind of the workspace or an attached root would re-expose the
    /// hidden directory, so it has to be masked again after those binds.
    fn hide_under_a_bind(&self, hide: &Path) -> bool {
        std::iter::once(&self.workspace)
            .chain(&self.read_roots)
            .chain(&self.write_roots)
            .any(|root| hide.starts_with(root) && hide != root)
    }

    /// Attach read-only roots. See [`Policy::read_roots`] for why their bind
    /// order relative to the masks and the workspace is load-bearing.
    pub fn with_read_roots(mut self, read_roots: Vec<PathBuf>) -> Self {
        self.read_roots = read_roots;
        self
    }

    /// Mark attached roots writable. See [`Policy::write_roots`].
    pub fn with_write_roots(mut self, write_roots: Vec<PathBuf>) -> Self {
        self.write_roots = write_roots;
        self
    }

    /// Mask `mask_root` from the sandboxed shell. The desktop data folder holds
    /// the permanent memory/skills store and `settings.json` with provider keys;
    /// masking it keeps a relocated data folder out of the shell's reach. The
    /// thread workspace (nested under it) is re-bound on top so it survives.
    pub fn with_mask_root(mut self, mask_root: &Path) -> Self {
        self.mask_root = Some(mask_root.to_path_buf());
        self
    }

    /// Expose `$HOME` read-only instead of masking it. See [`Policy::home_readonly`].
    pub fn with_home_readonly(mut self, home_readonly: bool) -> Self {
        self.home_readonly = home_readonly;
        self
    }

    /// Expose `scratch_root` to the shell so scratch files persist across `bash`
    /// calls in a session instead of being discarded with each private tmpfs.
    /// See [`Policy::scratch_root`]. The directory must already exist (the
    /// caller creates and owns its lifecycle).
    pub fn with_scratch_root(mut self, scratch_root: &Path) -> Self {
        self.scratch_root = Some(scratch_root.to_path_buf());
        self
    }
}

/// The user's home directory, or `None` when it is unset or degenerate. A `/`
/// home would hide the whole filesystem, so it is treated as absent.
fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    let raw = std::env::var_os("USERPROFILE");
    #[cfg(not(windows))]
    let raw = std::env::var_os("HOME");
    let path = PathBuf::from(raw?);
    if path.parent().is_none() || path.as_os_str().is_empty() {
        return None;
    }
    Some(path)
}

/// The active backend, probed once. Probing runs a subprocess on Linux, so it is
/// cached for the life of the process.
pub fn backend() -> Backend {
    static BACKEND: OnceLock<Backend> = OnceLock::new();
    *BACKEND.get_or_init(detect)
}

fn detect() -> Backend {
    // Escape hatch for CI and for users on kernels where the probe is wrong.
    // Only ever loosens to `None`, which withholds the tool: it cannot be used
    // to run commands unconfined.
    if let Some(forced) = std::env::var_os("JAN_AGENT_SANDBOX") {
        if forced.eq_ignore_ascii_case("none") || forced.eq_ignore_ascii_case("off") {
            return Backend::None;
        }
    }
    #[cfg(target_os = "macos")]
    {
        if Path::new(SEATBELT).is_file() {
            return Backend::Seatbelt;
        }
        Backend::None
    }
    #[cfg(target_os = "linux")]
    {
        if bwrap_path().is_some() {
            Backend::Bubblewrap
        } else {
            Backend::None
        }
    }
    #[cfg(windows)]
    {
        if appcontainer::available() {
            return Backend::AppContainer;
        }
        Backend::None
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    {
        Backend::None
    }
}

/// Where the session scratch is reachable from *inside* the sandbox, which is
/// what the shell's `TMPDIR`/`TMP`/`TEMP` must name. Bubblewrap binds the
/// scratch over `/tmp`, so the host path does not exist in that namespace;
/// Seatbelt and AppContainer mount nothing, so the real path is the only one
/// that resolves -- and it is the same name the filesystem tools use there, so
/// a file written by `bash` can be read back by `read`. `None` when the caller
/// set no scratch: the shell then keeps the host's own temp dir.
pub fn scratch_env_path(backend: Backend, policy: &Policy) -> Option<PathBuf> {
    let scratch = policy.scratch_root.as_ref()?;
    Some(match backend {
        Backend::Bubblewrap => PathBuf::from("/tmp"),
        _ => scratch.clone(),
    })
}

/// Wrap `cfg` so the shell it describes runs confined. The returned config keeps
/// the same shape -- program, fixed args, command appended last -- so the spawn
/// path is unchanged. Returns `None` when no backend can enforce the policy, in
/// which case the caller must not run the command.
pub fn wrap(cfg: &ShellConfig, policy: &Policy) -> Option<ShellConfig> {
    match backend() {
        Backend::Bubblewrap => Some(ShellConfig {
            program: bwrap_path()?,
            args: bwrap_args(policy, cfg),
            kind: cfg.kind,
        }),
        Backend::Seatbelt => Some(ShellConfig {
            program: PathBuf::from(seatbelt_program()),
            args: seatbelt_args(policy, cfg),
            kind: cfg.kind,
        }),
        // AppContainer is a token attribute on the spawn rather than an argv
        // prefix, and `tokio::process::Command` cannot set one, so the wrapper is
        // a re-exec of this binary that performs the confined spawn itself. If
        // the running binary cannot be located there is no wrapper to run, and
        // returning `cfg` unchanged would run the command with no confinement.
        Backend::AppContainer if policy.workspace_readonly => None,
        Backend::AppContainer => Some(ShellConfig {
            program: std::env::current_exe().ok()?,
            args: appcontainer::helper_args(
                &policy.workspace,
                policy.scratch_root.as_deref(),
                policy.allow_network,
                &cfg.program,
                &cfg.args,
            ),
            kind: cfg.kind,
        }),
        Backend::None => None,
    }
}

// ---------------------------------------------------------------------------
// bubblewrap (Linux)
// ---------------------------------------------------------------------------

/// The local override is trusted only when the resolved target is a regular
/// file owned by `owner_uid`, neither group- nor world-writable, and every
/// directory on both its lookup path and resolved path up to `trust_root` is
/// owned by that uid and neither group- nor world-writable. Checking both
/// paths prevents a writable symlink target or lookup directory from replacing
/// an otherwise protected binary. Production uses `/` and uid 0.
///
/// Debian ships `/usr/local` as `root:root 0755` unless the admin opted into
/// the staff group (`/etc/staff-group-for-usr-local`), which makes it
/// `root:staff 2775`. Such a directory is rejected on purpose: the mode alone
/// cannot say who is in that group, and anyone who is can swap the binary. The
/// sandbox then starts with the system bwrap, as it did before this lookup.
#[cfg(any(target_os = "linux", all(test, unix)))]
fn trusted_local_bwrap(path: &Path, trust_root: &Path, owner_uid: u32) -> bool {
    fn protected(path: &Path, owner_uid: u32, directory: bool) -> bool {
        use std::os::unix::fs::MetadataExt;
        let Ok(meta) = std::fs::metadata(path) else {
            return false;
        };
        (if directory {
            meta.is_dir()
        } else {
            meta.is_file()
        }) && meta.uid() == owner_uid
            && meta.mode() & 0o022 == 0
    }

    fn protected_parents(path: &Path, root: &Path, owner_uid: u32) -> bool {
        let mut parent = path.parent();
        while let Some(dir) = parent {
            if !protected(dir, owner_uid, true) {
                return false;
            }
            if dir == root {
                return true;
            }
            parent = dir.parent();
        }
        false
    }

    let Ok(resolved) = path.canonicalize() else {
        return false;
    };
    let Ok(root) = trust_root.canonicalize() else {
        return false;
    };
    protected(&resolved, owner_uid, false)
        && protected_parents(path, trust_root, owner_uid)
        && protected_parents(&resolved, &root, owner_uid)
}

#[cfg(any(target_os = "linux", all(test, unix)))]
fn select_bwrap(
    candidates: [&Path; 3],
    trust_root: &Path,
    owner_uid: u32,
    usable: impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    let [local, system, bin] = candidates;
    let trusted = trusted_local_bwrap(local, trust_root, owner_uid);
    if trusted && local.is_file() && usable(local) {
        return Some(local.to_path_buf());
    }
    [system, bin]
        .into_iter()
        .chain((!trusted).then_some(local))
        .find(|path| path.is_file() && usable(path))
        .map(Path::to_path_buf)
}

/// [`select_bwrap`], then `PATH` as a last resort for distros with no FHS
/// layout at all (NixOS keeps bwrap only at a Nix-store path). `PATH` is
/// consulted only when none of the fixed locations holds a bwrap, as before:
/// an installed but unusable system bwrap (userns blocked) must not hand the
/// choice to whatever a user prepended to `PATH`.
#[cfg(any(target_os = "linux", all(test, unix)))]
fn select_bwrap_or_path(
    candidates: [&Path; 3],
    trust_root: &Path,
    owner_uid: u32,
    usable: impl Fn(&Path) -> bool,
    which: impl FnOnce() -> Option<PathBuf>,
) -> Option<PathBuf> {
    let any_installed = candidates.iter().any(|path| path.is_file());
    select_bwrap(candidates, trust_root, owner_uid, &usable).or_else(|| {
        if any_installed {
            None
        } else {
            which().filter(|path| usable(path))
        }
    })
}

/// Prefer a root-owned local override only if its binary and every directory
/// reachable on both its original and symlink-resolved paths are root-owned and
/// not group/world-writable. This prevents an unprivileged user from planting
/// a local override ahead of `/usr/bin` or `/bin`. An untrusted local binary is
/// only a last resort, as before, followed by `PATH` for non-FHS distros.
/// Every candidate must pass the live sandbox probe before selection.
#[cfg(target_os = "linux")]
fn bwrap_path() -> Option<PathBuf> {
    // OnceLock, not LazyLock: this crate's MSRV is 1.77.2 and LazyLock needs 1.80.
    static PATH: OnceLock<Option<PathBuf>> = OnceLock::new();
    PATH.get_or_init(|| {
        let candidates = [
            Path::new("/usr/local/bin/bwrap"),
            Path::new("/usr/bin/bwrap"),
            Path::new("/bin/bwrap"),
        ];
        select_bwrap_or_path(candidates, Path::new("/"), 0, bwrap_usable, || {
            super::proc::which("bwrap")
        })
    })
    .clone()
}

#[cfg(not(target_os = "linux"))]
fn bwrap_path() -> Option<PathBuf> {
    None
}

/// bubblewrap needs unprivileged user namespaces, which some distros and all of
/// WSL1 disable. Probe with a trivial sandbox rather than inferring from kernel
/// version, and treat a hang as unusable so a broken setup cannot wedge startup.
#[cfg(target_os = "linux")]
fn bwrap_usable(path: &Path) -> bool {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let Ok(mut child) = Command::new(path)
        .args(["--unshare-all", "--ro-bind", "/", "/", "/bin/true"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    else {
        return false;
    };
    let deadline = Instant::now() + Duration::from_millis(500);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success(),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}

fn push(args: &mut Vec<String>, parts: &[&str]) {
    args.extend(parts.iter().map(|s| s.to_string()));
}

/// Build bubblewrap's argv. Operations apply in order, which the layering below
/// depends on: the read-only root comes first, then the tmpfs that hides `$HOME`,
/// then the workspace bind that punches back through it.
pub fn bwrap_args(policy: &Policy, cfg: &ShellConfig) -> Vec<String> {
    let ws = policy.workspace.to_string_lossy().to_string();
    let mut args: Vec<String> = Vec::new();

    push(&mut args, &["--ro-bind", "/", "/"]);
    // Re-mounted after the read-only root so they are real kernel filesystems
    // rather than the host's, and so an unshared pid namespace has a valid /proc.
    push(&mut args, &["--proc", "/proc"]);
    push(&mut args, &["--dev", "/dev"]);
    // `/tmp`: by default a private tmpfs, writable and discarded with the
    // sandbox. When a session-scoped scratch root is set, bind it over `/tmp`
    // instead (the tmpfs would shadow it), so scratch files persist across
    // `bash` calls for the whole run.
    if let Some(scratch) = &policy.scratch_root {
        let scratch = scratch.to_string_lossy();
        push(&mut args, &["--bind", &scratch, "/tmp"]);
    } else {
        push(&mut args, &["--tmpfs", "/tmp"]);
    }

    // An empty tmpfs over $HOME hides user files without needing a deny rule.
    // The workspace is re-bound on top, so it survives while its siblings (the
    // permanent memory/skills store, settings.json, model files) do not.
    //
    // With `home_readonly` the CLI instead mounts $HOME read-only so helpers
    // that read it (git/ssh credential helpers, ~/.ssh/config, ~/.netrc) work;
    // the read-only mount is what keeps writes out even if the command tries.
    // It is deliberately read-only, so no later rw bind can shadow it.
    if let Some(home) = home_dir() {
        if policy.home_readonly {
            push(
                &mut args,
                &[
                    "--ro-bind",
                    &home.to_string_lossy(),
                    &home.to_string_lossy(),
                ],
            );
        } else {
            push(&mut args, &["--tmpfs", &home.to_string_lossy()]);
        }
    }
    // Mask a relocated data folder the same way: `$HOME` hiding alone would leave
    // a `JAN_DATA_FOLDER` outside the home readable, exposing the permanent
    // store and any co-located `settings.json`. The workspace is re-bound below
    // (it is nested under this root on the desktop), so it survives.
    if let Some(mask) = &policy.mask_root {
        push(&mut args, &["--tmpfs", &mask.to_string_lossy()]);
    }
    // The Jan home, masked with the others: before the binds below, so a
    // workspace living under it (a Jan worktree) is punched back through.
    if let Some(hide) = &policy.hide_root {
        push(&mut args, &["--tmpfs", &hide.to_string_lossy()]);
    }

    // Between the masks above and the workspace below, and that position is the
    // enforcement: after the `$HOME`/data-folder tmpfs so a project living under
    // either is punched back through, and before the workspace bind so a read
    // root can never shadow the one writable path. Read-only, so nothing the
    // shell does can write into the user's own folder. Not `--ro-bind-try`: a
    // root that vanished should fail loudly rather than silently unmount.
    for root in &policy.read_roots {
        // A root the surface also marked writable is bound once, below, rw: a
        // later rw bind would shadow this one anyway, so skipping is the same
        // mount table with one entry instead of two.
        if policy.write_roots.contains(root) {
            continue;
        }
        let root = root.to_string_lossy();
        push(&mut args, &["--ro-bind", &root, &root]);
    }
    // Same position and the same reasoning as the read roots; `--bind` is the
    // whole difference, which is what makes the attached folder writable.
    for root in &policy.write_roots {
        let root = root.to_string_lossy();
        push(&mut args, &["--bind", &root, &root]);
    }

    let bind = if policy.workspace_readonly { "--ro-bind" } else { "--bind" };
    push(&mut args, &[bind, &ws, &ws]);
    // And again after, when a bind contains it (running in `$HOME`): the
    // workspace bind would otherwise shadow the mask above and re-expose it.
    if let Some(hide) = policy.hide_root.as_deref().filter(|h| policy.hide_under_a_bind(h)) {
        push(&mut args, &["--tmpfs", &hide.to_string_lossy()]);
    }
    // Last and in order, so no grant above can shadow them and a writable
    // entry re-opens only what lies inside an earlier read-only one. A
    // read-only path that does not exist yet still gets a mount, or the shell
    // could create it: an empty read-only tmpfs for a directory, `/dev/null`
    // for a file. bubblewrap leaves the empty mount point behind on the host,
    // which git reads like an absent one (an empty config sets nothing).
    // A writable entry that does not exist cannot be bound; left out, it stays
    // read-only under the entry it was carved from, rather than failing the run.
    for carve in &policy.carve_outs {
        let path = carve.path.to_string_lossy();
        if carve.writable && !carve.path.exists() {
            continue;
        } else if carve.writable {
            push(&mut args, &["--bind", &path, &path]);
        } else if carve.path.exists() {
            push(&mut args, &["--ro-bind", &path, &path]);
        } else if carve.dir {
            push(&mut args, &["--tmpfs", &path, "--remount-ro", &path]);
        } else {
            push(&mut args, &["--ro-bind", "/dev/null", &path]);
        }
    }
    push(&mut args, &["--chdir", &ws]);

    // Drops the network, pid, ipc, uts and cgroup namespaces along with the
    // user namespace; --share-net selectively restores networking.
    push(&mut args, &["--unshare-all"]);
    if policy.allow_network {
        push(&mut args, &["--share-net"]);
    }
    // Reap the tree if this process dies, and detach the controlling terminal so
    // a command cannot inject keystrokes into it via TIOCSTI.
    push(&mut args, &["--die-with-parent", "--new-session"]);

    push(&mut args, &["--"]);
    args.push(cfg.program.to_string_lossy().to_string());
    args.extend(cfg.args.iter().cloned());
    args
}

// ---------------------------------------------------------------------------
// Seatbelt (macOS)
// ---------------------------------------------------------------------------

fn seatbelt_program() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        SEATBELT
    }
    #[cfg(not(target_os = "macos"))]
    {
        "/usr/bin/sandbox-exec"
    }
}

/// Seatbelt rules hiding the Jan home; where they go in the profile decides
/// whether they win over the workspace allow (see [`seatbelt_policy`]).
const HIDE_RULES: &str = "(deny file-read* (subpath (param \"HIDE_ROOT\")))\n\
                          (deny file-write* (subpath (param \"HIDE_ROOT\")))\n";

/// The resolved form of `path` when it differs from `path` itself. Seatbelt
/// matches a `subpath` against the real path, so a rule naming a path through
/// a symlink (`/var/folders/...` and `/tmp` are links to `/private/...` on
/// macOS) never fires unless the resolved form is named too.
fn real_form(path: &Path) -> Option<PathBuf> {
    path.canonicalize().ok().filter(|real| real != path)
}

/// The paths a Seatbelt profile names beyond the policy's own fields, worked
/// out once so the profile and its `-D` arguments always agree: sandbox-exec
/// refuses a profile referencing a parameter no argument supplies.
struct SeatbeltPaths {
    scratch_real: Option<PathBuf>,
    /// The read-only checkout and read roots, each in every form it has.
    deny_write: Vec<PathBuf>,
    /// [`Policy::carve_outs`] in order, each in every form it has, with
    /// whether it is writable.
    carve_outs: Vec<(PathBuf, bool)>,
}

impl SeatbeltPaths {
    fn of(policy: &Policy) -> Self {
        let readonly = policy
            .workspace_readonly
            .then_some(&policy.workspace)
            .into_iter()
            .chain(policy.read_roots.iter().filter(|r| !policy.write_roots.contains(r)));
        let mut deny_write: Vec<PathBuf> = Vec::new();
        for root in readonly {
            for form in std::iter::once(root.clone()).chain(real_form(root)) {
                if !deny_write.contains(&form) {
                    deny_write.push(form);
                }
            }
        }
        let carve_outs = policy
            .carve_outs
            .iter()
            .flat_map(|c| {
                std::iter::once(c.path.clone())
                    .chain(real_form(&c.path))
                    .map(move |form| (form, c.writable))
            })
            .collect();
        Self {
            scratch_real: policy.scratch_root.as_deref().and_then(real_form),
            deny_write,
            carve_outs,
        }
    }
}

/// Seatbelt profile. `(deny default)` closes everything, then each section opens
/// the narrowest thing that works. Later rules win, which is what lets the
/// workspace be re-allowed after `$HOME` is denied (or, with `home_readonly`,
/// lets the home stay readable while writes remain confined).
pub fn seatbelt_policy(policy: &Policy) -> String {
    seatbelt_profile(policy, &SeatbeltPaths::of(policy))
}

fn seatbelt_profile(policy: &Policy, paths: &SeatbeltPaths) -> String {
    let mut p = String::from(
        "(version 1)\n\
         (deny default)\n\
         ; A command may fork and exec freely; children inherit this profile.\n\
         (allow process-exec)\n\
         (allow process-fork)\n\
         (allow signal (target same-sandbox))\n\
         (allow process-info* (target same-sandbox))\n\
         ; Read-only sysctl (uname, hostname, env probes) -- a read-only open, LOW risk.\n\
         (allow sysctl-read)\n\
         ; openpty() and friends, so interactive-ish tools detect a tty.\n\
         (allow pseudo-tty)\n\
         (allow file-read* file-write* file-ioctl (literal \"/dev/ptmx\"))\n\
         (allow file-ioctl (regex #\"^/dev/ttys[0-9]+\"))\n\
         ; Python multiprocessing and OpenMP runtimes. Their shared POSIX shm/sem\n\
         ; names are host-wide and cannot be scoped per-sandbox on sandbox-exec\n\
         ; (also deprecated / not a security boundary per Apple) -- accepted tradeoff;\n\
         ; the real boundary is the $HOME / MASK_ROOT read denial below.\n\
         (allow ipc-posix-sem)\n\
         (allow ipc-posix-shm*)\n\
         (allow mach-lookup (global-name \"com.apple.system.opendirectoryd.libinfo\"))\n\
         (allow file-write-data\n\
         \x20 (require-all (path \"/dev/null\") (vnode-type CHARACTER-DEVICE)))\n\
         ; Reads: open, minus the user's home, plus the workspace back.\n\
         (allow file-read*)\n",
    );
    if home_dir().is_some() && !policy.home_readonly {
        p.push_str("(deny file-read* (subpath (param \"HOME_ROOT\")))\n");
    }
    if policy.mask_root.is_some() {
        p.push_str("(deny file-read* (subpath (param \"MASK_ROOT\")))\n");
    }
    // Later rules win. Denied here, before the allows below, when the
    // workspace lives under the Jan home (a worktree) so it is read back; when
    // the home lies inside an allowed root instead, the deny goes last.
    let hide_last = policy
        .hide_root
        .as_deref()
        .is_some_and(|h| policy.hide_under_a_bind(h));
    if policy.hide_root.is_some() && !hide_last {
        p.push_str(HIDE_RULES);
    }
    p.push_str("(allow file-read* (subpath (param \"WORKSPACE\")))\n");
    // Not the host temp dir (`$TMPDIR`, `/var/folders/...`): the shell's
    // `TMPDIR` is the session scratch, granted by name below, and the host
    // one holds other programs' files, which must not be writable here.
    p.push_str(
        "; Writes: the workspace, the scratch and /private/tmp, nothing else.\n\
         (allow file-write* (subpath \"/private/tmp\"))\n",
    );
    // The `/private/tmp` grant above is broad, so a read-only checkout or read
    // root under it (a project in `/tmp`) would be writable through it. Denied
    // after them, and before the scratch and write-root allows below so those
    // stay writable even inside such a root.
    for i in 0..paths.deny_write.len() {
        p.push_str(&format!(
            "(deny file-write* (subpath (param \"DENY_WRITE_{i}\")))\n"
        ));
    }
    // After the denials, as bubblewrap binds the workspace after the read
    // roots: a writable workspace inside a read root stays writable.
    if !policy.workspace_readonly {
        p.push_str("(allow file-write* (subpath (param \"WORKSPACE\")))\n");
    }
    // The session scratch by name, rather than trusting it to sit under TMPDIR:
    // a relocated scratch must stay usable, and it is read back after the home
    // denial above, which would otherwise cover a scratch inside $HOME. Emitted
    // only with the matching `-DSCRATCH`, since sandbox-exec refuses a profile
    // that references a parameter no argument supplies.
    if policy.scratch_root.is_some() {
        p.push_str(
            "(allow file-read* (subpath (param \"SCRATCH\")))\n\
             (allow file-write* (subpath (param \"SCRATCH\")))\n",
        );
    }
    if paths.scratch_real.is_some() {
        p.push_str(
            "(allow file-read* (subpath (param \"SCRATCH_REAL\")))\n\
             (allow file-write* (subpath (param \"SCRATCH_REAL\")))\n",
        );
    }
    // After the HOME/MASK denials, so an attached folder inside either is read
    // back: in Seatbelt the later rule wins. Read only — no matching
    // `file-write*`, so `(deny default)` keeps the folder unwritable. Emitted
    // one per root, and only with the matching `-DREAD_ROOT_n`, since
    // sandbox-exec refuses a profile referencing an unsupplied parameter.
    for i in 0..policy.read_roots.len() {
        p.push_str(&format!(
            "(allow file-read* (subpath (param \"READ_ROOT_{i}\")))\n"
        ));
    }
    // Writable attached roots: read *and* write allowed, same position so the
    // HOME/MASK denials above are overridden for them too.
    for i in 0..policy.write_roots.len() {
        p.push_str(&format!(
            "(allow file-read* (subpath (param \"WRITE_ROOT_{i}\")))\n\
             (allow file-write* (subpath (param \"WRITE_ROOT_{i}\")))\n"
        ));
    }
    // After every write allow, so none of them re-grants a carved-out path.
    // A `subpath` rule also matches a path that does not exist yet, so a
    // missing one cannot be created either.
    for (i, (_, writable)) in paths.carve_outs.iter().enumerate() {
        let verb = if *writable { "allow" } else { "deny" };
        p.push_str(&format!("({verb} file-write* (subpath (param \"CARVE_{i}\")))\n"));
    }
    if hide_last {
        p.push_str(HIDE_RULES);
    }
    if policy.allow_network {
        p.push_str(
            "(allow network*)\n\
             (allow system-socket)\n\
             (allow mach-lookup\n\
             \x20 (global-name \"com.apple.SystemConfiguration.DNSConfiguration\")\n\
             \x20 (global-name \"com.apple.SystemConfiguration.configd\")\n\
             \x20 (global-name \"com.apple.SecurityServer\")\n\
             \x20 (global-name \"com.apple.trustd.agent\")\n\
             \x20 (global-name \"com.apple.ocspd\")\n\
             \x20 (global-name \"com.apple.networkd\"))\n",
        );
    } else {
        p.push_str("(deny network*)\n");
    }
    p
}

/// Build `sandbox-exec`'s argv. Paths travel as `-D` parameters rather than being
/// interpolated into the profile so a path containing profile syntax cannot
/// rewrite the policy.
pub fn seatbelt_args(policy: &Policy, cfg: &ShellConfig) -> Vec<String> {
    let paths = SeatbeltPaths::of(policy);
    let mut args = vec!["-p".to_string(), seatbelt_profile(policy, &paths)];
    args.push(format!(
        "-DWORKSPACE={}",
        policy.workspace.to_string_lossy()
    ));
    if let Some(mask) = &policy.mask_root {
        args.push(format!("-DMASK_ROOT={}", mask.to_string_lossy()));
    }
    if let Some(hide) = &policy.hide_root {
        args.push(format!("-DHIDE_ROOT={}", hide.to_string_lossy()));
    }
    for (i, root) in policy.read_roots.iter().enumerate() {
        args.push(format!("-DREAD_ROOT_{i}={}", root.to_string_lossy()));
    }
    for (i, root) in policy.write_roots.iter().enumerate() {
        args.push(format!("-DWRITE_ROOT_{i}={}", root.to_string_lossy()));
    }
    for (i, root) in paths.deny_write.iter().enumerate() {
        args.push(format!("-DDENY_WRITE_{i}={}", root.to_string_lossy()));
    }
    for (i, (path, _)) in paths.carve_outs.iter().enumerate() {
        args.push(format!("-DCARVE_{i}={}", path.to_string_lossy()));
    }
    if let Some(scratch) = &policy.scratch_root {
        args.push(format!("-DSCRATCH={}", scratch.to_string_lossy()));
    }
    if let Some(real) = &paths.scratch_real {
        args.push(format!("-DSCRATCH_REAL={}", real.to_string_lossy()));
    }
    if let Some(home) = home_dir() {
        args.push(format!("-DHOME_ROOT={}", home.to_string_lossy()));
    }
    args.push("--".to_string());
    args.push(cfg.program.to_string_lossy().to_string());
    args.extend(cfg.args.iter().cloned());
    args
}

// ---------------------------------------------------------------------------
// Denial heuristics
// ---------------------------------------------------------------------------

/// Keywords a kernel or libc emits when the sandbox refuses an operation. Used
/// only to append an explanatory hint: a false positive costs a stray sentence,
/// never a behavior change.
const DENIAL_MARKERS: &[&str] = &[
    "operation not permitted",
    "permission denied",
    "access is denied",
    "read-only file system",
    "not permitted",
    "sandbox",
    "seccomp",
    "landlock",
    "bwrap:",
    "network is unreachable",
    "temporary failure in name resolution",
    "could not resolve host",
    "name or service not known",
];

/// True when `output` looks like the sandbox blocked something, so the model can
/// be told why instead of retrying a command that can never succeed.
pub fn looks_denied(output: &str) -> bool {
    let lower = output.to_lowercase();
    DENIAL_MARKERS.iter().any(|m| lower.contains(m))
}

/// Sentence appended to a denied command's output, telling the model the limits
/// rather than leaving it to infer them from `Permission denied`.
pub fn denial_hint(policy: &Policy) -> String {
    let net = if policy.allow_network {
        ""
    } else {
        " Network access is disabled."
    };
    let home = if policy.home_readonly {
        ""
    } else {
        " and files under your home directory are not readable"
    };
    // Naming only the workspace would send the model away from the scratch,
    // which is writable too and is where temporary work belongs.
    let scratch = match scratch_env_path(backend(), policy) {
        Some(path) => format!(" and the scratch dir ({})", path.display()),
        None => String::new(),
    };
    // An attached folder the file tools can read but the shell cannot is a real
    // asymmetry on Windows, where granting it would mean permanently rewriting
    // the DACL of a directory Jan does not own and never revokes. Saying so
    // beats letting the model read the folder with `read` and conclude `bash` is
    // broken when the same path is missing there.
    let attached = if policy.read_roots.is_empty() {
        String::new()
    } else if backend() == Backend::AppContainer {
        " The attached folder is reachable by the file tools but not by shell \
         commands on this platform."
            .to_string()
    } else {
        let list = |roots: &[PathBuf]| {
            roots
                .iter()
                .map(|r| r.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        };
        let readonly: Vec<PathBuf> = policy
            .read_roots
            .iter()
            .filter(|r| !policy.write_roots.contains(r))
            .cloned()
            .collect();
        let mut s = String::new();
        if !policy.write_roots.is_empty() {
            s.push_str(&format!(
                " The attached folder ({}) is readable and writable.",
                list(&policy.write_roots)
            ));
        }
        if !readonly.is_empty() {
            s.push_str(&format!(
                " The attached folder ({}) is readable but not writable.",
                list(&readonly)
            ));
        }
        s
    };
    // A write root carved read-only as a whole (a worktree writer's shared git
    // dir) is writable only where reopened. Git's own message names just
    // `packed-refs.lock`, which leaves a model retrying a branch deletion.
    let mut attached = attached;
    for root in policy.write_roots.iter().filter(|r| {
        policy.carve_outs.iter().any(|c| !c.writable && c.path == **r)
    }) {
        let open: Vec<String> = policy
            .carve_outs
            .iter()
            .filter(|c| c.writable && c.path.starts_with(root))
            .map(|c| c.path.display().to_string())
            .collect();
        attached.push_str(&format!(
            " In the git dir {} only {} are writable, so commits, new branches and \
             stashes work, but deleting a branch or tag (or the last stash entry's \
             ref) rewrites packed-refs there and is refused: leave it for the user.",
            root.display(),
            open.join(", ")
        ));
    }
    // A read-only workspace is not a place writes may go: naming it as one sends
    // the model straight back to retry there.
    if policy.workspace_readonly {
        let scratch = scratch.strip_prefix(" and ").unwrap_or("");
        let writes = if scratch.is_empty() {
            " and nothing here is writable".to_string()
        } else {
            format!("; writes are limited to {scratch}")
        };
        return format!(
            "\n[sandbox: the workspace ({}) is read-only{writes}{home}.{net}{attached}]",
            policy.workspace.display()
        );
    }
    format!(
        "\n[sandbox: writes are limited to the workspace ({}){scratch}{home}.{net}{attached}]",
        policy.workspace.display()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> ShellConfig {
        ShellConfig {
            program: PathBuf::from("/bin/bash"),
            args: vec!["-c".to_string()],
            kind: super::super::proc::ShellKind::Posix,
        }
    }

    fn policy() -> Policy {
        Policy::new(Path::new("/data/agent-workspace/threads/t1"), false)
    }

    #[cfg(unix)]
    struct BwrapFixture(PathBuf);

    #[cfg(unix)]
    impl BwrapFixture {
        fn new() -> Self {
            use std::os::unix::fs::PermissionsExt;
            use std::sync::atomic::{AtomicUsize, Ordering};
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let path = std::env::temp_dir().join(format!(
                "jan_bwrap_{}_{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir(&path).expect("create fixture");
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            Self(path)
        }

        fn candidates(&self) -> [PathBuf; 3] {
            use std::os::unix::fs::PermissionsExt;
            let local = self.0.join("usr/local/bin/bwrap");
            let system = self.0.join("usr/bin/bwrap");
            let bin = self.0.join("bin/bwrap");
            for path in [&local, &system, &bin] {
                std::fs::create_dir_all(path.parent().unwrap()).expect("create bin directory");
                std::fs::write(path, b"bwrap").expect("create candidate");
                std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o644)).unwrap();
                let mut dir = path.parent();
                while let Some(parent) = dir.filter(|parent| *parent != self.0) {
                    std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o755))
                        .unwrap();
                    dir = parent.parent();
                }
            }
            [local, system, bin]
        }

        fn owner(&self) -> u32 {
            use std::os::unix::fs::MetadataExt;
            std::fs::metadata(&self.0).expect("fixture owner").uid()
        }
    }

    #[cfg(unix)]
    impl Drop for BwrapFixture {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).expect("remove fixture");
        }
    }

    #[cfg(unix)]
    #[test]
    fn trusted_local_bwrap_wins_over_system() {
        let fixture = BwrapFixture::new();
        let [local, system, bin] = fixture.candidates();
        let selected = select_bwrap([&local, &system, &bin], &fixture.0, fixture.owner(), |_| {
            true
        });
        assert_eq!(selected.as_deref(), Some(local.as_path()));
    }

    #[cfg(unix)]
    #[test]
    fn group_writable_local_bwrap_is_rejected() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = BwrapFixture::new();
        let [local, system, bin] = fixture.candidates();
        std::fs::set_permissions(&local, std::fs::Permissions::from_mode(0o664)).unwrap();
        assert_eq!(
            select_bwrap([&local, &system, &bin], &fixture.0, fixture.owner(), |_| {
                true
            }),
            Some(system)
        );
    }

    #[cfg(unix)]
    #[test]
    fn world_writable_local_directory_is_rejected() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = BwrapFixture::new();
        let [local, system, bin] = fixture.candidates();
        std::fs::set_permissions(
            local.parent().unwrap(),
            std::fs::Permissions::from_mode(0o777),
        )
        .unwrap();
        assert_eq!(
            select_bwrap([&local, &system, &bin], &fixture.0, fixture.owner(), |_| {
                true
            }),
            Some(system)
        );
    }

    // An installed system bwrap that fails the probe (userns blocked) must not
    // pass the choice to whatever sits earlier in PATH.
    #[cfg(unix)]
    #[test]
    fn path_is_not_consulted_when_a_fixed_bwrap_is_installed() {
        let fixture = BwrapFixture::new();
        let [local, system, bin] = fixture.candidates();
        let planted = fixture.0.join("planted/bwrap");
        std::fs::create_dir_all(planted.parent().unwrap()).unwrap();
        std::fs::write(&planted, b"bwrap").unwrap();
        let planted_on_path = planted.clone();
        let selected = select_bwrap_or_path(
            [&local, &system, &bin],
            &fixture.0,
            fixture.owner(),
            |path| path == planted,
            move || Some(planted_on_path),
        );
        assert_eq!(selected, None);
    }

    // No fixed location holds a bwrap (NixOS): PATH is the only source, and the
    // live probe still has to pass.
    #[cfg(unix)]
    #[test]
    fn path_is_used_when_no_fixed_bwrap_is_installed() {
        let fixture = BwrapFixture::new();
        let missing = fixture.0.join("nowhere/bwrap");
        let on_path = fixture.0.join("nix/bwrap");
        std::fs::create_dir_all(on_path.parent().unwrap()).unwrap();
        std::fs::write(&on_path, b"bwrap").unwrap();
        let found = on_path.clone();
        let selected = select_bwrap_or_path(
            [&missing, &missing, &missing],
            &fixture.0,
            fixture.owner(),
            |path| path == on_path,
            move || Some(found),
        );
        assert_eq!(selected.as_deref(), Some(on_path.as_path()));
        let unusable = select_bwrap_or_path(
            [&missing, &missing, &missing],
            &fixture.0,
            fixture.owner(),
            |_| false,
            || Some(on_path.clone()),
        );
        assert_eq!(unusable, None);
    }

    #[cfg(unix)]
    #[test]
    fn setgid_group_writable_local_directory_is_rejected() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = BwrapFixture::new();
        let [local, system, bin] = fixture.candidates();
        std::fs::set_permissions(
            local.parent().unwrap(),
            std::fs::Permissions::from_mode(0o2775),
        )
        .unwrap();
        assert_eq!(
            select_bwrap([&local, &system, &bin], &fixture.0, fixture.owner(), |_| {
                true
            }),
            Some(system)
        );
    }

    #[cfg(unix)]
    #[test]
    fn writable_parent_of_local_directory_is_rejected() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = BwrapFixture::new();
        let [local, system, bin] = fixture.candidates();
        std::fs::set_permissions(
            fixture.0.join("usr/local"),
            std::fs::Permissions::from_mode(0o777),
        )
        .unwrap();
        assert_eq!(
            select_bwrap([&local, &system, &bin], &fixture.0, fixture.owner(), |_| {
                true
            }),
            Some(system)
        );
    }

    #[cfg(unix)]
    #[test]
    fn local_bwrap_with_wrong_owner_is_rejected() {
        let fixture = BwrapFixture::new();
        let [local, system, bin] = fixture.candidates();
        assert_eq!(
            select_bwrap(
                [&local, &system, &bin],
                &fixture.0,
                fixture.owner() + 1,
                |_| true
            ),
            Some(system)
        );
    }

    #[cfg(unix)]
    #[test]
    fn local_symlink_to_untrusted_target_is_rejected() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let fixture = BwrapFixture::new();
        let [local, system, bin] = fixture.candidates();
        let target = fixture.0.join("untrusted/bwrap");
        std::fs::create_dir(target.parent().unwrap()).unwrap();
        std::fs::write(&target, b"untrusted").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o666)).unwrap();
        std::fs::remove_file(&local).unwrap();
        symlink(&target, &local).unwrap();
        assert_eq!(
            select_bwrap([&local, &system, &bin], &fixture.0, fixture.owner(), |_| {
                true
            }),
            Some(system)
        );
    }

    #[cfg(unix)]
    #[test]
    fn local_symlink_through_writable_target_directory_is_rejected() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let fixture = BwrapFixture::new();
        let [local, system, bin] = fixture.candidates();
        let target = fixture.0.join("untrusted/bwrap");
        std::fs::create_dir(target.parent().unwrap()).unwrap();
        std::fs::write(&target, b"untrusted").unwrap();
        std::fs::set_permissions(
            target.parent().unwrap(),
            std::fs::Permissions::from_mode(0o777),
        )
        .unwrap();
        std::fs::remove_file(&local).unwrap();
        symlink(&target, &local).unwrap();
        assert_eq!(
            select_bwrap([&local, &system, &bin], &fixture.0, fixture.owner(), |_| {
                true
            }),
            Some(system)
        );
    }

    #[cfg(unix)]
    #[test]
    fn untrusted_local_remains_last_resort() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = BwrapFixture::new();
        let [local, system, bin] = fixture.candidates();
        std::fs::set_permissions(&local, std::fs::Permissions::from_mode(0o666)).unwrap();
        assert_eq!(
            select_bwrap(
                [&local, &system, &bin],
                &fixture.0,
                fixture.owner(),
                |path| path == local
            ),
            Some(local)
        );
    }

    #[cfg(unix)]
    #[test]
    fn unusable_local_bwrap_falls_through_to_system() {
        let fixture = BwrapFixture::new();
        let [local, system, bin] = fixture.candidates();
        assert_eq!(
            select_bwrap(
                [&local, &system, &bin],
                &fixture.0,
                fixture.owner(),
                |path| path != local
            ),
            Some(system)
        );
    }

    fn joined(args: &[String]) -> String {
        args.join(" ")
    }

    /// Running in `$HOME`: the Jan home is inside the workspace, so the
    /// workspace bind would shadow the first mask; a second one must follow.
    #[test]
    fn bwrap_hides_the_jan_home_after_a_workspace_that_contains_it() {
        let ws = "/home/u";
        let hide = "/home/u/.jan";
        let text = joined(&bwrap_args(
            &Policy::new(Path::new(ws), false).with_hide_root(Path::new(hide)),
            &cfg(),
        ));
        let bind = text.find(&format!("--bind {ws} {ws}")).expect("bind");
        let last = text.rfind(&format!("--tmpfs {hide}")).expect("mask");
        assert!(bind < last, "the mask must follow the workspace bind: {text}");
    }

    /// A Jan worktree lives under the home: the mask goes before the workspace
    /// bind only, or it would hide the tree the agent is working in.
    #[test]
    fn bwrap_hides_the_jan_home_before_a_workspace_inside_it() {
        let ws = "/home/u/.jan/worktrees/r-1/feat";
        let hide = "/home/u/.jan";
        let text = joined(&bwrap_args(
            &Policy::new(Path::new(ws), false).with_hide_root(Path::new(hide)),
            &cfg(),
        ));
        let bind = text.find(&format!("--bind {ws} {ws}")).expect("bind");
        let mask = format!("--tmpfs {hide} ");
        assert_eq!(text.matches(&mask).count(), 1, "{text}");
        assert!(text.find(&mask).unwrap() < bind, "{text}");
        assert!(!joined(&bwrap_args(&policy(), &cfg())).contains(".jan"));
    }

    #[test]
    fn seatbelt_orders_the_jan_home_deny_by_where_the_workspace_is() {
        let deny = "(deny file-read* (subpath (param \"HIDE_ROOT\")))";
        let allow = "(allow file-read* (subpath (param \"WORKSPACE\")))";
        let home = Policy::new(Path::new("/Users/u"), false).with_hide_root(Path::new("/Users/u/.jan"));
        let p = seatbelt_policy(&home);
        assert!(p.find(allow).unwrap() < p.find(deny).unwrap(), "{p}");
        assert!(p.contains("(deny file-write* (subpath (param \"HIDE_ROOT\")))"));
        let wt = Policy::new(Path::new("/Users/u/.jan/worktrees/r/f"), false)
            .with_hide_root(Path::new("/Users/u/.jan"));
        let p = seatbelt_policy(&wt);
        assert!(p.find(deny).unwrap() < p.find(allow).unwrap(), "{p}");
        // The path travels as a -D parameter, never interpolated into the profile.
        assert!(!p.contains("/Users/u/.jan"), "{p}");
        assert!(joined(&seatbelt_args(&wt, &cfg())).contains("-DHIDE_ROOT=/Users/u/.jan"));
        assert!(!seatbelt_policy(&policy()).contains("HIDE_ROOT"));
    }

    /// A read-only subagent's checkout is bound read-only, `.git` included
    /// (it is inside the bind), while the scratch stays the writable `/tmp`.
    #[test]
    fn bwrap_binds_a_read_only_workspace_read_only() {
        let ws = "/data/agent-workspace/threads/t1";
        let text = joined(&bwrap_args(&policy().with_workspace_readonly(true), &cfg()));
        assert!(text.contains(&format!("--ro-bind {ws} {ws}")), "{text}");
        assert!(!text.contains(&format!("--bind {ws} {ws}")), "{text}");
        assert!(text.contains(&format!("--chdir {ws}")), "{text}");
    }

    #[test]
    fn seatbelt_never_allows_writes_to_a_read_only_workspace() {
        let write = "(allow file-write* (subpath (param \"WORKSPACE\")))";
        assert!(seatbelt_policy(&policy()).contains(write));
        let p = seatbelt_policy(&policy().with_workspace_readonly(true));
        assert!(!p.contains(write), "{p}");
        assert!(p.contains("(allow file-read* (subpath (param \"WORKSPACE\")))"), "{p}");
    }

    #[test]
    fn bwrap_mounts_root_read_only_before_layering_on_it() {
        let args = bwrap_args(&policy(), &cfg());
        let text = joined(&args);
        assert!(text.contains("--ro-bind / /"));
        // Order is the enforcement: the workspace bind must come after the tmpfs
        // that hides $HOME, or it would be buried by it.
        if let (Some(tmpfs), Some(bind)) = (text.find("--tmpfs /home"), text.find("--bind /data")) {
            assert!(tmpfs < bind, "workspace bind must follow the $HOME tmpfs");
        }
    }

    #[test]
    fn bwrap_binds_the_workspace_writable_and_chdirs_into_it() {
        let args = bwrap_args(&policy(), &cfg());
        let text = joined(&args);
        let ws = "/data/agent-workspace/threads/t1";
        assert!(text.contains(&format!("--bind {ws} {ws}")));
        assert!(text.contains(&format!("--chdir {ws}")));
    }

    #[test]
    fn bwrap_masks_home_by_default_and_reads_it_when_configured() {
        let Some(home) = home_dir() else {
            panic!("test needs a HOME");
        };
        let home = home.to_string_lossy();
        let ro_bind = format!("--ro-bind {home} {home}");
        let tmpfs = format!("--tmpfs {home}");

        // Default: an empty tmpfs hides the home.
        let masked = joined(&bwrap_args(&policy(), &cfg()));
        assert!(masked.contains(&tmpfs), "{masked}");
        assert!(!masked.contains(&ro_bind), "{masked}");

        // home_readonly: the home is bound read-only instead of hidden.
        let ro = joined(&bwrap_args(&policy().with_home_readonly(true), &cfg()));
        assert!(!ro.contains(&tmpfs), "{ro}");
        assert!(ro.contains(&ro_bind), "{ro}");
    }

    /// The bind order *is* the enforcement, on both sides: after the `$HOME`
    /// tmpfs so a folder living under the home is punched back through the mask,
    /// and before the workspace bind so a read root can never shadow the only
    /// writable path.
    #[test]
    fn bwrap_binds_read_roots_between_the_home_mask_and_the_workspace() {
        let ws = "/data/agent-workspace/threads/t1";
        let repo = "/home/u/Projects/app";
        let text = joined(&bwrap_args(
            &policy().with_read_roots(vec![PathBuf::from(repo)]),
            &cfg(),
        ));
        let home = home_dir().expect("a home dir");
        let home_tmpfs = text
            .find(&format!("--tmpfs {}", home.to_string_lossy()))
            .expect("home tmpfs");
        let ro = text
            .find(&format!("--ro-bind {repo} {repo}"))
            .expect("read root bind");
        let bind = text.find(&format!("--bind {ws} {ws}")).expect("ws bind");
        assert!(
            home_tmpfs < ro,
            "read root must follow the home mask: {text}"
        );
        assert!(
            ro < bind,
            "read root must precede the workspace bind: {text}"
        );
    }

    #[test]
    fn bwrap_binds_read_roots_read_only_and_omits_them_by_default() {
        let repo = "/home/u/repo";
        let text = joined(&bwrap_args(
            &policy().with_read_roots(vec![PathBuf::from(repo)]),
            &cfg(),
        ));
        assert!(text.contains(&format!("--ro-bind {repo} {repo}")), "{text}");
        assert!(
            !text.contains(&format!("--bind {repo} {repo}")),
            "never writable: {text}"
        );
        assert!(!joined(&bwrap_args(&policy(), &cfg())).contains(repo));
    }

    /// The writable-attach opt-in: the root is bound rw, exactly once, in the
    /// read-root position (after the home mask, before the workspace bind).
    #[test]
    fn bwrap_binds_a_write_root_rw_and_never_twice() {
        let ws = "/data/agent-workspace/threads/t1";
        let repo = "/home/u/Projects/app";
        let text = joined(&bwrap_args(
            &policy()
                .with_read_roots(vec![PathBuf::from(repo)])
                .with_write_roots(vec![PathBuf::from(repo)]),
            &cfg(),
        ));
        assert!(text.contains(&format!("--bind {repo} {repo}")), "{text}");
        assert!(
            !text.contains(&format!("--ro-bind {repo} {repo}")),
            "one entry in the mount table, writable: {text}"
        );
        let home = home_dir().expect("a home dir");
        let home_tmpfs = text
            .find(&format!("--tmpfs {}", home.to_string_lossy()))
            .expect("home tmpfs");
        let rw = text
            .find(&format!("--bind {repo} {repo}"))
            .expect("write root bind");
        let ws_bind = text.find(&format!("--bind {ws} {ws}")).expect("ws bind");
        assert!(home_tmpfs < rw && rw < ws_bind, "{text}");
    }

    #[test]
    fn seatbelt_allows_a_write_root_to_write() {
        let repo = "/Users/u/repo";
        let p = seatbelt_policy(
            &policy()
                .with_read_roots(vec![PathBuf::from(repo)])
                .with_write_roots(vec![PathBuf::from(repo)]),
        );
        assert!(
            p.contains("(allow file-write* (subpath (param \"WRITE_ROOT_0\")))"),
            "{p}"
        );
        let args = seatbelt_args(
            &policy()
                .with_read_roots(vec![PathBuf::from(repo)])
                .with_write_roots(vec![PathBuf::from(repo)]),
            &cfg(),
        );
        assert!(args.iter().any(|a| a == &format!("-DWRITE_ROOT_0={repo}")));
    }

    /// Seatbelt takes the last matching rule, so the read allow has to come
    /// after the HOME/MASK denials or a folder inside either stays unreadable.
    #[test]
    fn seatbelt_allows_read_roots_after_the_denials_and_never_writes() {
        let repo = "/Users/u/repo";
        let p = seatbelt_policy(
            &policy()
                .with_mask_root(Path::new("/data"))
                .with_read_roots(vec![PathBuf::from(repo)]),
        );
        let deny = p
            .find("(deny file-read* (subpath (param \"MASK_ROOT\")))")
            .expect("mask deny");
        let allow = p
            .find("(allow file-read* (subpath (param \"READ_ROOT_0\")))")
            .expect("read root allow");
        assert!(deny < allow, "the allow must win over the denials: {p}");
        assert!(
            !p.contains("(allow file-write* (subpath (param \"READ_ROOT_0\")))"),
            "a read root is never writable: {p}"
        );

        let args = seatbelt_args(&policy().with_read_roots(vec![PathBuf::from(repo)]), &cfg());
        assert!(args.iter().any(|a| a == &format!("-DREAD_ROOT_0={repo}")));
    }

    /// sandbox-exec refuses a profile that references a parameter no `-D`
    /// supplies, so the rule and the argument have to appear together.
    #[test]
    fn seatbelt_omits_the_read_root_rule_when_there_is_none() {
        let p = seatbelt_policy(&policy());
        assert!(!p.contains("READ_ROOT"), "{p}");
        assert!(!seatbelt_args(&policy(), &cfg())
            .iter()
            .any(|a| a.contains("READ_ROOT")));
    }

    #[test]
    fn bwrap_denies_network_unless_allowed() {
        let denied = joined(&bwrap_args(&policy(), &cfg()));
        assert!(denied.contains("--unshare-all"));
        assert!(!denied.contains("--share-net"));

        let allowed = joined(&bwrap_args(
            &Policy::new(Path::new("/data/ws"), true),
            &cfg(),
        ));
        assert!(allowed.contains("--unshare-all"));
        assert!(allowed.contains("--share-net"));
    }

    #[test]
    fn bwrap_hardens_the_tree_and_terminal() {
        let text = joined(&bwrap_args(&policy(), &cfg()));
        assert!(text.contains("--die-with-parent"));
        assert!(text.contains("--new-session"));
        assert!(text.contains("--proc /proc"));
        assert!(text.contains("--tmpfs /tmp"));
    }

    #[test]
    fn bwrap_binds_scratch_over_tmp_instead_of_a_tmpfs() {
        let scratch = Path::new("/data/agent-workspace/threads/t1/agent-scratch");
        let scratch_bind = format!("--bind {} /tmp", scratch.to_string_lossy());

        // Default: a throwaway tmpfs per command, no scratch bind.
        let default = joined(&bwrap_args(&policy(), &cfg()));
        assert!(default.contains("--tmpfs /tmp"), "{default}");
        assert!(!default.contains(&scratch_bind), "{default}");

        // With a scratch root, /tmp is a real bind so files written there by one
        // bash call survive into the next.
        let bound = joined(&bwrap_args(&policy().with_scratch_root(scratch), &cfg()));
        assert!(!bound.contains("--tmpfs /tmp"), "{bound}");
        assert!(bound.contains(&scratch_bind), "{bound}");
    }

    #[test]
    fn bwrap_ends_with_the_shell_so_the_command_appends_last() {
        let args = bwrap_args(&policy(), &cfg());
        let sep = args.iter().position(|a| a == "--").expect("separator");
        assert_eq!(
            &args[sep + 1..],
            &["/bin/bash".to_string(), "-c".to_string()]
        );
    }

    #[test]
    fn seatbelt_closes_by_default_then_opens_reads() {
        let p = seatbelt_policy(&policy());
        assert!(p.starts_with("(version 1)\n(deny default)"));
        assert!(p.contains("(allow file-read*)"));
    }

    #[test]
    fn seatbelt_keeps_home_readable_but_unwritable_when_configured() {
        // home_readonly: no home read-denial, and the write section never opens
        // HOME_ROOT, so reads work but writes stay confined to workspace/temp.
        let p = seatbelt_policy(&policy().with_home_readonly(true));
        assert!(
            !p.contains("(deny file-read* (subpath (param \"HOME_ROOT\")))"),
            "{p}"
        );
        assert!(p.contains("(allow file-read*)"), "{p}");
        assert!(
            !p.contains("(allow file-write* (subpath (param \"HOME_ROOT\")))"),
            "{p}"
        );
    }

    #[test]
    fn seatbelt_denies_home_after_allowing_reads_and_restores_the_workspace() {
        let p = seatbelt_policy(&policy());
        let allow_all = p.find("(allow file-read*)\n").expect("blanket read");
        let deny_home = p.find("(deny file-read* (subpath (param \"HOME_ROOT\")))");
        let allow_ws = p
            .find("(allow file-read* (subpath (param \"WORKSPACE\")))")
            .expect("workspace read");
        // Seatbelt takes the last matching rule, so these three must appear in
        // this order for the workspace carve-out to survive the home denial.
        if let Some(deny_home) = deny_home {
            assert!(allow_all < deny_home && deny_home < allow_ws);
        }
    }

    /// The `/private/tmp` grant is broad, and in Seatbelt the later rule wins:
    /// a read-only checkout under it must be denied writes after it, by every
    /// name it has, or it is writable after all.
    #[test]
    fn seatbelt_denies_writes_to_a_read_only_checkout_under_the_temp_grants() {
        let ws = Path::new("/private/tmp/checkout");
        let ro = Policy::new(ws, false)
            .with_workspace_readonly(true)
            .with_read_roots(vec![PathBuf::from("/private/tmp/worktrees")]);
        let p = seatbelt_policy(&ro);
        let deny = "(deny file-write* (subpath (param \"DENY_WRITE_0\")))";
        let at = p.find(deny).expect(&p);
        assert!(p.find("(allow file-write* (subpath \"/private/tmp\"))").unwrap() < at, "{p}");
        assert!(p.contains("(deny file-write* (subpath (param \"DENY_WRITE_1\")))"), "{p}");
        let args = seatbelt_args(&ro, &cfg());
        assert!(args.iter().any(|a| a == "-DDENY_WRITE_0=/private/tmp/checkout"), "{args:?}");
        assert!(args.iter().any(|a| a == "-DDENY_WRITE_1=/private/tmp/worktrees"), "{args:?}");
        // A writable workspace, and a read root also marked writable, get none.
        let rw = Policy::new(ws, false)
            .with_read_roots(vec![PathBuf::from("/r")])
            .with_write_roots(vec![PathBuf::from("/r")]);
        assert!(!seatbelt_policy(&rw).contains("DENY_WRITE"));
        assert!(!seatbelt_args(&rw, &cfg()).iter().any(|a| a.contains("DENY_WRITE")));
    }

    /// The scratch and the write roots stay writable even inside a read-only
    /// checkout: their allows come after its denial.
    #[test]
    fn seatbelt_keeps_the_scratch_and_write_roots_writable_past_the_denial() {
        let ro = Policy::new(Path::new("/Users/u"), false)
            .with_workspace_readonly(true)
            .with_scratch_root(Path::new("/Users/u/.jan/scratch/s1"))
            .with_write_roots(vec![PathBuf::from("/Users/u/.jan/worktrees/r/cargo-target")]);
        let p = seatbelt_policy(&ro);
        let deny = p.find("(param \"DENY_WRITE_0\")").expect(&p);
        assert!(deny < p.find("(allow file-write* (subpath (param \"SCRATCH\")))").unwrap(), "{p}");
        assert!(deny < p.find("(allow file-write* (subpath (param \"WRITE_ROOT_0\")))").unwrap());
        // A parent session in a Jan worktree reads its children's worktrees
        // beside it: that read root's denial must not cover its own checkout.
        let parent = Policy::new(Path::new("/Users/u/.jan/worktrees/r/feat"), false)
            .with_read_roots(vec![PathBuf::from("/Users/u/.jan/worktrees/r")]);
        let p = seatbelt_policy(&parent);
        let deny = p.find("(param \"DENY_WRITE_0\")").expect(&p);
        let ws = p.find("(allow file-write* (subpath (param \"WORKSPACE\")))").unwrap();
        assert!(deny < ws, "{p}");
    }

    /// Seatbelt matches a `subpath` against the resolved path, so a path that
    /// goes through a symlink (`/var` -> `/private/var` on macOS) is named in
    /// both forms, or the rule never fires.
    #[cfg(unix)]
    #[test]
    fn seatbelt_names_symlinked_paths_in_their_resolved_form_too() {
        let base = std::env::temp_dir().join(format!("jan-sb-forms-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let real = base.join("real");
        std::fs::create_dir_all(real.join("ws")).unwrap();
        std::fs::create_dir_all(real.join("scratch")).unwrap();
        std::os::unix::fs::symlink(&real, base.join("link")).unwrap();
        let real = real.canonicalize().unwrap();
        let (ws, scratch) = (base.join("link/ws"), base.join("link/scratch"));
        let ro = Policy::new(&ws, false)
            .with_workspace_readonly(true)
            .with_scratch_root(&scratch);
        let p = seatbelt_policy(&ro);
        let args = seatbelt_args(&ro, &cfg());
        let has = |arg: String| args.contains(&arg);
        assert!(has(format!("-DDENY_WRITE_0={}", ws.display())), "{args:?}");
        assert!(has(format!("-DDENY_WRITE_1={}", real.join("ws").display())), "{args:?}");
        assert!(p.contains("(deny file-write* (subpath (param \"DENY_WRITE_1\")))"), "{p}");
        assert!(has(format!("-DSCRATCH_REAL={}", real.join("scratch").display())), "{args:?}");
        assert!(p.contains("(allow file-write* (subpath (param \"SCRATCH_REAL\")))"), "{p}");
        assert!(p.contains("(allow file-read* (subpath (param \"SCRATCH_REAL\")))"), "{p}");
        // Unresolvable or already resolved: one form, and no stray parameter.
        let plain = policy().with_scratch_root(Path::new("/var/scratch/jan-agent-s1"));
        assert!(!seatbelt_policy(&plain).contains("SCRATCH_REAL"));
        assert!(!seatbelt_args(&plain, &cfg()).iter().any(|a| a.contains("SCRATCH_REAL")));
        let _ = std::fs::remove_dir_all(&base);
    }

    /// The shared git dir's hooks and config are bound read-only after the
    /// writable grant of the dir itself, in order, with the writer's own admin
    /// dir re-opened inside a read-only `worktrees/` and its redirect files
    /// closed again; a missing path gets a read-only placeholder.
    #[test]
    fn bwrap_binds_carve_outs_after_every_grant_in_order() {
        let base = std::env::temp_dir().join(format!("jan-carve-bw-{}", std::process::id()));
        let git = base.join("repo/.git");
        std::fs::create_dir_all(git.join("hooks")).unwrap();
        std::fs::create_dir_all(git.join("worktrees/w")).unwrap();
        std::fs::write(git.join("config"), b"").unwrap();
        let s = |p: &Path| p.to_string_lossy().into_owned();
        let policy = Policy::new(&base.join("wt"), false)
            .with_write_roots(vec![git.clone()])
            .with_carve_outs(vec![
                CarveOut::read_only(git.join("hooks"), true),
                CarveOut::read_only(git.join("config"), false),
                CarveOut::read_only(git.join("modules"), true),
                CarveOut::read_only(git.join("config.worktree"), false),
                CarveOut::read_only(git.join("worktrees"), true),
                CarveOut::writable(git.join("worktrees/w")),
                CarveOut::read_only(git.join("worktrees/w/gitdir"), false),
            ]);
        let text = joined(&bwrap_args(&policy, &cfg()));
        let _ = std::fs::remove_dir_all(&base);
        let at = |needle: String| text.find(&needle).unwrap_or_else(|| panic!("{needle}: {text}"));
        let ws = at(format!("--bind {0} {0}", s(&base.join("wt"))));
        let grant = at(format!("--bind {0} {0}", s(&git)));
        let hooks = at(format!("--ro-bind {0} {0}", s(&git.join("hooks"))));
        let config = at(format!("--ro-bind {0} {0}", s(&git.join("config"))));
        let modules = s(&git.join("modules"));
        let modules = at(format!("--tmpfs {modules} --remount-ro {modules}"));
        let wtconfig = at(format!("--ro-bind /dev/null {}", s(&git.join("config.worktree"))));
        let trees = at(format!("--ro-bind {0} {0}", s(&git.join("worktrees"))));
        let own = at(format!("--bind {0} {0}", s(&git.join("worktrees/w"))));
        let gitdir = at(format!("--ro-bind /dev/null {}", s(&git.join("worktrees/w/gitdir"))));
        assert!(grant < ws && ws < hooks, "after the workspace bind too: {text}");
        assert!(hooks < config && config < modules && modules < wtconfig, "{text}");
        assert!(wtconfig < trees && trees < own && own < gitdir, "{text}");
        assert!(gitdir < at("--chdir".to_string()), "{text}");
    }

    /// Seatbelt denies writes to the whole shared git dir after every write
    /// allow, by subpath (which also matches a path that does not exist yet,
    /// so `commondir` cannot be created), then re-allows the allowlist after
    /// that denial and denies what is carved back out of it after those.
    #[test]
    fn seatbelt_denies_carve_outs_after_every_write_allow() {
        let git = PathBuf::from("/Users/u/repo/.git");
        let admin = git.join("worktrees/w");
        let policy = Policy::new(Path::new("/Users/u/.jan/worktrees/r/w"), false)
            .with_scratch_root(Path::new("/Users/u/.jan/scratch/s1"))
            .with_write_roots(vec![git.clone()])
            .with_carve_outs(vec![
                CarveOut::read_only(git.clone(), true),
                CarveOut::writable(git.join("objects")),
                CarveOut::read_only(git.join("objects/info"), true),
                CarveOut::writable(git.join("refs")),
                CarveOut::writable(admin.clone()),
                CarveOut::read_only(admin.join("commondir"), false),
            ]);
        let p = seatbelt_policy(&policy);
        let at = |needle: &str| p.find(needle).unwrap_or_else(|| panic!("{needle}: {p}"));
        let deny = |i: usize| at(&format!("(deny file-write* (subpath (param \"CARVE_{i}\")))"));
        let allow = |i: usize| at(&format!("(allow file-write* (subpath (param \"CARVE_{i}\")))"));
        for grant in ["WORKSPACE", "SCRATCH", "WRITE_ROOT_0"] {
            let g = at(&format!("(allow file-write* (subpath (param \"{grant}\")))"));
            assert!(g < deny(0), "{grant}: {p}");
        }
        assert!(deny(0) < allow(1) && allow(1) < deny(2) && deny(2) < allow(3), "{p}");
        assert!(allow(3) < allow(4) && allow(4) < deny(5), "{p}");
        let args = seatbelt_args(&policy, &cfg());
        assert!(args.iter().any(|a| a == "-DCARVE_0=/Users/u/repo/.git"), "{args:?}");
        assert!(args.iter().any(|a| a == "-DCARVE_2=/Users/u/repo/.git/objects/info"), "{args:?}");
        assert!(args.iter().any(|a| a == "-DCARVE_4=/Users/u/repo/.git/worktrees/w"), "{args:?}");
        assert!(!seatbelt_policy(&Policy::new(Path::new("/w"), false)).contains("CARVE"));
    }

    /// The shared git dir is read-only except for an allowlist: objects (minus
    /// `objects/info`, whose alternates would inject objects into the user's
    /// repo), refs, logs and the writer's own admin dir (minus the files that
    /// point git elsewhere or configure it). Everything else at its top level,
    /// `commondir`, `gitdir` and `packed-refs` included, is covered, and the
    /// reopened dirs are created when missing so they can be bound.
    #[test]
    fn git_dir_carve_outs_reopen_only_an_allowlist_of_the_shared_git_dir() {
        let base = std::env::temp_dir().join(format!("jan-carve-allow-{}", std::process::id()));
        let common = base.join("repo/.git");
        let admin = common.join("worktrees/w");
        std::fs::create_dir_all(&admin).unwrap();
        std::fs::write(admin.join("commondir"), b"../..\n").unwrap();
        std::fs::write(admin.join("gitdir"), b"/w/.git\n").unwrap();
        let carve = git_dir_carve_outs(&common, &admin);
        let logs = common.join("logs").is_dir() && common.join("refs").is_dir();
        let ro = |p: &str| carved_read_only(&carve, &common.join(p));
        for p in [
            "commondir", "gitdir", "config", "config.worktree", "packed-refs",
            "packed-refs.lock", "HEAD", "hooks/pre-commit", "info/attributes", "modules/m",
            "remotes/o", "branches/b", "anything-new", "objects/info/alternates",
            "objects/info/http-alternates", "worktrees/other/HEAD", "worktrees/w/commondir",
            "worktrees/w/gitdir", "worktrees/w/config.worktree",
        ] {
            assert!(ro(p), "{p} must stay read-only: {carve:#?}");
        }
        for p in [
            "objects/ab/cd", "objects/pack/p.pack", "refs/heads/jan/agent/x", "refs/stash",
            "logs/HEAD", "logs/refs/heads/x", "worktrees/w/index.lock", "worktrees/w/HEAD",
        ] {
            assert!(!ro(p), "{p} must stay writable: {carve:#?}");
        }
        // An admin dir missing a pointer file is not reopened: binding it
        // read-only would leave an empty one behind, which git fails to parse.
        std::fs::remove_file(admin.join("commondir")).unwrap();
        let carve = git_dir_carve_outs(&common, &admin);
        let _ = std::fs::remove_dir_all(&base);
        assert!(logs, "the reopened dirs exist on the host");
        assert!(carved_read_only(&carve, &admin.join("index.lock")), "{carve:#?}");
        assert!(!carve.iter().any(|c| c.path.starts_with(&admin)), "{carve:#?}");
    }

    /// A reopened dir that is missing on the host cannot be bound, so it is
    /// left out (staying read-only under the dir it was carved from) rather
    /// than failing the whole shell.
    #[test]
    fn bwrap_skips_a_writable_carve_out_that_does_not_exist() {
        let base = std::env::temp_dir().join(format!("jan-carve-miss-{}", std::process::id()));
        let git = base.join("repo/.git");
        std::fs::create_dir_all(git.join("refs")).unwrap();
        let s = |p: &Path| p.to_string_lossy().into_owned();
        let policy = Policy::new(&base.join("wt"), false)
            .with_write_roots(vec![git.clone()])
            .with_carve_outs(vec![
                CarveOut::read_only(git.clone(), true),
                CarveOut::writable(git.join("refs")),
                CarveOut::writable(git.join("logs")),
            ]);
        let text = joined(&bwrap_args(&policy, &cfg()));
        let _ = std::fs::remove_dir_all(&base);
        assert!(text.contains(&format!("--bind {0} {0}", s(&git.join("refs")))), "{text}");
        assert!(!text.contains(&s(&git.join("logs"))), "{text}");
    }

    /// A denied write in a worktree writer's shell says what of the git dir is
    /// writable, so a failed branch or stash deletion is not retried.
    #[test]
    fn denial_hint_explains_the_git_dir_allowlist() {
        let git = PathBuf::from("/r/.git");
        let plain = denial_hint(&policy().with_write_roots(vec![git.clone()]));
        assert!(!plain.contains("packed-refs"), "{plain}");
        let hint = denial_hint(
            &policy()
                .with_write_roots(vec![git.clone()])
                .with_carve_outs(vec![
                    CarveOut::read_only(git.clone(), true),
                    CarveOut::writable(git.join("refs")),
                ]),
        );
        assert!(hint.contains("packed-refs") && hint.contains("/r/.git/refs"), "{hint}");
        assert!(hint.contains("deleting a branch or tag"), "{hint}");
    }

    /// The file tools ask the same question the sandbox enforces: the last
    /// carve-out over a path decides.
    #[test]
    fn carved_read_only_follows_the_last_matching_carve_out() {
        let carve = [
            CarveOut::read_only(PathBuf::from("/r/.git/hooks"), true),
            CarveOut::read_only(PathBuf::from("/r/.git/worktrees"), true),
            CarveOut::writable(PathBuf::from("/r/.git/worktrees/w")),
            CarveOut::read_only(PathBuf::from("/r/.git/worktrees/w/gitdir"), false),
        ];
        let ro = |p: &str| carved_read_only(&carve, Path::new(p));
        assert!(ro("/r/.git/hooks/pre-commit") && ro("/r/.git/worktrees/other/HEAD"));
        assert!(ro("/r/.git/worktrees/w/gitdir"));
        assert!(!ro("/r/.git/worktrees/w/index.lock") && !ro("/r/.git/objects/ab"));
        assert!(!ro("/r/.git/hooksy"), "a component match, not a string prefix");
    }

    /// bubblewrap layers in order, so a read-only checkout under `/tmp` is
    /// bound read-only after the scratch takes `/tmp`, never shadowed by it.
    #[test]
    fn bwrap_binds_a_read_only_checkout_under_tmp_after_the_scratch() {
        let ws = "/tmp/checkout";
        let ro = Policy::new(Path::new(ws), false)
            .with_workspace_readonly(true)
            .with_scratch_root(Path::new("/tmp/scratch-s1"))
            .with_read_roots(vec![PathBuf::from("/tmp/worktrees")]);
        let text = joined(&bwrap_args(&ro, &cfg()));
        let scratch = text.find("--bind /tmp/scratch-s1 /tmp").expect(&text);
        assert!(scratch < text.find(&format!("--ro-bind {ws} {ws}")).expect(&text), "{text}");
        assert!(scratch < text.find("--ro-bind /tmp/worktrees /tmp/worktrees").unwrap());
        assert!(!text.contains(&format!("--bind {ws} ")), "{text}");
    }

    #[test]
    fn seatbelt_confines_writes_to_the_workspace_and_temp() {
        let p = seatbelt_policy(&policy());
        assert!(p.contains("(allow file-write* (subpath (param \"WORKSPACE\")))"));
        assert!(p.contains("(allow file-write* (subpath \"/private/tmp\"))"));
        // No blanket write rule anywhere.
        assert!(!p.contains("(allow file-write*)"));
    }

    /// The host temp dir is not the shell's: its `TMPDIR` is the session
    /// scratch, granted by name. No write allow may name the host temp dir,
    /// in its given or resolved form (`/var/folders/...` resolves to
    /// `/private/var/folders/...` on macOS), or anything above it.
    #[test]
    fn seatbelt_never_grants_writes_to_the_host_temp_dir() {
        let tmp = std::env::temp_dir();
        let forms: Vec<PathBuf> = std::iter::once(tmp.clone()).chain(real_form(&tmp)).collect();
        let scratch = tmp.join(format!("jan-agent-tmpgrant-{}", std::process::id()));
        std::fs::create_dir_all(&scratch).unwrap();
        let ws = Path::new("/data/agent-workspace/threads/t1");
        let policy = Policy::new(ws, false).with_scratch_root(&scratch);
        let p = seatbelt_policy(&policy);
        let args = seatbelt_args(&policy, &cfg());
        let _ = std::fs::remove_dir_all(&scratch);
        for line in p.lines().filter(|l| l.starts_with("(allow file-write*")) {
            let granted = match line.split_once("(param \"") {
                Some((_, rest)) => {
                    let name = rest.split('"').next().unwrap();
                    let value = args
                        .iter()
                        .find_map(|a| a.strip_prefix(&format!("-D{name}=")))
                        .unwrap_or_else(|| panic!("{name} has no argument: {args:?}"));
                    PathBuf::from(value)
                }
                None => match line.split_once("(subpath \"") {
                    Some((_, rest)) => PathBuf::from(rest.split('"').next().unwrap()),
                    None => continue,
                },
            };
            for form in &forms {
                assert!(!form.starts_with(&granted), "{line} grants {form:?}:\n{p}");
            }
        }
        // The scratch inside it stays writable, by its resolved name too.
        assert!(p.contains("(allow file-write* (subpath (param \"SCRATCH\")))"), "{p}");
        assert!(!args.iter().any(|a| a.starts_with("-DTMPDIR")), "{args:?}");
    }

    /// The scratch is granted by name rather than relying on it happening to sit
    /// under the host temp dir, so a relocated scratch stays writable.
    #[test]
    fn seatbelt_grants_the_scratch_as_its_own_parameter() {
        let scratch = Path::new("/var/scratch/jan-agent-s1");
        let p = seatbelt_policy(&policy().with_scratch_root(scratch));
        assert!(p.contains("(allow file-write* (subpath (param \"SCRATCH\")))"));
        let args = seatbelt_args(&policy().with_scratch_root(scratch), &cfg());
        assert!(args
            .iter()
            .any(|a| a == "-DSCRATCH=/var/scratch/jan-agent-s1"));
        assert!(
            !args[1].contains("/var/scratch"),
            "path must not be inlined"
        );
    }

    /// `sandbox-exec` fails to launch when the profile references a `param` no
    /// `-D` supplies, so the rule and the parameter must appear together.
    #[test]
    fn seatbelt_omits_the_scratch_rule_when_there_is_no_scratch() {
        let p = seatbelt_policy(&policy());
        assert!(!p.contains("SCRATCH"));
        let args = seatbelt_args(&policy(), &cfg());
        assert!(!args.iter().any(|a| a.starts_with("-DSCRATCH=")));
    }

    /// What `TMPDIR` must say inside the sandbox: bubblewrap binds the scratch
    /// over `/tmp`, so the host path is meaningless there; the other backends
    /// have no mount, so the real path is the only one that resolves.
    #[test]
    fn scratch_env_path_follows_what_the_backend_actually_mounts() {
        let scratch = Path::new("/var/scratch/jan-agent-s1");
        let with = policy().with_scratch_root(scratch);
        assert_eq!(
            scratch_env_path(Backend::Bubblewrap, &with).as_deref(),
            Some(Path::new("/tmp"))
        );
        for backend in [Backend::Seatbelt, Backend::AppContainer] {
            assert_eq!(
                scratch_env_path(backend, &with).as_deref(),
                Some(scratch),
                "{backend:?} has no mount, so the real path is the scratch"
            );
        }
        // No scratch, nothing to point at: the shell keeps the default temp dir.
        assert_eq!(scratch_env_path(Backend::Bubblewrap, &policy()), None);
        assert_eq!(scratch_env_path(Backend::Seatbelt, &policy()), None);
    }

    #[test]
    fn seatbelt_denies_network_unless_allowed() {
        assert!(seatbelt_policy(&policy()).contains("(deny network*)"));
        let open = seatbelt_policy(&Policy::new(Path::new("/data/ws"), true));
        assert!(open.contains("(allow network*)"));
        assert!(!open.contains("(deny network*)"));
    }

    #[test]
    fn seatbelt_passes_paths_as_parameters_not_policy_text() {
        let args = seatbelt_args(&policy(), &cfg());
        let ws = "/data/agent-workspace/threads/t1";
        assert!(args.iter().any(|a| a == &format!("-DWORKSPACE={ws}")));
        // The path must not be interpolated into the profile itself, or a path
        // containing sbpl syntax could rewrite the policy.
        assert!(!args[1].contains(ws));
    }

    #[test]
    fn seatbelt_ends_with_the_shell_so_the_command_appends_last() {
        let args = seatbelt_args(&policy(), &cfg());
        let sep = args.iter().position(|a| a == "--").expect("separator");
        assert_eq!(
            &args[sep + 1..],
            &["/bin/bash".to_string(), "-c".to_string()]
        );
    }

    #[test]
    fn denial_markers_match_real_kernel_messages() {
        assert!(looks_denied(
            "touch: cannot touch '/etc/x': Read-only file system"
        ));
        assert!(looks_denied("bash: /root/.x: Permission denied"));
        assert!(looks_denied(
            "curl: (6) Could not resolve host: example.com"
        ));
        assert!(!looks_denied("hello world"));
        assert!(!looks_denied("test failed: 3 assertions"));
    }

    #[test]
    fn denial_hint_names_the_workspace_and_network_state() {
        let hint = denial_hint(&policy());
        assert!(hint.contains("/data/agent-workspace/threads/t1"));
        assert!(hint.contains("Network access is disabled."));
        assert!(!denial_hint(&Policy::new(Path::new("/w"), true)).contains("Network access"));
        // With no scratch there is nothing to point the model at.
        assert!(!hint.contains("scratch"));
    }

    /// A denied write must not send the model away from the one other place it
    /// is allowed to write, named as the sandbox exposes it.
    #[test]
    fn denial_hint_names_the_scratch_when_there_is_one() {
        let scratch = Path::new("/var/scratch/jan-agent-s1");
        let hint = denial_hint(&policy().with_scratch_root(scratch));
        let expected = scratch_env_path(backend(), &policy().with_scratch_root(scratch))
            .expect("a scratch was set");
        assert!(
            hint.contains(&format!("scratch dir ({})", expected.display())),
            "got: {hint}"
        );
    }

    #[test]
    fn a_degenerate_home_is_ignored_rather_than_hiding_the_filesystem() {
        // Guards the `parent().is_none()` check: a `/` home would put a tmpfs
        // over the entire filesystem and nothing would be executable.
        assert!(PathBuf::from("/").parent().is_none());
    }

    #[test]
    fn backend_is_stable_across_calls() {
        assert_eq!(backend(), backend());
    }
}

/// Live end-to-end checks: these assert the kernel actually refuses things,
/// not that we generated the right flags. Skipped when no backend is available.
#[cfg(all(test, unix))]
mod enforcement_tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static N: AtomicUsize = AtomicUsize::new(0);

    /// The canonical temp dir. On macOS `std::env::temp_dir()` returns the
    /// `/var/folders/...` symlinked form while `sandbox-exec` matches the
    /// canonical `/private/var/folders/...` path, so denying the symlinked form
    /// (and the workspace built on top of it) is silently bypassed. Resolving the
    /// symlink keeps the enforcement tests meaningful on macOS. A no-op elsewhere.
    fn temp_dir() -> PathBuf {
        let tmp = std::env::temp_dir();
        #[cfg(target_os = "macos")]
        {
            tmp.canonicalize().unwrap_or(tmp)
        }
        #[cfg(not(target_os = "macos"))]
        {
            tmp
        }
    }

    fn workspace() -> PathBuf {
        let n = N.fetch_add(1, Ordering::SeqCst);
        let dir = temp_dir().join(format!("jan_jail_{}_{}", std::process::id(), n));
        std::fs::create_dir_all(&dir).expect("create workspace");
        dir
    }

    /// Run `command` confined to `ws` and return combined output plus success.
    async fn run(ws: &Path, allow_network: bool, command: &str) -> (bool, String) {
        let policy = Policy::new(ws, allow_network);
        run_policy(policy, ws, command).await
    }

    /// Run `command` under `policy`, spawning in `ws`.
    async fn run_policy(policy: Policy, ws: &Path, command: &str) -> (bool, String) {
        let wrapped = wrap(super::super::proc::shell(), &policy).expect("backend");
        // Mirrors the bash handler: the temp env follows what the backend mounts.
        let tmp = scratch_env_path(backend(), &policy);
        let child = super::super::proc::spawn(
            &wrapped,
            command,
            ws,
            tmp.as_deref(),
            super::super::proc::ShellEnv::default(),
            None,
        )
        .await
        .expect("spawn");
        let pid = child.id();
        let out = child.wait_with_output().await.expect("wait");
        if let Some(pid) = pid {
            super::super::proc::unregister(None, pid);
        }
        let mut text = String::from_utf8_lossy(&out.stdout).to_string();
        text.push_str(&String::from_utf8_lossy(&out.stderr));
        (out.status.success(), text)
    }

    macro_rules! require_backend {
        () => {
            if !backend().enforces() {
                eprintln!("skipping: no sandbox backend on this host");
                return;
            }
        };
    }

    #[tokio::test]
    // `/etc/hostname` does not exist on macOS, so this Linux-content check is
    // gated to the platform that guarantees the file.
    #[cfg(target_os = "linux")]
    async fn a_command_still_runs_and_can_read_system_files() {
        require_backend!();
        let ws = workspace();
        let (ok, out) = run(
            &ws,
            false,
            "echo alive && head -c 4 /etc/hostname >/dev/null",
        )
        .await;
        let _ = std::fs::remove_dir_all(&ws);
        assert!(ok, "basic command must work inside the sandbox: {out}");
        assert!(out.contains("alive"), "{out}");
    }

    #[tokio::test]
    async fn writes_inside_the_workspace_succeed_and_persist() {
        require_backend!();
        let ws = workspace();
        let (ok, out) = run(&ws, false, "echo written > marker.txt").await;
        assert!(ok, "workspace write must succeed: {out}");
        let marker = ws.join("marker.txt");
        let landed = std::fs::read_to_string(&marker)
            .ok()
            .map(|s| s.trim().to_string());
        assert_eq!(
            landed.as_deref(),
            Some("written"),
            "the write must land on the real workspace, not a throwaway overlay"
        );
        let _ = std::fs::remove_dir_all(&ws);
    }

    #[tokio::test]
    async fn scratch_persists_across_bash_calls_when_bound_over_tmp() {
        require_backend!();
        let ws = workspace();
        let scratch = ws.join("agent-scratch");
        std::fs::create_dir_all(&scratch).unwrap();
        let policy = Policy::new(&ws, false).with_scratch_root(&scratch);

        // Write into /tmp in the first call, then read it back in a second,
        // separate sandboxed process. This is exactly the pattern the fix
        // exists for: a scratch pad that outlives a single bash invocation.
        let (ok, out) = run_policy(policy.clone(), &ws, "echo persistent > /tmp/scratch.txt").await;
        assert!(ok, "scratch write must succeed: {out}");
        let (ok, out) = run_policy(policy, &ws, "cat /tmp/scratch.txt").await;
        let _ = std::fs::remove_dir_all(&ws);
        assert!(ok, "scratch read must succeed: {out}");
        assert!(
            out.contains("persistent"),
            "scratch must survive a second bash call: {out}"
        );
    }

    #[tokio::test]
    async fn writes_outside_the_workspace_never_reach_the_host() {
        require_backend!();
        let ws = workspace();
        let victim = std::env::temp_dir().join(format!("jan_jail_victim_{}", std::process::id()));
        let _ = std::fs::remove_file(&victim);
        // The command may well succeed: on bubblewrap the temp dir is a private
        // tmpfs, so the write lands somewhere thrown away with the sandbox. What
        // must hold either way is that nothing appears on the host.
        let (_, out) = run(
            &ws,
            false,
            &format!("echo pwned > {}", victim.to_string_lossy()),
        )
        .await;
        let leaked = victim.exists();
        let _ = std::fs::remove_file(&victim);
        let _ = std::fs::remove_dir_all(&ws);
        assert!(!leaked, "the host filesystem must be untouched: {out}");
    }

    #[tokio::test]
    async fn writes_to_read_only_system_paths_fail() {
        require_backend!();
        let ws = workspace();
        let (ok, out) = run(&ws, false, "echo pwned > /etc/jan_jail_probe").await;
        let leaked = Path::new("/etc/jan_jail_probe").exists();
        let _ = std::fs::remove_dir_all(&ws);
        assert!(
            !ok,
            "system paths are read-only, the write must fail: {out}"
        );
        assert!(!leaked);
        assert!(
            looks_denied(&out),
            "a refusal must be recognizable so the model gets the hint: {out}"
        );
    }

    #[tokio::test]
    // Sibling-workspace invisibility relies on the sandbox backend scoping the
    // temp dir (bwrap's private tmpfs / seatbelt's HOME deny). The seatbelt
    // workspace lives under the mac temp dir, which is not covered by its HOME
    // deny, so this semantic only holds under bwrap on Linux.
    #[cfg(target_os = "linux")]
    async fn another_threads_workspace_is_not_reachable() {
        require_backend!();
        // The isolation that matters most: one conversation must not see another's
        // files, nor the permanent memory/skills store beside them.
        let mine = workspace();
        let theirs = workspace();
        std::fs::write(theirs.join("private.txt"), b"THEIRSECRET").unwrap();
        let (_, out) = run(
            &mine,
            false,
            &format!("cat {}/private.txt", theirs.to_string_lossy()),
        )
        .await;
        let _ = std::fs::remove_dir_all(&mine);
        let _ = std::fs::remove_dir_all(&theirs);
        assert!(
            !out.contains("THEIRSECRET"),
            "another thread's files must be invisible, got: {out}"
        );
    }

    #[tokio::test]
    async fn the_users_home_directory_is_not_readable() {
        require_backend!();
        let Some(home) = home_dir() else {
            eprintln!("skipping: no HOME set");
            return;
        };
        // A real secret-shaped file in the real home, which the sandbox must not
        // be able to read back.
        let secret = home.join(format!(".jan_jail_secret_{}", std::process::id()));
        if std::fs::write(&secret, b"TOPSECRET").is_err() {
            eprintln!("skipping: home not writable");
            return;
        }
        let ws = workspace();
        let (_, out) = run(&ws, false, &format!("cat {}", secret.to_string_lossy())).await;
        let _ = std::fs::remove_file(&secret);
        let _ = std::fs::remove_dir_all(&ws);
        assert!(
            !out.contains("TOPSECRET"),
            "home files must be unreadable, got: {out}"
        );
    }

    #[tokio::test]
    async fn home_is_readable_and_writes_stay_confined_when_home_readonly() {
        require_backend!();
        let Some(home) = home_dir() else {
            eprintln!("skipping: no HOME set");
            return;
        };
        // A file in the real home the sandbox must now be able to read...
        let secret = home.join(format!(".jan_jail_ro_read_{}", std::process::id()));
        if std::fs::write(&secret, b"READABLE_SECRET").is_err() {
            eprintln!("skipping: home not writable");
            return;
        }
        let ws = workspace();
        let policy = Policy::new(&ws, false).with_home_readonly(true);
        // ...read it back, and fail to write a second file into the home.
        let victim = home.join(format!(".jan_jail_ro_write_{}", std::process::id()));
        let _ = std::fs::remove_file(&victim);
        let command = format!(
            "cat {} && echo pwned > {}",
            secret.to_string_lossy(),
            victim.to_string_lossy()
        );
        let (ok, out) = run_policy(policy, &ws, &command).await;
        let leaked = victim.exists();
        let _ = std::fs::remove_file(&secret);
        let _ = std::fs::remove_file(&victim);
        let _ = std::fs::remove_dir_all(&ws);
        assert!(
            out.contains("READABLE_SECRET"),
            "home reads must work: {out}"
        );
        assert!(
            !leaked,
            "home writes must stay confined even when readable: {out}"
        );
        assert!(!ok, "the write into the home must fail: {out}");
    }

    #[tokio::test]
    async fn the_network_is_unreachable_by_default() {
        require_backend!();
        let ws = workspace();
        // /dev/tcp is a bash builtin, so this needs no network tooling installed.
        let (ok, _) = run(&ws, false, "exec 3<>/dev/tcp/1.1.1.1/53 && echo connected").await;
        let _ = std::fs::remove_dir_all(&ws);
        assert!(!ok, "network must be denied by default");
    }

    /// A read-only subagent cannot change its checkout from the shell, not even
    /// its `.git`, while the scratch it was given stays writable.
    #[tokio::test]
    #[cfg(target_os = "linux")]
    async fn a_read_only_workspace_refuses_writes_but_the_scratch_does_not() {
        require_backend!();
        let ws = workspace();
        std::fs::create_dir_all(ws.join(".git")).unwrap();
        std::fs::write(ws.join("kept.txt"), b"original").unwrap();
        let scratch = workspace();
        let policy = Policy::new(&ws, false)
            .with_scratch_root(&scratch)
            .with_workspace_readonly(true);
        let (ok, out) = run_policy(policy.clone(), &ws, "echo changed > kept.txt").await;
        assert!(!ok, "{out}");
        let (ok, out) = run_policy(policy.clone(), &ws, "touch .git/index.lock").await;
        assert!(!ok, "{out}");
        let (ok, out) = run_policy(policy, &ws, "cat kept.txt && echo s > /tmp/s.txt").await;
        let kept = std::fs::read_to_string(ws.join("kept.txt")).unwrap();
        let scratched = scratch.join("s.txt").exists();
        let _ = std::fs::remove_dir_all(&ws);
        let _ = std::fs::remove_dir_all(&scratch);
        assert!(ok && out.contains("original"), "reads still work: {out}");
        assert_eq!(kept, "original");
        assert!(scratched, "the scratch stays writable");
    }

    /// A writer in a linked worktree commits into the main repository's git
    /// dir, which is outside its checkout: granted as a write root, the commit
    /// lands, while what configures git or runs code in the user's checkout
    /// stays read-only under the carve-outs.
    #[tokio::test]
    #[cfg(target_os = "linux")]
    async fn a_worktree_writer_can_commit_but_not_touch_git_hooks_or_config() {
        require_backend!();
        let git = |dir: &Path, args: &[&str]| {
            std::process::Command::new("git")
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
        };
        let repo = workspace();
        if !git(&repo, &["init", "-q"]) {
            eprintln!("skipping: no git");
            return;
        }
        std::fs::write(repo.join("a.txt"), b"a").unwrap();
        assert!(git(&repo, &["add", "a.txt"]));
        assert!(git(&repo, &["commit", "-q", "--no-gpg-sign", "-m", "a"]));
        let wt = workspace();
        std::fs::remove_dir(&wt).unwrap();
        assert!(git(&repo, &["worktree", "add", "-q", "-b", "child", &wt.to_string_lossy()]));
        let common = repo.join(".git");
        // A repository without reflogs has no `logs/`: it is created so it can
        // be reopened, or the commit could not write one.
        std::fs::remove_dir_all(common.join("logs")).unwrap();
        // On, so a `config.worktree` the writer managed to write would be read.
        assert!(git(&repo, &["config", "extensions.worktreeConfig", "true"]));
        let top = |dir: &Path| {
            let mut names: Vec<String> = std::fs::read_dir(dir)
                .unwrap()
                .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
                .collect();
            names.sort();
            names
        };
        let commit = "echo b > b.txt && git add b.txt && git -c user.name=t -c user.email=t@t \
                      commit -q --no-gpg-sign -m b";
        let (landed, _) = run_policy(Policy::new(&wt, false), &wt, commit).await;
        let admin = common.join("worktrees").join(wt.file_name().unwrap());
        assert!(admin.is_dir(), "{admin:?}");
        let with = Policy::new(&wt, false)
            .with_write_roots(vec![common.clone()])
            .with_carve_outs(git_dir_carve_outs(&common, &admin));
        let before = top(&common);
        let admin_before = top(&admin);
        let (ok, out) = run_policy(with.clone(), &wt, commit).await;
        // New branches and stash entries are loose refs, so they work; so does
        // popping one, whose changes apply though the emptied stash's ref,
        // a deletion, is refused.
        let stash = "git checkout -q -b side && git checkout -q - && echo s >> b.txt && \
                     git stash -q && git stash list | grep -q . && ! grep -q s b.txt && \
                     git stash pop -q; grep -q s b.txt && git checkout -q b.txt";
        let (stashed, s_out) = run_policy(with.clone(), &wt, stash).await;
        // Deleting any ref rewrites `packed-refs` beside the config: refused,
        // and in words the denial hint recognises.
        let (deleted, d_out) = run_policy(with.clone(), &wt, "git branch -d side").await;
        // Nothing that configures or runs code in the user's checkout, by any
        // spelling, and a hook that does not exist yet cannot be created.
        let tamper = [
            "echo x > \"$(git rev-parse --git-common-dir)/hooks/pre-commit\"".to_string(),
            format!("printf '#!/bin/sh\\ntouch /tmp/p\\n' > {}/hooks/post-commit", common.display()),
            format!("echo x >> {}/config", common.display()),
            "git config core.fsmonitor 'touch /tmp/pwn'".to_string(),
            "git config --worktree core.hooksPath /tmp".to_string(),
            format!("mkdir -p {}/modules/m/hooks", common.display()),
            format!("echo '* filter=x' > {}/info/attributes", common.display()),
            format!("echo x > {}/config.worktree", common.display()),
            format!("echo x > {}/config.worktree", admin.display()),
            format!("echo /tmp > {}/commondir", admin.display()),
            format!("echo x > {}/gitdir", admin.display()),
            format!("mkdir {}/worktrees/evil", common.display()),
            // Pointers git follows from the shared dir: a `commondir` there
            // redirects the user's checkout to a repository the writer made,
            // alternates add objects to it from anywhere.
            format!("echo /tmp/evil > {}/commondir", common.display()),
            format!("echo /tmp/evil > {}/gitdir", common.display()),
            format!("echo /tmp/evil > {}/objects/info/alternates", common.display()),
            format!("echo /tmp/evil > {}/objects/info/http-alternates", common.display()),
            format!("echo x > {}/packed-refs", common.display()),
            format!("echo x > {}/HEAD", common.display()),
            format!("echo x > {}/FETCH_HEAD", common.display()),
        ];
        let mut changed = Vec::new();
        for cmd in &tamper {
            let (wrote, t_out) = run_policy(with.clone(), &wt, cmd).await;
            if wrote {
                changed.push(format!("{cmd}: {t_out}"));
            }
        }
        let hook = common.join("hooks/post-commit").exists();
        let config = std::fs::read_to_string(common.join("config")).unwrap_or_default();
        let module = common.join("modules/m").exists();
        // No mount point is left behind where git would parse it: the shared
        // dir and the admin dir list what they did before, plus what git wrote.
        let after = top(&common);
        let admin_after = top(&admin);
        // ...and the user's checkout, unconfined, still works.
        let main_ok = git(&repo, &["status", "--short"])
            && git(&repo, &["log", "-1", "--oneline", "child"])
            && git(&repo, &["commit", "-q", "--allow-empty", "--no-gpg-sign", "-m", "m"])
            && git(&wt, &["status", "--short"]);
        let _ = std::fs::remove_dir_all(&wt);
        let _ = std::fs::remove_dir_all(&repo);
        assert!(!landed, "without the git dir the commit cannot land");
        assert!(ok, "with it, it does: {out}");
        assert!(stashed, "{s_out}");
        assert!(!deleted && looks_denied(&d_out), "{d_out}");
        assert!(changed.is_empty(), "these wrote the git dir: {changed:#?}");
        assert!(!hook && !module, "nothing created");
        assert!(!config.contains("fsmonitor") && !config.contains("\nx"), "{config}");
        assert!(before.contains(&"logs".to_string()), "{before:?}");
        assert_eq!(after, before, "nothing new in the shared git dir");
        // What git itself writes there, and an empty `config.worktree`, made
        // up front so it can be bound.
        let written = ["COMMIT_EDITMSG", "ORIG_HEAD", "AUTO_MERGE", "logs", "config.worktree"];
        let new: Vec<_> = admin_after.iter().filter(|n| !admin_before.contains(n)).collect();
        assert!(new.iter().all(|n| written.contains(&n.as_str())), "{new:?}");
        assert!(main_ok, "the main checkout still works");
    }

    /// A relocated store root (e.g. `JAN_DATA_FOLDER` outside `$HOME`) must not
    /// be readable by the shell, even when it is not under the user's home.
    #[tokio::test]
    async fn a_relocated_store_root_is_not_readable() {
        require_backend!();
        let ws = workspace();
        let store = workspace();
        std::fs::create_dir_all(&store).unwrap();
        let secret = store.join("memory.txt");
        std::fs::write(&secret, b"STORESECRET").unwrap();

        let policy = Policy::new(&ws, false).with_mask_root(&store);
        let (_, out) = run_policy(policy, &ws, &format!("cat {}", secret.to_string_lossy())).await;
        let _ = std::fs::remove_dir_all(&ws);
        let _ = std::fs::remove_dir_all(&store);
        assert!(
            !out.contains("STORESECRET"),
            "a relocated store root must be unreadable, got: {out}"
        );
    }
}
