//! `http_fetch`: the only network path of an installed extension.
//!
//! Every call re-reads the extension's grants from `extensions.json` and
//! checks the URL with the same rule as the web-app dispatcher before any
//! socket is opened. The client has no cookie store and follows no
//! redirect: a 3xx comes back to the caller with its `Location`, and the
//! caller checks the next hop against the grants and calls again. Cookie
//! headers are dropped both ways and a request cannot set transport
//! headers (Host and the like), so a granted connection cannot be pointed
//! at another virtual host.
//!
//! # Accepted risks
//!
//! **DNS rebinding.** A `network:<host>` grant is checked against the URL's
//! host name; the address it resolves to is not checked. Every host other
//! than `localhost` and `127.0.0.1` must be https with a certificate that
//! verifies for that name, and Jan's local API server speaks plain http, so
//! a name rebound to loopback cannot complete a TLS handshake with it. What
//! remains is an internal https service that holds a valid certificate for
//! the granted public name, which an extension cannot arrange.
//!
//! **Proxies.** Requests go through whatever proxy reqwest picks up: the
//! `HTTP_PROXY`, `HTTPS_PROXY` and `ALL_PROXY` variables (honouring
//! `NO_PROXY`), and in the app build also the system proxy settings, since
//! cargo unifies reqwest's default features from the app crate. Extension
//! traffic, including granted `http://localhost` and `http://127.0.0.1`
//! requests, may therefore pass through the user's proxy unless `NO_PROXY`
//! excludes it. That is the user's own configuration, so it is accepted;
//! the grant check is unaffected because it runs on the URL before the
//! request is built. Index and tarball downloads ([`crate::index`]) behave
//! the same way.

use std::collections::BTreeMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;
use url::Url;

use crate::error::{Error, Result};
use crate::install::network_grants;
use crate::permissions::url_allowed;
use crate::state::{lock, ExtensionsState, Running};

/// Largest response body returned by [`http_fetch`].
pub const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
/// Largest request body accepted.
pub const MAX_REQUEST_BYTES: usize = 4 * 1024 * 1024;
/// Largest body one stream may deliver in total. Model output is long, but
/// not unbounded.
pub const MAX_STREAM_BYTES: usize = 64 * 1024 * 1024;
/// Whole-request timeout of [`http_fetch`].
pub const FETCH_TIMEOUT: Duration = Duration::from_secs(30);
/// Longest wait for the next chunk of a stream (or its head).
pub const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(300);
/// Requests in flight per extension.
pub const MAX_IN_FLIGHT_PER_EXTENSION: usize = 8;

const METHODS: &[&str] = &["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];
const COOKIE_HEADERS: &[&str] = &["cookie", "cookie2", "set-cookie", "set-cookie2"];
// Set by the client from the URL and body; letting a caller choose them
// would let a granted connection carry a request for another host.
const TRANSPORT_HEADERS: &[&str] = &[
    "host",
    "content-length",
    "transfer-encoding",
    "connection",
    "keep-alive",
    "upgrade",
    "te",
    "trailer",
    "expect",
    "proxy-authorization",
    "proxy-connection",
];

/// A request from an extension.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    /// Absolute https URL (http only for localhost and 127.0.0.1).
    pub url: String,
    /// `GET` (default), `POST`, `PUT`, `PATCH`, `DELETE` or `HEAD`.
    #[serde(default)]
    pub method: Option<String>,
    /// Request headers. Cookie and transport headers are refused.
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    /// UTF-8 request body.
    #[serde(default)]
    pub body: Option<String>,
}

/// A whole response. A redirect is returned as is, with `Location` in
/// `headers`, for the caller to check and follow.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    /// HTTP status.
    pub status: u16,
    /// Response headers, lowercase names, repeated values joined by `, `.
    /// Cookie headers are removed.
    pub headers: BTreeMap<String, String>,
    /// The body, decoded as UTF-8 (invalid sequences replaced).
    pub body: String,
}

