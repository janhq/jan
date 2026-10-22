//! Real loopback HTTP through Jan's proxy; the upstream is an echo fixture.
use super::proxy;
use crate::core::{mcp::models::McpSettings, state::ProviderConfig};
use http_body_util::{BodyExt, Full};
use hyper::{body::Bytes, service::service_fn, Response};
use hyper_util::rt::TokioIo;
use serde_json::{json, Value};
use std::{collections::HashMap, convert::Infallible, sync::Arc};
use tauri_plugin_llamacpp::state::LlamacppState;
use tokio::sync::Mutex;

fn available_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

#[tokio::test]
async fn systemone_routes_model_preserves_payload_and_keeps_auth() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_port = listener.local_addr().unwrap().port();
    let upstream = tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            tokio::spawn(async move {
                hyper::server::conn::http1::Builder::new()
                    .serve_connection(TokioIo::new(stream), service_fn(|req: hyper::Request<hyper::body::Incoming>| async move {
                        assert_eq!(req.uri().path(), "/v1/systemone");
                        assert_eq!(req.headers()["authorization"], "Bearer upstream-test-key");
                        let body: Value = serde_json::from_slice(&req.into_body().collect().await.unwrap().to_bytes()).unwrap();
                        Ok::<_, Infallible>(Response::builder().header("content-type", "application/json").body(Full::new(Bytes::from(json!({"echo":body,"answers":{"refund":{"noul":0.9}},"usage":{"output_tokens":0}}).to_string()))).unwrap())
                    })).await.unwrap();
            });
        }
    });
    let handle = Arc::new(Mutex::new(None));
    let providers = Arc::new(Mutex::new(HashMap::from([(
        "fixture".into(),
        ProviderConfig {
            provider: "fixture".into(),
            api_key: Some("upstream-test-key".into()),
            base_url: Some(format!("http://127.0.0.1:{upstream_port}/v1")),
            models: vec!["d1-test".into()],
            ..Default::default()
        },
    )])));
    let port = proxy::start_server(
        handle.clone(),
        Arc::new(LlamacppState::new()),
        Arc::new(Mutex::new(HashMap::new())),
        "127.0.0.1".into(),
        available_port(),
        "/custom/v1".into(),
        "local-test-key".into(),
        vec![vec!["127.0.0.1".into()]],
        30,
        providers,
        Arc::new(Mutex::new(HashMap::new())),
        Arc::new(Mutex::new(HashMap::new())),
        Arc::new(Mutex::new(
            serde_json::from_value::<McpSettings>(json!({})).unwrap(),
        )),
        String::new(),
        true,
    )
    .await
    .unwrap();
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/custom/v1/systemone");
    let body = json!({"model":"d1-test","state":{"messages":[{"role":"user","content":"Keep all state bytes semantically intact"}]},
        "messages":[{"role":"user","content":"x-anthropic-billing-header: test\nKeep this decision input"}],
        "questions":{"refund":{"type":"noul","instructions":"Is a refund requested?"},
        "team":{"type":"choice","instructions":"Pick a team","criteria":{"billing":"Refunds","technical":"App faults"}},
        "urgency":{"type":"score","instructions":"Urgency","criteria":["Can wait","Today","Blocked"]}},
        "images":["data:image/png;base64,fixture"]});
    assert_eq!(
        client.post(&url).json(&body).send().await.unwrap().status(),
        401
    );
    let response = client
        .post(&url)
        .bearer_auth("local-test-key")
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let answer: Value = response.json().await.unwrap();
    assert_eq!(answer["echo"], body);
    assert_eq!(answer["usage"]["output_tokens"], 0);
    assert_eq!(
        client
            .post(&url)
            .bearer_auth("local-test-key")
            .json(&json!({"state":"test","questions":{}}))
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(
        client
            .post(&url)
            .bearer_auth("local-test-key")
            .body("not json")
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    assert_eq!(
        client
            .post(&url)
            .bearer_auth("local-test-key")
            .json(&json!({"model":"unknown","state":null,"questions":{}}))
            .send()
            .await
            .unwrap()
            .status(),
        503
    );
    handle.lock().await.take().unwrap().abort();
    upstream.abort();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires JAN_D1_TEST_WORKER and JAN_D1_TEST_MODEL pointing to real local files"]
async fn systemone_real_d1_through_local_api() {
    let worker = std::env::var("JAN_D1_TEST_WORKER").expect("worker path");
    let model = std::env::var("JAN_D1_TEST_MODEL").expect("GGUF path");
    let temp = tempfile::tempdir().unwrap();
    let preset = temp.path().join("d1.ini");
    let mut ini=format!("[*]\nfit = off\nctx-size = 4096\nn-gpu-layers = 99\nparallel = 1\n\n[d1-test]\nmodel = {model}\nload-on-startup = false\n");
    if let Ok(chat_model) = std::env::var("JAN_D1_TEST_CHAT_MODEL") {
        ini.push_str(&format!(
            "\n[chat-test]\nmodel = {chat_model}\nload-on-startup = false\n"
        ));
    }
    std::fs::write(&preset, ini).unwrap();
    let child = tauri_plugin_llamacpp::engine::worker::spawn(
        std::path::Path::new(&worker),
        &preset,
        0,
        "worker-test-key",
        1,
        0,
        HashMap::new(),
        None,
    )
    .await
    .unwrap();
    let state = Arc::new(LlamacppState::new());
    *state.engine.lock().await = Some(child);
    let handle = Arc::new(Mutex::new(None));
    let port = proxy::start_server(
        handle.clone(),
        state.clone(),
        Arc::new(Mutex::new(HashMap::new())),
        "127.0.0.1".into(),
        available_port(),
        "/v1".into(),
        "local-test-key".into(),
        vec![vec!["127.0.0.1".into()]],
        120,
        Arc::new(Mutex::new(HashMap::new())),
        Arc::new(Mutex::new(HashMap::new())),
        Arc::new(Mutex::new(HashMap::new())),
        Arc::new(Mutex::new(
            serde_json::from_value::<McpSettings>(json!({})).unwrap(),
        )),
        temp.path().to_string_lossy().into_owned(),
        false,
    )
    .await
    .unwrap();
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/v1/systemone");
    let response=client.post(&url).bearer_auth("local-test-key").json(&json!({
        "model":"d1-test","state":"I was charged twice this month, please refund one of them.",
        "questions":{"refund":{"type":"noul","instructions":"Is the customer asking for a refund?"},
        "team":{"type":"choice","instructions":"Which team should handle this?","criteria":{"billing":"Charges, refunds, invoices","technical":"App faults"}},
        "urgency":{"type":"score","instructions":"How urgent is this?","criteria":["Can wait","Today","Blocking the customer now"]}}
    })).send().await.unwrap();
    let status = response.status();
    let answer: Value = response.json().await.unwrap();
    let invalid=client.post(&url).bearer_auth("local-test-key").json(&json!({"model":"d1-test","state":"test","questions":{"bad":{"type":"invalid","instructions":"test"}}})).send().await.unwrap().status();
    let chat = if std::env::var_os("JAN_D1_TEST_CHAT_MODEL").is_some() {
        let response=client.post(format!("http://127.0.0.1:{port}/v1/chat/completions")).bearer_auth("local-test-key").json(&json!({
            "model":"chat-test","messages":[{"role":"user","content":"Say hello."}],"max_tokens":8,"temperature":0,"stream":false
        })).send().await.unwrap();
        assert_eq!(response.status(), 200);
        Some(response.json::<Value>().await.unwrap())
    } else {
        None
    };
    handle.lock().await.take().unwrap().abort();
    state.engine.lock().await.take().unwrap().stop().await;
    assert_eq!(status, 200, "{answer}");
    assert_eq!(answer["usage"]["output_tokens"], 0);
    assert!(answer["usage"]["input_tokens"].as_u64().unwrap() > 0);
    assert!(answer["answers"]["refund"]["noul"]
        .as_f64()
        .is_some_and(|p| (0.0..=1.0).contains(&p)));
    assert!(answer["answers"]["team"]["choice"].is_string());
    assert!(answer["answers"]["urgency"]["score"].is_number());
    assert_eq!(invalid, 400);
    if let Some(chat) = chat {
        assert!(chat["usage"]["completion_tokens"].as_u64().unwrap() > 0);
        println!(
            "CHAT_REGRESSION_TOKENS={}",
            chat["usage"]["completion_tokens"]
        );
    }
    println!("REAL_D1_RESULT={answer}");
}
