use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime, State};
use tauri_plugin_llamacpp::cleanup_llama_processes;

use crate::core::app::commands::{
    default_data_folder_path, get_configuration_file_path, get_jan_data_folder_path,
    write_app_configuration,
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

/// Clear the WebKit/WRY webview profile (localStorage, cookies, IndexedDB,
/// updater state) stored in the bundle-id app-data dir (e.g. `jan.ai.app/`).
/// Distinct from the product-name data folder; only removed on explicit opt-in.
fn clear_webview_profile<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    data_folder: &std::path::Path,
) {
    let webview_dir = match crate::core::app::paths::app_data_dir_for(app_handle) {
        Ok(dir) => dir,
        Err(e) => {
            log::warn!("Cannot resolve webview profile dir: {e}");
            return;
        }
    };

    // Never touch the dir if it is the user's data folder or contains it.
    if webview_dir == data_folder || data_folder.starts_with(&webview_dir) {
        log::warn!(
            "Skipping webview clear: data folder lives inside {}",
            webview_dir.display()
        );
        return;
    }

    if !webview_dir.is_dir() || !is_safe_to_delete(&webview_dir) {
        return;
    }

    log::info!("Clearing webview profile: {}", webview_dir.display());
    if let Err(e) = fs::remove_dir_all(&webview_dir) {
        log::warn!(
            "Failed to clear webview profile {}: {e}",
            webview_dir.display()
        );
    }
}

const WEBDATA_RESET_SENTINEL: &str = ".pending-webdata-reset";

/// Flags describing what a pending reset should prune from webview localStorage.
/// Consumed by the frontend on next startup before stores hydrate.
#[derive(serde::Serialize, serde::Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct WebdataResetFlags {
    pub keep_app_data: bool,
    pub keep_models_and_configs: bool,
    pub clear_web_data: bool,
}

/// Sentinel lives in the app config dir (alongside settings.json), which
/// survives the data-folder wipe.
fn webdata_reset_sentinel_path<R: Runtime>(app_handle: &tauri::AppHandle<R>) -> Option<PathBuf> {
    get_configuration_file_path(app_handle.clone())
        .parent()
        .map(|dir| dir.join(WEBDATA_RESET_SENTINEL))
}

fn write_webdata_reset_sentinel<R: Runtime>(
    app_handle: &tauri::AppHandle<R>,
    keep_app_data: bool,
    keep_models_and_configs: bool,
    clear_web_data: bool,
) {
    let Some(path) = webdata_reset_sentinel_path(app_handle) else {
        return;
    };
    let flags = WebdataResetFlags {
        keep_app_data,
        keep_models_and_configs,
        clear_web_data,
    };
    match serde_json::to_string(&flags) {
        Ok(json) => {
            if let Err(e) = fs::write(&path, json) {
                log::warn!("Failed to write webdata reset sentinel: {e}");
            }
        }
        Err(e) => log::warn!("Failed to serialize webdata reset flags: {e}"),
    }
}

/// Read and remove the pending-reset sentinel. Returns the flags if one existed
/// so the frontend can prune the matching localStorage keys before hydration.
#[tauri::command]
pub fn take_pending_webdata_reset<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Option<WebdataResetFlags> {
    let path = webdata_reset_sentinel_path(&app_handle)?;
    if !path.is_file() {
        return None;
    }
    let flags = fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str::<WebdataResetFlags>(&content).ok());
    if let Err(e) = fs::remove_file(&path) {
        log::warn!("Failed to remove webdata reset sentinel: {e}");
    }
    flags
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

/// Opening line of the block Jan writes into the user's shell profile.
const ENV_BLOCK_BEGIN: &str = "# >>> jan claude-code >>>";
/// Closing line of the block Jan writes into the user's shell profile.
const ENV_BLOCK_END: &str = "# <<< jan claude-code <<<";
/// The exact line older Jan versions wrote before and after the exported
/// variables. Every version that wrote to the profile used this marker pair.
const LEGACY_ENV_MARKER: &str = "# Jan Local API Server - Claude Code Config";
/// Prefix of the variables older Jan versions wrote inside the marker pair.
const LEGACY_ENV_PREFIX: &str = "export ANTHROPIC_";

/// Quote a value for a POSIX shell: wrap it in single quotes and turn every
/// embedded `'` into `'\''`. Nothing inside single quotes is expanded.
fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

