use rmcp::{
    model::{ClientCapabilities, ClientInfo, Implementation},
    transport::{
        streamable_http_client::StreamableHttpClientTransportConfig, SseClientTransport,
        StreamableHttpClientTransport, TokioChildProcess,
    },
    ServiceExt,
};
use serde_json::Value;
use std::{collections::HashMap, env, process::Stdio, sync::Arc, time::Duration};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_http::reqwest;
use tokio::{
    io::AsyncReadExt,
    process::Command,
    sync::{Mutex, Notify},
    time::{sleep, timeout},
};

use crate::core::{
    app::commands::get_jan_data_folder_path,
    mcp::models::{McpServerConfig, McpSettings},
    state::{AppState, RunningServiceEnum, SharedMcpServers},
};
use jan_utils::{can_override_npx, can_override_uvx};

#[derive(Debug, Clone, Copy)]
pub enum ShutdownContext {
    AppExit,       // User closing app - be fast
    ManualRestart, // User restarting servers - be thorough
    FactoryReset,  // Deleting data - be very thorough
}

impl ShutdownContext {
    pub fn per_server_timeout(&self) -> Duration {
        match self {
            Self::AppExit => Duration::from_millis(500),
            Self::ManualRestart => Duration::from_secs(2),
            Self::FactoryReset => Duration::from_secs(5),
        }
    }

    pub fn overall_timeout(&self) -> Duration {
        match self {
            Self::AppExit => Duration::from_millis(1500),
            Self::ManualRestart => Duration::from_secs(5),
            Self::FactoryReset => Duration::from_secs(10),
        }
    }
}

/// Runs MCP commands by reading configuration from a JSON file and initializing servers
///
/// # Arguments
/// * `app_path` - Path to the application directory containing mcp_config.json
/// * `servers_state` - Shared state containing running MCP services
///
/// # Returns
/// * `Ok(())` if servers were initialized successfully
/// * `Err(String)` if there was an error reading config or starting servers
pub async fn run_mcp_commands<R: Runtime>(
    app: &AppHandle<R>,
    servers_state: SharedMcpServers,
) -> Result<(), String> {
    let app_path = get_jan_data_folder_path(app.clone());
    let app_path_str = app_path.to_str().unwrap().to_string();
    log::trace!(
        "Load MCP configs from {}",
        app_path_str.clone() + "/mcp_config.json"
    );
    let config_content = std::fs::read_to_string(app_path_str + "/mcp_config.json")
        .map_err(|e| format!("Failed to read config file: {e}"))?;

    let mcp_servers: serde_json::Value = serde_json::from_str(&config_content)
        .map_err(|e| format!("Failed to parse config: {e}"))?;

    // Update runtime MCP settings from config
    {
        let settings = mcp_servers
            .get("mcpSettings")
            .and_then(|value| serde_json::from_value::<McpSettings>(value.clone()).ok())
            .unwrap_or_default();

        let app_state = app.state::<AppState>();
        let mut guard = app_state.mcp_settings.lock().await;
        *guard = settings;
    }

    let server_map = mcp_servers
        .get("mcpServers")
        .and_then(Value::as_object)
        .ok_or("No mcpServers found in config")?;

    log::trace!("MCP Servers: {server_map:#?}");

    // Collect handles for initial server startup
    let mut startup_handles = Vec::new();

    for (name, config) in server_map {
        if extract_active_status(config) == Some(false) {
            log::trace!("Server {name} is not active, skipping.");
            continue;
        }

        let app_clone = app.clone();
        let servers_clone = servers_state.clone();
        let name_clone = name.clone();
        let config_clone = config.clone();

        // Spawn task for initial startup attempt
        let handle = tauri::async_runtime::spawn(async move {
            // Only wait for the initial startup attempt, not the monitoring
            let result = start_mcp_server(
                app_clone.clone(),
                servers_clone.clone(),
                name_clone.clone(),
                config_clone.clone(),
            )
            .await;

            // If initial startup failed, we still want to continue with other servers
            if let Err(e) = &result {
                log::error!("Initial startup failed for MCP server {name_clone}: {e}");
            }

            (name_clone, result)
        });

        startup_handles.push(handle);
    }

    // Wait for all initial startup attempts to complete
    let mut successful_count = 0;
    let mut failed_count = 0;

    for handle in startup_handles {
        match handle.await {
            Ok((name, result)) => match result {
                Ok(_) => {
                    log::info!("MCP server {name} initialized successfully");
                    successful_count += 1;
                }
                Err(e) => {
                    log::error!("MCP server {name} failed to initialize: {e}");
                    failed_count += 1;
                }
            },
            Err(e) => {
                log::error!("Failed to join startup task: {e}");
                failed_count += 1;
            }
        }
    }

    log::info!(
        "MCP server initialization complete: {successful_count} successful, {failed_count} failed"
    );

    Ok(())
}

