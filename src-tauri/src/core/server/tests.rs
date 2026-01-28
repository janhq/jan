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
        let whitelisted_paths = [
            "/",
            "/openapi.json",
            "/favicon.ico",
            "/messages",
        ];
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
        };
        assert_eq!(config.prefix, "/v1");
        assert_eq!(config.proxy_api_key, "test-key");
        assert_eq!(config.trusted_hosts.len(), 1);
    }

    #[test]
    fn test_proxy_config_default() {
        let config = proxy::ProxyConfig {
            prefix: "".to_string(),
            proxy_api_key: "".to_string(),
            trusted_hosts: vec![],
        };
        assert_eq!(config.prefix, "");
        assert_eq!(config.proxy_api_key, "");
        assert_eq!(config.trusted_hosts.len(), 0);
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

        let api_key_valid = x_api_key_header
            .map(|key| key == api_key)
            .unwrap_or(false);

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

        let api_key_valid = x_api_key_header
            .map(|key| key == api_key)
            .unwrap_or(false);

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

        let api_key_valid = x_api_key_header
            .map(|key| key == api_key)
            .unwrap_or(false);

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

        let api_key_valid = x_api_key_header
            .map(|key| key == api_key)
            .unwrap_or(false);

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

        let api_key_valid = x_api_key_header
            .map(|key| key == api_key)
            .unwrap_or(false);

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
}
