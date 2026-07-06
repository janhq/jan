//! Backend-owned settings store for webview Zustand stores.
//!
//! Persists non-secret settings to `<jan_data_folder>/settings.json` as a flat
//! JSON object (`{ "<namespace>": "<serialized-store-blob>" }`). The webview
//! reaches this via the async `StateStorage` adapter; an out-of-process consumer
//! (jan-cli) can read the same file without an `AppHandle`. Secrets never land
//! here — they go to the OS keyring via the provider-config path.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use super::commands::resolve_jan_data_folder;
use crate::core::app::constants::CONFIGURATION_FILE_NAME;

/// Serializes read-modify-write cycles so concurrent `settings_set`/`_remove`
/// calls can't clobber each other. The file is the source of truth; this only
/// guards the in-process critical section.
static WRITE_LOCK: Mutex<()> = Mutex::new(());

fn settings_file_path() -> PathBuf {
    resolve_jan_data_folder().join(CONFIGURATION_FILE_NAME)
}

fn read_map(path: &PathBuf) -> BTreeMap<String, String> {
    match fs::read_to_string(path) {
        Ok(content) if !content.trim().is_empty() => {
            serde_json::from_str(&content).unwrap_or_default()
        }
        _ => BTreeMap::new(),
    }
}

fn write_map_atomic(path: &PathBuf, map: &BTreeMap<String, String>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let serialized = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serialized).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn settings_get(key: String) -> Option<String> {
    let path = settings_file_path();
    read_map(&path).get(&key).cloned()
}

#[tauri::command]
pub fn settings_set(key: String, value: String) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let path = settings_file_path();
    let mut map = read_map(&path);
    map.insert(key, value);
    write_map_atomic(&path, &map)
}

#[tauri::command]
pub fn settings_remove(key: String) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    let path = settings_file_path();
    let mut map = read_map(&path);
    if map.remove(&key).is_some() {
        return write_map_atomic(&path, &map);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::MutexGuard;

    /// `resolve_jan_data_folder` reads process-wide env/config, so tests that
    /// point it at a temp dir must not run concurrently.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    struct TempDataFolder {
        _guard: MutexGuard<'static, ()>,
        prev_app_name: Option<String>,
        prev_data_dir: Option<String>,
        dir: tempfile::TempDir,
    }

    impl TempDataFolder {
        fn new() -> Self {
            let guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let dir = tempfile::tempdir().unwrap();
            let prev_app_name = std::env::var("APP_NAME").ok();
            let prev_data_dir = std::env::var("XDG_DATA_HOME").ok();
            // Force resolve_jan_data_folder to the default branch under our temp dir.
            std::env::set_var("APP_NAME", "JanTest");
            std::env::set_var("XDG_DATA_HOME", dir.path());
            Self {
                _guard: guard,
                prev_app_name,
                prev_data_dir,
                dir,
            }
        }
    }

    impl Drop for TempDataFolder {
        fn drop(&mut self) {
            match &self.prev_app_name {
                Some(v) => std::env::set_var("APP_NAME", v),
                None => std::env::remove_var("APP_NAME"),
            }
            match &self.prev_data_dir {
                Some(v) => std::env::set_var("XDG_DATA_HOME", v),
                None => std::env::remove_var("XDG_DATA_HOME"),
            }
            let _ = &self.dir;
        }
    }

    #[test]
    fn roundtrip_set_get_remove() {
        let _tmp = TempDataFolder::new();
        assert_eq!(settings_get("model-provider".into()), None);

        settings_set("model-provider".into(), "{\"a\":1}".into()).unwrap();
        assert_eq!(
            settings_get("model-provider".into()),
            Some("{\"a\":1}".to_string())
        );

        settings_set("theme".into(), "\"dark\"".into()).unwrap();
        assert_eq!(settings_get("theme".into()), Some("\"dark\"".to_string()));
        assert_eq!(
            settings_get("model-provider".into()),
            Some("{\"a\":1}".to_string())
        );

        settings_remove("model-provider".into()).unwrap();
        assert_eq!(settings_get("model-provider".into()), None);
        assert_eq!(settings_get("theme".into()), Some("\"dark\"".to_string()));
    }

    #[test]
    fn remove_missing_key_is_ok() {
        let _tmp = TempDataFolder::new();
        assert!(settings_remove("nope".into()).is_ok());
    }

    #[test]
    fn overwrites_preserve_other_keys() {
        let _tmp = TempDataFolder::new();
        settings_set("a".into(), "1".into()).unwrap();
        settings_set("b".into(), "2".into()).unwrap();
        settings_set("a".into(), "3".into()).unwrap();
        assert_eq!(settings_get("a".into()), Some("3".to_string()));
        assert_eq!(settings_get("b".into()), Some("2".to_string()));
    }
}
