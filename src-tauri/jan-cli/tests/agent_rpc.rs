//! Exercise the persistent RPC process through the real `jan` binary.
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::Duration;

/// A stub OpenAI-compatible provider that streams `tokens` deltas of
/// `token_bytes` each and then stops.
fn provider(tokens: usize, token_bytes: usize) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    std::thread::spawn(move || {
        for connection in listener.incoming() {
            let Ok(mut stream) = connection else { break };
            stream
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut headers = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                headers.push_str(&line);
            }
            let size = headers
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .and_then(|n| n.trim().parse::<usize>().ok())
                })
                .unwrap_or(0);
            let mut request = vec![0; size];
            std::io::Read::read_exact(&mut reader, &mut request).unwrap();
            let mut answer = String::new();
            for index in 0..tokens.max(1) {
                let text = if index == 0 && token_bytes == 0 {
                    "stub answer".to_owned()
                } else {
                    "x".repeat(token_bytes.max(1))
                };
                let chunk = serde_json::json!({
                    "id":"stub-1","object":"chat.completion.chunk","created":1,"model":"stub-model",
                    "choices":[{"index":0,"delta":{"role":"assistant","content":text},"finish_reason":null}]
                });
                answer.push_str(&format!("data: {chunk}\n\n"));
            }
            answer.push_str("data: {\"id\":\"stub-1\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"stub-model\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2,\"total_tokens\":7}}\n\n");
            answer.push_str("data: [DONE]\n\n");
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{answer}", answer.len()).unwrap();
        }
    });
    url
}

/// A scratch directory of our own, so the two tests never share a `~/.jan`.
/// The project's store as the binary resolves it under the test's `HOME`.
fn store(home: &Path, project: &Path) -> PathBuf {
    tauri_plugin_agent_tools::workspace::project_store_in(&home.join(".jan"), project)
}

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("jan-rpc-{name}-{}", std::process::id()));
    std::fs::create_dir_all(dir.join("home")).unwrap();
    std::fs::create_dir_all(dir.join("project")).unwrap();
    dir
}

/// Point the CLI at the stub provider, so a session can resolve a model.
fn configure(home: &Path, base_url: &str) {
    let configured = Command::new(env!("CARGO_BIN_EXE_jan"))
        .args([
            "config",
            "set",
            "--provider",
            "stub",
            "--api-key",
            "test-key",
            "--base-url",
            base_url,
            "--model",
            "stub-model",
        ])
        .env("HOME", home)
        .env("JAN_CLI_NO_UPDATE_CHECK", "1")
        .output()
        .unwrap();
    assert!(
        configured.status.success(),
        "{}",
        String::from_utf8_lossy(&configured.stderr)
    );
}

/// The RPC process as a client drives it: LF-delimited frames in and out.
struct Rpc {
    child: Child,
    input: Option<ChildStdin>,
    output: BufReader<ChildStdout>,
}

impl Rpc {
    fn open(home: &Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_jan"))
            .args(["cli", "agent", "rpc"])
            .env("JAN_CLI_NO_UPDATE_CHECK", "1")
            .env("HOME", home)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .expect("launch rpc process");
        let input = child.stdin.take().unwrap();
        let output = BufReader::new(child.stdout.take().unwrap());
        Self {
            child,
            input: Some(input),
            output,
        }
    }

    fn read(&mut self) -> serde_json::Value {
        let mut line = String::new();
        assert!(
            self.output.read_line(&mut line).unwrap() > 0,
            "the channel closed with no record"
        );
        serde_json::from_str(&line).expect("one JSON-RPC line")
    }

    /// Read frames until one matches, or the channel closes with none.
    fn read_until(
        &mut self,
        mut matches: impl FnMut(&serde_json::Value) -> bool,
    ) -> Option<serde_json::Value> {
        for _ in 0..50_000 {
            let mut line = String::new();
            if self.output.read_line(&mut line).unwrap() == 0 {
                return None;
            }
            let record: serde_json::Value = serde_json::from_str(&line).expect("one JSON-RPC line");
            if matches(&record) {
                return Some(record);
            }
        }
        panic!("no matching record in 50000 frames");
    }

    fn send(&mut self, frame: serde_json::Value) {
        self.raw(&frame.to_string());
    }

    /// Write a line the client could only produce by hand, malformed included.
    fn raw(&mut self, line: &str) {
        let input = self.input.as_mut().expect("stdin is open");
        writeln!(input, "{line}").unwrap();
        input.flush().unwrap();
    }

    /// Close stdin while leaving stdout readable: the client asks the process
    /// to end and then keeps listening to it.
    fn close_stdin(&mut self) {
        self.input.take();
    }

    /// One request, and the one frame it is answered with.
    fn ask(&mut self, request: serde_json::Value) -> serde_json::Value {
        self.send(request);
        self.read()
    }

    /// `initialize` and then `initialized`: the guard every method sits behind.
    fn handshake(&mut self) {
        let init = self.ask(serde_json::json!({"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":1,"clientInfo":{"name":"test","version":"1"},"capabilities":{}}}));
        assert_eq!(init["result"]["protocolVersion"], 1);
        self.send(serde_json::json!({"jsonrpc":"2.0","method":"initialized","params":{}}));
    }

    fn start_session(&mut self, cwd: &Path) -> String {
        let started = self.ask(serde_json::json!({"jsonrpc":"2.0","id":3,"method":"session/start","params":{"cwd":cwd,"model":"stub-model"}}));
        let session_id = started["result"]["sessionId"].as_str().unwrap_or_default();
        assert!(!session_id.is_empty(), "{started}");
        session_id.to_owned()
    }

    /// Close stdin and wait: the process ends when the client says so.
    fn close(mut self) {
        drop(self.input);
        assert!(self.child.wait().unwrap().success());
    }
}

#[test]
fn rpc_serves_a_session_lifecycle_after_the_handshake() {
    let scratch = scratch("lifecycle");
    let home = scratch.join("home");
    let provider_url = provider(1, 0);
    configure(&home, &provider_url);
    let mut rpc = Rpc::open(&home);

    let refused =
        rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":1,"method":"session/list","params":{}}));
    assert_eq!(refused["error"]["code"], -32002);
    rpc.handshake();

    let project = scratch.join("project");
    let session_id = rpc.start_session(&project);
    let unknown_option = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":11,"method":"session/start","params":{"cwd":project,"model":"stub-model","hostTools":[]}}));
    assert_eq!(unknown_option["error"]["code"], -32602);
    let invalid_image = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":12,"method":"turn/start","params":{"sessionId":session_id,"input":[{"type":"image_url","image_url":{"url":"data:image/bmp;base64,AA=="}}]}}));
    assert_eq!(invalid_image["error"]["code"], -32602);
    let unknown =
        rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":13,"method":"not-a-method","params":{}}));
    assert_eq!(unknown["error"]["code"], -32601);
    // Malformed JSON is a transport fault with its own code, and it does not
    // desynchronize the channel: the next request is still answered.
    rpc.raw("{not json");
    let parse_error = rpc.read();
    assert_eq!(parse_error["error"]["code"], -32700, "{parse_error}");
    // An unknown additive notification is ignored rather than fatal: a frame
    // with no id gets no answer, so the next frame the client reads is the
    // response to the request it sent after it.
    rpc.send(serde_json::json!({"jsonrpc":"2.0","method":"not-a-notification","params":{}}));
    let after =
        rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":15,"method":"session/list","params":{}}));
    assert_eq!(after["id"], 15, "{after}");

    let turn = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":4,"method":"turn/start","params":{"sessionId":session_id,"input":"say hi"}}));
    assert!(turn["result"]["turnId"].as_str().is_some(), "{turn}");
    let mut terminal = None;
    let mut saw_text = false;
    for _ in 0..40 {
        let record = rpc.read();
        if record["method"] == "item/token" {
            assert_eq!(record["params"]["event"]["text"], "stub answer");
            saw_text = true;
        }
        if record["method"] == "turn/completed" {
            terminal = Some(record);
            break;
        }
    }
    let terminal = terminal.expect("a terminal outcome after the streamed events");
    assert_eq!(terminal["params"]["turnId"], turn["result"]["turnId"]);
    assert_eq!(terminal["params"]["stopReason"], "completed");
    assert!(saw_text, "the real provider's streamed token reaches RPC");
    assert!(
        store(&home, &project)
            .join("threads")
            .join(&session_id)
            .exists(),
        "completed non-ephemeral turn persists under its RPC session id"
    );

    let listed =
        rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":5,"method":"session/list","params":{}}));
    assert_eq!(listed["result"]["sessions"][0]["turns"], 1, "{listed}");
    let resumed = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":6,"method":"session/resume","params":{"sessionId":session_id}}));
    assert_eq!(resumed["result"]["sessionId"], session_id, "{resumed}");

    let pending = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":9,"method":"turn/start","params":{"sessionId":session_id,"input":"continue"}}));
    assert!(pending["result"]["turnId"].is_string(), "{pending}");
    let busy = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":14,"method":"turn/start","params":{"sessionId":session_id,"input":"overlapping turn"}}));
    assert_eq!(busy["error"]["code"], -32001, "{busy}");
    assert_eq!(busy["error"]["data"]["retryable"], true);
    rpc.send(serde_json::json!({"jsonrpc":"2.0","id":10,"method":"turn/interrupt","params":{"sessionId":session_id}}));
    let mut interrupted = 0;
    let mut acknowledged = false;
    for _ in 0..40 {
        let record = rpc.read();
        if record["method"] == "turn/completed"
            && record["params"]["turnId"] == pending["result"]["turnId"]
        {
            assert_eq!(record["params"]["stopReason"], "interrupted");
            interrupted += 1;
        }
        if record["id"] == 10 {
            assert_eq!(record["result"], serde_json::json!({}));
            acknowledged = true;
        }
        if interrupted == 1 && acknowledged {
            break;
        }
    }
    assert!(acknowledged && interrupted == 1);

    let archived = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":7,"method":"session/archive","params":{"sessionId":session_id}}));
    assert_eq!(archived["result"], serde_json::json!({}), "{archived}");
    let gone = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":8,"method":"session/resume","params":{"sessionId":session_id}}));
    assert_eq!(gone["error"]["code"], -32602);

    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}

