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
        project
            .join(".jan/agent/threads")
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

#[test]
fn failed_fork_does_not_close_other_sessions() {
    let scratch = scratch("failed-fork");
    let home = scratch.join("home");
    configure(&home, &provider(1, 0));
    let mut rpc = Rpc::open(&home);
    rpc.handshake();
    let project = scratch.join("project");
    let session_id = rpc.start_session(&project);
    std::fs::write(project.join(".jan/agent/agent.toml"), "[agent\n").unwrap();

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
            sink.lock()
                .unwrap()
                .push(serde_json::from_slice(&request).unwrap_or(serde_json::Value::Null));
            let reply = replies[index.min(replies.len() - 1)];
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
    assert!(tools.iter().any(|t| t == "bash"), "built-ins stay by default: {started}");
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

    let refused = rpc.ask(serde_json::json!({"jsonrpc":"2.0","id":3,"method":"session/start","params":{"cwd":project,"model":"stub-model","tools":[{"name":"bash"}]}}));
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
