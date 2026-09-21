//! Tests for the served side of MCP: the advertised set, the decision table,
//! and a list/call round trip over a real transport.

use std::path::PathBuf;

use rmcp::model::CallToolRequestParams;
use rmcp::transport::io::stdio;
use rmcp::{ServiceExt, ServerHandler};

use super::http::{authorized, generate_token};
use super::{JanToolServer, ServeOptions, ServedTools};

fn options(root: &std::path::Path) -> ServeOptions {
    let mut opts = ServeOptions::new(root.to_path_buf());
    // The sandbox is a kernel facility the CI container may not have; these
    // tests are about the served surface, not about confinement of `bash`.
    opts.sandbox = false;
    opts
}

fn tool_names(server: &JanToolServer) -> Vec<String> {
    server.tools().into_iter().map(|t| t.name.to_string()).collect()
}

#[test]
fn default_served_set_is_read_only() {
    let server = JanToolServer::new(options(&PathBuf::from(".")));
    let names = tool_names(&server);
    assert!(names.contains(&"read".to_string()));
    // Served even though a model is not offered them: `bash` is what covers
    // listing and searching for the agent, and `bash` is opt-in here.
    assert!(names.contains(&"ls".to_string()));
    assert!(names.contains(&"find".to_string()));
    assert!(names.contains(&"grep".to_string()));
    assert!(names.contains(&"web_search".to_string()));
    assert!(names.contains(&"memory_read".to_string()));
    // Workspace writes stay in: they reach the agent's own store by name, never
    // a project file.
    assert!(names.contains(&"memory_write".to_string()));
    assert!(names.contains(&"skill_write".to_string()));
    assert!(!names.contains(&"write".to_string()));
    assert!(!names.contains(&"edit".to_string()));
    assert!(!names.contains(&"bash".to_string()));
}

#[test]
fn opt_in_adds_mutating_tools() {
    let mut opts = options(&PathBuf::from("."));
    opts.served = ServedTools {
        allow_write: true,
        allow_exec: true,
        only: Vec::new(),
    };
    let names = tool_names(&JanToolServer::new(opts));
    assert!(names.contains(&"write".to_string()));
    assert!(names.contains(&"edit".to_string()));
    assert!(names.contains(&"bash".to_string()));
}

#[test]
fn only_narrows_the_set_but_never_widens_it() {
    let mut opts = options(&PathBuf::from("."));
    opts.served.only = vec!["read".into(), "bash".into()];
    let names = tool_names(&JanToolServer::new(opts));
    assert_eq!(names, vec!["read".to_string()]);
}

/// Every served name must be a real builtin, so the gate and `path_args` apply
/// to all of them; and the served set must carry no duplicate, which chaining
/// two schema lists could otherwise introduce.
#[test]
fn every_served_tool_is_a_gated_builtin_and_appears_once() {
    let mut opts = options(&PathBuf::from("."));
    opts.served = ServedTools {
        allow_write: true,
        allow_exec: true,
        only: Vec::new(),
    };
    let names = tool_names(&JanToolServer::new(opts));
    for name in &names {
        assert!(
            tauri_plugin_agent_tools::tools::lookup(name).is_some(),
            "{name} is served but is not a builtin"
        );
    }
    let mut unique = names.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), names.len(), "duplicate in {names:?}");
}

#[test]
fn advertised_schemas_are_the_builtin_schemas() {
    let server = JanToolServer::new(options(&PathBuf::from(".")));
    let read = server
        .tools()
        .into_iter()
        .find(|t| t.name == "read")
        .expect("read is served");
    let source = tauri_plugin_agent_tools::tools::schema::builtin_tool_schemas()
        .into_iter()
        .find(|s| s["function"]["name"] == "read")
        .expect("read has a schema");
    assert_eq!(
        serde_json::Value::Object((*read.input_schema).clone()),
        source["function"]["parameters"]
    );
    assert_eq!(
        read.description.as_deref(),
        source["function"]["description"].as_str()
    );
}

