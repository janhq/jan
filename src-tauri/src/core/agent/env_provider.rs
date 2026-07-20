//! Env-var-driven upstream injection shared by the CLI and desktop agent paths.
//!
//! `JAN_AGENT_API_KEY` + `JAN_AGENT_BASE_URL` synthesize a `jan-agent-custom`
//! provider so an agent can reach an upstream without a pre-registered remote
//! provider; `JAN_AGENT_MODEL_ID` seeds its model list. Both entry points
//! (`cli::providers::load_provider_configs` and the desktop `agent_run` command)
//! call [`inject_env_provider`] so resolution is identical.

use std::collections::HashMap;

use crate::core::state::ProviderConfig;

/// Environment variable for the Jan Agent custom provider API key.
pub(crate) const ENV_AGENT_API_KEY: &str = "JAN_AGENT_API_KEY";

/// Environment variable for the Jan Agent custom provider base URL.
pub(crate) const ENV_AGENT_BASE_URL: &str = "JAN_AGENT_BASE_URL";

/// Environment variable that overrides the agent model id (highest priority).
pub(crate) const ENV_AGENT_MODEL_ID: &str = "JAN_AGENT_MODEL_ID";

/// Synthetic provider name injected when the env vars are present.
pub(crate) const ENV_AGENT_PROVIDER: &str = "jan-agent-custom";

