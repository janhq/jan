//! Session-scoped JSON-RPC over LF-delimited stdio. Stdout contains only protocol records.
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::sync::Arc;

use serde_json::{json, Value};
use tokio::sync::mpsc::{self, OwnedPermit};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use super::providers::ProviderOverrides;
use super::rpc_schema::{
    InitializeParams, PermissionOwner, PermissionResponseParams, SessionIdParams,
    SessionModelSetParams, SessionStartParams, SessionToolsSetParams, ToolRespondParams,
    ToolResultContent, TurnStartParams, TurnSteerParams,
};
use super::stream_input::{parse_input_line, MAX_LINE_BYTES};
use super::{agent_dir_for, cli_save_thread, prepare_agent_session, AgentSession, SessionFlags};
use crate::core::agent::events::{StreamEvent, PROTOCOL_VERSION};
use crate::core::agent::host_tools::{HostToolDecl, HostToolResult, HostToolSet};
use crate::core::agent::r#loop::{run_orchestration_steered, SteeringRequest};

const OUTPUT_CAPACITY: usize = 1025; // 1024 ordinary records and one reserved terminal outcome.
const INPUT_CAPACITY: usize = 64;

struct Session {
    agent: AgentSession,
    history: Vec<Value>,
    id: String,
    turns: u32,
    ephemeral: bool,
    /// `false` restricts every turn to the host tools, through the same
    /// per-request `allowed_tools` allowlist an API caller uses.
    builtins: bool,
}

struct ActiveTurn {
    session_id: String,
    turn_id: String,
    events: mpsc::Receiver<TurnMessage>,
    runner: JoinHandle<()>,
    steerer: JoinHandle<()>,
    pending: Arc<Mutex<Vec<Value>>>,
    updated_history: Option<Vec<Value>>,
    /// The slot the terminal record is written through, held for the whole
    /// turn. Reserving it up front is what makes "the outcome always arrives"
    /// a property of the channel rather than a convention every other writer
    /// has to keep: `capacity()` counts it as taken, so no notification, reply
    /// or event can be queued in its place.
    terminal: OwnedPermit<Value>,
}

enum TurnMessage {
    Event(StreamEvent),
    Finished(Result<Value, String>),
}

fn response(id: &Value, result: Value) -> Value {
    json!({"jsonrpc":"2.0","id":id,"result":result})
}

fn error(id: &Value, code: i32, message: &str) -> Value {
    let data = if code == -32001 { json!({"retryable":true}) } else { Value::Null };
    error_data(id, code, message, data)
}

fn error_data(id: &Value, code: i32, message: &str, data: Value) -> Value {
    json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message,"data":data}})
}

/// A verb that would change what the running turn reads (its tools, model or
/// history) is refused rather than applied mid-turn: the turn has already
/// built its request from the old state, so the change would take effect at
/// an arbitrary point in it.
fn turn_active(id: &Value) -> Value {
    error_data(
        id,
        -32001,
        "this session has an active turn; retry after turn/completed",
        json!({"retryable":true,"kind":"turn_active"}),
    )
}

fn invalid_tools(id: &Value, message: &str) -> Value {
    error_data(id, -32602, message, json!({"kind":"invalid_tools"}))
}

const UNKNOWN_SESSION: &str = "unknown sessionId";

