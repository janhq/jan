//! RPC and stream-json are two serializers over one engine, driven through the
//! real binary. The same scripted scenario runs on both surfaces and the two
//! wire transcripts are compared: the permission decision a client sends must
//! reach the same gate and the same tool outcome, and one run's events must
//! reach both serializers as the same sequence.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// The model calls the declared actuator. An actuator is prompted on both
/// surfaces whatever their auto-approve setting, so the call always raises a
/// `permission_request` through the loop's registry.
const ACTUATOR_CALL: &str = concat!(
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

/// Plain prose, which ends the run.
const PROSE: &str = concat!(
    "data: {\"id\":\"stub-2\",\"object\":\"chat.completion.chunk\",\"created\":1,",
    "\"model\":\"stub-model\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",",
    "\"content\":\"the arm reached bin\"},\"finish_reason\":null}]}\n\n",
    "data: {\"id\":\"stub-2\",\"object\":\"chat.completion.chunk\",\"created\":1,",
    "\"model\":\"stub-model\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],",
    "\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":4,\"total_tokens\":13}}\n\n",
    "data: [DONE]\n\n",
);

const TASK: &str = "move the arm";

/// The host's answer when the gate lets the call through.
const HOST_ANSWER: &str = "arm at bin";

fn arm_tool() -> serde_json::Value {
    serde_json::json!({
        "name": "robot_arm_move",
        "description": "Move the arm.",
        "capability": "actuator",
        "parameters": {
            "type": "object",
            "properties": {"position": {"type": "string"}},
            "required": ["position"]
        }
    })
}

type Requests = Arc<Mutex<Vec<serde_json::Value>>>;

/// Serve `replies` in order, one per connection, repeating the last, and keep
/// every request body: the tool message the model is sent next is the outcome
/// both surfaces must agree on.
fn scripted_provider(replies: &'static [&'static str]) -> (String, Requests) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind the stub provider");
    let url = format!("http://{}/v1", listener.local_addr().expect("stub address"));
    let seen: Requests = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen);
    std::thread::spawn(move || {
        for (index, connection) in listener.incoming().enumerate() {
            let Ok(mut stream) = connection else { break };
            let body = read_request(&mut stream);
            sink.lock()
                .unwrap()
                .push(serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null));
            let reply = replies[index.min(replies.len() - 1)];
            let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}", reply.len());
            let _ = stream.flush();
        }
    });
    (url, seen)
}

fn read_request(stream: &mut TcpStream) -> Vec<u8> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => return Vec::new(),
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
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
            return buf[head + 4..].to_vec();
        }
    }
}

/// A private home, data folder and project per surface, removed on drop.
struct Scratch {
    root: PathBuf,
}

