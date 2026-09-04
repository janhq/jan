//! The `monitor` tool: poll one shell script on an interval until it matches,
//! then report its output to the agent as an out-of-band notice.
//!
//! The script is arbitrary shell run from the project root under the same
//! confinement `bash` gets (`handlers::confined_shell`). Exit 0 means matched,
//! and its stdout is the matched content; anything else means "not yet" and
//! the poll repeats. A monitor is one-shot: the first match ends it, as does an
//! explicit stop or its deadline -- the bound that makes it safe for a
//! run-owned set to park a run on an active monitor. One script per monitor
//! keeps the call shape small enough for local models to emit reliably.
//!
//! Delivery is the caller's: a [`MonitorSet`] either queues [`MonitorUpdate`]s
//! for the agent loop to drain into `<SYSTEM>` reminders (the CLI/desktop run
//! path), or hands each one to a subscriber callback (the Tauri command layer,
//! which forwards them to Cowork over an IPC channel).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::tools::ToolContext;

pub const MONITOR_TOOL_NAME: &str = "monitor";

/// Active monitors per set. Each one holds a background task, and a run
/// fanning out more than this is doing the job's work itself.
pub const MAX_MONITORS: usize = 8;
pub const DEFAULT_TIMEOUT_SECS: u64 = 1800;
pub const MAX_TIMEOUT_SECS: u64 = 7200;
const MIN_TIMEOUT_SECS: u64 = 10;
pub const DEFAULT_INTERVAL_SECS: u64 = 5;
const MIN_INTERVAL_SECS: u64 = 1;
const MAX_INTERVAL_SECS: u64 = 300;
/// A script that runs longer than this is killed and treated as unmatched; a
/// poll is a check, not a job of its own.
const EVAL_TIMEOUT: Duration = Duration::from_secs(60);
/// Cap on the label derived from a script when no `name` is given.
const DEFAULT_NAME_CHARS: usize = 60;
/// Cap on the matched content a notice carries into the conversation.
const MATCH_MAX_BYTES: usize = 4096;

#[derive(Debug, Clone, PartialEq)]
pub struct MonitorSpec {
    /// Short label quoted back in every notice; the script itself when the
    /// model gave none.
    pub name: String,
    /// Run from the project root on every poll; exit 0 = matched.
    pub script: String,
    pub timeout_secs: u64,
    /// Poll cadence, model-settable within [`MIN_INTERVAL_SECS`, `MAX_INTERVAL_SECS`].
    pub interval: Duration,
}

/// Owned snapshot of the [`ToolContext`] fields an evaluation needs: the
/// monitor task outlives the borrowed context of the call that started it.
#[derive(Debug, Clone)]
pub struct MonitorCtx {
    pub project_root: PathBuf,
    pub scratch_root: Option<PathBuf>,
    pub mask_root: Option<PathBuf>,
    pub read_roots: Vec<PathBuf>,
    pub write_roots: Vec<PathBuf>,
    pub allow_network: bool,
    pub home_readonly: bool,
    pub sandbox: bool,
}

impl MonitorCtx {
    pub fn from_tool_context(ctx: &ToolContext<'_>) -> Self {
        Self {
            project_root: ctx.project_root.to_path_buf(),
            scratch_root: ctx.scratch_root.map(Path::to_path_buf),
            mask_root: ctx.mask_root.map(Path::to_path_buf),
            read_roots: ctx.read_roots.to_vec(),
            write_roots: ctx.write_roots.to_vec(),
            allow_network: ctx.allow_network,
            home_readonly: ctx.home_readonly,
            sandbox: ctx.sandbox,
        }
    }

    /// A borrowed context over this snapshot, for the pieces of the bash
    /// machinery that take one. The store root is never consulted by an exec,
    /// so the project root stands in for it.
    fn as_tool_context(&self) -> ToolContext<'_> {
        let mut ctx = ToolContext::new(&self.project_root, &self.project_root, &[])
            .with_network(self.allow_network)
            .with_home_readonly(self.home_readonly)
            .with_sandbox(self.sandbox)
            .with_read_roots(&self.read_roots)
            .with_write_roots(&self.write_roots);
        if let Some(mask) = &self.mask_root {
            ctx = ctx.with_mask_root(mask);
        }
        if let Some(scratch) = &self.scratch_root {
            ctx = ctx.with_scratch_root(scratch);
        }
        ctx
    }
}

