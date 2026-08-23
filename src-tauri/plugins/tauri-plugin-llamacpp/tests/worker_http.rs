//! The loopback HTTP surface, driven the way Jan's own callers drive it:
//! `proxy.rs` forwards to `http://127.0.0.1:<port>/v1<path>` with a bearer
//! token, and the extension's `chat()` posts to `/v1/chat/completions`.
//!
//! Opt-in on JAN_TEST_GGUF, like tests/engine_smoke.rs.
#![cfg(feature = "engine")]

use std::sync::Arc;

use tauri_plugin_llamacpp::engine::http::EngineServer;
use tauri_plugin_llamacpp::engine::registry::{LoadSpec, Registry};
use tokio::sync::Mutex;

const MODEL_ID: &str = "test-model";
const KEY: &str = "test-key";

fn model_path() -> Option<String> {
    std::env::var("JAN_TEST_GGUF").ok().filter(|p| !p.is_empty())
}

/// Spawns a server on an OS-chosen port and returns its base url.
async fn serve(model: &str, models_max: usize) -> String {
    let mut reg = Registry::new(models_max);
    reg.register(
        MODEL_ID,
        LoadSpec::Args(
            [
                "llama-server", "-m", model, "-c", "2048", "-ngl", "0",
                "--no-warmup", "-t", "4", "-fit", "off", "-np", "1",
            ]
            .iter()
            .map(|s| s.to_string())
            .collect(),
        ),
    );
    let (server, listener) = EngineServer::bind(Arc::new(Mutex::new(reg)), 0, KEY.into())
        .await
        .expect("loopback bind");
    let base = format!("http://127.0.0.1:{}", server.port);
    tokio::spawn(server.serve(listener));
    base
}

async fn post(base: &str, path: &str, body: &str, key: Option<&str>) -> (u16, String) {
    let mut req = reqwest::Client::new().post(format!("{base}{path}"));
    if let Some(k) = key {
        req = req.bearer_auth(k);
    }
    let res = req
        .header("content-type", "application/json")
        .body(body.to_string())
        .send()
        .await
        .expect("request should reach the loopback server");
    (res.status().as_u16(), res.text().await.unwrap_or_default())
}

