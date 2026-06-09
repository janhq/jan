use std::{
    collections::HashMap,
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, OnceLock},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::ChildStdin,
    sync::{mpsc, Mutex},
};

use crate::core::app::commands::get_jan_data_folder_path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryProbeResult {
    pub found: bool,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointProbeResult {
    pub reachable: bool,
    pub status_code: Option<u16>,
    pub model_count: Option<usize>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioRuntimeProcess {
    pub runtime_id: String,
    pub pid: u32,
    pub model: Option<String>,
    pub base_url: String,
    pub log_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAppServerProcess {
    pub session_id: String,
    pub pid: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAppServerLinePayload {
    pub session_id: String,
    pub line: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAppServerExitPayload {
    pub session_id: String,
    pub code: Option<i32>,
    pub signal: Option<String>,
}

struct ManagedCodexAppServer {
    pid: u32,
    stdin: Arc<Mutex<ChildStdin>>,
    shutdown: mpsc::UnboundedSender<()>,
}

static CODEX_APP_SERVERS: OnceLock<Mutex<HashMap<String, ManagedCodexAppServer>>> = OnceLock::new();

fn codex_app_servers() -> &'static Mutex<HashMap<String, ManagedCodexAppServer>> {
    CODEX_APP_SERVERS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct StudioRuntimeStore {
    processes: Vec<StudioRuntimeProcess>,
}

fn studio_store_path<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    get_jan_data_folder_path(app.clone())
        .join("studio")
        .join("runtimes.json")
}

fn studio_logs_dir<R: Runtime>(app: &AppHandle<R>) -> PathBuf {
    get_jan_data_folder_path(app.clone())
        .join("studio")
        .join("logs")
}

fn read_store<R: Runtime>(app: &AppHandle<R>) -> StudioRuntimeStore {
    let path = studio_store_path(app);
    if !path.exists() {
        return StudioRuntimeStore::default();
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_store<R: Runtime>(app: &AppHandle<R>, store: &StudioRuntimeStore) -> Result<(), String> {
    let path = studio_store_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

fn binary_search_paths(binary: &str) -> Vec<String> {
    let mut paths = Vec::new();

    if let Ok(path_var) = std::env::var("PATH") {
        for dir in path_var.split(':') {
            if dir.is_empty() {
                continue;
            }
            paths.push(format!("{dir}/{binary}"));
        }
    }

    #[cfg(target_os = "macos")]
    {
        paths.push(format!("/opt/homebrew/bin/{binary}"));
        paths.push(format!("/usr/local/bin/{binary}"));
        if let Ok(home) = std::env::var("HOME") {
            paths.push(format!("{home}/.local/bin/{binary}"));
        }
        if binary == "ollama" {
            paths.push("/Applications/Ollama.app/Contents/Resources/ollama".to_string());
        }
    }

    #[cfg(windows)]
    {
        paths.push(format!("C:\\Program Files\\Ollama\\{binary}.exe"));
    }

    paths
}

fn probe_binary_sync(binary: &str) -> BinaryProbeResult {
    let which_cmd = if cfg!(windows) { "where" } else { "which" };
    let mut cmd = std::process::Command::new(which_cmd);
    cmd.arg(binary);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    if let Ok(out) = cmd.output() {
        if out.status.success() {
            let raw = String::from_utf8_lossy(&out.stdout);
            #[cfg(windows)]
            let path = raw
                .lines()
                .map(str::trim)
                .find(|p| !p.is_empty())
                .map(str::to_string);
            #[cfg(not(windows))]
            let path = {
                let trimmed = raw.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                }
            };

            if let Some(path) = path {
                return BinaryProbeResult {
                    found: true,
                    path: Some(path),
                };
            }
        }
    }

    for candidate in binary_search_paths(binary) {
        if std::path::Path::new(&candidate).is_file() {
            return BinaryProbeResult {
                found: true,
                path: Some(candidate),
            };
        }
    }

    BinaryProbeResult {
        found: false,
        path: None,
    }
}

fn is_codex_binary_command(command: &str) -> bool {
    let trimmed = command.trim().to_ascii_lowercase();
    let file_name = Path::new(&trimmed)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    let file_name = file_name.rsplit('\\').next().unwrap_or(file_name);
    file_name == "codex"
        || file_name == "codex.exe"
        || trimmed.ends_with("/codex.app/contents/resources/codex")
        || trimmed.ends_with("\\codex.app\\contents\\resources\\codex")
}

fn should_fallback_to_npx(command: &str, start_error: &std::io::Error, has_npx: bool) -> bool {
    is_codex_binary_command(command) && matches!(start_error.kind(), ErrorKind::NotFound) && has_npx
}

fn app_server_help_output_supports_stdio(stdout: &[u8], stderr: &[u8]) -> bool {
    let output = format!(
        "{}\n{}",
        String::from_utf8_lossy(stdout).to_ascii_lowercase(),
        String::from_utf8_lossy(stderr).to_ascii_lowercase()
    );
    output.contains("app-server") && output.contains("--stdio")
}

fn codex_binary_supports_app_server(command: &str) -> bool {
    if !is_codex_binary_command(command) {
        return true;
    }

    let Ok(output) = std::process::Command::new(command)
        .arg("app-server")
        .arg("--help")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
    else {
        return true;
    };

    app_server_help_output_supports_stdio(&output.stdout, &output.stderr)
}

fn requests_app_server_stdio(args: &[String]) -> bool {
    args.first()
        .map(|arg| arg == "app-server")
        .unwrap_or(false)
        && args.iter().any(|arg| arg == "--stdio")
}

fn process_is_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }

    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}")])
            .creation_flags(0x08000000)
            .output()
            .map(|out| {
                let text = String::from_utf8_lossy(&out.stdout);
                text.contains(&pid.to_string())
            })
            .unwrap_or(false)
    }
}

fn read_log_tail(path: &std::path::Path, max_lines: usize) -> String {
    let Ok(raw) = fs::read_to_string(path) else {
        return String::new();
    };
    let lines: Vec<&str> = raw.lines().collect();
    if lines.len() <= max_lines {
        return raw;
    }
    lines[lines.len() - max_lines..].join("\n")
}

fn probe_openai_endpoint_sync(base_url: &str, api_key: Option<String>) -> EndpointProbeResult {
    let base_url = normalize_base_url(base_url);
    let client = match reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(4))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return EndpointProbeResult {
                reachable: false,
                status_code: None,
                model_count: None,
                error: Some(error.to_string()),
            };
        }
    };

    let mut request = client
        .get(format!("{base_url}/models"))
        .header("Origin", "tauri://localhost");

    if let Some(key) = api_key.filter(|k| !k.trim().is_empty()) {
        request = request
            .header("Authorization", format!("Bearer {key}"))
            .header("x-api-key", key);
    }

    match request.send() {
        Ok(response) => {
            let status = response.status();
            if !status.is_success() {
                return EndpointProbeResult {
                    reachable: false,
                    status_code: Some(status.as_u16()),
                    model_count: None,
                    error: Some(format!("HTTP {}", status)),
                };
            }

            match response.json::<serde_json::Value>() {
                Ok(body) => EndpointProbeResult {
                    reachable: true,
                    status_code: Some(status.as_u16()),
                    model_count: Some(count_models_from_body(&body)),
                    error: None,
                },
                Err(error) => EndpointProbeResult {
                    reachable: true,
                    status_code: Some(status.as_u16()),
                    model_count: None,
                    error: Some(format!("Failed to parse models response: {error}")),
                },
            }
        }
        Err(error) => EndpointProbeResult {
            reachable: false,
            status_code: None,
            model_count: None,
            error: Some(error.to_string()),
        },
    }
}

