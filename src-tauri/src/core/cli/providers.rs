//! Cloud provider credential loader for the CLI.
//!
//! Jan Agent runs standalone, without Jan Desktop, so provider config is
//! resolved from two `.jan` scopes rather than desktop's `settings.json`:
//!
//! 1. Global `~/.jan/config.toml` (user-wide, [`crate::core::agent::global_config`]) - the base.
//! 2. Desktop `settings.json`, if present, is layered in as an **inherit-only**
//!    additive source (never overwrites a Global entry, never written back to).
//! 3. Project-local `agent.toml` `[provider]` override
//!    ([`crate::core::agent::project::ProviderSection`]) - highest of the
//!    three, since it's an explicit per-project choice.
//! 4. `--provider`/`--api-key` CLI flags (+ `JAN_API_KEY`/`{PROVIDER}_API_KEY`
//!    env fallback via [`ProviderOverrides::with_env`]) win over all of the
//!    above - the most explicit, most ephemeral signal.

use std::collections::HashMap;
use std::time::Duration;

use crate::core::agent::global_config::load_global_config;
use crate::core::agent::project::ProviderSection;
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

/// The desktop app's current selection (`state.selectedProvider` /
/// `state.selectedModel.id` in the `model-provider` store), used to default the
/// CLI `--provider`/`--model` when the user gives none.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct DesktopSelection {
    pub provider: Option<String>,
    pub model: Option<String>,
}

/// Read the desktop's selected provider + model from `settings.json`. Missing or
/// malformed data yields an empty selection (no defaults applied).
pub fn desktop_selection() -> DesktopSelection {
    let path = resolve_jan_data_folder().join("settings.json");
    match std::fs::read_to_string(&path) {
        Ok(raw) => parse_selection(&raw),
        Err(_) => DesktopSelection::default(),
    }
}

/// Extract the selection from a `settings.json` body. Tolerant of shape drift.
fn parse_selection(raw: &str) -> DesktopSelection {
    let root: serde_json::Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return DesktopSelection::default(),
    };
    let blob = match root.get(MODEL_PROVIDER_KEY).and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return DesktopSelection::default(),
    };
    let parsed: serde_json::Value = match serde_json::from_str(blob) {
        Ok(v) => v,
        Err(_) => return DesktopSelection::default(),
    };
    let state = parsed.get("state");
    let non_empty = |v: Option<&serde_json::Value>| {
        v.and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
    };
    DesktopSelection {
        provider: non_empty(state.and_then(|s| s.get("selectedProvider"))),
        model: non_empty(state.and_then(|s| s.get("selectedModel").and_then(|m| m.get("id")))),
    }
}

/// Whether the CLI can actually reach this provider. A populated `base_url` is
/// an HTTP upstream; an empty one means a local engine (llamacpp, llamacpp-rs,
/// mlx) whose endpoint only exists after the desktop app spawns it. The CLI is
/// remote-only, so those entries are dead options and must not be offered.
/// Mirrors the resolution rule in `agent::upstream::resolve_upstream_for_model`,
/// whose local-engine branches are compiled out of this build.
pub fn is_cli_reachable(config: &ProviderConfig) -> bool {
    config.base_url.as_deref().is_some_and(|u| !u.is_empty())
}

/// Whether this install can run a turn at all: some provider is reachable and
/// either credentialed or local (a self-hosted endpoint - typically the desktop
/// app's API server - needs no key). `false` is the fresh-install state that
/// triggers the sign-in flow. A remote entry with no key does not count: the
/// request would only fail later with a 401.
pub fn has_usable_provider(project_root: Option<&std::path::Path>) -> bool {
    let overrides = ProviderOverrides::default().with_env();
    match load_provider_configs(project_root, &overrides) {
        Ok(configs) => configs.values().any(is_usable),
        Err(e) => {
            log::warn!("could not load provider configs: {e}");
            false
        }
    }
}

fn is_usable(config: &ProviderConfig) -> bool {
    if !is_cli_reachable(config) {
        return false;
    }
    config.api_key.is_some()
        || !config.api_keys.is_empty()
        || config.base_url.as_deref().is_some_and(is_loopback_url)
}

