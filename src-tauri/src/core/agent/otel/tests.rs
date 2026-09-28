use super::*;
use serde_json::{json, Value};
use std::time::Duration;

fn cfg_with(prompts: bool, tools: bool) -> Config {
    let env = move |key: &str| match key {
        config::ENABLE_ENV => Some("1".to_string()),
        "OTEL_LOG_USER_PROMPTS" if prompts => Some("1".to_string()),
        "OTEL_LOG_TOOL_DETAILS" if tools => Some("1".to_string()),
        _ => None,
    };
    config::resolve(&env, None, None).unwrap()
}

fn provenance(run: Option<&str>, session: &str) -> StreamEvent {
    StreamEvent::RequestProvenance {
        run_id: run.map(str::to_string),
        session_id: Some(session.into()),
        provider: Some("stub".into()),
        model: "stub-model".into(),
        api_type: None,
        request_sha256: "0".repeat(64),
        body_bytes: 123,
        tools_sha256: None,
        images: Vec::new(),
    }
}

fn usage(prompt: u64, completion: u64, cached: u64, written: u64) -> StreamEvent {
    StreamEvent::TurnUsage {
        usage: Usage {
            prompt_tokens: Some(prompt),
            completion_tokens: Some(completion),
            total_tokens: Some(prompt + completion),
            cached_tokens: Some(cached),
            cache_write_tokens: Some(written),
        },
        execution_id: None,
    }
}

/// Feed `events` through the same classification the sink uses.
fn fold(cfg: Config, pricer: Option<Pricer>, events: &[StreamEvent]) -> State {
    let cfg = Arc::new(cfg);
    let mut state = State::new(Arc::clone(&cfg), pricer);
    state.apply(
        Instant::now(),
        1,
        Signal::RunStart {
            session: Some("sess-1".into()),
            run_id: None,
            prompt: Some((11, cfg.log_user_prompts.then(|| "secret plan".to_string()))),
        },
    );
    for event in events {
        if let Some(signal) = classify(&cfg, event, None) {
            state.apply(Instant::now(), 2, signal);
        }
    }
    state
}

fn point(state: &State, name: &str, want: &[(&str, &str)]) -> Option<PointValue> {
    state
        .metrics(3, 0)
        .into_iter()
        .find(|m| m.name == name)?
        .points
        .into_iter()
        .find(|p| {
            want.iter().all(|(k, v)| {
                p.attrs.iter().any(|(pk, pv)| pk == k && *pv == AnyValue::Str(v.to_string()))
            })
        })
        .map(|p| p.value)
}

fn log_names(logs: &[LogRecord]) -> Vec<&str> {
    logs.iter().map(|l| l.event_name.as_str()).collect()
}

fn attr<'a>(record: &'a LogRecord, key: &str) -> Option<&'a AnyValue> {
    record.attrs.iter().find(|(k, _)| k == key).map(|(_, v)| v)
}