fn normalize_base_url(base_url: &str) -> String {
    base_url.trim().trim_end_matches('/').to_string()
}

fn count_models_from_body(body: &serde_json::Value) -> usize {
    if let Some(data) = body.get("data").and_then(|v| v.as_array()) {
        return data.len();
    }
    if let Some(models) = body.get("models").and_then(|v| v.as_array()) {
        return models.len();
    }
    if body.is_array() {
        return body.as_array().map(|v| v.len()).unwrap_or(0);
    }
    0
}

#[tauri::command]
pub async fn probe_binary_on_path(binary: String) -> BinaryProbeResult {
    let binary = binary.trim().to_string();
    tokio::task::spawn_blocking(move || probe_binary_sync(&binary))
        .await
        .unwrap_or(BinaryProbeResult {
            found: false,
            path: None,
        })
}

#[tauri::command]
pub async fn probe_openai_endpoint(
    base_url: String,
    api_key: Option<String>,
) -> EndpointProbeResult {
    let base_url = normalize_base_url(&base_url);
    let api_key = api_key.filter(|k| !k.trim().is_empty());

    tokio::task::spawn_blocking(move || probe_openai_endpoint_sync(&base_url, api_key))
        .await
        .unwrap_or(EndpointProbeResult {
            reachable: false,
            status_code: None,
            model_count: None,
            error: Some("Probe task failed".to_string()),
        })
}

