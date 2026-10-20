//! Opt-in OTLP export, through the real `jan` binary: a scripted provider, a
//! stand-in collector, and a one-shot stream-json run.
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const REPLY: &str = concat!(
    "data: {\"id\":\"stub-1\",\"object\":\"chat.completion.chunk\",\"created\":1,",
    "\"model\":\"stub-model\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",",
    "\"content\":\"hi there\"},\"finish_reason\":null}]}\n\n",
    "data: {\"id\":\"stub-1\",\"object\":\"chat.completion.chunk\",\"created\":1,",
    "\"model\":\"stub-model\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],",
    "\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":4,\"total_tokens\":13}}\n\n",
    "data: [DONE]\n\n",
);

type Seen = Arc<Mutex<Vec<(String, Vec<u8>)>>>;

/// Answer every HTTP request with `reply`, recording `(path, body)`. Serves as
/// both the model provider and the collector.
fn serve(content_type: &'static str, reply: &'static str) -> (String, Seen) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let seen: Seen = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen);
    std::thread::spawn(move || {
        for connection in listener.incoming() {
            let Ok(mut stream) = connection else { break };
            let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut request_line = String::new();
            let _ = reader.read_line(&mut request_line);
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
            let mut body = vec![0; size];
            if reader.read_exact(&mut body).is_err() {
                continue;
            }
            let path = request_line.split_whitespace().nth(1).unwrap_or("").to_string();
            sink.lock().unwrap().push((path, body));
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{reply}",
                reply.len()
            );
        }
    });
    (url, seen)
}

struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("jan-otel-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("home")).unwrap();
        std::fs::create_dir_all(root.join("project")).unwrap();
        Self(root)
    }

    fn command(&self) -> Command {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_jan"));
        cmd.env("HOME", self.0.join("home"))
            .env("JAN_DATA_FOLDER", self.0.join("jan-data"))
            .env("JAN_CLI_NO_UPDATE_CHECK", "1");
        for (key, _) in std::env::vars() {
            if key.starts_with("OTEL_") || key == "JAN_AGENT_ENABLE_TELEMETRY" {
                cmd.env_remove(key);
            }
        }
        cmd.env_remove("JAN_API_KEY")
            .env_remove("OPENAI_API_KEY")
            .env_remove("ANTHROPIC_API_KEY");
        cmd
    }

    fn configure(&self, base_url: &str) {
        let out = self
            .command()
            .args([
                "config", "set", "--provider", "stub", "--api-key", "test-key", "--base-url",
                base_url, "--model", "stub-model",
            ])
            .output()
            .unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    }

    fn run(&self, env: &[(&str, &str)]) -> Output {
        let project = self.0.join("project");
        let mut cmd = self.command();
        cmd.args([
            "cli",
            "agent",
            "run",
            "--project",
            project.to_str().unwrap(),
            "--model",
            "stub-model",
            "--provider",
            "stub",
            "--output-format",
            "stream-json",
            "say hi, my password is hunter2",
        ])
        .stdin(Stdio::null());
        for (k, v) in env {
            cmd.env(k, v);
        }
        cmd.output().unwrap()
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn stdout_is_protocol_only(out: &Output) {
    for line in String::from_utf8_lossy(&out.stdout).lines().filter(|l| !l.trim().is_empty()) {
        let record: serde_json::Value =
            serde_json::from_str(line).unwrap_or_else(|e| panic!("non-JSON stdout {line:?}: {e}"));
        assert!(record.get("type").is_some(), "{line}");
    }
}

#[test]
fn an_enabled_run_exports_metrics_and_logs_and_keeps_stdout_clean() {
    let scratch = Scratch::new("on");
    let (provider, _) = serve("text/event-stream", REPLY);
    scratch.configure(&format!("{provider}/v1"));
    let (collector, seen) = serve("application/json", "{}");

    let out = scratch.run(&[
        ("JAN_AGENT_ENABLE_TELEMETRY", "1"),
        ("OTEL_EXPORTER_OTLP_ENDPOINT", &collector),
        ("OTEL_EXPORTER_OTLP_PROTOCOL", "http/json"),
        ("OTEL_RESOURCE_ATTRIBUTES", "tenant.id=t-1"),
    ]);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    stdout_is_protocol_only(&out);

    let seen = seen.lock().unwrap().clone();
    let body = |path: &str| -> serde_json::Value {
        let (_, body) = seen
            .iter()
            .rev()
            .find(|(p, _)| p == path)
            .unwrap_or_else(|| panic!("no POST {path}: {:?}", seen.iter().map(|s| &s.0).collect::<Vec<_>>()));
        serde_json::from_slice(body).unwrap()
    };
    let metrics = body("/v1/metrics");
    let text = metrics.to_string();
    for name in ["jan_agent.session.count", "jan_agent.token.usage", "jan_agent.prompt.count"] {
        assert!(text.contains(name), "{name} missing from {text}");
    }
    assert!(text.contains("tenant.id") && text.contains("\"stub-model\""), "{text}");

    let all_logs: String = seen
        .iter()
        .filter(|(p, _)| p == "/v1/logs")
        .map(|(_, b)| String::from_utf8_lossy(b).into_owned())
        .collect();
    for name in ["jan_agent.user_prompt", "jan_agent.api_request"] {
        assert!(all_logs.contains(name), "{name} missing from {all_logs}");
    }
    // Content is gated off by default, and credentials never travel.
    assert!(!all_logs.contains("hunter2") && !text.contains("hunter2"));
    assert!(!all_logs.contains("test-key") && !text.contains("test-key"));
}

#[test]
fn nothing_is_sent_unless_telemetry_is_enabled() {
    let scratch = Scratch::new("off");
    let (provider, _) = serve("text/event-stream", REPLY);
    scratch.configure(&format!("{provider}/v1"));
    let (collector, seen) = serve("application/json", "{}");

    // The endpoint alone is not consent: it may be set for another program.
    let out = scratch.run(&[
        ("OTEL_EXPORTER_OTLP_ENDPOINT", &collector),
        ("OTEL_EXPORTER_OTLP_PROTOCOL", "http/json"),
    ]);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    std::thread::sleep(Duration::from_millis(200));
    assert!(seen.lock().unwrap().is_empty(), "{:?}", seen.lock().unwrap());
}