/// Computes the clamped exponential backoff delay in milliseconds.
///
/// `attempt` is 0-indexed (0 = first failure). Invalid multipliers (NaN, negative,
/// zero, < 1.0) fall back to 1.0 so the delay never decreases. Overflow to
/// infinity caps at `max_delay_ms`. Result is always >= `base_delay_ms`.
pub(super) fn compute_backoff_delay(
    base_delay_ms: u64,
    max_delay_ms: u64,
    multiplier: f64,
    attempt: u32,
) -> u64 {
    let safe_multiplier = if multiplier.is_finite() && multiplier >= 1.0 {
        multiplier
    } else {
        1.0
    };
    let raw_delay = base_delay_ms as f64 * safe_multiplier.powi(attempt as i32);
    let delay_ms = if raw_delay.is_finite() {
        raw_delay as u64
    } else {
        max_delay_ms
    };
    delay_ms.min(max_delay_ms).max(base_delay_ms)
}

/// Monitor MCP server health and auto-reconnect on failure with exponential backoff
pub async fn monitor_mcp_server_handle<R: Runtime>(
    app: AppHandle<R>,
    servers_state: SharedMcpServers,
    name: String,
    config: Value,
    shutdown_flag: Arc<Mutex<bool>>,
    reconnect_notify: Arc<Notify>,
) {
    log::info!("Monitoring MCP server {name} health");
    let mut consecutive_failures: u32 = 0;

    loop {
        // Wait for either the periodic health check or an immediate reconnect signal
        tokio::select! {
            _ = sleep(Duration::from_secs(2)) => {}
            _ = reconnect_notify.notified() => {
                log::info!("MCP server {name} monitor received reconnect signal");
            }
        }

        {
            let shutdown = shutdown_flag.lock().await;
            if *shutdown {
                log::info!("MCP server {name} monitor shutting down (shutdown flag)");
                return;
            }
        }

        let health_check_result = {
            let servers = servers_state.lock().await;
            if let Some(service) = servers.get(&name) {
                match timeout(Duration::from_secs(2), service.list_all_tools()).await {
                    Ok(Ok(_)) => true,
                    Ok(Err(e)) => {
                        log::warn!("MCP server {name} health check failed: {e}");
                        false
                    }
                    Err(_) => {
                        log::warn!("MCP server {name} health check timed out");
                        false
                    }
                }
            } else {
                // Entry was removed (e.g., by get_tools cleanup or deactivate).
                // Only stop monitoring if the server was deliberately deactivated.
                let still_active = {
                    let app_state = app.state::<AppState>();
                    let active_servers = app_state.mcp_active_servers.lock().await;
                    active_servers.contains_key(&name)
                };
                if still_active {
                    log::info!("MCP server {name} entry missing but still active, will reconnect");
                    false
                } else {
                    log::info!("MCP server {name} removed and deactivated, stopping monitor");
                    return;
                }
            }
        };

        if health_check_result {
            // Reset failure count on success
            consecutive_failures = 0;
            continue;
        }

        // Server failed health check — remove the dead entry and try to reconnect
        log::error!("MCP server {name} failed health check, attempting auto-reconnect");

        // Clean up the dead server entry (if still present) and its tracked PID
        {
            let mut servers = servers_state.lock().await;
            if let Some(service) = servers.remove(&name) {
                match service {
                    RunningServiceEnum::NoInit(service) => {
                        let _ = service.cancel().await;
                    }
                    RunningServiceEnum::WithInit(service) => {
                        let _ = service.cancel().await;
                    }
                }
            }
        }
        {
            let app_state = app.state::<AppState>();
            let mut pids = app_state.mcp_server_pids.lock().await;
            pids.remove(&name);
        }

        // Emit event so frontend shows accurate disconnected status
        emit_mcp_update_event(&app, &name);

        consecutive_failures += 1;

        // Calculate backoff delay
        let settings = {
            let app_state = app.state::<AppState>();
            let guard = app_state.mcp_settings.lock().await;
            guard.clone()
        };
        let base_delay_ms = settings.base_restart_delay_ms;
        let max_delay_ms = settings.max_restart_delay_ms;
        let multiplier = settings.backoff_multiplier;
        let capped_delay_ms = compute_backoff_delay(
            base_delay_ms,
            max_delay_ms,
            multiplier,
            consecutive_failures - 1,
        );

        log::info!(
            "MCP server {name} reconnect attempt {} in {}ms",
            consecutive_failures,
            capped_delay_ms
        );
        sleep(Duration::from_millis(capped_delay_ms)).await;

        // Check shutdown flag before reconnect attempt
        {
            let shutdown = shutdown_flag.lock().await;
            if *shutdown {
                log::info!("MCP server {name} monitor shutting down before reconnect");
                return;
            }
        }

        // Check that server is still in active configs (user hasn't deactivated it)
        let still_active = {
            let app_state = app.state::<AppState>();
            let active_servers = app_state.mcp_active_servers.lock().await;
            active_servers.contains_key(&name)
        };

        if !still_active {
            log::info!("MCP server {name} was deactivated, stopping monitor");
            return;
        }

        // Attempt reconnect
        match schedule_mcp_start_task(
            app.clone(),
            servers_state.clone(),
            name.clone(),
            config.clone(),
        )
        .await
        {
            Ok(_) => {
                log::info!("MCP server {name} reconnected successfully");
                consecutive_failures = 0;
                // Emit event so frontend shows accurate connected status
                emit_mcp_update_event(&app, &name);
            }
            Err(e) => {
                log::error!("MCP server {name} reconnect attempt {consecutive_failures} failed: {e}");
                // Loop continues — will retry with increased backoff
            }
        }
    }
}

