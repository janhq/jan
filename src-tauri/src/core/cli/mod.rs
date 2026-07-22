//! CLI adapter layer — thin wrappers that call core logic without an AppHandle.
//!
//! This module is only compiled when the `cli` feature is enabled.

pub mod mcp;
pub mod preset;
pub mod providers;
mod path_refs;
mod tui;

use std::path::PathBuf;
use std::sync::Arc;

use crate::core::app::commands::{resolve_config_file_path, resolve_jan_data_folder};
use crate::core::server::proxy;
use crate::core::state::AppState;
use crate::core::threads::{
    constants::THREADS_FILE,
    helpers::{read_messages_from_file, update_thread_metadata, write_messages_to_file},
    utils::{
        ensure_data_dirs, get_data_dir, get_messages_path, get_thread_dir,
        get_thread_metadata_path,
    },
};
use tauri_plugin_llamacpp::router as llamacpp_router;
use tauri_plugin_llamacpp::state::LlamacppState;
#[cfg(target_os = "macos")]
use tauri_plugin_mlx::state::MlxState;

#[cfg(target_os = "macos")]
pub use tauri_plugin_mlx::state::SessionInfo;
#[cfg(target_os = "macos")]
pub use tauri_plugin_mlx::{load_mlx_model_impl, MlxConfig};

// ── State constructors ─────────────────────────────────────────────────────

pub fn init_llamacpp_state() -> LlamacppState {
    LlamacppState::new()
}

#[cfg(target_os = "macos")]
pub fn init_mlx_state() -> MlxState {
    MlxState::new()
}

// ── Thread operations ──────────────────────────────────────────────────────

