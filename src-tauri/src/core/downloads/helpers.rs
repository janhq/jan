use super::models::{DownloadEvent, DownloadItem, ProxyConfig};
use crate::core::app::commands::get_jan_data_folder_path;
use futures_util::StreamExt;
use jan_utils::normalize_path;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use std::collections::HashMap;
use std::time::Duration;
use tauri::Emitter;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;
use url::Url;

pub fn err_to_string<E: std::fmt::Display>(e: E) -> String {
    format!("Error: {}", e)
}

pub fn validate_proxy_config(config: &ProxyConfig) -> Result<(), String> {
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

pub fn create_proxy_from_config(config: &ProxyConfig) -> Result<reqwest::Proxy, String> {
    // Validate the configuration first
    validate_proxy_config(config)?;

    let mut proxy = reqwest::Proxy::all(&config.url).map_err(err_to_string)?;

    // Add authentication if provided
    if let (Some(username), Some(password)) = (&config.username, &config.password) {
        proxy = proxy.basic_auth(username, password);
    }

    Ok(proxy)
}

pub fn should_bypass_proxy(url: &str, no_proxy: &[String]) -> bool {
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

pub fn _get_client_for_item(
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

pub fn _convert_headers(
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

pub async fn _get_file_size(
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

pub async fn _download_files_internal(
    app: tauri::AppHandle,
    items: &[DownloadItem],
    headers: &HashMap<String, String>,
    task_id: &str,
    resume: bool,
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

        let mut should_resume = resume
            && tmp_save_path.exists()
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
        let resp = if should_resume {
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
                    should_resume = false;
                    _get_maybe_resume(&client, &item.url, 0).await?
                }
            }
        } else {
            _get_maybe_resume(&client, &item.url, 0).await?
        };
        let mut stream = resp.bytes_stream();

        let file = if should_resume {
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
                if !should_resume {
                    tokio::fs::remove_dir_all(&save_path.parent().unwrap())
                        .await
                        .ok();
                }
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

pub async fn _get_maybe_resume(
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
