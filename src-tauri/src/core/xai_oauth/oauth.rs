use crate::core::xai_oauth::store::{save_tokens, StoredXaiTokens};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use hyper::service::{make_service_fn, service_fn};
use hyper::{Body, Method, Request, Response, Server, StatusCode};
use rand::Rng;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};
use url::Url;

// Public Grok-CLI OAuth client used by Hermes, OpenClaw, and OpenCode.
pub const CLIENT_ID: &str = "b1a00492-073a-47ea-816f-4c329264a828";
pub const AUTHORIZE_URL: &str = "https://auth.x.ai/oauth2/authorize";
pub const TOKEN_URL: &str = "https://auth.x.ai/oauth2/token";
pub const DEVICE_AUTHORIZATION_URL: &str = "https://auth.x.ai/oauth2/device/code";
pub const DEVICE_CODE_GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";
pub const SCOPE: &str = "openid profile email offline_access grok-cli:access api:access";

pub const OAUTH_HOST: &str = "127.0.0.1";
pub const OAUTH_PORT: u16 = 56121;
pub const OAUTH_REDIRECT_PATH: &str = "/callback";
pub const REDIRECT_URI: &str = "http://127.0.0.1:56121/callback";

pub const ACCESS_TOKEN_REFRESH_SKEW_MS: i64 = 120_000;
pub const OAUTH_TIMEOUT_MS: u64 = 5 * 60 * 1000;

const DEVICE_CODE_DEFAULT_INTERVAL_MS: u64 = 5_000;
const DEVICE_CODE_MIN_INTERVAL_MS: u64 = 1_000;
const DEVICE_CODE_SLOW_DOWN_INCREMENT_MS: u64 = 5_000;
const DEVICE_CODE_DEFAULT_EXPIRES_MS: u64 = 5 * 60 * 1000;
const OAUTH_POLLING_SAFETY_MARGIN_MS: u64 = 3_000;

#[derive(Clone)]
pub struct PkceCodes {
    pub verifier: String,
    pub challenge: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<i64>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: Option<String>,
    pub expires_in: Option<i64>,
    pub interval: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct DeviceTokenErrorBody {
    error: Option<String>,
    error_description: Option<String>,
}

struct PendingOAuth {
    pkce: PkceCodes,
    state: String,
    result_tx: oneshot::Sender<Result<StoredXaiTokens, String>>,
}

pub struct XaiOAuthRuntime {
    pending: Arc<Mutex<Option<PendingOAuth>>>,
    login_receiver: Arc<Mutex<Option<oneshot::Receiver<Result<StoredXaiTokens, String>>>>>,
    server_task: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
}

impl Default for XaiOAuthRuntime {
    fn default() -> Self {
        Self {
            pending: Arc::new(Mutex::new(None)),
            login_receiver: Arc::new(Mutex::new(None)),
            server_task: Arc::new(Mutex::new(None)),
        }
    }
}

impl XaiOAuthRuntime {
    pub async fn start_login(&self) -> Result<String, String> {
        self.ensure_server_running().await?;
        let _ = self.cancel_pending_login().await;

        let pkce = generate_pkce();
        let state = generate_state();
        let (tx, rx) = oneshot::channel();

        {
            let mut pending = self.pending.lock().await;
            *pending = Some(PendingOAuth {
                pkce: pkce.clone(),
                state: state.clone(),
                result_tx: tx,
            });
            let mut login_receiver = self.login_receiver.lock().await;
            *login_receiver = Some(rx);
        }

        Ok(build_authorize_url(&pkce, &state))
    }

    pub async fn wait_for_login(
        &self,
        data_folder: &Path,
    ) -> Result<StoredXaiTokens, String> {
        let rx = {
            let mut login_receiver = self.login_receiver.lock().await;
            login_receiver
                .take()
                .ok_or_else(|| "No OAuth login in progress".to_string())?
        };

        let result = tokio::time::timeout(
            std::time::Duration::from_millis(OAUTH_TIMEOUT_MS),
            rx,
        )
        .await
        .map_err(|_| "OAuth callback timeout - authorization took too long".to_string())?
        .map_err(|_| "OAuth login cancelled".to_string())??;

        save_tokens(data_folder, &result)?;
        Ok(result)
    }

