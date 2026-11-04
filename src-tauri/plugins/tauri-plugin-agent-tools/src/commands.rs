//! Desktop IPC shims over the Tauri-free core.
//!
//! Three surfaces:
//!
//! 1. **Management** -- skill and memory CRUD against the permanent store.
//! 2. **Sandbox lifecycle** -- `thread_workspace_{path,delete,sweep}`. Each
//!    thread gets its own ephemeral sandbox, so scratch files from one
//!    conversation are invisible to the next; the store is never swept.
//! 3. **Tool execution** -- `tool_schemas` + `execute_tool`, for the desktop
//!    chat loop. The desktop drives its tool loop in TypeScript
//!    (`custom-chat-transport.ts`), so unlike the CLI agent -- which calls
//!    `tools::handlers` in process -- it has to reach execution over IPC.
//!
//! `execute_tool` treats the gate as the authority rather than the caller, but it
//! answers two of the gate's prompts structurally instead of by asking, because on
//! this surface what the prompt protects is already guaranteed:
//!
//! - **Writes** land in the thread's ephemeral sandbox (`root` is always
//!   `ensure_thread_workspace`): confined by `escapes_project`, deleted with the
//!   conversation, and only a *sibling* of the permanent store. No durable user
//!   data is in range.
//! - **`bash`** runs only when `jail` reports an enforcing OS sandbox, which gives
//!   the same containment. With no sandbox it is refused outright rather than run
//!   unconfined.
//!
//! Everything else still refuses -- notably a read that escapes the sandbox. The
//! gate itself is deliberately left untouched, because the CLI agent shares it and
//! *does* want to prompt: there, the root is the user's real project.
//!
//! Note some command names match built-in tool names (`skill_list`,
//! `memory_list`). The commands are the *management* surface; the tools are what
//! the model calls. They are separate namespaces.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::artifact;
use crate::memory;
use crate::permissions::ToolPermissions;
use crate::preview::{self, PreviewRoots};
use crate::skills::{self, SkillMeta};
use crate::tools::gate::{self, Decision, PromptKind, SessionGrants};
use crate::tools::jail;
use crate::tools::{handlers, lookup, schema, ImageContentPart, ToolContext};
use crate::workspace;

#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[error("AgentToolsError: {message}")]
pub struct AgentToolsError {
    pub message: String,
}

impl From<String> for AgentToolsError {
    /// Strips the core's `ERROR:` tool-protocol prefix; it is meaningful to the
    /// model, but noise in a dialog.
    fn from(message: String) -> Self {
        let message = message
            .strip_prefix("ERROR:")
            .unwrap_or(&message)
            .trim()
            .to_string();
        Self { message }
    }
}

/// Outcome of a built-in tool execution.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub content: String,
    /// Display-only diff for `write`/`edit`; never part of model context.
    pub diff: Option<String>,
    pub is_error: bool,
    /// Images the tool returned (`read` of an image, `screenshot`), for the
    /// caller to put in front of a vision model.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<ImageContentPart>,
}

/// `content` plus a line per hook matcher that still names `tool` by an old
/// name (`bash`, `memory_write`, ...). The CLI reports hook load notices once
/// at run start; this surface has no run around a call, so they ride on the
/// call of the tool the stale matcher meant. A shell result keeps its exit
/// marker as the final line, so the notices go above it.
fn with_renamed_tool_notices(
    tool: &str,
    mut content: String,
    hooks: &crate::tools::hooks::HookSet,
) -> String {
    for notice in hooks.renamed_notices(tool) {
        crate::tools::handlers::insert_before_exit_marker(
            &mut content,
            &format!("\n[hook config: {notice}]"),
        );
    }
    content
}

/// The permanent store root holding `memory/` and `skills/`.
///
/// `project` is an explicit override and is currently always `None`: the desktop
/// has no project picker yet. Once one lands, a project's own store
/// (`~/.jan/projects/<slug>`) layers on top of this one; see the memory-scope TODO.
fn resolve_store(data_folder: &Path, project: Option<&str>) -> PathBuf {
    match project.map(str::trim).filter(|p| !p.is_empty()) {
        Some(p) => workspace::project_store(Path::new(p)),
        None => workspace::permanent_store(data_folder),
    }
}

/// Ensure the permanent store exists and return its path, so the UI can show
/// where memories and skills live.
#[tauri::command]
pub async fn workspace_path(data_folder: String) -> Result<String, AgentToolsError> {
    let data_folder = workspace::host_data_folder(&data_folder);
    let root = workspace::ensure_permanent_store(Path::new(&data_folder)).await?;
    Ok(root.to_string_lossy().to_string())
}

/// Create a thread's ephemeral sandbox and return its path, so the UI can offer
/// to open it and the user can copy files in for the agent to work on.
#[tauri::command]
pub async fn thread_workspace_path(
    data_folder: String,
    thread_id: String,
) -> Result<String, AgentToolsError> {
    let data_folder = workspace::host_data_folder(&data_folder);
    let dir = workspace::ensure_thread_workspace(Path::new(&data_folder), &thread_id).await?;
    Ok(dir.to_string_lossy().to_string())
}

/// Delete a thread's sandbox. Called when a thread is deleted; memory and skills
/// are untouched.
#[tauri::command]
pub async fn thread_workspace_delete(
    data_folder: String,
    thread_id: String,
) -> Result<(), AgentToolsError> {
    let data_folder = workspace::host_data_folder(&data_folder);
    workspace::remove_thread_workspace(Path::new(&data_folder), &thread_id)
        .await
        .map_err(Into::into)
}

/// Delete every sandbox not belonging to a surviving thread, returning how many
/// were removed. Called once at startup: sandboxes are ephemeral, but a crash or
/// a thread deleted while the app was closed would otherwise leave one behind.
///
/// Abandoned scratch directories in the cache are collected in the same pass,
/// with `keep` as the live set so no surviving thread's scratch goes. The
/// sweep covers every project's folder, so a CLI session's scratch is only
/// ever collected once it is a week stale -- see
/// [`workspace::sweep_stale_scratch_dirs`]. Their count is not added to the
/// return value, which names thread sandboxes.
#[tauri::command]
pub async fn thread_workspace_sweep(
    data_folder: String,
    keep: Vec<String>,
) -> Result<usize, AgentToolsError> {
    let data_folder = workspace::host_data_folder(&data_folder);
    workspace::sweep_stale_scratch_dirs(&keep).await;
    workspace::sweep_thread_workspaces(Path::new(&data_folder), &keep)
        .await
        .map_err(Into::into)
}

/// The Cowork session sandbox, created if absent.
#[cfg_attr(feature = "tauri", tauri::command)]
pub async fn session_workspace_path(
    data_folder: String,
    session_id: String,
) -> Result<String, AgentToolsError> {
    let data_folder = workspace::host_data_folder(&data_folder);
    let dir = workspace::ensure_session_workspace(Path::new(&data_folder), &session_id).await?;
    Ok(dir.to_string_lossy().to_string())
}

/// Delete a Cowork session's sandbox, with its scratch.
#[cfg_attr(feature = "tauri", tauri::command)]
pub async fn session_workspace_delete(
    data_folder: String,
    session_id: String,
) -> Result<(), AgentToolsError> {
    let data_folder = workspace::host_data_folder(&data_folder);
    workspace::remove_session_workspace(Path::new(&data_folder), &session_id)
        .await
        .map_err(Into::into)
}

/// Collect session sandboxes whose sessions no longer exist.
///
/// Deliberately separate from the thread sweep: the two id spaces are
/// independent, so handing either one the other's keep list would delete live
/// work. `keep` being empty is a no-op, not a full wipe.
#[cfg_attr(feature = "tauri", tauri::command)]
pub async fn session_workspace_sweep(
    data_folder: String,
    keep: Vec<String>,
) -> Result<usize, AgentToolsError> {
    let data_folder = workspace::host_data_folder(&data_folder);
    workspace::sweep_session_workspaces(Path::new(&data_folder), &keep)
        .await
        .map_err(Into::into)
}

/// Every discovered skill with its description, including empty stubs so the
/// user can see and edit them.
#[tauri::command]
pub async fn skill_list(
    data_folder: String,
    project: Option<String>,
) -> Result<Vec<SkillMeta>, AgentToolsError> {
    let data_folder = workspace::host_data_folder(&data_folder);
    Ok(skills::list_meta(&resolve_store(
        &data_folder,
        project.as_deref(),
    )))
}

/// Raw `SKILL.md` text, frontmatter included, for the editor.
#[tauri::command]
pub async fn skill_read(
    data_folder: String,
    project: Option<String>,
    name: String,
) -> Result<String, AgentToolsError> {
    let data_folder = workspace::host_data_folder(&data_folder);
    skills::read_raw(&resolve_store(&data_folder, project.as_deref()), &name).map_err(Into::into)
}

/// Create or overwrite a skill. Parent directories are created as needed.
#[tauri::command]
pub async fn skill_write(
    data_folder: String,
    project: Option<String>,
    name: String,
    content: String,
) -> Result<(), AgentToolsError> {
    let data_folder = workspace::host_data_folder(&data_folder);
    skills::write(
        &resolve_store(&data_folder, project.as_deref()),
        &name,
        &content,
    )
    .map_err(Into::into)
}

/// Delete a skill in either form. Idempotent: a missing skill is Ok.
#[tauri::command]
pub async fn skill_delete(
    data_folder: String,
    project: Option<String>,
    name: String,
) -> Result<(), AgentToolsError> {
    let data_folder = workspace::host_data_folder(&data_folder);
    skills::delete(&resolve_store(&data_folder, project.as_deref()), &name).map_err(Into::into)
}
/// Build a user prompt for an installed skill, including its body and arguments.
#[tauri::command]
pub async fn skill_invoke(
    data_folder: String,
    project: Option<String>,
    name: String,
    args: String,
) -> Result<String, AgentToolsError> {
    let data_folder = workspace::host_data_folder(&data_folder);
    skills::build_invocation_message(
        &resolve_store(&data_folder, project.as_deref()),
        &name,
        &args,
    )
    .map(|(message, _)| message)
    .map_err(Into::into)
}

/// Memory note names (stems), sorted.
#[tauri::command]
pub async fn memory_list(
    data_folder: String,
    project: Option<String>,
) -> Result<Vec<String>, AgentToolsError> {
    let data_folder = workspace::host_data_folder(&data_folder);
    Ok(memory::list(&resolve_store(&data_folder, project.as_deref())).await)
}

#[tauri::command]
pub async fn memory_read(
    data_folder: String,
    project: Option<String>,
    name: String,
) -> Result<String, AgentToolsError> {
    let data_folder = workspace::host_data_folder(&data_folder);
    memory::read(&resolve_store(&data_folder, project.as_deref()), &name)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn memory_write(
    data_folder: String,
    project: Option<String>,
    name: String,
    content: String,
) -> Result<(), AgentToolsError> {
    let data_folder = workspace::host_data_folder(&data_folder);
    let store = resolve_store(&data_folder, project.as_deref());
    let _lock = memory::lock_changes(&store).await;
    memory::write(&store, &name, &content)
        .await
        .map(|_| ())
        .map_err(Into::into)
}

/// Name + summary + mtime for every memory note, name-sorted. This is the
/// recall surface: both desktop chat's digest and Cowork's prompt catalog are
/// built from it, so neither re-reads the store per note just to list it.
#[tauri::command]
pub async fn memory_catalog(
    data_folder: String,
    project: Option<String>,
) -> Result<Vec<memory::CatalogEntry>, AgentToolsError> {
    let data_folder = workspace::host_data_folder(&data_folder);
    let store = resolve_store(&data_folder, project.as_deref());
    // `catalog` is sync std::fs by design (the CLI calls it from sync context);
    // keep its directory walk off the async runtime's thread here.
    tokio::task::spawn_blocking(move || memory::catalog(&store))
        .await
        .map_err(|e| AgentToolsError::from(format!("memory catalog failed: {e}")))
}

/// Delete a memory note. Idempotent: a missing note is Ok.
#[tauri::command]
pub async fn memory_delete(
    data_folder: String,
    project: Option<String>,
    name: String,
) -> Result<(), AgentToolsError> {
    let data_folder = workspace::host_data_folder(&data_folder);
    let store = resolve_store(&data_folder, project.as_deref());
    let _lock = memory::lock_changes(&store).await;
    memory::delete(&store, &name).await.map_err(Into::into)
}

/// OpenAI-shaped function schemas for every built-in tool. The frontend picks
/// which subset to advertise; `schema.rs` stays the single source of truth so
/// the schemas are never re-typed in TypeScript.
#[tauri::command]
pub fn tool_schemas() -> Vec<serde_json::Value> {
    schema::builtin_tool_schemas()
}

/// Whether this machine can confine a shell, and with what.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SandboxStatus {
    /// Backend name for display: `bubblewrap`, `seatbelt`, `appcontainer`, `none`.
    pub backend: String,
    pub enforces: bool,
}

/// Report the sandbox backend so the frontend can decide whether to advertise
/// `bash` at all. Offering a tool that `execute_tool` will always refuse wastes a
/// model turn and reads as a bug, so the tool list is built from this.
#[tauri::command]
pub async fn sandbox_status() -> Result<SandboxStatus, AgentToolsError> {
    // The first call probes bubblewrap in a subprocess. Cached afterwards, but
    // keep even that one call off the async runtime's thread.
    let backend = tokio::task::spawn_blocking(jail::backend)
        .await
        .map_err(|e| AgentToolsError::from(format!("sandbox probe failed: {e}")))?;
    Ok(SandboxStatus {
        backend: backend.as_str().to_string(),
        enforces: backend.enforces(),
    })
}

/// One fragment of a tool's live output.
///
/// `seq` is monotonic per call so the receiver can assert ordering and notice
/// the truncation below; `callId` says which tool call it belongs to, which a
/// backgrounded `bash` needs because it keeps streaming after the tool returned.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolOutputChunk {
    pub seq: u64,
    pub call_id: Option<String>,
    pub text: String,
}

/// Live output past this point is dropped from the stream, not from the result.
///
/// A `yes`-style command would otherwise flood the webview with IPC messages
/// faster than it can render them. The full text still reaches the caller in
/// `ToolResult`, and in the spill file when it overflows that.
const MAX_STREAMED_BYTES: usize = 2 * 1024 * 1024;

/// Which sandbox namespace an id belongs to.
///
/// Chat threads and Cowork sessions have independent id spaces and independent
/// sweeps, so the caller has to say which one it means; guessing would let one
/// surface's cleanup delete the other's work.
#[derive(Debug, Clone, Copy, Default, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceScope {
    #[default]
    Thread,
    Session,
}

impl WorkspaceScope {
    async fn ensure(self, data_folder: &Path, id: &str) -> Result<PathBuf, String> {
        match self {
            Self::Thread => workspace::ensure_thread_workspace(data_folder, id).await,
            Self::Session => workspace::ensure_session_workspace(data_folder, id).await,
        }
    }
}

/// A claimed subagent result file: `path` is the model-visible spelling to hand
/// back to the model, `file` the name to pass to [`subagent_result_fill`] once
/// the child has an answer.
#[derive(serde::Serialize)]
pub struct ReservedResult {
    pub file: String,
    pub path: String,
}

/// Claim a file in the parent session's scratch for a subagent's answer.
///
/// Host-side, not a model tool: the Cowork loop runs in the frontend, where the
/// scratch is only reachable through this plugin. Claimed at dispatch rather
/// than written at completion because the `task` tool returns the path
/// immediately -- the parent is told where the answer will be while the child is
/// still working. The path is the one spelling both the filesystem tools and the
/// sandboxed shell resolve, so the parent can `read` it back. An existing name
/// is suffixed, never overwritten.
#[tauri::command]
pub async fn subagent_result_reserve(
    thread_id: String,
    id: String,
) -> Result<ReservedResult, AgentToolsError> {
    let scratch = workspace::ensure_scratch_dir(&thread_id).await?;
    let reserved = tokio::task::spawn_blocking(move || {
        crate::tools::spill::reserve_subagent_result(&scratch, &id).map(|p| ReservedResult {
            file: p
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            path: p.to_string_lossy().into_owned(),
        })
    })
    .await
    .map_err(|e| AgentToolsError::from(format!("subagent result reserve failed: {e}")))?;
    reserved.ok_or_else(|| {
        AgentToolsError::from("could not claim a file in the session scratch".to_string())
    })
}

/// Write a finished subagent's answer into the file that was reserved for it.
///
/// Takes the reserved *name*, not a path: it has crossed to the frontend and
/// back, so it is re-validated and re-resolved under the session's own scratch
/// rather than trusted (see `spill::fill_named_subagent_result`).
#[tauri::command]
pub async fn subagent_result_fill(
    thread_id: String,
    file: String,
    content: String,
) -> Result<(), AgentToolsError> {
    let scratch = workspace::ensure_scratch_dir(&thread_id).await?;
    let filled = tokio::task::spawn_blocking(move || {
        crate::tools::spill::fill_named_subagent_result(&scratch, &file, &content)
    })
    .await
    .map_err(|e| AgentToolsError::from(format!("subagent result write failed: {e}")))?;
    if !filled {
        return Err(AgentToolsError::from(
            "could not write the reserved result file".to_string(),
        ));
    }
    Ok(())
}

