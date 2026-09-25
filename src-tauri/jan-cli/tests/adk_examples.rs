//! The ADK cookbook's runnable source, run.
//!
//! Every file under `examples/adk/` is executed with its own interpreter
//! (`node`, `python3`) against the real `jan` binary, which talks to a scripted
//! stub provider on a loopback port. So a recipe that stops working -- a record
//! renamed, a message shape changed, a flag removed -- fails here instead of in
//! a reader's terminal. The stub records every request, which is how the
//! host-tool case proves the tool result reached the model rather than only
//! that the example printed something.
//!
//! The docs pages quote these files. A fenced block whose meta names
//! `filename="examples/adk/..."` must be a verbatim excerpt of that file,
//! so a page cannot drift from the source this test runs.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("repo root")
}

/// One streamed completion that answers with `text`.
fn text_reply(text: &str) -> String {
    let chunk = serde_json::json!({
        "id": "stub", "object": "chat.completion.chunk", "created": 1, "model": "stub-model",
        "choices": [{ "index": 0, "delta": { "role": "assistant", "content": text }, "finish_reason": null }],
    });
    let end = serde_json::json!({
        "id": "stub", "object": "chat.completion.chunk", "created": 1, "model": "stub-model",
        "choices": [{ "index": 0, "delta": {}, "finish_reason": "stop" }],
    });
    format!("data: {chunk}\n\ndata: {end}\n\ndata: [DONE]\n\n")
}

/// One streamed completion that calls `name` with `arguments`.
fn tool_call_reply(name: &str, arguments: serde_json::Value) -> String {
    let call = serde_json::json!({
        "id": "stub", "object": "chat.completion.chunk", "created": 1, "model": "stub-model",
        "choices": [{
            "index": 0,
            "delta": {
                "role": "assistant",
                "tool_calls": [{
                    "index": 0, "id": "call_1", "type": "function",
                    "function": { "name": name, "arguments": arguments.to_string() },
                }],
            },
            "finish_reason": null,
        }],
    });
    let end = serde_json::json!({
        "id": "stub", "object": "chat.completion.chunk", "created": 1, "model": "stub-model",
        "choices": [{ "index": 0, "delta": {}, "finish_reason": "tool_calls" }],
    });
    format!("data: {call}\n\ndata: {end}\n\ndata: [DONE]\n\n")
}

/// A provider that answers request N with `replies[N]` (the last one repeats)
/// and keeps every request body it was sent.
struct Stub {
    url: String,
    requests: Arc<Mutex<Vec<serde_json::Value>>>,
}

fn stub_provider(replies: Vec<String>) -> Stub {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind the stub provider");
    let url = format!("http://{}/v1", listener.local_addr().expect("stub address"));
    let requests = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&requests);
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let Some(body) = read_body(&mut stream) else {
                let _ = stream.write_all(
                    b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
                );
                continue;
            };
            let n = {
                let mut seen = seen.lock().unwrap();
                seen.push(body);
                seen.len() - 1
            };
            let reply = &replies[n.min(replies.len() - 1)];
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{reply}",
                reply.len()
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
        }
    });
    Stub { url, requests }
}

/// Read one request and return its JSON body. `None` for anything that is not
/// a JSON POST, so a stray probe cannot shift the script.
fn read_body(stream: &mut TcpStream) -> Option<serde_json::Value> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => return None,
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
            return serde_json::from_slice(&buf[head + 4..head + 4 + want]).ok();
        }
    }
}

/// A private home and data folder, with the stub registered as the only
/// provider through the CLI's own config writer.
struct Scratch {
    root: PathBuf,
}

