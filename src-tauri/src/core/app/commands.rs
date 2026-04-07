use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, Runtime, State};

use super::{
    constants::{CONFIGURATION_FILE_NAME, TAURI_BUNDLE_IDENTIFIER},
    helpers::copy_dir_recursive,
    models::AppConfiguration,
};
use crate::core::state::AppState;

/// Canonical Jan app support directory (`%APPDATA%/Jan` on Windows).
fn resolve_human_readable_app_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join(env!("CARGO_PKG_NAME")))
}

/// Tauri bundle-id app support directory (e.g. `%APPDATA%/jan.ai.app` on Windows).
fn resolve_bundle_app_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|d| d.join(TAURI_BUNDLE_IDENTIFIER))
}

/// Keep `%APPDATA%/Jan/settings.json` as canonical, but recover from legacy or
/// alternate locations if users removed one directory (#7898).
fn migrate_legacy_app_configuration(app_data_dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(app_data_dir)?;
    let canonical = app_data_dir.join(CONFIGURATION_FILE_NAME);
    if canonical.exists() {
        return Ok(());
    }

    migrate_from_candidates(&canonical, legacy_app_config_candidate_paths(app_data_dir))
}

fn migrate_from_candidates(canonical: &Path, candidates: Vec<PathBuf>) -> std::io::Result<()> {
    for legacy in candidates {
        if legacy.is_file() {
            log::info!(
                "Recovering app configuration from {} to {}",
                legacy.display(),
                canonical.display()
            );
            fs::copy(&legacy, canonical)?;
            return Ok(());
        }
    }
    Ok(())
}

fn legacy_app_config_candidate_paths(app_data_dir: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Some(bundle_dir) = resolve_bundle_app_data_dir() {
        paths.push(bundle_dir.join(CONFIGURATION_FILE_NAME));
    }

    #[cfg(target_os = "linux")]
    {
        let package_name = env!("CARGO_PKG_NAME");
        if let Some(config_dir) = dirs::config_dir() {
            let legacy = config_dir.join(package_name).join(CONFIGURATION_FILE_NAME);
            if legacy != app_data_dir.join(CONFIGURATION_FILE_NAME) {
                paths.push(legacy);
            }
        }
    }

    paths
}

fn app_data_dir_with_fallback<R: Runtime>(app_handle: &tauri::AppHandle<R>) -> PathBuf {
    let package_name = env!("CARGO_PKG_NAME");
    app_handle.path().data_dir().unwrap_or_else(|err| {
        log::error!("Failed to get data directory: {err}. Using home directory instead.");

        let home_dir = std::env::var(if cfg!(target_os = "windows") {
            "USERPROFILE"
        } else {
            "HOME"
        })
        .expect("Failed to determine the home directory");

        PathBuf::from(home_dir)
    })
    .join(package_name)
}

/// Resolve the Jan config file path without an AppHandle (for CLI use).
/// Canonical location is `%APPDATA%/Jan/settings.json` (or OS equivalent),
/// with fallback recovery from bundle-id location when needed.
pub fn resolve_config_file_path() -> PathBuf {
    let app_data = resolve_human_readable_app_data_dir().unwrap_or_else(|| {
        let package_name = env!("CARGO_PKG_NAME");
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_default();
        PathBuf::from(home).join(package_name)
    });

    if let Err(err) = migrate_legacy_app_configuration(&app_data) {
        log::warn!("Legacy app config migration (CLI) skipped: {err}");
    }

    app_data.join(CONFIGURATION_FILE_NAME)
}

/// Resolve the Jan data folder path without an AppHandle (for CLI use).
/// Reads AppConfiguration from the config file; falls back to the default location.
pub fn resolve_jan_data_folder() -> PathBuf {
    let config_file = resolve_config_file_path();

    if config_file.exists() {
        if let Ok(content) = fs::read_to_string(&config_file) {
            if let Ok(config) = serde_json::from_str::<AppConfiguration>(&content) {
                return PathBuf::from(config.data_folder);
            }
        }
    }

    // Default: data_dir/Jan/data  (mirrors default_data_folder_path)
    let app_name = std::env::var("APP_NAME").unwrap_or_else(|_| "Jan".to_string());
    if let Some(data_dir) = dirs::data_dir() {
        return data_dir.join(&app_name).join("data");
    }
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    PathBuf::from(home).join(&app_name).join("data")
}

