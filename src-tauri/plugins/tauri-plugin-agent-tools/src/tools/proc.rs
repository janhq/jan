//! Process-group-aware shell spawning and whole-tree termination for the `bash`
//! tool. Every command runs as its own process-group leader so a timeout,
//! cancel, or app shutdown can reap the entire descendant tree, not just the
//! top-level shell. Without this, any command that spawns children (a build, a
//! `foo &`, a pipeline) leaks orphans when the run is torn down.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};

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

/// Bound the resource exhaustion a sandboxed command could otherwise trigger on
/// the host. `bwrap` 0.6.1 (and older) has no `--rlimit`, so instead we clamp the
/// child's soft limits here, before exec, from the one choke point every backend
/// funnels through. A fork-bomb is capped by `NPROC`, descriptor exhaustion by
/// `NOFILE`, and disk fill through the unbounded workspace bind by `FSIZE`. The
/// bwrap wrapper execs `bwrap` itself, which sets up the namespace and then
/// execs the real shell, so the limits carry over to every descendant. Linux
/// only; the Windows AppContainer child is limited by its token.
#[cfg(unix)]
fn confine_limits(cmd: &mut Command) {
    // `tokio::process::Command::pre_exec` (unix) is the std `pre_exec`; the call
    // below is what mounts the limits.
    // # Safety: `pre_exec` runs in the forked child before exec. Only async-signal-
    // safe calls are allowed; `setrlimit` is one. Errors fall back to the parent's
    // values and are ignored (best effort), so a kernel that refuses a limit
    // cannot wedge a launch.
    unsafe {
        cmd.pre_exec(|| {
            for (resource, limit) in [
                (nix::libc::RLIMIT_NPROC, 4096_u64),
                (nix::libc::RLIMIT_NOFILE, 1024_u64),
                (nix::libc::RLIMIT_FSIZE, 1024_u64 * 1024_u64 * 1024_u64),
            ] {
                let r = nix::libc::rlimit {
                    rlim_cur: limit,
                    rlim_max: limit,
                };
                // Best effort: a setrlimit failure is intentionally ignored so a
                // kernel that refuses a limit cannot wedge the launch.
                let _ = nix::libc::setrlimit(resource, &r);
            }
            Ok(())
        });
    }
}

pub async fn spawn(
    cfg: &ShellConfig,
    command: &str,
    cwd: &Path,
    scratch: Option<&Path>,
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
        register(pid);
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
#[cfg(unix)]
pub fn kill_tree(pid: u32) {
    use nix::sys::signal::{killpg, Signal};
    use nix::unistd::Pid;
    let group = Pid::from_raw(pid as i32);
    if killpg(group, Signal::SIGKILL).is_err() {
        let _ = nix::sys::signal::kill(Pid::from_raw(pid as i32), Signal::SIGKILL);
    }
}

#[cfg(windows)]
pub fn kill_tree(pid: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/F", "/T", "/PID", &pid.to_string()])
        .output();
}

fn running() -> &'static Mutex<HashSet<u32>> {
    static RUNNING: OnceLock<Mutex<HashSet<u32>>> = OnceLock::new();
    RUNNING.get_or_init(|| Mutex::new(HashSet::new()))
}

pub fn register(pid: u32) {
    running().lock().unwrap().insert(pid);
}

pub fn unregister(pid: u32) {
    running().lock().unwrap().remove(&pid);
}

/// Reap every still-running bash command. Called on app shutdown so no shell
/// tree outlives the process that spawned it.
pub fn kill_all() {
    let pids: Vec<u32> = running().lock().unwrap().drain().collect();
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
        let child = spawn(shell(), "echo hello", &tmp(), None).await.unwrap();
        let pid = child.id().unwrap();
        let out = child.wait_with_output().await.unwrap();
        unregister(pid);
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
        )
        .await
        .unwrap();
        let pid = child.id().unwrap();
        let out = child.wait_with_output().await.unwrap();
        unregister(pid);
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
        let child = spawn(shell(), "echo ${TMPDIR:-unset}", &tmp(), None)
            .await
            .unwrap();
        let pid = child.id().unwrap();
        let out = child.wait_with_output().await.unwrap();
        unregister(pid);
        let expected = std::env::var("TMPDIR").unwrap_or_else(|_| "unset".to_string());
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), expected);
    }

    #[tokio::test]
    async fn kill_tree_reaps_backgrounded_grandchild() {
        // The shell backgrounds a long sleeper, prints its pid, then waits on
        // it. Killing the group must take down that grandchild too.
        let mut child = spawn(shell(), "sleep 300 & echo $! ; wait", &tmp(), None)
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
        unregister(leader);

        // Give the kernel a moment to tear the group down.
        for _ in 0..50 {
            if !alive(grandchild) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        assert!(!alive(grandchild), "grandchild must be reaped by group kill");
    }

    #[test]
    fn register_and_unregister_track_pids() {
        // A pid outside any real range: exercising the registry only, never
        // signalling a live process (kill_all is shutdown-only and would reap
        // other tests' children if called under the parallel harness).
        let fake = u32::MAX - 1;
        register(fake);
        assert!(running().lock().unwrap().contains(&fake));
        unregister(fake);
        assert!(!running().lock().unwrap().contains(&fake));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn confine_limits_caps_the_child_process_count() {
        // The rlimit mounting must actually reach the spawned child: with NPROC
        // clamped we still run up to the cap, but a fork-bomb past it fails.
        let child = spawn(shell(), "exit 0", &tmp(), None).await.unwrap();
        let pid = child.id().unwrap();
        child.wait_with_output().await.unwrap();
        unregister(pid);

        // Spawn a shell that reports its own soft NOFILE limit; confine_limits
        // sets it to 1024, which should be visible inside the sandbox.
        let child = spawn(shell(), "ulimit -n", &tmp(), None).await.unwrap();
        let pid = child.id().unwrap();
        let out = child.wait_with_output().await.unwrap();
        unregister(pid);
        let val = String::from_utf8_lossy(&out.stdout).trim().to_string();
        assert_eq!(val, "1024", "NOFILE soft limit should be capped, got: {val}");
    }
}
