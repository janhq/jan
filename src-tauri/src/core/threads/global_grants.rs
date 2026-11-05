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

/// Persist durably before the caller acknowledges. A revocation that is
/// acknowledged and then lost (power failure between the rename and the disk
/// catching up) would be silently undone by the enabled-by-default path on the
/// next start, so: write to a temp file no concurrent save shares, flush its
/// contents to disk, atomically replace the target, then flush the directory so
/// the rename itself is on disk. Platforms without directory sync (Windows)
/// keep the file flush and the atomic replace.
fn save(data_folder: &Path, grants: GlobalGrants) -> Result<(), String> {
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let bytes = serde_json::to_vec_pretty(&grants).map_err(|e| e.to_string())?;
    let target = path(data_folder);
    let temp = data_folder.join(format!(
        "{FILE_NAME}.{}.{}.tmp",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    let written = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, &target)
    })();
    if let Err(error) = written {
        let _ = std::fs::remove_file(&temp);
        return Err(error.to_string());
    }
    sync_dir(data_folder)
}

#[cfg(unix)]
fn sync_dir(dir: &Path) -> Result<(), String> {
    std::fs::File::open(dir)
        .and_then(|d| d.sync_all())
        .map_err(|e| format!("could not sync {}: {e}", dir.display()))
}

#[cfg(not(unix))]
fn sync_dir(_dir: &Path) -> Result<(), String> {
    Ok(())
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

/// One setter transaction at a time: narrow, persist, publish and fence are a
/// unit. Two overlapping setters (enable saves and pauses; disable saves,
/// publishes and fences; enable resumes and publishes) would otherwise leave
/// the disk saying disabled while the live value says enabled.
fn setter_lock() -> &'static tokio::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(Default::default)
}

/// Apply a requested value to the live grants and the data folder.
///
/// Narrowing wins over persistence: any permission the request turns off is
/// switched off in the live value (and fenced against in-flight spawn
/// admissions) BEFORE the file is written, and stays off if the write fails --
/// an unrecorded revocation is still a revocation. Only after the file is
/// durably written is anything enabled or widened, so the live value never
/// grants more than the disk records. A persistence failure is returned.
async fn apply_chat_permissions(
    data_folder: &Path,
    value: GlobalGrants,
) -> Result<GlobalGrants, String> {
    let _transaction = setter_lock().lock().await;
    let live = tauri_plugin_agent_tools::thread_capabilities::get_global_grants();
    let narrowed = GlobalGrants {
        shell_network: live.shell_network && value.shell_network,
        memory_write: live.memory_write && value.memory_write,
    };
    if narrowed != live {
        set_global_grants(narrowed);
        // Fence: a monitor poll admitted before the switch moved is mid-spawn
        // under the admission guard. Waiting for it here means that, once the
        // value is narrowed, every later spawn admission observes it.
        drop(tauri_plugin_agent_tools::thread_capabilities::admission().lock().await);
    }
    save(data_folder, value)?;
    set_global_grants(value);
    Ok(value)
}

