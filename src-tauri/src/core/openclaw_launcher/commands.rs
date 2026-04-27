use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Duration;

use serde_json::Value;
use tauri::{Emitter, Runtime};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

const OPENCLAW_INSTALL_PROGRESS_EVENT: &str = "openclaw-install-progress";
const OPENCLAW_GATEWAY_PORT: u16 = 18789;
const GATEWAY_READY_EVENT: &str = "openclaw-gateway-ready";
const DEFAULT_NPM_REGISTRY: &str = "https://registry.npmjs.org";
const TEMPORARY_CHINA_NPM_REGISTRY: &str = "https://registry.npmmirror.com";

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    format!("Error: {e}")
}

fn normalize_registry(value: &str) -> String {
    value.trim().trim_end_matches('/').to_ascii_lowercase()
}

fn is_default_npm_registry(registry: &str) -> bool {
    registry.is_empty()
        || registry == DEFAULT_NPM_REGISTRY
        || registry == "http://registry.npmjs.org"
}

fn is_known_domestic_npm_registry(registry: &str) -> bool {
    registry.contains("registry.npmmirror.com")
        || registry.contains("registry.npm.taobao.org")
        || registry.contains("registry.cnpmjs.org")
}

fn resolve_openclaw_install_registry(current_registry: Option<&str>) -> Option<&'static str> {
    let normalized = current_registry.map(normalize_registry).unwrap_or_default();
    if is_default_npm_registry(&normalized) {
        return Some(TEMPORARY_CHINA_NPM_REGISTRY);
    }

    if is_known_domestic_npm_registry(&normalized) {
        return None;
    }

    None
}

async fn get_npm_registry(npm: &std::path::Path) -> Option<String> {
    let mut command = Command::new(npm);
    command.args(["config", "get", "registry"]);
    apply_no_window(&mut command);

    match command.output().await {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if stdout.is_empty() || stdout.eq_ignore_ascii_case("undefined") {
                None
            } else {
                Some(stdout)
            }
        }
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            log::warn!(
                "Failed to read npm registry before OpenClaw install (status={}): {}",
                output.status,
                stderr
            );
            None
        }
        Err(error) => {
            log::warn!(
                "Failed to run `npm config get registry` before OpenClaw install: {}",
                error
            );
            None
        }
    }
}

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "Unable to determine home directory".to_string())
}

fn openclaw_config_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".openclaw"))
}

fn openclaw_config_path() -> Result<PathBuf, String> {
    Ok(openclaw_config_dir()?.join("openclaw.json"))
}