/// A client that sends an image sends bytes into a channel with no
/// backpressure, so the caps are part of the handshake rather than something to
/// discover by being rejected. The RPC handshake carries the same object `init`
/// gives a stream-json client; this asserts the field is on the wire, and that
/// it is that object - compared against the builder, not against a copy of the
/// numbers, so a cap cannot move in one place only.
#[test]
fn the_handshake_advertises_the_content_part_caps() {
    let scratch = scratch("caps");
    let home = scratch.join("home");
    let provider_url = provider(1, 0);
    configure(&home, &provider_url);
    let mut rpc = Rpc::open(&home);

    let init = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientInfo":{"name":"test","version":"1"},"capabilities":{}}}));
    let caps = &init["result"]["input_content_parts"];
    assert!(!caps.is_null(), "{init}");
    assert_eq!(
        caps,
        &serde_json::to_value(app_lib::core::cli::run_report::InputContentParts::current())
            .expect("the caps serialize"),
        "the handshake advertises the caps the parser enforces",
    );

    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}

#[test]
fn failed_fork_does_not_close_other_sessions() {
    let scratch = scratch("failed-fork");
    let home = scratch.join("home");
    configure(&home, &provider(1, 0));
    let mut rpc = Rpc::open(&home);
    rpc.handshake();
    let project = scratch.join("project");
    let session_id = rpc.start_session(&project);
    std::fs::write(store(&home, &project).join("agent.toml"), "[agent\n").unwrap();

    let failure = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":4,"method":"session/fork","params":{"sessionId":session_id}}));
    assert_eq!(failure["id"], 4);
    assert_eq!(failure["error"]["code"], -32602);
    let resumed = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":5,"method":"session/resume","params":{"sessionId":session_id}}));
    assert_eq!(resumed["result"]["sessionId"], session_id);
    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}

#[test]
fn failed_initialize_revokes_the_previous_handshake() {
    let scratch = scratch("handshake");
    let mut rpc = Rpc::open(&scratch.join("home"));
    rpc.handshake();
    let failure = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":4,"method":"initialize","params":{"protocolVersion":999,"clientInfo":{"name":"test","version":"1"}}}));
    assert_eq!(failure["error"]["code"], -32602);
    rpc.send(serde_json::json!({"jsonrpc":"2.0","method":"initialized","params":{}}));
    let refused =
        rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":5,"method":"session/list","params":{}}));
    assert_eq!(refused["error"]["code"], -32002);
    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}

#[test]
fn an_explicit_null_id_gets_an_answer() {
    let scratch = scratch("null-id");
    let mut rpc = Rpc::open(&scratch.join("home"));
    rpc.handshake();
    rpc.send(serde_json::json!({"jsonrpc":"2.0","id":null,"method":"session/list","params":{}}));
    rpc.send(serde_json::json!({"jsonrpc":"2.0","id":7,"method":"session/list","params":{}}));
    let first = rpc.read();
    assert!(first["id"].is_null(), "{first}");
    assert!(first["result"]["sessions"].is_array(), "{first}");
    let next = rpc.read();
    assert_eq!(next["id"], 7);
    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}

/// A client that stops reading cannot grow the server without bound: the queue
/// fills at its cap, the run ends with a terminal outcome that says so, and
/// that outcome still reaches the client once it reads again - through the slot
/// the turn reserved for it, never through one the client's records could take.
///
/// The reservation's other half, a `turn/start` refused with `-32001` because
/// the queue has no room left for its terminal record, is not asserted here: on
/// this platform the writer drains a full queue into the stdout pipe faster
/// than a stalled client can be caught holding it, so the refusal is a guard
/// against a slower pipe rather than a state a test can park in.
#[test]
fn rpc_survives_a_client_that_stops_reading() {
    let scratch = scratch("overload");
    let home = scratch.join("home");
    let provider_url = provider(20_000, 0);
    configure(&home, &provider_url);
    let mut rpc = Rpc::open(&home);
    rpc.handshake();

    let project = scratch.join("project");
    let session_id = rpc.start_session(&project);
    let turn = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":4,"method":"turn/start","params":{"sessionId":session_id,"input":"talk"}}));
    assert!(turn["result"]["turnId"].is_string(), "{turn}");

    // Stop reading. The writer blocks on the pipe, the bounded queue fills
    // behind it, and the producer ends the turn instead of buffering the
    // deltas the provider still has to send.
    std::thread::sleep(Duration::from_secs(2));

    let mut terminal = None;
    for _ in 0..20_000 {
        let record = rpc.read();
        if record["method"] == "turn/completed" {
            terminal = Some(record);
            break;
        }
    }
    let terminal = terminal.expect("a terminal outcome after the queue overloaded");
    assert_eq!(terminal["params"]["turnId"], turn["result"]["turnId"]);
    assert_eq!(terminal["params"]["stopReason"], "error", "{terminal}");
    assert!(
        terminal["params"]["error"]
            .as_str()
            .is_some_and(|error| error.contains("overloaded")),
        "{terminal}"
    );

    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}

/// The artifact is what a client generates its calls from, so a method it names
/// must be a method the dispatcher answers. The list is read from the committed
/// file rather than written here: a verb added to the document without an arm to
/// serve it fails this, which is the half of the parity the schema unit test
/// cannot see (that one compares the document against a reviewed list, not
/// against the dispatcher).
///
/// The responses themselves are not the subject - a bad call is expected - only
/// that each one is answered rather than `-32601`.
#[test]
fn every_documented_method_is_answered() {
    let scratch = scratch("surface");
    let home = scratch.join("home");
    let provider_url = provider(1, 0);
    configure(&home, &provider_url);
    let mut rpc = Rpc::open(&home);
    rpc.handshake();

    let document: serde_json::Value =
        serde_json::from_str(include_str!("../../../protocol/rpc-schema.json"))
            .expect("the committed artifact is JSON");
    let mut methods: Vec<&str> = document["requests"]
        .as_object()
        .expect("the artifact lists its requests")
        .keys()
        .map(String::as_str)
        .collect();
    methods.sort_unstable();
    // A vacuity guard: an empty or renamed map would otherwise make the loop
    // below pass without asking anything.
    assert!(methods.len() >= 9, "{methods:?}");

    for (index, method) in methods.iter().enumerate() {
        let id = 100 + index;
        let reply =
            rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":id,"method":method,"params":{}}));
        assert_eq!(reply["id"], id, "{method}: {reply}");
        assert_ne!(
            reply["error"]["code"], -32601,
            "{method} is in the artifact but not dispatched: {reply}"
        );
        assert!(
            !reply["result"].is_null() || !reply["error"].is_null(),
            "{method} was answered with neither: {reply}"
        );
    }

    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}

/// Closing stdin asks the process to end, but stdin is not stdout: the client
/// can still read, and the turn that was running when it asked is the one case
/// where it cannot infer the outcome from anything else on the channel. It gets
/// a terminal record, on the slot the turn reserved for it, before the process
/// exits.
#[test]
fn closing_stdin_closes_the_active_turn() {
    let scratch = scratch("stdin-close");
    let home = scratch.join("home");
    // Enough deltas that the turn is still producing when stdin closes.
    let provider_url = provider(20_000, 0);
    configure(&home, &provider_url);
    let mut rpc = Rpc::open(&home);
    rpc.handshake();

    let project = scratch.join("project");
    let session_id = rpc.start_session(&project);
    let turn = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":4,"method":"turn/start","params":{"sessionId":session_id,"input":"talk"}}));
    assert!(turn["result"]["turnId"].is_string(), "{turn}");

    std::thread::sleep(Duration::from_millis(200));
    rpc.close_stdin();

    let terminal = rpc
        .read_until(|record| record["method"] == "turn/completed")
        .expect("a terminal record for the turn the client abandoned");
    assert_eq!(terminal["params"]["turnId"], turn["result"]["turnId"]);
    assert_eq!(
        terminal["params"]["stopReason"], "interrupted",
        "{terminal}"
    );

    // Nothing is left running: the process exits once the queue is drained.
    assert!(rpc.child.wait().unwrap().success());
    let _ = std::fs::remove_dir_all(scratch);
}