#[tauri::command]
pub async fn list_studio_runtime_processes<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<StudioRuntimeProcess>, String> {
    Ok(read_store(&app).processes)
}

#[tauri::command]
pub async fn spawn_studio_runtime<R: Runtime>(
    app: AppHandle<R>,
    runtime_id: String,
    model: String,
    base_url: String,
) -> Result<StudioRuntimeProcess, String> {
    let runtime_id = runtime_id.trim().to_lowercase();
    let model = model.trim().to_string();
    if model.is_empty() && runtime_id != "ollama" {
        return Err("Model name is required".to_string());
    }

    let binary = match runtime_id.as_str() {
        "vllm" => "vllm",
        "ollama" => "ollama",
        _ => return Err(format!("Unsupported runtime: {runtime_id}")),
    };

    let normalized_base_url = normalize_base_url(&base_url);
    let endpoint_probe = probe_openai_endpoint_sync(&normalized_base_url, Some("jan".to_string()));
    if endpoint_probe.reachable {
        let logs_dir = studio_logs_dir(&app);
        fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;
        let log_path = logs_dir.join(format!("{runtime_id}.log"));

        let process = StudioRuntimeProcess {
            runtime_id: runtime_id.clone(),
            pid: 0,
            model: if model.is_empty() { None } else { Some(model) },
            base_url: normalized_base_url,
            log_path: log_path.to_string_lossy().into_owned(),
        };

        let mut store = read_store(&app);
        store.processes.retain(|p| p.runtime_id != runtime_id);
        store.processes.push(process.clone());
        write_store(&app, &store)?;
        return Ok(process);
    }

    let binary_probe = probe_binary_sync(binary);
    let binary_path = binary_probe.path.ok_or_else(|| {
        format!(
            "{binary} was not found. Install it and ensure the binary is available to Jan (PATH, Homebrew, or /Applications/Ollama.app)."
        )
    })?;

    let logs_dir = studio_logs_dir(&app);
    fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;
    let log_path = logs_dir.join(format!("{runtime_id}.log"));
    let log_file = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&log_path)
        .map_err(|e| e.to_string())?;

    let mut command = match runtime_id.as_str() {
        "vllm" => {
            let mut cmd = std::process::Command::new(&binary_path);
            cmd.args(["serve", &model, "--host", "127.0.0.1", "--port", "8000"]);
            cmd
        }
        "ollama" => {
            let mut cmd = std::process::Command::new(&binary_path);
            cmd.arg("serve");
            cmd
        }
        _ => unreachable!(),
    };

    command
        .stdout(Stdio::from(
            log_file.try_clone().map_err(|e| e.to_string())?,
        ))
        .stderr(Stdio::from(log_file))
        .stdin(Stdio::null());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        const DETACHED_PROCESS: u32 = 0x00000008;
        command.creation_flags(0x08000000 | CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS);
    }

    let child = command.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    // Detach the managed runtime so it keeps running after this command returns.
    std::mem::forget(child);

    tokio::time::sleep(std::time::Duration::from_secs(2)).await;

    if !process_is_alive(pid) {
        let log_tail = read_log_tail(&log_path, 30);
        let detail = if log_tail.is_empty() {
            format!("{runtime_id} exited immediately after launch.")
        } else {
            format!("{runtime_id} exited immediately after launch:\n{log_tail}")
        };
        return Err(detail);
    }

    let process = StudioRuntimeProcess {
        runtime_id: runtime_id.clone(),
        pid,
        model: if model.is_empty() { None } else { Some(model) },
        base_url: normalized_base_url,
        log_path: log_path.to_string_lossy().into_owned(),
    };

    let mut store = read_store(&app);
    store.processes.retain(|p| p.runtime_id != runtime_id);
    store.processes.push(process.clone());
    write_store(&app, &store)?;

    Ok(process)
}

