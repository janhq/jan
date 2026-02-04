use futures_util::StreamExt;
use hyper::body::Bytes;
use hyper::service::{make_service_fn, service_fn};
use hyper::{Body, Request, Response, Server, StatusCode};
use jan_utils::{is_cors_header, is_valid_host, remove_prefix};
use reqwest::Client;
use serde_json;
use std::collections::HashMap;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use tauri_plugin_llamacpp::LLamaBackendSession;
use tokio::sync::Mutex;

use crate::core::state::ServerHandle;

/// Configuration for the proxy server
#[derive(Clone)]
<<<<<<< HEAD
struct ProxyConfig {
    prefix: String,
    proxy_api_key: String,
    trusted_hosts: Vec<Vec<String>>,
}

/// Determines the final destination path based on the original request path
fn get_destination_path(original_path: &str, prefix: &str) -> String {
=======
pub struct ProxyConfig {
    pub prefix: String,
    pub proxy_api_key: String,
    pub trusted_hosts: Vec<Vec<String>>,
    pub host: String,
    pub port: u16,
}

/// Determines the final destination path based on the original request path
pub fn get_destination_path(original_path: &str, prefix: &str) -> String {
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    remove_prefix(original_path, prefix)
}

/// Handles the proxy request logic
async fn proxy_request(
    req: Request<Body>,
    client: Client,
    config: ProxyConfig,
    sessions: Arc<Mutex<HashMap<i32, LLamaBackendSession>>>,
) -> Result<Response<Body>, hyper::Error> {
    if req.method() == hyper::Method::OPTIONS {
        log::debug!(
            "Handling CORS preflight request from {:?} {:?}",
            req.headers().get(hyper::header::HOST),
            req.headers()
                .get(hyper::header::ACCESS_CONTROL_REQUEST_METHOD)
        );

        let host = req
            .headers()
            .get(hyper::header::HOST)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        let origin = req
            .headers()
            .get(hyper::header::ORIGIN)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

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
            log::warn!("CORS preflight: Method '{requested_method}' not allowed");
            return Ok(Response::builder()
                .status(StatusCode::METHOD_NOT_ALLOWED)
                .body(Body::from("Method not allowed"))
                .unwrap());
        }

        let request_path = req.uri().path();
        let whitelisted_paths = ["/", "/openapi.json", "/favicon.ico"];
        let is_whitelisted_path = whitelisted_paths.contains(&request_path);

        let is_trusted = if is_whitelisted_path {
            log::debug!(
                "CORS preflight: Bypassing host check for whitelisted path: {request_path}"
            );
            true
        } else if !host.is_empty() {
            log::debug!(
                "CORS preflight: Host is '{host}', trusted hosts: {:?}",
                &config.trusted_hosts
            );
            is_valid_host(host, &config.trusted_hosts)
        } else {
            log::warn!("CORS preflight: No Host header present");
            false
        };

        if !is_trusted {
<<<<<<< HEAD
            log::warn!(
                "CORS preflight: Host '{host}' not trusted for path '{request_path}'"
            );
=======
            log::warn!("CORS preflight: Host '{host}' not trusted for path '{request_path}'");
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            return Ok(Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Body::from("Host not allowed"))
                .unwrap());
        }

        let requested_headers = req
            .headers()
            .get("Access-Control-Request-Headers")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

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
<<<<<<< HEAD
            log::warn!(
                "CORS preflight: Some requested headers not allowed: {requested_headers}"
            );
=======
            log::warn!("CORS preflight: Some requested headers not allowed: {requested_headers}");
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            return Ok(Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body(Body::from("Headers not allowed"))
                .unwrap());
        }

        let mut response = Response::builder()
            .status(StatusCode::OK)
            .header("Access-Control-Allow-Methods", allowed_methods.join(", "))
            .header("Access-Control-Allow-Headers", allowed_headers.join(", "))
            .header("Access-Control-Max-Age", "86400")
            .header(
                "Vary",
                "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
            );

        if !origin.is_empty() {
            response = response
                .header("Access-Control-Allow-Origin", origin)
                .header("Access-Control-Allow-Credentials", "true");
        } else {
            response = response.header("Access-Control-Allow-Origin", "*");
        }

<<<<<<< HEAD
        log::debug!(
            "CORS preflight response: host_trusted={is_trusted}, origin='{origin}'"
        );