/// Starts an MCP server
/// Returns the result of the first start attempt
pub async fn start_mcp_server<R: Runtime>(
    app: AppHandle<R>,
    servers_state: SharedMcpServers,
    name: String,
    config: Value,
) -> Result<(), String> {
    let app_state = app.state::<AppState>();
    let active_servers_state = app_state.mcp_active_servers.clone();

    // Store active server config for restart purposes
    store_active_server_config(&active_servers_state, &name, &config).await;

    // Try the first start attempt and return its result
    log::info!("Starting MCP server {name} (Initial attempt)");
    let first_start_result = schedule_mcp_start_task(
        app.clone(),
        servers_state.clone(),
        name.clone(),
        config.clone(),
    )
    .await;

    match first_start_result {
        Ok(_) => {
            log::info!("MCP server {name} started successfully");

            // Spawn health monitoring with auto-reconnect
            let monitor_app = app.clone();
            let monitor_servers = servers_state.clone();
            let monitor_name = name.clone();
            let monitor_config = config.clone();
            let shutdown_flag = app_state.mcp_shutdown_in_progress.clone();
            let reconnect_notify = app_state.mcp_reconnect_notify.clone();

            let monitor_handle = tauri::async_runtime::spawn(async move {
                monitor_mcp_server_handle(
                    monitor_app,
                    monitor_servers,
                    monitor_name,
                    monitor_config,
                    shutdown_flag,
                    reconnect_notify,
                )
                .await;
            });

            // Store the monitoring task handle so it can be aborted on shutdown
            {
                let mut monitoring_tasks = app_state.mcp_monitoring_tasks.lock().await;
                monitoring_tasks.insert(name.clone(), monitor_handle);
            }

            Ok(())
        }
        Err(e) => {
            log::error!("Failed to start MCP server {name} on first attempt: {e}");
            Err(e)
        }
    }
}

