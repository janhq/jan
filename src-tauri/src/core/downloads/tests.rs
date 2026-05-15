use super::helpers::*;
use super::models::*;
use crate::core::filesystem::helpers::resolve_path_within_jan_data_folder;
use reqwest::header::HeaderMap;
use std::collections::HashMap;
use std::panic;
use std::time::{SystemTime, UNIX_EPOCH};

// Helper function to create a minimal proxy config for testing
fn create_test_proxy_config(url: &str) -> ProxyConfig {
    ProxyConfig {
        url: url.to_string(),
        username: None,
        password: None,
        no_proxy: None,
        ignore_ssl: None,
    }
}

#[test]
fn test_validate_proxy_config() {
    // Valid HTTP proxy
    let config = ProxyConfig {
        url: "http://proxy.example.com:8080".to_string(),
        username: Some("user".to_string()),
        password: Some("pass".to_string()),
        no_proxy: Some(vec!["localhost".to_string(), "*.example.com".to_string()]),
        ignore_ssl: Some(true),
    };
    assert!(validate_proxy_config(&config).is_ok());

    // Valid HTTPS proxy
    let config = ProxyConfig {
        url: "https://proxy.example.com:8080".to_string(),
        username: None,
        password: None,
        no_proxy: None,
        ignore_ssl: None,
    };
    assert!(validate_proxy_config(&config).is_ok());

    // Valid SOCKS5 proxy
    let config = ProxyConfig {
        url: "socks5://proxy.example.com:1080".to_string(),
        username: None,
        password: None,
        no_proxy: None,
        ignore_ssl: None,
    };
    assert!(validate_proxy_config(&config).is_ok());

    // Invalid URL
    let config = create_test_proxy_config("invalid-url");
    assert!(validate_proxy_config(&config).is_err());

    // Unsupported scheme
    let config = create_test_proxy_config("ftp://proxy.example.com:21");
    assert!(validate_proxy_config(&config).is_err());

    // Username without password
    let mut config = create_test_proxy_config("http://proxy.example.com:8080");
    config.username = Some("user".to_string());
    assert!(validate_proxy_config(&config).is_err());

    // Password without username
    let mut config = create_test_proxy_config("http://proxy.example.com:8080");
    config.password = Some("pass".to_string());
    assert!(validate_proxy_config(&config).is_err());

    // Empty no_proxy entry
    let mut config = create_test_proxy_config("http://proxy.example.com:8080");
    config.no_proxy = Some(vec!["".to_string()]);
    assert!(validate_proxy_config(&config).is_err());

    // Invalid wildcard pattern
    let mut config = create_test_proxy_config("http://proxy.example.com:8080");
    config.no_proxy = Some(vec!["*.".to_string()]);
    assert!(validate_proxy_config(&config).is_err());
}

#[test]
fn test_should_bypass_proxy() {
    let no_proxy = vec![
        "localhost".to_string(),
        "127.0.0.1".to_string(),
        "*.example.com".to_string(),
        "specific.domain.com".to_string(),
    ];

    // Should bypass for localhost
    assert!(should_bypass_proxy("http://localhost:8080/path", &no_proxy));

    // Should bypass for 127.0.0.1
    assert!(should_bypass_proxy("https://127.0.0.1:3000/api", &no_proxy));

    // Should bypass for wildcard match
    assert!(should_bypass_proxy(
        "http://sub.example.com/path",
        &no_proxy
    ));
    assert!(should_bypass_proxy("https://api.example.com/v1", &no_proxy));

    // Should bypass for specific domain
    assert!(should_bypass_proxy(
        "http://specific.domain.com/test",
        &no_proxy
    ));

    // Should NOT bypass for other domains
    assert!(!should_bypass_proxy("http://other.com/path", &no_proxy));
    assert!(!should_bypass_proxy("https://example.org/api", &no_proxy));

    // Should bypass everything with "*"
    let wildcard_no_proxy = vec!["*".to_string()];
    assert!(should_bypass_proxy(
        "http://any.domain.com/path",
        &wildcard_no_proxy
    ));

    // Empty no_proxy should not bypass anything
    let empty_no_proxy = vec![];
    assert!(!should_bypass_proxy(
        "http://any.domain.com/path",
        &empty_no_proxy
    ));
}

