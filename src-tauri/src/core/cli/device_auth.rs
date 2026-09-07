//! Browser-approval sign-in for Tokamak, the counterpart to `codex login
//! --device-auth` and Claude Code's OAuth login. Ported from the tokamak CLI's
//! `cli-login.ts`; the wire format below is that client's, not an invention.
//!
//! Where the legacy flow makes the user paste a minted `sk_live_*` key, this
//! flow leans on a browser approval that can happen on *any* device:
//!
//!   1. `POST {api}/auth/cli/sessions` with `{code_challenge, client_name}`
//!      returns `session_id`, `user_code` (`ABCD-2345`), `expires_in` and a
//!      suggested poll `interval`.
//!   2. The CLI opens `{web}/cli/authorize?code=ABCD-2345` so the user can
//!      confirm the code matches and click Approve (a phone works too; the poll
//!      below still finishes the login).
//!   3. The CLI polls `POST {api}/auth/cli/sessions/token` with
//!      `{session_id, code_verifier}` until the reply's `status` settles on
//!      `approved` (carrying the minted `api_key`), `denied`, or `expired`.
//!
//! These endpoints ride the gateway's unauthenticated `/auth/*` pass-through,
//! so they hang off the API *origin* -- not off the OpenAI-compatible `/v1`
//! base, which rejects everything unauthenticated. A server predating the flow
//! answers 404/405 there, which the caller turns into the legacy paste flow.
//!
//! Only the PKCE verifier proves the claim: revealing it at claim time is what
//! shows this process -- not someone who merely saw the session id -- is the
//! requester. No token or key ever rides a URL, and the browser's Keycloak
//! token never reaches the CLI.
//!
//! A 127.0.0.1-only ephemeral wake listener makes desktop logins complete the
//! instant the user clicks Approve, instead of waiting for the next poll tick.
//! Headless/SSH machines need nothing: approve from a phone and the poll picks
//! it up.
//!
//! Tauri-free and UI-free: presentation lives in the callers ([`super::login`]
//! for the plain terminal).

use std::net::{Ipv4Addr, SocketAddr};
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use url::Url;

/// Endpoint prefix for the CLI-login session API, relative to the API origin.
pub(crate) const SESSIONS_PATH: &str = "/auth/cli/sessions";

/// Identifies this client in the approve page ("… is requesting access").
const CLIENT_NAME: &str = "Jan CLI";

/// Fallbacks for a server that omits them, matching the reference client.
const DEFAULT_EXPIRES_IN: u64 = 600;
const DEFAULT_INTERVAL: u64 = 5;

/// Clamp for the server-suggested poll interval, so neither a zero nor an absurd
/// value turns the loop into a busy spin or a stall.
const MIN_INTERVAL: u64 = 1;
const MAX_INTERVAL: u64 = 30;

/// How long a single HTTP call waits before failing, so a hung server cannot
/// stall the poll loop past one tick's worth of patience.
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);

/// A fresh, unapproved sign-in as returned by the create endpoint.
#[derive(Debug, Clone, PartialEq)]
pub struct Session {
    pub session_id: String,
    /// The human-readable code the user must match in the authorize page
    /// (e.g. `ABCD-2345`).
    pub user_code: String,
    /// Where to ask the user to go, e.g.
    /// `https://tokamak.sh/cli/authorize?code=ABCD-2345`.
    pub authorize_url: String,
    /// Seconds the session lives before it expires -- the poll deadline.
    pub expires_in: u64,
    /// Seconds the server asks us to wait between polls.
    pub interval: u64,
}

/// State held between `begin` and `claim`, so a long approval window keeps the
/// verifier (and the wake listener) on one struct.
pub(crate) struct PendingAuth {
    api_root: String,
    session: Session,
    verifier: String,
    /// Bound in `begin` so its port and state can ride the authorize page and
    /// an Approve click can wake the poll immediately. `None` when binding
    /// failed -- the poll interval is the floor then.
    wake: Option<WakeServer>,
}

/// The key minted by a successful claim, before it is persisted.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Minted {
    pub api_key: String,
    /// Server-assigned key id, needed to revoke this exact key on logout.
    pub key_id: Option<String>,
    /// Unix seconds, parsed from the server's RFC 3339 `expires_at`.
    pub key_expires_at: Option<u64>,
    /// Who the server says signed in, for the sign-in report.
    pub account: Option<String>,
}

/// Why [`begin`] gave up. Split from a plain string so the caller can act on
/// "this server predates the flow" without matching on prose.
#[derive(Debug)]
pub(crate) enum BeginError {
    /// 404/405 from the auth pass-through: fall back to the legacy paste flow.
    Unsupported,
    Failed(String),
}