/// AppleScript for the macOS admin fallback: copy `src` over `dst`, then remove
/// `src`, with administrator privileges. Each path is shell-quoted, and the
/// whole shell command is then escaped for the AppleScript string literal it is
/// embedded in (`\` and `"`), so a path is only ever a path.
fn admin_copy_applescript(src: &str, dst: &str) -> String {
    let shell = format!(
        "cp {} {} && rm {}",
        shell_single_quote(src),
        shell_single_quote(dst),
        shell_single_quote(src)
    );
    let escaped = shell.replace('\\', r"\\").replace('"', r#"\""#);
    format!(r#"do shell script "{escaped}" with administrator privileges"#)
}

fn is_valid_env_key(key: &str) -> bool {
    let mut chars = key.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Reject names and values that cannot be written as a single `export` line.
fn validate_env_vars(env_vars: &[(String, String)]) -> Result<(), String> {
    for (key, value) in env_vars {
        if !is_valid_env_key(key) {
            return Err(format!(
                "Invalid environment variable name {:?}: use only letters, digits and \
                 underscores, and do not start with a digit.",
                key
            ));
        }
        if value.contains(['\n', '\r', '\0']) {
            return Err(format!(
                "The value for {} contains a line break or NUL character, which cannot be \
                 written to a shell profile.",
                key
            ));
        }
    }
    Ok(())
}

/// Render the marked block of `export` lines Jan owns in the shell profile.
fn render_env_block(env_vars: &[(String, String)]) -> Result<String, String> {
    validate_env_vars(env_vars)?;
    let mut block = String::new();
    block.push_str(ENV_BLOCK_BEGIN);
    block.push('\n');
    for (key, value) in env_vars {
        block.push_str(&format!("export {}={}\n", key, shell_single_quote(value)));
    }
    block.push_str(ENV_BLOCK_END);
    block.push('\n');
    Ok(block)
}

/// Index of the first line after `start` that satisfies `is_end`.
fn find_closing_line(lines: &[&str], start: usize, is_end: impl Fn(&str) -> bool) -> Option<usize> {
    lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find(|(_, l)| is_end(l))
        .map(|(i, _)| i)
}

/// Remove everything Jan wrote to a shell profile and keep the user's own
/// lines. Removes the marked block as a whole and legacy blocks between a pair
/// of `LEGACY_ENV_MARKER` lines as a whole. Lines outside those blocks are the
/// user's, including their own `export ANTHROPIC_` lines. Returns "" or content
/// ending in one newline.
fn strip_jan_env_lines(content: &str) -> String {
    let lines: Vec<&str> = content.split('\n').collect();
    let mut kept: Vec<&str> = Vec::with_capacity(lines.len());
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim_end();
        if trimmed == ENV_BLOCK_BEGIN {
            match find_closing_line(&lines, i, |l| l.trim_end() == ENV_BLOCK_END) {
                Some(end) => i = end + 1,
                None => i += 1,
            }
            continue;
        }
        if trimmed == ENV_BLOCK_END {
            i += 1;
            continue;
        }
        // Older versions appended the opening marker without first ending the
        // file's last line, so it can trail one of the user's lines.
        if let Some(prefix) = trimmed.strip_suffix(LEGACY_ENV_MARKER) {
            if !prefix.is_empty() {
                kept.push(prefix);
            }
            match find_closing_line(&lines, i, |l| l.trim_end() == LEGACY_ENV_MARKER) {
                Some(end) => i = end + 1,
                None => {
                    // No closing line: drop only the exports Jan wrote right
                    // after the marker, and a closing marker that later text
                    // was appended to (the admin path wrote it without a
                    // trailing newline).
                    i += 1;
                    while i < lines.len() && lines[i].starts_with(LEGACY_ENV_PREFIX) {
                        i += 1;
                    }
                    if let Some(rest) = lines.get(i).and_then(|l| l.strip_prefix(LEGACY_ENV_MARKER))
                    {
                        if !rest.trim().is_empty() {
                            kept.push(rest);
                        }
                        i += 1;
                    }
                }
            }
            continue;
        }
        kept.push(line);
        i += 1;
    }
    let joined = kept.join("\n");
    let trimmed = joined.trim_end();
    if trimmed.is_empty() {
        String::new()
    } else {
        format!("{}\n", trimmed)
    }
}

/// Full new profile content: the user's lines plus Jan's block at the end.
fn build_env_file_content(existing: &str, env_vars: &[(String, String)]) -> Result<String, String> {
    let block = render_env_block(env_vars)?;
    let base = strip_jan_env_lines(existing);
    if base.is_empty() {
        Ok(block)
    } else {
        Ok(format!("{}\n{}", base, block))
    }
}

/// Current content of a shell profile, or "" when it does not exist yet. Any
/// other read error is returned: rewriting a profile Jan could not read would
/// replace the user's lines with Jan's block alone.
fn read_shell_profile(env_file_path: &str) -> Result<String, String> {
    match std::fs::read_to_string(env_file_path) {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("Could not read {}: {}", env_file_path, e)),
    }
}

/// macOS fallback for a profile Jan cannot write directly: copy `content`
/// over `env_file_path` with administrator privileges, via `temp_path`. A
/// cancelled password prompt is returned as an error.
fn admin_write_shell_profile(
    temp_path: &str,
    env_file_path: &str,
    content: &str,
) -> Result<(), String> {
    write_via_temp_file(temp_path, content, || {
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg(admin_copy_applescript(temp_path, env_file_path))
            .output()
            .map_err(|e| e.to_string())?;
        check_admin_copy(&output, env_file_path)
    })
}

/// Turn the osascript result of the admin copy into an error when it failed,
/// e.g. because the user cancelled the password prompt.
fn check_admin_copy(output: &std::process::Output, env_file_path: &str) -> Result<(), String> {
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Could not update {} with administrator privileges: {}",
            env_file_path,
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

/// Write `content` to `temp_path`, readable by the user only (it can hold the
/// API token), run `copy`, and remove `temp_path` whether or not it worked.
fn write_via_temp_file(
    temp_path: &str,
    content: &str,
    copy: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    // A leftover file may have other permissions; start from a fresh one.
    let _ = std::fs::remove_file(temp_path);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = options
        .open(temp_path)
        .and_then(|mut file| std::io::Write::write_all(&mut file, content.as_bytes()))
        .map_err(|e| e.to_string())
        .and_then(|()| copy());
    let _ = std::fs::remove_file(temp_path);
    result
}

// Helper function to write env vars to a shell config file
fn write_env_to_shell(env_file_path: &str, env_vars: &[(String, String)]) -> Result<(), String> {
    let existing_content = read_shell_profile(env_file_path)?;
    let final_content = build_env_file_content(&existing_content, env_vars)?;
    std::fs::write(env_file_path, &final_content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn factory_reset<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    keep_app_data: Option<bool>,
    keep_models_and_configs: Option<bool>,
    clear_web_data: Option<bool>,
) {
    let keep_app_data = keep_app_data.unwrap_or(false);
    let keep_models_and_configs = keep_models_and_configs.unwrap_or(false);
    let clear_web_data = clear_web_data.unwrap_or(false);

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
        "Factory reset (keep_app_data={}, keep_models_and_configs={}, clear_web_data={}), data folder: {:?}",
        keep_app_data,
        keep_models_and_configs,
        clear_web_data,
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
            let default_config = AppConfiguration {
                data_folder: default_data_folder_path(app_handle.clone()),
            };
            let _ = write_app_configuration(app_handle.clone(), default_config);
        }

        // Persisted UI state (model-provider, setup flag) lives in webview
        // localStorage, not the data folder. Renderer-side removal races the
        // restart flush, and the on-disk localStorage location is
        // platform-specific (esp. macOS WKWebView), so instead drop a sentinel
        // that the frontend consumes on next startup to clear localStorage via
        // the webview API before stores hydrate. File-level profile deletion
        // (Linux cookies/cache) stays as a best-effort supplement.
        let full_wipe = !keep_app_data && !keep_models_and_configs;
        if !keep_app_data || !keep_models_and_configs || clear_web_data {
            write_webdata_reset_sentinel(
                &app_handle,
                keep_app_data,
                keep_models_and_configs,
                clear_web_data,
            );
        }
        if clear_web_data || full_wipe {
            clear_webview_profile(&app_handle, &data_folder);
        }

        app_handle.restart();
    });
}

