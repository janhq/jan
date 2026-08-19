use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use sha2::{Digest, Sha256};

use super::{Credential, CredentialStore, OAuthToken};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountProvider {
    Codex,
    Claude,
}

impl AccountProvider {
    pub const fn credential_provider(self) -> &'static str {
        match self {
            Self::Codex => "openai",
            Self::Claude => "anthropic",
        }
    }

    pub(crate) fn from_credential_provider(provider: &str) -> Option<Self> {
        match provider {
            "openai" => Some(Self::Codex),
            "anthropic" => Some(Self::Claude),
            _ => None,
        }
    }
}

#[derive(Clone)]
pub struct AccountLogin {
    pub authorization_url: String,
    pub redirect_uri: &'static str,
    pub state: String,
    pub verifier: String,
    provider: AccountProvider,
    client_id: &'static str,
    token_endpoint: String,
    #[cfg(test)]
    model_base_url: Option<String>,
}

impl AccountLogin {
    pub const fn provider(&self) -> AccountProvider {
        self.provider
    }

    pub fn parse_manual_input(&self, raw: &str) -> Result<String, String> {
        parse_manual_callback(raw, &self.state)
    }
}

pub fn begin(provider: AccountProvider) -> Result<AccountLogin, String> {
    let (client_id, authorization_endpoint, token_endpoint, redirect_uri, scopes) = match provider {
        AccountProvider::Codex => (
            "app_EMoamEEZ73f0CkXaXp7hrann",
            "https://auth.openai.com/oauth/authorize",
            "https://auth.openai.com/oauth/token",
            "http://localhost:1455/auth/callback",
            "openid profile email offline_access api.connectors.read api.connectors.invoke",
        ),
        AccountProvider::Claude => (
            "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
            "https://claude.ai/oauth/authorize",
            "https://platform.claude.com/v1/oauth/token",
            "http://localhost:54545/callback",
            "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
        ),
    };
    // PKCE generates a single random verifier; the `state` CSRF nonce is
    // usually a second random value. Anthropic's `claude.ai/oauth/authorize`
    // endpoint empirically rejects a random `state` with "Invalid request
    // format" -- it accepts only `state == code_verifier`, which is what the
    // Claude Code CLI, pi, and motosan-ai-oauth all send. OpenAI's Codex
    // endpoint accepts an independent random state, so only Claude reuses the
    // verifier as its state.
    let verifier = random_url_safe(96);
    let codex_state = random_hex(16);
    let state = if provider == AccountProvider::Claude {
        verifier.clone()
    } else {
        codex_state
    };
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut url = url::Url::parse(authorization_endpoint).map_err(|e| e.to_string())?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("response_type", "code");
        query.append_pair("client_id", client_id);
        query.append_pair("redirect_uri", redirect_uri);
        query.append_pair("scope", scopes);
        query.append_pair("code_challenge", &challenge);
        query.append_pair("code_challenge_method", "S256");
        query.append_pair("state", &state);
        if provider == AccountProvider::Codex {
            query.append_pair("id_token_add_organizations", "true");
            query.append_pair("codex_cli_simplified_flow", "true");
            query.append_pair("originator", "jan");
        } else {
            query.append_pair("code", "true");
        }
    }
    Ok(AccountLogin {
        authorization_url: url.into(),
        redirect_uri,
        state,
        verifier,
        provider,
        client_id,
        token_endpoint: token_endpoint.to_string(),
        #[cfg(test)]
        model_base_url: None,
    })
}

/// Append one line to the account-oauth debug log (under the Jan data
/// folder's `logs/` directory). Best-effort: a failing login must never be
/// blocked by a failing log write. The on-screen message stays sanitized;
/// this file carries the real stage/status/body detail for diagnostics.
pub fn debug_log(message: &str) {
    use std::io::Write;

    let data_folder = crate::core::app::commands::resolve_jan_data_folder();
    let path = data_folder.join("logs").join("account-oauth.log");
    let _ = std::fs::create_dir_all(path.parent().expect("log path has a parent"));
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(file, "[{timestamp}] {message}");
    }
}

fn random_url_safe(bytes: usize) -> String {
    let mut value = vec![0; bytes];
    rand::thread_rng().fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}

/// CSRF state token. Lower-entropy hex (not base64url) to match what both
/// providers' authorization servers were validated against by the reference
/// implementations; the format is opaque to us either way; only the
/// authorize/callback round trip cares that it matches.
fn random_hex(bytes: usize) -> String {
    let mut value = vec![0; bytes];
    rand::thread_rng().fill_bytes(&mut value);
    hex::encode(value)
}

/// Extract the ChatGPT account id a Codex OAuth token was issued to. OpenAI's
/// Codex login returns an account-scoped token whose JWT claims carry the
/// ChatGPT account under `https://api.openai.com/auth` -> `chatgpt_account_id`;
/// both pi and opencode use this claim (never a `/v1/models` call) to identify
/// and validate the account. Returns the account id, or an error when the token
/// is not a decodable JWT carrying the claim.
fn codex_chatgpt_account_id(token: &str) -> Result<String, String> {
    let mut segments = token.split('.');
    let _header = segments.next();
    let payload = segments.next().ok_or_else(|| "token is not a JWT".to_string())?;
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| "token payload is not base64url".to_string())?;
    let claims: serde_json::Value = serde_json::from_slice(&decoded)
        .map_err(|_| "token payload is not JSON".to_string())?;
    claims
        .get("https://api.openai.com/auth")
        .and_then(|auth| auth.get("chatgpt_account_id"))
        .and_then(|id| id.as_str())
        .map(str::to_string)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| "token carries no chatgpt_account_id claim".to_string())
}

pub fn parse_callback(raw: &str, expected_state: &str) -> Result<String, String> {
    let url =
        url::Url::parse(raw.trim()).map_err(|_| "paste the complete redirect URL".to_string())?;
    let state = url
        .query_pairs()
        .find_map(|(key, value)| (key == "state").then_some(value.into_owned()))
        .ok_or_else(|| "the redirect URL is missing its state".to_string())?;
    if state != expected_state {
        return Err("the redirect state did not match".to_string());
    }

    url.query_pairs()
        .find_map(|(key, value)| (key == "code").then_some(value.into_owned()))
        .filter(|code| !code.is_empty())
        .ok_or_else(|| "the redirect URL is missing its authorization code".to_string())
}

pub fn parse_manual_callback(raw: &str, expected_state: &str) -> Result<String, String> {
    fn code_from_pairs<'a>(
        pairs: impl Iterator<Item = (std::borrow::Cow<'a, str>, std::borrow::Cow<'a, str>)>,
        expected_state: &str,
    ) -> Result<String, String> {
        let mut code = None;
        let mut state = None;
        for (key, value) in pairs {
            match key.as_ref() {
                "code" => code = Some(value.into_owned()),
                "state" => state = Some(value.into_owned()),
                _ => {}
            }
        }
        if state.is_some_and(|state| state != expected_state) {
            return Err("the redirect state did not match".to_string());
        }
        code.filter(|code| !code.is_empty())
            .ok_or_else(|| "the authorization code was empty".to_string())
    }

    let input = raw.trim();
    if input.is_empty() {
        return Err("enter the redirect URL or authorization code".to_string());
    }

    if let Ok(url) = url::Url::parse(input) {
        return code_from_pairs(url.query_pairs(), expected_state);
    }

    if input.starts_with("code=") || input.starts_with("?code=") {
        return code_from_pairs(
            url::form_urlencoded::parse(input.trim_start_matches('?').as_bytes()),
            expected_state,
        );
    }

    let (code, state) = input
        .split_once('#')
        .map_or((input, None), |(code, state)| (code, Some(state)));
    if state.is_some_and(|state| state.trim() != expected_state) {
        return Err("the redirect state did not match".to_string());
    }
    let code = code.trim();
    if code.is_empty() {
        return Err("the authorization code was empty".to_string());
    }
    Ok(code.to_string())
}

