use crate::core::cmd::get_jan_data_folder_path;
use crate::core::state::AppState;
use crate::core::utils::normalize_path;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use std::collections::HashMap;
use std::time::Duration;
use tauri::{Emitter, State};
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;
use url::Url;

#[derive(Default)]
pub struct DownloadManagerState {
    pub cancel_tokens: HashMap<String, CancellationToken>,
}

#[derive(serde::Deserialize, Clone, Debug)]
pub struct ProxyConfig {
    pub url: String,
    pub username: Option<String>,
    pub password: Option<String>,
    pub no_proxy: Option<Vec<String>>, // List of domains to bypass proxy
    pub ignore_ssl: Option<bool>,      // Ignore SSL certificate verification
}

#[derive(serde::Deserialize, Clone, Debug)]
pub struct DownloadItem {
    pub url: String,
    pub save_path: String,
    pub proxy: Option<ProxyConfig>,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct DownloadEvent {
    pub transferred: u64,
    pub total: u64,
}

fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    format!("Error: {}", e)
}

fn validate_proxy_config(config: &ProxyConfig) -> Result<(), String> {
    // Validate proxy URL format
    if let Err(e) = Url::parse(&config.url) {
        return Err(format!("Invalid proxy URL '{}': {}", config.url, e));
    }

    // Check if proxy URL has valid scheme
    let url = Url::parse(&config.url).unwrap(); // Safe to unwrap as we just validated it
    match url.scheme() {
        "http" | "https" | "socks4" | "socks5" => {}
        scheme => return Err(format!("Unsupported proxy scheme: {}", scheme)),
    }

    // Validate authentication credentials
    if config.username.is_some() && config.password.is_none() {
        return Err("Username provided without password".to_string());
    }

    if config.password.is_some() && config.username.is_none() {
        return Err("Password provided without username".to_string());
    }

    // Validate no_proxy entries
    if let Some(no_proxy) = &config.no_proxy {
        for entry in no_proxy {
            if entry.is_empty() {
                return Err("Empty no_proxy entry".to_string());
            }
            // Basic validation for wildcard patterns
            if entry.starts_with("*.") && entry.len() < 3 {
                return Err(format!("Invalid wildcard pattern: {}", entry));
            }
        }
    }

    // SSL verification settings are all optional booleans, no validation needed

    Ok(())
}

fn create_proxy_from_config(config: &ProxyConfig) -> Result<reqwest::Proxy, String> {
    // Validate the configuration first
    validate_proxy_config(config)?;

    let mut proxy = reqwest::Proxy::all(&config.url).map_err(err_to_string)?;

    // Add authentication if provided
    if let (Some(username), Some(password)) = (&config.username, &config.password) {
        proxy = proxy.basic_auth(username, password);
    }

    Ok(proxy)
}

fn should_bypass_proxy(url: &str, no_proxy: &[String]) -> bool {
    if no_proxy.is_empty() {
        return false;
    }

    // Parse the URL to get the host
    let parsed_url = match Url::parse(url) {
        Ok(u) => u,
        Err(_) => return false,
    };

    let host = match parsed_url.host_str() {
        Some(h) => h,
        None => return false,
    };

    // Check if host matches any no_proxy entry
    for entry in no_proxy {
        if entry == "*" {
            return true;
        }

        // Simple wildcard matching
        if entry.starts_with("*.") {
            let domain = &entry[2..];
            if host.ends_with(domain) {
                return true;
            }
        } else if host == entry {
            return true;
        }
    }

    false
}

fn _get_client_for_item(
    item: &DownloadItem,
    header_map: &HeaderMap,
) -> Result<reqwest::Client, String> {
    let mut client_builder = reqwest::Client::builder()
        .http2_keep_alive_timeout(Duration::from_secs(15))
        .default_headers(header_map.clone());

    // Add proxy configuration if provided
    if let Some(proxy_config) = &item.proxy {
        // Handle SSL verification settings
        if proxy_config.ignore_ssl.unwrap_or(false) {
            client_builder = client_builder.danger_accept_invalid_certs(true);
            log::info!("SSL certificate verification disabled for URL {}", item.url);
        }

        // Note: reqwest doesn't have fine-grained SSL verification controls
        // for verify_proxy_ssl, verify_proxy_host_ssl, verify_peer_ssl, verify_host_ssl
        // These settings are handled by the underlying TLS implementation

        // Check if this URL should bypass proxy
        let no_proxy = proxy_config.no_proxy.as_deref().unwrap_or(&[]);
        if !should_bypass_proxy(&item.url, no_proxy) {
            let proxy = create_proxy_from_config(proxy_config)?;
            client_builder = client_builder.proxy(proxy);
            log::info!("Using proxy {} for URL {}", proxy_config.url, item.url);
        } else {
            log::info!("Bypassing proxy for URL {}", item.url);
        }
    }

    client_builder.build().map_err(err_to_string)
}