#[tauri::command]
pub fn relaunch<R: Runtime>(app: AppHandle<R>) {
    app.restart()
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
    let env_vars = build_claude_code_env_vars(
        api_url,
        api_key,
        big_model,
        medium_model,
        small_model,
        custom_env_vars,
    )?;

    // Claude Code talks to Jan's local API server, which authenticates inbound
    // requests against its own key (the proxy_api_key). ANTHROPIC_AUTH_TOKEN
    // MUST therefore be the local server key, and there is no valid placeholder:
    // anything else reaches the proxy, passes its key check, and then gets
    // rejected by the remote provider as a bogus credential (an opaque 403).
    // Refuse to launch with a clear message rather than ship a fake key.
    write_claude_code_env_vars(&env_vars)
}

/// Build the environment variable map for the Claude Code integration.
/// Returns an error if no local API key is set, since the proxy will not
/// authenticate the session otherwise.
fn build_claude_code_env_vars(
    api_url: String,
    api_key: Option<String>,
    big_model: Option<String>,
    medium_model: Option<String>,
    small_model: Option<String>,
    custom_env_vars: Vec<serde_json::Value>,
) -> Result<Vec<(String, String)>, String> {
    let token = api_key
        .filter(|k| !k.trim().is_empty())
        .ok_or_else(|| {
            "No local API key is set. Open Settings > Local API Server, set an API key, \
             and try again: Claude Code needs a real key to authenticate with the local \
             server and reach remote models."
                .to_string()
        })?;

    let mut env_vars: Vec<(String, String)> = Vec::with_capacity(8);
    env_vars.push(("ANTHROPIC_BASE_URL".to_string(), api_url));
    env_vars.push(("ANTHROPIC_AUTH_TOKEN".to_string(), token));

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
            // An unfilled row in the custom env list; nothing to export.
            if key.is_empty() {
                continue;
            }
            env_vars.push((key.to_string(), value.to_string()));
        }
    }

    Ok(env_vars)
}