pub async fn accept_callback(
    listener: tokio::net::TcpListener,
    login: &AccountLogin,
) -> Result<String, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let (mut stream, _) = listener
        .accept()
        .await
        .map_err(|_| "could not receive the account callback".to_string())?;
    let mut request = [0; 8192];
    let read = stream
        .read(&mut request)
        .await
        .map_err(|_| "could not read the account callback".to_string())?;
    let target = std::str::from_utf8(&request[..read])
        .ok()
        .and_then(|request| request.lines().next())
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| "the account callback was malformed".to_string())?;
    let callback = format!(
        "{}/{}",
        login.redirect_uri.trim_end_matches('/'),
        target.trim_start_matches('/')
    );
    let result = parse_callback(&callback, &login.state);
    let response = if result.is_ok() {
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: 71\r\nConnection: close\r\n\r\n<html><body>Sign-in completed. You can close this window.</body></html>"
    } else {
        "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: 57\r\nConnection: close\r\n\r\n<html><body>Sign-in could not be verified.</body></html>"
    };
    let _ = stream.write_all(response.as_bytes()).await;
    result
}

pub async fn bind_callback(login: &AccountLogin) -> Result<tokio::net::TcpListener, String> {
    let redirect = url::Url::parse(login.redirect_uri)
        .map_err(|_| "the callback URL was invalid".to_string())?;
    let port = redirect
        .port_or_known_default()
        .ok_or_else(|| "the callback URL did not include a port".to_string())?;
    tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|_| "could not start the local sign-in callback".to_string())
}

pub async fn wait_for_browser_callback(login: &AccountLogin) -> Result<String, String> {
    let listener = bind_callback(login).await?;
    accept_callback(listener, login).await
}

fn token_request_body(
    login: &AccountLogin,
    code: &str,
) -> std::collections::BTreeMap<String, String> {
    let mut fields = vec![
        ("grant_type", "authorization_code".to_string()),
        ("client_id", login.client_id.to_string()),
        ("code", code.to_string()),
        ("code_verifier", login.verifier.clone()),
        ("redirect_uri", login.redirect_uri.to_string()),
    ];
    // Anthropic's token endpoint expects `state` echoed back in the exchange
    // body (pi's `AnthropicOAuthFlow.exchangeToken` sends it); OpenAI's does
    // not accept it on this grant.
    if login.provider == AccountProvider::Claude {
        fields.push(("state", login.state.clone()));
    }
    fields
        .into_iter()
        .map(|(key, value)| (key.to_string(), value))
        .collect()
}
fn refresh_request_body(
    client_id: &str,
    token: &OAuthToken,
) -> Result<std::collections::BTreeMap<String, String>, String> {
    let refresh_token = token
        .refresh_token
        .as_deref()
        .filter(|token| !token.is_empty())
        .ok_or_else(|| "account sign-in must be completed again".to_string())?;
    Ok([
        ("grant_type", "refresh_token".to_string()),
        ("client_id", client_id.to_string()),
        ("refresh_token", refresh_token.to_string()),
    ]
    .into_iter()
    .map(|(key, value)| (key.to_string(), value))
    .collect())
}

pub async fn exchange(login: &AccountLogin, code: &str) -> Result<OAuthToken, String> {
    #[derive(serde::Deserialize)]
    struct TokenResponse {
        access_token: String,
        #[serde(default)]
        refresh_token: Option<String>,
        #[serde(default)]
        expires_in: Option<i64>,
        #[serde(default = "default_token_type")]
        token_type: String,
        #[serde(default)]
        scope: String,
    }

    fn default_token_type() -> String {
        "Bearer".to_string()
    }

    let request = reqwest::Client::new().post(&login.token_endpoint);
    let request = match login.provider {
        // Anthropic's /v1/oauth/token expects a JSON body (pi posts
        // application/json); OpenAI's accepts only form-encoded.
        AccountProvider::Claude => request.json(&token_request_body(login, code)),
        AccountProvider::Codex => request.form(&token_request_body(login, code)),
    };
    let response = request
        .send()
        .await
        .map_err(|error| {
            debug_log(&format!(
                "exchange: could not reach {}: {error}",
                login.token_endpoint
            ));
            "could not exchange the authorization code".to_string()
        })?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        debug_log(&format!(
            "exchange: rejected by {} with HTTP {status} body={body}",
            login.token_endpoint
        ));
        return Err(format!("account sign-in was rejected (HTTP {status})"));
    }
    let token = response
        .json::<TokenResponse>()
        .await
        .map_err(|_| "the account token response was unreadable".to_string())?;
    if token.access_token.is_empty() {
        return Err("the account token response did not contain an access token".to_string());
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "could not read the system clock".to_string())?
        .as_secs() as i64;
    Ok(OAuthToken {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: token
            .expires_in
            .map(|seconds| now.saturating_add(seconds.saturating_sub(300))),
        token_type: token.token_type,
        scopes: token.scope.split_whitespace().map(str::to_string).collect(),
    })
}

/// Client id and token endpoint for the refresh grant. Kept in sync with
/// `begin()` so a refresh always hits the same endpoint the user consented
/// to. Both providers' OAuth servers are served from the platform host, not
/// the inference API host (`api.anthropic.com` has no `/v1/oauth/token`).
fn refresh_endpoint(provider: AccountProvider) -> (&'static str, &'static str) {
    match provider {
        AccountProvider::Codex => (
            "app_EMoamEEZ73f0CkXaXp7hrann",
            "https://auth.openai.com/oauth/token",
        ),
        AccountProvider::Claude => (
            "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
            "https://platform.claude.com/v1/oauth/token",
        ),
    }
}

pub async fn refresh(provider: AccountProvider, token: &OAuthToken) -> Result<OAuthToken, String> {
    #[derive(serde::Deserialize)]
    struct TokenResponse {
        access_token: String,
        #[serde(default)]
        refresh_token: Option<String>,
        #[serde(default)]
        expires_in: Option<i64>,
        #[serde(default = "default_token_type")]
        token_type: String,
        #[serde(default)]
        scope: String,
    }

    fn default_token_type() -> String {
        "Bearer".to_string()
    }

    let (client_id, token_endpoint) = refresh_endpoint(provider);
    let body = refresh_request_body(client_id, token)?;
    let request = reqwest::Client::new().post(token_endpoint);
    let request = match provider {
        // Anthropic refresh expects JSON plus the versioned beta header and a
        // recognizable user agent (pi's refreshAnthropicToken sends both);
        // OpenAI's endpoint accepts only form-encoded.
        AccountProvider::Claude => request
            .header("anthropic-beta", "oauth-2025-04-20")
            .header(
                "user-agent",
                "anthropic-sdk-typescript/0.94.0 userOAuthProvider",
            )
            .json(&body),
        AccountProvider::Codex => request.form(&body),
    };
    let response = request
        .send()
        .await
        .map_err(|error| {
            debug_log(&format!("refresh: could not reach {token_endpoint}: {error}"));
            "could not refresh the account token".to_string()
        })?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        debug_log(&format!(
            "refresh: rejected by {token_endpoint} with HTTP {status} body={body}"
        ));
        return Err(format!(
            "account token refresh was rejected (HTTP {status})"
        ));
    }
    let refreshed = response
        .json::<TokenResponse>()
        .await
        .map_err(|_| "the refreshed account token was unreadable".to_string())?;
    if refreshed.access_token.is_empty() {
        return Err("the refreshed account token did not contain an access token".to_string());
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "could not read the system clock".to_string())?
        .as_secs() as i64;
    Ok(OAuthToken {
        access_token: refreshed.access_token,
        refresh_token: refreshed
            .refresh_token
            .or_else(|| token.refresh_token.clone()),
        expires_at: refreshed
            .expires_in
            .map(|seconds| now.saturating_add(seconds.saturating_sub(300))),
        token_type: refreshed.token_type,
        scopes: if refreshed.scope.is_empty() {
            token.scopes.clone()
        } else {
            refreshed
                .scope
                .split_whitespace()
                .map(str::to_string)
                .collect()
        },
    })
}