/// Parse and declare a host tool set. Entries arrive as raw values so a bad
/// one is reported with its index and reason under `invalid_tools`, not as a
/// generic params error.
fn declare_tools(entries: Vec<Value>) -> Result<HostToolSet, String> {
    let decls = entries
        .into_iter()
        .enumerate()
        .map(|(index, entry)| {
            serde_json::from_value::<HostToolDecl>(entry).map_err(|e| format!("tools[{index}]: {e}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    HostToolSet::declare(decls).map_err(|e| e.to_string())
}

fn host_names(set: &HostToolSet) -> Vec<String> {
    set.all().iter().map(|tool| tool.qualified_name.clone()).collect()
}

/// What the session's next turn advertises, and the host schemas among it.
/// Filtered to the advertised set the way the stream-json `init` record is:
/// a host tool withheld by a deny list or Plan mode is not echoed, so the
/// host can see the suppression instead of waiting for a call.
async fn tools_view(session: &Session) -> Value {
    let args = &session.agent.args;
    let advertised = crate::core::agent::r#loop::context_advertised_tools(
        &args.mcp_servers,
        &args.mcp_settings,
        &args.permissions,
        args.project_root.as_deref(),
        args.run_mode,
        args.subagents_enabled,
        args.max_parallel_subagents,
        args.ask_requests.is_some(),
        args.todo_registry.is_some(),
        &args.host_tools,
    )
    .await;
    let mut tools: Vec<String> = advertised
        .iter()
        .filter_map(|tool| tool["function"]["name"].as_str().map(str::to_owned))
        .collect();
    if !session.builtins {
        tools.retain(|name| args.host_tools.is_host_tool(name));
    }
    let specs: Vec<Value> = args
        .host_tools
        .schemas()
        .into_iter()
        .filter(|spec| {
            spec["function"]["name"]
                .as_str()
                .is_some_and(|name| tools.iter().any(|t| t == name))
        })
        .collect();
    json!({"tools":tools,"toolSpecs":specs})
}

/// Validate a content-part tool result with the same checks the stream-json
/// `tool_result` uses, returning its text summary.
fn check_result_parts(parts: &[Value]) -> Result<String, String> {
    super::stream_input::check_content_parts(parts, "tool_result")?;
    Ok(super::stream_input::summarize_parts(parts))
}

fn host_result(params: ToolRespondParams) -> Result<(String, HostToolResult), String> {
    let ToolRespondParams { request_id, content, is_error, details } = params;
    let (content, parts) = match content {
        ToolResultContent::Text(text) => (text, None),
        ToolResultContent::Parts(parts) => (check_result_parts(&parts)?, Some(parts)),
    };
    Ok((
        request_id,
        HostToolResult { content, parts, details: details.map(Value::Object), is_error },
    ))
}

/// Release every host request the turn still holds and tell the client which
/// ones it must no longer answer, before the turn's terminal record.
///
/// `client_gone` (stdin closed) is best effort: the client may have stopped
/// reading too, and waiting on it would keep the process alive forever. An
/// interrupt comes from a client that is reading, so its records are owed.
async fn release_host_requests(
    session: Option<&Session>,
    turn: &ActiveTurn,
    reason: &str,
    out: &mpsc::Sender<Value>,
) -> Result<(), String> {
    let Some(session) = session else { return Ok(()) };
    let registry = &session.agent.args.host_tool_requests;
    let released = if reason == "client_gone" {
        crate::core::agent::host_tools::strand_all(registry).await
    } else {
        crate::core::agent::host_tools::cancel_all(registry).await
    };
    for request_id in released {
        let event = StreamEvent::ToolRequestCancelled { request_id, reason: reason.to_owned() };
        let wire = serde_json::to_value(&event).map_err(|e| e.to_string())?;
        let params = json!({"sessionId":turn.session_id,"turnId":turn.turn_id,"event":wire});
        if reason == "client_gone" {
            let _ = notify(out, "item/tool_request_cancelled", params);
        } else {
            send_reply(out, json!({"jsonrpc":"2.0","method":"item/tool_request_cancelled","params":params})).await?;
        }
    }
    Ok(())
}

fn send(out: &mpsc::Sender<Value>, record: Value) -> Result<(), String> {
    out.try_send(record)
        .map_err(|_| "RPC output queue is full or closed".to_owned())
}

fn notify(out: &mpsc::Sender<Value>, method: &str, params: Value) -> Result<(), String> {
    send(
        out,
        json!({"jsonrpc":"2.0","method":method,"params":params}),
    )
}

/// A record a client is owed an answer with: it waits for room instead of
/// taking the slot the turn's terminal record reserved, and instead of turning
/// a client that stopped reading into a process that died holding the answer.
async fn send_reply(out: &mpsc::Sender<Value>, record: Value) -> Result<(), String> {
    out.send(record)
        .await
        .map_err(|_| "RPC client closed stdout".to_owned())
}

fn read_line(reader: &mut impl BufRead) -> std::io::Result<Option<(Vec<u8>, bool)>> {
    let mut line = Vec::new();
    let mut too_long = false;
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Ok((!line.is_empty()).then_some((line, too_long)));
        }
        let n = available
            .iter()
            .position(|byte| *byte == b'\n')
            .map_or(available.len(), |index| index + 1);
        if !too_long {
            let available_bytes = MAX_LINE_BYTES.saturating_sub(line.len());
            line.extend_from_slice(&available[..n.min(available_bytes)]);
            too_long = n > available_bytes;
        }
        let done = available[n - 1] == b'\n';
        reader.consume(n);
        if done {
            return Ok(Some((line, too_long)));
        }
    }
}

fn input_lines() -> mpsc::Receiver<(Vec<u8>, bool)> {
    let (tx, rx) = mpsc::channel(INPUT_CAPACITY);
    std::thread::spawn(move || {
        let mut stdin = std::io::stdin().lock();
        while let Ok(Some(line)) = read_line(&mut stdin) {
            if tx.blocking_send(line).is_err() {
                break;
            }
        }
    });
    rx
}

fn output_lines(mut rx: mpsc::Receiver<Value>) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let stdout = std::io::stdout();
        let mut writer = stdout.lock();
        while let Some(value) = rx.blocking_recv() {
            if serde_json::to_writer(&mut writer, &value).is_err()
                || writer.write_all(b"\n").is_err()
                || writer.flush().is_err()
            {
                break;
            }
        }
    })
}