/// List thread metadata under `<base>/threads/`. `base` is the Jan data folder
/// (desktop store) or a project's `.jan/agent` dir (TUI store).
pub fn list_threads_in(base: &std::path::Path) -> Result<Vec<serde_json::Value>, String> {
    use std::fs;

    let data_dir = get_data_dir(base);
    let mut threads = Vec::new();
    if !data_dir.exists() {
        return Ok(threads);
    }
    for entry in fs::read_dir(&data_dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
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

/// List all threads from the Jan data folder (desktop store).
pub async fn cli_list_threads() -> Result<Vec<serde_json::Value>, String> {
    let data_folder = resolve_jan_data_folder();
    ensure_data_dirs(&data_folder)?;
    list_threads_in(&data_folder)
}

/// Read a thread's messages from `<base>/threads/<id>/messages.jsonl`.
pub fn cli_list_messages_in(
    base: &std::path::Path,
    thread_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    read_messages_from_file(base, thread_id)
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
    crate::core::agent::git::cleanup_snapshot_index(thread_id);
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

/// Persist a TUI conversation as a desktop-compatible thread so it appears in
/// `/resume` and the desktop app. `history` is OpenAI-shaped (`{role, content}`);
/// it is written as `thread.message` records plus `thread.json` metadata. Pass
/// an existing `thread_id` to update that thread, or `None` to create one
/// (returns the id). Title/created are preserved when updating.
pub fn cli_save_thread(
    base: &std::path::Path,
    thread_id: Option<&str>,
    model: &str,
    history: &[serde_json::Value],
    metadata: Option<serde_json::Value>,
) -> Result<String, String> {
    if history.is_empty() {
        return Err("empty conversation".to_string());
    }
    ensure_data_dirs(base)?;
    let id = thread_id
        .map(str::to_string)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(get_thread_dir(base, &id)).map_err(|e| e.to_string())?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let now_ms = now.as_millis() as i64;
    let now_secs = now.as_secs_f64();

    let messages: Vec<serde_json::Value> = history
        .iter()
        .filter_map(|m| {
            let role = m.get("role").and_then(|v| v.as_str())?;
            let content = openai_content_text(m.get("content"));
            Some(serde_json::json!({
                "id": uuid::Uuid::new_v4().to_string(),
                "object": "thread.message",
                "thread_id": id,
                "role": role,
                "type": "text",
                "status": "ready",
                "created_at": now_ms,
                "completed_at": now_ms,
                "content": [{ "type": "text", "text": { "value": content, "annotations": [] } }],
            }))
        })
        .collect();
    write_messages_to_file(&messages, &get_messages_path(base, &id))?;

    let existing: Option<serde_json::Value> =
        std::fs::read_to_string(get_thread_metadata_path(base, &id))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok());
    let created = existing
        .as_ref()
        .and_then(|e| e.get("created").and_then(serde_json::Value::as_f64))
        .unwrap_or(now_secs);
    let title = existing
        .as_ref()
        .and_then(|e| e.get("title").and_then(|v| v.as_str()))
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| default_thread_title(history));

    // Preserve prior metadata when the caller passes none (e.g. a plain save with
    // no worktree state), so an update never drops isolation bookkeeping.
    let metadata = metadata
        .or_else(|| existing.as_ref().and_then(|e| e.get("metadata").cloned()))
        .unwrap_or_else(|| serde_json::json!({}));

    let thread = serde_json::json!({
        "id": id,
        "object": "thread",
        "title": title,
        "created": created,
        "updated": now_secs,
        "model": { "id": model, "provider": "" },
        "metadata": metadata,
    });
    update_thread_metadata(base, &id, &thread)?;
    Ok(id)
}

/// Persist a TUI `/model` choice to the project's `agent.toml` `[agent].model`,
/// so it is remembered on the next session (agent.toml wins over the desktop
/// default in the model-resolution order). `agent_dir` is `<project>/.jan/agent`.
pub fn cli_set_project_model(agent_dir: &std::path::Path, model: &str) -> Result<(), String> {
    set_model_in_agent_toml(&agent_dir.join("agent.toml"), model)
}

/// Text of an OpenAI-shaped message `content`: the string as-is, or the joined
/// `text` parts of a multimodal content array (image parts contribute nothing).
fn openai_content_text(content: Option<&serde_json::Value>) -> String {
    match content {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Array(parts)) => parts
            .iter()
            .filter(|p| p.get("type").and_then(|v| v.as_str()) == Some("text"))
            .filter_map(|p| p.get("text").and_then(|v| v.as_str()))
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

/// Fallback thread title: the first user message, whitespace-collapsed and
/// truncated. Used only when no summarized title exists yet.
fn default_thread_title(history: &[serde_json::Value]) -> String {
    let first_user = history
        .iter()
        .find(|m| m.get("role").and_then(|v| v.as_str()) == Some("user"))
        .map(|m| openai_content_text(m.get("content")))
        .unwrap_or_default();
    let collapsed = first_user.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return "Agent chat".to_string();
    }
    if collapsed.chars().count() > 50 {
        format!("{}…", collapsed.chars().take(49).collect::<String>())
    } else {
        collapsed
    }
}

// ── Server operations ──────────────────────────────────────────────────────

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
pub fn resolve_model_engine(model_id: &str) -> Result<(String, PathBuf, Option<PathBuf>), String> {
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
        Run `jan models list` to see available models.",
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
            Run `jan models list` to see available models.",
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

    let exe = if cfg!(windows) {
        "llama-server.exe"
    } else {
        "llama-server"
    };

    // Collect version directories, sorted descending so we prefer the latest.
    let mut version_entries: Vec<_> = fs::read_dir(&backends_dir)
        .ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .collect();
    version_entries.sort_by_key(|b| std::cmp::Reverse(b.file_name()));

    for version_entry in version_entries {
        let version_dir = version_entry.path();
        let mut backend_entries: Vec<_> = fs::read_dir(&version_dir)
            .ok()?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .collect();
        backend_entries.sort_by_key(|a| a.file_name());

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
#[cfg(target_os = "macos")]
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
    if let Ok(exe_dir) =
        std::env::current_exe().map(|p| p.parent().map(|d| d.to_path_buf()).unwrap_or_default())
    {
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
            let download_url = format!("https://huggingface.co/{}/resolve/main/{}", repo_id, name);
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
    let model_dir = data_folder.join("llamacpp").join("models").join(repo_id);
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
    let rel_path = format!("llamacpp/models/{}/{}", repo_id, file.filename);
    let display_name = repo_id.split('/').next_back().unwrap_or(repo_id);

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

// ── Agent operations ───────────────────────────────────────────────────────

use crate::core::agent::events::StreamEvent;
use crate::core::agent::project::{
    ensure_project, load_agent_config, permissions_from, set_model_in_agent_toml,
};
use crate::core::agent::r#loop::{
    run_orchestration_streamed, OrchestrationArgs, PermissionRegistry,
};
use crate::core::agent::tools::gate::PermissionDecision;
use crate::core::cli::providers::{load_provider_configs, ProviderOverrides};
use crate::core::mcp::models::McpSettings;
use std::collections::HashMap;
use std::io::Write as _;
use tokio::sync::{mpsc, Mutex};

/// Default turn cap when neither `--max-turns` nor `agent.toml [agent].max_turns`
/// is set. `0` means unbounded: the session token budget and user cancellation
/// guard the loop instead of a fixed step count, so runs aren't cut off
/// mid-task. Set an explicit cap to bound it.
const DEFAULT_MAX_TURNS: u32 = 0;

/// Resolve the `--project` flag (default `"."`) to an absolute path. The raw
/// value is what the model would otherwise see verbatim in the system prompt's
/// working-directory block, so a bare "." must become the real cwd rather than
/// being sent to the model as-is. Falls back to the raw (possibly relative)
/// path if canonicalization fails (e.g. the directory doesn't exist yet).
fn resolve_project_root(project: &str) -> PathBuf {
    PathBuf::from(project)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(project))
}

/// Resolved-config + provider snapshot for `jan agent status`.
pub fn cli_agent_status(
    project: &str,
    overrides: &ProviderOverrides,
) -> Result<serde_json::Value, String> {
    let project_root = resolve_project_root(project);
    ensure_project(&project_root)?;
    let cfg = load_agent_config(&project_root)?;
    let provider_configs = load_provider_configs(Some(&project_root), overrides)?;

    let mut providers: Vec<serde_json::Value> = provider_configs
        .values()
        .map(|c| {
            serde_json::json!({
                "provider": c.provider,
                "base_url": c.base_url,
                "has_api_key": c.api_key.is_some() || !c.api_keys.is_empty(),
                "models": c.models.len(),
            })
        })
        .collect();
    providers.sort_by(|a, b| a["provider"].as_str().cmp(&b["provider"].as_str()));

    Ok(serde_json::json!({
        "project": project_root.to_string_lossy(),
        "data_folder": resolve_jan_data_folder().to_string_lossy(),
        "model": cfg.agent.model,
        "max_turns": cfg.agent.max_turns.unwrap_or(DEFAULT_MAX_TURNS),
        "tools": {
            "default": cfg.tools.default,
            "allow": cfg.tools.allow,
            "deny": cfg.tools.deny,
            "allow_write": cfg.tools.allow_write,
        },
        "providers": providers,
    }))
}

/// Set (create or merge) a provider entry in the global `~/.jan/config.toml`,
/// the standalone-agent credential store. Returns the config path so the caller
/// can report where the value landed. Headless: no Desktop app required.
pub fn cli_agent_config_set(
    provider: &str,
    api_key: Option<String>,
    base_url: Option<String>,
    models: Option<Vec<String>>,
    api_type: Option<String>,
) -> Result<PathBuf, String> {
    crate::core::agent::global_config::set_provider(
        provider,
        crate::core::agent::global_config::ProviderUpdate {
            api_key,
            base_url,
            models,
            api_type,
        },
    )
}

/// Remove a provider entry from `~/.jan/config.toml`. `Ok(false)` means it was
/// already absent.
pub fn cli_agent_config_unset(provider: &str) -> Result<bool, String> {
    crate::core::agent::global_config::remove_provider(provider)
}

/// The global config file path, scaffolding a commented template if it doesn't
/// exist yet so `jan agent config path` always points at a real file.
pub fn cli_agent_config_path() -> Result<PathBuf, String> {
    crate::core::agent::global_config::ensure_global_config()
}

/// Providers configured in `~/.jan/config.toml`, as JSON with API keys redacted.
/// Reflects only the global store (what the user set), not Desktop inherit.
pub fn cli_agent_config_list() -> Result<serde_json::Value, String> {
    let configs = crate::core::agent::global_config::load_global_config()?;
    let mut providers: Vec<serde_json::Value> = configs
        .values()
        .map(|c| {
            serde_json::json!({
                "provider": c.provider,
                "base_url": c.base_url,
                "has_api_key": c.api_key.is_some(),
                "api_type": c.api_type,
                "models": c.models,
            })
        })
        .collect();
    providers.sort_by(|a, b| a["provider"].as_str().cmp(&b["provider"].as_str()));
    Ok(serde_json::json!({
        "config_path": crate::core::agent::global_config::global_config_path()?.to_string_lossy(),
        "providers": providers,
    }))
}

/// Autonomous multi-turn run to completion or the turn/token budget.
pub async fn cli_agent_run(
    project: &str,
    task: &str,
    model: Option<String>,
    max_turns: Option<u32>,
    overrides: ProviderOverrides,
    yolo: bool,
) -> Result<(), String> {
    run_agent_loop(project, task, model, max_turns, overrides, yolo).await
}

/// Single-turn run for debugging (`max_turns = 1`).
pub async fn cli_agent_step(
    project: &str,
    task: &str,
    model: Option<String>,
    overrides: ProviderOverrides,
    yolo: bool,
) -> Result<(), String> {
    run_agent_loop(project, task, model, Some(1), overrides, yolo).await
}

#[allow(clippy::too_many_arguments)]
fn build_cli_orchestration_args(
    project_root: PathBuf,
    permissions: crate::core::agent::permissions::ToolPermissions,
    provider_configs: HashMap<String, crate::core::state::ProviderConfig>,
    llama_state: Arc<LlamacppState>,
    mcp_servers: crate::core::state::SharedMcpServers,
    mcp_settings: McpSettings,
    permission_requests: PermissionRegistry,
    yolo: bool,
) -> OrchestrationArgs {
    OrchestrationArgs {
        client: reqwest::Client::new(),
        provider_configs: Arc::new(Mutex::new(provider_configs)),
        llama_state,
        mlx_sessions: Arc::new(Mutex::new(HashMap::new())),
        mcp_servers,
        mcp_settings: Arc::new(Mutex::new(mcp_settings)),
        jan_data_folder: resolve_jan_data_folder().to_string_lossy().into_owned(),
        permissions,
        project_root: Some(project_root),
        permission_requests,
        system_prompt_override: None,
        subagents_enabled: true,
        yolo,
    }
}

/// Model-load readiness timeout (seconds) for the router started on the agent
/// path. Generous: a cold local model can take a while to memory-map + warm up.
const AGENT_ROUTER_TIMEOUT_SECS: u64 = 300;

/// Pick a free TCP port on the loopback interface. The port is released
/// immediately; the router binds it moments later (standard, benign race).
fn pick_free_port() -> Result<u16, String> {
    let listener =
        std::net::TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    listener
        .local_addr()
        .map(|a| a.port())
        .map_err(|e| e.to_string())
}

/// When `model_id` resolves to a local llamacpp model, spawn a background task
/// that starts the router and loads the model into `llama_state`. Returns the
/// task handle so the caller can await readiness before the first turn without
/// blocking setup/render. Cloud (and MLX) models return `None` -- they either
/// hit an HTTP provider or a separately-managed session.
fn spawn_local_router_if_needed(
    model_id: &str,
    llama_state: &Arc<LlamacppState>,
) -> Option<tokio::task::JoinHandle<Result<(), String>>> {
    match resolve_model_engine(model_id) {
        Ok((engine, _, _)) if engine == "llamacpp" => {}
        _ => return None,
    }

    let llama_state = llama_state.clone();
    let model_id = model_id.to_string();
    Some(tokio::spawn(async move {
        let bin_path = discover_llamacpp_binary()
            .ok_or_else(|| {
                "llama-server binary not found; install a backend in the Jan desktop app".to_string()
            })?
            .to_string_lossy()
            .into_owned();
        let port = pick_free_port()?;
        ensure_router_and_load(
            &llama_state,
            &bin_path,
            &model_id,
            port,
            String::new(),
            false,
            HashMap::new(),
            AGENT_ROUTER_TIMEOUT_SECS,
        )
        .await
        .map(|_| ())
    }))
}

/// Await a spawned router-start task, flattening the join + inner errors.
async fn await_router_task(
    task: Option<tokio::task::JoinHandle<Result<(), String>>>,
) -> Result<(), String> {
    match task {
        Some(h) => h
            .await
            .map_err(|e| format!("router task failed: {e}"))?
            .map_err(|e| format!("failed to start local model: {e}")),
        None => Ok(()),
    }
}

/// Router endpoint + pid after [`ensure_router_and_load`].
pub struct RouterServeInfo {
    pub pid: i32,
    pub port: u16,
    #[allow(dead_code)]
    pub api_key: String,
}

/// Start the llama-server router (if not already running) against the generated
/// preset, then POST `/models/load` for `model_id`. Shared by `jan serve` and
/// the agent path so a local model has a live upstream to talk to. The preset is
/// generated on demand (see [`preset::ensure_router_preset`]) when the desktop
/// app hasn't produced one.
#[allow(clippy::too_many_arguments)]
pub async fn ensure_router_and_load(
    llama_state: &Arc<LlamacppState>,
    bin_path: &str,
    model_id: &str,
    port: u16,
    api_key: String,
    is_embedding: bool,
    envs: HashMap<String, String>,
    timeout: u64,
) -> Result<RouterServeInfo, String> {
    if is_embedding {
        return Err(
            "--embedding on the llamacpp engine requires router preset support; \
             use the desktop UI to load embedding models for now."
                .to_string(),
        );
    }

    let preset_path = preset::ensure_router_preset()?;

    let already_running = { llama_state.router.lock().await.is_some() };
    if !already_running {
        let router_api_key = if api_key.is_empty() {
            uuid::Uuid::new_v4().to_string()
        } else {
            api_key.clone()
        };
        let mut router_envs = envs.clone();
        router_envs
            .entry("LLAMA_ARG_TIMEOUT".to_string())
            .or_insert_with(|| timeout.to_string());

        let handle = llamacpp_router::start_router(
            PathBuf::from(bin_path),
            preset_path,
            port,
            router_api_key,
            0,
            Vec::new(),
            router_envs,
            None,
        )
        .await
        .map_err(|e| format!("{e:?}"))?;
        let mut guard = llama_state.router.lock().await;
        *guard = Some(handle);
    }

    let (router_port, router_key, router_pid) = {
        let guard = llama_state.router.lock().await;
        let h = guard
            .as_ref()
            .ok_or_else(|| "Router unexpectedly missing after start".to_string())?;
        (h.port, h.api_key.clone(), h.pid)
    };

    let url = format!("http://127.0.0.1:{router_port}/models/load");
    let resp = reqwest::Client::new()
        .post(&url)
        .header("Authorization", format!("Bearer {router_key}"))
        .json(&serde_json::json!({ "model": model_id }))
        .send()
        .await
        .map_err(|e| format!("Failed to POST {url}: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Router /models/load returned {status}: {body}"));
    }

    Ok(RouterServeInfo {
        pid: router_pid as i32,
        port: router_port,
        api_key: router_key,
    })
}

/// Everything needed to drive one agent run: the engine handle, request body,
/// and the shared permission registry. Built once and consumed by either the
/// plain CLI printer or the TUI renderer.
pub(crate) struct PreparedRun {
    pub args: OrchestrationArgs,
    pub body: serde_json::Value,
    pub permission_requests: PermissionRegistry,
    /// Background local-router startup, awaited before the first turn. `None`
    /// for cloud models.
    pub router_task: Option<tokio::task::JoinHandle<Result<(), String>>>,
    /// Background connect of `active` MCP servers, awaited before the first turn.
    pub mcp_task: Option<tokio::task::JoinHandle<Vec<String>>>,
}

/// Resolved engine handle for a chat session: the args are built once and the
/// request body is assembled per turn (the TUI reuses this across many turns;
/// the plain CLI builds a single body). `model`/`max_turns` seed each body.
pub(crate) struct AgentSession {
    pub args: OrchestrationArgs,
    pub permission_requests: PermissionRegistry,
    pub model: String,
    /// Fast model for the `smol` role (goal evaluation). Falls back to `model`.
    pub smol_model: String,
    pub max_turns: u32,
    /// Background local-router startup, awaited before the first turn. `None`
    /// for cloud models.
    pub router_task: Option<tokio::task::JoinHandle<Result<(), String>>>,
    /// Shared MCP connection map (same Arc held by `args`), so the TUI can
    /// connect/disconnect servers live via `/mcp` and later turns pick them up.
    pub mcp_servers: crate::core::state::SharedMcpServers,
    /// Background connect of `active` MCP servers, awaited before the first turn.
    /// `None` when no server is active. Resolves to the connected server names.
    pub mcp_task: Option<tokio::task::JoinHandle<Vec<String>>>,
}

impl AgentSession {
    /// Build a streaming request body for the given conversation history.
    pub(crate) fn body(&self, messages: serde_json::Value) -> serde_json::Value {
        serde_json::json!({
            "model": self.model,
            "messages": messages,
            "max_turns": self.max_turns,
            "stream": true,
        })
    }
}

/// Resolve project config + credentials into a ready-to-run engine handle.
/// Shared by `run_agent_loop` (plain CLI) and `cli_agent_ui` (TUI).
fn prepare_agent_session(
    project: &str,
    model_override: Option<String>,
    max_turns_override: Option<u32>,
    overrides: ProviderOverrides,
    yolo: bool,
) -> Result<AgentSession, String> {
    let project_root = resolve_project_root(project);
    ensure_project(&project_root)?;
    if let Err(e) = crate::core::agent::global_config::ensure_global_config() {
        log::warn!("Agent: could not scaffold ~/.jan/config.toml: {e}");
    }
    let cfg = load_agent_config(&project_root)?;
    let permissions = permissions_from(&cfg);

    if yolo {
        eprintln!(
            "WARNING: --yolo disables the sandbox. The agent can read, write, and run any command without asking for approval."
        );
    }

    // Resolution order: --model flag, then agent.toml [agent].model, then the
    // standalone global config (~/.jan/config.toml default_model / first provider
    // model), then the desktop app's currently-selected model (settings.json
    // inherit). Global config outranks desktop so a standalone agent is
    // self-sufficient without a desktop install.
    let model = model_override
        .or_else(|| cfg.agent.model.clone())
        .or_else(|| crate::core::agent::global_config::default_model().ok().flatten())
        .or_else(|| crate::core::cli::providers::desktop_selection().model)
        .ok_or_else(|| {
            "no model specified: pass --model, set [agent].model in agent.toml, set default_model in ~/.jan/config.toml, or select a model in the desktop app"
                .to_string()
        })?;
    let max_turns = max_turns_override
        .or(cfg.agent.max_turns)
        .unwrap_or(DEFAULT_MAX_TURNS);

    // The `smol` role (used by /goal evaluation): an explicit smol_model in
    // ~/.jan/config.toml, else reuse the main model so evaluation always works.
    let smol_model = crate::core::agent::global_config::smol_model()
        .ok()
        .flatten()
        .unwrap_or_else(|| model.clone());

    let provider_configs = load_provider_configs(Some(&project_root), &overrides)?;

    // A local llamacpp model needs its router started; cloud models are plain
    // HTTP upstreams. Start it off-thread so setup/render isn't blocked on the
    // model load; the caller awaits `router_task` before the first turn.
    let llama_state = Arc::new(init_llamacpp_state());
    let router_task = spawn_local_router_if_needed(&model, &llama_state);

    // MCP servers marked `active` in mcp_config.json connect off-thread so setup/
    // render isn't blocked on a cold stdio spawn. The caller awaits `mcp_task`
    // before the first turn (tools are collected once per run), so a race with
    // the first message can't leave the model without its MCP tools. `None` when
    // no server is active.
    let mcp_servers: crate::core::state::SharedMcpServers =
        Arc::new(Mutex::new(HashMap::new()));
    let mcp_settings = mcp::read_settings();
    let mcp_task = if mcp::active_count() > 0 {
        let servers = mcp_servers.clone();
        Some(tokio::spawn(
            async move { mcp::connect_active(&servers).await },
        ))
    } else {
        None
    };

    let permission_requests: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
    let args = build_cli_orchestration_args(
        project_root,
        permissions,
        provider_configs,
        llama_state,
        mcp_servers.clone(),
        mcp_settings,
        permission_requests.clone(),
        yolo,
    );

    Ok(AgentSession {
        args,
        permission_requests,
        model,
        smol_model,
        max_turns,
        router_task,
        mcp_servers,
        mcp_task,
    })
}

fn prepare_agent_run(
    project: &str,
    task: &str,
    model_override: Option<String>,
    max_turns_override: Option<u32>,
    overrides: ProviderOverrides,
    yolo: bool,
) -> Result<PreparedRun, String> {
    let session =
        prepare_agent_session(project, model_override, max_turns_override, overrides, yolo)?;
    let project_root = resolve_project_root(project);
    let (clean_task, injected) = path_refs::resolve_references(task, &project_root);
    let final_task = if injected.is_empty() {
        clean_task
    } else {
        format!("{clean_task}\n\n---\nReferenced file contents:\n\n{injected}")
    };
    let body = session.body(serde_json::json!([{ "role": "user", "content": final_task }]));
    // Emit resolved references stderr so the user sees what was injected
    if !injected.is_empty() {
        eprintln!("(resolved @path references)");
    }
    Ok(PreparedRun {
        args: session.args,
        body,
        permission_requests: session.permission_requests,
        router_task: session.router_task,
        mcp_task: session.mcp_task,
    })
}

async fn run_agent_loop(
    project: &str,
    task: &str,
    model_override: Option<String>,
    max_turns_override: Option<u32>,
    overrides: ProviderOverrides,
    yolo: bool,
) -> Result<(), String> {
    let PreparedRun {
        args,
        body,
        permission_requests,
        router_task,
        mcp_task,
    } = prepare_agent_run(project, task, model_override, max_turns_override, overrides, yolo)?;

    // Block until the local model is loaded (no-op for cloud models).
    await_router_task(router_task).await?;
    // Block until active MCP servers connect, so tools (collected once per run)
    // are present on the first turn.
    if let Some(task) = mcp_task {
        match task.await {
            Ok(names) if !names.is_empty() => {
                log::info!("MCP: connected {}", names.join(", "))
            }
            Ok(_) => {}
            Err(e) => log::warn!("MCP connect task failed: {e}"),
        }
    }

    let (tx, mut rx) = mpsc::unbounded_channel::<StreamEvent>();
    let printer = tokio::spawn(async move {
        while let Some(ev) = rx.recv().await {
            print_event(ev, &permission_requests).await;
        }
    });

    let result = run_orchestration_streamed(&tx, &body, &args).await;
    drop(tx);
    let _ = printer.await;
    result.map(|_| ())
}

/// Launch the interactive chat console (`jan agent ui`). An optional `task`
/// seeds the first turn; otherwise the user types the first message. Shares the
/// engine with `run_agent_loop` via `AgentSession` — only presentation differs.
pub async fn cli_agent_ui(
    project: &str,
    task: Option<String>,
    model: Option<String>,
    max_turns: Option<u32>,
    images: Vec<String>,
    overrides: ProviderOverrides,
    yolo: bool,
) -> Result<(), String> {
    let session = prepare_agent_session(project, model, max_turns, overrides, yolo)?;
    // TUI threads persist under the project's .jan/agent dir, separate from the
    // desktop store, so continuing here never mutates desktop threads.
    let project_root = resolve_project_root(project);
    let agent_dir = project_root.join(".jan").join("agent");
    tui::run(session, agent_dir, project_root, task, images).await
}

/// Render one `StreamEvent` for the terminal. Content tokens go to stdout so a
/// run can be piped; progress/diagnostics go to stderr. `PermissionRequest` is
/// resolved via the terminal (deny when non-interactive).
async fn print_event(ev: StreamEvent, registry: &PermissionRegistry) {
    match ev {
        StreamEvent::Token { text } => {
            print!("{text}");
            let _ = std::io::stdout().flush();
        }
        StreamEvent::Step { index, max } => eprintln!("\n\x1b[2m[turn {index}/{max}]\x1b[0m"),
        StreamEvent::ToolCall { name, args, .. } => eprintln!(
            "\x1b[2m[tool] {}\x1b[0m",
            crate::core::agent::events::describe_tool_call(&name, &args)
        ),
        StreamEvent::ToolResult {
            content, is_error, ..
        } => {
            let tag = if is_error {
                "tool-error"
            } else {
                "tool-result"
            };
            eprintln!("\x1b[2m[{tag}] {content}\x1b[0m");
        }
        StreamEvent::SubagentStart { name, .. } => {
            eprintln!("\x1b[2m[subagent:{name}] started (background)\x1b[0m")
        }
        StreamEvent::SubagentEnd { name, .. } => {
            eprintln!("\x1b[2m[subagent:{name}] finished\x1b[0m")
        }
        StreamEvent::Subagent { name, event, .. } => {
            if let StreamEvent::ToolCall { name: tool, args, .. } = *event {
                eprintln!(
                    "\x1b[2m[subagent:{name}] {}\x1b[0m",
                    crate::core::agent::events::describe_tool_call(&tool, &args)
                );
            }
        }
        StreamEvent::Done { stop_reason, usage } => {
            let tokens = usage.and_then(|u| u.total_tokens).unwrap_or(0);
            eprintln!("\n\x1b[2m[done] stop_reason={stop_reason} tokens={tokens}\x1b[0m");
        }
        StreamEvent::Error { code, message } => {
            eprintln!("\n\x1b[31m[error] {code}: {message}\x1b[0m")
        }
        // The non-interactive CLI doesn't persist session state, so
        // MessagesUpdated is a no-op here.
        StreamEvent::MessagesUpdated { .. } => {}
        StreamEvent::PermissionRequest {
            request_id,
            tool_name,
            capability,
            path,
            command,
            diff,
            ..
        } => {
            let detail = command
                .map(|c| format!(" ({c})"))
                .or_else(|| path.map(|p| format!(" on {p}")))
                .unwrap_or_default();
            if let Some(diff) = diff {
                eprintln!("\x1b[2m{diff}\x1b[0m");
            }
            let decision = prompt_permission(tool_name, capability, detail).await;
            if let Some(sender) = registry.lock().await.remove(&request_id) {
                let _ = sender.send(decision);
            }
        }
    }
}

/// Ask the terminal to approve a gated tool call. Non-interactive stdin (pipe,
/// CI) auto-denies, matching the headless "safe default" contract; blocking
/// stdin is confined to a blocking thread so the loop task keeps running.
async fn prompt_permission(
    tool_name: String,
    capability: String,
    detail: String,
) -> PermissionDecision {
    use std::io::IsTerminal;
    if !std::io::stdin().is_terminal() {
        eprintln!("\x1b[33m[permission] auto-denied {capability} via '{tool_name}' (non-interactive)\x1b[0m");
        return PermissionDecision::Deny;
    }
    tokio::task::spawn_blocking(move || {
        eprint!("\x1b[33m[permission] allow {capability} via '{tool_name}'{detail}? [y/N] \x1b[0m");
        let _ = std::io::stderr().flush();
        let mut line = String::new();
        if std::io::stdin().read_line(&mut line).is_err() {
            return PermissionDecision::Deny;
        }
        match line.trim().to_ascii_lowercase().as_str() {
            "y" | "yes" => PermissionDecision::AllowOnce,
            _ => PermissionDecision::Deny,
        }
    })
    .await
    .unwrap_or(PermissionDecision::Deny)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── default_thread_title ───────────────────────────────────────────────

    #[test]
    fn default_thread_title_uses_first_user_message() {
        let history = serde_json::json!([
            { "role": "user", "content": "Explain   the  buffer\nlogic" },
            { "role": "assistant", "content": "sure" },
        ]);
        assert_eq!(
            default_thread_title(history.as_array().unwrap()),
            "Explain the buffer logic"
        );
    }

    #[test]
    fn openai_content_text_reads_multimodal_array() {
        let content = serde_json::json!([
            { "type": "text", "text": "describe" },
            { "type": "image_url", "image_url": { "url": "data:image/png;base64,AA" } },
        ]);
        assert_eq!(openai_content_text(Some(&content)), "describe");
        assert_eq!(openai_content_text(Some(&serde_json::json!("plain"))), "plain");
    }

    #[test]
    fn default_thread_title_uses_multimodal_user_text() {
        let history = serde_json::json!([{
            "role": "user",
            "content": [
                { "type": "text", "text": "look at this" },
                { "type": "image_url", "image_url": { "url": "data:image/png;base64,AA" } },
            ],
        }]);
        assert_eq!(
            default_thread_title(history.as_array().unwrap()),
            "look at this"
        );
    }

    #[test]
    fn default_thread_title_truncates_and_falls_back() {
        let long = "x".repeat(80);
        let history = serde_json::json!([{ "role": "user", "content": long }]);
        let title = default_thread_title(history.as_array().unwrap());
        assert_eq!(title.chars().count(), 50);
        assert!(title.ends_with('…'));

        let no_user = serde_json::json!([{ "role": "assistant", "content": "hi" }]);
        assert_eq!(default_thread_title(no_user.as_array().unwrap()), "Agent chat");
    }

    // ── cli_save_thread metadata (snapshot bookkeeping) ────────────────────

    #[test]
    fn save_thread_persists_and_preserves_snapshot_metadata() {
        let base = std::env::temp_dir().join(format!(
            "jan_savethread_{}_{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let history = serde_json::json!([
            { "role": "user", "content": "hi" },
            { "role": "assistant", "content": "hello" },
        ]);
        let meta = serde_json::json!({
            "base_snapshot": "abc",
            "checkpoints": [{ "user_index": 0, "preview": "hi", "sha": "def" }],
        });

        let id = cli_save_thread(
            &base,
            None,
            "m",
            history.as_array().unwrap(),
            Some(meta.clone()),
        )
        .expect("save");

        let raw = std::fs::read_to_string(get_thread_metadata_path(&base, &id)).expect("read");
        let stored: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(stored["metadata"]["base_snapshot"], "abc");
        assert_eq!(stored["metadata"]["checkpoints"][0]["sha"], "def");

        // A follow-up save with no metadata must preserve the prior snapshot block.
        cli_save_thread(&base, Some(&id), "m", history.as_array().unwrap(), None).expect("resave");
        let raw = std::fs::read_to_string(get_thread_metadata_path(&base, &id)).expect("read2");
        let stored: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(stored["metadata"]["base_snapshot"], "abc");

        let _ = std::fs::remove_dir_all(&base);
    }

    // ── looks_like_hf_repo ─────────────────────────────────────────────────

    #[test]
    fn hf_repo_valid_basic() {
        assert!(looks_like_hf_repo("janhq/Jan-code-4b-gguf"));
        assert!(looks_like_hf_repo("openai/whisper"));
        assert!(looks_like_hf_repo("a/b"));
    }

    #[test]
    fn hf_repo_valid_with_dots_dashes_underscores() {
        assert!(looks_like_hf_repo("user.name/repo-name"));
        assert!(looks_like_hf_repo("user_name/repo.v2"));
        assert!(looks_like_hf_repo("Org-1/Model_2.gguf"));
    }

    #[test]
    fn hf_repo_rejects_paths() {
        assert!(!looks_like_hf_repo("/abs/path"));
        assert!(!looks_like_hf_repo("./relative"));
        assert!(!looks_like_hf_repo("~/home"));
    }

    #[test]
    fn hf_repo_rejects_no_slash() {
        assert!(!looks_like_hf_repo("noslashhere"));
    }

    #[test]
    fn hf_repo_rejects_empty_components() {
        assert!(!looks_like_hf_repo("/repo"));
        assert!(!looks_like_hf_repo("owner/"));
        assert!(!looks_like_hf_repo("/"));
    }

    #[test]
    fn hf_repo_rejects_multiple_slashes() {
        assert!(!looks_like_hf_repo("owner/repo/extra"));
    }

    #[test]
    fn hf_repo_rejects_invalid_chars() {
        assert!(!looks_like_hf_repo("owner/repo name"));
        assert!(!looks_like_hf_repo("own*er/repo"));
        assert!(!looks_like_hf_repo("owner/re@po"));
    }

    // ── ModelYml deserialization ──────────────────────────────────────────

    #[test]
    fn model_yml_minimal_required_field() {
        let yml = "model_path: /tmp/x.gguf\n";
        let parsed: ModelYml = serde_yaml::from_str(yml).unwrap();
        assert_eq!(parsed.model_path, "/tmp/x.gguf");
        assert_eq!(parsed.size_bytes, 0);
        assert!(!parsed.embedding);
        assert!(parsed.name.is_none());
        assert!(parsed.mmproj_path.is_none());
        assert!(parsed.capabilities.is_empty());
    }

    #[test]
    fn model_yml_full() {
        let yml = "model_path: relative/model.gguf\n\
                   name: My Model\n\
                   size_bytes: 1024\n\
                   embedding: true\n\
                   mmproj_path: relative/mmproj.gguf\n\
                   capabilities:\n  - vision\n  - tools\n";
        let parsed: ModelYml = serde_yaml::from_str(yml).unwrap();
        assert_eq!(parsed.model_path, "relative/model.gguf");
        assert_eq!(parsed.name.as_deref(), Some("My Model"));
        assert_eq!(parsed.size_bytes, 1024);
        assert!(parsed.embedding);
        assert_eq!(parsed.mmproj_path.as_deref(), Some("relative/mmproj.gguf"));
        assert_eq!(parsed.capabilities, vec!["vision", "tools"]);
    }

    #[test]
    fn model_yml_missing_model_path_errors() {
        let yml = "name: bad\n";
        let parsed: Result<ModelYml, _> = serde_yaml::from_str(yml);
        assert!(parsed.is_err());
    }

    // ── HfFileInfo construction ───────────────────────────────────────────

    #[test]
    fn hf_file_info_clone() {
        let f = HfFileInfo {
            filename: "x.gguf".into(),
            size: 100,
            sha256: Some("abc".into()),
            download_url: "https://hf.co/x".into(),
        };
        let c = f.clone();
        assert_eq!(c.filename, "x.gguf");
        assert_eq!(c.size, 100);
        assert_eq!(c.sha256.as_deref(), Some("abc"));
    }

    // ── State constructors ────────────────────────────────────────────────

    #[test]
    fn state_constructors_do_not_panic() {
        let _ = init_llamacpp_state();
        #[cfg(target_os = "macos")]
        let _ = init_mlx_state();
    }

    // ── cli_get_data_folder returns a path ────────────────────────────────

    #[test]
    fn cli_get_data_folder_returns_non_empty_path() {
        let p = cli_get_data_folder();
        assert!(!p.as_os_str().is_empty());
    }
}