/// One notice, in the two registers every background ping needs: `headline`
/// for the transcript row, `text` for the `<SYSTEM>` reminder the model gets.
/// Every update is terminal (a match or the timeout), so it also closes the
/// monitor on any display that tracks it; `matched` tells the two apart.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorUpdate {
    pub monitor_id: String,
    pub name: String,
    pub headline: String,
    pub text: String,
    pub matched: bool,
}

/// Display-only view of one active monitor, for a status panel.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorSnapshot {
    pub monitor_id: String,
    pub name: String,
    pub script: String,
    pub polls: u64,
}

/// Parse and validate a `monitor {op:"start"}` call.
pub fn parse_start_args(args: &serde_json::Value) -> Result<MonitorSpec, String> {
    let script = args
        .get("script")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or("start requires 'script': a shell command that exits 0 once the thing you are waiting for has happened")?
        .to_string();
    let name = args
        .get("name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| default_name(&script));
    let timeout_secs = args
        .get("timeout")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_TIMEOUT_SECS)
        .clamp(MIN_TIMEOUT_SECS, MAX_TIMEOUT_SECS);
    let interval_secs = args
        .get("interval")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_INTERVAL_SECS)
        .clamp(MIN_INTERVAL_SECS, MAX_INTERVAL_SECS);
    Ok(MonitorSpec {
        name,
        script,
        timeout_secs,
        interval: Duration::from_secs(interval_secs),
    })
}

/// The script, flattened to one line and capped, as the label when the model
/// gave none.
fn default_name(script: &str) -> String {
    let flat: String = script.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= DEFAULT_NAME_CHARS {
        return flat;
    }
    let head: String = flat.chars().take(DEFAULT_NAME_CHARS - 3).collect();
    format!("{head}...")
}

