//! The loopback HTTP surface, driven the way Jan's own callers drive it:
//! `proxy.rs` forwards to `http://127.0.0.1:<port>/v1<path>` with a bearer
//! token, and the extension's `chat()` posts to `/v1/chat/completions`.
//!
//! Opt-in on JAN_TEST_GGUF, like tests/engine_smoke.rs.
#![cfg(feature = "engine")]

use std::sync::Arc;

use tauri_plugin_llamacpp::engine::http::EngineServer;
use tauri_plugin_llamacpp::engine::registry::{LoadSpec, Registry};
use tauri_plugin_llamacpp::engine::slots::{state_key, StateStore};
use std::time::Duration;
use tokio::sync::Mutex;

const MODEL_ID: &str = "test-model";
const KEY: &str = "test-key";

fn model_path() -> Option<String> {
    // Registering the ggml backends is the caller's job and has to happen
    // before any other ggml call. A test binary sits in target/<profile>/ with
    // no backend modules beside it, and with GGML_BACKEND_DL every backend
    // including the CPU one is a loadable module -- so without this, loading a
    // model fails with no backend registered at all. Called from here because
    // it gates every test in the file and is idempotent.
    tauri_plugin_llamacpp::engine::load_backend_modules();
    std::env::var("JAN_TEST_GGUF").ok().filter(|p| !p.is_empty())
}

