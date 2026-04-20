use std::path::PathBuf;
use std::time::Duration;
use tauri::{Emitter, Runtime};
use tokio::io::{AsyncBufReadExt, BufReader};

const OPENCLAW_INSTALL_PROGRESS_EVENT: &str = "openclaw-install-progress";
const OPENCLAW_GATEWAY_PORT: u16 = 18789;
const GATEWAY_READY_EVENT: &str = "openclaw-gateway-ready";

fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    format!("Error: {e}")
}

/// Returns the home directory path.
fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "Unable to determine home directory".to_string())
}

/// Returns the path to the OpenClaw config directory.
fn openclaw_config_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".openclaw"))
}

/// Returns the path to the OpenClaw config file.
fn openclaw_config_path() -> Result<PathBuf, String> {
    Ok(openclaw_config_dir()?.join("openclaw.json"))
}

/// Looks for `openclaw` (or `clawdbot` / `openclaw.cmd`) on PATH.
fn find_openclaw_binary() -> Option<String> {
    let names = ["openclaw", "clawdbot", "openclaw.cmd", "clawdbot.cmd"];
    for name in &names {
        if let Ok(path) = which::which(name) {
            return Some(path.to_string_lossy().to_string());
        }
    }
    None
}

/// Check whether OpenClaw binary is installed.
#[tauri::command]
pub fn check_openclaw_installed() -> Option<String> {
    find_openclaw_binary()
}

/// Probe whether the OpenClaw gateway is accepting connections.
#[tauri::command]
pub async fn get_openclaw_status() -> Result<OpenClawStatus, String> {
    let addr = format!("127.0.0.1:{}", OPENCLAW_GATEWAY_PORT);
    let running = tokio::net::TcpStream::connect(&addr)
        .await
        .is_ok();

    Ok(OpenClawStatus {
        running,
        gateway_url: if running {
            Some(format!("http://localhost:{}", OPENCLAW_GATEWAY_PORT))
        } else {
            None
        },
    })
}

#[derive(serde::Serialize, Clone)]
pub struct OpenClawStatus {
    pub running: bool,
    pub gateway_url: Option<String>,
}

/// Install OpenClaw globally via npm.
/// Emits progress events to the frontend.
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

    let npm = which::which("npm").map_err(|_| {
        "npm not found on PATH. Please install Node.js first.".to_string()
    })?;

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let mut child = tokio::process::Command::new(&npm)
            .args(["install", "-g", "openclaw@latest"])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
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
        let output = tokio::process::Command::new(&npm)
            .args(["install", "-g", "openclaw@latest"])
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
            "message": "OpenClaw 安装成功！"
        }),
    )
    .ok();

    log::info!("OpenClaw installed successfully");
    Ok(())
}

/// Write the OpenClaw configuration file so that the gateway uses Ollama
/// as its sole provider and binds to the selected model.
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

    // Ensure nested structure exists: models -> providers -> ollama
    if !config.contains_key("models") {
        config.insert("models".to_string(), serde_json::json!({}));
    }
    let models_section = config["models"].as_object_mut().unwrap();

    if !models_section.contains_key("providers") {
        models_section.insert("providers".to_string(), serde_json::json!({}));
    }
    let providers = models_section["providers"].as_object_mut().unwrap();

    providers.insert("ollama".to_string(), serde_json::json!({
        "api": "ollama",
        "apiKey": "ollama-local",
        "baseUrl": "http://127.0.0.1:11434",
        "models": [model_entry]
    }));

    // Set default agent model: agents -> defaults -> model -> primary
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

    model_cfg.insert("primary".to_string(), serde_json::Value::String(format!("ollama/{}", model)));

    let data = serde_json::to_string_pretty(&config).map_err(err_to_string)?;
    std::fs::write(&config_path, data).map_err(err_to_string)?;

    log::info!("OpenClaw config written to {:?} with model {}", config_path, model);
    Ok(())
}

