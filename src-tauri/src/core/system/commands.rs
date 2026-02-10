use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_llamacpp::cleanup_llama_processes;

use crate::core::app::commands::{
    default_data_folder_path, get_jan_data_folder_path, update_app_configuration,
};
use crate::core::app::models::AppConfiguration;
use crate::core::mcp::helpers::{stop_mcp_servers_with_context, ShutdownContext};
use crate::core::state::AppState;

// Helper function to write env vars to zshenv
fn write_env_to_zsh(
    zshenv_path: &str,
    env_vars: &[(String, String)],
    terminal_app: &str,
) -> Result<(), String> {
    let marker = "# Jan Local API Server - Claude Code Config";
    let new_entries: String = env_vars
        .iter()
        .map(|(k, v)| format!("export {}='{}'", k, v))
        .collect();

    let existing_content = std::fs::read_to_string(zshenv_path).unwrap_or_default();
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
    std::fs::write(zshenv_path, &final_content).map_err(|e| e.to_string())?;

    if terminal_app == "Terminal" {
        let script = r#"echo "Jan Local API Server: Env vars configured in ~/.zshenv"
echo "Please restart your terminal or run: source ~/.zshenv"
echo ""
echo "Then run: claude""#;

        std::process::Command::new("osascript")
            .arg("-e")
            .arg(&format!(
                r#"tell application "Terminal" to do script "{}""#,
                script.replace("\"", "\\\"")
            ))
            .spawn()
            .map_err(|e| e.to_string())?;
    }

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

        if data_folder.exists() {
            if let Err(e) = fs::remove_dir_all(&data_folder) {
                log::error!("Failed to remove data folder: {e}");
                return;
            }
        }

        // Recreate the data folder
        let _ = fs::create_dir_all(&data_folder).map_err(|e| e.to_string());

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
    // Export environment variables to ~/.zshenv (always sourced by zsh)

    if cfg!(target_os = "macos") {
        // On macOS, write to ~/.zshenv
        let home_dir = std::env::var("HOME").map_err(|e| e.to_string())?;
        let zshenv_path = format!("{}/.zshenv", home_dir);

        // Try direct write first
        match std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .open(&zshenv_path)
        {
            Ok(_) => {
                write_env_to_zsh(&zshenv_path, &env_vars, "Terminal")?;
                return Ok(());
            }
            Err(_) => {
                // Use admin privileges to write
                let home_dir = std::env::var("HOME").map_err(|e| e.to_string())?;
                let zshenv_path = format!("{}/.zshenv", home_dir);

                // Read and clean existing file
                let marker = "# Jan Local API Server - Claude Code Config";
                let existing_content = std::fs::read_to_string(&zshenv_path).unwrap_or_default();
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
                let temp_script_path = format!("{}/.jan_zshenv_update.sh", home_dir);
                std::fs::write(&temp_script_path, &final_content).map_err(|e| e.to_string())?;

                // Use admin privileges to move the temp file to .zshenv
                let script = format!(
                    r#"do shell script "cp '{}' '{}' && rm '{}' && echo 'Env vars written to ~/.zshenv'" with administrator privileges"#,
                    temp_script_path, zshenv_path, temp_script_path
                );

                std::process::Command::new("osascript")
                    .arg("-e")
                    .arg(&script)
                    .output()
                    .map_err(|e| e.to_string())?;

                log::info!("Env vars written to ~/.zshenv with admin privileges");
                return Ok(());
            }
        }
    } else if cfg!(target_os = "linux") {
        // On Linux, write to ~/.zshenv
        let home_dir = std::env::var("HOME").map_err(|e| e.to_string())?;
        let zshenv_path = format!("{}/.zshenv", home_dir);

        // Try to write to ~/.zshenv
        match std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .open(&zshenv_path)
        {
            Ok(_) => {
                write_env_to_zsh(&zshenv_path, &env_vars, "")?;
                return Ok(());
            }
            Err(_) => {
                // Return special message for frontend to show dialog
                let jan_config_dir = format!("{}/.config/jan", home_dir);
                let env_file = format!("{}/claude-code-env.zsh", jan_config_dir);
                return Err(format!("NEED_PERMISSION:{}", env_file));
            }
        }
    } else {
        // On Windows, write to a batch file
        let env_export: String = env_vars
            .iter()
            .map(|(k, v)| format!("set \"{}={}\"", k, v))
            .collect();

        let batch_content = format!(
            r#"@echo off
REM Jan Local API Server - Claude Code Config
{}

echo Run: claude
pause
"#,
            env_export
        );

        let batch_file = "C:\\Users\\Public\\claude_code_env.bat";
        std::fs::write(batch_file, &batch_content).map_err(|e| e.to_string())?;

        std::process::Command::new("cmd")
            .arg("/c")
            .arg("start")
            .arg("Claude Code")
            .arg("/K")
            .arg(format!("{} && claude", env_export))
            .spawn()
            .map_err(|e| e.to_string())?;

        log::info!("Env vars exported. Claude Code should now use them.");
        return Ok(());
    }
}