    pub async fn is_login_in_progress(&self) -> bool {
        self.pending.lock().await.is_some()
    }

    pub async fn cancel_login(&self) -> Result<(), String> {
        self.cancel_pending_login().await
    }

    pub async fn complete_with_callback_url(
        &self,
        data_folder: &Path,
        callback_url: &str,
    ) -> Result<StoredXaiTokens, String> {
        let (code, state) = parse_oauth_callback_input(callback_url)?;

        let (pkce, expected_state) = {
            let guard = self.pending.lock().await;
            let pending = guard.as_ref().ok_or_else(|| {
                "No OAuth login in progress. Click Sign in with SuperGrok again, then paste the code without refreshing this page.".to_string()
            })?;
            (pending.pkce.clone(), pending.state.clone())
        };

        if let Some(state) = state {
            if expected_state != state {
                return Err("Invalid state - potential CSRF attack".to_string());
            }
        }

        let tokens = exchange_code_for_tokens(&code, &pkce).await?;
        save_tokens(data_folder, &tokens)?;
        self.finish_pending_success(tokens.clone()).await?;
        Ok(tokens)
    }

    async fn ensure_server_running(&self) -> Result<(), String> {
        let mut task_guard = self.server_task.lock().await;
        if task_guard
            .as_ref()
            .is_some_and(|handle| !handle.is_finished())
        {
            return Ok(());
        }

        let pending = self.pending.clone();
        let addr: SocketAddr = format!("{OAUTH_HOST}:{OAUTH_PORT}")
            .parse()
            .map_err(|err| format!("Invalid OAuth listen address: {err}"))?;

        let make_svc = make_service_fn(move |_conn| {
            let pending = pending.clone();
            async move {
                Ok::<_, Infallible>(service_fn(move |req| {
                    let pending = pending.clone();
                    async move { handle_oauth_request(req, pending).await }
                }))
            }
        });

        let server = Server::bind(&addr).serve(make_svc);
        let handle = tokio::spawn(async move {
            if let Err(err) = server.await {
                log::warn!("xAI OAuth loopback server stopped: {err}");
            }
        });

        *task_guard = Some(handle);
        Ok(())
    }

    async fn cancel_pending_login(&self) -> Result<(), String> {
        self.reject_pending("Login cancelled").await
    }

    async fn reject_pending(&self, message: &str) -> Result<(), String> {
        let pending = self.pending.lock().await.take();
        if let Some(pending) = pending {
            let _ = pending.result_tx.send(Err(message.to_string()));
        }
        Ok(())
    }