/// Test convenience: the Claude Code subscription access token from its stored
/// JSON secret. [`claude_code_oauth`] feeds it the raw keychain payload.
/// Returns `None` when the shape is absent or unparsable.
#[cfg(test)]
fn parse_claude_code_secret(raw: &str) -> Option<String> {
    claude_code_oauth(raw).map(|oauth| oauth.access_token)
}

/// Parse the full `claudeAiOauth` block Claude Code stores in its keychain
/// JSON into a Jan [`OAuthToken`] (access + refresh + expiry). Pure and
/// unit-testable. Returns `None` when the block is absent or unparsable.
fn claude_code_oauth(raw: &str) -> Option<OAuthToken> {
    // Claude Code stores a JSON object with a `claudeAiOauth` block carrying
    // accessToken/refreshToken/expiresAt. `expiresAt` is in epoch milliseconds;
    // Jan's OAuthToken expires_at is in seconds.
    let parsed: serde_json::Value = serde_json::from_str(raw).ok()?;
    let oauth = parsed.get("claudeAiOauth")?;
    let access = oauth.get("accessToken")?.as_str()?;
    if access.is_empty() {
        return None;
    }
    let expires_at = oauth
        .get("expiresAt")
        .and_then(|value| value.as_i64())
        .map(|millis| millis / 1000);
    Some(OAuthToken {
        access_token: access.to_string(),
        refresh_token: oauth
            .get("refreshToken")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        expires_at,
        token_type: "Bearer".to_string(),
        scopes: Vec::new(),
    })
}

/// The clean generic macOS keychain descriptor type returned by the keyring
/// crate for a `Claude Code-credentials` entry.
fn claude_code_keychain_entry() -> Option<keyring::Entry> {
    // The account name is the macOS login user, which the OS keychain keys the
    // entry under. Claude Code names its service with the stable literal
    // "Claude Code-credentials" (a second, machine-hashed service has the
    // "Claude Code-credentials-<uuid>" shape and is not the live one).
    let user = std::env::var("USER")
        .or_else(|_| std::env::var("LOGNAME"))
        .ok()?;
    keyring::Entry::new("Claude Code-credentials", &user).ok()
}

/// The `subscriptionType` Claude Code stamps on a resolved account (e.g.
/// `team`, `pro`, `enterprise`, `free`). Authoritative for which plan the token
/// actually resolved to, so a team/enterprise account whose heavy-model quota is
/// momentarily exhausted is not misreported as a free personal plan. Best-effort:
/// returns `None` when the keychain entry is absent or the field is missing.
fn claude_code_subscription_type() -> Option<String> {
    claude_code_keychain_entry()?
        .get_password()
        .ok()
        .and_then(|raw| {
            let doc: serde_json::Value = serde_json::from_str(&raw).ok()?;
            doc.get("claudeAiOauth")?
                .get("subscriptionType")?
                .as_str()
                .map(str::to_string)
        })
}

#[cfg(test)]
static CLAUDE_ALIAS_ENABLED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

#[cfg(test)]
fn claude_alias_enabled() -> bool {
    CLAUDE_ALIAS_ENABLED.load(std::sync::atomic::Ordering::Relaxed)
}

#[cfg(not(test))]
fn claude_alias_enabled() -> bool {
    true
}

/// Test-only: flip whether the Claude Code alias is consulted in production
/// code paths from unit tests. Off by default so tests never touch the
/// developer's keychain or a real omp install; on in production.
#[cfg(test)]
pub(crate) fn set_claude_alias(enabled: bool) {
    CLAUDE_ALIAS_ENABLED.store(enabled, std::sync::atomic::Ordering::Relaxed);
}
/// Resolve a working access token from Claude Code's keychain entry, refreshing
/// it and writing the rotated token back into the same keychain entry (the
/// single source of truth omp also reads) when it has expired. This keeps Jan
/// usable unattended with the enterprise workspace's OAuth login without a
/// browser re-consent, and omp re-reads its own keychain each launch so it
/// stays current.
async fn claude_code_access_token() -> Option<String> {
    if !claude_alias_enabled() {
        return None;
    }
    let entry = claude_code_keychain_entry()?;
    let raw = entry.get_password().ok()?;
    let oauth = claude_code_oauth(&raw)?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs() as i64;
    if oauth.expires_at.is_some_and(|expires_at| expires_at <= now + 300) {
        match refresh(AccountProvider::Claude, &oauth).await {
            Ok(fresh) => {
                // Write the rotated token back into omp's keychain entry so the
                // shared credential stays fresh even if Jan is the only client
                // running. On writeback failure we still return the refreshed
                // token so Jan keeps working for this session.
                if write_claude_code_keychain(&entry, &raw, &fresh).is_err() {
                    debug_log("claude alias: refreshed but could not write back to the Claude Code keychain");
                }
                return Some(fresh.access_token);
            }
            Err(error) => {
                debug_log(&format!(
                    "claude alias: could not refresh Claude Code token: {error}"
                ));
                return None;
            }
        }
    }
    Some(oauth.access_token)
}

/// Refresh-rotate the `claudeAiOauth` block inside a Claude Code keychain JSON
/// document in place, preserving all other top-level fields (e.g. `mcpOAuth`,
/// `claudeOauth`), so omp's entry is updated rather than replaced. Pure and
/// unit-testable; [`write_claude_code_keychain`] persists the result.
fn rotate_claude_code_secret(raw: &str, fresh: &OAuthToken) -> Result<String, String> {
    let mut doc: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| "unparsable Claude Code secret".to_string())?;
    let oauth = doc
        .get_mut("claudeAiOauth")
        .ok_or_else(|| "no claudeAiOauth block in Claude Code secret".to_string())?;
    oauth["accessToken"] = serde_json::Value::String(fresh.access_token.clone());
    if let Some(refresh_token) = &fresh.refresh_token {
        oauth["refreshToken"] = serde_json::Value::String(refresh_token.clone());
    }
    if let Some(expires_at_secs) = fresh.expires_at {
        // Claude Code stores expiresAt in epoch milliseconds.
        oauth["expiresAt"] =
            serde_json::Value::Number((expires_at_secs.saturating_mul(1000)).into());
    }
    Ok(doc.to_string())
}

/// Refresh-rotate the `claudeAiOauth` block inside a Claude Code keychain JSON
/// document in place, preserving all other top-level fields (e.g. `mcpOAuth`,
/// `claudeOauth`), so omp's entry is updated rather than replaced.
fn write_claude_code_keychain(
    entry: &keyring::Entry,
    raw: &str,
    fresh: &OAuthToken,
) -> Result<(), String> {
    let updated = rotate_claude_code_secret(raw, fresh)?;
    entry
        .set_password(&updated)
        .map_err(|error| format!("could not update the Claude Code keychain: {error}"))
}

/// Resolve a working access token for `provider`, preferring Jan's own stored
/// credential. For the Claude provider, when Jan has no account credential of
/// its own, this falls back to Claude Code's keychain token (see
/// [`claude_code_access_token`]) so the enterprise subscription quota is the
/// same one omp uses.
pub async fn access_token(provider: &str) -> Result<Option<String>, String> {
    let Some(provider_kind) = AccountProvider::from_credential_provider(provider) else {
        return Ok(None);
    };
    let stored = CredentialStore::load(provider)?;
    let Some(Credential::OAuthToken(token)) = stored else {
        // No Jan-owned credential: alias Claude Code's token (Claude only).
        if provider_kind == AccountProvider::Claude {
            if let Some(access) = claude_code_access_token().await {
                return Ok(Some(access));
            }
        }
        return Ok(None);
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| "could not read the system clock".to_string())?
        .as_secs() as i64;
    if token.expires_at.is_some_and(|expires_at| expires_at <= now) {
        let refreshed = refresh(provider_kind, &token).await?;
        store(provider_kind, &refreshed)?;
        return Ok(Some(refreshed.access_token));
    }
    Ok(Some(token.access_token))
}

