//! Opt-in OpenTelemetry export of the agent's usage: metrics and event logs over
//! OTLP/HTTP, to a collector the user names (janhq/jan-internal#393).
//!
//! Off by default: nothing here runs, and no request is made, unless
//! [`config::enabled`] says so. This is separate from Jan's own update-check
//! ping (`cli::telemetry`), which goes to Jan; this goes only to the user's
//! endpoint.
//!
//! One sink, fed from what the engine already reports:
//!
//! - every surface (TUI, `cli agent run`, RPC) hands the [`StreamEvent`]s it
//!   consumes to [`observe`], so a child's events arrive in their `Subagent`
//!   bracket and are attributed to its run;
//! - the loop's own lifecycle points (next to the `SessionStart`/`SessionEnd`
//!   and `UserPromptSubmit` hooks, and `PreCompact`) call [`RunScope::begin`]
//!   and [`compaction`], which the event stream cannot tell.
//!
//! The calling side does almost nothing: it turns the event into a small owned
//! [`Signal`] and `try_send`s it on a bounded queue. A full queue drops the
//! signal and counts it; nothing on the agent's path ever waits on telemetry.
//! Aggregation and export happen on one background task, which POSTs to the
//! collector on the configured intervals, after each top-level run, and once at
//! shutdown (bounded by [`SHUTDOWN_TIMEOUT`]). Export failures are logged at
//! debug level and never reach stdout, which is the protocol channel for RPC
//! and stream-json.
//!
//! Nothing here touches a request body: telemetry only reads what the loop
//! already emitted, so the prompt-cache prefix is unaffected.

pub mod config;
pub mod encode;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tokio::sync::{mpsc, oneshot};

use crate::core::agent::events::{StreamEvent, Usage};
use crate::core::agent::session::TokenRates;
use config::{Config, Target};
use encode::{AnyValue, Attrs, LogRecord, Metric, Origin, Point, PointValue};

/// Signals that can wait for the worker. Generous: a busy turn emits a few
/// dozen, and the worker drains continuously.
pub const QUEUE_CAPACITY: usize = 4096;
/// How long [`shutdown`] waits for the final export before giving up.
pub const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
/// Logs buffered before an early export, whatever the interval.
const LOG_BATCH: usize = 512;
/// Cap on a gated free-text attribute (prompt text, tool arguments).
const CONTENT_CAP: usize = 4096;
/// Cap on an error message carried by `api_error`.
const ERROR_CAP: usize = 512;

/// Per-token prices for `(provider, model)`, when the catalog knows them.
pub type Pricer = Box<dyn Fn(Option<&str>, &str) -> Option<TokenRates> + Send + Sync>;

/// A subagent's identity, carried on every signal its events produce.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Child {
    pub run_id: String,
    pub name: String,
}

/// What the calling side hands the worker: small, owned, and already stripped
/// of anything a content gate withholds.
#[derive(Debug, Clone, PartialEq)]
pub enum Signal {
    RunStart {
        session: Option<String>,
        /// `Some` for a child run.
        run_id: Option<String>,
        /// The submitted prompt's length in chars, and its text only when
        /// `OTEL_LOG_USER_PROMPTS` is on. `None` for a child (its task is not a
        /// user prompt) and for a run with no new prompt.
        prompt: Option<(usize, Option<String>)>,
    },
    RunEnd {
        session: Option<String>,
        run_id: Option<String>,
        elapsed: Duration,
    },
    Compaction {
        message_count: usize,
    },
    Event {
        child: Option<Child>,
        event: EventSignal,
    },
    Flush,
}

#[derive(Debug, Clone, PartialEq)]
pub enum EventSignal {
    Request {
        session: Option<String>,
        provider: Option<String>,
        model: String,
        body_bytes: u64,
    },
    Usage {
        tokens: Tokens,
        execution_id: Option<String>,
    },
    Step,
    ToolCall {
        id: String,
        name: String,
        /// Serialized arguments, only when `OTEL_LOG_TOOL_DETAILS` is on.
        args: Option<String>,
    },
    ToolResult {
        id: String,
        is_error: bool,
        refusal: Option<Refusal>,
        bytes: usize,
    },
    Permission {
        tool_name: String,
    },
    Error {
        code: String,
        message: String,
    },
    SubagentEnd {
        failed: bool,
    },
}

/// One request's token counts, as [`Usage`] reports them (`cached` and
/// `written` are shares of `prompt`). Omitted counts are zero.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Tokens {
    pub prompt: u64,
    pub completion: u64,
    pub cached: u64,
    pub written: u64,
}

