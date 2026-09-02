//! The `monitor` tool: watch a file a long-running job streams into and
//! evaluate custom condition scripts against it, reporting each match to the
//! agent as an out-of-band notice.
//!
//! A condition is an arbitrary shell script run from the project root under the
//! same confinement `bash` gets (`handlers::confined_shell`). Exit 0 means the
//! condition matched, and its stdout is the matched content. Conditions are
//! evaluated once at start and again whenever the watched file changes; a met
//! condition is never re-evaluated. The monitor stops itself when every
//! condition has matched, when it is stopped explicitly, or at its deadline --
//! the bound that makes it safe for a run to park on an active monitor.
//!
//! Delivery is the caller's: a [`MonitorSet`] either queues [`MonitorUpdate`]s
//! for the agent loop to drain into `<SYSTEM>` reminders (the CLI/desktop run
//! path), or hands each one to a subscriber callback (the Tauri command layer,
//! which forwards them to Cowork over an IPC channel).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::tools::{sandbox, ToolContext};

pub const MONITOR_TOOL_NAME: &str = "monitor";

/// Active monitors per set. A run fanning out more watchers than this is
/// polling, not monitoring, and each one holds a background task.
pub const MAX_MONITORS: usize = 8;
/// Conditions per monitor.
pub const MAX_CONDITIONS: usize = 16;
pub const DEFAULT_TIMEOUT_SECS: u64 = 1800;
pub const MAX_TIMEOUT_SECS: u64 = 7200;
const MIN_TIMEOUT_SECS: u64 = 10;
/// How often the watched file is re-checked for changes.
const POLL_INTERVAL: Duration = Duration::from_secs(2);
/// A condition script that runs longer than this is killed and treated as
/// unmet; a matcher is a check, not a job of its own.
const EVAL_TIMEOUT: Duration = Duration::from_secs(60);
/// Cap on the matched content a notice carries into the conversation.
const MATCH_MAX_BYTES: usize = 4096;

#[derive(Debug, Clone, PartialEq)]
pub struct MonitorCondition {
    pub name: String,
    pub script: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MonitorSpec {
    /// The watched path as the model wrote it; resolved against the project
    /// root and scratch at start.
    pub file: String,
    pub conditions: Vec<MonitorCondition>,
    pub timeout_secs: u64,
    /// Poll cadence. Not model-settable; tests shorten it.
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
            .with_read_roots(&self.read_roots);
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
/// `done` marks the update that also ends the monitor (all met, or timeout).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorUpdate {
    pub monitor_id: String,
    pub headline: String,
    pub text: String,
    pub done: bool,
}

/// Parse and validate a `monitor {op:"start"}` call.
pub fn parse_start_args(args: &serde_json::Value) -> Result<MonitorSpec, String> {
    let file = args
        .get("file")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or("start requires 'file': the path the job streams its output to")?
        .to_string();
    let raw = args
        .get("conditions")
        .and_then(|v| v.as_array())
        .filter(|a| !a.is_empty())
        .ok_or("start requires a non-empty 'conditions' array of {name, script}")?;
    if raw.len() > MAX_CONDITIONS {
        return Err(format!("at most {MAX_CONDITIONS} conditions per monitor"));
    }
    let mut conditions = Vec::with_capacity(raw.len());
    for c in raw {
        let name = c
            .get("name")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or("every condition needs a non-empty 'name'")?;
        let script = c
            .get("script")
            .and_then(|v| v.as_str())
            .filter(|s| !s.trim().is_empty())
            .ok_or("every condition needs a non-empty 'script'")?;
        if conditions
            .iter()
            .any(|existing: &MonitorCondition| existing.name == name)
        {
            return Err(format!("duplicate condition name '{name}'"));
        }
        conditions.push(MonitorCondition {
            name: name.to_string(),
            script: script.to_string(),
        });
    }
    let timeout_secs = args
        .get("timeout")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_TIMEOUT_SECS)
        .clamp(MIN_TIMEOUT_SECS, MAX_TIMEOUT_SECS);
    Ok(MonitorSpec {
        file,
        conditions,
        timeout_secs,
        interval: POLL_INTERVAL,
    })
}

