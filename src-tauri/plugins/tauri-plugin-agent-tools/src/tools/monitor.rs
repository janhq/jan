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

use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
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
    pub pkg_cache: Option<crate::workspace::PkgCache>,
    pub mask_root: Option<PathBuf>,
    pub hidden_root: Option<PathBuf>,
    pub read_roots: Vec<PathBuf>,
    pub write_roots: Vec<PathBuf>,
    pub allow_network: bool,
    pub home_readonly: bool,
    pub sandbox: bool,
    pub workspace_readonly: bool,
    /// Process-registry owner for this monitor's poll children. `None` keeps
    /// the historical ownerless bucket (Cowork sessions, tests), which only
    /// `kill_all` reaps; a thread-owned monitor sets it so a revocation can
    /// reap exactly its own pids via `proc::kill_thread`.
    pub owner: Option<String>,
    /// The user's hooks, re-resolved per poll alongside consent. Only the
    /// thread-owned path populates this: a poll then fires `PreToolUse` for
    /// its script before spawning, and a deny is terminal. `None` -- the
    /// Session path and `from_tool_context` -- fires nothing, unchanged.
    pub hooks: Option<crate::tools::hooks::HookSet>,
}

/// Re-resolved immediately before *every* poll of a thread-owned monitor, in
/// place of a frozen start-time snapshot: fresh stored consent intersected
/// with the current process confirmation, canonical roots rebuilt and the jail
/// re-verified, plus the generation token that the spawn is admitted against.
/// `Err` is terminal -- the monitor reports a revoked/err notice and stops,
/// rather than retrying a policy failure forever as "not yet".
pub type AuthorityFuture =
    Pin<Box<dyn Future<Output = Result<(MonitorCtx, u64), String>> + Send>>;
pub type AuthorityResolver = Arc<dyn Fn() -> AuthorityFuture + Send + Sync>;

/// What makes a monitor thread-owned: whose consent it runs under, which
/// process-registry bucket its children belong to, and how to re-authorize.
#[derive(Clone)]
pub struct ThreadAuthority {
    pub thread_id: String,
    pub owner: String,
    pub resolve: AuthorityResolver,
}

