use serde::{Deserialize, Serialize};
use tauri::State;

use crate::core::state::{AppState, ProviderConfig};

/// Custom header for provider requests
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCustomHeader {
    pub header: String,
    pub value: String,
}

/// Request to register/update a remote provider config
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterProviderRequest {
    pub provider: String,
    pub api_key: Option<String>,
    /// Additional keys (after `api_key`) when the upstream returns 401, 403, or 429.
    #[serde(default)]
    pub api_keys: Vec<String>,
    pub base_url: Option<String>,
    pub custom_headers: Vec<ProviderCustomHeader>,
    pub models: Vec<String>,
}

fn merge_register_api_keys(api_key: Option<String>, api_keys: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push_unique = |s: String| {
        let t = s.trim().to_string();
        if t.is_empty() {
            return;
        }
        if !out.iter().any(|x| x == &t) {
            out.push(t);
        }
    };
    if let Some(k) = api_key {
        push_unique(k);
    }
    for k in api_keys {
        push_unique(k);
    }
    out
}

/// Register a remote provider configuration
#[tauri::command]
pub async fn register_provider_config(
    state: State<'_, AppState>,
    request: RegisterProviderRequest,
) -> Result<(), String> {
    let provider_configs = state.provider_configs.clone();
    let mut configs = provider_configs.lock().await;

    let key_chain = merge_register_api_keys(request.api_key.clone(), request.api_keys.clone());
    let api_key = key_chain.first().cloned();

    let config = ProviderConfig {
        provider: request.provider.clone(),
        api_key,
        api_keys: key_chain,
        base_url: request.base_url,
        custom_headers: request
            .custom_headers
            .into_iter()
            .map(|h| crate::core::state::ProviderCustomHeader {
                header: h.header,
                value: h.value,
            })
            .collect(),
        models: request.models, // Models will be added when they are configured
    };

    let provider_name = request.provider.clone();
    configs.insert(provider_name.clone(), config);
    log::info!("Registered provider config: {provider_name}");
    Ok(())
}

/// Unregister a provider configuration
#[tauri::command]
pub async fn unregister_provider_config(
    state: State<'_, AppState>,
    provider: String,
) -> Result<(), String> {
    let provider_configs = state.provider_configs.clone();
    let mut configs = provider_configs.lock().await;

    if configs.remove(&provider).is_some() {
        log::info!("Unregistered provider config: {provider}");
        Ok(())
    } else {
        Ok(())
    }
}

/// Get provider configuration by name
#[tauri::command]
pub async fn get_provider_config(
    state: State<'_, AppState>,
    provider: String,
) -> Result<Option<ProviderConfig>, String> {
    let provider_configs = state.provider_configs.clone();
    let configs = provider_configs.lock().await;

    Ok(configs.get(&provider).cloned())
}

/// List all registered provider configurations (without sensitive keys)
#[tauri::command]
pub async fn list_provider_configs(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderConfig>, String> {
    let provider_configs = state.provider_configs.clone();
    let configs = provider_configs.lock().await;

    Ok(configs.values().cloned().collect())
}
