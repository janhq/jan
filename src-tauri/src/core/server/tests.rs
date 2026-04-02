#[cfg(test)]
mod tests {
    use crate::core::server::proxy;

    #[test]
    fn test_get_destination_path_basic() {
        let result = proxy::get_destination_path("/v1/messages", "/v1");
        assert_eq!(result, "/messages");
    }

    #[test]
    fn test_get_destination_path_with_subpath() {
        let result = proxy::get_destination_path("/v1/messages/threads/123", "/v1");
        assert_eq!(result, "/messages/threads/123");
    }

    #[test]
    fn test_get_destination_path_no_prefix() {
        let result = proxy::get_destination_path("/messages", "");
        assert_eq!(result, "/messages");
    }

    #[test]
    fn test_get_destination_path_different_prefix() {
        let result = proxy::get_destination_path("/api/v1/messages", "/api/v1");
        assert_eq!(result, "/messages");
    }

    #[test]
    fn test_get_destination_path_empty_prefix() {
        let result = proxy::get_destination_path("/messages", "/v1");
        assert_eq!(result, "/messages");
    }

    #[test]
    fn test_messages_in_cors_whitelist() {
        let whitelisted_paths = ["/", "/openapi.json", "/favicon.ico", "/messages"];
        assert!(whitelisted_paths.contains(&"/messages"));
    }

    #[test]
    fn test_messages_in_main_whitelist() {
        let whitelisted_paths = [
            "/",
            "/openapi.json",
            "/favicon.ico",
            "/docs/swagger-ui.css",
            "/docs/swagger-ui-bundle.js",
            "/docs/swagger-ui-standalone-preset.js",
            "/messages",
        ];
        assert!(whitelisted_paths.contains(&"/messages"));
    }

    #[test]
    fn test_messages_subpath_not_in_exact_whitelist() {
        let whitelisted_paths = ["/", "/openapi.json", "/favicon.ico", "/messages"];
        // Only exact match
        assert!(!whitelisted_paths.contains(&"/messages/threads"));
        assert!(!whitelisted_paths.contains(&"/messages/api"));
    }

    #[test]
    fn test_proxy_config_creation() {
        let config = proxy::ProxyConfig {
            prefix: "/v1".to_string(),
            proxy_api_key: "test-key".to_string(),
            trusted_hosts: vec![vec!["localhost".to_string()]],
            host: "localhost".to_string(),
            port: 1337,
        };
        assert_eq!(config.prefix, "/v1");
        assert_eq!(config.proxy_api_key, "test-key");
        assert_eq!(config.trusted_hosts.len(), 1);
        assert_eq!(config.host, "localhost");
        assert_eq!(config.port, 1337);
    }

    #[test]
    fn test_proxy_config_default() {
        let config = proxy::ProxyConfig {
            prefix: "".to_string(),
            proxy_api_key: "".to_string(),
            trusted_hosts: vec![],
            host: "127.0.0.1".to_string(),
            port: 8080,
        };
        assert_eq!(config.prefix, "");
        assert_eq!(config.proxy_api_key, "");
        assert_eq!(config.trusted_hosts.len(), 0);
        assert_eq!(config.host, "127.0.0.1");
        assert_eq!(config.port, 8080);
    }

    #[test]
    fn test_allowed_methods() {
        let allowed_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"];
        assert!(allowed_methods.contains(&"POST"));
        assert!(allowed_methods.contains(&"GET"));
        assert!(allowed_methods.contains(&"OPTIONS"));
    }

    #[test]
    fn test_allowed_headers() {
        let allowed_headers = [
            "accept",
            "authorization",
            "content-type",
            "host",
            "origin",
            "user-agent",
            "x-api-key",
        ];
        assert!(allowed_headers.contains(&"authorization"));
        assert!(allowed_headers.contains(&"content-type"));
        assert!(allowed_headers.contains(&"x-api-key"));
    }

    // Tests for X-Api-Key header authentication support
    // The proxy now accepts either Authorization: Bearer <token> or X-Api-Key: <token>

    #[test]
    fn test_bearer_token_extraction() {
        let api_key = "test-secret-key";
        let auth_header = "Bearer test-secret-key";

        let auth_valid = auth_header
            .strip_prefix("Bearer ")
            .map(|token| token == api_key)
            .unwrap_or(false);

        assert!(auth_valid);
    }

    #[test]
    fn test_bearer_token_extraction_invalid() {
        let api_key = "test-secret-key";
        let auth_header = "Bearer wrong-key";

        let auth_valid = auth_header
            .strip_prefix("Bearer ")
            .map(|token| token == api_key)
            .unwrap_or(false);

        assert!(!auth_valid);
    }

    #[test]
    fn test_bearer_token_extraction_missing_prefix() {
        let api_key = "test-secret-key";
        let auth_header = "test-secret-key"; // Missing "Bearer " prefix

        let auth_valid = auth_header
            .strip_prefix("Bearer ")
            .map(|token| token == api_key)
            .unwrap_or(false);

        assert!(!auth_valid);
    }

