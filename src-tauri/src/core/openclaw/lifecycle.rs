use std::path::Path;
use std::time::Duration;

use super::sandbox::{
    IsolationTier, Sandbox, SandboxConfig, SandboxMode, SandboxStatus,
};
use super::security::ensure_secure_config_permissions;
use super::{get_openclaw_config_dir, OpenClawState, OPENCLAW_PORT};

/// Build a SandboxConfig from the current OpenClaw configuration.
pub fn build_sandbox_config(jan_api_url: &str) -> Result<SandboxConfig, String> {
    let config_dir = get_openclaw_config_dir()?;

    Ok(SandboxConfig {
        config_dir: config_dir.clone(),
        port: OPENCLAW_PORT,
        jan_api_url: jan_api_url.to_string(),
        env_vars: vec![(
            "OPENCLAW_CONFIG".into(),
            config_dir
                .join("openclaw.json")
                .to_string_lossy()
                .into_owned(),
        )],
    })
}

/// Start OpenClaw using the provided sandbox implementation.
pub async fn start_openclaw(
    sandbox: &dyn Sandbox,
    config: &SandboxConfig,
    state: &OpenClawState,
) -> Result<(), String> {
    ensure_secure_config_permissions(&config.config_dir).await?;
    let _ = patch_config_for_sandbox(sandbox, &config.config_dir)?;
    let handle = sandbox.start(config).await?;
    wait_for_port(config.port, Duration::from_secs(30)).await?;
    let mut mode = state.sandbox_mode.lock().await;
    *mode = SandboxMode::Active {
        sandbox_name: sandbox.name().to_string(),
        isolation_tier: sandbox.isolation_tier(),
        handle,
    };

    log::info!("OpenClaw started via {} (tier: {})", sandbox.name(), sandbox.isolation_tier());
    Ok(())
}

/// Stop OpenClaw regardless of which sandbox type is in use.
pub async fn stop_openclaw(
    sandbox: &dyn Sandbox,
    state: &OpenClawState,
) -> Result<(), String> {
    let mut mode = state.sandbox_mode.lock().await;
    match *mode {
        SandboxMode::Active {
            ref mut handle, ..
        } => {
            sandbox.stop(handle).await?;
        }
        SandboxMode::Inactive => {
            if is_port_in_use(OPENCLAW_PORT).await {
                let mut dummy = super::sandbox::SandboxHandle::Named("stop-fallback".to_string());
                sandbox.stop(&mut dummy).await?;
            }
        }
    }
    *mode = SandboxMode::Inactive;

    for _i in 0..10 {
        if !is_port_in_use(OPENCLAW_PORT).await {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    log::warn!("OpenClaw port may still be in use after stop");
    Ok(())
}

/// Get OpenClaw status using the sandbox.
pub async fn get_openclaw_status(
    sandbox: &dyn Sandbox,
    state: &OpenClawState,
) -> Result<(SandboxStatus, Option<String>, Option<IsolationTier>), String> {
    let mode = state.sandbox_mode.lock().await;

    match &*mode {
        SandboxMode::Active {
            sandbox_name,
            isolation_tier,
            handle,
        } => {
            let status = sandbox.status(handle).await?;
            Ok((
                status,
                Some(sandbox_name.clone()),
                Some(isolation_tier.clone()),
            ))
        }
        SandboxMode::Inactive => {
            if is_port_in_use(OPENCLAW_PORT).await {
                Ok((SandboxStatus::Running, None, None))
            } else {
                Ok((SandboxStatus::Stopped, None, None))
            }
        }
    }
}

/// Poll a port until it responds or timeout.
pub async fn wait_for_port(port: u16, timeout: Duration) -> Result<(), String> {
    let start = tokio::time::Instant::now();
    let interval = Duration::from_millis(500);

    loop {
        if is_port_in_use(port).await {
            return Ok(());
        }

        if start.elapsed() >= timeout {
            return Err(format!(
                "Timed out waiting for port {} to respond ({}s)",
                port,
                timeout.as_secs()
            ));
        }

        tokio::time::sleep(interval).await;
    }
}

/// Check if a port has something listening.
pub async fn is_port_in_use(port: u16) -> bool {
    tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port))
        .await
        .is_ok()
}

