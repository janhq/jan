//! Persistence for remote-provider API keys.
//!
//! Secrets never touch the settings file or webview storage. The key chain for
//! a provider (primary key + fallbacks) is stored as a JSON array under a stable
//! service/account pair in the OS keyring so an out-of-process consumer
//! (jan-cli) can read it.
//!
//! The Linux Secret Service needs a D-Bus session + an unlocked keyring, which
//! is often absent on headless/CI/SSH boxes. When the keyring is unavailable we
//! fall back to an encrypted, permission-restricted file
//! (`<jan_data>/provider_secrets.enc`, AES-256-GCM, `0600` on unix). The key is
//! derived from a stable per-machine id + an app salt: this defeats casual disk
//! or backup inspection, the realistic threat for a headless fallback. It is not
//! proof against an attacker who already has code + disk access on the box (no
//! local-key scheme can be). Keyring failure is never fatal; callers additionally
//! have `--api-key`/env as a last resort.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use keyring::Entry;
use sha2::{Digest, Sha256};

use crate::core::app::commands::resolve_jan_data_folder;

const KEYRING_SERVICE: &str = "jan-providers";
const SECRETS_FILE_NAME: &str = "provider_secrets.enc";
const NONCE_LEN: usize = 12;

/// Serializes read-modify-write on the fallback file.
static FILE_LOCK: Mutex<()> = Mutex::new(());

/// Latched on the first infrastructure-level keyring failure (D-Bus timeout,
/// platform/storage-access failure). Once set, every secret op skips the
/// keyring and goes straight to the encrypted file fallback for the rest of the
/// session -- otherwise each call re-attempts a dead Secret Service, blocking on
/// the D-Bus timeout and re-logging every time. A missing entry (`NoEntry`) is
/// normal and never trips this.
static KEYRING_DOWN: AtomicBool = AtomicBool::new(false);

fn keyring_down() -> bool {
    KEYRING_DOWN.load(Ordering::Relaxed)
}

/// Whether an error means the keyring backend itself is unusable (vs. a normal
/// "key not stored" or a usage error on our controlled data).
fn is_infra_failure(err: &keyring::Error) -> bool {
    matches!(
        err,
        keyring::Error::PlatformFailure(_) | keyring::Error::NoStorageAccess(_)
    )
}

/// Trip the latch on the first infrastructure failure and warn exactly once.
fn note_keyring_failure(err: &keyring::Error) {
    if is_infra_failure(err) && !KEYRING_DOWN.swap(true, Ordering::Relaxed) {
        log::warn!(
            "Keyring unavailable ({err}); using encrypted file fallback for the rest of this session"
        );
    }
}

fn keyring_entry(provider: &str) -> keyring::Result<Entry> {
    Entry::new(KEYRING_SERVICE, provider)
}

fn secrets_file_path() -> PathBuf {
    resolve_jan_data_folder().join(SECRETS_FILE_NAME)
}

/// Derive a stable 32-byte key from a per-machine id and a versioned app salt.
fn derive_cipher() -> Result<Aes256Gcm, String> {
    let machine_id = machine_uid::get().unwrap_or_else(|_| "jan-fallback-machine".to_string());
    let mut hasher = Sha256::new();
    hasher.update(b"jan-provider-secrets-v1");
    hasher.update(machine_id.as_bytes());
    let key = hasher.finalize();
    Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())
}

fn read_file_map(path: &PathBuf) -> BTreeMap<String, Vec<String>> {
    let Ok(bytes) = fs::read(path) else {
        return BTreeMap::new();
    };
    if bytes.len() <= NONCE_LEN {
        return BTreeMap::new();
    }
    let (nonce, ciphertext) = bytes.split_at(NONCE_LEN);
    let plaintext = match derive_cipher().and_then(|c| {
        c.decrypt(Nonce::from_slice(nonce), ciphertext)
            .map_err(|e| e.to_string())
    }) {
        Ok(pt) => pt,
        Err(err) => {
            log::warn!("Failed to decrypt provider secrets file: {err}");
            return BTreeMap::new();
        }
    };
    serde_json::from_slice(&plaintext).unwrap_or_default()
}

