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
    collector_refusing(stall, 0).await
}

/// [`collector`] whose first `refuse` POSTs are answered `503` with
/// `Retry-After: 0`, the way a collector that cannot persist a batch answers.
async fn collector_refusing(
    stall: bool,
    refuse: usize,
) -> (String, Arc<Mutex<Vec<(String, Vec<u8>)>>>) {
    use std::sync::atomic::AtomicUsize;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen);
    let refused = Arc::new(AtomicUsize::new(0));
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let sink = Arc::clone(&sink);
            let refused = Arc::clone(&refused);
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
                    let answer: &[u8] = if refused.fetch_add(1, Ordering::SeqCst) < refuse {
                        b"HTTP/1.1 503 Service Unavailable\r\nRetry-After: 0\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    } else {
                        b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    };
                    let _ = stream.write_all(answer).await;
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
    let started = std::time::Instant::now();
    t.shutdown(Duration::from_secs(2)).await;
    // No collector is listening, so the exit must not wait on one: no retry,
    // no sleep. Not timed on Windows, where a connect to a closed port is
    // itself retried before it fails, so the exports alone took ~1s in CI.
    if cfg!(not(windows)) {
        assert!(started.elapsed() < RETRY_DELAY, "{:?}", started.elapsed());
    }
}

#[tokio::test]
async fn a_batch_the_collector_asks_to_retry_is_sent_again_once() {
    let posts = |seen: &[(String, Vec<u8>)], path: &str| {
        seen.iter()
            .filter(|(p, _)| p == path)
            .map(|(_, b)| b.clone())
            .collect::<Vec<_>>()
    };
    // The run's end exports logs, then metrics. One 503 + Retry-After: 0
    // hits the logs batch, and its retry lands.
    let (url, seen) = collector_refusing(false, 1).await;
    let t = Telemetry::start(cfg_for(&url, "http/json"), None, "0.0.0-test");
    scripted_run(&t);
    t.shutdown(Duration::from_secs(5)).await;
    let seen = seen.lock().unwrap().clone();
    let logs = posts(&seen, "/v1/logs");
    assert_eq!(logs.len(), 2, "{seen:?}");
    assert_eq!(logs[0], logs[1], "the retry resends the same batch");
    assert_eq!(posts(&seen, "/v1/metrics").len(), 1, "{seen:?}");

    // Refused again on the retry, the batch is dropped: there is no third try.
    let (url, seen) = collector_refusing(false, 2).await;
    let t = Telemetry::start(cfg_for(&url, "http/json"), None, "0.0.0-test");
    scripted_run(&t);
    t.shutdown(Duration::from_secs(5)).await;
    let seen = seen.lock().unwrap().clone();
    assert_eq!(posts(&seen, "/v1/logs").len(), 2, "{seen:?}");
    assert_eq!(posts(&seen, "/v1/metrics").len(), 1, "{seen:?}");
}

#[test]
fn only_otlps_retryable_statuses_are_retried_and_within_the_cap() {
    assert_eq!(retry_delay(503, Some("5")), Some(Duration::from_secs(5)));
    assert_eq!(retry_delay(429, None), Some(RETRY_DELAY));
    assert_eq!(
        retry_delay(502, Some("Wed, 21 Oct 2015 07:28:00 GMT")),
        Some(RETRY_DELAY)
    );
    assert_eq!(retry_delay(504, Some("0")), Some(Duration::ZERO));
    assert_eq!(
        retry_delay(503, Some("3600")),
        None,
        "longer than the cap: dropped, not retried early"
    );
    for status in [400, 401, 404, 413, 500] {
        assert_eq!(retry_delay(status, Some("1")), None, "{status}");
    }
}

fn cfg_temporality(value: &'static str) -> Config {
    let env = move |key: &str| match key {
        config::ENABLE_ENV => Some("1".to_string()),
        "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE" => Some(value.to_string()),
        _ => None,
    };
    config::resolve(&env, None, None).unwrap()
}

fn feed(state: &mut State, cfg: &Config, events: &[StreamEvent]) {
    for event in events {
        if let Some(signal) = classify(cfg, event, None) {
            state.apply(Instant::now(), 2, signal);
        }
    }
}

fn start_run(state: &mut State, session: &str) {
    state.apply(
        Instant::now(),
        1,
        Signal::RunStart {
            session: Some(session.into()),
            run_id: None,
            prompt: Some((1, None)),
        },
    );
}

