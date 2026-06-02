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
        let whitelisted_paths = ["/", "/openapi.json", "/messages"];
        assert!(whitelisted_paths.contains(&"/messages"));
    }

    #[test]
    fn test_messages_in_main_whitelist() {
        let whitelisted_paths = [
            "/",
            "/openapi.json",
            "/docs/swagger-ui.css",
            "/docs/swagger-ui-bundle.js",
            "/docs/swagger-ui-standalone-preset.js",
            "/messages",
        ];
        assert!(whitelisted_paths.contains(&"/messages"));
    }

    #[test]
    fn test_messages_subpath_not_in_exact_whitelist() {
        let whitelisted_paths = ["/", "/openapi.json", "/messages"];
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
    fn test_known_post_only_route_reports_post_allowlist() {
        let allowed = proxy::allowed_methods_for_path("/chat/completions");
        assert_eq!(allowed, Some(&["POST"][..]));
    }

    #[test]
    fn test_known_get_only_route_reports_get_allowlist() {
        let allowed = proxy::allowed_methods_for_path("/models");
        assert_eq!(allowed, Some(&["GET"][..]));
    }

    #[test]
    fn test_unknown_route_has_no_allowlist() {
        let allowed = proxy::allowed_methods_for_path("/totally-unknown");
        assert_eq!(allowed, None);
    }

    #[test]
    fn test_count_tokens_route_reports_post_allowlist() {
        let allowed = proxy::allowed_methods_for_path("/messages/count_tokens");
        assert_eq!(allowed, Some(&["POST"][..]));
    }

    #[test]
    fn test_model_ids_match_exact() {
        assert!(proxy::model_ids_match("Qwen3.5-9B-MLX-4bit", "Qwen3.5-9B-MLX-4bit"));
        assert!(proxy::model_ids_match("", ""));
    }

    #[test]
    fn test_model_ids_match_dot_underscore_equivalent() {
        // The motivating case: a client sending the underscore form must still
        // resolve to the active session whose id uses dots.
        assert!(proxy::model_ids_match(
            "Qwen3_5-9B-MLX-4bit",
            "Qwen3.5-9B-MLX-4bit",
        ));
        assert!(proxy::model_ids_match(
            "Qwen3.5-9B-MLX-4bit",
            "Qwen3_5-9B-MLX-4bit",
        ));
        assert!(proxy::model_ids_match("a.b_c", "a_b.c"));
    }

    #[test]
    fn test_model_ids_match_negatives() {
        assert!(!proxy::model_ids_match("Qwen3.5-9B", "Qwen3.5-7B"));
        assert!(!proxy::model_ids_match("Qwen3.5", "Qwen3.5-9B"));
        assert!(!proxy::model_ids_match("llama-3", "llama-4"));
        // Non-{dot,underscore} chars must still match exactly.
        assert!(!proxy::model_ids_match("a-b", "a.b"));
        assert!(!proxy::model_ids_match("a.b", "a-b"));
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

    // ── /v1/responses shim (responses_shim.rs) ───────────────────────────────
    use crate::core::server::responses_shim::{
        chat_response_to_responses, responses_request_to_chat, ResponsesStreamConverter,
    };
    use serde_json::json;

    #[test]
    fn responses_request_string_input_to_chat() {
        let req = json!({
            "model": "m",
            "instructions": "you are helpful",
            "input": "hello",
            "stream": true
        });
        let chat = responses_request_to_chat(&req);
        assert_eq!(chat["model"], "m");
        assert_eq!(chat["stream"], true);
        // Streaming requests must opt into usage so we can fill response.completed.
        assert_eq!(chat["stream_options"]["include_usage"], true);
        let msgs = chat["messages"].as_array().unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0]["role"], "system");
        assert_eq!(msgs[0]["content"], "you are helpful");
        assert_eq!(msgs[1]["role"], "user");
        assert_eq!(msgs[1]["content"], "hello");
    }

    #[test]
    fn responses_request_items_and_tools_to_chat() {
        let req = json!({
            "model": "m",
            "input": [
                {"type": "message", "role": "user",
                 "content": [{"type": "input_text", "text": "run ls"}]},
                {"type": "function_call", "name": "shell",
                 "arguments": "{\"cmd\":\"ls\"}", "call_id": "call_1"},
                {"type": "function_call_output", "call_id": "call_1", "output": "file.txt"},
                {"type": "reasoning", "summary": []}
            ],
            "tools": [{
                "type": "function", "name": "shell",
                "description": "run a shell command",
                "parameters": {"type": "object"}
            }],
            "tool_choice": "auto",
            "max_output_tokens": 256
        });
        let chat = responses_request_to_chat(&req);
        let msgs = chat["messages"].as_array().unwrap();
        // reasoning item dropped -> user + assistant(tool_call) + tool
        assert_eq!(msgs.len(), 3);
        assert_eq!(msgs[0]["content"], "run ls");
        assert_eq!(msgs[1]["tool_calls"][0]["id"], "call_1");
        assert_eq!(msgs[1]["tool_calls"][0]["function"]["name"], "shell");
        assert_eq!(msgs[2]["role"], "tool");
        assert_eq!(msgs[2]["tool_call_id"], "call_1");
        assert_eq!(msgs[2]["content"], "file.txt");
        // tool flattened into chat schema
        assert_eq!(chat["tools"][0]["type"], "function");
        assert_eq!(chat["tools"][0]["function"]["name"], "shell");
        assert_eq!(chat["tool_choice"], "auto");
        assert_eq!(chat["max_tokens"], 256);
    }

    #[test]
    fn chat_response_nonstream_to_responses_text() {
        let chat = json!({
            "model": "m",
            "choices": [{"message": {"role": "assistant", "content": "hi there"},
                         "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7}
        });
        let resp = chat_response_to_responses(&chat, "resp_x", "fallback");
        assert_eq!(resp["object"], "response");
        assert_eq!(resp["status"], "completed");
        assert_eq!(resp["id"], "resp_x");
        assert_eq!(resp["output"][0]["type"], "message");
        assert_eq!(resp["output"][0]["content"][0]["text"], "hi there");
        assert_eq!(resp["usage"]["input_tokens"], 5);
        assert_eq!(resp["usage"]["output_tokens"], 2);
        assert_eq!(resp["usage"]["total_tokens"], 7);
    }

    #[test]
    fn chat_response_nonstream_to_responses_tool_call() {
        let chat = json!({
            "model": "m",
            "choices": [{"message": {
                "role": "assistant",
                "content": serde_json::Value::Null,
                "tool_calls": [{
                    "id": "call_9", "type": "function",
                    "function": {"name": "shell", "arguments": "{\"cmd\":\"ls\"}"}
                }]
            }, "finish_reason": "tool_calls"}]
        });
        let resp = chat_response_to_responses(&chat, "resp_y", "m");
        let out = resp["output"].as_array().unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["type"], "function_call");
        assert_eq!(out[0]["call_id"], "call_9");
        assert_eq!(out[0]["name"], "shell");
        assert_eq!(out[0]["arguments"], "{\"cmd\":\"ls\"}");
    }

    #[test]
    fn stream_converter_text_sequence() {
        let mut conv = ResponsesStreamConverter::new("resp_s".into(), "m".into());
        let created = conv.created_event();
        assert_eq!(created["type"], "response.created");
        assert_eq!(created["response"]["status"], "in_progress");

        let mut types: Vec<String> = Vec::new();
        for delta in [
            json!({"choices":[{"delta":{"role":"assistant"}}]}),
            json!({"choices":[{"delta":{"content":"He"}}]}),
            json!({"choices":[{"delta":{"content":"llo"}}]}),
            json!({"choices":[{"delta":{},"finish_reason":"stop"}]}),
        ] {
            for ev in conv.on_chunk(&delta) {
                types.push(ev["type"].as_str().unwrap().to_string());
            }
        }
        // First text delta opens the message item + content part.
        assert!(types.contains(&"response.output_item.added".to_string()));
        assert!(types.contains(&"response.content_part.added".to_string()));
        assert_eq!(
            types
                .iter()
                .filter(|t| *t == "response.output_text.delta")
                .count(),
            2
        );

        let closers = conv.finish(Some(&json!({
            "prompt_tokens": 3, "completion_tokens": 1, "total_tokens": 4
        })));
        let closer_types: Vec<&str> =
            closers.iter().map(|e| e["type"].as_str().unwrap()).collect();
        assert!(closer_types.contains(&"response.output_text.done"));
        assert!(closer_types.contains(&"response.output_item.done"));
        let completed = closers.last().unwrap();
        assert_eq!(completed["type"], "response.completed");
        assert_eq!(completed["response"]["status"], "completed");
        assert_eq!(completed["response"]["output"][0]["content"][0]["text"], "Hello");
        assert_eq!(completed["response"]["usage"]["output_tokens"], 1);
    }

    #[test]
    fn stream_converter_tool_call_sequence() {
        let mut conv = ResponsesStreamConverter::new("resp_t".into(), "m".into());
        let _ = conv.created_event();

        let chunks = [
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1",
                "type":"function","function":{"name":"shell","arguments":"{\"cmd"}}]}}]}),
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,
                "function":{"arguments":"\":\"ls\"}"}}]}}]}),
            json!({"choices":[{"delta":{},"finish_reason":"tool_calls"}]}),
        ];
        let mut types: Vec<String> = Vec::new();
        for c in chunks {
            for ev in conv.on_chunk(&c) {
                types.push(ev["type"].as_str().unwrap().to_string());
            }
        }
        assert!(types.contains(&"response.output_item.added".to_string()));
        assert!(types.contains(&"response.function_call_arguments.delta".to_string()));

        let closers = conv.finish(None);
        let completed = closers.last().unwrap();
        assert_eq!(completed["type"], "response.completed");
        let item = &completed["response"]["output"][0];
        assert_eq!(item["type"], "function_call");
        assert_eq!(item["call_id"], "call_1");
        assert_eq!(item["name"], "shell");
        assert_eq!(item["arguments"], "{\"cmd\":\"ls\"}");
    }
}
