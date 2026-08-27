//! Tokamak sign-in for the headless CLI.
//!
//! Tokamak is an ordinary OpenAI-compatible upstream as far as the agent is
//! concerned (Bearer key + `{base_url}/chat/completions`), so historically
//! "login" was just: send the user to the web UI to mint an API key, verify what
//! they paste against `GET /v1/models`, and persist it as a provider entry in
//! `~/.jan/config.toml`. No OAuth, no callback server, no browser required --
//! the key could always be pasted from another machine.
//!
//! The default flow is now the browser-approval device flow
//! ([`device_login`] / [`super::device_auth`]): the server mints a fresh
//! `sk_live_*` key after the user approves in a browser on any device, and only
//! the PKCE verifier ever rides the network -- never the key. The legacy
//! paste-a-key flow ([`login`]) remains for deployments that predate the
//! `/auth/cli/sessions` endpoints (404/405 on create -- the caller falls back to
//! it automatically) and for `--paste-token`.
//!
//! Presentation lives in the callers ([`super::login`] for the plain terminal,
//! [`super::tui`] for `/login`); this module is UI-free so both share one
//! implementation.

use std::path::PathBuf;
use std::time::Duration;

use crate::core::agent::global_config::{set_default_model_if_unset, set_provider, ProviderUpdate};

/// Provider id this login writes to in `~/.jan/config.toml`.
pub const PROVIDER: &str = "tokamak";
/// Default OpenAI-compatible API root. Read through [`base_url`] rather than
/// directly, so a dev or self-hosted deployment can be targeted without a
/// rebuild; persisted into the config so a user can also retarget it by hand
/// afterwards.
pub const BASE_URL: &str = "https://api.tokamak.sh/v1";

/// Env var selecting a non-production deployment, matching the name the tokamak
/// CLI already uses. Without it there is no way to exercise the browser sign-in
/// against a dev stack before it reaches production.
pub const BASE_URL_ENV: &str = "TOKAMAK_BASE_URL";

/// The API root this run talks to: `$TOKAMAK_BASE_URL` when set, else
/// [`BASE_URL`].
pub fn base_url() -> String {
    resolve_base_url(std::env::var(BASE_URL_ENV).ok().as_deref())
}

/// Split from [`base_url`] so the precedence is testable without mutating the
/// process environment (which every other test in this binary shares).
fn resolve_base_url(from_env: Option<&str>) -> String {
    from_env
        .map(|v| v.trim().trim_end_matches('/'))
        .filter(|v| !v.is_empty())
        .map_or_else(|| BASE_URL.to_string(), str::to_string)
}
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
    /// Who the server says signed in. Only the browser flow reports one; the
    /// paste flow never learns it.
    pub account: Option<String>,
}

/// Trim a pasted key and reject anything that isn't plausibly one. Terminals and
/// clipboards routinely add surrounding whitespace or a trailing newline; a key
/// with interior whitespace is a mis-paste (partial selection, wrapped line)
/// that would otherwise fail as a confusing 401.
pub fn sanitize_key(raw: &str) -> Result<String, String> {
    super::auth::providers::sanitize_key(raw)
}

/// Verify `api_key` against Tokamak and return the model ids it grants access
/// to. An empty list is a valid answer (the account has no models yet), so the
/// caller decides whether that is usable.
async fn verify_key(api_key: &str) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(VERIFY_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let root = base_url();
    let response = client
        .get(format!("{root}/models"))
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
        .map_err(|e| format!("could not reach {root}: {e}"))?;

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
            clear_api_key: false,
            base_url: Some(base_url()),
            models: Some(models.clone()),
            api_type: None,
            // A pasted key carries no metadata, and any left over from a
            // previous browser login belongs to a key this one replaces.
            key_id: Some(None),
            key_expires_at: Some(None),
            account: Some(None),
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
        // The paste flow verifies a key against `/v1/models`; it never learns
        // who the key belongs to.
        account: None,
    })
}

/// Run the device (browser-approval) login to completion and persist the
/// minted key. `pending` comes from [`super::device_auth::begin`].
///
/// The claim reply carries the key and its metadata but no model list, so the
/// models are resolved the same way the paste flow resolves them -- a
/// `GET /v1/models` with the fresh key. That doubles as a check that the minted
/// key actually works before anything is written.
pub(crate) async fn device_login(
    pending: super::device_auth::PendingAuth,
) -> Result<Login, String> {
    let minted = pending.claim().await?;
    let models = verify_key(&minted.api_key).await?;
    persist_minted(&minted, models)
}

