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
    patch_config_for_sandbox(sandbox, &config.config_dir)?;
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
            // Mode is Inactive but the gateway may still be running (e.g. mode was
            // reset by a status check). Always attempt to stop via a dummy handle.
            if is_port_in_use(OPENCLAW_PORT).await {
                log::info!("Gateway still on port {}, stopping via sandbox", OPENCLAW_PORT);
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

/// Patch OpenClaw config for the sandbox type (bind mode and API baseUrl).
pub fn patch_config_for_sandbox(sandbox: &dyn Sandbox, config_dir: &Path) -> Result<(), String> {
    use super::constants;

    let config_path = config_dir.join("openclaw.json");
    if !config_path.exists() {
        return Ok(());
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;

    let mut config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    let (target_base_url, target_bind) = match sandbox.isolation_tier() {
        IsolationTier::FullContainer => {
            (constants::DOCKER_JAN_BASE_URL, constants::DOCKER_BIND_MODE)
        }
        IsolationTier::PlatformSandbox | IsolationTier::None => {
            (constants::DEFAULT_JAN_BASE_URL, constants::DEFAULT_BIND_MODE)
        }
    };

    let mut modified = false;

    if let Some(bind) = config.pointer_mut("/gateway/bind") {
        if bind.as_str() != Some(target_bind) {
            *bind = serde_json::json!(target_bind);
            modified = true;
        }
    }

    if let Some(base_url) = config.pointer_mut("/models/providers/jan/baseUrl") {
        if base_url.as_str() != Some(target_base_url) {
            *base_url = serde_json::json!(target_base_url);
            modified = true;
        }
    }

    // Patch WhatsApp authDir — host paths don't exist inside Docker and vice versa
    let target_wa_auth_dir = match sandbox.isolation_tier() {
        IsolationTier::FullContainer => "/home/node/.openclaw/whatsapp_auth".to_string(),
        _ => config_dir.join("whatsapp_auth").to_string_lossy().into_owned(),
    };
    if let Some(auth_dir) = config.pointer_mut("/channels/whatsapp/accounts/default/authDir") {
        if auth_dir.as_str() != Some(&target_wa_auth_dir) {
            *auth_dir = serde_json::json!(target_wa_auth_dir);
            modified = true;
        }
    }

    if modified {
        let updated = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        std::fs::write(&config_path, updated)
            .map_err(|e| format!("Failed to write config: {}", e))?;
        log::info!("Patched config for {} sandbox", sandbox.name());
    }

    Ok(())
}
