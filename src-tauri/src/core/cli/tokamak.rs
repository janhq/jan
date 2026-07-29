//! Tokamak sign-in for the headless CLI.
//!
//! Tokamak is an ordinary OpenAI-compatible upstream as far as the agent is
//! concerned (Bearer key + `{base_url}/chat/completions`), so "login" is just:
//! send the user to the web UI to mint an API key, verify what they paste
//! against `GET /v1/models`, and persist it as a provider entry in
//! `~/.jan/config.toml`. No OAuth, no callback server, no browser required --
//! the key can always be pasted from another machine.
//!
//! Presentation lives in the callers ([`super::mod`] for the fresh-install
//! prompt, [`super::tui`] for `/login`); this module is UI-free so both share
//! one implementation.

use std::path::PathBuf;
use std::time::Duration;

use crate::core::agent::global_config::{set_default_model_if_unset, set_provider, ProviderUpdate};

/// Provider id this login writes to in `~/.jan/config.toml`.
pub const PROVIDER: &str = "tokamak";
/// OpenAI-compatible API root. Persisted (not hardcoded at call sites) so a user
/// can retarget it by editing the config afterwards.
pub const BASE_URL: &str = "https://api.tokamak.sh/v1";
/// Where the user signs in and mints a key.
pub const API_KEYS_URL: &str = "https://tokamak.sh/settings/api-keys";

const VERIFY_TIMEOUT: Duration = Duration::from_secs(20);

/// What a successful sign-in changed, for the caller to report.
#[derive(Debug, Clone, PartialEq)]
pub struct Login {
    pub models: Vec<String>,
    pub config_path: PathBuf,
    /// The model written to `default_model`, or `None` when the user already had one.
    pub default_model: Option<String>,
}

/// Trim a pasted key and reject anything that isn't plausibly one. Terminals and
/// clipboards routinely add surrounding whitespace or a trailing newline; a key
/// with interior whitespace is a mis-paste (partial selection, wrapped line)
/// that would otherwise fail as a confusing 401.
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

/// Verify `api_key` against Tokamak and return the model ids it grants access
/// to. An empty list is a valid answer (the account has no models yet), so the
/// caller decides whether that is usable.
pub async fn verify_key(api_key: &str) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(VERIFY_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(format!("{BASE_URL}/models"))
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
        .map_err(|e| format!("could not reach {BASE_URL}: {e}"))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(describe_failure(status.as_u16(), &body));
    }
    let parsed: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Tokamak returned a response we could not read: {e}"))?;
    Ok(parse_models(&parsed))
}

/// Verify the key, then persist it as the `tokamak` provider. Nothing is written
/// when verification fails, so a typo never leaves a broken entry behind.
pub async fn login(api_key: &str) -> Result<Login, String> {
    let api_key = sanitize_key(api_key)?;
    let models = verify_key(&api_key).await?;
    persist(&api_key, models)
}

/// Write the verified key + model list to `~/.jan/config.toml`, adopting the
/// first model as `default_model` when the user has none (otherwise the agent
/// would still start with "no model specified" right after signing in).
fn persist(api_key: &str, models: Vec<String>) -> Result<Login, String> {
    let config_path = set_provider(
        PROVIDER,
        ProviderUpdate {
            api_key: Some(api_key.to_string()),
            base_url: Some(BASE_URL.to_string()),
            models: Some(models.clone()),
            api_type: None,
        },
    )?;
    let default_model = match models.first() {
        Some(first) if set_default_model_if_unset(first)? => Some(first.clone()),
        _ => None,
    };
    Ok(Login {
        models,
        config_path,
        default_model,
    })
}

/// Human-readable reason a verification request was rejected.
fn describe_failure(status: u16, body: &str) -> String {
    match status {
        401 | 403 => "Tokamak rejected that API key. Mint a fresh one and try again.".to_string(),
        429 => "Tokamak is rate limiting this key - wait a moment and try again.".to_string(),
        500..=599 => format!("Tokamak is unavailable right now (HTTP {status})."),
        _ => {
            let detail = api_error_message(body).unwrap_or_else(|| snippet(body));
            if detail.is_empty() {
                format!("Tokamak returned HTTP {status}.")
            } else {
                format!("Tokamak returned HTTP {status}: {detail}")
            }
        }
    }
}

/// `error` as a string, or `error.message`, from an error body.
fn api_error_message(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    let error = value.get("error")?;
    let text = error
        .as_str()
        .or_else(|| error.get("message").and_then(|m| m.as_str()))?;
    Some(text.to_string())
}

fn snippet(body: &str) -> String {
    let one_line = body.split_whitespace().collect::<Vec<_>>().join(" ");
    if one_line.chars().count() > 120 {
        format!("{}...", one_line.chars().take(117).collect::<String>())
    } else {
        one_line
    }
}