async fn forward_events(
    source: &mut mpsc::UnboundedReceiver<StreamEvent>,
    events: &mpsc::Sender<TurnMessage>,
) -> Result<(), String> {
    while let Some(event) = source.recv().await {
        events
            .try_send(TurnMessage::Event(event))
            .map_err(|_| "RPC event queue overloaded or closed".to_owned())?;
    }
    Ok(())
}

fn start_turn(
    session: &mut Session,
    input: Value,
    out: &Arc<mpsc::Sender<Value>>,
) -> Result<ActiveTurn, String> {
    // Before the turn is accepted, not after: a queue with no room for the
    // terminal record is a queue this turn cannot report on, and accepting it
    // anyway is how a client that stopped reading loses the one record that
    // says the turn ended.
    let terminal = mpsc::Sender::clone(out)
        .try_reserve_owned()
        .map_err(|_| "RPC output queue is full; retry after draining notifications".to_owned())?;
    session.history.push(json!({"role":"user","content":input}));
    let mut body = session.agent.body(json!(session.history));
    if !session.builtins {
        body["allowed_tools"] = json!(host_names(&session.agent.args.host_tools));
    }
    let args = session.agent.args.clone();
    let (events, receiver) = mpsc::channel(64);
    let (steering_tx, mut steering_rx) = mpsc::unbounded_channel::<SteeringRequest>();
    let pending = Arc::new(Mutex::new(Vec::<Value>::new()));
    let queued = Arc::clone(&pending);
    let steerer = tokio::spawn(async move {
        while let Some(request) = steering_rx.recv().await {
            let messages = std::mem::take(&mut *queued.lock().await);
            let _ = request.reply.send(messages);
        }
    });
    let runner = tokio::spawn(async move {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut result = {
            let engine = run_orchestration_steered(&tx, &body, &args, Some(&steering_tx));
            tokio::pin!(engine);
            loop {
                tokio::select! {
                    run = &mut engine => break run,
                    event = rx.recv() => {
                        match event {
                            Some(event) => {
                                if events.try_send(TurnMessage::Event(event)).is_err() {
                                    break Err("RPC event queue overloaded or closed".to_owned());
                                }
                            }
                            None => break Err("RPC event stream closed".to_owned()),
                        }
                    }
                }
            }
        };
        // The run is complete, so stop producing events and drain only what
        // the engine already emitted. A full bounded queue is an overload,
        // not permission to buffer the remaining deltas without a bound.
        drop(tx);
        if let Err(message) = forward_events(&mut rx, &events).await {
            result = Err(message);
        }
        let _ = events.send(TurnMessage::Finished(result)).await;
    });
    Ok(ActiveTurn {
        session_id: session.id.clone(),
        turn_id: uuid::Uuid::new_v4().to_string(),
        events: receiver,
        runner,
        steerer,
        pending,
        updated_history: None,
        terminal,
    })
}

/// A new agent for `source`'s project, on `model` or the one it has, carrying
/// its host tools and gate. History and registry are the caller's to decide.
fn rebuild_agent(source: &Session, model: Option<String>) -> Result<AgentSession, String> {
    let project = source
        .agent
        .args
        .project_root
        .as_deref()
        .ok_or_else(|| "session has no project root".to_owned())?;
    let mut agent = prepare_agent_session(
        &project.to_string_lossy(),
        Some(model.unwrap_or_else(|| source.agent.model.clone())),
        ProviderOverrides::default(),
        SessionFlags { require_model: true, ..Default::default() },
        None,
    )?;
    agent.args.host_tools = source.agent.args.host_tools.clone();
    agent.args.host_owns_gate = source.agent.args.host_owns_gate;
    Ok(agent)
}

fn finish_turn(
    sessions: &mut HashMap<String, Session>,
    turn: ActiveTurn,
    result: Result<Value, String>,
    interrupted: bool,
) -> Result<(), String> {
    let ActiveTurn {
        session_id,
        turn_id,
        steerer,
        updated_history,
        terminal,
        ..
    } = turn;
    steerer.abort();
    let session = sessions
        .get_mut(&session_id)
        .ok_or("active session missing")?;
    if let Some(history) = updated_history {
        session.history = history;
    }
    let stop_reason = if interrupted {
        "interrupted"
    } else if result.is_ok() {
        "completed"
    } else {
        "error"
    };
    let mut error_message = if interrupted {
        None
    } else {
        result.as_ref().err().cloned()
    };
    if let Ok(completion) = &result {
        if let Some(text) = super::completion_text(completion) {
            session
                .history
                .push(json!({"role":"assistant","content":text}));
        }
        if !session.ephemeral {
            if let Some(project) = session.agent.args.project_root.as_ref() {
                if let Err(message) = cli_save_thread(
                    &agent_dir_for(project),
                    Some(&session.id),
                    &session.agent.model,
                    &session.history,
                    None,
                ) {
                    error_message = Some(format!("could not save session: {message}"));
                }
            }
        }
    }
    session.turns += 1;
    // Through the slot the turn reserved, so this cannot be the record that
    // fails to fit: a client that stopped reading gets the outcome when it
    // starts again instead of a process that died holding it.
    terminal.send(json!({
        "jsonrpc":"2.0","method":"turn/completed",
        "params": {
            "sessionId":session_id,"turnId":turn_id,
            "stopReason":if error_message.is_some() { "error" } else { stop_reason },"error":error_message
        }
    }));
    Ok(())
}

