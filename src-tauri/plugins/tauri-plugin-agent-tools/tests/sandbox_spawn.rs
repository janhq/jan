//! Starts real shells inside the Windows AppContainer sandbox (#9101).
//!
//! The unit tests around the sandbox check argv quoting and the environment
//! block's layout, and all of them passed while every sandboxed spawn on a real
//! machine failed with os error 203. Only a real `CreateProcessW` into a real
//! container catches that, so this test does one, with the same filtered
//! environment and helper re-exec the shell tool uses.
//!
//! `harness = false` because the backend re-execs the running binary as its
//! helper: under libtest that re-exec would run the test suite again instead of
//! the spawn, so `main` hands control to the helper before anything else.

fn main() {
    tauri_plugin_agent_tools::run_sandbox_helper_if_requested();
    #[cfg(windows)]
    windows::run();
    #[cfg(not(windows))]
    eprintln!("sandbox_spawn: AppContainer only, nothing to run on this platform");
}

#[cfg(windows)]
mod windows {
    use std::path::{Path, PathBuf};
    use tauri_plugin_agent_tools::tools::jail::{self, Backend, Policy};
    use tauri_plugin_agent_tools::tools::proc::{self, ShellConfig, ShellEnv, ShellKind};

    pub fn run() {
        assert_eq!(
            jail::backend(),
            Backend::AppContainer,
            "the sandbox must be available on a Windows runner"
        );
        // Deliberately the raw `TEMP` path: on a runner it is the 8.3
        // `RUNNER~1` form, as it is for any user with a long name, and the
        // helper must still give the shell a working directory it can use.
        let ws = std::env::temp_dir().join(format!("jan_sandbox_spawn_{}", std::process::id()));
        std::fs::create_dir_all(&ws).expect("create workspace");
        let rt = tokio::runtime::Runtime::new().expect("runtime");

        let system = PathBuf::from(std::env::var_os("SystemRoot").expect("SystemRoot"))
            .join("System32");
        let shells = [
            ("resolved", proc::shell().clone()),
            (
                "powershell 5.1",
                ShellConfig {
                    program: system.join(r"WindowsPowerShell\v1.0\powershell.exe"),
                    args: proc::shell_args(ShellKind::PowerShell),
                    kind: ShellKind::PowerShell,
                },
            ),
            (
                "cmd",
                ShellConfig {
                    program: system.join("cmd.exe"),
                    args: proc::shell_args(ShellKind::Cmd),
                    kind: ShellKind::Cmd,
                },
            ),
        ];
        assert_ne!(
            proc::shell().kind,
            ShellKind::Posix,
            "Windows must resolve a native shell, not bash: {}",
            proc::shell().program.display()
        );
        for (label, shell) in &shells {
            let (ok, out) = rt.block_on(spawn(shell, &ws, "echo ok"));
            assert!(ok, "{label}: a command must start and succeed in the sandbox: {out}");
            assert!(out.contains("ok"), "{label}: output lost: {out}");
            let (ok, out) = rt.block_on(spawn(shell, &ws, "exit 3"));
            assert!(!ok, "{label}: a failing command must report failure: {out}");
            eprintln!("sandbox_spawn: {label} ({}) ok", shell.program.display());
        }
        // Windows PowerShell 5.1 cannot autoload modules in the container, so
        // cmdlets from each imported inbox module must still resolve.
        let (ok, out) = rt.block_on(spawn(
            &shells[1].1,
            &ws,
            "Get-ChildItem | Out-Null; 'x' | ConvertTo-Json; echo ok",
        ));
        assert!(ok && out.contains("ok"), "powershell 5.1 core cmdlets: {out}");
        // cmd keeps a command's own quotes rather than seeing them escaped.
        let (ok, out) = rt.block_on(spawn(&shells[2].1, &ws, r#"echo "a b""#));
        assert!(ok && out.contains(r#""a b""#), "cmd quoting: {out}");

        let _ = std::fs::remove_dir_all(&ws);
    }

    /// Spawn `command` through the sandbox exactly as the shell tool does:
    /// `jail::wrap` turns the shell into the helper re-exec, and `proc::spawn`
    /// clears the environment down to the allowlist before starting it.
    async fn spawn(shell: &ShellConfig, ws: &Path, command: &str) -> (bool, String) {
        let policy = Policy::new(ws, false);
        let wrapped = jail::wrap(shell, &policy).expect("AppContainer wrapper");
        let child = proc::spawn(&wrapped, command, ws, None, ShellEnv::default(), None)
            .await
            .expect("spawn the helper");
        let pid = child.id();
        let out = child.wait_with_output().await.expect("wait");
        if let Some(pid) = pid {
            proc::unregister(None, pid);
        }
        let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
        text.push_str(&String::from_utf8_lossy(&out.stderr));
        (out.status.success(), text)
    }
}