=======
        log::debug!("CORS preflight response: host_trusted={is_trusted}, origin='{origin}'");
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        return Ok(response.body(Body::empty()).unwrap());
    }

    let (parts, body) = req.into_parts();

    let origin_header = parts
        .headers
        .get(hyper::header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let host_header = parts
        .headers
        .get(hyper::header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let original_path = parts.uri.path();
    let headers = parts.headers.clone();

    let path = get_destination_path(original_path, &config.prefix);
    let method = parts.method.clone();

    let whitelisted_paths = [
        "/",
        "/openapi.json",
        "/favicon.ico",
        "/docs/swagger-ui.css",
        "/docs/swagger-ui-bundle.js",
        "/docs/swagger-ui-standalone-preset.js",
    ];
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
        log::debug!("Bypassing host validation for whitelisted path: {path}");
    }

    if !is_whitelisted_path && !config.proxy_api_key.is_empty() {
<<<<<<< HEAD
        if let Some(authorization) = parts.headers.get(hyper::header::AUTHORIZATION) {
            let auth_str = authorization.to_str().unwrap_or("");

            if auth_str.strip_prefix("Bearer ") != Some(config.proxy_api_key.as_str()) {
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
=======
        // Check Authorization header (Bearer token)
        let auth_valid = parts
            .headers
            .get(hyper::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|auth_str| auth_str.strip_prefix("Bearer "))
            .map(|token| token == config.proxy_api_key)
            .unwrap_or(false);

        // Check X-Api-Key header
        let api_key_valid = parts
            .headers
            .get("X-Api-Key")
            .and_then(|v| v.to_str().ok())
            .map(|key| key == config.proxy_api_key)
            .unwrap_or(false);

        if !auth_valid && !api_key_valid {
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
            let mut error_response = Response::builder().status(StatusCode::UNAUTHORIZED);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );
            return Ok(error_response
<<<<<<< HEAD
                .body(Body::from("Missing authorization header"))
                .unwrap());
        }
    } else if is_whitelisted_path {
        log::debug!(
            "Bypassing authorization check for whitelisted path: {path}"
        );
=======
                .body(Body::from("Invalid or missing authorization token"))
                .unwrap());
        }
    } else if is_whitelisted_path {
        log::debug!("Bypassing authorization check for whitelisted path: {path}");
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    }

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

    let target_port: Option<i32>;
    let session_api_key: Option<String>;
    let buffered_body: Option<Bytes>;
    let original_path = parts.uri.path();
    let destination_path = get_destination_path(original_path, &config.prefix);

    match (method.clone(), destination_path.as_str()) {
        (hyper::Method::POST, "/chat/completions")
        | (hyper::Method::POST, "/completions")
<<<<<<< HEAD
        | (hyper::Method::POST, "/embeddings") => {
            log::debug!(
=======
        | (hyper::Method::POST, "/embeddings")
        | (hyper::Method::POST, "/messages")
        | (hyper::Method::POST, "/messages/count_tokens") => {
            log::info!(
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                "Handling POST request to {destination_path} requiring model lookup in body",
            );
            let body_bytes = match hyper::body::to_bytes(body).await {
                Ok(bytes) => bytes,
                Err(_) => {
                    let mut error_response =
                        Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(error_response
                        .body(Body::from("Failed to read request body"))
                        .unwrap());
                }
            };
            buffered_body = Some(body_bytes.clone());

            match serde_json::from_slice::<serde_json::Value>(&body_bytes) {
                Ok(json_body) => {
                    if let Some(model_id) = json_body.get("model").and_then(|v| v.as_str()) {
                        log::debug!("Extracted model_id: {model_id}");
                        let sessions_guard = sessions.lock().await;

                        if sessions_guard.is_empty() {
<<<<<<< HEAD
                            log::warn!(
                                "Request for model '{model_id}' but no models are running."
                            );
=======
                            log::warn!("Request for model '{model_id}' but no models are running.");
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                            let mut error_response =
                                Response::builder().status(StatusCode::SERVICE_UNAVAILABLE);
                            error_response = add_cors_headers_with_host_and_origin(
                                error_response,
                                &host_header,
                                &origin_header,
                                &config.trusted_hosts,
                            );
                            return Ok(error_response
                                .body(Body::from("No models are available"))
                                .unwrap());
                        }

                        if let Some(session) = sessions_guard
                            .values()
                            .find(|s| s.info.model_id == model_id)
                        {
                            target_port = Some(session.info.port);
                            session_api_key = Some(session.info.api_key.clone());
                            log::debug!("Found session for model_id {model_id}");
                        } else {
                            log::warn!("No running session found for model_id: {model_id}");
                            let mut error_response =
                                Response::builder().status(StatusCode::NOT_FOUND);
                            error_response = add_cors_headers_with_host_and_origin(
                                error_response,
                                &host_header,
                                &origin_header,
                                &config.trusted_hosts,
                            );
                            return Ok(error_response
                                .body(Body::from(format!(
                                    "No running session found for model '{model_id}'"
                                )))
                                .unwrap());
                        }
                    } else {
                        log::warn!(
                            "POST body for {destination_path} is missing 'model' field or it's not a string"
                        );
                        let mut error_response =
                            Response::builder().status(StatusCode::BAD_REQUEST);
                        error_response = add_cors_headers_with_host_and_origin(
                            error_response,
                            &host_header,
                            &origin_header,
                            &config.trusted_hosts,
                        );
                        return Ok(error_response
                            .body(Body::from("Request body must contain a 'model' field"))
                            .unwrap());
                    }
                }
                Err(e) => {
<<<<<<< HEAD
                    log::warn!(
                        "Failed to parse POST body for {destination_path} as JSON: {e}"
                    );
=======
                    log::warn!("Failed to parse POST body for {destination_path} as JSON: {e}");
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
                    let mut error_response = Response::builder().status(StatusCode::BAD_REQUEST);
                    error_response = add_cors_headers_with_host_and_origin(
                        error_response,
                        &host_header,
                        &origin_header,
                        &config.trusted_hosts,
                    );
                    return Ok(error_response
                        .body(Body::from("Invalid JSON body"))
                        .unwrap());
                }
            }
        }
        (hyper::Method::GET, "/models") => {
            log::debug!("Handling GET /v1/models request");
            let sessions_guard = sessions.lock().await;

            let models_data: Vec<_> = sessions_guard
                .values()
                .map(|session| {
                    serde_json::json!({
                        "id": session.info.model_id,
                        "object": "model",
                        "created": 1,
                        "owned_by": "user"
                    })
                })
                .collect();

            let response_json = serde_json::json!({
                "object": "list",
                "data": models_data
            });

            let body_str =
                serde_json::to_string(&response_json).unwrap_or_else(|_| "{}".to_string());

            let mut response_builder = Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "application/json");

            response_builder = add_cors_headers_with_host_and_origin(
                response_builder,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );

            return Ok(response_builder.body(Body::from(body_str)).unwrap());
        }

        (hyper::Method::GET, "/openapi.json") => {
<<<<<<< HEAD
            let body = include_str!("../../../static/openapi.json"); // relative to src-tauri/src/
            return Ok(Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap());
=======
            let static_body = include_str!("../../../static/openapi.json"); // relative to src-tauri/src/
                                                                            // Parse the static OpenAPI JSON and update the server URL with actual host and port
            match serde_json::from_str::<serde_json::Value>(static_body) {
                Ok(mut openapi_spec) => {
                    // Update the servers array with the actual host and port
                    if let Some(servers) = openapi_spec
                        .get_mut("servers")
                        .and_then(|s| s.as_array_mut())
                    {
                        for server in servers {
                            if let Some(server_obj) = server.as_object_mut() {
                                if let Some(url) = server_obj.get_mut("url") {
                                    let base_url = format!(
                                        "http://{}:{}{}",
                                        config.host, config.port, config.prefix
                                    );
                                    *url = serde_json::Value::String(base_url);
                                }
                            }
                        }
                    }
                    let body = serde_json::to_string(&openapi_spec)
                        .unwrap_or_else(|_| static_body.to_string());
                    return Ok(Response::builder()
                        .status(StatusCode::OK)
                        .header(hyper::header::CONTENT_TYPE, "application/json")
                        .body(Body::from(body))
                        .unwrap());
                }
                Err(_) => {
                    // If parsing fails, return the static file as fallback
                    return Ok(Response::builder()
                        .status(StatusCode::OK)
                        .header(hyper::header::CONTENT_TYPE, "application/json")
                        .body(Body::from(static_body))
                        .unwrap());
                }
            }
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
        }

        // DOCS route
        (hyper::Method::GET, "/") => {
            let html = r#"
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>API Docs</title>
  <link rel="stylesheet" type="text/css" href="/docs/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/docs/swagger-ui-bundle.js"></script>
  <script>
  window.onload = () => {
    SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
    });
  };
  </script>
</body>
</html>
    "#;

            let mut response_builder = Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "text/html");

            response_builder = add_cors_headers_with_host_and_origin(
                response_builder,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );

            return Ok(response_builder.body(Body::from(html)).unwrap());
        }

        (hyper::Method::GET, "/docs/swagger-ui.css") => {
            let css = include_str!("../../../static/swagger-ui/swagger-ui.css");
            return Ok(Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "text/css")
                .body(Body::from(css))
                .unwrap());
        }

        (hyper::Method::GET, "/docs/swagger-ui-bundle.js") => {
            let js = include_str!("../../../static/swagger-ui/swagger-ui-bundle.js");
            return Ok(Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "application/javascript")
                .body(Body::from(js))
                .unwrap());
        }

        (hyper::Method::GET, "/favicon.ico") => {
            let icon = include_bytes!("../../../static/swagger-ui/favicon.ico");
            return Ok(Response::builder()
                .status(StatusCode::OK)
                .header(hyper::header::CONTENT_TYPE, "image/x-icon")
                .body(Body::from(icon.as_ref()))
                .unwrap());
        }

        _ => {
            let is_explicitly_whitelisted_get = method == hyper::Method::GET
                && whitelisted_paths.contains(&destination_path.as_str());
            if is_explicitly_whitelisted_get {
                log::debug!("Handled whitelisted GET path: {destination_path}");
                let mut error_response = Response::builder().status(StatusCode::NOT_FOUND);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response.body(Body::from("Not Found")).unwrap());
            } else {
                log::warn!(
                    "Unhandled method/path for dynamic routing: {method} {destination_path}"
                );
                let mut error_response = Response::builder().status(StatusCode::NOT_FOUND);
                error_response = add_cors_headers_with_host_and_origin(
                    error_response,
                    &host_header,
                    &origin_header,
                    &config.trusted_hosts,
                );
                return Ok(error_response.body(Body::from("Not Found")).unwrap());
            }
        }
    }

    let port = match target_port {
        Some(p) => p,
        None => {
            log::error!(
                "Internal API server routing error: target is None after successful lookup"
            );
            let mut error_response = Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );
            return Ok(error_response
                .body(Body::from("Internal routing error"))
                .unwrap());
        }
    };
