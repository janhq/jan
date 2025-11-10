use reqwest::multipart;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
    pub headers: HashMap<String, String>,
}

/// Make a POST request with multipart/form-data
/// This bypasses CORS restrictions by making the request from the backend
#[tauri::command]
pub async fn http_post_multipart(
    url: String,
    query_params: HashMap<String, String>,
    audio_data: Vec<u8>,
    audio_filename: String,
    field_name: String,
    headers: Option<HashMap<String, String>>,
) -> Result<HttpResponse, String> {
    log::info!("Making HTTP POST multipart request to: {}", url);

    // Build the client
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300)) // 5 minutes timeout
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Build the URL with query parameters
    let mut url_builder = reqwest::Url::parse(&url)
        .map_err(|e| format!("Invalid URL: {}", e))?;

    for (key, value) in query_params {
        url_builder.query_pairs_mut().append_pair(&key, &value);
    }

    // Create multipart form
    let part = multipart::Part::bytes(audio_data)
        .file_name(audio_filename)
        .mime_str("audio/webm")
        .map_err(|e| format!("Failed to set mime type: {}", e))?;

    let form = multipart::Form::new()
        .part(field_name, part);

    // Build the request
    let mut request_builder = client
        .post(url_builder.as_str())
        .multipart(form);

    // Add custom headers if provided
    if let Some(custom_headers) = headers {
        for (key, value) in custom_headers {
            request_builder = request_builder.header(&key, value);
        }
    }

    // Execute the request
    let response = request_builder
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    // Extract status and headers
    let status = response.status().as_u16();
    let response_headers: HashMap<String, String> = response
        .headers()
        .iter()
        .map(|(k, v)| {
            (
                k.as_str().to_string(),
                v.to_str().unwrap_or("").to_string(),
            )
        })
        .collect();

    // Get the response body
    let body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    log::info!("HTTP request completed with status: {}", status);

    Ok(HttpResponse {
        status,
        body,
        headers: response_headers,
    })
}