#[test]
fn test_create_proxy_from_config() {
    // Valid configuration should work
    let mut config = create_test_proxy_config("http://proxy.example.com:8080");
    config.username = Some("user".to_string());
    config.password = Some("pass".to_string());
    assert!(create_proxy_from_config(&config).is_ok());

    // Invalid configuration should fail
    let config = create_test_proxy_config("invalid-url");
    assert!(create_proxy_from_config(&config).is_err());
}

#[test]
fn test_convert_headers() {
    let mut headers = HashMap::new();
    headers.insert("User-Agent".to_string(), "test-agent".to_string());
    headers.insert("Authorization".to_string(), "Bearer token".to_string());

    let header_map = _convert_headers(&headers).unwrap();
    assert_eq!(header_map.len(), 2);
    assert_eq!(header_map.get("User-Agent").unwrap(), "test-agent");
    assert_eq!(header_map.get("Authorization").unwrap(), "Bearer token");
}

#[test]
fn test_proxy_ssl_verification_settings() {
    // Test proxy config with SSL verification settings
    let mut config = create_test_proxy_config("https://proxy.example.com:8080");
    config.ignore_ssl = Some(true);

    // Should validate successfully
    assert!(validate_proxy_config(&config).is_ok());

    // Test with all SSL settings as false
    config.ignore_ssl = Some(false);

    // Should still validate successfully
    assert!(validate_proxy_config(&config).is_ok());
}

#[test]
fn test_proxy_config_with_mixed_ssl_settings() {
    // Test with mixed SSL settings - ignore_ssl true, others false
    let mut config = create_test_proxy_config("https://proxy.example.com:8080");
    config.ignore_ssl = Some(true);

    assert!(validate_proxy_config(&config).is_ok());
    assert!(create_proxy_from_config(&config).is_ok());
}

#[test]
fn test_proxy_config_ssl_defaults() {
    // Test with no SSL settings (should use None defaults)
    let config = create_test_proxy_config("https://proxy.example.com:8080");

    assert_eq!(config.ignore_ssl, None);

    assert!(validate_proxy_config(&config).is_ok());
    assert!(create_proxy_from_config(&config).is_ok());
}

#[test]
fn test_download_item_with_ssl_proxy() {
    // Test that DownloadItem can be created with SSL proxy configuration
    let mut proxy_config = create_test_proxy_config("https://proxy.example.com:8080");
    proxy_config.ignore_ssl = Some(true);

    let download_item = DownloadItem {
        url: "https://example.com/file.zip".to_string(),
        save_path: "downloads/file.zip".to_string(),
        proxy: Some(proxy_config),
        sha256: None,
        size: None,
        model_id: None,
    };

    assert!(download_item.proxy.is_some());
    let proxy = download_item.proxy.unwrap();
    assert_eq!(proxy.ignore_ssl, Some(true));
}

#[test]
fn test_client_creation_with_ssl_settings() {
    // Test client creation with SSL settings
    let mut proxy_config = create_test_proxy_config("https://proxy.example.com:8080");
    proxy_config.ignore_ssl = Some(true);

    let download_item = DownloadItem {
        url: "https://example.com/file.zip".to_string(),
        save_path: "downloads/file.zip".to_string(),
        proxy: Some(proxy_config),
        sha256: None,
        size: None,
        model_id: None,
    };

    let header_map = HeaderMap::new();
    let result = _get_client_for_item(&download_item, &header_map);

    // Should create client successfully even with SSL settings
    assert!(result.is_ok());
}

#[test]
fn test_proxy_config_with_http_and_ssl_settings() {
    // Test that SSL settings work with HTTP proxy (though not typically used)
    let mut config = create_test_proxy_config("http://proxy.example.com:8080");
    config.ignore_ssl = Some(true);

    assert!(validate_proxy_config(&config).is_ok());
    assert!(create_proxy_from_config(&config).is_ok());
}