impl MonitorCtx {
    pub fn from_tool_context(ctx: &ToolContext<'_>) -> Self {
        Self {
            owner: None,
            hooks: None,
            project_root: ctx.project_root.to_path_buf(),
            scratch_root: ctx.scratch_root.map(Path::to_path_buf),
            pkg_cache: ctx.pkg_cache.cloned(),
            mask_root: ctx.mask_root.map(Path::to_path_buf),
            hidden_root: ctx.hidden_root.map(Path::to_path_buf),
            read_roots: ctx.read_roots.to_vec(),
            write_roots: ctx.write_roots.to_vec(),
            allow_network: ctx.allow_network,
            home_readonly: ctx.home_readonly,
            sandbox: ctx.sandbox,
            workspace_readonly: ctx.workspace_readonly,
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
            .with_write_roots(&self.write_roots)
            .with_hidden_root(self.hidden_root.as_deref())
            .with_workspace_readonly(self.workspace_readonly);
        if let Some(mask) = &self.mask_root {
            ctx = ctx.with_mask_root(mask);
        }
        if let Some(scratch) = &self.scratch_root {
            ctx = ctx.with_scratch_root(scratch);
        }
        ctx.with_pkg_cache(self.pkg_cache.as_ref())
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
#[derive(
    Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize, schemars::JsonSchema,
)]
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
        self.start_owned(spec, ctx, None)
    }

    /// Start a monitor whose every poll is re-authorized against live thread
    /// consent instead of the frozen `ctx` (see [`ThreadAuthority`]). With
    /// `None` this is exactly [`MonitorSet::start`]: the Cowork session path
    /// is unchanged.
    pub fn start_owned(
        self: &Arc<Self>,
        spec: MonitorSpec,
        ctx: MonitorCtx,
        authority: Option<ThreadAuthority>,
    ) -> Result<String, String> {
        self.start_owned_with_id(spec, ctx, authority)
            .map(|(_, message)| message)
    }

    /// [`MonitorSet::start_owned`], also returning the new monitor's id so a
    /// caller can bind per-monitor state without parsing the result string.
    pub fn start_owned_with_id(
        self: &Arc<Self>,
        spec: MonitorSpec,
        ctx: MonitorCtx,
        authority: Option<ThreadAuthority>,
    ) -> Result<(String, String), String> {
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
            run_monitor(&set, &id_task, spec, ctx, status_task, authority).await;
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
        let message = format!(
            "Monitor started (monitor_id={monitor_id}): '{name}' runs every {interval_secs}s. \
             When it exits 0 you get a <SYSTEM> note with its output and the monitor stops; it \
             also stops if you stop it or after {timeout_secs}s without a match. Keep working \
             meanwhile."
        );
        Ok((monitor_id, message))
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

/// Where one monitor's updates go.
pub type UpdateSink = Arc<dyn Fn(MonitorUpdate) + Send + Sync>;

/// A [`MonitorSet`] whose updates are routed to the sink each monitor was
/// *started with*, by monitor id. One shared "latest subscriber" slot would
/// hand monitor M1's update to the sink of the later-started M2, whose owner
/// then treats M1's terminal update as M2's. Every update is terminal, so a
/// route is dropped as soon as it has fired (or its monitor is stopped).
pub struct RoutedMonitors {
    set: Arc<MonitorSet>,
    sinks: Arc<Mutex<std::collections::HashMap<String, UpdateSink>>>,
}

impl Default for RoutedMonitors {
    fn default() -> Self {
        Self::new()
    }
}

impl RoutedMonitors {
    pub fn new() -> Self {
        let sinks: Arc<Mutex<std::collections::HashMap<String, UpdateSink>>> =
            Arc::new(Mutex::new(std::collections::HashMap::new()));
        let routed = sinks.clone();
        let set = Arc::new(MonitorSet::subscribed(Arc::new(move |update| {
            // Blocks while `start` is still binding the id below, so an update
            // that fires immediately is never delivered to nobody.
            let sink = routed.lock().unwrap().remove(&update.monitor_id);
            if let Some(sink) = sink {
                sink(update);
            }
        })));
        Self { set, sinks }
    }

    pub fn set(&self) -> &Arc<MonitorSet> {
        &self.set
    }

    /// Start a monitor whose updates (and only its updates) go to `sink`.
    pub fn start(
        &self,
        spec: MonitorSpec,
        ctx: MonitorCtx,
        authority: Option<ThreadAuthority>,
        sink: UpdateSink,
    ) -> Result<String, String> {
        // Held across the start so the subscriber cannot look the id up before
        // it is bound.
        let mut sinks = self.sinks.lock().unwrap();
        let (id, message) = self.set.start_owned_with_id(spec, ctx, authority)?;
        sinks.insert(id, sink);
        Ok(message)
    }

    /// Stop one monitor and drop its route.
    pub fn stop(&self, monitor_id: &str) -> String {
        self.sinks.lock().unwrap().remove(monitor_id);
        self.set.stop(monitor_id)
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
    authority: Option<ThreadAuthority>,
) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(spec.timeout_secs);
    loop {
        status.lock().unwrap().polls += 1;
        // Re-authorize against live consent before every poll. The start-time
        // context authorizes nothing on its own for a thread-owned monitor.
        let (poll_ctx, barrier) = match &authority {
            None => (None, None),
            Some(auth) => match (auth.resolve)().await {
                Ok((fresh, generation)) => (Some(fresh), Some((auth, generation))),
                Err(reason) => {
                    set.push_update(revoked_update(monitor_id, &spec.name, &reason));
                    return;
                }
            },
        };
        let effective = poll_ctx.as_ref().unwrap_or(&ctx);
        match eval_script(effective, &spec.script, barrier).await {
            PollVerdict::Matched(content) => {
                set.push_update(match_update(monitor_id, &spec.name, &content));
                return;
            }
            // A policy deny is terminal, like a revocation: retrying it every
            // interval would re-ask the user's hook the same question forever.
            PollVerdict::Denied(reason) => {
                set.push_update(hook_denied_update(monitor_id, &spec.name, &reason));
                return;
            }
            PollVerdict::NotYet => {}
        }
        let now = tokio::time::Instant::now();
        if now >= deadline {
            let polls = status.lock().unwrap().polls;
            set.push_update(MonitorUpdate {
                monitor_id: monitor_id.to_string(),
                name: spec.name.clone(),
                headline: headline(monitor_id, &spec.name, false),
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

/// Last word of a matched monitor's headline; a display classifies the
/// headline by it, so it is shared rather than repeated as a literal.
pub const MATCHED_OUTCOME: &str = "matched";

/// Last words of a timed-out monitor's headline (see [`MATCHED_OUTCOME`]).
pub const TIMED_OUT_OUTCOME: &str = "timed out";

/// Last words of a monitor stopped because its thread's consent no longer
/// authorizes it. A policy failure is terminal: without this a revoked monitor
/// would read as "not yet" and retry forever (see [`eval_script`]).
pub const REVOKED_OUTCOME: &str = "stopped: permission revoked";

/// Last words of a monitor stopped because the user's own `PreToolUse` hook
/// denied its poll script (see [`REVOKED_OUTCOME`]; equally terminal).
pub const HOOK_DENIED_OUTCOME: &str = "stopped: denied by a PreToolUse hook";

/// Terminal notice for a monitor that lost authorization mid-run. `matched` is
/// false, so any display that already treats a non-match update as terminal
/// closes it correctly.
fn revoked_update(monitor_id: &str, name: &str, reason: &str) -> MonitorUpdate {
    MonitorUpdate {
        monitor_id: monitor_id.to_string(),
        name: name.to_string(),
        headline: format!("Monitor {monitor_id}: '{name}' {REVOKED_OUTCOME}"),
        text: format!(
            "Monitor '{monitor_id}' ('{name}') stopped because this conversation's \
             permissions no longer allow it: {reason}. Re-grant folder access and \
             start it again if you still want it."
        ),
        matched: false,
    }
}

/// Terminal notice for a poll script a `PreToolUse` hook denied. `matched` is
/// false, so displays close it like any other terminal update.
fn hook_denied_update(monitor_id: &str, name: &str, reason: &str) -> MonitorUpdate {
    MonitorUpdate {
        monitor_id: monitor_id.to_string(),
        name: name.to_string(),
        headline: format!("Monitor {monitor_id}: '{name}' {HOOK_DENIED_OUTCOME}"),
        text: format!(
            "Monitor '{monitor_id}' ('{name}') stopped because a PreToolUse hook denied its \
             poll script: {reason}. Adjust or remove the hook and start it again if you still \
             want it."
        ),
        matched: false,
    }
}

/// `Monitor mon-1: 'build' matched` (or `timed out`): the one producer of a
/// monitor headline, so the display that styles it by outcome cannot drift.
pub fn headline(monitor_id: &str, name: &str, matched: bool) -> String {
    let outcome = if matched {
        MATCHED_OUTCOME
    } else {
        TIMED_OUT_OUTCOME
    };
    format!("Monitor {monitor_id}: '{name}' {outcome}")
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
        headline: headline(monitor_id, name, true),
        text: format!("Monitor '{monitor_id}' ('{name}') matched{body}\n\nIt has stopped."),
        matched: true,
    }
}

/// Reaps and deregisters a poll child if its task is aborted mid-poll. The
/// normal path calls [`PollChild::disarm`] once the child has exited.
///
/// Shared lifecycle improvement, deliberately NOT thread-only: a Session
/// (Cowork) monitor aborted mid-poll previously leaked its registered pid and
/// the child ran to natural exit; with this guard both paths reap on abort.
struct PollChild<'a> {
    owner: Option<&'a str>,
    pid: Option<u32>,
}

impl PollChild<'_> {
    fn disarm(&mut self) {
        self.pid = None;
    }
}

impl Drop for PollChild<'_> {
    fn drop(&mut self) {
        if let Some(pid) = self.pid {
            crate::tools::proc::unregister(self.owner, pid);
            crate::tools::proc::kill_tree(pid);
        }
    }
}

/// One poll's answer. Only `Denied` is a policy stop; everything that merely
/// did not match yet stays retryable.
enum PollVerdict {
    /// The script exited 0; its bounded stdout is the matched content.
    Matched(String),
    /// Nonzero exit, a spawn failure, a skipped admission, or a script that
    /// outran [`EVAL_TIMEOUT`] -- all retried on the next poll.
    NotYet,
    /// A `PreToolUse` hook denied the script before it spawned. Terminal.
    Denied(String),
}

fn poll_network_allowed(ceiling: bool, global: bool) -> bool {
    ceiling && global
}

/// Run the script once under the same confinement `bash` gets.
async fn eval_script(
    ctx: &MonitorCtx,
    script: &str,
    barrier: Option<(&ThreadAuthority, u64)>,
) -> PollVerdict {
    // Re-read on EVERY poll, including legacy Session monitors whose context
    // otherwise stays fixed. A requested/start-time false is a permanent ceiling.
    // Sampled here, but only a sample: it is re-checked under the admission
    // guard at every spawn below (the poll's hooks may run for a long time).
    let network = poll_network_allowed(
        ctx.allow_network,
        crate::thread_capabilities::get_global_grants().shell_network,
    );
    let tool_ctx = ctx.as_tool_context().with_network(network);
    // Thread-only PreToolUse gate, fired for the poll script exactly as the
    // `shell` tool would fire it, BEFORE any spawn. Only the thread-owned
    // resolver populates `ctx.hooks` (re-resolved each poll); the Session
    // path carries `None` and fires nothing. Run before the admission guard,
    // so a slow hook never holds the global mutex; a revocation landing after
    // an allow is still caught by the generation re-check below.
    //
    // Only a hook that RAN and answered `{"decision":"deny"}` denies. A hook
    // that crashes, times out or prints malformed JSON is 'misbehaved,
    // proceed' -- deliberate parity with one-shot dispatch (`run_hooks`), and
    // hooks here are defense-in-depth over host consent, never its source.
    // On a poll that misbehavior repeats every interval with its notices
    // dropped (there is no turn to attach them to); accepted and documented.
    if let Some(hooks) = &ctx.hooks {
        let payload = crate::tools::hooks::HookPayload {
            tool_name: Some(crate::tools::SHELL_TOOL.to_string()),
            tool_input: Some(serde_json::json!({ "command": script })),
            ..Default::default()
        };
        // Hooks are spawned under the same admission as the poll itself: a
        // revocation either finds the hook registered under the monitor's
        // owner or stops it from starting (see `SpawnAdmission`).
        let admission = barrier.map(|(auth, generation)| crate::tools::hooks::SpawnAdmission {
            owner: auth.owner.clone(),
            thread_id: auth.thread_id.clone(),
            generation,
            network,
        });
        let outcome = crate::tools::hooks::run_hooks_admitted(
            hooks,
            crate::tools::hooks::HookEvent::PreToolUse,
            &payload,
            &tool_ctx,
            false,
            admission.as_ref(),
        )
        .await;
        if let Some(reason) = outcome.denied {
            return PollVerdict::Denied(reason);
        }
    }
    let Ok((shell, sandbox_env, _policy)) = crate::tools::handlers::confined_shell(&tool_ctx)
    else {
        return PollVerdict::NotYet;
    };
    // A poll child is short-lived and re-spawned each interval. Without an
    // owner it is not tied to any Stop and lands in the process-wide bucket;
    // a thread-owned monitor registers under its own key so a revocation reaps
    // exactly its pids.
    let owner = ctx.owner.as_deref();
    let mut child = {
        // Admission guard: re-check the generation and let `proc::spawn`
        // register the child under one lock, so a revocation can never sweep
        // in the window between the check and the registration. Released
        // before the shell actually runs -- never held across a poll.
        let _admitted = match barrier {
            Some((auth, token)) => {
                let guard = crate::thread_capabilities::admission().lock().await;
                if !crate::thread_capabilities::spawn_authorized(&auth.thread_id, token, network) {
                    // Consent moved under us (this thread's barrier, or the
                    // app-wide network switch). Skip this poll; the next one
                    // re-resolves and reports a revocation terminally.
                    return PollVerdict::NotYet;
                }
                Some(guard)
            }
            None => None,
        };
        match crate::tools::proc::spawn(
            &shell,
            script,
            &ctx.project_root,
            sandbox_env.as_ref(),
            tool_ctx.shell_env(),
            owner,
        )
        .await
        {
            Ok(child) => child,
            Err(_) => return PollVerdict::NotYet,
        }
    };
    let pid = child.id();
    // A monitor task can be aborted mid-poll (stop, revoke, delete, set drop).
    // An abort drops this future without running the cleanup below, which
    // would leave the pid in the registry forever -- and a later reap would
    // then `killpg` a pid the OS may have recycled. The guard reaps and
    // unregisters on an abort, and is disarmed on the normal path.
    let mut registered = PollChild { owner, pid };
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
    registered.disarm();
    if let Some(pid) = pid {
        crate::tools::proc::unregister(owner, pid);
        // The leader is done, but whatever it left running in its process group
        // (`(sleep 30; touch marker) &`) is not: once unregistered, a later
        // revocation could no longer find it. Reap the group on every
        // completed-poll path, a match included. Windows cannot enumerate the
        // descendants of an exited parent, so only the timeout arm below
        // (leader still alive) reaps there.
        #[cfg(unix)]
        crate::tools::proc::kill_tree(pid);
    }
    match result {
        Ok((Ok(exit), head)) if exit.success() => {
            PollVerdict::Matched(String::from_utf8_lossy(&head).trim().to_string())
        }
        Ok(_) => PollVerdict::NotYet,
        Err(_) => {
            // Timed out: reap the whole tree, or a wedged matcher leaks.
            if let Some(pid) = pid {
                crate::tools::proc::kill_tree(pid);
            }
            PollVerdict::NotYet
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
            "description": "Wait in the background for a condition and be told when it happens. start polls a shell script from the project root every interval; the first poll that exits 0 ends the monitor and hands you its stdout as a <SYSTEM> note while you keep working (a nonzero exit means not yet), e.g. \"grep -m1 'BUILD FAILED' build.log\" or \"test -f done.flag\". A monitor also ends on its timeout. stop ends one early by its id once you no longer need it, and list shows active monitors and their ids. Start one monitor per thing you are waiting for.",
            "parameters": {
                "type": "object",
                "properties": {
                    "op": { "type": "string", "enum": ["start", "stop", "list"] },
                    "script": { "type": "string", "description": "For start: a cheap shell check that exits 0 once the thing has happened; its stdout is what you get back." },
                    "name": { "type": "string", "description": "For start: optional short label quoted back to you when it matches (defaults to the script)." },
                    "interval": { "type": "integer", "description": "For start: seconds between polls (default 5, min 1, max 300)." },
                    "timeout": { "type": "integer", "description": "For start: seconds before the monitor gives up (default 1800, max 7200)." },
                    "monitor_id": { "type": "string", "description": "The monitor's id, from start's result (or list); required for stop." }
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

    #[test]
    fn monitor_network_keeps_ceiling_and_observes_global_off_on_later_polls() {
        assert!(poll_network_allowed(true, true));
        assert!(!poll_network_allowed(true, false));
        assert!(!poll_network_allowed(false, true));
        assert!(!poll_network_allowed(false, false));
    }

    fn ctx_for(root: &Path) -> MonitorCtx {
        MonitorCtx {
            owner: None,
            hooks: None,
            project_root: root.to_path_buf(),
            scratch_root: None,
            pkg_cache: None,
            mask_root: None,
            hidden_root: None,
            read_roots: Vec::new(),
            write_roots: Vec::new(),
            allow_network: false,
            home_readonly: false,
            // Bare shell: these tests exercise the monitor loop, not the jail.
            sandbox: false,
            workspace_readonly: false,
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

    /// A thread-owned context plus an authority whose verdict the test drives.
    /// `verdict` returning `Err` models consent having been revoked.
    fn thread_authority_for(
        id: &'static str,
        root: &Path,
        verdict: Arc<dyn Fn() -> Result<u64, String> + Send + Sync>,
    ) -> (MonitorCtx, ThreadAuthority) {
        thread_authority_with(ctx_for(root), id, verdict)
    }

    /// [`thread_authority_for`] over a caller-built context (e.g. one carrying
    /// a hook set), so the per-poll resolved clone includes it.
    fn thread_authority_with(
        mut ctx: MonitorCtx,
        id: &'static str,
        verdict: Arc<dyn Fn() -> Result<u64, String> + Send + Sync>,
    ) -> (MonitorCtx, ThreadAuthority) {
        let owner = format!("thread-monitor:{id}");
        ctx.owner = Some(owner.clone());
        let resolved = ctx.clone();
        let authority = ThreadAuthority {
            thread_id: id.to_string(),
            owner,
            resolve: Arc::new(move || {
                let ctx = resolved.clone();
                let verdict = verdict.clone();
                Box::pin(async move { verdict().map(|generation| (ctx, generation)) })
            }),
        };
        (ctx, authority)
    }

    /// A policy failure is terminal. Without this the monitor would read a
    /// revocation as "not yet" and retry it forever.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_revoked_thread_monitor_stops_with_a_terminal_notice() {
        let dir = unique_root();
        let id = "tm-revoke-notice";
        let allowed = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let gate = allowed.clone();
        let (ctx, authority) = thread_authority_for(
            id,
            &dir,
            Arc::new(move || {
                if gate.load(Ordering::SeqCst) {
                    Ok(crate::thread_capabilities::generation(id))
                } else {
                    Err("folder access for this conversation is no longer granted".into())
                }
            }),
        );
        let set = Arc::new(MonitorSet::new());
        // Never matches, so only a revocation can end it inside the timeout.
        set.start_owned(spec("watch", "exit 1", 30), ctx, Some(authority))
            .unwrap();
        tokio::time::sleep(Duration::from_millis(60)).await;
        allowed.store(false, Ordering::SeqCst);
        let update = next_notice(&set).await;
        assert!(!update.matched, "a revocation is not a match");
        assert!(
            update.headline.ends_with(REVOKED_OUTCOME),
            "{}",
            update.headline
        );
        assert!(update.text.contains("no longer allow it"), "{}", update.text);
        assert!(set.snapshot().is_empty(), "the monitor must have retired");
    }

    /// The start-time context authorizes nothing: every poll re-resolves.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_thread_monitor_re_authorizes_on_every_poll() {
        let dir = unique_root();
        let id = "tm-reauthorize";
        let polls = Arc::new(AtomicUsize::new(0));
        let counter = polls.clone();
        let (ctx, authority) = thread_authority_for(
            id,
            &dir,
            Arc::new(move || {
                counter.fetch_add(1, Ordering::SeqCst);
                Ok(crate::thread_capabilities::generation(id))
            }),
        );
        let set = Arc::new(MonitorSet::new());
        set.start_owned(spec("watch", "exit 1", 30), ctx, Some(authority))
            .unwrap();
        tokio::time::sleep(Duration::from_millis(200)).await;
        set.stop_all();
        assert!(
            polls.load(Ordering::SeqCst) > 1,
            "consent was resolved {} time(s); it must be re-read per poll",
            polls.load(Ordering::SeqCst)
        );
    }

    /// Revoke landing between resolve and spawn: the generation moves after
    /// the authority is resolved, so the admission guard must refuse the spawn
    /// rather than start a child under stale authority.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_revoke_between_resolve_and_spawn_prevents_the_spawn() {
        let dir = unique_root();
        let marker = dir.join("spawned");
        let id = "tm-resolve-spawn-race";
        let script = format!("touch {}", marker.display());
        let (ctx, authority) = thread_authority_for(
            id,
            &dir,
            Arc::new(move || {
                // Resolve, then let a revocation land before the spawn: the
                // token handed back is already stale by one generation.
                let stale = crate::thread_capabilities::generation(id);
                crate::thread_capabilities::narrow(id);
                Ok(stale)
            }),
        );
        let set = Arc::new(MonitorSet::new());
        set.start_owned(spec("watch", &script, 10), ctx, Some(authority))
            .unwrap();
        tokio::time::sleep(Duration::from_millis(250)).await;
        set.stop_all();
        assert!(
            !marker.exists(),
            "a child was spawned under an authority that had already changed"
        );

        // Positive control: the identical script and context, differing only
        // in that the handed-back generation stays current, must spawn. Without
        // this the assertion above could pass for an unrelated reason.
        let control = "tm-resolve-spawn-control";
        let (ctx, authority) = thread_authority_for(
            control,
            &dir,
            Arc::new(move || Ok(crate::thread_capabilities::generation(control))),
        );
        let set = Arc::new(MonitorSet::new());
        set.start_owned(spec("watch", &script, 10), ctx, Some(authority))
            .unwrap();
        let mut spawned = false;
        for _ in 0..200 {
            if marker.exists() {
                spawned = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        set.stop_all();
        assert!(
            spawned,
            "control failed to spawn, so the barrier assertion proves nothing"
        );
    }

    /// The PollChild drop guard is a SHARED lifecycle improvement: a Session
    /// monitor aborted mid-poll must reap its in-flight poll child rather
    /// than leak it to run to natural exit (the pre-guard behavior).
    #[cfg(unix)]
    #[tokio::test]
    async fn an_aborted_session_monitor_reaps_its_in_flight_poll_child() {
        let dir = unique_root();
        let pidfile = dir.join("poll-child.pid");
        // The sleeper is the shell's own child (same process group), so after
        // the kill it is reparented and fully reaped by the OS: liveness can
        // be probed without the zombie ambiguity a direct child would have.
        let script = format!("sleep 30 & echo $! > {}; wait", pidfile.display());
        let set = Arc::new(MonitorSet::new());
        // Session path: no authority, no owner, no hooks.
        set.start(spec("watch", &script, 60), ctx_for(&dir)).unwrap();
        let mut pid = None;
        for _ in 0..400 {
            if let Some(parsed) = std::fs::read_to_string(&pidfile)
                .ok()
                .and_then(|s| s.trim().parse::<i32>().ok())
            {
                pid = Some(parsed);
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let pid = nix::unistd::Pid::from_raw(pid.expect("the poll child never started"));
        // Abort mid-poll: the drop guard, not the normal exit path, must reap.
        set.stop_all();
        let mut dead = false;
        for _ in 0..500 {
            // Signal 0 probes liveness without delivering anything.
            if nix::sys::signal::kill(pid, None).is_err() {
                dead = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(dead, "the in-flight poll child survived the abort");
    }

    /// A user PreToolUse deny hook gates a thread-owned poll BEFORE its spawn,
    /// and terminally -- a policy deny must never read as "not yet" and retry
    /// forever. The Session path carries no hook set and is untouched.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_pre_tool_use_deny_hook_blocks_a_thread_poll_terminally() {
        fn hook_set(command: &str) -> crate::tools::hooks::HookSet {
            let mut hooks = crate::tools::hooks::HookSet::new();
            hooks.extend_from(
                vec![crate::tools::hooks::HookEntry {
                    event: "PreToolUse".into(),
                    matcher: Some(crate::tools::SHELL_TOOL.into()),
                    command: command.into(),
                    timeout_secs: None,
                }],
                Path::new("test-hooks"),
            );
            assert_eq!(hooks.len(), 1, "the test hook must have loaded");
            hooks
        }
        let dir = unique_root();
        let marker = dir.join("hook-gated-spawn");
        let script = format!("touch {}", marker.display());

        let id = "tm-hook-deny";
        let mut ctx = ctx_for(&dir);
        ctx.hooks = Some(hook_set(
            r#"echo '{"decision":"deny","reason":"blocked by test hook"}'"#,
        ));
        let (ctx, authority) = thread_authority_with(
            ctx,
            id,
            Arc::new(move || Ok(crate::thread_capabilities::generation(id))),
        );
        let set = Arc::new(MonitorSet::new());
        set.start_owned(spec("watch", &script, 30), ctx, Some(authority))
            .unwrap();
        let update = next_notice(&set).await;
        assert!(!update.matched, "a hook deny is not a match");
        assert!(
            update.headline.ends_with(HOOK_DENIED_OUTCOME),
            "{}",
            update.headline
        );
        assert!(
            update.text.contains("blocked by test hook"),
            "{}",
            update.text
        );
        assert!(
            !marker.exists(),
            "the poll script ran although a PreToolUse hook denied it"
        );
        assert!(set.snapshot().is_empty(), "a deny is terminal, not retried");

        // Positive control: identical wiring, but the hook allows (empty
        // stdout). The same script must then spawn and match, so the deny
        // assertions above cannot be passing for an unrelated reason.
        let control = "tm-hook-allow";
        let mut ctx = ctx_for(&dir);
        ctx.hooks = Some(hook_set("true"));
        let (ctx, authority) = thread_authority_with(
            ctx,
            control,
            Arc::new(move || Ok(crate::thread_capabilities::generation(control))),
        );
        let set = Arc::new(MonitorSet::new());
        set.start_owned(spec("watch", &script, 30), ctx, Some(authority))
            .unwrap();
        let update = next_notice(&set).await;
        assert!(update.matched, "{}", update.text);
        assert!(marker.exists(), "control failed to spawn");
    }

    fn sleeping_hook_set(command: &str) -> crate::tools::hooks::HookSet {
        let mut hooks = crate::tools::hooks::HookSet::new();
        hooks.extend_from(
            vec![crate::tools::hooks::HookEntry {
                event: "PreToolUse".into(),
                matcher: Some(crate::tools::SHELL_TOOL.into()),
                command: command.into(),
                timeout_secs: None,
            }],
            Path::new("test-hooks"),
        );
        assert_eq!(hooks.len(), 1, "the test hook must have loaded");
        hooks
    }

    /// R4: a poll's PreToolUse hook is part of the monitor's authority. It
    /// registers under the monitor's owner so a revocation's reap finds it and
    /// its descendants, instead of an ownerless bucket nothing sweeps.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_poll_hook_is_owned_and_reaped_by_a_revocation() {
        let dir = unique_root();
        let id = "tm-hook-owned";
        let owner = format!("thread-monitor:{id}");
        let pidfile = dir.join("hook-sleeper.pid");
        let mut ctx = ctx_for(&dir);
        // The sleeper is the hook shell's grandchild, so liveness can be probed
        // without a zombie (same pattern as the owned-children test).
        ctx.hooks = Some(sleeping_hook_set(&format!(
            "sleep 30 & echo $! > {}; wait",
            pidfile.display()
        )));
        let (ctx, authority) = thread_authority_with(
            ctx,
            id,
            Arc::new(move || Ok(crate::thread_capabilities::generation(id))),
        );
        let set = Arc::new(MonitorSet::new());
        set.start_owned(spec("watch", "false", 30), ctx, Some(authority))
            .unwrap();
        let mut pid = None;
        for _ in 0..400 {
            if let Some(parsed) = std::fs::read_to_string(&pidfile)
                .ok()
                .and_then(|s| s.trim().parse::<i32>().ok())
            {
                pid = Some(parsed);
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let pid = nix::unistd::Pid::from_raw(pid.expect("the hook never started"));
        assert!(nix::sys::signal::kill(pid, None).is_ok(), "hook sleeper must be alive");
        // What a revocation does: drain the owner's bucket and kill its trees.
        let pids = crate::tools::proc::take_thread_pids(&owner);
        assert!(!pids.is_empty(), "the hook child is not registered under the monitor's owner");
        for p in pids {
            crate::tools::proc::kill_tree(p);
        }
        let mut dead = false;
        for _ in 0..500 {
            if nix::sys::signal::kill(pid, None).is_err() {
                dead = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        set.stop_all();
        assert!(dead, "the revocation's reap did not take the hook's process tree");
    }

    /// R4: hook spawning is admitted against the generation like the poll's own
    /// spawn. A poll authorized at a generation that has since moved starts no
    /// hook (and so, with the hook refused, no script either).
    #[cfg(unix)]
    #[tokio::test]
    async fn a_poll_hook_does_not_start_after_the_generation_moved() {
        let dir = unique_root();
        let id = "tm-hook-stale";
        let hook_marker = dir.join("hook-ran");
        let script_marker = dir.join("script-ran");
        let mut ctx = ctx_for(&dir);
        ctx.hooks = Some(sleeping_hook_set(&format!("touch {}", hook_marker.display())));
        // The poll was authorized at a token the thread has already moved past.
        let (ctx, authority) = thread_authority_with(
            ctx,
            id,
            Arc::new(move || Ok(crate::thread_capabilities::generation(id) + 1_000_000)),
        );
        let set = Arc::new(MonitorSet::new());
        set.start_owned(
            spec("watch", &format!("touch {}", script_marker.display()), 30),
            ctx,
            Some(authority),
        )
        .unwrap();
        tokio::time::sleep(Duration::from_millis(400)).await;
        set.stop_all();
        assert!(!hook_marker.exists(), "a hook started under a stale generation");
        assert!(!script_marker.exists(), "the poll script started under a stale generation");
    }

    /// A thread monitor's poll children are owned, so a revocation reaps
    /// exactly its pids -- by registered id, never by process name. Probes
    /// REAL process liveness by pid: registry membership alone is a
    /// tautology, because `kill_thread` drains the bucket before it kills
    /// anything, so `snapshot()` goes empty even if nothing was signalled.
    #[cfg(unix)]
    #[tokio::test]
    async fn thread_monitor_children_are_owned_and_reaped_by_id() {
        let dir = unique_root();
        let id = "tm-owned-children";
        let owner = format!("thread-monitor:{id}");
        let pidfile = dir.join("owned-child.pid");
        // The sleeper is the shell's own child (same process group), so after
        // the kill it is reparented and reaped by the OS: liveness can be
        // probed without the zombie ambiguity a direct child would have
        // (same pattern as the session-abort test).
        let script = format!("sleep 30 & echo $! > {}; wait", pidfile.display());
        let (ctx, authority) = thread_authority_for(
            id,
            &dir,
            Arc::new(move || Ok(crate::thread_capabilities::generation(id))),
        );
        let set = Arc::new(MonitorSet::new());
        set.start_owned(spec("watch", &script, 30), ctx, Some(authority))
            .unwrap();
        let mut pid = None;
        for _ in 0..400 {
            if let Some(parsed) = std::fs::read_to_string(&pidfile)
                .ok()
                .and_then(|s| s.trim().parse::<i32>().ok())
            {
                pid = Some(parsed);
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let pid = nix::unistd::Pid::from_raw(pid.expect("the poll child never started"));
        // Positive control: genuinely alive before the kill, so the probe
        // below cannot pass vacuously.
        assert!(
            nix::sys::signal::kill(pid, None).is_ok(),
            "the sleeper must be alive before the revocation"
        );
        crate::tools::proc::kill_thread(&owner);
        let mut dead = false;
        for _ in 0..500 {
            if nix::sys::signal::kill(pid, None).is_err() {
                dead = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        set.stop_all();
        assert!(dead, "kill_thread did not kill the owned poll child's tree");
    }

    // POSIX command text: Windows runs PowerShell.
    #[cfg(unix)]
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

    // POSIX command text: Windows runs PowerShell.
    #[cfg(unix)]
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

    // POSIX command text: Windows runs PowerShell.
    #[cfg(unix)]
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

    // POSIX command text: Windows runs PowerShell.
    #[cfg(unix)]
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

    // R5: a poll that completes normally must not leave its background
    // descendants running (and, once unregistered, beyond a revocation's reach).
    #[cfg(unix)]
    #[tokio::test]
    async fn a_completed_poll_does_not_leave_descendants_running() {
        let dir = unique_root();
        let marker = dir.join("late-marker");
        let script = format!(
            "(sleep 1; touch '{}') >/dev/null 2>&1 & exit 0",
            marker.display()
        );
        let set = Arc::new(MonitorSet::new());
        set.start(spec("bg", &script, 30), ctx_for(&dir)).unwrap();
        let update = next_notice(&set).await;
        assert!(update.matched, "the poll itself must still match");
        tokio::time::sleep(Duration::from_millis(1700)).await;
        assert!(!marker.exists(), "a surviving descendant of a completed poll wrote its marker");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // R8: two monitors started on one thread must each deliver to the sink
    // they were started with, not to whichever subscribed last.
    #[cfg(unix)]
    #[tokio::test]
    async fn each_monitor_delivers_to_its_own_sink() {
        let dir = unique_root();
        std::fs::write(dir.join("one.log"), "").unwrap();
        std::fs::write(dir.join("two.log"), "").unwrap();
        let routed = RoutedMonitors::new();
        let (tx1, mut rx1) = tokio::sync::mpsc::unbounded_channel();
        let (tx2, mut rx2) = tokio::sync::mpsc::unbounded_channel();
        let m1 = routed
            .start(
                spec("one", "grep hit one.log", 30),
                ctx_for(&dir),
                None,
                Arc::new(move |u| {
                    let _ = tx1.send(u);
                }),
            )
            .unwrap();
        routed
            .start(
                spec("two", "grep hit two.log", 30),
                ctx_for(&dir),
                None,
                Arc::new(move |u| {
                    let _ = tx2.send(u);
                }),
            )
            .unwrap();
        assert!(m1.contains("monitor_id=mon-1"), "{m1}");
        // M1 matches while M2 (started later) is still polling.
        std::fs::write(dir.join("one.log"), "hit\n").unwrap();
        let first = tokio::time::timeout(Duration::from_secs(5), rx1.recv())
            .await
            .expect("M1's update never reached M1's sink")
            .unwrap();
        assert_eq!((first.monitor_id.as_str(), first.name.as_str()), ("mon-1", "one"));
        assert!(rx2.try_recv().is_err(), "M1's update leaked into M2's sink");
        std::fs::write(dir.join("two.log"), "hit\n").unwrap();
        let second = tokio::time::timeout(Duration::from_secs(5), rx2.recv())
            .await
            .expect("M2's update never reached M2's sink")
            .unwrap();
        assert_eq!(second.monitor_id, "mon-2");
        assert!(rx1.try_recv().is_err());
        assert!(routed.sinks.lock().unwrap().is_empty(), "fired routes are dropped");
        let _ = std::fs::remove_dir_all(&dir);
    }

    // POSIX command text: Windows runs PowerShell.
    #[cfg(unix)]
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
