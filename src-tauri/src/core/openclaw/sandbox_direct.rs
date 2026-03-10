use std::process::Stdio;

use super::sandbox::{IsolationTier, Sandbox, SandboxConfig, SandboxHandle, SandboxStatus};

pub struct DirectProcessSandbox;

/// Patch OpenClaw LaunchAgent plists to include `AssociatedBundleIdentifiers`.
///
/// macOS 13+ uses this key to associate background login items with their parent
/// app, which makes the "Background Items Added" notification display the app
/// icon instead of a generic placeholder.  Without this key macOS falls back to
/// showing the organisation name from the signing certificate.
///
/// Reference: <https://developer.apple.com/documentation/servicemanagement/updating-helper-executables-from-earlier-versions-of-macos>
#[cfg(target_os = "macos")]
pub fn patch_launchagent_associated_bundle_id(bundle_id: &str) {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => {
            log::warn!("patch_launchagent: could not resolve home directory");
            return;
        }
    };
    let launch_agents = home.join("Library/LaunchAgents");
    let entries = match std::fs::read_dir(&launch_agents) {
        Ok(e) => e,
        Err(e) => {
            log::warn!("patch_launchagent: cannot read LaunchAgents dir: {}", e);
            return;
        }
    };

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.contains("openclaw") || !name.ends_with(".plist") {
            continue;
        }

        let path = entry.path();
        let path_str = path.to_string_lossy().to_string();

        // Remove existing key first (ignore errors — key may not exist yet)
        let _ = std::process::Command::new("/usr/libexec/PlistBuddy")
            .args(["-c", "Delete :AssociatedBundleIdentifiers", &path_str])
            .output();

        // Add the array key
        if let Err(e) = std::process::Command::new("/usr/libexec/PlistBuddy")
            .args(["-c", "Add :AssociatedBundleIdentifiers array", &path_str])
            .output()
        {
            log::warn!("patch_launchagent: failed to add array key to {}: {}", name, e);
            continue;
        }

        // Add the bundle identifier as the first entry
        match std::process::Command::new("/usr/libexec/PlistBuddy")
            .args([
                "-c",
                &format!("Add :AssociatedBundleIdentifiers:0 string {}", bundle_id),
                &path_str,
            ])
            .output()
        {
            Ok(output) if output.status.success() => {
                log::info!(
                    "patch_launchagent: patched {} with AssociatedBundleIdentifiers = [{}]",
                    name,
                    bundle_id
                );
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                log::warn!(
                    "patch_launchagent: PlistBuddy failed for {}: {}",
                    name,
                    stderr.trim()
                );
            }
            Err(e) => {
                log::warn!("patch_launchagent: failed to run PlistBuddy for {}: {}", name, e);
            }
        }
    }
}

/// Resolve the app's bundle identifier at runtime from the parent `.app` bundle's
/// `Info.plist`.  Falls back to `"jan.ai.app"` so the patch is always attempted.
#[cfg(target_os = "macos")]
pub fn resolve_bundle_identifier() -> String {
    // The running binary lives at  Jan.app/Contents/MacOS/<binary>.
    // Walk up to the .app bundle and read its Info.plist.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(macos_dir) = exe.parent() {
            let info_plist = macos_dir.parent().map(|p| p.join("Info.plist")); // Contents/Info.plist
            if let Some(ref plist_path) = info_plist {
                if plist_path.exists() {
                    if let Ok(output) = std::process::Command::new("/usr/libexec/PlistBuddy")
                        .args([
                            "-c",
                            "Print :CFBundleIdentifier",
                            &plist_path.to_string_lossy(),
                        ])
                        .output()
                    {
                        if output.status.success() {
                            let id = String::from_utf8_lossy(&output.stdout).trim().to_string();
                            if !id.is_empty() {
                                return id;
                            }
                        }
                    }
                }
            }
        }
    }
    "jan.ai.app".to_string()
}

/// Returns the BUN_INSTALL directory under Jan's data folder, creating it if needed.
fn get_bunx_dir() -> Option<std::path::PathBuf> {
    let dir = super::get_openclaw_base_dir().ok()?.join("bunx");
    if let Err(e) = std::fs::create_dir_all(&dir) {
        log::warn!("Failed to create BUN_INSTALL dir {:?}: {}", dir, e);
    }
    Some(dir)
}

