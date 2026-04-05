use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_llamacpp::cleanup_llama_processes;

use crate::core::app::commands::{
    default_data_folder_path, get_jan_data_folder_path, update_app_configuration,
};
use crate::core::app::constants::{
    JAN_DATA_DIRS_COMMON, JAN_DATA_DIRS_CONVERSATIONS, JAN_DATA_DIRS_MODELS,
    JAN_DATA_FILES_CONFIGS, JAN_DATA_FILES_SETTINGS,
};
use crate::core::app::models::AppConfiguration;
use crate::core::mcp::helpers::{stop_mcp_servers_with_context, ShutdownContext};
use crate::core::state::AppState;

fn is_safe_to_delete(path: &std::path::Path) -> bool {
    let count = path.components().count();
    count >= 3
}

fn remove_dir(data_folder: &std::path::Path, name: &str) {
    let path = data_folder.join(name);
    if path.is_dir() {
        log::info!("Removing directory: {}", path.display());
        if let Err(e) = fs::remove_dir_all(&path) {
            log::warn!("Failed to remove {}: {e}", path.display());
        }
    }
}

fn remove_file(data_folder: &std::path::Path, name: &str) {
    let path = data_folder.join(name);
    if path.is_file() {
        log::info!("Removing file: {}", path.display());
        if let Err(e) = fs::remove_file(&path) {
            log::warn!("Failed to remove {}: {e}", path.display());
        }
    }
}

/// Delete conversations and user data (threads, assistants).
fn delete_conversations(data_folder: &std::path::Path) {
    log::info!("Deleting conversations (threads, assistants)");
    for dir in JAN_DATA_DIRS_CONVERSATIONS {
        remove_dir(data_folder, dir);
    }
}

/// Delete downloaded models, engine binaries, and configuration files
/// (engine settings, MCP config, etc.).
fn delete_models_and_configs(data_folder: &std::path::Path) {
    log::info!("Deleting models, engines, and configurations");
    for dir in JAN_DATA_DIRS_MODELS {
        remove_dir(data_folder, dir);
    }
    for file in JAN_DATA_FILES_CONFIGS {
        remove_file(data_folder, file);
    }
}

/// Delete extensions, logs, caches — always cleaned during any reset.
fn delete_common_data(data_folder: &std::path::Path) {
    log::info!("Deleting common data (extensions, logs, caches)");
    for dir in JAN_DATA_DIRS_COMMON {
        remove_dir(data_folder, dir);
    }
}