pub fn parse_stop_args(args: &serde_json::Value) -> Result<String, String> {
    args.get("monitor_id")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "stop requires 'monitor_id'".to_string())
}

/// Shared, mutable view of one monitor's progress, read by `list` and written
/// by the monitor's own task.
struct MonitorStatus {
    file: String,
    met: Vec<String>,
    unmet: Vec<String>,
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
        !self.notices.lock().unwrap().is_empty() || self.active.load(Ordering::SeqCst) > 0
    }

    /// Park until an update is queued, or nothing is left to wait for. The
    /// waiter registers before the state re-read, so a monitor finishing in
    /// between wakes this call rather than being missed.
    pub async fn wait_for_notice(&self) {
        loop {
            let waiter = self.wake.notified();
            tokio::pin!(waiter);
            waiter.as_mut().enable();
            if !self.notices.lock().unwrap().is_empty()
                || self.active.load(Ordering::SeqCst) == 0
            {
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

    /// Start a monitor, returning the model-facing result string. The watched
    /// path must sit where a read may reach (project, scratch, or an attached
    /// read-only root); the file itself may not exist yet.
    pub fn start(self: &Arc<Self>, spec: MonitorSpec, ctx: MonitorCtx) -> Result<String, String> {
        if self.inner.lock().unwrap().len() >= MAX_MONITORS {
            return Err(format!(
                "at most {MAX_MONITORS} monitors may be active; stop one first"
            ));
        }
        let scratch = ctx.scratch_root.as_deref();
        match sandbox::escapes_read_roots(&ctx.project_root, scratch, &ctx.read_roots, &spec.file)
        {
            Ok(false) => {}
            Ok(true) => {
                return Err(format!(
                    "'{}' is outside the project; a monitor can only watch files the run can read",
                    spec.file
                ))
            }
            Err(e) => return Err(format!("cannot resolve '{}': {e}", spec.file)),
        }
        let watch_path = sandbox::resolve_path(&ctx.project_root, scratch, &spec.file);
        let monitor_id = format!("mon-{}", self.seq.fetch_add(1, Ordering::Relaxed));

        let status = Arc::new(Mutex::new(MonitorStatus {
            file: spec.file.clone(),
            met: Vec::new(),
            unmet: spec.conditions.iter().map(|c| c.name.clone()).collect(),
        }));
        let condition_count = spec.conditions.len();
        let timeout_secs = spec.timeout_secs;
        let file = spec.file.clone();

        self.active.fetch_add(1, Ordering::SeqCst);
        let set = self.clone();
        let id_task = monitor_id.clone();
        let status_task = status.clone();
        let handle = tokio::spawn(async move {
            run_monitor(&set, &id_task, spec, ctx, watch_path, status_task).await;
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
        let plural = if condition_count == 1 { "" } else { "s" };
        Ok(format!(
            "Monitor started (monitor_id={monitor_id}) watching {file} with {condition_count} \
             condition{plural}. Conditions are checked now and whenever the file changes; each \
             match arrives as a <SYSTEM> note carrying the matched content. The monitor stops \
             when every condition has matched, when you stop it, or after {timeout_secs}s. Keep \
             working meanwhile."
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
            "Monitor {monitor_id} stopped. Conditions met: {}; unmet: {}.",
            name_list(&status.met),
            name_list(&status.unmet)
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
                "{id}: watching {} (met: {}; unmet: {})\n",
                status.file,
                name_list(&status.met),
                name_list(&status.unmet)
            ));
        }
        out.trim_end().to_string()
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

fn name_list(names: &[String]) -> String {
    if names.is_empty() {
        "none".to_string()
    } else {
        names.join(", ")
    }
}

/// The change signature polling keys off. Length plus mtime rather than either
/// alone: an append changes the length, an in-place rewrite the mtime.
fn file_signature(meta: &std::fs::Metadata) -> (u64, Option<std::time::SystemTime>) {
    (meta.len(), meta.modified().ok())
}

async fn run_monitor(
    set: &Arc<MonitorSet>,
    monitor_id: &str,
    spec: MonitorSpec,
    ctx: MonitorCtx,
    watch_path: PathBuf,
    status: Arc<Mutex<MonitorStatus>>,
) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(spec.timeout_secs);
    let mut unmet = spec.conditions;
    // `None` until the file exists; the first sighting triggers an evaluation,
    // as does a start over a file that already has content.
    let mut last_sig: Option<(u64, Option<std::time::SystemTime>)> = None;
    let mut first_pass = true;
    loop {
        let sig = tokio::fs::metadata(&watch_path)
            .await
            .ok()
            .map(|m| file_signature(&m));
        // The very first pass evaluates even with no file yet: a condition
        // script need not read the watched file at all.
        let changed = (sig.is_some() && sig != last_sig) || first_pass;
        first_pass = false;
        if changed {
            last_sig = sig;
            let mut still_unmet = Vec::with_capacity(unmet.len());
            let mut met_now: Vec<(String, String)> = Vec::new();
            for cond in unmet {
                match eval_condition(&ctx, &cond.script).await {
                    Some(content) => met_now.push((cond.name, content)),
                    None => still_unmet.push(cond),
                }
            }
            unmet = still_unmet;
            let total = met_now.len();
            for (i, (name, content)) in met_now.into_iter().enumerate() {
                {
                    let mut s = status.lock().unwrap();
                    s.unmet.retain(|n| n != &name);
                    s.met.push(name.clone());
                }
                let last = unmet.is_empty() && i + 1 == total;
                set.push_update(match_update(monitor_id, &spec.file, &name, &content, last));
            }
            if unmet.is_empty() {
                return;
            }
        }
        let now = tokio::time::Instant::now();
        if now >= deadline {
            let names: Vec<String> = unmet.iter().map(|c| c.name.clone()).collect();
            set.push_update(MonitorUpdate {
                monitor_id: monitor_id.to_string(),
                headline: format!("Monitor {monitor_id}: timed out"),
                text: format!(
                    "Monitor '{monitor_id}' timed out after {}s watching {}. Unmet conditions: \
                     {}. It has stopped.",
                    spec.timeout_secs,
                    spec.file,
                    name_list(&names)
                ),
                done: true,
            });
            return;
        }
        tokio::time::sleep(spec.interval.min(deadline - now)).await;
    }
}

fn match_update(
    monitor_id: &str,
    file: &str,
    name: &str,
    content: &str,
    last: bool,
) -> MonitorUpdate {
    let body = if content.is_empty() {
        "(the condition script matched with no output)".to_string()
    } else {
        format!(":\n{content}")
    };
    let mut text = format!("Monitor '{monitor_id}' condition '{name}' matched on {file}{body}");
    let headline = if last {
        text.push_str("\n\nAll conditions for this monitor have now matched; it has stopped.");
        format!("Monitor {monitor_id}: condition '{name}' matched; all conditions met")
    } else {
        format!("Monitor {monitor_id}: condition '{name}' matched")
    };
    MonitorUpdate {
        monitor_id: monitor_id.to_string(),
        headline,
        text,
        done: last,
    }
}

/// Run one condition script under the same confinement `bash` gets.
/// `Some(content)` when it exits 0 (its stdout, bounded); `None` for a nonzero
/// exit, a spawn failure, or a script that outran [`EVAL_TIMEOUT`] -- all of
/// which read as "not matched yet" and are retried on the next change.
async fn eval_condition(ctx: &MonitorCtx, script: &str) -> Option<String> {
    let tool_ctx = ctx.as_tool_context();
    let (shell, sandbox_tmp, _policy) =
        crate::tools::handlers::confined_shell(&tool_ctx).ok()?;
    let mut child = crate::tools::proc::spawn(
        &shell,
        script,
        &ctx.project_root,
        sandbox_tmp.as_deref(),
    )
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
            "description": "Watch a file a long-running job streams output into (e.g. a backgrounded bash job redirecting to a log) and evaluate condition scripts against it. Each condition is a shell script run from the project root whenever the file changes; exit 0 means the condition matched and its stdout is the matched content. You get a <SYSTEM> note per match, so start the monitor and keep working. The monitor stops when every condition has matched, on stop, or at its timeout. A met condition is never re-checked.",
            "parameters": {
                "type": "object",
                "properties": {
                    "op": { "type": "string", "enum": ["start", "stop", "list"] },
                    "file": { "type": "string", "description": "For start: the file to watch, relative to the project root (or under /tmp). It may not exist yet." },
                    "conditions": {
                        "type": "array",
                        "description": "For start: the conditions to watch for. Scripts should be cheap checks (e.g. grep -m1 'BUILD FAILED' build.log), not jobs.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": { "type": "string", "description": "Short unique label, quoted back to you when it matches." },
                                "script": { "type": "string", "description": "Shell script; exit 0 = matched, stdout = the matched content." }
                            },
                            "required": ["name", "script"]
                        }
                    },
                    "timeout": { "type": "integer", "description": "For start: seconds before the monitor gives up and reports its unmet conditions (default 1800, max 7200)." },
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
            allow_network: false,
            home_readonly: false,
            // Bare shell: these tests exercise the monitor loop, not the jail.
            sandbox: false,
        }
    }

    fn spec(file: &str, conditions: &[(&str, &str)], timeout_secs: u64) -> MonitorSpec {
        MonitorSpec {
            file: file.to_string(),
            conditions: conditions
                .iter()
                .map(|(name, script)| MonitorCondition {
                    name: name.to_string(),
                    script: script.to_string(),
                })
                .collect(),
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
    fn parse_rejects_a_call_with_no_conditions() {
        assert!(parse_start_args(&serde_json::json!({"op": "start", "file": "a.log"})).is_err());
        assert!(parse_start_args(
            &serde_json::json!({"op": "start", "file": "a.log", "conditions": []})
        )
        .is_err());
        assert!(parse_start_args(&serde_json::json!({
            "op": "start", "conditions": [{"name": "x", "script": "true"}]
        }))
        .is_err());
        assert!(parse_start_args(&serde_json::json!({
            "op": "start", "file": "a.log",
            "conditions": [{"name": "x", "script": "true"}, {"name": "x", "script": "false"}]
        }))
        .is_err());
    }

    #[test]
    fn parse_clamps_the_timeout_and_defaults_it() {
        let base = serde_json::json!({
            "op": "start", "file": "a.log",
            "conditions": [{"name": "x", "script": "true"}]
        });
        assert_eq!(
            parse_start_args(&base).unwrap().timeout_secs,
            DEFAULT_TIMEOUT_SECS
        );
        let mut low = base.clone();
        low["timeout"] = serde_json::json!(1);
        assert_eq!(parse_start_args(&low).unwrap().timeout_secs, MIN_TIMEOUT_SECS);
        let mut high = base;
        high["timeout"] = serde_json::json!(1_000_000);
        assert_eq!(
            parse_start_args(&high).unwrap().timeout_secs,
            MAX_TIMEOUT_SECS
        );
    }

    #[tokio::test]
    async fn a_condition_matching_at_start_reports_its_content_and_stops() {
        let dir = unique_root();
        std::fs::write(dir.join("build.log"), "warm up\nBUILD OK line\n").unwrap();
        let set = Arc::new(MonitorSet::new());
        let result = set
            .start(
                spec("build.log", &[("ok", "grep 'BUILD OK' build.log")], 30),
                ctx_for(&dir),
            )
            .unwrap();
        assert!(result.contains("monitor_id=mon-1"), "{result}");
        let update = next_notice(&set).await;
        assert!(update.done, "single condition: the match ends the monitor");
        assert!(update.text.contains("BUILD OK line"), "{}", update.text);
        assert!(update.text.contains("all conditions") || update.text.contains("All conditions"));
        for _ in 0..100 {
            if !set.has_pending_work() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("the set still reports pending work after the final match");
    }

    #[tokio::test]
    async fn a_later_append_meets_the_second_condition() {
        let dir = unique_root();
        let log = dir.join("job.log");
        std::fs::write(&log, "phase one done\n").unwrap();
        let set = Arc::new(MonitorSet::new());
        set.start(
            spec(
                "job.log",
                &[
                    ("one", "grep 'phase one' job.log"),
                    ("two", "grep 'phase two' job.log"),
                ],
                30,
            ),
            ctx_for(&dir),
        )
        .unwrap();
        let first = next_notice(&set).await;
        assert!(first.text.contains("'one'"), "{}", first.text);
        assert!(!first.done);
        assert!(set.has_pending_work(), "condition 'two' is still owed");
        assert!(set.list().contains("met: one; unmet: two"), "{}", set.list());

        let mut content = std::fs::read_to_string(&log).unwrap();
        content.push_str("phase two done\n");
        std::fs::write(&log, content).unwrap();
        let second = next_notice(&set).await;
        assert!(second.text.contains("'two'"), "{}", second.text);
        assert!(second.text.contains("phase two done"));
        assert!(second.done);
    }

    #[tokio::test]
    async fn an_unmet_monitor_times_out_and_names_its_conditions() {
        let dir = unique_root();
        let set = Arc::new(MonitorSet::new());
        // Timeout of zero: the deadline has passed by the first re-check, so
        // the test never waits out a real timeout.
        set.start(
            spec("never.log", &[("ghost", "grep ghost never.log")], 0),
            ctx_for(&dir),
        )
        .unwrap();
        let update = next_notice(&set).await;
        assert!(update.done);
        assert!(update.text.contains("timed out"), "{}", update.text);
        assert!(update.text.contains("ghost"), "{}", update.text);
    }

    #[tokio::test]
    async fn stop_reports_progress_and_frees_the_slot() {
        let dir = unique_root();
        let set = Arc::new(MonitorSet::new());
        let result = set
            .start(
                spec("never.log", &[("ghost", "false")], 3600),
                ctx_for(&dir),
            )
            .unwrap();
        assert!(result.contains("mon-1"));
        assert!(set.has_pending_work());
        let stopped = set.stop("mon-1");
        assert!(stopped.contains("unmet: ghost"), "{stopped}");
        assert!(!set.has_pending_work());
        assert!(set.stop("mon-1").starts_with("ERROR"));
        assert_eq!(set.list(), "No active monitors.");
    }

    #[tokio::test]
    async fn a_watched_path_outside_the_project_is_refused() {
        let dir = unique_root();
        let set = Arc::new(MonitorSet::new());
        let err = set
            .start(
                spec("/etc/passwd", &[("x", "true")], 30),
                ctx_for(&dir),
            )
            .unwrap_err();
        assert!(err.contains("outside the project"), "{err}");
        assert!(!set.has_pending_work());
    }

    #[tokio::test]
    async fn the_monitor_cap_is_enforced() {
        let dir = unique_root();
        let set = Arc::new(MonitorSet::new());
        for _ in 0..MAX_MONITORS {
            set.start(spec("a.log", &[("x", "false")], 3600), ctx_for(&dir))
                .unwrap();
        }
        let err = set
            .start(spec("a.log", &[("x", "false")], 3600), ctx_for(&dir))
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
        set.start(
            spec("late.log", &[("hit", "grep hit late.log")], 30),
            ctx_for(&dir),
        )
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
        set.start(
            spec("s.log", &[("hit", "grep hit s.log")], 30),
            ctx_for(&dir),
        )
        .unwrap();
        let update = tokio::time::timeout(Duration::from_secs(5), rx.recv())
            .await
            .expect("no subscriber update")
            .unwrap();
        assert!(update.done);
        assert!(set.take_notices().is_empty(), "queue must stay empty");
    }
}
