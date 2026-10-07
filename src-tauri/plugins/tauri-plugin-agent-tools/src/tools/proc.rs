//! Process-group-aware shell spawning and whole-tree termination for the `bash`
//! tool. Every command runs as its own process-group leader so a timeout,
//! cancel, or app shutdown can reap the entire descendant tree, not just the
//! top-level shell. Without this, any command that spawns children (a build, a
//! `foo &`, a pipeline) leaks orphans when the run is torn down.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock, RwLock};
use std::time::Instant;

use tokio::process::{Child, Command};

/// User-supplied, plugin-declared credentials, scoped to the project that
/// registered them. Concurrent projects must never replace each other's keys.
static PLUGIN_ENV: RwLock<BTreeMap<PathBuf, BTreeMap<String, String>>> =
    RwLock::new(BTreeMap::new());

/// Replace one project's plugin credentials, or revoke them with an empty map.
pub fn set_plugin_env(root: &Path, vars: BTreeMap<String, String>) {
    let root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let mut projects = PLUGIN_ENV.write().unwrap();
    if vars.is_empty() {
        projects.remove(&root);
    } else {
        projects.insert(root, vars);
    }
}

/// True for variable names the sandbox owns itself: the static allowlist, the
/// scratch temp keys, and the classic dynamic-linker/loader injection
/// prefixes. The host refuses to store or inject plugin-declared values under
/// these names -- a plugin declaring `PATH` or `LD_PRELOAD` would otherwise
/// let one pasted value clobber (or escape) the sandbox environment wholesale.
pub fn is_reserved_env_key(key: &str) -> bool {
    SANDBOX_ENV_ALLOW.contains(&key)
        || TEMP_ENV_KEYS.contains(&key)
        || key.starts_with("LD_")
        || key.starts_with("DYLD_")
        || key.starts_with("SUDO_")
}

/// The command language a resolved shell speaks. It decides how the command is
/// handed over (see [`spawn_with_stdin`]) and what the model is told to write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellKind {
    /// `bash`/`sh` and anything else that takes `-c <command>`.
    Posix,
    /// Windows PowerShell 5.1 (`powershell.exe`) or PowerShell 7 (`pwsh`).
    PowerShell,
    /// `cmd.exe`, the last resort on a Windows box with neither.
    Cmd,
}

impl ShellKind {
    /// The sentence that tells the model which syntax to write, for every shell
    /// that is not the POSIX one it assumes by default. Shared by the tool
    /// description and the system prompt's runtime block so the two agree.
    pub fn syntax_note(self) -> Option<&'static str> {
        match self {
            ShellKind::Posix => None,
            ShellKind::PowerShell => Some(
                "Commands run in PowerShell: write PowerShell syntax (e.g. `Get-ChildItem`, \
                 `Get-Content`, `$env:VAR`, `;` between statements), not bash/POSIX. \
                 Relative paths work. For a full path, use `Convert-Path` rather than \
                 `$PWD` or `Resolve-Path`, which may show a drive other programs cannot open.",
            ),
            ShellKind::Cmd => Some(
                "Commands run in cmd.exe: write cmd syntax (e.g. `dir`, `type`, `set`, \
                 `%VAR%`), not bash/POSIX.",
            ),
        }
    }
}

/// How to invoke the host shell. `program` + `args` are fixed; the command
/// string is appended as the final argv element.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellConfig {
    pub program: PathBuf,
    pub args: Vec<String>,
    /// The language of the shell the command finally runs in. Kept through
    /// [`super::jail::wrap`], whose wrapper program is not the shell itself.
    pub kind: ShellKind,
}

/// Fixed PowerShell arguments, the command following `-Command`. No profile so
/// a user's `$PROFILE` cannot change or slow every call; non-interactive so a
/// prompt fails instead of hanging; `Bypass` so a `.ps1` the agent writes can
/// run on a client whose default policy is `Restricted`. `-EncodedCommand` is
/// deliberately not used: with redirected output, Windows PowerShell 5.1 then
/// writes errors and progress to stderr as `#< CLIXML` records.
const POWERSHELL_ARGS: &[&str] = &[
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
];

/// `/D` skips the AutoRun registry hook, as `-NoProfile` does for PowerShell.
/// `/S` makes cmd strip exactly the outer quote pair [`cmd_payload`] adds, so
/// the command's own quotes survive whatever it contains.
const CMD_ARGS: &[&str] = &["/D", "/S", "/C"];

