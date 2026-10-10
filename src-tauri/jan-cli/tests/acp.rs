//! `jan acp` (experimental) through the real binary, driven the way an ACP
//! client drives it: LF-delimited JSON-RPC on stdin/stdout, against a stub
//! OpenAI-compatible provider on a loopback port.
//!
//! What is pinned here is what only the process boundary can show: the opt-in
//! gate, that stdout carries nothing but protocol frames (with debug logging
//! on), the `session/update` stream a prompt produces, a gate prompt answered
//! over `session/request_permission`, `session/load` replaying a saved thread
//! before it replies, and `session/cancel` ending a prompt as `cancelled`.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};

fn chunk(delta: Value, finish: Option<&str>) -> String {
    let record = json!({
        "id":"stub","object":"chat.completion.chunk","created":1,"model":"stub-model",
        "choices":[{"index":0,"delta":delta,"finish_reason":finish}],
        "usage": finish.map(|_| json!({"prompt_tokens":5,"completion_tokens":2,"total_tokens":7})),
    });
    format!("data: {record}\n\n")
}

fn prose(text: &str) -> String {
    let mut out = chunk(json!({"role":"assistant","content":text}), None);
    out.push_str(&chunk(json!({}), Some("stop")));
    out.push_str("data: [DONE]\n\n");
    out
}

/// The model writes `note.txt`: a call the default gate prompts for.
fn write_call() -> String {
    let args = json!({"path":"note.txt","content":"hello"}).to_string();
    let mut out = chunk(
        json!({"role":"assistant","tool_calls":[{"index":0,"id":"call-1","type":"function",
            "function":{"name":"write","arguments":args}}]}),
        None,
    );
    out.push_str(&chunk(json!({}), Some("tool_calls")));
    out.push_str("data: [DONE]\n\n");
    out
}

/// The model reads `a.txt`: a call the default gate allows without asking.
fn read_call() -> String {
    let args = json!({"path":"a.txt"}).to_string();
    let mut out = chunk(
        json!({"role":"assistant","tool_calls":[{"index":0,"id":"call-r","type":"function",
            "function":{"name":"read","arguments":args}}]}),
        None,
    );
    out.push_str(&chunk(json!({}), Some("tool_calls")));
    out.push_str("data: [DONE]\n\n");
    out
}

/// Serve `replies` in order, one per request, repeating the last. A `None`
/// reply holds the connection open without answering, so a prompt stays in
/// flight until it is cancelled.
fn stub_provider(replies: Vec<Option<String>>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind the stub provider");
    let addr = listener.local_addr().expect("stub address");
    let replies = Arc::new(replies);
    let nth = Arc::new(AtomicUsize::new(0));
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let replies = Arc::clone(&replies);
            let nth = Arc::clone(&nth);
            std::thread::spawn(move || {
                drain_request(&mut stream);
                let i = nth.fetch_add(1, Ordering::SeqCst);
                match &replies[i.min(replies.len() - 1)] {
                    Some(reply) => {
                        let response = format!(
                            "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
                            reply.len()
                        );
                        let _ = stream.write_all(response.as_bytes());
                        let _ = stream.flush();
                    }
                    None => std::thread::sleep(Duration::from_secs(60)),
                }
            });
        }
    });
    format!("http://{addr}/v1")
}

fn drain_request(stream: &mut TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let mut buf: Vec<u8> = Vec::new();
    let mut part = [0u8; 4096];
    loop {
        match stream.read(&mut part) {
            Ok(0) | Err(_) => return,
            Ok(n) => buf.extend_from_slice(&part[..n]),
        }
        let Some(head) = buf.windows(4).position(|w| w == b"\r\n\r\n") else {
            continue;
        };
        let headers = String::from_utf8_lossy(&buf[..head]).to_ascii_lowercase();
        let want = headers
            .lines()
            .find_map(|line| line.strip_prefix("content-length:"))
            .and_then(|v| v.trim().parse::<usize>().ok())
            .unwrap_or(0);
        if buf.len() >= head + 4 + want {
            return;
        }
    }
}

/// A private home, data folder and project per test, removed on drop.
struct Scratch {
    root: PathBuf,
}

impl Scratch {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("jan-acp-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("home")).expect("home dir");
        std::fs::create_dir_all(root.join("project")).expect("project dir");
        Self { root }
    }

    fn project(&self) -> PathBuf {
        self.root.join("project")
    }