#[tauri::command]
pub async fn download_files(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    items: Vec<DownloadItem>,
    task_id: &str,
    headers: HashMap<String, String>,
) -> Result<(), String> {
    // insert cancel tokens
    let cancel_token = CancellationToken::new();
    {
        let mut download_manager = state.download_manager.lock().await;
        if download_manager.cancel_tokens.contains_key(task_id) {
            return Err(format!("task_id {} exists", task_id));
        }
        download_manager
            .cancel_tokens
            .insert(task_id.to_string(), cancel_token.clone());
    }

    let result =
        _download_files_internal(app.clone(), &items, &headers, task_id, cancel_token.clone())
            .await;

    // cleanup
    {
        let mut download_manager = state.download_manager.lock().await;
        download_manager.cancel_tokens.remove(task_id);
    }

    // delete files if cancelled
    if cancel_token.is_cancelled() {
        let jan_data_folder = get_jan_data_folder_path(app.clone());
        for item in items {
            let save_path = jan_data_folder.join(&item.save_path);
            let _ = std::fs::remove_file(&save_path); // don't check error
        }
    }

    result.map_err(err_to_string)
}

#[tauri::command]
pub async fn cancel_download_task(state: State<'_, AppState>, task_id: &str) -> Result<(), String> {
    // NOTE: might want to add User-Agent header
    let mut download_manager = state.download_manager.lock().await;
    if let Some(token) = download_manager.cancel_tokens.remove(task_id) {
        token.cancel();
        log::info!("Cancelled download task: {}", task_id);
        Ok(())
    } else {
        Err(format!("No download task: {}", task_id))
    }
}

fn _convert_headers(
    headers: &HashMap<String, String>,
) -> Result<HeaderMap, Box<dyn std::error::Error>> {
    let mut header_map = HeaderMap::new();
    for (k, v) in headers {
        let key = HeaderName::from_bytes(k.as_bytes())?;
        let value = HeaderValue::from_str(v)?;
        header_map.insert(key, value);
    }
    Ok(header_map)
}

async fn _get_file_size(
    client: &reqwest::Client,
    url: &str,
) -> Result<u64, Box<dyn std::error::Error>> {
    let resp = client.head(url).send().await?;
    if !resp.status().is_success() {
        return Err(format!("Failed to get file size: HTTP status {}", resp.status()).into());
    }
    // this is buggy, always return 0 for HEAD request
    // Ok(resp.content_length().unwrap_or(0))

    match resp.headers().get("content-length") {
        Some(value) => {
            let value_str = value.to_str()?;
            let value_u64: u64 = value_str.parse()?;
            Ok(value_u64)
        }
        None => Ok(0),
    }
}

