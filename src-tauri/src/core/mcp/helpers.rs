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
    sync::Mutex,
    time::{sleep, timeout},
};

use super::constants::{
    MCP_BACKOFF_MULTIPLIER, MCP_BASE_RESTART_DELAY_MS, MCP_MAX_RESTART_DELAY_MS,
};
use crate::core::{
    app::commands::get_jan_data_folder_path,
    mcp::models::McpServerConfig,
    state::{AppState, RunningServiceEnum, SharedMcpServers},
};
use jan_utils::can_override_npx;

/// Calculate exponential backoff delay with jitter
///
/// # Arguments
/// * `attempt` - The current restart attempt number (1-based)
///
/// # Returns
/// * `u64` - Delay in milliseconds, capped at MCP_MAX_RESTART_DELAY_MS
pub fn calculate_exponential_backoff_delay(attempt: u32) -> u64 {
    use std::cmp;

    // Calculate base exponential delay: base_delay * multiplier^(attempt-1)
    let exponential_delay =
        (MCP_BASE_RESTART_DELAY_MS as f64) * MCP_BACKOFF_MULTIPLIER.powi((attempt - 1) as i32);

    // Cap the delay at maximum
    let capped_delay = cmp::min(exponential_delay as u64, MCP_MAX_RESTART_DELAY_MS);

    // Add jitter (±25% randomness) to prevent thundering herd
    let jitter_range = (capped_delay as f64 * 0.25) as u64;
    let jitter = if jitter_range > 0 {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};

        // Use attempt number as seed for deterministic but varied jitter
        let mut hasher = DefaultHasher::new();
        attempt.hash(&mut hasher);
        let hash = hasher.finish();

        // Convert hash to jitter value in range [-jitter_range, +jitter_range]
        let jitter_offset = (hash % (jitter_range * 2)) as i64 - jitter_range as i64;
        jitter_offset
    } else {
        0
    };

    // Apply jitter while ensuring delay stays positive and within bounds
    let final_delay = cmp::max(
        100, // Minimum 100ms delay
        cmp::min(
            MCP_MAX_RESTART_DELAY_MS,
            (capped_delay as i64 + jitter) as u64,
        ),
    );

    final_delay
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
        let handle = tokio::spawn(async move {
            // Only wait for the initial startup attempt, not the monitoring
            let result = start_mcp_server_with_restart(
                app_clone.clone(),
                servers_clone.clone(),
                name_clone.clone(),
                config_clone.clone(),
                Some(3), // Default max restarts for startup
            )
            .await;

            // If initial startup failed, we still want to continue with other servers
            if let Err(e) = &result {
                log::error!(
                    "Initial startup failed for MCP server {}: {}",
                    name_clone,
                    e
                );
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
                    log::info!("MCP server {} initialized successfully", name);
                    successful_count += 1;
                }
                Err(e) => {
                    log::error!("MCP server {} failed to initialize: {}", name, e);
                    failed_count += 1;
                }
            },
            Err(e) => {
                log::error!("Failed to join startup task: {}", e);
                failed_count += 1;
            }
        }
    }

    log::info!(
        "MCP server initialization complete: {} successful, {} failed",
        successful_count,
        failed_count
    );

    Ok(())
}

/// Monitor MCP server health without removing it from the HashMap
pub async fn monitor_mcp_server_handle(
    servers_state: SharedMcpServers,
    name: String,
) -> Option<rmcp::service::QuitReason> {
    log::info!("Monitoring MCP server {} health", name);

    // Monitor server health with periodic checks
    loop {
        // Small delay between health checks
        sleep(Duration::from_secs(5)).await;

        // Check if server is still healthy by trying to list tools
        let health_check_result = {
            let servers = servers_state.lock().await;
            if let Some(service) = servers.get(&name) {
                // Try to list tools as a health check with a short timeout
                match timeout(Duration::from_secs(2), service.list_all_tools()).await {
                    Ok(Ok(_)) => {
                        // Server responded successfully
                        true
                    }
                    Ok(Err(e)) => {
                        log::warn!("MCP server {} health check failed: {}", name, e);
                        false
                    }
                    Err(_) => {
                        log::warn!("MCP server {} health check timed out", name);
                        false
                    }
                }
            } else {
                // Server was removed from HashMap (e.g., by deactivate_mcp_server)
                log::info!("MCP server {} no longer in running services", name);
                return Some(rmcp::service::QuitReason::Closed);
            }
        };

        if !health_check_result {
            // Server failed health check - remove it and return
            log::error!(
                "MCP server {} failed health check, removing from active servers",
                name
            );
            let mut servers = servers_state.lock().await;
            if let Some(service) = servers.remove(&name) {
                // Try to cancel the service gracefully
                match service {
                    RunningServiceEnum::NoInit(service) => {
                        log::info!("Stopping server {name}...");
                        let _ = service.cancel().await;
                    }
                    RunningServiceEnum::WithInit(service) => {
                        log::info!("Stopping server {name} with initialization...");
                        let _ = service.cancel().await;
                    }
                }
            }
            return Some(rmcp::service::QuitReason::Closed);
        }
    }
}

