//! Cloud provider credential loader for the CLI.
//!
//! The desktop app never persists provider configs from Rust: the frontend
//! holds them in a zustand store mirrored to `<jan_data>/settings.json` under
//! the `"model-provider"` key (a stringified `{"state":{"providers":[...]}}`
//! blob). The CLI has no `AppHandle` and no in-memory store, so it reconstructs
//! `ProviderConfig`s by reading that file directly, then layers CLI/env
//! overrides on top.

use std::collections::HashMap;

use crate::core::app::commands::resolve_jan_data_folder;
use crate::core::state::ProviderConfig;

const MODEL_PROVIDER_KEY: &str = "model-provider";
const API_KEY_SETTING_KEYS: [&str; 2] = ["api-key", "api_key"];

/// CLI/env overrides applied after loading the persisted store.
#[derive(Debug, Default, Clone)]
pub struct ProviderOverrides {
    /// Restrict/target a single provider (e.g. `anthropic`).
    pub provider: Option<String>,
    /// API key to inject for `provider` (or all providers when `provider` is None).
    pub api_key: Option<String>,
}

impl ProviderOverrides {
    /// Fold in environment fallbacks for the API key when not set explicitly.
    /// `JAN_API_KEY` wins, then a provider-specific var (`ANTHROPIC_API_KEY`,
    /// `OPENAI_API_KEY`, ...) when a provider is targeted.
    pub fn with_env(mut self) -> Self {
        if self.api_key.is_none() {
            if let Ok(k) = std::env::var("JAN_API_KEY") {
                if !k.is_empty() {
                    self.api_key = Some(k);
                }
            }
        }
        if self.api_key.is_none() {
            if let Some(provider) = &self.provider {
                let var = format!("{}_API_KEY", provider.to_ascii_uppercase());
                if let Ok(k) = std::env::var(&var) {
                    if !k.is_empty() {
                        self.api_key = Some(k);
                    }
                }
            }
        }
        self
    }
}

/// Load cloud provider configs from the persisted desktop store, applying
/// `overrides`. A missing/malformed store is not fatal: it yields an empty map
/// so `--provider`/`--api-key`/env can still stand up a config on their own.
///
/// Secrets no longer live in `settings.json` (moved to the OS keyring /
/// encrypted fallback file by #8388), so keys are seeded from
/// `provider_secrets::load_provider_keys` before overrides are applied.
pub fn load_provider_configs(
    overrides: &ProviderOverrides,
) -> Result<HashMap<String, ProviderConfig>, String> {
    let path = resolve_jan_data_folder().join("settings.json");
    let mut configs = match std::fs::read_to_string(&path) {
        Ok(raw) => parse_provider_store(&raw),
        Err(_) => HashMap::new(),
    };
    seed_keys_from_store(&mut configs, |p| {
        crate::core::server::provider_secrets::load_provider_keys(p)
    });
    apply_overrides(&mut configs, overrides);
    Ok(configs)
}

/// Seed each config's key chain from the secret store when the settings blob
/// carried no key. `load` is injected for testability. Explicit `--api-key`/env
/// overrides run afterward and still win.
fn seed_keys_from_store(
    configs: &mut HashMap<String, ProviderConfig>,
    load: impl Fn(&str) -> Vec<String>,
) {
    for (name, cfg) in configs.iter_mut() {
        if cfg.api_key.is_some() {
            continue;
        }
        let keys = load(name);
        if !keys.is_empty() {
            cfg.api_key = keys.first().cloned();
            cfg.api_keys = keys;
        }
    }
}

/// Parse the `settings.json` body into provider configs. Tolerant of shape
/// drift: anything it cannot read is skipped rather than erroring.
fn parse_provider_store(raw: &str) -> HashMap<String, ProviderConfig> {
    let root: serde_json::Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return HashMap::new(),
    };

    // The store value is itself a JSON string ("{\"state\":{...}}").
    let blob = match root.get(MODEL_PROVIDER_KEY).and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return HashMap::new(),
    };
    let parsed: serde_json::Value = match serde_json::from_str(blob) {
        Ok(v) => v,
        Err(_) => return HashMap::new(),
    };
    let providers = parsed
        .get("state")
        .and_then(|s| s.get("providers"))
        .and_then(|p| p.as_array());
    let providers = match providers {
        Some(p) => p,
        None => return HashMap::new(),
    };

    let mut out = HashMap::new();
    for p in providers {
        if let Some(cfg) = provider_from_json(p) {
            out.insert(cfg.provider.clone(), cfg);
        }
    }
    out
}

fn provider_from_json(p: &serde_json::Value) -> Option<ProviderConfig> {
    let provider = p.get("provider").and_then(|v| v.as_str())?.to_string();

    let base_url = p
        .get("base_url")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);

    let api_key = p
        .get("settings")
        .and_then(|s| s.as_array())
        .and_then(|settings| {
            settings.iter().find_map(|s| {
                let key = s.get("key").and_then(|k| k.as_str())?;
                if !API_KEY_SETTING_KEYS.contains(&key) {
                    return None;
                }
                s.get("controller_props")
                    .and_then(|c| c.get("value"))
                    .and_then(|v| v.as_str())
                    .filter(|v| !v.is_empty())
                    .map(String::from)
            })
        });

    let models = p
        .get("models")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let api_type = p
        .get("api_type")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from);

    Some(ProviderConfig {
        provider,
        api_keys: api_key.iter().cloned().collect(),
        api_key,
        base_url,
        custom_headers: Vec::new(),
        models,
        api_type,
    })
}

