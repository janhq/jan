//! User-wide `~/.jan/config.toml` provider config. Lets Jan Agent run
//! standalone (no Jan Desktop) with credentials scoped to the whole user, not
//! just one project. Optional: a missing file yields an empty provider set,
//! not an error.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::core::state::ProviderConfig;

const GLOBAL_CONFIG_TEMPLATE: &str = r#"# Jan Agent global provider config.
# Applies to every project unless overridden by that project's
# .jan/agent/agent.toml [provider] section.
#
# default_model = "my-model"        # used when no --model / agent.toml model is set
# smol_model = "my-fast-model"       # fast model for the `smol` role (/goal evaluation);
#                                     # defaults to `default_model` when unset
# mouse = false                      # disable TUI mouse tracking (scroll wheel,
#                                     # click-to-expand); on by default
#
# [providers.my-provider]
# api_key = "sk-..."
# base_url = "https://api.example.com/v1"
# models = ["my-model"]
"#;

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
struct GlobalConfigToml {
    /// Explicit default model for a standalone agent, used when neither a CLI
    /// flag nor `agent.toml` names one. Takes precedence over any derived guess.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    default_model: Option<String>,
    /// Fast, cheap model for the `smol` role: goal evaluation and other
    /// lightweight side calls. Falls back to `default_model` when unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    smol_model: Option<String>,
    /// TUI mouse tracking (wheel scrolling, click-to-expand). `None` = the
    /// default, on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    mouse: Option<bool>,
    #[serde(default)]
    providers: HashMap<String, GlobalProviderEntry>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
struct GlobalProviderEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    api_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    base_url: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    models: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    api_type: Option<String>,
}

/// Fields to update on a provider entry via [`set_provider`]. `None` leaves the
/// existing value untouched (merge semantics); `Some` overwrites it.
#[derive(Debug, Default, Clone)]
pub(crate) struct ProviderUpdate {
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    /// `Some(vec)` replaces the model list; `Some(empty)` clears it.
    pub models: Option<Vec<String>>,
    pub api_type: Option<String>,
}

/// `~/.jan`, the user-wide config directory.
pub(crate) fn global_jan_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".jan"))
        .ok_or_else(|| "could not resolve the user's home directory".to_string())
}

/// `~/.jan/config.toml`.
pub(crate) fn global_config_path() -> Result<PathBuf, String> {
    Ok(global_jan_dir()?.join("config.toml"))
}

/// Load provider configs from `~/.jan/config.toml`. Missing file -> empty map
/// (standalone-with-no-global-config is valid); malformed file -> error.
pub(crate) fn load_global_config() -> Result<HashMap<String, ProviderConfig>, String> {
    let path = match global_config_path() {
        Ok(p) => p,
        Err(_) => return Ok(HashMap::new()),
    };
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(_) => return Ok(HashMap::new()),
    };
    let parsed: GlobalConfigToml =
        toml::from_str(&raw).map_err(|e| format!("Failed to parse {}: {e}", path.display()))?;

    Ok(parsed
        .providers
        .into_iter()
        .map(|(name, entry)| {
            let api_keys = entry.api_key.iter().cloned().collect();
            (
                name.clone(),
                ProviderConfig {
                    provider: name,
                    api_key: entry.api_key,
                    api_keys,
                    base_url: entry.base_url,
                    custom_headers: Vec::new(),
                    models: entry.models,
                    api_type: entry.api_type,
                },
            )
        })
        .collect())
}

/// Resolve a default model from `~/.jan/config.toml` for a standalone agent:
/// the explicit `default_model` key if set, else the first model of the first
/// provider (providers sorted by name for determinism). `None` when nothing is
/// configured. Errors only on a malformed file.
pub(crate) fn default_model() -> Result<Option<String>, String> {
    let config = load_raw()?;
    if let Some(model) = config.default_model.filter(|m| !m.trim().is_empty()) {
        return Ok(Some(model));
    }
    let mut providers: Vec<_> = config.providers.into_iter().collect();
    providers.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(providers
        .into_iter()
        .find_map(|(_, entry)| entry.models.into_iter().next()))
}

/// Resolve the `smol` role model from `~/.jan/config.toml`: the explicit
/// `smol_model` key if set. `None` when unset (callers fall back to the
/// session's main model). Errors only on a malformed file.
pub(crate) fn smol_model() -> Result<Option<String>, String> {
    let config = load_raw()?;
    Ok(config.smol_model.filter(|m| !m.trim().is_empty()))
}

