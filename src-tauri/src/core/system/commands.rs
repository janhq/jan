use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_llamacpp::cleanup_llama_processes;

use crate::core::app::commands::{
    default_data_folder_path, get_jan_data_folder_path, update_app_configuration,
};
use crate::core::app::constants::{JAN_DATA_FILES, JAN_DATA_SUBDIRS};
use crate::core::app::models::AppConfiguration;
use crate::core::mcp::helpers::{stop_mcp_servers_with_context, ShutdownContext};
use crate::core::state::AppState;

fn is_safe_to_delete(path: &std::path::Path) -> bool {
    let count = path.components().count();
    count >= 3
}

fn remove_dir_all_with_retry(path: &std::path::Path) {
    const MAX_ATTEMPTS: u32 = 5;
    const RETRY_DELAY_MS: u64 = 500;

    for attempt in 1..=MAX_ATTEMPTS {
        match fs::remove_dir_all(path) {
            Ok(()) => {
                if attempt > 1 {
                    log::info!("Removed {} on attempt {}", path.display(), attempt);
                }
                return;
            }
            Err(e) if attempt < MAX_ATTEMPTS => {
                log::warn!(
                    "Failed to remove {} (attempt {}/{}): {e}",
                    path.display(),
                    attempt,
                    MAX_ATTEMPTS
                );
                std::thread::sleep(std::time::Duration::from_millis(RETRY_DELAY_MS));
            }
            Err(e) => {
                log::error!(
                    "Failed to remove {} after {} attempts: {e}",
                    path.display(),
                    MAX_ATTEMPTS
                );
            }
        }
    }
}

fn remove_jan_data_contents(data_folder: &std::path::Path) {
    for subdir in JAN_DATA_SUBDIRS {
        let path = data_folder.join(subdir);
        if path.is_dir() {
            remove_dir_all_with_retry(&path);
        }
    }
    for file in JAN_DATA_FILES {
        let path = data_folder.join(file);
        if path.is_file() {
            if let Err(e) = fs::remove_file(&path) {
                log::warn!("Failed to remove {}: {e}", path.display());
            }
        }
    }
}

/// Detect the user's default shell and return the appropriate env file path.
/// Returns (shell_name, env_file_path).
fn detect_shell_env_file(home_dir: &str, is_macos: bool) -> (&'static str, String) {
    let shell = std::env::var("SHELL").unwrap_or_default();
    if shell.ends_with("/bash") {
        // macOS uses login shells in Terminal, so ~/.bash_profile is sourced.
        // Linux interactive shells source ~/.bashrc.
        let file = if is_macos {
            format!("{}/.bash_profile", home_dir)
        } else {
            format!("{}/.bashrc", home_dir)
        };
        ("bash", file)
    } else {
        // Default to zsh (macOS default since Catalina)
        ("zsh", format!("{}/.zshenv", home_dir))
    }
}

