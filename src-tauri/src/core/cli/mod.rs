//! CLI adapter layer — thin wrappers that call core logic without an AppHandle.
//!
//! This module is only compiled when the `cli` feature is enabled.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::core::app::commands::{resolve_config_file_path, resolve_jan_data_folder};
use crate::core::server::proxy;
use crate::core::state::AppState;
use crate::core::threads::{
    constants::THREADS_FILE,
    helpers::read_messages_from_file,
    utils::{ensure_data_dirs, get_data_dir, get_thread_dir, get_thread_metadata_path},
};
use tauri_plugin_llamacpp::state::LlamacppState;
use tauri_plugin_mlx::state::MlxState;

// Re-export impl functions and config types so the binary can call them directly
pub use tauri_plugin_llamacpp::{load_llama_model_impl, LlamacppConfig};
pub use tauri_plugin_mlx::{load_mlx_model_impl, MlxConfig};
pub use tauri_plugin_mlx::state::SessionInfo;

// ── State constructors ─────────────────────────────────────────────────────

pub fn init_app_state() -> AppState {
    AppState::default()
}

pub fn init_llamacpp_state() -> LlamacppState {
    LlamacppState::new()
}

pub fn init_mlx_state() -> MlxState {
    MlxState::new()
}

// ── Thread operations ──────────────────────────────────────────────────────

/// List all threads from the Jan data folder.
pub async fn cli_list_threads() -> Result<Vec<serde_json::Value>, String> {
    use std::fs;

    let data_folder = resolve_jan_data_folder();
    ensure_data_dirs(&data_folder)?;
    let data_dir = get_data_dir(&data_folder);
    let mut threads = Vec::new();

    if !data_dir.exists() {
        return Ok(threads);
    }

    for entry in fs::read_dir(&data_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            let metadata_path = path.join(THREADS_FILE);
            if metadata_path.exists() {
                let data = fs::read_to_string(&metadata_path).map_err(|e| e.to_string())?;
                if let Ok(thread) = serde_json::from_str(&data) {
                    threads.push(thread);
                }
            }
        }
    }

    Ok(threads)
}

/// List messages for a thread.
pub fn cli_list_messages(thread_id: &str) -> Result<Vec<serde_json::Value>, String> {
    let data_folder = resolve_jan_data_folder();
    read_messages_from_file(&data_folder, thread_id)
}