#[tauri::command]
pub async fn stop_studio_runtime<R: Runtime>(
    app: AppHandle<R>,
    runtime_id: String,
) -> Result<(), String> {
    let runtime_id = runtime_id.trim().to_lowercase();
    let mut store = read_store(&app);
    let Some(index) = store
        .processes
        .iter()
        .position(|p| p.runtime_id == runtime_id)
    else {
        return Ok(());
    };

    let process = store.processes.remove(index);
    write_store(&app, &store)?;

    #[cfg(unix)]
    {
        unsafe {
            libc::kill(process.pid as i32, libc::SIGTERM);
        }
    }

    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &process.pid.to_string(), "/F"])
            .output();
    }

    Ok(())
}

#[tauri::command]
pub async fn read_studio_runtime_logs<R: Runtime>(
    app: AppHandle<R>,
    runtime_id: String,
) -> Result<String, String> {
    let runtime_id = runtime_id.trim().to_lowercase();
    let store = read_store(&app);
    let process = store
        .processes
        .iter()
        .find(|p| p.runtime_id == runtime_id)
        .ok_or_else(|| format!("No managed process for runtime: {runtime_id}"))?;

    if !std::path::Path::new(&process.log_path).exists() {
        return Ok(String::new());
    }

    fs::read_to_string(&process.log_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn write_codex_app_server_config<R: Runtime>(
    app: AppHandle<R>,
    codex_home: String,
    config_toml: String,
    agents_md: Option<String>,
    custom_agents: Option<String>,
) -> Result<String, String> {
    let path = PathBuf::from(&codex_home);
    let codex_home_path = if path.is_absolute() {
        path
    } else {
        get_jan_data_folder_path(app).join(path)
    };
    fs::create_dir_all(&codex_home_path).map_err(|e| e.to_string())?;
    let config_path = codex_home_path.join("config.toml");
    fs::write(&config_path, config_toml).map_err(|e| e.to_string())?;

    if let Some(content) = agents_md {
        if !content.trim().is_empty() {
            let agents_path = codex_home_path.join("AGENTS.md");
            fs::write(&agents_path, content).map_err(|e| e.to_string())?;
        }
    }

    // Write custom sub-agents as TOML files for Codex engine (loaded from agents/ dir)
    if let Some(agents_json) = custom_agents {
        if !agents_json.trim().is_empty() {
            let agents_dir = codex_home_path.join("agents");
            fs::create_dir_all(&agents_dir).map_err(|e| e.to_string())?;
            if let Ok(agents) = serde_json::from_str::<Vec<serde_json::Value>>(&agents_json) {
                for agent in agents {
                    let name = agent.get("name").and_then(|v| v.as_str()).unwrap_or("custom-agent");
                    let desc = agent.get("description").and_then(|v| v.as_str()).unwrap_or("");
                    let instructions = agent.get("developer_instructions").and_then(|v| v.as_str()).unwrap_or("");
                    let model = agent.get("model").and_then(|v| v.as_str());
                    let sandbox = agent.get("sandbox_mode").and_then(|v| v.as_str());

                    let mut toml = format!(
                        "name = {}\ndescription = {}\ndeveloper_instructions = \"\"\"\n{}\n\"\"\"\n",
                        serde_json::to_string(name).unwrap_or_default(),
                        serde_json::to_string(desc).unwrap_or_default(),
                        instructions
                    );
                    if let Some(m) = model {
                        toml.push_str(&format!("model = {}\n", serde_json::to_string(m).unwrap_or_default()));
                    }
                    if let Some(s) = sandbox {
                        toml.push_str(&format!("sandbox_mode = {}\n", serde_json::to_string(s).unwrap_or_default()));
                    }
                    // sanitize filename
                    let safe_name: String = name.chars().filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_').collect();
                    let agent_path = agents_dir.join(format!("{}.toml", if safe_name.is_empty() { "custom".to_string() } else { safe_name }));
                    let _ = fs::write(&agent_path, toml);
                }
            }
        }
    }

    Ok(config_path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn start_codex_app_server<R: Runtime>(
    app: AppHandle<R>,
    session_id: String,
    command: String,
    args: Vec<String>,
    cwd: String,
    mut env: HashMap<String, String>,
) -> Result<CodexAppServerProcess, String> {
    let session_id = session_id.trim().to_string();
    if session_id.is_empty() {
        return Err("Codex app-server session id is required".to_string());
    }

    if let Some(existing) = codex_app_servers().lock().await.remove(&session_id) {
        let _ = existing.shutdown.send(());
    }

    if let Some(codex_home) = env.get_mut("CODEX_HOME") {
        let path = PathBuf::from(&codex_home);
        if !path.is_absolute() {
            let abs_path = get_jan_data_folder_path(app.clone()).join(path);
            *codex_home = abs_path.to_string_lossy().into_owned();
        }
    }

    let original_args = args;
    let mut command = command.trim().to_string();
    let mut command_args = original_args.clone();
    let use_codex_fallback = is_codex_binary_command(&command);
    let requested_app_server_stdio = requests_app_server_stdio(&command_args);
    let npx_probe = probe_binary_sync("npx");

    if use_codex_fallback
        && requested_app_server_stdio
        && !codex_binary_supports_app_server(&command)
    {
        if !npx_probe.found {
            return Err(
                "Configured codex binary does not support `app-server --stdio`, and `npx` is not available for @openai/codex fallback."
                    .to_string(),
            );
        }

        log::warn!(
            "Configured codex binary does not support `app-server --stdio`; trying `npx @openai/codex` fallback."
        );
        command = "npx".to_string();
        command_args = std::iter::once("-y".to_string())
            .chain(std::iter::once("@openai/codex".to_string()))
            .chain(original_args.clone().into_iter())
            .collect();
    }

    let build_cmd = |cmd_name: &str, args: &[String], env: &HashMap<String, String>| {
        let mut cmd = tokio::process::Command::new(cmd_name);
        cmd.args(args)
            .current_dir(cwd.trim())
            .envs(env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(unix)]
        {
            unsafe {
                cmd.pre_exec(|| {
                    libc::setsid();
                    Ok(())
                });
            }
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
            cmd.creation_flags(0x08000000 | CREATE_NEW_PROCESS_GROUP);
        }

        cmd
    };

    let mut child = match build_cmd(&command, &command_args, &env).spawn() {
        Ok(child) => child,
        Err(start_error) => {
            let should_try_npx = use_codex_fallback
                && command != "npx"
                && should_fallback_to_npx(&command, &start_error, npx_probe.found);

            if !should_try_npx {
                return Err(format!("Failed to start codex app-server: {start_error}"));
            }

            log::warn!(
                "Failed to spawn '{command}' ({start_error}); trying `npx @openai/codex` fallback."
            );
            command = "npx".to_string();
            command_args = std::iter::once("-y".to_string())
                .chain(std::iter::once("@openai/codex".to_string()))
                .chain(original_args.into_iter())
                .collect();

            build_cmd(&command, &command_args, &env)
                .spawn()
                .map_err(|fallback_error| {
                    format!(
                        "Failed to start codex app-server with '{command}': {fallback_error}; \
                        fallback `npx @openai/codex` with original args also failed: {start_error}"
                    )
                })?
        }
    };
    let pid = child
        .id()
        .ok_or_else(|| "Codex app-server started without a process id".to_string())?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open codex app-server stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open codex app-server stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to open codex app-server stderr".to_string())?;

    let stdin = Arc::new(Mutex::new(stdin));
    let (shutdown, mut shutdown_rx) = mpsc::unbounded_channel::<()>();

    spawn_codex_line_reader(
        app.clone(),
        session_id.clone(),
        "codex-app-server-stdout",
        stdout,
    );
    spawn_codex_line_reader(
        app.clone(),
        session_id.clone(),
        "codex-app-server-stderr",
        stderr,
    );

    {
        let mut registry = codex_app_servers().lock().await;
        registry.insert(
            session_id.clone(),
            ManagedCodexAppServer {
                pid,
                stdin: stdin.clone(),
                shutdown,
            },
        );
    }

    let exit_app = app.clone();
    let exit_session_id = session_id.clone();
    tauri::async_runtime::spawn(async move {
        let status = tokio::select! {
            status = child.wait() => status,
            _ = shutdown_rx.recv() => {
                let _ = child.kill().await;
                child.wait().await
            }
        };

        let (code, signal) = match status {
            Ok(status) => {
                #[cfg(unix)]
                {
                    use std::os::unix::process::ExitStatusExt;
                    (status.code(), status.signal().map(|s| s.to_string()))
                }
                #[cfg(not(unix))]
                {
                    (status.code(), None)
                }
            }
            Err(error) => {
                log::warn!("Failed waiting for codex app-server: {error}");
                (None, None)
            }
        };

        codex_app_servers().lock().await.remove(&exit_session_id);
        let _ = exit_app.emit(
            "codex-app-server-exit",
            CodexAppServerExitPayload {
                session_id: exit_session_id,
                code,
                signal,
            },
        );
    });

    Ok(CodexAppServerProcess { session_id, pid })
}

#[tauri::command]
pub async fn write_codex_app_server_stdin(session_id: String, line: String) -> Result<(), String> {
    let stdin = {
        let registry = codex_app_servers().lock().await;
        registry
            .get(session_id.trim())
            .map(|server| server.stdin.clone())
            .ok_or_else(|| format!("No codex app-server process for session: {session_id}"))?
    };

    let mut stdin = stdin.lock().await;
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    stdin.write_all(b"\n").await.map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_codex_app_server(session_id: String) -> Result<(), String> {
    let Some(existing) = codex_app_servers().lock().await.remove(session_id.trim()) else {
        return Ok(());
    };
    let _ = existing.shutdown.send(());
    Ok(())
}

#[tauri::command]
pub async fn list_codex_app_server_processes() -> Result<Vec<CodexAppServerProcess>, String> {
    let registry = codex_app_servers().lock().await;
    Ok(registry
        .iter()
        .map(|(session_id, process)| CodexAppServerProcess {
            session_id: session_id.clone(),
            pid: process.pid,
        })
        .collect())
}

fn spawn_codex_line_reader<R, S>(
    app: AppHandle<R>,
    session_id: String,
    event_name: &'static str,
    stream: S,
) where
    R: Runtime,
    S: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stream).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    let _ = app.emit(
                        event_name,
                        CodexAppServerLinePayload {
                            session_id: session_id.clone(),
                            line,
                        },
                    );
                }
                Ok(None) => break,
                Err(error) => {
                    let _ = app.emit(
                        "codex-app-server-stderr",
                        CodexAppServerLinePayload {
                            session_id: session_id.clone(),
                            line: format!("Failed reading codex app-server stream: {error}"),
                        },
                    );
                    break;
                }
            }
        }
    });
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCliRunResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