    async fn finish_pending_success(&self, tokens: StoredXaiTokens) -> Result<(), String> {
        let pending = self.pending.lock().await.take();
        if let Some(pending) = pending {
            let _ = pending.result_tx.send(Ok(tokens));
        }
        Ok(())
    }
}

async fn handle_oauth_request(
    req: Request<Body>,
    pending: Arc<Mutex<Option<PendingOAuth>>>,
) -> Result<Response<Body>, hyper::Error> {
    let method = req.method().clone();
    let path = req.uri().path().to_string();

    if method == Method::OPTIONS {
        return Ok(cors_preflight_response(req));
    }

    if path == OAUTH_REDIRECT_PATH {
        let query = req.uri().query().unwrap_or_default();
        let parsed = Url::parse(&format!("http://{OAUTH_HOST}:{OAUTH_PORT}{path}?{query}"))
            .unwrap_or_else(|_| Url::parse(&format!("http://{OAUTH_HOST}:{OAUTH_PORT}{path}")).unwrap());

        let code = parsed
            .query_pairs()
            .find(|(key, _)| key == "code")
            .map(|(_, value)| value.to_string());
        let state = parsed
            .query_pairs()
            .find(|(key, _)| key == "state")
            .map(|(_, value)| value.to_string());
        let error = parsed
            .query_pairs()
            .find(|(key, _)| key == "error")
            .map(|(_, value)| value.to_string());
        let error_description = parsed
            .query_pairs()
            .find(|(key, _)| key == "error_description")
            .map(|(_, value)| value.to_string());

        if let Some(error) = error {
            let message = error_description.unwrap_or(error);
            reject_pending_with_message(&pending, &message).await;
            return Ok(html_response(StatusCode::OK, &html_error(&message)));
        }

        let Some(code) = code else {
            let message = "Missing authorization code";
            reject_pending_with_message(&pending, message).await;
            return Ok(html_response(StatusCode::BAD_REQUEST, &html_error(message)));
        };

        let current = {
            let mut guard = pending.lock().await;
            let Some(current) = guard.take() else {
                let message = "No OAuth login in progress";
                return Ok(html_response(StatusCode::BAD_REQUEST, &html_error(message)));
            };

            if current.state != state.unwrap_or_default() {
                let message = "Invalid state - potential CSRF attack";
                let _ = current.result_tx.send(Err(message.to_string()));
                return Ok(html_response(StatusCode::BAD_REQUEST, &html_error(message)));
            }

            current
        };

        match exchange_code_for_tokens(&code, &current.pkce).await {
            Ok(tokens) => {
                let _ = current.result_tx.send(Ok(tokens.clone()));
                Ok(html_response(StatusCode::OK, HTML_SUCCESS))
            }
            Err(err) => {
                let _ = current.result_tx.send(Err(err.clone()));
                Ok(html_response(StatusCode::BAD_REQUEST, &html_error(&err)))
            }
        }
    } else if path == "/cancel" {
        reject_pending_with_message(&pending, "Login cancelled").await;
        Ok(text_response(StatusCode::OK, "Login cancelled"))
    } else {
        Ok(text_response(StatusCode::NOT_FOUND, "Not found"))
    }
}

async fn reject_pending_with_message(pending: &Arc<Mutex<Option<PendingOAuth>>>, message: &str) {
    if let Some(current) = pending.lock().await.take() {
        let _ = current.result_tx.send(Err(message.to_string()));
    }
}

pub fn parse_oauth_callback_input(input: &str) -> Result<(String, Option<String>), String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Authorization code or callback URL is required".to_string());
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        let parsed = Url::parse(trimmed).map_err(|err| format!("Invalid callback URL: {err}"))?;

        if let Some(error) = parsed
            .query_pairs()
            .find(|(key, _)| key == "error")
            .map(|(_, value)| value.to_string())
        {
            let description = parsed
                .query_pairs()
                .find(|(key, _)| key == "error_description")
                .map(|(_, value)| value.to_string())
                .unwrap_or(error);
            return Err(description);
        }

        let code = parsed
            .query_pairs()
            .find(|(key, _)| key == "code")
            .map(|(_, value)| value.to_string())
            .ok_or_else(|| "Callback URL is missing authorization code".to_string())?;
        let state = parsed
            .query_pairs()
            .find(|(key, _)| key == "state")
            .map(|(_, value)| value.to_string());

        return Ok((code, state));
    }

    Ok((trimmed.to_string(), None))
}

pub fn build_authorize_url(pkce: &PkceCodes, state: &str) -> String {
    let nonce = generate_state();
    let mut params = url::form_urlencoded::Serializer::new(String::new());
    params.append_pair("response_type", "code");
    params.append_pair("client_id", CLIENT_ID);
    params.append_pair("redirect_uri", REDIRECT_URI);
    params.append_pair("scope", SCOPE);
    params.append_pair("code_challenge", &pkce.challenge);
    params.append_pair("code_challenge_method", "S256");
    params.append_pair("state", state);
    params.append_pair("nonce", &nonce);
    params.append_pair("plan", "generic");
    params.append_pair("referrer", "jan");
    format!("{AUTHORIZE_URL}?{}", params.finish())
}

