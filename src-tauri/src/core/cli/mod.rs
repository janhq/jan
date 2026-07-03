//! CLI adapter layer — thin wrappers that call core logic without an AppHandle.
//!
//! This module is only compiled when the `cli` feature is enabled.

pub mod providers;

use std::path::PathBuf;
use std::sync::Arc;

use crate::core::app::commands::{resolve_config_file_path, resolve_jan_data_folder};
use crate::core::threads::{
    constants::THREADS_FILE,
    helpers::{read_messages_from_file, update_thread_metadata, write_messages_to_file},
    utils::{
        ensure_data_dirs, get_data_dir, get_messages_path, get_thread_dir,
        get_thread_metadata_path,
    },
};
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

/// Which saved thread a `--resume` / `--continue` / `/resume` request refers to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ResumeTarget {
    /// Most recently updated thread for the project.
    Latest,
    /// A full thread id or a unique prefix of one.
    Id(String),
}

impl ResumeTarget {
    /// Build a target from the CLI flag pair: `--resume [ID]` and `--continue`/`-c`
    /// (an alias for a bare `--resume`). `None` means "do not resume".
    pub fn from_flags(resume: Option<Option<String>>, continue_session: bool) -> Option<Self> {
        match resume {
            Some(Some(id)) if !id.trim().is_empty() => Some(Self::Id(id.trim().to_string())),
            Some(_) => Some(Self::Latest),
            None if continue_session => Some(Self::Latest),
            None => None,
        }
    }
}

/// Recency sort key for a saved thread (`updated`, falling back to `created`).
pub fn thread_recency(t: &serde_json::Value) -> f64 {
    t.get("updated")
        .or_else(|| t.get("created"))
        .and_then(serde_json::Value::as_f64)
        .unwrap_or(0.0)
}