/// Run a Codex CLI subcommand (doctor, exec, resume, etc.) with optional CODEX_HOME and cwd.
/// Used by Jan Studio for diagnostics and non-interactive Codex CLI bridging.
#[tauri::command]
pub async fn run_codex_cli_subcommand<R: Runtime>(
    app: AppHandle<R>,
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
    codex_home: Option<String>,
    extra_env: Option<HashMap<String, String>>,
) -> Result<CodexCliRunResult, String> {
    let mut cmd_name = command.trim().to_string();
    if cmd_name.is_empty() {
        return Err("Codex binary path is required".to_string());
    }

    let mut env = extra_env.unwrap_or_default();
    if let Some(home) = codex_home {
        let path = PathBuf::from(&home);
        let resolved = if path.is_absolute() {
            path
        } else {
            get_jan_data_folder_path(app).join(path)
        };
        env.insert(
            "CODEX_HOME".to_string(),
            resolved.to_string_lossy().into_owned(),
        );
    }

    let work_dir = cwd.unwrap_or_else(|| ".".to_string());
    let use_codex_fallback = is_codex_binary_command(&cmd_name);
    let mut cmd_args = args;
    let npx_probe = probe_binary_sync("npx");

    if use_codex_fallback && !codex_binary_supports_subcommand(&cmd_name, &cmd_args) && npx_probe.found
    {
        log::warn!(
            "Configured codex binary may not support subcommand {:?}; trying `npx @openai/codex` fallback.",
            cmd_args.first()
        );
        cmd_name = "npx".to_string();
        cmd_args = std::iter::once("-y".to_string())
            .chain(std::iter::once("@openai/codex".to_string()))
            .chain(cmd_args.into_iter())
            .collect();
    }

    let output = tokio::task::spawn_blocking(move || {
        std::process::Command::new(&cmd_name)
            .args(&cmd_args)
            .current_dir(work_dir.trim())
            .envs(&env)
            .output()
    })
    .await
    .map_err(|err| format!("Failed to spawn codex CLI: {err}"))?
    .map_err(|err| format!("Failed to run codex CLI: {err}"))?;

    Ok(CodexCliRunResult {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        exit_code: output.status.code(),
    })
}