impl BeginError {
    pub(crate) fn message(&self, host: &str) -> String {
        match self {
            Self::Unsupported => format!(
                "the server at {host} does not support browser sign-in; falling back to pasting \
                 an API key"
            ),
            Self::Failed(e) => e.clone(),
        }
    }
}

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// Base64url (no padding) SHA-256 of `input` -- the S256 PKCE derivation.
fn pkce_code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn random_b64(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

/// A random verifier string. 43-128 chars of unreserved base64url -- 32 random
/// bytes is 43 characters, comfortably inside the codex/Claude range.
fn random_verifier() -> String {
    random_b64(32)
}

/// Guards the loopback wake endpoint, so only the browser we sent to the
/// approve page can ring it.
fn random_state() -> String {
    random_b64(16)
}

/// Scheme + host + port of `base_url`, with no trailing slash. The session
/// endpoints live at the API origin, not under the `/v1` OpenAI-compatible
/// prefix that `base_url` points at.
pub(crate) fn api_root(base_url: &str) -> String {
    match origin_of(base_url) {
        Some(url) => url.as_str().trim_end_matches('/').to_string(),
        None => base_url.trim_end_matches('/').to_string(),
    }
}

/// Origin of the *web* app, which serves the authorize page. Tokamak splits the
/// two (API at `api.tokamak.sh`, web at `tokamak.sh`), so a plain `api.`
/// subdomain is dropped; anything else is assumed to serve both.
fn web_root(base_url: &str) -> String {
    let Some(mut url) = origin_of(base_url) else {
        return base_url.trim_end_matches('/').to_string();
    };
    if let Some(host) = url.host_str().and_then(|h| h.strip_prefix("api.")) {
        let host = host.to_string();
        if url.set_host(Some(&host)).is_err() {
            return url.as_str().trim_end_matches('/').to_string();
        }
    }
    url.as_str().trim_end_matches('/').to_string()
}

fn origin_of(base_url: &str) -> Option<Url> {
    let mut url = Url::parse(base_url).ok()?;
    url.set_path("");
    url.set_query(None);
    url.set_fragment(None);
    Some(url)
}

/// The browser approval URL. When a wake listener is running, its loopback
/// address and a random state ride along so the approve page can bounce the
/// browser back and finish the terminal instantly -- the params carry no
/// secrets, and losing them only costs one poll tick.
fn build_authorize_url(web_root: &str, user_code: &str, wake: Option<(u16, &str)>) -> String {
    let joined = Url::parse(web_root).and_then(|base| base.join("/cli/authorize"));
    let Ok(mut url) = joined else {
        return format!("{web_root}/cli/authorize?code={user_code}");
    };
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("code", user_code);
        if let Some((port, state)) = wake {
            query.append_pair("redirect", &format!("http://127.0.0.1:{port}/done"));
            query.append_pair("state", state);
        }
    }
    url.to_string()
}

fn clamp_interval(seconds: Option<u64>) -> u64 {
    seconds
        .filter(|s| *s > 0)
        .unwrap_or(DEFAULT_INTERVAL)
        .clamp(MIN_INTERVAL, MAX_INTERVAL)
}