/// Persist a verified key plus the server-assigned key metadata (`key_id`/
/// `key_expires_at`, so `auth status` can show the expiry and logout can revoke
/// this exact key), adopting the first model as `default_model` when the user
/// has none.
fn persist_minted(
    minted: &super::device_auth::Minted,
    models: Vec<String>,
) -> Result<Login, String> {
    let config_path = set_provider(
        PROVIDER,
        ProviderUpdate {
            api_key: Some(minted.api_key.clone()),
            clear_api_key: false,
            base_url: Some(base_url()),
            models: Some(models.clone()),
            api_type: None,
            // Written even when the server sent nothing, so a re-login cannot
            // leave the previous key's id behind to be revoked by mistake.
            key_id: Some(minted.key_id.clone()),
            key_expires_at: Some(minted.key_expires_at),
            account: Some(minted.account.clone()),
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
        account: minted.account.clone(),
    })
}

/// What a sign-out actually did, so the caller does not claim a revocation that
/// never happened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Logout {
    /// Nothing was configured.
    NothingToDo,
    /// The local entry is gone and the server confirmed the key is revoked.
    ClearedAndRevoked,
    /// The local entry is gone, but the key was not revoked upstream -- no
    /// `key_id` was recorded (a legacy paste login) or the call did not land.
    ClearedOnly,
}

/// Sign out: revoke the stored key server-side (best-effort) and clear the
/// `tokamak` provider entry. Local sign-out always happens even if the
/// revocation call fails, so a network problem cannot strand the user signed in
/// locally -- but the result says which of the two happened.
pub async fn logout() -> Result<Logout, String> {
    use crate::core::agent::global_config::{provider_key_meta, remove_provider};

    let meta = provider_key_meta(PROVIDER).unwrap_or_default();
    let key = stored_api_key();
    if meta.key_id.is_none() && key.is_none() {
        return Ok(Logout::NothingToDo);
    }

    // Revoking needs both the server-side id and the key itself to authenticate
    // the call; a legacy paste login recorded no id, so it can only clear local.
    let revoked = match (&meta.key_id, &key) {
        (Some(key_id), Some(key)) => revoke_key(key_id, key).await,
        _ => false,
    };

    remove_provider(PROVIDER)?;
    Ok(match revoked {
        true => Logout::ClearedAndRevoked,
        false => Logout::ClearedOnly,
    })
}

fn stored_api_key() -> Option<String> {
    use crate::core::agent::global_config::load_global_config;
    load_global_config()
        .ok()?
        .get(PROVIDER)
        .and_then(|c| c.api_key.clone())
        .filter(|k| !k.is_empty())
}

/// Revoke `key_id` server-side, authenticating with the key itself. Best-effort
/// by contract -- logout must never be blocked by this call -- so the result is
/// a plain "did it land", never an error.
///
/// `DELETE /auth/api-keys/{id}` is the real route: unauthenticated it answers
/// `401 user context missing`, while `DELETE /auth/api-keys` (no id) and
/// `GET /auth/api-keys/{id}` both answer `404 auth route not found`.
async fn revoke_key(key_id: &str, api_key: &str) -> bool {
    let Ok(client) = reqwest::Client::builder().timeout(VERIFY_TIMEOUT).build() else {
        return false;
    };
    let root = super::device_auth::api_root(&base_url());
    client
        .delete(format!("{root}/auth/api-keys/{key_id}"))
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
        .is_ok_and(|r| r.status().is_success())
}

/// What `jan auth status` reports, without touching the network.
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct AuthStatus {
    pub signed_in: bool,
    pub endpoint: String,
    pub account: Option<String>,
    pub key_id: Option<String>,
    pub key_expires_at: Option<u64>,
}

/// Read the local auth state for Tokamak.
pub fn auth_status() -> AuthStatus {
    use crate::core::agent::global_config::provider_key_meta;

    let meta = provider_key_meta(PROVIDER).unwrap_or_default();
    AuthStatus {
        signed_in: stored_api_key().is_some(),
        endpoint: base_url(),
        account: meta.account,
        key_id: meta.key_id,
        key_expires_at: meta.key_expires_at,
    }
}

