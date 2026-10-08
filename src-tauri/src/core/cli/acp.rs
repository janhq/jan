//! `jan acp` (experimental): the agent served over the Agent Client Protocol
//! (ACP, <https://agentclientprotocol.com>) on stdio, so editors such as Zed and
//! JetBrains can drive it.
//!
//! An adapter, not a second engine. A session is an [`AgentSession`] built by
//! the same `prepare_agent_session` every other surface uses, a prompt is one
//! `run_orchestration_steered` run, and the run's [`StreamEvent`]s are
//! translated into `session/update` notifications by [`TurnMap`]. A permission
//! prompt is answered through the session's own `PermissionRegistry`, so the
//! tool gate an editor drives is the gate the TUI drives, with no bypass.
//!
//! Pinned to stable ACP wire protocol version 1 (negotiated in `initialize`),
//! with no `unstable_*` crate feature. An event ACP has no standard update for
//! is dropped, never invented into the protocol; the full table is in
//! [`TurnMap::map`], whose match has no wildcard arm so a new `StreamEvent`
//! variant cannot slip past the decision.
//!
//! MCP servers a client passes in `session/new`/`session/load` are connected
//! alongside the project's own, over stdio (the transport every ACP agent must
//! support); HTTP and SSE are not advertised. Out of scope for this cut:
//! consuming the client's `fs/*` and `terminal/*` (Jan's own tools serve the
//! filesystem) and `session/set_mode`. Neither is advertised.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use agent_client_protocol::schema::v1::{
    AgentCapabilities, AuthMethod, AuthMethodTerminal, AuthenticateRequest, AuthenticateResponse,
    CancelNotification, ContentBlock, ContentChunk, EmbeddedResourceResource, Implementation,
    InitializeRequest, InitializeResponse, LoadSessionRequest, LoadSessionResponse, McpServer,
    NewSessionRequest, NewSessionResponse, PermissionOption, PermissionOptionKind, Plan,
    PlanEntry, PlanEntryPriority, PlanEntryStatus, PromptCapabilities, PromptRequest,
    PromptResponse, RequestPermissionOutcome, RequestPermissionRequest,
    SessionId, SessionNotification, SessionUpdate, StopReason, ToolCall, ToolCallContent,
    ToolCallLocation, ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields, ToolKind,
    UsageUpdate,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{Agent, Client, ConnectionTo, Error, Responder, Stdio};
use serde_json::{json, Value};
use tauri_plugin_agent_tools::tools::gate::PermissionDecision;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use super::providers::ProviderOverrides;
use super::{
    adopt_turn_history, agent_dir_for, cli_read_messages_lenient, cli_save_thread,
    find_resume_thread, fold_interrupted_tools, is_user_turn, prepare_agent_session,
    rebuild_wire_history, thread_message_text, AgentSession, ResumeTarget, SessionFlags,
};
use crate::core::agent::events::StreamEvent;
use crate::core::agent::r#loop::{run_orchestration_steered, settle_permission};
use crate::core::agent::todo::{TodoList, TodoStatus};

/// The env var that switches the experimental server on. Any explicit value
/// wins over `[experimental].acp` in `~/.jan/config.toml`, so `=0` turns it off.
pub const ENABLE_ENV: &str = "JAN_EXPERIMENTAL_ACP";

/// Printed (to stderr) when `jan acp` runs without the opt-in.
pub const DISABLED_MESSAGE: &str = "`jan acp` is experimental and off by default. Enable it with \
     JAN_EXPERIMENTAL_ACP=1, or set `acp = true` under `[experimental]` in ~/.jan/config.toml.";

/// Whether `jan acp` may run: the env var, then the global config, then off.
pub fn enabled() -> bool {
    enabled_from(
        std::env::var(ENABLE_ENV).ok().as_deref(),
        crate::core::agent::global_config::experimental_acp_setting(),
    )
}

fn enabled_from(env: Option<&str>, config: Option<bool>) -> bool {
    env.and_then(crate::core::agent::otel::config::parse_flag)
        .or(config)
        .unwrap_or(false)
}

/// The argument a terminal-auth client appends to the configured `jan acp`
/// invocation to sign in (`jan acp --login`).
pub const LOGIN_ARG: &str = "--login";

const ALLOW_ONCE: &str = "allow_once";
const ALLOW_ALWAYS: &str = "allow_always";
const REJECT_ONCE: &str = "reject_once";

/// Accumulated tool output is kept to this many trailing bytes. `content` on a
/// `tool_call_update` replaces the whole list, so each delta resends the lot,
/// and an unbounded build log would be resent quadratically.
const OUTPUT_TAIL_BYTES: usize = 32 * 1024;

/// A tool result replayed by `session/load` is clipped to this many bytes: the
/// model keeps the full text in history, and the editor only needs the gist.
const REPLAY_RESULT_BYTES: usize = 8 * 1024;

struct Session {
    agent: AgentSession,
    history: Vec<Value>,
    cwd: PathBuf,
    /// Set from the moment a prompt is accepted until its thread is saved;
    /// `session/cancel` fires it, and `session/load` refuses to replace a
    /// session while it is set.
    turn: Option<CancellationToken>,
}

type Sessions = Arc<Mutex<HashMap<String, Session>>>;