#[tauri::command]
pub fn get_app_configurations<R: Runtime>(app_handle: tauri::AppHandle<R>) -> AppConfiguration {
    let mut app_default_configuration = AppConfiguration::default();

    if std::env::var("CI").unwrap_or_default() == "e2e" {
        return app_default_configuration;
    }

    let app_path = app_data_dir_with_fallback(&app_handle);
    if let Err(err) = migrate_legacy_app_configuration(&app_path) {
        log::warn!("Legacy app config migration skipped: {err}");
    }

    let configuration_file = app_path.join(CONFIGURATION_FILE_NAME);

    let default_data_folder = default_data_folder_path(app_handle.clone());

    if !configuration_file.exists() {
        log::info!("App config not found, creating default config at {configuration_file:?}");

        app_default_configuration.data_folder = default_data_folder;

        if let Err(err) = fs::write(
            &configuration_file,
            serde_json::to_string(&app_default_configuration).unwrap(),
        ) {
            log::error!("Failed to create default config: {err}");
        }

        return app_default_configuration;
    }

    match fs::read_to_string(&configuration_file) {
        Ok(content) => {
            match serde_json::from_str::<AppConfiguration>(&content) {
                Ok(app_configurations) => app_configurations,
                Err(err) => {
                    log::error!("Failed to parse app config, returning default config instead. Error: {err}");
                    // Use the proper default data folder path, not the relative "./data"
                    app_default_configuration.data_folder = default_data_folder;
                    app_default_configuration
                }
            }
        }
        Err(err) => {
            log::error!(
                "Failed to read app config, returning default config instead. Error: {err}"
            );
            // Use the proper default data folder path, not the relative "./data"
            app_default_configuration.data_folder = default_data_folder;
            app_default_configuration
        }
    }
}

#[tauri::command]
pub fn update_app_configuration<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    configuration: AppConfiguration,
) -> Result<(), String> {
    let configuration_file = get_configuration_file_path(app_handle);
    log::info!("update_app_configuration, configuration_file: {configuration_file:?}");

    fs::write(
        configuration_file,
        serde_json::to_string(&configuration).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_jan_data_folder_path<R: Runtime>(app_handle: tauri::AppHandle<R>) -> PathBuf {
    if cfg!(test) {
        use std::cell::RefCell;
        thread_local! {
            static TEST_DATA_DIR: RefCell<Option<PathBuf>> = const { RefCell::new(None) };
        }

        return TEST_DATA_DIR.with(|dir| {
            let mut dir = dir.borrow_mut();
            if dir.is_none() {
                let unique_id = std::thread::current().id();
                let timestamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0);
                let path = std::env::current_dir()
                    .unwrap_or_else(|_| PathBuf::from("."))
                    .join(format!("test-data-{unique_id:?}-{timestamp}"));
                let _ = fs::create_dir_all(&path);
                *dir = Some(path);
            }
            dir.clone().unwrap()
        });
    }

    let app_configurations = get_app_configurations(app_handle);
    PathBuf::from(app_configurations.data_folder)
}

#[tauri::command]
pub fn get_configuration_file_path<R: Runtime>(app_handle: tauri::AppHandle<R>) -> PathBuf {
    let app_path = app_data_dir_with_fallback(&app_handle);
    if let Err(err) = migrate_legacy_app_configuration(&app_path) {
        log::warn!("Legacy app config migration skipped: {err}");
    }
    app_path.join(CONFIGURATION_FILE_NAME)
}

#[tauri::command]
pub fn default_data_folder_path<R: Runtime>(app_handle: tauri::AppHandle<R>) -> String {
    let mut path = app_handle.path().data_dir().unwrap_or_else(|err| {
        log::error!("Failed to get data directory: {err}. Falling back to home directory.");
        let home = std::env::var(if cfg!(target_os = "windows") {
            "USERPROFILE"
        } else {
            "HOME"
        })
        .unwrap_or_else(|_| ".".to_string());
        PathBuf::from(home)
    });

    let app_name = std::env::var("APP_NAME")
        .unwrap_or_else(|_| app_handle.config().product_name.clone().unwrap());
    path.push(app_name);
    path.push("data");

    let mut path_str = path.to_string_lossy().into_owned();

    if let Some(stripped) = path_str.strip_suffix(".ai.app") {
        path_str = stripped.to_string();
    }

    path_str
}

#[tauri::command]
pub fn get_user_home_path<R: Runtime>(app: AppHandle<R>) -> String {
    get_app_configurations(app.clone()).data_folder
}

#[tauri::command]
pub fn change_app_data_folder<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    new_data_folder: String,
) -> Result<(), String> {
    // Get current data folder path
    let current_data_folder = get_jan_data_folder_path(app_handle.clone());
    let new_data_folder_path = PathBuf::from(&new_data_folder);

    // Create the new data folder if it doesn't exist
    if !new_data_folder_path.exists() {
        fs::create_dir_all(&new_data_folder_path)
            .map_err(|e| format!("Failed to create new data folder: {e}"))?;
    }

    // Copy all files from the old folder to the new one
    if current_data_folder.exists() {
        log::info!("Copying data from {current_data_folder:?} to {new_data_folder_path:?}");

        // Check if this is a parent directory to avoid infinite recursion
        if new_data_folder_path.starts_with(&current_data_folder) {
            return Err(
                "New data folder cannot be a subdirectory of the current data folder".to_string(),
            );
        }
        copy_dir_recursive(
            &current_data_folder,
            &new_data_folder_path,
            &[".uvx", ".npx", "openclaw"],
        )
        .map_err(|e| format!("Failed to copy data to new folder: {e}"))?;
    } else {
        log::info!("Current data folder does not exist, nothing to copy");
    }

    // Update the configuration to point to the new folder
    let mut configuration = get_app_configurations(app_handle.clone());
    configuration.data_folder = new_data_folder;

    // Save the updated configuration
    update_app_configuration(app_handle, configuration)
}