/// `(value, start, time)` of the point of `name` whose attributes include `want`.
fn point_in(
    metrics: &[Metric],
    name: &str,
    want: &[(&str, &str)],
) -> Option<(PointValue, u64, u64)> {
    metrics
        .iter()
        .find(|m| m.name == name)?
        .points
        .iter()
        .find_map(|p| {
            want.iter()
                .all(|(k, v)| {
                    p.attrs
                        .iter()
                        .any(|(pk, pv)| pk == k && *pv == AnyValue::Str(v.to_string()))
                })
                .then_some((p.value, p.start_unix_nano, p.time_unix_nano))
        })
}

#[test]
fn delta_exports_only_what_accrued_since_the_last_export() {
    let cfg = Arc::new(cfg_temporality("delta"));
    let mut state = State::new(Arc::clone(&cfg), None);
    start_run(&mut state, "sess-1");
    feed(
        &mut state,
        &cfg,
        &[provenance(None, "sess-1"), usage(10, 1, 0, 0)],
    );
    let first = state.metrics(100, 2);
    assert!(first.iter().all(|m| m.temporality == Temporality::Delta));
    let input = [("type", "input"), ("session.id", "sess-1")];
    assert_eq!(
        point_in(&first, "jan_agent.token.usage", &input).map(|p| p.0),
        Some(PointValue::Int(10))
    );
    assert_eq!(
        point_in(&first, "jan_agent.telemetry.dropped", &[]).map(|p| p.0),
        Some(PointValue::Int(2))
    );
    state.exported(100, 2);

    // Nothing accrued and nothing more was dropped: nothing to send.
    assert!(state.metrics(150, 2).is_empty());

    feed(
        &mut state,
        &cfg,
        &[provenance(None, "sess-1"), usage(5, 0, 0, 0)],
    );
    let second = state.metrics(200, 3);
    // Only this window's tokens, over this window, and no re-send of the
    // series that did not move (output, the session and prompt counts).
    assert_eq!(
        point_in(&second, "jan_agent.token.usage", &input),
        Some((PointValue::Int(5), 100, 200))
    );
    assert_eq!(
        point_in(&second, "jan_agent.token.usage", &[("type", "output")]),
        None
    );
    assert!(second
        .iter()
        .all(|m| m.name != "jan_agent.session.count" && m.name != "jan_agent.prompt.count"));
    assert_eq!(
        point_in(&second, "jan_agent.telemetry.dropped", &[]).map(|p| p.0),
        Some(PointValue::Int(1))
    );
}

#[test]
fn cumulative_stays_the_running_total() {
    let cfg = Arc::new(cfg_temporality("cumulative"));
    let mut state = State::new(Arc::clone(&cfg), None);
    start_run(&mut state, "sess-1");
    feed(
        &mut state,
        &cfg,
        &[provenance(None, "sess-1"), usage(10, 1, 0, 0)],
    );
    state.exported(100, 0);
    feed(
        &mut state,
        &cfg,
        &[provenance(None, "sess-1"), usage(5, 0, 0, 0)],
    );
    let metrics = state.metrics(200, 0);
    assert!(metrics
        .iter()
        .all(|m| m.temporality == Temporality::Cumulative));
    let (value, start, _) =
        point_in(&metrics, "jan_agent.token.usage", &[("type", "input")]).unwrap();
    assert_eq!(value, PointValue::Int(15));
    assert_eq!(
        start, state.start_nanos,
        "a cumulative point starts when the exporter did"
    );
    assert!(
        point_in(&metrics, "jan_agent.token.usage", &[("type", "output")]).is_some(),
        "unchanged series are re-sent"
    );
}

