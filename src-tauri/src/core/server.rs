use hyper::service::{make_service_fn, service_fn};
use hyper::{Body, Request, Response, Server, StatusCode};
use reqwest::Client;
use serde_json::Value;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::LazyLock;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;
use flate2::read::GzDecoder;
use std::io::Read;

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
    trusted_hosts: Vec<String>,
    api_key: String,
}

/// Removes a prefix from a path, ensuring proper formatting
fn remove_prefix(path: &str, prefix: &str) -> String {
    log::debug!("Processing path: {}, removing prefix: {}", path, prefix);

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
    // Handle OPTIONS requests for CORS preflight
    log::debug!(
        "Received request: {} {} {:?} {:?} {:?}",
        req.method(),
        req.uri().path(),
        req.headers().get(hyper::header::HOST),
        req.headers().get(hyper::header::ORIGIN),
        req.headers()
            .get(hyper::header::ACCESS_CONTROL_REQUEST_METHOD)
    );
    if req.method() == hyper::Method::OPTIONS {
        log::debug!(
            "Handling CORS preflight request from {:?} {:?}",
            req.headers().get(hyper::header::HOST),
            req.headers()
                .get(hyper::header::ACCESS_CONTROL_REQUEST_METHOD)
        );

        // Get the Host header to validate the target (where request is going)
        let host = req
            .headers()
            .get(hyper::header::HOST)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        // Get the Origin header for CORS response
        let origin = req
            .headers()
            .get(hyper::header::ORIGIN)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        // Validate requested method
        let requested_method = req
            .headers()
            .get("Access-Control-Request-Method")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        let allowed_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"];
        let method_allowed = requested_method.is_empty()
            || allowed_methods
                .iter()
                .any(|&method| method.eq_ignore_ascii_case(requested_method));

        if !method_allowed {
            log::warn!("CORS preflight: Method '{}' not allowed", requested_method);
            return Ok(Response::builder()
                .status(StatusCode::METHOD_NOT_ALLOWED)
                .body(Body::from("Method not allowed"))
                .unwrap());
        }

        // Check if the host (target) is trusted, but bypass for whitelisted paths
        let request_path = req.uri().path();
        let whitelisted_paths = ["/", "/openapi.json", "/favicon.ico"];
        let is_whitelisted_path = whitelisted_paths.contains(&request_path);

        let is_trusted = if is_whitelisted_path {
            log::debug!(
                "CORS preflight: Bypassing host check for whitelisted path: {}",
                request_path
            );
            true
        } else if !host.is_empty() {
            log::debug!(
                "CORS preflight: Host is '{}', trusted hosts: [{}]",
                host,
                &config.trusted_hosts.join(", ")
            );
            is_valid_host(host, &config.trusted_hosts)
        } else {
            log::warn!("CORS preflight: No Host header present");
            false
        };

        if !is_trusted {
            log::warn!(
                "CORS preflight: Host '{}' not trusted for path '{}'",
                host,
                request_path
            );
            return Ok(Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Body::from("Host not allowed"))
                .unwrap());
        }

        // Get and validate requested headers
        let requested_headers = req
            .headers()
            .get("Access-Control-Request-Headers")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        // Allow common headers plus our required ones
        let allowed_headers = [
            "accept",
            "accept-language",
            "authorization",
            "cache-control",
            "connection",
            "content-type",
            "dnt",
            "host",
            "if-modified-since",
            "keep-alive",
            "origin",
            "user-agent",
            "x-api-key",
            "x-csrf-token",
            "x-forwarded-for",
            "x-forwarded-host",
            "x-forwarded-proto",
            "x-requested-with",
            "x-stainless-arch",
            "x-stainless-lang",
            "x-stainless-os",
            "x-stainless-package-version",
            "x-stainless-retry-count",
            "x-stainless-runtime",
            "x-stainless-runtime-version",
            "x-stainless-timeout",
        ];

        let headers_valid = if requested_headers.is_empty() {
            true
        } else {
            requested_headers
                .split(',')
                .map(|h| h.trim())
                .all(|header| {
                    allowed_headers
                        .iter()
                        .any(|&allowed| allowed.eq_ignore_ascii_case(header))
                })
        };

        if !headers_valid {
            log::warn!(
                "CORS preflight: Some requested headers not allowed: {}",
                requested_headers
            );
            return Ok(Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Body::from("Headers not allowed"))
                .unwrap());
        }

        // Build CORS response
        let mut response = Response::builder()
            .status(StatusCode::OK)
            .header("Access-Control-Allow-Methods", allowed_methods.join(", "))
            .header("Access-Control-Allow-Headers", allowed_headers.join(", "))
            .header("Access-Control-Max-Age", "86400")
            .header(
                "Vary",
                "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
            );

        // Set Access-Control-Allow-Origin based on origin presence
        if !origin.is_empty() {
            response = response
                .header("Access-Control-Allow-Origin", origin)
                .header("Access-Control-Allow-Credentials", "true");
        } else {
            // No origin header - allow all origins (useful for non-browser clients)
            response = response.header("Access-Control-Allow-Origin", "*");
        }

        log::debug!(
            "CORS preflight response: host_trusted={}, origin='{}'",
            is_trusted,
            origin
        );
        return Ok(response.body(Body::empty()).unwrap());
    }

    // Extract headers early for validation and CORS responses
    let origin_header = req
        .headers()
        .get(hyper::header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let host_header = req
        .headers()
        .get(hyper::header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let original_path = req.uri().path();
    let path = get_destination_path(original_path, &config.prefix);
    let method = req.method().clone();

    // Verify Host header (check target), but bypass for whitelisted paths
    let whitelisted_paths = ["/", "/openapi.json", "/favicon.ico"];
    let is_whitelisted_path = whitelisted_paths.contains(&path.as_str());
    
    if !is_whitelisted_path {
        if !host_header.is_empty() {
            if !is_valid_host(&host_header, &config.trusted_hosts) {
                let mut error_response = Response::builder().status(StatusCode::FORBIDDEN);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response
                    .body(Body::from("Invalid host header"))
                    .unwrap());
            }
        } else {
            let mut error_response = Response::builder().status(StatusCode::BAD_REQUEST);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );
            return Ok(error_response
                .body(Body::from("Missing host header"))
                .unwrap());
        }
    } else {
        log::debug!("Bypassing host validation for whitelisted path: {}", path);
    }

    // Skip authorization check for whitelisted paths
    if !is_whitelisted_path && !config.api_key.is_empty() {
        if let Some(authorization) = req.headers().get(hyper::header::AUTHORIZATION) {
            let auth_str = authorization.to_str().unwrap_or("");

            if auth_str.strip_prefix("Bearer ") != Some(config.api_key.as_str()) {
                let mut error_response = Response::builder().status(StatusCode::UNAUTHORIZED);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response
                    .body(Body::from("Invalid or missing authorization token"))
                    .unwrap());
            }
        } else {
            let mut error_response = Response::builder().status(StatusCode::UNAUTHORIZED);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );
            return Ok(error_response
                .body(Body::from("Missing authorization header"))
                .unwrap());
        }
    } else if is_whitelisted_path {
        log::debug!("Bypassing authorization check for whitelisted path: {}", path);
    }

    // Block access to /configs endpoint
    if path.contains("/configs") {
        let mut error_response = Response::builder().status(StatusCode::NOT_FOUND);
        error_response = add_cors_headers_with_host_and_origin(
            error_response,
            &host_header,
            &origin_header,
            &config.trusted_hosts,
        );
        return Ok(error_response.body(Body::from("Not Found")).unwrap());
    }

    // Build the outbound request
    let upstream_url = build_upstream_url(&config.upstream, &path);
    log::debug!("Proxying request to: {}", upstream_url);

    let mut outbound_req = client.request(req.method().clone(), &upstream_url);

    // Copy original headers
    for (name, value) in req.headers() {
        // Skip host & authorization header
        if name != hyper::header::HOST && name != hyper::header::AUTHORIZATION {
            outbound_req = outbound_req.header(name, value);
        }
    }

    // Add authorization header
    outbound_req = outbound_req.header("Authorization", format!("Bearer {}", config.auth_token));

    // Send the request and handle the response
    match outbound_req.body(req.into_body()).send().await {
        Ok(response) => {
            let status = response.status();
            log::debug!("Received response with status: {}", status);

            let mut builder = Response::builder().status(status);

            // Copy response headers, excluding CORS headers and Content-Length to avoid conflicts
            for (name, value) in response.headers() {
                // Skip CORS headers from upstream to avoid duplicates
                // Skip Content-Length header when filtering models response to avoid mismatch
                if !is_cors_header(name.as_str()) && name != hyper::header::CONTENT_LENGTH {
                    builder = builder.header(name, value);
                }
            }

            // Add our own CORS headers
            builder = add_cors_headers_with_host_and_origin(
                builder,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );

            // Read response body
            match response.bytes().await {
                Ok(bytes) => {
                    // Check if this is a /models endpoint request and filter the response
                    if path.contains("/models") && method == hyper::Method::GET {
                        match filter_models_response(&bytes) {
                            Ok(filtered_bytes) => Ok(builder.body(Body::from(filtered_bytes)).unwrap()),
                            Err(e) => {
                                log::warn!("Failed to filter models response: {}, returning original", e);
                                Ok(builder.body(Body::from(bytes)).unwrap())
                            }
                        }
                    } else {
                        Ok(builder.body(Body::from(bytes)).unwrap())
                    }
                },
                Err(e) => {
                    log::error!("Failed to read response body: {}", e);
                    let mut error_response =
                        Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    Ok(error_response
                        .body(Body::from("Error reading upstream response"))
                        .unwrap())
                }
            }
        }
        Err(e) => {
            log::error!("Proxy request failed: {}", e);
            let mut error_response = Response::builder().status(StatusCode::BAD_GATEWAY);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );
            Ok(error_response
                .body(Body::from(format!("Upstream error: {}", e)))
                .unwrap())
        }
    }
}

