//! The first line of a `stream-json` run is the `init` handshake -- for a run
//! that succeeds and for one whose first request fails.
//!
//! Driven through the real binary on purpose. The guarantee is about what
//! reaches stdout, and the printer writes to the process's own fd 1, which an
//! in-process test harness does not capture; a unit test could only assert that
//! the function is called before the run, not that nothing else got there
//! first.
//!
//! The provider is a stub on a loopback port speaking SSE, so the run needs no
//! credentials, no network, and no local engine.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::Duration;

/// A healthy completion, as the OpenAI streaming shape the engine parses.
const ANSWER: &str = concat!(
    "data: {\"id\":\"stub-1\",\"object\":\"chat.completion.chunk\",\"created\":1,",
    "\"model\":\"stub-model\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",",
    "\"content\":\"stub answer\"},\"finish_reason\":null}]}\n\n",
    "data: {\"id\":\"stub-1\",\"object\":\"chat.completion.chunk\",\"created\":1,",
    "\"model\":\"stub-model\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],",
    "\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2,\"total_tokens\":7}}\n\n",
    "data: [DONE]\n\n",
);

/// What a request the provider refuses looks like. A 4xx is refused outright
/// where a 5xx would be retried with backoff, which keeps this case as fast as
/// the healthy one while exercising the same path.
const REFUSAL: &str =
    "{\"error\":{\"message\":\"stub refused the request\",\"type\":\"invalid_request_error\"}}";

/// Serve one canned reply per connection until the test process exits, and
/// return the OpenAI-compatible base URL for it.
fn stub_provider(status: &'static str, content_type: &'static str, body: &'static str) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind the stub provider");
    let addr = listener.local_addr().expect("stub address");
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            read_request(&mut stream);
            let response = format!(
                "HTTP/1.1 {status}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        }
    });
    format!("http://{addr}/v1")
}

/// Read a request off the wire, headers and body. Without this the client sees
/// a reset instead of an answer, which would make a failure case pass for the
/// wrong reason.
fn read_request(stream: &mut TcpStream) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => return,
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
            return;
        }
    }
}

/// A private home and data folder per test, removed by the caller. Not
/// `tempfile`: this crate has no dev-dependency, and one is not worth adding
/// for two directories.
struct Scratch {
    root: PathBuf,
}