// Helper function to write env vars to a shell config file
fn write_env_to_shell(env_file_path: &str, env_vars: &[(String, String)]) -> Result<(), String> {
    let marker = "# Jan Local API Server - Claude Code Config";
    let new_entries: String = env_vars
        .iter()
        .map(|(k, v)| format!("export {}='{}'\n", k, v))
        .collect();

    let existing_content = std::fs::read_to_string(env_file_path).unwrap_or_default();
    let cleaned: Vec<&str> = existing_content
        .split('\n')
        .filter(|line| {
            // Remove Jan config markers and existing ANTHROPIC env vars to replace them
            !line.starts_with(marker)
                && !line.starts_with("# Jan Local API Server")
                && !line.starts_with("export ANTHROPIC_")
        })
        .collect();

    let new_content = format!("{}\n{}\n{}\n", marker, new_entries, marker);

    let final_content = cleaned.join("\n") + &new_content;
    std::fs::write(env_file_path, &final_content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn factory_reset<R: Runtime>(app_handle: tauri::AppHandle<R>, state: State<'_, AppState>) {
    // close window (not available on mobile platforms)
    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        let windows = app_handle.webview_windows();
        for (label, window) in windows.iter() {
            window.close().unwrap_or_else(|_| {
                log::warn!("Failed to close window: {label:?}");
            });
        }
    }
    let data_folder = get_jan_data_folder_path(app_handle.clone());
    log::info!("Factory reset, removing data folder: {data_folder:?}");

    tauri::async_runtime::block_on(async {
        let _ =
            stop_mcp_servers_with_context(&app_handle, &state, ShutdownContext::FactoryReset).await;

        {
            let mut active_servers = state.mcp_active_servers.lock().await;
            active_servers.clear();
        }

        use crate::core::mcp::lockfile::cleanup_own_locks;
        if let Err(e) = cleanup_own_locks(&app_handle) {
            log::warn!("Failed to cleanup lock files: {}", e);
        }
        let _ = cleanup_llama_processes(app_handle.clone()).await;

        // Windows needs time to release file handles after TerminateProcess
        #[cfg(windows)]
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;

        if data_folder.exists() {
            if !is_safe_to_delete(&data_folder) {
                log::error!(
                    "Refusing factory reset: path is too close to filesystem root: {}",
                    data_folder.display()
                );
                return;
            }

            // Preserve downloaded llamacpp backends across factory reset so the user
            // doesn't have to re-download CUDA/Vulkan binaries (can be hundreds of MB).
            let backends_dir = data_folder.join("llamacpp").join("backends");
            let temp_backends = std::env::temp_dir().join("atomic-chat-backends-preserve");
            let backends_preserved = if backends_dir.is_dir() {
                if temp_backends.exists() {
                    let _ = fs::remove_dir_all(&temp_backends);
                }
                match fs::rename(&backends_dir, &temp_backends) {
                    Ok(()) => {
                        log::info!("Preserved llamacpp backends to temp dir");
                        true
                    }
                    Err(e) => {
                        log::warn!("Failed to preserve llamacpp backends: {e}");
                        false
                    }
                }
            } else {
                false
            };

            remove_jan_data_contents(&data_folder);

            if backends_preserved {
                let llamacpp_dir = data_folder.join("llamacpp");
                let _ = fs::create_dir_all(&llamacpp_dir);
                match fs::rename(&temp_backends, &backends_dir) {
                    Ok(()) => log::info!("Restored llamacpp backends after factory reset"),
                    Err(e) => log::warn!("Failed to restore llamacpp backends: {e}"),
                }
            }
        }

        // Reset the configuration
        let mut default_config = AppConfiguration::default();
        default_config.data_folder = default_data_folder_path(app_handle.clone());
        let _ = update_app_configuration(app_handle.clone(), default_config);

        app_handle.restart();
    });
}

#[tauri::command]
pub fn relaunch<R: Runtime>(app: AppHandle<R>) {
    app.restart()
}

#[tauri::command]
pub fn open_app_directory<R: Runtime>(app: AppHandle<R>) {
    let app_path = app.path().app_data_dir().unwrap();
    if cfg!(target_os = "windows") {
        std::process::Command::new("explorer")
            .arg(app_path)
            .status()
            .expect("Failed to open app directory");
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open")
            .arg(app_path)
            .status()
            .expect("Failed to open app directory");
    } else {
        std::process::Command::new("xdg-open")
            .arg(app_path)
            .status()
            .expect("Failed to open app directory");
    }
}

#[tauri::command]
pub fn open_file_explorer(path: String) {
    let path = PathBuf::from(path);
    if cfg!(target_os = "windows") {
        std::process::Command::new("explorer")
            .arg(path)
            .status()
            .expect("Failed to open file explorer");
    } else if cfg!(target_os = "macos") {
        std::process::Command::new("open")
            .arg(path)
            .status()
            .expect("Failed to open file explorer");
    } else {
        std::process::Command::new("xdg-open")
            .arg(path)
            .status()
            .expect("Failed to open file explorer");
    }
}

#[tauri::command]
pub async fn read_logs<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let log_path = get_jan_data_folder_path(app).join("logs").join("app.log");
    if log_path.exists() {
        let content = fs::read_to_string(log_path).map_err(|e| e.to_string())?;
        Ok(content)
    } else {
        Err("Log file not found".to_string())
    }
}

// check if a system library is available
#[tauri::command]
pub fn is_library_available(library: &str) -> bool {
    match unsafe { libloading::Library::new(library) } {
        Ok(_) => true,
        Err(e) => {
            log::info!("Library {library} is not available: {e}");
            false
        }
    }
}

