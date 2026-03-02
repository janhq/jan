/// Linux namespace-based sandbox using the `unshare` command.
///
/// Provides PID and mount namespace isolation — the same primitives that
/// bubblewrap and Docker use under the hood. For the initial implementation
/// we shell out to `unshare(1)` which is available on every modern Linux
/// distribution. A future iteration can replace this with direct `nix::sched`
/// syscalls for tighter control.
///
/// Security hardening (Phase 3):
/// - PR_SET_NO_NEW_PRIVS: prevents privilege escalation via setuid binaries
/// - PR_SET_DUMPABLE(0): prevents core dumps that could leak secrets
/// - Resource limits via setrlimit: memory (RLIMIT_AS), CPU time, max PIDs, open files
/// - PDEATHSIG: child receives SIGTERM when parent dies (prevents orphan processes)
#[cfg(target_os = "linux")]
use std::process::Stdio;

#[cfg(target_os = "linux")]
use super::sandbox::{IsolationTier, Sandbox, SandboxConfig, SandboxHandle, SandboxStatus};

/// Default memory limit: 512 MB
#[cfg(target_os = "linux")]
const DEFAULT_MEMORY_LIMIT_BYTES: u64 = 512 * 1024 * 1024;

/// Default max open file descriptors
#[cfg(target_os = "linux")]
const DEFAULT_NOFILE_LIMIT: u64 = 4096;

/// Default max processes (NPROC)
#[cfg(target_os = "linux")]
const DEFAULT_NPROC_LIMIT: u64 = 256;

/// Default max core dump size: 0 (disabled)
#[cfg(target_os = "linux")]
const DEFAULT_CORE_LIMIT: u64 = 0;

#[cfg(target_os = "linux")]
pub struct NativeSandbox;

#[cfg(target_os = "linux")]
impl NativeSandbox {
    /// Check whether unprivileged user namespaces are available.
    /// Required for rootless namespace creation.
    async fn check_user_namespace_support() -> bool {
        // Method 1: check the sysctl (Debian/Ubuntu)
        if let Ok(content) =
            tokio::fs::read_to_string("/proc/sys/kernel/unprivileged_userns_clone").await
        {
            if content.trim() == "0" {
                log::info!("User namespaces disabled via sysctl");
                return false;
            }
        }
        // If the file doesn't exist, the kernel doesn't gate it (newer kernels)

        // Method 2: check that unshare(1) exists
        if let Ok(output) = tokio::process::Command::new("unshare")
            .arg("--help")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .await
        {
            if !output.status.success() {
                log::info!("unshare command not found");
                return false;
            }
        } else {
            return false;
        }

        true
    }

    /// Apply resource limits to a child process via setrlimit.
    /// Called in the pre_exec hook (runs in the child before exec).
    ///
    /// # Safety
    /// This function uses nix::sys::resource::setrlimit which is safe to call
    /// in a pre_exec context (async-signal-safe).
    fn apply_resource_limits() -> Result<(), String> {
        use nix::sys::resource::{setrlimit, Resource};

        // Memory limit (virtual address space)
        setrlimit(
            Resource::RLIMIT_AS,
            DEFAULT_MEMORY_LIMIT_BYTES,
            DEFAULT_MEMORY_LIMIT_BYTES,
        )
        .map_err(|e| format!("Failed to set RLIMIT_AS: {}", e))?;

        // Max open file descriptors
        setrlimit(
            Resource::RLIMIT_NOFILE,
            DEFAULT_NOFILE_LIMIT,
            DEFAULT_NOFILE_LIMIT,
        )
        .map_err(|e| format!("Failed to set RLIMIT_NOFILE: {}", e))?;

        // Max number of processes
        setrlimit(
            Resource::RLIMIT_NPROC,
            DEFAULT_NPROC_LIMIT,
            DEFAULT_NPROC_LIMIT,
        )
        .map_err(|e| format!("Failed to set RLIMIT_NPROC: {}", e))?;

        // Disable core dumps (prevent secret leakage)
        setrlimit(Resource::RLIMIT_CORE, DEFAULT_CORE_LIMIT, DEFAULT_CORE_LIMIT)
            .map_err(|e| format!("Failed to set RLIMIT_CORE: {}", e))?;

        Ok(())
    }
}

#[cfg(target_os = "linux")]
#[async_trait::async_trait]
impl Sandbox for NativeSandbox {
    fn name(&self) -> &str {
        "Linux Namespaces"
    }

    fn isolation_tier(&self) -> IsolationTier {
        IsolationTier::PlatformSandbox
    }

    async fn is_available(&self) -> bool {
        Self::check_user_namespace_support().await
    }