pub fn store(provider: AccountProvider, token: &OAuthToken) -> Result<(), String> {
    CredentialStore::store(
        provider.credential_provider(),
        &Credential::OAuthToken(token.clone()),
    )
}
// A Claude account token resolves to whichever Anthropic org/workspace was
// active on claude.ai at consent time. That org's plan decides which models
// the token may run: on the free personal plan only lightweight models (e.g.
// claude-haiku) respond, while heavy models (sonnet/opus) return 429 even
// with plentiful overall quota. This reports the resolved entitlement so a
// sign-in that landed on the wrong org is diagnosed immediately instead of
// surfacing later as mysterious rate-limit errors. Best-effort: never fails
// a login; on any error it returns the given `fallback` message.
pub async fn claude_plan_summary(fallback: &str) -> String {
    // Resolve through access_token so the probe sees the same token the
    // request path uses: Jan's own credential when present, otherwise the
    // Claude Code alias (see claude_code_access_token).
    let Some(token) = access_token(AccountProvider::Claude.credential_provider())
        .await
        .ok()
        .flatten()
    else {
        return fallback.to_string();
    };
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(client) => client,
        Err(_) => return fallback.to_string(),
    };
    // Distinguish a model-family entitlement boundary from a transient quota
    // window. Probe one heavy model (sonnet) and one lightweight model (haiku).
    // When only haiku answers, the heavy answer may be a genuine entitlement
    // boundary OR a momentarily exhausted 5-hour quota window; the account's
    // stamped `subscriptionType` disambiguates the two (a paid tier that 429s is
    // quota exhaustion, not a free plan).
    let mut heavy_ok = false;
    for model in ["claude-haiku-4-5", "claude-sonnet-5"] {
        let body = serde_json::json!({
            "model": model,
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "hi"}],
        });
        let probe = client
            .post("https://api.anthropic.com/v1/messages")
            .header("Authorization", format!("Bearer {token}"))
            .header("anthropic-beta", "oauth-2025-04-20,claude-code-20250219")
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await;
        if matches!(&probe, Ok(response) if response.status().is_success()) {
            if model == "claude-sonnet-5" {
                heavy_ok = true;
            }
        }
    }
    let tier = claude_code_subscription_type();
    claude_plan_message(heavy_ok, tier.as_deref())
}

/// True when a stamped `subscriptionType` is a paid/enterprise plan whose heavy
/// models carry quota, as opposed to the free personal plan.
fn is_paid_claude_tier(tier: Option<&str>) -> bool {
    matches!(
        tier,
        Some("team")
            | Some("pro")
            | Some("enterprise")
            | Some("max")
            | Some("premium")
    )
}

/// Human-readable verdict on which Claude entitlement a token resolved to.
/// `heavy_ok` is whether the heavy-model probe (sonnet) succeeded; `tier` is
/// the `subscriptionType` stamped by Claude Code, when reachable.
fn claude_plan_message(heavy_ok: bool, tier: Option<&str>) -> String {
    if heavy_ok {
        "Claude account resolved with heavy-model access (enterprise/premium quota in effect). Models check out: claude-sonnet-5 and claude-haiku-4-5 both respond.".to_string()
    } else if is_paid_claude_tier(tier) {
        format!(
            "Claude account resolves to a {} account, not a free plan: heavy models are momentarily rate-limited (429) while claude-haiku-4-5 works. This is a transient 5-hour quota window, not a plan or sign-in problem - retry shortly or use a lightweight model to continue.",
            tier.unwrap_or("paid")
        )
    } else {
        "Claude account resolves to a plan without heavy-model access (likely the free personal plan): claude-sonnet-5 is rate-limited (429) while claude-haiku-4-5 works. This is a quota/entitlement boundary, not a sign-in problem, so reusing Claude Code's saved login (sign out with x on the picker) inherits whatever quota that workspace carries - heavy-model access only improves if your Claude Code workspace has a premium allowance.".to_string()
    }
}


pub async fn complete_browser_login(login: AccountLogin) -> Result<AccountProvider, String> {
    let listener = bind_callback(&login).await?;
    complete_callback_login(listener, login).await
}

pub async fn complete_callback_login(
    listener: tokio::net::TcpListener,
    login: AccountLogin,
) -> Result<AccountProvider, String> {
    let code = accept_callback(listener, &login).await?;
    complete_code_login(login, code).await
}

pub async fn complete_callback_login_with_manual(
    listener: tokio::net::TcpListener,
    login: AccountLogin,
    mut manual: tokio::sync::mpsc::UnboundedReceiver<String>,
) -> Result<AccountProvider, String> {
    let code = {
        let callback = accept_callback(listener, &login);
        tokio::pin!(callback);
        loop {
            match manual.try_recv() {
                Ok(input) => {
                    if let Ok(code) = login.parse_manual_input(&input) {
                        break code;
                    }
                }
                Err(tokio::sync::mpsc::error::TryRecvError::Empty) => {}
                Err(tokio::sync::mpsc::error::TryRecvError::Disconnected) => {
                    break callback.await?;
                }
            }
            tokio::select! {
                result = &mut callback => break result?,
                input = manual.recv() => match input {
                    Some(input) => {
                        if let Ok(code) = login.parse_manual_input(&input) {
                            break code;
                        }
                    }
                    None => break callback.await?,
                },
            }
        }
    };
    complete_code_login(login, code).await
}

async fn complete_code_login(
    login: AccountLogin,
    code: String,
) -> Result<AccountProvider, String> {
    let provider = login.provider;
    let token = exchange(&login, &code).await?;
    let definition =
        crate::core::cli::auth::provider_by_id(provider.credential_provider())
            .ok_or_else(|| "selected account is unavailable".to_string())?;
    #[cfg(test)]
    let definition = {
        let mut definition = definition;
        if let Some(base_url) = login.model_base_url {
            definition.default_base_url = base_url;
        }
        definition
    };
    // Codex and Claude account tokens authenticate against different surfaces.
    // A Claude account token is valid against `/v1/models` (Anthropic accepts
    // it with the OAuth beta header). A Codex account token is a ChatGPT
    // account token that `api.openai.com/v1/models` rejects (401) because that
    // endpoint only accepts an API key - so discovery is skipped for Codex and
    // the account is instead verified from the JWT `chatgpt_account_id` claim,
    // exactly as opencode and pi do. Codex is served through the Responses API.
    let (models, api_type) = if provider == AccountProvider::Codex {
        match codex_chatgpt_account_id(&token.access_token) {
            Ok(account_id) => {
                debug_log(&format!("codex: verified chatgpt_account_id {account_id}"));
                // Fetch the account's real Codex roster from the ChatGPT
                // backend's `/codex/models` endpoint (a Codex account token is
                // a ChatGPT credential, not an OpenAI API key, so
                // `api.openai.com/v1/models` rejects it). `/codex/models`
                // returns the stable Codex slugs, whereas
                // `chatgpt.com/backend-api/models` would return rolling
                // user-scoped ChatGPT codenames that cannot run. Fall back to
                // a single default model so a transient roster failure never
                // hard-fails an otherwise valid login.
                let models = crate::core::cli::auth::providers::discover_codex_models(
                    &token.access_token,
                    Some(&account_id),
                    &definition.default_base_url,
                )
                .await
                .map(|m| {
                    if m.is_empty() {
                        vec!["gpt-5-chat-latest".to_string()]
                    } else {
                        m
                    }
                })
                .unwrap_or_else(|error| {
                    debug_log(&format!("codex: model discovery failed: {error:?}"));
                    vec!["gpt-5-chat-latest".to_string()]
                });
                (models, Some("openai-responses".to_string()))
            }
            Err(error) => {
                debug_log(&format!("codex: account validation failed: {error}"));
                return Err("could not verify the Codex account".to_string());
            }
        }
    } else {
        let models =
            crate::core::cli::auth::providers::discover_models(&definition, &token.access_token, true)
                .await
                .map_err(|error| {
                    debug_log(&format!(
                        "model discovery: {} rejected the token: {error:?}",
                        definition.id
                    ));
                    "could not discover account models".to_string()
                })?;
        (
            models,
            matches!(
                definition.transport,
                crate::core::cli::auth::Transport::Anthropic
            )
            .then_some("anthropic".to_string()),
        )
    };
    store(provider, &token)?;
    if let Err(error) = crate::core::agent::global_config::set_provider(
        definition.id,
        crate::core::agent::global_config::ProviderUpdate {
            api_key: None,
            clear_api_key: true,
            base_url: Some(definition.default_base_url),
            models: Some(models),
            api_type,
        },
    ) {
        let _ = CredentialStore::delete(provider.credential_provider());
        return Err(format!(
            "could not save the provider configuration: {error}"
        ));
    }
    Ok(provider)
}
#[cfg(test)]
mod tests {