pub async fn exchange_code_for_tokens(
    code: &str,
    pkce: &PkceCodes,
) -> Result<StoredXaiTokens, String> {
    let client = reqwest::Client::new();
    let response = client
        .post(TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .header("User-Agent", "Jan/0.8")
        .body(format!(
            "grant_type=authorization_code&code={}&redirect_uri={}&client_id={}&code_verifier={}&code_challenge={}&code_challenge_method=S256",
            urlencoding_encode(code),
            urlencoding_encode(REDIRECT_URI),
            urlencoding_encode(CLIENT_ID),
            urlencoding_encode(&pkce.verifier),
            urlencoding_encode(&pkce.challenge),
        ))
        .send()
        .await
        .map_err(|err| format!("xAI token exchange request failed: {err}"))?;

    let status = response.status();
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(format!(
            "xAI token exchange failed ({status}){}",
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        ));
    }

    let body: TokenResponse = response
        .json()
        .await
        .map_err(|err| format!("Failed to parse xAI token response: {err}"))?;

    token_response_to_stored(body, None)
}

pub async fn refresh_access_token(refresh_token: &str) -> Result<StoredXaiTokens, String> {
    let client = reqwest::Client::new();
    let response = client
        .post(TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .header("User-Agent", "Jan/0.8")
        .body(format!(
            "grant_type=refresh_token&refresh_token={}&client_id={}",
            urlencoding_encode(refresh_token),
            urlencoding_encode(CLIENT_ID),
        ))
        .send()
        .await
        .map_err(|err| format!("xAI token refresh request failed: {err}"))?;

    let status = response.status();
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(format!(
            "xAI token refresh failed ({status}){}",
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        ));
    }

    let body: TokenResponse = response
        .json()
        .await
        .map_err(|err| format!("Failed to parse xAI refresh response: {err}"))?;

    token_response_to_stored(body, Some(refresh_token.to_string()))
}

pub async fn request_device_code() -> Result<DeviceCodeResponse, String> {
    let client = reqwest::Client::new();
    let response = client
        .post(DEVICE_AUTHORIZATION_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .header("Accept", "application/json")
        .header("User-Agent", "Jan/0.8")
        .body(format!(
            "client_id={}&scope={}",
            urlencoding_encode(CLIENT_ID),
            urlencoding_encode(SCOPE),
        ))
        .send()
        .await
        .map_err(|err| format!("xAI device code request failed: {err}"))?;

    let status = response.status();
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(format!(
            "xAI device code request failed ({status}){}",
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        ));
    }

    let body: DeviceCodeResponse = response
        .json()
        .await
        .map_err(|err| format!("Failed to parse xAI device code response: {err}"))?;

    if body.device_code.is_empty() || body.user_code.is_empty() || body.verification_uri.is_empty() {
        return Err(
            "xAI device code response is missing device_code / user_code / verification_uri"
                .to_string(),
        );
    }

    Ok(body)
}