impl From<&Usage> for Tokens {
    fn from(u: &Usage) -> Self {
        Self {
            prompt: u.prompt_tokens.unwrap_or(0),
            completion: u.completion_tokens.unwrap_or(0),
            cached: u.cached_tokens.unwrap_or(0),
            written: u.cache_write_tokens.unwrap_or(0),
        }
    }
}

/// Why a tool call never ran, read off the loop's stable refusal messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// The user answered a permission prompt with deny.
    User,
    /// Project policy, plan mode or the hidden Jan home.
    Config,
    /// A `PreToolUse` hook said no.
    Hook,
}

impl Refusal {
    fn source(self) -> &'static str {
        match self {
            Refusal::User => "user",
            Refusal::Config => "config",
            Refusal::Hook => "hook",
        }
    }
}

/// Classify a tool result the loop produced without running the tool. The
/// phrases are the loop's own constants (`r#loop::DENIED_BY_USER` and
/// friends), the same ones its refusal messages are built from, so the two
/// cannot drift apart. Only the head of an `ERROR:` result is read.
pub fn refusal_of(content: &str) -> Option<Refusal> {
    use crate::core::agent::r#loop::{
        DENIED_BY_POLICY, DENIED_BY_USER, HIDDEN_PATH_REFUSED, HOOK_DENIED, PLAN_MODE_UNAVAILABLE,
    };
    if !content.starts_with("ERROR:") {
        return None;
    }
    let head: String = content.chars().take(300).collect();
    if head.contains(DENIED_BY_USER) {
        Some(Refusal::User)
    } else if head.contains(DENIED_BY_POLICY)
        || head.contains(PLAN_MODE_UNAVAILABLE)
        || head.contains(HIDDEN_PATH_REFUSED)
    {
        Some(Refusal::Config)
    } else if head.starts_with("ERROR: tool '") && head.contains(&format!("' {HOOK_DENIED}")) {
        Some(Refusal::Hook)
    } else {
        None
    }
}

/// Strip credentials a provider error may echo back (bearer tokens, API keys,
/// `key=` query parameters) before the message leaves the process.
pub fn redact_secrets(message: &str) -> String {
    static PATTERNS: OnceLock<Vec<(regex::Regex, &'static str)>> = OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| {
        [
            (r"(?i)(bearer\s+)[A-Za-z0-9._~+/=-]{8,}", "${1}[REDACTED]"),
            (r"(?i)((?:api[_-]?key|access[_-]?token|token|key|secret|password)[\x22']?\s*[=:]\s*[\x22']?)[^\s&\x22',}]{6,}", "${1}[REDACTED]"),
            (r"\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}", "[REDACTED]"),
            (r"\bAIza[0-9A-Za-z_-]{20,}", "[REDACTED]"),
            (r"\bgh[pousr]_[A-Za-z0-9]{20,}", "[REDACTED]"),
        ]
        .into_iter()
        .map(|(p, r)| (regex::Regex::new(p).expect("valid redaction pattern"), r))
        .collect()
    });
    let mut out = message.to_string();
    for (re, replacement) in patterns {
        out = re.replace_all(&out, *replacement).into_owned();
    }
    out
}

fn truncate(s: &str, cap: usize) -> String {
    if s.len() <= cap {
        return s.to_string();
    }
    let mut end = cap;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &s[..end])
}

/// The signal an event contributes, if any. Content is dropped here, on the
/// calling side, so a gated value never even reaches the queue.
pub fn classify(cfg: &Config, event: &StreamEvent, child: Option<Child>) -> Option<Signal> {
    let event = match event {
        StreamEvent::Subagent { run_id, name, event } => {
            return classify(
                cfg,
                event,
                Some(Child { run_id: run_id.clone(), name: name.clone() }),
            );
        }
        StreamEvent::RequestProvenance { session_id, provider, model, body_bytes, .. } => {
            EventSignal::Request {
                session: session_id.clone(),
                provider: provider.clone(),
                model: model.clone(),
                body_bytes: *body_bytes,
            }
        }
        StreamEvent::TurnUsage { usage, execution_id } => EventSignal::Usage {
            tokens: Tokens::from(usage),
            execution_id: execution_id.clone(),
        },
        StreamEvent::Step { .. } => EventSignal::Step,
        StreamEvent::ToolCall { id, name, args } => EventSignal::ToolCall {
            id: id.clone(),
            name: name.clone(),
            args: cfg
                .log_tool_details
                .then(|| truncate(&args.to_string(), CONTENT_CAP)),
        },
        StreamEvent::ToolResult { id, content, is_error, .. } => EventSignal::ToolResult {
            id: id.clone(),
            is_error: *is_error,
            refusal: refusal_of(content),
            bytes: content.len(),
        },
        StreamEvent::PermissionRequest { tool_name, .. } => EventSignal::Permission {
            tool_name: tool_name.clone(),
        },
        StreamEvent::Error { code, message } => EventSignal::Error {
            code: code.clone(),
            message: truncate(&redact_secrets(message), ERROR_CAP),
        },
        StreamEvent::SubagentEnd { run_id, name, error } => {
            return Some(Signal::Event {
                child: Some(Child { run_id: run_id.clone(), name: name.clone() }),
                event: EventSignal::SubagentEnd { failed: error.is_some() },
            });
        }
        _ => return None,
    };
    Some(Signal::Event { child, event })
}