/// Checks if the byte array starts with gzip magic number
fn is_gzip_encoded(bytes: &[u8]) -> bool {
    bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b
}

/// Decompresses gzip-encoded bytes
fn decompress_gzip(bytes: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let mut decoder = GzDecoder::new(bytes);
    let mut decompressed = Vec::new();
    decoder.read_to_end(&mut decompressed)?;
    Ok(decompressed)
}

/// Compresses bytes using gzip
fn compress_gzip(bytes: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;
    
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(bytes)?;
    let compressed = encoder.finish()?;
    Ok(compressed)
}

/// Filters models response to keep only models with status "downloaded"
fn filter_models_response(bytes: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    // Try to decompress if it's gzip-encoded
    let decompressed_bytes = if is_gzip_encoded(bytes) {
        log::debug!("Response is gzip-encoded, decompressing...");
        decompress_gzip(bytes)?
    } else {
        bytes.to_vec()
    };
    
    let response_text = std::str::from_utf8(&decompressed_bytes)?;
    let mut response_json: Value = serde_json::from_str(response_text)?;
    
    // Check if this is a ListModelsResponseDto format with data array
    if let Some(data_array) = response_json.get_mut("data") {
        if let Some(models) = data_array.as_array_mut() {
            // Keep only models where status == "downloaded"
            models.retain(|model| {
                if let Some(status) = model.get("status") {
                    if let Some(status_str) = status.as_str() {
                        status_str == "downloaded"
                    } else {
                        false // Remove models without string status
                    }
                } else {
                    false // Remove models without status field
                }
            });
            log::debug!("Filtered models response: {} downloaded models remaining", models.len());
        }
    } else if response_json.is_array() {
        // Handle direct array format
        if let Some(models) = response_json.as_array_mut() {
            models.retain(|model| {
                if let Some(status) = model.get("status") {
                    if let Some(status_str) = status.as_str() {
                        status_str == "downloaded"
                    } else {
                        false // Remove models without string status
                    }
                } else {
                    false // Remove models without status field
                }
            });
            log::debug!("Filtered models response: {} downloaded models remaining", models.len());
        }
    }
    
    let filtered_json = serde_json::to_vec(&response_json)?;
    
    // If original was gzip-encoded, re-compress the filtered response
    if is_gzip_encoded(bytes) {
        log::debug!("Re-compressing filtered response with gzip");
        compress_gzip(&filtered_json)
    } else {
        Ok(filtered_json)
    }
}

