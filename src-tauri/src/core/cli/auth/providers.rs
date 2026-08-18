//! API-key validation and the login/logout transaction.
//!
//! Ordering is the security contract: sanitize, then validate over HTTP,
//! then persist the secret, then write only non-secret provider
//! configuration. A failure at any point leaves nothing behind - a rejected
//! key never creates a credential record or a config entry, and a failed
//! write rolls back the secret it already stored.

use std::time::Duration;

use crate::core::agent::global_config::{
    remove_provider, set_default_model_if_unset, set_provider, ProviderUpdate,
};

use super::{Credential, CredentialStore, LoginError, LoginResult, ProviderDefinition, Transport};

const VERIFY_TIMEOUT: Duration = Duration::from_secs(20);

/// Validates and persists provider sign-ins. Stateless: callers construct one
/// per flow and share it across attempts.
pub struct LoginService;

impl LoginService {
    /// Trim and reject a key before any I/O. A key with interior whitespace is
    /// a mis-paste (partial selection, wrapped line) that would otherwise fail
    /// as a confusing 401.
    pub fn sanitize_key(raw: &str) -> Result<String, String> {
        let key = raw.trim();
        if key.is_empty() {
            return Err("no API key entered".to_string());
        }
        if key.chars().any(char::is_whitespace) {
            return Err("that key contains spaces or line breaks - copy it again".to_string());
        }
        Ok(key.to_string())
    }

    /// Validate `raw_key` against the provider's model endpoint, then persist
    /// the credential (secret store) and non-secret provider configuration.
    /// Nothing is written when validation fails.
    pub async fn login_with_api_key(
        &self,
        definition: &ProviderDefinition,
        raw_key: &str,
    ) -> Result<LoginResult, LoginError> {
        let key = Self::sanitize_key(raw_key).map_err(LoginError::InvalidKey)?;
        let models = discover_models(definition, &key, false).await?;
        persist(definition, &key, &models)
    }

    /// Remove the stored credential and the provider's non-secret
    /// configuration entry. Missing entries are not an error.
    pub fn logout(&self, provider: &str) -> Result<(), LoginError> {
        CredentialStore::delete(provider).map_err(|e| {
            LoginError::Persist(format!("could not clear the stored credential: {e}"))
        })?;
        remove_provider(provider).map_err(|e| {
            LoginError::Persist(format!("could not clear the provider configuration: {e}"))
        })?;
        Ok(())
    }
}

pub(crate) async fn discover_models(
    definition: &ProviderDefinition,
    credential: &str,
    oauth: bool,
) -> Result<Vec<String>, LoginError> {
    let client = reqwest::Client::builder()
        .timeout(VERIFY_TIMEOUT)
        .build()
        .map_err(|e| LoginError::Unavailable(format!("could not build an HTTP client: {e}")))?;
    let url = format!(
        "{}/models",
        definition.default_base_url.trim_end_matches('/')
    );
    let mut request = client.get(&url);
    request = match definition.transport {
        // An API-key credential identifies itself with `x-api-key`; an OAuth
        // access token must go as `Authorization: Bearer` (with the oauth beta
        // header), or Anthropic rejects the discovery with 401.
        Transport::Anthropic if oauth => request
            .header("Authorization", format!("Bearer {credential}"))
            .header("anthropic-beta", "oauth-2025-04-20")
            .header("anthropic-version", "2023-06-01")
            .header("Accept", "application/json"),
        Transport::Anthropic => request
            .header("x-api-key", credential)
            .header("anthropic-version", "2023-06-01")
            .header("Accept", "application/json"),
        Transport::OpenAi => request.header("Authorization", format!("Bearer {credential}")),
    };
    let response = request.send().await.map_err(|e| {
        LoginError::Unavailable(format!(
            "could not reach {}: {e}",
            definition.default_base_url
        ))
    })?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(failure_for(definition, status.as_u16(), &body));
    }
    let parsed: serde_json::Value = serde_json::from_str(&body).map_err(|e| {
        LoginError::Unavailable(format!(
            "{} returned a response we could not read: {e}",
            definition.name
        ))
    })?;
    Ok(parse_models(&parsed))
}

