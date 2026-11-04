//! App-wide Chat permissions: shell network access and durable memory writes.
//!
//! These are settings, not per-conversation consent. The host owns the value:
//! it is stored in the data folder, loaded at startup and changed only through
//! [`set_chat_permissions`]. The agent-tools plugin overlays it on every layer of
//! a conversation's grant, so the webview can never widen it by claiming a grant.
//! Both default to on, matching the old Cowork behaviour; a conversation's folder
//! scope is unaffected and stays per-conversation.

use std::path::{Path, PathBuf};
use tauri_plugin_agent_tools::thread_capabilities::{set_global_grants, GlobalGrants};

const FILE_NAME: &str = "chat-permissions.json";

fn path(data_folder: &Path) -> PathBuf {
    data_folder.join(FILE_NAME)
}

/// A missing file migrates an explicit legacy network opt-out, otherwise it is
/// first use (everything on). Persist that decision before startup installs it.
/// Existing settings fail closed: invalid or absent fields are off, without
/// discarding valid independent fields.
pub fn load(data_folder: &Path) -> GlobalGrants {
    let bytes = match std::fs::read(path(data_folder)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut grants = GlobalGrants::default();
            if legacy_network_disabled(data_folder) {
                grants.shell_network = false;
            }
            // Even if persistence fails, enforce the migrated opt-out for this
            // run; a later startup can retry without ever widening that grant.
            if let Err(error) = save(data_folder, grants) {
                log::warn!("Failed to persist initial Chat permissions: {error}");
            }
            return grants;
        }
        Err(_) => return closed(),
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return closed();
    };
    GlobalGrants {
        shell_network: value
            .get("shellNetwork")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        memory_write: value
            .get("memoryWrite")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    }
}

/// backendStorage stores each Zustand persist envelope as a JSON *string*
/// inside the flat settings.json map. Only the boolean false is an opt-out;
/// absent or malformed legacy data keeps the original on-by-default behavior.
fn legacy_network_disabled(data_folder: &Path) -> bool {
    let read = || -> Option<bool> {
        let bytes =
            std::fs::read(data_folder.join(crate::core::app::constants::CONFIGURATION_FILE_NAME))
                .ok()?;
        let settings: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
        let blob = settings.get("setting-cowork")?.as_str()?;
        let store: serde_json::Value = serde_json::from_str(blob).ok()?;
        store.get("state")?.get("networkEnabled")?.as_bool()
    };
    read() == Some(false)
}

fn closed() -> GlobalGrants {
    GlobalGrants {
        shell_network: false,
        memory_write: false,
    }
}

fn save(data_folder: &Path, grants: GlobalGrants) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(&grants).map_err(|e| e.to_string())?;
    let target = path(data_folder);
    let temp = target.with_extension("json.tmp");
    std::fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&temp, &target).map_err(|e| e.to_string())
}

/// Load the stored value into the plugin. Called once at startup.
pub fn install(data_folder: &Path) {
    set_global_grants(load(data_folder));
}

#[cfg(not(feature = "cli"))]
#[tauri::command]
pub fn get_chat_permissions() -> GlobalGrants {
    tauri_plugin_agent_tools::thread_capabilities::get_global_grants()
}