/// Write a finished subagent's answer to `<scratch>/blackboard/<name>.md`, the
/// predictable name-keyed coordination file a phased dispatch's next phase (and
/// sibling agents) read. Reserve + fill in one call: the Cowork scheduler writes
/// only after the child has finished, so there is nothing to claim ahead of time.
/// The name is re-validated and re-resolved under the session scratch; a stale
/// file from an earlier plan is truncated in place. Returns the model-visible
/// path (`spill::reserve_blackboard_result`).
#[tauri::command]
pub async fn blackboard_write(
    thread_id: String,
    name: String,
    content: String,
) -> Result<String, AgentToolsError> {
    let scratch = workspace::ensure_scratch_dir(&thread_id).await?;
    tokio::task::spawn_blocking(move || {
        let path = crate::tools::spill::reserve_blackboard_result(&scratch, &name)
            .ok_or_else(|| {
                AgentToolsError::from("could not claim a blackboard file".to_string())
            })?;
        if crate::tools::spill::fill_subagent_result(&path, &content) {
            Ok(path.to_string_lossy().into_owned())
        } else {
            Err(AgentToolsError::from(
                "could not write the blackboard file".to_string(),
            ))
        }
    })
    .await
    .map_err(|e| AgentToolsError::from(format!("blackboard write failed: {e}")))?
}

/// An attachment imported into a session workspace: host paths, which are also
/// the model-visible spelling since the workspace is the tools' root.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAttachment {
    pub path: String,
    pub text_path: Option<String>,
}

/// Copy a user attachment into the Cowork session workspace, with its extracted
/// text beside it, so the agent's file tools can reach a file the picker found
/// outside every root they may read. Host-side rather than a model tool: the
/// source path is the user's, never the model's to name.
#[tauri::command]
pub async fn attachment_import(
    data_folder: String,
    session_id: String,
    source: String,
    text: Option<String>,
) -> Result<ImportedAttachment, AgentToolsError> {
    let data_folder = workspace::host_data_folder(&data_folder);
    let workspace =
        workspace::ensure_session_workspace(Path::new(&data_folder), &session_id).await?;
    let imported = tokio::task::spawn_blocking(move || {
        crate::tools::attachments::import_attachment(
            &workspace,
            Path::new(&source),
            text.as_deref(),
        )
    })
    .await
    .map_err(|e| AgentToolsError::from(format!("attachment import failed: {e}")))??;
    Ok(ImportedAttachment {
        path: imported.path.to_string_lossy().into_owned(),
        text_path: imported.text_path.map(|p| p.to_string_lossy().into_owned()),
    })
}

/// Live monitors per Cowork session, each with the IPC channel its updates are
/// forwarded over. Process-wide like `bash`'s background jobs: the Cowork loop
/// runs in the frontend, so nothing host-side scopes a run. The channel slot is
/// swappable because a session outlives any one run -- each `start_monitor`
/// installs the current run's channel, and updates always go to the latest.
struct SessionMonitors {
    set: std::sync::Arc<crate::tools::monitor::MonitorSet>,
    channel: MonitorChannelSlot,
}

type MonitorChannelSlot = std::sync::Arc<
    std::sync::Mutex<Option<tauri::ipc::Channel<crate::tools::monitor::MonitorUpdate>>>,
>;

fn session_monitors(
) -> &'static std::sync::Mutex<std::collections::HashMap<String, SessionMonitors>> {
    static SETS: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, SessionMonitors>>,
    > = std::sync::OnceLock::new();
    SETS.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// Start a monitor for a Cowork session; updates stream over `on_update`.
///
/// Returns the model-facing result string from `MonitorSet::start`. Like
/// `bash` on this surface, the polled script runs only under an enforcing OS
/// sandbox -- there is no one to prompt, so unconfined execution is refused
/// rather than allowed.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn start_monitor(
    data_folder: String,
    thread_id: String,
    args: serde_json::Value,
    allow_network: Option<bool>,
    read_only_project: Option<String>,
    project_writable: Option<bool>,
    scope: Option<WorkspaceScope>,
    on_update: tauri::ipc::Channel<crate::tools::monitor::MonitorUpdate>,
) -> Result<String, AgentToolsError> {
    if !matches!(scope, Some(WorkspaceScope::Session)) {
        return Err("monitor is unavailable for Chat threads".to_string().into());
    }
    // Same host-kind guard as `execute_tool`: an elevated Session monitor
    // (network, attached folder, or writable project) needs a host-verified
    // Cowork identity, and the check runs before any setup side effect.
    guard_caller_session(
        scope,
        &thread_id,
        crate::tools::monitor::MONITOR_TOOL_NAME,
        &args,
        allow_network,
        read_only_project.as_deref(),
        project_writable,
    )
    .await?;
    let data_folder = workspace::host_data_folder(&data_folder);
    use crate::tools::monitor;
    if !jail::backend().enforces() {
        return Err(AgentToolsError::from(
            "monitor is unavailable because no OS sandbox could be established on this system"
                .to_string(),
        ));
    }
    let spec = monitor::parse_start_args(&args).map_err(AgentToolsError::from)?;
    let sandbox = scope
        .unwrap_or_default()
        .ensure(Path::new(&data_folder), &thread_id)
        .await?;
    let scratch = workspace::ensure_scratch_dir(&thread_id).await?;
    let writable = project_writable.unwrap_or(false);
    let attached = attach_folder(
        read_only_project.as_deref(),
        &sandbox,
        &data_folder,
        writable,
    )?;
    let (root, read_roots, write_roots) = resolve_workspace_root(sandbox, attached, writable);
    let ctx = monitor::MonitorCtx {
        // A Cowork session monitor keeps the ownerless process bucket it has
        // always used; only thread-owned monitors register under an owner.
        owner: None,
        // And its polls keep bypassing PreToolUse hooks, as they always have:
        // the hook gate is thread-only. Gating Cowork too is a behavior change
        // that wants its own reviewed task.
        hooks: None,
        project_root: root,
        scratch_root: Some(scratch),
        // Desktop chat and Cowork have no filesystem project to key one on.
        pkg_cache: None,
        mask_root: Some(PathBuf::from(&data_folder)),
        hidden_root: workspace::hidden_root(true),
        read_roots,
        write_roots,
        allow_network: allow_network.unwrap_or(false)
            && crate::thread_capabilities::get_global_grants().shell_network,
        home_readonly: false,
        sandbox: true,
        workspace_readonly: false,
    };
    let set = {
        let mut sets = session_monitors().lock().unwrap();
        let entry = sets.entry(thread_id).or_insert_with(|| {
            let slot: MonitorChannelSlot = std::sync::Arc::new(std::sync::Mutex::new(None));
            let subscriber_slot = slot.clone();
            SessionMonitors {
                set: std::sync::Arc::new(monitor::MonitorSet::subscribed(std::sync::Arc::new(
                    move |update| {
                        if let Some(channel) = subscriber_slot.lock().unwrap().as_ref() {
                            let _ = channel.send(update);
                        }
                    },
                ))),
                channel: slot,
            }
        });
        *entry.channel.lock().unwrap() = Some(on_update);
        entry.set.clone()
    };
    set.start(spec, ctx).map_err(AgentToolsError::from)
}

/// Stop one monitor. The result string is model-facing, so an unknown id comes
/// back as an `ERROR:` result rather than a command failure.
#[tauri::command]
pub async fn stop_monitor(
    thread_id: String,
    monitor_id: String,
) -> Result<String, AgentToolsError> {
    let set = session_monitors()
        .lock()
        .unwrap()
        .get(&thread_id)
        .map(|entry| entry.set.clone());
    Ok(match set {
        Some(set) => set.stop(&monitor_id),
        None => format!("ERROR: unknown or already-stopped monitor '{monitor_id}'"),
    })
}

#[tauri::command]
pub async fn list_monitors(thread_id: String) -> Result<String, AgentToolsError> {
    let set = session_monitors()
        .lock()
        .unwrap()
        .get(&thread_id)
        .map(|entry| entry.set.clone());
    Ok(match set {
        Some(set) => set.list(),
        None => "No active monitors.".to_string(),
    })
}

/// The ids of a session's still-active monitors, for the UI to reconcile its
/// rail against. Every monitor is one-shot and retires (match, timeout, or an
/// explicit stop) after emitting its terminal update, so a monitor Rust no
/// longer lists has ended; a rail row still marked running for it is stale
/// (a dropped terminal update) and the UI can settle it.
#[tauri::command]
pub async fn session_monitor_ids(thread_id: String) -> Result<Vec<String>, AgentToolsError> {
    let set = session_monitors()
        .lock()
        .unwrap()
        .get(&thread_id)
        .map(|entry| entry.set.clone());
    Ok(set
        .map(|s| s.snapshot().into_iter().map(|m| m.monitor_id).collect())
        .unwrap_or_default())
}

/// Abort every monitor a session still has. Called at run end (and session
/// teardown), the Cowork counterpart of the run-scoped drop on the CLI.
#[tauri::command]
pub async fn stop_session_monitors(thread_id: String) -> Result<(), AgentToolsError> {
    if let Some(entry) = session_monitors().lock().unwrap().remove(&thread_id) {
        entry.set.stop_all();
    }
    Ok(())
}

/// Kill every `bash` tree this session started, running or backgrounded. Driven
/// by the Stop button: aborting the JS run only discards a tool result, so
/// without this a long or backgrounded shell keeps executing on the host until
/// app shutdown. Scoped to `thread_id`, so a concurrent session's shells are
/// untouched.
#[tauri::command]
pub async fn cancel_thread_bash(thread_id: String) -> Result<(), AgentToolsError> {
    crate::tools::proc::kill_thread(&thread_id);
    Ok(())
}

/// Live monitors per Chat thread.
///
/// Deliberately a *separate* map from [`session_monitors`], which is keyed by
/// raw session id. Sharing one map behind a namespaced key would make
/// Thread/Session non-collision a naming convention; two maps make it
/// structural, so nothing on this surface can address a Cowork session's
/// monitors even if the ids were identical.
struct ThreadMonitors {
    set: std::sync::Arc<crate::tools::monitor::MonitorSet>,
    channel: MonitorChannelSlot,
}

fn thread_monitors(
) -> &'static std::sync::Mutex<std::collections::HashMap<String, ThreadMonitors>> {
    static SETS: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, ThreadMonitors>>,
    > = std::sync::OnceLock::new();
    SETS.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// Process-registry bucket for one thread's monitor poll children. A thread id
/// is `[A-Za-z0-9_-]` only (`validate_thread_id`), so the `:` here means this
/// key can never equal the raw-thread-id bucket `cancel_thread_bash` reaps,
/// nor any Cowork session's. Per thread rather than per monitor, so one
/// `kill_thread` reaps everything a revocation must stop.
fn monitor_owner(thread_id: &str) -> String {
    format!("thread-monitor:{thread_id}")
}

/// The authority for one poll: freshly read stored consent intersected with
/// the current host confirmation, canonical roots rebuilt from the result and
/// the jail re-verified. Returns the generation the spawn is admitted against.
///
/// This is re-run immediately before *every* poll, so a start-time grant
/// authorizes nothing on its own, and it reuses the same `attach_folder` /
/// `resolve_workspace_root` / mask construction as scoped Chat tool dispatch
/// rather than introducing a second policy path.
async fn resolve_thread_monitor_ctx(
    thread_id: &str,
    ceiling: &crate::thread_capabilities::ThreadCapabilities,
) -> Result<(crate::tools::monitor::MonitorCtx, u64), String> {
    if !jail::backend().enforces() {
        return Err("no OS sandbox could be established on this system".into());
    }
    let (data_folder, grant, generation) =
        crate::thread_capabilities::authorize(thread_id).await?;
    let grant = grant.intersect(ceiling.clone())?;
    let Some(scope) = grant.folder_scope.clone() else {
        return Err("folder access for this conversation is no longer granted".into());
    };
    let writable = scope.access == "write";
    let sandbox = WorkspaceScope::Thread
        .ensure(&data_folder, thread_id)
        .await
        .map_err(|e| e.to_string())?;
    let scratch = workspace::ensure_scratch_dir(thread_id)
        .await
        .map_err(|e| e.to_string())?;
    let attached = attach_folder(Some(scope.path.as_str()), &sandbox, &data_folder, writable)
        .map_err(|e| e.to_string())?;
    let (root, read_roots, write_roots) = resolve_workspace_root(sandbox, attached, writable);
    Ok((
        crate::tools::monitor::MonitorCtx {
            owner: Some(monitor_owner(thread_id)),
            // Re-resolved with the rest of the poll's authority, so a hook the
            // user adds or removes applies from the next poll. Chat has no
            // project, so these are the user's global hooks, exactly what
            // one-shot Chat dispatch resolves in `execute_tool_inner`.
            hooks: Some(crate::tools::hooks::resolve_for(None)),
            project_root: root,
            scratch_root: Some(scratch),
            // Desktop chat has no filesystem project to key a cache on.
            pkg_cache: None,
            mask_root: Some(data_folder),
            hidden_root: workspace::hidden_root(true),
            read_roots,
            write_roots,
            allow_network: grant.shell_network,
            home_readonly: false,
            sandbox: true,
            workspace_readonly: false,
        },
        generation,
    ))
}

fn thread_authority(
    thread_id: &str,
    ceiling: crate::thread_capabilities::ThreadCapabilities,
) -> crate::tools::monitor::ThreadAuthority {
    let resolver_id = thread_id.to_string();
    crate::tools::monitor::ThreadAuthority {
        thread_id: thread_id.to_string(),
        owner: monitor_owner(thread_id),
        resolve: std::sync::Arc::new(move || {
            let id = resolver_id.clone();
            let ceiling = ceiling.clone();
            Box::pin(async move { resolve_thread_monitor_ctx(&id, &ceiling).await })
        }),
    }
}

/// Start a monitor owned by a Chat thread.
///
/// Unlike [`start_monitor`] there is no caller-supplied data folder, scope,
/// network or writability flag to forge: the host derives every one of them
/// from the thread's own consent, and re-derives them on each poll. Nothing
/// the caller passes can widen authority.
#[tauri::command]
pub async fn start_thread_monitor(
    thread_id: String,
    args: serde_json::Value,
    on_update: tauri::ipc::Channel<crate::tools::monitor::MonitorUpdate>,
) -> Result<String, AgentToolsError> {
    let spec =
        crate::tools::monitor::parse_start_args(&args).map_err(AgentToolsError::from)?;
    // Authorize once up front so an unauthorized start fails loudly, rather
    // than starting a monitor whose only possible output is a revoked notice.
    let (_, ceiling, _) = crate::thread_capabilities::authorize(&thread_id)
        .await
        .map_err(AgentToolsError::from)?;
    let (ctx, _) = resolve_thread_monitor_ctx(&thread_id, &ceiling)
        .await
        .map_err(AgentToolsError::from)?;
    let authority = thread_authority(&thread_id, ceiling);
    // The map lock is held across `start_owned`, so a revoke or stop that
    // removes this thread's entry cannot interleave between publishing the set
    // and starting the monitor. Otherwise the monitor would belong to a set no
    // longer in the map: invisible to list, unstoppable by id, and never
    // aborted by a later revocation.
    {
        let mut sets = thread_monitors().lock().unwrap();
        let entry = sets.entry(thread_id).or_insert_with(|| {
            let slot: MonitorChannelSlot = std::sync::Arc::new(std::sync::Mutex::new(None));
            let subscriber_slot = slot.clone();
            ThreadMonitors {
                set: std::sync::Arc::new(crate::tools::monitor::MonitorSet::subscribed(
                    std::sync::Arc::new(move |update| {
                        if let Some(channel) = subscriber_slot.lock().unwrap().as_ref() {
                            let _ = channel.send(update);
                        }
                    }),
                )),
                channel: slot,
            }
        });
        *entry.channel.lock().unwrap() = Some(on_update);
        entry
            .set
            .clone()
            .start_owned(spec, ctx, Some(authority))
            .map_err(AgentToolsError::from)
    }
}

/// Stop one of a thread's monitors. Scoped to the calling thread's own set, so
/// a monitor id from another conversation is simply unknown here.
#[tauri::command]
pub async fn stop_thread_monitor(
    thread_id: String,
    monitor_id: String,
) -> Result<String, AgentToolsError> {
    let set = thread_monitors()
        .lock()
        .unwrap()
        .get(&thread_id)
        .map(|entry| entry.set.clone());
    Ok(match set {
        Some(set) => set.stop(&monitor_id),
        None => format!("ERROR: unknown or already-stopped monitor '{monitor_id}'"),
    })
}

#[tauri::command]
pub async fn list_thread_monitors(thread_id: String) -> Result<String, AgentToolsError> {
    let set = thread_monitors()
        .lock()
        .unwrap()
        .get(&thread_id)
        .map(|entry| entry.set.clone());
    Ok(match set {
        Some(set) => set.list(),
        None => "No active monitors.".to_string(),
    })
}

/// Stop every monitor a thread still has, and reap their poll children.
#[tauri::command]
pub async fn stop_all_thread_monitors(thread_id: String) -> Result<(), AgentToolsError> {
    stop_thread_monitors_and_children(&thread_id).await;
    Ok(())
}

/// Advance the barrier (`advance` is [`crate::thread_capabilities::deny_in_memory`]
/// for a revocation, [`crate::thread_capabilities::bump_generation`] for a
/// plain stop) and empty this thread's process bucket under the admission
/// guard, then reap outside it. Returns the new generation token.
///
/// The barrier move and the bucket drain are what must be atomic against a
/// poll's {check generation, spawn, register}: a poll that got the guard first
/// has already registered, so its pid is in the returned list; a poll that
/// gets it afterwards sees the new generation and refuses to spawn. Reaping
/// outside keeps the blocking Windows `taskkill` off the global mutex (and off
/// the per-thread consent lock the setter holds above it).
async fn reap_thread_monitor_children(thread_id: &str, advance: fn(&str) -> u64) -> u64 {
    let (token, pids) = {
        let _admitted = crate::thread_capabilities::admission().lock().await;
        let token = advance(thread_id);
        (
            token,
            crate::tools::proc::take_thread_pids(&monitor_owner(thread_id)),
        )
    };
    for pid in pids {
        crate::tools::proc::kill_tree(pid);
    }
    token
}