#[test]
fn a_closed_sessions_cumulative_series_go_once_their_final_values_are_out() {
    let cfg = Arc::new(cfg_temporality("cumulative"));
    let mut state = State::new(Arc::clone(&cfg), None);
    for session in ["sess-a", "sess-b"] {
        start_run(&mut state, session);
        feed(
            &mut state,
            &cfg,
            &[provenance(None, session), usage(10, 1, 0, 0)],
        );
    }
    state.apply(
        Instant::now(),
        3,
        Signal::SessionClosed {
            session: "sess-a".into(),
        },
    );
    let has = |metrics: &[Metric], s: &str| {
        point_in(
            metrics,
            "jan_agent.token.usage",
            &[("type", "input"), ("session.id", s)],
        )
        .is_some()
    };
    let last = state.metrics(100, 0);
    assert!(
        has(&last, "sess-a"),
        "the export after the close still carries its final totals"
    );
    state.exported(100, 0);
    let after = state.metrics(200, 0);
    assert!(!has(&after, "sess-a"));
    assert!(has(&after, "sess-b"), "a live session's series stay");
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

#[test]
fn refusals_classify_the_messages_the_loop_builds() {
    use crate::core::agent::r#loop::{
        DENIED_BY_POLICY, DENIED_BY_USER, HIDDEN_PATH_REFUSED, HOOK_DENIED, PLAN_MODE_UNAVAILABLE,
    };
    // Built the way loop.rs builds them, from the same constants.
    assert_eq!(refusal_of(&format!("ERROR: tool 'bash' {DENIED_BY_USER}")), Some(Refusal::User));
    assert_eq!(
        refusal_of(&format!("ERROR: tool 'bash' {DENIED_BY_POLICY} (see [tools] deny in x)")),
        Some(Refusal::Config)
    );
    assert_eq!(
        refusal_of(&format!("ERROR: tool 'read' {HIDDEN_PATH_REFUSED} (~/.jan) holds")),
        Some(Refusal::Config)
    );
    assert_eq!(
        refusal_of(&format!("ERROR: tool 'edit' {PLAN_MODE_UNAVAILABLE} (plan mode is read-only)")),
        Some(Refusal::Config)
    );
    assert_eq!(refusal_of(&format!("ERROR: tool 'x' {HOOK_DENIED}nope")), Some(Refusal::Hook));
}

#[test]
fn overlapping_sessions_keep_their_own_prompt_id() {
    let cfg = Arc::new(cfg_with(false, false));
    let mut state = State::new(Arc::clone(&cfg), None);
    let start = |state: &mut State, s: &str| {
        state.apply(
            Instant::now(),
            1,
            Signal::RunStart { session: Some(s.into()), run_id: None, prompt: Some((1, None)) },
        )
    };
    start(&mut state, "sess-a");
    start(&mut state, "sess-b");
    // A request from session A arrives after B started its prompt.
    for event in [provenance(None, "sess-a"), usage(10, 1, 0, 0)] {
        if let Some(signal) = classify(&cfg, &event, None) {
            state.apply(Instant::now(), 2, signal);
        }
    }
    let logs = state.logs.clone();
    let prompt = |s: &str| {
        logs.iter()
            .find(|l| {
                l.event_name == "jan_agent.user_prompt"
                    && attr(l, "session.id") == Some(&AnyValue::Str(s.into()))
            })
            .and_then(|l| attr(l, "prompt.id"))
            .cloned()
    };
    let request = logs.iter().find(|l| l.event_name == "jan_agent.api_request").unwrap();
    assert_ne!(prompt("sess-a"), prompt("sess-b"));
    assert_eq!(attr(request, "session.id"), Some(&AnyValue::Str("sess-a".into())));
    assert_eq!(attr(request, "prompt.id").cloned(), prompt("sess-a"));
}

#[test]
fn api_error_messages_are_redacted() {
    let cfg = cfg_with(false, false);
    let event = StreamEvent::Error {
        code: "upstream".into(),
        message: "401: invalid key sk-abcdefghijklmnop1234 (Authorization: Bearer abc.def.ghi12345) \
                  url https://x/v1?api_key=supersecret99&x=1"
            .into(),
    };
    let Some(Signal::Event { event: EventSignal::Error { message, .. }, .. }) =
        classify(&cfg, &event, None)
    else {
        panic!("error should classify");
    };
    assert!(!message.contains("sk-abcdefghijklmnop1234"), "{message}");
    assert!(!message.contains("abc.def.ghi12345"), "{message}");
    assert!(!message.contains("supersecret99"), "{message}");
    assert!(message.contains("401: invalid key"), "{message}");
}

// ── Traces ───────────────────────────────────────────────────────────────────

fn cfg_traced(extra: &[(&'static str, &'static str)]) -> Config {
    let extra: Vec<(&str, &str)> = extra.to_vec();
    let env = move |key: &str| {
        if key == config::ENABLE_ENV || key == "OTEL_TRACES_EXPORTER" {
            return Some(if key == config::ENABLE_ENV { "1" } else { "otlp" }.to_string());
        }
        extra.iter().find(|(k, _)| *k == key).map(|(_, v)| v.to_string())
    };
    config::resolve(&env, None, None).unwrap()
}