#[test]
fn usage_splits_tokens_by_type_with_model_and_provider() {
    let state = fold(
        cfg_with(false, false),
        Some(Box::new(|provider, model| {
            (provider == Some("stub") && model == "stub-model").then_some(TokenRates {
                prompt_usd: 1.0,
                completion_usd: 2.0,
                cache_read_usd: Some(0.5),
                cache_write_usd: None,
            })
        })),
        &[
            provenance(None, "sess-1"),
            StreamEvent::Step { index: 1, max: 0 },
            usage(100, 10, 30, 20),
        ],
    );
    let tokens = |kind| point(&state, "jan_agent.token.usage", &[("type", kind), ("model", "stub-model"), ("provider", "stub"), ("session.id", "sess-1")]);
    // `cached` and `cache_write` are shares of `prompt_tokens`, so input is
    // what is left of it.
    assert_eq!(tokens("input"), Some(PointValue::Int(50)));
    assert_eq!(tokens("output"), Some(PointValue::Int(10)));
    assert_eq!(tokens("cache_read"), Some(PointValue::Int(30)));
    assert_eq!(tokens("cache_write"), Some(PointValue::Int(20)));
    // 50*1 + 30*0.5 + 20*1 (no write rate: the prompt rate) + 10*2
    assert_eq!(
        point(&state, "jan_agent.cost.usage", &[("model", "stub-model")]),
        Some(PointValue::Double(105.0))
    );
    assert_eq!(point(&state, "jan_agent.session.count", &[]), Some(PointValue::Int(1)));
    assert_eq!(point(&state, "jan_agent.turn.count", &[("agent", "main")]), Some(PointValue::Int(1)));
    let logs = state.logs.clone();
    assert_eq!(log_names(&logs), vec!["jan_agent.user_prompt", "jan_agent.api_request"]);
    let request = &logs[1];
    assert_eq!(attr(request, "input_tokens"), Some(&AnyValue::Int(50)));
    assert_eq!(attr(request, "request_bytes"), Some(&AnyValue::Int(123)));
    assert!(attr(request, "duration_ms").is_some());
    // Joined to the prompt that caused it.
    assert_eq!(attr(request, "prompt.id"), attr(&logs[0], "prompt.id"));
    assert!(attr(request, "prompt.id").is_some());
}

#[test]
fn an_unpriced_model_reports_no_cost_rather_than_zero() {
    let state = fold(cfg_with(false, false), None, &[provenance(None, "s"), usage(10, 1, 0, 0)]);
    assert!(point(&state, "jan_agent.cost.usage", &[]).is_none());
}

#[test]
fn prompt_text_and_tool_arguments_are_gated() {
    let events = [
        StreamEvent::ToolCall {
            id: "t1".into(),
            name: "bash".into(),
            args: json!({ "command": "cat ~/.ssh/id_rsa" }),
        },
        StreamEvent::ToolResult {
            id: "t1".into(),
            content: "PRIVATE KEY".into(),
            is_error: false,
            diff: None,
        },
    ];
    let everything = |state: &State| {
        let body = encode::logs_json(
            &Origin { resource: Vec::new(), scope_name: String::new(), scope_version: String::new() },
            &state.logs,
        );
        String::from_utf8(body).unwrap()
    };

    let closed = everything(&fold(cfg_with(false, false), None, &events));
    assert!(!closed.contains("secret plan"), "{closed}");
    assert!(!closed.contains("id_rsa"), "{closed}");
    assert!(closed.contains("prompt_length"));

    let prompts = everything(&fold(cfg_with(true, false), None, &events));
    assert!(prompts.contains("secret plan"));
    assert!(!prompts.contains("id_rsa"));

    let tools = everything(&fold(cfg_with(false, true), None, &events));
    assert!(!tools.contains("secret plan"));
    assert!(tools.contains("id_rsa"));

    // Tool *output* has no gate in this slice: it is never exported at all.
    let all = everything(&fold(cfg_with(true, true), None, &events));
    assert!(!all.contains("PRIVATE KEY"));
}

#[test]
fn the_gate_applies_before_the_queue() {
    let cfg = cfg_with(false, false);
    let signal = classify(
        &cfg,
        &StreamEvent::ToolCall { id: "t".into(), name: "write".into(), args: json!({"x": 1}) },
        None,
    );
    assert_eq!(
        signal,
        Some(Signal::Event {
            child: None,
            event: EventSignal::ToolCall { id: "t".into(), name: "write".into(), args: None }
        })
    );
}

