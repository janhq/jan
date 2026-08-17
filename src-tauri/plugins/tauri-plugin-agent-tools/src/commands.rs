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

use crate::memory;
use crate::permissions::ToolPermissions;
use crate::skills::{self, SkillMeta};
use crate::tools::gate::{self, Decision, PromptKind, SessionGrants};
use crate::tools::jail;
use crate::tools::{handlers, lookup, schema, ToolContext};
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
}

/// The permanent store root holding `memory/` and `skills/`.
///
/// `project` is an explicit override and is currently always `None`: the desktop
/// has no project picker yet. Once one lands, a project's own co-located store
/// (`<project>/.jan/agent`) layers on top of this one; see the memory-scope TODO.
fn resolve_store(data_folder: &str, project: Option<&str>) -> PathBuf {
    match project.map(str::trim).filter(|p| !p.is_empty()) {
        Some(p) => workspace::project_store(Path::new(p)),
        None => workspace::permanent_store(Path::new(data_folder)),
    }
}

/// Ensure the permanent store exists and return its path, so the UI can show
/// where memories and skills live.
#[tauri::command]
pub async fn workspace_path(data_folder: String) -> Result<String, AgentToolsError> {
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
    workspace::remove_thread_workspace(Path::new(&data_folder), &thread_id)
        .await
        .map_err(Into::into)
}

/// Delete every sandbox not belonging to a surviving thread, returning how many
/// were removed. Called once at startup: sandboxes are ephemeral, but a crash or
/// a thread deleted while the app was closed would otherwise leave one behind.
#[tauri::command]
pub async fn thread_workspace_sweep(
    data_folder: String,
    keep: Vec<String>,
) -> Result<usize, AgentToolsError> {
    workspace::sweep_thread_workspaces(Path::new(&data_folder), &keep)
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
    skills::delete(&resolve_store(&data_folder, project.as_deref()), &name).map_err(Into::into)
}

/// Memory note names (stems), sorted.
#[tauri::command]
pub async fn memory_list(
    data_folder: String,
    project: Option<String>,
) -> Result<Vec<String>, AgentToolsError> {
    Ok(memory::list(&resolve_store(&data_folder, project.as_deref())).await)
}

#[tauri::command]
pub async fn memory_read(
    data_folder: String,
    project: Option<String>,
    name: String,
) -> Result<String, AgentToolsError> {
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
    memory::write(
        &resolve_store(&data_folder, project.as_deref()),
        &name,
        &content,
    )
    .await
    .map(|_| ())
    .map_err(Into::into)
}