fn tool_call(id: &str, name: &str) -> StreamEvent {
    StreamEvent::ToolCall { id: id.into(), name: name.into(), args: json!({"command": "echo hi"}) }
}

fn tool_result(id: &str, is_error: bool) -> StreamEvent {
    StreamEvent::ToolResult { id: id.into(), content: "hi".into(), is_error, diff: None }
}

/// One whole turn: prompt, a request that calls a tool, the tool, a final
/// request, and the run's end.
fn traced_turn(cfg: Config) -> State {
    let mut state = fold(
        cfg,
        None,
        &[
            provenance(None, "sess-1"),
            StreamEvent::Step { index: 1, max: 0 },
            usage(100, 10, 40, 5),
            tool_call("call-1", "bash"),
            tool_result("call-1", false),
            provenance(None, "sess-1"),
            usage(120, 5, 100, 0),
        ],
    );
    state.apply(
        Instant::now(),
        9,
        Signal::RunEnd { session: Some("sess-1".into()), run_id: None, elapsed: Duration::from_secs(1) },
    );
    state
}

fn span_attr<'a>(span: &'a Span, key: &str) -> Option<&'a AnyValue> {
    span.attrs.iter().find(|(k, _)| k == key).map(|(_, v)| v)
}

#[test]
fn traces_are_off_unless_asked_for() {
    let mut state = traced_turn(cfg_with(true, true));
    assert!(state.take_spans().is_empty(), "metrics/logs opt-in must not produce spans");
}

#[test]
fn a_turn_is_one_trace_rooted_at_its_interaction() {
    let spans = traced_turn(cfg_traced(&[])).take_spans();
    let names: Vec<&str> = spans.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(
        names,
        vec!["jan_agent.llm_request", "jan_agent.tool", "jan_agent.llm_request", "jan_agent.interaction"]
    );
    let root = spans.last().unwrap();
    assert_eq!(root.parent_span_id, None, "no TRACEPARENT: the interaction is the root");
    for child in &spans[..3] {
        assert_eq!(child.trace_id, root.trace_id);
        assert_eq!(child.parent_span_id, Some(root.span_id), "{}", child.name);
        assert_eq!(span_attr(child, "prompt.id"), span_attr(root, "prompt.id"));
    }
    let ids: HashSet<[u8; 8]> = spans.iter().map(|s| s.span_id).collect();
    assert_eq!(ids.len(), spans.len(), "span ids are unique");
    assert!(spans.iter().all(|s| s.end_unix_nano >= s.start_unix_nano));
}

#[test]
fn llm_request_spans_carry_genai_usage() {
    let spans = traced_turn(cfg_traced(&[])).take_spans();
    let llm = &spans[0];
    assert_eq!(llm.kind, encode::SPAN_KIND_CLIENT);
    assert_eq!(span_attr(llm, "gen_ai.operation.name"), Some(&AnyValue::Str("chat".into())));
    assert_eq!(span_attr(llm, "gen_ai.request.model"), Some(&AnyValue::Str("stub-model".into())));
    assert_eq!(span_attr(llm, "gen_ai.system"), Some(&AnyValue::Str("stub".into())));
    // Of 100 prompt tokens, 40 were cache reads and 5 cache writes.
    assert_eq!(span_attr(llm, "input_tokens"), Some(&AnyValue::Int(55)));
    assert_eq!(span_attr(llm, "gen_ai.usage.input_tokens"), Some(&AnyValue::Int(100)));
    assert_eq!(span_attr(llm, "gen_ai.usage.output_tokens"), Some(&AnyValue::Int(10)));
    assert_eq!(span_attr(llm, "cache_read_tokens"), Some(&AnyValue::Int(40)));
    assert_eq!(span_attr(llm, "cache_creation_tokens"), Some(&AnyValue::Int(5)));
    assert_eq!(llm.error, None);
}

#[test]
fn tool_spans_join_to_the_call_and_record_failure() {
    let mut state = fold(
        cfg_traced(&[]),
        None,
        &[tool_call("call-9", "bash"), tool_result("call-9", true)],
    );
    let spans = state.take_spans();
    let tool = spans.iter().find(|s| s.name == "jan_agent.tool").unwrap();
    assert_eq!(span_attr(tool, "tool_use_id"), Some(&AnyValue::Str("call-9".into())));
    assert_eq!(span_attr(tool, "gen_ai.tool.call.id"), Some(&AnyValue::Str("call-9".into())));
    assert_eq!(span_attr(tool, "tool_name"), Some(&AnyValue::Str("bash".into())));
    assert_eq!(span_attr(tool, "success"), Some(&AnyValue::Bool(false)));
    assert!(tool.error.is_some(), "a failed tool sets status ERROR");
}