/// Read `JAN_AGENT_MODEL_ID`, trimmed and non-empty.
pub(crate) fn env_model_id() -> Option<String> {
    std::env::var(ENV_AGENT_MODEL_ID)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Inject a synthetic `jan-agent-custom` provider from `JAN_AGENT_API_KEY` and
/// `JAN_AGENT_BASE_URL` when both are set and non-empty. `model_id` seeds the
/// provider's model list (from the request body or `JAN_AGENT_MODEL_ID`) so
/// `resolve_upstream_for_model` can find it. No-op when either var is missing.
pub(crate) fn inject_env_provider(
    configs: &mut HashMap<String, ProviderConfig>,
    model_id: Option<&str>,
) {
    let Ok(api_key) = std::env::var(ENV_AGENT_API_KEY) else {
        return;
    };
    let Ok(base_url) = std::env::var(ENV_AGENT_BASE_URL) else {
        return;
    };
    inject_env_provider_inner(configs, model_id, &api_key, &base_url);
}

/// Value-injected version of [`inject_env_provider`], testable without touching
/// the process environment.
pub(crate) fn inject_env_provider_inner(
    configs: &mut HashMap<String, ProviderConfig>,
    model_id: Option<&str>,
    api_key: &str,
    base_url: &str,
) {
    let api_key = api_key.trim().to_string();
    let base_url = base_url.trim().trim_end_matches('/').to_string();
    if api_key.is_empty() || base_url.is_empty() {
        return;
    }
    let models = model_id
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .map(|m| vec![m.to_string()])
        .unwrap_or_default();
    configs.insert(
        ENV_AGENT_PROVIDER.to_string(),
        ProviderConfig {
            provider: ENV_AGENT_PROVIDER.to_string(),
            api_key: Some(api_key),
            api_keys: Vec::new(),
            base_url: Some(base_url.clone()),
            custom_headers: Vec::new(),
            models: models.clone(),
            api_type: None,
        },
    );
    // Direct model_id -> provider alias so lookup succeeds even when the model
    // string isn't listed in any provider's `models` field. Never clobbers an
    // existing entry for that model.
    if let Some(mid) = models.first().filter(|m| *m != ENV_AGENT_PROVIDER) {
        if !configs.contains_key(mid) {
            configs.insert(
                mid.clone(),
                ProviderConfig {
                    provider: ENV_AGENT_PROVIDER.to_string(),
                    api_key: None,
                    api_keys: Vec::new(),
                    base_url: Some(base_url.clone()),
                    custom_headers: Vec::new(),
                    models,
                    api_type: None,
                },
            );
        }
    }
    log::info!(
        "Agent: injected env-var provider '{}' pointing at {}",
        ENV_AGENT_PROVIDER,
        base_url
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_when_missing() {
        let mut configs = HashMap::new();
        inject_env_provider_inner(&mut configs, None, "", "");
        assert!(configs.is_empty());
    }

    #[test]
    fn skips_when_only_one_var_set() {
        let mut configs = HashMap::new();
        inject_env_provider_inner(&mut configs, None, "sk-abc", "");
        assert!(configs.is_empty());
    }

    #[test]
    fn skips_when_empty() {
        let mut configs = HashMap::new();
        inject_env_provider_inner(&mut configs, None, "", "https://example.com");
        assert!(configs.is_empty());
    }

    #[test]
    fn creates_entry_without_model() {
        let mut configs = HashMap::new();
        inject_env_provider_inner(
            &mut configs,
            None,
            "sk-secret",
            "https://api.custom.example.com/v1/",
        );
        let cfg = configs.get("jan-agent-custom").expect("entry created");
        assert_eq!(cfg.api_key.as_deref(), Some("sk-secret"));
        assert_eq!(
            cfg.base_url.as_deref(),
            Some("https://api.custom.example.com/v1")
        );
        assert_eq!(cfg.provider, "jan-agent-custom");
        assert!(cfg.models.is_empty());
        assert!(!configs.contains_key("sk-secret"));
    }

    #[test]
    fn creates_entry_with_model() {
        let mut configs = HashMap::new();
        inject_env_provider_inner(
            &mut configs,
            Some("gpt-4o"),
            "sk-secret",
            "https://api.custom.example.com/v1/",
        );
        let cfg = configs.get("jan-agent-custom").expect("entry created");
        assert_eq!(cfg.models, vec!["gpt-4o".to_string()]);
        let alias = configs.get("gpt-4o").expect("alias entry created");
        assert_eq!(alias.provider, "jan-agent-custom");
        assert_eq!(
            alias.base_url.as_deref(),
            Some("https://api.custom.example.com/v1")
        );
    }

    #[test]
    fn trims_trailing_slash() {
        let mut configs = HashMap::new();
        inject_env_provider_inner(&mut configs, None, "sk-key", "https://api.example.com/v1///");
        let cfg = configs.get("jan-agent-custom").expect("entry created");
        assert_eq!(cfg.base_url.as_deref(), Some("https://api.example.com/v1"));
    }

    #[test]
    fn overwrites_existing_entry() {
        let mut configs = HashMap::new();
        configs.insert(
            "jan-agent-custom".to_string(),
            ProviderConfig {
                provider: "jan-agent-custom".to_string(),
                api_key: Some("sk-old".to_string()),
                api_keys: vec!["sk-old".to_string()],
                base_url: Some("https://old.url".to_string()),
                custom_headers: Vec::new(),
                models: Vec::new(),
                api_type: None,
            },
        );
        inject_env_provider_inner(&mut configs, None, "sk-env", "https://env.url");
        let cfg = configs.get("jan-agent-custom").expect("entry exists");
        assert_eq!(cfg.api_key.as_deref(), Some("sk-env"));
        assert_eq!(cfg.base_url.as_deref(), Some("https://env.url"));
    }

    #[test]
    fn trims_whitespace() {
        let mut configs = HashMap::new();
        inject_env_provider_inner(
            &mut configs,
            None,
            "  sk-key  ",
            "  https://api.example.com/v1  ",
        );
        let cfg = configs.get("jan-agent-custom").expect("entry created");
        assert_eq!(cfg.api_key.as_deref(), Some("sk-key"));
        assert_eq!(cfg.base_url.as_deref(), Some("https://api.example.com/v1"));
    }

    #[test]
    fn model_id_alias_does_not_clobber_existing() {
        let mut configs = HashMap::new();
        configs.insert(
            "gpt-4o".to_string(),
            ProviderConfig {
                provider: "openai".to_string(),
                api_key: Some("sk-existing".to_string()),
                api_keys: vec!["sk-existing".to_string()],
                base_url: Some("https://existing.url".to_string()),
                custom_headers: Vec::new(),
                models: vec!["gpt-4o".to_string()],
                api_type: None,
            },
        );
        inject_env_provider_inner(&mut configs, Some("gpt-4o"), "sk-env", "https://env.url");
        let alias = configs.get("gpt-4o").expect("alias still exists");
        assert_eq!(alias.provider, "openai");
        assert_eq!(alias.api_key.as_deref(), Some("sk-existing"));
        let main = configs.get("jan-agent-custom").expect("main entry");
        assert_eq!(main.models, vec!["gpt-4o".to_string()]);
    }
}