async fn schedule_mcp_start_task<R: Runtime>(
    app: tauri::AppHandle<R>,
    servers: SharedMcpServers,
    name: String,
    config: Value,
) -> Result<(), String> {
    let app_path = get_jan_data_folder_path(app.clone());
    let exe_path = env::current_exe().expect("Failed to get current exe path");
    let exe_parent_path = exe_path
        .parent()
        .expect("Executable must have a parent directory");
    let bin_path = exe_parent_path.to_path_buf();

    let config_params = extract_command_args(&config)
        .ok_or_else(|| format!("Failed to extract command args from config for {name}"))?;

    if config_params.transport_type.as_deref() == Some("http") && config_params.url.is_some() {
        let transport = StreamableHttpClientTransport::with_client(
            reqwest::Client::builder()
                .default_headers({
                    // Map envs to request headers
                    let mut headers: tauri::http::HeaderMap = reqwest::header::HeaderMap::new();
                    for (key, value) in config_params.headers.iter() {
                        if let Some(v_str) = value.as_str() {
                            // Try to map env keys to HTTP header names (case-insensitive)
                            // Most HTTP headers are Title-Case, so we try to convert
                            let header_name =
                                reqwest::header::HeaderName::from_bytes(key.as_bytes());
                            if let Ok(header_name) = header_name {
                                if let Ok(header_value) =
                                    reqwest::header::HeaderValue::from_str(v_str)
                                {
                                    headers.insert(header_name, header_value);
                                }
                            }
                        }
                    }
                    headers
                })
                .connect_timeout(config_params.timeout.unwrap_or(Duration::MAX))
                .build()
                .unwrap(),
            StreamableHttpClientTransportConfig {
                uri: config_params.url.unwrap().into(),
                ..Default::default()
            },
        );

        let client_info = ClientInfo {
            protocol_version: Default::default(),
            capabilities: ClientCapabilities::default(),
            client_info: Implementation {
                name: "Jan Streamable Client".to_string(),
                version: "0.0.1".to_string(),
                title: None,
                website_url: None,
                icons: None,
            },
        };
        let client = client_info.serve(transport).await.inspect_err(|e| {
            log::error!("client error: {e:?}");
        });

        match client {
            Ok(client) => {
                log::info!("Connected to server: {:?}", client.peer_info());
                servers
                    .lock()
                    .await
                    .insert(name.clone(), RunningServiceEnum::WithInit(client));

                emit_mcp_update_event(&app, &name);
            }
            Err(e) => {
                log::error!("Failed to connect to server: {e}");
                return Err(format!("Failed to connect to server: {e}"));
            }
        }
    } else if config_params.transport_type.as_deref() == Some("sse") && config_params.url.is_some()
    {
        let transport = SseClientTransport::start_with_client(
            reqwest::Client::builder()
                .default_headers({
                    // Map envs to request headers
                    let mut headers = reqwest::header::HeaderMap::new();
                    for (key, value) in config_params.headers.iter() {
                        if let Some(v_str) = value.as_str() {
                            // Try to map env keys to HTTP header names (case-insensitive)
                            // Most HTTP headers are Title-Case, so we try to convert
                            let header_name =
                                reqwest::header::HeaderName::from_bytes(key.as_bytes());
                            if let Ok(header_name) = header_name {
                                if let Ok(header_value) =
                                    reqwest::header::HeaderValue::from_str(v_str)
                                {
                                    headers.insert(header_name, header_value);
                                }
                            }
                        }
                    }
                    headers
                })
                .connect_timeout(config_params.timeout.unwrap_or(Duration::MAX))
                .build()
                .unwrap(),
            rmcp::transport::sse_client::SseClientConfig {
                sse_endpoint: config_params.url.unwrap().into(),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| {
            log::error!("transport error: {e:?}");
            format!("Failed to start SSE transport: {e}")
        })?;

        let client_info = ClientInfo {
            protocol_version: Default::default(),
            capabilities: ClientCapabilities::default(),
            client_info: Implementation {
                name: "Jan SSE Client".to_string(),
                version: "0.0.1".to_string(),
                title: None,
                website_url: None,
                icons: None,
            },
        };
        let client = client_info.serve(transport).await.map_err(|e| {
            log::error!("client error: {e:?}");
            e.to_string()
        });

        match client {
            Ok(client) => {
                log::info!("Connected to server: {:?}", client.peer_info());
                servers
                    .lock()
                    .await
                    .insert(name.clone(), RunningServiceEnum::WithInit(client));

                emit_mcp_update_event(&app, &name);
            }
            Err(e) => {
                log::error!("Failed to connect to server: {e}");
                return Err(format!("Failed to connect to server: {e}"));
            }
        }
    } else {
        if name == "Jan Browser MCP" {
            if let Some(port_str) = config_params.envs.get("BRIDGE_PORT") {
                if let Some(port_str) = port_str.as_str() {
                    if let Ok(port) = port_str.parse::<u16>() {
                        if !jan_utils::network::is_port_available(port) {
                            log::warn!("Port {} occupied, attempting cleanup", port);
                            match kill_orphaned_mcp_process_with_app(&app, port).await {
                                Ok(true) => {
                                    log::info!("Cleaned up orphaned process on port {}", port);
                                }
                                Ok(false) => {
                                    return Err(format!(
                                        "Port {} is already in use. Please close the application using this port or restart Jan.",
                                        port
                                    ));
                                }
                                Err(e) => return Err(e),
                            }
                        }
                    }
                }
            }
        }

        let mut cmd = Command::new(config_params.command.clone());
        let bun_x_path = if cfg!(windows) {
            bin_path.join("bun.exe")
        } else {
            bin_path.join("bun")
        };
        if config_params.command.clone() == "npx"
            && can_override_npx(bun_x_path.display().to_string())
        {
            let mut cache_dir = app_path.clone();
            cache_dir.push(".npx");
            cmd = Command::new(bun_x_path.display().to_string());
            cmd.arg("x");
            cmd.env("BUN_INSTALL", cache_dir.to_str().unwrap());
        }

        let uv_path = if cfg!(windows) {
            bin_path.join("uv.exe")
        } else {
            bin_path.join("uv")
        };
        if config_params.command.clone() == "uvx" && can_override_uvx(uv_path.display().to_string())
        {
            let mut cache_dir = app_path.clone();
            cache_dir.push(".uvx");
            cmd = Command::new(uv_path);
            cmd.arg("tool");
            cmd.arg("run");
            cmd.env("UV_CACHE_DIR", cache_dir.to_str().unwrap());
        }
        #[cfg(windows)]
        {
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW: prevents shell window on Windows
        }

        cmd.kill_on_drop(true);

        config_params
            .args
            .iter()
            .filter_map(Value::as_str)
            .for_each(|arg| {
                cmd.arg(arg);
            });
        config_params.envs.iter().for_each(|(k, v)| {
            if let Some(v_str) = v.as_str() {
                cmd.env(k, v_str);
            }
        });

        let (process, stderr) = TokioChildProcess::builder(cmd)
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                log::error!("Failed to run command {name}: {e}");
                format!("Failed to run command {name}: {e}")
            })?;

        let process_pid = process.id();
        if let Some(pid) = process_pid {
            log::info!("MCP server {name} spawned with PID {pid}");
            let app_state = app.state::<AppState>();
            let mut pids = app_state.mcp_server_pids.lock().await;
            pids.insert(name.clone(), pid);
        }

        let service = ()
            .serve(process)
            .await
            .map_err(|e| format!("Failed to start MCP server {name}: {e}"));

        match service {
            Ok(server) => {
                // Keep the stderr pipe alive to prevent the child process from
                // receiving SIGPIPE and to capture diagnostic output.
                if let Some(mut stderr_stream) = stderr {
                    let stderr_name = name.clone();
                    tokio::spawn(async move {
                        let mut buf = [0u8; 1024];
                        while let Ok(n) = stderr_stream.read(&mut buf).await {
                            if n == 0 {
                                break;
                            }
                            if let Ok(text) = std::str::from_utf8(&buf[..n]) {
                                for line in text.lines() {
                                    if !line.trim().is_empty() {
                                        log::warn!("[mcp-stderr:{}] {}", stderr_name, line);
                                    }
                                }
                            }
                        }
                    });
                }
                log::trace!("Connected to server: {:#?}", server.peer_info());
                servers
                    .lock()
                    .await
                    .insert(name.clone(), RunningServiceEnum::NoInit(server));
                log::info!("Server {name} started successfully.");
            }
            Err(_) => {
                let mut buffer = String::new();
                let error = match stderr
                    .expect("stderr must be piped")
                    .read_to_string(&mut buffer)
                    .await
                {
                    Ok(_) => format!("Failed to start MCP server {name}: {buffer}"),
                    Err(_) => format!("Failed to read MCP server {name} stderr"),
                };
                log::error!("{error}");
                return Err(error);
            }
        }

        // Wait a short time to verify the server is stable before marking as connected
        // This prevents race conditions where the server quits immediately
        let verification_delay = Duration::from_millis(500);
        sleep(verification_delay).await;

        // Check if server is still running after the verification delay
        let server_still_running = {
            let servers_map = servers.lock().await;
            servers_map.contains_key(&name)
        };

        if !server_still_running {
            return Err(format!("MCP server {name} quit immediately after starting"));
        }

        // Verify tools/list is reachable before emitting the ready event.
        // Stdio servers (especially via npx mcp-remote) may need extra time
        // after serve() completes before the transport is ready for JSON-RPC.
        const MAX_TOOL_VERIFY_ATTEMPTS: u32 = 3;
        const TOOL_VERIFY_TIMEOUT_SECS: u64 = 2;
        const TOOL_VERIFY_BACKOFF_MS: u64 = 1000;

        for attempt in 1..=MAX_TOOL_VERIFY_ATTEMPTS {
            let verify_result = {
                let servers_map = servers.lock().await;
                if let Some(service) = servers_map.get(&name) {
                    Some(
                        timeout(
                            Duration::from_secs(TOOL_VERIFY_TIMEOUT_SECS),
                            service.list_all_tools(),
                        )
                        .await,
                    )
                } else {
                    log::info!(
                        "MCP server {name} was removed during tools/list verification; skipping"
                    );
                    None
                }
            };

            match verify_result {
                None => {
                    // Server was removed from state (e.g., user toggled it off).
                    // Skip emitting the event entirely — this is intentional.
                    return Ok(());
                }
                Some(Ok(Ok(_tools))) => {
                    log::info!(
                        "MCP server {name} tools/list verified on attempt {attempt}"
                    );
                    break;
                }
                Some(Ok(Err(e))) => {
                    log::warn!(
                        "MCP server {name} tools/list failed on attempt {attempt}/{MAX_TOOL_VERIFY_ATTEMPTS}: {e}"
                    );
                    if attempt < MAX_TOOL_VERIFY_ATTEMPTS {
                        sleep(Duration::from_millis(TOOL_VERIFY_BACKOFF_MS)).await;
                    }
                }
                Some(Err(_)) => {
                    log::warn!(
                        "MCP server {name} tools/list timed out on attempt {attempt}/{MAX_TOOL_VERIFY_ATTEMPTS}"
                    );
                    if attempt < MAX_TOOL_VERIFY_ATTEMPTS {
                        sleep(Duration::from_millis(TOOL_VERIFY_BACKOFF_MS)).await;
                    }
                }
            }
        }
        // If all attempts failed, we still proceed to emit the event.
        // The health monitor will handle ongoing reconnection.

        // Create lock file for Jan Browser MCP
        if name == "Jan Browser MCP" {
            if let Some(port_str) = config_params.envs.get("BRIDGE_PORT") {
                if let Some(port_str) = port_str.as_str() {
                    if let Ok(port) = port_str.parse::<u16>() {
                        use crate::core::mcp::lockfile::create_lock_file;
                        if let Err(e) = create_lock_file(&app, port, &name) {
                            log::warn!("Failed to create lock file for port {}: {}", port, e);
                        }
                    }
                }
            }
        }

        emit_mcp_update_event(&app, &name);
    }
    Ok(())
}