async fn _download_files_internal(
    app: tauri::AppHandle,
    items: &[DownloadItem],
    headers: &HashMap<String, String>,
    task_id: &str,
    cancel_token: CancellationToken,
) -> Result<(), String> {
    log::info!("Start download task: {}", task_id);

    let header_map = _convert_headers(headers).map_err(err_to_string)?;

    let total_size = {
        let mut total_size = 0u64;
        for item in items.iter() {
            let client = _get_client_for_item(item, &header_map).map_err(err_to_string)?;
            total_size += _get_file_size(&client, &item.url)
                .await
                .map_err(err_to_string)?;
        }
        total_size
    };
    log::info!("Total download size: {}", total_size);

    let mut evt = DownloadEvent {
        transferred: 0,
        total: total_size,
    };
    let evt_name = format!("download-{}", task_id);

    // save file under Jan data folder
    let jan_data_folder = get_jan_data_folder_path(app.clone());

    for item in items.iter() {
        let save_path = jan_data_folder.join(&item.save_path);
        let save_path = normalize_path(&save_path);

        if !save_path.starts_with(&jan_data_folder) {
            return Err(format!(
                "Path {} is outside of Jan data folder {}",
                save_path.display(),
                jan_data_folder.display()
            ));
        }

        // Create parent directories if they don't exist
        if let Some(parent) = save_path.parent() {
            if !parent.exists() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(err_to_string)?;
            }
        }

        let current_extension = save_path.extension().unwrap_or_default().to_string_lossy();
        let append_extension = |ext: &str| {
            if current_extension.is_empty() {
                ext.to_string()
            } else {
                format!("{}.{}", current_extension, ext)
            }
        };
        let tmp_save_path = save_path.with_extension(append_extension("tmp"));
        let url_save_path = save_path.with_extension(append_extension("url"));

        let mut resume = tmp_save_path.exists()
            && tokio::fs::read_to_string(&url_save_path)
                .await
                .map(|url| url == item.url) // check if we resume the same URL
                .unwrap_or(false);

        tokio::fs::write(&url_save_path, item.url.clone())
            .await
            .map_err(err_to_string)?;

        log::info!("Started downloading: {}", item.url);
        let client = _get_client_for_item(item, &header_map).map_err(err_to_string)?;
        let mut download_delta = 0u64;
        let resp = if resume {
            let downloaded_size = tmp_save_path.metadata().map_err(err_to_string)?.len();
            match _get_maybe_resume(&client, &item.url, downloaded_size).await {
                Ok(resp) => {
                    log::info!(
                        "Resume download: {}, already downloaded {} bytes",
                        item.url,
                        downloaded_size
                    );
                    download_delta += downloaded_size;
                    resp
                }
                Err(e) => {
                    // fallback to normal download
                    log::warn!("Failed to resume download: {}", e);
                    resume = false;
                    _get_maybe_resume(&client, &item.url, 0).await?
                }
            }
        } else {
            _get_maybe_resume(&client, &item.url, 0).await?
        };
        let mut stream = resp.bytes_stream();

        let file = if resume {
            // resume download, append to existing file
            tokio::fs::OpenOptions::new()
                .write(true)
                .append(true)
                .open(&tmp_save_path)
                .await
                .map_err(err_to_string)?
        } else {
            // start new download, create a new file
            File::create(&tmp_save_path).await.map_err(err_to_string)?
        };
        let mut writer = tokio::io::BufWriter::new(file);

        // write chunk to file
        while let Some(chunk) = stream.next().await {
            if cancel_token.is_cancelled() {
                log::info!("Download cancelled for task: {}", task_id);
                app.emit(&evt_name, evt.clone()).unwrap();
                return Ok(());
            }

            let chunk = chunk.map_err(err_to_string)?;
            writer.write_all(&chunk).await.map_err(err_to_string)?;
            download_delta += chunk.len() as u64;

            // only update every 10 MB
            if download_delta >= 10 * 1024 * 1024 {
                evt.transferred += download_delta;
                app.emit(&evt_name, evt.clone()).unwrap();
                download_delta = 0u64;
            }
        }

        writer.flush().await.map_err(err_to_string)?;
        evt.transferred += download_delta;

        // rename tmp file to final file
        tokio::fs::rename(&tmp_save_path, &save_path)
            .await
            .map_err(err_to_string)?;
        tokio::fs::remove_file(&url_save_path)
            .await
            .map_err(err_to_string)?;
        log::info!("Finished downloading: {}", item.url);
    }

    app.emit(&evt_name, evt.clone()).unwrap();
    Ok(())
}

async fn _get_maybe_resume(
    client: &reqwest::Client,
    url: &str,
    start_bytes: u64,
) -> Result<reqwest::Response, String> {
    if start_bytes > 0 {
        let resp = client
            .get(url)
            .header("Range", format!("bytes={}-", start_bytes))
            .send()
            .await
            .map_err(err_to_string)?;
        if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
            return Err(format!(
                "Failed to resume download: HTTP status {}, {}",
                resp.status(),
                resp.text().await.unwrap_or_default()
            ));
        }
        Ok(resp)
    } else {
        let resp = client.get(url).send().await.map_err(err_to_string)?;
        if !resp.status().is_success() {
            return Err(format!(
                "Failed to download: HTTP status {}, {}",
                resp.status(),
                resp.text().await.unwrap_or_default()
            ));
        }
        Ok(resp)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

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
        assert!(create_proxy_from_config(&config).is_ok());
    }

    #[test]
    fn test_download_item_creation() {
        let item = DownloadItem {
            url: "https://example.com/file.tar.gz".to_string(),
            save_path: "models/test.tar.gz".to_string(),
            proxy: None,
        };

        assert_eq!(item.url, "https://example.com/file.tar.gz");
        assert_eq!(item.save_path, "models/test.tar.gz");
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
}