/// Checks if a header is a CORS-related header that should be filtered out from upstream responses
fn is_cors_header(header_name: &str) -> bool {
    let header_lower = header_name.to_lowercase();
    header_lower.starts_with("access-control-")
}

/// Adds CORS headers to a response builder using host for validation and origin for response
fn add_cors_headers_with_host_and_origin(
    builder: hyper::http::response::Builder,
    host: &str,
    origin: &str,
    trusted_hosts: &[String],
) -> hyper::http::response::Builder {
    let mut builder = builder;

    // Check if host (target) is trusted - this is what we validate
    let is_trusted = if !host.is_empty() {
        is_valid_host(host, trusted_hosts)
    } else {
        false // Host is required for validation
    };

    // Set CORS headers using origin for the response
    if !origin.is_empty() && is_trusted {
        builder = builder
            .header("Access-Control-Allow-Origin", origin)
            .header("Access-Control-Allow-Credentials", "true");
    } else if !origin.is_empty() {
        builder = builder.header("Access-Control-Allow-Origin", origin);
    } else {
        builder = builder.header("Access-Control-Allow-Origin", "*");
    }

    builder = builder
        .header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
        .header("Access-Control-Allow-Headers", "Authorization, Content-Type, Host, Accept, Accept-Language, Cache-Control, Connection, DNT, If-Modified-Since, Keep-Alive, Origin, User-Agent, X-Requested-With, X-CSRF-Token, X-Forwarded-For, X-Forwarded-Proto, X-Forwarded-Host, authorization, content-type, x-api-key")
        .header("Vary", "Origin");

    builder
}