/// One event of [`http_fetch_stream`], in order: `head`, any number of
/// `chunk`, then `end` or `error`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "camelCase")]
pub enum HttpStreamEvent {
    /// Status and headers; a redirect ends right after it.
    Head {
        /// HTTP status.
        status: u16,
        /// As in [`HttpResponse::headers`].
        headers: BTreeMap<String, String>,
    },
    /// The next piece of the body. Chunks split only between whole UTF-8
    /// characters, so concatenating them gives the body.
    Chunk {
        /// UTF-8 text.
        data: String,
    },
    /// The body is complete.
    End,
    /// The stream failed after its head.
    #[serde(rename_all = "camelCase")]
    Error {
        /// The same `kind` as a command error.
        kind: String,
        /// What went wrong.
        message: String,
    },
}

/// A request that passed [`check_request`].
#[derive(Debug, Clone)]
pub struct CheckedRequest {
    /// The parsed URL.
    pub url: Url,
    /// The method.
    pub method: reqwest::Method,
    /// The headers to send, lowercase names.
    pub headers: Vec<(String, String)>,
}

/// Validates the request and checks the URL against `granted`, before any
/// network.
pub fn check_request(
    granted: &[String],
    req: &HttpRequest,
    local_api_port: Option<u16>,
) -> Result<CheckedRequest> {
    let url = Url::parse(&req.url).map_err(|_| Error::Invalid(format!("'{}' is not an absolute URL", req.url)))?;
    if !url_allowed(granted, &url, local_api_port) {
        let host = url.host_str().unwrap_or("");
        return Err(Error::Denied(format!(
            "the extension may not connect to {}://{host}",
            url.scheme()
        )));
    }
    let method = req.method.as_deref().unwrap_or("GET").to_ascii_uppercase();
    if !METHODS.contains(&method.as_str()) {
        return Err(Error::Invalid(format!("method '{method}' is not allowed")));
    }
    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|_| Error::Invalid(format!("method '{method}' is not allowed")))?;
    if req.body.as_ref().is_some_and(|b| b.len() > MAX_REQUEST_BYTES) {
        return Err(Error::TooLarge(format!(
            "the request body is larger than {MAX_REQUEST_BYTES} bytes"
        )));
    }
    let mut headers = Vec::with_capacity(req.headers.len());
    for (name, value) in &req.headers {
        let lower = name.to_ascii_lowercase();
        if COOKIE_HEADERS.contains(&lower.as_str()) {
            continue;
        }
        if TRANSPORT_HEADERS.contains(&lower.as_str())
            || lower.starts_with("proxy-")
            || lower.starts_with("sec-")
        {
            return Err(Error::Invalid(format!("header '{name}' cannot be set")));
        }
        if reqwest::header::HeaderName::from_bytes(name.as_bytes()).is_err()
            || reqwest::header::HeaderValue::from_str(value).is_err()
        {
            return Err(Error::Invalid(format!("header '{name}' is malformed")));
        }
        headers.push((lower, value.clone()));
    }
    Ok(CheckedRequest {
        url,
        method,
        headers,
    })
}

fn response_headers(response: &reqwest::Response) -> BTreeMap<String, String> {
    let mut out: BTreeMap<String, String> = BTreeMap::new();
    for (name, value) in response.headers() {
        let name = name.as_str().to_ascii_lowercase();
        if COOKIE_HEADERS.contains(&name.as_str()) {
            continue;
        }
        let value = String::from_utf8_lossy(value.as_bytes()).into_owned();
        out.entry(name)
            .and_modify(|v| {
                v.push_str(", ");
                v.push_str(&value);
            })
            .or_insert(value);
    }
    out
}

/// Removes the request from the in-flight map when dropped, unless the key
/// already belongs to a later request: `cancel` only signals, but a caller
/// may still re-use a request id once its request has finished.
struct InFlight<'a> {
    state: &'a ExtensionsState,
    key: String,
    token: u64,
}

impl Drop for InFlight<'_> {
    fn drop(&mut self) {
        let mut requests = lock(&self.state.requests);
        if requests.get(&self.key).is_some_and(|r| r.token == self.token) {
            requests.remove(&self.key);
        }
    }
}