fn emit_mcp_update_event<R: Runtime>(app: &AppHandle<R>, name: &str) {
    if let Err(e) = app.emit(
        "mcp-update",
        serde_json::json!({
            "server": name
        }),
    ) {
        log::error!("Failed to emit mcp-update event: {e}");
    }
}

pub fn extract_command_args(config: &Value) -> Option<McpServerConfig> {
    let obj = config.as_object()?;
    let command = obj.get("command")?.as_str()?.to_string();
    let args = obj.get("args")?.as_array()?.clone();
    let url = obj.get("url").and_then(|u| u.as_str()).map(String::from);
    let transport_type = obj.get("type").and_then(|t| t.as_str()).map(String::from);
    let timeout = obj
        .get("timeout")
        .and_then(|t| t.as_u64())
        .map(Duration::from_secs);
    let headers = obj
        .get("headers")
        .unwrap_or(&Value::Object(serde_json::Map::new()))
        .as_object()?
        .clone();
    let envs = obj
        .get("env")
        .unwrap_or(&Value::Object(serde_json::Map::new()))
        .as_object()?
        .clone();
    Some(McpServerConfig {
        timeout,
        transport_type,
        url,
        command,
        args,
        envs,
        headers,
    })
}

pub fn extract_active_status(config: &Value) -> Option<bool> {
    let obj = config.as_object()?;
    let active = obj.get("active")?.as_bool()?;
    Some(active)
}