/// Installs openclaw globally into the BUN_INSTALL dir using `bun add -g openclaw`.
/// After this, the binary lives at `$BUN_INSTALL/bin/openclaw[.exe]`.
async fn install_openclaw_globally() -> Result<(), String> {
    let bun_path = super::resolve_bundled_bun().ok_or("Bundled bun not found")?;
    let bunx_dir = get_bunx_dir().ok_or("Could not resolve home directory")?;

    log::info!("Installing openclaw globally into {:?}", bunx_dir);

    let mut cmd = tokio::process::Command::new(&bun_path);
    cmd.args(["add", "-g", &format!("openclaw@{}", super::constants::OPENCLAW_VERSION)])
        .env("BUN_INSTALL", &bunx_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(new_path) = super::build_augmented_path() {
        cmd.env("PATH", new_path);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let output = cmd.output().await.map_err(|e| format!("Failed to run bun add -g openclaw: {}", e))?;
    log::info!("bun add -g openclaw stdout: {}", String::from_utf8_lossy(&output.stdout).trim());
    log::info!("bun add -g openclaw stderr: {}", String::from_utf8_lossy(&output.stderr).trim());

    if !output.status.success() {
        return Err(format!(
            "bun add -g openclaw failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    Ok(())
}

/// Build a command that runs the globally-installed openclaw binary from BUN_INSTALL/bin/.
/// Falls back to `bun x openclaw` if the installed binary is not found.
fn build_openclaw_command(args: &[&str], config_dir: &std::path::Path) -> tokio::process::Command {
    let bunx_dir = get_bunx_dir();

    let installed_bin = bunx_dir.as_ref().map(|d| {
        if cfg!(target_os = "windows") {
            d.join("bin").join("openclaw.exe")
        } else {
            d.join("bin").join("openclaw")
        }
    });

    let mut cmd = if installed_bin.as_ref().map(|p| p.exists()).unwrap_or(false) {
        log::info!("Running openclaw from installed path: {:?}", installed_bin);
        tokio::process::Command::new(installed_bin.unwrap())
    } else if let Some(bun) = super::resolve_bundled_bun() {
        log::info!("openclaw not installed yet, falling back to bun x");
        let mut c = tokio::process::Command::new(bun);
        c.arg("x");
        c.arg("openclaw");
        c
    } else {
        tokio::process::Command::new("openclaw")
    };

    cmd.args(args)
        .current_dir(config_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(dir) = bunx_dir {
        cmd.env("BUN_INSTALL", dir);
    }

    if let Some(new_path) = super::build_augmented_path() {
        cmd.env("PATH", new_path);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    cmd
}

#[async_trait::async_trait]
impl Sandbox for DirectProcessSandbox {
    fn name(&self) -> &str {
        "Direct Process"
    }

    fn isolation_tier(&self) -> IsolationTier {
        IsolationTier::None
    }

    async fn is_available(&self) -> bool {
        true // Always available as fallback
    }

    async fn start(&self, config: &SandboxConfig) -> Result<SandboxHandle, String> {
        if let Err(e) = super::ensure_bun_node_shim() {
            log::warn!("Failed to ensure node shim: {}", e);
        }

        let use_child_process = if cfg!(target_os = "windows") {
            true
        } else {
            let install_args = if super::resolve_bundled_bun().is_some() {
                vec!["gateway", "install", "--runtime", "bun"]
            } else {
                vec!["gateway", "install"]
            };
            let mut install_cmd = build_openclaw_command(&install_args.iter().map(|s| *s).collect::<Vec<_>>(), &config.config_dir);
            match install_cmd.output().await {
                Ok(output) if output.status.success() => {
                    // Patch the LaunchAgent plist so macOS shows the Jan app
                    // icon in the "Background Items Added" notification
                    // instead of a generic icon with the certificate org name.
                    #[cfg(target_os = "macos")]
                    {
                        let bundle_id = resolve_bundle_identifier();
                        patch_launchagent_associated_bundle_id(&bundle_id);
                    }
                    false
                }
                Ok(output) => {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    log::error!("gateway install failed: {}", stderr.trim());
                    true
                }
                Err(e) => {
                    log::error!("Failed to run gateway install: {}", e);
                    true
                }
            }
        };

        if !use_child_process {
            if let Err(e) = install_openclaw_globally().await {
                log::warn!("openclaw global install failed, will attempt to run anyway: {}", e);
            }

            let mut cmd =
                build_openclaw_command(&["gateway", "run", "--force"], &config.config_dir);
            for (key, value) in &config.env_vars {
                cmd.env(key, value);
            }


            let mut child = cmd
                .spawn()
                .map_err(|e| format!("Failed to spawn openclaw gateway: {}", e))?;

            // Drain stdout and stderr in background so the pipes don't block
            if let Some(stdout) = child.stdout.take() {
                tokio::spawn(async move {
                    use tokio::io::{AsyncBufReadExt, BufReader};
                    let mut lines = BufReader::new(stdout).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        log::info!("openclaw stdout: {}", line);
                    }
                });
            }
            if let Some(stderr) = child.stderr.take() {
                tokio::spawn(async move {
                    use tokio::io::{AsyncBufReadExt, BufReader};
                    let mut lines = BufReader::new(stderr).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        log::info!("openclaw stderr: {}", line);
                    }
                });
            }

            // Log when the process exits
            let pid = child.id();
            tokio::spawn(async move {
                // We can't await the child here since we've already moved it into the handle,
                // so poll the port instead as a proxy for the process being alive.
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                    let alive = tokio::net::TcpStream::connect(
                        format!("127.0.0.1:{}", super::OPENCLAW_PORT)
                    ).await.is_ok();
                    if !alive {
                        log::warn!("openclaw gateway process (pid {:?}) appears to have exited", pid);
                        break;
                    }
                }
            });

            Ok(SandboxHandle::Process(child))
        } else {
            log::info!("Starting gateway as child process");
            let mut cmd = build_openclaw_command(&["gateway"], &config.config_dir);
            cmd.stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                // CREATE_NO_WINDOW only — DETACHED_PROCESS conflicts and can
                // cause Windows to allocate a visible console for the child.
                cmd.creation_flags(0x08000000);
            }
            for (key, value) in &config.env_vars {
                cmd.env(key, value);
            }

            let child = cmd
                .spawn()
                .map_err(|e| format!("Failed to spawn openclaw gateway: {}", e))?;

            Ok(SandboxHandle::Process(child))
        }
    }

    async fn stop(&self, handle: &mut SandboxHandle) -> Result<(), String> {
        if let SandboxHandle::Process(child) = handle {
            #[cfg(target_os = "windows")]
            {
                if let Some(pid) = child.id() {
                    use std::os::windows::process::CommandExt;
                    let mut cmd = tokio::process::Command::new("taskkill");
                    cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
                    cmd.creation_flags(0x08000000);
                    let _ = cmd.output().await;
                } else {
                    let _ = child.kill().await;
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                let _ = child.kill().await;
            }
            return Ok(());
        }

        let mut stopped_via_cli = false;
        let config_dir =
            super::get_openclaw_config_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
        let mut stop_cmd = build_openclaw_command(&["gateway", "stop"], &config_dir);
        if let Ok(output) = stop_cmd.output().await {
            stopped_via_cli = output.status.success();
        }

        if !stopped_via_cli {
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            {
                let _ = tokio::process::Command::new("pkill")
                    .args(["-f", "openclaw"])
                    .output()
                    .await;
            }

            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                let kill = |im: &'static str| async move {
                    let mut cmd = tokio::process::Command::new("taskkill");
                    cmd.args(["/F", "/T", "/IM", im]);
                    cmd.creation_flags(0x08000000);
                    let _ = cmd.output().await;
                };
                kill("bun.exe").await;
                kill("node.exe").await;
                kill("openclaw.exe").await;
            }
        }

        // Port-based kill fallback
        if tokio::net::TcpStream::connect(format!("127.0.0.1:{}", super::OPENCLAW_PORT))
            .await
            .is_ok()
        {
            log::warn!(
                "Port {} still in use after stop attempts, trying port-based kill",
                super::OPENCLAW_PORT
            );
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            {
                let _ = tokio::process::Command::new("sh")
                    .args([
                        "-c",
                        &format!("lsof -ti :{} | xargs kill -9", super::OPENCLAW_PORT),
                    ])
                    .output()
                    .await;
            }

            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                let mut cmd = tokio::process::Command::new("cmd");
                cmd.args(["/C", &format!("for /f \"tokens=5\" %%a in ('netstat -aon ^| findstr :{} ^| findstr LISTENING') do taskkill /F /T /PID %%a", super::OPENCLAW_PORT)]);
                cmd.creation_flags(0x08000000);
                let _ = cmd.output().await;
            }
        }

        Ok(())
    }

    async fn status(&self, _handle: &SandboxHandle) -> Result<SandboxStatus, String> {
        match tokio::net::TcpStream::connect(format!("127.0.0.1:{}", super::OPENCLAW_PORT)).await {
            Ok(_) => Ok(SandboxStatus::Running),
            Err(_) => Ok(SandboxStatus::Stopped),
        }
    }

    async fn logs(&self, _handle: &SandboxHandle, _lines: usize) -> Result<Vec<String>, String> {
        Ok(vec!["Check /tmp/openclaw/ for logs.".to_string()])
    }
}