/// A running exporter: the bounded queue into its worker, and the worker.
pub struct Telemetry {
    cfg: Arc<Config>,
    tx: mpsc::Sender<(Instant, u64, Signal)>,
    dropped: Arc<AtomicU64>,
    stop: Mutex<Option<oneshot::Sender<()>>>,
    worker: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

fn wall_nanos() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

impl Telemetry {
    /// Start the worker on the current tokio runtime.
    pub fn start(cfg: Config, pricer: Option<Pricer>, version: &str) -> Self {
        Self::with_capacity(cfg, pricer, version, QUEUE_CAPACITY)
    }

    pub fn with_capacity(
        cfg: Config,
        pricer: Option<Pricer>,
        version: &str,
        capacity: usize,
    ) -> Self {
        let cfg = Arc::new(cfg);
        let (tx, rx) = mpsc::channel(capacity.max(1));
        let (stop_tx, stop_rx) = oneshot::channel();
        let dropped = Arc::new(AtomicU64::new(0));
        let worker = Worker::new(Arc::clone(&cfg), pricer, version, Arc::clone(&dropped));
        let handle = tokio::spawn(worker.run(rx, stop_rx));
        Self {
            cfg,
            tx,
            dropped,
            stop: Mutex::new(Some(stop_tx)),
            worker: Mutex::new(Some(handle)),
        }
    }

    pub fn config(&self) -> &Config {
        &self.cfg
    }

    /// Queue a signal without waiting. A full queue drops it and counts it.
    pub fn send(&self, signal: Signal) {
        if self.tx.try_send((Instant::now(), wall_nanos(), signal)).is_err() {
            self.dropped.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn observe(&self, event: &StreamEvent) {
        if let Some(signal) = classify(&self.cfg, event, None) {
            self.send(signal);
        }
    }

    pub fn dropped(&self) -> u64 {
        self.dropped.load(Ordering::Relaxed)
    }

    /// Export what is buffered and stop the worker, waiting at most `timeout`.
    pub async fn shutdown(&self, timeout: Duration) {
        if let Some(stop) = self.stop.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = stop.send(());
        }
        let handle = self.worker.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(handle) = handle {
            if tokio::time::timeout(timeout, handle).await.is_err() {
                log::debug!("telemetry: final export did not finish within {timeout:?}");
            }
        }
    }
}

// ── The process-wide exporter ────────────────────────────────────────────────

static GLOBAL: OnceLock<Telemetry> = OnceLock::new();

fn global() -> Option<&'static Telemetry> {
    GLOBAL.get()
}

/// Turn the exporter on for this process when the configuration says so.
/// Idempotent: the first call decides. Must run inside a tokio runtime.
pub fn init(
    project_enabled: Option<bool>,
    global_enabled: Option<bool>,
    pricer: impl FnOnce() -> Option<Pricer>,
    version: &str,
) -> bool {
    if GLOBAL.get().is_some() {
        return true;
    }
    // The worker is a tokio task; a caller outside a runtime cannot host one.
    if tokio::runtime::Handle::try_current().is_err() {
        return false;
    }
    let env = |key: &str| std::env::var(key).ok();
    let Some(cfg) = config::resolve(&env, project_enabled, global_enabled) else {
        return false;
    };
    for warning in &cfg.warnings {
        log::warn!("telemetry: {warning}");
    }
    let _ = GLOBAL.set(Telemetry::start(cfg, pricer(), version));
    true
}

/// Hand one consumed event to the exporter, if it is on.
pub fn observe(event: &StreamEvent) {
    if let Some(t) = global() {
        t.observe(event);
    }
}

/// A compaction is about to run (reported from `PreCompact`'s call site).
pub fn compaction(message_count: usize) {
    if let Some(t) = global() {
        t.send(Signal::Compaction { message_count });
    }
}

/// Export whatever is buffered and stop, bounded by [`SHUTDOWN_TIMEOUT`].
pub async fn shutdown() {
    if let Some(t) = global() {
        t.shutdown(SHUTDOWN_TIMEOUT).await;
    }
}

/// Brackets one orchestration run: reports its start (and the prompt that
/// started it) now, and its end and active time when dropped -- so a cancelled
/// run, whose future is dropped mid-await, is still accounted for.
pub struct RunScope {
    session: Option<String>,
    run_id: Option<String>,
    started: Instant,
    armed: bool,
}

impl RunScope {
    pub fn begin(session: Option<&str>, run_id: Option<&str>, prompt: Option<&str>) -> Self {
        let armed = match global() {
            Some(t) => {
                let prompt = run_id.is_none().then_some(prompt).flatten().map(|p| {
                    (
                        p.chars().count(),
                        t.cfg.log_user_prompts.then(|| truncate(p, CONTENT_CAP)),
                    )
                });
                t.send(Signal::RunStart {
                    session: session.map(str::to_string),
                    run_id: run_id.map(str::to_string),
                    prompt,
                });
                true
            }
            None => false,
        };
        Self {
            session: session.map(str::to_string),
            run_id: run_id.map(str::to_string),
            started: Instant::now(),
            armed,
        }
    }
}

impl Drop for RunScope {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        if let Some(t) = global() {
            t.send(Signal::RunEnd {
                session: self.session.take(),
                run_id: self.run_id.take(),
                elapsed: self.started.elapsed(),
            });
        }
    }
}

