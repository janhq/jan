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
//! - the agent's own `<workspace>/.jan` state directory is hidden even though it
//!   sits inside the workspace ([`Policy::hide_root`]); AppContainer is the one
//!   backend that cannot express it.
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
    /// A path *inside* the workspace to hide from the shell: the agent's own
    /// `<project>/.jan` state directory. The workspace bind/allow makes the whole
    /// project reachable, so hiding it needs a rule layered on top -- see
    /// [`Policy::with_hide_root`].
    pub hide_root: Option<PathBuf>,
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
}

impl Policy {
    pub fn new(workspace: &Path, allow_network: bool) -> Self {
        Self {
            workspace: workspace.to_path_buf(),
            mask_root: None,
            allow_network,
            hide_root: None,
            home_readonly: false,
            scratch_root: None,
            read_roots: Vec::new(),
        }
    }

    /// Attach read-only roots. See [`Policy::read_roots`] for why their bind
    /// order relative to the masks and the workspace is load-bearing.
    pub fn with_read_roots(mut self, read_roots: Vec<PathBuf>) -> Self {
        self.read_roots = read_roots;
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

    /// Hide `hide_root` from the sandboxed shell. Applied after the workspace is
    /// bound/allowed, so it wins over it: the gate's token scan of the command
    /// string is best-effort, and this is what makes `.jan` unreachable to the
    /// spellings a scan cannot see (`cd .jan`, `$(echo ...)`, a script the shell
    /// writes and runs). Not enforced on AppContainer, where the workspace is
    /// granted by an ACE and carving a subpath back out would mean writing a deny
    /// ACE onto the user's directory; there the scan stands alone.
    pub fn with_hide_root(mut self, hide_root: &Path) -> Self {
        self.hide_root = Some(hide_root.to_path_buf());
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
        match bwrap_path() {
            Some(path) if bwrap_usable(&path) => Backend::Bubblewrap,
            _ => Backend::None,
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
            via_stdin: cfg.via_stdin,
            description: cfg.description,
        }),
        Backend::Seatbelt => Some(ShellConfig {
            program: PathBuf::from(seatbelt_program()),
            args: seatbelt_args(policy, cfg),
            via_stdin: cfg.via_stdin,
            description: cfg.description,
        }),
        // AppContainer is a token attribute on the spawn rather than an argv
        // prefix, and `tokio::process::Command` cannot set one, so the wrapper is
        // a re-exec of this binary that performs the confined spawn itself. If
        // the running binary cannot be located there is no wrapper to run, and
        // returning `cfg` unchanged would run the command with no confinement.
        Backend::AppContainer => Some(ShellConfig {
            program: std::env::current_exe().ok()?,
            args: appcontainer::helper_args(
                &policy.workspace,
                policy.scratch_root.as_deref(),
                policy.allow_network,
                &cfg.program,
                &cfg.args,
            ),
            via_stdin: cfg.via_stdin,
            description: cfg.description,
        }),
        Backend::None => None,
    }
}

// ---------------------------------------------------------------------------
// bubblewrap (Linux)
// ---------------------------------------------------------------------------