/// Stop-all is not a revocation: the barrier bump keeps an already-resolved
/// poll from spawning after the reap, while the confirmed grant survives for
/// the next start. Only `narrow` (the setter, revoke, delete) denies.
async fn stop_thread_monitors_and_children(thread_id: &str) {
    let set = thread_monitors()
        .lock()
        .unwrap()
        .remove(thread_id)
        .map(|entry| entry.set);
    reap_thread_monitor_children(thread_id, crate::thread_capabilities::bump_generation).await;
    if let Some(set) = set {
        set.stop_all();
    }
}

/// Narrow a thread's host confirmation immediately, ahead of any queued
/// persistence.
///
/// Narrow-only: it can deny but never grant, so exposing it to the webview
/// cannot widen authority. The frontend calls it the moment a revocation is
/// requested, because its own save queue may hold an earlier in-flight write;
/// without this the native mirror would keep authorizing polls until that
/// queue drained. The strict setter narrows again when it runs, which is what
/// covers callers that never go through the frontend.
#[tauri::command]
pub async fn revoke_thread_capabilities(thread_id: String) -> Result<(), AgentToolsError> {
    revoke_thread_consent(&thread_id).await;
    crate::thread_capabilities::denial_persisted(&thread_id).map_err(AgentToolsError::from)?;
    Ok(())
}

/// Narrow a thread's host confirmation and stop everything running under it,
/// returning the generation token a subsequent confirm must present.
///
/// The strict consent setter calls this BEFORE the write, for every caller
/// rather than only the frontend, so a write that fails or is lost can never
/// leave an earlier confirmation live. (Input validation runs first: a
/// rejected request writes nothing and narrows nothing.) The mirror is never
/// restored on failure; it is re-confirmed only by a successful write.
pub async fn revoke_thread_consent(thread_id: &str) -> u64 {
    let token = deny_thread_and_stop_monitors(
        thread_id, crate::thread_capabilities::deny_in_memory,
    ).await;
    crate::thread_capabilities::persist_denial_async(thread_id.to_string(), token).await;
    token
}

async fn deny_thread_and_stop_monitors(thread_id: &str, advance: fn(&str) -> u64) -> u64 {
    let token = reap_thread_monitor_children(thread_id, advance).await;
    let set = thread_monitors()
        .lock()
        .unwrap()
        .remove(thread_id)
        .map(|entry| entry.set);
    if let Some(set) = set {
        set.stop_all();
    }
    token
}

/// Kill every shell tree registered under a thread's RAW process bucket (the
/// one the Stop button's `cancel_thread_bash` drains), which is disjoint from
/// the `thread-monitor:` bucket a revocation reaps.
///
/// Called at the delete/rollback boundary, where the conversation itself is
/// going away, so nothing it started may outlive it. A consent *revocation*
/// deliberately does not call this: revocation narrows what the next dispatch
/// may run, while an in-flight shell stays the UI Stop button's to cancel.
pub fn cancel_thread_shells(thread_id: &str) {
    crate::tools::proc::kill_thread(thread_id);
}

/// Finalize deletion after the host acknowledged a durable revoke and removed
/// the record. Preserve that denial without any further fallible marker I/O;
/// invalidate stale polls and drain monitors under the same admission barrier.
pub async fn forget_thread_consent(thread_id: &str) {
    deny_thread_and_stop_monitors(thread_id, crate::thread_capabilities::clear).await;
}

/// Confirm elevations after the strict setter actually wrote them. Returns
/// false when a newer narrow intervened, in which case the thread stays
/// denied -- fail closed.
pub async fn confirm_thread_consent(
    thread_id: &str,
    grant: crate::thread_capabilities::ThreadCapabilities,
    token: u64,
) -> bool {
    crate::thread_capabilities::confirm_async(thread_id.to_string(), grant, token).await
}

/// Validate the folder a surface asked to attach (Cowork's shared folder, chat's
/// read-only attachment): plural from the outset so attaching a second folder
/// later is not another signature change. A writable attach must also pass
/// [`workspace::validate_write_root`].
fn attach_folder(
    folder: Option<&str>,
    sandbox: &Path,
    data_folder: &Path,
    writable: bool,
) -> Result<Vec<PathBuf>, AgentToolsError> {
    let Some(folder) = folder else {
        return Ok(Vec::new());
    };
    let root = workspace::validate_read_root(Path::new(folder), sandbox, Some(data_folder))?;
    if writable {
        workspace::validate_write_root(&root, workspace::user_home().as_deref(), data_folder)?;
    }
    Ok(vec![root])
}

/// Pick the workspace root a tool call resolves relative paths against, plus the
/// side roots it may read and write.
///
/// A writable attached folder (Cowork's shared folder) is the workspace root
/// itself, not merely a reachable side root: relative paths resolve against the
/// root, so with the ephemeral sandbox as the root a bare `deck.html` lands in
/// the Jan data folder instead of the directory the user selected (#8882).
///
/// Promoting the folder changes only where an unqualified path resolves, never
/// what is reachable: the sandbox stays a read+write side root, so the agent's
/// own scratch and the user attachments Cowork stages there
/// (`attachment_import`) remain readable and writable by their absolute path.
/// The set of writable locations -- folder, sandbox, scratch -- is exactly what
/// it was before, with the folder as the base rather than the sandbox.
///
/// A read-only attach (chat) or no attach keeps the sandbox as the root, with
/// the attached folder as a read-only side root.
fn resolve_workspace_root(
    sandbox: PathBuf,
    attached: Vec<PathBuf>,
    writable: bool,
) -> (PathBuf, Vec<PathBuf>, Vec<PathBuf>) {
    match (writable, attached.first()) {
        (true, Some(folder)) => (folder.clone(), vec![sandbox.clone()], vec![sandbox]),
        _ => (sandbox, attached, Vec::new()),
    }
}

/// Execute one built-in tool.
///
/// The gate decides, not the caller. `write` and `edit` resolve to `Prompt` and
/// are refused here regardless of what the frontend asks for, until a permission
/// round-trip exists; a read that escapes the project root prompts too. `bash`
/// runs only under an enforcing sandbox (see the module docs).
///
/// `plan_mode` is the Cowork run's effective Plan state at dispatch. It is
/// required (a caller that predates it fails closed at IPC deserialization, it
/// is never defaulted to `false`) and only tightens: tool hooks go inert and the
/// mutating tools are refused, exactly as for scoped Chat.
#[tauri::command]
// `read_only_project` is a folder the user attached read-only. It is validated
// here rather than trusted: an unusable one is an error, never a silent drop,
// or the agent would work against a folder it believes is attached and is not.
#[allow(clippy::too_many_arguments)]
pub async fn execute_tool<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    data_folder: String,
    thread_id: String,
    project: Option<String>,
    name: String,
    args: serde_json::Value,
    enabled_skills: Option<Vec<String>>,
    allow_network: Option<bool>,
    read_only_project: Option<String>,
    project_writable: Option<bool>,
    scope: Option<WorkspaceScope>,
    call_id: Option<String>,
    plan_mode: bool,
) -> Result<ToolResult, AgentToolsError> {
    guard_caller_session(
        scope,
        &thread_id,
        &name,
        &args,
        allow_network,
        read_only_project.as_deref(),
        project_writable,
    )
    .await?;
    execute_tool_inner(
        screenshot_backend(&app),
        data_folder,
        thread_id,
        project,
        name,
        args,
        enabled_skills,
        allow_network,
        read_only_project,
        project_writable,
        scope,
        call_id,
        None,
        ToolRun {
            plan_mode,
            folder_skills: false,
        },
    )
    .await
}

/// Chat-only execution: both persisted consent and the caller's narrower
/// effective limits must authorize each capability. Legacy Cowork is separate.
///
/// `plan_mode` is the caller's *effective, run-latched* Plan state at dispatch
/// (enabled mid-run stays on; a later toggle-off cannot widen the active turn;
/// the reviewed Execute transition sends `false`). It is required, so a caller
/// that predates it fails closed at IPC deserialization rather than silently
/// running tool hooks in Plan. It can only tighten: native honors it by making
/// tool hooks inert (a hook is a shell command with the folder's write grant)
/// and by refusing mutating tools outright.
#[tauri::command]
pub async fn execute_thread_tool<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    thread_id: String,
    tool_name: String,
    args: serde_json::Value,
    effective_grant: crate::thread_capabilities::ThreadCapabilities,
    plan_mode: bool,
) -> Result<ToolResult, AgentToolsError> {
    let (data_folder, stored) = crate::thread_capabilities::snapshot(thread_id.clone()).await?;
    execute_thread_tool_inner(
        screenshot_backend(&app),
        data_folder,
        thread_id,
        tool_name,
        args,
        stored,
        effective_grant,
        plan_mode,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn execute_thread_tool_inner(
    backend: Option<crate::tools::ScreenshotBackend>,
    data_folder: PathBuf,
    thread_id: String,
    name: String,
    args: serde_json::Value,
    stored: serde_json::Value,
    effective: crate::thread_capabilities::ThreadCapabilities,
    plan_mode: bool,
) -> Result<ToolResult, AgentToolsError> {
    // No loop-dispatched monitor/subagent tools, management commands, legacy
    // aliases or unknown tools can enter this narrow surface.
    if !matches!(
        name.as_str(),
        "read"
            | "ls"
            | "find"
            | "grep"
            | "write"
            | "edit"
            | "shell"
            | "memory"
            | "skill_list"
            | "skill_read"
            | "skill_write"
    ) || lookup(&name).is_none()
    {
        return Err(format!("unknown Chat tool '{name}'").into());
    }
    let stored: crate::thread_capabilities::ThreadCapabilities = serde_json::from_value(stored)
        .map_err(|e| AgentToolsError::from(format!("Invalid stored consent: {e}")))?;
    // Folder access requires process-local confirmation too: a stale disk
    // grant or a revoke whose disk write is still in flight cannot restore it.
    // Network/memory are instead host-owned app-wide settings (see below).
    let (mirror, _) = crate::thread_capabilities::current(&thread_id);
    // Global settings supply persistent Chat authority, never temporary Chat
    // authority or permission to widen a frozen run ceiling. A forged effective
    // grant cannot elevate temporary Chat. Confirmation controls folders only.
    let grant = stored
        .with_global(&thread_id)
        .intersect(effective)?
        .intersect(mirror.with_global(&thread_id))?;
    if is_durable_mutation(&name, &args) && !grant.memory_write {
        return Err(
            format!("tool '{name}' mutation is not authorized for this conversation").into(),
        );
    }
    let folder = grant.folder_scope.as_ref().map(|f| f.path.clone());
    let writable = grant
        .folder_scope
        .as_ref()
        .is_some_and(|f| f.access == "write");
    execute_tool_inner(
        backend,
        data_folder.to_string_lossy().into_owned(),
        thread_id,
        None,
        name,
        args,
        None,
        Some(grant.shell_network),
        folder,
        Some(writable),
        Some(WorkspaceScope::Thread),
        None,
        None,
        ToolRun {
            plan_mode,
            folder_skills: true,
        },
    )
    .await
}

/// The webview-backed `screenshot` renderer on the desktop (Linux, macOS,
/// Windows); `None` everywhere else, which renders through headless Chrome.
#[cfg(all(
    feature = "tauri",
    any(target_os = "linux", target_os = "macos", target_os = "windows")
))]
fn screenshot_backend<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Option<crate::tools::ScreenshotBackend> {
    Some(crate::webview_shot::make_backend(app))
}

#[cfg(not(all(
    feature = "tauri",
    any(target_os = "linux", target_os = "macos", target_os = "windows")
)))]
fn screenshot_backend<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
) -> Option<crate::tools::ScreenshotBackend> {
    None
}

/// `execute_tool`, plus a channel that receives the tool's output as it is
/// produced. A separate command rather than an optional argument because
/// `tauri::ipc::Channel` is a `CommandArg`, not a `Deserialize`, so it cannot be
/// wrapped in `Option`.
#[cfg(feature = "tauri")]
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn execute_tool_streaming<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    data_folder: String,
    thread_id: String,
    project: Option<String>,
    name: String,
    args: serde_json::Value,
    enabled_skills: Option<Vec<String>>,
    allow_network: Option<bool>,
    read_only_project: Option<String>,
    project_writable: Option<bool>,
    scope: Option<WorkspaceScope>,
    call_id: Option<String>,
    on_output: tauri::ipc::Channel<ToolOutputChunk>,
    plan_mode: bool,
) -> Result<ToolResult, AgentToolsError> {
    let sink = output_sink(on_output, call_id.clone());
    guard_caller_session(
        scope,
        &thread_id,
        &name,
        &args,
        allow_network,
        read_only_project.as_deref(),
        project_writable,
    )
    .await?;
    execute_tool_inner(
        screenshot_backend(&app),
        data_folder,
        thread_id,
        project,
        name,
        args,
        enabled_skills,
        allow_network,
        read_only_project,
        project_writable,
        scope,
        call_id,
        Some(sink),
        ToolRun {
            plan_mode,
            folder_skills: false,
        },
    )
    .await
}

// Both legacy IPC entry points share these guards. `scope=Session` is a
// caller-chosen IPC argument, so it is never identity: an elevated Session call
// proceeds only when the host itself classifies the thread id as Cowork (see
// `thread_capabilities::thread_kind`). Only the dedicated Chat command may
// supply authority for a Chat thread. The private executor is not an IPC surface.

/// Whether a call asks for anything beyond unprivileged scratch tools:
/// network, an attached folder, folder writes, memory/skill mutation, or an
/// outbound (renderer/net) tool.
fn requests_elevation(
    name: &str,
    args: &serde_json::Value,
    network: Option<bool>,
    folder: Option<&str>,
    writable: Option<bool>,
) -> bool {
    let mutation = is_durable_mutation(name, args);
    // Renderers may fetch remote subresources outside the shell jail. Native
    // web tools have their separate approved frontend path, not this legacy
    // thread executor. Neither can bypass scoped Chat via old IPC dispatch.
    let outbound = name == "screenshot"
        || lookup(name).is_some_and(|tool| matches!(tool.capability, crate::tools::Capability::Net));
    network == Some(true) || writable == Some(true) || folder.is_some() || mutation || outbound
}

fn is_durable_mutation(name: &str, args: &serde_json::Value) -> bool {
    name == "skill_write"
        || (name == crate::tools::MEMORY_TOOL
            && !matches!(
                args.get("op").and_then(|v| v.as_str()),
                Some("view" | "search")
            ))
}

/// Shared by both legacy IPC variants and scoped Chat dispatch. Management
/// commands are intentionally separate: this gates model-dispatched tools.
fn enforce_global_tool_policy(
    name: &str,
    args: &serde_json::Value,
    requested_network: Option<bool>,
    global: crate::thread_capabilities::GlobalGrants,
) -> Result<bool, AgentToolsError> {
    if is_durable_mutation(name, args) && !global.memory_write {
        return Err(format!("tool '{name}' mutation is not authorized by global settings").into());
    }
    Ok(requested_network.unwrap_or(false) && global.shell_network)
}

/// Pure decision for a legacy call: `scope=Session` elevation depends on the
/// host-resolved kind, every other scope may never elevate.
fn legacy_elevation_decision(
    scope: Option<WorkspaceScope>,
    kind: crate::thread_capabilities::ThreadKind,
    elevated: bool,
) -> Result<(), AgentToolsError> {
    if !elevated {
        return Ok(());
    }
    if !matches!(scope, Some(WorkspaceScope::Session)) {
        return Err("Chat capability access requires execute_thread_tool"
            .to_string()
            .into());
    }
    if kind.allows_elevated_session() {
        Ok(())
    } else {
        Err("Elevated Session access requires a host-verified Cowork session"
            .to_string()
            .into())
    }
}

/// Test-only model of the pre-host-kind guard (`scope=Session` always passes,
/// every other scope is judged with an `Unknown` kind). Production dispatch
/// goes through [`guard_caller_session`].
#[cfg(test)]
fn reject_legacy_thread_elevation(
    scope: Option<WorkspaceScope>,
    name: &str,
    args: &serde_json::Value,
    network: Option<bool>,
    folder: Option<&str>,
    writable: Option<bool>,
) -> Result<(), AgentToolsError> {
    if matches!(scope, Some(WorkspaceScope::Session)) {
        return Ok(());
    }
    legacy_elevation_decision(
        scope,
        crate::thread_capabilities::ThreadKind::Unknown,
        requests_elevation(name, args, network, folder, writable),
    )
}

/// Runs before any setup side effect. The host kind is consulted only for an
/// elevated Session call; scratch-only calls keep their existing contract.
async fn guard_caller_session(
    scope: Option<WorkspaceScope>,
    thread_id: &str,
    name: &str,
    args: &serde_json::Value,
    network: Option<bool>,
    folder: Option<&str>,
    writable: Option<bool>,
) -> Result<(), AgentToolsError> {
    let elevated = requests_elevation(name, args, network, folder, writable);
    let kind = if elevated && matches!(scope, Some(WorkspaceScope::Session)) {
        crate::thread_capabilities::thread_kind(thread_id).await
    } else {
        crate::thread_capabilities::ThreadKind::Unknown
    };
    legacy_elevation_decision(scope, kind, elevated)
}