/// Restart only servers that were previously active (like cortex restart behavior)
pub async fn restart_active_mcp_servers<R: Runtime>(
    app: &AppHandle<R>,
    servers_state: SharedMcpServers,
) -> Result<(), String> {
    let app_state = app.state::<AppState>();
    let active_servers = app_state.mcp_active_servers.lock().await;

    log::info!(
        "Restarting {} previously active MCP servers",
        active_servers.len()
    );

    for (name, config) in active_servers.iter() {
        log::info!("Restarting MCP server: {name}");

        // Start server with restart monitoring - spawn async task
        let app_clone = app.clone();
        let servers_clone = servers_state.clone();
        let name_clone = name.clone();
        let config_clone = config.clone();

        tauri::async_runtime::spawn(async move {
            let _ = start_mcp_server(app_clone, servers_clone, name_clone, config_clone).await;
        });
    }

    Ok(())
}

pub async fn kill_orphaned_mcp_process_with_app<R: Runtime>(
    app: &AppHandle<R>,
    port: u16,
) -> Result<bool, String> {
    use crate::core::mcp::lockfile::{
        check_and_cleanup_stale_lock, is_process_alive, read_lock_file,
    };

    // Check lock file first (fast path)
    if let Some(lock) = read_lock_file(app, port) {
        log::debug!("Found lock file for port {}: PID={}", port, lock.pid);

        if !is_process_alive(lock.pid) {
            log::info!("Lock file stale, process {} is dead", lock.pid);
            check_and_cleanup_stale_lock(app, port).await?;
            return Ok(true);
        }

        // Process from lock file is alive - verify it's still the MCP process
        if let Some(process_info) = jan_utils::network::get_process_info_by_pid(lock.pid) {
            if jan_utils::network::is_orphaned_mcp_process(&process_info) {
                log::info!(
                    "Lock file PID {} verified as MCP process, attempting kill",
                    lock.pid
                );
                kill_process_by_pid(lock.pid).await?;

                use crate::core::mcp::lockfile::delete_lock_file;
                delete_lock_file(app, port)?;

                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

                if jan_utils::network::is_port_available(port) {
                    log::info!("Cleaned up orphaned process via lock file");
                    return Ok(true);
                }
            } else {
                log::warn!(
                    "Lock file PID {} is alive but NOT an MCP process (name: {}, cmd: {:?}). Lock file is stale.",
                    lock.pid,
                    process_info.name,
                    process_info.cmd
                );
                // PID reused by another process, clean up stale lock file
                check_and_cleanup_stale_lock(app, port).await?;
            }
        } else {
            log::debug!(
                "Could not get process info for PID {}, cleaning up lock file",
                lock.pid
            );
            check_and_cleanup_stale_lock(app, port).await?;
        }
    }

    // Fallback: Use lsof/netstat to find process on port
    let process_info = match jan_utils::network::find_process_using_port(port) {
        Some(info) => info,
        None => return Ok(false),
    };

    log::info!(
        "Found process on port {}: PID={}, name={}, cmd={:?}",
        port,
        process_info.pid,
        process_info.name,
        process_info.cmd
    );

    if !jan_utils::network::is_orphaned_mcp_process(&process_info) {
        log::warn!(
            "Port {} occupied by non-Jan process '{}' (PID {})",
            port,
            process_info.name,
            process_info.pid
        );
        return Err(format!(
            "Port {} is in use by another application '{}' (PID {}). Please close that application or use a different port.",
            port, process_info.name, process_info.pid
        ));
    }

    log::info!("Killing orphaned MCP process: PID {}", process_info.pid);
    kill_process_by_pid(process_info.pid).await?;

    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    if jan_utils::network::is_port_available(port) {
        log::info!("Cleaned up orphaned process on port {}", port);
        Ok(true)
    } else {
        Err(format!("Port {} still in use after killing process", port))
    }
}