/// Classify a shell by its file name, case-insensitively and with either path
/// separator, so a `JAN_AGENT_SHELL` pointing at PowerShell or cmd is driven as
/// one rather than handed `-c`.
pub fn kind_of(program: &Path) -> ShellKind {
    let text = program.to_string_lossy();
    let name = text.rsplit(['/', '\\']).next().unwrap_or(&text).to_ascii_lowercase();
    match name.strip_suffix(".exe").unwrap_or(&name) {
        "pwsh" | "powershell" => ShellKind::PowerShell,
        "cmd" => ShellKind::Cmd,
        _ => ShellKind::Posix,
    }
}

/// The fixed arguments a shell of `kind` takes before its command.
pub fn shell_args(kind: ShellKind) -> Vec<String> {
    let args: &[&str] = match kind {
        ShellKind::Posix => &["-c"],
        ShellKind::PowerShell => POWERSHELL_ARGS,
        ShellKind::Cmd => CMD_ARGS,
    };
    args.iter().map(|s| s.to_string()).collect()
}

/// The config that drives `program` according to its [`kind_of`].
fn config_for(program: PathBuf) -> ShellConfig {
    let kind = kind_of(&program);
    ShellConfig {
        program,
        args: shell_args(kind),
        kind,
    }
}

/// The inbox modules behind everyday cmdlets: `Get-ChildItem`/`Get-Content`/
/// `Set-Location` (Management), `Write-Output`/`Select-String`/
/// `ConvertTo-Json` (Utility), `Get-Acl` (Security), `Expand-Archive`
/// (Archive). Anything else on 5.1 needs its own `Import-Module`.
const POWERSHELL_CORE_MODULES: &str = "Microsoft.PowerShell.Management, \
     Microsoft.PowerShell.Utility, Microsoft.PowerShell.Security, Microsoft.PowerShell.Archive";

/// The script PowerShell is given for `command`. PowerShell's own exit code is
/// only 0 or 1, so it is made to report a failing native command's real code,
/// which the tool output's `[exit N]` line and the model both rely on.
/// `$LASTEXITCODE` is reset first so a code left by an earlier call cannot
/// leak in.
///
/// Success is `$?` of the last statement, as in POSIX shells. On failure the
/// native code is used only when it is non-zero, so a cmdlet failing after a
/// native command that succeeded still reports 1 rather than 0. PowerShell
/// does not record which statement set `$LASTEXITCODE`, so when a cmdlet fails
/// after an earlier native command that failed, the code is that native
/// command's: still non-zero, possibly not the failing statement's own.
///
/// The command runs inside a function, and the code is handed to
/// `$host.SetShouldExit` rather than `exit`:
/// - A top-level `exit` discards formatted output that has not been flushed,
///   so `Get-Location; Write-Output x` printed nothing.
/// - An error is reported against the statement that raised it. At top level
///   that statement is the whole `-Command` text, so 5.1 echoed this wrapper
///   back with every `Write-Error`; inside the function it is just `jan_cmd`.
///
/// Output is switched to UTF-8: 5.1 otherwise encodes with the OEM code page
/// and mangles every non-ASCII character. The progress stream is silenced
/// because it is noise in captured output.
///
/// Inside the AppContainer two things need help:
/// - Windows PowerShell 5.1 cannot autoload modules: `Write-Output` is "not
///   recognized" although `Import-Module` of the same module succeeds, so on
///   5.1 the core inbox modules are imported explicitly. pwsh 7 autoloads.
/// - PowerShell starts at `C:\` rather than the working directory it was
///   given, because it cannot read the workspace's parent folders to resolve
///   the path; relative paths, `Get-ChildItem` and, on 5.1, every external
///   program then fail. The session first moves to the process's working
///   directory by its real path. Only if that is refused does it fall back to
///   a `JanWs:` drive rooted there, which needs no parent access, so the drive
///   is never used where a real path works. Under the drive, `$PWD` and
///   `Resolve-Path` read `JanWs:\...`, which a native program cannot open;
///   [`ShellKind::syntax_note`] tells the model to pass `Convert-Path` output
///   instead, which is the real path.
///
/// A `return` in the command leaves `jan_cmd` before its status line runs, so
/// the code is then taken after the call: the native code if one was set,
/// else success.
pub fn powershell_script(command: &str) -> String {
    format!(
        "$ProgressPreference = 'SilentlyContinue'\n\
         if ($PSVersionTable.PSVersion.Major -lt 6) {{ Import-Module {POWERSHELL_CORE_MODULES} -ErrorAction SilentlyContinue }}\n\
         try {{ [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) }} catch {{}}\n\
         $OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n\
         $JanWs = [Environment]::CurrentDirectory\n\
         try {{ Set-Location -LiteralPath $JanWs -ErrorAction Stop }} catch {{ try {{ $null = New-PSDrive -Name JanWs -PSProvider FileSystem -Root $JanWs -Scope Global -ErrorAction Stop; Set-Location JanWs:\\ }} catch {{}} }}\n\
         $global:LASTEXITCODE = $null\n\
         $JanExit = $null\n\
         function jan_cmd {{\n\
         {command}\n\
         $script:JanExit = if ($?) {{ 0 }} elseif ($LASTEXITCODE) {{ $LASTEXITCODE }} else {{ 1 }}\n\
         }}\n\
         jan_cmd\n\
         if ($null -eq $JanExit) {{ $JanExit = if ($LASTEXITCODE) {{ $LASTEXITCODE }} else {{ 0 }} }}\n\
         $host.SetShouldExit($JanExit)\n"
    )
}