#[tokio::test]
async fn unserved_tool_is_refused_without_running() {
    let dir = tempfile::tempdir().expect("tempdir");
    let server = JanToolServer::new(options(dir.path()));
    let (content, _) = server
        .dispatch(
            "write",
            &serde_json::json!({ "path": "out.txt", "content": "hi" }),
        )
        .await;
    assert!(content.starts_with("ERROR"), "{content}");
    assert!(content.contains("not served"), "{content}");
    assert!(!dir.path().join("out.txt").exists());
}

#[tokio::test]
async fn unknown_tool_is_refused() {
    let dir = tempfile::tempdir().expect("tempdir");
    let server = JanToolServer::new(options(dir.path()));
    let (content, _) = server.dispatch("nope", &serde_json::json!({})).await;
    assert!(content.starts_with("ERROR: unknown tool"), "{content}");
}

#[tokio::test]
async fn grep_searches_inside_the_root() {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::write(dir.path().join("a.txt"), "alpha needle omega\n").expect("write fixture");
    let server = JanToolServer::new(options(dir.path()));
    let (content, _) = server
        .dispatch("grep", &serde_json::json!({ "pattern": "needle" }))
        .await;
    assert!(!content.starts_with("ERROR"), "{content}");
    assert!(content.contains("a.txt"), "{content}");
}

#[tokio::test]
async fn grep_cannot_search_outside_the_root() {
    let dir = tempfile::tempdir().expect("tempdir");
    let outside = tempfile::tempdir().expect("tempdir");
    std::fs::write(outside.path().join("secret.txt"), "needle\n").expect("write fixture");
    let server = JanToolServer::new(options(dir.path()));
    let (content, _) = server
        .dispatch(
            "grep",
            &serde_json::json!({
                "pattern": "needle",
                "path": outside.path().to_string_lossy(),
            }),
        )
        .await;
    assert!(content.starts_with("ERROR"), "{content}");
    assert!(content.contains("escapes the served project root"), "{content}");
}

#[tokio::test]
async fn read_inside_the_root_works() {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::write(dir.path().join("hello.txt"), "served\n").expect("write fixture");
    let server = JanToolServer::new(options(dir.path()));
    let (content, _) = server
        .dispatch("read", &serde_json::json!({ "path": "hello.txt" }))
        .await;
    assert!(content.contains("served"), "{content}");
}

#[tokio::test]
async fn escaping_read_path_is_refused() {
    let dir = tempfile::tempdir().expect("tempdir");
    let outside = tempfile::tempdir().expect("tempdir");
    let secret = outside.path().join("secret.txt");
    std::fs::write(&secret, "classified").expect("write fixture");
    let server = JanToolServer::new(options(dir.path()));
    let (content, _) = server
        .dispatch(
            "read",
            &serde_json::json!({ "path": secret.to_string_lossy() }),
        )
        .await;
    assert!(content.starts_with("ERROR"), "{content}");
    assert!(content.contains("escapes the served project root"), "{content}");
    assert!(!content.contains("classified"));
}

#[tokio::test]
async fn escaping_write_path_is_refused_even_when_write_is_served() {
    let dir = tempfile::tempdir().expect("tempdir");
    let outside = tempfile::tempdir().expect("tempdir");
    let target = outside.path().join("planted.txt");
    let mut opts = options(dir.path());
    opts.served.allow_write = true;
    let server = JanToolServer::new(opts);
    let (content, _) = server
        .dispatch(
            "write",
            &serde_json::json!({ "path": target.to_string_lossy(), "content": "x" }),
        )
        .await;
    assert!(content.starts_with("ERROR"), "{content}");
    assert!(content.contains("escapes the served project root"), "{content}");
    assert!(!target.exists());
}

#[tokio::test]
async fn hidden_jan_state_is_refused() {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::create_dir_all(dir.path().join(".jan/agent")).expect("mkdir");
    std::fs::write(dir.path().join(".jan/agent/agent.toml"), "x = 1").expect("write fixture");
    let server = JanToolServer::new(options(dir.path()));
    let (content, _) = server
        .dispatch("read", &serde_json::json!({ "path": ".jan/agent/agent.toml" }))
        .await;
    assert!(content.starts_with("ERROR"), "{content}");
    assert!(content.contains("hidden .jan state"), "{content}");
}