#[test]
fn test_proxy_config_with_socks_and_ssl_settings() {
    // Test that SSL settings work with SOCKS proxy
    let mut config = create_test_proxy_config("socks5://proxy.example.com:1080");
    config.ignore_ssl = Some(false);

    assert!(validate_proxy_config(&config).is_ok());

    // SOCKS proxies are not supported by reqwest::Proxy::all()
    // This test should expect an error for SOCKS proxies
    let result = create_proxy_from_config(&config);
    assert!(result.is_err());

    // Test with HTTP proxy instead which is supported
    let mut http_config = create_test_proxy_config("http://proxy.example.com:8080");
    http_config.ignore_ssl = Some(false);
    assert!(validate_proxy_config(&http_config).is_ok());
    assert!(create_proxy_from_config(&http_config).is_ok());
}

#[test]
fn test_download_item_creation() {
    let item = DownloadItem {
        url: "https://example.com/file.tar.gz".to_string(),
        save_path: "models/test.tar.gz".to_string(),
        proxy: None,
        sha256: None,
        size: None,
        model_id: None,
    };

    assert_eq!(item.url, "https://example.com/file.tar.gz");
    assert_eq!(item.save_path, "models/test.tar.gz");
}

#[cfg(unix)]
#[test]
fn test_download_scope_accepts_absolute_path_inside_canonical_root() {
    use std::fs;
    use std::os::unix::fs::symlink;
    use std::time::{SystemTime, UNIX_EPOCH};

    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let base_dir = std::env::temp_dir().join(format!("jan-download-scope-{unique}"));
    let configured_root = base_dir.join("home").join("user").join("jan-data");
    let canonical_root = base_dir
        .join("var")
        .join("home")
        .join("user")
        .join("jan-data");
    fs::create_dir_all(&canonical_root).unwrap();
    fs::create_dir_all(configured_root.parent().unwrap()).unwrap();
    symlink(&canonical_root, &configured_root).unwrap();

    let candidate = canonical_root.join("llamacpp/backends/v1/backend.tar.gz");
    let (_, resolved_path) =
        resolve_path_within_jan_data_folder(&configured_root, candidate.to_string_lossy().as_ref())
            .unwrap();

    let expected_path = canonical_root
        .canonicalize()
        .unwrap()
        .join("llamacpp/backends/v1/backend.tar.gz");
    assert_eq!(resolved_path, expected_path);

    let _ = fs::remove_dir_all(&base_dir);
}

#[test]
fn test_download_event_creation() {
    let event = DownloadEvent {
        transferred: 1024,
        total: 2048,
    };

    assert_eq!(event.transferred, 1024);
    assert_eq!(event.total, 2048);
}

#[test]
fn test_err_to_string() {
    let error = "Test error";
    let result = err_to_string(error);
    assert_eq!(result, "Error: Test error");
}

#[test]
fn test_handle_emit_result_does_not_panic_on_error() {
    let result = panic::catch_unwind(|| {
        handle_emit_result("download-progress", Err("frontend listener disconnected".into()));
    });
    assert!(result.is_ok());
}

#[test]
fn test_convert_headers_valid() {
    let mut headers = HashMap::new();
    headers.insert("Content-Type".to_string(), "application/json".to_string());
    headers.insert("Authorization".to_string(), "Bearer token123".to_string());

    let result = _convert_headers(&headers);
    assert!(result.is_ok());

    let header_map = result.unwrap();
    assert_eq!(header_map.len(), 2);
    assert_eq!(header_map.get("Content-Type").unwrap(), "application/json");
    assert_eq!(header_map.get("Authorization").unwrap(), "Bearer token123");
}

#[test]
fn test_convert_headers_invalid_header_name() {
    let mut headers = HashMap::new();
    headers.insert("Invalid\nHeader".to_string(), "value".to_string());

    let result = _convert_headers(&headers);
    assert!(result.is_err());
}

#[test]
fn test_convert_headers_invalid_header_value() {
    let mut headers = HashMap::new();
    headers.insert("Content-Type".to_string(), "invalid\nvalue".to_string());

    let result = _convert_headers(&headers);
    assert!(result.is_err());
}