/// The text appended, unescaped, after [`CMD_ARGS`]. cmd does its own quote
/// handling rather than the `CommandLineToArgvW` rules every argv quoter
/// follows, so an escaped `\"` reaches it literally; the command is wrapped in
/// one quote pair that `/S` removes again instead.
pub fn cmd_payload(command: &str) -> String {
    format!("\"{command}\"")
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

/// Resolved shell for this process, computed once. `JAN_AGENT_SHELL` wins;
/// otherwise `bash` on unix and PowerShell on Windows, with `cmd` only as the
/// last resort.
pub fn shell() -> &'static ShellConfig {
    static SHELL: OnceLock<ShellConfig> = OnceLock::new();
    SHELL.get_or_init(resolve_shell)
}

/// Whether a `pwsh` at `path` can start inside the AppContainer: only under a
/// Program Files folder (`program_files`), which every container may read.
/// A per-user install (scoop, a zip under the profile, dotnet tool) has no
/// such grant and fails at startup with "Failed to resolve full path of the
/// current executable"; a Store alias is a reparse point that cannot start
/// either. Both would leave 5.1, which always works, unused.
#[cfg(any(windows, test))]
fn container_can_run(path: &Path, program_files: &[PathBuf]) -> bool {
    let p = path.to_string_lossy().replace('/', "\\").to_ascii_lowercase();
    !is_app_execution_alias(path)
        && program_files.iter().any(|root| {
            let root = root.to_string_lossy().replace('/', "\\").to_ascii_lowercase();
            let root = root.trim_end_matches('\\');
            !root.is_empty() && p.starts_with(&format!("{root}\\"))
        })
}

/// True for a Store app-execution alias under `%LOCALAPPDATA%\Microsoft\
/// WindowsApps`, such as the Store PowerShell 7's `pwsh.exe`.
/// An alias is a reparse point that cannot start inside the AppContainer, so
/// choosing one leaves the sandboxed shell failing every command while a
/// working shell later in the order goes unused. String-based so it is
/// testable on any host.
#[cfg(any(windows, test))]
fn is_app_execution_alias(path: &Path) -> bool {
    let p = path.to_string_lossy().replace('/', "\\").to_ascii_lowercase();
    p.contains("\\microsoft\\windowsapps\\")
}

fn resolve_shell() -> ShellConfig {
    if let Some(path) = std::env::var_os("JAN_AGENT_SHELL") {
        let p = PathBuf::from(&path);
        if p.exists() {
            return config_for(p);
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
            return config_for(p);
        }
        if Path::new("/bin/bash").exists() {
            return config_for(PathBuf::from("/bin/bash"));
        }
        config_for(PathBuf::from("/bin/sh"))
    }
    #[cfg(windows)]
    {
        // PowerShell, never a bash: the sandbox is an AppContainer, where the
        // MSYS runtime behind Git Bash cannot create its objects under
        // `\BaseNamedObjects` and dies at startup (#9101). 7 (`pwsh`) when
        // installed under Program Files, else the inbox 5.1 by absolute path so
        // a PATH entry cannot shadow it.
        let program_files: Vec<PathBuf> = ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"]
            .iter()
            .filter_map(std::env::var_os)
            .map(PathBuf::from)
            .collect();
        if let Some(p) = which_all("pwsh")
            .into_iter()
            .find(|p| container_can_run(p, &program_files))
        {
            return config_for(p);
        }
        let system = std::env::var_os("SystemRoot")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
            .join("System32");
        let powershell = system
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe");
        if powershell.exists() {
            return config_for(powershell);
        }
        config_for(system.join("cmd.exe"))
    }
}

/// Locate an executable on PATH via the platform's own resolver. Also used by
/// [`super::jail`] to find `bwrap` on distros with no FHS paths (NixOS keeps it
/// only at a Nix-store path).
/// Unix only outside tests: Windows resolution needs every match (see
/// [`which_all`]) to step past the app-execution aliases.
#[cfg(any(unix, test))]
pub(crate) fn which(name: &str) -> Option<PathBuf> {
    which_all(name).into_iter().next()
}