/// The model calls the declared host tool; its arguments satisfy the schema.
const HOST_TOOL_CALL: &str = concat!(
    "data: {\"id\":\"stub-1\",\"object\":\"chat.completion.chunk\",\"created\":1,",
    "\"model\":\"stub-model\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",",
    "\"tool_calls\":[{\"index\":0,\"id\":\"call-1\",\"type\":\"function\",\"function\":",
    "{\"name\":\"host__robot_arm_move\",\"arguments\":\"{\\\"position\\\":\\\"bin\\\"}\"}}]},",
    "\"finish_reason\":null}]}\n\n",
    "data: {\"id\":\"stub-1\",\"object\":\"chat.completion.chunk\",\"created\":1,",
    "\"model\":\"stub-model\",\"choices\":[{\"index\":0,\"delta\":{},",
    "\"finish_reason\":\"tool_calls\"}],",
    "\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2,\"total_tokens\":7}}\n\n",
    "data: [DONE]\n\n",
);

/// Plain prose, which ends the turn.
const PROSE: &str = concat!(
    "data: {\"id\":\"stub-2\",\"object\":\"chat.completion.chunk\",\"created\":1,",
    "\"model\":\"stub-model\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",",
    "\"content\":\"the arm reached bin\"},\"finish_reason\":null}]}\n\n",
    "data: {\"id\":\"stub-2\",\"object\":\"chat.completion.chunk\",\"created\":1,",
    "\"model\":\"stub-model\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],",
    "\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":4,\"total_tokens\":13}}\n\n",
    "data: [DONE]\n\n",
);

/// Serve `replies` in order, one per connection, repeating the last, and keep
/// every request body: what the model was sent is where a host tool's result
/// has to land for the round trip to mean anything.
fn scripted_provider(
    replies: &'static [&'static str],
) -> (String, std::sync::Arc<std::sync::Mutex<Vec<serde_json::Value>>>) {
    routed_provider(move |index, _| replies[index.min(replies.len() - 1)])
}

/// Serve whatever `reply` picks for each request, from its arrival index and
/// body, and keep every body. A run with children sends requests from more
/// than one conversation at once, so their order is not the script's to fix.
fn routed_provider(
    reply: impl Fn(usize, &serde_json::Value) -> &'static str + Send + 'static,
) -> (String, std::sync::Arc<std::sync::Mutex<Vec<serde_json::Value>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = std::sync::Arc::clone(&seen);
    std::thread::spawn(move || {
        for (index, connection) in listener.incoming().enumerate() {
            let Ok(mut stream) = connection else { break };
            stream
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut size = 0;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                    break;
                }
                if let Some(n) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    size = n.trim().parse().unwrap_or(0);
                }
            }
            let mut request = vec![0; size];
            if std::io::Read::read_exact(&mut reader, &mut request).is_err() {
                continue;
            }
            let body: serde_json::Value =
                serde_json::from_slice(&request).unwrap_or(serde_json::Value::Null);
            let reply = reply(index, &body);
            sink.lock().unwrap().push(body);
            let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}", reply.len());
        }
    });
    (url, seen)
}

/// One declared host tool, as a host would send it on `session/start`.
fn arm_tool() -> serde_json::Value {
    serde_json::json!({
        "name": "robot_arm_move",
        "description": "Move the arm.",
        "parameters": {
            "type": "object",
            "properties": {"position": {"type": "string"}},
            "required": ["position"]
        }
    })
}

/// A session over `tools`, gated by the host so no `permission_request`
/// interleaves with the host tool traffic under test.
fn start_host_session(
    rpc: &mut Rpc,
    cwd: &Path,
    tools: serde_json::Value,
    builtins: bool,
) -> serde_json::Value {
    let started = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":3,"method":"session/start","params":{
        "cwd":cwd,"model":"stub-model","tools":tools,"builtins":builtins,"permissions":"host"
    }}));
    assert!(started["result"]["sessionId"].is_string(), "{started}");
    started["result"].clone()
}

/// Read until the reply to request `id`, keeping the notifications passed on
/// the way so a test can assert their order.
fn reply_to(rpc: &mut Rpc, id: u64, seen: &mut Vec<serde_json::Value>) -> serde_json::Value {
    rpc.read_until(|record| {
        if record["id"] == id {
            return true;
        }
        seen.push(record.clone());
        false
    })
    .expect("the request is answered")
}

fn tool_request_id(rpc: &mut Rpc) -> String {
    let request = rpc
        .read_until(|record| record["method"] == "item/tool_request")
        .expect("the model's call reaches the host");
    assert_eq!(request["params"]["event"]["tool_name"], "robot_arm_move", "{request}");
    assert_eq!(request["params"]["event"]["args"]["position"], "bin", "{request}");
    request["params"]["event"]["request_id"]
        .as_str()
        .expect("a request id")
        .to_owned()
}