#[test]
fn tool_decisions_name_their_source() {
    let call = |id: &str, name: &str| StreamEvent::ToolCall {
        id: id.into(),
        name: name.into(),
        args: json!({}),
    };
    let result = |id: &str, content: &str| StreamEvent::ToolResult {
        id: id.into(),
        content: content.into(),
        is_error: content.starts_with("ERROR"),
        diff: None,
    };
    let state = fold(
        cfg_with(false, false),
        None,
        &[
            call("a", "read"),
            result("a", "file text"),
            call("b", "bash"),
            StreamEvent::PermissionRequest {
                request_id: "p".into(),
                tool_name: "bash".into(),
                capability: "exec".into(),
                path: None,
                command: Some("ls".into()),
                diff: None,
                prompt_kind: "exec".into(),
                offers_always: true,
            },
            result("b", "ERROR: tool 'bash' denied by user"),
            call("c", "write"),
            result("c", "ERROR: tool 'write' denied by project policy (see [tools] deny in x)"),
            call("d", "edit"),
            result("d", "ERROR: tool 'edit' denied: no edits on Fridays"),
            call("e", "bash"),
            result("e", "ERROR: command failed"),
        ],
    );
    let decisions: Vec<(String, String)> = state
        .logs
        .iter()
        .filter(|l| l.event_name == "jan_agent.tool_decision")
        .map(|l| {
            let s = |k| match attr(l, k) {
                Some(AnyValue::Str(s)) => s.clone(),
                other => panic!("{k}: {other:?}"),
            };
            (s("decision"), s("source"))
        })
        .collect();
    let pair = |a: &str, b: &str| (a.to_string(), b.to_string());
    assert_eq!(
        decisions,
        vec![
            pair("accept", "config"),
            pair("reject", "user"),
            pair("reject", "config"),
            pair("reject", "hook"),
            pair("accept", "config"),
        ]
    );
    assert_eq!(
        point(&state, "jan_agent.tool.count", &[("tool_name", "bash"), ("decision", "accept"), ("success", "false")]),
        Some(PointValue::Int(1))
    );
    assert_eq!(
        point(&state, "jan_agent.tool.count", &[("tool_name", "read"), ("success", "true")]),
        Some(PointValue::Int(1))
    );
}

#[test]
fn a_subagents_signals_carry_its_run_and_the_parent_session() {
    let wrapped = |event: StreamEvent| StreamEvent::Subagent {
        run_id: "run-7".into(),
        name: "scout".into(),
        event: Box::new(event),
    };
    let state = fold(
        cfg_with(false, false),
        None,
        &[
            provenance(None, "sess-1"),
            wrapped(provenance(Some("run-7"), "sess-1")),
            wrapped(StreamEvent::Step { index: 1, max: 0 }),
            wrapped(usage(4, 2, 0, 0)),
            StreamEvent::SubagentEnd { run_id: "run-7".into(), name: "scout".into(), error: None },
        ],
    );
    let request = state
        .logs
        .iter()
        .find(|l| l.event_name == "jan_agent.api_request")
        .unwrap();
    assert_eq!(attr(request, "agent.run_id"), Some(&AnyValue::Str("run-7".into())));
    assert_eq!(attr(request, "subagent.name"), Some(&AnyValue::Str("scout".into())));
    assert_eq!(attr(request, "session.id"), Some(&AnyValue::Str("sess-1".into())));
    assert_eq!(point(&state, "jan_agent.turn.count", &[("agent", "subagent")]), Some(PointValue::Int(1)));
    assert!(state.logs.iter().any(|l| l.event_name == "jan_agent.subagent_result"));
}

#[test]
fn an_error_after_a_request_counts_a_failed_request() {
    let state = fold(
        cfg_with(false, false),
        None,
        &[
            provenance(None, "s"),
            StreamEvent::Error { code: "error".into(), message: "HTTP 500".into() },
        ],
    );
    let error = state.logs.iter().find(|l| l.event_name == "jan_agent.api_error").unwrap();
    assert_eq!(error.severity_number, 17);
    assert_eq!(attr(error, "model"), Some(&AnyValue::Str("stub-model".into())));
    assert_eq!(
        point(&state, "jan_agent.api_request.count", &[("success", "false")]),
        Some(PointValue::Int(1))
    );
}