/// Every match for `name` on PATH, in PATH order.
fn which_all(name: &str) -> Vec<PathBuf> {
    #[cfg(unix)]
    let finder = "which";
    #[cfg(windows)]
    let finder = "where";
    let Ok(out) = std::process::Command::new(finder).arg(name).output() else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(PathBuf::from)
        .collect()
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
    // PowerShell keeps its module-analysis cache under `LOCALAPPDATA`, and
    // npm, pip and most Windows toolchains resolve per-user state through these.
    // Locations, not secrets; also unset on unix.
    "SystemDrive",
    "LOCALAPPDATA",
    "APPDATA",
];

/// Every spelling of "where temporary files go": POSIX tools read `TMPDIR`,
/// Windows ones `TEMP`/`TMP`, and a mixed toolchain (git-bash, MSYS) reads both.
/// All are pointed at the scratch together so no tool falls back to the host.
const TEMP_ENV_KEYS: &[&str] = &["TMPDIR", "TMP", "TEMP"];

/// Soft limits the sandboxed child runs under, each capped by the host's hard
/// limit. `NOFILE` and `FSIZE` are deliberately generous: toolchains (linkers,
/// node, cargo) routinely want tens of thousands of descriptors, and a debug
/// `cargo test` binary or incremental artifact can pass a gigabyte on its own.
/// Caps that low break ordinary work long before they stop abuse. `FSIZE` is a
/// per-file cap enforced with `SIGXFSZ`, so exceeding it kills the writer rather
/// than returning an error most tools report clearly. Linux `NPROC` is omitted
/// because the kernel counts it across the entire real UID, so unrelated host
/// processes can exhaust a limit mounted on one Jan shell. Per-run process-tree
/// isolation requires a cgroup `pids.max`; until then the child inherits the
/// launcher's process limit.
#[cfg(unix)]
const CHILD_LIMITS: &[(RlimitResource, u64)] = &[
    (nix::libc::RLIMIT_NOFILE, 65536),
    (nix::libc::RLIMIT_FSIZE, 16 * 1024 * 1024 * 1024),
];

/// libc types the `RLIMIT_*` ids per platform: `__rlimit_resource_t` (`u32`) on
/// linux-gnu, plain `c_int` everywhere else Unix (macOS, musl). Naming the type
/// once keeps [`CHILD_LIMITS`] and the `getrlimit`/`setrlimit` calls cast-free.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
type RlimitResource = nix::libc::__rlimit_resource_t;
#[cfg(all(unix, not(all(target_os = "linux", target_env = "gnu"))))]
type RlimitResource = nix::libc::c_int;

/// Bound the resource exhaustion a sandboxed command could otherwise trigger on
/// the host. `bwrap` 0.6.1 (and older) has no `--rlimit`, so instead we clamp the
/// child's soft limits here, before exec, from the one choke point every backend
/// funnels through. Descriptor exhaustion and disk fill are capped by `NOFILE`
/// and `FSIZE`. The hard limit is left at the host's value so a command that
/// genuinely needs more can raise its own soft limit back up. The bwrap wrapper
/// execs `bwrap` itself, which sets up the namespace and then execs the real
/// shell, so the limits carry over to every descendant. Unix only; the Windows
/// AppContainer child is limited by its token.
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
///
/// `HEADERS` covers `OTEL_EXPORTER_OTLP_*HEADERS` and `JAN_CUSTOM_HEADERS`,
/// which carry an API key when a launcher sets them, so `OTEL_*` cannot copy
/// one. `AUTHORIZATION`, not a bare `AUTH`, which would also match
/// `GIT_AUTHOR_NAME`.
fn is_secret_name(name: &str) -> bool {
    const MARKERS: &[&str] = &[
        "KEY",
        "SECRET",
        "TOKEN",
        "PASSWORD",
        "PASSWD",
        "CREDENTIAL",
        "HEADERS",
        "AUTHORIZATION",
    ];
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
    spawn_with_stdin(cfg, command, cwd, scratch, env, thread, None).await
}

/// `path` without the `\\?\` verbatim prefix `canonicalize` adds on Windows:
/// `\\?\C:\x` becomes `C:\x` and `\\?\UNC\srv\share` becomes
/// `\\srv\share`. cmd refuses a verbatim working directory and silently runs
/// in `C:\Windows` instead, and tools print the prefix back at the model. Any
/// other path, including other verbatim forms, is returned unchanged.
pub fn without_verbatim_prefix(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        let b = rest.as_bytes();
        if b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && b[2] == b'\\' {
            return PathBuf::from(rest);
        }
    }
    path.to_path_buf()
}