/// The whole host tool loop over RPC: declared on `session/start`, called by
/// the model, surfaced as `item/tool_request`, answered with content parts
/// through `tool/respond`, and carried into the model's next request.
#[test]
fn a_host_tool_round_trips_with_content_parts() {
    let scratch = scratch("host-round-trip");
    let home = scratch.join("home");
    let (url, seen) = scripted_provider(&[HOST_TOOL_CALL, PROSE]);
    configure(&home, &url);
    let mut rpc = Rpc::open(&home);
    rpc.handshake();
    let project = scratch.join("project");

    let started = start_host_session(&mut rpc, &project, serde_json::json!([arm_tool()]), true);
    assert_eq!(started["model"], "stub-model", "{started}");
    let tools = started["tools"].as_array().expect("advertised names");
    assert!(tools.iter().any(|t| t == "host__robot_arm_move"), "{started}");
    assert!(tools.iter().any(|t| t == "shell"), "built-ins stay by default: {started}");
    assert_eq!(started["toolSpecs"][0]["function"]["name"], "host__robot_arm_move");
    assert_eq!(started["toolSpecs"][0]["function"]["parameters"], arm_tool()["parameters"]);
    let session_id = started["sessionId"].as_str().unwrap().to_owned();

    let turn = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":4,"method":"turn/start","params":{"sessionId":session_id,"input":"move the arm"}}));
    assert!(turn["result"]["turnId"].is_string(), "{turn}");
    let request_id = tool_request_id(&mut rpc);

    let image = "data:image/png;base64,iVBORw0KGgo=";
    rpc.send(serde_json::json!({"jsonrpc":"2.0","id":5,"method":"tool/respond","params":{
        "requestId":request_id,
        "content":[{"type":"text","text":"frame captured"},{"type":"image_url","image_url":{"url":image}}],
        "details":{"frame":7}
    }}));
    let mut notes = Vec::new();
    let answered = reply_to(&mut rpc, 5, &mut notes);
    assert_eq!(answered["result"], serde_json::json!({}), "{answered}");
    let terminal = rpc
        .read_until(|record| {
            notes.push(record.clone());
            record["method"] == "turn/completed"
        })
        .expect("the turn completes");
    assert_eq!(terminal["params"]["stopReason"], "completed", "{terminal}");

    // The details are the host's: surfaced as their own event and nowhere else.
    assert!(
        notes.iter().any(|n| n["method"] == "item/tool_details"
            && n["params"]["event"]["details"]["frame"] == 7),
        "{notes:?}"
    );
    // The loop's tool message is the parts, verbatim and in order.
    let history = notes
        .iter()
        .rev()
        .find(|n| n["method"] == "item/messages_updated")
        .expect("the history is published");
    let tool_message = history["params"]["event"]["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["role"] == "tool")
        .expect("a tool message")
        .clone();
    assert_eq!(tool_message["content"][0]["text"], "frame captured", "{tool_message}");
    assert_eq!(tool_message["content"][1]["image_url"]["url"], image, "{tool_message}");

    let requests = seen.lock().unwrap();
    assert_eq!(requests.len(), 2, "the result never reached the model");
    let wire = requests[1]["messages"].as_array().unwrap();
    let tool_at = wire
        .iter()
        .position(|m| m["role"] == "tool")
        .expect("the follow-up request carries the tool message");
    // A tool message is text on the wire (`genai` tool responses are
    // text-only), so the image rides in the user turn right after it.
    assert!(wire[tool_at].to_string().contains("frame captured"), "{}", wire[tool_at]);
    let carried = &wire[tool_at + 1];
    assert_eq!(carried["role"], "user", "{carried}");
    assert!(
        carried["content"]
            .as_array()
            .expect("a content-part array")
            .iter()
            .any(|p| p["image_url"]["url"] == image),
        "the host's image reached the model: {carried}"
    );
    assert!(
        !requests[1].to_string().contains("\"frame\":7"),
        "details must never reach the model: {}",
        requests[1]
    );
    drop(requests);

    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}

/// A host that names its tool after a built-in has misunderstood whose
/// implementation runs, and is told so before any session exists.
#[test]
fn a_reserved_host_tool_name_is_refused_as_invalid_tools() {
    let scratch = scratch("host-reserved");
    let home = scratch.join("home");
    configure(&home, &provider(1, 0));
    let mut rpc = Rpc::open(&home);
    rpc.handshake();
    let project = scratch.join("project");

    let refused = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":3,"method":"session/start","params":{"cwd":project,"model":"stub-model","tools":[{"name":"shell"}]}}));
    assert_eq!(refused["error"]["code"], -32602, "{refused}");
    assert_eq!(refused["error"]["data"]["kind"], "invalid_tools", "{refused}");
    assert!(refused["error"]["message"].as_str().unwrap().contains("reserved"), "{refused}");
    // A malformed entry is the same kind, naming where it is.
    let typo = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":4,"method":"session/start","params":{"cwd":project,"model":"stub-model","tools":[{"name":"x","capability":"write"}]}}));
    assert_eq!(typo["error"]["data"]["kind"], "invalid_tools", "{typo}");
    assert!(typo["error"]["message"].as_str().unwrap().contains("tools[0]"), "{typo}");
    let listed = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":5,"method":"session/list","params":{}}));
    assert_eq!(listed["result"]["sessions"], serde_json::json!([]), "{listed}");

    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}

/// The running turn has already built its request from the session's tools,
/// model and history, so changing them mid-turn is refused as retryable; once
/// the turn ends the change applies and `session/tools/get` shows it.
#[test]
fn session_mutations_wait_for_the_active_turn() {
    let scratch = scratch("host-mutation");
    let home = scratch.join("home");
    let (url, _seen) = scripted_provider(&[HOST_TOOL_CALL, PROSE]);
    configure(&home, &url);
    let mut rpc = Rpc::open(&home);
    rpc.handshake();
    let project = scratch.join("project");
    let started = start_host_session(&mut rpc, &project, serde_json::json!([arm_tool()]), true);
    let session_id = started["sessionId"].as_str().unwrap().to_owned();

    let turn = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":4,"method":"turn/start","params":{"sessionId":session_id,"input":"move the arm"}}));
    assert!(turn["result"]["turnId"].is_string(), "{turn}");
    // Parked on the host: the turn is certainly still active.
    let request_id = tool_request_id(&mut rpc);

    let camera = serde_json::json!([{"name":"camera","capability":"read"}]);
    let mut notes = Vec::new();
    for (id, method, params) in [
        (5, "session/tools/set", serde_json::json!({"sessionId":session_id,"tools":camera})),
        (6, "session/model/set", serde_json::json!({"sessionId":session_id,"model":"stub-model"})),
        (7, "session/reset", serde_json::json!({"sessionId":session_id})),
    ] {
        rpc.send(serde_json::json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}));
        let refused = reply_to(&mut rpc, id, &mut notes);
        assert_eq!(refused["error"]["code"], -32001, "{method}: {refused}");
        assert_eq!(refused["error"]["data"]["kind"], "turn_active", "{method}: {refused}");
        assert_eq!(refused["error"]["data"]["retryable"], true, "{method}: {refused}");
    }
    let unknown = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":8,"method":"session/tools/get","params":{"sessionId":"nope"}}));
    assert_eq!(unknown["error"]["code"], -32602, "{unknown}");

    rpc.send(serde_json::json!({"jsonrpc":"2.0","id":9,"method":"tool/respond","params":{"requestId":request_id,"content":"moved"}}));
    let answered = reply_to(&mut rpc, 9, &mut notes);
    assert_eq!(answered["result"], serde_json::json!({}), "{answered}");
    rpc.read_until(|record| record["method"] == "turn/completed")
        .expect("the turn completes");

    let set = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":10,"method":"session/tools/set","params":{"sessionId":session_id,"tools":camera}}));
    let tools = set["result"]["tools"].as_array().expect("advertised names");
    assert!(tools.iter().any(|t| t == "host__camera"), "{set}");
    assert!(!tools.iter().any(|t| t == "host__robot_arm_move"), "the set is replaced: {set}");
    let got = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":11,"method":"session/tools/get","params":{"sessionId":session_id}}));
    assert_eq!(got["result"], set["result"], "{got}");
    let model = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":12,"method":"session/model/set","params":{"sessionId":session_id,"model":"stub-model"}}));
    assert_eq!(model["result"], serde_json::json!({"model":"stub-model"}), "{model}");
    let after_model = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":13,"method":"session/tools/get","params":{"sessionId":session_id}}));
    assert_eq!(after_model["result"], set["result"], "a model switch keeps the host tools: {after_model}");
    let reset = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":14,"method":"session/reset","params":{"sessionId":session_id}}));
    assert_eq!(reset["result"], set["result"], "a reset keeps the tools: {reset}");

    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}

/// `builtins: false` is a session that exposes the host's tools and nothing
/// else, which the provider's request is the only honest witness of.
#[test]
fn builtins_false_advertises_only_host_tools() {
    let scratch = scratch("host-only");
    let home = scratch.join("home");
    let (url, seen) = scripted_provider(&[PROSE]);
    configure(&home, &url);
    let mut rpc = Rpc::open(&home);
    rpc.handshake();
    let project = scratch.join("project");
    let started = start_host_session(&mut rpc, &project, serde_json::json!([arm_tool()]), false);
    assert_eq!(started["tools"], serde_json::json!(["host__robot_arm_move"]), "{started}");
    let session_id = started["sessionId"].as_str().unwrap().to_owned();

    rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":4,"method":"turn/start","params":{"sessionId":session_id,"input":"hi"}}));
    let terminal = rpc
        .read_until(|record| record["method"] == "turn/completed")
        .expect("the turn completes");
    assert_eq!(terminal["params"]["stopReason"], "completed", "{terminal}");

    let requests = seen.lock().unwrap();
    let names: Vec<&str> = requests[0]["tools"]
        .as_array()
        .expect("the request advertises tools")
        .iter()
        .filter_map(|tool| tool["function"]["name"].as_str())
        .collect();
    assert_eq!(names, ["host__robot_arm_move"], "{}", requests[0]);
    drop(requests);

    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}

/// An interrupt withdraws what the host still holds, and says so before the
/// turn's terminal record; an answer after that has nothing to resolve.
#[test]
fn interrupting_withdraws_pending_host_requests() {
    let scratch = scratch("host-interrupt");
    let home = scratch.join("home");
    let (url, _seen) = scripted_provider(&[HOST_TOOL_CALL, PROSE]);
    configure(&home, &url);
    let mut rpc = Rpc::open(&home);
    rpc.handshake();
    let project = scratch.join("project");
    let started = start_host_session(&mut rpc, &project, serde_json::json!([arm_tool()]), true);
    let session_id = started["sessionId"].as_str().unwrap().to_owned();

    rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":4,"method":"turn/start","params":{"sessionId":session_id,"input":"move the arm"}}));
    let request_id = tool_request_id(&mut rpc);

    rpc.send(serde_json::json!({"jsonrpc":"2.0","id":5,"method":"turn/interrupt","params":{"sessionId":session_id}}));
    let mut notes = Vec::new();
    let acknowledged = reply_to(&mut rpc, 5, &mut notes);
    assert_eq!(acknowledged["result"], serde_json::json!({}), "{acknowledged}");
    let cancelled = notes
        .iter()
        .position(|n| n["method"] == "item/tool_request_cancelled")
        .unwrap_or_else(|| panic!("no cancellation record: {notes:?}"));
    assert_eq!(notes[cancelled]["params"]["event"]["request_id"], request_id);
    assert_eq!(notes[cancelled]["params"]["event"]["reason"], "interrupted");
    let completed = notes
        .iter()
        .position(|n| n["method"] == "turn/completed")
        .unwrap_or_else(|| panic!("no terminal record: {notes:?}"));
    assert!(cancelled < completed, "{notes:?}");
    assert_eq!(notes[completed]["params"]["stopReason"], "interrupted");

    let late = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":6,"method":"tool/respond","params":{"requestId":request_id,"content":"too late"}}));
    assert_eq!(late["error"]["code"], -32602, "{late}");
    assert_eq!(late["error"]["data"]["kind"], "not_pending", "{late}");

    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}

/// The provenance a client receives names the session that client holds, and
/// goes on naming it after the session is rebuilt for a model change. A record
/// naming some internal id, or a new one after `session/model/set`, cannot be
/// joined to the turn it belongs to, which is the whole use of the field.
#[test]
fn provenance_names_the_session_the_client_holds() {
    let scratch = scratch("provenance-session");
    let home = scratch.join("home");
    let (url, _seen) = scripted_provider(&[PROSE]);
    configure(&home, &url);
    let mut rpc = Rpc::open(&home);
    rpc.handshake();
    let project = scratch.join("project");
    let session_id = rpc.start_session(&project);

    let provenance = |rpc: &mut Rpc, id: u64| {
        let turn = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":id,"method":"turn/start","params":{"sessionId":session_id,"input":"hi"}}));
        assert!(turn["result"]["turnId"].is_string(), "{turn}");
        let record = rpc
            .read_until(|frame| frame["method"] == "item/request_provenance")
            .expect("the turn's request is reported");
        rpc.read_until(|frame| frame["method"] == "turn/completed")
            .expect("the turn completes");
        record["params"]["event"]["session_id"].clone()
    };

    assert_eq!(provenance(&mut rpc, 4), serde_json::json!(session_id));

    // Rebuilding the agent for a model change must not rename the session: the
    // client's id is the session's, not the agent's.
    let set = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":5,"method":"session/model/set","params":{"sessionId":session_id,"model":"stub-model"}}));
    assert_eq!(set["result"]["model"], "stub-model", "{set}");
    assert_eq!(provenance(&mut rpc, 6), serde_json::json!(session_id));

    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}