#[cfg(unix)]
async fn kill_process_by_pid(pid: u32) -> Result<(), String> {
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;

    let nix_pid = Pid::from_raw(pid as i32);

    kill(nix_pid, Signal::SIGTERM)
        .map_err(|e| format!("Failed to send SIGTERM to PID {}: {}", pid, e))?;

    for _ in 0..30 {
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        if kill(nix_pid, None).is_err() {
            return Ok(());
        }
    }

    log::warn!("Process {} unresponsive, sending SIGKILL", pid);
    kill(nix_pid, Signal::SIGKILL)
        .map_err(|e| format!("Failed to send SIGKILL to PID {}: {}", pid, e))?;

    Ok(())
}

#[cfg(windows)]
async fn kill_process_by_pid(pid: u32) -> Result<(), String> {
    use std::process::Command;

    #[cfg(windows)]
    use std::os::windows::process::CommandExt;

    let mut cmd = Command::new("taskkill");
    cmd.args(&["/F", "/T", "/PID", &pid.to_string()]);

    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run taskkill: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("taskkill failed: {}", stderr));
    }

    Ok(())
}

pub async fn background_cleanup_mcp_servers<R: Runtime>(
    app: &AppHandle<R>,
    state: &State<'_, AppState>,
) {
    let _ = stop_mcp_servers_with_context(app, state, ShutdownContext::AppExit).await;

    // Clear active servers and restart counts
    {
        let mut active_servers = state.mcp_active_servers.lock().await;
        active_servers.clear();
    }

    // Clean up all lock files created by this process
    use crate::core::mcp::lockfile::cleanup_own_locks;
    let _ = cleanup_own_locks(app);
}

struct ShutdownGuard {
    flag: Arc<Mutex<bool>>,
}

impl Drop for ShutdownGuard {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.flag.try_lock() {
            *guard = false;
        } else {
            let flag = self.flag.clone();
            tauri::async_runtime::spawn(async move {
                let mut guard = flag.lock().await;
                *guard = false;
            });
        }
    }
}