/// Start a sign-in: create a session on the server (PKCE S256 challenge,
/// unauthenticated) for the deployment `base_url` points at. `base_url` is the
/// OpenAI-compatible base (e.g. `https://api.tokamak.sh/v1`); both the API
/// origin and the authorize page host are derived from it.
pub(crate) async fn begin(base_url: &str) -> Result<PendingAuth, BeginError> {
    let verifier = random_verifier();
    let challenge = pkce_code_challenge(&verifier);
    let api_root = api_root(base_url);

    let body = serde_json::json!({ "code_challenge": challenge, "client_name": CLIENT_NAME });
    let response = http()
        .post(format!("{api_root}{SESSIONS_PATH}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| BeginError::Failed(format!("could not reach {api_root}: {e}")))?;

    let status = response.status().as_u16();
    // No route here means the deployment predates the flow.
    if status == 404 || status == 405 {
        return Err(BeginError::Unsupported);
    }
    let payload: SessionPayload = response.json().await.unwrap_or_default();
    let (Some(session_id), Some(user_code)) = (payload.session_id, payload.user_code) else {
        return Err(BeginError::Failed(describe_create_failure(
            status,
            payload.error.as_deref(),
        )));
    };
    if !(200..300).contains(&status) {
        return Err(BeginError::Failed(describe_create_failure(
            status,
            payload.error.as_deref(),
        )));
    }

    // Best-effort: a machine with no browser has nothing to hit the listener,
    // so a bind failure just means the poll interval is the floor.
    let state = random_state();
    let wake = WakeServer::bind(state.clone()).await.ok();
    let authorize_url = build_authorize_url(
        &web_root(base_url),
        &user_code,
        wake.as_ref().map(|w| (w.port, state.as_str())),
    );

    Ok(PendingAuth {
        api_root,
        session: Session {
            session_id,
            user_code,
            authorize_url,
            expires_in: payload
                .expires_in
                .filter(|s| *s > 0)
                .unwrap_or(DEFAULT_EXPIRES_IN),
            interval: clamp_interval(payload.interval),
        },
        verifier,
        wake,
    })
}

fn describe_create_failure(status: u16, error: Option<&str>) -> String {
    match status {
        401 | 403 => format!(
            "Tokamak refused to start a sign-in session (HTTP {status}). The sign-in endpoints \
             should not require auth, so this is likely the wrong endpoint for this deployment."
        ),
        429 => "too many sign-in attempts - wait a minute and try again.".to_string(),
        500..=599 => format!("Tokamak is unavailable right now (HTTP {status})."),
        _ => match error {
            Some(e) if !e.is_empty() => {
                format!("Tokamak could not start a sign-in session (HTTP {status}): {e}")
            }
            _ => format!("Tokamak could not start a sign-in session (HTTP {status})."),
        },
    }
}

impl PendingAuth {
    /// The session + authorize URL, for the caller to display before claiming.
    pub fn session(&self) -> &Session {
        &self.session
    }

    /// Point of no return for the poll loop: wait until the session settles,
    /// then hand back the minted key. Wakes early when the browser pings the
    /// loopback listener, otherwise sleeps the server-suggested interval.
    pub async fn claim(self) -> Result<Minted, String> {
        let PendingAuth {
            api_root,
            session,
            verifier,
            mut wake,
        } = self;

        let deadline = tokio::time::Instant::now() + Duration::from_secs(session.expires_in);
        let mut interval = Duration::from_secs(session.interval);
        // The last reachability blip, and whether it landed on the final poll:
        // then it, not the clock, is why the sign-in is being abandoned.
        let mut last_transient: Option<(String, bool)> = None;
        loop {
            // The local deadline is only a bound on waiting: one last poll runs
            // on the way out so the server's own `expired`/`approved` gets the
            // final word rather than the generic timeout below.
            let last_round = tokio::time::Instant::now() >= deadline;
            if !last_round {
                // Wait before the first poll: the session was created a moment
                // ago, so an immediate poll can only come back pending. The wake
                // is one-shot -- once it fires, later ticks are plain sleeps,
                // else an already-signalled listener would spin the loop.
                match wake.take() {
                    Some(listener) => {
                        if !listener.wait(interval).await {
                            wake = Some(listener);
                        }
                    }
                    None => tokio::time::sleep(interval).await,
                }
            }
            match poll_once(&api_root, &session.session_id, &verifier).await {
                Ok(Poll::Approved(minted)) => return Ok(*minted),
                Ok(Poll::Pending(next)) => {
                    interval = next;
                    // A live tick clears any earlier blip from the timeout message.
                    last_transient.take();
                }
                Ok(Poll::Denied) => {
                    return Err("the sign-in was denied in the browser.".to_string())
                }
                Ok(Poll::Expired) => {
                    return Err(
                        "the sign-in expired before it was approved. Run `jan login` again."
                            .to_string(),
                    )
                }
                // A reachability blip is one bad tick, not the session settling:
                // the user may have just approved and the key is live server
                // side. Keep polling and let the deadline bound the wait.
                Err(e) if e.retryable => last_transient = Some((e.message, last_round)),
                Err(e) => return Err(e.message),
            }
            if last_round {
                break;
            }
        }
        Err(match last_transient {
            // The last word came from a failed poll, not from the clock running
            // out on a silent server -- saying "timed out" would contradict a
            // reason like "approved but no API key".
            Some((e, true)) => format!(
                "could not confirm the sign-in before the window closed: {e} Run `jan login` again."
            ),
            Some((e, _)) => format!(
                "timed out waiting for browser approval (last poll error: {e}). Run `jan login` \
                 again."
            ),
            None => "timed out waiting for browser approval. Run `jan login` again.".to_string(),
        })
    }
}

/// How a single poll settled.
enum Poll {
    Pending(Duration),
    Denied,
    Expired,
    Approved(Box<Minted>),
}

/// Why a single poll failed. `retryable` marks the failures that say nothing
/// about the session itself -- the loop spends a tick on those instead of
/// abandoning a sign-in the user may have just approved.
struct PollError {
    message: String,
    retryable: bool,
}

impl PollError {
    fn transient(message: String) -> Self {
        Self {
            message,
            retryable: true,
        }
    }

    fn terminal(message: String) -> Self {
        Self {
            message,
            retryable: false,
        }
    }
}

/// A status the session cannot recover from: the server has judged this exact
/// session id or verifier, so re-polling it will keep failing.
fn poll_status_is_terminal(status: u16) -> bool {
    !matches!(status, 408 | 425 | 429 | 500..=599)
}

/// One poll of the token endpoint. `Err` is a transport or protocol failure;
/// everything the server models as an outcome comes back as a [`Poll`].
async fn poll_once(api_root: &str, session_id: &str, verifier: &str) -> Result<Poll, PollError> {
    let body = serde_json::json!({ "session_id": session_id, "code_verifier": verifier });
    let response = http()
        .post(format!("{api_root}{SESSIONS_PATH}/token"))
        .json(&body)
        .send()
        .await
        .map_err(|e| PollError::transient(format!("could not reach {api_root}: {e}")))?;

    let status = response.status().as_u16();
    let payload: PollPayload = response.json().await.unwrap_or_default();
    if !(200..300).contains(&status) {
        let message = describe_poll_failure(status, payload.error.as_deref());
        return Err(if poll_status_is_terminal(status) {
            PollError::terminal(message)
        } else {
            PollError::transient(message)
        });
    }

    Ok(match payload.status.as_deref() {
        Some("approved") => {
            let key = payload
                .api_key
                .filter(|k| !k.key.is_empty())
                .ok_or_else(|| {
                    // Approved without a key is a malformed body, not a verdict:
                    // the next poll of the same approved session should carry it.
                    PollError::transient(
                        "the sign-in was approved but Tokamak returned no API key.".to_string(),
                    )
                })?;
            Poll::Approved(Box::new(Minted {
                api_key: key.key,
                key_id: key.id.filter(|id| !id.is_empty()),
                key_expires_at: key.expires_at.as_deref().and_then(parse_expires_at),
                account: payload.user.and_then(|u| u.email.or(u.name)),
            }))
        }
        Some("denied") => Poll::Denied,
        Some("expired") => Poll::Expired,
        // An unrecognised status is not a terminal outcome: a newer server may
        // add intermediate states, and treating them as expired would abort a
        // live sign-in. Keep polling; the deadline still bounds the wait.
        _ => Poll::Pending(Duration::from_secs(clamp_interval(payload.interval))),
    })
}

fn describe_poll_failure(status: u16, error: Option<&str>) -> String {
    match status {
        401 | 403 => "the sign-in session could not be verified - re-run `jan login`.".to_string(),
        429 => "Tokamak is rate limiting - wait a moment and try again.".to_string(),
        500..=599 => format!("Tokamak is unavailable right now (HTTP {status})."),
        _ => match error {
            Some(e) if !e.is_empty() => {
                format!("Tokamak could not finish the sign-in (HTTP {status}): {e}")
            }
            _ => format!("Tokamak could not finish the sign-in (HTTP {status})."),
        },
    }
}

/// The server dates the key in RFC 3339; the config stores unix seconds.
fn parse_expires_at(raw: &str) -> Option<u64> {
    let parsed = chrono::DateTime::parse_from_rfc3339(raw).ok()?;
    u64::try_from(parsed.timestamp()).ok()
}

/// Payload of `POST /auth/cli/sessions`.
#[derive(Deserialize, Default)]
struct SessionPayload {
    #[serde(default)]
    session_id: Option<String>,
    #[serde(default)]
    user_code: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
    #[serde(default)]
    interval: Option<u64>,
    #[serde(default)]
    error: Option<String>,
}

/// Payload of `POST /auth/cli/sessions/token`.
#[derive(Deserialize, Default)]
struct PollPayload {
    #[serde(default)]
    status: Option<String>,
    #[serde(default)]
    interval: Option<u64>,
    #[serde(default)]
    api_key: Option<ApiKeyPayload>,
    #[serde(default)]
    user: Option<UserPayload>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Deserialize)]
struct ApiKeyPayload {
    key: String,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    expires_at: Option<String>,
}

#[derive(Deserialize)]
struct UserPayload {
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    name: Option<String>,
}

const WAKE_PAGE: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Jan CLI</title>\
</head><body style=\"font-family:system-ui,sans-serif;display:flex;align-items:center;\
justify-content:center;height:100vh;margin:0\"><div style=\"text-align:center\">\
<div style=\"font-size:2rem;margin-bottom:.5rem\">&#10003;</div>\
<h1 style=\"font-size:1.3rem;font-weight:500;margin:0 0 .4rem\">Jan CLI authorized</h1>\
<p style=\"opacity:.6;margin:0\">Return to your terminal. You can close this tab.</p>\
</div></body></html>";

/// A 127.0.0.1-only ephemeral listener that turns an approve click into an
/// immediate poll, instead of waiting for the next tick.
struct WakeServer {
    listener: tokio::net::TcpListener,
    port: u16,
    /// Guards the endpoint: the approve page echoes back the state we sent it.
    state: String,
}

/// What a request to the wake listener was asking for.
enum WakeRequest {
    /// Chrome's Private Network Access preflight, which must be answered before
    /// the approve page is allowed to ping loopback at all.
    Preflight,
    Woken,
    Other,
}

impl WakeServer {
    async fn bind(state: String) -> Result<Self, std::io::Error> {
        let listener =
            tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).await?;
        let port = listener.local_addr()?.port();
        Ok(Self {
            listener,
            port,
            state,
        })
    }

    /// Wait up to `timeout` for the browser to ping us. `true` means woken;
    /// `false` means the caller should just poll. The wake is only a heads-up
    /// that the poll should run now, never a trust boundary.
    async fn wait(&self, timeout: Duration) -> bool {
        use tokio::io::AsyncReadExt as _;
        let deadline = tokio::time::Instant::now() + timeout;
        let mut buf = [0u8; 1024];
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                return false;
            }
            let Ok(Ok((mut stream, _))) =
                tokio::time::timeout(remaining, self.listener.accept()).await
            else {
                return false;
            };
            let n = stream.read(&mut buf).await.unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..n]);
            match classify_wake(&request, &self.state) {
                WakeRequest::Preflight => {
                    let _ = write_preflight(&mut stream).await;
                }
                WakeRequest::Woken => {
                    let _ = write_wake_page(&mut stream).await;
                    return true;
                }
                WakeRequest::Other => {
                    let _ = write_not_found(&mut stream).await;
                }
            }
        }
    }
}

