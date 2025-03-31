use hyper::service::{make_service_fn, service_fn};
use hyper::{Body, Request, Response, Server, StatusCode};
use reqwest::Client;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::LazyLock;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use tracing::{debug, error, info};

/// Server handle type for managing the proxy server lifecycle
type ServerHandle = JoinHandle<Result<(), Box<dyn std::error::Error + Send + Sync>>>;

/// Global singleton for the current server instance
static SERVER_HANDLE: LazyLock<Mutex<Option<ServerHandle>>> = LazyLock::new(|| Mutex::new(None));

/// Configuration for the proxy server
#[derive(Clone)]
struct ProxyConfig {
    upstream: String,
    prefix: String,
    auth_token: String,
}

/// Removes a prefix from a path, ensuring proper formatting
fn remove_prefix(path: &str, prefix: &str) -> String {
    debug!("Processing path: {}, removing prefix: {}", path, prefix);

    if !prefix.is_empty() && path.starts_with(prefix) {
        let result = path[prefix.len()..].to_string();
        if result.is_empty() {
            "/".to_string()
        } else {
            result
        }
    } else {
        path.to_string()
    }
}

/// Determines the final destination path based on the original request path
fn get_destination_path(original_path: &str, prefix: &str) -> String {
    let removed_prefix_path = remove_prefix(original_path, prefix);

    println!("Removed prefix path: {}", removed_prefix_path);
    // Special paths don't need the /v1 prefix
    if !original_path.contains(prefix)
        || removed_prefix_path.contains("/healthz")
        || removed_prefix_path.contains("/process")
    {
        original_path.to_string()
    } else {
        format!("/v1{}", removed_prefix_path)
    }
}

/// Creates the full upstream URL for the proxied request
fn build_upstream_url(upstream: &str, path: &str) -> String {
    let upstream_clean = upstream.trim_end_matches('/');
    let path_clean = path.trim_start_matches('/');

    format!("{}/{}", upstream_clean, path_clean)
}

/// Handles the proxy request logic
async fn proxy_request(
    req: Request<Body>,
    client: Client,
    config: ProxyConfig,
) -> Result<Response<Body>, hyper::Error> {
    let original_path = req.uri().path();
    let path = get_destination_path(original_path, &config.prefix);

    // Block access to /configs endpoint
    if path.contains("/configs") {
        return Ok(Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Not Found"))
            .unwrap());
    }

    // Build the outbound request
    let upstream_url = build_upstream_url(&config.upstream, &path);
    debug!("Proxying request to: {}", upstream_url);

    let mut outbound_req = client.request(req.method().clone(), &upstream_url);

    // Copy original headers
    for (name, value) in req.headers() {
        if name != hyper::header::HOST {
            // Skip host header
            outbound_req = outbound_req.header(name, value);
        }
    }

    // Add authorization header
    outbound_req = outbound_req.header("Authorization", format!("Bearer {}", config.auth_token));

    // Send the request and handle the response
    match outbound_req.body(req.into_body()).send().await {
        Ok(response) => {
            let status = response.status();
            debug!("Received response with status: {}", status);

            let mut builder = Response::builder().status(status);

            // Copy response headers
            for (name, value) in response.headers() {
                builder = builder.header(name, value);
            }

            // Read response body
            match response.bytes().await {
                Ok(bytes) => Ok(builder.body(Body::from(bytes)).unwrap()),
                Err(e) => {
                    error!("Failed to read response body: {}", e);
                    Ok(Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .body(Body::from("Error reading upstream response"))
                        .unwrap())
                }
            }
        }
        Err(e) => {
            error!("Proxy request failed: {}", e);
            Ok(Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Body::from(format!("Upstream error: {}", e)))
                .unwrap())
        }
    }
}

/// Starts the proxy server
pub async fn start_server(
    host: String,
    port: u16,
    prefix: String,
    auth_token: String,
) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    // Check if server is already running
    let mut handle_guard = SERVER_HANDLE.lock().await;
    if handle_guard.is_some() {
        return Err("Server is already running".into());
    }

    // Create server address
    let addr: SocketAddr = format!("{}:{}", host, port)
        .parse()
        .map_err(|e| format!("Invalid address: {}", e))?;

    // Configure proxy settings
    let config = ProxyConfig {
        upstream: "http://127.0.0.1:39291".to_string(),
        prefix,
        auth_token,
    };

    // Create HTTP client
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    // Create service handler
    let make_svc = make_service_fn(move |_conn| {
        let client = client.clone();
        let config = config.clone();

        async move {
            Ok::<_, Infallible>(service_fn(move |req| {
                proxy_request(req, client.clone(), config.clone())
            }))
        }
    });

    // Create and start the server
    let server = Server::bind(&addr).serve(make_svc);
    info!("Proxy server started on http://{}", addr);

    // Spawn server task
    let server_handle = tokio::spawn(async move {
        if let Err(e) = server.await {
            error!("Server error: {}", e);
            return Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>);
        }
        Ok(())
    });

    *handle_guard = Some(server_handle);
    Ok(true)
}

/// Stops the currently running proxy server
pub async fn stop_server() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut handle_guard = SERVER_HANDLE.lock().await;

    if let Some(handle) = handle_guard.take() {
        handle.abort();
        info!("Proxy server stopped");
    } else {
        debug!("No server was running");
    }

    Ok(())
}
