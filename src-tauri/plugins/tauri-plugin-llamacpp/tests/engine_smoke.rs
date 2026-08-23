//! End-to-end check that the in-process engine loads a real model and streams.
//!
//! Opt-in: set JAN_TEST_GGUF to a small model. It needs the `engine` feature
//! (so a compiled llama.cpp) and a few hundred MB of RAM, neither of which the
//! default test job has.
#![cfg(feature = "engine")]

use tauri_plugin_llamacpp::engine::{Engine, Route};

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

fn start(model: &str) -> Engine {
    let args: Vec<String> = [
        "llama-server", "-m", model, "-c", "2048", "-ngl", "0",
        "--no-warmup", "-t", "4", "-fit", "off", "-np", "1",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    Engine::start(&args).expect("engine should start")
}

#[test]
fn loads_a_model_and_answers_health_and_models() {
    let Some(model) = model_path() else {
        eprintln!("skipping: set JAN_TEST_GGUF to run");
        return;
    };
    let engine = start(&model);

    let res = engine.request(Route::Health.as_shim_name(), "");
    assert_eq!(res.status(), 200, "health body: {}", res.body());
    assert!(res.body().contains("ok"));

    let res = engine.request(Route::Models.as_shim_name(), "");
    assert_eq!(res.status(), 200);
    let v: serde_json::Value = serde_json::from_str(&res.body()).unwrap();
    assert!(
        v.pointer("/data/0/meta/n_ctx").is_some(),
        "no model metadata: {}",
        res.body()
    );
}

#[test]
fn a_chat_completion_applies_the_template_and_reports_usage() {
    let Some(model) = model_path() else {
        eprintln!("skipping: set JAN_TEST_GGUF to run");
        return;
    };
    let engine = start(&model);

    let res = engine.request(
        Route::ChatCompletions.as_shim_name(),
        r#"{"messages":[{"role":"user","content":"Say only: OK"}],
            "max_tokens":200,"temperature":0}"#,
    );
    assert_eq!(res.status(), 200, "body: {}", res.body());
    let v: serde_json::Value = serde_json::from_str(&res.body()).unwrap();

    // A response at all means the model's chat template was applied: without
    // it the prompt would not have been wrapped and there would be no message.
    assert!(
        v.pointer("/choices/0/message/role").is_some(),
        "no assistant message: {}",
        res.body()
    );
    assert!(
        v.pointer("/usage/completion_tokens")
            .and_then(|t| t.as_u64())
            .unwrap_or(0)
            > 0,
        "no tokens generated: {}",
        res.body()
    );
}

#[test]
fn a_streaming_completion_yields_sse_chunks_then_finishes() {
    let Some(model) = model_path() else {
        eprintln!("skipping: set JAN_TEST_GGUF to run");
        return;
    };
    let engine = start(&model);

    let mut res = engine.request(
        Route::ChatCompletions.as_shim_name(),
        r#"{"messages":[{"role":"user","content":"Count to five."}],
            "max_tokens":80,"temperature":0,"stream":true}"#,
    );
    assert_eq!(res.status(), 200);
    assert!(res.is_stream(), "expected a streaming response");
    assert_eq!(res.content_type(), "text/event-stream");

    // The first frame arrives in the body; the rest through next_chunk().
    let mut frames = res.body().matches("data: ").count();
    let mut guard = 0;
    while let Some(chunk) = res.next_chunk().expect("generator threw") {
        frames += chunk.matches("data: ").count();
        guard += 1;
        assert!(guard < 10_000, "stream did not terminate");
    }
    assert!(frames > 1, "expected multiple SSE frames, got {frames}");
    // Draining past the end must stay terminated rather than restart.
    assert_eq!(res.next_chunk().unwrap(), None);
}

#[test]
fn an_unknown_route_is_a_404_not_a_crash() {
    let Some(model) = model_path() else {
        eprintln!("skipping: set JAN_TEST_GGUF to run");
        return;
    };
    let engine = start(&model);
    let res = engine.request("post_does_not_exist", "{}");
    assert_eq!(res.status(), 404, "body: {}", res.body());
}

/// Two engines in one process, concurrently. This is the property that made
/// `server_context` the right level to link: `llama_server()` keeps its
/// shutdown handler in a file-scope global (server.cpp:25), so a second
/// instance would steal the first one's teardown -- which is why multi-model
/// upstream means multi-*process*. Driving server_context directly does not
/// have that limit, so models_max can be served in-process.
#[test]
fn two_engines_coexist_in_one_process() {
    let Some(model) = model_path() else {
        eprintln!("skipping: set JAN_TEST_GGUF to run");
        return;
    };
    let a = start(&model);
    let b = start(&model);

    for (name, engine) in [("a", &a), ("b", &b)] {
        let res = engine.request(Route::Health.as_shim_name(), "");
        assert_eq!(res.status(), 200, "engine {name} unhealthy: {}", res.body());
    }

    // And both can generate, so they are not sharing one queue.
    for (name, engine) in [("a", &a), ("b", &b)] {
        let res = engine.request(
            Route::ChatCompletions.as_shim_name(),
            r#"{"messages":[{"role":"user","content":"hi"}],"max_tokens":16,"temperature":0}"#,
        );
        assert_eq!(res.status(), 200, "engine {name} failed: {}", res.body());
    }

    // Dropping one must not disturb the other.
    drop(a);
    let res = b.request(Route::Health.as_shim_name(), "");
    assert_eq!(res.status(), 200, "engine b died with a: {}", res.body());
}

/// Regression: stopping an engine that never served a request used to hang
/// forever. `server_queue::start_loop` sets `running = true` at its top
/// (server-queue.cpp:279), so a `terminate()` issued before the loop thread
/// reaches that line is erased and the loop blocks. In the app that is a
/// shutdown hang after loading a model the user never used.
#[test]
fn an_engine_stops_promptly_even_if_it_never_served_a_request() {
    let Some(model) = model_path() else {
        eprintln!("skipping: set JAN_TEST_GGUF to run");
        return;
    };
    // Repeat: the failure is a race, so one pass proves little.
    for attempt in 0..5 {
        let started = std::time::Instant::now();
        let engine = start(&model);
        drop(engine); // immediate stop, no request in between
        let elapsed = started.elapsed();
        assert!(
            elapsed < std::time::Duration::from_secs(20),
            "attempt {attempt}: start+stop took {elapsed:?}, which means the \
             loop missed its terminate"
        );
    }
}