fn classify_wake(request: &str, state: &str) -> WakeRequest {
    let mut line = request
        .lines()
        .next()
        .unwrap_or_default()
        .split_whitespace();
    let method = line.next().unwrap_or_default();
    let target = line.next().unwrap_or_default();
    if method == "OPTIONS" {
        return WakeRequest::Preflight;
    }
    if method != "GET" {
        return WakeRequest::Other;
    }
    let Ok(url) = Url::parse("http://127.0.0.1").and_then(|base| base.join(target)) else {
        return WakeRequest::Other;
    };
    if url.path() != "/done" {
        return WakeRequest::Other;
    }
    match url.query_pairs().any(|(k, v)| k == "state" && v == state) {
        true => WakeRequest::Woken,
        false => WakeRequest::Other,
    }
}

async fn write_all(stream: &mut tokio::net::TcpStream, response: &str) -> std::io::Result<()> {
    use tokio::io::AsyncWriteExt as _;
    stream.write_all(response.as_bytes()).await
}

async fn write_preflight(stream: &mut tokio::net::TcpStream) -> std::io::Result<()> {
    write_all(
        stream,
        "HTTP/1.1 204 No Content\r\naccess-control-allow-origin: *\r\n\
         access-control-allow-methods: GET, OPTIONS\r\n\
         access-control-allow-private-network: true\r\nconnection: close\r\n\r\n",
    )
    .await
}