pub async fn poll_device_code_token(device: &DeviceCodeResponse) -> Result<StoredXaiTokens, String> {
    let expires_in_ms = positive_seconds_to_ms(device.expires_in, DEVICE_CODE_DEFAULT_EXPIRES_MS);
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(expires_in_ms);
    let mut interval_ms = positive_seconds_to_ms(device.interval, DEVICE_CODE_DEFAULT_INTERVAL_MS)
        .max(DEVICE_CODE_MIN_INTERVAL_MS);

    let client = reqwest::Client::new();

    while std::time::Instant::now() < deadline {
        let response = client
            .post(TOKEN_URL)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .header("Accept", "application/json")
            .header("User-Agent", "Jan/0.8")
            .body(format!(
                "grant_type={}&client_id={}&device_code={}",
                urlencoding_encode(DEVICE_CODE_GRANT_TYPE),
                urlencoding_encode(CLIENT_ID),
                urlencoding_encode(&device.device_code),
            ))
            .send()
            .await
            .map_err(|err| format!("xAI device token request failed: {err}"))?;

        let status = response.status();
        if status.is_success() {
            let body: TokenResponse = response
                .json()
                .await
                .map_err(|err| format!("Failed to parse xAI device token response: {err}"))?;
            return token_response_to_stored(body, None);
        }

        let body: DeviceTokenErrorBody = response
            .json()
            .await
            .unwrap_or(DeviceTokenErrorBody {
                error: None,
                error_description: None,
            });

        let remaining = deadline
            .saturating_duration_since(std::time::Instant::now())
            .as_millis() as u64;

        match body.error.as_deref() {
            Some("authorization_pending") => {
                tokio::time::sleep(std::time::Duration::from_millis(
                    interval_ms
                        .saturating_add(OAUTH_POLLING_SAFETY_MARGIN_MS)
                        .min(remaining)
                        .max(1),
                ))
                .await;
            }
            Some("slow_down") => {
                interval_ms += DEVICE_CODE_SLOW_DOWN_INCREMENT_MS;
                tokio::time::sleep(std::time::Duration::from_millis(
                    interval_ms
                        .saturating_add(OAUTH_POLLING_SAFETY_MARGIN_MS)
                        .min(remaining)
                        .max(1),
                ))
                .await;
            }
            Some("access_denied") | Some("authorization_denied") => {
                return Err("xAI device authorization was denied".to_string());
            }
            Some("expired_token") => {
                return Err("xAI device code expired - please re-run login".to_string());
            }
            _ => {
                let detail = body
                    .error_description
                    .or(body.error)
                    .unwrap_or_else(|| "unknown error".to_string());
                return Err(format!(
                    "xAI device token exchange failed ({status}){}",
                    if detail.is_empty() {
                        String::new()
                    } else {
                        format!(": {detail}")
                    }
                ));
            }
        }
    }

    Err("xAI device authorization timed out".to_string())
}

pub fn access_token_is_expiring(token: &str, skew_ms: i64) -> bool {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() < 2 {
        return false;
    }

    let mut payload = parts[1].replace('-', "+").replace('_', "/");
    while payload.len() % 4 != 0 {
        payload.push('=');
    }

    let decoded = match base64::engine::general_purpose::STANDARD.decode(payload) {
        Ok(value) => value,
        Err(_) => return false,
    };

    let claims: serde_json::Value = match serde_json::from_slice(&decoded) {
        Ok(value) => value,
        Err(_) => return false,
    };

    let exp = claims.get("exp").and_then(|value| value.as_i64());
    match exp {
        Some(exp) => exp * 1000 <= chrono::Utc::now().timestamp_millis() + skew_ms.max(0),
        None => false,
    }
}

pub async fn resolve_access_token(
    data_folder: &Path,
    stored: &StoredXaiTokens,
) -> Result<StoredXaiTokens, String> {
    let needs_refresh = stored.is_expiring_soon(ACCESS_TOKEN_REFRESH_SKEW_MS)
        || access_token_is_expiring(&stored.access_token, ACCESS_TOKEN_REFRESH_SKEW_MS);

    if !needs_refresh {
        return Ok(stored.clone());
    }

    let refreshed = refresh_access_token(&stored.refresh_token).await?;
    save_tokens(data_folder, &refreshed)?;
    Ok(refreshed)
}

fn token_response_to_stored(
    body: TokenResponse,
    fallback_refresh: Option<String>,
) -> Result<StoredXaiTokens, String> {
    let refresh_token = body
        .refresh_token
        .or(fallback_refresh)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "xAI token response is missing refresh_token".to_string())?;

    let expires_at =
        chrono::Utc::now().timestamp_millis() + body.expires_in.unwrap_or(3600) * 1000;

    Ok(StoredXaiTokens {
        access_token: body.access_token,
        refresh_token,
        expires_at,
    })
}

