//! Process-group-aware shell spawning and whole-tree termination for the `bash`
//! tool. Every command runs as its own process-group leader so a timeout,
//! cancel, or app shutdown can reap the entire descendant tree, not just the
//! top-level shell. Without this, any command that spawns children (a build, a
//! `foo &`, a pipeline) leaks orphans when the run is torn down.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use tokio::process::{Child, Command};

/// How to invoke the host shell. `program` + `args` are fixed; the command
/// string is appended as the final argv element, or piped to stdin when
/// `via_stdin` is set (legacy WSL `bash.exe`, which cannot take `-c`).
/// `description` names the shell for the model (e.g. git-bash vs `cmd`), so it
/// can adapt command syntax instead of assuming POSIX bash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellConfig {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub via_stdin: bool,
    /// A short human-readable name of the resolved shell, for the model.
    pub description: &'static str,
}

/// User-configured additions to the shell's environment, layered on top of the
/// fixed [`SANDBOX_ENV_ALLOW`] base. Empty by default, so an unconfigured run is
/// byte-for-byte unchanged. `passthrough` copies host vars by exact name or
/// `*`-glob; `set` injects explicit key=value pairs and wins per key. Secret-
/// looking names (`*KEY*`, `*TOKEN*`, ...) are never copied by `passthrough` --
/// only an explicit `set` can inject one, which names it on purpose.
#[derive(Debug, Clone, Copy, Default)]
pub struct ShellEnv<'a> {
    pub passthrough: &'a [String],
    pub set: &'a [(String, String)],
}

/// Resolved shell for this process, computed once. Prefers a real `bash`
/// (matching the tool's name and documented guidance) and falls back to a
/// POSIX `sh`/`cmd` only when no bash is found.
pub fn shell() -> &'static ShellConfig {
    static SHELL: OnceLock<ShellConfig> = OnceLock::new();
    SHELL.get_or_init(resolve_shell)
}

fn c(program: &str, args: &[&str], description: &'static str) -> ShellConfig {
    ShellConfig {
        program: PathBuf::from(program),
        args: args.iter().map(|s| s.to_string()).collect(),
        via_stdin: false,
        description,
    }
}

fn resolve_shell() -> ShellConfig {
    if let Some(path) = std::env::var_os("JAN_AGENT_SHELL") {
        let p = PathBuf::from(&path);
        if p.exists() {
            return ShellConfig {
                program: p,
                args: vec!["-c".to_string()],
                via_stdin: false,
                description: "custom",
            };
        }
    }
    #[cfg(unix)]
    {
        // Prefer the bash on `PATH` over the fixed `/bin/bash`: on NixOS the
        // shell lives only at a Nix-store path resolved via `which`, so a
        // hardcoded `/bin/bash` does not exist there and the fixed path would be
        // wrong.
        // `/bin/bash` stays as the fallback for systems where `which` is absent
        // or `PATH` is degenerate but `/bin/bash` is real (e.g. cron); `/bin/sh`
        // is the guaranteed-POSIX last resort.
        if let Some(p) = which("bash") {
            return ShellConfig {
                program: p,
                args: vec!["-c".to_string()],
                via_stdin: false,
                description: "bash",
            };
        }
        if Path::new("/bin/bash").exists() {
            return c("/bin/bash", &["-c"], "bash");
        }
        c("/bin/sh", &["-c"], "sh")
    }
    #[cfg(windows)]
    {
        // Prefer a real bash before ever falling back to cmd, so POSIX command
        // syntax keeps working. Check the standard git-bash/msys install
        // locations under the well-known program dirs first, then `bash` on
        // PATH.
        for var in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"] {
            if let Some(base) = std::env::var_os(var) {
                let git_bash = PathBuf::from(base).join("Git").join("bin").join("bash.exe");
                if git_bash.exists() {
                    return ShellConfig {
                        program: git_bash,
                        args: vec!["-c".to_string()],
                        via_stdin: false,
                        description: "git-bash",
                    };
                }
            }
        }
        if let Some(p) = which("bash") {
            // The WSL launcher is the shim at System32\bash.exe; it rejects
            // `-c`, so the command must be piped to `bash -s` on stdin. Only
            // that exact location is treated as WSL, so a real bash that merely
            // lives under a directory named `system32` is not misrouted to
            // stdin one-shot mode.
            let is_wsl = p
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.eq_ignore_ascii_case("bash.exe"))
                .unwrap_or(false)
                && p.parent()
                    .and_then(|d| d.file_name())
                    .and_then(|n| n.to_str())
                    .map(|n| n.eq_ignore_ascii_case("System32"))
                    .unwrap_or(false);
            if is_wsl {
                return ShellConfig {
                    program: p,
                    args: vec!["-s".to_string()],
                    via_stdin: true,
                    description: "wsl bash",
                };
            }
            return ShellConfig {
                program: p,
                args: vec!["-c".to_string()],
                via_stdin: false,
                description: "bash",
            };
        }
        // No bash anywhere: cmd is the only shell. The model is told this (the
        // runtime env block reports COMSPEC, and the bash handler's output note
        // names cmd) so it can write cmd syntax rather than silently passing
        // POSIX commands that cmd would reject.
        c("cmd.exe", &["/C"], "cmd")
    }
}