/// A session's provider and model are pinned when it starts: a model the
/// configuration cannot resolve is refused at `session/model/set` instead of
/// being accepted and only failing the next turn, and the session keeps serving
/// the model it already had. Adopting some other reachable model, or failing a
/// turn the client had every reason to believe was valid, is what this refuses.
#[test]
fn model_set_refuses_a_model_no_provider_serves() {
    let scratch = scratch("model-pin");
    let home = scratch.join("home");
    let (url, seen) = scripted_provider(&[PROSE]);
    configure(&home, &url);
    let mut rpc = Rpc::open(&home);
    rpc.handshake();
    let project = scratch.join("project");
    let session_id = rpc.start_session(&project);

    let refused = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":4,"method":"session/model/set","params":{"sessionId":session_id,"model":"no-such-model"}}));
    assert_eq!(refused["error"]["code"], -32602, "{refused}");
    assert!(
        refused["error"]["message"]
            .as_str()
            .unwrap_or_default()
            .contains("no-such-model"),
        "the refusal names the model: {refused}"
    );
    assert!(refused["result"].is_null(), "a refusal carries no model: {refused}");

    // The session is still on the model it started with: the turn goes out with
    // `stub-model` in the body, to the provider that serves it.
    let turn = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":5,"method":"turn/start","params":{"sessionId":session_id,"input":"hi"}}));
    assert!(turn["result"]["turnId"].is_string(), "{turn}");
    rpc.read_until(|record| record["method"] == "turn/completed")
        .expect("the turn completes");
    let requests = seen.lock().unwrap().clone();
    assert!(!requests.is_empty(), "the provider saw the turn");
    for request in &requests {
        assert_eq!(
            request["model"], "stub-model",
            "no substitution: the session stays on the model it was given: {request}"
        );
    }

    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}

/// Every request the provider has seen that carries recalled project memory.
fn recalled(seen: &std::sync::Mutex<Vec<serde_json::Value>>) -> usize {
    let requests = seen.lock().unwrap();
    requests
        .iter()
        .filter(|request| request.to_string().contains("# Project Memory"))
        .count()
}

fn start_with(rpc: &mut Rpc, id: u64, cwd: &Path, ephemeral: bool) -> String {
    let started = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":id,"method":"session/start","params":{
        "cwd":cwd,"model":"stub-model","ephemeral":ephemeral
    }}));
    started["result"]["sessionId"]
        .as_str()
        .unwrap_or_else(|| panic!("{started}"))
        .to_owned()
}

fn complete_turn(rpc: &mut Rpc, id: u64, session_id: &str) {
    let turn = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":id,"method":"turn/start","params":{"sessionId":session_id,"input":"where is the arm"}}));
    assert!(turn["result"]["turnId"].is_string(), "{turn}");
    let done = rpc
        .read_until(|record| record["method"] == "turn/completed")
        .expect("the turn completes");
    assert_eq!(done["params"]["stopReason"], "completed", "{done}");
}

/// `ephemeral` means nothing outlives the session, and project memory is part
/// of that: one episode's answer ("the arm reached bin") must not be recalled
/// into a later episode's prompt, even though they share a project. The saved
/// control proves the recall is observable in this setup at all.
#[test]
fn an_ephemeral_session_neither_indexes_nor_recalls_project_memory() {
    let scratch = scratch("ephemeral-memory");
    let home = scratch.join("home");
    let (url, seen) = scripted_provider(&[PROSE]);
    configure(&home, &url);
    let mut rpc = Rpc::open(&home);
    rpc.handshake();

    let saved = scratch.join("project");
    let first = start_with(&mut rpc, 3, &saved, false);
    complete_turn(&mut rpc, 4, &first);
    let second = start_with(&mut rpc, 5, &saved, false);
    complete_turn(&mut rpc, 6, &second);
    assert_eq!(recalled(&seen), 1, "a saved session recalls the earlier answer");

    let isolated = scratch.join("isolated");
    std::fs::create_dir_all(&isolated).unwrap();
    let episode = start_with(&mut rpc, 7, &isolated, true);
    complete_turn(&mut rpc, 8, &episode);
    // A model switch and a fork rebuild the agent; both keep the setting.
    let set = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":9,"method":"session/model/set","params":{"sessionId":episode,"model":"stub-model"}}));
    assert_eq!(set["result"]["model"], "stub-model", "{set}");
    complete_turn(&mut rpc, 10, &episode);
    let fork = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":11,"method":"session/fork","params":{"sessionId":episode}}));
    let fork = fork["result"]["sessionId"].as_str().unwrap_or_else(|| panic!("{fork}")).to_owned();
    complete_turn(&mut rpc, 12, &fork);
    let next = start_with(&mut rpc, 13, &isolated, true);
    complete_turn(&mut rpc, 14, &next);
    assert_eq!(
        recalled(&seen),
        1,
        "no ephemeral turn is sent an earlier episode's answer"
    );

    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}

/// One recorded provider request: the headers that carry credentials and
/// correlation, and the body the model was sent.
#[derive(Clone, Debug)]
struct SeenRequest {
    headers: Vec<(String, String)>,
    body: serde_json::Value,
}

impl SeenRequest {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.as_str())
    }
}

/// An SSE reply in which the model calls host tool `host__<tool>`.
fn host_call_sse(tool: &str) -> String {
    let call = serde_json::json!({
        "id":"stub-1","object":"chat.completion.chunk","created":1,"model":"stub-model",
        "choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call-1","type":"function",
            "function":{"name":format!("host__{tool}"),"arguments":"{\"position\":\"bin\"}"}}]},"finish_reason":null}]
    });
    let stop = serde_json::json!({
        "id":"stub-1","object":"chat.completion.chunk","created":1,"model":"stub-model",
        "choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],
        "usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}
    });
    format!("data: {call}\n\ndata: {stop}\n\ndata: [DONE]\n\n")
}

/// Like `scripted_provider`, but owning its replies and keeping each request's
/// headers: credentials travel in headers, so a body-only record could not show
/// which session's key a request carried.
fn recording_provider(replies: Vec<String>) -> (String, std::sync::Arc<std::sync::Mutex<Vec<SeenRequest>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = std::sync::Arc::clone(&seen);
    std::thread::spawn(move || {
        for (index, connection) in listener.incoming().enumerate() {
            let Ok(mut stream) = connection else { break };
            stream
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut headers = Vec::new();
            let mut size = 0;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                    break;
                }
                if let Some((key, value)) = line.trim_end().split_once(':') {
                    let (key, value) = (key.trim().to_owned(), value.trim().to_owned());
                    if key.eq_ignore_ascii_case("content-length") {
                        size = value.parse().unwrap_or(0);
                    }
                    headers.push((key, value));
                }
            }
            let mut request = vec![0; size];
            if std::io::Read::read_exact(&mut reader, &mut request).is_err() {
                continue;
            }
            let body = serde_json::from_slice(&request).unwrap_or(serde_json::Value::Null);
            sink.lock().unwrap().push(SeenRequest { headers, body });
            let reply = &replies[index.min(replies.len() - 1)];
            let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}", reply.len());
        }
    });
    (url, seen)
}

/// Give `project` its own provider through agent.toml's project-local
/// `[provider]` override: the same provider name and model in both projects, so
/// the only thing that tells the two sessions' routes apart is whose
/// configuration each one resolved.
fn project_provider(home: &Path, project: &Path, base_url: &str, api_key: &str) {
    let store = store(home, project);
    std::fs::create_dir_all(&store).unwrap();
    std::fs::write(
        store.join("agent.toml"),
        format!("[agent]\n\n[provider]\nname = \"stub\"\napi_key = \"{api_key}\"\nbase_url = \"{base_url}\"\nmodels = [\"stub-model\"]\n"),
    )
    .unwrap();
}

/// A host tool of the arm's shape under `name`, with no declared capability:
/// opaque, so Jan's own gate prompts for it with a `permission_request`.
fn opaque_tool(name: &str) -> serde_json::Value {
    let mut tool = arm_tool();
    tool["name"] = serde_json::json!(name);
    tool
}

/// Read until `stop` matches, keeping every record read on the way (the
/// matching one included), so a test can check all of them.
fn collect_until(
    rpc: &mut Rpc,
    log: &mut Vec<serde_json::Value>,
    mut stop: impl FnMut(&serde_json::Value) -> bool,
) -> serde_json::Value {
    rpc.read_until(|record| {
        log.push(record.clone());
        stop(record)
    })
    .expect("the channel closed before the expected record")
}