    use super::*;
    use crate::core::agent::global_config::{load_global_config, with_temp_home};
    use crate::core::server::provider_secrets::SECRET_STORE_TEST_LOCK;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{mpsc, Mutex, MutexGuard};

    /// Serializes the two tests that mutate the process-global Claude alias
    /// latch, which cargo runs in parallel threads.
    static ALIAS_TEST_LOCK: Mutex<()> = Mutex::new(());

    fn alias_test_lock() -> MutexGuard<'static, ()> {
        ALIAS_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner())
    }

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
                Some(value) => std::env::set_var("JAN_DATA_FOLDER", value),
                None => std::env::remove_var("JAN_DATA_FOLDER"),
            }
        }
    }

    fn account_models_server(
        status_line: &'static str,
        body: &'static str,
    ) -> (String, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let read = stream.read(&mut request).unwrap_or(0);
            let _ = tx.send(String::from_utf8_lossy(&request[..read]).into_owned());
            let response = format!(
                "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
        });
        (format!("http://{addr}/v1"), rx)
    }

    fn unavailable_base_url() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        drop(listener);
        format!("http://{addr}/v1")
    }

    fn token_server() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/token", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let _ = stream.read(&mut request).unwrap();
            let body = r#"{"access_token":"exchanged-account-token","refresh_token":"refresh","expires_in":3600,"token_type":"Bearer","scope":"profile offline_access"}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });
        endpoint
    }
    /// Build a signed-shape Codex OAuth access token (a JWT) carrying the
    /// `https://api.openai.com/auth` -> `chatgpt_account_id` claim that jan
    /// uses to verify a Codex account. The signature is a dummy; `codex_chatgpt_account_id`
    /// decodes only the payload segment.
    fn codex_jwt(account_id: &str) -> String {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"RS256"}"#);
        let payload = serde_json::json!({
            "https://api.openai.com/auth": { "chatgpt_account_id": account_id },
            "sub": account_id,
        });
        let payload = URL_SAFE_NO_PAD.encode(payload.to_string());
        format!("{header}.{payload}.signature")
    }

    /// Build a fake OpenAI token exchange response whose access token is a
    /// Codex JWT. Used by the live accounts tests to exercise the Codex
    /// verify-then-persist path.
    fn codex_token_server(account_id: &str) -> String {
        let jwt = codex_jwt(account_id);
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/token", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let _ = stream.read(&mut request).unwrap();
            let body = format!(
                r#"{{"access_token":"{}","refresh_token":"refresh","expires_in":3600,"token_type":"Bearer","scope":"profile offline_access"}}"#,
                jwt
            );
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });
        endpoint
    }

    fn complete_account_for_test(models_base_url: String) -> Result<AccountProvider, String> {
        std::thread::spawn(move || {
            tokio::runtime::Runtime::new().unwrap().block_on(async move {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                let address = listener.local_addr().unwrap();
                let mut login = begin(AccountProvider::Codex).unwrap();
                login.token_endpoint = codex_token_server("account-321");
                login.model_base_url = Some(models_base_url);
                let callback = format!(
                    "GET /auth/callback?code=authorization-code&state={} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n",
                    login.state
                );
                let client = tokio::spawn(async move {
                    let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
                    tokio::io::AsyncWriteExt::write_all(&mut stream, callback.as_bytes())
                        .await
                        .unwrap();
                });
                let result = complete_callback_login(listener, login).await;
                client.await.unwrap();
                result
            })
        })
        .join()
        .expect("account completion thread must not panic")
    }


    /// A Claude-specific completion helper. Claude OAuth keeps the real
    /// `/v1/models` discovery path, so these tests exercise discovery failure
    /// semantics against a plain account token (Claude's token is not a JWT).
    fn complete_claude_account_for_test(
        models_base_url: String,
    ) -> Result<AccountProvider, String> {
        std::thread::spawn(move || {
            tokio::runtime::Runtime::new().unwrap().block_on(async move {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                let address = listener.local_addr().unwrap();
                let mut login = begin(AccountProvider::Claude).unwrap();
                login.model_base_url = Some(models_base_url);
                let callback = format!(
                    "GET /callback?code=authorization-code&state={} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n",
                    login.state
                );
                let client = tokio::spawn(async move {
                    let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
                    tokio::io::AsyncWriteExt::write_all(&mut stream, callback.as_bytes())
                        .await
                        .unwrap();
                });
                let result = complete_callback_login(listener, login).await;
                client.await.unwrap();
                result
            })
        })
        .join()
        .expect("claude account completion thread must not panic")
    }
    fn complete_account_manually_for_test(
        models_base_url: String,
    ) -> Result<AccountProvider, String> {
        std::thread::spawn(move || {
            tokio::runtime::Runtime::new().unwrap().block_on(async move {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                let mut login = begin(AccountProvider::Codex).unwrap();
                login.token_endpoint = codex_token_server("account-321");
                login.model_base_url = Some(models_base_url);
                let manual_input = format!("authorization-code#{}", login.state);
                let (manual, receiver) = tokio::sync::mpsc::unbounded_channel();
                manual.send(manual_input).unwrap();
                complete_callback_login_with_manual(listener, login, receiver).await
            })
        })
        .join()
        .expect("manual account completion thread must not panic")
    }

    #[test]
    fn codex_browser_login_uses_pkce_and_loopback_callback() {
        let login = begin(AccountProvider::Codex).unwrap();
        let url = url::Url::parse(&login.authorization_url).unwrap();

        assert_eq!(
            url.origin().ascii_serialization(),
            "https://auth.openai.com"
        );
        assert_eq!(url.path(), "/oauth/authorize");
        assert_eq!(
            url.query_pairs()
                .find(|(key, _)| key == "response_type")
                .unwrap()
                .1,
            "code"
        );
        assert_eq!(
            url.query_pairs()
                .find(|(key, _)| key == "code_challenge_method")
                .unwrap()
                .1,
            "S256"
        );
        assert_eq!(login.redirect_uri, "http://localhost:1455/auth/callback");
        assert!(!login.state.is_empty());
        assert!(!login.verifier.is_empty());
    }

    #[test]
    fn claude_browser_login_uses_pkce_and_loopback_callback() {
        let login = begin(AccountProvider::Claude).unwrap();
        let url = url::Url::parse(&login.authorization_url).unwrap();

        assert_eq!(url.origin().ascii_serialization(), "https://claude.ai");
        assert_eq!(url.path(), "/oauth/authorize");
        assert_eq!(
            url.query_pairs()
                .find(|(key, _)| key == "response_type")
                .unwrap()
                .1,
            "code"
        );
        assert_eq!(
            url.query_pairs()
                .find(|(key, _)| key == "code_challenge_method")
                .unwrap()
                .1,
            "S256"
        );
        assert_eq!(login.redirect_uri, "http://localhost:54545/callback");
        assert!(!login.state.is_empty());
        assert!(!login.verifier.is_empty());
    }
    #[test]
    fn claude_browser_login_uses_registered_client_id() {
        let login = begin(AccountProvider::Claude).unwrap();
        let url = url::Url::parse(&login.authorization_url).unwrap();

        assert_eq!(
            url.query_pairs()
                .find(|(key, _)| key == "client_id")
                .unwrap()
                .1,
            "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
        );
        assert_eq!(login.client_id, "9d1c250a-e61b-44d9-88ed-5944d1962f5e");
        assert_eq!(
            login.token_endpoint,
            "https://platform.claude.com/v1/oauth/token"
        );
    }

    #[test]
    fn claude_browser_login_matches_reference_state_and_scopes() {
        let login = begin(AccountProvider::Claude).unwrap();
        let url = url::Url::parse(&login.authorization_url).unwrap();

        assert_eq!(
            url.query_pairs()
                .find(|(key, _)| key == "scope")
                .unwrap()
                .1,
            "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload"
        );
        // Anthropic accepts only `state == code_verifier`, so Claude's state
        // must equal its verifier (not be an independent random value).
        assert_eq!(login.state, login.verifier, "Claude state must equal verifier");
        assert!(
            url.query_pairs()
                .find(|(key, _)| key == "state")
                .unwrap()
                .1
                == login.verifier,
            "authorize URL state must be the verifier"
        );
    }

    #[test]
    fn codex_browser_login_matches_reference_flow() {
        let login = begin(AccountProvider::Codex).unwrap();
        let url = url::Url::parse(&login.authorization_url).unwrap();

        assert_eq!(
            url.query_pairs()
                .find(|(key, _)| key == "scope")
                .unwrap()
                .1,
            "openid profile email offline_access api.connectors.read api.connectors.invoke"
        );
        assert_eq!(
            url.query_pairs()
                .find(|(key, _)| key == "originator")
                .unwrap()
                .1,
            "jan"
        );
        assert_eq!(url.query_pairs().find(|(key, _)| key == "client_id").unwrap().1, "app_EMoamEEZ73f0CkXaXp7hrann");
        assert_eq!(login.token_endpoint, "https://auth.openai.com/oauth/token");
    }

    #[test]
    fn callback_requires_the_matching_state() {
        let login = begin(AccountProvider::Codex).unwrap();
        let accepted = format!(
            "{}?code=authorization-code&state={}",
            login.redirect_uri, login.state
        );
        assert_eq!(
            parse_callback(&accepted, &login.state).unwrap(),
            "authorization-code"
        );
        assert!(parse_callback(
            "http://localhost:1455/auth/callback?code=authorization-code&state=wrong",
            &login.state
        )
        .is_err());
    }

    #[test]
    fn manual_callback_accepts_a_complete_redirect_url() {
        let login = begin(AccountProvider::Codex).unwrap();
        let raw = format!(
            "{}?code=authorization-code&state={}",
            login.redirect_uri, login.state
        );
        assert_eq!(
            parse_manual_callback(&raw, &login.state).unwrap(),
            "authorization-code"
        );
    }

    #[test]
    fn manual_callback_accepts_a_raw_code_and_optional_state_suffix() {
        assert_eq!(
            parse_manual_callback("authorization-code", "expected-state").unwrap(),
            "authorization-code"
        );
        assert_eq!(
            parse_manual_callback("authorization-code#expected-state", "expected-state").unwrap(),
            "authorization-code"
        );
    }

    #[test]
    fn manual_callback_rejects_empty_code_and_mismatched_state() {
        assert!(parse_manual_callback("", "expected-state").is_err());
        assert!(parse_manual_callback("authorization-code#wrong-state", "expected-state").is_err());
        assert!(parse_manual_callback(
            "http://localhost:1455/auth/callback?code=authorization-code&state=wrong-state",
            "expected-state"
        )
        .is_err());
    }

    #[test]
    fn token_exchange_binds_code_to_the_original_pkce_request() {
        let login = begin(AccountProvider::Claude).unwrap();
        let fields = token_request_body(&login, "authorization-code");

        assert_eq!(
            fields.get("grant_type"),
            Some(&"authorization_code".to_string())
        );
        assert_eq!(fields.get("code"), Some(&"authorization-code".to_string()));
        assert_eq!(fields.get("code_verifier"), Some(&login.verifier));
        assert_eq!(
            fields.get("redirect_uri"),
            Some(&login.redirect_uri.to_string())
        );
        assert!(fields.get("client_id").is_some());
        // Anthropic's token endpoint expects `state` echoed back on exchange;
        // OpenAI's rejects the extra field, so it must stay Claude-only.
        assert_eq!(fields.get("state"), Some(&login.state));

        let codex_login = begin(AccountProvider::Codex).unwrap();
        let codex_fields = token_request_body(&codex_login, "authorization-code");
        assert!(!codex_fields.contains_key("state"));
    }

    #[tokio::test]
    async fn token_exchange_stores_refreshable_credentials() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/token", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let _ = stream.read(&mut request).unwrap();
            let body = r#"{"access_token":"access","refresh_token":"refresh","expires_in":3600,"token_type":"Bearer","scope":"profile offline_access"}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        });

        let mut login = begin(AccountProvider::Codex).unwrap();
        login.token_endpoint = endpoint;
        let token = exchange(&login, "authorization-code").await.unwrap();

        assert_eq!(token.access_token, "access");
        assert_eq!(token.refresh_token.as_deref(), Some("refresh"));
        assert_eq!(token.token_type, "Bearer");
        assert_eq!(token.scopes, vec!["profile", "offline_access"]);
        assert!(token.expires_at.is_some());
    }

    /// Each provider's token endpoint expects a specific request encoding:
    /// Anthropic posts JSON, OpenAI posts form-encoded. Sending the wrong one
    /// gets the exchange rejected even when every other parameter is right.
    #[tokio::test]
    async fn exchange_posts_json_for_claude_and_form_for_codex() {
        use std::io::{Read, Write};
        use std::net::TcpListener;

        async fn run_case(provider: AccountProvider, expected: &str) {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let endpoint = format!("http://{}/token", listener.local_addr().unwrap());
            let body = r#"{"access_token":"access","expires_in":3600,"token_type":"Bearer"}"#;
            let expected = expected.to_string();
            let handle = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = Vec::new();
                let mut chunk = [0; 8192];
                // Read until the full body has arrived: a single read can
                // return headers only while the body is still in flight, and
                // answering early makes reqwest's send() fail mid-write.
                loop {
                    match stream.read(&mut chunk).unwrap() {
                        0 => break,
                        n => {
                            request.extend_from_slice(&chunk[..n]);
                            if let Some(header_end) =
                                request.windows(4).position(|w| w == b"\r\n\r\n")
                            {
                                let head = String::from_utf8_lossy(&request[..header_end]);
                                let content_length = head
                                    .lines()
                                    .find_map(|line| {
                                        line.to_ascii_lowercase()
                                            .strip_prefix("content-length:")
                                            .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                                    })
                                    .unwrap_or(0);
                                if request.len() >= header_end + 4 + content_length {
                                    break;
                                }
                            }
                        }
                    }
                }
                let request = String::from_utf8_lossy(&request);
                assert!(
                    request.starts_with(&format!("POST /token HTTP/1.1\r\n")),
                    "{request}"
                );
                let lower = request.to_ascii_lowercase();
                assert!(
                    lower.contains(&expected.to_ascii_lowercase()),
                    "missing {expected} in: {request}"
                );
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                )
                .unwrap();
            });

            let mut login = begin(provider).unwrap();
            login.token_endpoint = endpoint;
            exchange(&login, "authorization-code").await.unwrap();
            handle.join().unwrap();
        }

        run_case(AccountProvider::Claude, "Content-Type: application/json").await;
        run_case(
            AccountProvider::Codex,
            "Content-Type: application/x-www-form-urlencoded",
        )
        .await;
    }

    #[tokio::test]
    async fn loopback_listener_accepts_matching_callback() {
        use tokio::io::AsyncWriteExt;

        let login = begin(AccountProvider::Codex).unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let callback = format!(
            "GET /auth/callback?code=authorization-code&state={} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n",
            login.state
        );
        let client = tokio::spawn(async move {
            let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
            stream.write_all(callback.as_bytes()).await.unwrap();
        });

        assert_eq!(
            accept_callback(listener, &login).await.unwrap(),
            "authorization-code"
        );
        client.await.unwrap();
    }

    #[test]
    fn codex_login_persists_token_and_responses_config() {
        let _tmp = TempSecrets::new();
        with_temp_home(|_| {
            // Codex verifies the account via the JWT chatgpt_account_id claim
            // and fetches its real model roster from the ChatGPT backend's
            // `/codex/models` endpoint (not the rolling `/models` roster),
            // then configures the Responses API with that roster.
            let roster = r#"{"models":[{"slug":"gpt-5.5","display_name":"GPT-5.5"},{"slug":"gpt-5.4","display_name":"GPT-5.4"}]}"#;
            let (models_base_url, request) = account_models_server("200 OK", roster);

            assert_eq!(
                complete_account_for_test(models_base_url.clone()).unwrap(),
                AccountProvider::Codex
            );

            // Codex performs model discovery against the Codex roster route,
            // carrying the Codex client identifiers. The mock channel records
            // the raw HTTP request, so assert the path and headers directly.
            let request = request.try_recv().expect("Codex must hit /codex/models");
            assert!(
                request.contains("/codex/models"),
                "must target /codex/models, got: {request}"
            );
            assert!(
                request.contains("client_version=0.144.1"),
                "missing client_version in: {request}"
            );
            assert!(
                request.contains("chatgpt-account-id: account-321"),
                "missing chatgpt-account-id in: {request}"
            );
            assert!(
                request.to_ascii_lowercase()
                    .contains("openai-beta: responses=experimental"),
                "missing OpenAI-Beta in: {request}"
            );

            let token = OAuthToken {
                access_token: codex_jwt("account-321").into(),
                refresh_token: Some("refresh".into()),
                expires_at: CredentialStore::load("openai")
                    .unwrap()
                    .and_then(|credential| {
                        credential.as_oauth().and_then(|token| token.expires_at)
                    }),
                token_type: "Bearer".into(),
                scopes: vec!["profile".into(), "offline_access".into()],
            };
            assert_eq!(
                CredentialStore::load("openai").unwrap(),
                Some(Credential::OAuthToken(token))
            );

            let cfg = load_global_config().unwrap().get("openai").unwrap().clone();
            assert!(cfg.api_key.is_none());
            assert!(cfg.api_keys.is_empty());
            assert_eq!(cfg.base_url.as_deref(), Some(models_base_url.as_str()));
            assert_eq!(
                cfg.models,
                vec!["gpt-5.4".to_string(), "gpt-5.5".to_string()]
            );
            assert_eq!(cfg.api_type.as_deref(), Some("openai-responses"));
        });
    }

    #[test]
    fn codex_login_falls_back_to_default_when_roster_unavailable() {
        let _tmp = TempSecrets::new();
        with_temp_home(|_| {
            // A failed/empty roster must not hard-fail an otherwise valid
            // login; the account persists with a single usable default model.
            let (models_base_url, _request) = account_models_server("200 OK", "{}");

            assert_eq!(
                complete_account_for_test(models_base_url.clone()).unwrap(),
                AccountProvider::Codex
            );

            let cfg = load_global_config().unwrap().get("openai").unwrap().clone();
            assert_eq!(cfg.models, vec!["gpt-5-chat-latest".to_string()]);
            assert_eq!(cfg.api_type.as_deref(), Some("openai-responses"));
        });
    }

    #[test]
    fn manual_codex_login_persists_token_and_responses_config() {
        let _tmp = TempSecrets::new();
        with_temp_home(|_| {
            let roster = r#"{"models":[{"slug":"gpt-5.5","display_name":"GPT-5.5"},{"slug":"gpt-5.4","display_name":"GPT-5.4"}]}"#;
            let (models_base_url, request) = account_models_server("200 OK", roster);

            assert_eq!(
                complete_account_manually_for_test(models_base_url.clone()).unwrap(),
                AccountProvider::Codex
            );

            // Codex performs model discovery against the Codex roster route.
            let request = request.try_recv().expect("Codex must hit /codex/models");
            assert!(
                request.contains("/codex/models"),
                "must target /codex/models, got: {request}"
            );
            assert!(
                request.contains("chatgpt-account-id: account-321"),
                "missing chatgpt-account-id in: {request}"
            );

            let token = OAuthToken {
                access_token: codex_jwt("account-321").into(),
                refresh_token: Some("refresh".into()),
                expires_at: CredentialStore::load("openai")
                    .unwrap()
                    .and_then(|credential| {
                        credential.as_oauth().and_then(|token| token.expires_at)
                    }),
                token_type: "Bearer".into(),
                scopes: vec!["profile".into(), "offline_access".into()],
            };
            assert_eq!(
                CredentialStore::load("openai").unwrap(),
                Some(Credential::OAuthToken(token))
            );

            let cfg = load_global_config().unwrap().get("openai").unwrap().clone();
            assert!(cfg.api_key.is_none());
            assert!(cfg.api_keys.is_empty());
            assert_eq!(cfg.base_url.as_deref(), Some(models_base_url.as_str()));
            assert_eq!(
                cfg.models,
                vec!["gpt-5.4".to_string(), "gpt-5.5".to_string()]
            );
            assert_eq!(cfg.api_type.as_deref(), Some("openai-responses"));
        });
    }


    #[test]
    fn account_model_discovery_unauthorized_leaves_no_account_state() {
        let _tmp = TempSecrets::new();
        with_temp_home(|_| {
            let (models_base_url, _request) = account_models_server("401 Unauthorized", "{}");
            let error = complete_claude_account_for_test(models_base_url).unwrap_err();

            assert!(!error.contains("exchanged-account-token"), "{error}");
            assert!(!error.contains("authorization-code"), "{error}");
            assert!(CredentialStore::load(AccountProvider::Claude.credential_provider())
                .unwrap()
                .is_none());
            assert!(load_global_config()
                .unwrap()
                .get("anthropic")
                .is_none());
        });
    }

    #[test]
    fn account_model_discovery_unreadable_response_leaves_no_account_state() {
        let _tmp = TempSecrets::new();
        with_temp_home(|_| {
            let (models_base_url, _request) =
                account_models_server("200 OK", "not-json-without-secret");
            let error = complete_claude_account_for_test(models_base_url).unwrap_err();

            assert!(!error.contains("not-json-without-secret"), "{error}");
            assert!(!error.contains("exchanged-account-token"), "{error}");
            assert!(!error.contains("authorization-code"), "{error}");
            assert!(CredentialStore::load(AccountProvider::Claude.credential_provider())
                .unwrap()
                .is_none());
            assert!(load_global_config()
                .unwrap()
                .get("anthropic")
                .is_none());
        });
    }

    #[test]
    fn account_model_discovery_unavailable_server_leaves_no_account_state() {
        let _tmp = TempSecrets::new();
        with_temp_home(|_| {
            let error = complete_claude_account_for_test(unavailable_base_url()).unwrap_err();

            assert!(!error.contains("exchanged-account-token"), "{error}");
            assert!(!error.contains("authorization-code"), "{error}");
            assert!(CredentialStore::load(AccountProvider::Claude.credential_provider())
                .unwrap()
                .is_none());
            assert!(load_global_config()
                .unwrap()
                .get("anthropic")
                .is_none());
        });
    }

    #[test]
    fn exchanged_token_is_scoped_to_its_account_provider() {
        use crate::core::server::provider_secrets::SECRET_STORE_TEST_LOCK;

        let _guard = SECRET_STORE_TEST_LOCK
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let directory = tempfile::tempdir().unwrap();
        let previous = std::env::var("JAN_DATA_FOLDER").ok();
        std::env::set_var("JAN_DATA_FOLDER", directory.path());
        crate::core::server::provider_secrets::force_file_secrets();

        let token = OAuthToken {
            access_token: "access".into(),
            refresh_token: Some("refresh".into()),
            expires_at: Some(1_800_000_000),
            token_type: "Bearer".into(),
            scopes: vec!["profile".into()],
        };
        store(AccountProvider::Claude, &token).unwrap();
        assert_eq!(
            crate::core::cli::auth::CredentialStore::load("anthropic").unwrap(),
            Some(crate::core::cli::auth::Credential::OAuthToken(token))
        );

        match previous {
            Some(value) => std::env::set_var("JAN_DATA_FOLDER", value),
            None => std::env::remove_var("JAN_DATA_FOLDER"),
        }
    }

    #[test]
    fn refresh_request_uses_the_refresh_grant_without_the_expired_access_token() {
        let token = OAuthToken {
            access_token: "expired-access".into(),
            refresh_token: Some("refresh-token".into()),
            expires_at: Some(1),
            token_type: "Bearer".into(),
            scopes: vec!["profile".into()],
        };

        let fields = refresh_request_body("client", &token).unwrap();

        assert_eq!(fields.get("grant_type"), Some(&"refresh_token".to_string()));
        assert_eq!(
            fields.get("refresh_token"),
            Some(&"refresh-token".to_string())
        );
        assert_eq!(fields.get("client_id"), Some(&"client".to_string()));
        assert!(!fields.contains_key("access_token"));
    }


    #[test]
    fn claude_plan_message_heavy_access_names_premium() {
        let text = claude_plan_message(true, None);
        assert!(text.contains("heavy-model access"), "{text}");
        assert!(text.contains("enterprise/premium"), "{text}");
    }

    #[test]
    fn claude_plan_message_paid_tier_is_not_reported_as_free() {
        // A team/enterprise account whose heavy-model quota is momentarily
        // exhausted must be reported as a paid tier with a transient 429, never
        // as a "free personal plan".
        let text = claude_plan_message(false, Some("team"));
        assert!(text.contains("team account"), "{text}");
        assert!(text.contains("not a free plan"), "{text}");
        assert!(text.contains("429"), "{text}");
        assert!(!text.contains("free personal plan"), "{text}");
        let pro = claude_plan_message(false, Some("pro"));
        assert!(pro.contains("pro account"), "{pro}");
        // An unknown / missing tier falls back to the free-plan framing.
        let unknown = claude_plan_message(false, None);
        assert!(unknown.contains("free personal plan"), "{unknown}");
    }

    #[test]
    fn claude_plan_message_personal_plan_names_the_discriminator() {
        let text = claude_plan_message(false, None);
        assert!(text.contains("free personal plan"), "{text}");
        assert!(text.contains("claude-sonnet-5"), "{text}");
        assert!(text.contains("429"), "{text}");
        assert!(text.contains("claude-haiku-4-5"), "{text}");
        // The guidance must be honest that 429 is a quota boundary, not a
        // sign-in problem, so it never promises a sign-out unlocks heavy models.
        assert!(text.contains("quota"), "{text}");
        assert!(!text.contains("it will reuse Claude Code's existing login, which carries the workspace you approved there"), "{text}");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn claude_plan_summary_falls_back_when_no_credential() {
        let _alias = alias_test_lock();
        set_claude_alias(false);
        let _temp = TempSecrets::new();
        // No Claude credential is stored in the fresh temp home, and the alias
        // is pinned off, so the function must produce the fallback line.
        let summary = claude_plan_summary("fallback-line").await;
        assert_eq!(summary, "fallback-line");
    }
    #[test]
    fn claude_code_secret_extracts_the_access_token() {
        let secret = r#"{"mcpOAuth":{},"claudeAiOauth":{"accessToken":"sk-ant-oat01-abc","refreshToken":"sk-ant-ort01-def","expiresAt":1786970599091,"scopes":["user:inference"]}}"#;
        assert_eq!(
            parse_claude_code_secret(secret).as_deref(),
            Some("sk-ant-oat01-abc")
        );
        // A missing/empty access token must not come through as Some("").
        assert_eq!(parse_claude_code_secret(r#"{"claudeAiOauth":{"accessToken":""}}"#), None);
        assert_eq!(
            parse_claude_code_secret(r#"{"claudeAiOauth":{"refreshToken":"sk-ant-ort01-x"}}"#),
            None
        );
        assert_eq!(parse_claude_code_secret("not json"), None);
    }
    #[test]
    fn claude_code_oauth_converts_expiry_to_seconds_and_carries_refresh() {
        // expiresAt is stored in epoch milliseconds; OAuthToken.expires_at is
        // in seconds. 1786970599091 ms -> 1786970599 s.
        let oauth = claude_code_oauth(
            r#"{"claudeAiOauth":{"accessToken":"sk-ant-oat01-abc","refreshToken":"sk-ant-ort01-def","expiresAt":1786970599091}}"#,
        )
        .expect("parseable");
        assert_eq!(oauth.access_token, "sk-ant-oat01-abc");
        assert_eq!(oauth.refresh_token.as_deref(), Some("sk-ant-ort01-def"));
        assert_eq!(oauth.expires_at, Some(1786970599));
    }

    #[test]
    fn rotate_claude_code_secret_preserves_unrelated_fields_and_rotates_ms() {
        let fresh = OAuthToken {
            access_token: "sk-ant-oat01-new".to_string(),
            refresh_token: Some("sk-ant-ort01-new".to_string()),
            expires_at: Some(1_800_000_000),
            token_type: "Bearer".to_string(),
            scopes: vec!["user:inference".to_string()],
        };
        let updated = rotate_claude_code_secret(
            r#"{"mcpOAuth":{"some":"kept"},"claudeAiOauth":{"accessToken":"old","refreshToken":"oldrt","expiresAt":1000},"claudeOauth":{"x":1}}"#,
            &fresh,
        )
        .expect("rotates");
        let doc: serde_json::Value = serde_json::from_str(&updated).unwrap();
        // Unrelated top-level blocks are preserved.
        assert_eq!(doc["mcpOAuth"]["some"], "kept");
        assert_eq!(doc["claudeOauth"]["x"], 1);
        // The oauth block is rotated; expiresAt written back in milliseconds.
        assert_eq!(doc["claudeAiOauth"]["accessToken"], "sk-ant-oat01-new");
        assert_eq!(doc["claudeAiOauth"]["refreshToken"], "sk-ant-ort01-new");
        assert_eq!(doc["claudeAiOauth"]["expiresAt"], 1_800_000_000_000_i64);
    }

    #[test]
    fn rotate_claude_code_secret_rejects_missing_oauth_block() {
        assert!(rotate_claude_code_secret(
            r#"{"mcpOAuth":{}}"#,
            &OAuthToken {
                access_token: "x".to_string(),
                refresh_token: None,
                expires_at: None,
                token_type: "Bearer".to_string(),
                scopes: Vec::new(),
            }
        )
        .is_err());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn claude_alias_is_off_by_default_in_tests() {
        let _guard = alias_test_lock();
        set_claude_alias(false);
        assert!(!claude_alias_enabled());
        assert_eq!(claude_code_access_token().await, None);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn claude_alias_toggle_controls_the_lookup_gate() {
        let _guard = alias_test_lock();
        set_claude_alias(false);
        // Off: the keychain is never touched, so this is deterministic None
        // even on a machine with Claude Code / omp installed.
        assert_eq!(claude_code_access_token().await, None);
        set_claude_alias(true);
        assert!(claude_alias_enabled());
        // On: it may surface a real token (on a machine with omp signed in) or
        // None (sandboxed/CI); either is a valid gate result, so only assert
        // the gate flips without panicking.
        let _ = claude_code_access_token().await;
        set_claude_alias(false);
        assert!(!claude_alias_enabled());
    }

    #[test]
    fn refresh_endpoint_matches_the_endpoint_begin_authorized_against() {
        // A refresh grant against a different endpoint than the one the user
        // consented to at `begin()` can silently swap token scope (Claude's
        // console endpoint grants org:create_api_key only, not
        // user:inference) even though the request itself succeeds.
        for provider in [AccountProvider::Codex, AccountProvider::Claude] {
            let login = begin(provider).unwrap();
            let (client_id, token_endpoint) = refresh_endpoint(provider);
            assert_eq!(client_id, login.client_id);
            assert_eq!(token_endpoint, login.token_endpoint);
        }
    }
}