/// The hooks for one call. Tests substitute a per-thread set, because the real
/// resolver is a process-wide `OnceLock` shared by every test in the binary.
fn resolve_hooks(project: Option<&Path>, thread_id: &str) -> crate::tools::hooks::HookSet {
    #[cfg(test)]
    if let Some(set) = tests::test_hooks(thread_id) {
        return set;
    }
    #[cfg(not(test))]
    let _ = thread_id;
    crate::tools::hooks::resolve_for(project)
}

/// Per-call execution policy. `plan_mode` comes from the caller's run-latched
/// policy and can only tighten execution. `folder_skills` is host-only: only
/// [`execute_thread_tool_inner`] enables host-derived authorized folder skills.
#[derive(Debug, Clone, Copy, Default)]
struct ToolRun {
    /// Effective run-latched Plan: tool hooks are inert (they are shell commands
    /// running with the folder's grant, so a Plan-allowed read must not fire one).
    plan_mode: bool,
    /// Derive skill roots and the enabled whitelist from the effective authorized
    /// folder (the validated `read_only_project`), never from a caller path.
    folder_skills: bool,
}

#[allow(clippy::too_many_arguments)]
async fn execute_tool_inner(
    screenshot_backend: Option<crate::tools::ScreenshotBackend>,
    data_folder: String,
    thread_id: String,
    project: Option<String>,
    name: String,
    args: serde_json::Value,
    enabled_skills: Option<Vec<String>>,
    allow_network: Option<bool>,
    read_only_project: Option<String>,
    project_writable: Option<bool>,
    scope: Option<WorkspaceScope>,
    call_id: Option<String>,
    sink: Option<crate::tools::OutputSink>,
    run: ToolRun,
) -> Result<ToolResult, AgentToolsError> {
    // Plan is read-only. Callers already refuse these, but the host does not
    // rely on that: the latched bit it was handed refuses them here too, on
    // every entry point (scoped Chat and legacy Cowork, streaming included).
    if run.plan_mode && matches!(name.as_str(), "write" | "edit" | "shell" | "skill_write") {
        return Err(format!(
            "tool '{name}' is disabled in Plan mode, which is read-only. Stage changes in the \
             plan and ask the user to leave Plan mode before implementation."
        )
        .into());
    }
    let allow_network = enforce_global_tool_policy(
        &name,
        &args,
        allow_network,
        crate::thread_capabilities::get_global_grants(),
    )?;
    let data_folder = workspace::host_data_folder(&data_folder);
    // Created here rather than trusted to exist: `escapes_project` canonicalizes
    // the sandbox root and treats a missing one as an escape, so every tool call
    // would be refused if the thread's first tool call arrived before any UI
    // surface had ensured it.
    let sandbox = scope
        .unwrap_or_default()
        .ensure(Path::new(&data_folder), &thread_id)
        .await?;
    let scratch = workspace::ensure_scratch_dir(&thread_id).await?;
    // Base store for memory and skill *writes*: always the permanent store,
    // independent of `project`. `project` only overlays its co-located skills on
    // top for `skill_list`/`skill_read` (#8879), so an attached folder's skills
    // reach the model without moving memory or authored skills off the permanent
    // store. (Equivalent to the old `resolve_store(.., None)`, which is what every
    // caller passed.)
    let store = workspace::permanent_store(Path::new(&data_folder));
    let project_dir: Option<PathBuf> = project
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(PathBuf::from);
    let writable = project_writable.unwrap_or(false);
    let attached = attach_folder(
        read_only_project.as_deref(),
        &sandbox,
        &data_folder,
        writable,
    )?;
    // Scoped Chat: the skill overlay and whitelist belong to the folder the host
    // just validated from the effective grant, exactly what the composer
    // discovers from. Legacy callers keep the project they passed (Cowork).
    let skill_folder: Option<PathBuf> = if run.folder_skills {
        attached.first().cloned()
    } else {
        project_dir.clone()
    };
    let skill_project: Option<PathBuf> = skill_folder.as_deref().map(workspace::project_store);
    let (root, read_roots, write_roots) = resolve_workspace_root(sandbox, attached, writable);
    let tool = lookup(&name)
        .ok_or_else(|| AgentToolsError::from(format!("unknown built-in tool '{name}'")))?;
    // The desktop always sandboxes, and an attached project folder can be the
    // user's home, which puts the CLI's `~/.jan` inside it.
    let hidden = workspace::hidden_root(true);

    match gate::resolve_decision(
        tool,
        &args,
        &gate::GateContext {
            project_root: &root,
            scratch: Some(&scratch),
            read_roots: &read_roots,
            write_roots: &write_roots,
            hidden_root: hidden.as_deref(),
        },
        &ToolPermissions::default(),
        &SessionGrants::default(),
    ) {
        Decision::Allow => {}
        Decision::HardDeny(gate::DenyReason::Policy) => {
            return Err(format!("tool '{name}' is denied by policy").into());
        }
        Decision::HardDeny(gate::DenyReason::Hidden) => {
            return Err(format!("tool '{name}' is denied: the Jan home (~/.jan) is hidden").into());
        }
        // An exec prompt asks the user to vouch for a command that could reach
        // anything. Under an enforcing sandbox it cannot: writes stay in the
        // thread workspace and $HOME is unreadable, so the containment the prompt
        // was protecting is already guaranteed. The gate itself is left alone,
        // because the CLI agent *does* want to prompt here.
        Decision::Prompt(PromptKind::Exec) if jail::backend().enforces() => {}
        // Same reasoning for writes, from the other direction. `root` here is
        // always `ensure_thread_workspace`, never a real project: an ephemeral
        // directory deleted with the conversation, which `escapes_project`
        // confines and whose sibling -- not child -- is the permanent store. So
        // no durable user data is in range for the prompt to protect, and
        // refusing here while `bash` may already write the same files would be a
        // control a sibling tool bypasses.
        //
        // With `project_writable` the attached folder is in range too. That is
        // the surface's own opt-in (Cowork's shared folder): the user attached
        // the folder to be worked on, its UI shows every change as a diff, and
        // `bash` under the jail can already write there -- so a prompt here
        // would again be a control a sibling tool bypasses.
        //
        // A write that *escapes* the sandbox (absolute or `..`) is different:
        // it can reach host files (rc files, ssh keys, LaunchAgents, the store)
        // that the ephemeral-root reasoning does not cover. It is gated as
        // `WriteEscape` and refused here outright, since this surface has no
        // prompt round-trip to approve it.
        Decision::Prompt(PromptKind::Write) => {}
        // The message matters as much as the refusal: told only "refused", a
        // model retries the same write until the step budget runs out.
        Decision::Prompt(PromptKind::WriteEscape) => {
            // Branch on `write_roots`, not `read_roots`: a writable attach keeps
            // the sandbox in `read_roots`, so keying the read-only advice off
            // `read_roots.first()` would misname the sandbox as an unwritable
            // user folder.
            return Err(match read_roots.first() {
                // Chat's read-only attach: the folder is a readable side root but
                // never the write target, so point the model back at the
                // workspace rather than the folder.
                Some(attached) if write_roots.is_empty() => format!(
                    "tool '{name}' cannot write outside the agent workspace {}. The attached \
                     folder {} is mounted read-only; copy the file into the workspace and \
                     edit it there.",
                    root.display(),
                    attached.display()
                ),
                // A writable attach makes the folder the workspace root (#8882),
                // and a run with no attach has only the sandbox: either way the
                // workspace is the one writable place, so naming it tells the
                // model exactly where its writes must land.
                _ => format!(
                    "tool '{name}' cannot write outside the agent workspace {} and was refused.",
                    root.display()
                ),
            }
            .into());
        }
        // The chat sandbox is throwaway by design and never lifted: escalation
        // is a CLI capability, so say so rather than "not available yet".
        Decision::Prompt(PromptKind::Escalate) => {
            return Err(format!(
                "tool '{name}' cannot run outside the sandbox here; the command was not run. \
                 Run it without `escalate`."
            )
            .into());
        }
        Decision::Prompt(kind) => {
            return Err(format!(
                "tool '{name}' needs user approval ({kind:?}) and is not available yet"
            )
            .into());
        }
    }

    let enabled = match (run.folder_skills, skill_folder.as_deref()) {
        (true, Some(folder)) => skills::enabled_for_project(folder),
        _ => enabled_skills.unwrap_or_default(),
    };
    // The hooks that apply to this call, resolved through the app-installed
    // resolver (`hooks::set_resolver`): this command is handed one tool call
    // with no run around it, so unlike the CLI loop it has no run-start
    // snapshot to carry. Without this the desktop would be the one surface a
    // user's `[[hooks]]` silently did not reach.
    //
    // `project` is the attached folder Cowork passes, which is the only project
    // this surface knows about; chat has none and gets the user's global hooks
    // alone.
    let hooks = resolve_hooks(project_dir.as_deref(), &thread_id);
    let mut ctx = ToolContext::new(&root, &store, &enabled)
        .with_hooks(&hooks, run.plan_mode, None)
        .with_network(allow_network)
        .with_confined_writes(true)
        .with_mask_root(Path::new(&data_folder))
        .with_scratch_root(&scratch)
        .with_read_roots(&read_roots)
        .with_write_roots(&write_roots)
        .with_hidden_root(hidden.as_deref())
        .with_thread_id(Some(&thread_id))
        .with_screenshot_backend(screenshot_backend);
    if let Some(sp) = skill_project.as_deref() {
        ctx = ctx.with_skill_project_root(sp);
    }
    if let Some(id) = call_id.as_deref() {
        ctx = ctx.with_call_id(id);
    }
    if let Some(sink) = sink {
        ctx = ctx.with_output_sink(sink);
    }
    let (content, diff, images) = handlers::execute_builtin_with_diff(tool, &args, &ctx).await;
    let content = with_renamed_tool_notices(tool.name, content, &hooks);
    let is_error = handlers::tool_result_failed(tool, &content);
    Ok(ToolResult {
        content,
        diff,
        is_error,
        images: images.unwrap_or_default(),
    })
}

/// Let the `preview://` scheme serve files under `root`, with `allow_network`
/// as the page policy. Re-registering the same root replaces the flag. Refused
/// on Windows; see [`PreviewRoots::register_unsandboxed`].
#[tauri::command]
pub fn preview_register_root(
    roots: tauri::State<'_, PreviewRoots>,
    root: String,
    allow_network: bool,
) -> Result<(), AgentToolsError> {
    roots.register_unsandboxed(Path::new(&root), allow_network)?;
    Ok(())
}

#[tauri::command]
pub fn preview_unregister_root(roots: tauri::State<'_, PreviewRoots>, root: String) {
    roots.unregister(Path::new(&root));
}

/// Cowork's "Open": hand an agent-written file to its OS default app, once
/// [`artifact::checked_artifact`] has checked the file itself, not just its
/// name, against the session's folders in `roots`. A refusal is an error the
/// frontend answers by revealing the file instead.
#[tauri::command]
pub async fn open_artifact<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    data_folder: String,
    roots: Vec<String>,
    path: String,
) -> Result<(), AgentToolsError> {
    use tauri_plugin_opener::OpenerExt;
    let data_folder = workspace::host_data_folder(&data_folder);
    let roots = artifact::open_roots(&data_folder, &roots);
    let file = artifact::checked_artifact(Path::new(&path), &roots)?;
    // The canonical path, so what opens is what was checked; without the
    // `\\?\` prefix `canonicalize` adds on Windows, which not every handler accepts.
    let file = crate::tools::proc::without_verbatim_prefix(&file);
    app.opener()
        .open_path(file.to_string_lossy(), None::<&str>)
        .map_err(|e| AgentToolsError::from(e.to_string()))
}

/// One `preview://` request. Anything not resolvable to a file under a
/// registered root is a 404 with no detail: the requester is model markup.
pub fn preview_response<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    request_path: &str,
) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{header, Response, StatusCode};
    use tauri::Manager;
    let not_found = || {
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Vec::new())
            .expect("static response")
    };
    let Some(served) = app.state::<PreviewRoots>().resolve(request_path) else {
        return not_found();
    };
    let Ok(body) = std::fs::read(&served.path) else {
        return not_found();
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, preview::mime_for(&served.path))
        .header(
            header::CONTENT_SECURITY_POLICY,
            preview::csp(served.allow_network),
        )
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .unwrap_or_else(|_| not_found())
}