#[test]
fn span_content_is_gated() {
    let spans = traced_turn(cfg_traced(&[])).take_spans();
    let root = spans.last().unwrap();
    assert_eq!(span_attr(root, "user_prompt"), Some(&AnyValue::Str("<REDACTED>".into())));
    assert_eq!(span_attr(root, "user_prompt_length"), Some(&AnyValue::Int(11)));
    let tool = spans.iter().find(|s| s.name == "jan_agent.tool").unwrap();
    assert_eq!(span_attr(tool, "tool_parameters"), None);

    let spans = traced_turn(cfg_traced(&[("OTEL_LOG_USER_PROMPTS", "1"), ("OTEL_LOG_TOOL_DETAILS", "1")]))
        .take_spans();
    let root = spans.last().unwrap();
    assert_eq!(span_attr(root, "user_prompt"), Some(&AnyValue::Str("secret plan".into())));
    let tool = spans.iter().find(|s| s.name == "jan_agent.tool").unwrap();
    assert!(matches!(span_attr(tool, "tool_parameters"), Some(AnyValue::Str(a)) if a.contains("echo hi")));
}

#[test]
fn traceparent_makes_the_interaction_a_child_of_the_caller() {
    let spans = traced_turn(cfg_traced(&[(
        "TRACEPARENT",
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    )]))
    .take_spans();
    let root = spans.last().unwrap();
    assert_eq!(hex::encode(root.trace_id), "4bf92f3577b34da6a3ce929d0e0e4736");
    assert_eq!(root.parent_span_id.map(hex::encode).as_deref(), Some("00f067aa0ba902b7"));
    assert!(spans.iter().all(|s| s.trace_id == root.trace_id));
}

#[test]
fn a_failed_request_is_an_error_span() {
    let mut state = fold(
        cfg_traced(&[]),
        None,
        &[
            provenance(None, "sess-1"),
            StreamEvent::Error { code: "upstream".into(), message: "429 key sk-abcdefghijklmnop1234".into() },
        ],
    );
    let spans = state.take_spans();
    let llm = spans.iter().find(|s| s.name == "jan_agent.llm_request").unwrap();
    let message = llm.error.as_deref().unwrap();
    assert!(message.contains("429") && !message.contains("sk-abcdefghijklmnop1234"), "{message}");
    assert_eq!(span_attr(llm, "success"), Some(&AnyValue::Bool(false)));
}

#[test]
fn subagent_spans_nest_under_the_parents_interaction() {
    let mut state = fold(
        cfg_traced(&[]),
        None,
        &[StreamEvent::Subagent {
            run_id: "r1".into(),
            name: "explore".into(),
            event: Box::new(provenance(Some("r1"), "sess-1")),
        }],
    );
    let usage_event = StreamEvent::Subagent {
        run_id: "r1".into(),
        name: "explore".into(),
        event: Box::new(usage(1, 1, 0, 0)),
    };
    let cfg = cfg_traced(&[]);
    if let Some(sig) = classify(&cfg, &usage_event, None) {
        state.apply(Instant::now(), 3, sig);
    }
    state.apply(
        Instant::now(),
        9,
        Signal::RunEnd { session: Some("sess-1".into()), run_id: None, elapsed: Duration::from_secs(1) },
    );
    let spans = state.take_spans();
    let root = spans.iter().find(|s| s.name == "jan_agent.interaction").unwrap();
    let llm = spans.iter().find(|s| s.name == "jan_agent.llm_request").unwrap();
    assert_eq!(llm.parent_span_id, Some(root.span_id));
    assert_eq!(span_attr(llm, "agent_id"), Some(&AnyValue::Str("r1".into())));
}