#[test]
fn session_id_can_be_kept_off_metric_points() {
    let env = |key: &str| match key {
        config::ENABLE_ENV => Some("1".into()),
        "OTEL_METRICS_INCLUDE_SESSION_ID" => Some("false".into()),
        _ => None,
    };
    let state = fold(config::resolve(&env, None, None).unwrap(), None, &[provenance(None, "s"), usage(1, 1, 0, 0)]);
    for metric in state.metrics(3, 0) {
        for p in metric.points {
            assert!(p.attrs.iter().all(|(k, _)| k != "session.id"), "{}", metric.name);
        }
    }
    // Events still carry it: they are the join key, one record each.
    assert!(state.logs.iter().all(|l| attr(l, "session.id").is_some()));
}

/// A tokio listener standing in for a collector: records `(path, body)` of
/// every POST, answers 200 or, when `stall`, never answers at all.
async fn collector(stall: bool) -> (String, Arc<Mutex<Vec<(String, Vec<u8>)>>>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen);
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let sink = Arc::clone(&sink);
            tokio::spawn(async move {
                if stall {
                    tokio::time::sleep(Duration::from_secs(3600)).await;
                    return;
                }
                let mut buf = Vec::new();
                let mut chunk = [0u8; 8192];
                loop {
                    let n = stream.read(&mut chunk).await.unwrap_or(0);
                    if n == 0 {
                        return;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                    let Some(end) = buf.windows(4).position(|w| w == b"\r\n\r\n") else {
                        continue;
                    };
                    let head = String::from_utf8_lossy(&buf[..end]).to_string();
                    let length: usize = head
                        .lines()
                        .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse().unwrap_or(0)))
                        .unwrap_or(0);
                    if buf.len() < end + 4 + length {
                        continue;
                    }
                    let path = head.split_whitespace().nth(1).unwrap_or("").to_string();
                    sink.lock().unwrap().push((path, buf[end + 4..end + 4 + length].to_vec()));
                    let _ = stream
                        .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                        .await;
                    return;
                }
            });
        }
    });
    (url, seen)
}

fn cfg_for(url: &str, protocol: &str) -> Config {
    let url = url.to_string();
    let protocol = protocol.to_string();
    let env = move |key: &str| match key {
        config::ENABLE_ENV => Some("1".to_string()),
        "OTEL_EXPORTER_OTLP_ENDPOINT" => Some(url.clone()),
        "OTEL_EXPORTER_OTLP_PROTOCOL" => Some(protocol.clone()),
        "OTEL_EXPORTER_OTLP_TIMEOUT" => Some("500".to_string()),
        _ => None,
    };
    config::resolve(&env, None, None).unwrap()
}

fn scripted_run(t: &Telemetry) {
    t.send(Signal::RunStart {
        session: Some("sess-1".into()),
        run_id: None,
        prompt: Some((5, None)),
    });
    t.observe(&provenance(None, "sess-1"));
    t.observe(&StreamEvent::Step { index: 1, max: 0 });
    t.observe(&usage(9, 4, 0, 0));
    t.send(Signal::RunEnd {
        session: Some("sess-1".into()),
        run_id: None,
        elapsed: Duration::from_millis(250),
    });
}

#[tokio::test]
async fn a_run_exports_metrics_and_logs_to_the_collector() {
    let (url, seen) = collector(false).await;
    let t = Telemetry::start(cfg_for(&url, "http/json"), None, "0.0.0-test");
    scripted_run(&t);
    t.shutdown(Duration::from_secs(5)).await;
    let seen = seen.lock().unwrap().clone();
    let body = |path: &str| -> Value {
        let (_, body) = seen.iter().find(|(p, _)| p == path).unwrap_or_else(|| panic!("no POST {path} in {seen:?}"));
        serde_json::from_slice(body).unwrap()
    };
    let metrics = body("/v1/metrics");
    let names: Vec<&str> = metrics["resourceMetrics"][0]["scopeMetrics"][0]["metrics"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["name"].as_str().unwrap())
        .collect();
    for want in ["jan_agent.session.count", "jan_agent.token.usage", "jan_agent.turn.count", "jan_agent.active_time.total"] {
        assert!(names.contains(&want), "{want} in {names:?}");
    }
    let resource = metrics["resourceMetrics"][0]["resource"]["attributes"].to_string();
    assert!(resource.contains("jan-agent") && resource.contains("0.0.0-test"), "{resource}");
    let logs = body("/v1/logs");
    let events: Vec<&str> = logs["resourceLogs"][0]["scopeLogs"][0]["logRecords"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["eventName"].as_str().unwrap())
        .collect();
    assert_eq!(events, vec!["jan_agent.user_prompt", "jan_agent.api_request"]);
}