/// How close to expiry a stored key has to be before the CLI says so unprompted,
/// rather than letting the user discover it as a 401 mid-run.
pub const EXPIRY_WARNING_WINDOW: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// A one-line warning when the stored key is expired or about to be. `None` when
/// there is no key, no recorded expiry (a legacy paste login records none), or
/// the expiry is comfortably far off.
pub fn expiry_warning() -> Option<String> {
    let expires_at = auth_status().key_expires_at?;
    describe_expiry(expires_at, unix_now())
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Split from [`expiry_warning`] so the wording can be tested without pinning
/// the wall clock.
fn describe_expiry(expires_at: u64, now: u64) -> Option<String> {
    if expires_at == 0 {
        return None;
    }
    let Some(remaining) = expires_at.checked_sub(now) else {
        return Some(
            "your Tokamak key has expired - run `jan login` to sign in again.".to_string(),
        );
    };
    if remaining > EXPIRY_WARNING_WINDOW.as_secs() {
        return None;
    }
    let days = remaining / (24 * 60 * 60);
    Some(match days {
        0 => "your Tokamak key expires within a day - run `jan login` to renew it.".to_string(),
        1 => "your Tokamak key expires in 1 day - run `jan login` to renew it.".to_string(),
        n => format!("your Tokamak key expires in {n} days - run `jan login` to renew it."),
    })
}

/// Who the stored key belongs to, as recorded when it was minted. Read from the
/// config rather than looked up: the browser flow's claim reply already names
/// the account, so there is no round trip and no identity-endpoint response
/// shape to guess. `None` after a legacy paste login, which never learns it.
pub fn account() -> Option<String> {
    use crate::core::agent::global_config::provider_key_meta;
    provider_key_meta(PROVIDER).ok()?.account
}

/// Whether the stored key is currently accepted by the upstream: a live check
/// against `GET /v1/models`. `None` when there is no key to check (not signed
/// in), otherwise the pass/fail. A network the CLI cannot reach is reported as
/// `None` so a blip does not read as an invalid key.
pub async fn live_valid() -> Option<bool> {
    use crate::core::agent::global_config::load_global_config;
    let key = load_global_config()
        .ok()
        .and_then(|c| c.get(PROVIDER).cloned())
        .and_then(|c| c.api_key)?;
    if key.is_empty() {
        return Some(false);
    }
    match verify_key(&key).await {
        // A 401/403 is an invalid key; a network blip should not read as one.
        Ok(_) => Some(true),
        Err(e) if e.contains("could not reach") => None,
        Err(_) => Some(false),
    }
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
pub(crate) fn parse_models(value: &serde_json::Value) -> Vec<String> {
    super::auth::providers::parse_models(value)
}

/// Open the API-keys page in the user's browser. `Err` means the caller must
/// print the URL for the user to open themselves -- which callers do
/// unconditionally anyway, since a spawned launcher reports nothing about
/// whether a page actually appeared.
pub fn open_api_keys_page() -> Result<(), String> {
    super::browser::open(API_KEYS_URL)
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

    /// Build a claim result the way `device_auth` hands one over.
    fn minted(key_id: Option<&str>, expires_at: Option<u64>) -> super::super::device_auth::Minted {
        super::super::device_auth::Minted {
            api_key: "sk_live_x".to_string(),
            key_id: key_id.map(str::to_string),
            key_expires_at: expires_at,
            account: Some("a@b.c".to_string()),
        }
    }

    /// A browser-flow mint records `key_id`/`key_expires_at`, so `auth status`
    /// can show the expiry and logout can revoke that exact key.
    #[test]
    fn persist_minted_records_the_server_key_metadata() {
        with_temp_home(|_| {
            use crate::core::agent::global_config::provider_key_meta;
            let login = persist_minted(&minted(Some("k-1"), Some(1700000000)), vec!["m-a".into()])
                .expect("persist");
            assert_eq!(login.default_model.as_deref(), Some("m-a"));
            assert_eq!(login.account.as_deref(), Some("a@b.c"));

            let configs = load_global_config().expect("load");
            let cfg = configs.get(PROVIDER).unwrap();
            assert_eq!(cfg.api_key.as_deref(), Some("sk_live_x"));

            let meta = provider_key_meta(PROVIDER).expect("meta");
            assert_eq!(meta.key_id.as_deref(), Some("k-1"));
            assert_eq!(meta.key_expires_at, Some(1700000000));
        });
    }

    /// A legacy paste login writes no key metadata, so auth status falls back to
    /// the key-only shape rather than erroring.
    #[test]
    fn legacy_persist_writes_no_key_metadata() {
        with_temp_home(|_| {
            persist("tk-1", vec![]).expect("persist");
            use crate::core::agent::global_config::provider_key_meta;
            let meta = provider_key_meta(PROVIDER).expect("meta");
            assert!(meta.key_id.is_none());
            assert!(meta.key_expires_at.is_none());
        });
    }

    /// The account rides the mint, so `auth status` can name it with no round
    /// trip -- and a paste login that never learns one must not inherit a stale
    /// account from the key it replaced.
    #[test]
    fn the_account_is_recorded_by_the_mint_and_cleared_by_a_paste() {
        with_temp_home(|_| {
            persist_minted(&minted(Some("k-1"), None), vec![]).expect("persist");
            assert_eq!(account().as_deref(), Some("a@b.c"));
            assert_eq!(auth_status().account.as_deref(), Some("a@b.c"));

            persist("tk-pasted", vec![]).expect("persist paste");
            assert_eq!(
                account(),
                None,
                "a paste login must not keep the old account"
            );
            assert_eq!(auth_status().account, None);
        });
    }

    #[test]
    fn auth_status_reflects_signed_in_state_and_metadata() {
        with_temp_home(|_| {
            assert!(!auth_status().signed_in);
            persist_minted(&minted(Some("k-1"), Some(1700000000)), vec![]).expect("persist");
            let status = auth_status();
            assert!(status.signed_in);
            assert_eq!(status.endpoint, BASE_URL);
            assert_eq!(status.key_id.as_deref(), Some("k-1"));
            assert_eq!(status.key_expires_at, Some(1700000000));
        });
    }

    /// A dev or self-hosted deployment must be reachable without a rebuild, and
    /// an unset/blank var must not produce an empty base url.
    #[test]
    fn base_url_prefers_the_env_override() {
        assert_eq!(resolve_base_url(None), BASE_URL);
        assert_eq!(resolve_base_url(Some("")), BASE_URL);
        assert_eq!(resolve_base_url(Some("   ")), BASE_URL);
        assert_eq!(
            resolve_base_url(Some("https://api.dev.tokamak.sh/v1")),
            "https://api.dev.tokamak.sh/v1"
        );
        // A trailing slash would double up in `{base}/models`.
        assert_eq!(
            resolve_base_url(Some(" http://localhost:8080/v1/ ")),
            "http://localhost:8080/v1"
        );
    }

    /// The warning window is the point of storing `key_expires_at` at all: a
    /// key must announce itself before it 401s mid-run.
    #[test]
    fn expiry_is_only_described_inside_the_warning_window() {
        const DAY: u64 = 24 * 60 * 60;
        let now = 1_700_000_000;
        // Comfortably far off: nothing to say.
        assert_eq!(describe_expiry(now + 30 * DAY, now), None);
        assert_eq!(describe_expiry(now + 8 * DAY, now), None);
        // An unrecorded expiry is not an expired key.
        assert_eq!(describe_expiry(0, now), None);

        let soon = describe_expiry(now + 6 * DAY, now).expect("inside the window");
        assert!(soon.contains("6 days"), "{soon}");
        assert!(soon.contains("jan login"), "{soon}");

        assert!(describe_expiry(now + DAY + 60, now)
            .expect("1 day")
            .contains("in 1 day"));
        assert!(describe_expiry(now + 600, now)
            .expect("today")
            .contains("within a day"));
        // Already gone -- and subtraction must not wrap.
        let gone = describe_expiry(now - DAY, now).expect("expired");
        assert!(gone.contains("has expired"), "{gone}");
    }

    /// A legacy paste login records no expiry, so the warning must stay quiet
    /// rather than inventing one.
    #[test]
    fn expiry_warning_is_quiet_without_a_recorded_expiry() {
        with_temp_home(|_| {
            persist("tk-1", vec![]).expect("persist");
            assert_eq!(expiry_warning(), None);
        });
    }

    #[test]
    fn expiry_warning_fires_for_a_key_that_is_about_to_lapse() {
        with_temp_home(|_| {
            let soon = unix_now() + 2 * 24 * 60 * 60;
            persist_minted(&minted(Some("k-1"), Some(soon)), vec![]).expect("persist");
            let warning = expiry_warning().expect("a key expiring in 2 days must warn");
            assert!(warning.contains("2 days"), "{warning}");
        });
    }

    fn run_logout() -> Logout {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(logout())
            .expect("logout")
    }

    #[test]
    fn logout_with_nothing_configured_is_a_no_op() {
        with_temp_home(|_| assert_eq!(run_logout(), Logout::NothingToDo));
    }

    /// Without a recorded `key_id` there is nothing to revoke, so logout must
    /// still clear the local entry -- and must not claim a revocation.
    #[test]
    fn logout_without_a_key_id_clears_locally_only() {
        with_temp_home(|_| {
            persist_minted(&minted(None, None), vec!["m-a".into()]).expect("persist");
            assert!(auth_status().signed_in);

            assert_eq!(run_logout(), Logout::ClearedOnly);
            assert!(!auth_status().signed_in);

            // The provider entry is fully gone.
            let configs = load_global_config().expect("load");
            assert!(!configs.contains_key(PROVIDER));
        });
    }

    /// A revoke call that cannot land (no server here) must not strand the user
    /// signed in locally, and must report that the key survives upstream.
    #[test]
    fn logout_clears_locally_even_when_revocation_fails() {
        with_temp_home(|_| {
            persist_minted(&minted(Some("k-1"), None), vec!["m-a".into()]).expect("persist");
            assert_eq!(run_logout(), Logout::ClearedOnly);
            assert!(!auth_status().signed_in);
        });
    }
}