impl Scratch {
    fn new(name: &str, stub: &Stub) -> Self {
        let root = std::env::temp_dir().join(format!("jan-adk-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("home")).expect("scratch home");
        let scratch = Self { root };
        let out = scratch
            .command(env!("CARGO_BIN_EXE_jan"))
            .args([
                "config",
                "set",
                "--provider",
                "stub",
                "--api-key",
                "test-key",
                "--base-url",
                &stub.url,
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
        scratch
    }

    fn command(&self, program: &str) -> Command {
        let mut cmd = Command::new(program);
        cmd.env("HOME", self.root.join("home"))
            .env("JAN_DATA_FOLDER", self.root.join("jan-data"))
            .env("JAN_BIN", env!("CARGO_BIN_EXE_jan"))
            .env_remove("JAN_MODEL")
            .env_remove("JAN_API_KEY")
            .env_remove("OPENAI_API_KEY")
            .env_remove("ANTHROPIC_API_KEY");
        cmd
    }

    /// Run one example the way its header comment says to. Bounded: a recipe
    /// that stops answering the run (a renamed record it no longer matches)
    /// would otherwise leave both processes waiting on each other forever.
    fn example(&self, file: &str) -> Output {
        let path = repo_root().join("examples/adk").join(file);
        let interpreter = if file.ends_with(".py") {
            "python3"
        } else {
            "node"
        };
        let mut child = self
            .command(interpreter)
            .arg(&path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap_or_else(|e| {
                panic!("run `{interpreter} {file}` ({e}); is {interpreter} installed?")
            });
        // Drained on their own threads, so a chatty run cannot fill a pipe and
        // stall while this thread is only polling for the exit.
        let drain = |mut pipe: Box<dyn Read + Send>| {
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                let _ = pipe.read_to_end(&mut buf);
                buf
            })
        };
        let stdout = drain(Box::new(child.stdout.take().expect("stdout")));
        let stderr = drain(Box::new(child.stderr.take().expect("stderr")));
        let deadline = std::time::Instant::now() + Duration::from_secs(90);
        let status = loop {
            if let Some(status) = child.try_wait().expect("poll the example") {
                break status;
            }
            if std::time::Instant::now() > deadline {
                let _ = child.kill();
                let _ = child.wait();
                panic!(
                    "{file} did not finish within 90s.\nstdout:\n{}\nstderr:\n{}",
                    String::from_utf8_lossy(&stdout.join().unwrap_or_default()),
                    String::from_utf8_lossy(&stderr.join().unwrap_or_default())
                );
            }
            std::thread::sleep(Duration::from_millis(50));
        };
        Output {
            status,
            stdout: stdout.join().unwrap_or_default(),
            stderr: stderr.join().unwrap_or_default(),
        }
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn assert_ran(file: &str, out: &Output, answer: &str) {
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        out.status.success() && stdout.contains(answer),
        "{file} did not finish with the stub's answer.\nstatus: {}\nstdout:\n{stdout}\nstderr:\n{}",
        out.status,
        String::from_utf8_lossy(&out.stderr)
    );
}

fn first_turn(file: &str) {
    let stub = stub_provider(vec![text_reply("stub answer")]);
    let scratch = Scratch::new(&file.replace(['/', '.'], "-"), &stub);
    let out = scratch.example(file);
    assert_ran(file, &out, "stub answer");
}

/// The model calls the host tool, the example answers it, and the next request
/// the provider sees carries that answer as the tool's message.
fn host_tool(file: &str) {
    let stub = stub_provider(vec![
        tool_call_reply("host__get_weather", serde_json::json!({ "city": "Hanoi" })),
        text_reply("It is sunny in Hanoi."),
    ]);
    let scratch = Scratch::new(&file.replace(['/', '.'], "-"), &stub);
    let out = scratch.example(file);
    assert_ran(file, &out, "It is sunny in Hanoi.");

    let requests = stub.requests.lock().unwrap();
    let advertised = requests[0]["tools"].to_string();
    assert!(
        advertised.contains("host__get_weather"),
        "the first request does not offer the host tool: {advertised}"
    );
    let tool_message = requests
        .get(1)
        .and_then(|r| r["messages"].as_array())
        .and_then(|m| m.iter().find(|m| m["role"] == "tool"))
        .unwrap_or_else(|| panic!("no tool message reached the provider: {requests:?}"));
    let content = tool_message["content"].to_string();
    assert!(
        content.contains("sunny") && content.contains("Hanoi"),
        "the host's result is not what the model was sent: {content}"
    );
}

#[test]
fn js_first_turn_runs() {
    first_turn("js/first-turn.mjs");
}

#[test]
fn python_first_turn_runs() {
    first_turn("python/first_turn.py");
}

#[test]
fn js_host_tool_round_trips() {
    host_tool("js/host-tool.mjs");
}

#[test]
fn python_host_tool_round_trips() {
    host_tool("python/host_tool.py");
}

/// Every fenced block a docs page attributes to an example is a verbatim
/// excerpt of it, and every example the test runs is quoted somewhere.
#[test]
fn the_docs_quote_the_examples_verbatim() {
    let root = repo_root();
    let pages = root.join("docs/src/pages/docs/agent");
    let mut quoted = std::collections::BTreeSet::new();
    for entry in std::fs::read_dir(&pages).expect("agent docs") {
        let page = entry.expect("page").path();
        if page.extension().is_none_or(|e| e != "mdx") {
            continue;
        }
        let text = std::fs::read_to_string(&page).expect("read page");
        let mut lines = text.lines();
        while let Some(line) = lines.next() {
            let Some(rest) = line.trim_start().strip_prefix("```") else {
                continue;
            };
            let Some(file) = rest
                .split("filename=\"")
                .nth(1)
                .and_then(|s| s.split('"').next())
                .and_then(|f| f.strip_prefix("examples/adk/"))
            else {
                continue;
            };
            let block: Vec<&str> = lines
                .by_ref()
                .take_while(|l| l.trim_start() != "```")
                .collect();
            let source = std::fs::read_to_string(root.join("examples/adk").join(file))
                .unwrap_or_else(|e| {
                    panic!(
                        "{} quotes {file}, which cannot be read: {e}",
                        page.display()
                    )
                });
            // An excerpt from inside a function reads better without the
            // function's indentation, so both sides are compared dedented:
            // the lines and their relative indentation must match exactly.
            let excerpt = dedent(&block);
            let source_lines: Vec<&str> = source.lines().collect();
            let found = !excerpt.trim().is_empty()
                && source_lines
                    .windows(block.len())
                    .any(|window| dedent(window) == excerpt);
            assert!(
                found,
                "{} quotes {file}, but the block is not a verbatim excerpt of it:\n{excerpt}",
                page.display()
            );
            quoted.insert(file.to_string());
        }
    }
    for file in EXAMPLES {
        assert!(
            quoted.contains(file),
            "no docs page quotes examples/adk/{file}"
        );
    }
}

/// The examples the tests above run. A file added under `examples/adk/`
/// without a test here would be published untested, so the directory must
/// hold exactly these.
const EXAMPLES: [&str; 4] = [
    "js/first-turn.mjs",
    "js/host-tool.mjs",
    "python/first_turn.py",
    "python/host_tool.py",
];

#[test]
fn every_example_is_run() {
    let root = repo_root().join("examples/adk");
    let mut found = Vec::new();
    let mut dirs = vec![root.clone()];
    while let Some(dir) = dirs.pop() {
        for entry in std::fs::read_dir(&dir).expect("examples dir") {
            let path = entry.expect("entry").path();
            // `.DS_Store` and the like: not published, so not examples.
            if path
                .file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with('.'))
            {
                continue;
            }
            if path.is_dir() {
                dirs.push(path);
            } else {
                let rel = path.strip_prefix(&root).expect("under root");
                found.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    found.sort();
    assert_eq!(
        found, EXAMPLES,
        "every file under examples/adk/ needs a test that runs it"
    );
}

/// Lines with their shared leading whitespace removed, joined. Blank lines do
/// not count toward the shared indent, so a paragraph break inside a function
/// does not make the whole excerpt unindentable.
fn dedent(lines: &[&str]) -> String {
    let indent = lines
        .iter()
        .filter(|l| !l.trim().is_empty())
        .map(|l| l.len() - l.trim_start().len())
        .min()
        .unwrap_or(0);
    lines
        .iter()
        .map(|l| l.get(indent..).unwrap_or("").trim_end())
        .collect::<Vec<_>>()
        .join("\n")
}
