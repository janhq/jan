use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
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
        if dest.exists() {
            let alias = resource_bin_dir.join("atomic-chat-cli.exe");
            if let Err(e) = std::fs::copy(&dest, &alias) {
                log::warn!("Could not copy jan.exe to atomic-chat-cli.exe: {}", e);
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
        for name in ["jan.exe", "atomic-chat-cli.exe"] {
            let path = bin_dir.join(name);
            if path.exists() {
                if let Err(e) = std::fs::remove_file(&path) {
                    log::warn!("Could not remove {}: {}", path.display(), e);
                }
            }
        }
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
            if !did_default && trimmed.starts_with("default:") {
                did_default = true;
                return replace_yaml_scalar_value(line, &model);
            }
            if !did_provider && trimmed.starts_with("provider:") {
                did_provider = true;
                return replace_yaml_scalar_value(line, "custom");
            }
            if !did_base_url && trimmed.starts_with("base_url:") {
                did_base_url = true;
                return replace_yaml_scalar_value(line, &api_url);
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

    // Seed a per-request timeout for the `custom` provider (the id our model
    // section uses). Hermes reads `providers.<id>.request_timeout_seconds`
    // (run_agent.py::get_provider_request_timeout); without it the legacy
    // 1800s default applies. Any value the user already set is preserved.
    let after_timeout = upsert_provider_request_timeout(
        &after_cp,
        "custom",
        HERMES_REQUEST_TIMEOUT_SECONDS,
    );

    let final_content = if content.ends_with('\n') && !after_timeout.ends_with('\n') {
        format!("{}\n", after_timeout)
    } else {
        after_timeout
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
            if !did_default && trimmed.starts_with("default:") {
                did_default = true;
                return replace_yaml_scalar_value(line, "anthropic/claude-opus-4.6");
            }
            if !did_provider && trimmed.starts_with("provider:") {
                did_provider = true;
                return replace_yaml_scalar_value(line, "auto");
            }
            if !did_base_url && trimmed.starts_with("base_url:") {
                did_base_url = true;
                return replace_yaml_scalar_value(line, "https://openrouter.ai/api/v1");
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

/// Replace the scalar value of a `key: value` YAML line, preserving the leading
/// indentation and the key. Handles both quoted (`key: "old"`) and bare
/// (`key: old`) values; the new value is written unquoted to match Hermes'
/// default config style (model ids, providers, and URLs are all valid plain
/// scalars). Lines without a `:` separator are returned unchanged.
fn replace_yaml_scalar_value(line: &str, new_value: &str) -> String {
    match line.find(':') {
        Some(colon) => format!("{} {}", &line[..=colon], new_value),
        None => line.to_string(),
    }
}

const ATOMIC_PROVIDER_NAME: &str = "atomic-chat";

/// Default per-request timeout (seconds) seeded for Hermes' `custom` provider.
/// Hermes otherwise defaults to 1800s (`HERMES_API_TIMEOUT`); a tighter cap
/// lets a wedged local turn fail fast without waiting half an hour.
const HERMES_REQUEST_TIMEOUT_SECONDS: u32 = 180;

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

/// Return true for a YAML line that begins a top-level (column-0) mapping key,
/// i.e. not indented, not a list item, not a comment, not blank.
fn is_top_level_yaml_key(line: &str) -> bool {
    match line.chars().next() {
        Some(c) => c != ' ' && c != '\t' && c != '-' && c != '#',
        None => false,
    }
}

/// Ensure `providers.<provider_id>.request_timeout_seconds: <seconds>` exists in
/// the Hermes config, creating the `providers:` map and the provider sub-block
/// as needed. A value the user has already set under that provider is left
/// untouched (we only fill the gap, never clobber).
fn upsert_provider_request_timeout(content: &str, provider_id: &str, seconds: u32) -> String {
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();

    let prov_key_line = format!("  {}:", provider_id);
    let field_line = format!("    request_timeout_seconds: {}", seconds);

    // Locate a top-level `providers:` mapping (also tolerate an empty `{}` form).
    let providers_idx = lines.iter().position(|l| {
        let t = l.trim_end();
        is_top_level_yaml_key(l)
            && (t == "providers:" || t == "providers: {}" || t == "providers:{}")
    });

    match providers_idx {
        None => {
            while lines.last().map_or(false, |l| l.trim().is_empty()) {
                lines.pop();
            }
            lines.push("providers:".to_string());
            lines.push(prov_key_line);
            lines.push(field_line);
        }
        Some(pidx) => {
            if lines[pidx].trim_end() != "providers:" {
                lines[pidx] = "providers:".to_string();
            }

            // Extent of the providers block: until the next top-level key.
            let mut block_end = lines.len();
            for i in (pidx + 1)..lines.len() {
                if is_top_level_yaml_key(&lines[i]) {
                    block_end = i;
                    break;
                }
            }

            // Find the provider sub-key at 2-space indent.
            let prov_idx =
                (pidx + 1..block_end).find(|&i| lines[i].trim_end() == prov_key_line);

            match prov_idx {
                None => {
                    lines.insert(pidx + 1, field_line);
                    lines.insert(pidx + 1, prov_key_line);
                }
                Some(pk) => {
                    // Extent of this provider's sub-block: until the next key at
                    // indent <= 2 (a sibling provider) or the block end.
                    let mut sub_end = block_end;
                    for i in (pk + 1)..block_end {
                        let l = &lines[i];
                        if l.trim().is_empty() {
                            continue;
                        }
                        let indent = l.len() - l.trim_start().len();
                        if indent <= 2 {
                            sub_end = i;
                            break;
                        }
                    }
                    let has_field = (pk + 1..sub_end).any(|i| {
                        lines[i].trim_start().starts_with("request_timeout_seconds:")
                    });
                    if !has_field {
                        lines.insert(pk + 1, field_line);
                    }
                }
            }
        }
    }

    let out = lines.join("\n");
    if out.ends_with('\n') {
        out
    } else {
        format!("{}\n", out)
    }
}

// ---------------------------------------------------------------------------
// External coding-agent / assistant integrations (Launch page)
// ---------------------------------------------------------------------------

const ATOMIC_MANAGED_BEGIN: &str = "# >>> Atomic Chat (managed) >>>";
const ATOMIC_MANAGED_END: &str = "# <<< Atomic Chat (managed) <<<";

/// Resolve the user's home directory in a platform-aware way.
fn agent_home_dir() -> Result<String, String> {
    if cfg!(windows) {
        std::env::var("USERPROFILE").map_err(|e| e.to_string())
    } else {
        std::env::var("HOME").map_err(|e| e.to_string())
    }
}

/// Remove a previously written `# >>> Atomic Chat (managed) >>> ... <<<` block.
fn strip_atomic_managed_block(content: &str) -> String {
    if let (Some(start), Some(end)) = (
        content.find(ATOMIC_MANAGED_BEGIN),
        content.find(ATOMIC_MANAGED_END),
    ) {
        if end >= start {
            let end_idx = end + ATOMIC_MANAGED_END.len();
            let mut result = String::with_capacity(content.len());
            result.push_str(&content[..start]);
            result.push_str(&content[end_idx..]);
            return result;
        }
    }
    content.to_string()
}

/// Installer spec for an agent: (program, args, prerequisite_binary, docs_url).
/// Verified against each vendor's official install path:
///   - Claude Code / Codex / OpenCode / OpenClaw ship as global npm packages.
///   - Hermes is a Python project installed via its official shell / PowerShell
///     bootstrap script (NOT npm).
fn agent_install_spec(
    agent_id: &str,
) -> Result<(String, Vec<String>, &'static str, &'static str), String> {
    let npm = |pkg: &str| {
        (
            "npm".to_string(),
            vec!["install".to_string(), "-g".to_string(), pkg.to_string()],
        )
    };

    match agent_id {
        "claude-code" => {
            let (p, a) = npm("@anthropic-ai/claude-code");
            Ok((p, a, "npm", "https://docs.anthropic.com/en/docs/claude-code"))
        }
        "codex" => {
            let (p, a) = npm("@openai/codex");
            Ok((p, a, "npm", "https://github.com/openai/codex"))
        }
        "opencode" => {
            let (p, a) = npm("opencode-ai");
            Ok((p, a, "npm", "https://opencode.ai"))
        }
        "openclaw" => {
            let (p, a) = npm("openclaw");
            Ok((p, a, "npm", "https://docs.openclaw.ai"))
        }
        "hermes" => {
            let (program, args): (String, Vec<String>) = if cfg!(windows) {
                (
                    "powershell".to_string(),
                    vec![
                        "-NoProfile".to_string(),
                        "-Command".to_string(),
                        "iex (irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1)".to_string(),
                    ],
                )
            } else {
                (
                    "sh".to_string(),
                    vec![
                        "-c".to_string(),
                        "curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash".to_string(),
                    ],
                )
            };
            let prereq = if cfg!(windows) { "powershell" } else { "curl" };
            Ok((program, args, prereq, "https://github.com/NousResearch/hermes-agent"))
        }
        other => Err(format!("Unknown or non-installable agent id: {}", other)),
    }
}

/// Probe whether a CLI binary is reachable on PATH (`which` / `where`).
#[tauri::command]
pub async fn detect_agent_installed(bin: String) -> bool {
    let which_cmd = if cfg!(windows) { "where" } else { "which" };
    let mut cmd = std::process::Command::new(which_cmd);
    cmd.arg(&bin);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    matches!(
        tokio::task::spawn_blocking(move || cmd.output()).await,
        Ok(Ok(out))
            if out.status.success()
                && !String::from_utf8_lossy(&out.stdout).trim().is_empty()
    )
}

/// Install an external agent by spawning its official installer, streaming
/// stdout/stderr to the UI via the `agent_install_log:<agent_id>` event.
#[tauri::command]
pub async fn install_agent<R: Runtime>(
    app_handle: AppHandle<R>,
    agent_id: String,
) -> Result<(), String> {
    let (program, args, prereq, docs) = agent_install_spec(&agent_id)?;

    if !detect_agent_installed(prereq.to_string()).await {
        return Err(format!(
            "'{}' is required to install this agent but was not found on PATH. \
             Install it first, then try again: {}",
            prereq, docs
        ));
    }

    let event = format!("agent_install_log:{}", agent_id);
    let agent_id_log = agent_id.clone();

    let success = tokio::task::spawn_blocking(move || -> Result<bool, String> {
        use std::io::{BufRead, BufReader};
        use std::process::{Command, Stdio};

        let mut cmd = Command::new(&program);
        cmd.args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn '{}': {}", program, e))?;

        if let Some(stdout) = child.stdout.take() {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let _ = app_handle.emit(&event, line);
            }
        }
        if let Some(stderr) = child.stderr.take() {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let _ = app_handle.emit(&event, line);
            }
        }

        let status = child.wait().map_err(|e| e.to_string())?;
        Ok(status.success())
    })
    .await
    .map_err(|e| e.to_string())??;

    if success {
        log::info!("Agent '{}' installed successfully", agent_id_log);
        Ok(())
    } else {
        Err(format!(
            "The installer for '{}' exited with a non-zero status. See the install log for details.",
            agent_id_log
        ))
    }
}

/// Configure Codex CLI by upserting a managed block in `~/.codex/config.toml`.
#[tauri::command]
pub fn configure_codex(
    api_url: String,
    model: String,
    api_key: Option<String>,
) -> Result<(), String> {
    let home = agent_home_dir()?;
    let dir = PathBuf::from(&home).join(".codex");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create ~/.codex: {}", e))?;
    let path = dir.join("config.toml");

    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let cleaned = strip_atomic_managed_block(&existing);

    let mut block = String::new();
    block.push_str(ATOMIC_MANAGED_BEGIN);
    block.push('\n');
    block.push_str("[model_providers.atomic]\n");
    block.push_str("name = \"Atomic Chat\"\n");
    block.push_str(&format!("base_url = \"{}\"\n", api_url));
    if api_key.as_deref().filter(|k| !k.is_empty()).is_some() {
        // Codex reads the secret from the env var named here, not inline.
        block.push_str("env_key = \"ATOMIC_CHAT_API_KEY\"\n");
    }
    block.push('\n');
    block.push_str("[profiles.atomic]\n");
    block.push_str(&format!("model = \"{}\"\n", model));
    block.push_str("model_provider = \"atomic\"\n");
    block.push_str(ATOMIC_MANAGED_END);
    block.push('\n');

    let final_content = if cleaned.trim().is_empty() {
        block
    } else {
        format!("{}\n{}", cleaned.trim_end(), block)
    };

    std::fs::write(&path, final_content)
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    log::info!("Codex configured: base_url={}, model={}", api_url, model);
    Ok(())
}

/// Configure OpenCode by upserting `provider.atomic` in
/// `~/.config/opencode/opencode.json` (strict JSON, other providers preserved).
#[tauri::command]
pub fn configure_opencode(
    api_url: String,
    model: String,
    api_key: Option<String>,
) -> Result<(), String> {
    let home = agent_home_dir()?;
    let dir = PathBuf::from(&home).join(".config").join("opencode");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create ~/.config/opencode: {}", e))?;
    let path = dir.join("opencode.json");

    let mut root: serde_json::Value = if path.exists() {
        let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        if text.trim().is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str(&text).map_err(|e| {
                format!(
                    "Could not parse {}: {}. Fix or remove the file and try again.",
                    path.display(),
                    e
                )
            })?
        }
    } else {
        serde_json::json!({})
    };

    let obj = root
        .as_object_mut()
        .ok_or_else(|| "opencode.json is not a JSON object".to_string())?;
    obj.entry("$schema")
        .or_insert_with(|| serde_json::json!("https://opencode.ai/config.json"));

    let provider = obj
        .entry("provider")
        .or_insert_with(|| serde_json::json!({}));
    if !provider.is_object() {
        *provider = serde_json::json!({});
    }

    let key_val = api_key.as_deref().filter(|k| !k.is_empty()).unwrap_or("atomic");
    let mut models = serde_json::Map::new();
    models.insert(model.clone(), serde_json::json!({ "name": model }));

    provider.as_object_mut().unwrap().insert(
        "atomic".to_string(),
        serde_json::json!({
            "npm": "@ai-sdk/openai-compatible",
            "name": "Atomic Chat",
            "options": { "baseURL": api_url, "apiKey": key_val },
            "models": serde_json::Value::Object(models),
        }),
    );

    let pretty = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    std::fs::write(&path, pretty + "\n")
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    log::info!("OpenCode configured: baseURL={}, model={}", api_url, model);
    Ok(())
}

/// Configure OpenClaw by upserting `models.providers.atomic` plus the
/// `agents.defaults.models` allowlist entry in `~/.openclaw/openclaw.json`.
#[tauri::command]
pub fn configure_openclaw(
    api_url: String,
    model: String,
    api_key: Option<String>,
) -> Result<(), String> {
    let home = agent_home_dir()?;
    let config_path = std::env::var("OPENCLAW_CONFIG_PATH")
        .ok()
        .filter(|p| !p.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(&home).join(".openclaw").join("openclaw.json")
        });

    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    }

    let mut root: serde_json::Value = if config_path.exists() {
        let text = std::fs::read_to_string(&config_path).map_err(|e| e.to_string())?;
        if text.trim().is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_str(&text).map_err(|_| {
                format!(
                    "Could not parse {} as JSON (it may contain JSON5 comments). \
                     Please add the Atomic provider manually under models.providers.",
                    config_path.display()
                )
            })?
        }
    } else {
        serde_json::json!({})
    };

    let obj = root
        .as_object_mut()
        .ok_or_else(|| "openclaw.json is not a JSON object".to_string())?;

    let model_ref = format!("atomic/{}", model);
    let key_val = api_key.as_deref().filter(|k| !k.is_empty()).unwrap_or("atomic");

    let models = obj.entry("models").or_insert_with(|| serde_json::json!({}));
    let models_obj = models
        .as_object_mut()
        .ok_or_else(|| "models is not a JSON object".to_string())?;
    models_obj
        .entry("mode")
        .or_insert_with(|| serde_json::json!("merge"));
    let providers = models_obj
        .entry("providers")
        .or_insert_with(|| serde_json::json!({}));
    let providers_obj = providers
        .as_object_mut()
        .ok_or_else(|| "models.providers is not a JSON object".to_string())?;
    providers_obj.insert(
        "atomic".to_string(),
        serde_json::json!({
            "baseUrl": api_url,
            "apiKey": key_val,
            "api": "openai-completions",
            "models": [ { "id": model_ref, "name": model } ],
        }),
    );

    let agents = obj.entry("agents").or_insert_with(|| serde_json::json!({}));
    let agents_obj = agents
        .as_object_mut()
        .ok_or_else(|| "agents is not a JSON object".to_string())?;
    let defaults = agents_obj
        .entry("defaults")
        .or_insert_with(|| serde_json::json!({}));
    let defaults_obj = defaults
        .as_object_mut()
        .ok_or_else(|| "agents.defaults is not a JSON object".to_string())?;
    // Small local models can exceed OpenClaw's short default request timeout
    // once wrapped in the agent system prompt + tools. Seed a generous default
    // (preserving any value the user already set).
    defaults_obj
        .entry("timeoutSeconds")
        .or_insert_with(|| serde_json::json!(240));
    let allow = defaults_obj
        .entry("models")
        .or_insert_with(|| serde_json::json!({}));
    let allow_obj = allow
        .as_object_mut()
        .ok_or_else(|| "agents.defaults.models is not a JSON object".to_string())?;
    allow_obj
        .entry(model_ref)
        .or_insert_with(|| serde_json::json!({}));

    let pretty = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    std::fs::write(&config_path, pretty + "\n")
        .map_err(|e| format!("Failed to write {}: {}", config_path.display(), e))?;
    log::info!("OpenClaw configured: baseUrl={}, model={}", api_url, model);
    Ok(())
}
