use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountProvider {
    Codex,
    Claude,
}

pub struct AccountLogin {
    pub authorization_url: String,
    pub redirect_uri: &'static str,
    pub state: String,
    pub verifier: String,
}

pub fn begin(provider: AccountProvider) -> Result<AccountLogin, String> {
    let (client_id, authorization_endpoint, redirect_uri, scopes) = match provider {
        AccountProvider::Codex => (
            "app_EMoamEEZ73f0CkXaXp7hrann",
            "https://auth.openai.com/oauth/authorize",
            "http://localhost:1455/auth/callback",
            "openid profile email offline_access",
        ),
        AccountProvider::Claude => (
            "1d1c250a-e61b-44d9-88ed-5944d1962f5e",
            "https://claude.ai/oauth/authorize",
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
}