/// Delete a memory note. Idempotent: a missing note is Ok.
#[tauri::command]
pub async fn memory_delete(
    data_folder: String,
    project: Option<String>,
    name: String,
) -> Result<(), AgentToolsError> {
    memory::delete(&resolve_store(&data_folder, project.as_deref()), &name)
        .await
        .map_err(Into::into)
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

/// Execute one built-in tool.
///
/// The gate decides, not the caller. `write` and `edit` resolve to `Prompt` and
/// are refused here regardless of what the frontend asks for, until a permission
/// round-trip exists; a read that escapes the project root prompts too. `bash`
/// runs only under an enforcing sandbox (see the module docs).
#[tauri::command]
pub async fn execute_tool(
    data_folder: String,
    thread_id: String,
    project: Option<String>,
    name: String,
    args: serde_json::Value,
    enabled_skills: Option<Vec<String>>,
    allow_network: Option<bool>,
) -> Result<ToolResult, AgentToolsError> {
    // Created here rather than trusted to exist: `escapes_project` canonicalizes
    // the sandbox root and treats a missing one as an escape, so every tool call
    // would be refused if the thread's first tool call arrived before any UI
    // surface had ensured it.
    let root = workspace::ensure_thread_workspace(Path::new(&data_folder), &thread_id).await?;
    let scratch = workspace::ensure_scratch_dir(&thread_id).await?;
    let store = resolve_store(&data_folder, project.as_deref());
    let tool = lookup(&name)
        .ok_or_else(|| AgentToolsError::from(format!("unknown built-in tool '{name}'")))?;

    match gate::resolve_decision(
        tool,
        &args,
        &root,
        Some(&scratch),
        &ToolPermissions::default(),
        &SessionGrants::default(),
    ) {
        Decision::Allow => {}
        Decision::HardDeny(gate::DenyReason::Hidden) => {
            return Err(format!(
                "tool '{name}' is denied: {} is the agent's own state directory and is hidden",
                crate::tools::sandbox::JAN_DIR
            )
            .into());
        }
        Decision::HardDeny(gate::DenyReason::Policy) => {
            return Err(format!("tool '{name}' is denied by policy").into());
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
        // A write that *escapes* the sandbox (absolute or `..`) is different:
        // it can reach host files (rc files, ssh keys, LaunchAgents, the store)
        // that the ephemeral-root reasoning does not cover. It is gated as
        // `WriteEscape` and refused here outright, since this surface has no
        // prompt round-trip to approve it.
        Decision::Prompt(PromptKind::Write) => {}
        Decision::Prompt(PromptKind::WriteEscape) => {
            return Err(format!(
                "tool '{name}' tried to write outside the agent workspace and was refused"
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

    let enabled = enabled_skills.unwrap_or_default();
    let ctx = ToolContext::new(&root, &store, &enabled)
        .with_network(allow_network.unwrap_or(false))
        .with_confined_writes(true)
        .with_mask_root(Path::new(&data_folder))
        .with_scratch_root(&scratch);
    let (content, diff) = handlers::execute_builtin_with_diff(tool, &args, &ctx).await;
    let is_error =
        content.starts_with("ERROR") || (name == "bash" && handlers::bash_result_failed(&content));
    Ok(ToolResult {
        content,
        diff,
        is_error,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// A temp dir standing in for the Jan data folder.
    fn unique_data_folder() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!("jan_cmd_test_{}_{}", std::process::id(), n))
    }

    const T1: &str = "thread-one";
    const T2: &str = "thread-two";

    #[test]
    fn default_store_is_permanent_and_outside_any_sandbox() {
        let store = resolve_store("/data", None);
        assert_eq!(store, Path::new("/data/agent-workspace"));
        // The sandbox lives under threads/, so no relative path from inside one
        // reaches the store without escaping it.
        let sandbox = workspace::thread_workspace(Path::new("/data"), T1).unwrap();
        assert!(!workspace::store_dir(&store, "memory").starts_with(&sandbox));
    }

    #[test]
    fn explicit_project_uses_its_co_located_store() {
        assert_eq!(
            resolve_store("/data", Some("/repo")),
            Path::new("/repo/.jan/agent")
        );
        // Blank is treated as absent, not as the filesystem root.
        assert_eq!(
            resolve_store("/data", Some("   ")),
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
    /// spelled `/tmp/...` where it is bound over the sandbox's `/tmp` and by its
    /// real path where nothing is mounted there.
    #[tokio::test]
    async fn escaping_writes_are_refused() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();

        for path in ["../escape.txt", "/etc/hosts", "/home/akarshan/.bashrc"] {
            let err = execute_tool(
                df.clone(),
                T1.into(),
                None,
                "write".into(),
                json!({"path": path, "content": "x"}),
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

        // A scratch write is not a host escape and succeeds, under whichever
        // spelling reaches the scratch on this platform. The scratch outlives the
        // test process, so the name is per-run: a leftover file would answer
        // "No change" instead of "Created".
        let scratch = crate::workspace::ensure_scratch_dir(T1).await.unwrap();
        let name = format!("jan_cmd_scratch_{}.txt", std::process::id());
        let (requested, expected) = if cfg!(target_os = "linux") {
            let p = format!("/tmp/{name}");
            (p.clone(), p)
        } else {
            let p = scratch.join(&name).to_string_lossy().into_owned();
            (p.clone(), p)
        };
        let res = execute_tool(
            df.clone(),
            T1.into(),
            None,
            "write".into(),
            json!({"path": requested, "content": "x"}),
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
            T1.into(),
            None,
            "write".into(),
            json!({"path": "ok.txt", "content": "x"}),
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
    async fn bash_runs_only_when_the_sandbox_can_enforce() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();

        let result = execute_tool(
            df.clone(),
            T1.into(),
            None,
            "bash".into(),
            json!({"command": "echo hi"}),
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
            "bash".into(),
            json!({"command": "exec 3<>/dev/tcp/1.1.1.1/53 && echo connected"}),
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
        )
        .await
        .unwrap();
        assert!(out.content.contains("hello"), "got: {}", out.content);
        assert!(!out.is_error);
        let _ = std::fs::remove_dir_all(&data);
    }

    /// Thread isolation: each conversation gets its own sandbox, and neither a
    /// relative climb-out nor a sibling-thread absolute path reaches the other's
    /// scratch files. `/tmp` is the agent's own (per-thread) scratch, so a read
    /// of `/tmp` from a different thread resolves to that thread's empty scratch.
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
        )
        .await
        .expect_err("a relative climb-out to a sibling thread must be refused");
        assert!(
            err.message.contains("needs user approval"),
            "unexpected: {}",
            err.message
        );

        // `/tmp` is the per-thread scratch: t1's scratch (written by its shell)
        // is not visible to t2, whose own scratch is empty.
        let one_scratch = crate::workspace::ensure_scratch_dir(t1).await.unwrap();
        std::fs::write(one_scratch.join("secret.txt"), b"classified").unwrap();
        let out = execute_tool(
            df.clone(),
            t2.into(),
            None,
            "read".into(),
            json!({"path": "/tmp/secret.txt"}),
            None,
            None,
        )
        .await
        .unwrap();
        assert!(out.is_error, "t2 sees an empty scratch, got: {}", out.content);
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
            "memory_write".into(),
            json!({"name": "prefs", "content": "user likes tabs"}),
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
            "memory_read".into(),
            json!({"name": "prefs"}),
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
    async fn agent_config_surface_is_hard_denied() {
        let data = unique_data_folder();
        let df = data.to_string_lossy().to_string();
        thread_workspace_path(df.clone(), T1.into()).await.unwrap();

        let err = execute_tool(
            df.clone(),
            T1.into(),
            None,
            "read".to_string(),
            json!({"path": ".jan/agent/agent.toml"}),
            None,
            None,
        )
        .await
        .expect_err("agent config must be hard-denied");
        assert!(
            err.message.contains("is hidden"),
            "unexpected: {}",
            err.message
        );
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
        )
        .await
        .unwrap();
        assert_eq!(out.content, "run it");
        let _ = std::fs::remove_dir_all(&data);
    }
}