/// Whether a base URL points at this machine, where an API key is usually not
/// required. Host-only match (no DNS): anything else is treated as remote.
pub(crate) fn is_loopback_url(url: &str) -> bool {
    let authority = url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(url)
        .split('/')
        .next()
        .unwrap_or("");
    // Bracketed IPv6 keeps its colons; everything else splits off the port.
    let host = match authority.strip_prefix('[') {
        Some(rest) => rest.split(']').next().unwrap_or(""),
        None => authority.split(':').next().unwrap_or(""),
    };
    matches!(host, "localhost" | "127.0.0.1" | "0.0.0.0" | "::1")
}

/// `(provider, model_id)` pairs the CLI can actually run, sorted by provider
/// then model.
pub fn reachable_models(configs: &HashMap<String, ProviderConfig>) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = configs
        .values()
        .filter(|c| is_cli_reachable(c))
        .flat_map(|c| c.models.iter().map(|m| (c.provider.clone(), m.clone())))
        .collect();
    out.sort();
    out
}

/// Name of the local-engine provider serving `model_id` when **no** reachable
/// provider offers it, so the caller can reject the run up front instead of
/// failing at upstream resolution. Lookup mirrors
/// `agent::upstream::resolve_upstream_for_model`: an exact hit in a provider's
/// `models` list, or a `<provider>/<model>` prefix.
///
/// `None` for a model nobody claims: provider `models` lists are routinely
/// incomplete (custom deployments, freshly released ids), so an unknown id must
/// still fall through to normal resolution rather than be rejected here.
pub fn unreachable_local_provider(
    configs: &HashMap<String, ProviderConfig>,
    model_id: &str,
) -> Option<String> {
    let offering = |c: &&ProviderConfig| c.models.iter().any(|m| m == model_id);
    if configs.values().filter(offering).any(is_cli_reachable) {
        return None;
    }
    if let Some(local) = configs.values().find(|c| offering(c)) {
        return Some(local.provider.clone());
    }

    let prefix = model_id.split_once('/')?.0;
    configs
        .get(prefix)
        .filter(|c| !is_cli_reachable(c))
        .map(|c| c.provider.clone())
}

/// Runnable `(provider, model_id)` pairs for the TUI `/model` selector, taken
/// from the same layered resolution the agent uses -- so the picker offers
/// exactly what a run can reach, including `~/.jan/config.toml` providers the
/// desktop store knows nothing about.
pub fn list_provider_models(project_root: Option<&std::path::Path>) -> Vec<(String, String)> {
    match load_provider_configs(project_root, &ProviderOverrides::default().with_env()) {
        Ok(configs) => reachable_models(&configs),
        Err(e) => {
            log::warn!("could not load provider configs for the model picker: {e}");
            Vec::new()
        }
    }
}