/// Locate an executable on PATH via the platform's own resolver. Also used by
/// [`super::jail`] to find `bwrap` on distros with no FHS paths (NixOS keeps it
/// only at a Nix-store path).
pub(crate) fn which(name: &str) -> Option<PathBuf> {
    #[cfg(unix)]
    let finder = "which";
    #[cfg(windows)]
    let finder = "where";
    let out = std::process::Command::new(finder).arg(name).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let first = text.lines().map(str::trim).find(|l| !l.is_empty())?;
    Some(PathBuf::from(first))
}

/// Spawn `command` in `cwd` using the resolved shell, as a new process group,
/// with stdout/stderr piped and `kill_on_drop` armed. The returned child's pid
/// is registered so [`kill_all`] can reap it on shutdown; the caller must
/// [`unregister`] it once the command finishes. The child inherits only the
/// minimal environment in `SANDBOX_ENV_ALLOW`, never the full host environment.
///
/// The full host environment leaks secrets to any `bash` call -- `JAN_API_KEY`,
/// `OPENAI_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `SSH_AUTH_SOCK`, the relocated
/// `JAN_DATA_FOLDER` -- so the shell is launched with only what a command needs
/// to run at all. Applied here, the one choke point all backends (bubblewrap,
/// seatbelt, and the Windows AppContainer helper) funnel through.
const SANDBOX_ENV_ALLOW: &[&str] = &[
    "PATH",
    "HOME",
    "USERPROFILE",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "TERM",
    // Windows processes (cmd, and the cygwin/git-bash and MSYS runtimes) need
    // the system location keys to find system DLLs, `cmd.exe` itself, and run
    // `.bat`/`.cmd` helpers. Harmless no-ops on unix, where none are set.
    "SystemRoot",
    "windir",
    "ComSpec",
    "PATHEXT",
    "ProgramFiles",
    "ProgramData",
];

/// Every spelling of "where temporary files go": POSIX tools read `TMPDIR`,
/// Windows ones `TEMP`/`TMP`, and a mixed toolchain (git-bash, MSYS) reads both.
/// All are pointed at the scratch together so no tool falls back to the host.
const TEMP_ENV_KEYS: &[&str] = &["TMPDIR", "TMP", "TEMP"];

/// Soft limits the sandboxed child runs under, each capped by the host's hard
/// limit. `NOFILE` is deliberately generous: toolchains (linkers, node, cargo)
/// routinely want tens of thousands of descriptors, and a descriptor cap that
/// low breaks ordinary work long before it stops abuse.
#[cfg(unix)]
const CHILD_LIMITS: &[(u32, u64)] = &[
    (nix::libc::RLIMIT_NPROC, 4096),
    (nix::libc::RLIMIT_NOFILE, 65536),
    (nix::libc::RLIMIT_FSIZE, 1024 * 1024 * 1024),
];