/// Whether the TUI should track the mouse (`mouse` in `~/.jan/config.toml`),
/// defaulting to on. A display preference must never block startup, so an
/// unreadable or malformed config yields the default rather than an error.
pub(crate) fn mouse_enabled() -> bool {
    load_raw()
        .ok()
        .and_then(|config| config.mouse)
        .unwrap_or(true)
}

/// Read `~/.jan/config.toml` into the raw TOML struct for editing. Missing file
/// -> default (empty); malformed file -> error, so a set never silently drops an
/// unparseable file's contents.
fn load_raw() -> Result<GlobalConfigToml, String> {
    let path = global_config_path()?;
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(_) => return Ok(GlobalConfigToml::default()),
    };
    toml::from_str(&raw).map_err(|e| format!("Failed to parse {}: {e}", path.display()))
}

/// Serialize the config back to `~/.jan/config.toml`, creating `~/.jan` if
/// needed. The directory is user-scoped; the file is world-unreadable on Unix
/// since it holds API keys.
fn write_raw(config: &GlobalConfigToml) -> Result<PathBuf, String> {
    let dir = global_jan_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    let path = dir.join("config.toml");
    let body = toml::to_string_pretty(config).map_err(|e| format!("Failed to serialize config: {e}"))?;
    std::fs::write(&path, &body).map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    restrict_permissions(&path);
    Ok(path)
}

#[cfg(unix)]
fn restrict_permissions(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &std::path::Path) {}

/// Create or update a provider entry in `~/.jan/config.toml`, merging with any
/// existing entry (see [`ProviderUpdate`]). Returns the config path. This is the
/// headless write path that lets a standalone Jan Agent set credentials with no
/// Desktop app present.
pub(crate) fn set_provider(name: &str, update: ProviderUpdate) -> Result<PathBuf, String> {
    if name.trim().is_empty() {
        return Err("provider name must not be empty".to_string());
    }
    let mut config = load_raw()?;
    let entry = config.providers.entry(name.to_string()).or_default();
    if let Some(api_key) = update.api_key {
        entry.api_key = Some(api_key);
    }
    if let Some(base_url) = update.base_url {
        entry.base_url = Some(base_url);
    }
    if let Some(models) = update.models {
        entry.models = models;
    }
    if let Some(api_type) = update.api_type {
        entry.api_type = Some(api_type);
    }
    write_raw(&config)
}

/// Point `default_model` at `model` unless the user already chose one. Returns
/// `true` when it was written. Used by sign-in flows: the first provider a user
/// connects should become runnable without a second config step, but an explicit
/// choice must never be overwritten.
pub(crate) fn set_default_model_if_unset(model: &str) -> Result<bool, String> {
    if model.trim().is_empty() {
        return Ok(false);
    }
    let mut config = load_raw()?;
    if config
        .default_model
        .as_deref()
        .is_some_and(|m| !m.trim().is_empty())
    {
        return Ok(false);
    }
    config.default_model = Some(model.to_string());
    write_raw(&config)?;
    Ok(true)
}

/// Remove a provider entry from `~/.jan/config.toml`. Returns `true` if the
/// provider existed and was removed, `false` if it was already absent.
pub(crate) fn remove_provider(name: &str) -> Result<bool, String> {
    let mut config = load_raw()?;
    if config.providers.remove(name).is_none() {
        return Ok(false);
    }
    write_raw(&config)?;
    Ok(true)
}

/// Scaffold `~/.jan/config.toml` with a commented example, if it doesn't exist
/// yet. Idempotent and clobber-safe: never overwrites an existing file.
pub(crate) fn ensure_global_config() -> Result<PathBuf, String> {
    let dir = global_jan_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    let path = dir.join("config.toml");
    if !path.exists() {
        std::fs::write(&path, GLOBAL_CONFIG_TEMPLATE)
            .map_err(|e| format!("Failed to write {}: {e}", path.display()))?;
    }
    Ok(path)
}

