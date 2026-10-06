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
            if !ok && shell.kind == ShellKind::PowerShell {
                eprintln!("{label} diagnostics:\n{}", rt.block_on(spawn(shell, &ws, PS_PROBE)).1);
                // Explicit Import-Module works where autoload does not, so try
                // each candidate fix for autoload in the same run.
                let cache = ws.join("ps-analysis-cache");
                let cache = cache.to_string_lossy().into_owned();
                let modules = shell
                    .program
                    .parent()
                    .map(|p| p.join("Modules").to_string_lossy().into_owned())
                    .unwrap_or_default();
                let variants: [Variant; 4] = [
                    ("analysis cache in the workspace", vec![("PSModuleAnalysisCachePath".into(), cache)], "echo ok"),
                    ("analysis cache off", vec![("PSModuleAnalysisCachePath".into(), "NUL".into())], "echo ok"),
                    ("PSModulePath = PSHOME only", vec![("PSModulePath".into(), modules)], "echo ok"),
                    ("explicit import", vec![], "Import-Module Microsoft.PowerShell.Utility; echo ok"),
                ];
                for (name, set, command) in &variants {
                    let (ok, out) = rt.block_on(spawn_with(shell, &ws, command, set));
                    eprintln!("{label} variant [{name}]: ok={ok} out={}", out.trim());
                }
            }
            assert!(ok, "{label}: a command must start and succeed in the sandbox: {out}");
            assert!(out.contains("ok"), "{label}: output lost: {out}");
            let (ok, out) = rt.block_on(spawn(shell, &ws, "exit 3"));
            assert!(!ok, "{label}: a failing command must report failure: {out}");
            eprintln!("sandbox_spawn: {label} ({}) ok", shell.program.display());
        }
        // cmd keeps a command's own quotes rather than seeing them escaped.
        let (ok, out) = rt.block_on(spawn(&shells[2].1, &ws, r#"echo "a b""#));
        assert!(ok && out.contains(r#""a b""#), "cmd quoting: {out}");

        let _ = std::fs::remove_dir_all(&ws);
    }

    /// A diagnostic re-run: its label, extra environment, and command.
    type Variant<'a> = (&'a str, Vec<(String, String)>, &'a str);

    /// What PowerShell sees of its module search, using only the engine and
    /// .NET -- no cmdlet a broken module search would fail to find.
    const PS_PROBE: &str = r#"
"PSVersion=" + $PSVersionTable.PSVersion
"PSHOME=" + $PSHOME
"PSModulePath(env)=" + [Environment]::GetEnvironmentVariable('PSModulePath')
"LOCALAPPDATA=" + $env:LOCALAPPDATA
"Personal=" + [Environment]::GetFolderPath('Personal')
"LanguageMode=" + $ExecutionContext.SessionState.LanguageMode
"AutoLoad=" + $PSModuleAutoLoadingPreference
"CacheDir exists=" + [IO.Directory]::Exists("$env:LOCALAPPDATA\Microsoft\Windows\PowerShell")
try { Get-Command Write-Output -ErrorAction Stop | Out-Null; "Get-Command ok" } catch { "Get-Command failed: " + $_.Exception.GetType().FullName + ": " + $_.Exception.Message }
foreach ($p in ($env:PSModulePath -split ';')) { "  dir $p exists=" + [IO.Directory]::Exists($p) }
"Utility psd1 exists=" + [IO.File]::Exists("$PSHOME\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1")
try { Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop; "Import-Module ok" } catch { "Import-Module failed: " + $_.Exception.GetType().FullName + ": " + $_.Exception.Message }
"#;

    /// Spawn `command` through the sandbox exactly as the shell tool does:
    /// `jail::wrap` turns the shell into the helper re-exec, and `proc::spawn`
    /// clears the environment down to the allowlist before starting it.
    async fn spawn(shell: &ShellConfig, ws: &Path, command: &str) -> (bool, String) {
        spawn_with(shell, ws, command, &[]).await
    }

    /// [`spawn`] with extra variables set in the shell's environment.
    async fn spawn_with(
        shell: &ShellConfig,
        ws: &Path,
        command: &str,
        set: &[(String, String)],
    ) -> (bool, String) {
        let policy = Policy::new(ws, false);
        let wrapped = jail::wrap(shell, &policy).expect("AppContainer wrapper");
        let env = ShellEnv { passthrough: &[], set };
        let child = proc::spawn(&wrapped, command, ws, None, env, None)
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