/// Delete a thread directory.
pub fn cli_delete_thread(thread_id: &str) -> Result<(), String> {
    use std::fs;

    let data_folder = resolve_jan_data_folder();
    let thread_dir = get_thread_dir(&data_folder, thread_id);
    if thread_dir.exists() {
        fs::remove_dir_all(thread_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Get thread metadata by ID.
pub fn cli_get_thread(thread_id: &str) -> Result<serde_json::Value, String> {
    let data_folder = resolve_jan_data_folder();
    let path = get_thread_metadata_path(&data_folder, thread_id);
    if !path.exists() {
        return Err(format!("Thread '{thread_id}' not found"));
    }
    let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

// ── Server operations ──────────────────────────────────────────────────────

/// Start the OpenAI-compatible proxy server. Returns the port it's listening on.
pub async fn cli_start_server(
    app_state: Arc<AppState>,
    llama_state: Arc<LlamacppState>,
    mlx_state: Arc<MlxState>,
    host: String,
    port: u16,
    prefix: String,
    api_key: String,
    proxy_timeout: u64,
) -> Result<u16, String> {
    proxy::start_server(
        app_state.server_handle.clone(),
        llama_state.llama_server_process.clone(),
        mlx_state.mlx_server_process.clone(),
        host,
        port,
        prefix,
        api_key,
        vec![vec![]],
        proxy_timeout,
        app_state.provider_configs.clone(),
    )
    .await
    .map_err(|e| e.to_string())
}

/// Stop the running proxy server.
pub async fn cli_stop_server(app_state: Arc<AppState>) -> Result<(), String> {
    proxy::stop_server(app_state.server_handle.clone())
        .await
        .map_err(|e| e.to_string())
}

/// Check whether the proxy server is currently running.
pub async fn cli_is_server_running(app_state: Arc<AppState>) -> bool {
    proxy::is_server_running(app_state.server_handle.clone()).await
}

// ── Model discovery ───────────────────────────────────────────────────────

/// Parsed representation of a `model.yml` file.
#[derive(Debug, serde::Deserialize)]
pub struct ModelYml {
    pub model_path: String,
    pub name: Option<String>,
    #[serde(default)]
    pub size_bytes: u64,
    #[serde(default)]
    pub embedding: bool,
    pub mmproj_path: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
}

/// A discovered model entry: `(model_id, yml)`.
pub type ModelEntry = (String, ModelYml);

/// Scan `<data_folder>/<engine>/models/` for `model.yml` files.
///
/// `engine` is `"llamacpp"` or `"mlx"`. Returns one entry per model found.
pub fn list_models(engine: &str) -> Vec<ModelEntry> {
    use std::fs;

    let data_folder = resolve_jan_data_folder();
    let models_root = data_folder.join(engine).join("models");

    if !models_root.exists() {
        return Vec::new();
    }

    let mut results = Vec::new();
    let mut stack = vec![models_root.clone()];

    while let Some(dir) = stack.pop() {
        let yml_path = dir.join("model.yml");
        if yml_path.exists() {
            if let Ok(content) = fs::read_to_string(&yml_path) {
                if let Ok(yml) = serde_yaml::from_str::<ModelYml>(&content) {
                    // model_id = path relative to models_root
                    let model_id = dir
                        .strip_prefix(&models_root)
                        .unwrap_or(&dir)
                        .to_string_lossy()
                        .into_owned();
                    results.push((model_id, yml));
                    continue; // don't recurse into a model directory
                }
            }
        }
        // Recurse into subdirectories
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    stack.push(entry.path());
                }
            }
        }
    }

    results.sort_by(|a, b| a.0.cmp(&b.0));
    results
}

/// Detect which engine owns `model_id` by probing the data folder, and
/// resolve its paths.  Tries `llamacpp` first, then `mlx`.
/// Returns `(engine, model_path, mmproj_path)`.
pub fn resolve_model_engine(
    model_id: &str,
) -> Result<(String, PathBuf, Option<PathBuf>), String> {
    let data_folder = resolve_jan_data_folder();
    for engine in &["llamacpp", "mlx"] {
        let yml_path = data_folder
            .join(engine)
            .join("models")
            .join(model_id)
            .join("model.yml");
        if yml_path.exists() {
            let (model_path, mmproj_path) = resolve_model_by_id(model_id, engine)?;
            return Ok((engine.to_string(), model_path, mmproj_path));
        }
    }
    Err(format!(
        "Model '{}' not found for any engine. \
        Run `jan-cli models list` or `jan-cli models list --engine mlx` to see available models.",
        model_id
    ))
}

/// Resolve the absolute model file path (and optional mmproj path) for a
/// given model ID and engine.
///
/// `model_path` in the YAML can be:
///   - absolute (`/…` or `C:\…`) — used verbatim
///   - relative — joined with the Jan data folder
pub fn resolve_model_by_id(
    model_id: &str,
    engine: &str,
) -> Result<(PathBuf, Option<PathBuf>), String> {
    let data_folder = resolve_jan_data_folder();
    let yml_path = data_folder
        .join(engine)
        .join("models")
        .join(model_id)
        .join("model.yml");

    if !yml_path.exists() {
        return Err(format!(
            "Model '{}' not found for engine '{}'. \
            Run `jan-cli models list` to see available models.",
            model_id, engine
        ));
    }

    let content = std::fs::read_to_string(&yml_path).map_err(|e| e.to_string())?;
    let yml: ModelYml = serde_yaml::from_str(&content).map_err(|e| e.to_string())?;

    let resolve_path = |p: &str| -> PathBuf {
        let pb = PathBuf::from(p);
        if pb.is_absolute() {
            pb
        } else {
            data_folder.join(p)
        }
    };

    let model_path = resolve_path(&yml.model_path);
    let mmproj_path = yml.mmproj_path.as_deref().map(resolve_path);

    Ok((model_path, mmproj_path))
}

// ── Binary auto-discovery ──────────────────────────────────────────────────

/// Find the llama-server binary inside the Jan data folder.
///
/// Walks `<data_folder>/llamacpp/backends/<version>/<backend>/` and checks
/// two locations per backend (same logic as the llamacpp-extension):
///   1. `<backend_dir>/build/bin/llama-server[.exe]`
///   2. `<backend_dir>/llama-server[.exe]`
///
/// Returns the first binary found, or `None` if no installed backend is found.
pub fn discover_llamacpp_binary() -> Option<PathBuf> {
    use std::fs;

    let data_folder = resolve_jan_data_folder();
    let backends_dir = data_folder.join("llamacpp").join("backends");

    if !backends_dir.exists() {
        return None;
    }

    let exe = if cfg!(windows) { "llama-server.exe" } else { "llama-server" };

    // Collect version directories, sorted descending so we prefer the latest.
    let mut version_entries: Vec<_> = fs::read_dir(&backends_dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .collect();
    version_entries.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

    for version_entry in version_entries {
        let version_dir = version_entry.path();
        let mut backend_entries: Vec<_> = fs::read_dir(&version_dir)
            .ok()?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .collect();
        backend_entries.sort_by(|a, b| a.file_name().cmp(&b.file_name()));

        for backend_entry in backend_entries {
            let backend_dir = backend_entry.path();

            // Primary location: <backend>/build/bin/llama-server
            let primary = backend_dir.join("build").join("bin").join(exe);
            if primary.exists() {
                return Some(primary);
            }

            // Fallback: <backend>/llama-server
            let fallback = backend_dir.join(exe);
            if fallback.exists() {
                return Some(fallback);
            }
        }
    }

    None
}

/// Find the mlx-server binary.
///
/// Checks standard locations in order:
///   1. `/Applications/Jan.app/Contents/Resources/bin/mlx-server` (installed app)
///   2. Next to the running binary (for dev/custom installs)
pub fn discover_mlx_binary() -> Option<PathBuf> {
    // 1. Standard macOS app bundle locations (try both path variants)
    for candidate in &[
        "/Applications/Jan.app/Contents/Resources/resources/bin/mlx-server",
        "/Applications/Jan.app/Contents/Resources/bin/mlx-server",
    ] {
        let p = PathBuf::from(candidate);
        if p.exists() {
            return Some(p);
        }
    }

    // 2. Next to the current executable (useful for dev builds / custom installs)
    if let Ok(exe_dir) = std::env::current_exe().map(|p| p.parent().map(|d| d.to_path_buf()).unwrap_or_default()) {
        let next_to_bin = exe_dir.join("mlx-server");
        if next_to_bin.exists() {
            return Some(next_to_bin);
        }
    }

    None
}

// ── HuggingFace download ───────────────────────────────────────────────────

/// A single file entry from a HuggingFace repository.
#[derive(Debug, Clone)]
pub struct HfFileInfo {
    /// Original filename in the repo (e.g. `qwen3-30b.Q4_K_M.gguf`)
    pub filename: String,
    /// Total size in bytes (from HF metadata or LFS pointer)
    pub size: u64,
    /// SHA-256 from the LFS pointer, used for integrity validation
    pub sha256: Option<String>,
    /// Direct download URL (`https://huggingface.co/{repo}/resolve/main/{file}`)
    pub download_url: String,
}

/// Return `true` if `s` looks like a HuggingFace repo ID (`owner/repo`).
///
/// A valid HF repo ID has exactly one `/`, both parts non-empty, no
/// filesystem path markers, and only alphanumeric / `-` / `_` / `.` chars.
pub fn looks_like_hf_repo(s: &str) -> bool {
    if s.starts_with('/') || s.starts_with('.') || s.starts_with('~') {
        return false;
    }
    let Some((owner, name)) = s.split_once('/') else {
        return false;
    };
    if owner.is_empty() || name.is_empty() || name.contains('/') {
        return false;
    }
    let ok = |c: char| c.is_alphanumeric() || matches!(c, '-' | '_' | '.');
    owner.chars().all(ok) && name.chars().all(ok)
}

/// Fetch the list of GGUF files available in a HuggingFace repository.
///
/// Results are sorted by size ascending so smaller quantizations appear first.
/// Passes `hf_token` as a Bearer token when provided.
pub async fn fetch_hf_gguf_files(
    repo_id: &str,
    hf_token: Option<&str>,
) -> Result<Vec<HfFileInfo>, String> {
    let url = format!(
        "https://huggingface.co/api/models/{}?blobs=true&files_metadata=true",
        repo_id
    );

    let client = reqwest::Client::new();
    let mut req = client.get(&url);
    if let Some(tok) = hf_token {
        req = req.bearer_auth(tok);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status();

    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 403 => format!(
                "HuggingFace returned {status} for '{repo_id}'. \
                The repo may be gated — set the HF_TOKEN environment variable."
            ),
            404 => format!(
                "HuggingFace repo '{repo_id}' not found. \
                Check the repo ID or run `jan models list` to see local models."
            ),
            _ => format!("HuggingFace API error {status} for '{repo_id}'."),
        });
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let siblings = body["siblings"]
        .as_array()
        .ok_or_else(|| "Unexpected HuggingFace API response format".to_string())?;

    let mut files: Vec<HfFileInfo> = siblings
        .iter()
        .filter_map(|s| {
            let name = s["rfilename"].as_str()?;
            if !name.to_lowercase().ends_with(".gguf") {
                return None;
            }
            // Prefer LFS size, fall back to top-level size field
            let size = s["lfs"]["size"]
                .as_u64()
                .or_else(|| s["size"].as_u64())
                .unwrap_or(0);
            let sha256 = s["lfs"]["sha256"].as_str().map(str::to_owned);
            let download_url = format!(
                "https://huggingface.co/{}/resolve/main/{}",
                repo_id, name
            );
            Some(HfFileInfo {
                filename: name.to_owned(),
                size,
                sha256,
                download_url,
            })
        })
        .collect();

    if files.is_empty() {
        return Err(format!(
            "No GGUF files found in HuggingFace repo '{repo_id}'. \
            For MLX/safetensors repos use `jan models load-mlx`."
        ));
    }

    // Smaller quantizations first
    files.sort_by_key(|f| f.size);
    Ok(files)
}

/// Download one GGUF file from HuggingFace and write a `model.yml` for it.
///
/// The model is stored at:
/// `<data_folder>/llamacpp/models/<repo_id>/<filename>`
///
/// `on_progress(downloaded, total)` is called after each chunk.
/// Returns the local model ID (same as `repo_id`).
pub async fn download_hf_model(
    repo_id: &str,
    file: &HfFileInfo,
    hf_token: Option<&str>,
    on_progress: impl Fn(u64, u64) + Send,
) -> Result<String, String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let data_folder = resolve_jan_data_folder();
    let model_dir = data_folder
        .join("llamacpp")
        .join("models")
        .join(repo_id);
    tokio::fs::create_dir_all(&model_dir)
        .await
        .map_err(|e| e.to_string())?;

    let dest_path = model_dir.join(&file.filename);

    // ── Download ──────────────────────────────────────────────────────────
    let client = reqwest::Client::new();
    let mut req = client.get(&file.download_url);
    if let Some(tok) = hf_token {
        req = req.bearer_auth(tok);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Download request failed: {}", resp.status()));
    }

    // Use the server-reported content-length, fall back to metadata size
    let total = resp.content_length().unwrap_or(file.size);
    let mut downloaded: u64 = 0;

    let mut dest = tokio::fs::File::create(&dest_path)
        .await
        .map_err(|e| e.to_string())?;

    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        dest.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        on_progress(downloaded, total);
    }
    dest.flush().await.map_err(|e| e.to_string())?;

    // ── Write model.yml ───────────────────────────────────────────────────
    // model_path is relative to the Jan data folder
    let rel_path = format!(
        "llamacpp/models/{}/{}",
        repo_id, file.filename
    );
    let display_name = repo_id.split('/').last().unwrap_or(repo_id);

    let mut yml = format!(
        "model_path: {rel_path}\nname: {display_name}\nsize_bytes: {}\nembedding: false\n",
        file.size
    );
    if let Some(sha) = &file.sha256 {
        yml.push_str(&format!("model_sha256: {sha}\n"));
    }

    tokio::fs::write(model_dir.join("model.yml"), yml)
        .await
        .map_err(|e| e.to_string())?;

    Ok(repo_id.to_string())
}

// ── App config ────────────────────────────────────────────────────────────

pub fn cli_get_data_folder() -> PathBuf {
    resolve_jan_data_folder()
}

pub fn cli_get_config() -> Result<serde_json::Value, String> {
    let path = resolve_config_file_path();
    if !path.exists() {
        return Err(format!("Config file not found at: {}", path.display()));
    }
    let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}