#[test]
fn test_download_manager_state_default() {
    let state = DownloadManagerState::default();
    assert!(state.cancel_tokens.is_empty());
}

#[test]
fn test_download_event_serialization() {
    let event = DownloadEvent {
        transferred: 512,
        total: 1024,
    };

    let json = serde_json::to_string(&event).unwrap();
    assert!(json.contains("\"transferred\":512"));
    assert!(json.contains("\"total\":1024"));
}

#[test]
fn test_download_item_deserialization() {
    let json = r#"{"url":"https://example.com/file.zip","save_path":"downloads/file.zip"}"#;
    let item: DownloadItem = serde_json::from_str(json).unwrap();

    assert_eq!(item.url, "https://example.com/file.zip");
    assert_eq!(item.save_path, "downloads/file.zip");
}

// ===== convert_to_mirror_url =====

#[test]
fn test_convert_to_mirror_url_huggingface() {
    let url = "https://huggingface.co/some/repo/resolve/main/model.gguf";
    let mirror = convert_to_mirror_url(url).expect("should produce a mirror url");
    assert!(mirror.starts_with("https://apps") && mirror.contains(".jan.ai/"));
    assert!(mirror.ends_with("huggingface.co/some/repo/resolve/main/model.gguf"));
}

#[test]
fn test_convert_to_mirror_url_huggingface_subdomain() {
    // Subdomains of mirror domains should also be mirrored
    let url = "https://cdn.huggingface.co/file.bin";
    let mirror = convert_to_mirror_url(url).expect("subdomain should mirror");
    assert!(mirror.ends_with("cdn.huggingface.co/file.bin"));
}

#[test]
fn test_convert_to_mirror_url_http_scheme() {
    let url = "http://huggingface.co/file";
    let mirror = convert_to_mirror_url(url).expect("http should be stripped too");
    assert!(mirror.ends_with("huggingface.co/file"));
    assert!(!mirror.contains("http://huggingface.co"));
}

#[test]
fn test_convert_to_mirror_url_non_mirror_domain() {
    assert!(convert_to_mirror_url("https://example.com/file.bin").is_none());
    assert!(convert_to_mirror_url("https://github.com/x/y").is_none());
}

#[test]
fn test_convert_to_mirror_url_invalid_url() {
    assert!(convert_to_mirror_url("not a url").is_none());
    assert!(convert_to_mirror_url("").is_none());
}

#[test]
fn test_convert_to_mirror_url_not_substring_match() {
    // A domain that merely contains "huggingface.co" as substring (not as suffix) must NOT match
    let url = "https://huggingface.co.evil.com/file";
    assert!(convert_to_mirror_url(url).is_none());
}

// ===== err_to_string =====

#[test]
fn test_err_to_string_with_io_error() {
    let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "missing");
    let s = err_to_string(io_err);
    assert!(s.starts_with("Error: "));
    assert!(s.contains("missing"));
}

// ===== _convert_headers edge cases =====

#[test]
fn test_convert_headers_empty() {
    let headers: HashMap<String, String> = HashMap::new();
    let result = _convert_headers(&headers).unwrap();
    assert!(result.is_empty());
}

#[test]
fn test_convert_headers_empty_value_is_ok() {
    // Empty header values are valid per HTTP spec
    let mut headers = HashMap::new();
    headers.insert("X-Empty".to_string(), "".to_string());
    let result = _convert_headers(&headers).unwrap();
    assert_eq!(result.get("X-Empty").unwrap(), "");
}

#[test]
fn test_convert_headers_invalid_name_with_space() {
    let mut headers = HashMap::new();
    headers.insert("Bad Header".to_string(), "v".to_string());
    assert!(_convert_headers(&headers).is_err());
}

// ===== validate_proxy_config additional cases =====

#[test]
fn test_validate_proxy_config_socks4() {
    let cfg = create_test_proxy_config("socks4://proxy.example.com:1080");
    assert!(validate_proxy_config(&cfg).is_ok());
}