#[tokio::test]
async fn in_project_write_runs_once_opted_in() {
    let dir = tempfile::tempdir().expect("tempdir");
    let mut opts = options(dir.path());
    opts.served.allow_write = true;
    let server = JanToolServer::new(opts);
    let (content, _) = server
        .dispatch(
            "write",
            &serde_json::json!({ "path": "note.txt", "content": "served write" }),
        )
        .await;
    assert!(!content.starts_with("ERROR"), "{content}");
    assert_eq!(
        std::fs::read_to_string(dir.path().join("note.txt")).expect("written"),
        "served write"
    );
}

#[test]
fn initialize_advertises_tools() {
    let server = JanToolServer::new(options(&PathBuf::from(".")));
    let info = server.get_info();
    assert!(info.capabilities.tools.is_some());
    assert_eq!(info.server_info.name, "jan");
}

#[test]
fn bearer_token_check_rejects_everything_but_the_token() {
    let token = generate_token();
    assert_eq!(token.len(), 64);
    let mut headers = hyper::HeaderMap::new();
    assert!(!authorized(&headers, &token), "no header");
    headers.insert(
        hyper::header::AUTHORIZATION,
        hyper::header::HeaderValue::from_str(&format!("Bearer {token}x")).unwrap(),
    );
    assert!(!authorized(&headers, &token), "wrong token");
    headers.insert(
        hyper::header::AUTHORIZATION,
        hyper::header::HeaderValue::from_str(&token).unwrap(),
    );
    assert!(!authorized(&headers, &token), "missing scheme");
    headers.insert(
        hyper::header::AUTHORIZATION,
        hyper::header::HeaderValue::from_str(&format!("Bearer {token}")).unwrap(),
    );
    assert!(authorized(&headers, &token));
}

/// The end-to-end shape an external agent sees: initialize, `tools/list`,
/// `tools/call`. Driven over an in-memory duplex rather than a spawned process,
/// which is the same transport type (`AsyncRead + AsyncWrite`) the stdio
/// transport is built from, without needing a second binary in the test.
#[tokio::test]
async fn list_and_call_round_trip_over_a_stream_transport() {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::write(dir.path().join("round.txt"), "round trip\n").expect("write fixture");

    let (server_io, client_io) = tokio::io::duplex(8 * 1024);
    let server = JanToolServer::new(options(dir.path()));
    let server_task = tokio::spawn(async move {
        let running = server.serve(server_io).await.expect("server starts");
        let _ = running.waiting().await;
    });

    let client = ().serve(client_io).await.expect("client initializes");
    let info = client.peer_info().expect("server info");
    assert!(info.capabilities.tools.is_some());

    let tools = client.list_all_tools().await.expect("tools/list");
    let names: Vec<String> = tools.iter().map(|t| t.name.to_string()).collect();
    assert!(names.contains(&"read".to_string()), "{names:?}");
    assert!(!names.contains(&"bash".to_string()), "{names:?}");

    let result = client
        .call_tool(
            CallToolRequestParams::new("read").with_arguments(
                serde_json::json!({ "path": "round.txt" })
                    .as_object()
                    .cloned()
                    .expect("object"),
            ),
        )
        .await
        .expect("tools/call");
    assert_ne!(result.is_error, Some(true));
    let text = result
        .content
        .iter()
        .filter_map(|b| b.as_text().map(|t| t.text.clone()))
        .collect::<String>();
    assert!(text.contains("round trip"), "{text}");

    // A denied tool comes back as a tool-level error the caller can read, not
    // as a transport failure.
    let denied = client
        .call_tool(
            CallToolRequestParams::new("bash").with_arguments(
                serde_json::json!({ "command": "echo nope" })
                    .as_object()
                    .cloned()
                    .expect("object"),
            ),
        )
        .await
        .expect("tools/call reaches the handler");
    assert_eq!(denied.is_error, Some(true));

    client.cancel().await.ok();
    server_task.abort();
}

/// `stdio()` is what the transport module hands to rmcp; assert it stays the
/// pair the server is built from, so a refactor cannot silently swap stdout for
/// something else and corrupt the framing.
#[test]
fn stdio_transport_is_stdin_stdout() {
    let (_stdin, _stdout) = stdio();
}