/// Bound the resource exhaustion a sandboxed command could otherwise trigger on
/// the host. `bwrap` 0.6.1 (and older) has no `--rlimit`, so instead we clamp the
/// child's soft limits here, before exec, from the one choke point every backend
/// funnels through. A fork-bomb is capped by `NPROC`, descriptor exhaustion by
/// `NOFILE`, and disk fill through the unbounded workspace bind by `FSIZE`. The
/// hard limit is left at the host's value so a command that genuinely needs more
/// can raise its own soft limit back up. The bwrap wrapper execs `bwrap` itself,
/// which sets up the namespace and then execs the real shell, so the limits carry
/// over to every descendant. Linux only; the Windows AppContainer child is
/// limited by its token.
#[cfg(unix)]
fn confine_limits(cmd: &mut Command) {
    // `tokio::process::Command::pre_exec` (unix) is the std `pre_exec`; the call
    // below is what mounts the limits.
    // # Safety: `pre_exec` runs in the forked child before exec. Only async-signal-
    // safe calls are allowed; `getrlimit`/`setrlimit` are. Errors fall back to the
    // parent's values and are ignored (best effort), so a kernel that refuses a
    // limit cannot wedge a launch.
    unsafe {
        cmd.pre_exec(|| {
            for &(resource, limit) in CHILD_LIMITS {
                let mut r = nix::libc::rlimit {
                    rlim_cur: 0,
                    rlim_max: 0,
                };
                if nix::libc::getrlimit(resource, &mut r) != 0 {
                    continue;
                }
                // Never exceed the host's hard limit; setrlimit would refuse.
                let ceiling = if r.rlim_max == nix::libc::RLIM_INFINITY {
                    limit
                } else {
                    limit.min(r.rlim_max)
                };
                r.rlim_cur = ceiling;
                // Best effort: a setrlimit failure is intentionally ignored so a
                // kernel that refuses a limit cannot wedge the launch.
                let _ = nix::libc::setrlimit(resource, &r);
            }
            Ok(())
        });
    }
}

/// Case-insensitive markers a `passthrough` glob must never copy, so a broad
/// pattern (`GIT_*`, `*`) cannot leak a credential into the shell. To inject one
/// on purpose, name it in [`ShellEnv::set`], which is not scrubbed.
fn is_secret_name(name: &str) -> bool {
    const MARKERS: &[&str] = &["KEY", "SECRET", "TOKEN", "PASSWORD", "PASSWD", "CREDENTIAL"];
    let upper = name.to_ascii_uppercase();
    MARKERS.iter().any(|m| upper.contains(m))
}

/// Minimal case-insensitive `*`-glob, the one wildcard an env-var allowlist
/// needs. `*` matches any run (including empty); every other character is
/// literal. No `?`/`[]` -- env-var names do not use them.
fn glob_match(pattern: &str, name: &str) -> bool {
    let p = pattern.to_ascii_uppercase();
    let n = name.to_ascii_uppercase();
    if !p.contains('*') {
        return p == n;
    }
    let parts: Vec<&str> = p.split('*').collect();
    let last = parts.len() - 1;
    let mut pos = 0usize;
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty() {
            continue;
        }
        if i == 0 {
            if !n[pos..].starts_with(part) {
                return false;
            }
            pos += part.len();
        } else if i == last {
            if !n[pos..].ends_with(part) {
                return false;
            }
        } else {
            match n[pos..].find(part) {
                Some(idx) => pos += idx + part.len(),
                None => return false,
            }
        }
    }
    true
}

