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
            "openid profile email offline_access",
        ),
        AccountProvider::Claude => (
            "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
            "https://claude.ai/oauth/authorize",
            "https://api.anthropic.com/v1/oauth/token",
            "http://localhost:54545/callback",
            "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
        ),
    };
    let verifier = random_url_safe(32);
    let state = random_url_safe(16);
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

fn random_url_safe(bytes: usize) -> String {
    let mut value = vec![0; bytes];
    rand::thread_rng().fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
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
    [
        ("grant_type", "authorization_code".to_string()),
        ("client_id", login.client_id.to_string()),
        ("code", code.to_string()),
        ("code_verifier", login.verifier.clone()),
        ("redirect_uri", login.redirect_uri.to_string()),
    ]
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

    let response = reqwest::Client::new()
        .post(&login.token_endpoint)
        .form(&token_request_body(login, code))
        .send()
        .await
        .map_err(|_| "could not exchange the authorization code".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "account sign-in was rejected (HTTP {})",
            response.status()
        ));
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

    let (client_id, token_endpoint) = match provider {
        AccountProvider::Codex => (
            "app_EMoamEEZ73f0CkXaXp7hrann",
            "https://auth.openai.com/oauth/token",
        ),
        AccountProvider::Claude => (
            "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
            "https://api.anthropic.com/v1/oauth/token",
        ),
    };
    let response = reqwest::Client::new()
        .post(token_endpoint)
        .form(&refresh_request_body(client_id, token)?)
        .send()
        .await
        .map_err(|_| "could not refresh the account token".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "account token refresh was rejected (HTTP {})",
            response.status()
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

pub async fn access_token(provider: &str) -> Result<Option<String>, String> {
    let Some(provider_kind) = AccountProvider::from_credential_provider(provider) else {
        return Ok(None);
    };
    let Some(Credential::OAuthToken(token)) = CredentialStore::load(provider)? else {
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
    let models =
        crate::core::cli::auth::providers::discover_models(&definition, &token.access_token)
            .await
            .map_err(|_| "could not discover account models".to_string())?;
    store(provider, &token)?;
    if let Err(error) = crate::core::agent::global_config::set_provider(
        definition.id,
        crate::core::agent::global_config::ProviderUpdate {
            api_key: None,
            clear_api_key: true,
            base_url: Some(definition.default_base_url),
            models: Some(models),
            api_type: matches!(
                definition.transport,
                crate::core::cli::auth::Transport::Anthropic
            )
            .then_some("anthropic".to_string()),
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
    use std::sync::{mpsc, MutexGuard};

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

    fn complete_account_for_test(models_base_url: String) -> Result<AccountProvider, String> {
        std::thread::spawn(move || {
            tokio::runtime::Runtime::new().unwrap().block_on(async move {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                let address = listener.local_addr().unwrap();
                let mut login = begin(AccountProvider::Codex).unwrap();
                login.token_endpoint = token_server();
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

    fn complete_account_manually_for_test(
        models_base_url: String,
    ) -> Result<AccountProvider, String> {
        std::thread::spawn(move || {
            tokio::runtime::Runtime::new().unwrap().block_on(async move {
                let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
                let mut login = begin(AccountProvider::Codex).unwrap();
                login.token_endpoint = token_server();
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
        assert_eq!(login.token_endpoint, "https://api.anthropic.com/v1/oauth/token");
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
    fn account_model_discovery_persists_models_and_token() {
        let _tmp = TempSecrets::new();
        with_temp_home(|_| {
            let body = r#"{"data":[{"id":"gpt-4o-mini"},{"id":"gpt-4o"},{"id":"gpt-4o"}]}"#;
            let (models_base_url, request) = account_models_server("200 OK", body);

            assert_eq!(
                complete_account_for_test(models_base_url.clone()).unwrap(),
                AccountProvider::Codex
            );

            let models_request = request.recv().unwrap();
            assert!(
                models_request.starts_with("GET /v1/models HTTP/1.1"),
                "{models_request}"
            );
            assert!(
                models_request.contains("authorization: Bearer exchanged-account-token")
                    || models_request.contains("Authorization: Bearer exchanged-account-token"),
                "{models_request}"
            );

            let token = OAuthToken {
                access_token: "exchanged-account-token".into(),
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
                vec!["gpt-4o".to_string(), "gpt-4o-mini".to_string()]
            );
        });
    }

    #[test]
    fn manual_account_completion_persists_models_and_token() {
        let _tmp = TempSecrets::new();
        with_temp_home(|_| {
            let body = r#"{"data":[{"id":"gpt-4o-mini"},{"id":"gpt-4o"},{"id":"gpt-4o"}]}"#;
            let (models_base_url, request) = account_models_server("200 OK", body);

            assert_eq!(
                complete_account_manually_for_test(models_base_url.clone()).unwrap(),
                AccountProvider::Codex
            );

            let models_request = request.recv().unwrap();
            assert!(models_request.starts_with("GET /v1/models HTTP/1.1"));
            assert!(
                models_request.contains("authorization: Bearer exchanged-account-token")
                    || models_request.contains("Authorization: Bearer exchanged-account-token")
            );

            let token = OAuthToken {
                access_token: "exchanged-account-token".into(),
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
                vec!["gpt-4o".to_string(), "gpt-4o-mini".to_string()]
            );
        });
    }

    #[test]
    fn account_model_discovery_unauthorized_leaves_no_account_state() {
        let _tmp = TempSecrets::new();
        with_temp_home(|_| {
            let (models_base_url, _request) = account_models_server("401 Unauthorized", "{}");
            let error = complete_account_for_test(models_base_url).unwrap_err();

            assert!(!error.contains("exchanged-account-token"), "{error}");
            assert!(!error.contains("authorization-code"), "{error}");
            assert!(CredentialStore::load("openai").unwrap().is_none());
            assert!(load_global_config().unwrap().get("openai").is_none());
        });
    }

    #[test]
    fn account_model_discovery_unreadable_response_leaves_no_account_state() {
        let _tmp = TempSecrets::new();
        with_temp_home(|_| {
            let (models_base_url, _request) =
                account_models_server("200 OK", "not-json-without-secret");
            let error = complete_account_for_test(models_base_url).unwrap_err();

            assert!(!error.contains("not-json-without-secret"), "{error}");
            assert!(!error.contains("exchanged-account-token"), "{error}");
            assert!(!error.contains("authorization-code"), "{error}");
            assert!(CredentialStore::load("openai").unwrap().is_none());
            assert!(load_global_config().unwrap().get("openai").is_none());
        });
    }

    #[test]
    fn account_model_discovery_unavailable_server_leaves_no_account_state() {
        let _tmp = TempSecrets::new();
        with_temp_home(|_| {
            let error = complete_account_for_test(unavailable_base_url()).unwrap_err();

            assert!(!error.contains("exchanged-account-token"), "{error}");
            assert!(!error.contains("authorization-code"), "{error}");
            assert!(CredentialStore::load("openai").unwrap().is_none());
            assert!(load_global_config().unwrap().get("openai").is_none());
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
}