/// Redirect `HOME` to a scratch dir for the duration of `f`. Every test that
/// touches `~/.jan` must go through this one helper: `HOME` is process-wide, so
/// a second lock elsewhere would let those tests race each other.
#[cfg(test)]
pub(crate) fn with_temp_home<T>(f: impl FnOnce(&std::path::Path) -> T) -> T {
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());
    static COUNTER: AtomicU32 = AtomicU32::new(0);

    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let home = std::env::temp_dir().join(format!("jan_global_cfg_test_{n}"));
    std::fs::create_dir_all(&home).unwrap();
    let prev = std::env::var_os("HOME");
    std::env::set_var("HOME", &home);
    let result = f(&home);
    match prev {
        Some(p) => std::env::set_var("HOME", p),
        None => std::env::remove_var("HOME"),
    }
    let _ = std::fs::remove_dir_all(&home);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_yields_empty_map() {
        with_temp_home(|_| {
            let configs = load_global_config().expect("load");
            assert!(configs.is_empty());
        });
    }

    #[test]
    fn mouse_defaults_on_and_reads_the_toml_key() {
        with_temp_home(|_| {
            assert!(mouse_enabled(), "missing file -> tracking on");
            let path = ensure_global_config().expect("ensure");
            assert!(mouse_enabled(), "scaffolded file -> tracking on");

            std::fs::write(&path, "mouse = false\n").unwrap();
            assert!(!mouse_enabled());
            std::fs::write(&path, "mouse = true\n").unwrap();
            assert!(mouse_enabled());

            std::fs::write(&path, "not valid toml [[[").unwrap();
            assert!(mouse_enabled(), "an unreadable config keeps the default");
        });
    }

    #[test]
    fn ensure_scaffolds_and_is_idempotent() {
        with_temp_home(|home| {
            let path = ensure_global_config().expect("ensure");
            assert_eq!(path, home.join(".jan").join("config.toml"));
            assert!(path.exists());

            std::fs::write(&path, "[providers.openai]\napi_key = \"sk-x\"\n").unwrap();
            ensure_global_config().expect("ensure again");
            let raw = std::fs::read_to_string(&path).unwrap();
            assert!(raw.contains("sk-x"), "must not clobber existing file");
        });
    }

    #[test]
    fn loads_providers_from_config() {
        with_temp_home(|_| {
            ensure_global_config().expect("ensure");
            let path = global_config_path().unwrap();
            std::fs::write(
                &path,
                r#"[providers.openai]
api_key = "sk-abc"
base_url = "https://api.openai.com/v1"
models = ["gpt-4o"]
"#,
            )
            .unwrap();

            let configs = load_global_config().expect("load");
            let openai = configs.get("openai").expect("openai present");
            assert_eq!(openai.api_key.as_deref(), Some("sk-abc"));
            assert_eq!(openai.base_url.as_deref(), Some("https://api.openai.com/v1"));
            assert_eq!(openai.models, vec!["gpt-4o".to_string()]);
        });
    }

    #[test]
    fn malformed_file_errors() {
        with_temp_home(|_| {
            let path = ensure_global_config().expect("ensure");
            std::fs::write(&path, "not valid toml [[[").unwrap();
            assert!(load_global_config().is_err());
        });
    }

    #[test]
    fn set_provider_creates_and_roundtrips() {
        with_temp_home(|_| {
            set_provider(
                "openai",
                ProviderUpdate {
                    api_key: Some("sk-1".into()),
                    base_url: Some("https://api.openai.com/v1".into()),
                    models: Some(vec!["gpt-4o".into()]),
                    api_type: None,
                },
            )
            .expect("set");
            let configs = load_global_config().expect("load");
            let openai = configs.get("openai").expect("present");
            assert_eq!(openai.api_key.as_deref(), Some("sk-1"));
            assert_eq!(openai.base_url.as_deref(), Some("https://api.openai.com/v1"));
            assert_eq!(openai.models, vec!["gpt-4o".to_string()]);
        });
    }

    #[test]
    fn set_provider_merges_without_clobbering_other_fields_or_providers() {
        with_temp_home(|_| {
            set_provider(
                "openai",
                ProviderUpdate {
                    api_key: Some("sk-1".into()),
                    base_url: Some("https://a".into()),
                    models: Some(vec!["gpt-4o".into()]),
                    api_type: None,
                },
            )
            .unwrap();
            set_provider("anthropic", ProviderUpdate { api_key: Some("sk-ant".into()), ..Default::default() }).unwrap();
            // Update only the openai key; base_url + models must survive.
            set_provider("openai", ProviderUpdate { api_key: Some("sk-2".into()), ..Default::default() }).unwrap();

            let configs = load_global_config().expect("load");
            let openai = configs.get("openai").unwrap();
            assert_eq!(openai.api_key.as_deref(), Some("sk-2"));
            assert_eq!(openai.base_url.as_deref(), Some("https://a"));
            assert_eq!(openai.models, vec!["gpt-4o".to_string()]);
            assert_eq!(configs.get("anthropic").unwrap().api_key.as_deref(), Some("sk-ant"));
        });
    }

    #[test]
    fn set_provider_rejects_empty_name() {
        with_temp_home(|_| {
            assert!(set_provider("  ", ProviderUpdate::default()).is_err());
        });
    }

    #[test]
    fn default_model_none_when_empty() {
        with_temp_home(|_| {
            assert_eq!(default_model().expect("default"), None);
        });
    }

    #[test]
    fn default_model_derives_from_first_provider_model() {
        with_temp_home(|_| {
            set_provider("openai", ProviderUpdate { models: Some(vec!["gpt-4o".into()]), ..Default::default() }).unwrap();
            assert_eq!(default_model().expect("default").as_deref(), Some("gpt-4o"));
        });
    }

    #[test]
    fn default_model_prefers_explicit_key() {
        with_temp_home(|_| {
            let path = global_config_path().unwrap();
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(
                &path,
                "default_model = \"claude-sonnet-5\"\n[providers.openai]\nmodels = [\"gpt-4o\"]\n",
            )
            .unwrap();
            assert_eq!(default_model().expect("default").as_deref(), Some("claude-sonnet-5"));
        });
    }

    #[test]
    fn default_model_derivation_is_deterministic_by_provider_name() {
        with_temp_home(|_| {
            set_provider("zeta", ProviderUpdate { models: Some(vec!["z-model".into()]), ..Default::default() }).unwrap();
            set_provider("alpha", ProviderUpdate { models: Some(vec!["a-model".into()]), ..Default::default() }).unwrap();
            assert_eq!(default_model().expect("default").as_deref(), Some("a-model"));
        });
    }

    #[test]
    fn set_provider_preserves_default_model_key() {
        with_temp_home(|_| {
            let path = global_config_path().unwrap();
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, "default_model = \"m1\"\n").unwrap();
            set_provider("openai", ProviderUpdate { api_key: Some("sk".into()), ..Default::default() }).unwrap();
            assert_eq!(default_model().expect("default").as_deref(), Some("m1"));
        });
    }

    #[test]
    fn default_model_is_set_once_and_never_overwritten() {
        with_temp_home(|_| {
            assert!(set_default_model_if_unset("m1").expect("set"));
            assert_eq!(default_model().expect("read").as_deref(), Some("m1"));
            assert!(!set_default_model_if_unset("m2").expect("set again"));
            assert_eq!(default_model().expect("read").as_deref(), Some("m1"));
        });
    }

    #[test]
    fn default_model_set_keeps_existing_providers_and_rejects_blank() {
        with_temp_home(|_| {
            set_provider(
                "tokamak",
                ProviderUpdate { api_key: Some("tk".into()), ..Default::default() },
            )
            .unwrap();
            assert!(!set_default_model_if_unset("  ").expect("blank"));
            assert!(set_default_model_if_unset("m1").expect("set"));
            let configs = load_global_config().expect("load");
            assert_eq!(configs.get("tokamak").unwrap().api_key.as_deref(), Some("tk"));
        });
    }

    #[test]
    fn remove_provider_reports_presence() {
        with_temp_home(|_| {
            set_provider("openai", ProviderUpdate { api_key: Some("sk-1".into()), ..Default::default() }).unwrap();
            assert!(remove_provider("openai").expect("remove"));
            assert!(!remove_provider("openai").expect("remove again"));
            assert!(load_global_config().unwrap().get("openai").is_none());
        });
    }

    #[test]
    fn set_provider_preserves_commented_scaffold_is_lost_but_data_kept() {
        // A hand-edited file with real entries roundtrips through set (comments in
        // the scaffold are not preserved, but no provider data is lost).
        with_temp_home(|_| {
            let path = global_config_path().unwrap();
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, "[providers.groq]\napi_key = \"gk\"\n").unwrap();
            set_provider("openai", ProviderUpdate { api_key: Some("sk".into()), ..Default::default() }).unwrap();
            let configs = load_global_config().unwrap();
            assert_eq!(configs.get("groq").unwrap().api_key.as_deref(), Some("gk"));
            assert_eq!(configs.get("openai").unwrap().api_key.as_deref(), Some("sk"));
        });
    }
}