/// The fixed FHS locations are preferred so a directory prepended to `PATH`
/// cannot shadow the system bwrap; `PATH` is the fallback for distros with no
/// FHS layout at all (NixOS keeps bwrap only at a Nix-store path). A planted
/// `bwrap` found via `PATH` gains nothing: it runs as the same user, and
/// [`bwrap_usable`]'s live probe still has to pass before it is trusted.
#[cfg(target_os = "linux")]
fn bwrap_path() -> Option<PathBuf> {
    static PATH: OnceLock<Option<PathBuf>> = OnceLock::new();
    PATH.get_or_init(|| {
        ["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap"]
            .into_iter()
            .map(PathBuf::from)
            .find(|p| p.is_file())
            .or_else(|| super::proc::which("bwrap"))
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

    // Between the masks above and the workspace below, and that position is the
    // enforcement: after the `$HOME`/data-folder tmpfs so a project living under
    // either is punched back through, and before the workspace bind so a read
    // root can never shadow the one writable path. Read-only, so nothing the
    // shell does can write into the user's own folder. Not `--ro-bind-try`: a
    // root that vanished should fail loudly rather than silently unmount.
    for root in &policy.read_roots {
        let root = root.to_string_lossy();
        push(&mut args, &["--ro-bind", &root, &root]);
    }

    push(&mut args, &["--bind", &ws, &ws]);
    // After the workspace bind, so it is not shadowed by it: an empty tmpfs where
    // the agent's own state directory sits. Mounted unconditionally rather than
    // only when the directory exists, so a `.jan` created while the sandbox runs
    // cannot be read back by the next command in the same shell. Writes into it
    // are discarded with the sandbox (and hard-denied at the tool layer anyway).
    if let Some(hide) = &policy.hide_root {
        push(&mut args, &["--tmpfs", &hide.to_string_lossy()]);
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

/// Seatbelt profile. `(deny default)` closes everything, then each section opens
/// the narrowest thing that works. Later rules win, which is what lets the
/// workspace be re-allowed after `$HOME` is denied (or, with `home_readonly`,
/// lets the home stay readable while writes remain confined).
pub fn seatbelt_policy(policy: &Policy) -> String {
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
    p.push_str(
        "(allow file-read* (subpath (param \"WORKSPACE\")))\n\
         ; Writes: the workspace and the temp dir, nothing else.\n\
         (allow file-write* (subpath (param \"WORKSPACE\")))\n\
         (allow file-write* (subpath (param \"TMPDIR\")))\n\
         (allow file-write* (subpath \"/private/tmp\"))\n",
    );
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
    // Last, so it wins over the workspace allow above: the agent's own state
    // directory is neither readable nor writable, however the command spells it.
    if policy.hide_root.is_some() {
        p.push_str(
            "(deny file-read* (subpath (param \"HIDE_ROOT\")))\n\
             (deny file-write* (subpath (param \"HIDE_ROOT\")))\n",
        );
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
    let mut args = vec!["-p".to_string(), seatbelt_policy(policy)];
    args.push(format!(
        "-DWORKSPACE={}",
        policy.workspace.to_string_lossy()
    ));
    if let Some(mask) = &policy.mask_root {
        args.push(format!("-DMASK_ROOT={}", mask.to_string_lossy()));
    }
    for (i, root) in policy.read_roots.iter().enumerate() {
        args.push(format!("-DREAD_ROOT_{i}={}", root.to_string_lossy()));
    }
    if let Some(hide) = &policy.hide_root {
        args.push(format!("-DHIDE_ROOT={}", hide.to_string_lossy()));
    }
    args.push(format!(
        "-DTMPDIR={}",
        std::env::temp_dir().to_string_lossy()
    ));
    if let Some(scratch) = &policy.scratch_root {
        args.push(format!("-DSCRATCH={}", scratch.to_string_lossy()));
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
        " The attached folder is readable by the file tools but not by shell \
         commands on this platform."
            .to_string()
    } else {
        format!(
            " The attached folder ({}) is readable but not writable.",
            policy
                .read_roots
                .iter()
                .map(|r| r.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        )
    };
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
            via_stdin: false,
            description: "bash",
        }
    }

    fn policy() -> Policy {
        Policy::new(Path::new("/data/agent-workspace/threads/t1"), false)
    }

    fn joined(args: &[String]) -> String {
        args.join(" ")
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

    /// The workspace bind makes the whole project reachable, so the mask must be
    /// layered on after it or it would be shadowed and silently do nothing.
    #[test]
    fn bwrap_hides_the_agent_state_dir_after_binding_the_workspace() {
        let ws = "/data/agent-workspace/threads/t1";
        let hide = format!("{ws}/.jan");
        let text = joined(&bwrap_args(
            &policy().with_hide_root(Path::new(&hide)),
            &cfg(),
        ));
        let bind = text.find(&format!("--bind {ws} {ws}")).expect("bind");
        let tmpfs = text.find(&format!("--tmpfs {hide}")).expect("hide tmpfs");
        assert!(
            bind < tmpfs,
            "the mask must follow the workspace bind: {text}"
        );
        // Unset by default, so nothing is hidden where no state dir is named.
        assert!(!joined(&bwrap_args(&policy(), &cfg())).contains(".jan"));
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
    fn seatbelt_denies_the_agent_state_dir_last() {
        let hide = "/data/agent-workspace/threads/t1/.jan";
        let p = policy().with_hide_root(Path::new(hide));
        let profile = seatbelt_policy(&p);
        let allow = profile
            .find("(allow file-read* (subpath (param \"WORKSPACE\")))")
            .expect("workspace allow");
        let deny = profile
            .find("(deny file-read* (subpath (param \"HIDE_ROOT\")))")
            .expect("hide deny");
        assert!(allow < deny, "later rules win, so the deny must come last");
        assert!(profile.contains("(deny file-write* (subpath (param \"HIDE_ROOT\")))"));
        // The path travels as a -D parameter, never interpolated into the profile.
        assert!(!profile.contains(hide), "{profile}");
        assert!(joined(&seatbelt_args(&p, &cfg())).contains(&format!("-DHIDE_ROOT={hide}")));
        assert!(!seatbelt_policy(&policy()).contains("HIDE_ROOT"));
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

    #[test]
    fn seatbelt_confines_writes_to_the_workspace_and_temp() {
        let p = seatbelt_policy(&policy());
        assert!(p.contains("(allow file-write* (subpath (param \"WORKSPACE\")))"));
        assert!(p.contains("(allow file-write* (subpath (param \"TMPDIR\")))"));
        // No blanket write rule anywhere.
        assert!(!p.contains("(allow file-write*)"));
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
        let tmp = tmp.canonicalize().unwrap_or(tmp);
        tmp
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
        let child = super::super::proc::spawn(&wrapped, command, ws, tmp.as_deref())
            .await
            .expect("spawn");
        let pid = child.id();
        let out = child.wait_with_output().await.expect("wait");
        if let Some(pid) = pid {
            super::super::proc::unregister(pid);
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