pub fn generate_pkce() -> PkceCodes {
    let verifier = generate_random_string(64);
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(hasher.finalize());
    PkceCodes { verifier, challenge }
}

pub fn generate_state() -> String {
    URL_SAFE_NO_PAD.encode(rand::thread_rng().gen::<[u8; 32]>())
}

fn generate_random_string(length: usize) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::thread_rng();
    (0..length)
        .map(|_| {
            let idx = rng.gen_range(0..CHARS.len());
            CHARS[idx] as char
        })
        .collect()
}

fn positive_seconds_to_ms(value: Option<i64>, default_ms: u64) -> u64 {
    match value {
        Some(seconds) if seconds > 0 => seconds as u64 * 1000,
        _ => default_ms,
    }
}

fn urlencoding_encode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

fn cors_preflight_response(req: Request<Body>) -> Response<Body> {
    let allowed_origins = ["https://accounts.x.ai", "https://auth.x.ai"];
    let origin = req
        .headers()
        .get("origin")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();

    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::NO_CONTENT;
    if allowed_origins.contains(&origin) {
        response
            .headers_mut()
            .insert("Access-Control-Allow-Origin", origin.parse().unwrap());
        response.headers_mut().insert(
            "Access-Control-Allow-Methods",
            "GET, OPTIONS".parse().unwrap(),
        );
        response.headers_mut().insert(
            "Access-Control-Allow-Headers",
            "Content-Type".parse().unwrap(),
        );
        response
            .headers_mut()
            .insert("Access-Control-Allow-Private-Network", "true".parse().unwrap());
        response
            .headers_mut()
            .insert("Vary", "Origin".parse().unwrap());
    }
    response
}

fn html_response(status: StatusCode, body: &str) -> Response<Body> {
    let mut response = Response::new(Body::from(body.to_string()));
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert("Content-Type", "text/html; charset=utf-8".parse().unwrap());
    response
}

fn text_response(status: StatusCode, body: &str) -> Response<Body> {
    let mut response = Response::new(Body::from(body.to_string()));
    *response.status_mut() = status;
    response
}

fn html_error(error: &str) -> String {
    format!(
        "<!doctype html><html><head><title>Jan - xAI Authorization Failed</title></head><body><h1>Authorization Failed</h1><p>{}</p></body></html>",
        escape_html(error)
    )
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

const HTML_SUCCESS: &str = "<!doctype html><html><head><title>Jan - xAI Authorization Successful</title></head><body><h1>Authorization Successful</h1><p>You can close this window and return to Jan.</p><script>setTimeout(() => window.close(), 2000)</script></body></html>";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_oauth_callback_input_accepts_raw_code() {
        let (code, state) =
            parse_oauth_callback_input("Id13pPcuznfZX94phdRn6ygiB88payGnrcR9ceqf4WJO2RShWKKCf5O0Y8G-mRFypBMlonXC4RX1tsE6-0UeTA")
                .unwrap();
        assert_eq!(
            code,
            "Id13pPcuznfZX94phdRn6ygiB88payGnrcR9ceqf4WJO2RShWKKCf5O0Y8G-mRFypBMlonXC4RX1tsE6-0UeTA"
        );
        assert!(state.is_none());
    }

    #[test]
    fn build_authorize_url_contains_required_params() {
        let pkce = generate_pkce();
        let state = generate_state();
        let url = build_authorize_url(&pkce, &state);
        assert!(url.starts_with(AUTHORIZE_URL));
        assert!(url.contains("plan=generic"));
        assert!(url.contains("referrer=jan"));
        assert!(url.contains(&urlencoding_encode(&pkce.challenge)));
        assert!(url.contains(&urlencoding_encode(&state)));
    }

    #[test]
    fn access_token_is_expiring_detects_near_expiry() {
        let exp = chrono::Utc::now().timestamp() + 30;
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(format!(r#"{{"exp":{exp}}}"#));
        let token = format!("header.{payload}.signature");
        assert!(access_token_is_expiring(&token, 120_000));
    }
}