/// Patch OpenClaw config for the active sandbox: bind mode, Jan API baseUrl,
/// agent paths, and agent model URLs. Returns `true` if config was modified.
pub fn patch_config_for_sandbox(sandbox: &dyn Sandbox, config_dir: &Path) -> Result<bool, String> {
    use super::constants;

    let config_path = config_dir.join("openclaw.json");
    if !config_path.exists() {
        return Ok(false);
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;

    let mut config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    let mut modified = false;

    match sandbox.isolation_tier() {
        IsolationTier::FullContainer => {
            if let Some(bind) = config.pointer_mut("/gateway/bind") {
                if bind.as_str() != Some(constants::GATEWAY_BIND_MODE) {
                    *bind = serde_json::json!(constants::GATEWAY_BIND_MODE);
                    modified = true;
                }
            }
            if let Some(base_url) = config.pointer_mut("/models/providers/jan/baseUrl") {
                if base_url.as_str() != Some(constants::DOCKER_JAN_BASE_URL) {
                    *base_url = serde_json::json!(constants::DOCKER_JAN_BASE_URL);
                    modified = true;
                }
            }
        }
        IsolationTier::PlatformSandbox | IsolationTier::None => {
            if let Some(base_url) = config.pointer_mut("/models/providers/jan/baseUrl") {
                if base_url.as_str() != Some(constants::DEFAULT_JAN_BASE_URL) {
                    *base_url = serde_json::json!(constants::DEFAULT_JAN_BASE_URL);
                    modified = true;
                }
            }
        }
    }

    // Rewrite cross-mode agent paths (Docker ↔ host)
    let config_dir_str = config_dir.to_string_lossy();
    let docker_prefix = "/home/node/.openclaw/";
    let is_docker = matches!(sandbox.isolation_tier(), IsolationTier::FullContainer);

    if let Some(agents_list) = config.pointer_mut("/agents/list") {
        if let Some(arr) = agents_list.as_array_mut() {
            for agent in arr.iter_mut() {
                for field in &["workspace", "agentDir"] {
                    if let Some(val) = agent.get_mut(*field) {
                        if let Some(s) = val.as_str() {
                            if is_docker && !s.starts_with(docker_prefix) && s.contains("/.openclaw/") {
                                if let Some(pos) = s.find("/.openclaw/") {
                                    let suffix = &s[pos + "/.openclaw/".len()..];
                                    let new_path = format!("{}{}", docker_prefix, suffix);
                                    *val = serde_json::json!(new_path);
                                    modified = true;
                                }
                            } else if !is_docker && s.starts_with(docker_prefix) {
                                let suffix = &s[docker_prefix.len()..];
                                let new_path = format!("{}/{}", config_dir_str, suffix);
                                *val = serde_json::json!(new_path);
                                modified = true;
                            }
                        }
                    }
                }
            }
        }
    }

    if modified {
        let updated = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        std::fs::write(&config_path, updated)
            .map_err(|e| format!("Failed to write config: {}", e))?;
        log::info!("Patched config for {} sandbox", sandbox.name());
    }

    // Fix agent models.json baseUrl for current sandbox mode
    let target_base_url = if is_docker {
        constants::DOCKER_JAN_BASE_URL
    } else {
        constants::DEFAULT_JAN_BASE_URL
    };
    let wrong_base_url = if is_docker {
        constants::DEFAULT_JAN_BASE_URL
    } else {
        constants::DOCKER_JAN_BASE_URL
    };
    patch_agent_models_base_url(config_dir, target_base_url, wrong_base_url);

    Ok(modified)
}

/// Patch baseUrl in all `agents/*/agent/models.json` files for the current sandbox mode.
fn patch_agent_models_base_url(config_dir: &Path, target_url: &str, wrong_url: &str) {
    let agents_dir = config_dir.join("agents");
    if !agents_dir.exists() {
        return;
    }

    let entries = match std::fs::read_dir(&agents_dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let models_path = entry.path().join("agent").join("models.json");
        if !models_path.exists() {
            continue;
        }

        let content = match std::fs::read_to_string(&models_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        if !content.contains(wrong_url) {
            continue;
        }

        let updated = content.replace(wrong_url, target_url);
        if let Err(e) = std::fs::write(&models_path, &updated) {
            log::warn!("Failed to patch {}: {}", models_path.display(), e);
        }
    }
}
