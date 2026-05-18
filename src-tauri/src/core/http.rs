use futures_util::StreamExt;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::ipc::Channel;

// #region agent log
fn dbg_log(message: &str, data: &str) {
    use std::io::Write;
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let line = format!(
        "{{\"sessionId\":\"4aeb88\",\"location\":\"http.rs:stream_local_http\",\"message\":\"{}\",\"data\":{},\"timestamp\":{}}}\n",
        message, data, ts
    );
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open("/Users/misha/Work/Atomic/Atomic-Chat/.cursor/debug-4aeb88.log")
    {
        let _ = f.write_all(line.as_bytes());
    }
}
// #endregion

fn shared_stream_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(600))
            .timeout(Duration::from_secs(600))
            .pool_max_idle_per_host(10)
            .pool_idle_timeout(Duration::from_secs(30))
            .tcp_keepalive(Some(Duration::from_secs(30)))
            .no_proxy()
            .build()
            .expect("stream HTTP client")
    })
}

fn shared_post_client(timeout_secs: u64) -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(timeout_secs))
        .timeout(Duration::from_secs(timeout_secs))
        .pool_max_idle_per_host(10)
        .pool_idle_timeout(Duration::from_secs(30))
        .tcp_keepalive(Some(Duration::from_secs(30)))
        .no_proxy()
        .build()
        .expect("post HTTP client")
}

#[derive(serde::Serialize, Clone)]
pub struct HttpStreamChunk {
    pub data: String,
}

/// Simple non-streaming HTTP POST that returns the full response body as text.
/// Bypasses tauri_plugin_http's fetch interception which may not properly
/// deliver response bodies to the webview.
#[tauri::command]
pub async fn post_local_http(
    url: String,
    headers: HashMap<String, String>,
    body: String,
    timeout_secs: u64,
) -> Result<String, String> {
    let client = shared_post_client(timeout_secs);

    let mut req = client.post(&url);
    for (k, v) in &headers {
        req = req.header(k.as_str(), v.as_str());
    }
    req = req.body(body);

    let response = req.send().await.map_err(|e| format!("Request failed: {e}"))?;
    let status = response.status().as_u16();
    let text = response.text().await.map_err(|e| format!("Body read failed: {e}"))?;

    if status >= 400 {
        return Err(format!("HTTP {status}: {text}"));
    }

    Ok(text)
}

/// Streams an HTTP POST response back to the frontend via a Tauri IPC Channel.
/// Bypasses tauri_plugin_http's fetch interception, which may not properly
/// bridge ReadableStream for SSE responses in the webview.
#[tauri::command]
pub async fn stream_local_http(
    url: String,
    headers: HashMap<String, String>,
    body: String,
    _timeout_secs: u64,
    on_chunk: Channel<HttpStreamChunk>,
) -> Result<u16, String> {
    // #region agent log
    let t_cmd_start = std::time::Instant::now();
    let body_summary: String = match serde_json::from_str::<serde_json::Value>(body.as_str()) {
        Ok(v) => {
            let keys: Vec<String> = v
                .as_object()
                .map(|o| o.keys().cloned().collect())
                .unwrap_or_default();
            let ctk = v
                .get("chat_template_kwargs")
                .map(|x| x.to_string())
                .unwrap_or_else(|| "null".to_string());
            let rb = v
                .get("reasoning_budget")
                .map(|x| x.to_string())
                .unwrap_or_else(|| "null".to_string());
            let re = v
                .get("reasoning_effort")
                .map(|x| x.to_string())
                .unwrap_or_else(|| "null".to_string());
            let sys_preview: String = v
                .get("messages")
                .and_then(|m| m.as_array())
                .and_then(|arr| arr.first())
                .and_then(|first| first.get("content"))
                .and_then(|c| c.as_str())
                .map(|s| {
                    let slice: &str = if s.len() > 300 { &s[..300] } else { s };
                    format!("{:?}", slice)
                })
                .unwrap_or_else(|| "null".to_string());
            format!(
                "{{\"keys\":{:?},\"chat_template_kwargs\":{},\"reasoning_budget\":{},\"reasoning_effort\":{},\"sysPromptPreview\":{}}}",
                keys, ctk, rb, re, sys_preview
            )
        }
        Err(_) => "{\"parse\":\"failed\"}".to_string(),
    };
    dbg_log(
        "cmd_start",
        &format!(
            "{{\"url\":\"{}\",\"bodyLen\":{},\"summary\":{}}}",
            url,
            body.len(),
            body_summary
        ),
    );
    // #endregion
    let client = shared_stream_client();

    let mut req = client.post(&url);
    for (k, v) in &headers {
        req = req.header(k.as_str(), v.as_str());
    }
    req = req.body(body);

    // #region agent log
    dbg_log(
        "before_send",
        &format!("{{\"sinceCmdStartMs\":{}}}", t_cmd_start.elapsed().as_millis()),
    );
    // #endregion
    let response = req
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;
    let status = response.status().as_u16();
    // #region agent log
    dbg_log(
        "after_send_headers",
        &format!(
            "{{\"sinceCmdStartMs\":{},\"status\":{}}}",
            t_cmd_start.elapsed().as_millis(),
            status
        ),
    );
    // #endregion

    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {text}"));
    }

    let mut stream = response.bytes_stream();
    let mut chunks_logged = 0u8;
    while let Some(chunk_result) = stream.next().await {
        match chunk_result {
            Ok(bytes) => {
                // #region agent log
                if chunks_logged < 5 {
                    chunks_logged += 1;
                    let preview = {
                        let s = String::from_utf8_lossy(&bytes);
                        let slice: &str = if s.len() > 400 { &s[..400] } else { &s };
                        format!("{:?}", slice)
                    };
                    dbg_log(
                        if chunks_logged == 1 { "first_chunk" } else { "next_chunk" },
                        &format!(
                            "{{\"sinceCmdStartMs\":{},\"bytes\":{},\"idx\":{},\"preview\":{}}}",
                            t_cmd_start.elapsed().as_millis(),
                            bytes.len(),
                            chunks_logged,
                            preview
                        ),
                    );
                }
                // #endregion
                let text = String::from_utf8_lossy(&bytes).to_string();
                if let Err(e) = on_chunk.send(HttpStreamChunk { data: text }) {
                    log::debug!("Channel closed by receiver: {e}");
                    break;
                }
            }
            Err(e) => {
                return Err(format!("Stream error: {e}"));
            }
        }
    }

    Ok(status)
}