fn write_file_map_atomic(path: &PathBuf, map: &BTreeMap<String, Vec<String>>) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let plaintext = serde_json::to_vec(map).map_err(|e| e.to_string())?;
    let cipher = derive_cipher()?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_ref())
        .map_err(|e| e.to_string())?;
    let mut blob = nonce.to_vec();
    blob.extend_from_slice(&ciphertext);

    let tmp = path.with_extension("enc.tmp");
    fs::write(&tmp, &blob).map_err(|e| e.to_string())?;
    restrict_permissions(&tmp);
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    restrict_permissions(path);
    Ok(())
}

#[cfg(unix)]
fn restrict_permissions(path: &PathBuf) {
    use std::os::unix::fs::PermissionsExt;
    if let Err(err) = fs::set_permissions(path, fs::Permissions::from_mode(0o600)) {
        log::warn!("Failed to restrict permissions on {}: {err}", path.display());
    }
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &PathBuf) {}

fn file_store(provider: &str, keys: &[String]) -> Result<(), String> {
    let _guard = FILE_LOCK.lock().map_err(|e| e.to_string())?;
    let path = secrets_file_path();
    let mut map = read_file_map(&path);
    map.insert(provider.to_string(), keys.to_vec());
    write_file_map_atomic(&path, &map)
}

fn file_remove(provider: &str) -> Result<(), String> {
    let _guard = FILE_LOCK.lock().map_err(|e| e.to_string())?;
    let path = secrets_file_path();
    let mut map = read_file_map(&path);
    if map.remove(provider).is_some() {
        return write_file_map_atomic(&path, &map);
    }
    Ok(())
}

fn file_load(provider: &str) -> Vec<String> {
    read_file_map(&secrets_file_path())
        .remove(provider)
        .unwrap_or_default()
}

/// Store (or replace) the full key chain for a provider. An empty chain deletes
/// the entry so we never persist a blank secret. Prefers the OS keyring; on
/// keyring failure, writes the permission-restricted fallback file.
pub fn store_provider_keys(provider: &str, keys: &[String]) -> Result<(), String> {
    if keys.is_empty() {
        return delete_provider_keys(provider);
    }
    let serialized = serde_json::to_string(keys).map_err(|e| e.to_string())?;
    if !keyring_down() {
        match keyring_entry(provider).and_then(|e| e.set_password(&serialized)) {
            Ok(()) => {
                // Keyring is authoritative; drop any stale fallback copy.
                let _ = file_remove(provider);
                return Ok(());
            }
            Err(err) => note_keyring_failure(&err),
        }
    }
    file_store(provider, keys)
}

/// Remove a provider's stored keys from both the keyring and the fallback file.
/// Missing entries are not an error.
pub fn delete_provider_keys(provider: &str) -> Result<(), String> {
    if !keyring_down() {
        match keyring_entry(provider).and_then(|e| e.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(err) => {
                note_keyring_failure(&err);
                log::warn!("Failed to delete keyring entry for {provider}: {err}");
            }
        }
    }
    file_remove(provider)
}

/// Read a provider's key chain: keyring first, then the fallback file. Returns
/// an empty vec when neither has it (caller falls back to env/flag).
pub fn load_provider_keys(provider: &str) -> Vec<String> {
    if !keyring_down() {
        match keyring_entry(provider).and_then(|e| e.get_password()) {
            Ok(serialized) => {
                if let Ok(keys) = serde_json::from_str::<Vec<String>>(&serialized) {
                    if !keys.is_empty() {
                        return keys;
                    }
                }
            }
            Err(keyring::Error::NoEntry) => {}
            Err(err) => note_keyring_failure(&err),
        }
    }
    file_load(provider)
}