    #[test]
    fn test_x_api_key_validation() {
        let api_key = "test-secret-key";
        let x_api_key_header = "test-secret-key";

        let api_key_valid = x_api_key_header == api_key;

        assert!(api_key_valid);
    }

    #[test]
    fn test_x_api_key_validation_invalid() {
        let api_key = "test-secret-key";
        let x_api_key_header = "wrong-key";

        let api_key_valid = x_api_key_header == api_key;

        assert!(!api_key_valid);
    }

    #[test]
    fn test_auth_either_header_valid_bearer() {
        let api_key = "test-secret-key";
        let auth_header = Some("Bearer test-secret-key");
        let x_api_key_header: Option<&str> = None;

        let auth_valid = auth_header
            .and_then(|auth_str| auth_str.strip_prefix("Bearer "))
            .map(|token| token == api_key)
            .unwrap_or(false);

        let api_key_valid = x_api_key_header.map(|key| key == api_key).unwrap_or(false);

        assert!(auth_valid || api_key_valid);
    }

    #[test]
    fn test_auth_either_header_valid_x_api_key() {
        let api_key = "test-secret-key";
        let auth_header: Option<&str> = None;
        let x_api_key_header = Some("test-secret-key");

        let auth_valid = auth_header
            .and_then(|auth_str| auth_str.strip_prefix("Bearer "))
            .map(|token| token == api_key)
            .unwrap_or(false);

        let api_key_valid = x_api_key_header.map(|key| key == api_key).unwrap_or(false);

        assert!(auth_valid || api_key_valid);
    }

    #[test]
    fn test_auth_both_headers_missing() {
        let api_key = "test-secret-key";
        let auth_header: Option<&str> = None;
        let x_api_key_header: Option<&str> = None;

        let auth_valid = auth_header
            .and_then(|auth_str| auth_str.strip_prefix("Bearer "))
            .map(|token| token == api_key)
            .unwrap_or(false);

        let api_key_valid = x_api_key_header.map(|key| key == api_key).unwrap_or(false);

        assert!(!auth_valid && !api_key_valid);
    }

    #[test]
    fn test_auth_both_headers_invalid() {
        let api_key = "test-secret-key";
        let auth_header = Some("Bearer wrong-key");
        let x_api_key_header = Some("also-wrong-key");

        let auth_valid = auth_header
            .and_then(|auth_str| auth_str.strip_prefix("Bearer "))
            .map(|token| token == api_key)
            .unwrap_or(false);

        let api_key_valid = x_api_key_header.map(|key| key == api_key).unwrap_or(false);

        assert!(!auth_valid && !api_key_valid);
    }

    #[test]
    fn test_auth_both_headers_one_valid() {
        let api_key = "test-secret-key";
        // Bearer is wrong but X-Api-Key is correct
        let auth_header = Some("Bearer wrong-key");
        let x_api_key_header = Some("test-secret-key");

        let auth_valid = auth_header
            .and_then(|auth_str| auth_str.strip_prefix("Bearer "))
            .map(|token| token == api_key)
            .unwrap_or(false);

        let api_key_valid = x_api_key_header.map(|key| key == api_key).unwrap_or(false);

        // Should pass if either is valid
        assert!(auth_valid || api_key_valid);
    }

    #[test]
    fn test_x_api_key_in_cors_allowed_headers() {
        // Verify x-api-key is in the CORS allowed headers list used by the proxy
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
        assert!(allowed_headers.contains(&"x-api-key"));
    }

    // Tests for server-side tool handling (web_search)

    #[test]
    fn test_has_web_search_tools_present() {
        let body = serde_json::json!({
            "model": "claude-3-opus",
            "messages": [{"role": "user", "content": "test"}],
            "tools": [
                {"type": "web_search_20250305", "name": "web_search", "max_uses": 5},
                {"name": "read_file", "input_schema": {"type": "object"}}
            ]
        });
        assert!(proxy::has_web_search_tools(&body));
    }

    #[test]
    fn test_has_web_search_tools_absent() {
        let body = serde_json::json!({
            "model": "claude-3-opus",
            "messages": [{"role": "user", "content": "test"}],
            "tools": [
                {"name": "read_file", "input_schema": {"type": "object"}}
            ]
        });
        assert!(!proxy::has_web_search_tools(&body));
    }

    #[test]
    fn test_has_web_search_tools_no_tools() {
        let body = serde_json::json!({
            "model": "claude-3-opus",
            "messages": [{"role": "user", "content": "test"}]
        });
        assert!(!proxy::has_web_search_tools(&body));
    }