/// Starts an MCP server with restart monitoring
/// Returns the result of the first start attempt, then continues with restart monitoring
pub async fn start_mcp_server_with_restart<R: Runtime>(
    app: AppHandle<R>,
    servers_state: SharedMcpServers,
    name: String,
    config: Value,
    max_restarts: Option<u32>,
) -> Result<(), String> {
    let app_state = app.state::<AppState>();
    let restart_counts = app_state.mcp_restart_counts.clone();
    let active_servers_state = app_state.mcp_active_servers.clone();
    let successfully_connected = app_state.mcp_successfully_connected.clone();

    // Store active server config for restart purposes
    store_active_server_config(&active_servers_state, &name, &config).await;

    let max_restarts = max_restarts.unwrap_or(5);

    // Try the first start attempt and return its result
    log::info!("Starting MCP server {} (Initial attempt)", name);
    let first_start_result = schedule_mcp_start_task(
        app.clone(),
        servers_state.clone(),
        name.clone(),
        config.clone(),
    )
    .await;

    match first_start_result {
        Ok(_) => {
            log::info!("MCP server {} started successfully on first attempt", name);
            reset_restart_count(&restart_counts, &name).await;

            // Check if server was marked as successfully connected (passed verification)
            let was_verified = {
                let connected = successfully_connected.lock().await;
                connected.get(&name).copied().unwrap_or(false)
            };

            if was_verified {
                // Only spawn monitoring task if server passed verification
                spawn_server_monitoring_task(
                    app,
                    servers_state,
                    name,
                    config,
                    max_restarts,
                    restart_counts,
                    successfully_connected,
                )
                .await;

                Ok(())
            } else {
                // Server failed verification, don't monitor for restarts
                log::error!("MCP server {} failed verification after startup", name);
                Err(format!(
                    "MCP server {} failed verification after startup",
                    name
                ))
            }
        }
        Err(e) => {
            log::error!(
                "Failed to start MCP server {} on first attempt: {}",
                name,
                e
            );
            Err(e)
        }
    }
}