pub fn parse_stop_args(args: &serde_json::Value) -> Result<String, String> {
    args.get("monitor_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "stop requires 'monitor_id'".to_string())
}

/// Shared view of one monitor, read by `list` and the snapshot and written by
/// the monitor's own task.
struct MonitorStatus {
    name: String,
    script: String,
    interval: Duration,
    polls: u64,
}

struct Entry {
    abort: tokio::task::AbortHandle,
    status: Arc<Mutex<MonitorStatus>>,
}

/// How a set delivers updates: queued for the agent loop to drain as
/// `<SYSTEM>` reminders, or pushed to a subscriber as they happen.
enum Delivery {
    Queue,
    Subscriber(Arc<dyn Fn(MonitorUpdate) + Send + Sync>),
}

/// Registry of one owner's monitors (a run on the CLI/desktop loop, a Cowork
/// session on the command layer). Mirrors `BackgroundSubagents`: notices +
/// wake + an active count whose decrement always follows the notice push, so
/// "is anything still owed?" can never read false in between.
pub struct MonitorSet {
    inner: Mutex<std::collections::HashMap<String, Entry>>,
    notices: Mutex<Vec<MonitorUpdate>>,
    wake: tokio::sync::Notify,
    active: AtomicUsize,
    seq: AtomicU64,
    delivery: Delivery,
}

impl Default for MonitorSet {
    fn default() -> Self {
        Self::new()
    }
}

impl MonitorSet {
    pub fn new() -> Self {
        Self::with_delivery(Delivery::Queue)
    }

    /// Route every update to `subscriber` instead of the queue. The subscriber
    /// owns ordering and persistence; `take_notices` then never has anything.
    pub fn subscribed(subscriber: Arc<dyn Fn(MonitorUpdate) + Send + Sync>) -> Self {
        Self::with_delivery(Delivery::Subscriber(subscriber))
    }

    fn with_delivery(delivery: Delivery) -> Self {
        Self {
            inner: Mutex::new(std::collections::HashMap::new()),
            notices: Mutex::new(Vec::new()),
            wake: tokio::sync::Notify::new(),
            active: AtomicUsize::new(0),
            seq: AtomicU64::new(1),
            delivery,
        }
    }

    /// Take every queued update, oldest first.
    pub fn take_notices(&self) -> Vec<MonitorUpdate> {
        std::mem::take(&mut *self.notices.lock().unwrap())
    }

    /// Whether anything could still produce an update: an active monitor, or a
    /// queued update not yet delivered. Safe to park on -- every monitor
    /// terminates (all met, stopped, or its deadline).
    pub fn has_pending_work(&self) -> bool {
        self.has_queued_notices() || self.active.load(Ordering::SeqCst) > 0
    }

    /// Whether an update is queued and not yet taken. Unlike
    /// [`Self::has_pending_work`] this says nothing about running monitors: a
    /// set that outlives its run consults it to decide whether the model has
    /// something to react to *now*.
    pub fn has_queued_notices(&self) -> bool {
        !self.notices.lock().unwrap().is_empty()
    }

    /// Park until an update is queued, or nothing is left to wait for. The
    /// waiter registers before the state re-read, so a monitor finishing in
    /// between wakes this call rather than being missed.
    pub async fn wait_for_notice(&self) {
        loop {
            let waiter = self.wake.notified();
            tokio::pin!(waiter);
            waiter.as_mut().enable();
            if !self.notices.lock().unwrap().is_empty() || self.active.load(Ordering::SeqCst) == 0 {
                return;
            }
            waiter.await;
        }
    }

    fn push_update(&self, update: MonitorUpdate) {
        match &self.delivery {
            Delivery::Queue => {
                self.notices.lock().unwrap().push(update);
            }
            Delivery::Subscriber(subscriber) => subscriber(update),
        }
        self.wake.notify_waiters();
    }

    /// Start a monitor, returning the model-facing result string.
    pub fn start(self: &Arc<Self>, spec: MonitorSpec, ctx: MonitorCtx) -> Result<String, String> {
        if self.inner.lock().unwrap().len() >= MAX_MONITORS {
            return Err(format!(
                "at most {MAX_MONITORS} monitors may be active; stop one first"
            ));
        }
        let monitor_id = format!("mon-{}", self.seq.fetch_add(1, Ordering::Relaxed));
        let status = Arc::new(Mutex::new(MonitorStatus {
            name: spec.name.clone(),
            script: spec.script.clone(),
            interval: spec.interval,
            polls: 0,
        }));
        let name = spec.name.clone();
        let timeout_secs = spec.timeout_secs;
        let interval_secs = spec.interval.as_secs();

        self.active.fetch_add(1, Ordering::SeqCst);
        let set = self.clone();
        let id_task = monitor_id.clone();
        let status_task = status.clone();
        let handle = tokio::spawn(async move {
            run_monitor(&set, &id_task, spec, ctx, status_task).await;
            // The terminal update (queued inside run_monitor) precedes both the
            // entry removal and the count release.
            set.inner.lock().unwrap().remove(&id_task);
            set.active.fetch_sub(1, Ordering::SeqCst);
            set.wake.notify_waiters();
        });
        self.inner.lock().unwrap().insert(
            monitor_id.clone(),
            Entry {
                abort: handle.abort_handle(),
                status,
            },
        );
        Ok(format!(
            "Monitor started (monitor_id={monitor_id}): '{name}' runs every {interval_secs}s. \
             When it exits 0 you get a <SYSTEM> note with its output and the monitor stops; it \
             also stops if you stop it or after {timeout_secs}s without a match. Keep working \
             meanwhile."
        ))
    }

    /// Stop one monitor. Its own tool result reports the state; no notice is
    /// queued, since the model asked for the stop itself.
    pub fn stop(&self, monitor_id: &str) -> String {
        let entry = self.inner.lock().unwrap().remove(monitor_id);
        let Some(entry) = entry else {
            return format!("ERROR: unknown or already-stopped monitor '{monitor_id}'");
        };
        entry.abort.abort();
        self.active.fetch_sub(1, Ordering::SeqCst);
        self.wake.notify_waiters();
        let status = entry.status.lock().unwrap();
        format!(
            "Monitor {monitor_id} ('{}') stopped after {} without a match.",
            status.name,
            pluralize_polls(status.polls)
        )
    }

    /// One line per active monitor, for `monitor {op:"list"}`.
    pub fn list(&self) -> String {
        let inner = self.inner.lock().unwrap();
        if inner.is_empty() {
            return "No active monitors.".to_string();
        }
        let mut ids: Vec<&String> = inner.keys().collect();
        ids.sort();
        let mut out = String::new();
        for id in ids {
            let status = inner[id].status.lock().unwrap();
            out.push_str(&format!(
                "{id}: '{}' every {}s, {} so far ({})\n",
                status.name,
                status.interval.as_secs(),
                pluralize_polls(status.polls),
                status.script
            ));
        }
        out.trim_end().to_string()
    }

    /// Every active monitor, ordered by id, for a live status display. Same
    /// source as `list`, so the screen and the model never disagree.
    pub fn snapshot(&self) -> Vec<MonitorSnapshot> {
        let inner = self.inner.lock().unwrap();
        let mut ids: Vec<&String> = inner.keys().collect();
        ids.sort();
        ids.into_iter()
            .map(|id| {
                let status = inner[id].status.lock().unwrap();
                MonitorSnapshot {
                    monitor_id: id.clone(),
                    name: status.name.clone(),
                    script: status.script.clone(),
                    polls: status.polls,
                }
            })
            .collect()
    }

    /// Abort and forget every monitor. Called at owner teardown; nothing is
    /// queued, since no turn is left to read it.
    pub fn stop_all(&self) {
        let mut inner = self.inner.lock().unwrap();
        for (_, entry) in inner.drain() {
            entry.abort.abort();
            self.active.fetch_sub(1, Ordering::SeqCst);
        }
        self.notices.lock().unwrap().clear();
        self.wake.notify_waiters();
    }
}

impl Drop for MonitorSet {
    fn drop(&mut self) {
        // Abort without touching the counters: the set is going away with its
        // owner, and a waiter cannot outlive it.
        for (_, entry) in self.inner.lock().unwrap().drain() {
            entry.abort.abort();
        }
    }
}

fn pluralize_polls(n: u64) -> String {
    if n == 1 {
        "1 poll".to_string()
    } else {
        format!("{n} polls")
    }
}

async fn run_monitor(
    set: &Arc<MonitorSet>,
    monitor_id: &str,
    spec: MonitorSpec,
    ctx: MonitorCtx,
    status: Arc<Mutex<MonitorStatus>>,
) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(spec.timeout_secs);
    loop {
        status.lock().unwrap().polls += 1;
        if let Some(content) = eval_script(&ctx, &spec.script).await {
            set.push_update(match_update(monitor_id, &spec.name, &content));
            return;
        }
        let now = tokio::time::Instant::now();
        if now >= deadline {
            let polls = status.lock().unwrap().polls;
            set.push_update(MonitorUpdate {
                monitor_id: monitor_id.to_string(),
                name: spec.name.clone(),
                headline: format!("Monitor {monitor_id}: '{}' timed out", spec.name),
                text: format!(
                    "Monitor '{monitor_id}' ('{}') timed out after {}s and {} without a match. \
                     It has stopped.",
                    spec.name,
                    spec.timeout_secs,
                    pluralize_polls(polls)
                ),
                matched: false,
            });
            return;
        }
        tokio::time::sleep(spec.interval.min(deadline - now)).await;
    }
}