// ── Aggregation ──────────────────────────────────────────────────────────────

/// `(name, description, unit, is_double)` for every metric this exports.
const METRICS: &[(&str, &str, &str, bool)] = &[
    ("jan_agent.session.count", "Sessions started", "1", false),
    ("jan_agent.prompt.count", "User prompts submitted", "1", false),
    ("jan_agent.turn.count", "Agent loop turns (model requests that start a step)", "1", false),
    ("jan_agent.token.usage", "Tokens used, by type", "tokens", false),
    ("jan_agent.cost.usage", "Estimated cost from the model catalog's published prices", "USD", true),
    ("jan_agent.api_request.count", "Provider requests, by outcome", "1", false),
    ("jan_agent.tool.count", "Tool calls, by tool, decision and outcome", "1", false),
    ("jan_agent.active_time.total", "Time the agent spent running", "s", true),
    ("jan_agent.compaction.count", "History compactions", "1", false),
    ("jan_agent.telemetry.dropped", "Telemetry signals dropped on a full queue", "1", false),
];

type SeriesKey = (&'static str, Vec<(String, String)>);

#[derive(Debug)]
struct PendingRequest {
    at: Instant,
    model: String,
    provider: Option<String>,
    body_bytes: u64,
}

#[derive(Debug)]
struct PendingTool {
    at: Instant,
    name: String,
    args: Option<String>,
}

/// Everything the worker folds signals into. Pure: no I/O, so the mapping from
/// events to metrics and logs is testable without a collector.
pub struct State {
    cfg: Arc<Config>,
    pricer: Option<Pricer>,
    start_nanos: u64,
    counters: BTreeMap<SeriesKey, f64>,
    logs: Vec<LogRecord>,
    sessions_seen: HashSet<String>,
    /// The session each run (`None` = the main run) last reported, from its
    /// provenance, so tool and usage records can carry it.
    run_session: HashMap<Option<String>, String>,
    requests: HashMap<Option<String>, PendingRequest>,
    tools: HashMap<(Option<String>, String), PendingTool>,
    /// Tools a permission prompt was raised for and not yet resolved, per run.
    prompted: HashMap<Option<String>, Vec<String>>,
    /// The prompt currently in flight, per session (`""` = no session id),
    /// so overlapping RPC sessions never tag each other's records.
    prompt_ids: HashMap<String, String>,
    main_session: Option<String>,
}

fn metric_attr(key: &str, value: impl Into<String>) -> (String, String) {
    (key.to_string(), value.into())
}

impl State {
    pub fn new(cfg: Arc<Config>, pricer: Option<Pricer>) -> Self {
        Self {
            cfg,
            pricer,
            start_nanos: wall_nanos(),
            counters: BTreeMap::new(),
            logs: Vec::new(),
            sessions_seen: HashSet::new(),
            run_session: HashMap::new(),
            requests: HashMap::new(),
            tools: HashMap::new(),
            prompted: HashMap::new(),
            prompt_ids: HashMap::new(),
            main_session: None,
        }
    }

    fn add(&mut self, name: &'static str, mut attrs: Vec<(String, String)>, by: f64) {
        if by <= 0.0 {
            return;
        }
        attrs.sort();
        *self.counters.entry((name, attrs)).or_insert(0.0) += by;
    }

    /// `session.id` for a metric point, unless the user opted out of it.
    fn session_attr(&self, session: Option<&str>) -> Vec<(String, String)> {
        match session {
            Some(s) if self.cfg.metrics_session_id => vec![metric_attr("session.id", s)],
            _ => Vec::new(),
        }
    }

    fn session_of(&self, run: &Option<String>) -> Option<String> {
        self.run_session
            .get(run)
            .or_else(|| self.run_session.get(&None))
            .cloned()
            .or_else(|| self.main_session.clone())
    }

    fn log(
        &mut self,
        at: u64,
        name: &str,
        error: bool,
        session: Option<&str>,
        child: Option<&Child>,
        mut attrs: Attrs,
    ) {
        let mut all: Attrs = vec![("event.name".into(), AnyValue::Str(name.to_string()))];
        if let Some(s) = session {
            all.push(("session.id".into(), AnyValue::Str(s.to_string())));
        }
        if let Some(p) = self.prompt_ids.get(session.unwrap_or("")) {
            all.push(("prompt.id".into(), AnyValue::Str(p.clone())));
        }
        if let Some(c) = child {
            all.push(("agent.run_id".into(), AnyValue::Str(c.run_id.clone())));
            all.push(("subagent.name".into(), AnyValue::Str(c.name.clone())));
        }
        all.append(&mut attrs);
        self.logs.push(LogRecord {
            time_unix_nano: at,
            severity_number: if error { 17 } else { 9 },
            severity_text: if error { "ERROR" } else { "INFO" },
            event_name: name.to_string(),
            attrs: all,
        });
    }

    pub fn apply(&mut self, at: Instant, wall: u64, signal: Signal) {
        match signal {
            Signal::RunStart { session, run_id, prompt } => {
                if run_id.is_none() {
                    self.main_session = session.clone();
                    if let Some(s) = &session {
                        self.run_session.insert(None, s.clone());
                        if self.sessions_seen.insert(s.clone()) {
                            let attrs = self.session_attr(Some(s));
                            self.add("jan_agent.session.count", attrs, 1.0);
                        }
                    }
                }
                if let Some((length, text)) = prompt {
                    self.prompt_ids.insert(
                        session.clone().unwrap_or_default(),
                        uuid::Uuid::new_v4().to_string(),
                    );
                    let attrs = self.session_attr(session.as_deref());
                    self.add("jan_agent.prompt.count", attrs, 1.0);
                    let mut fields: Attrs =
                        vec![("prompt_length".into(), AnyValue::Int(length as i64))];
                    if let Some(text) = text {
                        fields.push(("prompt".into(), AnyValue::Str(text)));
                    }
                    self.log(wall, "jan_agent.user_prompt", false, session.as_deref(), None, fields);
                }
            }
            Signal::RunEnd { session, run_id, elapsed } => {
                // Only the top-level run: a child's time overlaps its parent's.
                if run_id.is_none() {
                    let attrs = self.session_attr(session.as_deref());
                    self.add("jan_agent.active_time.total", attrs, elapsed.as_secs_f64());
                }
            }
            Signal::Compaction { message_count } => {
                let session = self.main_session.clone();
                let attrs = self.session_attr(session.as_deref());
                self.add("jan_agent.compaction.count", attrs, 1.0);
                self.log(
                    wall,
                    "jan_agent.compaction",
                    false,
                    session.as_deref(),
                    None,
                    vec![("message_count".into(), AnyValue::Int(message_count as i64))],
                );
            }
            Signal::Event { child, event } => self.apply_event(at, wall, child, event),
            Signal::Flush => {}
        }
    }

    fn apply_event(&mut self, at: Instant, wall: u64, child: Option<Child>, event: EventSignal) {
        let run = child.as_ref().map(|c| c.run_id.clone());
        match event {
            EventSignal::Request { session, provider, model, body_bytes } => {
                if let Some(s) = session {
                    self.run_session.insert(run.clone(), s);
                }
                self.requests.insert(run, PendingRequest { at, model, provider, body_bytes });
            }
            EventSignal::Usage { tokens, execution_id } => {
                let session = self.session_of(&run);
                let request = self.requests.remove(&run);
                let (model, provider) = request
                    .as_ref()
                    .map(|r| (r.model.clone(), r.provider.clone()))
                    .unwrap_or_else(|| ("unknown".to_string(), None));
                let prompt = tokens.prompt;
                let cached = tokens.cached.min(prompt);
                let written = tokens.written.min(prompt - cached);
                let input = prompt - cached - written;
                let output = tokens.completion;
                let mut base = self.session_attr(session.as_deref());
                base.push(metric_attr("model", model.clone()));
                if let Some(p) = &provider {
                    base.push(metric_attr("provider", p.clone()));
                }
                for (kind, n) in [
                    ("input", input),
                    ("output", output),
                    ("cache_read", cached),
                    ("cache_write", written),
                ] {
                    let mut attrs = base.clone();
                    attrs.push(metric_attr("type", kind));
                    self.add("jan_agent.token.usage", attrs, n as f64);
                }
                let cost = self
                    .pricer
                    .as_ref()
                    .and_then(|price| price(provider.as_deref(), &model))
                    .map(|rates| rates.cost_usd(prompt, output, cached, written));
                if let Some(cost) = cost {
                    self.add("jan_agent.cost.usage", base.clone(), cost);
                }
                let mut ok = base;
                ok.push(metric_attr("success", "true"));
                self.add("jan_agent.api_request.count", ok, 1.0);
                let mut fields: Attrs = vec![
                    ("model".into(), AnyValue::Str(model)),
                    ("input_tokens".into(), AnyValue::Int(input as i64)),
                    ("output_tokens".into(), AnyValue::Int(output as i64)),
                    ("cache_read_tokens".into(), AnyValue::Int(cached as i64)),
                    ("cache_write_tokens".into(), AnyValue::Int(written as i64)),
                ];
                if let Some(p) = provider {
                    fields.push(("provider".into(), AnyValue::Str(p)));
                }
                if let Some(r) = &request {
                    let ms = at.saturating_duration_since(r.at).as_millis() as i64;
                    fields.push(("duration_ms".into(), AnyValue::Int(ms)));
                    fields.push(("request_bytes".into(), AnyValue::Int(r.body_bytes as i64)));
                }
                if let Some(cost) = cost {
                    fields.push(("cost_usd".into(), AnyValue::Double(cost)));
                }
                if let Some(id) = execution_id {
                    fields.push(("execution_id".into(), AnyValue::Str(id)));
                }
                self.log(wall, "jan_agent.api_request", false, session.as_deref(), child.as_ref(), fields);
            }
            EventSignal::Step => {
                let mut attrs = Vec::new();
                attrs.push(metric_attr("agent", if child.is_some() { "subagent" } else { "main" }));
                self.add("jan_agent.turn.count", attrs, 1.0);
            }
            EventSignal::ToolCall { id, name, args } => {
                self.tools.insert((run, id), PendingTool { at, name, args });
            }
            EventSignal::Permission { tool_name } => {
                self.prompted.entry(run).or_default().push(tool_name);
            }
            EventSignal::ToolResult { id, is_error, refusal, bytes } => {
                let session = self.session_of(&run);
                let Some(tool) = self.tools.remove(&(run.clone(), id)) else {
                    return;
                };
                let prompted = self
                    .prompted
                    .get_mut(&run)
                    .and_then(|names| {
                        let at = names.iter().position(|n| *n == tool.name)?;
                        Some(names.remove(at))
                    })
                    .is_some();
                let (decision, source) = match refusal {
                    Some(r) => ("reject", r.source()),
                    None if prompted => ("accept", "user"),
                    None => ("accept", "config"),
                };
                let success = !is_error;
                let mut attrs = self.session_attr(session.as_deref());
                attrs.push(metric_attr("tool_name", tool.name.clone()));
                attrs.push(metric_attr("decision", decision));
                attrs.push(metric_attr("success", success.to_string()));
                self.add("jan_agent.tool.count", attrs, 1.0);
                self.log(
                    wall,
                    "jan_agent.tool_decision",
                    false,
                    session.as_deref(),
                    child.as_ref(),
                    vec![
                        ("tool_name".into(), AnyValue::Str(tool.name.clone())),
                        ("decision".into(), AnyValue::Str(decision.into())),
                        ("source".into(), AnyValue::Str(source.into())),
                    ],
                );
                let mut fields: Attrs = vec![
                    ("tool_name".into(), AnyValue::Str(tool.name)),
                    ("success".into(), AnyValue::Bool(success)),
                    (
                        "duration_ms".into(),
                        AnyValue::Int(at.saturating_duration_since(tool.at).as_millis() as i64),
                    ),
                    ("decision".into(), AnyValue::Str(decision.into())),
                    ("decision_source".into(), AnyValue::Str(source.into())),
                    ("result_size_bytes".into(), AnyValue::Int(bytes as i64)),
                ];
                if let Some(args) = tool.args {
                    fields.push(("tool_parameters".into(), AnyValue::Str(args)));
                }
                self.log(wall, "jan_agent.tool_result", !success, session.as_deref(), child.as_ref(), fields);
            }
            EventSignal::Error { code, message } => {
                let session = self.session_of(&run);
                let request = self.requests.remove(&run);
                let mut fields: Attrs = vec![
                    ("code".into(), AnyValue::Str(code)),
                    ("error".into(), AnyValue::Str(message)),
                ];
                if let Some(r) = request {
                    let mut attrs = self.session_attr(session.as_deref());
                    attrs.push(metric_attr("model", r.model.clone()));
                    if let Some(p) = &r.provider {
                        attrs.push(metric_attr("provider", p.clone()));
                    }
                    attrs.push(metric_attr("success", "false"));
                    self.add("jan_agent.api_request.count", attrs, 1.0);
                    fields.push(("model".into(), AnyValue::Str(r.model)));
                    fields.push((
                        "duration_ms".into(),
                        AnyValue::Int(at.saturating_duration_since(r.at).as_millis() as i64),
                    ));
                }
                self.log(wall, "jan_agent.api_error", true, session.as_deref(), child.as_ref(), fields);
            }
            EventSignal::SubagentEnd { failed } => {
                let session = self.session_of(&None);
                self.log(
                    wall,
                    "jan_agent.subagent_result",
                    failed,
                    session.as_deref(),
                    child.as_ref(),
                    vec![("success".into(), AnyValue::Bool(!failed))],
                );
                // The child's bookkeeping ends with it.
                self.requests.remove(&run);
                self.run_session.remove(&run);
                self.prompted.remove(&run);
                self.tools.retain(|(r, _), _| *r != run);
            }
        }
    }

    pub fn take_logs(&mut self) -> Vec<LogRecord> {
        std::mem::take(&mut self.logs)
    }

    pub fn pending_logs(&self) -> usize {
        self.logs.len()
    }

    /// Every series so far, cumulative since the exporter started.
    pub fn metrics(&self, now: u64, dropped: u64) -> Vec<Metric> {
        let mut by_name: BTreeMap<&'static str, Vec<Point>> = BTreeMap::new();
        let dropped_key = ("jan_agent.telemetry.dropped", Vec::new());
        let dropped_entry = (dropped > 0).then_some((&dropped_key, dropped as f64));
        for ((name, attrs), value) in self
            .counters
            .iter()
            .map(|(k, v)| (k, *v))
            .chain(dropped_entry)
        {
            let is_double = METRICS.iter().find(|m| m.0 == *name).is_some_and(|m| m.3);
            by_name.entry(name).or_default().push(Point {
                attrs: attrs
                    .iter()
                    .map(|(k, v)| (k.clone(), AnyValue::Str(v.clone())))
                    .collect(),
                start_unix_nano: self.start_nanos,
                time_unix_nano: now,
                value: if is_double {
                    PointValue::Double(value)
                } else {
                    PointValue::Int(value as i64)
                },
            });
        }
        by_name
            .into_iter()
            .map(|(name, points)| {
                let (_, description, unit, _) =
                    METRICS.iter().find(|m| m.0 == name).copied().unwrap_or((name, "", "", false));
                Metric {
                    name: name.to_string(),
                    description: description.to_string(),
                    unit: unit.to_string(),
                    points,
                }
            })
            .collect()
    }
}

// ── Export ───────────────────────────────────────────────────────────────────

struct Worker {
    cfg: Arc<Config>,
    state: State,
    origin: Origin,
    dropped: Arc<AtomicU64>,
    client: reqwest::Client,
    /// Whether any metric changed since the last export, so an idle process
    /// does not re-send the same totals every interval.
    metrics_dirty: bool,
}

impl Worker {
    fn new(cfg: Arc<Config>, pricer: Option<Pricer>, version: &str, dropped: Arc<AtomicU64>) -> Self {
        let mut resource: Attrs = cfg
            .resource
            .iter()
            .map(|(k, v)| (k.clone(), AnyValue::Str(v.clone())))
            .collect();
        for (k, v) in [
            ("service.version", version.to_string()),
            ("os.type", std::env::consts::OS.to_string()),
            ("host.arch", std::env::consts::ARCH.to_string()),
        ] {
            if !resource.iter().any(|(existing, _)| existing == k) {
                resource.push((k.to_string(), AnyValue::Str(v)));
            }
        }
        let client = reqwest::Client::builder()
            .timeout(cfg.export_timeout)
            .build()
            .unwrap_or_default();
        Self {
            state: State::new(Arc::clone(&cfg), pricer),
            origin: Origin {
                resource,
                scope_name: "jan-agent".to_string(),
                scope_version: version.to_string(),
            },
            cfg,
            dropped,
            client,
            metrics_dirty: false,
        }
    }

    async fn run(
        mut self,
        mut rx: mpsc::Receiver<(Instant, u64, Signal)>,
        mut stop: oneshot::Receiver<()>,
    ) {
        let mut metric_tick = tokio::time::interval(self.cfg.metric_interval);
        let mut logs_tick = tokio::time::interval(self.cfg.logs_interval);
        // The first tick of an interval fires at once; skip it.
        metric_tick.tick().await;
        logs_tick.tick().await;
        loop {
            tokio::select! {
                biased;
                _ = &mut stop => break,
                message = rx.recv() => {
                    let Some((at, wall, signal)) = message else { break };
                    let flush = matches!(signal, Signal::Flush)
                        || matches!(signal, Signal::RunEnd { run_id: None, .. });
                    self.metrics_dirty |= !matches!(signal, Signal::Flush);
                    self.state.apply(at, wall, signal);
                    if flush {
                        self.export_all().await;
                    } else if self.state.pending_logs() >= LOG_BATCH {
                        self.export_logs().await;
                    }
                }
                _ = metric_tick.tick() => self.export_metrics().await,
                _ = logs_tick.tick() => self.export_logs().await,
            }
        }
        // Whatever the agent already queued is part of the run being reported.
        while let Ok((at, wall, signal)) = rx.try_recv() {
            self.metrics_dirty = true;
            self.state.apply(at, wall, signal);
        }
        // Dirty only if something changed since the last export: a run's end
        // already exported, and resending identical totals is noise.
        self.export_all().await;
    }

    async fn export_all(&mut self) {
        self.export_logs().await;
        self.export_metrics().await;
    }

    async fn export_metrics(&mut self) {
        let Some(target) = self.cfg.metrics.clone() else { return };
        if !self.metrics_dirty {
            return;
        }
        let metrics = self.state.metrics(wall_nanos(), self.dropped.load(Ordering::Relaxed));
        if metrics.is_empty() {
            return;
        }
        self.metrics_dirty = false;
        let body = target.protocol.encode(
            || encode::metrics_json(&self.origin, &metrics),
            || encode::metrics_proto(&self.origin, &metrics),
        );
        self.post(&target, body, "metrics").await;
    }

    async fn export_logs(&mut self) {
        let Some(target) = self.cfg.logs.clone() else {
            self.state.take_logs();
            return;
        };
        let logs = self.state.take_logs();
        if logs.is_empty() {
            return;
        }
        let body = target.protocol.encode(
            || encode::logs_json(&self.origin, &logs),
            || encode::logs_proto(&self.origin, &logs),
        );
        self.post(&target, body, "logs").await;
    }

    /// One POST. Failures are the collector's problem, not the run's: logged
    /// at debug (never the URL's headers) and otherwise ignored.
    async fn post(&self, target: &Target, body: Vec<u8>, signal: &str) {
        let mut request = self
            .client
            .post(&target.url)
            .header(reqwest::header::CONTENT_TYPE, target.protocol.content_type())
            .body(body);
        for (k, v) in &target.headers {
            request = request.header(k.as_str(), v.as_str());
        }
        match request.send().await {
            Ok(response) if response.status().is_success() => {}
            Ok(response) => {
                log::debug!("telemetry: {signal} export rejected: HTTP {}", response.status())
            }
            Err(e) => log::debug!("telemetry: {signal} export failed: {}", e.without_url()),
        }
    }
}

#[cfg(test)]
mod tests;