fn register<'a>(
    state: &'a ExtensionsState,
    id: &str,
    request_id: &str,
) -> Result<(InFlight<'a>, oneshot::Receiver<()>)> {
    if request_id.is_empty() || request_id.len() > 64 {
        return Err(Error::Invalid("the request id must be 1-64 characters".into()));
    }
    let key = format!("{id}\n{request_id}");
    let prefix = format!("{id}\n");
    let mut requests = lock(&state.requests);
    if requests.contains_key(&key) {
        return Err(Error::Invalid(format!("request '{request_id}' is already running")));
    }
    if requests.keys().filter(|k| k.starts_with(&prefix)).count() >= MAX_IN_FLIGHT_PER_EXTENSION {
        return Err(Error::Denied(format!(
            "an extension may run at most {MAX_IN_FLIGHT_PER_EXTENSION} requests at once"
        )));
    }
    let (tx, rx) = oneshot::channel();
    let token = state.next_request_token();
    requests.insert(
        key.clone(),
        Running {
            token,
            cancel: Some(tx),
        },
    );
    Ok((InFlight { state, key, token }, rx))
}

/// Cancels a running request of `id`. Unknown ids are ignored: the request
/// may just have finished. The entry stays until the request's future is
/// dropped, so it keeps counting towards the in-flight cap until it has
/// actually stopped.
pub fn cancel(state: &ExtensionsState, id: &str, request_id: &str) {
    let mut requests = lock(&state.requests);
    if let Some(tx) = requests
        .get_mut(&format!("{id}\n{request_id}"))
        .and_then(|r| r.cancel.take())
    {
        let _ = tx.send(());
    }
}

async fn send(
    state: &ExtensionsState,
    id: &str,
    req: &HttpRequest,
) -> Result<reqwest::Response> {
    let granted = network_grants(state, id)?;
    let checked = check_request(&granted, req, state.local_api_port())?;
    let mut builder = state.http.request(checked.method, checked.url);
    for (name, value) in checked.headers {
        builder = builder.header(name, value);
    }
    if let Some(body) = &req.body {
        builder = builder.body(body.clone());
    }
    builder
        .send()
        .await
        .map_err(|e| Error::Network(format!("the request failed: {e}")))
}

/// Fetches `req` for extension `id` and returns the whole response, with
/// the body capped at [`MAX_RESPONSE_BYTES`]. `request_id` lets [`cancel`]
/// abort it.
pub async fn http_fetch(
    state: &ExtensionsState,
    id: &str,
    request_id: &str,
    req: &HttpRequest,
) -> Result<HttpResponse> {
    let (_in_flight, mut cancelled) = register(state, id, request_id)?;
    let work = async {
        let mut response = send(state, id, req).await?;
        let status = response.status().as_u16();
        let headers = response_headers(&response);
        let mut body: Vec<u8> = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| Error::Network(format!("reading the response failed: {e}")))?
        {
            if body.len() + chunk.len() > MAX_RESPONSE_BYTES {
                return Err(Error::TooLarge(format!(
                    "the response is larger than {MAX_RESPONSE_BYTES} bytes"
                )));
            }
            body.extend_from_slice(&chunk);
        }
        Ok(HttpResponse {
            status,
            headers,
            body: String::from_utf8_lossy(&body).into_owned(),
        })
    };
    tokio::select! {
        result = tokio::time::timeout(FETCH_TIMEOUT, work) => {
            result.map_err(|_| Error::Network("the request timed out".into()))?
        }
        _ = &mut cancelled => Err(Error::Cancelled),
    }
}

/// Splits `buf` at the last complete UTF-8 character and returns the text
/// before it, leaving an incomplete trailing sequence in `buf`.
fn take_utf8(buf: &mut Vec<u8>) -> String {
    let cut = match std::str::from_utf8(buf) {
        Ok(_) => buf.len(),
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        // An invalid sequence: decode lossily up to the end.
        Err(_) => buf.len(),
    };
    let rest = buf.split_off(cut);
    let text = String::from_utf8_lossy(buf).into_owned();
    *buf = rest;
    text
}