impl Scratch {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("jan-parity-{name}-{}", std::process::id()));
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
            .env_remove("JAN_API_KEY")
            .env_remove("OPENAI_API_KEY")
            .env_remove("ANTHROPIC_API_KEY");
        cmd
    }

    fn configure(&self, base_url: &str) {
        let out = self
            .command(&[
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
            .output()
            .expect("run `jan config set`");
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn spawn(&self, args: &[&str]) -> (Child, ChildStdin, BufReader<ChildStdout>) {
        let mut child = self
            .command(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn the jan CLI");
        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = BufReader::new(child.stdout.take().expect("piped stdout"));
        (child, stdin, stdout)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

impl Transcript {
    fn normalized(
        scratch: &Scratch,
        events: Vec<serde_json::Value>,
        requests: Vec<serde_json::Value>,
    ) -> Self {
        let n = |v: Vec<serde_json::Value>| v.iter().map(|x| normalize(scratch, x)).collect();
        Self {
            events: n(events),
            requests: n(requests),
        }
    }

    /// The first event of `kind`.
    fn event(&self, kind: &str) -> Option<&serde_json::Value> {
        self.events.iter().find(|e| e["type"] == kind)
    }

    fn count(&self, kind: &str) -> usize {
        self.events.iter().filter(|e| e["type"] == kind).count()
    }

    /// The tool message the model was sent after the gated call: the outcome a
    /// decision produces, as the provider received it.
    fn tool_message(&self) -> serde_json::Value {
        assert_eq!(self.requests.len(), 2, "one request per model turn");
        self.requests[1]["messages"]
            .as_array()
            .expect("a message list")
            .iter()
            .find(|m| m["role"] == "tool")
            .cloned()
            .expect("the follow-up request carries the tool message")
    }
}

/// Strip what legitimately differs between two processes running the same
/// scenario: each gets its own scratch directory (so its own project path, in
/// the prompt and the history) and its own session id. The provenance hash and
/// size cover a body that embeds that path, so they are dropped here and the
/// bodies themselves are compared instead -- a stronger check than the hash.
/// Nothing else is touched: every other byte must match.
fn normalize(scratch: &Scratch, value: &serde_json::Value) -> serde_json::Value {
    let mut text = value.to_string();
    // The canonical form first: on macOS the temp dir is a `/var` symlink to
    // `/private/var`, and the project root the run reports is canonical.
    let canonical = std::fs::canonicalize(&scratch.root).expect("scratch exists");
    for root in [canonical, scratch.root.clone()] {
        text = text.replace(root.to_str().expect("utf-8 path"), "<scratch>");
    }
    let mut value: serde_json::Value = serde_json::from_str(&text).expect("still JSON");
    if value["type"] == "request_provenance" {
        let event = value.as_object_mut().expect("an object");
        for key in ["session_id", "request_sha256", "body_bytes"] {
            assert!(
                event.remove(key).is_some(),
                "provenance carries {key}: {text}"
            );
        }
    }
    value
}

fn send(stdin: &mut ChildStdin, frame: serde_json::Value) {
    writeln!(stdin, "{frame}").expect("write a frame");
    stdin.flush().expect("flush the frame");
}

fn next(stdout: &mut BufReader<ChildStdout>) -> Option<serde_json::Value> {
    let mut line = String::new();
    if stdout.read_line(&mut line).expect("read stdout") == 0 {
        return None;
    }
    Some(serde_json::from_str(&line).unwrap_or_else(|e| panic!("not one JSON line: {e}\n{line}")))
}

/// What one surface put on the wire for the scenario, reduced to the parts the
/// two can share. Normalized on construction: see [`normalize`].
struct Transcript {
    /// Every `StreamEvent` the serializer wrote, in order.
    events: Vec<serde_json::Value>,
    /// Every request body the provider received.
    requests: Vec<serde_json::Value>,
}

/// The stream-json surface: one duplex `jan cli agent run`. The client answers
/// the permission prompt with a `permission` line and, when the gate opens, the
/// host call with a `tool_result` line.
fn run_stream_json(name: &str, decision: &str) -> Transcript {
    let scratch = Scratch::new(&format!("{name}-stream"));
    let (url, requests) = scripted_provider(&[ACTUATOR_CALL, PROSE]);
    scratch.configure(&url);
    let decl = scratch.root.join("host-tools.json");
    std::fs::write(&decl, serde_json::json!([arm_tool()]).to_string()).expect("declare");
    let project = scratch.project();
    // `--safe`: an RPC session never auto-approves, so the one-shot run is put
    // on the same gate setting before the two are compared.
    let (mut child, mut stdin, mut stdout) = scratch.spawn(&[
        "cli",
        "agent",
        "run",
        "--project",
        project.to_str().unwrap(),
        "--model",
        "stub-model",
        "--provider",
        "stub",
        "--safe",
        "--output-format",
        "stream-json",
        "--input-format",
        "stream-json",
        "--host-tools",
        decl.to_str().unwrap(),
        TASK,
    ]);
    let mut events = Vec::new();
    while let Some(record) = next(&mut stdout) {
        match record["type"].as_str() {
            // Records of the surface itself, not events of the run.
            Some("init") | Some("permission_decision") | Some("input_error") => continue,
            Some("result") => break,
            _ => {}
        }
        if record["type"] == "permission_request" {
            send(
                &mut stdin,
                serde_json::json!({
                    "type":"permission","request_id":record["request_id"],"decision":decision
                }),
            );
        }
        if record["type"] == "tool_request" {
            send(
                &mut stdin,
                serde_json::json!({
                    "type":"tool_result","request_id":record["request_id"],"content":HOST_ANSWER
                }),
            );
        }
        events.push(record);
    }
    drop(stdin);
    assert!(
        child.wait().expect("the run exits").success(),
        "the stream-json run failed"
    );
    let requests = requests.lock().unwrap().clone();
    Transcript::normalized(&scratch, events, requests)
}

/// The RPC surface: one `turn/start` on a session carrying the same tool. The
/// client answers the prompt with `permission/respond` and the host call with
/// `tool/respond`; every `item/*` notification's event is kept.
fn run_rpc(name: &str, decision: &str) -> Transcript {
    let scratch = Scratch::new(&format!("{name}-rpc"));
    let (url, requests) = scripted_provider(&[ACTUATOR_CALL, PROSE]);
    scratch.configure(&url);
    let (mut child, mut stdin, mut stdout) = scratch.spawn(&["cli", "agent", "rpc"]);
    send(
        &mut stdin,
        serde_json::json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
            "protocolVersion":1,"clientInfo":{"name":"parity","version":"1"},"capabilities":{}
        }}),
    );
    let init = next(&mut stdout).expect("initialize is answered");
    assert_eq!(init["result"]["protocolVersion"], 1, "{init}");
    send(
        &mut stdin,
        serde_json::json!({"jsonrpc":"2.0","method":"initialized","params":{}}),
    );
    send(
        &mut stdin,
        serde_json::json!({"jsonrpc":"2.0","id":2,"method":"session/start","params":{
            "cwd":scratch.project(),"model":"stub-model","tools":[arm_tool()]
        }}),
    );
    let started = next(&mut stdout).expect("session/start is answered");
    let session_id = started["result"]["sessionId"]
        .as_str()
        .unwrap_or_else(|| panic!("{started}"))
        .to_owned();
    send(
        &mut stdin,
        serde_json::json!({"jsonrpc":"2.0","id":3,"method":"turn/start","params":{
            "sessionId":session_id,"input":TASK
        }}),
    );
    let mut events = Vec::new();
    let mut next_id = 4;
    loop {
        let record = next(&mut stdout).expect("the turn completes before the channel closes");
        if record["method"] == "turn/completed" {
            assert_eq!(record["params"]["stopReason"], "completed", "{record}");
            break;
        }
        // A reply to one of this client's requests: every one must succeed.
        if record.get("id").is_some() {
            assert!(record["error"].is_null(), "a request was refused: {record}");
            continue;
        }
        let method = record["method"]
            .as_str()
            .expect("a notification")
            .to_owned();
        let event = record["params"]["event"].clone();
        assert_eq!(
            method,
            format!("item/{}", event["type"].as_str().unwrap()),
            "{record}"
        );
        if event["type"] == "permission_request" {
            send(
                &mut stdin,
                serde_json::json!({"jsonrpc":"2.0","id":next_id,"method":"permission/respond","params":{
                    "requestId":event["request_id"],"decision":decision
                }}),
            );
            next_id += 1;
        }
        if event["type"] == "tool_request" {
            send(
                &mut stdin,
                serde_json::json!({"jsonrpc":"2.0","id":next_id,"method":"tool/respond","params":{
                    "requestId":event["request_id"],"content":HOST_ANSWER
                }}),
            );
            next_id += 1;
        }
        events.push(event);
    }
    drop(stdin);
    assert!(
        child.wait().expect("the server exits").success(),
        "the RPC server failed"
    );
    let requests = requests.lock().unwrap().clone();
    Transcript::normalized(&scratch, events, requests)
}

/// A `permission/request` answered over RPC and the same prompt answered with a
/// stream-json `permission` line resolve the same gate -- the loop's
/// `PermissionRegistry` entry the prompt registered -- to the same decision and
/// the same tool outcome, for a grant and for a refusal.
///
/// The outcome is read where it becomes the model's: the tool message in the
/// provider's next request, plus whether the host was ever asked to run the
/// call. A surface that resolved the prompt by some other route (a default, a
/// second registry, an auto-approve) would differ in one of those.
#[test]
fn a_permission_answered_on_either_surface_reaches_the_same_outcome() {
    for (decision, runs) in [("allow_once", true), ("deny", false)] {
        let stream = run_stream_json(&format!("perm-{decision}"), decision);
        let rpc = run_rpc(&format!("perm-{decision}"), decision);

        // One prompt, raised by the loop's gate, identical on both wires.
        let prompt = stream
            .event("permission_request")
            .expect("stream-json prompts");
        assert_eq!(Some(prompt), rpc.event("permission_request"), "{decision}");
        assert_eq!(prompt["tool_name"], "host__robot_arm_move", "{prompt}");
        assert_eq!(prompt["prompt_kind"], "mcp", "{prompt}");
        assert_eq!(
            (
                stream.count("permission_request"),
                rpc.count("permission_request")
            ),
            (1, 1),
            "{decision}: one prompt each"
        );

        // The decision gates the host call the same way.
        assert_eq!(
            stream.count("tool_request"),
            usize::from(runs),
            "{decision}: stream-json"
        );
        assert_eq!(
            rpc.count("tool_request"),
            usize::from(runs),
            "{decision}: RPC"
        );

        // The same tool result, on the wire and in what the model is sent.
        let result = stream.event("tool_result").expect("the call resolves");
        assert_eq!(Some(result), rpc.event("tool_result"), "{decision}");
        let expected = if runs {
            serde_json::json!({"type":"tool_result","id":"call-1","content":HOST_ANSWER,"is_error":false})
        } else {
            serde_json::json!({"type":"tool_result","id":"call-1",
                "content":"ERROR: tool 'host__robot_arm_move' denied by user","is_error":true})
        };
        assert_eq!(result, &expected, "{decision}");
        let message = stream.tool_message();
        assert_eq!(message, rpc.tool_message(), "{decision}");
        assert!(
            message
                .to_string()
                .contains(expected["content"].as_str().unwrap()),
            "{decision}: {message}"
        );
    }
}

/// RPC is a serializer over the engine's `StreamEvent` source, not a second
/// loop: one scenario run on each surface yields the same event sequence --
/// every event, in order, equal after [`normalize`] -- and the provider is sent
/// the same requests. `run_rpc` also checks each notification is `item/<tag>`
/// over the event verbatim.
///
/// The scenario covers every kind of record a gated host tool turn produces,
/// so a surface that re-derived, reordered, dropped or added one fails here.
#[test]
fn both_serializers_observe_one_run_as_the_same_event_sequence() {
    let stream = run_stream_json("sequence", "allow_once");
    let rpc = run_rpc("sequence", "allow_once");

    let kinds = |t: &Transcript| -> Vec<String> {
        t.events
            .iter()
            .map(|e| e["type"].as_str().unwrap_or("?").to_owned())
            .collect()
    };
    assert_eq!(
        kinds(&stream),
        [
            "step",
            "request_provenance",
            "tool_call_started",
            "tool_call_args_delta",
            "turn_usage",
            "tool_call",
            "permission_request",
            "tool_request",
            "tool_result",
            "step",
            "request_provenance",
            "token",
            "turn_usage",
            "messages_updated",
            "done",
        ],
        "the scenario exercises the whole gated host tool turn"
    );
    assert_eq!(
        kinds(&stream),
        kinds(&rpc),
        "the two serializers saw different event kinds"
    );
    for (index, (s, r)) in stream.events.iter().zip(&rpc.events).enumerate() {
        assert_eq!(s, r, "event {index} differs between stream-json and RPC");
    }
    assert_eq!(
        stream.requests, rpc.requests,
        "the provider was sent different requests"
    );
}