#[tokio::test]
async fn a_traced_run_posts_spans_to_v1_traces() {
    for protocol in ["http/json", "http/protobuf"] {
        let (url, seen) = collector(false).await;
        let mut cfg = cfg_for(&url, protocol);
        let base = cfg.metrics.clone().unwrap();
        cfg.traces = Some(config::Target { url: format!("{url}/v1/traces"), ..base });
        let t = Telemetry::start(cfg, None, "0.0.0-test");
        scripted_run(&t);
        t.shutdown(Duration::from_secs(5)).await;
        let seen = seen.lock().unwrap().clone();
        let (_, body) = seen.iter().find(|(p, _)| p == "/v1/traces").unwrap_or_else(|| panic!("{protocol}: no traces POST"));
        if protocol == "http/json" {
            let v: Value = serde_json::from_slice(body).unwrap();
            let names: Vec<&str> = v["resourceSpans"][0]["scopeSpans"][0]["spans"]
                .as_array()
                .unwrap()
                .iter()
                .map(|s| s["name"].as_str().unwrap())
                .collect();
            assert_eq!(names, vec!["jan_agent.llm_request", "jan_agent.interaction"]);
        } else {
            assert!(body.windows(21).any(|w| w == b"jan_agent.interaction"));
        }
    }
}

// ── Claude Code compatibility ────────────────────────────────────────────────
//
// Each Claude Code signal (https://code.claude.com/docs/en/monitoring-usage,
// read 2026-09-28) and the jan_agent signal a dashboard built for it should
// use instead, with the attribute keys that must be present. A row that jan
// does not emit says why, so dropping a signal fails here instead of silently.

enum Kind {
    Metric,
    Event,
    Span,
}