<<<<<<< HEAD

    let upstream_url = format!("http://127.0.0.1:{port}{destination_path}");
=======
    log::info!("Proxying request to model server at port {port}, path: {destination_path}");

    let upstream_url = format!("http://127.0.0.1:{port}/v1{destination_path}");
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5

    let mut outbound_req = client.request(method.clone(), &upstream_url);

    for (name, value) in headers.iter() {
        if name != hyper::header::HOST && name != hyper::header::AUTHORIZATION {
            outbound_req = outbound_req.header(name, value);
        }
    }

    if let Some(key) = session_api_key {
        log::debug!("Adding session Authorization header");
        outbound_req = outbound_req.header("Authorization", format!("Bearer {key}"));
    } else {
        log::debug!("No session API key available for this request");
    }

    let outbound_req_with_body = if let Some(bytes) = buffered_body {
        let bytes_len = bytes.len();
        log::debug!("Sending buffered body ({bytes_len} bytes)");
        outbound_req.body(bytes)
    } else {
        log::error!("Internal logic error: Request reached proxy stage without a buffered body.");
        let mut error_response = Response::builder().status(StatusCode::INTERNAL_SERVER_ERROR);
        error_response = add_cors_headers_with_host_and_origin(
            error_response,
            &host_header,
            &origin_header,
            &config.trusted_hosts,
        );
        return Ok(error_response
            .body(Body::from("Internal server error: unhandled request path"))
            .unwrap());
    };

    match outbound_req_with_body.send().await {
        Ok(response) => {
            let status = response.status();
            log::debug!("Received response with status: {status}");

            let mut builder = Response::builder().status(status);

            for (name, value) in response.headers() {
                if !is_cors_header(name.as_str()) && name != hyper::header::CONTENT_LENGTH {
                    builder = builder.header(name, value);
                }
            }

            builder = add_cors_headers_with_host_and_origin(
                builder,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );

            let mut stream = response.bytes_stream();
            let (mut sender, body) = hyper::Body::channel();

            tokio::spawn(async move {
                while let Some(chunk_result) = stream.next().await {
                    match chunk_result {
                        Ok(chunk) => {
                            if sender.send_data(chunk).await.is_err() {
                                log::debug!("Client disconnected during streaming");
                                break;
                            }
                        }
                        Err(e) => {
                            log::error!("Stream error: {e}");
                            break;
                        }
                    }
                }
                log::debug!("Streaming complete to client");
            });

            Ok(builder.body(body).unwrap())
        }
        Err(e) => {
            let error_msg = format!("Proxy request to model failed: {e}");
            log::error!("{error_msg}");
            let mut error_response = Response::builder().status(StatusCode::BAD_GATEWAY);
            error_response = add_cors_headers_with_host_and_origin(
                error_response,
                &host_header,
                &origin_header,
                &config.trusted_hosts,
            );
            Ok(error_response.body(Body::from(error_msg)).unwrap())
        }
    }
}

