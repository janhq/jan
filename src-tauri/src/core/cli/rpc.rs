//! Session-scoped JSON-RPC over LF-delimited stdio. Stdout contains only protocol records.
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::sync::Arc;

use serde_json::{json, Value};
use tokio::sync::mpsc::{self, OwnedPermit};
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use super::providers::ProviderOverrides;
use super::rpc_schema::{InitializeParams, SessionStartParams};
use super::stream_input::{parse_input_line, MAX_LINE_BYTES};
use super::{agent_dir_for, cli_save_thread, prepare_agent_session, AgentSession, SessionFlags};
use crate::core::agent::events::{StreamEvent, PROTOCOL_VERSION};
use crate::core::agent::r#loop::{run_orchestration_steered, SteeringRequest};

const OUTPUT_CAPACITY: usize = 1025; // 1024 ordinary records and one reserved terminal outcome.
const INPUT_CAPACITY: usize = 64;

struct Session {
    agent: AgentSession,
    history: Vec<Value>,
    id: String,
    turns: u32,
    ephemeral: bool,
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
    let data = (code == -32001).then(|| json!({"retryable":true}));
    json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message,"data":data}})
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
    let body = session.agent.body(json!(session.history));
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
        let forward = tokio::spawn({
            let events = events.clone();
            async move {
                while let Some(event) = rx.recv().await {
                    if events.send(TurnMessage::Event(event)).await.is_err() {
                        break;
                    }
                }
            }
        });
        let result = run_orchestration_steered(&tx, &body, &args, Some(&steering_tx)).await;
        drop(tx);
        let _ = forward.await;
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
                let id = request.get("id").cloned().unwrap_or(Value::Null);
                let method = request.get("method").and_then(Value::as_str).unwrap_or("");
                let params = &request["params"];
                if request["jsonrpc"] != "2.0" || method.is_empty() {
                    send_reply(&out, error(&id, -32600, "Invalid Request")).await?;
                    continue;
                }
                if method == "initialize" {
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
                if method == "initialized" && negotiated && id.is_null() {
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
                            Ok(start) => match prepare_agent_session(&start.cwd, start.model, ProviderOverrides::default(), SessionFlags { require_model: true, ..Default::default() }, None) {
                                Ok(agent) => {
                                    let sid = uuid::Uuid::new_v4().to_string();
                                    sessions.insert(sid.clone(), Session { agent, history: Vec::new(), id: sid.clone(), turns: 0, ephemeral: start.ephemeral });
                                    response(&id, json!({"sessionId":sid}))
                                }
                                Err(message) => error(&id, -32602, &message),
                            },
                        }
                    }
                    "session/list" => response(&id, json!({"sessions":sessions.values().map(|s| json!({"id":s.id,"model":s.agent.model,"turns":s.turns})).collect::<Vec<_>>()})),
                    "session/resume" => match params["sessionId"].as_str() {
                        Some(sid) => match sessions.get(sid) {
                            Some(session) => response(&id, json!({"sessionId":sid,"model":session.agent.model,"turns":session.turns})),
                            None => error(&id, -32602, "unknown sessionId (RPC sessions belong to their process)"),
                        },
                        None => error(&id, -32602, "session/resume requires sessionId"),
                    },
                    "session/fork" => match params["sessionId"].as_str() {
                        Some(sid) if active.as_ref().is_some_and(|t| t.session_id == sid) => error(&id, -32001, "session busy"),
                        Some(sid) if sessions.contains_key(sid) => {
                            let source = sessions.get(sid).expect("checked");
                            let project = source.agent.args.project_root.as_deref().ok_or("session has no project root")?;
                            let agent = prepare_agent_session(&project.to_string_lossy(), Some(source.agent.model.clone()), ProviderOverrides::default(), SessionFlags { require_model: true, ..Default::default() }, None)?;
                            let fork = uuid::Uuid::new_v4().to_string();
                            let history = source.history.clone();
                            let ephemeral = source.ephemeral;
                            sessions.insert(fork.clone(), Session { agent, history, id: fork.clone(), turns: 0, ephemeral });
                            response(&id, json!({"sessionId":fork}))
                        }
                        _ => error(&id, -32602, "unknown sessionId"),
                    },
                    "session/archive" => match params["sessionId"].as_str() {
                        Some(sid) if active.as_ref().is_some_and(|t| t.session_id == sid) => error(&id, -32001, "session busy"),
                        Some(sid) if sessions.remove(sid).is_some() => response(&id, json!({})),
                        _ => error(&id, -32602, "unknown sessionId"),
                    },
                    "turn/start" => {
                        if active.is_some() {
                            error(&id, -32001, "another turn is active; retry after turn/completed")
                        } else if let (Some(sid), Some(input)) = (params["sessionId"].as_str(), params.get("input")) {
                            let parsed = json!({"type":"user","content":input});
                            let content = if let Some(text) = input.as_str() {
                                parse_input_line(&json!({"type":"user","text":text}).to_string()).map(|_| Value::String(text.to_owned()))
                            } else if input.is_array() {
                                parse_input_line(&parsed.to_string()).map(|_| input.clone())
                            } else { Err("input must be text or content parts".to_string()) };
                            match (sessions.get_mut(sid), content) {
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
                        } else { error(&id, -32602, "turn/start requires sessionId and input") }
                    }
                    "turn/steer" => match (active.as_ref(), params["sessionId"].as_str(), params["input"].as_str()) {
                        (Some(turn), Some(sid), Some(text)) if turn.session_id == sid && !text.trim().is_empty() => {
                            turn.pending.lock().await.push(json!({"role":"user","content":text}));
                            response(&id, json!({}))
                        }
                        _ => error(&id, -32602, "turn/steer requires an active session and nonempty input"),
                    },
                    "turn/interrupt" => match (active.take(), params["sessionId"].as_str()) {
                        (Some(turn), Some(sid)) if turn.session_id == sid => {
                            turn.runner.abort();
                            if let Some(session) = sessions.get_mut(sid) {
                                session.agent.permission_requests.lock().await.clear();
                            }
                            finish_turn(&mut sessions, turn, Err("interrupted".to_owned()), true)?;
                            response(&id, json!({}))
                        }
                        (other, _) => {
                            active = other;
                            error(&id, -32602, "no active turn for sessionId")
                        }
                    },
                    "permission/respond" => match (active.as_ref(), params["requestId"].as_str(), params["decision"].as_str()) {
                        (Some(turn), Some(request_id), Some(decision)) => {
                            let decision = match decision {
                                "allow_once" => Some(tauri_plugin_agent_tools::tools::gate::PermissionDecision::AllowOnce),
                                "allow_always" => Some(tauri_plugin_agent_tools::tools::gate::PermissionDecision::AllowAlways),
                                "deny" => Some(tauri_plugin_agent_tools::tools::gate::PermissionDecision::Deny),
                                _ => None,
                            };
                            if let Some(decision) = decision {
                                let session = sessions.get(&turn.session_id).expect("active session");
                                match session.agent.permission_requests.lock().await.remove(request_id) {
                                    Some(sender) => { let _ = sender.send(decision); response(&id, json!({})) }
                                    None => error(&id, -32602, "no permission request is pending"),
                                }
                            } else { error(&id, -32602, "invalid permission decision") }
                        }
                        _ => error(&id, -32602, "permission/respond requires an active turn and requestId"),
                    },
                    _ => error(&id, -32601, "Method not found"),
                };
                if !id.is_null() { send_reply(&out, reply).await?; }
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
        turn.steerer.abort();
    }
    drop(out);
    writer
        .join()
        .map_err(|_| "RPC output writer panicked".to_string())?;
    Ok(())
}