/// Every notification in `log` belongs to `session` and its `turn`, and the
/// provenance of every outbound request names `session`.
fn assert_all_belong_to(log: &[serde_json::Value], session: &str, turn: &serde_json::Value) {
    let notes: Vec<_> = log.iter().filter(|r| r["method"].is_string()).collect();
    assert!(!notes.is_empty(), "no notifications to check");
    for note in notes {
        assert_eq!(note["params"]["sessionId"], session, "routed to the wrong session: {note}");
        assert_eq!(note["params"]["turnId"], *turn, "routed to the wrong turn: {note}");
        if note["method"] == "item/request_provenance" {
            assert_eq!(note["params"]["event"]["session_id"], session, "{note}");
        }
    }
}

/// #385 E: two sessions held open at once in one runtime process never receive
/// each other's events, permission replies, tool results or credentials.
///
/// RPC runs one turn per process at a time (a second `turn/start` is refused
/// with a retryable `-32001`), so the sessions interleave rather than stream in
/// parallel: A's turn is parked on the host while B is open and addressed, then
/// B's turn runs while A's answered and stale ids are still in the client's
/// hands. Each session has its own project, its own provider endpoint and key,
/// and its own host tool, so a leak in any direction is visible by name.
///
/// Capture handles are not asserted: the protocol has none yet (#385 G).
#[test]
fn simultaneous_sessions_never_cross() {
    let scratch = scratch("isolation");
    let home = scratch.join("home");
    let project_a = scratch.join("project");
    let project_b = scratch.join("project-b");
    std::fs::create_dir_all(&project_b).unwrap();
    let (url_a, seen_a) = recording_provider(vec![host_call_sse("arm_move"), PROSE.to_owned()]);
    let (url_b, seen_b) = recording_provider(vec![host_call_sse("gripper_close"), PROSE.to_owned()]);
    project_provider(&home, &project_a, &url_a, "key-session-a");
    project_provider(&home, &project_b, &url_b, "key-session-b");

    let mut rpc = Rpc::open(&home);
    rpc.handshake();
    let start = |rpc: &mut Rpc, id: u64, cwd: &Path, tool: &str| {
        let started = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":id,"method":"session/start","params":{
            "cwd":cwd,"model":"stub-model","tools":[opaque_tool(tool)]
        }}));
        started["result"]["sessionId"]
            .as_str()
            .unwrap_or_else(|| panic!("{started}"))
            .to_owned()
    };
    let a = start(&mut rpc, 3, &project_a, "arm_move");
    let b = start(&mut rpc, 4, &project_b, "gripper_close");
    assert_ne!(a, b);

    // --- A's turn: parked on its permission prompt while B is open. ---
    let turn_a = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":10,"method":"turn/start","params":{"sessionId":a,"input":"move the arm"}}));
    let turn_a = turn_a["result"]["turnId"].clone();
    assert!(turn_a.is_string(), "{turn_a}");
    let mut log_a = Vec::new();
    let prompt_a = collect_until(&mut rpc, &mut log_a, |r| r["method"] == "item/permission_request");
    assert_eq!(prompt_a["params"]["event"]["tool_name"], "host__arm_move", "{prompt_a}");
    let perm_a = prompt_a["params"]["event"]["request_id"].as_str().unwrap().to_owned();

    // B cannot act on A's turn: not by interrupting it, steering it, or
    // starting its own over it.
    let mut stray = Vec::new();
    for (id, method, params) in [
        (11, "turn/interrupt", serde_json::json!({"sessionId":b})),
        (12, "turn/steer", serde_json::json!({"sessionId":b,"input":"from b"})),
        (13, "turn/start", serde_json::json!({"sessionId":b,"input":"from b"})),
    ] {
        rpc.send(serde_json::json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}));
        let refused = reply_to(&mut rpc, id, &mut stray);
        assert!(refused["error"].is_object(), "{method} for B was accepted during A's turn: {refused}");
    }
    log_a.extend(stray);

    // allow_always, so a grant that crossed sessions would show up as B's
    // prompt never arriving.
    rpc.send(serde_json::json!({"jsonrpc":"2.0","id":14,"method":"permission/respond","params":{"requestId":perm_a,"decision":"allow_always"}}));
    let allowed = reply_to(&mut rpc, 14, &mut log_a);
    assert_eq!(allowed["result"], serde_json::json!({}), "{allowed}");
    let call_a = collect_until(&mut rpc, &mut log_a, |r| r["method"] == "item/tool_request");
    assert_eq!(call_a["params"]["event"]["tool_name"], "arm_move", "{call_a}");
    let host_a = call_a["params"]["event"]["request_id"].as_str().unwrap().to_owned();
    rpc.send(serde_json::json!({"jsonrpc":"2.0","id":15,"method":"tool/respond","params":{"requestId":host_a,"content":"result-for-a"}}));
    let answered = reply_to(&mut rpc, 15, &mut log_a);
    assert_eq!(answered["result"], serde_json::json!({}), "{answered}");
    let done_a = collect_until(&mut rpc, &mut log_a, |r| r["method"] == "turn/completed");
    assert_eq!(done_a["params"]["stopReason"], "completed", "{done_a}");
    assert_all_belong_to(&log_a, &a, &turn_a);

    // --- B's turn: A's grant does not cover it, A's ids do not settle it. ---
    let turn_b = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":20,"method":"turn/start","params":{"sessionId":b,"input":"close the gripper"}}));
    let turn_b = turn_b["result"]["turnId"].clone();
    assert!(turn_b.is_string(), "{turn_b}");
    let mut log_b = Vec::new();
    let prompt_b = collect_until(&mut rpc, &mut log_b, |r| r["method"] == "item/permission_request");
    assert_eq!(prompt_b["params"]["event"]["tool_name"], "host__gripper_close", "{prompt_b}");
    let perm_b = prompt_b["params"]["event"]["request_id"].as_str().unwrap().to_owned();
    assert_ne!(perm_a, perm_b, "permission ids are never reused across sessions");

    // A's permission id, answered or not, is not B's request.
    rpc.send(serde_json::json!({"jsonrpc":"2.0","id":21,"method":"permission/respond","params":{"requestId":perm_a,"decision":"allow_once"}}));
    let crossed = reply_to(&mut rpc, 21, &mut log_b);
    assert_eq!(crossed["error"]["code"], -32602, "{crossed}");
    assert_eq!(crossed["error"]["data"]["kind"], "not_pending", "{crossed}");
    // B's prompt is still the one waiting: answering it by its own id works.
    rpc.send(serde_json::json!({"jsonrpc":"2.0","id":22,"method":"permission/respond","params":{"requestId":perm_b,"decision":"allow_once"}}));
    let allowed = reply_to(&mut rpc, 22, &mut log_b);
    assert_eq!(allowed["result"], serde_json::json!({}), "{allowed}");

    let call_b = collect_until(&mut rpc, &mut log_b, |r| r["method"] == "item/tool_request");
    assert_eq!(call_b["params"]["event"]["tool_name"], "gripper_close", "{call_b}");
    let host_b = call_b["params"]["event"]["request_id"].as_str().unwrap().to_owned();
    assert_ne!(host_a, host_b, "host request ids are never reused across sessions");
    // A's host request id cannot settle B's call.
    rpc.send(serde_json::json!({"jsonrpc":"2.0","id":23,"method":"tool/respond","params":{"requestId":host_a,"content":"forged-by-a"}}));
    let crossed = reply_to(&mut rpc, 23, &mut log_b);
    assert_eq!(crossed["error"]["code"], -32602, "{crossed}");
    assert_eq!(crossed["error"]["data"]["kind"], "not_pending", "{crossed}");
    rpc.send(serde_json::json!({"jsonrpc":"2.0","id":24,"method":"tool/respond","params":{"requestId":host_b,"content":"result-for-b"}}));
    let answered = reply_to(&mut rpc, 24, &mut log_b);
    assert_eq!(answered["result"], serde_json::json!({}), "{answered}");
    let done_b = collect_until(&mut rpc, &mut log_b, |r| r["method"] == "turn/completed");
    assert_eq!(done_b["params"]["stopReason"], "completed", "{done_b}");
    assert_all_belong_to(&log_b, &b, &turn_b);

    // --- A again: its history carries nothing of B's turn. ---
    let turn_a2 = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":30,"method":"turn/start","params":{"sessionId":a,"input":"and now?"}}));
    let turn_a2 = turn_a2["result"]["turnId"].clone();
    let mut log_a2 = Vec::new();
    let done_a2 = collect_until(&mut rpc, &mut log_a2, |r| r["method"] == "turn/completed");
    assert_eq!(done_a2["params"]["stopReason"], "completed", "{done_a2}");
    assert_all_belong_to(&log_a2, &a, &turn_a2);

    // --- The provider side: each endpoint saw only its own session. ---
    let check = |seen: &std::sync::Mutex<Vec<SeenRequest>>,
                 session: &str,
                 key: &str,
                 own: (&str, &str),
                 other: (&str, &str, &str),
                 expected: usize| {
        let requests = seen.lock().unwrap().clone();
        assert_eq!(requests.len(), expected, "{session}: {requests:?}");
        for request in &requests {
            assert_eq!(request.header("authorization"), Some(format!("Bearer {key}").as_str()), "{request:?}");
            assert_eq!(
                request.header("x-client-request-id"),
                Some(format!("jan-{session}").as_str()),
                "{request:?}"
            );
            let body = request.body.to_string();
            let (other_tool, other_result, other_key) = other;
            for leaked in [other_tool, other_result, other_key, "forged-by-a"] {
                assert!(!body.contains(leaked), "{session}'s request carries {leaked}: {body}");
            }
            let tools: Vec<&str> = request.body["tools"]
                .as_array()
                .expect("the request advertises tools")
                .iter()
                .filter_map(|tool| tool["function"]["name"].as_str())
                .collect();
            assert!(tools.contains(&own.0), "{session}: {tools:?}");
        }
        // The session's own result reached its own follow-up request.
        assert!(requests[1].body.to_string().contains(own.1), "{:?}", requests[1]);
    };
    check(&seen_a, &a, "key-session-a", ("host__arm_move", "result-for-a"),
        ("host__gripper_close", "result-for-b", "key-session-b"), 3);
    check(&seen_b, &b, "key-session-b", ("host__gripper_close", "result-for-b"),
        ("host__arm_move", "result-for-a", "key-session-a"), 2);

    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}