fn codex_binary_supports_subcommand(command: &str, args: &[String]) -> bool {
    if !is_codex_binary_command(command) {
        return true;
    }
    let sub = args.first().map(|s| s.as_str()).unwrap_or("");
    if sub.is_empty() || sub == "app-server" || sub == "proto" {
        return true;
    }
    let output = std::process::Command::new(command)
        .arg(sub)
        .arg("--help")
        .output();
    match output {
        Ok(result) => result.status.success() || !result.stdout.is_empty() || !result.stderr.is_empty(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        app_server_help_output_supports_stdio, is_codex_binary_command,
        requests_app_server_stdio, should_fallback_to_npx,
    };

    use std::io::{self, ErrorKind};

    #[test]
    fn detects_codex_binary_commands() {
        assert!(is_codex_binary_command("codex"));
        assert!(is_codex_binary_command("/usr/local/bin/codex"));
        assert!(is_codex_binary_command(
            "C:\\Program Files\\Codex\\codex.exe"
        ));
        assert!(is_codex_binary_command(
            "/Applications/Codex.app/Contents/Resources/codex"
        ));
        assert!(is_codex_binary_command(
            "/Users/test/Applications/Codex.app/Contents/Resources/codex"
        ));
        assert!(!is_codex_binary_command("npx"));
        assert!(!is_codex_binary_command("/usr/local/bin/codex-server"));
    }

    #[test]
    fn codex_npx_fallback_conditions() {
        let not_found = io::Error::new(ErrorKind::NotFound, "not found");
        let permission_denied = io::Error::new(ErrorKind::PermissionDenied, "permission denied");

        assert!(should_fallback_to_npx("codex", &not_found, true));
        assert!(!should_fallback_to_npx("npx", &not_found, true));
        assert!(!should_fallback_to_npx(
            "/usr/local/bin/codex",
            &permission_denied,
            true
        ));
        assert!(!should_fallback_to_npx(
            "/usr/local/bin/codex",
            &not_found,
            false
        ));
    }

    #[test]
    fn detects_app_server_stdio_support_from_help_output() {
        assert!(app_server_help_output_supports_stdio(
            b"Usage: codex app-server --stdio\n",
            b""
        ));
        assert!(!app_server_help_output_supports_stdio(
            b"Usage: codex [OPTIONS] [PROMPT]\nCommands:\n  proto\n",
            b""
        ));
        assert!(!app_server_help_output_supports_stdio(
            b"",
            b"error: unexpected argument '--stdio' found"
        ));
    }

    #[test]
    fn detects_only_explicit_app_server_stdio_launches() {
        assert!(requests_app_server_stdio(&[
            "app-server".to_string(),
            "--stdio".to_string()
        ]));
        assert!(!requests_app_server_stdio(&["proto".to_string()]));
        assert!(!requests_app_server_stdio(&["app-server".to_string()]));
    }
}