    fn command(&self, args: &[&str]) -> Command {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_jan"));
        cmd.args(args)
            .env("HOME", self.root.join("home"))
            .env("JAN_DATA_FOLDER", self.root.join("jan-data"))
            .env("JAN_CLI_NO_UPDATE_CHECK", "1")
            .env_remove("JAN_EXPERIMENTAL_ACP")
            .env_remove("JAN_API_KEY")
            .env_remove("OPENAI_API_KEY")
            .env_remove("ANTHROPIC_API_KEY");
        cmd
    }

    fn configure(&self, base_url: &str) {
        let out = self
            .command(&[
                "config", "set", "--provider", "stub", "--api-key", "test-key", "--base-url",
                base_url, "--model", "stub-model",
            ])
            .output()
            .expect("run `jan config set`");
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    }

    fn open(&self) -> Acp {
        let mut child = self
            .command(&["acp"])
            .env("JAN_EXPERIMENTAL_ACP", "1")
            // Debug logging on, so a stray log line on stdout breaks a frame.
            .env("RUST_LOG", "debug")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn `jan acp`");
        let input = child.stdin.take();
        let output = BufReader::new(child.stdout.take().expect("stdout"));
        Acp { child, input, output, next: 1 }
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

struct Acp {
    child: Child,
    input: Option<ChildStdin>,
    output: BufReader<ChildStdout>,
    next: u64,
}

impl Acp {
    fn send(&mut self, frame: Value) {
        let input = self.input.as_mut().expect("stdin is open");
        writeln!(input, "{frame}").unwrap();
        input.flush().unwrap();
    }

    /// Every stdout line must be a JSON-RPC 2.0 frame.
    fn read(&mut self) -> Value {
        let mut line = String::new();
        assert!(self.output.read_line(&mut line).unwrap() > 0, "the channel closed");
        let frame: Value = serde_json::from_str(&line)
            .unwrap_or_else(|e| panic!("non-protocol bytes on stdout ({e}): {line:?}"));
        assert_eq!(frame["jsonrpc"], "2.0", "{frame}");
        frame
    }

    fn request(&mut self, method: &str, params: Value) -> u64 {
        let id = self.next;
        self.next += 1;
        self.send(json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}));
        id
    }

    /// Send a request and collect every frame up to and including its reply,
    /// answering any `session/request_permission` with `answer`.
    fn call(&mut self, method: &str, params: Value, answer: Option<&str>) -> (Value, Vec<Value>) {
        let id = self.request(method, params);
        let mut seen = Vec::new();
        loop {
            let frame = self.read();
            if frame["method"] == "session/request_permission" {
                let option = answer.expect("no permission prompt was expected");
                self.send(json!({"jsonrpc":"2.0","id":frame["id"],
                    "result":{"outcome":{"outcome":"selected","optionId":option}}}));
            }
            if frame["id"] == json!(id) && frame.get("method").is_none() {
                return (frame, seen);
            }
            seen.push(frame);
        }
    }

    fn initialize(&mut self) -> Value {
        self.call(
            "initialize",
            json!({"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":true,"writeTextFile":true},"terminal":true},
                "clientInfo":{"name":"test","version":"1"}}),
            None,
        )
        .0
    }

    fn new_session(&mut self, cwd: &std::path::Path) -> String {
        let (reply, _) = self.call("session/new", json!({"cwd":cwd,"mcpServers":[]}), None);
        reply["result"]["sessionId"].as_str().unwrap_or_else(|| panic!("{reply}")).to_string()
    }

    fn close(mut self) {
        self.input.take();
        let status = self.child.wait().expect("wait for `jan acp`");
        assert!(status.success(), "{status}");
    }
}

/// Every thread id saved anywhere under `dir`: a thread is a directory holding
/// `messages.jsonl`, named by its id.
fn thread_ids(dir: &std::path::Path) -> Vec<String> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if path.is_dir() {
            if path.join("messages.jsonl").is_file() {
                out.push(entry.file_name().to_string_lossy().into_owned());
            }
            out.extend(thread_ids(&path));
        }
    }
    out
}

fn updates<'a>(frames: &'a [Value], tag: &str) -> Vec<&'a Value> {
    frames
        .iter()
        .filter(|f| f["method"] == "session/update" && f["params"]["update"]["sessionUpdate"] == tag)
        .map(|f| &f["params"]["update"])
        .collect()
}