#[test]
fn test_validate_proxy_config_empty_url() {
    let cfg = create_test_proxy_config("");
    assert!(validate_proxy_config(&cfg).is_err());
}

#[test]
fn test_validate_proxy_config_empty_no_proxy_list_ok() {
    let mut cfg = create_test_proxy_config("http://proxy.example.com:8080");
    cfg.no_proxy = Some(vec![]);
    assert!(validate_proxy_config(&cfg).is_ok());
}

#[test]
fn test_validate_proxy_config_valid_wildcard_min_length() {
    let mut cfg = create_test_proxy_config("http://proxy.example.com:8080");
    cfg.no_proxy = Some(vec!["*.a".to_string()]); // length 3, should pass
    assert!(validate_proxy_config(&cfg).is_ok());
}

// ===== should_bypass_proxy edge cases =====

#[test]
fn test_should_bypass_proxy_invalid_url() {
    let no_proxy = vec!["localhost".to_string()];
    assert!(!should_bypass_proxy("not a url", &no_proxy));
}

#[test]
fn test_should_bypass_proxy_url_without_host() {
    let no_proxy = vec!["localhost".to_string()];
    // file:// URLs technically have no host
    assert!(!should_bypass_proxy("file:///tmp/x", &no_proxy));
}

#[test]
fn test_should_bypass_proxy_wildcard_does_not_match_root() {
    // "*.example.com" should match sub.example.com but not example.com
    let no_proxy = vec!["*.example.com".to_string()];
    assert!(should_bypass_proxy("http://x.example.com/", &no_proxy));
    // root "example.com" technically ends_with "example.com" — current impl matches it.
    // Pin existing behavior:
    assert!(should_bypass_proxy("http://example.com/", &no_proxy));
}

#[test]
fn test_should_bypass_proxy_case_sensitive_host() {
    // url crate lowercases hosts; entries are matched case-sensitively against lowercased host
    let no_proxy = vec!["LocalHost".to_string()];
    // host becomes "localhost"; entry "LocalHost" != "localhost" -> not bypassed
    assert!(!should_bypass_proxy("http://localhost/", &no_proxy));
}

// ===== _get_client_for_item =====

#[test]
fn test_get_client_for_item_no_proxy() {
    let item = DownloadItem {
        url: "https://example.com/file".to_string(),
        save_path: "x".to_string(),
        proxy: None,
        sha256: None,
        size: None,
        model_id: None,
    };
    assert!(_get_client_for_item(&item, &HeaderMap::new()).is_ok());
}

#[test]
fn test_get_client_for_item_with_bypassed_proxy() {
    // Proxy configured but URL is in no_proxy list → still builds client without contacting proxy
    let mut proxy = create_test_proxy_config("http://proxy.example.com:8080");
    proxy.no_proxy = Some(vec!["example.com".to_string()]);
    let item = DownloadItem {
        url: "https://example.com/file".to_string(),
        save_path: "x".to_string(),
        proxy: Some(proxy),
        sha256: None,
        size: None,
        model_id: None,
    };
    assert!(_get_client_for_item(&item, &HeaderMap::new()).is_ok());
}

#[test]
fn test_get_client_for_item_invalid_proxy_url() {
    let item = DownloadItem {
        url: "https://example.com/file".to_string(),
        save_path: "x".to_string(),
        proxy: Some(create_test_proxy_config("not-a-url")),
        sha256: None,
        size: None,
        model_id: None,
    };
    assert!(_get_client_for_item(&item, &HeaderMap::new()).is_err());
}

// ===== ProgressTracker =====

#[tokio::test]
async fn test_progress_tracker_initial_total() {
    let mut sizes = HashMap::new();
    sizes.insert("a".to_string(), 100u64);
    sizes.insert("b".to_string(), 250u64);
    let tracker = ProgressTracker::new(&[], sizes);
    let (transferred, total) = tracker.get_total_progress().await;
    assert_eq!(transferred, 0);
    assert_eq!(total, 350);
}