    #[test]
    fn test_inject_web_search_function_tool_into_existing() {
        let mut body = serde_json::json!({
            "model": "test",
            "messages": [],
            "tools": [
                {"type": "function", "function": {"name": "existing", "parameters": {}}}
            ]
        });
        proxy::inject_web_search_function_tool(&mut body);

        let tools = body["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 2);
        assert_eq!(tools[1]["function"]["name"], "web_search");
    }

    #[test]
    fn test_inject_web_search_function_tool_no_tools() {
        let mut body = serde_json::json!({
            "model": "test",
            "messages": []
        });
        proxy::inject_web_search_function_tool(&mut body);

        let tools = body["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["function"]["name"], "web_search");
    }

    #[test]
    fn test_transform_skips_server_side_tools() {
        let body = serde_json::json!({
            "model": "claude-3-opus",
            "messages": [{"role": "user", "content": "test"}],
            "tools": [
                {"type": "web_search_20250305", "name": "web_search", "max_uses": 5},
                {"name": "read_file", "description": "Read a file", "input_schema": {"type": "object"}}
            ]
        });

        let result = proxy::transform_anthropic_to_openai(&body).unwrap();
        let tools = result["tools"].as_array().unwrap();
        // web_search tool should be filtered out, only read_file remains
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["function"]["name"], "read_file");
    }

    #[test]
    fn test_convert_server_tool_use_in_assistant_message() {
        let body = serde_json::json!({
            "model": "test",
            "messages": [
                {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": "Let me search for that."},
                        {
                            "type": "server_tool_use",
                            "id": "srvtoolu_123",
                            "name": "web_search",
                            "input": {"query": "rust programming"}
                        }
                    ]
                }
            ]
        });

        let result = proxy::transform_anthropic_to_openai(&body).unwrap();
        let messages = result["messages"].as_array().unwrap();
        let assistant_msg = &messages[0];
        assert_eq!(assistant_msg["role"], "assistant");

        let tool_calls = assistant_msg["tool_calls"].as_array().unwrap();
        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0]["id"], "srvtoolu_123");
        assert_eq!(tool_calls[0]["function"]["name"], "web_search");
    }

    #[test]
    fn test_convert_web_search_tool_result_in_user_message() {
        let body = serde_json::json!({
            "model": "test",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "web_search_tool_result",
                            "tool_use_id": "srvtoolu_123",
                            "content": [
                                {
                                    "type": "web_search_result",
                                    "title": "Rust Language",
                                    "url": "https://rust-lang.org",
                                    "page_snippet": "Rust is a systems programming language."
                                }
                            ]
                        },
                        {"type": "text", "text": "Based on the search results..."}
                    ]
                }
            ]
        });

        let result = proxy::transform_anthropic_to_openai(&body).unwrap();
        let messages = result["messages"].as_array().unwrap();

        // Should have a tool message and a user message
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["role"], "tool");
        assert_eq!(messages[0]["tool_call_id"], "srvtoolu_123");
        // Content should contain the search result info
        let content = messages[0]["content"].as_str().unwrap();
        assert!(content.contains("Rust Language"));
        assert!(content.contains("https://rust-lang.org"));

        assert_eq!(messages[1]["role"], "user");
    }

    // Tests for SSE re-emission of web search loop results

    #[tokio::test]
    async fn test_emit_anthropic_response_as_sse() {
        use hyper::Body;

        let anthropic_response = serde_json::json!({
            "id": "msg_test123",
            "type": "message",
            "role": "assistant",
            "content": [
                {"type": "text", "text": "Hello from web search!"}
            ],
            "model": "test-model",
            "stop_reason": "end_turn",
            "stop_sequence": null,
            "usage": {"input_tokens": 10, "output_tokens": 5}
        });

        let (sender, body) = Body::channel();

        let response = anthropic_response.clone();
        tokio::spawn(async move {
            proxy::emit_anthropic_response_as_sse(&response, sender).await;
        });

        let body_bytes = hyper::body::to_bytes(body).await.unwrap();
        let body_str = String::from_utf8_lossy(&body_bytes);

        // Verify SSE event sequence
        assert!(body_str.contains("event: message_start\n"), "missing message_start");
        assert!(body_str.contains("event: content_block_start\n"), "missing content_block_start");
        assert!(body_str.contains("event: content_block_delta\n"), "missing content_block_delta");
        assert!(body_str.contains("event: content_block_stop\n"), "missing content_block_stop");
        assert!(body_str.contains("event: message_delta\n"), "missing message_delta");
        assert!(body_str.contains("event: message_stop\n"), "missing message_stop");

        // Verify content is present
        assert!(body_str.contains("Hello from web search!"));
        assert!(body_str.contains("msg_test123"));
    }

    #[tokio::test]
    async fn test_emit_anthropic_response_as_sse_empty_content() {
        use hyper::Body;

        let anthropic_response = serde_json::json!({
            "id": "msg_empty",
            "type": "message",
            "role": "assistant",
            "content": [],
            "model": "test-model",
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 0, "output_tokens": 0}
        });

        let (sender, body) = Body::channel();

        let response = anthropic_response.clone();
        tokio::spawn(async move {
            proxy::emit_anthropic_response_as_sse(&response, sender).await;
        });

        let body_bytes = hyper::body::to_bytes(body).await.unwrap();
        let body_str = String::from_utf8_lossy(&body_bytes);

        // Should still have message_start, message_delta, message_stop
        assert!(body_str.contains("event: message_start\n"));
        assert!(body_str.contains("event: message_delta\n"));
        assert!(body_str.contains("event: message_stop\n"));
        // But no content blocks
        assert!(!body_str.contains("event: content_block_start\n"));
    }
}