fn match_update(monitor_id: &str, name: &str, content: &str) -> MonitorUpdate {
    let body = if content.is_empty() {
        " (the script exited 0 with no output)".to_string()
    } else {
        format!(":\n{content}")
    };
    MonitorUpdate {
        monitor_id: monitor_id.to_string(),
        name: name.to_string(),
        headline: format!("Monitor {monitor_id}: '{name}' matched"),
        text: format!("Monitor '{monitor_id}' ('{name}') matched{body}\n\nIt has stopped."),
        matched: true,
    }
}

/// Run the script once under the same confinement `bash` gets. `Some(content)`
/// when it exits 0 (its stdout, bounded); `None` for a nonzero exit, a spawn
/// failure, or a script that outran [`EVAL_TIMEOUT`] -- all of which read as
/// "not yet" and are retried on the next poll.
async fn eval_script(ctx: &MonitorCtx, script: &str) -> Option<String> {
    let tool_ctx = ctx.as_tool_context();
    let (shell, sandbox_tmp, _policy) = crate::tools::handlers::confined_shell(&tool_ctx).ok()?;
    let mut child =
        crate::tools::proc::spawn(&shell, script, &ctx.project_root, sandbox_tmp.as_deref())
            .await
            .ok()?;
    let pid = child.id();
    let result = tokio::time::timeout(EVAL_TIMEOUT, async {
        let stdout = child.stdout.take();
        // Drained so a chatty script cannot block on a full pipe, discarded
        // because only stdout is the matched content.
        let stderr = child.stderr.take();
        let drain = async {
            if let Some(mut stderr) = stderr {
                let mut sink = tokio::io::sink();
                let _ = tokio::io::copy(&mut stderr, &mut sink).await;
            }
        };
        let read = async {
            let mut head = Vec::new();
            if let Some(mut stdout) = stdout {
                use tokio::io::AsyncReadExt;
                let mut buf = [0u8; 8192];
                loop {
                    match stdout.read(&mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            let room = MATCH_MAX_BYTES.saturating_sub(head.len());
                            head.extend_from_slice(&buf[..n.min(room)]);
                            // Keep draining past the cap so the child never
                            // blocks on a full pipe.
                        }
                    }
                }
            }
            head
        };
        let (head, ()) = tokio::join!(read, drain);
        (child.wait().await, head)
    })
    .await;
    if let Some(pid) = pid {
        crate::tools::proc::unregister(pid);
    }
    match result {
        Ok((Ok(exit), head)) if exit.success() => {
            Some(String::from_utf8_lossy(&head).trim().to_string())
        }
        Ok(_) => None,
        Err(_) => {
            // Timed out: reap the whole tree, or a wedged matcher leaks.
            if let Some(pid) = pid {
                crate::tools::proc::kill_tree(pid);
            }
            None
        }
    }
}