fn spec(model: &str, slot_dir: Option<&str>) -> LoadSpec {
    let mut args: Vec<String> = [
        "llama-server", "-m", model, "-c", "2048", "-ngl", "0",
        "--no-warmup", "-t", "4", "-fit", "off", "-np", "1",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    if let Some(dir) = slot_dir {
        args.push("--slot-save-path".to_string());
        args.push(dir.to_string());
    }
    LoadSpec::Args(args)
}

/// Spawns a server on an OS-chosen port and returns its base url.
async fn serve(model: &str, models_max: usize) -> String {
    let mut reg = Registry::new(models_max);
    reg.register(MODEL_ID, spec(model, None));
    let (server, listener) = EngineServer::bind(Arc::new(Mutex::new(reg)), 0, KEY.into())
        .await
        .expect("loopback bind");
    let base = format!("http://127.0.0.1:{}", server.port);
    tokio::spawn(server.serve(listener));
    base
}

/// The same server with cross-session KV persistence on, plus the directory it
/// saves into so a test can inspect what landed there.
async fn serve_with_state(
    model: &str,
    budget_mib: u64,
) -> (String, std::path::PathBuf, Arc<EngineServer>) {
    let dir = std::env::temp_dir().join(format!(
        "jan-slot-it-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();

    let mut reg = Registry::new(1);
    reg.register(MODEL_ID, spec(model, Some(dir.to_str().unwrap())));
    let (server, listener) = EngineServer::bind(Arc::new(Mutex::new(reg)), 0, KEY.into())
        .await
        .expect("loopback bind");
    let base = format!("http://127.0.0.1:{}", server.port);
    let server = Arc::new(server.with_slot_state(StateStore::new(&dir, budget_mib)));
    tokio::spawn(
        Arc::clone(&server)
            .serve_until(listener, std::future::pending::<()>(), Duration::ZERO),
    );
    (base, dir, server)
}

/// A chat turn long enough to leave more than MIN_TOKENS_TO_SAVE in the slot,
/// tagged with the thread it belongs to.
fn chat_body(thread: &str) -> String {
    // ~40 words repeated: short prompts are deliberately not persisted, so a
    // one-liner would test the skip path instead of the save path.
    let filler = "the quick brown fox jumps over the lazy dog and keeps running ".repeat(40);
    serde_json::json!({
        "model": MODEL_ID,
        "thread_id": thread,
        "id_slot": 0,
        "max_tokens": 1,
        "messages": [{ "role": "user", "content": filler }],
    })
    .to_string()
}

fn saved_states(dir: &std::path::Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".bin"))
        .collect();
    v.sort();
    v
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

/// Serves a registry whose one model cannot possibly load, so the lifecycle
/// feed can be exercised without a GGUF on disk.
async fn serve_unloadable() -> String {
    tauri_plugin_llamacpp::engine::load_backend_modules();
    let mut reg = Registry::new(1);
    reg.register(MODEL_ID, spec("/nonexistent/jan-test-model.gguf", None));
    let (server, listener) = EngineServer::bind(Arc::new(Mutex::new(reg)), 0, KEY.into())
        .await
        .expect("loopback bind");
    let base = format!("http://127.0.0.1:{}", server.port);
    tokio::spawn(server.serve(listener));
    base
}

/// The lifecycle feed Jan subscribes to for the length of a load. Needs no
/// model: a load that cannot succeed still has to announce both transitions,
/// and the nonzero exit code is what tells the desktop it failed rather than
/// having been evicted.
#[tokio::test(flavor = "multi_thread")]
async fn models_sse_streams_the_load_transitions() {
    use futures_util::StreamExt;

    let base = serve_unloadable().await;

    let unauth = reqwest::Client::new()
        .get(format!("{base}/models/sse"))
        .send()
        .await
        .unwrap();
    assert_eq!(unauth.status(), 401, "the feed must require the key");

    let resp = reqwest::Client::new()
        .get(format!("{base}/models/sse"))
        .bearer_auth(KEY)
        .send()
        .await
        .expect("the feed should be reachable");
    assert_eq!(resp.status(), 200);
    assert_eq!(
        resp.headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok()),
        Some("text/event-stream")
    );

    // Posted only once the stream is established, which is the ordering the
    // plugin's own loader follows -- the load is synchronous, so a subscriber
    // that arrives afterwards sees nothing.
    let load = tokio::spawn({
        let base = base.clone();
        async move {
            post(
                &base,
                "/models/load",
                &format!(r#"{{"model":"{MODEL_ID}"}}"#),
                Some(KEY),
            )
            .await
        }
    });

    let mut stream = resp.bytes_stream();
    let mut seen = String::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
    while !seen.contains("unloaded") {
        let next = tokio::time::timeout_at(deadline, stream.next()).await;
        match next {
            Ok(Some(Ok(bytes))) => seen.push_str(&String::from_utf8_lossy(&bytes)),
            Ok(Some(Err(e))) => panic!("stream error: {e}"),
            Ok(None) => panic!("stream ended before the load resolved: {seen:?}"),
            Err(_) => panic!("timed out waiting for the transitions: {seen:?}"),
        }
    }

    let (status, body) = load.await.unwrap();
    assert_eq!(status, 400, "an impossible load must be refused: {body}");

    assert!(seen.contains(r#""status":"loading""#), "{seen:?}");
    assert!(seen.contains(r#""status":"unloaded""#), "{seen:?}");
    assert!(seen.contains(r#""exit_code":1"#), "{seen:?}");
    assert!(
        seen.find("loading").unwrap() < seen.find("unloaded").unwrap(),
        "transitions must arrive in order: {seen:?}"
    );
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

/// The point of the whole feature: a thread's cache outlives the turn that
/// built it, and a *second* thread taking the slot does not lose it.
#[tokio::test(flavor = "multi_thread")]
async fn a_thread_switch_parks_the_first_threads_cache_and_restores_it() {
    let Some(model) = model_path() else { return };
    let (base, dir, _server) = serve_with_state(&model, 4096).await;

    // Thread A runs twice. Nothing is saved: no other thread has claimed the
    // slot, so there is nothing to evict -- and the second turn must not park
    // or restore either, since the slot already holds A's own newer cache.
    for _ in 0..2 {
        let (status, body) =
            post(&base, "/v1/chat/completions", &chat_body("thread-a"), Some(KEY)).await;
        assert_eq!(status, 200, "{body}");
        assert!(
            saved_states(&dir).is_empty(),
            "a thread taking its own slot again is not a handover"
        );
    }

    // Thread B takes slot 0, which is what forces A to disk.
    let (status, body) = post(&base, "/v1/chat/completions", &chat_body("thread-b"), Some(KEY)).await;
    assert_eq!(status, 200, "{body}");
    let key_a = state_key(MODEL_ID, "thread-a");
    assert_eq!(
        saved_states(&dir),
        vec![format!("{key_a}.bin")],
        "thread A's cache should have been parked when B took the slot"
    );
    assert!(
        dir.join(format!("{key_a}.json")).is_file(),
        "a state file without its sidecar is refused later, so both must land"
    );

    // Back to A: its state is restored rather than re-read from the prompt.
    let (status, body) = post(&base, "/v1/chat/completions", &chat_body("thread-a"), Some(KEY)).await;
    assert_eq!(status, 200, "{body}");
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    let cached = v["usage"]["prompt_tokens_details"]["cached_tokens"]
        .as_u64()
        .or_else(|| v["timings"]["n_prompt_tokens_cache"].as_u64());
    if let Some(cached) = cached {
        assert!(cached > 0, "the restored prefix should be reported as cached: {body}");
    }
    // Both files are on disk now: B was evicted in turn, and a restore does not
    // consume A's file. Keeping it is deliberate -- it is still a valid prefix
    // of that conversation, so it is the right thing to fall back to if the
    // next eviction never happens (a crash, a kill).
    let mut expected = vec![
        format!("{key_a}.bin"),
        format!("{}.bin", state_key(MODEL_ID, "thread-b")),
    ];
    expected.sort();
    assert_eq!(saved_states(&dir), expected);
}

/// The condition the request names: a state saved by another model is refused
/// rather than restored as plausible-looking nonsense.
#[tokio::test(flavor = "multi_thread")]
async fn a_state_saved_by_a_different_model_is_refused_and_dropped() {
    let Some(model) = model_path() else { return };
    let (base, dir, _server) = serve_with_state(&model, 4096).await;

    let key = state_key(MODEL_ID, "thread-a");
    // A state file whose sidecar claims a different model, as a model swap
    // between sessions would leave behind.
    std::fs::write(dir.join(format!("{key}.bin")), vec![0u8; 1024]).unwrap();
    std::fs::write(
        dir.join(format!("{key}.json")),
        serde_json::json!({
            "model": "some-other-model",
            "spec": "deadbeef",
            "llama_build": "0",
            "llama_commit": "0",
            "model_bytes": 0u64,
            "model_mtime": 0u64,
            "n_tokens": 900u64,
            "saved_at": 1u64,
        })
        .to_string(),
    )
    .unwrap();

    let (status, body) = post(&base, "/v1/chat/completions", &chat_body("thread-a"), Some(KEY)).await;
    assert_eq!(status, 200, "a refused restore must not fail the turn: {body}");
    assert!(
        !dir.join(format!("{key}.bin")).exists(),
        "a state that can never match again must be dropped, not re-checked every turn"
    );
}

/// A request with no thread_id behaves exactly as before: nothing is saved and
/// llama.cpp never sees a field it does not know.
#[tokio::test(flavor = "multi_thread")]
async fn a_request_without_a_thread_is_untouched_by_the_feature() {
    let Some(model) = model_path() else { return };
    let (base, dir, _server) = serve_with_state(&model, 4096).await;

    let body = serde_json::json!({
        "model": MODEL_ID,
        "id_slot": 0,
        "max_tokens": 1,
        "messages": [{ "role": "user", "content": "hi" }],
    })
    .to_string();
    let (status, out) = post(&base, "/v1/chat/completions", &body, Some(KEY)).await;
    assert_eq!(status, 200, "{out}");
    assert!(saved_states(&dir).is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn erasing_a_threads_state_drops_only_that_thread() {
    let Some(model) = model_path() else { return };
    let (base, dir, _server) = serve_with_state(&model, 4096).await;

    for thread in ["thread-a", "thread-b", "thread-c"] {
        let (status, body) =
            post(&base, "/v1/chat/completions", &chat_body(thread), Some(KEY)).await;
        assert_eq!(status, 200, "{body}");
    }
    // a and b were both evicted in turn; c is still resident.
    assert_eq!(saved_states(&dir).len(), 2, "{:?}", saved_states(&dir));

    let (status, body) = post(
        &base,
        "/slots/state/erase",
        &serde_json::json!({ "model": MODEL_ID, "thread": "thread-a" }).to_string(),
        Some(KEY),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(
        saved_states(&dir),
        vec![format!("{}.bin", state_key(MODEL_ID, "thread-b"))]
    );

    let (status, body) = post(
        &base,
        "/slots/state/erase",
        &serde_json::json!({ "model": MODEL_ID }).to_string(),
        Some(KEY),
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert!(saved_states(&dir).is_empty(), "erasing a model clears all of it");
}

/// Closing Jan is the common way a thread stops being current, so the resident
/// slot has to be written at shutdown or the feature would only work across a
/// thread switch.
#[tokio::test(flavor = "multi_thread")]
async fn shutdown_parks_the_resident_thread() {
    let Some(model) = model_path() else { return };
    let (base, dir, server) = serve_with_state(&model, 4096).await;

    let (status, body) = post(&base, "/v1/chat/completions", &chat_body("thread-a"), Some(KEY)).await;
    assert_eq!(status, 200, "{body}");
    assert!(saved_states(&dir).is_empty(), "nothing evicted it yet");

    server.save_resident_slots().await;
    assert_eq!(
        saved_states(&dir),
        vec![format!("{}.bin", state_key(MODEL_ID, "thread-a"))]
    );
}

/// The budget is a real ceiling, not advisory: a saved state directory that
/// grows without bound is a disk leak, not a cache.
#[tokio::test(flavor = "multi_thread")]
async fn the_disk_budget_evicts_the_oldest_saved_state() {
    let Some(model) = model_path() else { return };
    // 1 MiB, which a 2048-token slot state comfortably exceeds.
    let (base, dir, _server) = serve_with_state(&model, 1).await;

    for thread in ["thread-a", "thread-b", "thread-c"] {
        let (status, body) =
            post(&base, "/v1/chat/completions", &chat_body(thread), Some(KEY)).await;
        assert_eq!(status, 200, "{body}");
    }
    let total: u64 = std::fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("bin"))
        .map(|e| e.metadata().map(|m| m.len()).unwrap_or(0))
        .sum();
    assert!(
        total <= 1024 * 1024,
        "the directory should have been pruned to the budget, got {total} bytes"
    );
}