/// Discover the models available to a Codex (ChatGPT account) OAuth token.
///
/// A Codex account token is a ChatGPT account credential, not an OpenAI API
/// key, so `api.openai.com/v1/models` rejects it with 401. The models are
/// instead served by ChatGPT's own backend, which the Codex CLI (and pi)
/// targets at `chatgpt.com/backend-api/codex/models`. That endpoint is distinct
/// from `chatgpt.com/backend-api/models`: the latter returns the internal
/// rolling/user-scoped ChatGPT roster (e.g. `gpt-5.6-luna-wm`) that has no real
/// upstream session, whereas `/codex/models` returns the stable Codex slugs
/// (`gpt-5.5`, `gpt-5.4`, ...) that the Responses API actually serves. The
/// Codex client identifiers (`client_version`, `chatgpt-account-id`,
/// `OpenAI-Beta`, `originator`, `version`) are mirrored from the pi coding
/// agent so the backend returns the Codex roster instead of the ChatGPT one.
///
/// `base_url` is the persisted Codex provider base (the OpenAI API-key surface
/// `api.openai.com/v1`); it is rewritten to the ChatGPT backend origin, or used
/// verbatim in tests. Falls back to `/models` when `/codex/models` is not
/// served.
pub(crate) async fn discover_codex_models(
    credential: &str,
    account_id: Option<&str>,
    base_url: &str,
) -> Result<Vec<String>, LoginError> {
    // The persisted Codex default_base_url points at the OpenAI API-key
    // surface (`api.openai.com/v1`), which rejects an account token. Discovery
    // must target the ChatGPT backend instead; a test override (the mock
    // model server) is used verbatim.
    let backend = if base_url.trim_end_matches('/').ends_with("api.openai.com/v1") {
        "https://chatgpt.com/backend-api"
    } else {
        base_url
    };
    let client = reqwest::Client::builder()
        .timeout(VERIFY_TIMEOUT)
        .build()
        .map_err(|e| LoginError::Unavailable(format!("could not build an HTTP client: {e}")))?;

    // `/codex/models` is the Codex roster; `/models` is the plain ChatGPT
    // roster and is kept only as a fallback for backends that omit the Codex
    // route (matching pi's `DEFAULT_MODEL_LIST_PATHS`).
    let paths = ["/codex/models", "/models"];
    let mut last_error: Option<LoginError> = None;
    for path in paths {
        let url = format!("{}{}", backend.trim_end_matches('/'), path);
        let mut request = client
            .get(&url)
            .header("Authorization", format!("Bearer {credential}"))
            .header("Accept", "application/json");
        // Only the Codex route is marked with the Codex client identifiers.
        if path == "/codex/models" {
            request = request
                .query(&[("client_version", "0.144.1")])
                .header("OpenAI-Beta", "responses=experimental")
                .header("originator", "jan")
                .header("version", "0.144.1");
            if let Some(account_id) = account_id {
                request = request.header("chatgpt-account-id", account_id);
            }
        }
        match request.send().await {
            Ok(response) => {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                if !status.is_success() {
                    last_error = Some(match status.as_u16() {
                        401 | 403 => LoginError::Unauthorized,
                        429 => LoginError::RateLimited,
                        500..=599 => LoginError::Unavailable(format!(
                            "the ChatGPT backend is unavailable right now (HTTP {status})."
                        )),
                        _ => LoginError::Unavailable(format!(
                            "the ChatGPT backend returned HTTP {status}."
                        )),
                    });
                    continue;
                }
                let parsed: serde_json::Value = serde_json::from_str(&body).map_err(|e| {
                    LoginError::Unavailable(format!(
                        "the ChatGPT backend returned a response we could not read: {e}"
                    ))
                })?;
                return Ok(parse_codex_models(&parsed));
            }
            Err(e) => {
                last_error = Some(LoginError::Unavailable(format!(
                    "could not reach the ChatGPT backend: {e}"
                )));
                continue;
            }
        }
    }
    Err(last_error.unwrap_or(LoginError::Unavailable(
        "the ChatGPT backend returned no usable model roster".to_string(),
    )))
}