#[cfg(not(feature = "cli"))]
#[tauri::command]
pub async fn set_chat_permissions<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    value: GlobalGrants,
) -> Result<GlobalGrants, String> {
    let data_folder = crate::core::app::commands::get_jan_data_folder_path(app_handle);
    apply_chat_permissions(&data_folder, value).await
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

    #[cfg(unix)]
    #[test]
    fn failed_migration_write_still_enforces_legacy_opt_out() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("legacy-write-failure");
        write_legacy(
            &dir,
            serde_json::json!(r#"{"state":{"networkEnabled":false},"version":0}"#),
        );
        // Read-only folder: the settings can be read but nothing can be created.
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o555)).unwrap();
        let probe = dir.join("probe");
        let can_write = std::fs::write(&probe, b"x").is_ok();
        if can_write {
            // Running as a user the mode does not bind (root): nothing to test.
            let _ = std::fs::remove_file(&probe);
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
            return;
        }
        let loaded = load(&dir);
        let exists = path(&dir).exists();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(
            loaded,
            GlobalGrants {
                shell_network: false,
                memory_write: true,
            }
        );
        assert!(!exists);
    }

    /// R7: concurrent saves must neither fail on a shared temp file nor leave
    /// one behind, and the survivor is always one complete saved value.
    #[test]
    fn concurrent_saves_use_distinct_temp_files_and_leave_no_residue() {
        let dir = temp_dir("concurrent-save");
        let values = [
            GlobalGrants { shell_network: true, memory_write: true },
            GlobalGrants { shell_network: false, memory_write: true },
            GlobalGrants { shell_network: true, memory_write: false },
            GlobalGrants { shell_network: false, memory_write: false },
        ];
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let dir = dir.clone();
                std::thread::spawn(move || {
                    for n in 0..50 {
                        save(&dir, values[(i + n) % values.len()])
                            .unwrap_or_else(|e| panic!("save {i}/{n} failed: {e}"));
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        assert!(values.contains(&load(&dir)));
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp files left behind: {leftovers:?}");
    }

    /// A failed save removes its temp file and reports the error, so the
    /// caller never acknowledges a revocation that is not on disk.
    #[cfg(unix)]
    #[test]
    fn a_failed_save_reports_the_error_and_leaves_no_temp_file() {
        let dir = temp_dir("failed-save");
        // A directory at the target: the final rename cannot replace it.
        std::fs::create_dir(path(&dir)).unwrap();
        assert!(save(&dir, GlobalGrants::default()).is_err());
        let leftovers = std::fs::read_dir(&dir)
            .unwrap()
            .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(leftovers, 0);
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

    /// Serializes the tests below, which drive the process-wide live grants.
    fn live_grants_guard() -> std::sync::MutexGuard<'static, ()> {
        static G: std::sync::Mutex<()> = std::sync::Mutex::new(());
        G.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// E1: a revocation whose write fails is still applied to the live value
    /// and the error is surfaced; a widening whose write fails is not.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_revocation_survives_a_failed_write_and_a_widening_does_not() {
        use std::os::unix::fs::PermissionsExt;
        let _g = live_grants_guard();
        let dir = temp_dir("narrow-on-failed-write");
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o555)).unwrap();
        if std::fs::write(dir.join("probe"), b"x").is_ok() {
            let _ = std::fs::remove_file(dir.join("probe"));
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
            return; // the mode does not bind this user (root)
        }
        let on = GlobalGrants { shell_network: true, memory_write: true };
        let off = GlobalGrants { shell_network: false, memory_write: false };
        set_global_grants(on);
        assert!(apply_chat_permissions(&dir, off).await.is_err());
        let after_revoke = get_live();
        // Widening while the write fails must not enable anything.
        assert!(apply_chat_permissions(&dir, on).await.is_err());
        let after_widen = get_live();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        set_global_grants(on);
        assert_eq!(after_revoke, off, "an unpersisted revocation must still take effect");
        assert_eq!(after_widen, off, "an unpersisted widening must not take effect");
    }

    fn get_live() -> GlobalGrants {
        tauri_plugin_agent_tools::thread_capabilities::get_global_grants()
    }

    /// E2: overlapping setters leave the live value and the file in agreement.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn overlapping_setters_leave_live_and_persisted_state_equal() {
        let _g = live_grants_guard();
        let dir = temp_dir("overlapping-setters");
        let on = GlobalGrants { shell_network: true, memory_write: true };
        let off = GlobalGrants { shell_network: false, memory_write: false };
        for round in 0..150 {
            set_global_grants(on);
            save(&dir, on).unwrap();
            let (d1, d2) = (dir.clone(), dir.clone());
            let (first, second) = if round % 2 == 0 { (on, off) } else { (off, on) };
            let a = tokio::spawn(async move { apply_chat_permissions(&d1, first).await });
            let b = tokio::spawn(async move { apply_chat_permissions(&d2, second).await });
            a.await.unwrap().unwrap();
            b.await.unwrap().unwrap();
            assert_eq!(get_live(), load(&dir), "round {round}: live and persisted diverged");
        }
        set_global_grants(on);
    }
}
