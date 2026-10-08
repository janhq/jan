//! Versioned credential records persisted through the shared secret store
//! (`provider_secrets`: OS keyring first, encrypted permission-restricted file
//! fallback). A credential is the only thing that knows a key or token; the
//! provider catalog and provider configuration never do.

use serde::{Deserialize, Serialize};

use crate::core::server::provider_secrets;

/// Credential record format version; bump on any breaking shape change.
const CREDENTIAL_VERSION: u32 = 1;

/// What a provider account is authenticated with. Stored only as a versioned
/// record under `auth:<provider>`; never in config, logs, or transcripts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum Credential {
    ApiKey(String),
    OAuthToken(OAuthToken),
}

impl Credential {
    /// The API key, when this credential is a plain key.
    pub fn as_api_key(&self) -> Option<&str> {
        match self {
            Credential::ApiKey(key) => Some(key.as_str()),
            Credential::OAuthToken(_) => None,
        }
    }

    /// The OAuth token bundle, when this credential is an account login.
    pub fn as_oauth(&self) -> Option<&OAuthToken> {
        match self {
            Credential::ApiKey(_) => None,
            Credential::OAuthToken(token) => Some(token),
        }
    }
}

/// An OAuth access token plus the fields needed to refresh it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OAuthToken {
    pub access_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    /// Unix seconds at which the access token expires; `None` when unknown.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,
    pub token_type: String,
    #[serde(default)]
    pub scopes: Vec<String>,
}

/// Read/write versioned credential records under `auth:<provider>` in the
/// shared secret store. Has no TUI or HTTP dependency, so any caller can use
/// it without pulling in presentation concerns.
pub struct CredentialStore;

impl CredentialStore {
    /// Replace the stored credential for `provider`. An empty record never
    /// exists: `store` with a value that serializes to nothing is rejected.
    pub fn store(provider: &str, credential: &Credential) -> Result<(), String> {
        let record = serde_json::json!({
            "version": CREDENTIAL_VERSION,
            "credential": credential,
        });
        let raw = record.to_string();
        if raw.is_empty() {
            return Err("credential record serialized to nothing".to_string());
        }
        provider_secrets::store_secret_record(&secret_key(provider), &raw)
    }

    /// The stored credential for `provider`, or `None`. A record with an
    /// unknown version or an unparsable body is treated as absent rather than
    /// surfaced, so a future format change degrades to "please sign in again".
    pub fn load(provider: &str) -> Result<Option<Credential>, String> {
        let Some(raw) = provider_secrets::load_secret_record(&secret_key(provider)) else {
            return Ok(None);
        };
        let parsed: serde_json::Value =
            serde_json::from_str(&raw).map_err(|e| format!("stored credential is unreadable: {e}"))?;
        if parsed.get("version").and_then(|v| v.as_u64()) != Some(CREDENTIAL_VERSION as u64) {
            return Ok(None);
        }
        let body = parsed.get("credential").cloned().unwrap_or(serde_json::Value::Null);
        serde_json::from_value(body)
            .map(Some)
            .map_err(|e| format!("stored credential is unreadable: {e}"))
    }

    /// Remove the stored credential for `provider`. Missing entries are not an
    /// error.
    pub fn delete(provider: &str) -> Result<(), String> {
        provider_secrets::delete_secret_record(&secret_key(provider))
    }
}

fn secret_key(provider: &str) -> String {
    format!("auth:{provider}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::server::provider_secrets::SECRET_STORE_TEST_LOCK;
    use std::sync::MutexGuard;

    struct TempSecrets {
        _guard: MutexGuard<'static, ()>,
        prev_data_folder: Option<String>,
        _dir: tempfile::TempDir,
    }

    impl TempSecrets {
        fn new() -> Self {
            let guard = SECRET_STORE_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let dir = tempfile::tempdir().unwrap();
            let prev_data_folder = std::env::var("JAN_DATA_FOLDER").ok();
            std::env::set_var("JAN_DATA_FOLDER", dir.path());
            crate::core::server::provider_secrets::force_file_secrets();
            Self {
                _guard: guard,
                prev_data_folder,
                _dir: dir,
            }
        }
    }

    impl Drop for TempSecrets {
        fn drop(&mut self) {
            match &self.prev_data_folder {
                Some(v) => std::env::set_var("JAN_DATA_FOLDER", v),
                None => std::env::remove_var("JAN_DATA_FOLDER"),
            }
        }
    }

    fn oauth_credential() -> Credential {
        Credential::OAuthToken(OAuthToken {
            access_token: "access".into(),
            refresh_token: Some("refresh".into()),
            expires_at: Some(1_800_000_000),
            token_type: "Bearer".into(),
            scopes: vec!["model.read".into()],
        })
    }

    #[test]
    fn credential_store_roundtrips_oauth_without_provider_config() {
        let _tmp = TempSecrets::new();
        let credential = oauth_credential();
        CredentialStore::store("openai", &credential).unwrap();
        assert_eq!(CredentialStore::load("openai").unwrap(), Some(credential));
    }

    #[test]
    fn credential_store_roundtrips_and_deletes_api_key() {
        let _tmp = TempSecrets::new();
        let credential = Credential::ApiKey("sk-live".into());
        CredentialStore::store("deepseek", &credential).unwrap();
        assert_eq!(CredentialStore::load("deepseek").unwrap(), Some(credential));

        CredentialStore::delete("deepseek").unwrap();
        assert_eq!(CredentialStore::load("deepseek").unwrap(), None);
        // Deleting one provider never touches another's record.
        assert_eq!(CredentialStore::load("openai").unwrap(), None);
    }

    #[test]
    fn load_missing_provider_is_none_and_delete_is_idempotent() {
        let _tmp = TempSecrets::new();
        assert_eq!(CredentialStore::load("anthropic").unwrap(), None);
        assert!(CredentialStore::delete("anthropic").is_ok());
    }

    #[test]
    fn provider_records_are_namespaced_away_from_key_chains() {
        let _tmp = TempSecrets::new();
        // A legacy provider key chain and a login credential share a provider
        // name but must not collide on storage.
        crate::core::server::provider_secrets::store_provider_keys(
            "openai",
            &["sk-legacy".to_string()],
        )
        .unwrap();
        let credential = Credential::ApiKey("sk-login".into());
        CredentialStore::store("openai", &credential).unwrap();
        assert_eq!(CredentialStore::load("openai").unwrap(), Some(credential));
        assert_eq!(
            crate::core::server::provider_secrets::load_provider_keys("openai"),
            vec!["sk-legacy".to_string()]
        );
    }
}