enum Jan {
    Same(&'static str, &'static [&'static str]),
    Unsupported(&'static str),
}

const CLAUDE_CODE: &[(&str, Kind, Jan)] = &[
    ("claude_code.session.count", Kind::Metric, Jan::Same("jan_agent.session.count", &["session.id"])),
    ("claude_code.token.usage", Kind::Metric, Jan::Same("jan_agent.token.usage", &["session.id", "model", "type"])),
    ("claude_code.cost.usage", Kind::Metric, Jan::Same("jan_agent.cost.usage", &["session.id", "model"])),
    ("claude_code.active_time.total", Kind::Metric, Jan::Same("jan_agent.active_time.total", &["session.id"])),
    ("claude_code.code_edit_tool.decision", Kind::Metric, Jan::Same("jan_agent.tool.count", &["tool_name", "decision"])),
    ("claude_code.lines_of_code.count", Kind::Metric, Jan::Unsupported("edit tools do not report line counts on the event stream")),
    ("claude_code.pull_request.count", Kind::Metric, Jan::Unsupported("no PR detection in bash output")),
    ("claude_code.commit.count", Kind::Metric, Jan::Unsupported("no commit detection in bash output")),
    ("claude_code.user_prompt", Kind::Event, Jan::Same("jan_agent.user_prompt", &["event.name", "session.id", "prompt.id", "prompt_length"])),
    ("claude_code.api_request", Kind::Event, Jan::Same("jan_agent.api_request", &["session.id", "prompt.id", "model", "input_tokens", "output_tokens", "cache_read_tokens", "duration_ms"])),
    ("claude_code.api_error", Kind::Event, Jan::Same("jan_agent.api_error", &["session.id", "prompt.id", "error", "model", "duration_ms"])),
    ("claude_code.tool_result", Kind::Event, Jan::Same("jan_agent.tool_result", &["session.id", "prompt.id", "tool_name", "success", "duration_ms", "decision", "decision_source"])),
    ("claude_code.tool_decision", Kind::Event, Jan::Same("jan_agent.tool_decision", &["session.id", "prompt.id", "tool_name", "decision", "source"])),
    ("claude_code.interaction", Kind::Span, Jan::Same("jan_agent.interaction", &["span.type", "session.id", "prompt.id", "user_prompt", "user_prompt_length", "interaction.sequence", "interaction.duration_ms"])),
    ("claude_code.llm_request", Kind::Span, Jan::Same("jan_agent.llm_request", &["span.type", "model", "gen_ai.system", "gen_ai.request.model", "duration_ms", "input_tokens", "output_tokens", "cache_read_tokens", "cache_creation_tokens", "success"])),
    ("claude_code.tool", Kind::Span, Jan::Same("jan_agent.tool", &["span.type", "tool_name", "duration_ms", "tool_use_id", "gen_ai.tool.call.id"])),
    ("claude_code.tool.execution", Kind::Span, Jan::Unsupported("the event stream has no separate execution start; claude_code.tool's success/duration are on jan_agent.tool")),
    ("claude_code.tool.blocked_on_user", Kind::Span, Jan::Unsupported("permission waits are not timed yet; decision/source are on jan_agent.tool_decision")),
    ("claude_code.hook", Kind::Span, Jan::Unsupported("detailed-beta only in Claude Code; hooks do not report to the stream")),
];

#[test]
fn every_claude_code_signal_has_a_jan_equivalent_or_a_reason() {
    let pricer: Pricer = Box::new(|_, _| {
        Some(TokenRates { prompt_usd: 1e-6, completion_usd: 1e-6, cache_read_usd: None, cache_write_usd: None })
    });
    let cfg = Arc::new(cfg_traced(&[]));
    let mut state = State::new(Arc::clone(&cfg), Some(pricer));
    let feed = |state: &mut State, e: StreamEvent| {
        if let Some(sig) = classify(&cfg, &e, None) {
            state.apply(Instant::now(), 2, sig);
        }
    };
    state.apply(
        Instant::now(),
        1,
        Signal::RunStart { session: Some("sess-1".into()), run_id: None, prompt: Some((3, None)) },
    );
    feed(&mut state, provenance(None, "sess-1"));
    feed(&mut state, usage(10, 2, 4, 1));
    feed(&mut state, tool_call("c1", "edit"));
    feed(&mut state, tool_result("c1", false));
    feed(&mut state, provenance(None, "sess-1"));
    feed(&mut state, StreamEvent::Error { code: "upstream".into(), message: "boom".into() });
    state.apply(
        Instant::now(),
        5,
        Signal::RunEnd { session: Some("sess-1".into()), run_id: None, elapsed: Duration::from_secs(2) },
    );
    let metrics = state.metrics(9, 0);
    let spans = state.take_spans();
    let logs = state.take_logs();

    let mut missing = Vec::new();
    for (theirs, kind, jan) in CLAUDE_CODE {
        let Jan::Same(ours, keys) = jan else { continue };
        let keys_of: Vec<Vec<String>> = match kind {
            Kind::Metric => metrics
                .iter()
                .filter(|m| m.name == *ours)
                .flat_map(|m| m.points.iter().map(|p| p.attrs.iter().map(|(k, _)| k.clone()).collect()))
                .collect(),
            Kind::Event => logs
                .iter()
                .filter(|l| l.event_name == *ours)
                .map(|l| l.attrs.iter().map(|(k, _)| k.clone()).collect())
                .collect(),
            Kind::Span => spans
                .iter()
                .filter(|s| s.name == *ours)
                .map(|s| s.attrs.iter().map(|(k, _)| k.clone()).collect())
                .collect(),
        };
        if keys_of.is_empty() {
            missing.push(format!("{theirs} -> {ours}: not emitted"));
            continue;
        }
        for key in *keys {
            if !keys_of.iter().any(|ks| ks.iter().any(|k| k == key)) {
                missing.push(format!("{theirs} -> {ours}: no `{key}`"));
            }
        }
    }
    assert!(missing.is_empty(), "Claude Code parity gaps:\n{}", missing.join("\n"));
    for (theirs, _, jan) in CLAUDE_CODE {
        if let Jan::Unsupported(why) = jan {
            assert!(!why.is_empty(), "{theirs} needs a reason");
        }
    }
}

#[test]
fn a_turn_carries_its_runs_session() {
    let state = fold(
        cfg_with(false, false),
        None,
        &[provenance(None, "sess-1"), StreamEvent::Step { index: 1, max: 0 }],
    );
    assert_eq!(
        point(&state, "jan_agent.turn.count", &[("agent", "main"), ("session.id", "sess-1")]),
        Some(PointValue::Int(1))
    );
}

#[test]
fn delta_drops_wait_for_a_session_to_carry_them() {
    let cfg = Arc::new(cfg_temporality("delta"));
    let mut state = State::new(Arc::clone(&cfg), None);
    // Dropped before any run started: no session to put them in, so they
    // are held rather than sent as the one point without a session.
    assert!(state.metrics(100, 4).is_empty());
    let _ = state.exported(100, 4);
    start_run(&mut state, "sess-1");
    let metrics = state.metrics(200, 4);
    assert_eq!(
        point_in(&metrics, "jan_agent.telemetry.dropped", &[("session.id", "sess-1")]).map(|p| p.0),
        Some(PointValue::Int(4)),
        "the held drops go out with the first session"
    );
    let _ = state.exported(200, 4);
    assert!(state.metrics(300, 4).iter().all(|m| m.name != "jan_agent.telemetry.dropped"));
}

#[test]
fn a_failed_delta_export_puts_its_window_back() {
    let cfg = Arc::new(cfg_temporality("delta"));
    let mut state = State::new(Arc::clone(&cfg), None);
    let started = state.last_export_nanos;
    start_run(&mut state, "sess-1");
    feed(&mut state, &cfg, &[provenance(None, "sess-1"), usage(10, 1, 0, 0)]);
    let input = [("type", "input"), ("session.id", "sess-1")];
    assert_eq!(point_in(&state.metrics(100, 2), "jan_agent.token.usage", &input).map(|p| p.0), Some(PointValue::Int(10)));
    let taken = state.exported(100, 2);
    // More accrues while the export is in flight, then the export fails.
    feed(&mut state, &cfg, &[provenance(None, "sess-1"), usage(5, 0, 0, 0)]);
    state.export_failed(taken);
    let retry = state.metrics(200, 2);
    assert_eq!(
        point_in(&retry, "jan_agent.token.usage", &input),
        Some((PointValue::Int(15), started, 200)),
        "the failed window and what accrued since, over the whole span"
    );
    assert_eq!(
        point_in(&retry, "jan_agent.telemetry.dropped", &[]).map(|p| p.0),
        Some(PointValue::Int(2)),
        "drops the failed export carried are reported again"
    );
    assert!(retry.iter().any(|m| m.name == "jan_agent.session.count"), "nothing the failed window held is lost");
}

#[test]
fn a_failed_cumulative_export_keeps_a_closed_sessions_final_values() {
    let cfg = Arc::new(cfg_temporality("cumulative"));
    let mut state = State::new(Arc::clone(&cfg), None);
    start_run(&mut state, "sess-a");
    feed(&mut state, &cfg, &[provenance(None, "sess-a"), usage(10, 1, 0, 0)]);
    state.apply(Instant::now(), 3, Signal::SessionClosed { session: "sess-a".into() });
    let has_a = |metrics: &[Metric]| {
        point_in(metrics, "jan_agent.token.usage", &[("type", "input"), ("session.id", "sess-a")]).is_some()
    };
    let taken = state.exported(100, 0);
    assert!(!has_a(&state.metrics(150, 0)), "evicted once handed to an export");
    state.export_failed(taken);
    assert!(has_a(&state.metrics(200, 0)), "back until an export actually carries it");
    let _ = state.exported(200, 0);
    assert!(!has_a(&state.metrics(300, 0)));
}

fn cfg_delta_for(url: &str) -> Config {
    let url = url.to_string();
    let env = move |key: &str| match key {
        config::ENABLE_ENV => Some("1".to_string()),
        "OTEL_EXPORTER_OTLP_ENDPOINT" => Some(url.clone()),
        "OTEL_EXPORTER_OTLP_PROTOCOL" => Some("http/json".to_string()),
        "OTEL_EXPORTER_OTLP_TIMEOUT" => Some("500".to_string()),
        "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE" => Some("delta".to_string()),
        _ => None,
    };
    config::resolve(&env, None, None).unwrap()
}

#[tokio::test]
async fn a_delta_window_whose_export_failed_goes_out_with_the_next() {
    // The first run's logs and metrics are both refused, retry included
    // (four 503s); the second run's exports land.
    let (url, seen) = collector_refusing(false, 4).await;
    let t = Telemetry::start(cfg_delta_for(&url), None, "0.0.0-test");
    scripted_run(&t);
    scripted_run(&t);
    t.shutdown(Duration::from_secs(5)).await;
    let seen = seen.lock().unwrap().clone();
    let metrics: Vec<Value> = seen
        .iter()
        .filter(|(p, _)| p == "/v1/metrics")
        .map(|(_, b)| serde_json::from_slice(b).unwrap())
        .collect();
    let input_tokens = |body: &Value| -> Option<i64> {
        body["resourceMetrics"][0]["scopeMetrics"][0]["metrics"]
            .as_array()?
            .iter()
            .find(|m| m["name"] == "jan_agent.token.usage")?["sum"]["dataPoints"]
            .as_array()?
            .iter()
            .find(|p| p["attributes"].to_string().contains("\"input\""))?["asInt"]
            .as_str()?
            .parse()
            .ok()
    };
    let landed = metrics.last().expect("a metrics POST landed");
    assert_eq!(
        input_tokens(landed),
        Some(18),
        "the refused window (9) and the next (9) arrive together: {metrics:?}"
    );
}