impl Scratch {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("jan-init-{name}-{}", std::process::id()));
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

    /// Register the stub as the one usable provider, through the CLI's own
    /// config writer so this test cannot drift from the file format.
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

    /// Run `jan cli agent run` to completion, machine-readable, with stdin
    /// closed. A `stream-json` reader that hits end of input is the ordinary
    /// case: the run keeps going, it just has no client left to talk to.
    fn run(&self) -> Output {
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
            "say hi",
        ])
        .stdin(Stdio::null())
        .output()
        .expect("run the jan CLI")
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
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// Parse stdout as the NDJSON stream it promises: one object per line, and a
/// non-empty first one.
fn records(out: &Output) -> Vec<serde_json::Value> {
    let stdout = String::from_utf8_lossy(&out.stdout);
    let lines: Vec<&str> = stdout.lines().filter(|l| !l.trim().is_empty()).collect();
    assert!(
        !lines.is_empty(),
        "no stream at all.\nstdout:\n{stdout}\nstderr:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    lines
        .iter()
        .map(|line| {
            serde_json::from_str(line)
                .unwrap_or_else(|e| panic!("not one JSON object per line: {e}\n{line}"))
        })
        .collect()
}

/// The handshake itself, field by field, and the ordering that makes it a
/// handshake: it is the first thing on the channel and it appears once.
fn assert_handshake(first: &serde_json::Value, project: &Path) {
    assert_eq!(
        first["type"], "init",
        "the first record is not the handshake"
    );
    assert_eq!(first["protocol_version"], 1);
    let session_id = first["session_id"].as_str().expect("a session id");
    assert!(!session_id.is_empty(), "the handshake names no session");
    assert_eq!(first["model"], "stub-model");
    assert_eq!(
        first["cwd"].as_str().expect("a cwd"),
        std::fs::canonicalize(project)
            .expect("canonical project")
            .to_string_lossy(),
    );
    let tools = first["tools"].as_array().expect("a tool list");
    assert!(
        tools.iter().any(|t| t == "read"),
        "the handshake advertises no read tool: {tools:?}"
    );
    assert_eq!(
        first["input_kinds"],
        serde_json::json!(["user", "abort", "permission", "tool_result"]),
        "a client is told what it may send back"
    );
    // The caps travel with the kinds, so a client that sends an image reads the
    // limits off the handshake instead of discovering them by rejection. Pinned
    // as literals: this is the published contract, not this build's internals.
    let parts = &first["input_content_parts"];
    assert_eq!(
        parts["mime_types"],
        serde_json::json!(["image/png", "image/jpeg", "image/gif", "image/webp"]),
        "a client is told which image types it may send"
    );
    assert_eq!(
        parts,
        &serde_json::json!({
            "mime_types": ["image/png", "image/jpeg", "image/gif", "image/webp"],
            "max_image_bytes": 5_242_880,
            "max_message_image_bytes": 10_485_760,
            "max_images": 8,
            "max_line_bytes": 16_777_216,
            "max_echo_bytes": 4_096,
        }),
        "the advertised caps are the ones the parser enforces"
    );
    assert!(
        first.get("tool_specs").is_none(),
        "a run that declared no host tools carries no specs: {first}"
    );
}

#[test]
fn a_successful_run_opens_with_the_handshake() {
    let scratch = Scratch::new("ok");
    let url = stub_provider("200 OK", "text/event-stream", ANSWER);
    scratch.configure(&url);

    let out = scratch.run();
    let records = records(&out);

    assert_handshake(&records[0], &scratch.project());
    assert_eq!(
        records.iter().filter(|r| r["type"] == "init").count(),
        1,
        "the handshake is emitted once"
    );

    let last = records.last().expect("a terminal record");
    assert_eq!(last["type"], "result", "the envelope terminates the stream");
    assert_eq!(
        last["is_error"], false,
        "the stub answered, so this run passes: {last}"
    );
    assert_eq!(last["result"], "stub answer");

    // The two ids are one session: the handshake carries it whole, the
    // envelope the short form `--resume` also accepts.
    let announced = records[0]["session_id"].as_str().expect("a session id");
    assert_eq!(
        last["session_id"].as_str().expect("a saved session"),
        &announced[..8],
        "the envelope must name the session the handshake announced"
    );
}

#[test]
fn a_failing_run_still_opens_with_the_handshake() {
    let scratch = Scratch::new("fail");
    let url = stub_provider("400 Bad Request", "application/json", REFUSAL);
    scratch.configure(&url);

    let out = scratch.run();
    let records = records(&out);

    assert_handshake(&records[0], &scratch.project());
    let last = records.last().expect("a terminal record");
    assert_eq!(last["type"], "result");
    assert_eq!(
        last["is_error"], true,
        "a refused request must fail the run: {last}"
    );
    assert_eq!(
        last["session_id"],
        serde_json::Value::Null,
        "nothing was saved, so the envelope names no session -- which is how a \
         client knows the id from `init` is not on disk"
    );
}

/// A run that fails before a model is resolved has no session and no tool set
/// to name, so it reports the failure and nothing else. Documented rather than
/// incidental: it is the one stream a client will not see a handshake on, and
/// `error.code` says which kind of failure it is.
#[test]
fn a_setup_failure_reports_the_envelope_without_a_handshake() {
    let scratch = Scratch::new("setup");
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
            "say hi",
        ])
        .stdin(Stdio::null())
        .output()
        .expect("run the jan CLI");

    let records = records(&out);
    assert_eq!(
        records.len(),
        1,
        "a setup failure reports once: {records:?}"
    );
    assert_eq!(records[0]["type"], "result");
    assert_eq!(records[0]["is_error"], true);
    assert_eq!(records[0]["error"]["code"], "setup_error");
    assert_eq!(records[0]["session_id"], serde_json::Value::Null);
}