/// The env additions for a run: host vars matched by `passthrough` (minus
/// secret-looking names) followed by `set`, which wins per key. Pure over its
/// `host` input so it is unit-tested without spawning a shell.
pub(crate) fn resolve_env_overrides<I>(host: I, env: ShellEnv<'_>) -> Vec<(String, String)>
where
    I: IntoIterator<Item = (String, String)>,
{
    let mut out: Vec<(String, String)> = Vec::new();
    if !env.passthrough.is_empty() {
        for (name, val) in host {
            if is_secret_name(&name) {
                continue;
            }
            if env.passthrough.iter().any(|p| glob_match(p, &name)) {
                out.push((name, val));
            }
        }
    }
    for (key, val) in env.set {
        out.retain(|(n, _)| n != key);
        out.push((key.clone(), val.clone()));
    }
    out
}

pub async fn spawn(
    cfg: &ShellConfig,
    command: &str,
    cwd: &Path,
    scratch: Option<&Path>,
    env: ShellEnv<'_>,
    thread: Option<&str>,
) -> std::io::Result<Child> {
    let mut cmd = Command::new(&cfg.program);
    cmd.args(&cfg.args);
    if !cfg.via_stdin {
        cmd.arg(command);
    }
    // Strip every inherited variable, then re-add only the allowlist so the
    // sandboxed process holds no host secrets regardless of which backend wraps
    // it. `current_dir` on the workspace keeps relative work correct.
    cmd.env_clear();
    for key in SANDBOX_ENV_ALLOW {
        if let Some(val) = std::env::var_os(key) {
            cmd.env(key, val);
        }
    }
    // Layer the run's configured pass-through and explicit overrides on top of
    // the base allowlist. Deny-by-default is preserved: nothing here is copied
    // unless the config named it, and a secret-looking host var is never copied
    // by a glob (see [`resolve_env_overrides`]).
    for (key, val) in resolve_env_overrides(std::env::vars(), env) {
        cmd.env(key, val);
    }
    // Point the shell's temp env at the session scratch, overriding the host
    // values the allowlist just copied in. Without this a command that writes
    // through `mktemp`/`$TMPDIR` lands in the host temp dir -- unreachable to
    // the filesystem tools, and on the backends that confine by path, not
    // writable at all. `scratch` is what the sandbox exposes, which is not
    // always the host path (see `jail::scratch_env_path`).
    if let Some(scratch) = scratch {
        for key in TEMP_ENV_KEYS {
            cmd.env(key, scratch);
        }
    }
    cmd.current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(if cfg.via_stdin {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .kill_on_drop(true);
    set_process_group(&mut cmd);
    #[cfg(unix)]
    confine_limits(&mut cmd);

    let mut child = cmd.spawn()?;

    if cfg.via_stdin {
        if let Some(mut stdin) = child.stdin.take() {
            use tokio::io::AsyncWriteExt;
            let _ = stdin.write_all(command.as_bytes()).await;
            let _ = stdin.write_all(b"\n").await;
            let _ = stdin.shutdown().await;
        }
    }

    if let Some(pid) = child.id() {
        register(thread, pid, command);
    }
    Ok(child)
}

#[cfg(unix)]
fn set_process_group(cmd: &mut Command) {
    // pgid 0 => the child becomes leader of a new group whose id equals its pid,
    // so `kill_tree(pid)` can signal the whole group.
    cmd.process_group(0);
}

#[cfg(windows)]
fn set_process_group(cmd: &mut Command) {
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    cmd.creation_flags(CREATE_NEW_PROCESS_GROUP);
}

/// Kill the process `pid` and every descendant it spawned.
///
/// Every child we register is spawned with `process_group(0)` (see
/// [`set_process_group`]), so its pgid equals its pid and `killpg` reaps the
/// whole tree. There is deliberately no bare-`kill(pid)` fallback: `killpg`
/// fails only when the group is already gone (ESRCH) or we lack permission
/// (EPERM, which a single `kill` would hit too), so the fallback could never
/// help a live tree -- it could only signal a recycled pid, since the registry
/// lock is dropped before this call and the OS may have reused the number.
#[cfg(unix)]
pub fn kill_tree(pid: u32) {
    use nix::sys::signal::{killpg, Signal};
    use nix::unistd::Pid;
    let _ = killpg(Pid::from_raw(pid as i32), Signal::SIGKILL);
}

#[cfg(windows)]
pub fn kill_tree(pid: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/F", "/T", "/PID", &pid.to_string()])
        .output();
}

/// A running bash command: what it is, when it started, and whether it outran
/// its call's timeout and detached into the background. Backs the `/shells`
/// inspector, which lists the detached ones so the user can stop a stuck job.
struct ShellProc {
    command: String,
    started: Instant,
    backgrounded: bool,
}

/// One running background shell, as `snapshot` reports it to the UI. `pid` is
/// the handle [`kill`] takes to stop it.
#[derive(Debug, Clone)]
pub struct ShellInfo {
    pub pid: u32,
    pub command: String,
    pub elapsed_secs: u64,
    pub backgrounded: bool,
}

/// Running bash commands, bucketed by the session (thread id) that spawned them
/// and keyed by pid, so a per-session cancel (`kill_thread`) reaps exactly that
/// session's shells without touching a concurrently-running one. Callers with no
/// session (the monitor poll children, tests) share the [`NO_THREAD`] bucket,
/// which only `kill_all` reaps.
fn running() -> &'static Mutex<HashMap<String, HashMap<u32, ShellProc>>> {
    static RUNNING: OnceLock<Mutex<HashMap<String, HashMap<u32, ShellProc>>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Bucket for pids spawned outside any session.
const NO_THREAD: &str = "";

pub fn register(thread: Option<&str>, pid: u32, command: &str) {
    running()
        .lock()
        .unwrap()
        .entry(thread.unwrap_or(NO_THREAD).to_string())
        .or_default()
        .insert(
            pid,
            ShellProc {
                command: command.to_string(),
                started: Instant::now(),
                backgrounded: false,
            },
        );
}

pub fn unregister(thread: Option<&str>, pid: u32) {
    let key = thread.unwrap_or(NO_THREAD);
    let mut map = running().lock().unwrap();
    if let Some(set) = map.get_mut(key) {
        set.remove(&pid);
        if set.is_empty() {
            map.remove(key);
        }
    }
}

/// Flag a still-running command as backgrounded: it outran its `bash` call's
/// timeout and is now detached, so `/shells` should list it. A no-op if the pid
/// already finished (the detached task unregistered it in the race).
pub fn mark_backgrounded(thread: Option<&str>, pid: u32) {
    if let Some(set) = running().lock().unwrap().get_mut(thread.unwrap_or(NO_THREAD)) {
        if let Some(proc) = set.get_mut(&pid) {
            proc.backgrounded = true;
        }
    }
}

/// Every currently-running bash command across all sessions, pid-sorted for a
/// stable list. The `/shells` inspector filters to the backgrounded ones.
pub fn snapshot() -> Vec<ShellInfo> {
    let map = running().lock().unwrap();
    let mut out: Vec<ShellInfo> = map
        .values()
        .flat_map(|set| {
            set.iter().map(|(pid, p)| ShellInfo {
                pid: *pid,
                command: p.command.clone(),
                elapsed_secs: p.started.elapsed().as_secs(),
                backgrounded: p.backgrounded,
            })
        })
        .collect();
    out.sort_by_key(|s| s.pid);
    out
}

/// Stop one running shell by pid: reap its whole tree and drop it from the
/// registry. Returns whether the pid was known. Drives the `/shells` stop action.
pub fn kill(pid: u32) -> bool {
    let found = {
        let mut map = running().lock().unwrap();
        let hit = map.values_mut().any(|set| set.remove(&pid).is_some());
        map.retain(|_, set| !set.is_empty());
        hit
    };
    if found {
        kill_tree(pid);
    }
    found
}

/// Reap every bash tree a session started. The per-session counterpart of
/// [`kill_all`]: the Stop button drives this so a running or backgrounded shell
/// is terminated with the run rather than left to finish on the host.
pub fn kill_thread(thread: &str) {
    let pids: Vec<u32> = running()
        .lock()
        .unwrap()
        .remove(thread)
        .map(|set| set.into_keys().collect())
        .unwrap_or_default();
    for pid in pids {
        kill_tree(pid);
    }
}

/// Reap every still-running bash command across all sessions. Called on app
/// shutdown so no shell tree outlives the process that spawned it.
pub fn kill_all() {
    let pids: Vec<u32> = running()
        .lock()
        .unwrap()
        .drain()
        .flat_map(|(_, set)| set.into_keys())
        .collect();
    for pid in pids {
        kill_tree(pid);
    }
}

#[cfg(test)]
mod env_allowlist_tests {
    use super::*;

    /// Windows-native processes (cmd, plus the cygwin/git-bash and MSYS
    /// runtimes) need the system-location keys to find DLLs and `cmd.exe`
    /// itself. These are the keys the ticket adds; assert they stay present so
    /// a bare Windows box can actually run a command.
    #[test]
    fn allowlist_has_windows_system_keys() {
        for key in ["SystemRoot", "windir", "ComSpec", "PATHEXT", "ProgramFiles", "ProgramData"] {
            assert!(
                SANDBOX_ENV_ALLOW.contains(&key),
                "missing {key} in SANDBOX_ENV_ALLOW"
            );
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use tokio::io::AsyncBufReadExt;

    fn tmp() -> PathBuf {
        std::env::temp_dir()
    }

    fn alive(pid: i32) -> bool {
        use nix::sys::signal::kill;
        use nix::unistd::Pid;
        kill(Pid::from_raw(pid), None).is_ok()
    }

    #[test]
    fn resolves_a_bash_like_shell() {
        let cfg = shell();
        assert!(cfg.program.exists(), "resolved shell must exist: {cfg:?}");
        assert!(!cfg.args.is_empty());
    }

    #[tokio::test]
    async fn runs_a_command_and_captures_stdout() {
        let child = spawn(shell(), "echo hello", &tmp(), None, ShellEnv::default(), None).await.unwrap();
        let pid = child.id().unwrap();
        let out = child.wait_with_output().await.unwrap();
        unregister(None, pid);
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "hello");
    }

    /// `mktemp`, `pytest`, `cargo` and friends write to `$TMPDIR`, so the scratch
    /// is only useful if it is what the shell's temp env names. All three
    /// spellings are set: POSIX tools read `TMPDIR`, Windows ones `TEMP`/`TMP`.
    #[tokio::test]
    async fn temp_env_points_at_the_scratch_when_one_is_given() {
        let scratch = tmp().join("jan_proc_scratch_env");
        std::fs::create_dir_all(&scratch).unwrap();
        let child = spawn(
            shell(),
            "echo \"$TMPDIR $TMP $TEMP\"",
            &tmp(),
            Some(&scratch),
            ShellEnv::default(),
            None,
        )
        .await
        .unwrap();
        let pid = child.id().unwrap();
        let out = child.wait_with_output().await.unwrap();
        unregister(None, pid);
        let s = scratch.to_string_lossy();
        assert_eq!(
            String::from_utf8_lossy(&out.stdout).trim(),
            format!("{s} {s} {s}")
        );
        let _ = std::fs::remove_dir_all(&scratch);
    }

    /// With no scratch the shell keeps whatever the host allowlist passed
    /// through, rather than being handed an empty temp dir.
    #[tokio::test]
    async fn temp_env_is_left_alone_without_a_scratch() {
        let child = spawn(shell(), "echo ${TMPDIR:-unset}", &tmp(), None, ShellEnv::default(), None)
            .await
            .unwrap();
        let pid = child.id().unwrap();
        let out = child.wait_with_output().await.unwrap();
        unregister(None, pid);
        let expected = std::env::var("TMPDIR").unwrap_or_else(|_| "unset".to_string());
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), expected);
    }

    #[tokio::test]
    async fn kill_tree_reaps_backgrounded_grandchild() {
        // The shell backgrounds a long sleeper, prints its pid, then waits on
        // it. Killing the group must take down that grandchild too.
        let mut child = spawn(shell(), "sleep 300 & echo $! ; wait", &tmp(), None, ShellEnv::default(), None)
            .await
            .unwrap();
        let leader = child.id().unwrap();
        let stdout = child.stdout.take().unwrap();
        let mut lines = tokio::io::BufReader::new(stdout).lines();
        let first = tokio::time::timeout(std::time::Duration::from_secs(5), lines.next_line())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let grandchild: i32 = first.trim().parse().unwrap();
        assert!(alive(grandchild), "grandchild should be running");

        kill_tree(leader);
        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), child.wait()).await;
        unregister(None, leader);

        // Give the kernel a moment to tear the group down.
        for _ in 0..50 {
            if !alive(grandchild) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        assert!(!alive(grandchild), "grandchild must be reaped by group kill");
    }

    fn is_registered(thread: Option<&str>, pid: u32) -> bool {
        running()
            .lock()
            .unwrap()
            .get(thread.unwrap_or(NO_THREAD))
            .map(|set| set.contains_key(&pid))
            .unwrap_or(false)
    }

    #[test]
    fn register_and_unregister_track_pids() {
        // A pid outside any real range: exercising the registry only, never
        // signalling a live process (kill_all is shutdown-only and would reap
        // other tests' children if called under the parallel harness).
        let fake = u32::MAX - 1;
        register(Some("thread-a"), fake, "sleep 1");
        assert!(is_registered(Some("thread-a"), fake));
        unregister(Some("thread-a"), fake);
        assert!(!is_registered(Some("thread-a"), fake));
    }

    /// `mark_backgrounded` flips only the named pid, and `snapshot` reports it
    /// with its command so `/shells` can name the detached job.
    #[test]
    fn snapshot_reports_backgrounded_shells_with_their_command() {
        let (fg, bg) = (u32::MAX - 10, u32::MAX - 11);
        register(Some("snap"), fg, "cargo build");
        register(Some("snap"), bg, "sleep 300");
        mark_backgrounded(Some("snap"), bg);
        let shells = snapshot();
        let got = |pid| shells.iter().find(|s| s.pid == pid).cloned();
        assert_eq!(got(bg).unwrap().command, "sleep 300");
        assert!(got(bg).unwrap().backgrounded, "marked one is backgrounded");
        assert!(!got(fg).unwrap().backgrounded, "the other is not");
        unregister(Some("snap"), fg);
        unregister(Some("snap"), bg);
    }

    /// `kill` drops the named pid from the registry (whichever bucket it is in)
    /// and reports whether it was known; an unknown pid is a no-op. Fake pids
    /// chosen to stay a positive, implausible i32 so the `kill_tree` this reaches
    /// signals a non-existent group (ESRCH), never a real low-numbered one.
    #[test]
    fn kill_removes_a_known_pid_and_reports_unknown() {
        let fake = 2_000_000_001;
        register(Some("kill-sess"), fake, "sleep 300");
        assert!(is_registered(Some("kill-sess"), fake));
        assert!(kill(fake), "a known pid is reported found");
        assert!(!is_registered(Some("kill-sess"), fake), "and dropped");
        assert!(!kill(2_000_000_002), "an unknown pid is a no-op");
    }

    /// `kill_thread` reaps only its own session's pids and leaves another
    /// session's registrations intact, so Stop in one run cannot tear down a
    /// concurrent run's shell. Fake pids: exercising bucketing, never signalling.
    #[test]
    fn kill_thread_is_scoped_to_its_session() {
        let (a, b) = (u32::MAX - 2, u32::MAX - 3);
        register(Some("sess-a"), a, "sleep 1");
        register(Some("sess-b"), b, "sleep 1");
        kill_thread("sess-a");
        assert!(!is_registered(Some("sess-a"), a), "own session must be reaped");
        assert!(is_registered(Some("sess-b"), b), "other session must survive");
        unregister(Some("sess-b"), b);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn confine_limits_caps_the_child_process_count() {
        // The rlimit mounting must actually reach the spawned child: with NPROC
        // clamped we still run up to the cap, but a fork-bomb past it fails.
        let child = spawn(shell(), "exit 0", &tmp(), None, ShellEnv::default(), None).await.unwrap();
        let pid = child.id().unwrap();
        child.wait_with_output().await.unwrap();
        unregister(None, pid);

        // Spawn a shell that reports its own soft NOFILE limit; confine_limits
        // sets it to the target, bounded by whatever hard limit the host allows.
        let child = spawn(shell(), "ulimit -n", &tmp(), None, ShellEnv::default(), None).await.unwrap();
        let pid = child.id().unwrap();
        let out = child.wait_with_output().await.unwrap();
        unregister(None, pid);
        let val = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let mut host = nix::libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        // # Safety: reads the calling process's own limit into a local.
        unsafe { nix::libc::getrlimit(nix::libc::RLIMIT_NOFILE, &mut host) };
        let want = if host.rlim_max == nix::libc::RLIM_INFINITY {
            65536
        } else {
            65536u64.min(host.rlim_max)
        };
        assert_eq!(
            val,
            want.to_string(),
            "NOFILE soft limit should be raised to the target, got: {val}"
        );
    }
}

#[cfg(test)]
mod env_policy_tests {
    use super::*;

    fn host(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn glob_matches_prefix_suffix_and_infix_case_insensitively() {
        assert!(glob_match("GIT_*", "GIT_AUTHOR_NAME"));
        assert!(glob_match("git_*", "GIT_AUTHOR_NAME"));
        assert!(glob_match("*_PROXY", "http_proxy".to_ascii_uppercase().as_str()));
        assert!(glob_match("*PROXY*", "HTTPS_PROXY_HOST"));
        assert!(glob_match("*", "ANYTHING"));
        assert!(glob_match("PATH", "PATH"));
        assert!(!glob_match("GIT_*", "CARGO_HOME"));
        assert!(!glob_match("PATH", "PATHEXT"));
    }

    #[test]
    fn secret_names_are_recognized() {
        for name in ["OPENAI_API_KEY", "MY_SECRET", "GH_TOKEN", "DB_PASSWORD", "aws_credential"] {
            assert!(is_secret_name(name), "{name} should read as secret");
        }
        for name in ["PATH", "HOME", "GIT_AUTHOR_NAME", "RUST_LOG"] {
            assert!(!is_secret_name(name), "{name} should not read as secret");
        }
    }

    #[test]
    fn empty_policy_copies_nothing() {
        let out = resolve_env_overrides(host(&[("PATH", "/bin"), ("FOO", "bar")]), ShellEnv::default());
        assert!(out.is_empty());
    }

    #[test]
    fn passthrough_copies_matches_and_skips_secret_named_vars() {
        let pats = vec!["GIT_*".to_string(), "CARGO_HOME".to_string()];
        let env = ShellEnv { passthrough: &pats, set: &[] };
        let out = resolve_env_overrides(
            host(&[
                ("GIT_AUTHOR_NAME", "Ada"),
                ("GIT_TOKEN", "leak"), // matches GIT_* but is secret-named
                ("CARGO_HOME", "/c"),
                ("UNRELATED", "x"),
            ]),
            env,
        );
        assert!(out.contains(&("GIT_AUTHOR_NAME".into(), "Ada".into())));
        assert!(out.contains(&("CARGO_HOME".into(), "/c".into())));
        assert!(!out.iter().any(|(k, _)| k == "GIT_TOKEN"), "secret-named var must not leak");
        assert!(!out.iter().any(|(k, _)| k == "UNRELATED"));
    }

    #[test]
    fn set_wins_over_passthrough_and_injects_verbatim() {
        let pats = vec!["RUST_LOG".to_string()];
        let set = vec![
            ("RUST_LOG".to_string(), "debug".to_string()),
            ("GH_TOKEN".to_string(), "explicit".to_string()), // secret-named but user-named
        ];
        let env = ShellEnv { passthrough: &pats, set: &set };
        let out = resolve_env_overrides(host(&[("RUST_LOG", "info")]), env);
        // Only one RUST_LOG, and it is the set value.
        assert_eq!(out.iter().filter(|(k, _)| k == "RUST_LOG").count(), 1);
        assert!(out.contains(&("RUST_LOG".into(), "debug".into())));
        assert!(out.contains(&("GH_TOKEN".into(), "explicit".into())));
    }
}
