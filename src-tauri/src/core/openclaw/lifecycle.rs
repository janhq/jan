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
/// Handles: config patching, sandbox start, health check, state update.
pub async fn start_openclaw(
    sandbox: &dyn Sandbox,
    config: &SandboxConfig,
    state: &OpenClawState,
) -> Result<(), String> {
    // 1. Ensure config directory has secure permissions
    ensure_secure_config_permissions(&config.config_dir).await?;

    // 2. Patch config if needed for this sandbox type
    patch_config_for_sandbox(sandbox, &config.config_dir)?;

    // 3. Start the sandbox
    let handle = sandbox.start(config).await?;

    // 4. Wait for the gateway to become responsive
    wait_for_port(config.port, Duration::from_secs(30)).await?;

    // 5. Update state
    let mut mode = state.sandbox_mode.lock().await;
    *mode = SandboxMode::Active {
        sandbox_name: sandbox.name().to_string(),
        isolation_tier: sandbox.isolation_tier(),
        handle,
    };

    log::info!(
        "OpenClaw started successfully via {} (tier: {})",
        sandbox.name(),
        sandbox.isolation_tier()
    );

    Ok(())
}

/// Stop OpenClaw regardless of which sandbox type is in use.
pub async fn stop_openclaw(
    sandbox: &dyn Sandbox,
    state: &OpenClawState,
) -> Result<(), String> {
    let mut mode = state.sandbox_mode.lock().await;
    if let SandboxMode::Active {
        ref mut handle, ..
    } = *mode
    {
        sandbox.stop(handle).await?;
    }
    *mode = SandboxMode::Inactive;

    // Wait for the port to actually be released
    for i in 0..10 {
        if !is_port_in_use(OPENCLAW_PORT).await {
            log::info!(
                "OpenClaw stopped successfully (port released after {} checks)",
                i + 1
            );
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
            // Even if we think we're inactive, check if the gateway happens to be running
            // (e.g., started externally or from a previous Jan session)
            if is_port_in_use(OPENCLAW_PORT).await {
                Ok((SandboxStatus::Running, None, None))
            } else {
                Ok((SandboxStatus::Stopped, None, None))
            }
        }
    }
}

/// Shared health check: poll a port until it responds or timeout.
pub async fn wait_for_port(port: u16, timeout: Duration) -> Result<(), String> {
    let start = tokio::time::Instant::now();
    let interval = Duration::from_millis(500);

    loop {
        if is_port_in_use(port).await {
            log::info!("Port {} is now responding", port);
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

/// Check if a port has something listening (TCP connect succeeds).
pub async fn is_port_in_use(port: u16) -> bool {
    tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port))
        .await
        .is_ok()
}

/// Patch OpenClaw config based on the sandbox type using proper JSON parsing.
/// Docker needs different API URLs and bind mode; direct process uses localhost.
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
            // Docker: container reaches Jan host via host.docker.internal
            // Bind to "lan" so Docker port mapping works
            (constants::DOCKER_JAN_BASE_URL, constants::DOCKER_BIND_MODE)
        }
        IsolationTier::PlatformSandbox | IsolationTier::None => {
            // Direct process / platform sandbox: same host, use localhost
            (constants::DEFAULT_JAN_BASE_URL, constants::DEFAULT_BIND_MODE)
        }
    };

    let mut modified = false;

    // Patch gateway.bind
    if let Some(bind) = config.pointer_mut("/gateway/bind") {
        if bind.as_str() != Some(target_bind) {
            *bind = serde_json::json!(target_bind);
            modified = true;
        }
    }

    // Patch models.providers.jan.baseUrl
    if let Some(base_url) = config.pointer_mut("/models/providers/jan/baseUrl") {
        if base_url.as_str() != Some(target_base_url) {
            *base_url = serde_json::json!(target_base_url);
            modified = true;
        }
    }

    if modified {
        let updated = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        std::fs::write(&config_path, updated)
            .map_err(|e| format!("Failed to write config: {}", e))?;
        log::info!(
            "Patched OpenClaw config for {} sandbox (bind={}, baseUrl={})",
            sandbox.name(),
            target_bind,
            target_base_url
        );
    }

    Ok(())
}