#[test]
fn acp_is_refused_without_the_experimental_opt_in() {
    let scratch = Scratch::new("gate");
    let out = scratch.command(&["acp"]).stdin(Stdio::null()).output().expect("run `jan acp`");
    assert_eq!(out.status.code(), Some(2));
    assert!(out.stdout.is_empty(), "nothing on the protocol channel");
    assert!(String::from_utf8_lossy(&out.stderr).contains("JAN_EXPERIMENTAL_ACP"));
    let help = scratch.command(&["--help"]).output().expect("run `jan --help`");
    assert!(!String::from_utf8_lossy(&help.stdout).contains("acp"), "hidden from help");
}

#[test]
fn a_prompt_streams_updates_and_a_gated_write_asks_the_client() {
    let scratch = Scratch::new("prompt");
    scratch.configure(&stub_provider(vec![
        Some(prose("stub answer")),
        Some(write_call()),
        Some(prose("wrote it")),
        Some(write_call()),
        Some(prose("did not write")),
    ]));
    let project = scratch.project();
    let mut acp = scratch.open();
    let init = acp.initialize();
    assert_eq!(init["result"]["protocolVersion"], 1);
    assert_eq!(init["result"]["agentCapabilities"]["loadSession"], true);
    assert_eq!(init["result"]["authMethods"], json!([]));
    let sid = acp.new_session(&project);

    let (reply, frames) = acp.call(
        "session/prompt",
        json!({"sessionId":sid,"prompt":[{"type":"text","text":"hi"}]}),
        None,
    );
    assert_eq!(reply["result"]["stopReason"], "end_turn", "{reply}");
    let text: String = updates(&frames, "agent_message_chunk")
        .iter()
        .filter_map(|u| u["content"]["text"].as_str())
        .collect();
    assert_eq!(text, "stub answer");

    // Allowed: the call runs and the file lands.
    let (reply, frames) = acp.call(
        "session/prompt",
        json!({"sessionId":sid,"prompt":[{"type":"text","text":"write the note"}]}),
        Some("allow_once"),
    );
    assert_eq!(reply["result"]["stopReason"], "end_turn", "{reply}");
    assert!(!updates(&frames, "tool_call").is_empty(), "{frames:?}");
    let done = updates(&frames, "tool_call_update");
    assert!(done.iter().any(|u| u["status"] == "completed"), "{frames:?}");
    assert_eq!(std::fs::read_to_string(project.join("note.txt")).unwrap(), "hello");

    // Rejected: the same gate refuses the call, and nothing is written.
    std::fs::remove_file(project.join("note.txt")).unwrap();
    let (reply, frames) = acp.call(
        "session/prompt",
        json!({"sessionId":sid,"prompt":[{"type":"text","text":"write it again"}]}),
        Some("reject_once"),
    );
    assert_eq!(reply["result"]["stopReason"], "end_turn", "{reply}");
    assert!(!project.join("note.txt").exists(), "a rejected write must not run");
    assert!(!updates(&frames, "tool_call_update").is_empty());
    acp.close();

    // The conversation was saved under the session id, so a fresh process
    // can load it -- and replays it before replying.
    let mut acp = scratch.open();
    acp.initialize();
    let (reply, frames) = acp.call(
        "session/load",
        json!({"sessionId":sid,"cwd":project,"mcpServers":[]}),
        None,
    );
    assert!(reply.get("error").is_none(), "{reply}");
    let users: Vec<&str> = updates(&frames, "user_message_chunk")
        .iter()
        .filter_map(|u| u["content"]["text"].as_str())
        .collect();
    assert_eq!(users, ["hi", "write the note", "write it again"]);
    assert!(!updates(&frames, "agent_message_chunk").is_empty());
    assert!(!updates(&frames, "tool_call").is_empty());

    let (reply, _) = acp.call(
        "session/load",
        json!({"sessionId":"no-such-thread","cwd":project,"mcpServers":[]}),
        None,
    );
    assert!(reply.get("error").is_some(), "{reply}");
    acp.close();
}

