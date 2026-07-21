//! User-wide `~/.jan/config.toml` provider config. Lets Jan Agent run
//! standalone (no Jan Desktop) with credentials scoped to the whole user, not
//! just one project. Optional: a missing file yields an empty provider set,
//! not an error.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::Deserialize;

use crate::core::state::ProviderConfig;

const GLOBAL_CONFIG_TEMPLATE: &str = r#"# Jan Agent global provider config.
# Applies to every project unless overridden by that project's
# .jan/agent/agent.toml [provider] section.
#
# [providers.openai]
# api_key = "sk-..."
# base_url = "https://api.openai.com/v1"
# models = ["gpt-4o"]
#
# [providers.anthropic]
# api_key = "sk-ant-..."
# models = ["claude-sonnet-5"]
"#;

#[derive(Debug, Clone, Default, Deserialize)]
struct GlobalConfigToml {
    #[serde(default)]
    providers: HashMap<String, GlobalProviderEntry>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct GlobalProviderEntry {
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default)]
    base_url: Option<String>,
    #[serde(default)]
    models: Vec<String>,
    #[serde(default)]
    api_type: Option<String>,
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Mutex;

    // HOME is process-wide; serialize tests that mutate it.
    static ENV_LOCK: Mutex<()> = Mutex::new(());
    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn with_temp_home<T>(f: impl FnOnce(&std::path::Path) -> T) -> T {
        let _guard = ENV_LOCK.lock().unwrap();
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

    #[test]
    fn missing_file_yields_empty_map() {
        with_temp_home(|_| {
            let configs = load_global_config().expect("load");
            assert!(configs.is_empty());
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
}