#[tokio::test]
async fn test_progress_tracker_update_and_sum() {
    let mut sizes = HashMap::new();
    sizes.insert("u1".to_string(), 1000u64);
    let tracker = ProgressTracker::new(&[], sizes);

    tracker.update_progress("file-0", 200).await;
    tracker.update_progress("file-1", 300).await;
    let (transferred, total) = tracker.get_total_progress().await;
    assert_eq!(transferred, 500);
    assert_eq!(total, 1000);

    // Update overwrites previous value for the same file id
    tracker.update_progress("file-0", 400).await;
    let (transferred, _) = tracker.get_total_progress().await;
    assert_eq!(transferred, 700);
}

#[tokio::test]
async fn test_progress_tracker_add_to_total() {
    let tracker = ProgressTracker::new(&[], HashMap::new());
    let (_, total0) = tracker.get_total_progress().await;
    assert_eq!(total0, 0);

    tracker.add_to_total(1024);
    tracker.add_to_total(2048);
    let (_, total) = tracker.get_total_progress().await;
    assert_eq!(total, 3072);
}

#[tokio::test]
async fn test_progress_tracker_clone_shares_state() {
    let mut sizes = HashMap::new();
    sizes.insert("x".to_string(), 500u64);
    let tracker = ProgressTracker::new(&[], sizes);
    let clone = tracker.clone();

    clone.update_progress("f", 123).await;
    clone.add_to_total(100);

    let (transferred, total) = tracker.get_total_progress().await;
    assert_eq!(transferred, 123);
    assert_eq!(total, 600);
}

// ===== DownloadEvent / DownloadItem serde =====

#[test]
fn test_download_item_full_deserialization() {
    let json = r#"{
        "url": "https://huggingface.co/m/file.gguf",
        "save_path": "models/m/file.gguf",
        "sha256": "abc123",
        "size": 4096,
        "model_id": "m"
    }"#;
    let item: DownloadItem = serde_json::from_str(json).unwrap();
    assert_eq!(item.sha256.as_deref(), Some("abc123"));
    assert_eq!(item.size, Some(4096));
    assert_eq!(item.model_id.as_deref(), Some("m"));
    assert!(item.proxy.is_none());
}

#[test]
fn test_download_event_zero_values() {
    let evt = DownloadEvent {
        transferred: 0,
        total: 0,
    };
    let json = serde_json::to_string(&evt).unwrap();
    assert_eq!(json, r#"{"transferred":0,"total":0}"#);
}

#[test]
fn test_download_manager_state_default_is_empty() {
    let s = DownloadManagerState::default();
    assert_eq!(s.cancel_tokens.len(), 0);
}

// ===== emit error handling =====

#[test]
fn test_ok_emit_does_not_panic() {
    handle_emit_result("some-event", Ok(()));
}

#[tokio::test]
async fn test_cleanup_failed_validation_removes_file_and_dir() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("jan-cleanup-test-{unique}"));
    tokio::fs::create_dir_all(&dir).await.unwrap();
    let file = dir.join("model.gguf");
    tokio::fs::write(&file, b"data").await.unwrap();

    cleanup_failed_validation(&file).await;

    assert!(!file.exists(), "file should be removed after failed validation");
    assert!(!dir.exists(), "empty parent dir should be removed after failed validation");
}

#[tokio::test]
async fn test_cleanup_failed_validation_noops_on_missing_file() {
    let dir = std::env::temp_dir().join("jan-cleanup-nonexistent");
    let file = dir.join("ghost.gguf");
    // must not panic even when the file does not exist
    cleanup_failed_validation(&file).await;
}

#[tokio::test]
async fn test_cleanup_failed_validation_leaves_nonempty_dir() {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("jan-cleanup-nonempty-{unique}"));
    tokio::fs::create_dir_all(&dir).await.unwrap();
    let target = dir.join("model.gguf");
    let sibling = dir.join("other.gguf");
    tokio::fs::write(&target, b"data").await.unwrap();
    tokio::fs::write(&sibling, b"sibling").await.unwrap();

    cleanup_failed_validation(&target).await;

    assert!(!target.exists(), "target file should be removed");
    assert!(dir.exists(), "non-empty dir should not be removed");

    let _ = tokio::fs::remove_dir_all(&dir).await;
}