/// Inject the override API key into the targeted provider(s). When a provider
/// is named but absent from the store, a minimal config is synthesized so the
/// CLI can reach it purely from flags/env.
fn apply_overrides(configs: &mut HashMap<String, ProviderConfig>, overrides: &ProviderOverrides) {
    let Some(api_key) = &overrides.api_key else {
        return;
    };
    match &overrides.provider {
        Some(provider) => {
            let cfg = configs
                .entry(provider.clone())
                .or_insert_with(|| ProviderConfig {
                    provider: provider.clone(),
                    api_key: None,
                    api_keys: Vec::new(),
                    base_url: None,
                    custom_headers: Vec::new(),
                    models: Vec::new(),
                    api_type: None,
                });
            set_key(cfg, api_key);
        }
        None => {
            for cfg in configs.values_mut() {
                set_key(cfg, api_key);
            }
        }
    }
}

fn set_key(cfg: &mut ProviderConfig, api_key: &str) {
    cfg.api_key = Some(api_key.to_string());
    cfg.api_keys = vec![api_key.to_string()];
}

#[cfg(test)]
mod tests {
    use super::*;

    const STORE: &str = r#"{"setting-general":{"x":1},"model-provider":"{\"state\":{\"providers\":[{\"provider\":\"anthropic\",\"base_url\":\"https://api.anthropic.com/v1\",\"settings\":[{\"key\":\"api-key\",\"controller_props\":{\"value\":\"sk-ant-123\"}}],\"models\":[{\"id\":\"claude-sonnet-4-5\"},{\"id\":\"claude-opus-4\"}]},{\"provider\":\"openai\",\"base_url\":\"https://api.openai.com/v1\",\"settings\":[{\"key\":\"api-key\",\"controller_props\":{\"value\":\"\"}}],\"models\":[{\"id\":\"gpt-4o\"}]}]}}"}"#;

    #[test]
    fn parses_provider_with_key_base_url_and_models() {
        let configs = parse_provider_store(STORE);
        let anthropic = configs.get("anthropic").expect("anthropic present");
        assert_eq!(anthropic.api_key.as_deref(), Some("sk-ant-123"));
        assert_eq!(anthropic.api_keys, vec!["sk-ant-123".to_string()]);
        assert_eq!(
            anthropic.base_url.as_deref(),
            Some("https://api.anthropic.com/v1")
        );
        assert!(anthropic.models.iter().any(|m| m == "claude-sonnet-4-5"));
    }

    #[test]
    fn empty_api_key_becomes_none() {
        let configs = parse_provider_store(STORE);
        let openai = configs.get("openai").expect("openai present");
        assert_eq!(openai.api_key, None);
        assert!(openai.api_keys.is_empty());
    }

    #[test]
    fn malformed_store_yields_empty_map() {
        assert!(parse_provider_store("not json").is_empty());
        assert!(parse_provider_store(r#"{"model-provider":"not json"}"#).is_empty());
        assert!(parse_provider_store(r#"{"other":1}"#).is_empty());
    }

    #[test]
    fn override_injects_key_into_named_provider() {
        let mut configs = parse_provider_store(STORE);
        let ov = ProviderOverrides {
            provider: Some("openai".to_string()),
            api_key: Some("sk-new".to_string()),
        };
        apply_overrides(&mut configs, &ov);
        let openai = configs.get("openai").unwrap();
        assert_eq!(openai.api_key.as_deref(), Some("sk-new"));
        assert_eq!(openai.api_keys, vec!["sk-new".to_string()]);
    }

    #[test]
    fn override_synthesizes_absent_provider() {
        let mut configs = HashMap::new();
        let ov = ProviderOverrides {
            provider: Some("anthropic".to_string()),
            api_key: Some("sk-ant".to_string()),
        };
        apply_overrides(&mut configs, &ov);
        assert_eq!(
            configs.get("anthropic").and_then(|c| c.api_key.as_deref()),
            Some("sk-ant")
        );
    }

    #[test]
    fn override_without_provider_sets_all() {
        let mut configs = parse_provider_store(STORE);
        let ov = ProviderOverrides {
            provider: None,
            api_key: Some("shared".to_string()),
        };
        apply_overrides(&mut configs, &ov);
        assert!(configs
            .values()
            .all(|c| c.api_key.as_deref() == Some("shared")));
    }

    #[test]
    fn seed_fills_missing_key_from_store() {
        let mut configs = parse_provider_store(STORE);
        // openai has an empty key in the blob -> should be seeded.
        seed_keys_from_store(&mut configs, |p| match p {
            "openai" => vec!["sk-stored-1".to_string(), "sk-stored-2".to_string()],
            _ => Vec::new(),
        });
        let openai = configs.get("openai").unwrap();
        assert_eq!(openai.api_key.as_deref(), Some("sk-stored-1"));
        assert_eq!(
            openai.api_keys,
            vec!["sk-stored-1".to_string(), "sk-stored-2".to_string()]
        );
    }

    #[test]
    fn seed_does_not_clobber_existing_key() {
        let mut configs = parse_provider_store(STORE);
        // anthropic already has sk-ant-123 from the blob -> store must not win.
        seed_keys_from_store(&mut configs, |_| vec!["sk-should-not-apply".to_string()]);
        let anthropic = configs.get("anthropic").unwrap();
        assert_eq!(anthropic.api_key.as_deref(), Some("sk-ant-123"));
    }

    #[test]
    fn seed_empty_store_leaves_key_none() {
        let mut configs = parse_provider_store(STORE);
        seed_keys_from_store(&mut configs, |_| Vec::new());
        assert_eq!(configs.get("openai").unwrap().api_key, None);
    }

    #[test]
    fn no_override_is_noop() {
        let mut configs = parse_provider_store(STORE);
        apply_overrides(&mut configs, &ProviderOverrides::default());
        assert_eq!(
            configs.get("anthropic").and_then(|c| c.api_key.as_deref()),
            Some("sk-ant-123")
        );
    }
}