/// One streamed assistant turn that calls `name` with `args`, as the provider
/// would send it.
fn tool_call_reply(name: &str, args: serde_json::Value) -> &'static str {
    let call = serde_json::json!({
        "id":"stub-3","object":"chat.completion.chunk","created":1,"model":"stub-model",
        "choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call-9","type":"function",
            "function":{"name":name,"arguments":args.to_string()}}]},"finish_reason":null}]
    });
    let end = serde_json::json!({
        "id":"stub-3","object":"chat.completion.chunk","created":1,"model":"stub-model",
        "choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],
        "usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}
    });
    Box::leak(format!("data: {call}\n\ndata: {end}\n\ndata: [DONE]\n\n").into_boxed_str())
}

fn advertised(request: &serde_json::Value) -> Vec<String> {
    request["tools"]
        .as_array()
        .map(|tools| {
            tools
                .iter()
                .filter_map(|tool| tool["function"]["name"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

fn system_text(request: &serde_json::Value) -> Option<String> {
    request["messages"]
        .as_array()?
        .iter()
        .find(|message| message["role"] == "system")
        .map(|message| match &message["content"] {
            serde_json::Value::String(text) => text.clone(),
            other => other.to_string(),
        })
}

/// A session with only host tools can still delegate. The parent is offered
/// dispatch and the tools to list, steer and stop what it dispatched, and
/// nothing else of Jan's; the child is held to the parent's host
/// tools -- no shell, files, web or skills -- even though the model names the
/// tool by the bare name the host declared; and the child's call reaches the
/// host attributed to the child.
#[test]
fn a_host_only_session_delegates_to_a_child_held_to_its_host_tools() {
    let scratch = scratch("host-delegate");
    let home = scratch.join("home");
    let dispatch = tool_call_reply(
        "dispatch_subagent",
        serde_json::json!({"subagents":[{"name":"mover","task":"move the arm to bin","allowed_tools":["robot_arm_move"]}]}),
    );
    let (url, seen) = routed_provider(move |_, body| {
        let answered = body["messages"]
            .as_array()
            .is_some_and(|messages| messages.iter().any(|m| m["role"] == "tool"));
        let parent = advertised(body).iter().any(|name| name == "dispatch_subagent");
        match (parent, answered) {
            (true, false) => dispatch,
            (false, false) => HOST_TOOL_CALL,
            _ => PROSE,
        }
    });
    configure(&home, &url);
    let mut rpc = Rpc::open(&home);
    rpc.handshake();
    let project = scratch.join("project");

    let started = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":3,"method":"session/start","params":{
        "cwd":project,"model":"stub-model","tools":[arm_tool()],"builtins":false,"subagents":true,
        "permissions":"host","ephemeral":true,"systemPrompt":"You drive the arm."
    }}));
    assert_eq!(
        started["result"]["tools"],
        serde_json::json!([
            "dispatch_subagent",
            "message_subagent",
            "stop_subagent",
            "list_subagents",
            "host__robot_arm_move"
        ]),
        "{started}"
    );
    let session_id = started["result"]["sessionId"].as_str().unwrap().to_owned();

    let turn = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":4,"method":"turn/start","params":{"sessionId":session_id,"input":"delegate the move"}}));
    assert!(turn["result"]["turnId"].is_string(), "{turn}");
    let request = rpc
        .read_until(|record| record["method"] == "item/tool_request")
        .expect("the child's call reaches the host");
    let event = &request["params"]["event"];
    assert_eq!(event["tool_name"], "robot_arm_move", "{request}");
    assert!(
        event["run_id"].as_str().is_some_and(|id| id.starts_with("sub-mover")),
        "the call is attributed to the child: {request}"
    );
    let request_id = event["request_id"].as_str().unwrap().to_owned();
    rpc.send(serde_json::json!({"jsonrpc":"2.0","id":5,"method":"tool/respond","params":{"requestId":request_id,"content":"moved"}}));
    let terminal = rpc
        .read_until(|record| record["method"] == "turn/completed")
        .expect("the turn completes");
    assert_eq!(terminal["params"]["stopReason"], "completed", "{terminal}");

    let requests = seen.lock().unwrap();
    let child: Vec<&serde_json::Value> = requests
        .iter()
        .filter(|body| !advertised(body).iter().any(|name| name == "dispatch_subagent"))
        .collect();
    assert!(!child.is_empty(), "the child made no request");
    for body in &child {
        assert_eq!(advertised(body), ["host__robot_arm_move"], "{body}");
        assert_ne!(
            system_text(body).as_deref(),
            Some("You drive the arm."),
            "a child runs on its own prompt, not the host's"
        );
    }
    drop(requests);

    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}

/// A child a host-only session dispatches with no allowlist of its own is
/// still held to the session's host tools: without the parent's allowlist it
/// would inherit Jan's whole toolset, shell included.
#[test]
fn a_child_dispatched_without_an_allowlist_inherits_the_host_only_set() {
    let scratch = scratch("host-delegate-inherit");
    let home = scratch.join("home");
    let dispatch = tool_call_reply(
        "dispatch_subagent",
        serde_json::json!({"subagents":[{"name":"mover","task":"say hi"}]}),
    );
    let (url, seen) = routed_provider(move |_, body| {
        let answered = body["messages"]
            .as_array()
            .is_some_and(|messages| messages.iter().any(|m| m["role"] == "tool"));
        let parent = advertised(body).iter().any(|name| name == "dispatch_subagent");
        if parent && !answered { dispatch } else { PROSE }
    });
    configure(&home, &url);
    let mut rpc = Rpc::open(&home);
    rpc.handshake();
    let project = scratch.join("project");
    let started = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":3,"method":"session/start","params":{
        "cwd":project,"model":"stub-model","tools":[arm_tool()],"builtins":false,"subagents":true,"permissions":"host"
    }}));
    let session_id = started["result"]["sessionId"].as_str().unwrap_or_else(|| panic!("{started}")).to_owned();
    complete_turn(&mut rpc, 4, &session_id);

    let requests = seen.lock().unwrap();
    let child: Vec<Vec<String>> = requests
        .iter()
        .map(advertised)
        .filter(|names| !names.iter().any(|name| name == "dispatch_subagent"))
        .collect();
    assert_eq!(child, [["host__robot_arm_move"]], "{requests:?}");
    drop(requests);

    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}