/// Serve ACP on stdin/stdout until the client closes stdin. Stdout carries only
/// protocol frames; logs go to stderr.
pub async fn serve() -> Result<(), String> {
    let sessions: Sessions = Arc::new(Mutex::new(HashMap::new()));
    let (s_new, s_load, s_prompt, s_cancel) = (
        Arc::clone(&sessions),
        Arc::clone(&sessions),
        Arc::clone(&sessions),
        Arc::clone(&sessions),
    );
    // Every long handler hands its work to `cx.spawn`: the SDK dispatches one
    // message at a time, and a prompt that awaited inline would hold back the
    // `session/cancel` and permission replies it is waiting on.
    Agent
        .builder()
        .name("jan")
        .on_receive_request(
            async move |req: InitializeRequest, responder: Responder<InitializeResponse>, _cx| {
                responder.respond(initialize_response(&req))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |_req: AuthenticateRequest, responder: Responder<AuthenticateResponse>, cx: ConnectionTo<Client>| {
                cx.spawn(async move {
                    responder.respond_with_result(authenticate().await)
                })
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |req: NewSessionRequest, responder: Responder<NewSessionResponse>, cx: ConnectionTo<Client>| {
                let sessions = Arc::clone(&s_new);
                cx.spawn(async move {
                    responder.respond_with_result(new_session(&sessions, req).await)
                })
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |req: LoadSessionRequest, responder: Responder<LoadSessionResponse>, cx: ConnectionTo<Client>| {
                let sessions = Arc::clone(&s_load);
                cx.clone().spawn(async move {
                    // Replay and reply in one task: the spec requires every
                    // replayed update to precede the response.
                    responder.respond_with_result(load_session(&sessions, &cx, req).await)
                })
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_request(
            async move |req: PromptRequest, responder: Responder<PromptResponse>, cx: ConnectionTo<Client>| {
                let sessions = Arc::clone(&s_prompt);
                cx.clone().spawn(async move {
                    responder.respond_with_result(prompt(&sessions, &cx, req).await)
                })
            },
            agent_client_protocol::on_receive_request!(),
        )
        .on_receive_notification(
            async move |n: CancelNotification, _cx| {
                if let Some(Session { turn: Some(token), .. }) =
                    s_cancel.lock().await.get(&*n.session_id.0)
                {
                    token.cancel();
                }
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .connect_to(Stdio::new())
        .await
        .map_err(|e| format!("ACP connection failed: {e}"))
}

/// What Jan advertises. Only what is consumed: no client `fs`/`terminal`, no
/// MCP transports, so a client never assumes its unsaved buffers are read.
fn initialize_response(req: &InitializeRequest) -> InitializeResponse {
    // Echo a version this build speaks, else the latest it does; a client that
    // cannot speak it disconnects, as the spec prescribes.
    let version = req.protocol_version.min(ProtocolVersion::LATEST);
    // A terminal method may only be offered to a client that said it can run
    // one. It relaunches `jan acp --login`, the interactive sign-in.
    let auth_methods = if req.client_capabilities.auth.terminal {
        vec![AuthMethod::Terminal(
            AuthMethodTerminal::new("jan-login", "Sign in to Jan")
                .description("Opens `jan login` to sign in to Tokamak and save an API key".to_string())
                .args(vec![LOGIN_ARG.to_string()]),
        )]
    } else {
        Vec::new()
    };
    InitializeResponse::new(version)
        .agent_capabilities(
            AgentCapabilities::new().load_session(true).prompt_capabilities(
                PromptCapabilities::new().image(true).embedded_context(true),
            ),
        )
        .auth_methods(auth_methods)
        .agent_info(Implementation::new("jan", env!("CARGO_PKG_VERSION")))
}

/// Jan's credentials live in `~/.jan/config.toml`, filled by `jan login` or
/// `jan config set`, so authenticating is checking that one is usable.
async fn authenticate() -> Result<AuthenticateResponse, Error> {
    if super::providers::has_usable_provider(None) {
        Ok(AuthenticateResponse::new())
    } else {
        Err(auth_required("no provider is configured"))
    }
}

fn auth_required(detail: &str) -> Error {
    Error::auth_required().data(json!({
        "message": format!("{detail}: run `jan login`, or `jan config set --provider <name> --api-key <key> --base-url <url> --model <id>`"),
    }))
}

fn internal(message: impl Into<String>) -> Error {
    Error::internal_error().data(json!({"message": message.into()}))
}

fn invalid_params(message: impl Into<String>) -> Error {
    Error::invalid_params().data(json!({"message": message.into()}))
}

/// Run blocking work (thread-store reads and writes, session setup that reads
/// config files) off the async workers, so it can never stall
/// `session/cancel` or another session's stream.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Result<T, Error> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|e| internal(format!("background task failed: {e}")))
}

fn checked_cwd(cwd: &Path) -> Result<PathBuf, Error> {
    if !cwd.is_absolute() {
        return Err(invalid_params("cwd must be an absolute path"));
    }
    if !cwd.is_dir() {
        return Err(invalid_params("cwd is not a directory"));
    }
    Ok(cwd.to_path_buf())
}

/// Build the engine handle for `cwd`, reporting the session under `id`, with
/// the client's MCP servers connected next to the project's.
async fn open_agent(cwd: &Path, id: &str, client_mcp: Vec<McpServer>) -> Result<AgentSession, Error> {
    let project = cwd.to_path_buf();
    let mut agent = blocking(move || {
        prepare_agent_session(
            &project.to_string_lossy(),
            None,
            ProviderOverrides::default(),
            // Gated: an editor surface asks before writes, shell and MCP calls,
            // which is what `session/request_permission` exists for.
            SessionFlags { require_model: true, ..Default::default() },
            None,
        )
        .map_err(|message| {
            if super::providers::has_usable_provider(Some(&project)) {
                internal(message)
            } else {
                auth_required(&message)
            }
        })
    })
    .await??;
    agent.args.session_id = Some(id.to_string());
    // The todo tool drives ACP's `plan` update, so an ACP session gets the
    // registry the TUI has and the headless run does not.
    agent.args.todo_registry = Some(crate::core::agent::todo::new_registry());
    // Tools are collected once per run, so the servers are awaited before the
    // first prompt can start one.
    if let Some(task) = agent.mcp_task.take() {
        if let Ok(outcome) = task.await {
            for failure in &outcome.failed {
                log::warn!("MCP: {failure}");
            }
        }
    }
    for server in client_mcp {
        let Some((name, config)) = client_mcp_config(server) else {
            continue;
        };
        // Best-effort, like the project's own servers: one that fails to start
        // costs its tools, not the session.
        if let Err(e) = super::mcp::connect(&name, &config, &agent.mcp_servers).await {
            log::warn!("ACP: client MCP server '{name}': {e}");
        }
    }
    Ok(agent)
}

/// A client MCP server in the shape `mcp_config.json` stores, so it connects
/// through the same code as a configured one. Only stdio: HTTP and SSE are not
/// advertised in `mcpCapabilities`, so a client that sends one anyway is
/// logged and skipped.
fn client_mcp_config(server: McpServer) -> Option<(String, Value)> {
    match server {
        McpServer::Stdio(stdio) => {
            let env: serde_json::Map<String, Value> =
                stdio.env.into_iter().map(|v| (v.name, Value::String(v.value))).collect();
            Some((
                stdio.name,
                json!({"command": stdio.command.to_string_lossy(), "args": stdio.args, "env": env}),
            ))
        }
        other => {
            log::warn!("ACP: skipping a client MCP server on an unadvertised transport: {other:?}");
            None
        }
    }
}

async fn new_session(sessions: &Sessions, req: NewSessionRequest) -> Result<NewSessionResponse, Error> {
    let cwd = checked_cwd(&req.cwd)?;
    // The session id is the thread id, unabbreviated, so `session/load`,
    // `/resume` and `--resume` all name the same conversation.
    let id = uuid::Uuid::new_v4().to_string();
    let agent = open_agent(&cwd, &id, req.mcp_servers).await?;
    sessions.lock().await.insert(
        id.clone(),
        Session { agent, history: Vec::new(), cwd, turn: None },
    );
    Ok(NewSessionResponse::new(SessionId::new(id)))
}

/// The wire history of the saved thread `id` under `agent_dir`, whichever
/// surface wrote it (TUI, headless run, RPC or ACP: all save through
/// `cli_save_thread`). Exact ids only: a prefix is a convenience for a person
/// typing, and a client that holds an id holds all of it.
fn read_thread(agent_dir: &Path, id: &str) -> Result<Vec<Value>, Error> {
    let found = find_resume_thread(agent_dir, &ResumeTarget::Id(id.to_string()))
        .ok()
        .filter(|thread| thread.get("id").and_then(Value::as_str) == Some(id));
    if found.is_none() {
        return Err(Error::resource_not_found(None).data(json!({"sessionId": id})));
    }
    let (messages, skipped) = cli_read_messages_lenient(agent_dir, id).map_err(internal)?;
    if skipped > 0 {
        log::warn!("ACP: skipped {skipped} unreadable message(s) loading {id}");
    }
    Ok(rebuild_wire_history(&messages))
}

fn busy() -> Error {
    Error::invalid_request().data(json!({"message": "session has a prompt running"}))
}

async fn load_session(
    sessions: &Sessions,
    cx: &ConnectionTo<Client>,
    req: LoadSessionRequest,
) -> Result<LoadSessionResponse, Error> {
    let cwd = checked_cwd(&req.cwd)?;
    let id = req.session_id.0.to_string();
    // A cheap early refusal; the check that counts is the one under the lock
    // below, since a prompt can start while this awaits.
    if sessions.lock().await.get(&id).is_some_and(|s| s.turn.is_some()) {
        return Err(busy());
    }
    let agent_dir = agent_dir_for(&cwd);
    let thread_id = id.clone();
    let history = blocking(move || read_thread(&agent_dir, &thread_id)).await??;
    let agent = open_agent(&cwd, &id, req.mcp_servers).await?;
    let updates = replay(&history, &cwd);
    {
        // Check and insert under one lock: a prompt accepted while the thread
        // was read would otherwise have its session replaced under it, and fold
        // its turn into the reloaded copy.
        let mut map = sessions.lock().await;
        if map.get(&id).is_some_and(|s| s.turn.is_some()) {
            return Err(busy());
        }
        map.insert(id, Session { agent, history, cwd, turn: None });
    }
    for update in updates {
        cx.send_notification(SessionNotification::new(req.session_id.clone(), update))?;
    }
    Ok(LoadSessionResponse::new())
}

/// The updates that redraw a saved conversation: what the user typed, what the
/// agent answered, and each tool call with its final result.
fn replay(history: &[Value], cwd: &Path) -> Vec<SessionUpdate> {
    let mut out = Vec::new();
    for message in history {
        match message.get("role").and_then(Value::as_str) {
            Some("user") if is_user_turn(message) => {
                let text = thread_message_text(message);
                if !text.is_empty() {
                    out.push(SessionUpdate::UserMessageChunk(text_chunk(text)));
                }
            }
            Some("assistant") => {
                let text = thread_message_text(message);
                if !text.is_empty() {
                    out.push(SessionUpdate::AgentMessageChunk(text_chunk(text)));
                }
                for call in message.get("tool_calls").and_then(Value::as_array).into_iter().flatten() {
                    let id = call.get("id").and_then(Value::as_str).unwrap_or_default();
                    let name = call.pointer("/function/name").and_then(Value::as_str).unwrap_or_default();
                    let args = call
                        .pointer("/function/arguments")
                        .and_then(Value::as_str)
                        .and_then(|raw| serde_json::from_str(raw).ok())
                        .unwrap_or(Value::Null);
                    out.push(SessionUpdate::ToolCall(
                        ToolCall::new(id.to_string(), tool_title(name, &args))
                            .kind(tool_kind(name))
                            .status(ToolCallStatus::Completed)
                            .locations(tool_locations(&args, cwd))
                            .raw_input(args),
                    ));
                }
            }
            Some("tool") => {
                let id = message.get("tool_call_id").and_then(Value::as_str).unwrap_or_default();
                let text = tail(&thread_message_text(message), REPLAY_RESULT_BYTES).to_string();
                out.push(SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
                    id.to_string(),
                    ToolCallUpdateFields::new()
                        .status(ToolCallStatus::Completed)
                        .content(vec![ToolCallContent::from(text)]),
                )));
            }
            _ => {}
        }
    }
    out
}

/// The prompt's blocks as the engine's user content: a plain string when it is
/// all text, else OpenAI content parts, held to the caps every surface uses.
fn prompt_content(blocks: Vec<ContentBlock>) -> Result<Value, Error> {
    let mut parts = Vec::new();
    for block in blocks {
        match block {
            ContentBlock::Text(text) => parts.push(json!({"type":"text","text":text.text})),
            ContentBlock::Image(image) => parts.push(json!({
                "type":"image_url",
                "image_url": {"url": format!("data:{};base64,{}", image.mime_type, image.data), "detail":"auto"},
            })),
            // A link is the user pointing at something; the agent's own tools
            // can open it, so it goes in as a reference rather than contents.
            ContentBlock::ResourceLink(link) => {
                parts.push(json!({"type":"text","text":format!("[@{}]({})", link.name, link.uri)}))
            }
            ContentBlock::Resource(resource) => match resource.resource {
                EmbeddedResourceResource::TextResourceContents(text) => parts.push(json!({
                    "type":"text",
                    "text":format!("<context uri=\"{}\">\n{}\n</context>", text.uri, text.text),
                })),
                EmbeddedResourceResource::BlobResourceContents(blob) => parts.push(json!({
                    "type":"text","text":format!("[@binary]({})", blob.uri),
                })),
                _ => return Err(invalid_params("unsupported embedded resource")),
            },
            // Audio is not advertised in `promptCapabilities`.
            _ => return Err(invalid_params("unsupported prompt content block")),
        }
    }
    if parts.iter().all(|p| p["type"] == "text") {
        let text = parts
            .iter()
            .filter_map(|p| p["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n");
        if text.trim().is_empty() {
            return Err(invalid_params("prompt is empty"));
        }
        return Ok(Value::String(text));
    }
    super::stream_input::check_content_parts(&parts, "prompt").map_err(invalid_params)?;
    Ok(Value::Array(parts))
}

async fn prompt(
    sessions: &Sessions,
    cx: &ConnectionTo<Client>,
    req: PromptRequest,
) -> Result<PromptResponse, Error> {
    let sid = req.session_id.clone();
    let id = sid.0.to_string();
    let content = prompt_content(req.prompt)?;
    let token = CancellationToken::new();
    let (body, args, registry, cwd, window) = {
        let mut map = sessions.lock().await;
        let session = map
            .get_mut(&id)
            .ok_or_else(|| Error::resource_not_found(None).data(json!({"sessionId": id})))?;
        if session.turn.is_some() {
            return Err(Error::invalid_request().data(json!({"message": "a prompt is already running in this session"})));
        }
        session.turn = Some(token.clone());
        session.history.push(json!({"role":"user","content":content}));
        (
            session.agent.body(json!(session.history)),
            session.agent.args.clone(),
            Arc::clone(&session.agent.permission_requests),
            session.cwd.clone(),
            session.agent.limits.context_window,
        )
    };

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
    // The run owns the sender, so the event stream ends exactly when it does.
    let runner = tokio::spawn(async move {
        let tx = tx;
        run_orchestration_steered(&tx, &body, &args, None).await
    });
    let mut map = TurnMap::new(cwd, window);
    let mut asks = tokio::task::JoinSet::new();
    let cancelled = loop {
        tokio::select! {
            biased;
            _ = token.cancelled() => break true,
            Some(_) = asks.join_next(), if !asks.is_empty() => {}
            event = rx.recv() => {
                let Some(event) = event else { break false };
                crate::core::agent::otel::observe(&event);
                let mut gone = false;
                for out in map.map(event) {
                    match out {
                        Outbound::Update(update) => {
                            gone |= cx.send_notification(SessionNotification::new(sid.clone(), update)).is_err();
                        }
                        Outbound::Permission(ask) => {
                            asks.spawn(ask_permission(cx.clone(), sid.clone(), ask, Arc::clone(&registry)));
                        }
                    }
                }
                // A client that cannot be written to cannot answer either.
                if gone {
                    break true;
                }
            }
        }
    };

    let result = if cancelled {
        // Dropping the run drops any tool call in flight; dropping the asks
        // sends `$/cancel_request` for each open prompt, and a dropped decision
        // sender reads as Deny to anything still waiting.
        runner.abort();
        asks.abort_all();
        registry.lock().await.clear();
        None
    } else {
        asks.abort_all();
        Some(runner.await.unwrap_or_else(|e| Err(format!("the run ended without an outcome: {e}"))))
    };

    // Settle the turn's history under the lock, but write it to disk after
    // dropping it: the lock is shared by every session and by
    // `session/cancel`. `turn` stays set until the save is done, so a
    // `session/load` cannot replace the session while its thread is written.
    let (agent_dir, model, history) = {
        let mut map_sessions = sessions.lock().await;
        let session = map_sessions.get_mut(&id).ok_or_else(|| internal("session vanished"))?;
        let completion = result.as_ref().and_then(|r| r.as_ref().ok());
        match completion {
            Some(completion) => adopt_turn_history(&mut session.history, map.history.take(), Some(completion)),
            None => map.settle_interrupted(&mut session.history),
        }
        (agent_dir_for(&session.cwd), session.agent.model.clone(), session.history.clone())
    };
    if !history.is_empty() {
        let thread_id = id.clone();
        let saved = blocking(move || cli_save_thread(&agent_dir, Some(&thread_id), &model, &history, None)).await;
        if let Err(message) = saved.and_then(|r| r.map_err(internal)) {
            log::warn!("ACP: could not save session {id}: {}", message.message);
        }
    }
    if let Some(session) = sessions.lock().await.get_mut(&id) {
        session.turn = None;
    }

    match result {
        None => Ok(PromptResponse::new(StopReason::Cancelled)),
        Some(Ok(_)) => Ok(PromptResponse::new(stop_reason(map.stop_reason.as_deref()))),
        // A failed run is not a failed request: the editor gets the turn's end
        // as `end_turn`, the reason as text it can show, and the log a copy.
        // A JSON-RPC error here would read to a client as a protocol fault.
        Some(Err(message)) => {
            log::warn!("ACP: run failed in session {id}: {message}");
            let _ = cx.send_notification(SessionNotification::new(
                sid,
                SessionUpdate::AgentMessageChunk(text_chunk(format!("\n\nError: {message}"))),
            ));
            Ok(PromptResponse::new(StopReason::EndTurn))
        }
    }
}

/// ACP's stop reason for the `Done` the run ended with. `Done` is the single
/// source: a stop reason is never inferred from the stream going quiet or
/// parsed from an error's text. ACP sessions set no turn cap, so the limit a
/// run can hit is the session's cost ceiling, which `Done` reports as
/// `budget_exceeded` -- a limit, not an error, hence `max_turn_requests`.
fn stop_reason(done: Option<&str>) -> StopReason {
    match done {
        Some("length") => StopReason::MaxTokens,
        Some("content_filter") => StopReason::Refusal,
        Some("budget_exceeded") => StopReason::MaxTurnRequests,
        _ => StopReason::EndTurn,
    }
}

/// Put one gate prompt to the client and settle it in the session's registry.
/// Anything but an allow option -- a reject, a cancelled outcome, an error, a
/// client that went away -- is Deny, which is what a dropped sender means too.
async fn ask_permission(
    cx: ConnectionTo<Client>,
    sid: SessionId,
    ask: PermissionAsk,
    registry: crate::core::agent::r#loop::PermissionRegistry,
) {
    let mut options = vec![PermissionOption::new(ALLOW_ONCE, "Allow", PermissionOptionKind::AllowOnce)];
    if ask.offers_always {
        options.push(PermissionOption::new(ALLOW_ALWAYS, "Always allow", PermissionOptionKind::AllowAlways));
    }
    options.push(PermissionOption::new(REJECT_ONCE, "Reject", PermissionOptionKind::RejectOnce));
    let reply = cx
        .send_request(RequestPermissionRequest::new(sid, ask.tool_call, options))
        .block_task()
        .await;
    let decision = match reply.map(|r| r.outcome) {
        Ok(RequestPermissionOutcome::Selected(selected)) => decision_for(&selected.option_id.0),
        _ => PermissionDecision::Deny,
    };
    // `false` is a prompt the cancel path already cleared: nothing waits on it.
    settle_permission(&registry, &ask.request_id, decision).await;
}

fn decision_for(option_id: &str) -> PermissionDecision {
    match option_id {
        ALLOW_ONCE => PermissionDecision::AllowOnce,
        ALLOW_ALWAYS => PermissionDecision::AllowAlways,
        _ => PermissionDecision::Deny,
    }
}

/// One gate prompt, as the client is to be asked it.
struct PermissionAsk {
    request_id: String,
    tool_call: ToolCallUpdate,
    offers_always: bool,
}

enum Outbound {
    Update(SessionUpdate),
    Permission(PermissionAsk),
}

#[derive(Default)]
struct CallState {
    name: String,
    /// A `tool_call` has gone out for it; later news is a `tool_call_update`.
    announced: bool,
    /// A result arrived; it can no longer be the call a prompt is about.
    finished: bool,
    /// A gate prompt was already matched to it.
    prompted: bool,
    output: String,
    /// The arguments, once whole, and the result: what a cancelled turn folds
    /// back into history.
    args: Option<Value>,
    result: Option<String>,
}

/// Per-turn translation state: which calls the client knows about, their
/// streamed output, and what the run said about how it ended.
struct TurnMap {
    cwd: PathBuf,
    context_window: u64,
    calls: HashMap<String, CallState>,
    /// Call ids in the order they were announced, for matching a gate prompt.
    order: Vec<String>,
    stop_reason: Option<String>,
    history: Option<Vec<Value>>,
    /// The prose streamed since the last published history, kept for a cancel.
    answer: String,
}

impl TurnMap {
    fn new(cwd: PathBuf, context_window: u64) -> Self {
        Self {
            cwd,
            context_window,
            calls: HashMap::new(),
            order: Vec::new(),
            stop_reason: None,
            history: None,
            answer: String::new(),
        }
    }

    /// Leave `history` as a well-formed conversation after a run stopped before
    /// it finished, the way the TUI does on Esc: the latest published history
    /// is adopted, the tool calls made since are folded in with their results
    /// (a call still in flight gets a placeholder), and the partial answer is
    /// kept. A turn that produced nothing is taken back out, so the next prompt
    /// does not put two user turns in a row on the wire -- the cancelled prompt
    /// neither ran nor counted.
    fn settle_interrupted(&mut self, history: &mut Vec<Value>) {
        adopt_turn_history(history, self.history.take(), None);
        let calls: Vec<(String, String, Value)> = self
            .order
            .iter()
            .filter_map(|id| {
                let call = self.calls.get(id)?;
                Some((id.clone(), call.name.clone(), call.args.clone()?))
            })
            .collect();
        let results: Vec<(String, String)> = self
            .calls
            .iter()
            .filter_map(|(id, call)| Some((id.clone(), call.result.clone()?)))
            .collect();
        let before = history.len();
        fold_interrupted_tools(history, &calls, &results);
        let answer = self.answer.trim();
        if !answer.is_empty() {
            history.push(json!({"role":"assistant","content":answer}));
        }
        if history.len() == before
            && history.last().is_some_and(|m| m.get("role").and_then(Value::as_str) == Some("user"))
        {
            history.pop();
        }
    }

    fn call(&mut self, id: &str, name: &str) -> &mut CallState {
        if !self.calls.contains_key(id) {
            self.order.push(id.to_string());
        }
        let call = self.calls.entry(id.to_string()).or_default();
        if call.name.is_empty() {
            call.name = name.to_string();
        }
        call
    }

    /// The `StreamEvent -> session/update` table. No wildcard arm: a variant
    /// added to `StreamEvent` fails the build here until it is decided.
    fn map(&mut self, event: StreamEvent) -> Vec<Outbound> {
        let update = |u| vec![Outbound::Update(u)];
        match event {
            StreamEvent::Token { text } => {
                self.answer.push_str(&text);
                update(SessionUpdate::AgentMessageChunk(text_chunk(text)))
            }
            StreamEvent::Reasoning { text } => update(SessionUpdate::AgentThoughtChunk(text_chunk(text))),
            StreamEvent::ToolCallStarted { id, name } => {
                let call = self.call(&id, &name);
                call.announced = true;
                update(SessionUpdate::ToolCall(
                    ToolCall::new(id, name.clone()).kind(tool_kind(&name)).status(ToolCallStatus::Pending),
                ))
            }
            StreamEvent::ToolCall { id, name, args } => {
                let locations = tool_locations(&args, &self.cwd);
                let title = tool_title(&name, &args);
                let kind = tool_kind(&name);
                let call = self.call(&id, &name);
                call.args = Some(args.clone());
                if call.announced {
                    update(SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
                        id,
                        ToolCallUpdateFields::new()
                            .title(title)
                            .kind(kind)
                            .status(ToolCallStatus::InProgress)
                            .locations(locations)
                            .raw_input(args),
                    )))
                } else {
                    // A provider that does not stream tool calls never sent
                    // `ToolCallStarted`, so this is the call's first mention.
                    call.announced = true;
                    update(SessionUpdate::ToolCall(
                        ToolCall::new(id, title)
                            .kind(kind)
                            .status(ToolCallStatus::InProgress)
                            .locations(locations)
                            .raw_input(args),
                    ))
                }
            }
            StreamEvent::ToolOutputDelta { id, delta } => {
                let call = self.call(&id, "");
                call.output.push_str(&delta);
                let keep = tail(&call.output, OUTPUT_TAIL_BYTES).len();
                let cut = call.output.len() - keep;
                call.output.drain(..cut);
                let text = call.output.clone();
                update(SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
                    id,
                    ToolCallUpdateFields::new().content(vec![ToolCallContent::from(text)]),
                )))
            }
            StreamEvent::ToolResult { id, content, is_error, diff } => {
                let call = self.call(&id, "");
                call.finished = true;
                call.result = Some(content.clone());
                let mut blocks = vec![ToolCallContent::from(content)];
                blocks.extend(diff.as_deref().map(diff_block));
                let status = if is_error { ToolCallStatus::Failed } else { ToolCallStatus::Completed };
                update(SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
                    id,
                    ToolCallUpdateFields::new().status(status).content(blocks),
                )))
            }
            ask @ StreamEvent::PermissionRequest { .. } => {
                self.permission(ask, true).map(Outbound::Permission).into_iter().collect()
            }
            // A subagent shares its parent's permission registry, so its gate
            // prompts have to reach the client or the child waits forever. The
            // child's calls are not the parent's, so the prompt is never pinned
            // to one of the parent's cards. The rest of a child's stream has no
            // ACP home and is dropped.
            StreamEvent::Subagent { event, .. } => {
                self.permission(*event, false).map(Outbound::Permission).into_iter().collect()
            }
            StreamEvent::TodoUpdate { list } => update(SessionUpdate::Plan(plan(&list))),
            StreamEvent::TurnUsage { usage, .. } => {
                let used = usage.total_tokens.unwrap_or_else(|| {
                    usage.prompt_tokens.unwrap_or(0) + usage.completion_tokens.unwrap_or(0)
                });
                if self.context_window == 0 || used == 0 {
                    Vec::new()
                } else {
                    update(SessionUpdate::UsageUpdate(UsageUpdate::new(used, self.context_window)))
                }
            }
            StreamEvent::MessagesUpdated { messages } => {
                // Everything streamed so far is in it, so a cancel from here on
                // folds only what comes after.
                self.history = Some(messages);
                self.answer.clear();
                Vec::new()
            }
            StreamEvent::Done { stop_reason, .. } => {
                self.stop_reason = Some(stop_reason);
                Vec::new()
            }
            // Partial JSON is not a valid `rawInput`; the whole arguments go
            // out with `ToolCall`.
            StreamEvent::ToolCallArgsDelta { .. }
            // The prompt's own response carries a failure.
            | StreamEvent::Error { .. }
            // Internal turn counter.
            | StreamEvent::Step { .. }
            // No standard ACP update, in stable or unstable: dropped rather
            // than carried in an invented extension.
            | StreamEvent::SubagentStart { .. }
            | StreamEvent::SubagentQueued { .. }
            | StreamEvent::SubagentEnd { .. }
            | StreamEvent::SubagentPlan { .. }
            // `ask` is not advertised in an ACP session (no ask registry).
            | StreamEvent::AskRequest { .. }
            | StreamEvent::AskResolved { .. }
            // Display-only, TUI-oriented, or diagnostics for other surfaces.
            | StreamEvent::Notice { .. }
            | StreamEvent::Compaction { .. }
            | StreamEvent::Retry { .. }
            | StreamEvent::Monitors { .. }
            | StreamEvent::Parked
            | StreamEvent::ToolDetails { .. }
            | StreamEvent::RequestProvenance { .. }
            // Host tools are an RPC/stream-json feature; none are declared here.
            | StreamEvent::ToolRequest { .. }
            | StreamEvent::ToolRequestCancelled { .. } => Vec::new(),
        }
    }

    /// Build the client's view of one gate prompt; `None` for any other event.
    /// The prompt names a tool but not the call, so with `match_calls` it is
    /// matched to the oldest open, unprompted call of that tool -- the gate
    /// prompts in call order. Without a match, or for a subagent's prompt, it
    /// stands on its own request id, which a client renders as a fresh card.
    fn permission(&mut self, event: StreamEvent, match_calls: bool) -> Option<PermissionAsk> {
        let StreamEvent::PermissionRequest {
            request_id, tool_name, capability, path, command, diff, offers_always, ..
        } = event
        else {
            return None;
        };
        let tool_name = tool_name.as_str();
        let matched = self
            .order
            .iter()
            .filter(|_| match_calls)
            .find(|id| {
                self.calls
                    .get(*id)
                    .is_some_and(|c| c.name == tool_name && !c.finished && !c.prompted)
            })
            .cloned();
        if let Some(id) = &matched {
            if let Some(call) = self.calls.get_mut(id) {
                call.prompted = true;
            }
        }
        let title = match (&command, &path) {
            (Some(command), _) => format!("{tool_name}: {command}"),
            (None, Some(path)) => format!("{tool_name} ({capability}) {path}"),
            (None, None) => format!("{tool_name} ({capability})"),
        };
        let mut fields = ToolCallUpdateFields::new().title(title).kind(tool_kind(tool_name));
        if let Some(path) = &path {
            fields = fields.locations(vec![ToolCallLocation::new(absolute(&self.cwd, path))]);
        }
        if let Some(diff) = diff {
            fields = fields.content(vec![diff_block(&diff)]);
        }
        Some(PermissionAsk {
            tool_call: ToolCallUpdate::new(matched.unwrap_or_else(|| request_id.clone()), fields),
            request_id,
            offers_always,
        })
    }
}

