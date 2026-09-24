//! `--host-tools` end to end, through the real binary.
//!
//! The guarantee here is about what crosses the process boundary: a declared
//! tool is advertised in the handshake, a call to it leaves as a `tool_request`
//! on stdout, and the `tool_result` the host writes to stdin becomes the tool
//! message the model sees on the next request. None of that is observable from
//! inside the process -- the printer writes to fd 1 and the reader reads fd 0 --
//! so the round trip is driven here rather than asserted one layer in.
//!
//! The provider is a stub on a loopback port: the first request is answered
//! with a tool call, the second with prose, which is the smallest exchange that
//! makes a host tool's result reach the model.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

/// The model calls the declared host tool. `host__` is the advertised name; the
/// host is told the bare one.
const TOOL_CALL: &str = concat!(
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

/// The turn after the tool result: plain prose, which ends the run.
const ANSWER: &str = concat!(
    "data: {\"id\":\"stub-2\",\"object\":\"chat.completion.chunk\",\"created\":1,",
    "\"model\":\"stub-model\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",",
    "\"content\":\"the arm reached bin\"},\"finish_reason\":null}]}\n\n",
    "data: {\"id\":\"stub-2\",\"object\":\"chat.completion.chunk\",\"created\":1,",
    "\"model\":\"stub-model\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],",
    "\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":4,\"total_tokens\":13}}\n\n",
    "data: [DONE]\n\n",
);

/// Serve `replies` in order, one per connection, repeating the last once they
/// run out. The bodies each request carried are kept so a test can assert what
/// the model was actually sent -- which is where a host tool's result has to
/// land for the round trip to mean anything.
fn stub_provider(replies: &'static [&'static str]) -> (String, Arc<std::sync::Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind the stub provider");
    let addr = listener.local_addr().expect("stub address");
    let seen: Arc<std::sync::Mutex<Vec<String>>> = Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen);
    let nth = AtomicUsize::new(0);
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let body = read_request(&mut stream);
            sink.lock().expect("request log").push(body);
            let i = nth.fetch_add(1, Ordering::SeqCst);
            let reply = replies[i.min(replies.len() - 1)];
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
                reply.len()
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        }
    });
    (format!("http://{addr}/v1"), seen)
}

/// Read one request off the wire and return its body. Without draining the
/// body the client sees a reset instead of an answer, which would make a
/// failure pass for the wrong reason.
fn read_request(stream: &mut TcpStream) -> String {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => return String::new(),
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
            return String::from_utf8_lossy(&buf[head + 4..]).to_string();
        }
    }
}

/// A private home and data folder per test, removed on drop.
struct Scratch {
    root: PathBuf,
}

impl Scratch {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("jan-host-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("scratch dir");
        Self { root }
    }

    fn home(&self) -> PathBuf {
        self.root.join("home")
    }

    fn project(&self) -> PathBuf {
        self.root.join("project")
    }

    /// Write a `--host-tools` file and return its path.
    fn declare(&self, contents: &str) -> PathBuf {
        let path = self.root.join("host-tools.json");
        std::fs::write(&path, contents).expect("write the declaration");
        path
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
            "config set failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn command(&self, args: &[&str]) -> Command {
        std::fs::create_dir_all(self.home()).expect("home dir");
        std::fs::create_dir_all(self.project()).expect("project dir");
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_jan"));
        cmd.args(args)
            .env("HOME", self.home())
            .env("JAN_DATA_FOLDER", self.root.join("jan-data"))
            .env_remove("JAN_API_KEY")
            .env_remove("OPENAI_API_KEY")
            .env_remove("ANTHROPIC_API_KEY");
        cmd
    }

    /// The duplex form: stdin stays open so a host can answer.
    fn spawn_duplex(&self, host_tools: &str) -> Child {
        let project = self.project();
        self.command(&[
            "cli",
            "agent",
            "run",
            "--project",
            project.to_str().expect("utf-8 path"),
            "--model",
            "stub-model",
            "--provider",
            "stub",
            "--output-format",
            "stream-json",
            "--input-format",
            "stream-json",
            "--host-tools",
            host_tools,
            "--max-turns",
            "4",
            "move the arm",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn the jan CLI")
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// One well-formed declaration, as a host would write it.
const DECL: &str = r#"[{"name":"robot_arm_move","description":"Move the arm.",
  "parameters":{"type":"object","properties":{"position":{"type":"string"}},
  "required":["position"]}}]"#;

fn records(out: &Output) -> Vec<serde_json::Value> {
    let stdout = String::from_utf8_lossy(&out.stdout);
    stdout
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            serde_json::from_str(line)
                .unwrap_or_else(|e| panic!("not one JSON object per line: {e}\n{line}"))
        })
        .collect()
}