/// Fetches `req` for extension `id` and delivers the response through
/// `emit` as a `head` event, `chunk` events and a final `end` or `error`.
/// The returned value is the head's status. Errors before the head (grant,
/// validation, connection) are returned and nothing is emitted; errors
/// after it are emitted as `error`. `emit` returning false (the receiver is
/// gone) stops the stream.
pub async fn http_fetch_stream<F>(
    state: &ExtensionsState,
    id: &str,
    request_id: &str,
    req: &HttpRequest,
    mut emit: F,
) -> Result<u16>
where
    F: FnMut(HttpStreamEvent) -> bool,
{
    let (_in_flight, mut cancelled) = register(state, id, request_id)?;
    let head = tokio::select! {
        result = tokio::time::timeout(STREAM_IDLE_TIMEOUT, send(state, id, req)) => {
            result.map_err(|_| Error::Network("the request timed out".into()))??
        }
        _ = &mut cancelled => return Err(Error::Cancelled),
    };
    let mut response = head;
    let status = response.status().as_u16();
    if !emit(HttpStreamEvent::Head {
        status,
        headers: response_headers(&response),
    }) {
        return Ok(status);
    }
    let mut total = 0usize;
    let mut pending: Vec<u8> = Vec::new();
    let failure = loop {
        let next = tokio::select! {
            result = tokio::time::timeout(STREAM_IDLE_TIMEOUT, response.chunk()) => result,
            _ = &mut cancelled => break Some(Error::Cancelled),
        };
        let chunk = match next {
            Err(_) => break Some(Error::Network("the stream stalled".into())),
            Ok(Err(e)) => break Some(Error::Network(format!("reading the response failed: {e}"))),
            Ok(Ok(None)) => break None,
            Ok(Ok(Some(chunk))) => chunk,
        };
        total += chunk.len();
        if total > MAX_STREAM_BYTES {
            break Some(Error::TooLarge(format!(
                "the response is larger than {MAX_STREAM_BYTES} bytes"
            )));
        }
        pending.extend_from_slice(&chunk);
        let data = take_utf8(&mut pending);
        if !data.is_empty() && !emit(HttpStreamEvent::Chunk { data }) {
            return Ok(status);
        }
    };
    match failure {
        None => {
            if !pending.is_empty() {
                let data = String::from_utf8_lossy(&pending).into_owned();
                if !emit(HttpStreamEvent::Chunk { data }) {
                    return Ok(status);
                }
            }
            emit(HttpStreamEvent::End);
        }
        Some(e) => {
            emit(HttpStreamEvent::Error {
                kind: e.kind().to_string(),
                message: e.to_string(),
            });
        }
    }
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grants(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    fn req(url: &str) -> HttpRequest {
        HttpRequest {
            url: url.into(),
            ..HttpRequest::default()
        }
    }

    #[test]
    fn refuses_ungranted_and_insecure_urls() {
        let g = grants(&["network:api.example.com", "network:127.0.0.1"]);
        assert!(check_request(&g, &req("https://api.example.com/x"), None).is_ok());
        for url in [
            "https://other.example.com/",
            "http://api.example.com/",
            "http://127.0.0.1:1337/v1/models",
            "https://user:pw@api.example.com/",
            "file:///etc/passwd",
            "not a url",
        ] {
            let err = check_request(&g, &req(url), Some(1337)).unwrap_err();
            assert!(matches!(err, Error::Denied(_) | Error::Invalid(_)), "{url}: {err}");
        }
    }

    #[test]
    fn refuses_transport_headers_and_drops_cookies() {
        let g = grants(&["network:*"]);
        let mut r = req("https://a.example.com/");
        r.headers.insert("Cookie".into(), "a=b".into());
        r.headers.insert("Authorization".into(), "Bearer x".into());
        let headers = check_request(&g, &r, None).unwrap().headers;
        assert_eq!(headers, vec![("authorization".to_string(), "Bearer x".to_string())]);
        for name in ["Host", "Content-Length", "Transfer-Encoding", "Proxy-Authorization", "Sec-Fetch-Site"] {
            let mut r = req("https://a.example.com/");
            r.headers.insert(name.into(), "x".into());
            assert!(check_request(&g, &r, None).is_err(), "{name}");
        }
        let mut r = req("https://a.example.com/");
        r.headers.insert("X-Bad".into(), "a\nb".into());
        assert!(check_request(&g, &r, None).is_err());
    }

    #[test]
    fn refuses_unknown_methods_and_large_bodies() {
        let g = grants(&["network:*"]);
        let mut r = req("https://a.example.com/");
        r.method = Some("CONNECT".into());
        assert!(check_request(&g, &r, None).is_err());
        r.method = Some("post".into());
        assert!(check_request(&g, &r, None).is_ok());
        r.body = Some("x".repeat(MAX_REQUEST_BYTES + 1));
        assert!(matches!(check_request(&g, &r, None), Err(Error::TooLarge(_))));
    }

    fn in_flight(state: &ExtensionsState, id: &str) -> usize {
        let prefix = format!("{id}\n");
        lock(&state.requests).keys().filter(|k| k.starts_with(&prefix)).count()
    }

    #[test]
    fn a_cancelled_request_does_not_drop_its_successor() {
        let root = tempfile::tempdir().unwrap();
        let options = crate::state::Options {
            app_version: "0.8.5".into(),
            safe_mode_forced: false,
        };
        let state = ExtensionsState::new(root.path(), options).unwrap();
        let id = "acme.hello";
        // A worker re-using one request id: cancel, then register it again
        // before and after the cancelled future is dropped.
        for _ in 0..MAX_IN_FLIGHT_PER_EXTENSION * 2 {
            let (first, mut first_rx) = register(&state, id, "same").unwrap();
            cancel(&state, id, "same");
            assert!(first_rx.try_recv().is_ok());
            // Still counted, and still owning its id, until it is dropped.
            assert_eq!(in_flight(&state, id), 1);
            assert!(matches!(register(&state, id, "same"), Err(Error::Invalid(_))));
            cancel(&state, id, "same");
            drop(first);
            assert_eq!(in_flight(&state, id), 0);
            let (second, mut rx) = register(&state, id, "same").unwrap();
            assert_eq!(in_flight(&state, id), 1);
            cancel(&state, id, "same");
            assert!(rx.try_recv().is_ok());
            drop(second);
        }
        assert_eq!(in_flight(&state, id), 0);

        // A guard whose key was taken over by a later request leaves it.
        let (stale, _rx) = register(&state, id, "k").unwrap();
        lock(&state.requests).remove(&format!("{id}\nk"));
        let (live, _live_rx) = register(&state, id, "k").unwrap();
        drop(stale);
        assert_eq!(in_flight(&state, id), 1);
        drop(live);
        assert_eq!(in_flight(&state, id), 0);

        let guards: Vec<_> = (0..MAX_IN_FLIGHT_PER_EXTENSION)
            .map(|i| register(&state, id, &format!("r{i}")).unwrap())
            .collect();
        assert!(matches!(register(&state, id, "one-more"), Err(Error::Denied(_))));
        drop(guards);
    }

    #[test]
    fn splits_chunks_on_character_boundaries() {
        let text = "a\u{e9}\u{1f600}";
        let bytes = text.as_bytes();
        let mut buf = bytes[..3].to_vec();
        assert_eq!(take_utf8(&mut buf), "a\u{e9}");
        assert_eq!(buf, Vec::<u8>::new());
        let mut buf = bytes[..5].to_vec();
        assert_eq!(take_utf8(&mut buf), "a\u{e9}");
        assert_eq!(buf, bytes[3..5].to_vec());
        buf.extend_from_slice(&bytes[5..]);
        assert_eq!(take_utf8(&mut buf), "\u{1f600}");
    }
}