/// A unified diff as tool-call content, fenced so a client renders it as one.
fn diff_block(diff: &str) -> ToolCallContent {
    ToolCallContent::from(format!("```diff\n{diff}\n```"))
}

fn text_chunk(text: impl Into<String>) -> ContentChunk {
    ContentChunk::new(ContentBlock::from(text.into()))
}

/// The session todo list as an ACP plan: phases flattened in order. An
/// abandoned task is not work the plan still describes, so it is left out --
/// ACP has no status for it.
fn plan(list: &TodoList) -> Plan {
    let entries = list
        .phases
        .iter()
        .flat_map(|phase| phase.tasks.iter())
        .filter_map(|task| {
            let status = match task.status {
                TodoStatus::Pending => PlanEntryStatus::Pending,
                TodoStatus::InProgress => PlanEntryStatus::InProgress,
                TodoStatus::Completed => PlanEntryStatus::Completed,
                TodoStatus::Abandoned => return None,
            };
            Some(PlanEntry::new(task.content.clone(), PlanEntryPriority::Medium, status))
        })
        .collect();
    Plan::new(entries)
}

/// What kind of work a tool does, for the client's icon and grouping.
fn tool_kind(name: &str) -> ToolKind {
    match name {
        "read" | "ls" | "memory_read" | "memory_list" | "skill_read" | "skill_list" => ToolKind::Read,
        "edit" | "write" | "memory_write" | "skill_write" => ToolKind::Edit,
        "grep" | "find" => ToolKind::Search,
        // `bash` is the shell's pre-rename name, still in replayed history.
        "bash" | tauri_plugin_agent_tools::tools::SHELL_TOOL => ToolKind::Execute,
        "web_fetch" | "web_search" => ToolKind::Fetch,
        "dispatch_subagent" | "todo" => ToolKind::Think,
        _ => ToolKind::Other,
    }
}