#[tauri::command]
pub fn launch_claude_code_with_config(
    api_url: String,
    api_key: Option<String>,
    big_model: Option<String>,
    medium_model: Option<String>,
    small_model: Option<String>,
    custom_env_vars: Vec<serde_json::Value>,
) -> Result<(), String> {
    // Clone values for logging before moving
    let api_url_log = api_url.clone();
    let big_model_log = big_model.clone();
    let medium_model_log = medium_model.clone();
    let small_model_log = small_model.clone();

    let mut env_vars: Vec<(String, String)> = Vec::with_capacity(8);
    env_vars.push(("ANTHROPIC_BASE_URL".to_string(), api_url));

    env_vars.push((
        "ANTHROPIC_AUTH_TOKEN".to_string(),
        api_key.unwrap_or_else(|| "jan".to_string()),
    ));

    if let Some(model) = big_model {
        env_vars.push(("ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(), model));
    }

    if let Some(model) = medium_model {
        env_vars.push(("ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(), model));
    }

    if let Some(model) = small_model {
        env_vars.push(("ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(), model));
    }

    // Add custom env vars from the custom CLI section
    for env in &custom_env_vars {
        if let (Some(key), Some(value)) = (
            env.get("key").and_then(|v| v.as_str()),
            env.get("value").and_then(|v| v.as_str()),
        ) {
            env_vars.push((key.to_string(), value.to_string()));
        }
    }

    log::info!(
        "Launching Claude Code with API URL: {}, models: opus={:?}, sonnet={:?}, haiku={:?}, custom_envs={}",
        api_url_log,
        big_model_log,
        medium_model_log,
        small_model_log,
        custom_env_vars.len()
    );

    // Build the command environment
    // Export environment variables to the user's shell config file

    if cfg!(target_os = "macos") {
        let home_dir = std::env::var("HOME").map_err(|e| e.to_string())?;
        let (shell_name, env_file_path) = detect_shell_env_file(&home_dir, true);
        log::info!(
            "Detected shell: {}, writing env to: {}",
            shell_name,
            env_file_path
        );

        // Try direct write first
        match std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .open(&env_file_path)
        {
            Ok(_) => {
                write_env_to_shell(&env_file_path, &env_vars)?;
                return Ok(());
            }
            Err(_) => {
                // Use admin privileges to write
                let marker = "# Jan Local API Server - Claude Code Config";
                let existing_content = std::fs::read_to_string(&env_file_path).unwrap_or_default();
                let cleaned: Vec<&str> = existing_content
                    .split('\n')
                    .filter(|line| {
                        !line.starts_with(marker)
                            && !line.starts_with("# Jan Local API Server")
                            && !line.starts_with("export ANTHROPIC_")
                    })
                    .collect();

                let env_content: String = env_vars
                    .iter()
                    .map(|(k, v)| format!("export {}='{}'\n", k, v))
                    .collect();

                let new_block = format!("{}\n{}", marker, env_content);

                let final_content = cleaned.join("\n") + "\n" + &new_block + marker;

                // Write to a temp file first, then use osascript to move it
                let temp_script_path = format!("{}/.jan_env_update.sh", home_dir);
                std::fs::write(&temp_script_path, &final_content).map_err(|e| e.to_string())?;

                // Use admin privileges to move the temp file
                let script = format!(
                    r#"do shell script "cp '{}' '{}' && rm '{}' && echo 'Env vars written to {}'" with administrator privileges"#,
                    temp_script_path, env_file_path, temp_script_path, env_file_path
                );

                std::process::Command::new("osascript")
                    .arg("-e")
                    .arg(&script)
                    .output()
                    .map_err(|e| e.to_string())?;

                log::info!(
                    "Env vars written to {} with admin privileges",
                    env_file_path
                );
                return Ok(());
            }
        }
    } else if cfg!(target_os = "linux") {
        let home_dir = std::env::var("HOME").map_err(|e| e.to_string())?;
        let (shell_name, env_file_path) = detect_shell_env_file(&home_dir, false);
        log::info!(
            "Detected shell: {}, writing env to: {}",
            shell_name,
            env_file_path
        );

        match std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .open(&env_file_path)
        {
            Ok(_) => {
                write_env_to_shell(&env_file_path, &env_vars)?;
                return Ok(());
            }
            Err(_) => {
                let jan_config_dir = format!("{}/.config/jan", home_dir);
                let ext = if shell_name == "bash" { "bash" } else { "zsh" };
                let env_file = format!("{}/claude-code-env.{}", jan_config_dir, ext);
                return Err(format!("NEED_PERMISSION:{}", env_file));
            }
        }
    } else {
        // On Windows, set persistent user environment variables using setx
        for (key, value) in &env_vars {
            let output = std::process::Command::new("setx")
                .arg(key)
                .arg(value)
                .output()
                .map_err(|e| e.to_string())?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Failed to set env var {}: {}", key, stderr));
            }
        }

        log::info!("Environment variables set permanently in Windows registry.");
        return Ok(());
    }
}

#[derive(serde::Serialize)]
pub struct CliInstallStatus {
    pub installed: bool,
    pub path: Option<String>,
}

/// Check if the `jan` CLI binary is accessible on PATH.
#[tauri::command]
pub async fn check_jan_cli_installed() -> CliInstallStatus {
    let which_cmd = if cfg!(windows) { "where" } else { "which" };
    let mut cmd = std::process::Command::new(which_cmd);
    cmd.arg("jan");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    match tokio::task::spawn_blocking(move || cmd.output()).await {
        Ok(Ok(out)) if out.status.success() => {
            let raw = String::from_utf8_lossy(&out.stdout);
            #[cfg(windows)]
            let path = {
                // `where` returns one path per line; pick the first that isn't a
                // dev-build artifact (i.e. skip paths containing \target\)
                raw.lines()
                    .map(str::trim)
                    .filter(|p| !p.is_empty() && !p.to_ascii_lowercase().contains("\\target\\"))
                    .next()
                    .map(str::to_string)
                    // fall back to the raw first line if every path looks like a build dir
                    .or_else(|| {
                        raw.lines()
                            .map(str::trim)
                            .find(|p| !p.is_empty())
                            .map(str::to_string)
                    })
            };
            #[cfg(not(windows))]
            let path = Some(raw.trim().to_string());
            CliInstallStatus {
                installed: path.is_some(),
                path,
            }
        }
        _ => CliInstallStatus {
            installed: false,
            path: None,
        },
    }
}

/// Core install logic — synchronous, no Tauri command overhead.
pub fn install_jan_cli_sync<R: Runtime>(
    app_handle: &AppHandle<R>,
) -> Result<CliInstallStatus, String> {
    let bin_name = if cfg!(windows) {
        "jan-cli.exe"
    } else {
        "jan-cli"
    };
    let dest_bin_name = if cfg!(windows) { "jan.exe" } else { "jan" };
    let resource_bin_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources/bin");
    let bundled = resource_bin_dir.join(bin_name);
    let dest = resource_bin_dir.join(dest_bin_name);

    if !bundled.exists() && !dest.exists() {
        return Err("Jan CLI binary not bundled with this version of Jan.".to_string());
    }

    #[cfg(windows)]
    {
        if bundled.exists() {
            if let Err(e) = std::fs::rename(&bundled, &dest) {
                log::warn!("Could not rename jan-cli.exe to jan.exe: {}", e);
            }
        }
        add_to_path_windows(&resource_bin_dir)?;
        return Ok(CliInstallStatus {
            installed: true,
            path: Some(dest.to_string_lossy().into_owned()),
        });
    }

    #[cfg(unix)]
    {
        let install_dir = jan_cli_install_dir()?;
        std::fs::create_dir_all(&install_dir).map_err(|e| e.to_string())?;
        let dest = install_dir.join(dest_bin_name);

        std::fs::copy(&bundled, &dest)
            .map_err(|e| format!("Failed to copy jan to {}: {}", dest.display(), e))?;

        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;

        Ok(CliInstallStatus {
            installed: true,
            path: Some(dest.to_string_lossy().into_owned()),
        })
    }
}

/// Copy the bundled `jan` binary to the system PATH (Tauri command wrapper).
#[tauri::command]
pub async fn install_jan_cli<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<CliInstallStatus, String> {
    install_jan_cli_sync(&app_handle)
}

/// Remove the installed `jan` CLI binary.
#[tauri::command]
pub fn uninstall_jan_cli() -> Result<(), String> {
    #[cfg(windows)]
    {
        let bin_dir = jan_cli_bin_dir_windows()?;
        remove_from_path_windows(&bin_dir)?;
        return Ok(());
    }

    #[cfg(unix)]
    {
        let dest = jan_cli_install_dir()?.join("jan");
        if dest.exists() {
            std::fs::remove_file(&dest)
                .map_err(|e| format!("Failed to remove Jan CLI from {}: {}", dest.display(), e))?;
        }
        Ok(())
    }
}

/// Build the cleaned shell-file content with all Jan CC env vars stripped out.
fn build_cleaned_env_content(env_file_path: &str) -> String {
    let existing_content = std::fs::read_to_string(env_file_path).unwrap_or_default();
    let cleaned: Vec<&str> = existing_content
        .split('\n')
        .filter(|line| {
            !line.starts_with("# Jan Local API Server - Claude Code Config")
                && !line.starts_with("# Jan Local API Server")
                && !line.starts_with("export ANTHROPIC_")
        })
        .collect();
    // Trim trailing blank lines left behind by the removed block
    cleaned.join("\n").trim_end().to_string() + "\n"
}

/// Clear all Jan-written Claude Code environment variables from the shell config.
/// Uses the same write-probe + osascript-fallback logic as `launch_claude_code_with_config`.
#[tauri::command]
pub fn clear_claude_code_env() -> Result<(), String> {
    if cfg!(target_os = "macos") {
        let home_dir = std::env::var("HOME").map_err(|e| e.to_string())?;
        let (shell_name, env_file_path) = detect_shell_env_file(&home_dir, true);
        log::info!(
            "Clearing CC env from shell: {}, file: {}",
            shell_name,
            env_file_path
        );

        let cleaned = build_cleaned_env_content(&env_file_path);

        match std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .open(&env_file_path)
        {
            Ok(_) => {
                std::fs::write(&env_file_path, &cleaned).map_err(|e| e.to_string())?;
                return Ok(());
            }
            Err(_) => {
                // Write cleaned content to a temp file, then use osascript to move it
                let temp_path = format!("{}/.jan_env_clear.sh", home_dir);
                std::fs::write(&temp_path, &cleaned).map_err(|e| e.to_string())?;

                let script = format!(
                    r#"do shell script "cp '{}' '{}' && rm '{}'" with administrator privileges"#,
                    temp_path, env_file_path, temp_path
                );

                std::process::Command::new("osascript")
                    .arg("-e")
                    .arg(&script)
                    .output()
                    .map_err(|e| e.to_string())?;

                log::info!(
                    "CC env cleared from {} with admin privileges",
                    env_file_path
                );
                return Ok(());
            }
        }
    } else if cfg!(target_os = "linux") {
        let home_dir = std::env::var("HOME").map_err(|e| e.to_string())?;
        let (shell_name, env_file_path) = detect_shell_env_file(&home_dir, false);
        log::info!(
            "Clearing CC env from shell: {}, file: {}",
            shell_name,
            env_file_path
        );

        let cleaned = build_cleaned_env_content(&env_file_path);

        match std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .open(&env_file_path)
        {
            Ok(_) => {
                std::fs::write(&env_file_path, &cleaned).map_err(|e| e.to_string())?;
                Ok(())
            }
            Err(_) => Err(format!("NEED_PERMISSION:{}", env_file_path)),
        }
    } else {
        // Windows: delete the persistent user env vars from the registry
        let keys = [
            "ANTHROPIC_BASE_URL",
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_DEFAULT_OPUS_MODEL",
            "ANTHROPIC_DEFAULT_SONNET_MODEL",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        ];
        for key in &keys {
            let _ = std::process::Command::new("reg")
                .args(["delete", "HKCU\\Environment", "/v", key, "/f"])
                .output();
        }
        log::info!("CC env vars removed from Windows registry.");
        Ok(())
    }
}

/// Determine the best writable directory for the Jan CLI install (Unix only).
#[cfg(unix)]
fn jan_cli_install_dir() -> Result<PathBuf, String> {
    let usr_local_bin = PathBuf::from("/usr/local/bin");
    if usr_local_bin.exists() {
        let probe = usr_local_bin.join(".jan_write_probe");
        if std::fs::write(&probe, b"").is_ok() {
            let _ = std::fs::remove_file(&probe);
            return Ok(usr_local_bin);
        }
    }
    let home =
        std::env::var("HOME").map_err(|_| "Cannot determine home directory".to_string())?;
    Ok(PathBuf::from(home).join(".local").join("bin"))
}

/// Return the directory containing the bundled CLI binary on Windows.
#[cfg(windows)]
fn jan_cli_bin_dir_windows() -> Result<PathBuf, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "Cannot determine LOCALAPPDATA".to_string())?;
    Ok(PathBuf::from(local_app_data)
        .join("Programs")
        .join("Atomic Chat")
        .join("resources")
        .join("bin"))
}

/// Add a directory to the Windows user PATH.
#[cfg(windows)]
fn add_to_path_windows(install_dir: &PathBuf) -> Result<(), String> {
    use std::process::Command;

    let install_dir_str = install_dir.to_string_lossy().to_string();

    let mut cmd = Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-Command",
        "[Environment]::GetEnvironmentVariable('Path', 'User')",
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let read_output = cmd
        .output()
        .map_err(|e| format!("Failed to read user PATH: {}", e))?;

    let existing_user_path = String::from_utf8_lossy(&read_output.stdout)
        .trim()
        .to_string();

    // Remove stale old-style PATH entry (..\\Programs\\Jan without \\resources\\bin)
    // left by previous versions that placed jan.exe next to the GUI binary.
    let old_jan_dir = install_dir
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_string_lossy().to_string());

    let parts: Vec<&str> = existing_user_path
        .split(';')
        .filter(|p| !p.is_empty())
        .filter(|p| {
            if let Some(ref old) = old_jan_dir {
                !p.eq_ignore_ascii_case(old)
            } else {
                true
            }
        })
        .collect();

    if parts.iter().any(|p| p.eq_ignore_ascii_case(&install_dir_str)) {
        return Ok(());
    }

    let mut new_parts = vec![install_dir_str.as_str()];
    new_parts.extend(parts);
    let new_path = new_parts.join(";");

    let mut cmd_write = Command::new("powershell");
    cmd_write.args([
        "-NoProfile",
        "-Command",
        &format!(
            "[Environment]::SetEnvironmentVariable('Path', '{}', 'User')",
            new_path.replace('\'', "''")
        ),
    ]);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd_write.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let write_output = cmd_write
        .output()
        .map_err(|e| format!("Failed to update user PATH: {}", e))?;

    if !write_output.status.success() {
        return Err(format!(
            "Failed to update PATH: {}",
            String::from_utf8_lossy(&write_output.stderr)
        ));
    }

    log::info!("Added {} to Windows user PATH", install_dir_str);
    Ok(())
}

/// Remove a directory from the Windows user PATH.
#[cfg(windows)]
fn remove_from_path_windows(dir: &PathBuf) -> Result<(), String> {
    use std::process::Command;

    let dir_str = dir.to_string_lossy().to_string();

    let mut cmd = Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-Command",
        "[Environment]::GetEnvironmentVariable('Path', 'User')",
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let read_output = cmd
        .output()
        .map_err(|e| format!("Failed to read user PATH: {}", e))?;

    let existing_user_path = String::from_utf8_lossy(&read_output.stdout)
        .trim()
        .to_string();

    let new_path: String = existing_user_path
        .split(';')
        .filter(|p| !p.is_empty() && !p.eq_ignore_ascii_case(&dir_str))
        .collect::<Vec<_>>()
        .join(";");

    if new_path.len() != existing_user_path.len() {
        let mut cmd_write = Command::new("powershell");
        cmd_write.args([
            "-NoProfile",
            "-Command",
            &format!(
                "[Environment]::SetEnvironmentVariable('Path', '{}', 'User')",
                new_path.replace('\'', "''")
            ),
        ]);

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd_write.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let write_output = cmd_write
            .output()
            .map_err(|e| format!("Failed to update user PATH: {}", e))?;

        if !write_output.status.success() {
            return Err(format!(
                "Failed to update PATH: {}",
                String::from_utf8_lossy(&write_output.stderr)
            ));
        }

        log::info!("Removed {} from Windows user PATH", dir_str);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Hermes Agent integration
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn configure_hermes_agent(
    api_url: String,
    model: String,
    api_key: Option<String>,
    context_length: Option<u32>,
) -> Result<(), String> {
    let home_dir = if cfg!(windows) {
        std::env::var("USERPROFILE").map_err(|e| e.to_string())?
    } else {
        std::env::var("HOME").map_err(|e| e.to_string())?
    };

    let hermes_dir = std::path::PathBuf::from(&home_dir).join(".hermes");
    let config_path = hermes_dir.join("config.yaml");
    let env_path = hermes_dir.join(".env");

    if !config_path.exists() {
        return Err(
            "Hermes Agent is not installed (~/.hermes/config.yaml not found). \
             Install it first: https://github.com/NousResearch/hermes-agent"
                .to_string(),
        );
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config.yaml: {}", e))?;

    // --- Patch model section (first occurrence of each key) ---
    let mut did_default = false;
    let mut did_provider = false;
    let mut did_base_url = false;

    let patched: Vec<String> = content
        .lines()
        .map(|line| {
            let trimmed = line.trim();
            if !did_default && trimmed.starts_with("default:") && trimmed.contains('"') {
                did_default = true;
                return replace_yaml_quoted_value(line, &model);
            }
            if !did_provider && trimmed.starts_with("provider:") && trimmed.contains('"') {
                did_provider = true;
                return replace_yaml_quoted_value(line, "custom");
            }
            if !did_base_url && trimmed.starts_with("base_url:") && trimmed.contains('"') {
                did_base_url = true;
                return replace_yaml_quoted_value(line, &api_url);
            }
            line.to_string()
        })
        .collect();

    let after_model_patch = patched.join("\n");

    // --- Upsert only our entry in custom_providers (preserves user's other providers) ---
    let ctx = context_length.unwrap_or(20000);
    let after_cp = upsert_atomic_provider(
        &after_model_patch,
        &api_url,
        &model,
        ctx,
    );

    let final_content = if content.ends_with('\n') && !after_cp.ends_with('\n') {
        format!("{}\n", after_cp)
    } else {
        after_cp
    };

    std::fs::write(&config_path, &final_content)
        .map_err(|e| format!("Failed to write config.yaml: {}", e))?;

    // --- Ensure NO_PROXY is set in .env to bypass system proxy for localhost ---
    let no_proxy_line = "NO_PROXY=localhost,127.0.0.1,0.0.0.0";
    let no_proxy_lower = "export no_proxy=localhost,127.0.0.1,0.0.0.0";

    if env_path.exists() {
        let env_content = std::fs::read_to_string(&env_path)
            .map_err(|e| format!("Failed to read .env: {}", e))?;
        if !env_content.contains("NO_PROXY=") && !env_content.contains("no_proxy=") {
            let separator = if env_content.ends_with('\n') { "" } else { "\n" };
            let patched = format!(
                "{}{}\n{}\n{}",
                env_content, separator, no_proxy_line, no_proxy_lower
            );
            std::fs::write(&env_path, patched)
                .map_err(|e| format!("Failed to write .env: {}", e))?;
        }
    }

    let _ = api_key; // reserved for future use

    log::info!(
        "Hermes Agent configured: model={}, base_url={}, context_length={}",
        model,
        api_url,
        ctx
    );
    Ok(())
}

#[tauri::command]
pub fn clear_hermes_agent_config() -> Result<(), String> {
    let home_dir = if cfg!(windows) {
        std::env::var("USERPROFILE").map_err(|e| e.to_string())?
    } else {
        std::env::var("HOME").map_err(|e| e.to_string())?
    };

    let hermes_dir = std::path::PathBuf::from(&home_dir).join(".hermes");
    let config_path = hermes_dir.join("config.yaml");

    if !config_path.exists() {
        return Ok(());
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config.yaml: {}", e))?;

    let mut did_default = false;
    let mut did_provider = false;
    let mut did_base_url = false;

    let patched: Vec<String> = content
        .lines()
        .map(|line| {
            let trimmed = line.trim();
            if !did_default && trimmed.starts_with("default:") && trimmed.contains('"') {
                did_default = true;
                return replace_yaml_quoted_value(line, "anthropic/claude-opus-4.6");
            }
            if !did_provider && trimmed.starts_with("provider:") && trimmed.contains('"') {
                did_provider = true;
                return replace_yaml_quoted_value(line, "auto");
            }
            if !did_base_url && trimmed.starts_with("base_url:") && trimmed.contains('"') {
                did_base_url = true;
                return replace_yaml_quoted_value(line, "https://openrouter.ai/api/v1");
            }
            line.to_string()
        })
        .collect();

    let after_model_patch = patched.join("\n");

    // Remove only our entry from custom_providers (preserves user's other providers)
    let after_cp = remove_atomic_provider(&after_model_patch);

    let final_content = if content.ends_with('\n') && !after_cp.ends_with('\n') {
        format!("{}\n", after_cp)
    } else {
        after_cp
    };

    std::fs::write(&config_path, &final_content)
        .map_err(|e| format!("Failed to write config.yaml: {}", e))?;

    // Remove NO_PROXY lines from .env
    let env_path = hermes_dir.join(".env");
    if env_path.exists() {
        let env_content = std::fs::read_to_string(&env_path)
            .map_err(|e| format!("Failed to read .env: {}", e))?;
        let cleaned: String = env_content
            .lines()
            .filter(|line| {
                let trimmed = line.trim();
                !trimmed.starts_with("NO_PROXY=") && !trimmed.starts_with("no_proxy=")
            })
            .collect::<Vec<_>>()
            .join("\n");
        let cleaned = if cleaned.ends_with('\n') {
            cleaned
        } else {
            format!("{}\n", cleaned)
        };
        std::fs::write(&env_path, cleaned)
            .map_err(|e| format!("Failed to write .env: {}", e))?;
    }

    log::info!("Hermes Agent config reset to defaults");
    Ok(())
}

/// Replace the quoted value in a YAML line like `  key: "old"` -> `  key: "new"`,
/// preserving leading whitespace and the key name.
fn replace_yaml_quoted_value(line: &str, new_value: &str) -> String {
    if let Some(first_quote) = line.find('"') {
        if let Some(second_quote) = line[first_quote + 1..].find('"') {
            let end = first_quote + 1 + second_quote;
            return format!(
                "{}\"{}\"{}",
                &line[..first_quote],
                new_value,
                &line[end + 1..],
            );
        }
    }
    line.to_string()
}

const ATOMIC_PROVIDER_NAME: &str = "atomic-chat";

/// Split the config into (before, entries, after) around `custom_providers:`.
/// `entries` is a Vec of Vec<String>, one per YAML list item.
fn split_custom_providers(content: &str) -> (Vec<String>, Vec<Vec<String>>, Vec<String>) {
    let mut before: Vec<String> = Vec::new();
    let mut block_lines: Vec<String> = Vec::new();
    let mut after: Vec<String> = Vec::new();

    #[derive(PartialEq)]
    enum Phase { Before, InBlock, After }
    let mut phase = Phase::Before;

    for line in content.lines() {
        match phase {
            Phase::Before => {
                let t = line.trim();
                if t == "custom_providers:"
                    || t == "custom_providers: []"
                    || t == "custom_providers:[]"
                {
                    phase = if t.contains("[]") { Phase::After } else { Phase::InBlock };
                } else {
                    before.push(line.to_string());
                }
            }
            Phase::InBlock => {
                let first = line.chars().next();
                match first {
                    None | Some(' ') | Some('\t') | Some('-') => {
                        block_lines.push(line.to_string());
                    }
                    _ => {
                        phase = Phase::After;
                        after.push(line.to_string());
                    }
                }
            }
            Phase::After => {
                after.push(line.to_string());
            }
        }
    }

    let mut entries: Vec<Vec<String>> = Vec::new();
    let mut current: Vec<String> = Vec::new();

    for line in &block_lines {
        if line.starts_with("- ") {
            if !current.is_empty() {
                entries.push(std::mem::take(&mut current));
            }
        }
        if !line.trim().is_empty() {
            current.push(line.clone());
        }
    }
    if !current.is_empty() {
        entries.push(current);
    }

    (before, entries, after)
}

fn entry_is_ours(entry: &[String]) -> bool {
    entry.iter().any(|l| {
        let t = l.trim();
        let name_val = if t.starts_with("- name:") {
            t.trim_start_matches("- name:").trim()
        } else if t.starts_with("name:") {
            t.trim_start_matches("name:").trim()
        } else {
            return false;
        };
        name_val == ATOMIC_PROVIDER_NAME
            || name_val == format!("\"{}\"", ATOMIC_PROVIDER_NAME)
    })
}

fn rebuild_custom_providers(
    before: &[String],
    entries: &[Vec<String>],
    after: &[String],
) -> String {
    let mut result: Vec<String> = before.to_vec();

    while result.last().map_or(false, |l| l.trim().is_empty()) {
        result.pop();
    }

    if entries.is_empty() {
        result.push("custom_providers: []".to_string());
    } else {
        result.push("custom_providers:".to_string());
        for entry in entries {
            for line in entry {
                result.push(line.clone());
            }
        }
    }

    for line in after {
        result.push(line.clone());
    }

    let out = result.join("\n");
    if out.ends_with('\n') { out } else { format!("{}\n", out) }
}

/// Add or update only the `atomic-chat` entry in `custom_providers`,
/// leaving all other user entries (Telegram, WhatsApp, etc.) intact.
fn upsert_atomic_provider(
    content: &str,
    api_url: &str,
    model: &str,
    context_length: u32,
) -> String {
    let (before, mut entries, after) = split_custom_providers(content);

    entries.retain(|e| !entry_is_ours(e));

    entries.push(vec![
        format!("- name: {}", ATOMIC_PROVIDER_NAME),
        format!("  base_url: {}", api_url),
        format!("  model: {}", model),
        "  models:".to_string(),
        format!("    {}:", model),
        format!("      context_length: {}", context_length),
    ]);

    rebuild_custom_providers(&before, &entries, &after)
}

/// Remove only the `atomic-chat` entry from `custom_providers`,
/// leaving all other user entries intact.
fn remove_atomic_provider(content: &str) -> String {
    let (before, mut entries, after) = split_custom_providers(content);
    entries.retain(|e| !entry_is_ours(e));
    rebuild_custom_providers(&before, &entries, &after)
}