/// Sort threads most-recent-first (by `updated`/`created`).
pub fn sort_threads_recent(threads: &mut [serde_json::Value]) {
    threads.sort_by(|a, b| {
        thread_recency(b)
            .partial_cmp(&thread_recency(a))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
}

/// Message shown when there is nothing to resume; the caller then starts fresh.
pub const NO_SESSION_TO_RESUME: &str = "No session to resume";

/// Resolve a resume target against `<base>/threads/`, returning the thread
/// metadata. Threads whose `thread.json` is unparsable are skipped by
/// `list_threads_in`, so a corrupted neighbour never blocks a resume.
pub fn find_resume_thread(
    base: &std::path::Path,
    target: &ResumeTarget,
) -> Result<serde_json::Value, String> {
    let mut threads = list_threads_in(base)?;
    match target {
        ResumeTarget::Latest => {
            sort_threads_recent(&mut threads);
            threads
                .into_iter()
                .next()
                .ok_or_else(|| NO_SESSION_TO_RESUME.to_string())
        }
        ResumeTarget::Id(id) => {
            let mut matches: Vec<serde_json::Value> = threads
                .into_iter()
                .filter(|t| {
                    t.get("id")
                        .and_then(|v| v.as_str())
                        .is_some_and(|full| full == id || full.starts_with(id.as_str()))
                })
                .collect();
            match matches.len() {
                0 => Err(format!("no thread matches '{id}'")),
                1 => Ok(matches.remove(0)),
                n => Err(format!("'{id}' is ambiguous ({n} matches)")),
            }
        }
    }
}

/// Read a thread's messages, tolerating a truncated or malformed line (a crash
/// mid-append leaves one). Returns the parsed records and the skipped count, so
/// a resume degrades to "lost the tail" instead of failing outright.
pub fn cli_read_messages_lenient(
    base: &std::path::Path,
    thread_id: &str,
) -> Result<(Vec<serde_json::Value>, usize), String> {
    use std::io::BufRead;

    let path = get_messages_path(base, thread_id);
    if !path.exists() {
        return Ok((Vec::new(), 0));
    }
    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut messages = Vec::new();
    let mut skipped = 0;
    for line in std::io::BufReader::new(file).lines() {
        let line = line.map_err(|e| e.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str(&line) {
            Ok(v) => messages.push(v),
            Err(_) => skipped += 1,
        }
    }
    Ok((messages, skipped))
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
use crate::core::agent::project::{ensure_project, load_agent_config, permissions_from};
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
/// is set. The loop separately clamps the effective value to 1..=400.
const DEFAULT_MAX_TURNS: u32 = 400;

/// Resolved-config + provider snapshot for `jan agent status`.
pub fn cli_agent_status(
    project: &str,
    overrides: &ProviderOverrides,
) -> Result<serde_json::Value, String> {
    let project_root = PathBuf::from(project);
    ensure_project(&project_root)?;
    let cfg = load_agent_config(&project_root)?;
    let provider_configs = load_provider_configs(overrides)?;

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

/// Autonomous multi-turn run to completion or the turn/token budget.
pub async fn cli_agent_run(
    project: &str,
    task: &str,
    model: Option<String>,
    max_turns: Option<u32>,
    overrides: ProviderOverrides,
) -> Result<(), String> {
    run_agent_loop(project, task, model, max_turns, overrides).await
}

/// Single-turn run for debugging (`max_turns = 1`).
pub async fn cli_agent_step(
    project: &str,
    task: &str,
    model: Option<String>,
    overrides: ProviderOverrides,
) -> Result<(), String> {
    run_agent_loop(project, task, model, Some(1), overrides).await
}

fn build_cli_orchestration_args(
    project_root: PathBuf,
    permissions: crate::core::agent::permissions::ToolPermissions,
    provider_configs: HashMap<String, crate::core::state::ProviderConfig>,
    permission_requests: PermissionRegistry,
) -> OrchestrationArgs {
    OrchestrationArgs {
        client: reqwest::Client::new(),
        provider_configs: Arc::new(Mutex::new(provider_configs)),
        llama_state: Arc::new(init_llamacpp_state()),
        mlx_sessions: Arc::new(Mutex::new(HashMap::new())),
        mcp_servers: Arc::new(Mutex::new(HashMap::new())),
        mcp_settings: Arc::new(Mutex::new(McpSettings::default())),
        jan_data_folder: resolve_jan_data_folder().to_string_lossy().into_owned(),
        permissions,
        project_root: Some(project_root),
        permission_requests,
    }
}

async fn run_agent_loop(
    project: &str,
    task: &str,
    model_override: Option<String>,
    max_turns_override: Option<u32>,
    overrides: ProviderOverrides,
) -> Result<(), String> {
    let project_root = PathBuf::from(project);
    ensure_project(&project_root)?;
    let cfg = load_agent_config(&project_root)?;
    let permissions = permissions_from(&cfg);

    let model = model_override
        .or_else(|| cfg.agent.model.clone())
        .ok_or_else(|| {
            "no model specified: pass --model or set [agent].model in agent.toml".to_string()
        })?;
    let max_turns = max_turns_override
        .or(cfg.agent.max_turns)
        .unwrap_or(DEFAULT_MAX_TURNS);

    let provider_configs = load_provider_configs(&overrides)?;

    let permission_requests: PermissionRegistry = Arc::new(Mutex::new(HashMap::new()));
    let args = build_cli_orchestration_args(
        project_root,
        permissions,
        provider_configs,
        permission_requests.clone(),
    );

    let body = serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": task }],
        "max_turns": max_turns,
        "stream": true,
    });

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
        StreamEvent::ToolCall { name, args, .. } => eprintln!("\x1b[2m[tool] {name} {args}\x1b[0m"),
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
        StreamEvent::Done { stop_reason, usage } => {
            let tokens = usage.and_then(|u| u.total_tokens).unwrap_or(0);
            eprintln!("\n\x1b[2m[done] stop_reason={stop_reason} tokens={tokens}\x1b[0m");
        }
        StreamEvent::Error { code, message } => {
            eprintln!("\n\x1b[31m[error] {code}: {message}\x1b[0m")
        }
        StreamEvent::PermissionRequest {
            request_id,
            tool_name,
            capability,
            path,
            ..
        } => {
            let decision = prompt_permission(tool_name, capability, path).await;
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
    path: Option<String>,
) -> PermissionDecision {
    use std::io::IsTerminal;
    if !std::io::stdin().is_terminal() {
        eprintln!("\x1b[33m[permission] auto-denied {capability} via '{tool_name}' (non-interactive)\x1b[0m");
        return PermissionDecision::Deny;
    }
    tokio::task::spawn_blocking(move || {
        let target = path.map(|p| format!(" on {p}")).unwrap_or_default();
        eprint!("\x1b[33m[permission] allow {capability} via '{tool_name}'{target}? [y/N] \x1b[0m");
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

    // ── resume ─────────────────────────────────────────────────────────────

    #[test]
    fn resume_target_from_flags() {
        assert_eq!(ResumeTarget::from_flags(None, false), None);
        assert_eq!(ResumeTarget::from_flags(None, true), Some(ResumeTarget::Latest));
        assert_eq!(
            ResumeTarget::from_flags(Some(None), false),
            Some(ResumeTarget::Latest)
        );
        // A blank --resume value behaves like a bare --resume.
        assert_eq!(
            ResumeTarget::from_flags(Some(Some("  ".into())), false),
            Some(ResumeTarget::Latest)
        );
        assert_eq!(
            ResumeTarget::from_flags(Some(Some(" 3f7a ".into())), false),
            Some(ResumeTarget::Id("3f7a".into()))
        );
    }

    /// Write a thread with the given id/recency and a single user message.
    fn seed_thread(base: &std::path::Path, id: &str, updated: f64) {
        std::fs::create_dir_all(get_thread_dir(base, id)).unwrap();
        std::fs::write(
            get_thread_metadata_path(base, id),
            serde_json::json!({ "id": id, "title": id, "updated": updated }).to_string(),
        )
        .unwrap();
        std::fs::write(
            get_messages_path(base, id),
            serde_json::json!({
                "role": "user",
                "content": [{ "type": "text", "text": { "value": id, "annotations": [] } }],
            })
            .to_string()
                + "\n",
        )
        .unwrap();
    }

    #[test]
    fn find_resume_thread_latest_and_by_prefix() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        assert_eq!(
            find_resume_thread(base, &ResumeTarget::Latest).unwrap_err(),
            NO_SESSION_TO_RESUME
        );

        seed_thread(base, "aaaa1111", 100.0);
        seed_thread(base, "bbbb2222", 300.0);
        seed_thread(base, "bbbb3333", 200.0);

        let latest = find_resume_thread(base, &ResumeTarget::Latest).unwrap();
        assert_eq!(latest["id"], "bbbb2222");

        let by_prefix = find_resume_thread(base, &ResumeTarget::Id("aaaa".into())).unwrap();
        assert_eq!(by_prefix["id"], "aaaa1111");

        assert!(find_resume_thread(base, &ResumeTarget::Id("zz".into()))
            .unwrap_err()
            .contains("no thread matches"));
        assert!(find_resume_thread(base, &ResumeTarget::Id("bbbb".into()))
            .unwrap_err()
            .contains("ambiguous"));
    }

    #[test]
    fn find_resume_thread_skips_corrupted_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        seed_thread(base, "good1111", 100.0);
        let bad = "bad02222";
        std::fs::create_dir_all(get_thread_dir(base, bad)).unwrap();
        std::fs::write(get_thread_metadata_path(base, bad), "{not json").unwrap();

        let latest = find_resume_thread(base, &ResumeTarget::Latest).unwrap();
        assert_eq!(latest["id"], "good1111");
    }

    #[test]
    fn read_messages_lenient_skips_truncated_tail() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        seed_thread(base, "aaaa1111", 100.0);
        let mut raw = std::fs::read_to_string(get_messages_path(base, "aaaa1111")).unwrap();
        raw.push_str("{\"role\":\"assist");
        std::fs::write(get_messages_path(base, "aaaa1111"), raw).unwrap();

        let (messages, skipped) = cli_read_messages_lenient(base, "aaaa1111").unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(skipped, 1);
        // The strict reader used elsewhere still rejects the same file.
        assert!(cli_list_messages_in(base, "aaaa1111").is_err());
    }

    #[test]
    fn read_messages_lenient_on_missing_thread_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        let (messages, skipped) = cli_read_messages_lenient(dir.path(), "nope").unwrap();
        assert!(messages.is_empty());
        assert_eq!(skipped, 0);
    }

    #[test]
    fn resume_cycle_preserves_thread_id_and_history() {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path();
        let history = vec![
            serde_json::json!({ "role": "user", "content": "first" }),
            serde_json::json!({ "role": "assistant", "content": "reply" }),
        ];
        let id = cli_save_thread(base, None, "m", &history, None).unwrap();

        let resumed = load_resume_history(base, &ResumeTarget::Latest).unwrap();
        assert_eq!(resumed.thread_id, id);
        assert_eq!(resumed.history, history);

        // Continue the session and save back: same thread, appended turns.
        let mut extended = resumed.history;
        extended.push(serde_json::json!({ "role": "user", "content": "second" }));
        let same = cli_save_thread(base, Some(&id), "m", &extended, None).unwrap();
        assert_eq!(same, id);
        assert_eq!(list_threads_in(base).unwrap().len(), 1);
        assert_eq!(
            load_resume_history(base, &ResumeTarget::Id(id[..8].to_string()))
                .unwrap()
                .history,
            extended
        );
    }

    #[test]
    fn completion_text_extracts_assistant_content() {
        let completion =
            serde_json::json!({ "choices": [{ "message": { "content": "hello" } }] });
        assert_eq!(completion_text(&completion).as_deref(), Some("hello"));
        assert_eq!(completion_text(&serde_json::json!({})), None);
        assert_eq!(
            completion_text(&serde_json::json!({ "choices": [{ "message": { "content": "" } }] })),
            None
        );
    }

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

    // ── cli_get_data_folder returns a path ────────────────────────────────

    #[test]
    fn cli_get_data_folder_returns_non_empty_path() {
        let p = cli_get_data_folder();
        assert!(!p.as_os_str().is_empty());
    }

    // ── prepare_agent_session model resolution ────────────────────────────

    /// A project's `agent.toml` naming a model must not paper over "nothing can
    /// actually serve it": with no provider configured (this repo's own
    /// agent.toml pins `tokamak-1-preview`, but a fresh `~/.jan` has no
    /// credentials for it), the TUI path must still come back with an empty
    /// model so its sign-in notice fires instead of a first-message failure.
    #[test]
    fn tui_session_ignores_a_project_model_with_no_usable_provider() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let dir = tempfile::tempdir().unwrap();
            std::fs::write(
                dir.path().join("agent.toml"),
                "[agent]\nmodel = \"tokamak-1-preview\"\n",
            )
            .unwrap();

            let session = prepare_agent_session(
                dir.path().to_str().unwrap(),
                None,
                None,
                ProviderOverrides::default(),
                false,
                false,
                false,
            )
            .expect("TUI session prep must not fail with nothing configured");
            assert_eq!(session.model, "");
        });
    }

    /// The same project config, once a provider is actually usable, must be
    /// trusted again.
    #[test]
    fn tui_session_honors_a_project_model_once_a_provider_is_usable() {
        crate::core::agent::global_config::with_temp_home(|_| {
            crate::core::agent::global_config::set_provider(
                "tokamak",
                crate::core::agent::global_config::ProviderUpdate {
                    api_key: Some("tk".into()),
                    base_url: Some(crate::core::cli::tokamak::BASE_URL.into()),
                    models: Some(vec!["tokamak-1-preview".into()]),
                    api_type: None,
                },
            )
            .unwrap();
            let dir = tempfile::tempdir().unwrap();
            std::fs::write(
                dir.path().join("agent.toml"),
                "[agent]\nmodel = \"tokamak-1-preview\"\n",
            )
            .unwrap();

            let session = prepare_agent_session(
                dir.path().to_str().unwrap(),
                None,
                None,
                ProviderOverrides::default(),
                false,
                false,
                false,
            )
            .expect("session prep");
            assert_eq!(session.model, "tokamak-1-preview");
        });
    }
}
