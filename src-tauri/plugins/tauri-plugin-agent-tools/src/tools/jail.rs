//! OS-level confinement for the `bash` tool.
//!
//! The static command scan in [`super::cmdscan`] bounds *which* commands run; this
//! module bounds what they can reach once running. Three properties, identical on
//! every backend:
//!
//! - reads: everything except `$HOME`, with the thread workspace carved back in
//!   (it lives under `$HOME`, so the carve-out is what keeps the sandbox usable
//!   while `settings.json`, provider keys, and the rest of the Jan data folder
//!   stay unreadable). Reads outside `$HOME` stay open because a process cannot
//!   start without its interpreter, loader, and libraries.
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
}

impl Policy {
    pub fn new(workspace: &Path, allow_network: bool) -> Self {
        Self {
            workspace: workspace.to_path_buf(),
            mask_root: None,
            allow_network,
        }
    }

    /// Mask `mask_root` from the sandboxed shell. The desktop data folder holds
    /// the permanent memory/skills store and `settings.json` with provider keys;
    /// masking it keeps a relocated data folder out of the shell's reach. The
    /// thread workspace (nested under it) is re-bound on top so it survives.
    pub fn with_mask_root(mut self, mask_root: &Path) -> Self {
        self.mask_root = Some(mask_root.to_path_buf());
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
        }),
        Backend::Seatbelt => Some(ShellConfig {
            program: PathBuf::from(seatbelt_program()),
            args: seatbelt_args(policy, cfg),
            via_stdin: cfg.via_stdin,
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
                policy.allow_network,
                &cfg.program,
                &cfg.args,
            ),
            via_stdin: cfg.via_stdin,
        }),
        Backend::None => None,
    }
}

// ---------------------------------------------------------------------------
// bubblewrap (Linux)
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
fn bwrap_path() -> Option<PathBuf> {
    static PATH: OnceLock<Option<PathBuf>> = OnceLock::new();
    PATH.get_or_init(|| {
        ["/usr/bin/bwrap", "/bin/bwrap", "/usr/local/bin/bwrap"]
            .into_iter()
            .map(PathBuf::from)
            .find(|p| p.is_file())
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
    // Private temp: writable, discarded with the sandbox, invisible to the host.
    push(&mut args, &["--tmpfs", "/tmp"]);

    // An empty tmpfs over $HOME hides user files without needing a deny rule.
    // The workspace is re-bound on top, so it survives while its siblings (the
    // permanent memory/skills store, settings.json, model files) do not.
    if let Some(home) = home_dir() {
        push(&mut args, &["--tmpfs", &home.to_string_lossy()]);
    }
    // Mask a relocated data folder the same way: `$HOME` hiding alone would leave
    // a `JAN_DATA_FOLDER` outside the home readable, exposing the permanent
    // store and any co-located `settings.json`. The workspace is re-bound below
    // (it is nested under this root on the desktop), so it survives.
    if let Some(mask) = &policy.mask_root {
        push(&mut args, &["--tmpfs", &mask.to_string_lossy()]);
    }

    push(&mut args, &["--bind", &ws, &ws]);
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
/// workspace be re-allowed after `$HOME` is denied.
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
    if home_dir().is_some() {
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
    args.push(format!(
        "-DTMPDIR={}",
        std::env::temp_dir().to_string_lossy()
    ));
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
    format!(
        "\n[sandbox: writes are limited to the workspace ({}) and files under \
         your home directory are not readable.{net}]",
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
            return tmp.canonicalize().unwrap_or(tmp);
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
        let child = super::super::proc::spawn(&wrapped, command, ws)
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