/// Build the live-output sink.
///
/// `OutputSink` is `Fn`, not `FnMut`, so the sequence counter and the byte
/// budget live in atomics. The channel is `Clone + Send + Sync + 'static`, which
/// is what lets a detached background job keep reporting after the call that
/// created the sink has returned.
#[cfg(feature = "tauri")]
fn output_sink(
    channel: tauri::ipc::Channel<ToolOutputChunk>,
    call_id: Option<String>,
) -> crate::tools::OutputSink {
    use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
    use std::sync::Arc;

    let seq = Arc::new(AtomicU64::new(0));
    let sent = Arc::new(AtomicUsize::new(0));
    let stopped = Arc::new(AtomicBool::new(false));
    Arc::new(move |text: String| {
        if stopped.load(Ordering::Relaxed) {
            return;
        }
        let total = sent.fetch_add(text.len(), Ordering::Relaxed) + text.len();
        // One honest final chunk rather than silently going quiet.
        let payload = if total > MAX_STREAMED_BYTES {
            stopped.store(true, Ordering::Relaxed);
            "\n[output truncated in the live view]\n".to_string()
        } else {
            text
        };
        let chunk = ToolOutputChunk {
            seq: seq.fetch_add(1, Ordering::Relaxed),
            call_id: call_id.clone(),
            text: payload,
        };
        // A send error means the webview is gone; stop rather than keep trying
        // for the lifetime of a backgrounded job.
        if channel.send(chunk).is_err() {
            stopped.store(true, Ordering::Relaxed);
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};


    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// Per-thread hook sets: the production resolver is a process-wide
    /// `OnceLock`, so tests cannot each install their own.
    fn hook_map() -> &'static Mutex<std::collections::HashMap<String, crate::tools::hooks::HookSet>> {
        static MAP: std::sync::OnceLock<
            Mutex<std::collections::HashMap<String, crate::tools::hooks::HookSet>>,
        > = std::sync::OnceLock::new();
        MAP.get_or_init(Default::default)
    }
    pub(super) fn test_hooks(thread_id: &str) -> Option<crate::tools::hooks::HookSet> {
        hook_map().lock().unwrap().get(thread_id).cloned()
    }

    /// Chunks recorded by [`test_sink`]: monotonic `(seq, call_id, text)`.
    type SeenChunks = Arc<Mutex<Vec<(u64, Option<String>, String)>>>;

    /// A temp dir standing in for the Jan data folder.
    #[test]
    fn legacy_thread_entry_points_cannot_supply_capability_authority() {
        for scope in [None, Some(WorkspaceScope::Thread)] {
            for (name, args, network, folder, writable) in [
                ("read", serde_json::json!({}), Some(true), None, None),
                ("read", serde_json::json!({}), None, Some("/forged"), None),
                ("write", serde_json::json!({}), None, None, Some(true)),
                (
                    "memory",
                    serde_json::json!({"op":"write"}),
                    None,
                    None,
                    None,
                ),
                ("skill_write", serde_json::json!({}), None, None, None),
                ("screenshot", serde_json::json!({}), None, None, None),
                ("web_fetch", serde_json::json!({}), None, None, None),
                ("web_search", serde_json::json!({}), None, None, None),
            ] {
                assert!(reject_legacy_thread_elevation(
                    scope, name, &args, network, folder, writable
                )
                .is_err());
                assert!(reject_legacy_thread_elevation(
                    Some(WorkspaceScope::Session),
                    name,
                    &args,
                    network,
                    folder,
                    writable
                )
                .is_ok());
            }
        }
    }

    #[test]
    fn session_elevation_matrix_follows_host_kind() {
        use crate::thread_capabilities::ThreadKind::{self, *};
        let none = serde_json::json!({});
        type SessionCase<'a> = (&'a str, serde_json::Value, Option<bool>, Option<&'a str>, Option<bool>);
        let cases: [SessionCase<'_>; 6] = [
            ("shell", none.clone(), Some(true), None, None),
            ("read", none.clone(), None, Some("/folder"), None),
            ("write", none.clone(), None, Some("/folder"), Some(true)),
            ("memory", serde_json::json!({"op":"write"}), None, None, None),
            ("skill_write", none.clone(), None, None, None),
            ("web_fetch", none.clone(), None, None, None),
        ];
        for (name, args, net, folder, writable) in cases {
            assert!(requests_elevation(name, &args, net, folder, writable), "{name}");
            for kind in [Chat, Unknown, Cowork, LegacyCowork] {
                let allowed = legacy_elevation_decision(Some(WorkspaceScope::Session), kind, true).is_ok();
                assert_eq!(allowed, matches!(kind, Cowork | LegacyCowork), "{name} {kind:?}");
                for scope in [None, Some(WorkspaceScope::Thread)] {
                    assert!(legacy_elevation_decision(scope, kind, true).is_err(), "{name} {kind:?}");
                }
            }
        }
        // Unelevated scratch calls never consult the kind.
        let scratch = serde_json::json!({"op":"view"});
        assert!(!requests_elevation("memory", &scratch, None, None, Some(false)));
        for kind in [Chat, Unknown, Cowork, LegacyCowork] {
            let _: ThreadKind = kind;
            assert!(legacy_elevation_decision(Some(WorkspaceScope::Session), kind, false).is_ok());
        }
    }

    #[test]
    fn legacy_global_policy_blocks_mutations_and_caps_requested_network() {
        use crate::thread_capabilities::GlobalGrants;
        let off = GlobalGrants {
            shell_network: false,
            memory_write: false,
        };
        for (name, args) in [
            ("memory", json!({"op":"write"})),
            ("memory", json!({"op":"delete"})),
            ("memory", json!({"op":"rename"})),
            ("memory", json!({})),
            ("skill_write", json!({})),
        ] {
            assert!(enforce_global_tool_policy(name, &args, Some(true), off).is_err());
            assert!(enforce_global_tool_policy(name, &args, Some(true), GlobalGrants::default()).unwrap());
        }
        for op in ["view", "search"] {
            assert!(!enforce_global_tool_policy("memory", &json!({"op":op}), Some(true), off).unwrap());
        }
        assert!(!enforce_global_tool_policy("shell", &json!({}), Some(true), off).unwrap());
        assert!(!enforce_global_tool_policy("shell", &json!({}), Some(false), GlobalGrants::default()).unwrap());
    }

    #[tokio::test]
    async fn unconfirmed_session_elevation_fails_before_any_setup() {
        let data = unique_data_folder();
        let id = format!("session-elev-{}", data.file_name().unwrap().to_string_lossy());
        assert!(!data.exists());
        // No kind resolver is installed in this binary, so the kind is Unknown.
        let err = guard_caller_session(
            Some(WorkspaceScope::Session), &id, "shell", &json!({}), Some(true), None, None,
        )
        .await
        .unwrap_err();
        assert!(err.message.contains("host-verified Cowork"), "{}", err.message);
        guard_caller_session(
            Some(WorkspaceScope::Session), &id, "shell", &json!({}), None, None, None,
        )
        .await
        .unwrap();
        assert!(!data.exists());
        assert!(!workspace::scratch_dir_in(&workspace::project_cache_dir(None), &id).exists());
    }

    #[test]
    fn legacy_thread_guard_preserves_unprivileged_scratch_tools() {
        for scope in [None, Some(WorkspaceScope::Thread)] {
            for (name, args) in [
                ("read", json!({"path":"scratch.txt"})),
                ("write", json!({"path":"scratch.txt","content":"scratch"})),
                ("shell", json!({"command":"printf scratch"})),
            ] {
                for disabled in [None, Some(false)] {
                    assert!(reject_legacy_thread_elevation(
                        scope, name, &args, disabled, None, disabled
                    )
                    .is_ok(), "{name} with {scope:?} and {disabled:?}");
                }
            }
        }
    }

    #[tokio::test]
    async fn monitor_requires_session_scope_before_any_setup() {
        let data = unique_data_folder();
        let id = format!("monitor-scope-{}", data.file_name().unwrap().to_string_lossy());
        assert!(!data.exists());
        assert!(!workspace::scratch_dir_in(&workspace::project_cache_dir(None), &id).exists());
        for scope in [None, Some(WorkspaceScope::Thread)] {
            let channel = tauri::ipc::Channel::new(|_| {
                panic!("a refused monitor must not emit updates")
            });
            let err = start_monitor(
                data.to_string_lossy().into_owned(),
                id.clone(),
                json!({}), // Invalid arguments must never reach monitor parsing.
                None,
                None,
                None,
                scope,
                channel,
            )
            .await
            .unwrap_err();
            assert_eq!(err.message, "monitor is unavailable for Chat threads");
            assert!(!data.exists(), "refusal must not create a workspace");
            assert!(!workspace::scratch_dir_in(&workspace::project_cache_dir(None), &id).exists(), "refusal must not create scratch");
            assert!(!session_monitors().lock().unwrap().contains_key(&id));
        }
    }

    #[tokio::test]
    async fn elevated_session_monitor_requires_host_verified_cowork_before_setup() {
        let data = unique_data_folder();
        let id = format!("monitor-elev-{}", data.file_name().unwrap().to_string_lossy());
        let folder = data.join("attached");
        for (network, folder, writable) in [
            (Some(true), None, None),
            (None, Some(folder.to_string_lossy().into_owned()), None),
            (None, None, Some(true)),
        ] {
            let channel = tauri::ipc::Channel::new(|_| {
                panic!("a refused monitor must not emit updates")
            });
            let err = start_monitor(
                data.to_string_lossy().into_owned(),
                id.clone(),
                json!({}), // Must be refused before argument parsing.
                network,
                folder,
                writable,
                Some(WorkspaceScope::Session),
                channel,
            )
            .await
            .unwrap_err();
            assert!(err.message.contains("host-verified Cowork"), "{}", err.message);
            assert!(!data.exists(), "refusal must not create a workspace");
            assert!(!workspace::scratch_dir_in(&workspace::project_cache_dir(None), &id).exists(), "refusal must not create scratch");
            assert!(!session_monitors().lock().unwrap().contains_key(&id));
        }
    }

    /// "Stop my monitors" is not "revoke my consent": stop-all advances the
    /// TOCTOU barrier (an in-flight poll must not spawn after the reap) but
    /// must leave the host confirmation exactly as the strict setter left it.
    #[tokio::test]
    async fn stop_all_thread_monitors_keeps_the_confirmed_grant() {
        let id = "stop-all-keeps-grant";
        let token = crate::thread_capabilities::narrow(id);
        let grant = crate::thread_capabilities::ThreadCapabilities {
            version: 1,
            folder_scope: None,
            shell_network: true,
            memory_write: true,
        };
        assert!(confirm_thread_consent(id, grant, token).await);
        let confirmed_at = crate::thread_capabilities::generation(id);
        stop_all_thread_monitors(id.to_string()).await.unwrap();
        let (caps, generation) = crate::thread_capabilities::current(id);
        assert!(
            caps.shell_network && caps.memory_write,
            "stopping monitors must not revoke consent"
        );
        assert_ne!(generation, confirmed_at, "but the barrier must advance");
        assert_ne!(generation, 0);
    }

    #[tokio::test]
    async fn forget_thread_consent_serializes_final_barrier_with_monitor_admission() {
        let id = "forget-final-admission";
        let revoked_at = revoke_thread_consent(id).await;
        let admission = crate::thread_capabilities::admission().lock().await;
        let finalize = tokio::spawn(forget_thread_consent(id));
        tokio::task::yield_now().await;
        assert!(!finalize.is_finished(), "finalization must wait for admitted spawns");
        assert_eq!(crate::thread_capabilities::generation(id), revoked_at);
        drop(admission);
        finalize.await.unwrap();
        let (grant, finalized_at) = crate::thread_capabilities::current(id);
        assert_ne!(finalized_at, revoked_at, "invalidate pre-finalization polls");
        assert!(!grant.shell_network && !grant.memory_write && grant.folder_scope.is_none());
        assert!(!confirm_thread_consent(id, crate::thread_capabilities::denied(), revoked_at).await);
        assert!(!thread_monitors().lock().unwrap().contains_key(id));
    }

    #[test]
    fn raw_network_intersection_requires_both_inputs() {
        use crate::thread_capabilities::ThreadCapabilities;
        for stored in [false, true] {
            for effective in [false, true] {
                let stored: ThreadCapabilities =
                    serde_json::from_value(consent(None, false, stored, false)).unwrap();
                let effective: ThreadCapabilities =
                    serde_json::from_value(consent(None, false, effective, false)).unwrap();
                let expected = stored.shell_network && effective.shell_network;
                assert_eq!(stored.intersect(effective).unwrap().shell_network, expected);
            }
        }
    }

    fn consent(
        folder: Option<&Path>,
        writable: bool,
        network: bool,
        memory: bool,
    ) -> serde_json::Value {
        serde_json::json!({"version":1,"folderScope":folder.map(|p| serde_json::json!({"path":p,"access":if writable {"write"} else {"read"}})),"shellNetwork":network,"memoryWrite":memory})
    }

    async fn chat_call(
        data: &Path,
        name: &str,
        args: serde_json::Value,
        stored: serde_json::Value,
        effective: serde_json::Value,
    ) -> Result<ToolResult, AgentToolsError> {
        chat_call_in(data, name, args, stored, effective, false).await
    }

    async fn chat_call_in(
        data: &Path,
        name: &str,
        args: serde_json::Value,
        stored: serde_json::Value,
        effective: serde_json::Value,
        plan_mode: bool,
    ) -> Result<ToolResult, AgentToolsError> {
        // One thread id per data folder, so concurrently running tests cannot
        // see each other's host confirmation.
        let id = format!(
            "chat-boundary-{}",
            data.file_name().unwrap().to_string_lossy()
        );
        // The strict setter confirms exactly what it persisted, so these
        // boundary tests model host confirmation as "mirror == stored". The
        // unconfirmed (restart) case is exercised separately in
        // `one_shot_chat_elevation_requires_host_confirmation`.
        if let Ok(grant) =
            serde_json::from_value::<crate::thread_capabilities::ThreadCapabilities>(stored.clone())
        {
            let token = crate::thread_capabilities::narrow(&id);
            crate::thread_capabilities::confirm_if_current(&id, grant, token);
        }
        let result = execute_thread_tool_inner(
            None,
            data.to_path_buf(),
            id.clone(),
            name.into(),
            args,
            stored,
            serde_json::from_value(effective).unwrap(),
            plan_mode,
        )
        .await;
        crate::thread_capabilities::clear(&id);
        result
    }

    #[tokio::test]
    #[cfg_attr(
        windows,
        ignore = "re-execs the test binary as the AppContainer helper; covered by tests/sandbox_spawn.rs"
    )]
    async fn temporary_chat_keeps_scratch_without_accepting_forged_authority() {
        let data = unique_data_folder();
        let folder = repo_outside_tmp("temporary-chat-forged-folder");
        let outside = folder.join("private.txt");
        std::fs::write(&outside, "private folder content").unwrap();
        let denied = consent(None, false, false, false);
        let forged = consent(Some(&folder), true, true, true);
        // Deliberately bypass chat_call's persistent ID: this is the exact
        // temporary Chat dispatch with every elevated permission forged by the UI.
        // Global ON must not supply host authority to temporary Chat.
        let call = |name: &str, args| {
            execute_thread_tool_inner(
                None,
                data.clone(),
                "temporary-chat".into(),
                name.into(),
                args,
                denied.clone(),
                serde_json::from_value(forged.clone()).unwrap(),
                false,
            )
        };
        let shell = call("shell", json!({"command":"printf temporary-chat-shell"}))
            .await
            .expect("shell returns a result, including explicit sandbox refusal");
        if jail::backend().enforces() {
            assert!(!shell.is_error, "{}", shell.content);
            assert!(shell.content.contains("temporary-chat-shell"), "{}", shell.content);
        } else {
            assert!(shell.is_error);
            assert!(shell.content.contains("no OS sandbox"), "{}", shell.content);
        }

        let scratch = workspace::scratch_dir_in(&workspace::project_cache_dir(None), "temporary-chat")
            .join(format!("temporary-verifier-{}.txt", data.file_name().unwrap().to_string_lossy()));
        let write = call("write", json!({"path":scratch,"content":"temporary scratch"}))
            .await.unwrap();
        assert!(!write.is_error, "{}", write.content);
        let read = call("read", json!({"path":scratch})).await.unwrap();
        assert!(!read.is_error, "{}", read.content);
        assert!(read.content.contains("temporary scratch"), "{}", read.content);

        for (name, args) in [
            ("memory", json!({"op":"write","name":"forged","content":"no"})),
            ("skill_write", json!({"name":"forged","content":"no"})),
        ] {
            let err = call(name, args).await.unwrap_err();
            assert!(err.message.contains("not authorized"), "{}", err.message);
        }
        let err = call("read", json!({"path":outside})).await.unwrap_err();
        assert!(err.message.contains("ReadEscape"), "{}", err.message);
        assert_eq!(std::fs::read_to_string(&outside).unwrap(), "private folder content");
        assert!(!workspace::permanent_store(&data).join("memory/forged.md").exists());
        assert!(!workspace::permanent_store(&data).join("skills/forged").exists());
        // The fixed temporary ID can be shared: remove only our scratch file.
        let _ = std::fs::remove_file(scratch);
        let _ = std::fs::remove_dir_all(folder);
        let _ = std::fs::remove_dir_all(data);
    }


    // ---- Plan / hooks (QA01) ------------------------------------------------

    fn chat_id(data: &Path) -> String {
        format!("chat-boundary-{}", data.file_name().unwrap().to_string_lossy())
    }

    fn hook_for(event: &str, matcher: &str, command: &str) -> crate::tools::hooks::HookSet {
        let mut set = crate::tools::hooks::HookSet::new();
        set.extend_from(
            vec![crate::tools::hooks::HookEntry {
                event: event.into(),
                matcher: Some(matcher.into()),
                command: command.into(),
                timeout_secs: Some(20),
            }],
            Path::new("config.toml"),
        );
        set
    }

    /// A writable attached folder holding `known.txt`, a mutating hook on
    /// `event` matching `read`, and the call run with the given latched Plan.
    /// Returns (read result, whether the hook's marker appeared).
    async fn read_with_marker_hook(event: &str, plan_mode: bool) -> (ToolResult, bool) {
        let data = unique_data_folder();
        let folder = repo_outside_tmp("plan-hook");
        std::fs::write(folder.join("known.txt"), "known content").unwrap();
        hook_map().lock().unwrap().insert(
            chat_id(&data),
            hook_for(event, "read", "printf ran > plan-hook-marker.txt"),
        );
        let write = consent(Some(&folder), true, false, false);
        let out = chat_call_in(
            &data,
            "read",
            json!({"path": "known.txt"}),
            write.clone(),
            write,
            plan_mode,
        )
        .await
        .expect("read is a Plan-allowed tool and must run");
        let marker = folder.join("plan-hook-marker.txt").exists();
        hook_map().lock().unwrap().remove(&chat_id(&data));
        let _ = std::fs::remove_dir_all(folder);
        let _ = std::fs::remove_dir_all(data);
        (out, marker)
    }

    /// The positive control proves the hook and the enforcing sandbox really ran
    /// the mutation; without it "marker absent in Plan" would also be what a hook
    /// that never starts looks like.
    #[tokio::test]
    async fn plan_read_keeps_tool_hooks_inert_while_normal_read_runs_them() {
        if !jail::backend().enforces() {
            eprintln!("skipping: no enforcing OS sandbox, so hooks cannot start here");
            return;
        }
        for event in ["PreToolUse", "PostToolUse"] {
            let (normal, marker) = read_with_marker_hook(event, false).await;
            assert!(!normal.is_error, "{}", normal.content);
            assert!(marker, "{event}: control — a normal read must run the mutating hook");

            let (planned, marker) = read_with_marker_hook(event, true).await;
            assert!(!planned.is_error, "{}", planned.content);
            assert!(planned.content.contains("known content"), "{}", planned.content);
            assert!(!marker, "{event}: a Plan read must not run a mutating hook");
        }
    }

    #[tokio::test]
    async fn plan_mode_refuses_mutating_thread_tools_at_the_host() {
        let data = unique_data_folder();
        let folder = repo_outside_tmp("plan-refuse");
        let write = consent(Some(&folder), true, true, true);
        for (name, args) in [
            ("write", json!({"path": "x.txt", "content": "no"})),
            ("edit", json!({"path": "x.txt", "old_string": "a", "new_string": "b"})),
            ("shell", json!({"command": "touch shell-ran.txt"})),
            ("skill_write", json!({"name": "planned", "content": "no"})),
        ] {
            let err = chat_call_in(&data, name, args, write.clone(), write.clone(), true)
                .await
                .unwrap_err();
            assert!(err.message.contains("Plan mode"), "{name}: {}", err.message);
        }
        let err = chat_call_in(
            &data,
            "memory",
            json!({"op": "write", "name": "planned", "content": "no"}),
            write.clone(),
            write.clone(),
            true,
        )
        .await
        .unwrap();
        assert!(err.is_error, "Plan memory mutation must be refused: {}", err.content);
        assert!(!folder.join("x.txt").exists() && !folder.join("shell-ran.txt").exists());
        assert!(!workspace::permanent_store(&data).join("skills/planned").exists());
        // Plan reads (incl. skills and memory view) still work.
        for (name, args) in [
            ("ls", json!({"path": "."})),
            ("skill_list", json!({})),
            ("memory", json!({"op": "view"})),
        ] {
            let out = chat_call_in(&data, name, args, write.clone(), write.clone(), true)
                .await
                .unwrap();
            if name == "memory" {
                assert!(
                    !out.content.contains("plan_mode_read_only"),
                    "Plan must not refuse memory view: {}",
                    out.content
                );
            } else {
                assert!(!out.is_error, "{name}: {}", out.content);
            }
        }
        let _ = std::fs::remove_dir_all(folder);
        let _ = std::fs::remove_dir_all(data);
    }

    // ---- Legacy Cowork IPC carries the run-latched Plan (QA01) --------------

    /// The legacy entry points' shared inner path, as `execute_tool` /
    /// `execute_tool_streaming` build it from their required `plan_mode`
    /// argument. `streaming` supplies an output sink like the streaming command.
    async fn legacy_call(
        data: &Path,
        thread: &str,
        folder: &Path,
        name: &str,
        args: serde_json::Value,
        plan_mode: bool,
        streaming: bool,
    ) -> Result<ToolResult, AgentToolsError> {
        let sink = streaming
            .then(|| test_sink(Arc::new(Mutex::new(Vec::new())), Some("call-1".into())));
        execute_tool_inner(
            None,
            data.to_string_lossy().into_owned(),
            thread.into(),
            Some(folder.to_string_lossy().into_owned()),
            name.into(),
            args,
            None,
            None,
            Some(folder.to_string_lossy().into_owned()),
            Some(true),
            None,
            Some("call-1".into()),
            sink,
            ToolRun {
                plan_mode,
                folder_skills: false,
            },
        )
        .await
    }

    #[tokio::test]
    async fn legacy_plan_read_keeps_tool_hooks_inert_streaming_or_not() {
        if !jail::backend().enforces() {
            eprintln!("skipping: no enforcing OS sandbox, so hooks cannot start here");
            return;
        }
        for streaming in [false, true] {
            for event in ["PreToolUse", "PostToolUse"] {
                for plan_mode in [false, true] {
                    let data = unique_data_folder();
                    let folder = repo_outside_tmp("legacy-plan-hook");
                    std::fs::write(folder.join("known.txt"), "known content").unwrap();
                    let thread = format!("legacy-plan-{}", data.file_name().unwrap().to_string_lossy());
                    hook_map().lock().unwrap().insert(
                        thread.clone(),
                        hook_for(event, "read", "printf ran > plan-hook-marker.txt"),
                    );
                    let out = legacy_call(
                        &data, &thread, &folder, "read", json!({"path": "known.txt"}), plan_mode, streaming,
                    )
                    .await
                    .expect("read is Plan-allowed");
                    assert!(!out.is_error, "{}", out.content);
                    let marker = folder.join("plan-hook-marker.txt").exists();
                    // Control (plan off) proves the hook really runs here; Plan must not.
                    assert_eq!(
                        marker, !plan_mode,
                        "streaming={streaming} {event} plan={plan_mode}: hook marker"
                    );
                    hook_map().lock().unwrap().remove(&thread);
                    let _ = std::fs::remove_dir_all(folder);
                    let _ = std::fs::remove_dir_all(data);
                }
            }
        }
    }

    #[tokio::test]
    async fn legacy_plan_refuses_mutating_tools_but_unplanned_runs_them() {
        for streaming in [false, true] {
            let data = unique_data_folder();
            let folder = repo_outside_tmp("legacy-plan-refuse");
            let thread = format!("legacy-refuse-{}", data.file_name().unwrap().to_string_lossy());
            for (name, args) in [
                ("write", json!({"path": "x.txt", "content": "no"})),
                ("edit", json!({"path": "x.txt", "old_string": "a", "new_string": "b"})),
                ("shell", json!({"command": "touch shell-ran.txt"})),
                ("skill_write", json!({"name": "planned", "content": "no"})),
            ] {
                let err = legacy_call(&data, &thread, &folder, name, args, true, streaming)
                    .await
                    .unwrap_err();
                assert!(err.message.contains("Plan mode"), "{name}: {}", err.message);
            }
            assert!(!folder.join("x.txt").exists() && !folder.join("shell-ran.txt").exists());
            // Control: the same write is allowed once Plan is off.
            let ok = legacy_call(
                &data, &thread, &folder, "write", json!({"path": "x.txt", "content": "yes"}), false, streaming,
            )
            .await
            .unwrap();
            assert!(!ok.is_error, "{}", ok.content);
            assert!(folder.join("x.txt").exists());
            let _ = std::fs::remove_dir_all(folder);
            let _ = std::fs::remove_dir_all(data);
        }
    }

    // ---- Folder skills (QA05) -----------------------------------------------

    /// Distinct bodies so a result proves which layer answered.
    fn seed_skill(root: &Path, name: &str, body: &str) {
        skills::write(root, name, &format!("---\nname: {name}\ndescription: {body} skill\n---\n{body}"))
            .unwrap();
    }

    async fn skill_call(
        data: &Path,
        name: &str,
        args: serde_json::Value,
        folder: Option<&Path>,
    ) -> ToolResult {
        let grant = consent(folder, false, false, false);
        chat_call(data, name, args, grant.clone(), grant).await.unwrap()
    }

    #[tokio::test]
    async fn chat_skill_tools_follow_the_authorized_folder() {
        let data = unique_data_folder();
        let folder = repo_outside_tmp("skills-folder");
        let global = workspace::permanent_store(&data);
        let project = workspace::project_store(&folder.canonicalize().unwrap());
        seed_skill(&global, "audit-demo", "GLOBAL");
        seed_skill(&project, "audit-demo", "PROJECT");
        seed_skill(&project, "folder-only", "FOLDERONLY");
        seed_skill(&global, "global-only", "GLOBALONLY");
        skills::test_support::set_enabled(&folder, &[]);

        // Folder skill overrides the same-named global one, like slash expansion.
        let read = skill_call(&data, "skill_read", json!({"name": "audit-demo"}), Some(&folder)).await;
        assert!(read.content.contains("PROJECT") && !read.content.contains("GLOBAL"), "{}", read.content);
        // A folder-only skill is discoverable and readable.
        let list = skill_call(&data, "skill_list", json!({}), Some(&folder)).await;
        assert!(list.content.contains("folder-only") && list.content.contains("global-only"), "{}", list.content);
        let only = skill_call(&data, "skill_read", json!({"name": "folder-only"}), Some(&folder)).await;
        assert!(only.content.contains("FOLDERONLY"), "{}", only.content);

        // No folder: skill-only/override layers are absent, global answers.
        let list = skill_call(&data, "skill_list", json!({}), None).await;
        assert!(!list.content.contains("folder-only"), "{}", list.content);
        let read = skill_call(&data, "skill_read", json!({"name": "audit-demo"}), None).await;
        assert!(read.content.contains("GLOBAL") && !read.content.contains("PROJECT"), "{}", read.content);
        let _ = std::fs::remove_dir_all(project);
        let _ = std::fs::remove_dir_all(folder);
        let _ = std::fs::remove_dir_all(data);
    }

    #[tokio::test]
    async fn chat_skill_whitelist_comes_from_the_folder_not_the_caller() {
        let data = unique_data_folder();
        let folder = repo_outside_tmp("skills-whitelist");
        let global = workspace::permanent_store(&data);
        let project = workspace::project_store(&folder.canonicalize().unwrap());
        seed_skill(&global, "blocked-global", "BLOCKED");
        seed_skill(&global, "allowed-global", "ALLOWED");
        seed_skill(&project, "allowed-folder", "FOLDERALLOWED");
        skills::test_support::set_enabled(&folder, &["allowed-global", "allowed-folder"]);

        let list = skill_call(&data, "skill_list", json!({}), Some(&folder)).await;
        assert!(!list.content.contains("blocked-global"), "{}", list.content);
        assert!(list.content.contains("allowed-global") && list.content.contains("allowed-folder"), "{}", list.content);
        let blocked = skill_call(&data, "skill_read", json!({"name": "blocked-global"}), Some(&folder)).await;
        assert!(blocked.is_error || blocked.content.contains("disabled") || blocked.content.contains("not found"), "{}", blocked.content);
        assert!(!blocked.content.contains("BLOCKED"), "{}", blocked.content);
        // Without the folder grant the folder's whitelist and overlay do not apply.
        let list = skill_call(&data, "skill_list", json!({}), None).await;
        assert!(list.content.contains("blocked-global") && !list.content.contains("allowed-folder"), "{}", list.content);
        let _ = std::fs::remove_dir_all(project);
        let _ = std::fs::remove_dir_all(folder);
        let _ = std::fs::remove_dir_all(data);
    }

    /// The forged caller overlay is not an authority: an effective grant naming
    /// a different folder than the stored consent cannot select its skills.
    #[tokio::test]
    async fn chat_skill_overlay_cannot_be_selected_by_an_unconsented_folder() {
        let data = unique_data_folder();
        let granted = repo_outside_tmp("skills-granted");
        let forged = repo_outside_tmp("skills-forged");
        seed_skill(&workspace::project_store(&forged.canonicalize().unwrap()), "forged-only", "FORGED");
        skills::test_support::set_enabled(&granted, &[]);
        skills::test_support::set_enabled(&forged, &[]);
        let stored = consent(Some(&granted), false, false, false);
        let overlay = consent(Some(&forged), false, false, false);
        let list = chat_call(&data, "skill_list", json!({}), stored, overlay).await.unwrap();
        assert!(!list.content.contains("forged-only"), "{}", list.content);
        let _ = std::fs::remove_dir_all(workspace::project_store(&forged.canonicalize().unwrap()));
        let _ = std::fs::remove_dir_all(granted);
        let _ = std::fs::remove_dir_all(forged);
        let _ = std::fs::remove_dir_all(data);
    }

    #[test]
    fn unresolved_folder_whitelist_fails_closed() {
        // No resolver override for this path and none installed in unit tests.
        let missing = std::env::temp_dir().join("jan-no-whitelist-resolver");
        assert_eq!(skills::enabled_for_project(&missing), vec![String::new()]);
    }

    #[tokio::test]
    async fn postfix_verifier_chat_rejects_outbound_aliases_before_setup() {
        let data = unique_data_folder();
        let on = consent(None, false, true, true);
        for name in [
            "web_search", "web_fetch", "screenshot", "Screenshot", "screenshotx",
            "WEB_FETCH", "WEB_SEARCH", "webfetch", "websearch", "bash", "memory_write",
            "not_a_tool",
        ] {
            let err = chat_call(&data, name, json!({}), on.clone(), on.clone())
                .await
                .unwrap_err();
            assert_eq!(err.message, format!("unknown Chat tool '{name}'"));
            assert!(!data.exists(), "{name} must fail before workspace setup");
        }
    }

    #[tokio::test]
    async fn postfix_verifier_legacy_unknown_aliases_cannot_dispatch() {
        let data = unique_data_folder();
        let id = format!("postfix-alias-{}", data.file_name().unwrap().to_string_lossy());
        for scope in [None, Some(WorkspaceScope::Thread)] {
            for name in ["Screenshot", "screenshotx", "WEB_FETCH", "WEB_SEARCH", "webfetch", "websearch"] {
                assert!(lookup(name).is_none(), "{name} must not resolve as an alias");
                // Unknown names need not trip the elevation guard: the exact
                // lookup in the executor must still prevent dispatch.
                reject_legacy_thread_elevation(scope, name, &json!({}), None, None, None)
                    .unwrap();
                let err = execute_tool_inner(
                    None, data.to_string_lossy().into_owned(), id.clone(), None,
                    name.into(), json!({}), None, None, None, None, scope, None, None,
                    ToolRun::default(),
                )
                .await
                .unwrap_err();
                assert_eq!(err.message, format!("unknown built-in tool '{name}'"));
            }
        }
        let _ = std::fs::remove_dir_all(workspace::scratch_dir_in(&workspace::project_cache_dir(None), &id));
        let _ = std::fs::remove_dir_all(data);
    }

    #[tokio::test]
    async fn postfix_verifier_overlay_parent_root_cannot_widen_attachment() {
        let data = unique_data_folder();
        let parent = repo_outside_tmp("postfix-overlay-parent");
        let selected = parent.join("selected");
        std::fs::create_dir_all(&selected).unwrap();
        let outside = parent.join("outside.txt");
        std::fs::write(&outside, "unchanged").unwrap();
        let stored = consent(Some(&selected), true, true, true);
        let overlay = consent(Some(&parent), true, true, true);
        let err = chat_call(
            &data, "read", json!({"path": outside}), stored, overlay,
        )
        .await
        .unwrap_err();
        assert!(err.message.contains("ReadEscape"), "{}", err.message);
        assert_eq!(std::fs::read_to_string(outside).unwrap(), "unchanged");
        let _ = std::fs::remove_dir_all(parent);
        let _ = std::fs::remove_dir_all(data);
    }

    /// Folder access needs host confirmation; app-wide memory authority does
    /// not. An ordinary unconfirmed Chat with effective true remains usable.
    #[tokio::test]
    async fn one_shot_chat_folder_requires_confirmation_but_app_grants_do_not() {
        let data = unique_data_folder();
        let id = "one-shot-mirror";
        let folder = repo_outside_tmp("one-shot-mirror-folder");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("input.txt"), "original").unwrap();
        let write = consent(Some(&folder), true, true, true);
        let call = |name: &str, args: serde_json::Value| {
            let (data, name, write) = (data.clone(), name.to_string(), write.clone());
            async move {
                execute_thread_tool_inner(
                    None,
                    data,
                    id.into(),
                    name,
                    args,
                    write.clone(),
                    serde_json::from_value(write).unwrap(),
                    false,
                )
                .await
            }
        };
        // Unconfirmed: both disk and the caller say yes, the host does not.
        assert!(
            call("read", json!({"path": folder.join("input.txt")}))
                .await
                .is_err(),
            "an unconfirmed grant must not reach an attached folder"
        );
        let memory = call("memory", json!({"op":"write","name":"m","content":"x"}))
            .await
            .unwrap();
        assert!(!memory.is_error, "{}", memory.content);
        // The scratch baseline needs no confirmation (temporary chat).
        let baseline = call("write", json!({"path":"note.txt","content":"scratch"}))
            .await
            .unwrap();
        assert!(!baseline.is_error, "{}", baseline.content);
        // Confirmed by the strict setter: the same call now elevates.
        let token = crate::thread_capabilities::narrow(id);
        assert!(crate::thread_capabilities::confirm_if_current(
            id,
            serde_json::from_value(write.clone()).unwrap(),
            token
        ));
        let out = call("read", json!({"path": folder.join("input.txt")}))
            .await
            .unwrap();
        assert!(out.content.contains("original"), "{}", out.content);
        crate::thread_capabilities::clear(id);
        let _ = std::fs::remove_dir_all(folder);
        let _ = std::fs::remove_dir_all(data);
    }

    #[tokio::test]
    async fn persistent_chat_global_on_allows_memory_with_stored_flags_off() {
        let data = unique_data_folder();
        let off = consent(None, false, false, false);
        let on = consent(None, false, true, true);
        let ordinary = chat_call(
            &data,
            "memory",
            serde_json::json!({"op":"write","name":"global-on","content":"yes"}),
            off.clone(),
            on.clone(),
        )
        .await
        .unwrap();
        assert!(!ordinary.is_error, "{}", ordinary.content);
        let _ = std::fs::remove_dir_all(data);
    }

    #[tokio::test]
    async fn chat_consent_intersection_blocks_forged_and_locally_revoked_memory() {
        let data = unique_data_folder();
        let off = consent(None, false, false, false);
        let on = consent(None, false, true, true);
        assert!(chat_call(
            &data,
            "memory",
            serde_json::json!({"op":"write","name":"forged","content":"no"}),
            serde_json::Value::Null,
            on.clone()
        )
        .await
        .is_err());
        for (stored, effective) in [(off.clone(), off.clone()), (on.clone(), off.clone())] {
            let err = chat_call(
                &data,
                "memory",
                serde_json::json!({"op":"write","name":"no","content":"no"}),
                stored,
                effective,
            )
            .await
            .unwrap_err();
            assert!(err.message.contains("not authorized"));
        }
        for name in [
            "monitor",
            "dispatch_subagent",
            "task",
            "bash",
            "memory_write",
            "web_fetch",
            "screenshot",
        ] {
            assert!(
                chat_call(&data, name, serde_json::json!({}), on.clone(), on.clone())
                    .await
                    .is_err(),
                "{name}"
            );
        }
        assert!(chat_call(
            &data,
            "skill_write",
            serde_json::json!({}),
            on.clone(),
            off.clone()
        )
        .await
        .is_err());
        assert!(!workspace::permanent_store(&data).exists());
    }

    #[tokio::test]
    async fn chat_folder_authority_is_intersected_and_canonicalized() {
        let data = unique_data_folder();
        let folder = repo_outside_tmp("chat-consent-folder");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("input.txt"), "original").unwrap();
        let read = consent(Some(&folder), false, false, false);
        let write = consent(Some(&folder), true, true, true);
        let args = serde_json::json!({"path":folder.join("input.txt"),"content":"changed"});
        for (stored, effective) in [(read.clone(), write.clone()), (write.clone(), read.clone())] {
            assert!(chat_call(&data, "write", args.clone(), stored, effective)
                .await
                .is_err());
        }
        assert_eq!(
            std::fs::read_to_string(folder.join("input.txt")).unwrap(),
            "original"
        );
        let allowed = chat_call(&data, "write", args.clone(), write.clone(), write.clone())
            .await
            .unwrap();
        assert!(!allowed.is_error);
        assert_eq!(
            std::fs::read_to_string(folder.join("input.txt")).unwrap(),
            "changed"
        );
        std::fs::write(folder.join("input.txt"), "original").unwrap();
        let memory = chat_call(
            &data,
            "memory",
            serde_json::json!({"op":"write","name":"allowed","content":"remember"}),
            write.clone(),
            write.clone(),
        )
        .await
        .unwrap();
        assert!(!memory.is_error, "{}", memory.content);
        assert!(workspace::permanent_store(&data)
            .join("memory/allowed.md")
            .exists());
        assert!(!folder.join("memory/allowed.md").exists());

        let out = chat_call(
            &data,
            "read",
            serde_json::json!({"path":folder.join("input.txt")}),
            read.clone(),
            read.clone(),
        )
        .await
        .unwrap();
        assert!(out.content.contains("original"));
        let off = consent(None, false, false, false);
        assert!(chat_call(
            &data,
            "read",
            serde_json::json!({"path":folder.join("input.txt")}),
            off,
            write.clone()
        )
        .await
        .is_err());
        #[cfg(unix)]
        {
            let outside = repo_outside_tmp("chat-outside");
            std::fs::create_dir_all(&outside).unwrap();
            std::os::unix::fs::symlink(&outside, folder.join("escape")).unwrap();
            let escaped = chat_call(
                &data,
                "write",
                serde_json::json!({"path":folder.join("escape/pwn.txt"),"content":"no"}),
                write.clone(),
                write.clone(),
            )
            .await;
            assert!(escaped.is_err() || escaped.unwrap().is_error);
            assert!(!outside.join("pwn.txt").exists());
            let _ = std::fs::remove_dir_all(outside);
            let link = folder.join("forbidden-link");
            std::os::unix::fs::symlink(&data, &link).unwrap();
            let grant = consent(Some(&link), true, false, false);
            assert!(chat_call(
                &data,
                "read",
                serde_json::json!({"path":"."}),
                grant.clone(),
                grant
            )
            .await
            .is_err());
        }
        let _ = std::fs::remove_dir_all(folder);
        let _ = std::fs::remove_dir_all(data);
    }

    fn unique_data_folder() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!("jan_cmd_test_{}_{}", std::process::id(), n))
    }

    /// A folder that is *not* under the host temp dir, where these tests'
    /// data folders (and so their thread sandboxes) and scratch live, so an
    /// attached folder is never mistaken for either.
    fn repo_outside_tmp(tag: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("attach-tests")
            .join(format!("{tag}_{}_{}", std::process::id(), n));
        std::fs::create_dir_all(&dir).expect("create test repo");
        dir
    }

    /// Test shim: `execute_tool` is now a generic Tauri command taking an
    /// `AppHandle`, which the tests have no runtime to build. This drives the
    /// same path with no webview backend (Chrome only) and no output sink.
    #[allow(clippy::too_many_arguments)]
    async fn execute_tool(
        data_folder: String,
        thread_id: String,
        project: Option<String>,
        name: String,
        args: serde_json::Value,
        enabled_skills: Option<Vec<String>>,
        allow_network: Option<bool>,
        read_only_project: Option<String>,
        project_writable: Option<bool>,
        scope: Option<WorkspaceScope>,
        call_id: Option<String>,
    ) -> Result<ToolResult, AgentToolsError> {
        execute_tool_inner(
            None,
            data_folder,
            thread_id,
            project,
            name,
            args,
            enabled_skills,
            allow_network,
            read_only_project,
            project_writable,
            scope,
            call_id,
            None,
            ToolRun::default(),
        )
        .await
    }

    const T1: &str = "thread-one";
    /// Own thread ids: the session scratch is keyed by thread id and lives in
    /// the shared host temp dir, so reusing one couples these tests to every
    /// other test that uses it.
    /// Its own id: this test depends on its scratch staying alive, and any
    /// test that deletes a thread workspace also deletes that thread's scratch.
    const T_SCRATCH: &str = "thread-scratch";
    const T_ATTACH_RW: &str = "thread-attach-rw";
    const T_ATTACH_NONE: &str = "thread-attach-none";
    const T_ATTACH_OVERLAP: &str = "thread-attach-overlap";
    const T_ATTACH_WRITABLE: &str = "thread-attach-writable";
    const T2: &str = "thread-two";

    #[test]
    fn default_store_is_permanent_and_outside_any_sandbox() {
        let store = resolve_store(Path::new("/data"), None);
        assert_eq!(store, Path::new("/data/agent-workspace"));
        // The sandbox lives under threads/, so no relative path from inside one
        // reaches the store without escaping it.
        let sandbox = workspace::thread_workspace(Path::new("/data"), T1).unwrap();
        assert!(!workspace::store_dir(&store, "memory").starts_with(&sandbox));
    }

    #[test]
    fn explicit_project_uses_its_project_store() {
        assert_eq!(
            resolve_store(Path::new("/data"), Some("/repo")),
            workspace::project_store(Path::new("/repo"))
        );
        // Blank is treated as absent, not as the filesystem root.
        assert_eq!(
            resolve_store(Path::new("/data"), Some("   ")),
            Path::new("/data/agent-workspace")
        );
    }

    #[test]
    fn error_strips_the_tool_protocol_prefix() {
        let e = AgentToolsError::from("ERROR: invalid name '..'".to_string());
        assert_eq!(e.message, "invalid name '..'");
        let e = AgentToolsError::from("plain message".to_string());
        assert_eq!(e.message, "plain message");
    }

    /// Writes land in the thread's ephemeral sandbox and are allowed there. This
    /// pins the containment that makes that safe: the file appears where it was
    /// asked for, and nowhere else.
    #[tokio::test]
    async fn writes_are_allowed_inside_the_ephemeral_sandbox() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();

        let out = execute_tool(
            df.clone(),
            T1.into(),
            None,
            "write".into(),
            json!({"path": "a.txt", "content": "hello"}),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .expect("a write inside the sandbox is allowed");
        assert!(!out.is_error, "got: {}", out.content);

        let sandbox = workspace::thread_workspace(&data, T1).unwrap();
        assert_eq!(
            std::fs::read_to_string(sandbox.join("a.txt")).ok(),
            Some("hello".to_string())
        );
        let _ = std::fs::remove_dir_all(&data);
    }

    /// `edit` returns a display-only diff. It must reach the caller (the UI needs
    /// it) while staying out of `content`, which is what the model sees.
    #[tokio::test]
    async fn edit_returns_a_diff_for_display_only() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();
        let sandbox = workspace::ensure_thread_workspace(&data, T1).await.unwrap();
        std::fs::write(sandbox.join("a.txt"), b"before").unwrap();

        let out = execute_tool(
            df.clone(),
            T1.into(),
            None,
            "edit".into(),
            json!({"path": "a.txt", "edits": [{"old_string": "before", "new_string": "after"}]}),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();

        assert!(!out.is_error, "got: {}", out.content);
        let diff = out.diff.expect("edit must report a diff");
        assert!(
            diff.contains("after"),
            "diff should show the change: {diff}"
        );
        assert!(
            !out.content.contains(&diff),
            "the diff must not be duplicated into model-facing content"
        );
        let _ = std::fs::remove_dir_all(&data);
    }

    /// The gate still decides: a read that escapes the sandbox is a `Prompt` and
    /// stays refused, so allowing writes did not open the door generally.
    #[tokio::test]
    async fn escaping_reads_are_still_refused() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();

        let err = execute_tool(
            df.clone(),
            T1.into(),
            None,
            "read".into(),
            json!({"path": "../../../etc/hostname"}),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .expect_err("an escaping read must be refused");
        assert!(
            err.message.contains("needs user approval"),
            "unexpected error {}",
            err.message
        );
        let _ = std::fs::remove_dir_all(&data);
    }

    /// A write that escapes the sandbox (absolute or `..`) must be refused on
    /// the desktop surface, just like an escaping read -- it could reach host
    /// files. The session scratch is the exception: it is the agent's own area,
    /// reached by its real path on every platform.
    #[tokio::test]
    async fn escaping_writes_are_refused() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();

        for path in ["../escape.txt", "/etc/hosts", "/home/akarshan/.bashrc"] {
            let err = execute_tool(
                df.clone(),
                T_SCRATCH.into(),
                None,
                "write".into(),
                json!({"path": path, "content": "x"}),
                None,
                None,
                None,
                None,
                None,
                None,
            )
            .await
            .expect_err("an escaping write must be refused");
            assert!(
                err.message.contains("outside the agent workspace"),
                "unexpected error {}",
                err.message
            );
        }

        // A scratch write is not a host escape and succeeds, at the scratch's
        // real path. The scratch outlives the test process, so the name is
        // per-run: a leftover file would answer "No change" instead of
        // "Created".
        let scratch = crate::workspace::ensure_scratch_dir(T_SCRATCH)
            .await
            .unwrap();
        let name = format!("jan_cmd_scratch_{}.txt", std::process::id());
        let requested = scratch.join(&name).to_string_lossy().into_owned();
        let expected = requested.clone();
        let res = execute_tool(
            df.clone(),
            T_SCRATCH.into(),
            None,
            "write".into(),
            json!({"path": requested, "content": "x"}),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .expect("a scratch write is the session scratch and must succeed");
        assert!(
            res.content.starts_with(&format!("Created {expected}")),
            "got: {}",
            res.content
        );
        let _ = std::fs::remove_file(scratch.join(&name));

        // An in-sandbox write still succeeds, so we didn't over-tighten.
        let res = execute_tool(
            df.clone(),
            T_SCRATCH.into(),
            None,
            "write".into(),
            json!({"path": "ok.txt", "content": "x"}),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .expect("an in-workspace write must succeed");
        assert_eq!(res.content, "Created ok.txt (1 bytes)");
        let _ = std::fs::remove_dir_all(&data);
    }

    /// The status the frontend gates on must agree with what execution actually
    /// does, or the tool list and the executor disagree about whether bash works.
    #[tokio::test]
    async fn sandbox_status_matches_the_backend_execution_uses() {
        let status = sandbox_status().await.unwrap();
        assert_eq!(status.enforces, jail::backend().enforces());
        assert_eq!(status.backend, jail::backend().as_str());
        assert_ne!(status.backend, "", "a backend always has a name");
        assert_eq!(status.enforces, status.backend != "none");
    }

    /// `bash` availability tracks the sandbox, in both directions: it runs when
    /// the OS can confine it and is refused when it cannot. Asserting both arms
    /// keeps the fallback honest on hosts (and CI images) with no backend.
    #[tokio::test]
    #[cfg_attr(
        windows,
        ignore = "re-execs the test binary as the AppContainer helper; covered by tests/sandbox_spawn.rs"
    )]
    async fn bash_runs_only_when_the_sandbox_can_enforce() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();

        let result = execute_tool(
            df.clone(),
            T1.into(),
            None,
            "shell".into(),
            json!({"command": "echo hi"}),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await;

        if jail::backend().enforces() {
            let out = result.expect("sandboxed bash should run");
            assert!(!out.is_error, "got: {}", out.content);
            assert!(out.content.contains("hi"), "got: {}", out.content);
        } else {
            let out = result.expect("the refusal is a tool result, not an IPC error");
            assert!(out.is_error);
            assert!(
                out.content.contains("no OS sandbox"),
                "the model must be told why, got: {}",
                out.content
            );
        }
        let _ = std::fs::remove_dir_all(&data);
    }

    /// A hook matcher on `bash` is reported under each shell call, and only
    /// there: the desktop has no run start to report it at.
    #[test]
    fn a_bash_hook_matcher_is_reported_under_shell_calls() {
        let mut hooks = crate::tools::hooks::HookSet::new();
        hooks.extend_from(
            vec![crate::tools::hooks::HookEntry {
                event: "PreToolUse".into(),
                matcher: Some("bash".into()),
                command: "guard".into(),
                timeout_secs: None,
            }],
            Path::new("config.toml"),
        );
        let out = with_renamed_tool_notices("shell", "ok\n[exit 0]".into(), &hooks);
        // Above the exit marker, which stays the final line.
        assert!(out.starts_with("ok\n[hook config: "), "{out}");
        assert!(out.ends_with("\n[exit 0]"), "{out}");
        assert!(out.contains("now `shell`"), "{out}");
        assert_eq!(with_renamed_tool_notices("read", "x".into(), &hooks), "x");
        assert_eq!(with_renamed_tool_notices("memory", "x".into(), &hooks), "x");
        let none = crate::tools::hooks::HookSet::new();
        assert_eq!(with_renamed_tool_notices("shell", "x".into(), &none), "x");
    }

    /// The same for a matcher on an old memory tool name, under memory calls.
    #[test]
    fn an_old_memory_hook_matcher_is_reported_under_memory_calls() {
        let mut hooks = crate::tools::hooks::HookSet::new();
        hooks.extend_from(
            vec![crate::tools::hooks::HookEntry {
                event: "PreToolUse".into(),
                matcher: Some("memory_read".into()),
                command: "guard".into(),
                timeout_secs: None,
            }],
            Path::new("config.toml"),
        );
        let out = with_renamed_tool_notices("memory", "Drift".into(), &hooks);
        assert!(out.starts_with("Drift\n[hook config: "), "{out}");
        assert!(out.contains("`memory_read`"), "{out}");
        assert_eq!(with_renamed_tool_notices("shell", "x".into(), &hooks), "x");
    }

    /// The network flag has to survive the whole IPC -> ToolContext -> jail path.
    /// Only the closed direction is asserted: opening it would make the test
    /// depend on the host actually having connectivity.
    #[tokio::test]
    async fn bash_has_no_network_unless_the_caller_asks() {
        if !jail::backend().enforces() {
            eprintln!("skipping: no sandbox backend on this host");
            return;
        }
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();

        let out = execute_tool(
            df.clone(),
            T1.into(),
            None,
            "shell".into(),
            json!({"command": "exec 3<>/dev/tcp/1.1.1.1/53 && echo connected"}),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();

        assert!(!out.content.contains("connected"), "got: {}", out.content);
        assert!(
            out.content.contains("Network access is disabled"),
            "a network refusal must explain itself, got: {}",
            out.content
        );
        let _ = std::fs::remove_dir_all(&data);
    }

    /// The sandbox is created by `execute_tool` itself. Without that, the very
    /// first tool call of a thread would be refused: `escapes_project`
    /// canonicalizes the root and a missing root reads as an escape.
    #[tokio::test]
    async fn first_tool_call_creates_the_sandbox() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();

        let out = execute_tool(
            df.clone(),
            T1.into(),
            None,
            "ls".into(),
            json!({}),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert!(!out.is_error, "got: {}", out.content);
        assert!(workspace::thread_workspace(&data, T1).unwrap().is_dir());
        let _ = std::fs::remove_dir_all(&data);
    }

    #[tokio::test]
    async fn allowed_read_runs_in_the_thread_sandbox() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();
        let sandbox = PathBuf::from(thread_workspace_path(df.clone(), T1.into()).await.unwrap());
        std::fs::write(sandbox.join("a.txt"), b"hello").unwrap();

        let out = execute_tool(
            df.clone(),
            T1.into(),
            None,
            "read".to_string(),
            json!({"path": "a.txt"}),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert!(out.content.contains("hello"), "got: {}", out.content);
        assert!(!out.is_error);
        let _ = std::fs::remove_dir_all(&data);
    }

    /// Thread isolation: a relative climb-out cannot reach another thread's
    /// workspace, and each thread sees only its own scratch files.
    #[tokio::test]
    async fn one_thread_cannot_read_another_threads_files() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();
        // Thread ids unique to this test rather than the ids shared across the
        // module: a scratch is keyed on the session id alone and lives in the
        // host temp dir, so it is global state even though each test gets its
        // own data folder, and any test deleting that thread's workspace also
        // removes its scratch (see `remove_thread_workspace`).
        let (t1, t2) = ("isolation-thread-one", "isolation-thread-two");
        let one = PathBuf::from(thread_workspace_path(df.clone(), t1.into()).await.unwrap());
        thread_workspace_path(df.clone(), t2.into()).await.unwrap();
        std::fs::write(one.join("secret.txt"), b"classified").unwrap();

        // A relative climb-out reaches the sibling thread's workspace and is an
        // escape, so it must prompt (and is refused on this surface).
        let err = execute_tool(
            df.clone(),
            t2.into(),
            None,
            "read".into(),
            json!({"path": "../isolation-thread-one/secret.txt"}),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .expect_err("a relative climb-out to a sibling thread must be refused");
        assert!(
            err.message.contains("needs user approval"),
            "unexpected: {}",
            err.message
        );

        // Each thread's scratch is its own directory: t2 naming the file at
        // its own scratch finds nothing of t1's.
        let one_scratch = crate::workspace::ensure_scratch_dir(t1).await.unwrap();
        std::fs::write(one_scratch.join("secret.txt"), b"classified").unwrap();
        let two_scratch = crate::workspace::ensure_scratch_dir(t2).await.unwrap();
        let requested = two_scratch.join("secret.txt").to_string_lossy().into_owned();
        let out = execute_tool(
            df.clone(),
            t2.into(),
            None,
            "read".into(),
            json!({"path": requested}),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert!(
            out.is_error,
            "t2 sees an empty scratch, got: {}",
            out.content
        );
        let _ = std::fs::remove_dir_all(&data);
        let _ = crate::workspace::remove_scratch_dir(t1).await;
        let _ = crate::workspace::remove_scratch_dir(t2).await;
    }

    /// Memory is permanent: wiping a thread's sandbox leaves it untouched, and a
    /// note written under one thread is readable from the next.
    #[tokio::test]
    async fn memory_outlives_the_thread_that_wrote_it() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();

        let out = execute_tool(
            df.clone(),
            T1.into(),
            None,
            "memory".into(),
            json!({"op": "write", "name": "prefs", "content": "user likes tabs"}),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert!(!out.is_error, "got: {}", out.content);

        thread_workspace_delete(df.clone(), T1.into())
            .await
            .unwrap();
        assert!(!workspace::thread_workspace(&data, T1).unwrap().exists());

        let out = execute_tool(
            df.clone(),
            T2.into(),
            None,
            "memory".into(),
            json!({"op": "view", "name": "prefs"}),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(out.content, "user likes tabs");
        let _ = std::fs::remove_dir_all(&data);
    }

    /// Memory lives outside the sandbox, so the general filesystem tools cannot
    /// reach it even by climbing out -- no extra rule, just `escapes_project`.
    #[tokio::test]
    async fn filesystem_tools_cannot_reach_memory() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();
        memory_write(df.clone(), None, "prefs".into(), "secret".into())
            .await
            .unwrap();
        thread_workspace_path(df.clone(), T1.into()).await.unwrap();

        // A relative climb out of the thread sandbox toward the store is an
        // escape and must be refused.
        let err = execute_tool(
            df.clone(),
            T1.into(),
            None,
            "read".into(),
            json!({"path": "../../memory/prefs.md"}),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .expect_err("memory must be unreachable from the sandbox");
        assert!(
            err.message.contains("needs user approval"),
            "unexpected: {}",
            err.message
        );
        let _ = std::fs::remove_dir_all(&data);
    }

    /// A sweep clears leftover sandboxes without touching the store.
    #[tokio::test]
    async fn sweep_keeps_live_threads_and_the_store() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();
        memory_write(df.clone(), None, "prefs".into(), "keep me".into())
            .await
            .unwrap();
        thread_workspace_path(df.clone(), T1.into()).await.unwrap();
        thread_workspace_path(df.clone(), T2.into()).await.unwrap();

        let removed = thread_workspace_sweep(df.clone(), vec![T1.to_string()])
            .await
            .unwrap();
        assert_eq!(removed, 1);
        assert!(workspace::thread_workspace(&data, T1).unwrap().is_dir());
        assert!(!workspace::thread_workspace(&data, T2).unwrap().exists());
        assert_eq!(
            memory_read(df.clone(), None, "prefs".into()).await.unwrap(),
            "keep me"
        );
        let _ = std::fs::remove_dir_all(&data);
    }

    #[tokio::test]
    async fn a_traversing_thread_id_is_rejected() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();
        for bad in ["../../..", "a/b", ""] {
            assert!(
                thread_workspace_path(df.clone(), bad.into()).await.is_err(),
                "expected {bad:?} to be rejected"
            );
            assert!(
                execute_tool(
                    df.clone(),
                    bad.into(),
                    None,
                    "ls".into(),
                    json!({}),
                    None,
                    None,
                    None,
                    None,
                    None,
                    None
                )
                .await
                .is_err(),
                "expected {bad:?} to be rejected by execute_tool"
            );
        }
        let _ = std::fs::remove_dir_all(&data);
    }

    #[tokio::test]
    async fn unknown_tool_is_rejected() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();
        let err = execute_tool(
            df,
            T1.into(),
            None,
            "rm_rf".to_string(),
            json!({}),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .expect_err("unknown tool");
        assert!(err.message.contains("unknown built-in tool"));
        let _ = std::fs::remove_dir_all(&data);
    }

    #[tokio::test]
    async fn memory_crud_roundtrip_in_the_permanent_store() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();
        workspace_path(df.clone()).await.unwrap();

        assert!(memory_list(df.clone(), None).await.unwrap().is_empty());
        memory_write(df.clone(), None, "prefs".into(), "body".into())
            .await
            .unwrap();
        assert_eq!(memory_list(df.clone(), None).await.unwrap(), vec!["prefs"]);
        assert_eq!(
            memory_read(df.clone(), None, "prefs".into()).await.unwrap(),
            "body"
        );
        let entries = memory_catalog(df.clone(), None).await.unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "prefs");
        assert_eq!(entries[0].summary, "body");
        assert!(entries[0].mtime_ms > 0);
        memory_delete(df.clone(), None, "prefs".into())
            .await
            .unwrap();
        assert!(memory_list(df.clone(), None).await.unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&data);
    }

    #[tokio::test]
    async fn skill_crud_roundtrip_in_the_permanent_store() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();
        workspace_path(df.clone()).await.unwrap();

        skill_write(
            df.clone(),
            None,
            "deploy".into(),
            "---\ndescription: d\n---\nbody".into(),
        )
        .await
        .unwrap();
        let listed = skill_list(df.clone(), None).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "deploy");
        assert_eq!(listed[0].description, "d");
        assert!(skill_read(df.clone(), None, "deploy".into())
            .await
            .unwrap()
            .contains("body"));
        skill_delete(df.clone(), None, "deploy".into())
            .await
            .unwrap();
        assert!(skill_list(df.clone(), None).await.unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&data);
    }

    /// A skill written by the model under one thread is loadable from the next,
    /// same as memory.
    #[tokio::test]
    async fn skills_written_by_a_tool_outlive_the_thread() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();

        execute_tool(
            df.clone(),
            T1.into(),
            None,
            "skill_write".into(),
            json!({"name": "deploy", "content": "---\ndescription: d\n---\nrun it"}),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
        thread_workspace_delete(df.clone(), T1.into())
            .await
            .unwrap();

        let out = execute_tool(
            df.clone(),
            T2.into(),
            None,
            "skill_read".into(),
            json!({"name": "deploy"}),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(out.content, "run it");
        let _ = std::fs::remove_dir_all(&data);
    }

    /// A folder passed as `project` layers its co-located skills on top of the
    /// permanent store: both reach `skill_list`, `skill_read` loads the folder's
    /// own skill, and memory/skill-writes stay on the permanent store (#8879).
    #[tokio::test]
    async fn an_attached_project_layers_skills_over_the_permanent_store() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();
        let repo = repo_outside_tmp("skilllayer");
        let project = repo.to_string_lossy().to_string();

        skills::write(
            &workspace::permanent_store(&data),
            "global_skill",
            "---\ndescription: from global\n---\nglobal body",
        )
        .unwrap();
        skills::write(
            &workspace::project_store(&repo),
            "folder_skill",
            "---\ndescription: from folder\n---\nfolder body",
        )
        .unwrap();

        let listed = execute_tool(
            df.clone(),
            T1.into(),
            Some(project.clone()),
            "skill_list".into(),
            json!({}),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert!(
            listed.content.contains("global_skill") && listed.content.contains("folder_skill"),
            "both stores must appear, got: {}",
            listed.content
        );

        let body = execute_tool(
            df.clone(),
            T2.into(),
            Some(project.clone()),
            "skill_read".into(),
            json!({"name": "folder_skill"}),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(body.content, "folder body");

        let _ = std::fs::remove_dir_all(&data);
        let _ = std::fs::remove_dir_all(&repo);
    }
    // ---- read-only attached folder, end to end ------------------------------

    /// The contract the workspace UI promises: the agent reads your folder and
    /// writes only into its own sandbox.
    #[tokio::test]
    async fn an_attached_folder_is_readable_and_unwritable() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();
        let repo = repo_outside_tmp("rw");
        std::fs::write(repo.join("main.rs"), b"fn main() {}").unwrap();
        let attached = Some(repo.to_string_lossy().to_string());

        let read = execute_tool(
            df.clone(),
            T_ATTACH_RW.into(),
            None,
            "read".into(),
            json!({"path": repo.join("main.rs").to_string_lossy()}),
            None,
            None,
            attached.clone(),
            None,
            None,
            None,
        )
        .await
        .unwrap();
        assert!(!read.is_error, "{}", read.content);
        assert!(read.content.contains("fn main"), "{}", read.content);

        let write = execute_tool(
            df.clone(),
            T_ATTACH_RW.into(),
            None,
            "write".into(),
            json!({"path": repo.join("evil.txt").to_string_lossy(), "content": "x"}),
            None,
            None,
            attached,
            None,
            None,
            None,
        )
        .await;
        let err = write.expect_err("a write into the attached folder must be refused");
        // The wording matters: told only "refused", a model retries until the
        // step budget runs out.
        let msg = format!("{err:?}");
        assert!(msg.contains("read-only"), "{msg}");
        assert!(msg.contains("copy the file into the workspace"), "{msg}");
        assert!(!repo.join("evil.txt").exists(), "nothing was written");

        let _ = std::fs::remove_dir_all(&data);
        let _ = std::fs::remove_dir_all(&repo);
    }

    /// The Cowork opt-in: with `project_writable` the same attached folder
    /// takes writes and edits in place, and only paths outside both roots stay
    /// refused.
    #[tokio::test]
    async fn a_writable_attachment_takes_writes_in_place() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();
        let repo = repo_outside_tmp("rw_writable");
        std::fs::write(repo.join("main.rs"), b"fn main() {}").unwrap();
        let attached = Some(repo.to_string_lossy().to_string());

        let write = execute_tool(
            df.clone(),
            T_ATTACH_WRITABLE.into(),
            None,
            "write".into(),
            json!({"path": repo.join("notes.md").to_string_lossy(), "content": "hi"}),
            None,
            None,
            attached.clone(),
            Some(true),
            None,
            None,
        )
        .await
        .expect("a write into a writable attachment is allowed");
        assert!(!write.is_error, "{}", write.content);
        assert_eq!(
            std::fs::read_to_string(repo.join("notes.md")).ok(),
            Some("hi".to_string())
        );

        let edit = execute_tool(
            df.clone(),
            T_ATTACH_WRITABLE.into(),
            None,
            "edit".into(),
            json!({
                "path": repo.join("main.rs").to_string_lossy(),
                "edits": [{"old_string": "fn main() {}", "new_string": "fn main() { run() }"}]
            }),
            None,
            None,
            attached.clone(),
            Some(true),
            None,
            None,
        )
        .await
        .expect("an edit inside a writable attachment is allowed");
        assert!(!edit.is_error, "{}", edit.content);

        // Outside the workspace is still refused. The folder is the workspace
        // root now, so the message names it and does not give the read-only
        // copy-it advice that would be wrong for a writable attach.
        let outside = repo_outside_tmp("rw_writable_outside");
        let err = execute_tool(
            df.clone(),
            T_ATTACH_WRITABLE.into(),
            None,
            "write".into(),
            json!({"path": outside.join("evil.txt").to_string_lossy(), "content": "x"}),
            None,
            None,
            attached,
            Some(true),
            None,
            None,
        )
        .await
        .expect_err("a write outside both roots is refused");
        let msg = format!("{err:?}");
        assert!(msg.contains("outside the agent workspace"), "{msg}");
        assert!(!msg.contains("read-only"), "{msg}");
        assert!(!outside.join("evil.txt").exists());

        let _ = std::fs::remove_dir_all(&data);
        let _ = std::fs::remove_dir_all(&repo);
        let _ = std::fs::remove_dir_all(&outside);
    }

    /// #8882: a writable attached folder is the workspace root, so a *relative*
    /// path resolves into the directory the user selected -- not the ephemeral
    /// sandbox under the Jan data folder.
    #[tokio::test]
    async fn a_writable_attachment_is_the_root_for_relative_paths() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();
        let repo = repo_outside_tmp("rw_root_relative");
        let attached = Some(repo.to_string_lossy().to_string());

        let write = execute_tool(
            df.clone(),
            "thread-rw-root-relative".into(),
            None,
            "write".into(),
            json!({"path": "deck.html", "content": "<h1>hi</h1>"}),
            None,
            None,
            attached,
            Some(true),
            Some(WorkspaceScope::Session),
            None,
        )
        .await
        .expect("a relative write with a writable attachment is allowed");
        assert!(!write.is_error, "{}", write.content);
        assert_eq!(
            std::fs::read_to_string(repo.join("deck.html")).ok(),
            Some("<h1>hi</h1>".to_string()),
            "the bare path resolved into the attached folder, not the sandbox"
        );

        let _ = std::fs::remove_dir_all(&data);
        let _ = std::fs::remove_dir_all(&repo);
    }

    /// The promotion does not widen the write surface: a `..` escape out of the
    /// attached-folder root is still refused.
    #[tokio::test]
    async fn a_writable_attachment_root_still_refuses_an_escape() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();
        let repo = repo_outside_tmp("rw_root_escape");
        let attached = Some(repo.to_string_lossy().to_string());

        let err = execute_tool(
            df.clone(),
            "thread-rw-root-escape".into(),
            None,
            "write".into(),
            json!({"path": "../escape.txt", "content": "x"}),
            None,
            None,
            attached,
            Some(true),
            Some(WorkspaceScope::Session),
            None,
        )
        .await
        .expect_err("a write escaping the attached-folder root is refused");
        assert!(!repo.parent().unwrap().join("escape.txt").exists());
        let _ = format!("{err:?}");

        let _ = std::fs::remove_dir_all(&data);
        let _ = std::fs::remove_dir_all(&repo);
    }

    /// Promoting the folder keeps the sandbox reachable by absolute path: the
    /// user attachments Cowork stages into the session workspace
    /// (`attachment_import`) and the agent's own scratch must stay readable and
    /// writable after the folder becomes the root (#8882).
    #[tokio::test]
    async fn a_writable_attachment_keeps_the_sandbox_reachable() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();
        let repo = repo_outside_tmp("rw_root_sandbox");
        let attached = Some(repo.to_string_lossy().to_string());
        let session = "thread-rw-root-sandbox";

        let sandbox = workspace::ensure_session_workspace(&data, session)
            .await
            .unwrap();
        let staged = sandbox.join("attachment.txt").to_string_lossy().into_owned();

        let write = execute_tool(
            df.clone(),
            session.into(),
            None,
            "write".into(),
            json!({"path": staged, "content": "doc"}),
            None,
            None,
            attached.clone(),
            Some(true),
            Some(WorkspaceScope::Session),
            None,
        )
        .await
        .expect("a write into the sandbox is allowed with a folder attached");
        assert!(!write.is_error, "{}", write.content);

        let read = execute_tool(
            df.clone(),
            session.into(),
            None,
            "read".into(),
            json!({"path": staged}),
            None,
            None,
            attached,
            Some(true),
            Some(WorkspaceScope::Session),
            None,
        )
        .await
        .expect("reading the staged attachment back is allowed");
        assert!(!read.is_error, "{}", read.content);
        assert!(read.content.contains("doc"), "{}", read.content);

        let _ = std::fs::remove_dir_all(&data);
        let _ = std::fs::remove_dir_all(&repo);
    }

    /// Without an attached folder nothing outside the sandbox is readable, so
    /// the mount is genuinely opt-in.
    #[tokio::test]
    async fn without_an_attachment_the_same_read_is_refused() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();
        let repo = repo_outside_tmp("noattach");
        std::fs::write(repo.join("main.rs"), b"fn main() {}").unwrap();

        let out = execute_tool(
            df.clone(),
            T_ATTACH_NONE.into(),
            None,
            "read".into(),
            json!({"path": repo.join("main.rs").to_string_lossy()}),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await;
        assert!(out.is_err() || out.unwrap().is_error);

        let _ = std::fs::remove_dir_all(&data);
        let _ = std::fs::remove_dir_all(&repo);
    }

    /// An unusable attachment is an error, never a silent drop: otherwise the
    /// agent works against a folder it believes is attached and is not.
    #[tokio::test]
    async fn an_overlapping_attachment_is_rejected_not_ignored() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();
        let inside = workspace::ensure_thread_workspace(&data, T_ATTACH_OVERLAP)
            .await
            .unwrap()
            .join("nested");
        std::fs::create_dir_all(&inside).unwrap();

        let out = execute_tool(
            df.clone(),
            T_ATTACH_OVERLAP.into(),
            None,
            "ls".into(),
            json!({}),
            None,
            None,
            Some(inside.to_string_lossy().to_string()),
            None,
            None,
            None,
        )
        .await;
        let err = out.expect_err("a root inside the workspace must be refused");
        assert!(format!("{err:?}").contains("overlaps"), "{err:?}");

        let _ = std::fs::remove_dir_all(&data);
    }
    // ---- live output streaming ---------------------------------------------

    /// The sink builder is exercised directly: a real `Channel` needs a webview,
    /// and what matters here is the ordering, correlation and the byte budget.
    #[test]
    fn the_output_sink_numbers_chunks_and_tags_them_with_the_call() {
        let seen: SeenChunks = Arc::new(Mutex::new(Vec::new()));
        let sink = test_sink(seen.clone(), Some("call-7".into()));

        sink("one".into());
        sink("two".into());

        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 2);
        assert_eq!(seen[0].0, 0);
        assert_eq!(seen[1].0, 1, "seq is monotonic so a gap is detectable");
        assert_eq!(seen[0].1.as_deref(), Some("call-7"));
        assert_eq!(seen[1].2, "two");
    }

    /// A `yes`-style command would otherwise flood the webview. The stream stops
    /// with one honest marker; the full text still reaches the caller in the
    /// tool result.
    #[test]
    fn the_output_sink_stops_at_the_byte_cap_and_says_so() {
        let seen: SeenChunks = Arc::new(Mutex::new(Vec::new()));
        let sink = test_sink(seen.clone(), None);

        sink("x".repeat(MAX_STREAMED_BYTES + 1));
        sink("more".into());
        sink("even more".into());

        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1, "nothing is sent after the cap");
        assert!(seen[0].2.contains("truncated"), "{}", seen[0].2);
    }

    /// Mirrors `output_sink`'s accounting without a `Channel`, which cannot be
    /// constructed outside a webview.
    fn test_sink(seen: SeenChunks, call_id: Option<String>) -> crate::tools::OutputSink {
        use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
        use std::sync::Arc;
        let seq = Arc::new(AtomicU64::new(0));
        let sent = Arc::new(AtomicUsize::new(0));
        let stopped = Arc::new(AtomicBool::new(false));
        Arc::new(move |text: String| {
            if stopped.load(Ordering::Relaxed) {
                return;
            }
            let total = sent.fetch_add(text.len(), Ordering::Relaxed) + text.len();
            let payload = if total > MAX_STREAMED_BYTES {
                stopped.store(true, Ordering::Relaxed);
                "\n[output truncated in the live view]\n".to_string()
            } else {
                text
            };
            seen.lock().unwrap().push((
                seq.fetch_add(1, Ordering::Relaxed),
                call_id.clone(),
                payload,
            ));
        })
    }
}
