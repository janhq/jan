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
}

pub struct AccountLogin {
    pub authorization_url: String,
    pub redirect_uri: &'static str,
    pub state: String,
    pub verifier: String,
    client_id: &'static str,
    token_endpoint: String,
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
            "1d1c250a-e61b-44d9-88ed-5944d1962f5e",
            "https://claude.ai/oauth/authorize",
            "https://platform.claude.com/v1/oauth/token",
            "http://localhost:53692/callback",
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
        client_id,
        token_endpoint: token_endpoint.to_string(),
    })
}

fn random_url_safe(bytes: usize) -> String {
    let mut value = vec![0; bytes];
    rand::thread_rng().fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}

pub fn parse_callback(raw: &str, expected_state: &str) -> Result<String, String> {
    let url = url::Url::parse(raw.trim()).map_err(|_| "paste the complete redirect URL".to_string())?;
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
    let callback = format!("{}/{}", login.redirect_uri.trim_end_matches('/'), target.trim_start_matches('/'));
    let result = parse_callback(&callback, &login.state);
    let response = if result.is_ok() {
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: 71\r\nConnection: close\r\n\r\n<html><body>Sign-in completed. You can close this window.</body></html>"
    } else {
        "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: 57\r\nConnection: close\r\n\r\n<html><body>Sign-in could not be verified.</body></html>"
    };
    let _ = stream.write_all(response.as_bytes()).await;
    result
}

fn token_request_body(login: &AccountLogin, code: &str) -> std::collections::BTreeMap<String, String> {
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
        expires_at: token.expires_in.map(|seconds| now.saturating_add(seconds.saturating_sub(300))),
        token_type: token.token_type,
        scopes: token.scope.split_whitespace().map(str::to_string).collect(),
    })
}

pub fn store(provider: AccountProvider, token: &OAuthToken) -> Result<(), String> {
    CredentialStore::store(
        provider.credential_provider(),
        &Credential::OAuthToken(token.clone()),
    )
}
#[cfg(test)]
mod tests {

    use super::*;

    #[test]
    fn codex_browser_login_uses_pkce_and_loopback_callback() {
        let login = begin(AccountProvider::Codex).unwrap();
        let url = url::Url::parse(&login.authorization_url).unwrap();

        assert_eq!(url.origin().ascii_serialization(), "https://auth.openai.com");
        assert_eq!(url.path(), "/oauth/authorize");
        assert_eq!(url.query_pairs().find(|(key, _)| key == "response_type").unwrap().1, "code");
        assert_eq!(url.query_pairs().find(|(key, _)| key == "code_challenge_method").unwrap().1, "S256");
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
        assert_eq!(url.query_pairs().find(|(key, _)| key == "response_type").unwrap().1, "code");
        assert_eq!(url.query_pairs().find(|(key, _)| key == "code_challenge_method").unwrap().1, "S256");
        assert_eq!(login.redirect_uri, "http://localhost:53692/callback");
        assert!(!login.state.is_empty());
        assert!(!login.verifier.is_empty());
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
    fn token_exchange_binds_code_to_the_original_pkce_request() {
        let login = begin(AccountProvider::Claude).unwrap();
        let fields = token_request_body(&login, "authorization-code");

        assert_eq!(fields.get("grant_type"), Some(&"authorization_code".to_string()));
        assert_eq!(fields.get("code"), Some(&"authorization-code".to_string()));
        assert_eq!(fields.get("code_verifier"), Some(&login.verifier));
        assert_eq!(fields.get("redirect_uri"), Some(&login.redirect_uri.to_string()));
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

        assert_eq!(accept_callback(listener, &login).await.unwrap(), "authorization-code");
        client.await.unwrap();
    }

    #[test]
    fn exchanged_token_is_scoped_to_its_account_provider() {
        use crate::core::server::provider_secrets::SECRET_STORE_TEST_LOCK;

        let _guard = SECRET_STORE_TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
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
}