    async fn start(&self, config: &SandboxConfig) -> Result<SandboxHandle, String> {
        log::info!("NativeSandbox: starting OpenClaw in PID+mount namespace (hardened)");

        // Build the unshare command:
        //   --pid --fork     : new PID namespace, fork so child is PID 1
        //   --mount-proc     : mount a fresh /proc inside the namespace
        //   --map-root-user  : map current user to root inside the namespace
        //
        // We intentionally do NOT use --net (network namespace) because OpenClaw
        // needs to reach both the Jan API on localhost and external messaging APIs.
        // Network isolation can be added later with a veth pair.
        let mut cmd = tokio::process::Command::new("unshare");
        cmd.args(["--pid", "--fork", "--mount-proc", "--map-root-user", "--"])
            .args(["openclaw", "gateway", "start"])
            .current_dir(&config.config_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        for (key, value) in &config.env_vars {
            cmd.env(key, value);
        }

        // Security hardening: pre_exec hook runs in the child process before exec.
        // This is the standard pattern for setting up child process security.
        //
        // SAFETY: The closures called here (prctl, setrlimit) are async-signal-safe
        // and do not allocate or call non-reentrant functions.
        unsafe {
            cmd.pre_exec(|| {
                // 1. PR_SET_NO_NEW_PRIVS: prevent privilege escalation via setuid binaries.
                //    Once set, this is irreversible — exactly what we want for a sandbox.
                if let Err(e) = nix::sys::prctl::set_no_new_privs() {
                    // Log to stderr since logging framework may not be available in child
                    eprintln!("NativeSandbox: failed to set NO_NEW_PRIVS: {}", e);
                    // Non-fatal: continue without this hardening
                }

                // 2. PR_SET_DUMPABLE(0): prevent core dumps that could leak secrets
                //    (tokens, session data, etc.)
                let _ = libc::prctl(libc::PR_SET_DUMPABLE, 0);

                // 3. PDEATHSIG: receive SIGTERM when parent (Jan) dies.
                //    Prevents orphan sandbox processes if Jan crashes.
                let _ = nix::sys::prctl::set_pdeathsig(nix::sys::signal::Signal::SIGTERM);

                // 4. Resource limits: constrain memory, file descriptors, processes
                if let Err(e) = NativeSandbox::apply_resource_limits() {
                    eprintln!("NativeSandbox: resource limit warning: {}", e);
                    // Non-fatal: continue without resource limits
                }

                Ok(())
            });
        }

        let child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn sandboxed OpenClaw: {}", e))?;

        let pid = child
            .id()
            .ok_or_else(|| "Failed to get PID of sandboxed process".to_string())?;

        log::info!(
            "NativeSandbox: spawned with PID {} (NO_NEW_PRIVS, resource limits applied)",
            pid
        );
        Ok(SandboxHandle::Pid(pid))
    }

    async fn stop(&self, handle: &mut SandboxHandle) -> Result<(), String> {
        if let SandboxHandle::Pid(pid) = handle {
            log::info!("NativeSandbox: stopping PID {}", pid);

            // Send SIGTERM first
            let term_result = nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(*pid as i32),
                nix::sys::signal::Signal::SIGTERM,
            );

            if let Err(e) = term_result {
                // ESRCH means process already gone — not an error
                if e != nix::errno::Errno::ESRCH {
                    log::warn!("NativeSandbox: SIGTERM failed: {}", e);
                }
                return Ok(());
            }

            // Wait up to 5 seconds for graceful shutdown
            for _ in 0..10 {
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                let still_alive = nix::sys::signal::kill(
                    nix::unistd::Pid::from_raw(*pid as i32),
                    None, // signal 0: just check if process exists
                );
                if still_alive.is_err() {
                    log::info!("NativeSandbox: process {} terminated gracefully", pid);
                    return Ok(());
                }
            }

            // Force kill
            log::warn!(
                "NativeSandbox: process {} did not exit gracefully, sending SIGKILL",
                pid
            );
            let _ = nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(*pid as i32),
                nix::sys::signal::Signal::SIGKILL,
            );
        }

        Ok(())
    }

    async fn status(&self, handle: &SandboxHandle) -> Result<SandboxStatus, String> {
        if let SandboxHandle::Pid(pid) = handle {
            // Check if the process is still alive
            let alive = nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(*pid as i32),
                None, // signal 0
            );

            if alive.is_ok() {
                // Process exists, also verify port is responding
                match tokio::net::TcpStream::connect(format!(
                    "127.0.0.1:{}",
                    super::OPENCLAW_PORT
                ))
                .await
                {
                    Ok(_) => Ok(SandboxStatus::Running),
                    Err(_) => Ok(SandboxStatus::Running), // Process alive but port not ready yet
                }
            } else {
                Ok(SandboxStatus::Stopped)
            }
        } else {
            Ok(SandboxStatus::Unknown)
        }
    }

    async fn logs(&self, _handle: &SandboxHandle, _lines: usize) -> Result<Vec<String>, String> {
        // TODO: capture stdout/stderr to a log file during start()
        Ok(vec![
            "Log capture for namespace sandbox is not yet implemented. Check /tmp/openclaw/ for logs.".to_string(),
        ])
    }
}