/// `systemPrompt` is the whole system prompt, byte for byte: no Jan identity,
/// guides, environment, date or git state around it. A model switch and a fork
/// keep it; a blank one is refused rather than read as "no prompt".
#[test]
fn a_host_system_prompt_is_sent_verbatim_and_kept() {
    let scratch = scratch("host-system-prompt");
    let home = scratch.join("home");
    let (url, seen) = scripted_provider(&[PROSE]);
    configure(&home, &url);
    let mut rpc = Rpc::open(&home);
    rpc.handshake();
    let project = scratch.join("project");

    let blank = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":3,"method":"session/start","params":{
        "cwd":project,"model":"stub-model","systemPrompt":"  "
    }}));
    assert_eq!(blank["error"]["code"], -32602, "{blank}");

    let prompt = "You are the arm controller.\nAnswer in one line.";
    let started = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":4,"method":"session/start","params":{
        "cwd":project,"model":"stub-model","tools":[arm_tool()],"builtins":false,"systemPrompt":prompt
    }}));
    let session_id = started["result"]["sessionId"].as_str().unwrap_or_else(|| panic!("{started}")).to_owned();
    complete_turn(&mut rpc, 5, &session_id);
    let set = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":6,"method":"session/model/set","params":{"sessionId":session_id,"model":"stub-model"}}));
    assert_eq!(set["result"]["model"], "stub-model", "{set}");
    complete_turn(&mut rpc, 7, &session_id);
    let fork = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":8,"method":"session/fork","params":{"sessionId":session_id}}));
    let fork = fork["result"]["sessionId"].as_str().unwrap_or_else(|| panic!("{fork}")).to_owned();
    complete_turn(&mut rpc, 9, &fork);

    let requests = seen.lock().unwrap();
    assert_eq!(requests.len(), 3, "{requests:?}");
    for body in requests.iter() {
        let systems: Vec<&serde_json::Value> = body["messages"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|message| message["role"] == "system")
            .collect();
        assert_eq!(systems.len(), 1, "{body}");
        assert_eq!(system_text(body).as_deref(), Some(prompt), "{body}");
        let wire = body.to_string();
        for jan_text in ["Jan agent harness", "Today's date is", "# Working Directory"] {
            assert!(!wire.contains(jan_text), "{jan_text:?} leaked into {body}");
        }
    }
    // Prefix stability on the host path, measured on the real requests: the
    // second turn's body extends the first byte for byte (same tools, same
    // system message, same history), so a provider's prompt cache holds. Jan
    // puts no per-turn tail on a host prompt, so nothing -- not even the date
    // -- can move bytes the host owns.
    let bytes = |body: &serde_json::Value, key: &str| serde_json::to_string(&body[key]).unwrap();
    assert_eq!(bytes(&requests[0], "tools"), bytes(&requests[1], "tools"));
    let first = requests[0]["messages"].as_array().unwrap();
    let second = requests[1]["messages"].as_array().unwrap();
    assert!(second.len() > first.len(), "{second:?}");
    assert_eq!(
        serde_json::to_string(first).unwrap(),
        serde_json::to_string(&second[..first.len()]).unwrap(),
        "the second turn rewrote bytes the first had sent"
    );
    drop(requests);

    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}

/// Run `git` in `dir`, failing the test on a non-zero exit.
fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"])
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("git runs");
    assert!(status.success(), "git {args:?}");
}

/// The session-start snapshot is taken once, at `session/start`. A model
/// switch and a fork rebuild the agent but keep it, so a branch switch between
/// turns moves no byte of the system prompt and each request's system message
/// is the one the first request sent.
#[test]
fn a_rebuilt_agent_keeps_the_session_start_snapshot() {
    let scratch = scratch("session-start-kept");
    let home = scratch.join("home");
    let project = scratch.join("project");
    git(&project, &["init", "-q", "-b", "first"]);
    git(&project, &["commit", "-q", "--allow-empty", "-m", "init"]);
    let (url, seen) = scripted_provider(&[PROSE]);
    configure(&home, &url);
    let mut rpc = Rpc::open(&home);
    rpc.handshake();

    let session_id = start_with(&mut rpc, 3, &project, true);
    complete_turn(&mut rpc, 4, &session_id);
    git(&project, &["checkout", "-q", "-b", "second"]);
    let set = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":5,"method":"session/model/set","params":{"sessionId":session_id,"model":"stub-model"}}));
    assert_eq!(set["result"]["model"], "stub-model", "{set}");
    complete_turn(&mut rpc, 6, &session_id);
    let fork = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":7,"method":"session/fork","params":{"sessionId":session_id}}));
    let fork = fork["result"]["sessionId"].as_str().unwrap_or_else(|| panic!("{fork}")).to_owned();
    complete_turn(&mut rpc, 8, &fork);

    let requests = seen.lock().unwrap();
    assert_eq!(requests.len(), 3, "{requests:?}");
    let first = serde_json::to_string(&requests[0]["messages"][0]).unwrap();
    assert!(first.contains("Starting branch: `first`"), "{first}");
    for body in requests.iter() {
        let systems: Vec<&serde_json::Value> = body["messages"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|message| message["role"] == "system")
            .collect();
        assert_eq!(systems.len(), 1, "a second system prompt was appended: {body}");
        assert_eq!(serde_json::to_string(systems[0]).unwrap(), first, "{body}");
    }
    drop(requests);

    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}

/// With built-ins on, a child asking for a plugin tool by its wire name gets
/// that plugin tool even though the host declared a tool under the same bare
/// name, and a bare host name (`robot_arm_move`) still resolves to the host
/// tool. What the parent could reach is recorded by the run itself, so this
/// fails if that record stops being filled.
#[test]
fn a_child_keeps_the_parents_tool_over_a_host_tool_of_the_same_name() {
    let scratch = scratch("host-delegate-collide");
    let home = scratch.join("home");
    let project = scratch.join("project");
    let plugin = store(&home, &project).join("plugins").join("p");
    std::fs::create_dir_all(&plugin).unwrap();
    std::fs::write(
        plugin.join("plugin.toml"),
        "name = \"p\"\n\n[[tools]]\nname = \"echo\"\ndescription = \"Echo\"\ncommand = \"true\"\n",
    )
    .unwrap();
    let dispatch = tool_call_reply(
        "dispatch_subagent",
        serde_json::json!({"subagents":[{"name":"mover","task":"say hi",
            "allowed_tools":["plugin__p__echo","robot_arm_move"]}]}),
    );
    let (url, seen) = routed_provider(move |_, body| {
        let answered = body["messages"]
            .as_array()
            .is_some_and(|messages| messages.iter().any(|m| m["role"] == "tool"));
        let parent = advertised(body).iter().any(|name| name == "dispatch_subagent");
        if parent && !answered { dispatch } else { PROSE }
    });
    configure(&home, &url);
    let mut rpc = Rpc::open(&home);
    rpc.handshake();
    let lookalike = serde_json::json!({"name":"plugin__p__echo","description":"The host's own echo."});
    let started = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":3,"method":"session/start","params":{
        "cwd":project,"model":"stub-model","tools":[arm_tool(),lookalike],"permissions":"host","ephemeral":true
    }}));
    let session_id = started["result"]["sessionId"].as_str().unwrap_or_else(|| panic!("{started}")).to_owned();
    complete_turn(&mut rpc, 4, &session_id);

    let requests = seen.lock().unwrap();
    let parent = requests
        .iter()
        .map(advertised)
        .find(|names| names.iter().any(|name| name == "dispatch_subagent"))
        .unwrap_or_else(|| panic!("the parent made no request: {requests:?}"));
    assert!(parent.iter().any(|name| name == "plugin__p__echo"), "{parent:?}");
    let child: Vec<Vec<String>> = requests
        .iter()
        .map(advertised)
        .filter(|names| !names.iter().any(|name| name == "dispatch_subagent"))
        .collect();
    assert!(!child.is_empty(), "the child made no request: {requests:?}");
    for names in &child {
        assert!(names.iter().any(|name| name == "plugin__p__echo"), "{names:?}");
        assert!(names.iter().any(|name| name == "host__robot_arm_move"), "{names:?}");
        assert!(
            !names.iter().any(|name| name.starts_with("host__plugin")),
            "the host's lookalike took the plugin tool's place: {names:?}"
        );
    }
    drop(requests);

    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}

/// A host-prompted session still leaves its answers for later recall -- only
/// the recall block itself, which Jan would write into the host's prompt, is
/// withheld. The later Jan-prompted session in the same project proves the
/// answer was indexed; the host-prompted turns prove nothing was recalled
/// into them.
#[test]
fn a_host_prompted_session_indexes_memory_but_is_never_sent_recall() {
    let scratch = scratch("host-prompt-memory");
    let home = scratch.join("home");
    let (url, seen) = scripted_provider(&[PROSE]);
    configure(&home, &url);
    let mut rpc = Rpc::open(&home);
    rpc.handshake();
    let project = scratch.join("project");

    let host_session = |rpc: &mut Rpc, id: u64| {
        let started = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":id,"method":"session/start","params":{
            "cwd":project,"model":"stub-model","systemPrompt":"You drive the arm."
        }}));
        started["result"]["sessionId"].as_str().unwrap_or_else(|| panic!("{started}")).to_owned()
    };
    let first = host_session(&mut rpc, 3);
    complete_turn(&mut rpc, 4, &first);
    let second = host_session(&mut rpc, 5);
    complete_turn(&mut rpc, 6, &second);
    assert_eq!(recalled(&seen), 0, "no host-prompted turn is sent recall");
    // The saved thread keeps the prompt it was written under, so reopening it
    // (the TUI's `/resume`) does not fall back to Jan's.
    let thread = std::fs::read_to_string(
        store(&home, &project).join("threads").join(&first).join("thread.json"),
    )
    .expect("the host-prompted session was saved");
    let thread: serde_json::Value = serde_json::from_str(&thread).unwrap();
    assert_eq!(thread["metadata"]["system_prompt"], "You drive the arm.", "{thread}");

    let jan = start_with(&mut rpc, 7, &project, false);
    complete_turn(&mut rpc, 8, &jan);
    assert_eq!(recalled(&seen), 1, "the host-prompted answers were indexed");

    rpc.close();
    let _ = std::fs::remove_dir_all(scratch);
}