/// Persist first, then apply: a failed write leaves the live value as it was,
/// so the settings screen never shows a state the host is not enforcing.
#[cfg(not(feature = "cli"))]
#[tauri::command]
pub fn set_chat_permissions<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    value: GlobalGrants,
) -> Result<GlobalGrants, String> {
    let data_folder = crate::core::app::commands::get_jan_data_folder_path(app_handle);
    save(&data_folder, value)?;
    set_global_grants(value);
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("jan-global-grants-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_file_defaults_to_everything_on() {
        let dir = temp_dir("missing");
        assert_eq!(
            load(&dir),
            GlobalGrants {
                shell_network: true,
                memory_write: true
            }
        );
        let persisted: GlobalGrants =
            serde_json::from_slice(&std::fs::read(path(&dir)).unwrap()).unwrap();
        assert_eq!(persisted, GlobalGrants::default());
    }

    fn write_legacy(dir: &Path, blob: serde_json::Value) {
        std::fs::write(
            dir.join("settings.json"),
            serde_json::to_vec(&serde_json::json!({ "setting-cowork": blob })).unwrap(),
        )
        .unwrap();
    }

    #[test]
    fn legacy_network_opt_out_is_migrated_and_persisted() {
        let dir = temp_dir("legacy-opt-out");
        write_legacy(
            &dir,
            serde_json::json!(r#"{"state":{"networkEnabled":false},"version":0}"#),
        );
        let legacy_before = std::fs::read(dir.join("settings.json")).unwrap();
        let expected = GlobalGrants {
            shell_network: false,
            memory_write: true,
        };
        assert_eq!(load(&dir), expected);
        let persisted: GlobalGrants =
            serde_json::from_slice(&std::fs::read(path(&dir)).unwrap()).unwrap();
        assert_eq!(persisted, expected);
        assert_eq!(
            std::fs::read(dir.join("settings.json")).unwrap(),
            legacy_before
        );
        // The new host-owned file, not the old store, is authoritative after migration.
        std::fs::remove_file(dir.join("settings.json")).unwrap();
        assert_eq!(load(&dir), expected);
    }

    #[test]
    fn only_an_explicit_legacy_boolean_false_opts_out() {
        let dir = temp_dir("legacy-defaults");
        for blob in [
            serde_json::json!(r#"{"state":{"networkEnabled":true},"version":0}"#),
            serde_json::json!(r#"{"state":{"networkEnabled":"false"}}"#),
            serde_json::json!(r#"{"state":{"networkEnabled":null}}"#),
            serde_json::json!(r#"{"networkEnabled":false}"#),
            serde_json::json!(r#"{"state":{}}"#),
            serde_json::json!("{not json"),
            serde_json::json!({ "state": { "networkEnabled": false } }),
        ] {
            write_legacy(&dir, blob.clone());
            assert_eq!(load(&dir), GlobalGrants::default(), "{blob}");
            assert!(path(&dir).is_file());
            std::fs::remove_file(path(&dir)).unwrap();
        }
        for bytes in ["{not json", "{}", "null"] {
            std::fs::write(dir.join("settings.json"), bytes).unwrap();
            assert_eq!(load(&dir), GlobalGrants::default());
            std::fs::remove_file(path(&dir)).unwrap();
        }
    }

    #[test]
    fn existing_permissions_override_legacy_and_are_not_rewritten() {
        let dir = temp_dir("legacy-existing");
        write_legacy(
            &dir,
            serde_json::json!(r#"{"state":{"networkEnabled":false},"version":0}"#),
        );
        for (bytes, expected) in [
            (
                r#"{"shellNetwork":true,"memoryWrite":false}"#,
                GlobalGrants {
                    shell_network: true,
                    memory_write: false,
                },
            ),
            ("{not json", closed()),
            ("{}", closed()),
        ] {
            std::fs::write(path(&dir), bytes).unwrap();
            assert_eq!(load(&dir), expected);
            assert_eq!(std::fs::read_to_string(path(&dir)).unwrap(), bytes);
        }
    }

    #[test]
    fn failed_migration_write_still_enforces_legacy_opt_out() {
        let dir = temp_dir("legacy-write-failure");
        write_legacy(
            &dir,
            serde_json::json!(r#"{"state":{"networkEnabled":false},"version":0}"#),
        );
        std::fs::create_dir(path(&dir).with_extension("json.tmp")).unwrap();
        assert_eq!(
            load(&dir),
            GlobalGrants {
                shell_network: false,
                memory_write: true,
            }
        );
        assert!(!path(&dir).exists());
    }

    #[test]
    fn corrupt_file_fails_closed() {
        let dir = temp_dir("corrupt");
        std::fs::write(path(&dir), b"{not json").unwrap();
        assert_eq!(load(&dir), closed());
    }

    #[test]
    fn unreadable_file_fails_closed() {
        let dir = temp_dir("unreadable");
        // A directory cannot be read as a settings file, even when running as root.
        std::fs::create_dir(path(&dir)).unwrap();
        assert_eq!(load(&dir), closed());
    }

    #[test]
    fn invalid_settings_fail_closed_per_field() {
        let dir = temp_dir("invalid-fields");
        for (json, expected) in [
            ("null", closed()),
            ("[]", closed()),
            ("true", closed()),
            ("{}", closed()),
            (r#"{"shellNetwork":false}"#, closed()),
            (
                r#"{"shellNetwork":true,"memoryWrite":"true"}"#,
                GlobalGrants {
                    shell_network: true,
                    memory_write: false,
                },
            ),
            (
                r#"{"shellNetwork":null,"memoryWrite":true}"#,
                GlobalGrants {
                    shell_network: false,
                    memory_write: true,
                },
            ),
            (r#"{"shellNetwork":false,"memoryWrite":123}"#, closed()),
        ] {
            std::fs::write(path(&dir), json).unwrap();
            assert_eq!(load(&dir), expected, "{json}");
        }
    }

    #[test]
    fn a_saved_value_round_trips_and_is_independent_per_field() {
        let dir = temp_dir("roundtrip");
        let value = GlobalGrants {
            shell_network: false,
            memory_write: true,
        };
        save(&dir, value).unwrap();
        assert_eq!(load(&dir), value);
        let flipped = GlobalGrants {
            shell_network: true,
            memory_write: false,
        };
        save(&dir, flipped).unwrap();
        assert_eq!(load(&dir), flipped);
    }
}