// Validates if the host header is allowed
fn is_valid_host(host: &str, trusted_hosts: &[String]) -> bool {
    if host.is_empty() {
        return false;
    }

    let host_without_port = if host.starts_with('[') {
        host.split(']')
            .next()
            .unwrap_or(host)
            .trim_start_matches('[')
    } else {
        host.split(':').next().unwrap_or(host)
    };
    let default_valid_hosts = ["localhost", "127.0.0.1", "0.0.0.0"];

    // Check default valid hosts (host part only)
    if default_valid_hosts
        .iter()
        .any(|&valid| host_without_port.to_lowercase() == valid.to_lowercase())
    {
        return true;
    }

    // Check trusted hosts - support both full host:port and host-only formats
    trusted_hosts.iter().any(|valid| {
        let host_lower = host.to_lowercase();
        let valid_lower = valid.to_lowercase();

        // First check exact match (including port)
        if host_lower == valid_lower {
            return true;
        }

        // Then check host part only (without port)
        let valid_without_port = if valid.starts_with('[') {
            valid
                .split(']')
                .next()
                .unwrap_or(valid)
                .trim_start_matches('[')
        } else {
            valid.split(':').next().unwrap_or(valid)
        };

        host_without_port.to_lowercase() == valid_without_port.to_lowercase()
    })
}