fn find_openclaw_binary() -> Option<String> {
    let names = ["openclaw", "clawdbot", "openclaw.cmd", "clawdbot.cmd"];
    for name in &names {
        if let Ok(path) = which::which(name) {
            return Some(path.to_string_lossy().to_string());
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn apply_no_window(command: &mut Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn apply_no_window(_command: &mut Command) {}

fn json_at_path<'a>(value: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    Some(current)
}

fn json_bool(value: &Value, path: &[&str]) -> Option<bool> {
    json_at_path(value, path)?.as_bool()
}

fn json_string(value: &Value, path: &[&str]) -> Option<String> {
    json_at_path(value, path)?.as_str().map(ToOwned::to_owned)
}

fn json_u16(value: &Value, path: &[&str]) -> Option<u16> {
    json_at_path(value, path)?
        .as_u64()
        .and_then(|port| u16::try_from(port).ok())
}

fn is_runtime_running(status: Option<&str>) -> bool {
    matches!(
        status,
        Some("running" | "starting" | "restarting" | "active")
    )
}

fn is_runtime_error(status: Option<&str>) -> bool {
    status.is_some_and(|value| {
        let normalized = value.to_ascii_lowercase();
        normalized.contains("error") || normalized.contains("fail")
    })
}

fn is_port_busy(port_status: Option<&str>) -> bool {
    !matches!(port_status, None | Some("free"))
}

fn gateway_url(bind_host: &str, port: u16) -> String {
    let host = match bind_host {
        "0.0.0.0" | "::" => "127.0.0.1",
        other => other,
    };
    format!("http://{host}:{port}/")
}

fn compute_health(rpc_ok: bool, runtime_status: Option<&str>, port_status: Option<&str>) -> String {
    if rpc_ok {
        "running".to_string()
    } else if is_runtime_error(runtime_status) {
        "error".to_string()
    } else if is_runtime_running(runtime_status) || is_port_busy(port_status) {
        "degraded".to_string()
    } else {
        "stopped".to_string()
    }
}

fn build_status_message(
    service_loaded: bool,
    health: &str,
    runtime_detail: Option<&str>,
    rpc_error: Option<&str>,
    config_valid: bool,
) -> Option<String> {
    if health == "running" {
        return None;
    }

    if !service_loaded {
        return Some("Gateway service missing.".to_string());
    }

    if !config_valid {
        return Some("OpenClaw configuration is invalid.".to_string());
    }

    if health == "degraded" {
        if let Some(error) = rpc_error {
            return Some(format!(
                "Gateway listener is up, but rpc is not ready yet: {error}"
            ));
        }
        if let Some(detail) = runtime_detail {
            return Some(detail.to_string());
        }
    }

    if health == "error" {
        if let Some(detail) = runtime_detail {
            return Some(detail.to_string());
        }
        if let Some(error) = rpc_error {
            return Some(error.to_string());
        }
    }

    runtime_detail.map(ToOwned::to_owned)
}

#[tauri::command]
pub fn check_openclaw_installed() -> Option<String> {
    find_openclaw_binary()
}

#[derive(serde::Serialize, Clone, Debug, PartialEq, Eq)]
pub struct OpenClawStatus {
    pub installed: bool,
    pub binary_path: Option<String>,
    pub version: Option<String>,
    pub gateway_url: Option<String>,
    pub gateway_port: u16,
    pub service_loaded: bool,
    pub service_label: Option<String>,
    pub service_runtime_status: Option<String>,
    pub service_runtime_detail: Option<String>,
    pub rpc_ok: bool,
    pub rpc_error: Option<String>,
    pub port_status: Option<String>,
    pub cli_config_exists: bool,
    pub daemon_config_exists: bool,
    pub config_valid: bool,
    pub health: String,
    pub message: Option<String>,
}

fn openclaw_not_installed_status() -> OpenClawStatus {
    OpenClawStatus {
        installed: false,
        binary_path: None,
        version: None,
        gateway_url: None,
        gateway_port: OPENCLAW_GATEWAY_PORT,
        service_loaded: false,
        service_label: None,
        service_runtime_status: None,
        service_runtime_detail: None,
        rpc_ok: false,
        rpc_error: None,
        port_status: None,
        cli_config_exists: false,
        daemon_config_exists: false,
        config_valid: true,
        health: "not-installed".to_string(),
        message: None,
    }
}

fn parse_gateway_status(
    json: &Value,
    binary_path: String,
    version: Option<String>,
) -> OpenClawStatus {
    let bind_host =
        json_string(json, &["gateway", "bindHost"]).unwrap_or_else(|| "127.0.0.1".to_string());
    let gateway_port = json_u16(json, &["gateway", "port"]).unwrap_or(OPENCLAW_GATEWAY_PORT);
    let service_loaded = json_bool(json, &["service", "loaded"]).unwrap_or(false);
    let service_runtime_status = json_string(json, &["service", "runtime", "status"]);
    let service_runtime_detail = json_string(json, &["service", "runtime", "detail"]);
    let rpc_ok = json_bool(json, &["rpc", "ok"]).unwrap_or(false);
    let rpc_error = json_string(json, &["rpc", "error"]);
    let port_status = json_string(json, &["port", "status"]);
    let cli_config_exists = json_bool(json, &["config", "cli", "exists"]).unwrap_or(false);
    let daemon_config_exists = json_bool(json, &["config", "daemon", "exists"]).unwrap_or(false);
    let cli_config_valid = json_bool(json, &["config", "cli", "valid"]).unwrap_or(true);
    let daemon_config_valid = json_bool(json, &["config", "daemon", "valid"]).unwrap_or(true);
    let config_valid = cli_config_valid && daemon_config_valid;
    let health = compute_health(
        rpc_ok,
        service_runtime_status.as_deref(),
        port_status.as_deref(),
    );
    let gateway_url = if rpc_ok
        || is_runtime_running(service_runtime_status.as_deref())
        || is_port_busy(port_status.as_deref())
    {
        Some(gateway_url(&bind_host, gateway_port))
    } else {
        None
    };
    let message = build_status_message(
        service_loaded,
        &health,
        service_runtime_detail.as_deref(),
        rpc_error.as_deref(),
        config_valid,
    );

    OpenClawStatus {
        installed: true,
        binary_path: Some(binary_path),
        version,
        gateway_url,
        gateway_port,
        service_loaded,
        service_label: json_string(json, &["service", "label"]),
        service_runtime_status,
        service_runtime_detail,
        rpc_ok,
        rpc_error,
        port_status,
        cli_config_exists,
        daemon_config_exists,
        config_valid,
        health,
        message,
    }
}

async fn openclaw_version(bin: &str) -> Option<String> {
    let mut command = Command::new(bin);
    command.arg("--version");
    apply_no_window(&mut command);
    let output = command.output().await.ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().next().map(|line| line.trim().to_string())
}

async fn run_openclaw_command(
    bin: &str,
    args: &[&str],
    envs: Option<&[(String, String)]>,
) -> Result<std::process::Output, String> {
    let mut command = Command::new(bin);
    command.args(args);
    if let Some(envs) = envs {
        command.envs(envs.iter().cloned());
    }
    apply_no_window(&mut command);
    let output = tokio::time::timeout(
        Duration::from_secs(20),
        command.output(),
    )
    .await
    .map_err(|_| format!("Timed out after 20s running openclaw {}", args.join(" ")))?
    .map_err(|e| format!("Failed to run openclaw {}: {e}", args.join(" ")))?;
    Ok(output)
}

fn command_error(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return stderr;
    }
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

async fn get_openclaw_status_inner() -> Result<OpenClawStatus, String> {
    let Some(bin) = find_openclaw_binary() else {
        return Ok(openclaw_not_installed_status());
    };

    let version = tokio::time::timeout(Duration::from_secs(10), openclaw_version(&bin))
        .await
        .unwrap_or(None);
    let output = run_openclaw_command(&bin, &["gateway", "status", "--json"], None).await?;
    if !output.status.success() {
        let detail = command_error(&output);
        return Err(format!("OpenClaw gateway status failed: {detail}"));
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|e| format!("OpenClaw gateway status returned invalid UTF-8: {e}"))?;
    let json: Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse OpenClaw gateway status JSON: {e}"))?;

    Ok(parse_gateway_status(&json, bin, version))
}

async fn wait_for_openclaw_status<F>(
    max_attempts: usize,
    predicate: F,
) -> Result<OpenClawStatus, String>
where
    F: Fn(&OpenClawStatus) -> bool,
{
    let mut last_status: Option<OpenClawStatus> = None;

    for _ in 0..max_attempts {
        let status = get_openclaw_status_inner().await?;
        if predicate(&status) {
            return Ok(status);
        }
        last_status = Some(status);
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    let detail = last_status
        .and_then(|status| status.message.or(status.service_runtime_detail))
        .unwrap_or_else(|| {
            "Timed out while waiting for OpenClaw state reconciliation.".to_string()
        });

    Err(detail)
}

#[tauri::command]
pub async fn get_openclaw_status() -> Result<OpenClawStatus, String> {
    get_openclaw_status_inner().await
}

#[tauri::command]
pub async fn install_openclaw<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    log::info!("Installing OpenClaw via npm...");

    app.emit(
        OPENCLAW_INSTALL_PROGRESS_EVENT,
        serde_json::json!({
            "status": "installing",
            "progress": 0.0,
            "message": "正在安装 OpenClaw，请稍候..."
        }),
    )
    .ok();

    let npm = which::which("npm")
        .map_err(|_| "npm not found on PATH. Please install Node.js first.".to_string())?;
    let current_registry = get_npm_registry(&npm).await;
    let temporary_registry = resolve_openclaw_install_registry(current_registry.as_deref());

    if let Some(registry) = temporary_registry {
        log::info!(
            "OpenClaw install will use temporary npm registry override: {} (detected current registry: {:?})",
            registry,
            current_registry
        );
        app.emit(
            OPENCLAW_INSTALL_PROGRESS_EVENT,
            serde_json::json!({
                "status": "installing",
                "progress": 8.0,
                "message": "检测到 npm 仍在使用默认源，本次安装将临时切换到国内镜像。"
            }),
        )
        .ok();
    } else {
        log::info!(
            "OpenClaw install will use existing npm registry: {:?}",
            current_registry
        );
    }

    #[cfg(target_os = "windows")]
    {
        let mut child = Command::new(&npm);
        child.args(["install", "-g", "openclaw@latest"]);
        if let Some(registry) = temporary_registry {
            child.env("npm_config_registry", registry);
            child.env("NPM_CONFIG_REGISTRY", registry);
        }
        child
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        apply_no_window(&mut child);

        let mut child = child
            .spawn()
            .map_err(|e| format!("Failed to spawn npm install: {e}"))?;

        if let Some(stdout) = child.stdout.take() {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                log::debug!("npm stdout: {}", line);
            }
        }

        let status = child
            .wait()
            .await
            .map_err(|e| format!("npm install process failed: {e}"))?;

        if !status.success() {
            return Err("npm install -g openclaw@latest failed".to_string());
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut command = Command::new(&npm);
        command.args(["install", "-g", "openclaw@latest"]);
        if let Some(registry) = temporary_registry {
            command.env("npm_config_registry", registry);
            command.env("NPM_CONFIG_REGISTRY", registry);
        }
        apply_no_window(&mut command);
        let output = command
            .output()
            .await
            .map_err(|e| format!("Failed to run npm install: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("npm install failed: {stderr}"));
        }
    }

    app.emit(
        OPENCLAW_INSTALL_PROGRESS_EVENT,
        serde_json::json!({
            "status": "completed",
            "progress": 100.0,
            "message": "OpenClaw 安装成功。"
        }),
    )
    .ok();

    log::info!("OpenClaw installed successfully");
    Ok(())
}

fn write_openclaw_config(model: &str) -> Result<(), String> {
    let config_dir = openclaw_config_dir()?;
    std::fs::create_dir_all(&config_dir).map_err(err_to_string)?;

    let config_path = openclaw_config_path()?;

    let mut config: serde_json::Map<String, serde_json::Value> = if config_path.exists() {
        let data = std::fs::read_to_string(&config_path).unwrap_or_default();
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        serde_json::Map::new()
    };

    let model_entry = serde_json::json!({
        "id": model,
        "name": model,
        "input": ["text"],
        "cost": {
            "input": 0,
            "output": 0,
            "cacheRead": 0,
            "cacheWrite": 0
        }
    });

    if !config.contains_key("models") {
        config.insert("models".to_string(), serde_json::json!({}));
    }
    let models_section = config["models"].as_object_mut().unwrap();

    if !models_section.contains_key("providers") {
        models_section.insert("providers".to_string(), serde_json::json!({}));
    }
    let providers = models_section["providers"].as_object_mut().unwrap();

    providers.insert(
        "ollama".to_string(),
        serde_json::json!({
            "api": "ollama",
            "apiKey": "ollama-local",
            "baseUrl": "http://127.0.0.1:11434",
            "models": [model_entry]
        }),
    );

    if !config.contains_key("agents") {
        config.insert("agents".to_string(), serde_json::json!({}));
    }
    let agents = config["agents"].as_object_mut().unwrap();

    if !agents.contains_key("defaults") {
        agents.insert("defaults".to_string(), serde_json::json!({}));
    }
    let defaults = agents["defaults"].as_object_mut().unwrap();

    if !defaults.contains_key("model") {
        defaults.insert("model".to_string(), serde_json::json!({}));
    }
    let model_cfg = defaults["model"].as_object_mut().unwrap();

    model_cfg.insert(
        "primary".to_string(),
        serde_json::Value::String(format!("ollama/{model}")),
    );

    let data = serde_json::to_string_pretty(&config).map_err(err_to_string)?;
    std::fs::write(&config_path, data).map_err(err_to_string)?;

    log::info!(
        "OpenClaw config written to {:?} with model {}",
        config_path,
        model
    );
    Ok(())
}

fn filtered_openclaw_env<I>(vars: I, inject_local_model: bool) -> Vec<(String, String)>
where
    I: IntoIterator<Item = (String, String)>,
{
    if !inject_local_model {
        return vars.into_iter().collect();
    }

    let clear: HashSet<&str> = [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_OAUTH_TOKEN",
        "OPENAI_API_KEY",
        "GEMINI_API_KEY",
        "MISTRAL_API_KEY",
        "GROQ_API_KEY",
        "XAI_API_KEY",
        "OPENROUTER_API_KEY",
    ]
    .iter()
    .copied()
    .collect();

    vars.into_iter()
        .filter(|(k, _)| !clear.contains(k.as_str()))
        .collect()
}

fn openclaw_env(inject_local_model: bool) -> Vec<(String, String)> {
    filtered_openclaw_env(std::env::vars(), inject_local_model)
}

async fn spawn_gateway_foreground(bin: &str, inject_local_model: bool) -> Result<(), String> {
    let mut command = Command::new(bin);
    command.args(["gateway", "run", "--force"]);
    command.envs(openclaw_env(inject_local_model));
    apply_no_window(&mut command);
    command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start OpenClaw gateway: {e}"))?;

    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                log::info!("[openclaw gateway stdout] {}", line);
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                log::warn!("[openclaw gateway stderr] {}", line);
            }
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn launch_openclaw_gateway<R: Runtime>(
    app: tauri::AppHandle<R>,
    model: Option<String>,
) -> Result<OpenClawLaunchResult, String> {
    let inject_local_model = model.as_ref().is_some_and(|value| !value.trim().is_empty());
    log::info!(
        "Launching OpenClaw gateway (inject_local_model={}, model={:?})",
        inject_local_model,
        model
    );

    let Some(bin) = find_openclaw_binary() else {
        return Err("OpenClaw is not installed. Please install it first.".to_string());
    };

    if let Some(model) = model.as_deref().filter(|value| !value.trim().is_empty()) {
        write_openclaw_config(model)?;
    }

    let current_status = get_openclaw_status_inner().await?;
    let expected_port = current_status.gateway_port;
    if current_status.service_loaded {
        let action = if current_status.rpc_ok
            || is_runtime_running(current_status.service_runtime_status.as_deref())
        {
            "restart"
        } else {
            "start"
        };

        let output = run_openclaw_command(
            &bin,
            &["gateway", action, "--json"],
            Some(&openclaw_env(inject_local_model)),
        )
        .await?;
        log::info!(
            "OpenClaw gateway {} stdout: {}",
            action,
            String::from_utf8_lossy(&output.stdout)
        );
        if !output.stderr.is_empty() {
            log::warn!(
                "OpenClaw gateway {} stderr: {}",
                action,
                String::from_utf8_lossy(&output.stderr)
            );
        }
    } else {
        if current_status.rpc_ok
            || is_runtime_running(current_status.service_runtime_status.as_deref())
            || is_port_busy(current_status.port_status.as_deref())
        {
            stop_openclaw_gateway().await?;
        }
        spawn_gateway_foreground(&bin, inject_local_model).await?;
    }

    // Wait for gateway readiness in background — don't block the command.
    // The frontend observes progress via get_openclaw_status polling and
    // the openclaw-gateway-ready event.
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        match wait_for_openclaw_status(60, |status| status.rpc_ok).await {
            Ok(final_status) => {
                let ready_url = final_status
                    .gateway_url
                    .clone()
                    .unwrap_or_else(|| gateway_url("127.0.0.1", expected_port));
                app_handle
                    .emit(
                        GATEWAY_READY_EVENT,
                        serde_json::json!({ "gateway_url": &ready_url }),
                    )
                    .ok();
                log::info!("OpenClaw gateway ready at {}", ready_url);
            }
            Err(e) => {
                log::warn!("OpenClaw gateway failed to become ready: {}", e);
            }
        }
    });

    // Return immediately with the expected gateway URL.
    Ok(OpenClawLaunchResult {
        gateway_url: gateway_url("127.0.0.1", expected_port),
    })
}

#[derive(serde::Serialize)]
pub struct OpenClawLaunchResult {
    pub gateway_url: String,
}

async fn kill_gateway_port_listener() {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("cmd");
        command.args([
            "/C",
            &format!(
                "for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :{}') do taskkill /PID %a /F",
                OPENCLAW_GATEWAY_PORT
            ),
        ]);
        apply_no_window(&mut command);
        let _ = command.output().await;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("pkill")
            .args(["-f", "openclaw gateway"])
            .output()
            .await;
    }
}

#[tauri::command]
pub async fn stop_openclaw_gateway() -> Result<(), String> {
    log::info!("Stopping OpenClaw gateway...");

    let current_status = get_openclaw_status_inner().await?;
    if !current_status.installed {
        return Ok(());
    }

    if let Some(bin) = current_status.binary_path.as_deref() {
        if current_status.service_loaded {
            let output = run_openclaw_command(bin, &["gateway", "stop", "--json"], None).await?;
            log::info!(
                "OpenClaw gateway stop stdout: {}",
                String::from_utf8_lossy(&output.stdout)
            );
            if !output.stderr.is_empty() {
                log::warn!(
                    "OpenClaw gateway stop stderr: {}",
                    String::from_utf8_lossy(&output.stderr)
                );
            }
        }
    }

    if current_status.rpc_ok
        || is_runtime_running(current_status.service_runtime_status.as_deref())
        || is_port_busy(current_status.port_status.as_deref())
    {
        kill_gateway_port_listener().await;
    }

    // Verify stop asynchronously — don't block the command.
    tokio::spawn(async move {
        match wait_for_openclaw_status(40, |status| {
            !status.rpc_ok
                && !is_runtime_running(status.service_runtime_status.as_deref())
                && !is_port_busy(status.port_status.as_deref())
        })
        .await
        {
            Ok(_) => log::info!("OpenClaw gateway stopped successfully"),
            Err(e) => log::warn!("OpenClaw gateway stop verification timeout: {}", e),
        }
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        filtered_openclaw_env, parse_gateway_status, resolve_openclaw_install_registry,
        TEMPORARY_CHINA_NPM_REGISTRY,
    };

    #[test]
    fn filtered_openclaw_env_preserves_remote_provider_keys_without_local_injection() {
        let env = vec![
            ("OPENAI_API_KEY".to_string(), "openai-key".to_string()),
            ("ANTHROPIC_API_KEY".to_string(), "anthropic-key".to_string()),
            ("PATH".to_string(), "C:\\bin".to_string()),
        ];

        assert_eq!(filtered_openclaw_env(env.clone(), false), env);
    }

    #[test]
    fn filtered_openclaw_env_removes_remote_provider_keys_for_local_injection() {
        let filtered = filtered_openclaw_env(
            vec![
                ("OPENAI_API_KEY".to_string(), "openai-key".to_string()),
                ("ANTHROPIC_API_KEY".to_string(), "anthropic-key".to_string()),
                ("PATH".to_string(), "C:\\bin".to_string()),
            ],
            true,
        );

        assert_eq!(filtered, vec![("PATH".to_string(), "C:\\bin".to_string())]);
    }

    #[test]
    fn parse_gateway_status_reports_stopped_when_service_is_missing() {
        let status = parse_gateway_status(
            &json!({
                "service": {
                    "label": "Scheduled Task",
                    "loaded": false,
                    "runtime": {
                        "status": "stopped",
                        "detail": "Gateway service missing."
                    }
                },
                "config": {
                    "cli": { "exists": false, "valid": true },
                    "daemon": { "exists": false, "valid": true }
                },
                "gateway": {
                    "bindHost": "127.0.0.1",
                    "port": 18789
                },
                "port": {
                    "status": "free"
                },
                "rpc": {
                    "ok": false,
                    "error": "connect ECONNREFUSED 127.0.0.1:18789"
                }
            }),
            "openclaw".to_string(),
            Some("OpenClaw 2026.4.24".to_string()),
        );

        assert_eq!(status.health, "stopped");
        assert!(!status.service_loaded);
        assert_eq!(status.gateway_url, None);
        assert_eq!(status.version.as_deref(), Some("OpenClaw 2026.4.24"));
    }

    #[test]
    fn parse_gateway_status_reports_degraded_when_rpc_is_down_but_listener_exists() {
        let status = parse_gateway_status(
            &json!({
                "service": {
                    "label": "Scheduled Task",
                    "loaded": true,
                    "runtime": {
                        "status": "running",
                        "detail": "Task is currently running."
                    }
                },
                "config": {
                    "cli": { "exists": true, "valid": true },
                    "daemon": { "exists": true, "valid": true }
                },
                "gateway": {
                    "bindHost": "127.0.0.1",
                    "port": 18789
                },
                "port": {
                    "status": "in-use"
                },
                "rpc": {
                    "ok": false,
                    "error": "handshake timeout"
                }
            }),
            "openclaw".to_string(),
            None,
        );

        assert_eq!(status.health, "degraded");
        assert_eq!(
            status.gateway_url.as_deref(),
            Some("http://127.0.0.1:18789/")
        );
        assert!(status
            .message
            .as_deref()
            .is_some_and(|message| message.contains("rpc")));
    }

    #[test]
    fn resolve_openclaw_install_registry_uses_temporary_mirror_for_default_npm_registry() {
        let decision = resolve_openclaw_install_registry(Some("https://registry.npmjs.org/"));

        assert_eq!(decision.as_deref(), Some(TEMPORARY_CHINA_NPM_REGISTRY));
    }

    #[test]
    fn resolve_openclaw_install_registry_keeps_existing_domestic_registry() {
        assert_eq!(
            resolve_openclaw_install_registry(Some("https://registry.npmmirror.com/")),
            None
        );
        assert_eq!(
            resolve_openclaw_install_registry(Some("https://registry.npm.taobao.org")),
            None
        );
    }

    #[test]
    fn resolve_openclaw_install_registry_keeps_custom_non_default_registry() {
        let decision = resolve_openclaw_install_registry(Some("https://packages.example.com/npm"));

        assert_eq!(decision, None);
    }

    #[test]
    fn resolve_openclaw_install_registry_uses_temporary_mirror_when_registry_is_empty() {
        let decision = resolve_openclaw_install_registry(Some("   "));

        assert_eq!(decision.as_deref(), Some(TEMPORARY_CHINA_NPM_REGISTRY));
    }

    #[test]
    fn resolve_openclaw_install_registry_uses_temporary_mirror_when_registry_is_unavailable() {
        let decision = resolve_openclaw_install_registry(None);

        assert_eq!(decision.as_deref(), Some(TEMPORARY_CHINA_NPM_REGISTRY));
    }
}
