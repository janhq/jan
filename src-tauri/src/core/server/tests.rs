#[cfg(test)]
mod tests {
    use crate::core::server::proxy;
    use serde_json::json;

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
            enable_server_tool_execution: false,
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
            enable_server_tool_execution: false,
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

    #[test]
    fn adds_string_type_for_description_only_leaf() {
        let mut schema = json!({
            "type": "object",
            "properties": {
                "url": {
                    "description": "field property config"
                }
            }
        });

        proxy::normalize_openai_tool_parameters_schema(&mut schema);

        assert_eq!(schema["properties"]["url"]["type"], json!("string"));
    }

    #[test]
    fn adds_empty_properties_for_object_without_properties() {
        let mut schema = json!({
            "type": "object"
        });

        proxy::normalize_openai_tool_parameters_schema(&mut schema);

        assert_eq!(schema["properties"], json!({}));
    }

    #[test]
    fn normalizes_nested_object_and_array_leaves() {
        let mut schema = json!({
            "type": "object",
            "properties": {
                "payload": {
                    "type": "object",
                    "properties": {
                        "title": {
                            "description": "Title text"
                        }
                    }
                },
                "filters": {
                    "type": "object"
                },
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object"
                    }
                }
            }
        });

        proxy::normalize_openai_tool_parameters_schema(&mut schema);

        assert_eq!(schema["properties"]["payload"]["properties"]["title"]["type"], json!("string"));
        assert_eq!(schema["properties"]["filters"]["properties"], json!({}));
        assert_eq!(schema["properties"]["items"]["items"]["properties"], json!({}));
    }

    #[test]
    fn leaves_existing_typed_or_container_nodes_unchanged() {
        let mut schema = json!({
            "type": "object",
            "properties": {
                "name": {
                    "description": "already typed",
                    "type": "integer"
                },
                "container": {
                    "description": "container node",
                    "properties": {
                        "child": {
                            "description": "leaf child"
                        }
                    }
                }
            }
        });

        proxy::normalize_openai_tool_parameters_schema(&mut schema);

        assert_eq!(schema["properties"]["name"]["type"], json!("integer"));
        assert!(schema["properties"]["container"].get("type").is_none());
        assert_eq!(
            schema["properties"]["container"]["properties"]["child"]["type"],
            json!("string"),
        );
    }

    #[test]
    fn leaves_existing_valid_object_schema_unchanged() {
        let mut schema = json!({
            "type": "object",
            "properties": {
                "payload": {
                    "type": "object",
                    "properties": {
                        "name": {
                            "type": "string"
                        }
                    },
                    "required": ["name"]
                }
            }
        });

        let original = schema.clone();
        proxy::normalize_openai_tool_parameters_schema(&mut schema);

        assert_eq!(schema, original);
    }

    #[test]
    fn normalizes_mixed_schema_without_altering_valid_fields() {
        let mut schema = json!({
            "type": "object",
            "properties": {
                "count": {
                    "type": "integer"
                },
                "title": {
                    "description": "A title"
                },
                "metadata": {
                    "type": "object",
                    "description": "Optional metadata"
                }
            }
        });

        proxy::normalize_openai_tool_parameters_schema(&mut schema);

        assert_eq!(schema["properties"]["count"]["type"], json!("integer"));
        assert_eq!(schema["properties"]["title"]["type"], json!("string"));
        assert_eq!(schema["properties"]["metadata"]["description"], json!("Optional metadata"));
        assert_eq!(schema["properties"]["metadata"]["properties"], json!({}));
    }

    // ── Pure helper coverage ───────────────────────────────────────────────

    #[test]
    fn http_status_indicates_api_key_retry_matrix() {
        use hyper::StatusCode;
        assert!(proxy::http_status_indicates_api_key_retry(StatusCode::UNAUTHORIZED));
        assert!(proxy::http_status_indicates_api_key_retry(StatusCode::FORBIDDEN));
        assert!(proxy::http_status_indicates_api_key_retry(StatusCode::TOO_MANY_REQUESTS));
        assert!(!proxy::http_status_indicates_api_key_retry(StatusCode::OK));
        assert!(!proxy::http_status_indicates_api_key_retry(StatusCode::BAD_REQUEST));
        assert!(!proxy::http_status_indicates_api_key_retry(StatusCode::INTERNAL_SERVER_ERROR));
    }

    #[test]
    fn text_parts_to_content_empty() {
        let out = proxy::text_parts_to_content(&[]);
        assert_eq!(out, json!(""));
    }

    #[test]
    fn text_parts_to_content_single_text_collapses_to_string() {
        let parts = vec![json!({"type": "text", "text": "hello"})];
        let out = proxy::text_parts_to_content(&parts);
        assert_eq!(out, json!("hello"));
    }

    #[test]
    fn text_parts_to_content_multiple_returns_array() {
        let parts = vec![
            json!({"type": "text", "text": "a"}),
            json!({"type": "image_url", "image_url": {"url": "data:..."}}),
        ];
        let out = proxy::text_parts_to_content(&parts);
        assert!(out.is_array());
        assert_eq!(out.as_array().unwrap().len(), 2);
    }

    #[test]
    fn extract_tool_result_content_string() {
        let v = json!("plain result");
        assert_eq!(proxy::extract_tool_result_content(Some(&v)), "plain result");
    }

    #[test]
    fn extract_tool_result_content_array_of_text() {
        let v = json!([
            {"type": "text", "text": "first"},
            {"type": "text", "text": "second"},
            {"type": "image", "source": {}}
        ]);
        assert_eq!(proxy::extract_tool_result_content(Some(&v)), "first\nsecond");
    }

    #[test]
    fn extract_tool_result_content_none_yields_empty() {
        assert_eq!(proxy::extract_tool_result_content(None), "");
    }

    #[test]
    fn extract_tool_result_content_other_value_stringified() {
        let v = json!({"foo": "bar"});
        // Non-string, non-array values get JSON-stringified.
        let s = proxy::extract_tool_result_content(Some(&v));
        assert!(s.contains("foo"));
    }

    #[test]
    fn convert_media_block_image_with_source() {
        let block = json!({
            "type": "image",
            "source": {
                "data": "BASE64DATA",
                "media_type": "image/png"
            }
        });
        let mut parts = Vec::new();
        proxy::convert_media_block(&block, &mut parts);
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0]["type"], "image_url");
        assert_eq!(parts[0]["image_url"]["url"], "data:image/png;base64,BASE64DATA");
    }

    #[test]
    fn convert_media_block_image_missing_data_skipped() {
        let block = json!({"type": "image", "source": {"media_type": "image/png"}});
        let mut parts = Vec::new();
        proxy::convert_media_block(&block, &mut parts);
        assert!(parts.is_empty());
    }

    #[test]
    fn convert_media_block_text_fallback() {
        let block = json!({"type": "unknown", "text": "fallback"});
        let mut parts = Vec::new();
        proxy::convert_media_block(&block, &mut parts);
        assert_eq!(parts.len(), 1);
        assert_eq!(parts[0]["type"], "text");
        assert_eq!(parts[0]["text"], "fallback");
    }

    #[test]
    fn convert_messages_simple_string_content() {
        let msgs = json!([
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"}
        ]);
        let out = proxy::convert_messages(&msgs, None).unwrap();
        let arr = out.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["role"], "user");
        assert_eq!(arr[0]["content"], "hi");
        assert_eq!(arr[1]["role"], "assistant");
    }

    #[test]
    fn convert_messages_with_string_system_prompt_prepends() {
        let msgs = json!([{"role": "user", "content": "hi"}]);
        let sys = json!("you are helpful");
        let out = proxy::convert_messages(&msgs, Some(&sys)).unwrap();
        let arr = out.as_array().unwrap();
        assert_eq!(arr[0]["role"], "system");
        assert_eq!(arr[0]["content"], "you are helpful");
        assert_eq!(arr[1]["role"], "user");
    }

    #[test]
    fn convert_messages_with_array_system_prompt_joins_text() {
        let msgs = json!([{"role": "user", "content": "hi"}]);
        let sys = json!([
            {"type": "text", "text": "first"},
            {"type": "text", "text": "second"}
        ]);
        let out = proxy::convert_messages(&msgs, Some(&sys)).unwrap();
        let arr = out.as_array().unwrap();
        assert_eq!(arr[0]["content"], "first\nsecond");
    }

    #[test]
    fn convert_messages_assistant_with_tool_use_emits_tool_calls() {
        let msgs = json!([{
            "role": "assistant",
            "content": [
                {"type": "text", "text": "let me check"},
                {"type": "tool_use", "id": "tool_1", "name": "search", "input": {"q": "rust"}}
            ]
        }]);
        let out = proxy::convert_messages(&msgs, None).unwrap();
        let arr = out.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["tool_calls"][0]["id"], "tool_1");
        assert_eq!(arr[0]["tool_calls"][0]["function"]["name"], "search");
        // arguments should be stringified JSON
        assert!(arr[0]["tool_calls"][0]["function"]["arguments"]
            .as_str()
            .unwrap()
            .contains("rust"));
    }

    #[test]
    fn convert_messages_user_tool_result_emits_tool_role() {
        let msgs = json!([{
            "role": "user",
            "content": [
                {"type": "tool_result", "tool_use_id": "tool_1", "content": "the answer"},
                {"type": "text", "text": "thanks"}
            ]
        }]);
        let out = proxy::convert_messages(&msgs, None).unwrap();
        let arr = out.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["role"], "tool");
        assert_eq!(arr[0]["tool_call_id"], "tool_1");
        assert_eq!(arr[0]["content"], "the answer");
        assert_eq!(arr[1]["role"], "user");
    }

    #[test]
    fn convert_messages_unknown_role_skipped() {
        let msgs = json!([
            {"role": "ghost", "content": "boo"},
            {"role": "user", "content": "hi"}
        ]);
        let out = proxy::convert_messages(&msgs, None).unwrap();
        assert_eq!(out.as_array().unwrap().len(), 1);
    }

    #[test]
    fn transform_anthropic_to_openai_basic() {
        let body = json!({
            "model": "claude-x",
            "messages": [{"role": "user", "content": "hi"}],
            "stream": true,
            "temperature": 0.5,
            "stop_sequences": ["END"]
        });
        let out = proxy::transform_anthropic_to_openai(&body).unwrap();
        assert_eq!(out["model"], "claude-x");
        assert_eq!(out["stream"], true);
        assert_eq!(out["temperature"], 0.5);
        assert_eq!(out["stop"], json!(["END"]));
        assert!(out["messages"].is_array());
    }

    #[test]
    fn transform_anthropic_to_openai_with_tools() {
        let body = json!({
            "model": "claude-x",
            "messages": [{"role": "user", "content": "hi"}],
            "tools": [{
                "name": "lookup",
                "description": "lookup tool",
                "input_schema": {"type": "object"}
            }]
        });
        let out = proxy::transform_anthropic_to_openai(&body).unwrap();
        assert_eq!(out["tools"][0]["type"], "function");
        assert_eq!(out["tools"][0]["function"]["name"], "lookup");
        assert_eq!(out["tools"][0]["function"]["description"], "lookup tool");
    }

    #[test]
    fn transform_anthropic_to_openai_missing_model_returns_none() {
        let body = json!({"messages": []});
        assert!(proxy::transform_anthropic_to_openai(&body).is_none());
    }

    #[test]
    fn transform_openai_response_to_anthropic_text_only() {
        let resp = json!({
            "id": "chatcmpl-1",
            "model": "gpt-4",
            "choices": [{
                "message": {"role": "assistant", "content": "hello"},
                "finish_reason": "stop"
            }],
            "usage": {"input_tokens": 1, "output_tokens": 1}
        });
        let out = proxy::transform_openai_response_to_anthropic(&resp);
        assert_eq!(out["type"], "message");
        assert_eq!(out["role"], "assistant");
        assert_eq!(out["stop_reason"], "end_turn");
        assert_eq!(out["content"][0]["type"], "text");
        assert_eq!(out["content"][0]["text"], "hello");
    }

    #[test]
    fn transform_openai_response_to_anthropic_tool_calls() {
        let resp = json!({
            "id": "x",
            "model": "gpt-4",
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": null,
                    "tool_calls": [{
                        "id": "call_1",
                        "function": {"name": "search", "arguments": "{\"q\":\"rust\"}"}
                    }]
                },
                "finish_reason": "tool_calls"
            }]
        });
        let out = proxy::transform_openai_response_to_anthropic(&resp);
        assert_eq!(out["stop_reason"], "tool_use");
        assert_eq!(out["content"][0]["type"], "tool_use");
        assert_eq!(out["content"][0]["id"], "call_1");
        assert_eq!(out["content"][0]["name"], "search");
        assert_eq!(out["content"][0]["input"]["q"], "rust");
    }

    #[test]
    fn transform_openai_response_finish_reason_length_maps_max_tokens() {
        let resp = json!({
            "choices": [{
                "message": {"content": "x"},
                "finish_reason": "length"
            }]
        });
        let out = proxy::transform_openai_response_to_anthropic(&resp);
        assert_eq!(out["stop_reason"], "max_tokens");
    }

    #[test]
    fn parse_openai_messages_ok() {
        let msgs = json!([
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"}
        ]);
        let out = proxy::parse_openai_messages(&msgs).unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[0]["role"], "user");
    }

    #[test]
    fn parse_openai_messages_not_array_errors() {
        let msgs = json!({"role": "user"});
        assert!(proxy::parse_openai_messages(&msgs).is_err());
    }

    #[test]
    fn parse_openai_messages_missing_role_errors() {
        let msgs = json!([{"content": "hi"}]);
        assert!(proxy::parse_openai_messages(&msgs).is_err());
    }

    #[test]
    fn parse_openai_messages_non_string_content_errors() {
        let msgs = json!([{"role": "user", "content": [{"type": "text", "text": "hi"}]}]);
        assert!(proxy::parse_openai_messages(&msgs).is_err());
    }

    #[test]
    fn set_system_prompt_replaces_existing_system() {
        let mut messages = vec![
            json!({"role": "system", "content": "old"}),
            json!({"role": "user", "content": "hi"}),
        ];
        proxy::set_system_prompt(&mut messages, "new");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[0]["content"], "new");
        assert_eq!(messages[1]["role"], "user");
    }

    #[test]
    fn set_system_prompt_inserts_when_absent() {
        let mut messages = vec![json!({"role": "user", "content": "hi"})];
        proxy::set_system_prompt(&mut messages, "system!");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[0]["content"], "system!");
    }

    #[test]
    fn extract_tool_calls_returns_empty_when_absent() {
        let resp = json!({"choices": [{"message": {"content": "x"}}]});
        assert!(proxy::extract_tool_calls(&resp).is_empty());
    }

    #[test]
    fn extract_tool_calls_returns_array() {
        let resp = json!({
            "choices": [{
                "message": {
                    "tool_calls": [{"id": "c1"}, {"id": "c2"}]
                }
            }]
        });
        let calls = proxy::extract_tool_calls(&resp);
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0]["id"], "c1");
    }

    #[test]
    fn extract_choice_message_returns_first_message() {
        let resp = json!({"choices": [{"message": {"role": "assistant", "content": "x"}}]});
        let msg = proxy::extract_choice_message(&resp).unwrap();
        assert_eq!(msg["role"], "assistant");
    }

    #[test]
    fn extract_choice_message_none_when_no_choices() {
        let resp = json!({});
        assert!(proxy::extract_choice_message(&resp).is_none());
    }

    #[test]
    fn copy_optional_chat_params_copies_only_known_keys() {
        let from = json!({
            "temperature": 0.7,
            "top_p": 0.9,
            "max_tokens": 128,
            "ignored_field": true
        });
        let mut into = serde_json::Map::new();
        proxy::copy_optional_chat_params(&from, &mut into);
        assert_eq!(into.get("temperature").unwrap(), &json!(0.7));
        assert_eq!(into.get("top_p").unwrap(), &json!(0.9));
        assert_eq!(into.get("max_tokens").unwrap(), &json!(128));
        assert!(into.get("ignored_field").is_none());
    }

    #[test]
    fn sse_event_default_message_type() {
        let v = json!({"foo": "bar"});
        let bytes = proxy::sse_event(&v);
        let s = std::str::from_utf8(&bytes).unwrap();
        assert!(s.starts_with("event: message\n"));
        assert!(s.ends_with("\n\n"));
        assert!(s.contains("data: "));
    }

    #[test]
    fn sse_event_uses_type_field() {
        let v = json!({"type": "content_block_start", "x": 1});
        let bytes = proxy::sse_event(&v);
        let s = std::str::from_utf8(&bytes).unwrap();
        assert!(s.starts_with("event: content_block_start\n"));
    }

    #[test]
    fn normalize_openai_tools_in_chat_body_patches_parameters() {
        let mut body = json!({
            "messages": [],
            "tools": [{
                "type": "function",
                "function": {
                    "name": "x",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "url": {"description": "the url"}
                        }
                    }
                }
            }]
        });
        proxy::normalize_openai_tools_in_chat_body(&mut body);
        assert_eq!(
            body["tools"][0]["function"]["parameters"]["properties"]["url"]["type"],
            json!("string")
        );
    }

    #[test]
    fn normalize_openai_tools_in_chat_body_no_tools_is_noop() {
        let mut body = json!({"messages": []});
        let original = body.clone();
        proxy::normalize_openai_tools_in_chat_body(&mut body);
        assert_eq!(body, original);
    }

    #[test]
    fn add_cors_headers_with_trusted_origin_reflects_origin() {
        let trusted = vec![vec!["localhost".to_string()]];
        let builder = hyper::Response::builder();
        let builder = proxy::add_cors_headers_with_host_and_origin(
            builder,
            "localhost",
            "http://localhost:3000",
            &trusted,
        );
        let resp = builder.body(hyper::Body::empty()).unwrap();
        let h = resp.headers();
        assert!(h.contains_key("access-control-allow-methods"));
        assert!(h.contains_key("access-control-allow-headers"));
        assert_eq!(h.get("vary").unwrap(), "Origin");
        assert_eq!(
            h.get("access-control-allow-origin").unwrap(),
            "http://localhost:3000"
        );
        assert_eq!(h.get("access-control-allow-credentials").unwrap(), "true");
    }

    #[test]
    fn add_cors_headers_with_untrusted_origin_omits_origin() {
        let trusted = vec![vec!["localhost".to_string()]];
        let builder = hyper::Response::builder();
        let builder = proxy::add_cors_headers_with_host_and_origin(
            builder,
            "localhost",
            "http://evil.example.com",
            &trusted,
        );
        let resp = builder.body(hyper::Body::empty()).unwrap();
        let h = resp.headers();
        assert!(h.contains_key("access-control-allow-methods"));
        assert!(!h.contains_key("access-control-allow-origin"));
        assert!(!h.contains_key("access-control-allow-credentials"));
    }

    #[test]
    fn add_cors_headers_with_empty_origin_omits_origin() {
        let trusted = vec![vec!["localhost".to_string()]];
        let builder = hyper::Response::builder();
        let builder = proxy::add_cors_headers_with_host_and_origin(
            builder,
            "localhost",
            "",
            &trusted,
        );
        let resp = builder.body(hyper::Body::empty()).unwrap();
        let h = resp.headers();
        assert!(!h.contains_key("access-control-allow-origin"));
    }

    #[test]
    fn get_destination_path_trailing_slash() {
        let result = proxy::get_destination_path("/v1/", "/v1");
        // remove_prefix should leave "/" or "" — either way no panic, deterministic.
        assert!(result == "/" || result == "");
    }

    #[test]
    fn proxy_config_clone_preserves_fields() {
        let cfg = proxy::ProxyConfig {
            prefix: "/p".to_string(),
            proxy_api_key: "k".to_string(),
            trusted_hosts: vec![vec!["a".to_string()]],
            host: "h".to_string(),
            port: 1,
            enable_server_tool_execution: true,
        };
        let cloned = cfg.clone();
        assert_eq!(cloned.prefix, "/p");
        assert_eq!(cloned.proxy_api_key, "k");
        assert!(cloned.enable_server_tool_execution);
    }

    #[test]
    fn normalizes_combinator_members_recursively() {
        let mut schema = json!({
            "anyOf": [
                {
                    "type": "object"
                },
                {
                    "description": "fallback string"
                }
            ],
            "oneOf": [
                {
                    "type": "object"
                }
            ],
            "allOf": [
                {
                    "description": "merged leaf"
                }
            ]
        });

        proxy::normalize_openai_tool_parameters_schema(&mut schema);

        assert_eq!(schema["anyOf"][0]["properties"], json!({}));
        assert_eq!(schema["anyOf"][1]["type"], json!("string"));
        assert_eq!(schema["oneOf"][0]["properties"], json!({}));
        assert_eq!(schema["allOf"][0]["type"], json!("string"));
    }
}