/// A thread another surface wrote -- here a headless `jan cli agent run`, which
/// saves through the same store the TUI does, tool calls included -- loads
/// and replays, and the loaded session can be prompted.
#[test]
fn load_replays_a_thread_another_surface_saved() {
    let scratch = Scratch::new("foreign");
    scratch.configure(&stub_provider(vec![
        Some(read_call()),
        Some(prose("read it")),
        Some(prose("continued")),
    ]));
    let project = scratch.project();
    std::fs::write(project.join("a.txt"), "alpha").unwrap();
    let out = scratch
        .command(&["cli", "agent", "run", "--project", project.to_str().unwrap(), "--output-format", "json", "read a.txt"])
        .output()
        .expect("run `jan cli agent run`");
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let report: Value = serde_json::from_slice(&out.stdout).expect("the json result");
    // The report abbreviates the id for a person; the store holds it whole,
    // and that is what a client that remembers a session holds.
    let short = report["session_id"].as_str().unwrap_or_else(|| panic!("{report}")).to_string();
    let sid = thread_ids(&scratch.root)
        .into_iter()
        .find(|id| id.starts_with(&short))
        .unwrap_or_else(|| panic!("no saved thread for {short}"));

    let mut acp = scratch.open();
    acp.initialize();
    let (reply, frames) = acp.call("session/load", json!({"sessionId":sid,"cwd":project,"mcpServers":[]}), None);
    assert!(reply.get("error").is_none(), "{reply}");
    let users: Vec<&str> = updates(&frames, "user_message_chunk")
        .iter()
        .filter_map(|u| u["content"]["text"].as_str())
        .collect();
    assert_eq!(users, ["read a.txt"]);
    let calls = updates(&frames, "tool_call");
    assert_eq!(calls.len(), 1, "{frames:?}");
    assert_eq!(calls[0]["toolCallId"], "call-r");
    let results = updates(&frames, "tool_call_update");
    assert!(results[0]["content"][0]["content"]["text"].as_str().unwrap().contains("alpha"), "{frames:?}");

    let (reply, _) = acp.call("session/prompt", json!({"sessionId":sid,"prompt":[{"type":"text","text":"go on"}]}), None);
    assert_eq!(reply["result"]["stopReason"], "end_turn", "{reply}");
    acp.close();
}

/// Cancelled while a gated call waits on the client: the prompt ends
/// `cancelled`, the open `session/request_permission` is withdrawn, the call
/// never runs, and the next prompt goes out on a well-formed history.
#[test]
fn cancel_during_a_pending_tool_call_neither_runs_it_nor_breaks_the_session() {
    let scratch = Scratch::new("cancel-tool");
    scratch.configure(&stub_provider(vec![Some(write_call()), Some(prose("after"))]));
    let project = scratch.project();
    let mut acp = scratch.open();
    acp.initialize();
    let sid = acp.new_session(&project);
    let id = acp.request("session/prompt", json!({"sessionId":sid,"prompt":[{"type":"text","text":"write"}]}));
    // Wait for the gate prompt, then cancel instead of answering it.
    loop {
        let frame = acp.read();
        if frame["method"] == "session/request_permission" {
            break;
        }
    }
    acp.send(json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":sid}}));
    loop {
        let frame = acp.read();
        if frame["id"] == json!(id) {
            assert_eq!(frame["result"]["stopReason"], "cancelled", "{frame}");
            break;
        }
    }
    assert!(!project.join("note.txt").exists(), "a cancelled call must not run");

    let (reply, frames) = acp.call("session/prompt", json!({"sessionId":sid,"prompt":[{"type":"text","text":"again"}]}), None);
    assert_eq!(reply["result"]["stopReason"], "end_turn", "{reply}");
    let text: String = updates(&frames, "agent_message_chunk")
        .iter()
        .filter_map(|u| u["content"]["text"].as_str())
        .collect();
    assert_eq!(text, "after");
    acp.close();
}

#[test]
fn cancel_ends_an_in_flight_prompt_as_cancelled() {
    let scratch = Scratch::new("cancel");
    // The provider never answers, so the prompt is in flight until cancelled.
    scratch.configure(&stub_provider(vec![None]));
    let project = scratch.project();
    let mut acp = scratch.open();
    acp.initialize();
    let sid = acp.new_session(&project);
    let id = acp.request("session/prompt", json!({"sessionId":sid,"prompt":[{"type":"text","text":"hang"}]}));
    std::thread::sleep(Duration::from_millis(500));
    acp.send(json!({"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":sid}}));
    loop {
        let frame = acp.read();
        if frame["id"] == json!(id) {
            assert_eq!(frame["result"]["stopReason"], "cancelled", "{frame}");
            break;
        }
    }
    acp.close();
}