async fn write_wake_page(stream: &mut tokio::net::TcpStream) -> std::io::Result<()> {
    let response = format!(
        "HTTP/1.1 200 OK\r\ncontent-length: {}\r\ncontent-type: text/html; charset=utf-8\r\n\
         access-control-allow-origin: *\r\nconnection: close\r\n\r\n{WAKE_PAGE}",
        WAKE_PAGE.len()
    );
    write_all(stream, &response).await
}

async fn write_not_found(stream: &mut tokio::net::TcpStream) -> std::io::Result<()> {
    write_all(
        stream,
        "HTTP/1.1 404 Not Found\r\ncontent-length: 9\r\ncontent-type: text/plain\r\n\
         connection: close\r\n\r\nnot found",
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_is_stable_and_url_safe() {
        let verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
        let challenge = pkce_code_challenge(verifier);
        assert_eq!(challenge.len(), 43);
        assert!(!challenge.contains('='));
        assert!(!challenge.contains('+'));
        assert!(!challenge.contains('/'));
        assert_eq!(challenge, pkce_code_challenge(verifier));
    }

    /// The S256 derivation must match the reference client's
    /// `sha256(verifier).base64url`, or the server rejects every claim.
    #[test]
    fn pkce_challenge_matches_the_reference_vector() {
        // RFC 7636 appendix B.
        assert_eq!(
            pkce_code_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn verifier_is_url_safe_and_random() {
        let a = random_verifier();
        let b = random_verifier();
        assert_ne!(a, b);
        for v in [&a, &b] {
            assert!((43..=128).contains(&v.len()));
            for c in v.chars() {
                assert!(
                    c.is_ascii_alphanumeric() || c == '-' || c == '_',
                    "unexpected char in verifier: {c}"
                );
            }
        }
    }

    #[test]
    fn state_is_random_and_url_safe() {
        let a = random_state();
        assert_ne!(a, random_state());
        assert!(a
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    /// The session endpoints ride the API origin, never the `/v1` prefix -- the
    /// gateway 401s everything under `/v1` that has no bearer key.
    #[test]
    fn api_root_drops_the_v1_prefix() {
        assert_eq!(
            api_root("https://api.tokamak.sh/v1"),
            "https://api.tokamak.sh"
        );
        assert_eq!(
            api_root("https://api.tokamak.sh/v1/"),
            "https://api.tokamak.sh"
        );
        assert_eq!(
            api_root("http://localhost:8080/v1"),
            "http://localhost:8080"
        );
        assert_eq!(
            format!("{}{SESSIONS_PATH}", api_root("https://api.tokamak.sh/v1")),
            "https://api.tokamak.sh/auth/cli/sessions"
        );
    }

    /// The authorize page is on the web host, and carries no path from the API
    /// base -- `tokamak.sh/cli/authorize`, never `tokamak.sh/v1/cli/authorize`.
    #[test]
    fn web_root_drops_the_api_subdomain_and_the_path() {
        assert_eq!(web_root("https://api.tokamak.sh/v1"), "https://tokamak.sh");
        assert_eq!(web_root("https://tokamak.sh/v1"), "https://tokamak.sh");
        assert_eq!(
            web_root("http://localhost:8080/v1"),
            "http://localhost:8080"
        );
    }

    #[test]
    fn authorize_url_matches_the_reference_shape() {
        let url = build_authorize_url("https://tokamak.sh", "ABCD-2345", None);
        assert_eq!(url, "https://tokamak.sh/cli/authorize?code=ABCD-2345");
    }

    /// With a wake listener the redirect + state ride along, percent-encoded,
    /// and still carry no secret.
    #[test]
    fn authorize_url_carries_an_encoded_wake_redirect() {
        let url = build_authorize_url("https://tokamak.sh", "ABCD-2345", Some((54321, "st-1")));
        assert_eq!(
            url,
            "https://tokamak.sh/cli/authorize?code=ABCD-2345\
             &redirect=http%3A%2F%2F127.0.0.1%3A54321%2Fdone&state=st-1"
        );
        assert!(!url.contains("sk_live"));
        assert!(!url.contains("verifier"));
    }

    #[test]
    fn interval_is_clamped_and_defaulted() {
        assert_eq!(clamp_interval(None), DEFAULT_INTERVAL);
        assert_eq!(clamp_interval(Some(0)), DEFAULT_INTERVAL);
        assert_eq!(clamp_interval(Some(2)), 2);
        assert_eq!(clamp_interval(Some(9999)), MAX_INTERVAL);
    }

    #[test]
    fn expires_at_parses_rfc3339_into_unix_seconds() {
        assert_eq!(parse_expires_at("2023-11-14T22:13:20Z"), Some(1700000000));
        assert_eq!(
            parse_expires_at("2023-11-14T22:13:20+00:00"),
            Some(1700000000)
        );
        assert_eq!(parse_expires_at("not a date"), None);
        assert_eq!(parse_expires_at("1700000000"), None);
    }

    #[test]
    fn wake_requests_are_classified_by_path_and_state() {
        let woken = "GET /done?state=st-1 HTTP/1.1\r\nhost: 127.0.0.1\r\n\r\n";
        assert!(matches!(classify_wake(woken, "st-1"), WakeRequest::Woken));
        // A wrong or missing state is not a wake.
        assert!(matches!(classify_wake(woken, "other"), WakeRequest::Other));
        assert!(matches!(
            classify_wake("GET /done HTTP/1.1\r\n\r\n", "st-1"),
            WakeRequest::Other
        ));
        // Another path on the same port is not a wake.
        assert!(matches!(
            classify_wake("GET /?state=st-1 HTTP/1.1\r\n\r\n", "st-1"),
            WakeRequest::Other
        ));
        // Chrome's private-network preflight must be recognised, or the ping
        // never arrives.
        assert!(matches!(
            classify_wake("OPTIONS /done HTTP/1.1\r\n\r\n", "st-1"),
            WakeRequest::Preflight
        ));
        assert!(matches!(classify_wake("", "st-1"), WakeRequest::Other));
    }

    /// A create reply the server rejects, or one missing the ids, must not read
    /// as a session.
    #[test]
    fn create_failures_are_described_with_the_server_reason() {
        assert!(describe_create_failure(429, None).contains("too many sign-in attempts"));
        assert!(describe_create_failure(503, None).contains("unavailable"));
        assert!(describe_create_failure(400, Some("bad challenge")).contains("bad challenge"));
        // A 401 here means the wrong endpoint, not a bad credential.
        assert!(describe_create_failure(401, None).contains("should not require auth"));
    }

    /// Spin up a mock of the two endpoints and drive the whole flow: create,
    /// one `pending` poll, then `approved`. Asserts the request bodies match the
    /// reference client's field names -- the thing a mock-only test can still
    /// get wrong is exactly what this pins.
    #[test]
    fn create_poll_and_claim_use_the_reference_wire_format() {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let (host, requests) = mock_server(vec![
                (
                    200,
                    r#"{"session_id":"sess-1","user_code":"ABCD-2345","expires_in":300,"interval":1}"#,
                ),
                (200, r#"{"status":"pending","interval":1}"#),
                (
                    200,
                    r#"{"status":"approved","api_key":{"id":"k-1","key":"sk_live_x","expires_at":"2023-11-14T22:13:20Z"},"user":{"email":"a@b.c"}}"#,
                ),
            ])
            .await;

            let pending = begin(&format!("{host}/v1")).await.expect("begin");
            assert_eq!(pending.session().user_code, "ABCD-2345");
            assert_eq!(pending.session().expires_in, 300);
            assert_eq!(pending.session().interval, 1);

            let minted = pending.claim().await.expect("claim");
            assert_eq!(minted.api_key, "sk_live_x");
            assert_eq!(minted.key_id.as_deref(), Some("k-1"));
            assert_eq!(minted.key_expires_at, Some(1700000000));
            assert_eq!(minted.account.as_deref(), Some("a@b.c"));

            let seen = requests.lock().unwrap();
            assert_eq!(seen.len(), 3, "create + pending poll + approved poll");
            // Create: the session path hangs off the origin, not /v1, and sends
            // the challenge plus a client name.
            assert!(
                seen[0].starts_with("POST /auth/cli/sessions HTTP"),
                "{}",
                seen[0]
            );
            assert!(seen[0].contains("code_challenge"), "{}", seen[0]);
            assert!(seen[0].contains("client_name"), "{}", seen[0]);
            // Poll: the session id and the verifier, under the reference's
            // field names.
            for poll in &seen[1..] {
                assert!(poll.starts_with("POST /auth/cli/sessions/token HTTP"), "{poll}");
                assert!(poll.contains("\"session_id\":\"sess-1\""), "{poll}");
                assert!(poll.contains("code_verifier"), "{poll}");
                assert!(!poll.contains("sk_live"), "no key on the wire: {poll}");
            }
        });
    }

    /// `denied` and `expired` are outcomes, not "keep waiting" -- a user who
    /// clicks Deny must not sit through the whole poll window.
    #[test]
    fn a_denied_session_fails_immediately() {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let (host, _) = mock_server(vec![
                (
                    200,
                    r#"{"session_id":"s","user_code":"A-1","expires_in":300,"interval":1}"#,
                ),
                (200, r#"{"status":"denied"}"#),
            ])
            .await;
            let pending = begin(&format!("{host}/v1")).await.expect("begin");
            let err = pending.claim().await.expect_err("denied must fail");
            assert!(err.contains("denied in the browser"), "{err}");
        });
    }

    /// A gateway blip mid-poll must cost one tick, not the whole sign-in: the
    /// approval may already have happened server side.
    #[test]
    fn a_transient_poll_failure_keeps_polling() {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let (host, requests) = mock_server(vec![
                (
                    200,
                    r#"{"session_id":"s","user_code":"A-1","expires_in":300,"interval":1}"#,
                ),
                (502, r#"{"error":"bad gateway"}"#),
                (
                    200,
                    r#"{"status":"approved","api_key":{"key":"sk_live_x"}}"#,
                ),
            ])
            .await;
            let pending = begin(&format!("{host}/v1")).await.expect("begin");
            let minted = pending.claim().await.expect("claim survives one bad tick");
            assert_eq!(minted.api_key, "sk_live_x");
            assert_eq!(requests.lock().unwrap().len(), 3);
        });
    }

    /// The deadline only bounds waiting: one last poll runs on the way out, and
    /// a server that is still `pending` then yields the timeout message.
    #[test]
    fn a_session_that_is_never_approved_times_out_after_a_final_poll() {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let (host, requests) = mock_server(vec![
                (
                    200,
                    r#"{"session_id":"s","user_code":"A-1","expires_in":1,"interval":1}"#,
                ),
                (200, r#"{"status":"pending","interval":1}"#),
                (200, r#"{"status":"pending","interval":1}"#),
            ])
            .await;
            let pending = begin(&format!("{host}/v1")).await.expect("begin");
            let err = pending
                .claim()
                .await
                .expect_err("an unapproved session times out");
            assert_eq!(
                err,
                "timed out waiting for browser approval. Run `jan login` again."
            );
            assert_eq!(
                requests.lock().unwrap().len(),
                3,
                "create + one tick + the final poll after the deadline"
            );
        });
    }

    /// When the final poll is the one that fails, the reason is that failure --
    /// "timed out ... (approved but no API key)" would contradict itself.
    #[test]
    fn a_blip_on_the_final_poll_is_reported_instead_of_a_timeout() {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let (host, _) = mock_server(vec![
                (
                    200,
                    r#"{"session_id":"s","user_code":"A-1","expires_in":1,"interval":1}"#,
                ),
                (200, r#"{"status":"approved"}"#),
                (200, r#"{"status":"approved"}"#),
            ])
            .await;
            let pending = begin(&format!("{host}/v1")).await.expect("begin");
            let err = pending.claim().await.expect_err("no key is not a claim");
            assert_eq!(
                err,
                "could not confirm the sign-in before the window closed: the sign-in was approved \
                 but Tokamak returned no API key. Run `jan login` again."
            );
        });
    }

    /// A rejected verifier is the server judging this session, so re-polling it
    /// can only fail the same way -- fail now instead of at the deadline.
    #[test]
    fn a_rejected_session_fails_without_retrying() {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let (host, requests) = mock_server(vec![
                (
                    200,
                    r#"{"session_id":"s","user_code":"A-1","expires_in":300,"interval":1}"#,
                ),
                (401, r#"{"error":"bad verifier"}"#),
                (
                    200,
                    r#"{"status":"approved","api_key":{"key":"sk_live_x"}}"#,
                ),
            ])
            .await;
            let pending = begin(&format!("{host}/v1")).await.expect("begin");
            let err = pending.claim().await.expect_err("401 must fail");
            assert!(err.contains("could not be verified"), "{err}");
            assert_eq!(requests.lock().unwrap().len(), 2, "no poll after the 401");
        });
    }

    /// A server that predates the flow answers 404 (405 on some proxies); both
    /// are the signal to fall back to the paste flow, and neither is an error
    /// the user should see.
    #[test]
    fn a_legacy_server_reports_unsupported() {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            for status in [404, 405] {
                let (host, _) =
                    mock_server(vec![(status, r#"{"error":"auth route not found"}"#)]).await;
                match begin(&format!("{host}/v1")).await {
                    Err(BeginError::Unsupported) => {}
                    Err(BeginError::Failed(e)) => panic!("HTTP {status} must be Unsupported: {e}"),
                    Ok(_) => panic!("HTTP {status} must not yield a session"),
                }
            }
        });
    }

    /// The `/v1` gate answers 401 for paths it does not know, so a 401 must not
    /// be mistaken for "unsupported" -- it means we asked the wrong host.
    #[test]
    fn a_401_is_a_failure_not_a_fallback() {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let (host, _) =
                mock_server(vec![(401, r#"{"error":"authentication required"}"#)]).await;
            match begin(&format!("{host}/v1")).await {
                Err(BeginError::Failed(e)) => assert!(e.contains("should not require auth"), "{e}"),
                Err(BeginError::Unsupported) => panic!("401 must not read as unsupported"),
                Ok(_) => panic!("401 must not yield a session"),
            }
        });
    }

    #[test]
    fn unsupported_message_names_the_fallback() {
        let msg = BeginError::Unsupported.message("https://api.tokamak.sh");
        assert!(msg.contains("does not support browser sign-in"), "{msg}");
        assert!(msg.contains("pasting an API key"), "{msg}");
    }

    /// A wake ping completes the wait; a wrong state does not.
    #[test]
    fn the_wake_listener_answers_only_its_own_state() {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let wake = WakeServer::bind("st-1".to_string()).await.expect("bind");
            let port = wake.port;

            let ping = tokio::spawn(async move {
                let client = reqwest::Client::new();
                // A wrong state is refused...
                let bad = client
                    .get(format!("http://127.0.0.1:{port}/done?state=nope"))
                    .send()
                    .await
                    .expect("bad ping");
                assert_eq!(bad.status().as_u16(), 404);
                // ...and the right one is accepted, with CORS on the reply.
                let ok = client
                    .get(format!("http://127.0.0.1:{port}/done?state=st-1"))
                    .send()
                    .await
                    .expect("good ping");
                assert_eq!(ok.status().as_u16(), 200);
                assert_eq!(ok.headers()["access-control-allow-origin"], "*");
            });

            assert!(
                wake.wait(Duration::from_secs(5)).await,
                "the matching ping must wake the poll"
            );
            ping.await.unwrap();
        });
    }

    #[test]
    fn the_wake_listener_times_out_without_a_ping() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let wake = WakeServer::bind("st-1".to_string()).await.expect("bind");
            assert!(!wake.wait(Duration::from_millis(50)).await);
        });
    }

    /// Serve `replies` in order, recording each request. Returns the origin to
    /// point a client at plus the recorded requests.
    async fn mock_server(
        replies: Vec<(u16, &'static str)>,
    ) -> (String, std::sync::Arc<std::sync::Mutex<Vec<String>>>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
            .await
            .unwrap();
        let host = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let requests = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let recorded = requests.clone();

        tokio::spawn(async move {
            for (status, body) in replies {
                let Ok((mut sock, _)) = listener.accept().await else {
                    return;
                };
                let mut buf = vec![0u8; 4096];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                recorded
                    .lock()
                    .unwrap()
                    .push(String::from_utf8_lossy(&buf[..n]).to_string());
                let reason = if (200..300).contains(&status) {
                    "OK"
                } else {
                    "Error"
                };
                let response = format!(
                    "HTTP/1.1 {status} {reason}\r\ncontent-length: {}\r\n\
                     content-type: application/json\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = sock.write_all(response.as_bytes()).await;
            }
        });

        (host, requests)
    }
}