/// Starts the proxy server
pub async fn start_server(
    host: String,
    port: u16,
    prefix: String,
    auth_token: String,
    api_key: String,
    trusted_hosts: Vec<String>,
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
        api_key,
        trusted_hosts,
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
    log::info!("Proxy server started on http://{}", addr);

    // Spawn server task
    let server_handle = tokio::spawn(async move {
        if let Err(e) = server.await {
            log::error!("Server error: {}", e);
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
        log::info!("Proxy server stopped");
    } else {
        log::debug!("No server was running");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_filter_models_response_with_downloaded_status() {
        let test_response = json!({
            "object": "list",
            "data": [
                {
                    "id": "model1",
                    "name": "Model 1",
                    "status": "downloaded"
                },
                {
                    "id": "model2",
                    "name": "Model 2",
                    "status": "available"
                },
                {
                    "id": "model3",
                    "name": "Model 3"
                }
            ]
        });

        let response_bytes = serde_json::to_vec(&test_response).unwrap();
        let filtered_bytes = filter_models_response(&response_bytes).unwrap();
        let filtered_response: serde_json::Value = serde_json::from_slice(&filtered_bytes).unwrap();

        let data = filtered_response["data"].as_array().unwrap();
        assert_eq!(data.len(), 1); // Should have 1 model (only model1 with "downloaded" status)
        
        // Verify only model1 (with "downloaded" status) is kept
        assert!(data.iter().any(|model| model["id"] == "model1"));
        
        // Verify model2 and model3 are filtered out
        assert!(!data.iter().any(|model| model["id"] == "model2"));
        assert!(!data.iter().any(|model| model["id"] == "model3"));
    }

    #[test]
    fn test_filter_models_response_direct_array() {
        let test_response = json!([
            {
                "id": "model1",
                "name": "Model 1",
                "status": "downloaded"
            },
            {
                "id": "model2",
                "name": "Model 2",
                "status": "available"
            }
        ]);

        let response_bytes = serde_json::to_vec(&test_response).unwrap();
        let filtered_bytes = filter_models_response(&response_bytes).unwrap();
        let filtered_response: serde_json::Value = serde_json::from_slice(&filtered_bytes).unwrap();

        let data = filtered_response.as_array().unwrap();
        assert_eq!(data.len(), 1); // Should have 1 model (only model1 with "downloaded" status)
        assert!(data.iter().any(|model| model["id"] == "model1"));
        assert!(!data.iter().any(|model| model["id"] == "model2"));
    }

    #[test]
    fn test_filter_models_response_no_status_field() {
        let test_response = json!({
            "object": "list",
            "data": [
                {
                    "id": "model1",
                    "name": "Model 1"
                },
                {
                    "id": "model2",
                    "name": "Model 2"
                }
            ]
        });

        let response_bytes = serde_json::to_vec(&test_response).unwrap();
        let filtered_bytes = filter_models_response(&response_bytes).unwrap();
        let filtered_response: serde_json::Value = serde_json::from_slice(&filtered_bytes).unwrap();

        let data = filtered_response["data"].as_array().unwrap();
        assert_eq!(data.len(), 0); // Should remove all models when no status field (no "downloaded" status)
    }

    #[test]
    fn test_filter_models_response_multiple_downloaded() {
        let test_response = json!({
            "object": "list",
            "data": [
                {
                    "id": "model1",
                    "name": "Model 1",
                    "status": "downloaded"
                },
                {
                    "id": "model2",
                    "name": "Model 2",
                    "status": "available"
                },
                {
                    "id": "model3",
                    "name": "Model 3",
                    "status": "downloaded"
                },
                {
                    "id": "model4",
                    "name": "Model 4",
                    "status": "installing"
                }
            ]
        });

        let response_bytes = serde_json::to_vec(&test_response).unwrap();
        let filtered_bytes = filter_models_response(&response_bytes).unwrap();
        let filtered_response: serde_json::Value = serde_json::from_slice(&filtered_bytes).unwrap();

        let data = filtered_response["data"].as_array().unwrap();
        assert_eq!(data.len(), 2); // Should have 2 models (model1 and model3 with "downloaded" status)
        
        // Verify only models with "downloaded" status are kept
        assert!(data.iter().any(|model| model["id"] == "model1"));
        assert!(data.iter().any(|model| model["id"] == "model3"));
        
        // Verify other models are filtered out
        assert!(!data.iter().any(|model| model["id"] == "model2"));
        assert!(!data.iter().any(|model| model["id"] == "model4"));
    }
}