#[tokio::test]
async fn protobuf_is_the_default_encoding() {
    let (url, seen) = collector(false).await;
    let t = Telemetry::start(cfg_for(&url, "http/protobuf"), None, "0.0.0-test");
    scripted_run(&t);
    t.shutdown(Duration::from_secs(5)).await;
    let seen = seen.lock().unwrap().clone();
    let (_, metrics) = seen.iter().find(|(p, _)| p == "/v1/metrics").expect("metrics POST");
    // Binary, and carrying the metric names as length-delimited strings.
    assert!(serde_json::from_slice::<Value>(metrics).is_err());
    assert!(metrics.windows(21).any(|w| w == b"jan_agent.token.usage"));
}

#[tokio::test]
async fn a_full_queue_drops_and_counts_without_waiting() {
    // Nothing listens on port 9 (discard) in a test sandbox, and the worker is
    // pinned on the stalled collector anyway: the point is the caller's side.
    let (url, _seen) = collector(true).await;
    let t = Telemetry::with_capacity(cfg_for(&url, "http/json"), None, "0", 4);
    let started = Instant::now();
    for _ in 0..10_000 {
        t.observe(&StreamEvent::Step { index: 1, max: 0 });
    }
    assert!(started.elapsed() < Duration::from_secs(1), "{:?}", started.elapsed());
    assert!(t.dropped() > 0);
    // A stalled collector bounds shutdown too.
    let started = Instant::now();
    t.shutdown(Duration::from_millis(300)).await;
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[tokio::test]
async fn a_dead_collector_is_not_the_runs_problem() {
    // Bound, then closed: connecting is refused.
    let port = {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };
    let t = Telemetry::start(cfg_for(&format!("http://127.0.0.1:{port}"), "http/json"), None, "0");
    scripted_run(&t);
    t.shutdown(Duration::from_secs(2)).await;
}

#[test]
fn refusals_are_read_off_the_loops_own_messages() {
    assert_eq!(refusal_of("ERROR: tool 'bash' denied by user"), Some(Refusal::User));
    assert_eq!(refusal_of("ERROR: user-scope subagent creation denied by user"), Some(Refusal::User));
    assert_eq!(
        refusal_of("ERROR: tool 'x' unavailable in plan_mode_read_only (plan mode is read-only)"),
        Some(Refusal::Config)
    );
    assert_eq!(refusal_of("ERROR: tool 'x' denied: because"), Some(Refusal::Hook));
    assert_eq!(refusal_of("ERROR: No such file"), None);
    assert_eq!(refusal_of("denied by user"), None, "only a loop-produced ERROR result");
}

#[test]
fn every_exported_metric_is_described() {
    let state = fold(
        cfg_with(false, false),
        Some(Box::new(|_, _| Some(TokenRates { prompt_usd: 1.0, completion_usd: 1.0, cache_read_usd: None, cache_write_usd: None }))),
        &[provenance(None, "s"), StreamEvent::Step { index: 1, max: 0 }, usage(1, 1, 0, 0)],
    );
    for metric in state.metrics(3, 5) {
        assert!(!metric.description.is_empty() && !metric.unit.is_empty(), "{}", metric.name);
    }
    let dropped = state.metrics(3, 5).into_iter().find(|m| m.name == "jan_agent.telemetry.dropped");
    assert_eq!(dropped.unwrap().points[0].value, PointValue::Int(5));
    assert!(state.metrics(3, 0).iter().all(|m| m.name != "jan_agent.telemetry.dropped"));
}