/// Persist the Claude Code environment variables to the user's shell config
/// (macOS/Linux) or the Windows registry, then return the result.
fn write_claude_code_env_vars(env_vars: &[(String, String)]) -> Result<(), String> {
    // The shell profile and the Windows registry both take the values
    // verbatim, so refuse names and values that cannot be stored safely.
    validate_env_vars(env_vars)?;

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
            .truncate(false)
            .open(&env_file_path)
        {
            Ok(_) => {
                write_env_to_shell(&env_file_path, env_vars)?;
                Ok(())
            }
            Err(_) => {
                // Use admin privileges to write
                let existing_content = read_shell_profile(&env_file_path)?;
                let final_content = build_env_file_content(&existing_content, env_vars)?;
                let temp_script_path = format!("{}/.jan_env_update.sh", home_dir);
                admin_write_shell_profile(&temp_script_path, &env_file_path, &final_content)?;

                log::info!(
                    "Env vars written to {} with admin privileges",
                    env_file_path
                );
                Ok(())
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
            .truncate(false)
            .open(&env_file_path)
        {
            Ok(_) => {
                write_env_to_shell(&env_file_path, env_vars)?;
                Ok(())
            }
            Err(_) => {
                let jan_config_dir = format!("{}/.config/jan", home_dir);
                let ext = if shell_name == "bash" { "bash" } else { "zsh" };
                let env_file = format!("{}/claude-code-env.{}", jan_config_dir, ext);
                Err(format!("NEED_PERMISSION:{}", env_file))
            }
        }
    } else {
        // On Windows, set persistent user environment variables using setx
        for (key, value) in env_vars {
            let output = std::process::Command::new(jan_utils::windows_system_tool("setx.exe"))
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
        Ok(())
    }
}

/// Build the cleaned shell-file content with all Jan CC env vars stripped out.
fn build_cleaned_env_content(env_file_path: &str) -> Result<String, String> {
    let existing_content = read_shell_profile(env_file_path)?;
    Ok(strip_jan_env_lines(&existing_content))
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

        let cleaned = build_cleaned_env_content(&env_file_path)?;

        match std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .open(&env_file_path)
        {
            Ok(_) => {
                std::fs::write(&env_file_path, &cleaned).map_err(|e| e.to_string())?;
                Ok(())
            }
            Err(_) => {
                let temp_path = format!("{}/.jan_env_clear.sh", home_dir);
                admin_write_shell_profile(&temp_path, &env_file_path, &cleaned)?;

                log::info!(
                    "CC env cleared from {} with admin privileges",
                    env_file_path
                );
                Ok(())
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

        let cleaned = build_cleaned_env_content(&env_file_path)?;

        match std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
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
            let _ = std::process::Command::new(jan_utils::windows_system_tool("reg.exe"))
                .args(["delete", "HKCU\\Environment", "/v", key, "/f"])
                .output();
        }
        log::info!("CC env vars removed from Windows registry.");
        Ok(())
    }
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
        assert!(d.join("settings.json").exists());
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
        assert!(d.join("settings.json").exists());
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
        assert!(d.join("settings.json").exists());
        assert!(d.join("mcp_config.json").exists());
    }

    #[test]
    fn test_delete_settings_only_removes_settings_json() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        delete_settings(d);

        assert!(!d.join("settings.json").exists());
        assert!(exists_all(d, JAN_DATA_DIRS_CONVERSATIONS));
        assert!(exists_all(d, JAN_DATA_DIRS_MODELS));
        assert!(exists_all(d, JAN_DATA_DIRS_COMMON));
        assert!(d.join("mcp_config.json").exists());
    }

    #[test]
    fn test_settings_json_survives_when_keeping_any_category() {
        // Simulate: keep_app_data=true, keep_models_and_configs=false
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        delete_common_data(d);
        delete_models_and_configs(d);
        // settings.json should NOT be deleted because keep_app_data=true
        assert!(d.join("settings.json").exists());

        // Simulate: keep_app_data=false, keep_models_and_configs=true
        let tmp2 = tempdir().unwrap();
        let d2 = tmp2.path();
        create_all_data(d2);

        delete_common_data(d2);
        delete_conversations(d2);
        // settings.json should NOT be deleted because keep_models_and_configs=true
        assert!(d2.join("settings.json").exists());
    }

    #[test]
    fn test_full_wipe_deletes_settings_json() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        delete_common_data(d);
        delete_conversations(d);
        delete_models_and_configs(d);
        delete_settings(d);

        assert!(!d.join("settings.json").exists());
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
    #[test]
    fn claude_code_env_uses_real_token_when_set() {
        let env = build_claude_code_env_vars(
            "http://127.0.0.1:1337".to_string(),
            Some("sk-real-secret".to_string()),
            None,
            None,
            None,
            vec![],
        )
        .unwrap();
        let token = env
            .iter()
            .find(|(k, _)| k == "ANTHROPIC_AUTH_TOKEN")
            .map(|(_, v)| v.as_str())
            .unwrap();
        assert_eq!(token, "sk-real-secret");
        assert!(env
            .iter()
            .all(|(_, v)| v != "jan"),
            "placeholder must never be shipped as a token");
    }

    #[test]
    fn claude_code_env_rejects_missing_key() {
        let err = build_claude_code_env_vars(
            "http://127.0.0.1:1337".to_string(),
            None,
            None,
            None,
            None,
            vec![],
        )
        .unwrap_err();
        assert!(
            err.contains("API key"),
            "should tell the user a local API key is required: {err}"
        );
    }

    #[test]
    fn claude_code_env_rejects_blank_key() {
        let err = build_claude_code_env_vars(
            "http://127.0.0.1:1337".to_string(),
            Some("   ".to_string()),
            None,
            None,
            None,
            vec![],
        )
        .unwrap_err();
        assert!(
            err.contains("API key"),
            "a whitespace-only key is not a real credential: {err}"
        );
    }

    fn kv(k: &str, v: &str) -> (String, String) {
        (k.to_string(), v.to_string())
    }

    #[test]
    fn shell_quote_escapes_single_quotes() {
        assert_eq!(shell_single_quote("plain"), "'plain'");
        assert_eq!(shell_single_quote("a'b"), r"'a'\''b'");
        assert_eq!(shell_single_quote(""), "''");
    }

    #[test]
    fn admin_copy_applescript_quotes_plain_paths() {
        assert_eq!(
            admin_copy_applescript("/Users/a/.tmp", "/Users/a/.zshrc"),
            r#"do shell script "cp '/Users/a/.tmp' '/Users/a/.zshrc' && rm '/Users/a/.tmp'" with administrator privileges"#
        );
    }

    #[test]
    fn admin_copy_applescript_escapes_quotes_and_backslashes() {
        // A home path holding `'`, `"` and `\`: shell-quoted first, then escaped
        // for the AppleScript string, so `'\''` becomes `'\\''` and `"` becomes `\"`.
        let script = admin_copy_applescript(r#"/Users/o'b"c\d/.tmp"#, "/x");
        assert_eq!(
            script,
            r#"do shell script "cp '/Users/o'\\''b\"c\\d/.tmp' '/x' && rm '/Users/o'\\''b\"c\\d/.tmp'" with administrator privileges"#
        );
    }

    #[test]
    fn env_block_quotes_a_value_that_closes_the_quote() {
        let block =
            render_env_block(&[kv("ANTHROPIC_DEFAULT_OPUS_MODEL", "x'; touch /tmp/x; #")]).unwrap();
        assert!(block.contains(r"export ANTHROPIC_DEFAULT_OPUS_MODEL='x'\''; touch /tmp/x; #'"));
        assert!(block.starts_with(ENV_BLOCK_BEGIN));
        assert!(block.trim_end().ends_with(ENV_BLOCK_END));
    }

    #[test]
    fn env_rejects_line_breaks_and_nul_in_values() {
        for bad in ["a\nexport X=1", "a\rb", "a\0b"] {
            let err = render_env_block(&[kv("ANTHROPIC_DEFAULT_OPUS_MODEL", bad)]).unwrap_err();
            assert!(err.contains("ANTHROPIC_DEFAULT_OPUS_MODEL"), "{err}");
            assert!(validate_env_vars(&[kv("K", bad)]).is_err());
        }
    }

    #[test]
    fn env_rejects_bad_keys() {
        for bad in [
            "",
            "1ABC",
            "A-B",
            "A B",
            "A;touch x",
            "A=B",
            "A\nB",
            "\u{c9}",
        ] {
            assert!(
                validate_env_vars(&[kv(bad, "v")]).is_err(),
                "{bad:?} accepted"
            );
        }
        for good in ["A", "_A", "a_b9", "ANTHROPIC_BASE_URL"] {
            assert!(
                validate_env_vars(&[kv(good, "v")]).is_ok(),
                "{good:?} rejected"
            );
        }
    }

    #[test]
    fn env_write_with_invalid_input_leaves_file_untouched() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".zshenv");
        fs::write(&path, "export PATH=\"$HOME/bin:$PATH\"\n").unwrap();
        let p = path.to_str().unwrap();
        assert!(write_env_to_shell(p, &[kv("BAD KEY", "v")]).is_err());
        assert!(write_env_to_shell(p, &[kv("K", "a\nb")]).is_err());
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "export PATH=\"$HOME/bin:$PATH\"\n"
        );
    }

    #[test]
    fn claude_code_env_skips_blank_custom_rows() {
        let env = build_claude_code_env_vars(
            "http://127.0.0.1:1337".to_string(),
            Some("k".to_string()),
            None,
            None,
            None,
            vec![
                serde_json::json!({"key": "", "value": ""}),
                serde_json::json!({"key": "MY_VAR", "value": "1"}),
            ],
        )
        .unwrap();
        assert!(env.iter().all(|(k, _)| !k.is_empty()));
        assert!(env.iter().any(|(k, v)| k == "MY_VAR" && v == "1"));
    }

    #[test]
    fn env_write_then_reset_preserves_user_lines_and_removes_jan_lines() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".zshenv");
        let user = "# my settings\nexport PATH=\"$HOME/bin:$PATH\"\nalias ll='ls -l'\n";
        fs::write(&path, user).unwrap();
        let p = path.to_str().unwrap();

        let vars = vec![
            kv("ANTHROPIC_BASE_URL", "http://127.0.0.1:1337"),
            kv("ANTHROPIC_AUTH_TOKEN", "sk-'quoted'"),
            kv("MY_CUSTOM_VAR", "x'; echo hi; #"),
        ];
        write_env_to_shell(p, &vars).unwrap();
        // Writing twice replaces the block instead of stacking it.
        write_env_to_shell(p, &vars).unwrap();
        let written = fs::read_to_string(&path).unwrap();
        assert!(written.starts_with(user));
        assert_eq!(written.matches(ENV_BLOCK_BEGIN).count(), 1);
        assert_eq!(written.matches(ENV_BLOCK_END).count(), 1);
        assert_eq!(written.matches("MY_CUSTOM_VAR").count(), 1);

        fs::write(&path, build_cleaned_env_content(p).unwrap()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), user);
    }

    #[test]
    fn env_reset_on_file_with_only_jan_block_leaves_it_empty() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".bashrc");
        let p = path.to_str().unwrap();
        write_env_to_shell(p, &[kv("ANTHROPIC_BASE_URL", "u")]).unwrap();
        assert_eq!(build_cleaned_env_content(p).unwrap(), "");
    }

    #[test]
    fn env_cleanup_removes_legacy_format_including_stray_lines() {
        // What older Jan versions wrote: a marker pair around unescaped
        // exports, where a newline in a value left an extra line behind and a
        // custom variable did not carry the ANTHROPIC_ prefix.
        let legacy = "export EDITOR=vim\n\
            # Jan Local API Server - Claude Code Config\n\
            export ANTHROPIC_BASE_URL='http://127.0.0.1:1337'\n\
            export ANTHROPIC_DEFAULT_OPUS_MODEL='m\n\
            touch /tmp/leftover'\n\
            export MY_CUSTOM_VAR='1'\n\
            \n\
            # Jan Local API Server - Claude Code Config\n\
            export AFTER=1\n";
        let cleaned = strip_jan_env_lines(legacy);
        assert_eq!(cleaned, "export EDITOR=vim\nexport AFTER=1\n");

        // Upgrading writes the new block and drops the legacy one.
        let upgraded =
            build_env_file_content(legacy, &[kv("ANTHROPIC_BASE_URL", "http://h")]).unwrap();
        assert!(!upgraded.contains(LEGACY_ENV_MARKER));
        assert!(!upgraded.contains("leftover"));
        assert!(!upgraded.contains("MY_CUSTOM_VAR"));
        assert!(upgraded.starts_with("export EDITOR=vim\nexport AFTER=1\n"));
        assert_eq!(upgraded.matches("ANTHROPIC_BASE_URL").count(), 1);
    }

    #[test]
    fn env_cleanup_handles_unpaired_markers_without_eating_user_lines() {
        let content = "export A=1\n# Jan Local API Server - Claude Code Config\n\
            export ANTHROPIC_BASE_URL='x'\nexport B=2\n# >>> jan claude-code >>>\nexport C=3\n";
        assert_eq!(
            strip_jan_env_lines(content),
            "export A=1\nexport B=2\nexport C=3\n"
        );
    }

    #[test]
    fn env_cleanup_keeps_user_comment_that_shares_the_legacy_prefix() {
        let content = "# Jan Local API Server notes: port 1337\n\
            export KEEP_ME=1\n\
            # Jan Local API Server - Claude Code Config\n\
            export ANTHROPIC_BASE_URL='http://127.0.0.1:1337'\n\
            # Jan Local API Server - Claude Code Config\n\
            export AFTER=1\n";
        assert_eq!(
            strip_jan_env_lines(content),
            "# Jan Local API Server notes: port 1337\nexport KEEP_ME=1\nexport AFTER=1\n"
        );
    }

    #[test]
    fn env_write_and_reset_keep_the_users_own_anthropic_exports() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".zshenv");
        let user = "export ANTHROPIC_API_KEY='mine'\nexport ANTHROPIC_MODEL=x\n";
        fs::write(&path, user).unwrap();
        let p = path.to_str().unwrap();

        write_env_to_shell(p, &[kv("ANTHROPIC_BASE_URL", "http://h")]).unwrap();
        assert!(fs::read_to_string(&path).unwrap().starts_with(user));

        fs::write(&path, build_cleaned_env_content(p).unwrap()).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), user);
    }

    #[test]
    fn env_cleanup_removes_each_historical_legacy_format() {
        let m = LEGACY_ENV_MARKER;
        // First release: the exports were joined without newlines.
        let joined = format!(
            "export A=1\n{m}\nexport ANTHROPIC_BASE_URL='u'export ANTHROPIC_API_KEY='k'\n{m}\n"
        );
        assert_eq!(strip_jan_env_lines(&joined), "export A=1\n");
        // Admin fallback: closing marker written without a trailing newline.
        let admin = format!("export A=1\n\n{m}\nexport ANTHROPIC_BASE_URL='u'\n{m}");
        assert_eq!(strip_jan_env_lines(&admin), "export A=1\n");
        // Profile that did not end in a newline: the opening marker trails the
        // user's last line.
        let glued_open = format!("export A=1{m}\nexport ANTHROPIC_BASE_URL='u'\n{m}\n");
        assert_eq!(strip_jan_env_lines(&glued_open), "export A=1\n");
        // Text appended after an admin-written block lands on the closing line.
        let glued_close =
            format!("{m}\nexport ANTHROPIC_AUTH_TOKEN='t'\n{m}export B=2\nexport C=3\n");
        assert_eq!(
            strip_jan_env_lines(&glued_close),
            "export B=2\nexport C=3\n"
        );
    }

    #[test]
    fn env_profile_read_errors_are_returned_except_not_found() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join(".zshenv");
        assert_eq!(read_shell_profile(missing.to_str().unwrap()).unwrap(), "");

        // Not valid UTF-8: refuse instead of replacing it with Jan's block.
        let binary = dir.path().join(".bashrc");
        fs::write(&binary, b"export A=1 # caf\xe9\n").unwrap();
        let p = binary.to_str().unwrap();
        assert!(write_env_to_shell(p, &[kv("ANTHROPIC_BASE_URL", "u")]).is_err());
        assert!(build_cleaned_env_content(p).is_err());
        assert_eq!(fs::read(&binary).unwrap(), b"export A=1 # caf\xe9\n");
    }

    #[cfg(unix)]
    #[test]
    fn env_temp_file_is_private_and_always_removed() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let temp = dir.path().join(".jan_env_update.sh");
        let t = temp.to_str().unwrap();
        for copy_ok in [true, false] {
            // A stale file from an earlier run is replaced, not reused.
            fs::write(&temp, "stale").unwrap();
            fs::set_permissions(&temp, fs::Permissions::from_mode(0o644)).unwrap();
            let result = write_via_temp_file(t, "export ANTHROPIC_AUTH_TOKEN='s'\n", || {
                let meta = fs::metadata(&temp).unwrap();
                assert_eq!(meta.permissions().mode() & 0o777, 0o600);
                assert_eq!(
                    fs::read_to_string(&temp).unwrap(),
                    "export ANTHROPIC_AUTH_TOKEN='s'\n"
                );
                if copy_ok {
                    Ok(())
                } else {
                    Err("cancelled".to_string())
                }
            });
            assert_eq!(result.is_ok(), copy_ok);
            assert!(!temp.exists());
        }
    }

    #[cfg(unix)]
    #[test]
    fn env_admin_copy_failure_is_an_error() {
        let run = |script: &str| {
            std::process::Command::new("sh")
                .arg("-c")
                .arg(script)
                .output()
                .unwrap()
        };
        assert!(check_admin_copy(&run("exit 0"), "/p").is_ok());
        let err =
            check_admin_copy(&run("echo 'User canceled. (-128)' >&2; exit 1"), "/p").unwrap_err();
        assert!(err.contains("User canceled"), "{err}");
    }

    #[cfg(unix)]
    #[test]
    fn env_file_sources_to_the_literal_values() {
        let dir = tempdir().unwrap();
        let home = dir.path();
        let path = home.join(".zshenv");
        let canary = home.join("canary");
        let hostile = [
            format!("x'; touch '{}'; #", canary.display()),
            format!("$(touch {})", canary.display()),
            format!("`touch {}`", canary.display()),
            "a\\b \"c\" $HOME ''' end".to_string(),
            String::new(),
        ];
        for value in &hostile {
            write_env_to_shell(path.to_str().unwrap(), &[kv("JAN_TEST_VAR", value)]).unwrap();
            let out = std::process::Command::new("sh")
                .arg("-c")
                .arg(". \"$1\" && printf '%s' \"$JAN_TEST_VAR\"")
                .arg("sh")
                .arg(&path)
                .env_clear()
                .env("HOME", home)
                .env("PATH", "/usr/bin:/bin")
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "{}",
                String::from_utf8_lossy(&out.stderr)
            );
            assert_eq!(String::from_utf8(out.stdout).unwrap(), *value);
            assert!(!canary.exists(), "value {value:?} ran a command");
        }
    }
}