/// Stable Codex model slugs from a `/codex/models` payload, sorted, deduped,
/// and with hidden/rolling entries filtered out. Accepts both the ChatGPT
/// backend shape (`{"models":[{slug,display_name,visibility}]}`) and the
/// OpenAI shape (`{"data":[{"id"}]}`) for backends that serve either.
fn parse_codex_models(value: &serde_json::Value) -> Vec<String> {
    let entries = value
        .get("models")
        .and_then(|m| m.as_array())
        .or_else(|| value.get("data").and_then(|d| d.as_array()))
        .into_iter()
        .flatten();
    let mut ids: Vec<String> = entries
        .filter_map(|entry| {
            // A `visibility` of `hide` shadows internal/rolling roster entries.
            let visibility = entry
                .get("visibility")
                .and_then(|v| v.as_str())
                .map(str::to_ascii_lowercase)
                .unwrap_or_default();
            if visibility == "hide" || visibility == "hidden" {
                return None;
            }
            // Stable slug/id, or a bare string slug for minimal gateways.
            let id = entry
                .get("slug")
                .and_then(|s| s.as_str())
                .or_else(|| entry.get("id").and_then(|s| s.as_str()))
                .or_else(|| entry.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(String::from);
            id
        })
        .collect();
    // Rolling ChatGPT codenames carry a user-scoped suffix (e.g.
    // `gpt-5.6-luna-wm`); they are not stable Codex models, so drop them.
    ids.retain(|id| !matches!(id.split('-').last(), Some("wm")));
    ids.sort();
    ids.dedup();
    ids
}

/// Human-readable reason a verification request was rejected. Never includes
/// the key.
fn failure_for(definition: &ProviderDefinition, status: u16, _body: &str) -> LoginError {
    match status {
        401 | 403 => LoginError::Unauthorized,
        429 => LoginError::RateLimited,
        500..=599 => LoginError::Unavailable(format!(
            "{} is unavailable right now (HTTP {status}).",
            definition.name
        )),
        _ => LoginError::Unavailable(format!("{} returned HTTP {status}.", definition.name)),
    }
}

/// Model ids from a `/models` payload, sorted and deduped so a config write
/// and the "N models" report are stable across calls. Accepts the OpenAI shape
/// (`{"data":[{"id":...}]}`) plus the bare-array and array-of-strings variants
/// smaller gateways serve. Anthropic's `/models` uses the same `data` shape.
pub(crate) fn parse_models(value: &serde_json::Value) -> Vec<String> {
    let entries = value
        .get("data")
        .and_then(|d| d.as_array())
        .or_else(|| value.as_array());
    let Some(entries) = entries else {
        return Vec::new();
    };
    let mut ids: Vec<String> = entries
        .iter()
        .filter_map(|entry| {
            entry
                .as_str()
                .or_else(|| entry.get("id").and_then(|id| id.as_str()))
        })
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(String::from)
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

/// Write the verified key + model list. Secret first, then non-secret
/// configuration; a failed config write rolls back the secret.
fn persist(
    definition: &ProviderDefinition,
    key: &str,
    models: &[String],
) -> Result<LoginResult, LoginError> {
    CredentialStore::store(definition.id, &Credential::ApiKey(key.to_string()))
        .map_err(|e| LoginError::Persist(format!("could not save the credential securely: {e}")))?;

    let config_path = match set_provider(
        definition.id,
        ProviderUpdate {
            // Keys never enter provider configuration; the credential store is
            // the only home for secrets.
            api_key: None,
            // Migrate away any legacy plaintext key the entry still holds.
            clear_api_key: true,
            base_url: Some(definition.default_base_url.clone()),
            models: Some(models.to_vec()),
            api_type: match definition.transport {
                Transport::Anthropic => Some("anthropic".to_string()),
                Transport::OpenAi => None,
            },
        },
    ) {
        Ok(path) => path,
        Err(e) => {
            let _ = CredentialStore::delete(definition.id);
            return Err(LoginError::Persist(format!(
                "could not save the provider configuration: {e}"
            )));
        }
    };

    // Adopt the first discovered model as the default only when the user has
    // none; an explicit choice is never overwritten. A failure here is not
    // fatal: the sign-in itself is complete and the config is valid.
    let default_model = match models.first() {
        Some(first) => match set_default_model_if_unset(first) {
            Ok(true) => Some(first.clone()),
            _ => None,
        },
        None => None,
    };

    Ok(LoginResult {
        provider: definition.id.to_string(),
        models: models.to_vec(),
        config_path,
        default_model,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::global_config::{load_global_config, with_temp_home};
    use crate::core::cli::auth::provider_by_id;
    use crate::core::server::provider_secrets::SECRET_STORE_TEST_LOCK;
    use serde_json::json;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::MutexGuard;

    struct TempSecrets {
        _guard: MutexGuard<'static, ()>,
        prev_data_folder: Option<String>,
        _dir: tempfile::TempDir,
    }

    impl TempSecrets {
        fn new() -> Self {
            let guard = SECRET_STORE_TEST_LOCK
                .lock()
                .unwrap_or_else(|e| e.into_inner());
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

    /// A one-shot HTTP server answering with `status` and `body`, returning its
    /// base URL. The thread detaches; it serves exactly one request.
    fn mock_server(status_line: &'static str, body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming().take(1) {
                let Ok(mut stream) = stream else { continue };
                let _ = Read::read(&mut stream, &mut [0u8; 4096]);
                let response = format!(
                    "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = Write::write_all(&mut stream, response.as_bytes());
            }
        });
        format!("http://{addr}/v1")
    }

    fn deepseek_at(endpoint: String) -> ProviderDefinition {
        let mut def = provider_by_id("deepseek").unwrap();
        def.default_base_url = endpoint;
        def
    }

    fn login_for_test(
        definition: &ProviderDefinition,
        key: &str,
    ) -> Result<LoginResult, LoginError> {
        let definition = definition.clone();
        let key = key.to_string();
        std::thread::spawn(move || {
            tokio::runtime::Runtime::new()
                .unwrap()
                .block_on(LoginService.login_with_api_key(&definition, &key))
        })
        .join()
        .expect("verification thread must not panic")
    }

    #[test]
    fn sanitize_trims_and_rejects_unusable_input() {
        assert_eq!(LoginService::sanitize_key("  sk-abc\n").unwrap(), "sk-abc");
        assert!(LoginService::sanitize_key("   ").is_err());
        assert!(LoginService::sanitize_key("").is_err());
        assert!(LoginService::sanitize_key("sk-abc def").is_err());
        assert!(LoginService::sanitize_key("sk-abc\ndef").is_err());
    }

    #[test]
    fn parses_openai_and_bare_model_lists_sorted_and_deduped() {
        let body = json!({"data": [{"id": "deepseek-chat"}, {"id": "b"}, {"id": "b"}]});
        assert_eq!(
            parse_models(&body),
            vec!["b".to_string(), "deepseek-chat".to_string()]
        );
        assert_eq!(
            parse_models(&json!(["x", {"id": "y"}])),
            vec!["x".to_string(), "y".to_string()]
        );
        assert!(parse_models(&json!({"data": []})).is_empty());
        assert!(parse_models(&json!({"unexpected": 1})).is_empty());
    }
    #[test]
    fn codex_models_filters_rolling_codenames_and_hidden_entries() {
        // Stable Codex slugs are kept; rolling user-scoped ChatGPT codenames
        // (the `-wm` suffix that has no upstream session) and `visibility: hide`
        // entries are dropped, exactly so the picker never offers a model that
        // later fails "No upstream session found for model ...".
        let body = json!({
            "models": [
                {"slug": "gpt-5.5", "display_name": "GPT-5.5"},
                {"slug": "gpt-5.6-luna-wm", "display_name": "GPT-5.6 Luna"},
                {"slug": "gpt-5.4", "display_name": "GPT-5.4", "visibility": "hide"},
                {"slug": "gpt-5.3", "display_name": "GPT-5.3", "visibility": "hidden"}
            ]
        });
        assert_eq!(
            parse_codex_models(&body),
            vec!["gpt-5.5".to_string()]
        );
        // Accepts the OpenAI `data` shape for backends that serve either.
        assert_eq!(
            parse_codex_models(&json!({"data": [{"id": "gpt-5.4"}, {"id": "gpt-5.5"}]})),
            vec!["gpt-5.4".to_string(), "gpt-5.5".to_string()]
        );
        assert!(parse_codex_models(&json!({"models": []})).is_empty());
    }

    #[test]
    fn provider_error_never_echoes_the_submitted_key() {
        let definition = provider_by_id("deepseek").unwrap();
        let error = failure_for(
            &definition,
            400,
            r#"{"error":{"message":"invalid key sk-secret"}}"#,
        );
        let LoginError::Unavailable(message) = error else {
            panic!("HTTP 400 must be an unavailable error");
        };
        assert!(!message.contains("sk-secret"), "{message}");
    }

    #[test]
    fn rejected_key_never_writes_a_secret_or_provider_config() {
        let _tmp = TempSecrets::new();
        with_temp_home(|_| {
            let endpoint = mock_server("401 Unauthorized", "{}");
            let result = login_for_test(&deepseek_at(endpoint), "bad");
            assert!(matches!(result, Err(LoginError::Unauthorized)));
            assert!(CredentialStore::load("deepseek").unwrap().is_none());
            assert!(load_global_config().unwrap().get("deepseek").is_none());
        });
    }

    #[tokio::test]
    async fn rate_limited_key_maps_to_rate_limited_error() {
        let _tmp = TempSecrets::new();
        let endpoint = mock_server("429 Too Many Requests", "{}");
        let result = LoginService
            .login_with_api_key(&deepseek_at(endpoint), "sk-busy")
            .await;
        assert!(matches!(result, Err(LoginError::RateLimited)));
    }

    #[tokio::test]
    async fn unreachable_provider_maps_to_unavailable() {
        let _tmp = TempSecrets::new();
        // Nothing listens on this port: connection refused.
        let def = deepseek_at("http://127.0.0.1:9/v1".to_string());
        let result = LoginService.login_with_api_key(&def, "sk-x").await;
        assert!(matches!(result, Err(LoginError::Unavailable(_))));
    }

    #[tokio::test]
    async fn valid_key_persists_secret_and_non_secret_config() {
        let _tmp = TempSecrets::new();
        with_temp_home(|_| {
            let body = r#"{"data":[{"id":"deepseek-chat"},{"id":"deepseek-reasoner"}]}"#;
            let endpoint = mock_server("200 OK", body);
            let result = login_for_test(&deepseek_at(endpoint.clone()), "sk-ok").unwrap();
            assert_eq!(result.provider, "deepseek");
            assert_eq!(
                result.models,
                vec!["deepseek-chat".to_string(), "deepseek-reasoner".to_string()]
            );
            assert_eq!(result.default_model.as_deref(), Some("deepseek-chat"));

            // The credential lives only in the secret store.
            assert_eq!(
                CredentialStore::load("deepseek").unwrap(),
                Some(Credential::ApiKey("sk-ok".into()))
            );
            // The config entry carries no secret, only id/endpoint/models.
            let cfg = load_global_config()
                .unwrap()
                .get("deepseek")
                .unwrap()
                .clone();
            assert!(cfg.api_key.is_none());
            assert!(cfg.api_keys.is_empty());
            assert_eq!(cfg.base_url.as_deref(), Some(endpoint.as_str()));
            assert_eq!(
                cfg.models,
                vec!["deepseek-chat".to_string(), "deepseek-reasoner".to_string()]
            );
        });
    }

    #[tokio::test]
    async fn logout_removes_credential_and_config() {
        let _tmp = TempSecrets::new();
        with_temp_home(|_| {
            let body = r#"{"data":[{"id":"deepseek-chat"}]}"#;
            let endpoint = mock_server("200 OK", body);
            login_for_test(&deepseek_at(endpoint), "sk-ok").unwrap();
            assert!(CredentialStore::load("deepseek").unwrap().is_some());
            assert!(load_global_config().unwrap().contains_key("deepseek"));

            LoginService.logout("deepseek").unwrap();
            assert!(CredentialStore::load("deepseek").unwrap().is_none());
            assert!(!load_global_config().unwrap().contains_key("deepseek"));
            // Logging out again is a no-op, not an error.
            LoginService.logout("deepseek").unwrap();
        });
    }

    #[tokio::test]
    async fn legacy_plaintext_key_is_cleared_by_login() {
        let _tmp = TempSecrets::new();
        with_temp_home(|_| {
            // Simulate a pre-existing legacy entry with a plaintext key.
            set_provider(
                "deepseek",
                ProviderUpdate {
                    api_key: Some("sk-legacy".into()),
                    clear_api_key: false,
                    base_url: Some("https://api.deepseek.com/v1".into()),
                    models: Some(vec!["deepseek-chat".into()]),
                    api_type: None,
                },
            )
            .unwrap();

            let body = r#"{"data":[{"id":"deepseek-chat"}]}"#;
            let endpoint = mock_server("200 OK", body);
            login_for_test(&deepseek_at(endpoint), "sk-new").unwrap();

            let cfg = load_global_config()
                .unwrap()
                .get("deepseek")
                .unwrap()
                .clone();
            assert!(
                cfg.api_key.is_none(),
                "legacy plaintext key must be migrated away"
            );
            assert_eq!(
                CredentialStore::load("deepseek").unwrap(),
                Some(Credential::ApiKey("sk-new".into()))
            );
        });
    }
}