/// Model ids from a `/models` payload, sorted and deduped so a config write and
/// the "N models" report are stable across calls. Accepts the OpenAI shape
/// (`{"data":[{"id":...}]}`) plus the bare-array and array-of-strings variants
/// smaller gateways serve.
fn parse_models(value: &serde_json::Value) -> Vec<String> {
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

/// Open the API-keys page in the user's browser. `Err` means the caller must
/// print the URL for the user to open themselves -- which callers do
/// unconditionally anyway, since a spawned launcher reports nothing about
/// whether a page actually appeared.
pub fn open_api_keys_page() -> Result<(), String> {
    open_url(API_KEYS_URL)
}

fn open_url(url: &str) -> Result<(), String> {
    if cfg!(test) {
        // A test run must never take over the developer's browser.
        return Err("browser launch is disabled under test".to_string());
    }
    launch(url)
}

fn launch(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let (program, args): (&str, &[&str]) = ("open", &[]);
    #[cfg(target_os = "windows")]
    let (program, args): (&str, &[&str]) = ("cmd", &["/C", "start", ""]);
    #[cfg(all(unix, not(target_os = "macos")))]
    let (program, args): (&str, &[&str]) = ("xdg-open", &[]);

    #[cfg(all(unix, not(target_os = "macos")))]
    if !has_display() {
        return Err("no graphical session detected".to_string());
    }

    std::process::Command::new(program)
        .args(args)
        .arg(url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not launch {program}: {e}"))
}

/// Whether a Linux/BSD session has a display server to open a browser on. Over
/// SSH or in a container `xdg-open` would either fail noisily or block, so the
/// caller falls back to printing the URL.
#[cfg(all(unix, not(target_os = "macos")))]
fn has_display() -> bool {
    ["WAYLAND_DISPLAY", "DISPLAY"]
        .iter()
        .any(|var| std::env::var_os(var).is_some_and(|v| !v.is_empty()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::global_config::{load_global_config, with_temp_home};
    use serde_json::json;

    #[test]
    fn sanitize_trims_and_rejects_unusable_input() {
        assert_eq!(sanitize_key("  tk-abc\n").unwrap(), "tk-abc");
        assert!(sanitize_key("   ").is_err());
        assert!(sanitize_key("").is_err());
        assert!(sanitize_key("tk-abc def").is_err());
        assert!(sanitize_key("tk-abc\ndef").is_err());
    }

    #[test]
    fn parses_openai_model_list_sorted_and_deduped() {
        let body = json!({"object": "list", "data": [
            {"id": "tokamak-1-preview"},
            {"id": "alpha"},
            {"id": "alpha"},
            {"id": "  "},
            {"name": "no-id-field"},
        ]});
        assert_eq!(
            parse_models(&body),
            vec!["alpha".to_string(), "tokamak-1-preview".to_string()]
        );
    }

    #[test]
    fn parses_bare_array_and_string_variants() {
        assert_eq!(
            parse_models(&json!(["b", {"id": "a"}])),
            vec!["a".to_string(), "b".to_string()]
        );
        assert!(parse_models(&json!({"data": []})).is_empty());
        assert!(parse_models(&json!({"unexpected": 1})).is_empty());
    }

    #[test]
    fn failure_messages_name_the_actual_problem() {
        assert!(describe_failure(401, r#"{"error":"unauthorized"}"#).contains("rejected"));
        assert!(describe_failure(403, "").contains("rejected"));
        assert!(describe_failure(429, "").contains("rate limiting"));
        assert!(describe_failure(503, "").contains("unavailable"));
        let other = describe_failure(400, r#"{"error":{"message":"bad request"}}"#);
        assert!(other.contains("400") && other.contains("bad request"));
        assert!(describe_failure(418, "").contains("418"));
    }

    #[test]
    fn persist_writes_provider_entry_and_default_model() {
        with_temp_home(|_| {
            let login = persist("tk-1", vec!["m-a".into(), "m-b".into()]).expect("persist");
            assert_eq!(login.default_model.as_deref(), Some("m-a"));

            let configs = load_global_config().expect("load");
            let cfg = configs.get(PROVIDER).expect("tokamak present");
            assert_eq!(cfg.api_key.as_deref(), Some("tk-1"));
            assert_eq!(cfg.base_url.as_deref(), Some(BASE_URL));
            assert_eq!(cfg.models, vec!["m-a".to_string(), "m-b".to_string()]);
            assert!(super::super::providers::is_cli_reachable(cfg));
        });
    }

    #[test]
    fn persist_respects_an_existing_default_model() {
        with_temp_home(|_| {
            crate::core::agent::global_config::set_default_model_if_unset("chosen").unwrap();
            let login = persist("tk-1", vec!["m-a".into()]).expect("persist");
            assert_eq!(login.default_model, None);
        });
    }

    #[test]
    fn persist_with_no_models_still_saves_the_key() {
        with_temp_home(|_| {
            let login = persist("tk-1", Vec::new()).expect("persist");
            assert!(login.models.is_empty());
            assert_eq!(login.default_model, None);
            let configs = load_global_config().expect("load");
            assert_eq!(
                configs.get(PROVIDER).unwrap().api_key.as_deref(),
                Some("tk-1")
            );
        });
    }

    #[test]
    fn relogin_replaces_the_key_and_model_list() {
        with_temp_home(|_| {
            persist("tk-old", vec!["m-a".into(), "m-b".into()]).expect("first");
            persist("tk-new", vec!["m-c".into()]).expect("second");
            let configs = load_global_config().expect("load");
            let cfg = configs.get(PROVIDER).unwrap();
            assert_eq!(cfg.api_key.as_deref(), Some("tk-new"));
            assert_eq!(cfg.models, vec!["m-c".to_string()]);
        });
    }
}