/// OpenAI function schema for the `monitor` tool. Mirrored verbatim by
/// Cowork's client-side tool table, like `task`/`todo`.
pub fn monitor_tool_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "function",
        "function": {
            "name": MONITOR_TOOL_NAME,
            "description": "Wait for something in the background: poll a shell script on an interval until it exits 0, then get its stdout as a <SYSTEM> note while you keep working. Use it to wait on a backgrounded job, e.g. script \"grep -m1 'BUILD FAILED' build.log\" or \"test -f done.flag\". The script runs from the project root on every poll; a nonzero exit means not yet. The first match ends the monitor, as does its timeout. Start one monitor per thing you are waiting for.",
            "parameters": {
                "type": "object",
                "properties": {
                    "op": { "type": "string", "enum": ["start", "stop", "list"] },
                    "script": { "type": "string", "description": "For start: a cheap shell check that exits 0 once the thing has happened; its stdout is what you get back." },
                    "name": { "type": "string", "description": "For start: optional short label quoted back to you when it matches (defaults to the script)." },
                    "interval": { "type": "integer", "description": "For start: seconds between polls (default 5, min 1, max 300)." },
                    "timeout": { "type": "integer", "description": "For start: seconds before the monitor gives up (default 1800, max 7200)." },
                    "monitor_id": { "type": "string", "description": "For stop: the id returned by start." }
                },
                "required": ["op"]
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh directory under the OS temp dir (the plugin has no tempfile
    /// dev-dependency; same pattern as the handlers tests).
    fn unique_root() -> PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let n = N.fetch_add(1, Ordering::SeqCst);
        let root =
            std::env::temp_dir().join(format!("jan_monitor_test_{}_{}", std::process::id(), n));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn ctx_for(root: &Path) -> MonitorCtx {
        MonitorCtx {
            project_root: root.to_path_buf(),
            scratch_root: None,
            mask_root: None,
            read_roots: Vec::new(),
            write_roots: Vec::new(),
            allow_network: false,
            home_readonly: false,
            // Bare shell: these tests exercise the monitor loop, not the jail.
            sandbox: false,
        }
    }

    fn spec(name: &str, script: &str, timeout_secs: u64) -> MonitorSpec {
        MonitorSpec {
            name: name.to_string(),
            script: script.to_string(),
            timeout_secs,
            interval: Duration::from_millis(25),
        }
    }

    async fn next_notice(set: &Arc<MonitorSet>) -> MonitorUpdate {
        for _ in 0..200 {
            if let Some(update) = set.take_notices().into_iter().next() {
                return update;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("no monitor update arrived");
    }

    #[test]
    fn parse_requires_a_script_and_labels_it_by_default() {
        assert!(parse_start_args(&serde_json::json!({"op": "start"})).is_err());
        assert!(parse_start_args(&serde_json::json!({"op": "start", "script": "  "})).is_err());
        let spec = parse_start_args(&serde_json::json!({
            "op": "start", "script": "grep -m1   FAILED\n build.log"
        }))
        .unwrap();
        assert_eq!(spec.name, "grep -m1 FAILED build.log", "flattened script");
        let named = parse_start_args(&serde_json::json!({
            "op": "start", "script": "true", "name": " build "
        }))
        .unwrap();
        assert_eq!(named.name, "build");
        let long = "x".repeat(200);
        let spec = parse_start_args(&serde_json::json!({ "op": "start", "script": long })).unwrap();
        assert_eq!(spec.name.chars().count(), DEFAULT_NAME_CHARS);
        assert!(spec.name.ends_with("..."));
    }

    #[test]
    fn parse_clamps_the_timeout_and_interval_and_defaults_them() {
        let base = serde_json::json!({ "op": "start", "script": "true" });
        let spec = parse_start_args(&base).unwrap();
        assert_eq!(spec.timeout_secs, DEFAULT_TIMEOUT_SECS);
        assert_eq!(spec.interval, Duration::from_secs(DEFAULT_INTERVAL_SECS));
        let mut low = base.clone();
        low["timeout"] = serde_json::json!(1);
        low["interval"] = serde_json::json!(0);
        let spec = parse_start_args(&low).unwrap();
        assert_eq!(spec.timeout_secs, MIN_TIMEOUT_SECS);
        assert_eq!(spec.interval, Duration::from_secs(MIN_INTERVAL_SECS));
        let mut high = base;
        high["timeout"] = serde_json::json!(1_000_000);
        high["interval"] = serde_json::json!(1_000_000);
        let spec = parse_start_args(&high).unwrap();
        assert_eq!(spec.timeout_secs, MAX_TIMEOUT_SECS);
        assert_eq!(spec.interval, Duration::from_secs(MAX_INTERVAL_SECS));
    }

    #[tokio::test]
    async fn a_script_matching_at_start_reports_its_output_and_stops() {
        let dir = unique_root();
        std::fs::write(dir.join("build.log"), "warm up\nBUILD OK line\n").unwrap();
        let set = Arc::new(MonitorSet::new());
        let result = set
            .start(spec("ok", "grep 'BUILD OK' build.log", 30), ctx_for(&dir))
            .unwrap();
        assert!(result.contains("monitor_id=mon-1"), "{result}");
        assert!(result.contains("'ok'"), "{result}");
        let update = next_notice(&set).await;
        assert!(update.matched);
        assert_eq!(update.name, "ok");
        assert!(
            update.headline.contains("'ok' matched"),
            "{}",
            update.headline
        );
        assert!(update.text.contains("BUILD OK line"), "{}", update.text);
        assert!(update.text.contains("It has stopped"));
        for _ in 0..100 {
            if !set.has_pending_work() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("the set still reports pending work after the match");
    }

    #[tokio::test]
    async fn a_later_change_is_caught_by_a_following_poll() {
        let dir = unique_root();
        let log = dir.join("job.log");
        std::fs::write(&log, "phase one done\n").unwrap();
        let set = Arc::new(MonitorSet::new());
        set.start(spec("two", "grep 'phase two' job.log", 30), ctx_for(&dir))
            .unwrap();
        tokio::time::sleep(Duration::from_millis(80)).await;
        assert!(set.take_notices().is_empty(), "nothing matched yet");
        assert!(set.has_pending_work());
        let listed = set.list();
        assert!(listed.contains("mon-1: 'two' every 0s"), "{listed}");
        assert!(listed.contains("grep 'phase two' job.log"), "{listed}");

        let mut content = std::fs::read_to_string(&log).unwrap();
        content.push_str("phase two done\n");
        std::fs::write(&log, content).unwrap();
        let update = next_notice(&set).await;
        assert!(update.matched);
        assert!(update.text.contains("phase two done"), "{}", update.text);
    }

    #[tokio::test]
    async fn snapshot_lists_active_monitors_with_their_poll_count() {
        let dir = unique_root();
        let set = Arc::new(MonitorSet::new());
        set.start(spec("never", "false", 30), ctx_for(&dir))
            .unwrap();
        tokio::time::sleep(Duration::from_millis(80)).await;
        let snap = set.snapshot();
        assert_eq!(snap.len(), 1);
        assert_eq!(snap[0].monitor_id, "mon-1");
        assert_eq!(snap[0].name, "never");
        assert_eq!(snap[0].script, "false");
        assert!(snap[0].polls >= 2, "polled repeatedly: {}", snap[0].polls);
        set.stop("mon-1");
        assert!(set.snapshot().is_empty());
    }

    #[tokio::test]
    async fn an_unmatched_monitor_times_out() {
        let dir = unique_root();
        let set = Arc::new(MonitorSet::new());
        // Timeout of zero: the deadline has passed by the first re-check, so
        // the test never waits out a real timeout.
        set.start(spec("ghost", "grep ghost never.log", 0), ctx_for(&dir))
            .unwrap();
        let update = next_notice(&set).await;
        assert!(!update.matched);
        assert!(update.text.contains("timed out"), "{}", update.text);
        assert!(update.text.contains("'ghost'"), "{}", update.text);
        assert!(update.text.contains("1 poll"), "{}", update.text);
    }

    #[tokio::test]
    async fn stop_reports_the_poll_count_and_frees_the_slot() {
        let dir = unique_root();
        let set = Arc::new(MonitorSet::new());
        let result = set
            .start(spec("ghost", "false", 3600), ctx_for(&dir))
            .unwrap();
        assert!(result.contains("mon-1"));
        assert!(set.has_pending_work());
        let stopped = set.stop("mon-1");
        assert!(stopped.contains("('ghost') stopped after"), "{stopped}");
        assert!(stopped.contains("without a match"), "{stopped}");
        assert!(!set.has_pending_work());
        assert!(set.stop("mon-1").starts_with("ERROR"));
        assert_eq!(set.list(), "No active monitors.");
    }

    #[tokio::test]
    async fn the_monitor_cap_is_enforced() {
        let dir = unique_root();
        let set = Arc::new(MonitorSet::new());
        for _ in 0..MAX_MONITORS {
            set.start(spec("x", "false", 3600), ctx_for(&dir)).unwrap();
        }
        let err = set
            .start(spec("x", "false", 3600), ctx_for(&dir))
            .unwrap_err();
        assert!(err.contains("at most"), "{err}");
        set.stop_all();
        assert!(!set.has_pending_work());
    }

    #[tokio::test]
    async fn wait_for_notice_wakes_on_a_match() {
        let dir = unique_root();
        let log = dir.join("late.log");
        let set = Arc::new(MonitorSet::new());
        set.start(spec("hit", "grep hit late.log", 30), ctx_for(&dir))
            .unwrap();
        let waiter = {
            let set = set.clone();
            tokio::spawn(async move {
                set.wait_for_notice().await;
                set.take_notices()
            })
        };
        tokio::time::sleep(Duration::from_millis(60)).await;
        std::fs::write(&log, "a hit at last\n").unwrap();
        let notices = tokio::time::timeout(Duration::from_secs(5), waiter)
            .await
            .expect("wait_for_notice never woke")
            .unwrap();
        assert_eq!(notices.len(), 1);
        assert!(notices[0].text.contains("a hit at last"));
    }

    #[tokio::test]
    async fn a_subscriber_gets_updates_instead_of_the_queue() {
        let dir = unique_root();
        std::fs::write(dir.join("s.log"), "hit\n").unwrap();
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let set = Arc::new(MonitorSet::subscribed(Arc::new(move |u| {
            let _ = tx.send(u);
        })));
        set.start(spec("hit", "grep hit s.log", 30), ctx_for(&dir))
            .unwrap();
        let update = tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("no subscriber update")
            .unwrap();
        assert!(update.matched);
        assert!(set.take_notices().is_empty(), "queue must stay empty");
    }
}