/// Delete cross-category settings (store.json) — only during a full wipe
/// when the user is not keeping any data.
fn delete_settings(data_folder: &std::path::Path) {
    log::info!("Deleting cross-category settings (store.json)");
    for file in JAN_DATA_FILES_SETTINGS {
        remove_file(data_folder, file);
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
pub fn factory_reset<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    keep_app_data: Option<bool>,
    keep_models_and_configs: Option<bool>,
) {
    let keep_app_data = keep_app_data.unwrap_or(false);
    let keep_models_and_configs = keep_models_and_configs.unwrap_or(false);

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
    log::info!(
        "Factory reset (keep_app_data={}, keep_models_and_configs={}), data folder: {:?}",
        keep_app_data,
        keep_models_and_configs,
        data_folder
    );

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

        if data_folder.exists() {
            if !is_safe_to_delete(&data_folder) {
                log::error!(
                    "Refusing factory reset: path is too close to filesystem root: {}",
                    data_folder.display()
                );
                return;
            }

            // Always clean common data (extensions, logs, caches)
            delete_common_data(&data_folder);

            // Delete conversations (threads, assistants) unless user chose to keep it
            if !keep_app_data {
                delete_conversations(&data_folder);
            }

            // Delete models and configs unless user chose to keep them
            if !keep_models_and_configs {
                delete_models_and_configs(&data_folder);
            }

            // store.json spans all categories; only wipe it when nothing is kept
            if !keep_app_data && !keep_models_and_configs {
                delete_settings(&data_folder);
            }
        }

        // Reset app configuration to defaults unless user chose to keep configs
        if !keep_models_and_configs {
            let mut default_config = AppConfiguration::default();
            default_config.data_folder = default_data_folder_path(app_handle.clone());
            let _ = update_app_configuration(app_handle.clone(), default_config);
        }

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
        // Normalize extended-length paths (\\?\...) for explorer compatibility.
        let mut path_str = path.to_string_lossy().into_owned();
        if let Some(stripped) = path_str.strip_prefix(r"\\?\UNC\") {
            path_str = format!(r"\\{}", stripped);
        } else if let Some(stripped) = path_str.strip_prefix(r"\\?\") {
            path_str = stripped.to_string();
        }
        std::process::Command::new("explorer")
            .arg(path_str)
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
        .join("Jan")
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::app::constants::*;
    use std::fs;
    use tempfile::tempdir;

    fn create_all_data(dir: &std::path::Path) {
        for subdir in JAN_DATA_SUBDIRS {
            fs::create_dir_all(dir.join(subdir)).unwrap();
            fs::write(dir.join(subdir).join("dummy.txt"), "data").unwrap();
        }
        for file in JAN_DATA_FILES {
            fs::write(dir.join(file), "data").unwrap();
        }
    }

    fn exists_any(dir: &std::path::Path, names: &[&str]) -> bool {
        names.iter().any(|n| dir.join(n).exists())
    }

    fn exists_all(dir: &std::path::Path, names: &[&str]) -> bool {
        names.iter().all(|n| dir.join(n).exists())
    }

    #[test]
    fn test_delete_conversations_only_removes_conversation_dirs() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        delete_conversations(d);

        assert!(!exists_any(d, JAN_DATA_DIRS_CONVERSATIONS));
        assert!(exists_all(d, JAN_DATA_DIRS_MODELS));
        assert!(exists_all(d, JAN_DATA_DIRS_COMMON));
        assert!(d.join("store.json").exists());
        assert!(d.join("mcp_config.json").exists());
    }

    #[test]
    fn test_delete_models_and_configs_only_removes_model_dirs_and_config_files() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        delete_models_and_configs(d);

        assert!(!exists_any(d, JAN_DATA_DIRS_MODELS));
        assert!(!exists_any(d, JAN_DATA_FILES_CONFIGS));
        assert!(exists_all(d, JAN_DATA_DIRS_CONVERSATIONS));
        assert!(exists_all(d, JAN_DATA_DIRS_COMMON));
        assert!(d.join("store.json").exists());
    }

    #[test]
    fn test_delete_common_data_only_removes_common_dirs() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        delete_common_data(d);

        assert!(!exists_any(d, JAN_DATA_DIRS_COMMON));
        assert!(exists_all(d, JAN_DATA_DIRS_CONVERSATIONS));
        assert!(exists_all(d, JAN_DATA_DIRS_MODELS));
        assert!(d.join("store.json").exists());
        assert!(d.join("mcp_config.json").exists());
    }

    #[test]
    fn test_delete_settings_only_removes_store_json() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        delete_settings(d);

        assert!(!d.join("store.json").exists());
        assert!(exists_all(d, JAN_DATA_DIRS_CONVERSATIONS));
        assert!(exists_all(d, JAN_DATA_DIRS_MODELS));
        assert!(exists_all(d, JAN_DATA_DIRS_COMMON));
        assert!(d.join("mcp_config.json").exists());
    }

    #[test]
    fn test_store_json_survives_when_keeping_any_category() {
        // Simulate: keep_app_data=true, keep_models_and_configs=false
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        delete_common_data(d);
        delete_models_and_configs(d);
        // store.json should NOT be deleted because keep_app_data=true
        assert!(d.join("store.json").exists());

        // Simulate: keep_app_data=false, keep_models_and_configs=true
        let tmp2 = tempdir().unwrap();
        let d2 = tmp2.path();
        create_all_data(d2);

        delete_common_data(d2);
        delete_conversations(d2);
        // store.json should NOT be deleted because keep_models_and_configs=true
        assert!(d2.join("store.json").exists());
    }

    #[test]
    fn test_full_wipe_deletes_store_json() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        delete_common_data(d);
        delete_conversations(d);
        delete_models_and_configs(d);
        delete_settings(d);

        assert!(!d.join("store.json").exists());
        assert!(!exists_any(d, JAN_DATA_SUBDIRS));
        assert!(!exists_any(d, JAN_DATA_FILES));
    }

    #[test]
    fn test_delete_on_nonexistent_dirs_does_not_panic() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        // Nothing created — should not panic
        delete_conversations(d);
        delete_models_and_configs(d);
        delete_common_data(d);
        delete_settings(d);
    }

    #[test]
    fn test_is_safe_to_delete() {
        assert!(!is_safe_to_delete(std::path::Path::new("/")));
        assert!(!is_safe_to_delete(std::path::Path::new("/home")));
        assert!(is_safe_to_delete(std::path::Path::new("/home/user/jan")));
        assert!(is_safe_to_delete(std::path::Path::new(
            "/home/user/.local/share/jan"
        )));
    }
}