fn add_cors_headers_with_host_and_origin(
    builder: hyper::http::response::Builder,
    _host: &str,
    origin: &str,
    _trusted_hosts: &[Vec<String>],
) -> hyper::http::response::Builder {
    let mut builder = builder;
    let allow_origin_header = if !origin.is_empty() {
        origin.to_string()
    } else {
        "*".to_string()
    };

    builder = builder
        .header("Access-Control-Allow-Origin", allow_origin_header.clone())
        .header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
        .header("Access-Control-Allow-Headers", "Authorization, Content-Type, Host, Accept, Accept-Language, Cache-Control, Connection, DNT, If-Modified-Since, Keep-Alive, Origin, User-Agent, X-Requested-With, X-CSRF-Token, X-Forwarded-For, X-Forwarded-Proto, X-Forwarded-Host, authorization, content-type, x-api-key")
        .header("Vary", "Origin");

    if allow_origin_header != "*" {
        builder = builder.header("Access-Control-Allow-Credentials", "true");
    }

    builder
}

pub async fn is_server_running(server_handle: Arc<Mutex<Option<ServerHandle>>>) -> bool {
    let handle_guard = server_handle.lock().await;
    handle_guard.is_some()
}

#[allow(clippy::too_many_arguments)]
pub async fn start_server(
    server_handle: Arc<Mutex<Option<ServerHandle>>>,
    sessions: Arc<Mutex<HashMap<i32, LLamaBackendSession>>>,
    host: String,
    port: u16,
    prefix: String,
    proxy_api_key: String,
    trusted_hosts: Vec<Vec<String>>,
    proxy_timeout: u64,
) -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    let mut handle_guard = server_handle.lock().await;
    if handle_guard.is_some() {
        return Err("Server is already running".into());
    }

    let addr: SocketAddr = format!("{host}:{port}")
        .parse()
        .map_err(|e| format!("Invalid address: {e}"))?;

    let config = ProxyConfig {
        prefix,
        proxy_api_key,
        trusted_hosts,
<<<<<<< HEAD
=======
        host: host.clone(),
        port,
>>>>>>> e49d51786081e89f4d262e710160cdbef16ba6a5
    };

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(proxy_timeout))
        .pool_max_idle_per_host(10)
        .pool_idle_timeout(std::time::Duration::from_secs(30))
        .build()?;

    let make_svc = make_service_fn(move |_conn| {
        let client = client.clone();
        let config = config.clone();
        let sessions = sessions.clone();

        async move {
            Ok::<_, Infallible>(service_fn(move |req| {
                proxy_request(req, client.clone(), config.clone(), sessions.clone())
            }))
        }
    });

    let server = match Server::try_bind(&addr) {
        Ok(builder) => builder.serve(make_svc),
        Err(e) => {
            log::error!("Failed to bind to {addr}: {e}");
            return Err(Box::new(e));
        }
    };
    log::info!("Jan API server started on http://{addr}");

    let server_task = tauri::async_runtime::spawn(async move {
        if let Err(e) = server.await {
            log::error!("Server error: {e}");
            return Err(Box::new(e) as Box<dyn std::error::Error + Send + Sync>);
        }
        Ok(())
    });

    *handle_guard = Some(server_task);
    let actual_port = addr.port();
    log::info!("Jan API server started successfully on port {actual_port}");
    Ok(actual_port)
}

pub async fn stop_server(
    server_handle: Arc<Mutex<Option<ServerHandle>>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut handle_guard = server_handle.lock().await;

    if let Some(handle) = handle_guard.take() {
        handle.abort();
        *handle_guard = None;
        log::info!("Jan API server stopped");
    } else {
        log::debug!("Server was not running");
    }

    Ok(())
}