/// Clear provider API keys from the environment so OpenClaw only uses Ollama.
fn openclaw_env() -> Vec<(String, String)> {
    let clear: std::collections::HashSet<&str> = [
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

    std::env::vars()
        .filter(|(k, _)| !clear.contains(k.as_str()))
        .collect()
}

/// Launch the OpenClaw gateway bound to the given Ollama model.
#[tauri::command]
pub async fn launch_openclaw_gateway<R: Runtime>(
    app: tauri::AppHandle<R>,
    model: String,
) -> Result<OpenClawLaunchResult, String> {
    log::info!("Launching OpenClaw gateway with model: {}", model);

    let bin = find_openclaw_binary()
        .ok_or_else(|| "OpenClaw is not installed. Please install it first.".to_string())?;

    // 1. Write config
    write_openclaw_config(&model)?;

    // 2. Check if gateway is already running and restart it
    let addr = format!("127.0.0.1:{}", OPENCLAW_GATEWAY_PORT);
    let already_running = tokio::net::TcpStream::connect(&addr).await.is_ok();

    if already_running {
        log::info!("OpenClaw gateway already running, restarting...");
        let _ = tokio::process::Command::new(&bin)
            .args(["daemon", "restart"])
            .envs(openclaw_env())
            .output()
            .await;

        // Wait for gateway to come back
        for _ in 0..40 {
            tokio::time::sleep(Duration::from_millis(250)).await;
            if tokio::net::TcpStream::connect(&addr).await.is_ok() {
                let gateway_url = format!("http://localhost:{}", OPENCLAW_GATEWAY_PORT);
                app.emit(
                    GATEWAY_READY_EVENT,
                    serde_json::json!({ "gateway_url": &gateway_url }),
                )
                .ok();
                return Ok(OpenClawLaunchResult { gateway_url });
            }
        }
        return Err("OpenClaw gateway did not come back after restart".to_string());
    }

    // 3. Start gateway as a background child process
    log::info!("Starting OpenClaw gateway...");
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let _child = tokio::process::Command::new(&bin)
            .args(["gateway", "run", "--force"])
            .envs(openclaw_env())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Failed to start OpenClaw gateway: {e}"))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _child = tokio::process::Command::new(&bin)
            .args(["gateway", "run", "--force"])
            .envs(openclaw_env())
            .spawn()
            .map_err(|e| format!("Failed to start OpenClaw gateway: {e}"))?;
    }

    // 4. Wait for port to open (up to 30s)
    for _ in 0..120 {
        tokio::time::sleep(Duration::from_millis(250)).await;
        if tokio::net::TcpStream::connect(&addr).await.is_ok() {
            let gateway_url = format!("http://localhost:{}", OPENCLAW_GATEWAY_PORT);
            app.emit(
                GATEWAY_READY_EVENT,
                serde_json::json!({ "gateway_url": &gateway_url }),
            )
            .ok();
            return Ok(OpenClawLaunchResult { gateway_url });
        }
    }

    Err("OpenClaw gateway did not start within 30 seconds".to_string())
}

#[derive(serde::Serialize)]
pub struct OpenClawLaunchResult {
    pub gateway_url: String,
}

/// Stop the OpenClaw gateway.
#[tauri::command]
pub async fn stop_openclaw_gateway() -> Result<(), String> {
    log::info!("Stopping OpenClaw gateway...");

    if let Some(bin) = find_openclaw_binary() {
        let output = tokio::process::Command::new(&bin)
            .args(["gateway", "stop"])
            .output()
            .await;

        match output {
            Ok(o) if o.status.success() => {
                log::info!("OpenClaw gateway stopped via CLI");
                return Ok(());
            }
            Ok(o) => {
                let stderr = String::from_utf8_lossy(&o.stderr);
                log::warn!("openclaw gateway stop returned error: {}", stderr);
            }
            Err(e) => {
                log::warn!("Failed to run openclaw gateway stop: {}", e);
            }
        }
    }

    // Fallback: try to kill any process listening on the gateway port
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = tokio::process::Command::new("cmd")
            .args([
                "/C",
                &format!(
                    "for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :{}') do taskkill /PID %a /F",
                    OPENCLAW_GATEWAY_PORT
                ),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .await;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = tokio::process::Command::new("pkill")
            .args(["-f", "openclaw gateway"])
            .output()
            .await;
    }

    Ok(())
}
