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
    pub base_url: Option<String>,
    pub custom_headers: Vec<ProviderCustomHeader>,
    pub models: Vec<String>,
}

fn resolve_provider_api_key(provider: &str, api_key: Option<String>) -> Option<String> {
    // 1. Use explicit API key if provided
    let normalized_key = api_key.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });

    if normalized_key.is_some() {
        return normalized_key;
    }

    // 2. Fall back to {PROVIDER}_API_KEY environment variable (works for all providers)
    let env_var_name = format!("{}_API_KEY", provider.to_uppercase());
    std::env::var(&env_var_name)
        .ok()
        .and_then(|value| {
            let trimmed = value.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
}

/// Register a remote provider configuration
#[tauri::command]
pub async fn register_provider_config(
    state: State<'_, AppState>,
    request: RegisterProviderRequest,
) -> Result<(), String> {
    let provider_configs = state.provider_configs.clone();
    let mut configs = provider_configs.lock().await;

    let config = ProviderConfig {
        provider: request.provider.clone(),
        api_key: resolve_provider_api_key(&request.provider, request.api_key),
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

#[cfg(test)]
mod tests {
    use super::resolve_provider_api_key;

    #[test]
    fn keeps_explicit_api_key() {
        let resolved = resolve_provider_api_key("novita", Some("explicit-key".to_string()));
        assert_eq!(resolved, Some("explicit-key".to_string()));
    }

    #[test]
    fn uses_provider_env_key_when_api_key_missing() {
        std::env::set_var("NOVITA_API_KEY", "novita-env-key");
        let resolved = resolve_provider_api_key("novita", None);
        std::env::remove_var("NOVITA_API_KEY");
        assert_eq!(resolved, Some("novita-env-key".to_string()));
    }

    #[test]
    fn uses_openai_env_key_for_openai() {
        std::env::set_var("OPENAI_API_KEY", "openai-env-key");
        let resolved = resolve_provider_api_key("openai", None);
        std::env::remove_var("OPENAI_API_KEY");
        assert_eq!(resolved, Some("openai-env-key".to_string()));
    }

    #[test]
    fn does_not_cross_use_env_keys() {
        std::env::set_var("NOVITA_API_KEY", "novita-env-key");
        let resolved = resolve_provider_api_key("openai", None);
        std::env::remove_var("NOVITA_API_KEY");
        assert_eq!(resolved, None);
    }
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
        log::warn!("Provider config not found: {provider}");
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