/// Helper function to handle the restart loop logic
pub async fn start_restart_loop<R: Runtime>(
    app: AppHandle<R>,
    servers_state: SharedMcpServers,
    name: String,
    config: Value,
    max_restarts: u32,
    restart_counts: Arc<Mutex<HashMap<String, u32>>>,
    successfully_connected: Arc<Mutex<HashMap<String, bool>>>,
) {
    loop {
        let current_restart_count = {
            let mut counts = restart_counts.lock().await;
            let count = counts.entry(name.clone()).or_insert(0);
            *count += 1;
            *count
        };

        if current_restart_count > max_restarts {
            log::error!(
                "MCP server {} reached maximum restart attempts ({}). Giving up.",
                name,
                max_restarts
            );
            if let Err(e) = app.emit(
                "mcp_max_restarts_reached",
                serde_json::json!({
                    "server": name,
                    "max_restarts": max_restarts
                }),
            ) {
                log::error!("Failed to emit mcp_max_restarts_reached event: {e}");
            }
            break;
        }

        log::info!(
            "Restarting MCP server {} (Attempt {}/{})",
            name,
            current_restart_count,
            max_restarts
        );

        // Calculate exponential backoff delay
        let delay_ms = calculate_exponential_backoff_delay(current_restart_count);
        log::info!(
            "Waiting {}ms before restart attempt {} for MCP server {}",
            delay_ms,
            current_restart_count,
            name
        );
        sleep(Duration::from_millis(delay_ms)).await;

        // Attempt to restart the server
        let start_result = schedule_mcp_start_task(
            app.clone(),
            servers_state.clone(),
            name.clone(),
            config.clone(),
        )
        .await;

        match start_result {
            Ok(_) => {
                log::info!("MCP server {} restarted successfully.", name);

                // Check if server passed verification (was marked as successfully connected)
                let passed_verification = {
                    let connected = successfully_connected.lock().await;
                    connected.get(&name).copied().unwrap_or(false)
                };

                if !passed_verification {
                    log::error!(
                        "MCP server {} failed verification after restart - stopping permanently",
                        name
                    );
                    break;
                }

                // Reset restart count on successful restart with verification
                {
                    let mut counts = restart_counts.lock().await;
                    if let Some(count) = counts.get_mut(&name) {
                        if *count > 0 {
                            log::info!(
                                "MCP server {} restarted successfully, resetting restart count from {} to 0.",
                                name,
                                *count
                            );
                            *count = 0;
                        }
                    }
                }

                // Monitor the server again
                let quit_reason =
                    monitor_mcp_server_handle(servers_state.clone(), name.clone()).await;

                log::info!("MCP server {} quit with reason: {:?}", name, quit_reason);

                // Check if server was marked as successfully connected
                let was_connected = {
                    let connected = successfully_connected.lock().await;
                    connected.get(&name).copied().unwrap_or(false)
                };

                // Only continue restart loop if server was previously connected
                if !was_connected {
                    log::error!(
                        "MCP server {} failed before establishing successful connection - stopping permanently",
                        name
                    );
                    break;
                }

                // Determine if we should restart based on quit reason
                let should_restart = match quit_reason {
                    Some(reason) => {
                        log::warn!("MCP server {} terminated unexpectedly: {:?}", name, reason);
                        true
                    }
                    None => {
                        log::info!("MCP server {} was manually stopped - not restarting", name);
                        false
                    }
                };

                if !should_restart {
                    break;
                }
                // Continue the loop for another restart attempt
            }
            Err(e) => {
                log::error!("Failed to restart MCP server {}: {}", name, e);

                // Check if server was marked as successfully connected before
                let was_connected = {
                    let connected = successfully_connected.lock().await;
                    connected.get(&name).copied().unwrap_or(false)
                };

                // Only continue restart attempts if server was previously connected
                if !was_connected {
                    log::error!(
                        "MCP server {} failed restart and was never successfully connected - stopping permanently",
                        name
                    );
                    break;
                }
                // Continue the loop for another restart attempt
            }
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
            },
        };
        let client = client_info.serve(transport).await.inspect_err(|e| {
            log::error!("client error: {:?}", e);
        });

        match client {
            Ok(client) => {
                log::info!("Connected to server: {:?}", client.peer_info());
                servers
                    .lock()
                    .await
                    .insert(name.clone(), RunningServiceEnum::WithInit(client));

                // Mark server as successfully connected (for restart policy)
                {
                    let app_state = app.state::<AppState>();
                    let mut connected = app_state.mcp_successfully_connected.lock().await;
                    connected.insert(name.clone(), true);
                    log::info!("Marked MCP server {} as successfully connected", name);
                }
            }
            Err(e) => {
                log::error!("Failed to connect to server: {}", e);
                return Err(format!("Failed to connect to server: {}", e));
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
            log::error!("transport error: {:?}", e);
            format!("Failed to start SSE transport: {}", e)
        })?;

        let client_info = ClientInfo {
            protocol_version: Default::default(),
            capabilities: ClientCapabilities::default(),
            client_info: Implementation {
                name: "Jan SSE Client".to_string(),
                version: "0.0.1".to_string(),
            },
        };
        let client = client_info.serve(transport).await.map_err(|e| {
            log::error!("client error: {:?}", e);
            e.to_string()
        });

        match client {
            Ok(client) => {
                log::info!("Connected to server: {:?}", client.peer_info());
                servers
                    .lock()
                    .await
                    .insert(name.clone(), RunningServiceEnum::WithInit(client));

                // Mark server as successfully connected (for restart policy)
                {
                    let app_state = app.state::<AppState>();
                    let mut connected = app_state.mcp_successfully_connected.lock().await;
                    connected.insert(name.clone(), true);
                    log::info!("Marked MCP server {} as successfully connected", name);
                }
            }
            Err(e) => {
                log::error!("Failed to connect to server: {}", e);
                return Err(format!("Failed to connect to server: {}", e));
            }
        }
    } else {
        let mut cmd = Command::new(config_params.command.clone());
        if config_params.command.clone() == "npx" && can_override_npx() {
            let mut cache_dir = app_path.clone();
            cache_dir.push(".npx");
            let bun_x_path = format!("{}/bun", bin_path.display());
            cmd = Command::new(bun_x_path);
            cmd.arg("x");
            cmd.env("BUN_INSTALL", cache_dir.to_str().unwrap().to_string());
        }
        if config_params.command.clone() == "uvx" {
            let mut cache_dir = app_path.clone();
            cache_dir.push(".uvx");
            let bun_x_path = format!("{}/uv", bin_path.display());
            cmd = Command::new(bun_x_path);
            cmd.arg("tool");
            cmd.arg("run");
            cmd.env("UV_CACHE_DIR", cache_dir.to_str().unwrap().to_string());
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

        let service = ()
            .serve(process)
            .await
            .map_err(|e| format!("Failed to start MCP server {name}: {e}"));

        match service {
            Ok(server) => {
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
            return Err(format!(
                "MCP server {} quit immediately after starting",
                name
            ));
        }
        // Mark server as successfully connected (for restart policy)
        {
            let app_state = app.state::<AppState>();
            let mut connected = app_state.mcp_successfully_connected.lock().await;
            connected.insert(name.clone(), true);
            log::info!("Marked MCP server {} as successfully connected", name);
        }
    }
    Ok(())
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
        log::info!("Restarting MCP server: {}", name);

        // Start server with restart monitoring - spawn async task
        let app_clone = app.clone();
        let servers_clone = servers_state.clone();
        let name_clone = name.clone();
        let config_clone = config.clone();

        tauri::async_runtime::spawn(async move {
            let _ = start_mcp_server_with_restart(
                app_clone,
                servers_clone,
                name_clone,
                config_clone,
                Some(3), // Default max restarts for startup
            )
            .await;
        });
    }

    Ok(())
}