/// Append `command` to `cmd` in the form `cfg`'s shell reads it. When `cfg` is a
/// sandbox wrapper rather than the shell itself, the command travels as a plain
/// argument and the AppContainer helper re-applies the cmd rule when it builds
/// the shell's own command line (see `appcontainer::command_line`).
fn append_command(cmd: &mut Command, cfg: &ShellConfig, command: &str) {
    match cfg.kind {
        ShellKind::Posix => {
            cmd.arg(command);
        }
        ShellKind::PowerShell => {
            cmd.arg(powershell_script(command));
        }
        ShellKind::Cmd => {
            #[cfg(windows)]
            if kind_of(&cfg.program) == ShellKind::Cmd {
                cmd.raw_arg(cmd_payload(command));
                return;
            }
            cmd.arg(command);
        }
    }
}

/// [`spawn`] plus a string fed to the child on stdin and then closed. Used by
/// the hook and plugin-tool runners, whose contract is "JSON in on stdin, JSON
/// out on stdout".
///
/// The write itself happens on a detached task, so this function returns as
/// soon as the child is spawned and the caller's timeout covers the whole
/// exchange. See the comment at the write site.
pub async fn spawn_with_stdin(
    cfg: &ShellConfig,
    command: &str,
    cwd: &Path,
    scratch: Option<&Path>,
    env: ShellEnv<'_>,
    thread: Option<&str>,
    stdin_payload: Option<&str>,
) -> std::io::Result<Child> {
    let mut cmd = Command::new(&cfg.program);
    cmd.args(&cfg.args);
    append_command(&mut cmd, cfg, command);
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
    // Plugin-declared credentials come last so they always win over an
    // allowlist key of the same name (reserved names never get this far --
    // see `is_reserved_env_key`). `cwd` is the tool context's project root, not
    // a shell-selected subdirectory, so the borrow is scoped to the project that
    // registered the keys rather than every project in the process.
    {
        let root = std::fs::canonicalize(cwd).unwrap_or_else(|_| cwd.to_path_buf());
        let projects = PLUGIN_ENV.read().unwrap();
        if let Some(vars) = projects.get(&root) {
            cmd.envs(vars);
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
    cmd.current_dir(without_verbatim_prefix(cwd))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(if stdin_payload.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .kill_on_drop(true);
    set_process_group(&mut cmd);
    #[cfg(unix)]
    confine_limits(&mut cmd);

    let mut child = cmd.spawn()?;

    if let Some(payload) = stdin_payload {
        if let Some(mut stdin) = child.stdin.take() {
            // Written from a detached task, never awaited here: a payload
            // larger than the pipe buffer blocks until the child reads it, and
            // a child that never reads its stdin would wedge the caller *before*
            // it could arm its timeout. A PostToolUse hook carries a whole tool
            // result, so this is the common size, not a corner case. Detached,
            // the write simply fails when the child is killed or exits.
            let payload = payload.to_string();
            tokio::spawn(async move {
                use tokio::io::AsyncWriteExt;
                if stdin.write_all(payload.as_bytes()).await.is_err() {
                    return;
                }
                let _ = stdin.write_all(b"\n").await;
                let _ = stdin.shutdown().await;
            });
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
        for key in [
            "SystemRoot", "windir", "ComSpec", "PATHEXT", "ProgramFiles", "ProgramData",
            "SystemDrive", "LOCALAPPDATA", "APPDATA",
        ] {
            assert!(
                SANDBOX_ENV_ALLOW.contains(&key),
                "missing {key} in SANDBOX_ENV_ALLOW"
            );
        }
    }
}

#[cfg(test)]
mod shell_kind_tests {
    use super::*;

    #[test]
    fn kind_of_reads_the_file_name_on_any_separator_and_case() {
        for (path, kind) in [
            ("/bin/bash", ShellKind::Posix),
            ("/bin/sh", ShellKind::Posix),
            (r"C:\Program Files\Git\bin\bash.exe", ShellKind::Posix),
            (r"C:\Program Files\PowerShell\7\pwsh.exe", ShellKind::PowerShell),
            ("/usr/bin/pwsh", ShellKind::PowerShell),
            (
                r"C:\Windows\System32\WindowsPowerShell\v1.0\PowerShell.EXE",
                ShellKind::PowerShell,
            ),
            (r"C:\Windows\System32\cmd.exe", ShellKind::Cmd),
            ("CMD.EXE", ShellKind::Cmd),
        ] {
            assert_eq!(kind_of(Path::new(path)), kind, "{path}");
        }
    }

    #[test]
    fn each_kind_gets_the_arguments_its_shell_reads() {
        assert_eq!(config_for(PathBuf::from("/bin/bash")).args, vec!["-c"]);
        let ps = config_for(PathBuf::from("pwsh.exe"));
        assert_eq!(ps.kind, ShellKind::PowerShell);
        assert_eq!(ps.args.last().map(String::as_str), Some("-Command"));
        assert!(ps.args.iter().any(|a| a == "-NoProfile"));
        assert!(ps.args.iter().any(|a| a == "-NonInteractive"));
        assert_eq!(config_for(PathBuf::from("cmd.exe")).args, vec!["/D", "/S", "/C"]);
    }

    /// Only a pwsh under Program Files can start in the AppContainer: a Store
    /// alias or a per-user install is skipped, so 5.1 is used instead.
    #[test]
    fn only_a_program_files_pwsh_is_chosen() {
        let pf = [PathBuf::from(r"C:\Program Files"), PathBuf::from(r"C:\Program Files (x86)\")];
        assert!(container_can_run(Path::new(r"C:\Program Files\PowerShell\7\pwsh.exe"), &pf));
        assert!(container_can_run(Path::new(r"c:\program files (x86)\PowerShell\7\pwsh.exe"), &pf));
        for skipped in [
            r"C:\Users\a\AppData\Local\Microsoft\WindowsApps\pwsh.exe",
            r"C:\Users\a\scoop\apps\pwsh\current\pwsh.exe",
            r"C:\Program Files Extra\pwsh.exe",
            r"D:\tools\pwsh.exe",
        ] {
            assert!(!container_can_run(Path::new(skipped), &pf), "{skipped}");
        }
        assert!(!container_can_run(Path::new(r"C:\Program Files\pwsh.exe"), &[]));
    }

    /// A Store PowerShell 7 is an app-execution alias, which cannot start in
    /// the AppContainer, so it is skipped; an installed pwsh is not.
    #[test]
    fn a_store_pwsh_alias_is_recognised_and_an_installed_pwsh_is_not() {
        assert!(is_app_execution_alias(Path::new(
            r"C:\Users\a\AppData\Local\Microsoft\WindowsApps\pwsh.exe"
        )));
        assert!(!is_app_execution_alias(Path::new(r"C:\Program Files\PowerShell\7\pwsh.exe")));
    }

    #[test]
    fn the_verbatim_prefix_is_stripped_only_from_drive_and_unc_paths() {
        assert_eq!(
            without_verbatim_prefix(Path::new(r"\\?\C:\Users\a\proj")),
            PathBuf::from(r"C:\Users\a\proj")
        );
        assert_eq!(
            without_verbatim_prefix(Path::new(r"\\?\UNC\server\share\proj")),
            PathBuf::from(r"\\server\share\proj")
        );
        for unchanged in [r"C:\Users\a", "/home/a/proj", r"\\?\Volume{abc}\x"] {
            assert_eq!(without_verbatim_prefix(Path::new(unchanged)), PathBuf::from(unchanged));
        }
    }

    /// cmd with `/S` strips exactly the outer pair, so the command's own quotes
    /// reach it untouched -- the `\"` an argv quoter would produce never does.
    #[test]
    fn the_cmd_payload_keeps_the_commands_own_quotes() {
        let payload = cmd_payload(r#""C:\Program Files\x.exe" "a b" && echo "done""#);
        assert_eq!(payload, r#"""C:\Program Files\x.exe" "a b" && echo "done"""#);
        assert!(!payload.contains(r#"\""#));
    }

    #[test]
    fn the_powershell_script_runs_the_command_and_reports_its_exit_code() {
        let script = powershell_script("git status");
        assert!(script.contains("\ngit status\n"));
        let (setup, rest) = script.split_once("git status").unwrap();
        assert!(setup.contains("$global:LASTEXITCODE = $null"), "reset before the command");
        assert!(
            setup.contains("Major -lt 6) { Import-Module Microsoft.PowerShell.Management,"),
            "5.1 imports the core modules it cannot autoload in the sandbox"
        );
        assert!(setup.contains("OutputEncoding"));
        assert!(setup.contains("Set-Location -LiteralPath $JanWs"), "real path first");
        assert!(setup.contains("Set-Location JanWs:\\"), "the drive only as the fallback");
        assert!(setup.contains("function jan_cmd {"), "runs inside the function");
        assert!(rest.contains("elseif ($LASTEXITCODE) { $LASTEXITCODE }"), "real code after it");
        assert!(rest.contains("$host.SetShouldExit($JanExit)"), "exit without dropping output");
    }

    /// The syntax note names the language for every non-POSIX shell and is
    /// absent for POSIX, which the model already assumes.
    #[test]
    fn only_non_posix_shells_carry_a_syntax_note() {
        assert!(ShellKind::Posix.syntax_note().is_none());
        assert!(ShellKind::PowerShell.syntax_note().unwrap().contains("PowerShell"));
        assert!(ShellKind::Cmd.syntax_note().unwrap().contains("cmd.exe"));
    }

    /// Run the PowerShell script through a real `pwsh` when one is installed
    /// (`JAN_TEST_PWSH`, else `pwsh` on PATH); skipped otherwise. Covers the
    /// pieces that only an actual PowerShell can prove: quoting survives, a
    /// native command's exit code comes back, and a failing cmdlet is not 0.
    #[tokio::test]
    async fn powershell_runs_commands_and_reports_exit_codes() {
        let Some(pwsh) = std::env::var_os("JAN_TEST_PWSH")
            .map(PathBuf::from)
            .or_else(|| which("pwsh"))
        else {
            eprintln!("skipped: no pwsh");
            return;
        };
        let cfg = config_for(pwsh);
        let run = |command: &'static str| {
            let cfg = cfg.clone();
            async move {
                let child = spawn(&cfg, command, &std::env::temp_dir(), None, ShellEnv::default(), None)
                    .await
                    .unwrap();
                let pid = child.id().unwrap();
                let out = child.wait_with_output().await.unwrap();
                unregister(None, pid);
                (
                    out.status.code(),
                    String::from_utf8_lossy(&out.stdout).trim().to_string(),
                    String::from_utf8_lossy(&out.stderr).to_string(),
                )
            }
        };
        // Non-ASCII written as escapes to keep the source ASCII; UTF-8 output is
        // what the script's encoding switch is for.
        let (code, stdout, _) = run("Write-Output \"say \"\"hi\"\" & 'bye' \u{fc}n\u{ef}\"").await;
        assert_eq!(code, Some(0));
        assert_eq!(stdout, "say \"hi\" & 'bye' \u{fc}n\u{ef}");

        let (code, _, _) = run("Get-Item ./definitely-not-here-jan").await;
        assert_eq!(code, Some(1), "a failing cmdlet must not report success");

        // A cmdlet failing after a native command that succeeded: the native
        // code (0) must not mask the failure.
        let (code, _, _) = run(
            "& (Get-Process -Id $PID).Path -NoProfile -Command 'exit 0'; \
             Get-Item ./definitely-not-here-jan",
        )
        .await;
        assert_eq!(code, Some(1), "a later cmdlet failure must not report 0");

        // The last statement succeeding is success, as in a POSIX shell.
        let (code, _, _) = run("Get-Item ./definitely-not-here-jan; Write-Output ok").await;
        assert_eq!(code, Some(0));

        // The running PowerShell itself as the native command, so the test does
        // not depend on what else is installed.
        let (code, _, stderr) =
            run("& (Get-Process -Id $PID).Path -NoProfile -Command 'exit 7'").await;
        assert_eq!(code, Some(7), "a native command's own code comes back");
        assert!(!stderr.contains("CLIXML"), "errors stay plain text: {stderr}");

        // Formatted output is flushed before the process exits.
        let (code, stdout, _) = run("Get-Location; Write-Output after").await;
        assert_eq!(code, Some(0));
        assert!(stdout.contains("after") && stdout.contains("Path"), "{stdout}");

        // An error names the command's own text, never the wrapper's.
        let (code, _, stderr) = run("Write-Error boom; exit 2").await;
        assert_eq!(code, Some(2));
        assert!(stderr.contains("boom"), "{stderr}");
        assert!(!stderr.contains("SetShouldExit"), "wrapper leaked: {stderr}");
        assert!(!stderr.contains("ProgressPreference"), "wrapper leaked: {stderr}");

        // A `return` leaves the function early and still reports success.
        let (code, _, _) = run("if ($true) { return }; Get-Item ./definitely-not-here-jan").await;
        assert_eq!(code, Some(0), "an early return is not a failure");

        // The location is a real path, not the fallback drive.
        let (_, stdout, _) = run("$PWD.Provider.Name; $PWD.Path").await;
        assert!(stdout.starts_with("FileSystem"), "{stdout}");
        assert!(!stdout.contains("JanWs:"), "{stdout}");

        // Relative paths resolve in the working directory it was started in.
        let (code, stdout, _) = run("(Convert-Path .).TrimEnd('/', '\\')").await;
        assert_eq!(code, Some(0));
        // Compared resolved: PowerShell reports the physical path, so on macOS
        // the `/var` temp dir comes back as `/private/var`.
        let tmp = std::env::temp_dir();
        assert_eq!(
            std::fs::canonicalize(&stdout).ok(),
            std::fs::canonicalize(&tmp).ok(),
            "starts in the working directory: {stdout}"
        );
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
    async fn confine_limits_caps_child_resource_limits() {
        // The rlimit mounting must reach the spawned child before its shell runs.
        let child = spawn(shell(), "exit 0", &tmp(), None, ShellEnv::default(), None).await.unwrap();
        let pid = child.id().unwrap();
        child.wait_with_output().await.unwrap();
        unregister(None, pid);

        // Spawn a shell that reports its own soft limits; confine_limits sets
        // each to the target, bounded by whatever hard limit the host allows.
        // `ulimit -f` reports FSIZE in 1024-byte blocks; `-n` is a raw count.
        for (name, flag, resource, target, unit) in [
            ("NOFILE", "-n", nix::libc::RLIMIT_NOFILE, 65536_u64, 1_u64),
            (
                "FSIZE",
                "-f",
                nix::libc::RLIMIT_FSIZE,
                16 * 1024 * 1024 * 1024,
                1024,
            ),
        ] {
            let cmd = format!("ulimit {flag}");
            let child = spawn(shell(), &cmd, &tmp(), None, ShellEnv::default(), None).await.unwrap();
            let pid = child.id().unwrap();
            let out = child.wait_with_output().await.unwrap();
            unregister(None, pid);
            let val = String::from_utf8_lossy(&out.stdout).trim().to_string();

            let mut host = nix::libc::rlimit {
                rlim_cur: 0,
                rlim_max: 0,
            };
            // # Safety: reads the calling process's own limit into a local.
            unsafe { nix::libc::getrlimit(resource, &mut host) };
            let want = if host.rlim_max == nix::libc::RLIM_INFINITY {
                target
            } else {
                target.min(host.rlim_max)
            };
            assert_eq!(
                val,
                (want / unit).to_string(),
                "{name} soft limit should be raised to the target, got: {val}"
            );
        }
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn confine_limits_preserves_the_launcher_process_limit() {
        // NPROC counts every process owned by the real UID. Jan must inherit the
        // launcher's value so unrelated workstation activity cannot starve one
        // agent-tool shell at an arbitrary Jan-specific threshold.
        let mut launcher = nix::libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        // # Safety: reads the test process's own limit into a local value.
        assert_eq!(
            unsafe { nix::libc::getrlimit(nix::libc::RLIMIT_NPROC, &mut launcher) },
            0
        );

        let child = spawn(
            shell(),
            "ulimit -u",
            &tmp(),
            None,
            ShellEnv::default(),
            None,
        )
        .await
        .unwrap();
        let pid = child.id().unwrap();
        let out = child.wait_with_output().await.unwrap();
        unregister(None, pid);
        let actual = String::from_utf8_lossy(&out.stdout).trim().to_string();

        assert_eq!(
            actual,
            launcher.rlim_cur.to_string(),
            "NPROC soft limit should be inherited from the launcher, got: {actual}"
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
        for name in [
            "OPENAI_API_KEY",
            "MY_SECRET",
            "GH_TOKEN",
            "DB_PASSWORD",
            "aws_credential",
            "OTEL_EXPORTER_OTLP_HEADERS",
            "OTEL_EXPORTER_OTLP_LOGS_HEADERS",
            "JAN_CUSTOM_HEADERS",
            "HTTP_AUTHORIZATION",
        ] {
            assert!(is_secret_name(name), "{name} should read as secret");
        }
        for name in [
            "PATH",
            "HOME",
            "GIT_AUTHOR_NAME",
            "RUST_LOG",
            "OTEL_SERVICE_NAME",
            "OTEL_EXPORTER_OTLP_ENDPOINT",
        ] {
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
    fn an_otel_glob_never_copies_the_exporters_headers() {
        // A launcher puts its API key in the OTLP headers; `OTEL_*` is a
        // natural pass-through to write, and must not carry it into a shell.
        let pats = vec!["OTEL_*".to_string(), "JAN_*".to_string()];
        let env = ShellEnv { passthrough: &pats, set: &[] };
        let out = resolve_env_overrides(
            host(&[
                ("OTEL_SERVICE_NAME", "jan-agent"),
                ("OTEL_EXPORTER_OTLP_HEADERS", "x-api-key=sk"),
                ("OTEL_EXPORTER_OTLP_METRICS_HEADERS", "x-api-key=sk"),
                ("JAN_CUSTOM_HEADERS", "Authorization: Bearer sk"),
            ]),
            env,
        );
        assert_eq!(out, vec![("OTEL_SERVICE_NAME".to_string(), "jan-agent".to_string())]);
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