/// One runtime owns many addressable sessions. All writes share one bounded output queue.
pub async fn serve() -> Result<(), String> {
    let mut input = input_lines();
    let (out, writer) = mpsc::channel(OUTPUT_CAPACITY);
    let out = Arc::new(out);
    let writer = output_lines(writer);
    let mut initialized = false;
    let mut negotiated = false;
    let mut sessions = HashMap::<String, Session>::new();
    let mut active: Option<ActiveTurn> = None;
    loop {
        tokio::select! {
            message = input.recv() => {
                let Some((line, too_long)) = message else { break; };
                if too_long {
                    send_reply(&out, error(&Value::Null, -32600, "Input line exceeds max_line_bytes")).await?;
                    continue;
                }
                let request: Value = match serde_json::from_slice(&line) {
                    Ok(value) => value,
                    Err(_) => { send_reply(&out, error(&Value::Null, -32700, "Parse error")).await?; continue; }
                };
                let has_id = request.get("id").is_some();
                let id = request.get("id").cloned().unwrap_or(Value::Null);
                let method = request.get("method").and_then(Value::as_str).unwrap_or("");
                let params = &request["params"];
                if request["jsonrpc"] != "2.0" || method.is_empty() {
                    send_reply(&out, error(&id, -32600, "Invalid Request")).await?;
                    continue;
                }
                if method == "initialize" {
                    // A new handshake replaces the previous one; a failed
                    // negotiation cannot authorize `initialized` or methods.
                    negotiated = false;
                    initialized = false;
                    let reply = match serde_json::from_value::<InitializeParams>(params.clone()) {
                        Ok(init) if init.protocol_version == PROTOCOL_VERSION && !init.client_info.name.is_empty() && !init.client_info.version.is_empty() => {
                            negotiated = true;
                            response(&id, json!({"protocolVersion":PROTOCOL_VERSION,"serverInfo":{"name":"jan","version":env!("CARGO_PKG_VERSION")},"capabilities":{"session":true,"turn":true}}))
                        }
                        _ => error(&id, -32602, "Unsupported protocol version or malformed clientInfo"),
                    };
                    send_reply(&out, reply).await?;
                    continue;
                }
                if method == "initialized" && negotiated && !has_id {
                    initialized = true;
                    continue;
                }
                if !initialized {
                    send_reply(&out, error(&id, -32002, "Server not initialized")).await?;
                    continue;
                }
                let reply = match method {
                    "session/start" => {
                        match serde_json::from_value::<SessionStartParams>(params.clone()) {
                            Err(_) => error(&id, -32602, "session/start requires cwd and supported options"),
                            Ok(start) if !std::path::Path::new(&start.cwd).is_dir() => error(&id, -32602, "cwd is not a directory"),
                            // Declared before the session is built: a tool set the
                            // host got wrong is refused before anything is spent.
                            Ok(start) => match declare_tools(start.tools) {
                                Err(message) => invalid_tools(&id, &message),
                                Ok(host_tools) => match prepare_agent_session(&start.cwd, start.model, ProviderOverrides::default(), SessionFlags { require_model: true, ..Default::default() }, None) {
                                    Ok(mut agent) => {
                                        agent.args.host_tools = host_tools;
                                        agent.args.host_owns_gate = start.permissions == PermissionOwner::Host;
                                        let sid = uuid::Uuid::new_v4().to_string();
                                        let session = Session { agent, history: Vec::new(), id: sid.clone(), turns: 0, ephemeral: start.ephemeral, builtins: start.builtins };
                                        let mut result = tools_view(&session).await;
                                        result["sessionId"] = json!(sid);
                                        result["model"] = json!(session.agent.model);
                                        sessions.insert(sid.clone(), session);
                                        response(&id, result)
                                    }
                                    Err(message) => error(&id, -32602, &message),
                                },
                            },
                        }
                    }
                    "session/tools/get" => match serde_json::from_value::<SessionIdParams>(params.clone()) {
                        Err(_) => error(&id, -32602, "session/tools/get requires sessionId"),
                        Ok(SessionIdParams { session_id: sid }) => match sessions.get(&sid) {
                            Some(session) => response(&id, tools_view(session).await),
                            None => error(&id, -32602, UNKNOWN_SESSION),
                        },
                    },
                    "session/tools/set" => match serde_json::from_value::<SessionToolsSetParams>(params.clone()) {
                        Err(_) => error(&id, -32602, "session/tools/set requires sessionId and tools"),
                        Ok(set) if !sessions.contains_key(&set.session_id) => error(&id, -32602, UNKNOWN_SESSION),
                        Ok(set) if active.as_ref().is_some_and(|t| t.session_id == set.session_id) => turn_active(&id),
                        Ok(set) => match declare_tools(set.tools) {
                            Err(message) => invalid_tools(&id, &message),
                            Ok(host_tools) => {
                                let session = sessions.get_mut(&set.session_id).expect("checked");
                                session.agent.args.host_tools = host_tools;
                                response(&id, tools_view(session).await)
                            }
                        },
                    },
                    "session/model/set" => match serde_json::from_value::<SessionModelSetParams>(params.clone()) {
                        Err(_) => error(&id, -32602, "session/model/set requires sessionId and model"),
                        Ok(set) if !sessions.contains_key(&set.session_id) => error(&id, -32602, UNKNOWN_SESSION),
                        Ok(set) if active.as_ref().is_some_and(|t| t.session_id == set.session_id) => turn_active(&id),
                        Ok(set) if set.model.trim().is_empty() => error(&id, -32602, "model must not be empty"),
                        Ok(set) => {
                            // Refuse a model no configured provider serves. The
                            // turn would fail closed on it too -- nothing goes
                            // out on the session's behalf -- but this is the
                            // point at which a client can still be told, and the
                            // session must not be left pinned to a model that
                            // cannot serve it, which the next turn would report
                            // as a failure of the client's own input.
                            let provider_configs = sessions
                                .get(&set.session_id)
                                .expect("checked")
                                .agent
                                .args
                                .provider_configs
                                .clone();
                            match crate::core::agent::upstream::resolve_upstream_for_model(
                                &set.model,
                                provider_configs,
                            )
                            .await
                            {
                                Err(message) => error(&id, -32602, &message),
                                Ok(_) => {
                                    let session = sessions.get_mut(&set.session_id).expect("checked");
                                    match rebuild_agent(session, Some(set.model)) {
                                        Ok(agent) => {
                                            // The same registry: nothing is pending between
                                            // turns, and keeping it keeps one per session.
                                            let registry = Arc::clone(&session.agent.args.host_tool_requests);
                                            session.agent = agent;
                                            session.agent.args.host_tool_requests = registry;
                                            response(&id, json!({"model":session.agent.model}))
                                        }
                                        Err(message) => error(&id, -32602, &message),
                                    }
                                }
                            }
                        }
                    },
                    "session/reset" => match serde_json::from_value::<SessionIdParams>(params.clone()) {
                        Err(_) => error(&id, -32602, "session/reset requires sessionId"),
                        Ok(SessionIdParams { session_id: sid }) if !sessions.contains_key(&sid) => error(&id, -32602, UNKNOWN_SESSION),
                        Ok(SessionIdParams { session_id: sid }) if active.as_ref().is_some_and(|t| t.session_id == sid) => turn_active(&id),
                        Ok(SessionIdParams { session_id: sid }) => {
                            let session = sessions.get_mut(&sid).expect("checked");
                            session.history.clear();
                            response(&id, tools_view(session).await)
                        }
                    },
                    "tool/respond" => match serde_json::from_value::<ToolRespondParams>(params.clone()) {
                        Err(_) => error(&id, -32602, "tool/respond requires requestId and content (a string or content parts)"),
                        Ok(respond) => match host_result(respond) {
                            Err(message) => error(&id, -32602, &message),
                            Ok((request_id, result)) => {
                                // Only the active turn can be waiting on a host: a
                                // reply with no turn running is as late as one for a
                                // request that was already answered.
                                let registry = active
                                    .as_ref()
                                    .and_then(|turn| sessions.get(&turn.session_id))
                                    .map(|session| Arc::clone(&session.agent.args.host_tool_requests));
                                let answered = match registry {
                                    Some(registry) => crate::core::agent::host_tools::respond(&registry, &request_id, Ok(result)).await,
                                    None => Err(format!("no host tool request '{request_id}' is pending (answered, cancelled, or never issued)")),
                                };
                                match answered {
                                    Ok(()) => response(&id, json!({})),
                                    Err(message) => error_data(&id, -32602, &message, json!({"kind":"not_pending"})),
                                }
                            }
                        },
                    },
                    // Takes no params, so the only shape it accepts is none: an
                    // object, or the omitted-params `null` JSON-RPC allows.
                    // As a list request it is also the one method where a
                    // scalar in place of params is a client bug worth naming.
                    "session/list" => match params {
                        Value::Object(_) | Value::Null => response(&id, json!({"sessions":sessions.values().map(|s| json!({"id":s.id,"model":s.agent.model,"turns":s.turns,"hostTools":s.agent.args.host_tools.len()})).collect::<Vec<_>>()})),
                        _ => error(&id, -32602, "session/list takes no params"),
                    },
                    "session/resume" => match serde_json::from_value::<SessionIdParams>(params.clone()) {
                        Err(_) => error(&id, -32602, "session/resume requires sessionId"),
                        Ok(SessionIdParams { session_id: sid }) => match sessions.get(&sid) {
                            Some(session) => response(&id, json!({"sessionId":sid,"model":session.agent.model,"turns":session.turns})),
                            None => error(&id, -32602, "unknown sessionId (RPC sessions belong to their process)"),
                        },
                    },
                    "session/fork" => match serde_json::from_value::<SessionIdParams>(params.clone()) {
                        Err(_) => error(&id, -32602, "unknown sessionId"),
                        Ok(SessionIdParams { session_id: sid }) if active.as_ref().is_some_and(|t| t.session_id == sid) => {
                            error(&id, -32001, "session busy")
                        }
                        Ok(SessionIdParams { session_id: sid }) if sessions.contains_key(&sid) => {
                            let source = sessions.get(&sid).expect("checked");
                            // A fresh registry (from the rebuild): the fork is its
                            // own session, and a reply must never cross into it.
                            match rebuild_agent(source, None) {
                                Ok(agent) => {
                                    let fork = uuid::Uuid::new_v4().to_string();
                                    let history = source.history.clone();
                                    let ephemeral = source.ephemeral;
                                    let builtins = source.builtins;
                                    sessions.insert(fork.clone(), Session { agent, history, id: fork.clone(), turns: 0, ephemeral, builtins });
                                    response(&id, json!({"sessionId":fork}))
                                }
                                Err(message) => error(&id, -32602, &message),
                            }
                        }
                        Ok(_) => error(&id, -32602, "unknown sessionId"),
                    },
                    "session/archive" => match serde_json::from_value::<SessionIdParams>(params.clone()) {
                        Err(_) => error(&id, -32602, "unknown sessionId"),
                        Ok(SessionIdParams { session_id: sid }) if active.as_ref().is_some_and(|t| t.session_id == sid) => {
                            error(&id, -32001, "session busy")
                        }
                        Ok(SessionIdParams { session_id: sid }) if sessions.remove(&sid).is_some() => response(&id, json!({})),
                        Ok(_) => error(&id, -32602, "unknown sessionId"),
                    },
                    "turn/start" => {
                        if active.is_some() {
                            error(&id, -32001, "another turn is active; retry after turn/completed")
                        } else {
                            match serde_json::from_value::<TurnStartParams>(params.clone()) {
                                Err(_) => error(&id, -32602, "turn/start requires sessionId and input"),
                                Ok(TurnStartParams { session_id, input }) => {
                                    let parsed = json!({"type":"user","content":input});
                                    let content = if let Some(text) = input.as_str() {
                                        parse_input_line(&json!({"type":"user","text":text}).to_string()).map(|_| Value::String(text.to_owned()))
                                    } else if input.is_array() {
                                        parse_input_line(&parsed.to_string()).map(|_| input)
                                    } else { Err("input must be text or content parts".to_string()) };
                                    match (sessions.get_mut(&session_id), content) {
                                        (Some(session), Ok(content)) => {
                                            match start_turn(session, content, &out) {
                                                Ok(turn) => {
                                                    let tid = turn.turn_id.clone();
                                                    active = Some(turn);
                                                    response(&id, json!({"turnId":tid}))
                                                }
                                                // The turn would have no room to report its
                                                // outcome on, so it is refused while the
                                                // client drains what is already queued.
                                                Err(message) => error(&id, -32001, &message),
                                            }
                                        }
                                        (None, _) => error(&id, -32602, "unknown sessionId"),
                                        (_, Err(message)) => error(&id, -32602, &message),
                                    }
                                }
                            }
                        }
                    }
                    "turn/steer" => match serde_json::from_value::<TurnSteerParams>(params.clone()) {
                        Err(_) => error(&id, -32602, "turn/steer requires an active session and nonempty input"),
                        Ok(TurnSteerParams { session_id: sid, input: text }) => match active.as_ref() {
                            Some(turn) if turn.session_id == sid && !text.trim().is_empty() => {
                                turn.pending.lock().await.push(json!({"role":"user","content":text}));
                                response(&id, json!({}))
                            }
                            _ => error(&id, -32602, "turn/steer requires an active session and nonempty input"),
                        },
                    },
                    "turn/interrupt" => match (active.take(), serde_json::from_value::<SessionIdParams>(params.clone())) {
                        (Some(turn), Ok(SessionIdParams { session_id: sid })) if turn.session_id == sid => {
                            turn.runner.abort();
                            if let Some(session) = sessions.get_mut(&sid) {
                                session.agent.permission_requests.lock().await.clear();
                            }
                            release_host_requests(sessions.get(&sid), &turn, "interrupted", &out).await?;
                            finish_turn(&mut sessions, turn, Err("interrupted".to_owned()), true)?;
                            response(&id, json!({}))
                        }
                        (other, _) => {
                            active = other;
                            error(&id, -32602, "no active turn for sessionId")
                        }
                    },
                    "permission/respond" => match (active.as_ref(), serde_json::from_value::<PermissionResponseParams>(params.clone())) {
                        (Some(turn), Ok(PermissionResponseParams { request_id, decision })) => {
                            let decision = match decision.as_str() {
                                "allow_once" => Some(tauri_plugin_agent_tools::tools::gate::PermissionDecision::AllowOnce),
                                "allow_always" => Some(tauri_plugin_agent_tools::tools::gate::PermissionDecision::AllowAlways),
                                "deny" => Some(tauri_plugin_agent_tools::tools::gate::PermissionDecision::Deny),
                                _ => None,
                            };
                            if let Some(decision) = decision {
                                let session = sessions.get(&turn.session_id).expect("active session");
                                match session.agent.permission_requests.lock().await.remove(&request_id) {
                                    Some(sender) => { let _ = sender.send(decision); response(&id, json!({})) }
                                    None => error(&id, -32602, "no permission request is pending"),
                                }
                            } else { error(&id, -32602, "invalid permission decision") }
                        }
                        _ => error(&id, -32602, "permission/respond requires an active turn and requestId"),
                    },
                    _ => error(&id, -32601, "Method not found"),
                };
                if has_id { send_reply(&out, reply).await?; }
            }
            message = async { active.as_mut().expect("active").events.recv().await }, if active.is_some() => {
                let Some(message) = message else {
                    // The run's task is gone without an outcome: a panic in the
                    // engine, or an abort this loop did not make. The turn still
                    // owes the client a terminal record, and this arm would be
                    // ready with `None` on every pass until it got one.
                    let turn = active.take().expect("active");
                    finish_turn(&mut sessions, turn, Err("the run ended without an outcome".to_owned()), false)?;
                    continue;
                };
                let turn = active.as_mut().expect("active");
                match message {
                    TurnMessage::Event(event) => {
                        if let StreamEvent::MessagesUpdated { messages } = &event { turn.updated_history = Some(messages.clone()); }
                        let wire = serde_json::to_value(&event).map_err(|e| e.to_string())?;
                        let method = format!("item/{}", wire["type"].as_str().ok_or("event has no tag")?);
                        // The turn's terminal record has its own slot, so this
                        // bound only covers the streamed events: when the client
                        // is not reading them, the turn ends rather than
                        // accumulating unbounded model deltas.
                        if out.capacity() == 0 {
                            let turn = active.take().expect("active");
                            turn.runner.abort();
                            finish_turn(&mut sessions, turn, Err("RPC output queue overloaded".to_owned()), false)?;
                        } else {
                            notify(&out, &method, json!({"sessionId":turn.session_id,"turnId":turn.turn_id,"event":wire}))?;
                        }
                    }
                    TurnMessage::Finished(result) => {
                        let turn = active.take().expect("active");
                        finish_turn(&mut sessions, turn, result, false)?;
                    }
                }
            }
        }
    }
    if let Some(turn) = active {
        turn.runner.abort();
        release_host_requests(sessions.get(&turn.session_id), &turn, "client_gone", &out).await?;
        // stdin closing is not stdout closing: a client that asked the process
        // to end but keeps reading still gets the record that says its turn
        // ended, which is the one thing it cannot infer from the channel
        // closing. The turn was stopped by the client, so that is what the
        // record reports, and it goes out on the slot the turn reserved - the
        // writer below drains the queue before joining.
        finish_turn(&mut sessions, turn, Ok(Value::Null), true)?;
    }
    drop(out);
    writer
        .join()
        .map_err(|_| "RPC output writer panicked".to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::cli::stream_input::{MAX_IMAGES, MAX_IMAGE_BYTES};

    #[tokio::test]
    async fn event_forwarder_stops_receiving_when_its_bounded_queue_is_full() {
        let (upstream, mut source) = mpsc::unbounded_channel();
        let (downstream, _blocked) = mpsc::channel(1);
        downstream
            .send(TurnMessage::Event(StreamEvent::Parked))
            .await
            .unwrap();
        let forward = tokio::spawn(async move { forward_events(&mut source, &downstream).await });

        upstream.send(StreamEvent::Parked).unwrap();
        assert!(forward.await.unwrap().unwrap_err().contains("overloaded"));
        assert!(upstream.send(StreamEvent::Parked).is_err(), "events should stop at the bounded boundary");
    }

    fn image(decoded: usize) -> Value {
        let payload = "A".repeat(decoded.div_ceil(3) * 4);
        json!({"type":"image_url","image_url":{"url":format!("data:image/png;base64,{payload}")}})
    }

    fn respond_params(content: Value) -> ToolRespondParams {
        serde_json::from_value(json!({"requestId":"host-1","content":content})).expect("parses")
    }

    #[test]
    fn a_text_result_is_the_whole_answer() {
        let (id, result) = host_result(respond_params(json!("moved"))).unwrap();
        assert_eq!(id, "host-1");
        assert_eq!(result, HostToolResult { content: "moved".into(), parts: None, details: None, is_error: false });
    }

    /// Parts pass through verbatim; the text summary is what hooks and the
    /// `tool_result` event see.
    #[test]
    fn a_parts_result_keeps_its_parts_and_summarizes_its_text() {
        let parts = json!([{"type":"text","text":"a"},image(3),{"type":"text","text":"b"}]);
        let params: ToolRespondParams = serde_json::from_value(json!({
            "requestId":"host-1","content":parts,"isError":true,"details":{"k":1}
        })).unwrap();
        let (_, result) = host_result(params).unwrap();
        assert_eq!(result.content, "a\nb");
        assert_eq!(Value::Array(result.parts.unwrap()), parts);
        assert_eq!(result.details, Some(json!({"k":1})));
        assert!(result.is_error);
    }

    #[test]
    fn result_parts_are_held_to_the_user_message_caps() {
        // Unpadded base64 decodes in whole 3-byte groups, so the largest image
        // at the cap is its largest multiple of 3.
        let at_cap = MAX_IMAGE_BYTES / 3 * 3;
        assert!(check_result_parts(&[image(at_cap)]).is_ok());
        assert!(check_result_parts(&[image(at_cap + 3)]).unwrap_err().contains("byte cap"));
        assert!(check_result_parts(&vec![image(3); MAX_IMAGES + 1]).unwrap_err().contains("images"));
        assert!(check_result_parts(&vec![image(at_cap); 3]).unwrap_err().contains("total"));
        assert!(check_result_parts(&[]).is_err());
        assert!(check_result_parts(&[json!({"type":"text","text":" "})]).is_err());
        assert!(check_result_parts(&[json!({"type":"audio"})]).unwrap_err().contains("audio"));
        let bmp = json!({"type":"image_url","image_url":{"url":"data:image/bmp;base64,AA=="}});
        assert!(check_result_parts(&[bmp]).is_err());
    }

    #[test]
    fn content_that_is_neither_text_nor_parts_is_a_params_error() {
        assert!(serde_json::from_value::<ToolRespondParams>(json!({"requestId":"h","content":7})).is_err());
        assert!(serde_json::from_value::<ToolRespondParams>(json!({"requestId":"h"})).is_err());
    }

    #[test]
    fn a_declaration_error_names_the_entry_or_the_rule() {
        let set = declare_tools(vec![json!({"name":"camera","capability":"read"})]).unwrap();
        assert_eq!(host_names(&set), ["host__camera"]);
        assert!(declare_tools(vec![json!({"name":"bash"})]).unwrap_err().contains("reserved"));
        assert!(declare_tools(vec![json!({"name":"a"}), json!(3)]).unwrap_err().starts_with("tools[1]"));
        assert!(declare_tools(Vec::new()).unwrap().is_empty());
    }

    #[test]
    fn session_start_defaults_keep_today_s_behaviour() {
        let start: SessionStartParams = serde_json::from_value(json!({"cwd":"/"})).unwrap();
        assert!(start.tools.is_empty() && start.builtins);
        assert_eq!(start.permissions, PermissionOwner::Jan);
        let host: SessionStartParams = serde_json::from_value(json!({"cwd":"/","permissions":"host","builtins":false})).unwrap();
        assert_eq!(host.permissions, PermissionOwner::Host);
        assert!(!host.builtins);
        assert!(serde_json::from_value::<SessionStartParams>(json!({"cwd":"/","permissions":"nobody"})).is_err());
    }

    #[test]
    fn mutation_refusals_carry_their_kind() {
        let busy = turn_active(&json!(1));
        assert_eq!(busy["error"]["code"], -32001);
        assert_eq!(busy["error"]["data"], json!({"retryable":true,"kind":"turn_active"}));
        let bad = invalid_tools(&json!(1), "x");
        assert_eq!(bad["error"]["data"], json!({"kind":"invalid_tools"}));
        // The plain helper is unchanged: -32001 is retryable, others carry no data.
        assert_eq!(error(&json!(1), -32001, "m")["error"]["data"], json!({"retryable":true}));
        assert!(error(&json!(1), -32602, "m")["error"]["data"].is_null());
    }
}