/// Populate model lists for providers that have none configured
/// (e.g. a provider just added via the `/settings` wizard with the models field
/// left blank). For each reachable provider with an empty `models` list, query
/// its OpenAI-compatible `GET {base_url}/models` endpoint and persist the
/// discovered ids back to `~/.jan/config.toml`, mirroring how `/login` records
/// Tokamak's model list. Returns `true` if at least one provider was populated.
/// An unreachable endpoint is not fatal: it yields a warning and is skipped, so
/// a dead credential never blocks the picker. The configured list is preserved
/// when a provider already names models (the user's explicit choice wins), and
/// only providers present in the global store are touched -- writing a
/// models-only entry for a Desktop-inherited provider would shadow it.
/// `already_probed` records which `(provider, base_url)` pairs were queried,
/// so each is touched at most once per session: a dead upstream is not
/// re-contacted on every picker open.
pub async fn fetch_missing_models(
    project_root: Option<&std::path::Path>,
    already_probed: &mut std::collections::HashSet<String>,
) -> Result<bool, String> {
    let global = load_global_config()?;
    let configs = load_provider_configs(project_root, &ProviderOverrides::default().with_env())?;
    let to_fetch: Vec<(String, String, Vec<String>)> = configs
        .values()
        .filter(|c| {
            global.contains_key(&c.provider) && is_cli_reachable(c) && c.models.is_empty()
        })
        .map(|c| {
            (
                c.provider.clone(),
                c.base_url.clone().unwrap_or_default(),
                c.bearer_key_chain(),
            )
        })
        // Probe each provider at most once per session. A provider that still
        // has an empty list after a probe was unreachable or offered nothing;
        // re-probing it on every bare `/model` would freeze the render loop
        // for the full request timeout each time.
        .filter(|(name, base_url, _)| {
            let tag = format!("{name}|{base_url}");
            if already_probed.contains(&tag) {
                return false;
            }
            already_probed.insert(tag);
            true
        })
        .collect();
    if to_fetch.is_empty() {
        return Ok(false);
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let mut populated = false;
    for (name, base_url, keys) in to_fetch {
        let models = match fetch_models(&client, &base_url, &keys).await {
            Ok(m) => m,
            Err(e) => {
                log::warn!("could not list models for provider '{name}': {e}");
                continue;
            }
        };
        if models.is_empty() {
            continue;
        }
        crate::core::agent::global_config::set_provider(
            &name,
            crate::core::agent::global_config::ProviderUpdate {
                api_key: None,
                base_url: None,
                models: Some(models),
                api_type: None,
            },
        )?;
        populated = true;
    }
    Ok(populated)
}

/// Query an OpenAI-compatible `GET {base_url}/models` with Bearer auth (trying
/// each key in the chain on 401/403, matching upstream resolution) and return
/// the parsed, sorted, deduped ids from the response body. A provider with no
/// key (a keyless local endpoint) is queried unauthenticated. A remote
/// plaintext-`http` base URL is rejected up front so a bearer key is never
/// sent over a cleartext connection (loopback `http` is allowed).
async fn fetch_models(
    client: &reqwest::Client,
    base_url: &str,
    keys: &[String],
) -> Result<Vec<String>, String> {
    if !(base_url.starts_with("https://")
        || (base_url.starts_with("http://") && is_loopback_url(base_url)))
    {
        return Err(format!(
            "base URL must be https:// (or http:// for localhost): {base_url}"
        ));
    }
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let mut last_err = format!("GET {url} failed");
    let attempts: Vec<Option<&String>> = if keys.is_empty() {
        vec![None]
    } else {
        keys.iter().map(Some).collect()
    };
    for key in attempts {
        let mut request = client.get(&url);
        if let Some(key) = key {
            request = request.header("Authorization", format!("Bearer {key}"));
        }
        let response = request
            .send()
            .await
            .map_err(|e| format!("could not reach {url}: {e}"))?;
        let status = response.status();
        if status.is_success() {
            let body = response.text().await.unwrap_or_default();
            let parsed: serde_json::Value = serde_json::from_str(&body)
                .map_err(|e| format!("{url} returned a response we could not read: {e}"))?;
            return Ok(super::tokamak::parse_models(&parsed));
        }
        if status != reqwest::StatusCode::UNAUTHORIZED && status != reqwest::StatusCode::FORBIDDEN {
            // A non-auth error (rate limit, upstream down) won't be fixed by
            // trying another key, so report it and stop.
            return Err(format!("GET {url} returned {status}"));
        }
        last_err = format!("{url} rejected the key ({status})");
    }
    Err(last_err)
}

/// Load provider configs by layering the four `.jan`-based scopes (see module
/// docs for the priority order): Global `~/.jan/config.toml` -> Desktop
/// `settings.json` (inherit-only, additive) -> project `agent.toml`
/// `[provider]` override -> `--provider`/`--api-key` CLI/env overrides.
///
/// `project_root` is `None` when no project context is available (e.g.
/// `jan cli agent status` without `--project`); the local override is then
/// skipped. A missing/malformed Desktop store is not fatal: it's simply not
/// layered in, since Global config alone is a valid standalone setup.
pub fn load_provider_configs(
    project_root: Option<&std::path::Path>,
    overrides: &ProviderOverrides,
) -> Result<HashMap<String, ProviderConfig>, String> {
    let mut configs = load_global_config()?;

    inherit_desktop_providers(&mut configs);

    if let Some(root) = project_root {
        apply_local_override(&mut configs, root)?;
    }

    apply_overrides(&mut configs, overrides);
    Ok(configs)
}

/// Layer in providers from Desktop's `settings.json` that Global doesn't
/// already define. Read-only inherit: never overwrites a Global entry, never
/// writes back to `settings.json`. Secrets are seeded from the OS keyring /
/// encrypted fallback file (#8388) since they no longer live in the JSON blob.
fn inherit_desktop_providers(configs: &mut HashMap<String, ProviderConfig>) {
    let path = resolve_jan_data_folder().join("settings.json");
    let mut desktop_configs = match std::fs::read_to_string(&path) {
        Ok(raw) => parse_provider_store(&raw),
        Err(_) => return,
    };
    seed_keys_from_store(&mut desktop_configs, |p| {
        crate::core::server::provider_secrets::load_provider_keys(p)
    });
    for (name, cfg) in desktop_configs {
        configs.entry(name).or_insert(cfg);
    }
}

/// Apply the project's `agent.toml` `[provider]` section, if present. Highest
/// priority of the three `.jan`-based sources: always wins over Global and the
/// Desktop inherit for the named provider.
fn apply_local_override(
    configs: &mut HashMap<String, ProviderConfig>,
    project_root: &std::path::Path,
) -> Result<(), String> {
    let cfg = match crate::core::agent::project::load_agent_config(project_root) {
        Ok(cfg) => cfg,
        Err(_) => return Ok(()),
    };
    if let Some(section) = cfg.provider {
        configs.insert(section.name.clone(), provider_config_from_section(section));
    }
    Ok(())
}

fn provider_config_from_section(section: ProviderSection) -> ProviderConfig {
    ProviderConfig {
        provider: section.name,
        api_keys: section.api_key.iter().cloned().collect(),
        api_key: section.api_key,
        base_url: section.base_url,
        custom_headers: Vec::new(),
        models: section.models,
        api_type: section.api_type,
    }
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
    fn provider_models_from_store_are_flattened_and_sorted() {
        let mut pairs: Vec<(String, String)> = parse_provider_store(STORE)
            .values()
            .flat_map(|c| c.models.iter().map(|m| (c.provider.clone(), m.clone())))
            .collect();
        pairs.sort();
        assert_eq!(
            pairs,
            vec![
                ("anthropic".to_string(), "claude-opus-4".to_string()),
                ("anthropic".to_string(), "claude-sonnet-4-5".to_string()),
                ("openai".to_string(), "gpt-4o".to_string()),
            ]
        );
    }

    #[test]
    fn parses_desktop_selection() {
        let store = r#"{"model-provider":"{\"state\":{\"selectedProvider\":\"anthropic\",\"selectedModel\":{\"id\":\"claude-sonnet-4-5\",\"provider\":\"anthropic\"},\"providers\":[]}}"}"#;
        let sel = parse_selection(store);
        assert_eq!(sel.provider.as_deref(), Some("anthropic"));
        assert_eq!(sel.model.as_deref(), Some("claude-sonnet-4-5"));
    }

    #[test]
    fn selection_absent_or_empty_is_none() {
        assert_eq!(parse_selection("not json"), DesktopSelection::default());
        assert_eq!(
            parse_selection(r#"{"model-provider":"{\"state\":{\"providers\":[]}}"}"#),
            DesktopSelection::default()
        );
        // Empty strings / null model are treated as unset.
        let blank = r#"{"model-provider":"{\"state\":{\"selectedProvider\":\"\",\"selectedModel\":null}}"}"#;
        assert_eq!(parse_selection(blank), DesktopSelection::default());
    }

    #[test]
    fn only_providers_with_a_base_url_are_cli_reachable() {
        let remote = ProviderConfig {
            provider: "anthropic".into(),
            base_url: Some("https://api.anthropic.com/v1".into()),
            ..Default::default()
        };
        // Local engines (llamacpp, llamacpp-rs, mlx) are stored by the desktop
        // app without a base_url: their upstream only exists once the desktop
        // has spawned the engine, which the CLI never does.
        let local = ProviderConfig {
            provider: "llamacpp".into(),
            base_url: None,
            ..Default::default()
        };
        let blank = ProviderConfig {
            provider: "mlx".into(),
            base_url: Some(String::new()),
            ..Default::default()
        };
        assert!(is_cli_reachable(&remote));
        assert!(!is_cli_reachable(&local));
        assert!(!is_cli_reachable(&blank));
    }

    #[test]
    fn usable_requires_a_key_only_for_remote_upstreams() {
        let keyed_remote = ProviderConfig {
            provider: "tokamak".into(),
            base_url: Some("https://api.tokamak.sh/v1".into()),
            api_key: Some("tk".into()),
            ..Default::default()
        };
        let keyless_remote = ProviderConfig {
            provider: "openai".into(),
            base_url: Some("https://api.openai.com/v1".into()),
            ..Default::default()
        };
        let keyless_local = ProviderConfig {
            provider: "jan".into(),
            base_url: Some("http://localhost:1337/v1".into()),
            ..Default::default()
        };
        let engine = ProviderConfig {
            provider: "llamacpp".into(),
            base_url: None,
            api_key: Some("k".into()),
            ..Default::default()
        };
        assert!(is_usable(&keyed_remote));
        assert!(!is_usable(&keyless_remote));
        assert!(is_usable(&keyless_local));
        assert!(!is_usable(&engine));
    }

    #[test]
    fn loopback_detection_ignores_ports_paths_and_lookalike_hosts() {
        assert!(is_loopback_url("http://127.0.0.1:1337/v1"));
        assert!(is_loopback_url("http://localhost/v1"));
        assert!(is_loopback_url("http://[::1]:1337/v1"));
        assert!(is_loopback_url("localhost:1337"));
        assert!(!is_loopback_url("https://localhost.evil.com/v1"));
        assert!(!is_loopback_url("https://api.tokamak.sh/v1"));
        assert!(!is_loopback_url(""));
    }

    #[test]
    fn reachable_models_skips_local_engine_providers() {
        let mut configs = HashMap::new();
        configs.insert(
            "llamacpp".to_string(),
            ProviderConfig {
                provider: "llamacpp".into(),
                base_url: None,
                models: vec!["gemma-4-E2B-it-IQ4_XS".into()],
                ..Default::default()
            },
        );
        configs.insert(
            "anthropic".to_string(),
            ProviderConfig {
                provider: "anthropic".into(),
                base_url: Some("https://api.anthropic.com/v1".into()),
                models: vec!["claude-sonnet-5".into(), "claude-opus-5".into()],
                ..Default::default()
            },
        );
        let pairs = reachable_models(&configs);
        assert_eq!(
            pairs,
            vec![
                ("anthropic".to_string(), "claude-opus-5".to_string()),
                ("anthropic".to_string(), "claude-sonnet-5".to_string()),
            ]
        );
    }

    fn cfg(provider: &str, base_url: Option<&str>, models: &[&str]) -> ProviderConfig {
        ProviderConfig {
            provider: provider.into(),
            base_url: base_url.map(String::from),
            models: models.iter().map(|m| m.to_string()).collect(),
            ..Default::default()
        }
    }

    fn two_provider_store() -> HashMap<String, ProviderConfig> {
        let mut c = HashMap::new();
        c.insert(
            "llamacpp".into(),
            cfg("llamacpp", None, &["gemma-4-E2B-it-IQ4_XS", "shared-id"]),
        );
        c.insert(
            "anthropic".into(),
            cfg(
                "anthropic",
                Some("https://api.anthropic.com/v1"),
                &["claude-sonnet-5", "shared-id"],
            ),
        );
        c
    }

    #[test]
    fn local_only_model_is_reported_with_its_provider() {
        assert_eq!(
            unreachable_local_provider(&two_provider_store(), "gemma-4-E2B-it-IQ4_XS"),
            Some("llamacpp".to_string())
        );
    }

    #[test]
    fn remote_model_is_not_flagged() {
        assert_eq!(
            unreachable_local_provider(&two_provider_store(), "claude-sonnet-5"),
            None
        );
    }

    #[test]
    fn model_offered_by_both_local_and_remote_is_not_flagged() {
        // A reachable provider also serves it, so the run can proceed.
        assert_eq!(
            unreachable_local_provider(&two_provider_store(), "shared-id"),
            None
        );
    }

    #[test]
    fn unknown_model_is_not_flagged() {
        // Provider `models` lists are often incomplete (custom deployments), so
        // an id nobody claims must fall through to normal upstream resolution
        // rather than being rejected here.
        assert_eq!(
            unreachable_local_provider(&two_provider_store(), "some-custom-model"),
            None
        );
    }

    #[test]
    fn provider_prefixed_local_model_is_flagged() {
        assert_eq!(
            unreachable_local_provider(&two_provider_store(), "llamacpp/whatever"),
            Some("llamacpp".to_string())
        );
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

    /// One-shot `/models` stub on a random loopback port. Returns the bound
    /// address; each accepted connection gets `body` back as JSON.
    fn models_stub(body: String, connections: usize) -> std::net::SocketAddr {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming().take(connections) {
                let Ok(mut stream) = stream else { continue };
                let mut buf = [0u8; 4096];
                let _ = std::io::Read::read(&mut stream, &mut buf);
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = std::io::Write::write_all(&mut stream, resp.as_bytes());
            }
        });
        addr
    }

    #[test]
    fn fetch_missing_models_populates_and_persists_empty_providers() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let addr = models_stub(
                serde_json::json!({"data": [{"id": "m-b"}, {"id": "m-a"}]}).to_string(),
                1,
            );
            crate::core::agent::global_config::set_provider(
                "bare",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: Some("k".into()),
                    base_url: Some(format!("http://{addr}/v1")),
                    models: Some(vec![]),
                    api_type: None,
                },
            )
            .unwrap();

            let rt = tokio::runtime::Runtime::new().unwrap();
            let populated = rt.block_on(fetch_missing_models(None, &mut std::collections::HashSet::new())).expect("fetch");
            assert!(populated);

            let configs = load_global_config().unwrap();
            assert_eq!(
                configs.get("bare").unwrap().models,
                vec!["m-a".to_string(), "m-b".to_string()],
                "discovered ids persist sorted"
            );
        });
    }

    #[test]
    fn fetch_missing_models_leaves_configured_lists_alone() {
        crate::core::agent::global_config::with_temp_home(|_| {
            crate::core::agent::global_config::set_provider(
                "chosen",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: Some("k".into()),
                    base_url: Some("http://127.0.0.1:9/v1".into()), // would refuse
                    models: Some(vec!["my-model".into()]),
                    api_type: None,
                },
            )
            .unwrap();

            let rt = tokio::runtime::Runtime::new().unwrap();
            // Nothing to fetch: the provider already names its models, so the
            // dead endpoint above must never be contacted.
            let populated = rt.block_on(fetch_missing_models(None, &mut std::collections::HashSet::new())).expect("fetch");
            assert!(!populated);
            let configs = load_global_config().unwrap();
            assert_eq!(configs.get("chosen").unwrap().models, vec!["my-model".to_string()]);
        });
    }

    #[test]
    fn fetch_missing_models_queries_keyless_loopback_providers() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let addr = models_stub(
                serde_json::json!({"data": [{"id": "local-model"}]}).to_string(),
                1,
            );
            crate::core::agent::global_config::set_provider(
                "local",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: None,
                    base_url: Some(format!("http://{addr}/v1")),
                    models: Some(vec![]),
                    api_type: None,
                },
            )
            .unwrap();

            let rt = tokio::runtime::Runtime::new().unwrap();
            let populated = rt.block_on(fetch_missing_models(None, &mut std::collections::HashSet::new())).expect("fetch");
            assert!(populated, "a keyless endpoint is queried unauthenticated");
            let configs = load_global_config().unwrap();
            assert_eq!(configs.get("local").unwrap().models, vec!["local-model".to_string()]);
        });
    }

    #[test]
    fn fetch_missing_models_short_circuits_already_probed() {
        crate::core::agent::global_config::with_temp_home(|_| {
            // A dead endpoint: if it were contacted, the 15s timeout would hang.
            crate::core::agent::global_config::set_provider(
                "dead",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: Some("k".into()),
                    base_url: Some("http://127.0.0.1:9/v1".into()), // refuses instantly
                    models: Some(vec![]),
                    api_type: None,
                },
            )
            .unwrap();

            let rt = tokio::runtime::Runtime::new().unwrap();
            let mut probed = std::collections::HashSet::new();
            // First probe hits the dead endpoint (fast refusal) and warns.
            let populated = rt
                .block_on(fetch_missing_models(None, &mut probed))
                .expect("fetch");
            assert!(!populated);
            assert_eq!(probed.len(), 1, "dead provider is recorded as probed");

            // A second fetch must not re-contact the dead endpoint at all
            // (the probed set short-circuits it), and must not error.
            let again = rt
                .block_on(fetch_missing_models(None, &mut probed))
                .expect("second fetch");
            assert!(!again, "already-probed provider is not re-fetched");
        });
    }
}
