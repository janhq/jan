//! The Streamable HTTP transport for [`JanToolServer`], bound to loopback
//! behind a bearer token.
//!
//! This is the same transport `core::mcp::helpers` connects *out* to, so a peer
//! that can talk to a remote MCP server can talk to this one. rmcp 3.x dropped
//! the HTTP+SSE client transport, so there is deliberately no SSE server here
//! either.
//!
//! Loopback plus a token, not one or the other: loopback keeps the listener off
//! the network, and the token keeps any other local process -- including a web
//! page's fetch from the user's browser -- from driving the agent's tools.

use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;

use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use rmcp::transport::streamable_http_server::session::local::LocalSessionManager;
use rmcp::transport::{StreamableHttpServerConfig, StreamableHttpService};

use super::{JanToolServer, ServeOptions};

/// A bound Streamable HTTP server: where it listens, and the token a caller
/// must present.
#[derive(Debug, Clone)]
pub struct BoundServer {
    pub addr: SocketAddr,
    pub token: String,
}

impl BoundServer {
    /// The URL an MCP client should be pointed at.
    pub fn url(&self) -> String {
        format!("http://{}/mcp", self.addr)
    }
}

/// A fresh random bearer token, hex-encoded 256 bits.
pub fn generate_token() -> String {
    use rand::Rng;
    let bytes: [u8; 32] = rand::thread_rng().gen();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Whether the request presents `token` as an RFC 6750 bearer credential.
///
/// Compared in constant time over the whole candidate: a short-circuiting
/// compare on a token a local attacker can retry at will is a timing oracle.
pub fn authorized(headers: &hyper::HeaderMap, token: &str) -> bool {
    let Some(value) = headers.get(hyper::header::AUTHORIZATION) else {
        return false;
    };
    let Ok(value) = value.to_str() else {
        return false;
    };
    // RFC 7235: the auth-scheme is case-insensitive. Only the scheme -- the
    // credential keeps its constant-time byte compare below.
    let (scheme, presented) = match value.split_once(' ') {
        Some(parts) => parts,
        None => return false,
    };
    if !scheme.eq_ignore_ascii_case("bearer") {
        return false;
    }
    constant_time_eq(presented.as_bytes(), token.as_bytes())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn unauthorized() -> Response<http_body_util::combinators::BoxBody<Bytes, Infallible>> {
    let mut response = Response::new(
        Full::new(Bytes::from_static(b"unauthorized"))
            .map_err(|e: Infallible| match e {})
            .boxed(),
    );
    *response.status_mut() = StatusCode::UNAUTHORIZED;
    response.headers_mut().insert(
        hyper::header::WWW_AUTHENTICATE,
        hyper::header::HeaderValue::from_static("Bearer"),
    );
    response
}

/// Bind a loopback Streamable HTTP server and serve the built-in toolset on it
/// until the process ends.
///
/// `port` 0 picks a free one; the chosen address comes back in [`BoundServer`].
/// The returned future must be polled (spawn it, or await it) for the server to
/// accept anything -- binding is done eagerly so the caller can print the URL
/// and the token before a single connection arrives.
pub async fn bind(
    opts: ServeOptions,
    port: u16,
    token: Option<String>,
) -> Result<(BoundServer, impl std::future::Future<Output = ()>), String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("failed to bind {addr}: {e}"))?;
    let addr = listener
        .local_addr()
        .map_err(|e| format!("failed to read the bound address: {e}"))?;
    let token = token.unwrap_or_else(generate_token);
    let bound = BoundServer {
        addr,
        token: token.clone(),
    };

    // One handler per session; the options are shared, so the factory is a
    // clone rather than a rebuild.
    let server = JanToolServer::new(opts);
    let service = Arc::new(StreamableHttpService::new(
        move || Ok(server.clone()),
        Arc::new(LocalSessionManager::default()),
        StreamableHttpServerConfig::default(),
    ));
    let token = Arc::new(token);

    let serve = async move {
        loop {
            let (stream, _) = match listener.accept().await {
                Ok(c) => c,
                Err(e) => {
                    log::error!("MCP server accept error: {e}");
                    continue;
                }
            };
            let io = TokioIo::new(stream);
            let service = service.clone();
            let token = token.clone();
            tokio::spawn(async move {
                let handler = service_fn(move |req: Request<hyper::body::Incoming>| {
                    let service = service.clone();
                    let token = token.clone();
                    async move {
                        if !authorized(req.headers(), &token) {
                            return Ok::<_, Infallible>(unauthorized());
                        }
                        Ok(service.handle(req).await)
                    }
                });
                if let Err(e) = http1::Builder::new().serve_connection(io, handler).await {
                    log::debug!("MCP server connection error: {e}");
                }
            });
        }
    };
    Ok((bound, serve))
}