/// A short human title: the command for a shell call, the target for a path
/// or query, else the tool's name.
fn tool_title(name: &str, args: &Value) -> String {
    let arg = |key: &str| args.get(key).and_then(Value::as_str);
    match (arg("command"), arg("path"), arg("pattern").or(arg("query")).or(arg("url"))) {
        (Some(command), _, _) => command.to_string(),
        (None, Some(path), _) => format!("{name} {path}"),
        (None, None, Some(target)) => format!("{name} {target}"),
        _ => name.to_string(),
    }
}

fn tool_locations(args: &Value, cwd: &Path) -> Vec<ToolCallLocation> {
    args.get("path")
        .and_then(Value::as_str)
        .map(|path| vec![ToolCallLocation::new(absolute(cwd, path))])
        .unwrap_or_default()
}

/// ACP locations are absolute; a tool's `path` argument is project-relative.
fn absolute(cwd: &Path, path: &str) -> PathBuf {
    let path = Path::new(path);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    }
}

/// The last `max` bytes of `text`, cut on a char boundary.
fn tail(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut start = text.len() - max;
    while !text.is_char_boundary(start) {
        start += 1;
    }
    &text[start..]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map() -> TurnMap {
        TurnMap::new(PathBuf::from("/work"), 1000)
    }

    fn wire(out: &Outbound) -> Value {
        match out {
            Outbound::Update(update) => serde_json::to_value(update).unwrap(),
            Outbound::Permission(ask) => json!({
                "permission": ask.request_id,
                "toolCall": serde_json::to_value(&ask.tool_call).unwrap(),
                "always": ask.offers_always,
            }),
        }
    }

    #[test]
    fn the_opt_in_is_off_by_default_and_the_env_wins() {
        assert!(!enabled_from(None, None));
        assert!(enabled_from(None, Some(true)));
        assert!(enabled_from(Some("1"), None));
        assert!(!enabled_from(Some("0"), Some(true)), "an explicit env value wins");
        assert!(enabled_from(Some("maybe"), Some(true)), "an unparseable value is no answer");
        assert!(!enabled_from(Some("maybe"), None));
    }

    /// Every sampled `StreamEvent` either maps to the update the table names
    /// or to nothing. The expected tag is spelled per variant, so a change to
    /// the table shows up here as a diff, not as silence.
    #[test]
    fn every_variant_maps_to_its_update_or_is_dropped() {
        for (variant, event) in crate::core::agent::events::tests::sample_events() {
            let mut map = map();
            // A result or a gate prompt is about a call the client was told of.
            map.map(StreamEvent::ToolCallStarted { id: "t1".into(), name: "read".into() });
            let out: Vec<Value> = map.map(event).iter().map(wire).collect();
            let expected: Option<&str> = match variant {
                "Token" => Some("agent_message_chunk"),
                "Reasoning" => Some("agent_thought_chunk"),
                "ToolCallStarted" => Some("tool_call"),
                "ToolCall" | "ToolOutputDelta" | "ToolResult" => Some("tool_call_update"),
                "TodoUpdate" => Some("plan"),
                "TurnUsage" => Some("usage_update"),
                "PermissionRequest" => Some("permission"),
                // Includes `Subagent`: the sample wraps a non-prompt event.
                _ => None,
            };
            match expected {
                Some("permission") => {
                    assert_eq!(out.len(), 1, "{variant}: {out:?}");
                    assert!(out[0].get("permission").is_some(), "{variant}: {out:?}");
                }
                Some(tag) => {
                    assert_eq!(out.len(), 1, "{variant}: {out:?}");
                    assert_eq!(out[0]["sessionUpdate"], tag, "{variant}: {out:?}");
                }
                None => assert!(out.is_empty(), "{variant} must be dropped, got {out:?}"),
            }
        }
    }

    #[test]
    fn a_subagent_gate_prompt_reaches_the_client() {
        let mut map = map();
        let out = map.map(StreamEvent::Subagent {
            run_id: "r".into(),
            name: "scout".into(),
            event: Box::new(StreamEvent::PermissionRequest {
                request_id: "perm-7".into(),
                tool_name: "bash".into(),
                capability: "exec".into(),
                path: None,
                command: Some("ls".into()),
                diff: None,
                prompt_kind: "exec".into(),
                offers_always: false,
            }),
        });
        let wire: Vec<Value> = out.iter().map(wire).collect();
        assert_eq!(wire.len(), 1);
        assert_eq!(wire[0]["permission"], "perm-7");
        assert_eq!(wire[0]["always"], false);
        // No announced call to match, so it stands on its own id.
        assert_eq!(wire[0]["toolCall"]["toolCallId"], "perm-7");
    }

    #[test]
    fn a_gate_prompt_attaches_to_the_oldest_open_call_of_its_tool() {
        let mut map = map();
        for id in ["a", "b"] {
            map.map(StreamEvent::ToolCall { id: id.into(), name: "write".into(), args: json!({"path":"x.txt"}) });
        }
        let ask = |map: &mut TurnMap, n: u8| {
            let out = map.map(StreamEvent::PermissionRequest {
                request_id: format!("perm-{n}"),
                tool_name: "write".into(),
                capability: "write".into(),
                path: Some("x.txt".into()),
                command: None,
                diff: Some("-a\n+b".into()),
                prompt_kind: "write".into(),
                offers_always: true,
            });
            wire(&out[0])
        };
        let first = ask(&mut map, 1);
        assert_eq!(first["toolCall"]["toolCallId"], "a");
        assert_eq!(first["toolCall"]["locations"][0]["path"], "/work/x.txt");
        assert!(first["toolCall"]["content"][0]["content"]["text"].as_str().unwrap().contains("+b"));
        assert_eq!(ask(&mut map, 2)["toolCall"]["toolCallId"], "b");
    }

    #[test]
    fn an_unstreamed_tool_call_is_announced_whole() {
        let mut map = map();
        let out = map.map(StreamEvent::ToolCall {
            id: "c".into(),
            name: "shell".into(),
            args: json!({"command":"cargo test"}),
        });
        let w = wire(&out[0]);
        assert_eq!(w["sessionUpdate"], "tool_call");
        assert_eq!(w["title"], "cargo test");
        assert_eq!(w["kind"], "execute");
        assert_eq!(w["status"], "in_progress");
    }

    #[test]
    fn a_failed_result_is_failed_and_the_done_reason_is_kept() {
        let mut map = map();
        map.map(StreamEvent::ToolCallStarted { id: "t".into(), name: "read".into() });
        let out = map.map(StreamEvent::ToolResult {
            id: "t".into(),
            content: "no such file".into(),
            is_error: true,
            diff: None,
        });
        assert_eq!(wire(&out[0])["status"], "failed");
        map.map(StreamEvent::Done { stop_reason: "length".into(), usage: None });
        assert_eq!(stop_reason(map.stop_reason.as_deref()), StopReason::MaxTokens);
        assert_eq!(stop_reason(Some("stop")), StopReason::EndTurn);
        assert_eq!(stop_reason(None), StopReason::EndTurn);
    }

    #[test]
    fn streamed_output_is_resent_whole_but_bounded() {
        let mut map = map();
        map.map(StreamEvent::ToolOutputDelta { id: "t".into(), delta: "ab".into() });
        let out = map.map(StreamEvent::ToolOutputDelta { id: "t".into(), delta: "cd".into() });
        assert_eq!(wire(&out[0])["content"][0]["content"]["text"], "abcd");
        let big = "x".repeat(OUTPUT_TAIL_BYTES + 10);
        let out = map.map(StreamEvent::ToolOutputDelta { id: "t".into(), delta: big });
        let text = wire(&out[0])["content"][0]["content"]["text"].as_str().unwrap().len();
        assert_eq!(text, OUTPUT_TAIL_BYTES);
    }

    #[test]
    fn an_abandoned_task_is_left_out_of_the_plan() {
        use crate::core::agent::todo::{TodoItem, TodoPhase};
        let list = TodoList {
            phases: vec![TodoPhase {
                name: "p".into(),
                tasks: vec![
                    TodoItem { content: "a".into(), status: TodoStatus::Completed },
                    TodoItem { content: "b".into(), status: TodoStatus::Abandoned },
                    TodoItem { content: "c".into(), status: TodoStatus::InProgress },
                ],
            }],
        };
        let w = serde_json::to_value(plan(&list)).unwrap();
        assert_eq!(w["entries"].as_array().unwrap().len(), 2);
        assert_eq!(w["entries"][1]["status"], "in_progress");
    }

    #[test]
    fn initialize_advertises_only_what_is_consumed() {
        let req: InitializeRequest = serde_json::from_value(json!({
            "protocolVersion": 1,
            "clientCapabilities": {"fs":{"readTextFile":true,"writeTextFile":true},"terminal":true},
        }))
        .unwrap();
        let w = serde_json::to_value(initialize_response(&req)).unwrap();
        assert_eq!(w["protocolVersion"], 1);
        let caps = &w["agentCapabilities"];
        assert_eq!(caps["loadSession"], true);
        assert_eq!(caps["promptCapabilities"]["image"], true);
        assert_eq!(caps["promptCapabilities"]["audio"], false);
        // No MCP transport beyond the mandatory stdio baseline is claimed.
        assert_ne!(caps["mcpCapabilities"]["http"], true);
        assert_ne!(caps["mcpCapabilities"]["sse"], true);
        // No terminal auth method for a client that cannot run one.
        assert_eq!(w["authMethods"], json!([]));

        let future: InitializeRequest = serde_json::from_value(json!({
            "protocolVersion": 9,
            "clientCapabilities": {"auth":{"terminal":true}},
        }))
        .unwrap();
        let w = serde_json::to_value(initialize_response(&future)).unwrap();
        assert_eq!(w["protocolVersion"], 1, "answers with the version it speaks");
        assert_eq!(w["authMethods"][0]["type"], "terminal");
        assert_eq!(w["authMethods"][0]["args"], json!([LOGIN_ARG]));
    }

    #[test]
    fn prompt_blocks_become_engine_content() {
        let text = prompt_content(vec![ContentBlock::from("hi".to_string())]).unwrap();
        assert_eq!(text, json!("hi"));
        let blocks: Vec<ContentBlock> = serde_json::from_value(json!([
            {"type":"text","text":"look"},
            {"type":"image","mimeType":"image/png","data":"AAAA"},
        ]))
        .unwrap();
        let parts = prompt_content(blocks).unwrap();
        assert_eq!(parts[1]["image_url"]["url"], "data:image/png;base64,AAAA");
        let linked: Vec<ContentBlock> = serde_json::from_value(json!([
            {"type":"text","text":"see"},
            {"type":"resource","resource":{"uri":"file:///a.rs","text":"fn main(){}"}},
        ]))
        .unwrap();
        let joined = prompt_content(linked).unwrap();
        assert!(joined.as_str().unwrap().contains("<context uri=\"file:///a.rs\">"));
        assert!(prompt_content(vec![ContentBlock::from(" ".to_string())]).is_err());
    }

    #[test]
    fn replay_redraws_turns_and_tool_calls() {
        let history = vec![
            json!({"role":"user","content":"fix it"}),
            json!({"role":"assistant","content":"","tool_calls":[{"id":"c1","type":"function",
                "function":{"name":"read","arguments":"{\"path\":\"a.rs\"}"}}]}),
            json!({"role":"tool","tool_call_id":"c1","content":"fn a(){}"}),
            json!({"role":"assistant","content":"done"}),
        ];
        let tags: Vec<Value> = replay(&history, Path::new("/work"))
            .iter()
            .map(|u| serde_json::to_value(u).unwrap())
            .collect();
        let names: Vec<&str> = tags.iter().map(|t| t["sessionUpdate"].as_str().unwrap()).collect();
        assert_eq!(names, ["user_message_chunk", "tool_call", "tool_call_update", "agent_message_chunk"]);
        assert_eq!(tags[1]["locations"][0]["path"], "/work/a.rs");
        assert_eq!(tags[1]["status"], "completed");
    }

    #[test]
    fn an_allow_option_is_the_only_way_to_allow() {
        assert_eq!(decision_for(ALLOW_ONCE), PermissionDecision::AllowOnce);
        assert_eq!(decision_for(ALLOW_ALWAYS), PermissionDecision::AllowAlways);
        assert_eq!(decision_for(REJECT_ONCE), PermissionDecision::Deny);
        assert_eq!(decision_for("anything"), PermissionDecision::Deny);
    }

    #[test]
    fn a_client_stdio_mcp_server_maps_to_the_stored_config_shape() {
        let servers: Vec<McpServer> = serde_json::from_value(json!([
            {"name":"fs","command":"/bin/fs-mcp","args":["--stdio"],"env":[{"name":"K","value":"v"}]},
            {"type":"http","name":"web","url":"https://x","headers":[]},
        ]))
        .unwrap();
        let mapped: Vec<_> = servers.into_iter().filter_map(client_mcp_config).collect();
        assert_eq!(mapped.len(), 1, "an unadvertised transport is skipped");
        let (name, config) = &mapped[0];
        assert_eq!(name, "fs");
        assert_eq!(config, &json!({"command":"/bin/fs-mcp","args":["--stdio"],"env":{"K":"v"}}));
        let parsed = crate::core::mcp::models::extract_command_args(config).expect("connectable");
        assert_eq!(parsed.command, "/bin/fs-mcp");
    }

    #[test]
    fn the_stop_reason_comes_from_done_alone() {
        assert_eq!(stop_reason(Some("stop")), StopReason::EndTurn);
        assert_eq!(stop_reason(Some("tool_calls")), StopReason::EndTurn);
        assert_eq!(stop_reason(Some("length")), StopReason::MaxTokens);
        assert_eq!(stop_reason(Some("content_filter")), StopReason::Refusal);
        assert_eq!(stop_reason(Some("budget_exceeded")), StopReason::MaxTurnRequests);
        assert_eq!(stop_reason(None), StopReason::EndTurn);
    }

    #[test]
    fn a_subagent_prompt_is_not_pinned_to_a_parent_call() {
        let mut map = map();
        map.map(StreamEvent::ToolCall { id: "parent".into(), name: "bash".into(), args: json!({"command":"make"}) });
        let out = map.map(StreamEvent::Subagent {
            run_id: "r".into(),
            name: "scout".into(),
            event: Box::new(StreamEvent::PermissionRequest {
                request_id: "perm-9".into(),
                tool_name: "bash".into(),
                capability: "exec".into(),
                path: None,
                command: Some("rm -rf build".into()),
                diff: None,
                prompt_kind: "exec".into(),
                offers_always: false,
            }),
        });
        let w = wire(&out[0]);
        assert_eq!(w["toolCall"]["toolCallId"], "perm-9", "{w}");
        assert_eq!(w["toolCall"]["title"], "bash: rm -rf build");
        assert!(!map.calls["parent"].prompted, "the parent's card is left for its own prompt");
    }

    #[test]
    fn a_cancelled_turn_folds_its_work_into_a_well_formed_history() {
        let mut map = map();
        map.map(StreamEvent::ToolCall { id: "c1".into(), name: "read".into(), args: json!({"path":"a"}) });
        map.map(StreamEvent::ToolResult { id: "c1".into(), content: "A".into(), is_error: false, diff: None });
        map.map(StreamEvent::ToolCall { id: "c2".into(), name: "bash".into(), args: json!({"command":"sleep 9"}) });
        map.map(StreamEvent::Token { text: "partial".into() });
        let mut history = vec![json!({"role":"user","content":"go"})];
        map.settle_interrupted(&mut history);
        let roles: Vec<&str> = history.iter().map(|m| m["role"].as_str().unwrap()).collect();
        assert_eq!(roles, ["user", "assistant", "tool", "tool", "assistant"]);
        assert_eq!(history[2]["content"], "A");
        assert_eq!(history[3]["content"], super::super::MISSING_TOOL_RESULT, "in flight: placeholder");
        assert_eq!(history[4]["content"], "partial");
    }

    #[test]
    fn a_cancelled_turn_that_produced_nothing_is_taken_back() {
        let mut history = vec![
            json!({"role":"user","content":"earlier"}),
            json!({"role":"assistant","content":"ok"}),
            json!({"role":"user","content":"hang"}),
        ];
        map().settle_interrupted(&mut history);
        assert_eq!(history.len(), 2, "no dangling user turn: {history:?}");
    }
}