pub async fn clean_up_mcp_servers(state: State<'_, AppState>) {
    log::info!("Cleaning up MCP servers");

    // Stop all running MCP servers
    let _ = stop_mcp_servers(state.mcp_servers.clone()).await;

    // Clear active servers and restart counts
    {
        let mut active_servers = state.mcp_active_servers.lock().await;
        active_servers.clear();
    }
    {
        let mut restart_counts = state.mcp_restart_counts.lock().await;
        restart_counts.clear();
    }
    log::info!("MCP servers cleaned up successfully");
}

pub async fn stop_mcp_servers(servers_state: SharedMcpServers) -> Result<(), String> {
    let mut servers_map = servers_state.lock().await;
    let keys: Vec<String> = servers_map.keys().cloned().collect();
    for key in keys {
        if let Some(service) = servers_map.remove(&key) {
            match service {
                RunningServiceEnum::NoInit(service) => {
                    log::info!("Stopping server {key}...");
                    service.cancel().await.map_err(|e| e.to_string())?;
                }
                RunningServiceEnum::WithInit(service) => {
                    log::info!("Stopping server {key} with initialization...");
                    service.cancel().await.map_err(|e| e.to_string())?;
                }
            }
        }
    }
    drop(servers_map); // Release the lock after stopping
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

/// Reset restart count for a server
pub async fn reset_restart_count(restart_counts: &Arc<Mutex<HashMap<String, u32>>>, name: &str) {
    let mut counts = restart_counts.lock().await;
    counts.insert(name.to_string(), 0);
}

/// Spawn the server monitoring task for handling restarts
pub async fn spawn_server_monitoring_task<R: Runtime>(
    app: AppHandle<R>,
    servers_state: SharedMcpServers,
    name: String,
    config: Value,
    max_restarts: u32,
    restart_counts: Arc<Mutex<HashMap<String, u32>>>,
    successfully_connected: Arc<Mutex<HashMap<String, bool>>>,
) {
    let app_clone = app.clone();
    let servers_clone = servers_state.clone();
    let name_clone = name.clone();
    let config_clone = config.clone();

    tauri::async_runtime::spawn(async move {
        // Monitor the server using RunningService's JoinHandle<QuitReason>
        let quit_reason =
            monitor_mcp_server_handle(servers_clone.clone(), name_clone.clone()).await;

        log::info!(
            "MCP server {} quit with reason: {:?}",
            name_clone,
            quit_reason
        );

        // Check if we should restart based on connection status and quit reason
        if should_restart_server(&successfully_connected, &name_clone, &quit_reason).await {
            // Start the restart loop
            start_restart_loop(
                app_clone,
                servers_clone,
                name_clone,
                config_clone,
                max_restarts,
                restart_counts,
                successfully_connected,
            )
            .await;
        }
    });
}

/// Determine if a server should be restarted based on its connection status and quit reason
pub async fn should_restart_server(
    successfully_connected: &Arc<Mutex<HashMap<String, bool>>>,
    name: &str,
    quit_reason: &Option<rmcp::service::QuitReason>,
) -> bool {
    // Check if server was marked as successfully connected
    let was_connected = {
        let connected = successfully_connected.lock().await;
        connected.get(name).copied().unwrap_or(false)
    };

    // Only restart if server was previously connected
    if !was_connected {
        log::error!(
            "MCP server {} failed before establishing successful connection - stopping permanently",
            name
        );
        return false;
    }

    // Determine if we should restart based on quit reason
    match quit_reason {
        Some(reason) => {
            log::warn!("MCP server {} terminated unexpectedly: {:?}", name, reason);
            true
        }
        None => {
            log::info!("MCP server {} was manually stopped - not restarting", name);
            false
        }
    }
}