/// Store a single generic secret (e.g. the Hugging Face token) under `key`.
/// Empty value deletes it. Backed by the same keyring/encrypted-file store.
#[tauri::command]
pub async fn set_secret(key: String, value: String) -> Result<(), String> {
    // Keyring/file access is blocking; keep it off the main (UI) thread.
    tauri::async_runtime::spawn_blocking(move || {
        if value.is_empty() {
            delete_provider_keys(&key)
        } else {
            store_provider_keys(&key, std::slice::from_ref(&value))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Read a single generic secret stored via `set_secret`. None when absent.
#[tauri::command]
pub async fn get_secret(key: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || load_provider_keys(&key).into_iter().next())
        .await
        .ok()
        .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::MutexGuard;

    /// `resolve_jan_data_folder` reads process-wide env, so tests that redirect
    /// it must not run concurrently.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    struct TempDataFolder {
        _guard: MutexGuard<'static, ()>,
        prev_data_folder: Option<String>,
        _dir: tempfile::TempDir,
    }

    impl TempDataFolder {
        fn new() -> Self {
            let guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let dir = tempfile::tempdir().unwrap();
            let prev_data_folder = std::env::var("JAN_DATA_FOLDER").ok();
            // Portable override: XDG_DATA_HOME only redirects on Linux, so
            // relying on it fails the fallback tests on macOS/Windows.
            std::env::set_var("JAN_DATA_FOLDER", dir.path());
            Self {
                _guard: guard,
                prev_data_folder,
                _dir: dir,
            }
        }
    }

    impl Drop for TempDataFolder {
        fn drop(&mut self) {
            match &self.prev_data_folder {
                Some(v) => std::env::set_var("JAN_DATA_FOLDER", v),
                None => std::env::remove_var("JAN_DATA_FOLDER"),
            }
        }
    }

    #[test]
    fn file_fallback_roundtrip() {
        let _tmp = TempDataFolder::new();
        let provider = "openai";
        assert!(file_load(provider).is_empty());

        let keys = vec!["sk-primary".to_string(), "sk-fallback".to_string()];
        file_store(provider, &keys).unwrap();
        assert_eq!(file_load(provider), keys);

        file_store("anthropic", &["sk-ant".to_string()]).unwrap();
        assert_eq!(file_load(provider), keys);

        file_remove(provider).unwrap();
        assert!(file_load(provider).is_empty());
        assert_eq!(file_load("anthropic"), vec!["sk-ant".to_string()]);
    }

    #[test]
    fn only_infra_errors_latch_the_keyring_off() {
        // A missing key is normal churn -> must not disable the keyring.
        assert!(!is_infra_failure(&keyring::Error::NoEntry));
        // Backend-unusable errors (D-Bus timeout surfaces as PlatformFailure) latch.
        assert!(is_infra_failure(&keyring::Error::PlatformFailure(Box::new(
            std::io::Error::other("dbus timeout")
        ))));
        assert!(is_infra_failure(&keyring::Error::NoStorageAccess(Box::new(
            std::io::Error::other("locked")
        ))));
    }

    #[test]
    fn file_remove_missing_is_ok() {
        let _tmp = TempDataFolder::new();
        assert!(file_remove("never-stored").is_ok());
    }

    /// A stored key must persist across reloads (restarts) and only disappear on
    /// an explicit remove — never as a side effect of provider-config churn.
    /// Regression guard for keys being wiped during boot reconciliation.
    #[test]
    fn stored_keys_survive_until_explicit_remove() {
        let _tmp = TempDataFolder::new();
        let provider = "custom-router";
        let keys = vec!["sk-1234".to_string()];
        file_store(provider, &keys).unwrap();

        // Simulate a restart: re-read from disk without any register/unregister.
        assert_eq!(file_load(provider), keys, "key must survive a reload");
        assert_eq!(file_load(provider), keys, "and a second reload");

        // Only an explicit removal clears it.
        file_remove(provider).unwrap();
        assert!(file_load(provider).is_empty());
    }

    #[test]
    fn fallback_file_is_encrypted_at_rest() {
        let _tmp = TempDataFolder::new();
        let secret = "sk-super-secret-value";
        file_store("openai", &[secret.to_string()]).unwrap();
        let bytes = fs::read(secrets_file_path()).unwrap();
        let haystack = String::from_utf8_lossy(&bytes);
        assert!(!haystack.contains(secret), "secret must not appear in plaintext on disk");
        assert!(!haystack.contains("openai"), "provider name must not appear in plaintext");
    }

    #[cfg(unix)]
    #[test]
    fn fallback_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let _tmp = TempDataFolder::new();
        file_store("openai", &["sk-x".to_string()]).unwrap();
        let mode = fs::metadata(secrets_file_path()).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
