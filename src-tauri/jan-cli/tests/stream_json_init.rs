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
    stub_provider_recording(status, content_type, body).0
}

/// The same, keeping every request body it was sent: what the provider received
/// is the only honest witness of what a run put on the wire.
#[allow(clippy::type_complexity)]
fn stub_provider_recording(
    status: &'static str,
    content_type: &'static str,
    body: &'static str,
) -> (String, std::sync::Arc<std::sync::Mutex<Vec<Vec<u8>>>>) {
    let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = std::sync::Arc::clone(&seen);
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind the stub provider");
    let addr = listener.local_addr().expect("stub address");
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            sink.lock().unwrap().push(read_request(&mut stream));
            let response = format!(
                "HTTP/1.1 {status}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        }
    });
    (format!("http://{addr}/v1"), seen)
}

/// Read a request off the wire, headers and body, returning the body. Without
/// this the client sees a reset instead of an answer, which would make a
/// failure case pass for the wrong reason.
fn read_request(stream: &mut TcpStream) -> Vec<u8> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let mut buf: Vec<u8> = Vec::new();
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
            return buf[head + 4..head + 4 + want].to_vec();
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
        self.run_task("say hi")
    }

    fn run_task(&self, task: &str) -> Output {
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
            task,
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

/// Every request a run sends is preceded by a `request_provenance` record, and
/// the record's digest is a deterministic function of the request Jan built.
/// That is the property a harness relies on to say two runs sent the same
/// thing, so it is the property pinned here: two identical runs report one
/// digest, and a different task does not.
///
/// The digest covers the body Jan built, before the provider adapter's own
/// serialization -- the record is identity for comparing runs, not a byte
/// audit of what a particular client put on the wire.
#[test]
fn a_run_reports_the_provenance_of_the_request_it_sends() {
    let scratch = Scratch::new("provenance");
    let (url, seen) = stub_provider_recording("200 OK", "text/event-stream", ANSWER);
    scratch.configure(&url);

    let first = scratch.run_task("say hi");
    assert!(
        first.status.success(),
        "the run failed: {}",
        String::from_utf8_lossy(&first.stderr)
    );
    let first_records = records(&first);
    let record = one_provenance(&first_records);
    assert_eq!(record["model"], "stub-model");
    assert_eq!(record["provider"], "stub");
    assert_eq!(
        record["session_id"],
        first_records[0]["session_id"],
        "the record names the session the handshake announced, not a derivation of it"
    );
    assert!(
        record.get("run_id").is_none() || record["run_id"].is_null(),
        "the main run is not a child: {record}"
    );
    assert!(
        record.get("api_type").is_none() || record["api_type"].is_null(),
        "chat/completions has no wire API name to report: {record}"
    );
    assert!(
        record["tools_sha256"].is_string(),
        "a run sends a tool array, so its digest is reported: {record}"
    );
    assert!(
        record.get("images").is_none(),
        "no images went out, so none are reported: {record}"
    );
    assert!(
        record["body_bytes"].as_u64().expect("a length") > 0,
        "the body has a size: {record}"
    );

    // The record belongs to the request that went out: the provider received a
    // body naming the model the record does.
    let bodies = seen.lock().unwrap().clone();
    let body: serde_json::Value = serde_json::from_slice(
        bodies.first().expect("the provider received the request"),
    )
    .expect("the request body is JSON");
    assert_eq!(body["model"], record["model"]);

    // Emitted before the call, which is what lets a harness record a request
    // whose reply it never gets.
    let at = |records: &Vec<serde_json::Value>, want: &str| {
        records
            .iter()
            .position(|r| r["type"] == want)
            .unwrap_or_else(|| panic!("no {want} record: {records:#?}"))
    };
    assert!(
        at(&first_records, "request_provenance") < at(&first_records, "token"),
        "the record precedes the answer it belongs to"
    );

    // Same task, same request: the digest is reproducible across runs.
    let again = scratch.run_task("say hi");
    let repeat = records(&again);
    assert_eq!(
        one_provenance(&repeat)["request_sha256"],
        record["request_sha256"],
        "an identical request must report an identical digest"
    );

    // A different task is a different request, so the digest must move: a
    // constant or mis-scoped hash would pass the check above.
    let other = scratch.run_task("say bye");
    let changed = records(&other);
    assert_ne!(
        one_provenance(&changed)["request_sha256"],
        record["request_sha256"],
        "a different request must report a different digest"
    );
}

/// The one `request_provenance` record of a single-request run.
fn one_provenance(records: &Vec<serde_json::Value>) -> &serde_json::Value {
    let found: Vec<&serde_json::Value> = records
        .iter()
        .filter(|r| r["type"] == "request_provenance")
        .collect();
    assert_eq!(
        found.len(),
        1,
        "one record per request, and this run makes one: {records:#?}"
    );
    found[0]
}