#[tokio::test(flavor = "multi_thread")]
async fn models_lists_registered_models_and_requires_the_key() {
    let Some(model) = model_path() else { return };
    let base = serve(&model, 1).await;
    let client = reqwest::Client::new();

    let un = client
        .get(format!("{base}/v1/models"))
        .send()
        .await
        .unwrap();
    assert_eq!(un.status(), 401, "an unauthenticated read must be refused");

    let ok = client
        .get(format!("{base}/v1/models"))
        .bearer_auth(KEY)
        .send()
        .await
        .unwrap();
    assert_eq!(ok.status(), 200);
    let v: serde_json::Value = ok.json().await.unwrap();
    assert_eq!(v["data"][0]["id"], MODEL_ID);
    // Registered but not resident: it must still be listed, or an eviction
    // would make the model vanish from the UI -- and proxy.rs routes off this
    // list, so an unlisted model becomes unreachable.
    assert_eq!(v["data"][0]["status"]["value"], "unloaded");
    assert_eq!(v["data"][0]["status"]["failed"], false);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_chat_completion_returns_content_and_usage() {
    let Some(model) = model_path() else { return };
    let base = serve(&model, 1).await;
    let (status, body) = post(
        &base,
        "/v1/chat/completions",
        &format!(
            r#"{{"model":"{MODEL_ID}","messages":[{{"role":"user","content":"Say only: OK"}}],
                "max_tokens":200,"temperature":0}}"#
        ),
        Some(KEY),
    )
    .await;
    assert_eq!(status, 200, "body: {body}");
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert!(v["choices"][0]["message"]["role"].is_string(), "body: {body}");
    assert!(
        v["usage"]["completion_tokens"].as_u64().unwrap_or(0) > 0,
        "no tokens: {body}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_streaming_completion_is_sse_and_terminates_with_done() {
    let Some(model) = model_path() else { return };
    let base = serve(&model, 1).await;
    let res = reqwest::Client::new()
        .post(format!("{base}/v1/chat/completions"))
        .bearer_auth(KEY)
        .header("content-type", "application/json")
        .body(format!(
            r#"{{"model":"{MODEL_ID}","messages":[{{"role":"user","content":"Count to three."}}],
                "max_tokens":48,"temperature":0,"stream":true,"timings_per_token":true}}"#
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    assert_eq!(
        res.headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok()),
        Some("text/event-stream")
    );
    let text = res.text().await.unwrap();
    let frames: Vec<&str> = text
        .lines()
        .filter_map(|l| l.strip_prefix("data: "))
        .collect();
    assert!(frames.len() > 2, "expected several frames, got {}", frames.len());
    assert_eq!(frames.last().map(|f| f.trim()), Some("[DONE]"));
    // timings_per_token is what the extension uses for live token counts.
    assert!(
        frames.iter().any(|f| f.contains("\"timings\"")),
        "timings_per_token produced no timings frame"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn an_unknown_model_is_a_client_error_not_a_hang() {
    let Some(model) = model_path() else { return };
    let base = serve(&model, 1).await;
    let (status, body) = post(
        &base,
        "/v1/chat/completions",
        r#"{"model":"not-registered","messages":[{"role":"user","content":"hi"}]}"#,
        Some(KEY),
    )
    .await;
    assert_eq!(status, 400, "body: {body}");
}

#[tokio::test(flavor = "multi_thread")]
async fn an_unknown_path_is_404() {
    let Some(model) = model_path() else { return };
    let base = serve(&model, 1).await;
    let (status, _) = post(&base, "/v1/nonsense", "{}", Some(KEY)).await;
    assert_eq!(status, 404);
}

#[tokio::test(flavor = "multi_thread")]
async fn tokenize_works_without_a_model_field_by_using_the_resident_engine() {
    let Some(model) = model_path() else { return };
    let base = serve(&model, 1).await;
    // Load something first: with nothing resident this is a 503 by design.
    let (s, b) = post(
        &base,
        "/v1/chat/completions",
        &format!(
            r#"{{"model":"{MODEL_ID}","messages":[{{"role":"user","content":"hi"}}],"max_tokens":8}}"#
        ),
        Some(KEY),
    )
    .await;
    assert_eq!(s, 200, "warmup failed: {b}");

    let (status, body) = post(&base, "/tokenize", r#"{"content":"hello"}"#, Some(KEY)).await;
    assert_eq!(status, 200, "body: {body}");
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert!(v["tokens"].is_array(), "body: {body}");
}

#[tokio::test(flavor = "multi_thread")]
async fn explicit_load_then_unload_moves_the_reported_status() {
    let Some(model) = model_path() else { return };
    let base = serve(&model, 1).await;
    let client = reqwest::Client::new();

    let status_of = |client: reqwest::Client, base: String| async move {
        let v: serde_json::Value = client
            .get(format!("{base}/v1/models"))
            .bearer_auth(KEY)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        v["data"][0]["status"]["value"].as_str().unwrap().to_string()
    };

    assert_eq!(status_of(client.clone(), base.clone()).await, "unloaded");

    let (s, b) = post(
        &base,
        "/models/load",
        &format!(r#"{{"model":"{MODEL_ID}"}}"#),
        Some(KEY),
    )
    .await;
    assert_eq!(s, 200, "load failed: {b}");
    assert_eq!(status_of(client.clone(), base.clone()).await, "loaded");

    // Loading twice must be idempotent, not an error: the plugin's post_load
    // treats an "already" body as success.
    let (s, b) = post(
        &base,
        "/models/load",
        &format!(r#"{{"model":"{MODEL_ID}"}}"#),
        Some(KEY),
    )
    .await;
    assert_eq!(s, 200, "second load: {b}");
    assert!(b.contains("already"), "expected an 'already' body, got {b}");

    let (s, b) = post(
        &base,
        "/models/unload",
        &format!(r#"{{"model":"{MODEL_ID}"}}"#),
        Some(KEY),
    )
    .await;
    assert_eq!(s, 200, "unload failed: {b}");
    assert_eq!(status_of(client, base).await, "unloaded");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_failed_load_is_reported_as_failed_not_merely_unloaded() {
    let Some(_) = model_path() else { return };
    // A registered model whose file does not exist: the poll arm must see
    // failed=true, or commands::evaluate_load_poll waits out its full timeout.
    let mut reg = Registry::new(1);
    reg.register(
        "broken",
        LoadSpec::Args(
            ["llama-server", "-m", "/definitely/not/a/model.gguf", "-fit", "off"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
        ),
    );
    let (server, listener) = EngineServer::bind(Arc::new(Mutex::new(reg)), 0, KEY.into())
        .await
        .unwrap();
    let base = format!("http://127.0.0.1:{}", server.port);
    tokio::spawn(server.serve(listener));

    let (status, body) = post(&base, "/models/load", r#"{"model":"broken"}"#, Some(KEY)).await;
    assert!(
        (400..600).contains(&status),
        "a bad model path must fail the load, got {status}: {body}"
    );

    let v: serde_json::Value = reqwest::Client::new()
        .get(format!("{base}/v1/models"))
        .bearer_auth(KEY)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(v["data"][0]["status"]["value"], "unloaded");
    assert_eq!(
        v["data"][0]["status"]["failed"], true,
        "failed flag missing, so the caller's poll loop would hang: {v}"
    );
}

/// Reload needs no model file: it only rewrites the registry's bookkeeping, so
/// unlike the rest of this file it runs without JAN_TEST_GGUF.
async fn serve_preset(ini_path: &str) -> String {
    let ini = std::fs::read_to_string(ini_path).expect("preset should be readable");
    let mut reg = Registry::new(1);
    for (section, spec) in tauri_plugin_llamacpp::engine::preset::specs(ini_path, &ini) {
        reg.register(section, spec);
    }
    let (server, listener) = EngineServer::bind(Arc::new(Mutex::new(reg)), 0, KEY.into())
        .await
        .expect("loopback bind");
    let base = format!("http://127.0.0.1:{}", server.port);
    tokio::spawn(server.serve(listener));
    base
}

fn write_preset(dir: &std::path::Path, body: &str) -> String {
    let path = dir.join("router.preset.ini");
    std::fs::write(&path, body).expect("preset should be writable");
    path.to_string_lossy().into_owned()
}

const PRESET_ONE: &str = "[*]\nparallel = 1\n\n[alpha]\nmodel = /a.gguf\n";
const PRESET_TWO: &str = "[*]\nparallel = 1\n\n[alpha]\nmodel = /a.gguf\n\n[beta]\nmodel = /b.gguf\n";

#[tokio::test(flavor = "multi_thread")]
async fn reload_applies_a_regenerated_preset_and_reports_the_diff() {
    let dir = std::env::temp_dir().join(format!("jan-reload-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let preset = write_preset(&dir, PRESET_ONE);
    let base = serve_preset(&preset).await;

    write_preset(&dir, PRESET_TWO);
    let (status, body) = post(
        &base,
        "/models/reload",
        &format!(r#"{{"preset_path":"{preset}","models_max":3}}"#),
        Some(KEY),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["added"], serde_json::json!(["beta"]));
    assert_eq!(v["changed"], serde_json::json!([]));
    assert_eq!(v["removed"], serde_json::json!([]));
    assert_eq!(v["models_max"], 3, "the router could not be resized at all");

    // The new model must be listed, not merely accepted.
    let listed = reqwest::Client::new()
        .get(format!("{base}/v1/models"))
        .bearer_auth(KEY)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(listed.contains("beta"), "{listed}");

    // Reverting the preset must remove it again.
    write_preset(&dir, PRESET_ONE);
    let (status, body) = post(
        &base,
        "/models/reload",
        &format!(r#"{{"preset_path":"{preset}"}}"#),
        Some(KEY),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(v["removed"], serde_json::json!(["beta"]));
    assert_eq!(v["models_max"], 3, "omitting models_max must keep it");

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn reload_rejects_a_missing_preset_rather_than_emptying_the_registry() {
    let dir = std::env::temp_dir().join(format!("jan-reload-miss-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let preset = write_preset(&dir, PRESET_ONE);
    let base = serve_preset(&preset).await;

    let (status, _) = post(
        &base,
        "/models/reload",
        r#"{"preset_path":"/definitely/not/here.ini"}"#,
        Some(KEY),
    )
    .await;
    assert_eq!(status, 400);

    // Registering nothing would have silently unregistered every model.
    let listed = reqwest::Client::new()
        .get(format!("{base}/v1/models"))
        .bearer_auth(KEY)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(listed.contains("alpha"), "{listed}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn reload_requires_the_api_key() {
    let dir = std::env::temp_dir().join(format!("jan-reload-auth-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let preset = write_preset(&dir, PRESET_ONE);
    let base = serve_preset(&preset).await;

    let (status, _) = post(
        &base,
        "/models/reload",
        &format!(r#"{{"preset_path":"{preset}"}}"#),
        None,
    )
    .await;
    assert_eq!(status, 401, "reload mutates state and must be authenticated");

    let _ = std::fs::remove_dir_all(&dir);
}