/// The whole point of the flag: the model calls a tool this process cannot run,
/// the host runs it, and its answer reaches the model as the tool message.
///
/// Driven through the binary because every step of that sentence is a process
/// boundary -- stdout for the request, stdin for the answer, and the provider
/// request that proves the answer was actually carried into the next turn.
#[test]
fn a_declared_host_tool_round_trips_through_the_client() {
    let scratch = Scratch::new("round-trip");
    let (url, seen) = stub_provider(&[TOOL_CALL, ANSWER]);
    scratch.configure(&url);
    let decl = scratch.declare(DECL);

    let mut child = scratch.spawn_duplex(decl.to_str().expect("utf-8 path"));
    let mut stdin = child.stdin.take().expect("piped stdin");
    let stdout = BufReader::new(child.stdout.take().expect("piped stdout"));

    let mut handshake = None;
    let mut request = None;
    let mut echoed_result = false;
    for line in stdout.lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let msg: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        match msg["type"].as_str() {
            Some("init") => handshake = Some(msg),
            Some("tool_request") => {
                // Answer it exactly as a host would, then stop reading: the
                // rest of the run is the provider's to finish.
                let id = msg["request_id"].as_str().expect("a request id");
                writeln!(
                    stdin,
                    "{}",
                    serde_json::json!({
                        "type": "tool_result",
                        "request_id": id,
                        "content": "{\"ok\":true,\"position\":\"bin\"}",
                    })
                )
                .expect("answer the request");
                stdin.flush().expect("flush the answer");
                request = Some(msg);
            }
            // The run's own view of the answer, echoed back so a client can
            // see what the model was given. Read here rather than off the
            // collected output: this loop consumes stdout, so a record after
            // the one it breaks on would never be collected.
            Some("tool_result") => echoed_result = true,
            Some("result") => break,
            _ => {}
        }
    }
    drop(stdin);
    let out = child.wait_with_output().expect("collect the run");

    let handshake = handshake.expect("the run never sent a handshake");
    assert_eq!(
        handshake["tools"]
            .as_array()
            .expect("a tool list")
            .iter()
            .filter(|t| *t == "host__robot_arm_move")
            .count(),
        1,
        "the declared tool is advertised under its qualified name: {handshake}"
    );
    assert_eq!(
        handshake["tool_specs"][0]["function"]["name"], "host__robot_arm_move",
        "the handshake echoes the schema the host declared: {handshake}"
    );

    let request = request.expect("the model's call never reached the host");
    assert_eq!(
        request["tool_name"], "robot_arm_move",
        "the host is told the name it declared, not the prefixed one: {request}"
    );
    assert_eq!(request["args"]["position"], "bin");

    // The result has to arrive as the model's tool message, which is only
    // observable in what the provider was sent next.
    let requests = seen.lock().expect("request log");
    assert_eq!(
        requests.len(),
        2,
        "the run did not take a second turn, so the result never reached the model"
    );
    assert!(
        requests[1].contains("\\\"position\\\":\\\"bin\\\"")
            || requests[1].contains("{\\\"ok\\\":true"),
        "the host's answer is not in the follow-up request: {}",
        requests[1]
    );
    assert!(
        echoed_result,
        "the client is never shown the result the model was given"
    );
    assert!(
        out.status.success(),
        "the round trip did not end cleanly: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// A call answered on stdin needs a client reading stdout, so the flag requires
/// the duplex pairing -- and the refusal is reported *on the channel*, not just
/// as a human string on stderr. A machine consumer that gets an empty stdout
/// has nothing to act on.
#[test]
fn host_tools_without_a_duplex_channel_is_refused_on_the_stream() {
    let scratch = Scratch::new("pairing");
    let decl = scratch.declare(DECL);
    let project = scratch.project();

    let out = scratch
        .command(&[
            "cli",
            "agent",
            "run",
            "--project",
            project.to_str().expect("utf-8 path"),
            "--output-format",
            "stream-json",
            "--host-tools",
            decl.to_str().expect("utf-8 path"),
            "say hi",
        ])
        .stdin(Stdio::null())
        .output()
        .expect("run the jan CLI");

    assert!(!out.status.success(), "a refused run must not exit 0");
    let records = records(&out);
    assert_eq!(
        records.len(),
        1,
        "a setup failure is one record and no handshake: {records:?}"
    );
    assert_eq!(records[0]["type"], "result");
    assert_eq!(records[0]["is_error"], true);
    assert_eq!(records[0]["error"]["code"], "setup_error");
    assert!(
        records[0]["error"]["message"]
            .as_str()
            .expect("a message")
            .contains("--host-tools requires --input-format stream-json"),
        "the message names the flag that is wrong: {}",
        records[0]
    );
}

/// A mistyped path is the first failure a host is likely to hit, and it is
/// reported the same way: on the channel, before anything is spent.
#[test]
fn an_unreadable_declaration_is_refused_on_the_stream() {
    let scratch = Scratch::new("missing");
    let project = scratch.project();

    let out = scratch
        .command(&[
            "cli",
            "agent",
            "run",
            "--project",
            project.to_str().expect("utf-8 path"),
            "--output-format",
            "stream-json",
            "--input-format",
            "stream-json",
            "--host-tools",
            "/nonexistent/host-tools.json",
            "say hi",
        ])
        .stdin(Stdio::null())
        .output()
        .expect("run the jan CLI");

    assert!(!out.status.success());
    let records = records(&out);
    assert_eq!(records.len(), 1, "one record, no handshake: {records:?}");
    assert_eq!(records[0]["error"]["code"], "setup_error");
    assert!(
        records[0]["error"]["message"]
            .as_str()
            .expect("a message")
            .contains("cannot read --host-tools file"),
        "the message names the path that failed: {}",
        records[0]
    );
}

/// A tool named for one this process already runs is refused at declaration
/// time: the host has misunderstood whose implementation will run, and failing
/// at startup is kinder than letting it shadow a built-in for a whole session.
#[test]
fn a_reserved_name_is_refused_before_the_run_starts() {
    let scratch = Scratch::new("reserved");
    let decl = scratch.declare(r#"[{"name":"bash","description":"not yours"}]"#);
    let project = scratch.project();

    let out = scratch
        .command(&[
            "cli",
            "agent",
            "run",
            "--project",
            project.to_str().expect("utf-8 path"),
            "--output-format",
            "stream-json",
            "--input-format",
            "stream-json",
            "--host-tools",
            decl.to_str().expect("utf-8 path"),
            "say hi",
        ])
        .stdin(Stdio::null())
        .output()
        .expect("run the jan CLI");

    assert!(!out.status.success());
    let records = records(&out);
    assert_eq!(records[0]["error"]["code"], "setup_error");
    assert!(
        records[0]["error"]["message"]
            .as_str()
            .expect("a message")
            .contains("reserved"),
        "the message says the name is reserved: {}",
        records[0]
    );
}

/// The model calls `host__camera` with no arguments.
const CAMERA_CALL: &str = concat!(
    "data: {\"id\":\"stub-1\",\"object\":\"chat.completion.chunk\",\"created\":1,",
    "\"model\":\"stub-model\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",",
    "\"tool_calls\":[{\"index\":0,\"id\":\"call-1\",\"type\":\"function\",\"function\":",
    "{\"name\":\"host__camera\",\"arguments\":\"{}\"}}]},",
    "\"finish_reason\":null}]}\n\n",
    "data: {\"id\":\"stub-1\",\"object\":\"chat.completion.chunk\",\"created\":1,",
    "\"model\":\"stub-model\",\"choices\":[{\"index\":0,\"delta\":{},",
    "\"finish_reason\":\"tool_calls\"}],",
    "\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2,\"total_tokens\":7}}\n\n",
    "data: [DONE]\n\n",
);

/// The model calls the *mapped* wire name of the dotted `yam.move_ee_ik`:
/// sanitized stem plus the first 8 hex chars of sha256("yam.move_ee_ik").
const MAPPED_CALL: &str = concat!(
    "data: {\"id\":\"stub-1\",\"object\":\"chat.completion.chunk\",\"created\":1,",
    "\"model\":\"stub-model\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",",
    "\"tool_calls\":[{\"index\":0,\"id\":\"call-1\",\"type\":\"function\",\"function\":",
    "{\"name\":\"host__yam_move_ee_ik_c68bc455\",\"arguments\":\"{}\"}}]},",
    "\"finish_reason\":null}]}\n\n",
    "data: {\"id\":\"stub-1\",\"object\":\"chat.completion.chunk\",\"created\":1,",
    "\"model\":\"stub-model\",\"choices\":[{\"index\":0,\"delta\":{},",
    "\"finish_reason\":\"tool_calls\"}],",
    "\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2,\"total_tokens\":7}}\n\n",
    "data: [DONE]\n\n",
);

/// Run a duplex session, answering every `tool_request` with `answer(request)`,
/// and return every record up to and including the final `result`.
fn drive(
    scratch: &Scratch,
    decl: &str,
    answer: impl Fn(&serde_json::Value) -> serde_json::Value,
) -> (Vec<serde_json::Value>, Output) {
    let decl = scratch.declare(decl);
    let mut child = scratch.spawn_duplex(decl.to_str().expect("utf-8 path"));
    let mut stdin = child.stdin.take().expect("piped stdin");
    let stdout = BufReader::new(child.stdout.take().expect("piped stdout"));
    let mut seen = Vec::new();
    for line in stdout.lines() {
        let Ok(line) = line else { break };
        let Ok(msg) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let kind = msg["type"].as_str().unwrap_or_default().to_string();
        if kind == "tool_request" {
            writeln!(stdin, "{}", answer(&msg)).expect("answer the request");
            stdin.flush().expect("flush the answer");
        }
        seen.push(msg);
        if kind == "result" {
            break;
        }
    }
    drop(stdin);
    (seen, child.wait_with_output().expect("collect the run"))
}

/// A host answers with content parts: they become the tool message, while
/// `details` goes to the client as `tool_details` and never into a provider
/// request.
///
/// The provider sees the parts' text as the tool message and the image in the
/// user turn right after it: `genai`'s tool response is text-only, so the
/// bridge carries a tool's image there (`genai_bridge::flush_tool_images`).
/// The details never leave the host's side.
#[test]
fn host_result_parts_reach_the_model_and_details_do_not() {
    let scratch = Scratch::new("parts");
    let (url, seen) = stub_provider(&[CAMERA_CALL, ANSWER]);
    scratch.configure(&url);
    let (records, out) = drive(
        &scratch,
        r#"[{"name":"camera","description":"Grab a frame.","capability":"read"}]"#,
        |request| {
            serde_json::json!({
                "type": "tool_result",
                "request_id": request["request_id"],
                "content": [
                    { "type": "text", "text": "front camera" },
                    { "type": "image_url",
                      "image_url": { "url": "data:image/png;base64,QUJD" } }
                ],
                "details": { "marker": "DETAILS-ONLY-FOR-THE-HOST" }
            })
        },
    );
    assert!(
        out.status.success(),
        "the run did not end cleanly: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let requests = seen.lock().expect("request log");
    assert_eq!(requests.len(), 2, "the result never reached a second turn");
    let body: serde_json::Value =
        serde_json::from_str(&requests[1]).expect("the follow-up request is JSON");
    let tool_message = body["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .find(|m| m["role"] == "tool")
        .expect("a tool message in the follow-up")
        .clone();
    assert_eq!(
        tool_message["content"], "front camera",
        "the parts' text is the tool message: {tool_message}"
    );
    let messages = body["messages"].as_array().expect("messages");
    let tool_at = messages.iter().position(|m| m["role"] == "tool").expect("tool");
    let carried = &messages[tool_at + 1];
    assert_eq!(carried["role"], "user", "the image follows the tool message: {body}");
    assert!(
        carried["content"]
            .as_array()
            .expect("a content-part array")
            .iter()
            .any(|p| p["image_url"]["url"] == "data:image/png;base64,QUJD"),
        "the host's image reached the provider: {carried}"
    );
    assert!(
        !requests.iter().any(|r| r.contains("DETAILS-ONLY-FOR-THE-HOST")),
        "details leaked into a provider request"
    );

    // The client sees the text summary on `tool_result`, then the details.
    let tags: Vec<&str> = records.iter().filter_map(|r| r["type"].as_str()).collect();
    let result_at = tags.iter().position(|t| *t == "tool_result").expect("tool_result");
    assert_eq!(tags[result_at + 1], "tool_details", "{tags:?}");
    assert_eq!(records[result_at]["content"], "front camera");
    assert_eq!(
        records[result_at + 1]["details"]["marker"],
        "DETAILS-ONLY-FOR-THE-HOST"
    );
}

/// R14: a dotted host name is advertised under a provider-safe wire name, the
/// model calls that, and the host is asked under the name it declared.
#[test]
fn a_dotted_host_name_round_trips_through_its_wire_name() {
    let scratch = Scratch::new("dotted");
    let (url, seen) = stub_provider(&[MAPPED_CALL, ANSWER]);
    scratch.configure(&url);
    let (records, out) = drive(
        &scratch,
        r#"[{"name":"yam.move_ee_ik","description":"Move the arm."}]"#,
        |request| {
            serde_json::json!({
                "type": "tool_result",
                "request_id": request["request_id"],
                "content": "moved",
            })
        },
    );
    assert!(
        out.status.success(),
        "the run did not end cleanly: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let init = records.iter().find(|r| r["type"] == "init").expect("init");
    assert_eq!(
        init["tool_specs"][0]["function"]["name"], "host__yam_move_ee_ik_c68bc455",
        "{init}"
    );
    let request = records
        .iter()
        .find(|r| r["type"] == "tool_request")
        .expect("the mapped call reached the host");
    assert_eq!(request["tool_name"], "yam.move_ee_ik", "{request}");
    assert!(request.get("run_id").is_none(), "a main-run request has no run_id");
    let requests = seen.lock().expect("request log");
    assert_eq!(requests.len(), 2);
    assert!(requests[1].contains("moved"), "{}", requests[1]);
}