#[tauri::command]
pub fn app_token(state: State<'_, AppState>) -> Option<String> {
    state.app_token.clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;
    use tempfile::tempdir;

    #[test]
    fn migration_copies_legacy_when_canonical_missing() {
        let tmp = tempdir().expect("temp dir");
        let canonical_dir = tmp.path().join("Jan");
        let canonical = canonical_dir.join(CONFIGURATION_FILE_NAME);
        let legacy = tmp.path().join("jan.ai.app").join(CONFIGURATION_FILE_NAME);

        fs::create_dir_all(legacy.parent().unwrap()).expect("create legacy dir");
        fs::write(&legacy, r#"{"data_folder":"D:\\jan.ai"}"#).expect("write legacy config");

        migrate_from_candidates(&canonical, vec![legacy.clone()]).expect("migration succeeds");

        let recovered = fs::read_to_string(&canonical).expect("read canonical");
        assert!(recovered.contains(r#""data_folder":"D:\\jan.ai""#));
        assert!(legacy.exists(), "migration should be copy-only");
    }

    #[test]
    fn migration_skips_when_canonical_exists() {
        let tmp = tempdir().expect("temp dir");
        let canonical_dir = tmp.path().join("Jan");
        let canonical = canonical_dir.join(CONFIGURATION_FILE_NAME);
        let legacy = tmp.path().join("jan.ai.app").join(CONFIGURATION_FILE_NAME);

        fs::create_dir_all(canonical.parent().unwrap()).expect("create canonical dir");
        fs::create_dir_all(legacy.parent().unwrap()).expect("create legacy dir");
        fs::write(&canonical, r#"{"data_folder":"D:\\kept"}"#).expect("write canonical config");
        fs::write(&legacy, r#"{"data_folder":"D:\\legacy"}"#).expect("write legacy config");

        migrate_legacy_app_configuration(&canonical_dir).expect("migration succeeds");

        let current = fs::read_to_string(&canonical).expect("read canonical");
        assert!(current.contains(r#""data_folder":"D:\\kept""#));
    }

    #[test]
    fn migration_handles_missing_legacy_files() {
        let tmp = tempdir().expect("temp dir");
        let canonical = tmp.path().join("Jan").join(CONFIGURATION_FILE_NAME);
        let missing = tmp.path().join("missing").join(CONFIGURATION_FILE_NAME);

        migrate_from_candidates(&canonical, vec![missing]).expect("migration succeeds");
        assert!(!canonical.exists(), "canonical should remain absent");
    }

    #[test]
    fn bundle_identifier_matches_tauri_conf() {
        let conf_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
        let content = fs::read_to_string(conf_path).expect("read tauri.conf.json");
        let json: Value = serde_json::from_str(&content).expect("parse tauri.conf.json");
        let identifier = json
            .get("identifier")
            .and_then(|v| v.as_str())
            .expect("identifier field exists");

        assert_eq!(
            identifier, TAURI_BUNDLE_IDENTIFIER,
            "TAURI_BUNDLE_IDENTIFIER must stay synced with tauri.conf.json"
        );
    }
}