pub async fn stop_mcp_servers_with_context<R: Runtime>(
    app: &AppHandle<R>,
    state: &State<'_, AppState>,
    context: ShutdownContext,
) -> Result<(), String> {
    {
        let mut shutdown_in_progress = state.mcp_shutdown_in_progress.lock().await;
        if *shutdown_in_progress {
            return Ok(());
        }
        *shutdown_in_progress = true;
    }

    let _guard = ShutdownGuard {
        flag: state.mcp_shutdown_in_progress.clone(),
    };

    {
        let mut monitoring_tasks = state.mcp_monitoring_tasks.lock().await;
        for (_name, handle) in monitoring_tasks.drain() {
            handle.abort();
        }
    }

    tokio::time::sleep(Duration::from_millis(50)).await;

    let pids_snapshot: std::collections::HashMap<String, u32> = {
        let pids = state.mcp_server_pids.lock().await;
        pids.clone()
    };
    let servers_to_stop: Vec<(String, RunningServiceEnum, Option<u16>)> = {
        let mut servers_map = state.mcp_servers.lock().await;
        let keys: Vec<String> = servers_map.keys().cloned().collect();

        let mut result = Vec::new();
        for key in keys {
            if let Some(service) = servers_map.remove(&key) {
                let port = if key == "Jan Browser MCP" {
                    let active_servers = state.mcp_active_servers.lock().await;
                    active_servers.get(&key).and_then(|config| {
                        config
                            .get("env")
                            .and_then(|e| e.get("BRIDGE_PORT"))
                            .and_then(|p| p.as_str())
                            .and_then(|s| s.parse::<u16>().ok())
                    })
                } else {
                    None
                };

                result.push((key, service, port));
            }
        }
        result
    };

    if servers_to_stop.is_empty() {
        return Ok(());
    }

    let server_names: Vec<String> = servers_to_stop
        .iter()
        .map(|(name, _, _)| name.clone())
        .collect();
    let per_server_timeout = context.per_server_timeout();
    let stop_handles: Vec<_> = servers_to_stop
        .into_iter()
        .map(|(name, service, port)| {
            let app_clone = app.clone();

            tauri::async_runtime::spawn(async move {
                let cancel_future = async {
                    match service {
                        RunningServiceEnum::NoInit(service) => service.cancel().await,
                        RunningServiceEnum::WithInit(service) => service.cancel().await,
                    }
                };

                let success = tokio::time::timeout(per_server_timeout, cancel_future)
                    .await
                    .map(|r| r.is_ok())
                    .unwrap_or(false);

                if name == "Jan Browser MCP" {
                    if let Some(port) = port {
                        use crate::core::mcp::lockfile::delete_lock_file;
                        if success {
                            tokio::time::sleep(Duration::from_millis(100)).await;
                        }
                        let _ = delete_lock_file(&app_clone, port);
                    }
                }

                (name, success)
            })
        })
        .collect();

    let overall_timeout = context.overall_timeout();
    let results = tokio::time::timeout(
        overall_timeout,
        futures_util::future::join_all(stop_handles),
    )
    .await;

    let failed_servers: Vec<String> = match results {
        Ok(results) => {
            results
                .into_iter()
                .filter_map(|r| match r {
                    Ok((name, success)) if !success => Some(name),
                    Err(_) => None, // Task was cancelled/panicked
                    _ => None,
                })
                .collect()
        }
        Err(_) => {
            // Overall timeout - assume all servers need force-kill
            log::warn!("MCP shutdown timed out, will force-kill remaining processes");
            server_names.clone()
        }
    };

    // Force-kill processes that didn't stop gracefully
    for server_name in &failed_servers {
        if let Some(&pid) = pids_snapshot.get(server_name) {
            log::warn!("Force-killing MCP server {} (PID {})", server_name, pid);
            if let Err(e) = kill_process_by_pid(pid).await {
                log::error!("Failed to force-kill PID {}: {}", pid, e);
            }
        }
    }

    // Clean up PIDs from tracking
    {
        let mut pids = state.mcp_server_pids.lock().await;
        for name in &server_names {
            pids.remove(name);
        }
    }

    tokio::time::sleep(Duration::from_millis(200)).await;

    Ok(())
}

/// Store active server configuration for restart purposes
pub async fn store_active_server_config(
    active_servers_state: &Arc<Mutex<HashMap<String, Value>>>,
    name: &str,
    config: &Value,
) {
    let mut active_servers = active_servers_state.lock().await;
    active_servers.insert(name.to_string(), config.clone());
}

// Add a new server configuration to the MCP config file
pub fn add_server_config<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    server_key: String,
    server_value: Value,
) -> Result<(), String> {
    add_server_config_with_path(app_handle, server_key, server_value, None)
}

// Add a new server configuration to the MCP config file with custom path support
pub fn add_server_config_with_path<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    server_key: String,
    server_value: Value,
    config_filename: Option<&str>,
) -> Result<(), String> {
    let config_filename = config_filename.unwrap_or("mcp_config.json");
    let config_path = get_jan_data_folder_path(app_handle).join(config_filename);

    let mut config: Value = serde_json::from_str(
        &std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config file: {e}"))?,
    )
    .map_err(|e| format!("Failed to parse config: {e}"))?;

    config
        .as_object_mut()
        .ok_or("Config root is not an object")?
        .entry("mcpServers")
        .or_insert_with(|| Value::Object(serde_json::Map::new()))
        .as_object_mut()
        .ok_or("mcpServers is not an object")?
        .insert(server_key, server_value);

    std::fs::write(
        &config_path,
        serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize config: {e}"))?,
    )
    .map_err(|e| format!("Failed to write config file: {e}"))?;

    Ok(())
}
