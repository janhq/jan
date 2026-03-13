use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::time::{sleep, Duration};

use app_lib::core::cli::{init_llamacpp_state, init_mlx_state};
use app_lib::core::server::proxy;
use app_lib::core::server::web_search::{execute_web_search, format_search_results};
use app_lib::core::state::{ProviderConfig, ProviderCustomHeader, ServerHandle};
use reqwest::Client;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    env_logger::init();

    // ── 1. DuckDuckGo sanity check ────────────────────────────────────────
    println!("=== DuckDuckGo sanity check ===");
    let client = Client::new();
    let results = execute_web_search(&client, "Bittensor TAO cryptocurrency").await;
    if results.is_empty() {
        eprintln!("ERROR: DuckDuckGo returned 0 results.");
        std::process::exit(1);
    }
    println!("DuckDuckGo OK — {} results\n", results.len());

    // ── 2. Start proxy ────────────────────────────────────────────────────
    let llama_state  = init_llamacpp_state();
    let mlx_state    = init_mlx_state();
    let sessions     = llama_state.llama_server_process.clone();
    let mlx_sessions = mlx_state.mlx_server_process.clone();
    let server_handle: Arc<Mutex<Option<ServerHandle>>> = Arc::new(Mutex::new(None));

    let mut configs = HashMap::new();
    configs.insert("anthropic".to_string(), ProviderConfig {
        provider: "anthropic".to_string(),
        api_key: None,
        base_url: Some("https://api.anthropic.com/v1".to_string()),
        custom_headers: vec![ProviderCustomHeader {
            header: "anthropic-version".to_string(),
            value: "2023-06-01".to_string(),
        }],
        models: vec![
            "claude-opus-4-5-20251101".to_string(),
            "claude-sonnet-4-5-20250929".to_string(),
            "claude-haiku-4-5-20251001".to_string(),
            "claude-opus-4-20250514".to_string(),
            "claude-opus-4-6".to_string(),
            "claude-sonnet-4-6".to_string(),
            "claude-sonnet-4-20250514".to_string(),
        ],
    });

    println!("=== Starting Jan proxy on localhost:1337 ===");
    let port = proxy::start_server(
        server_handle,
        sessions,
        mlx_sessions,
        "127.0.0.1".to_string(),
        1337,
        "/v1".to_string(),
        "".to_string(),
        vec![vec!["localhost".to_string(), "127.0.0.1".to_string()]],
        30,
        Arc::new(Mutex::new(configs)),
    ).await?;

    println!("Proxy listening on port {port} — waiting for Claude Code...");
    loop { sleep(Duration::from_secs(60)).await; }
}
