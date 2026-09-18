//! Declarative lifecycle hooks: user-supplied shell commands the agent runs at
//! fixed points of a run (before and after a tool call, at prompt submit, at
//! session start and end, before a compaction).
//!
//! The point is to make a team policy enforceable rather than merely requested.
//! "Run `cargo fmt` after every `edit`", "never let `bash` touch `infra/`",
//! "log every tool call to our audit sink" had no home before this: the only
//! lever was the system prompt, which the model is free to ignore.
//!
//! A hook is a shell command, not a plugin runtime. It runs through
//! [`crate::tools::handlers::confined_shell`] -- the very policy `bash` and the
//! `monitor` condition scripts already get -- so nothing here is a new
//! execution primitive, and a hook under a sandboxed run is confined exactly as
//! the shell the model drives is. That is also why this module lives in the
//! toolset crate and not in `core/agent/`: `confined_shell` is `pub(crate)`.
//!
//! Protocol: the event payload arrives on stdin as one JSON object; the answer
//! is whatever the command writes to stdout. Empty stdout (or output that is
//! not a JSON object) means "proceed unchanged". A JSON object may carry
//! `{"decision":"deny","reason":"..."}` -- honored for `PreToolUse` only -- or
//! `{"context":"..."}`, which the caller folds into the next turn as a
//! `<SYSTEM>` reminder.
//!
//! Failure is never fatal. A hook that exits nonzero, hangs past its timeout,
//! or writes unparseable stdout produces one [`HookNotice`] and the run carries
//! on; a hook must not be able to wedge a session, and a silent skip would be
//! worse than a visible complaint.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::tools::ToolContext;

/// Per-hook wall clock. Matches the monitor's condition-script overrun
/// (`monitor::EVAL_TIMEOUT`): a hook is the same kind of short side command,
/// and a run must not stall on one that never returns.
pub const DEFAULT_TIMEOUT_SECS: u64 = 60;

/// Upper bound on a hook's stdout that is parsed. A hook answers with a small
/// JSON object; anything past this is a runaway and is truncated rather than
/// buffered without limit.
const OUTPUT_MAX_BYTES: usize = 64 * 1024;

/// The lifecycle points a hook can attach to.
///
/// Deliberately the set the tree can already express -- there is a real call
/// site for each, and no event is advertised that nothing fires.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum HookEvent {
    /// Before a tool call executes. The only event whose `deny` is honored.
    PreToolUse,
    /// After a tool call returns, with its result text in the payload.
    PostToolUse,
    /// A user prompt was submitted, before the turn starts.
    UserPromptSubmit,
    /// A session began.
    SessionStart,
    /// A session ended.
    SessionEnd,
    /// Before the conversation is compacted.
    PreCompact,
}

impl HookEvent {
    pub fn as_str(self) -> &'static str {
        match self {
            HookEvent::PreToolUse => "PreToolUse",
            HookEvent::PostToolUse => "PostToolUse",
            HookEvent::UserPromptSubmit => "UserPromptSubmit",
            HookEvent::SessionStart => "SessionStart",
            HookEvent::SessionEnd => "SessionEnd",
            HookEvent::PreCompact => "PreCompact",
        }
    }

    /// Parse an event name. Case-sensitive: the names are a wire contract
    /// shared with `hooks.json`, and quietly accepting `pretooluse` would make
    /// a typo in one file behave differently from the same typo in another.
    pub fn parse(name: &str) -> Option<Self> {
        match name {
            "PreToolUse" => Some(HookEvent::PreToolUse),
            "PostToolUse" => Some(HookEvent::PostToolUse),
            "UserPromptSubmit" => Some(HookEvent::UserPromptSubmit),
            "SessionStart" => Some(HookEvent::SessionStart),
            "SessionEnd" => Some(HookEvent::SessionEnd),
            "PreCompact" => Some(HookEvent::PreCompact),
            _ => None,
        }
    }

    /// Whether this event is suppressed in read-only Plan mode.
    ///
    /// Only the two tool events are. Plan mode withholds every write/exec-
    /// capable tool from the model, so running an arbitrary shell command
    /// around one would reintroduce exactly the capability that mode exists to
    /// remove -- and with the tool withheld there is nothing left to wrap.
    ///
    /// The lifecycle events stay live. None of them is attached to a tool
    /// call: a run still starts, still ends, still takes a prompt and still
    /// compacts in Plan mode, and a `UserPromptSubmit` hook that injects
    /// context is if anything *more* useful while planning. They are not a
    /// mutation the mode is meant to stop.
    pub fn inert_in_plan_mode(self) -> bool {
        matches!(self, HookEvent::PreToolUse | HookEvent::PostToolUse)
    }
}

/// One configured hook: an event, a tool-name glob, and the command to run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Hook {
    pub event: HookEvent,
    /// Tool-name glob (`*` = any). Only consulted for the tool events; a
    /// session-lifecycle hook has no tool name to match and always fires.
    pub matcher: String,
    pub command: String,
    /// Seconds before the hook is killed. Defaults to [`DEFAULT_TIMEOUT_SECS`].
    pub timeout_secs: u64,
    /// The file this hook was read from, for `jan cli agent status`. A user
    /// looking at surprising behavior needs to know which of the three layers
    /// put it there.
    pub source: PathBuf,
}

impl Hook {
    /// Whether this hook applies to `tool_name`. A hook with no meaningful
    /// matcher (`*` or empty) applies to every tool.
    pub fn matches(&self, tool_name: &str) -> bool {
        if self.matcher.is_empty() || self.matcher == "*" {
            return true;
        }
        glob::Pattern::new(&self.matcher)
            .map(|p| p.matches(tool_name))
            .unwrap_or(false)
    }
}

/// The raw `[[hooks]]` / `hooks.json` entry, before defaults are applied and
/// the event name is validated. `event` and `command` are the only required
/// fields, so the smallest useful hook is two lines.
///
/// `Serialize` as well as `Deserialize` because `~/.jan/config.toml` is
/// round-tripped through its typed struct on every write; without it, saving a
/// provider would silently drop the user's hooks.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct HookEntry {
    pub event: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub matcher: Option<String>,
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_secs: Option<u64>,
}

/// Every hook a run may fire, in the order they were merged: least specific
/// source first, so a project file's hook runs after the user's global one and
/// a plugin's runs before both.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct HookSet {
    hooks: Vec<Hook>,
}

impl HookSet {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_empty(&self) -> bool {
        self.hooks.is_empty()
    }

    pub fn len(&self) -> usize {
        self.hooks.len()
    }

    pub fn all(&self) -> &[Hook] {
        &self.hooks
    }

    /// Append entries from one source, skipping any whose event name is not
    /// recognized or whose command is blank. A malformed entry is dropped
    /// rather than failing the load: one bad line in a shared config must not
    /// take every other hook down with it.
    pub fn extend_from(&mut self, entries: Vec<HookEntry>, source: &Path) {
        for entry in entries {
            let Some(event) = HookEvent::parse(entry.event.trim()) else {
                continue;
            };
            let command = entry.command.trim().to_string();
            if command.is_empty() {
                continue;
            }
            self.hooks.push(Hook {
                event,
                matcher: entry
                    .matcher
                    .unwrap_or_else(|| "*".to_string())
                    .trim()
                    .to_string(),
                command,
                timeout_secs: entry.timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS),
                source: source.to_path_buf(),
            });
        }
    }

    /// Hooks that fire for `event` and (for the tool events) `tool_name`, in
    /// merge order.
    pub fn matching(&self, event: HookEvent, tool_name: Option<&str>) -> Vec<&Hook> {
        self.hooks
            .iter()
            .filter(|h| h.event == event)
            .filter(|h| match tool_name {
                Some(name) => h.matches(name),
                None => true,
            })
            .collect()
    }
}

/// Read an installed plugin's `hooks/hooks.json`: a bare JSON array of entries.
/// Missing or malformed yields nothing, like every other optional plugin
/// payload -- installing a plugin must not be able to break a run.
pub fn plugin_hook_entries(plugin_dir: &Path) -> (Vec<HookEntry>, PathBuf) {
    let path = plugin_dir.join("hooks").join("hooks.json");
    let entries = std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<HookEntry>>(&raw).ok())
        .unwrap_or_default();
    (entries, path)
}

/// What a hook's stdout asked the run to do.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct HookResponse {
    /// `"deny"` blocks the call (PreToolUse only). Any other value is ignored,
    /// so a hook cannot *grant* a permission the gate would have withheld --
    /// hooks tighten policy, they never loosen it.
    #[serde(default)]
    pub decision: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    /// Text folded into the next turn as a `<SYSTEM>` reminder.
    #[serde(default)]
    pub context: Option<String>,
}

impl HookResponse {
    pub fn denies(&self) -> bool {
        self.decision.as_deref() == Some("deny")
    }
}

/// A hook misbehaved: nonzero exit, timeout, spawn failure or unparseable
/// stdout. Surfaced to the user once; never fails the run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookNotice {
    pub event: HookEvent,
    pub command: String,
    pub detail: String,
}

impl HookNotice {
    pub fn message(&self) -> String {
        format!(
            "Hook {} ('{}') {}",
            self.event.as_str(),
            self.command,
            self.detail
        )
    }
}

/// The aggregate answer of every hook that fired for one event.
#[derive(Debug, Clone, Default)]
pub struct HookOutcome {
    /// Set by the first `PreToolUse` hook that denied, with its reason. Later
    /// hooks for the same call are not run: the decision is already made and a
    /// hook that expects the call to have happened would be misled.
    pub denied: Option<String>,
    /// `context` strings, in hook order, for the caller to attach as reminders.
    pub context: Vec<String>,
    /// One entry per hook that failed.
    pub notices: Vec<HookNotice>,
}

/// What a fired event has to tell the run, for a [`crate::tools::HookSink`].
/// Separated from [`HookOutcome`] because a deny is answered synchronously by
/// the dispatcher while these two are folded into a later turn.
#[derive(Debug, Clone, Default)]
pub struct HookReport {
    pub context: Vec<String>,
    pub notices: Vec<HookNotice>,
}

impl HookReport {
    pub fn is_empty(&self) -> bool {
        self.context.is_empty() && self.notices.is_empty()
    }
}

/// The run-scoped facts a hook payload carries beyond the event itself.
#[derive(Debug, Clone, Default)]
pub struct HookPayload {
    pub tool_name: Option<String>,
    pub tool_input: Option<serde_json::Value>,
    pub tool_result: Option<String>,
    pub prompt: Option<String>,
    pub session_id: Option<String>,
    pub message_count: Option<usize>,
}

impl HookPayload {
    fn to_json(&self, event: HookEvent, project_root: &Path) -> serde_json::Value {
        let mut obj = serde_json::Map::new();
        obj.insert("event".into(), serde_json::json!(event.as_str()));
        obj.insert(
            "project_root".into(),
            serde_json::json!(project_root.to_string_lossy()),
        );
        if let Some(name) = &self.tool_name {
            obj.insert("tool_name".into(), serde_json::json!(name));
        }
        if let Some(input) = &self.tool_input {
            obj.insert("tool_input".into(), input.clone());
        }
        if let Some(result) = &self.tool_result {
            obj.insert("tool_result".into(), serde_json::json!(result));
        }
        if let Some(prompt) = &self.prompt {
            obj.insert("prompt".into(), serde_json::json!(prompt));
        }
        if let Some(session) = &self.session_id {
            obj.insert("session_id".into(), serde_json::json!(session));
        }
        if let Some(count) = self.message_count {
            obj.insert("message_count".into(), serde_json::json!(count));
        }
        serde_json::Value::Object(obj)
    }
}

/// Fire every hook registered for `event`, in merge order, and fold their
/// answers together.
///
/// `plan_mode` suppresses the tool and prompt events entirely (see
/// [`HookEvent::inert_in_plan_mode`]). A `PreToolUse` deny short-circuits the
/// rest.
pub async fn run_hooks(
    set: &HookSet,
    event: HookEvent,
    payload: &HookPayload,
    ctx: &ToolContext<'_>,
    plan_mode: bool,
) -> HookOutcome {
    let mut outcome = HookOutcome::default();
    if plan_mode && event.inert_in_plan_mode() {
        return outcome;
    }
    let hooks = set.matching(event, payload.tool_name.as_deref());
    if hooks.is_empty() {
        return outcome;
    }
    let body = serde_json::to_string(&payload.to_json(event, ctx.project_root))
        .unwrap_or_else(|_| "{}".to_string());
    for hook in hooks {
        match run_one(hook, &body, ctx).await {
            Ok(mut response) => {
                if let Some(context) = response.context.take().filter(|c| !c.trim().is_empty()) {
                    outcome.context.push(context);
                }
                // Only PreToolUse can deny: there is nothing left to stop once
                // a tool has run, and the other events do not sit on a decision.
                if event == HookEvent::PreToolUse && response.denies() {
                    outcome.denied = Some(
                        response
                            .reason
                            .filter(|r| !r.trim().is_empty())
                            .unwrap_or_else(|| "denied by a PreToolUse hook".to_string()),
                    );
                    return outcome;
                }
            }
            Err(detail) => outcome.notices.push(HookNotice {
                event,
                command: hook.command.clone(),
                detail,
            }),
        }
    }
    outcome
}

/// Run one hook command to completion. `Err` carries the one-line detail a
/// [`HookNotice`] reports; it never propagates as a run failure.
async fn run_one(hook: &Hook, body: &str, ctx: &ToolContext<'_>) -> Result<HookResponse, String> {
    let (shell, sandbox_tmp, _policy) = crate::tools::handlers::confined_shell(ctx)
        .map_err(|e| format!("could not start: {}", e.trim_start_matches("ERROR: ")))?;
    // A hook child is short-lived and belongs to the run rather than to a
    // cancellable tool call, so it registers in the process-wide bucket the
    // monitor poll children use.
    let mut child = crate::tools::proc::spawn_with_stdin(
        &shell,
        &hook.command,
        ctx.project_root,
        sandbox_tmp.as_deref(),
        ctx.shell_env(),
        None,
        Some(body),
    )
    .await
    .map_err(|e| format!("could not start: {e}"))?;
    let pid = child.id();
    let timeout = Duration::from_secs(hook.timeout_secs.max(1));
    let collected = tokio::time::timeout(timeout, async {
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        // stderr is drained and discarded: only stdout is the protocol, but an
        // undrained pipe would block a chatty hook forever.
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
                            let room = OUTPUT_MAX_BYTES.saturating_sub(head.len());
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
        crate::tools::proc::unregister(None, pid);
    }
    let (status, head) = match collected {
        Ok(pair) => pair,
        Err(_) => {
            // Timed out: reap the whole tree, or a wedged hook leaks children.
            if let Some(pid) = pid {
                crate::tools::proc::kill_tree(pid);
            }
            return Err(format!("timed out after {}s", hook.timeout_secs));
        }
    };
    let status = status.map_err(|e| format!("could not be waited on: {e}"))?;
    if !status.success() {
        let code = status
            .code()
            .map(|c| c.to_string())
            .unwrap_or_else(|| "signal".to_string());
        return Err(format!("exited {code}"));
    }
    parse_response(&String::from_utf8_lossy(&head))
}

/// Fire `event`'s hooks using the hook set, plan-mode flag and sink a
/// [`ToolContext`] carries, reporting context and notices through that sink.
/// `Some(reason)` is a `PreToolUse` deny.
///
/// This is what wraps [`crate::tools::handlers::execute_builtin`], so every
/// caller of the toolset -- the CLI loop, the desktop IPC command, and any
/// out-of-process caller added later -- goes through the same hooks without
/// having to remember to.
pub async fn fire_from_context(
    event: HookEvent,
    payload: &HookPayload,
    ctx: &ToolContext<'_>,
) -> Option<String> {
    let set = ctx.hooks?;
    if set.is_empty() {
        return None;
    }
    let outcome = run_hooks(set, event, payload, ctx, ctx.plan_mode).await;
    if let Some(sink) = &ctx.hook_sink {
        let report = HookReport {
            context: outcome.context,
            notices: outcome.notices,
        };
        if !report.is_empty() {
            sink(report);
        }
    }
    outcome.denied
}

/// Interpret a hook's stdout. Empty (or whitespace) is the common case and
/// means "proceed unchanged". Anything that is not a JSON object is an error
/// the caller reports, because a hook that meant to deny and mistyped its JSON
/// must not be read as consent.
fn parse_response(stdout: &str) -> Result<HookResponse, String> {
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return Ok(HookResponse::default());
    }
    serde_json::from_str::<HookResponse>(trimmed)
        .map_err(|_| "emitted stdout that is not a JSON object".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(event: &str, matcher: Option<&str>, command: &str) -> HookEntry {
        HookEntry {
            event: event.to_string(),
            matcher: matcher.map(str::to_string),
            command: command.to_string(),
            timeout_secs: None,
        }
    }

    fn unique_root(tag: &str) -> PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("jan-hooks-{tag}-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Unconfined so the test does not need an OS sandbox backend; every hook
    /// test only runs `echo`/`exit`.
    fn ctx<'a>(root: &'a Path, store: &'a Path, empty: &'a [String]) -> ToolContext<'a> {
        ToolContext::new(root, store, empty).with_sandbox(false)
    }

    #[test]
    fn every_event_name_round_trips() {
        for event in [
            HookEvent::PreToolUse,
            HookEvent::PostToolUse,
            HookEvent::UserPromptSubmit,
            HookEvent::SessionStart,
            HookEvent::SessionEnd,
            HookEvent::PreCompact,
        ] {
            assert_eq!(HookEvent::parse(event.as_str()), Some(event));
        }
        assert_eq!(HookEvent::parse("pretooluse"), None);
        assert_eq!(HookEvent::parse("Nope"), None);
    }

    #[test]
    fn entries_with_an_unknown_event_or_blank_command_are_dropped() {
        let mut set = HookSet::new();
        set.extend_from(
            vec![
                entry("PreToolUse", None, "true"),
                entry("NotAnEvent", None, "true"),
                entry("PostToolUse", None, "   "),
            ],
            Path::new("/tmp/agent.toml"),
        );
        assert_eq!(set.len(), 1);
        assert_eq!(set.all()[0].event, HookEvent::PreToolUse);
    }

    #[test]
    fn a_missing_matcher_defaults_to_every_tool() {
        let mut set = HookSet::new();
        set.extend_from(vec![entry("PreToolUse", None, "true")], Path::new("x"));
        assert_eq!(set.all()[0].matcher, "*");
        assert!(set.all()[0].matches("bash"));
        assert!(set.all()[0].matches("edit"));
    }

    #[test]
    fn a_matcher_glob_selects_tools() {
        let mut set = HookSet::new();
        set.extend_from(
            vec![
                entry("PreToolUse", Some("edit"), "a"),
                entry("PreToolUse", Some("*write*"), "b"),
                entry("PostToolUse", Some("edit"), "c"),
            ],
            Path::new("x"),
        );
        let matched = set.matching(HookEvent::PreToolUse, Some("edit"));
        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0].command, "a");
        let matched = set.matching(HookEvent::PreToolUse, Some("memory_write"));
        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0].command, "b");
    }

    #[test]
    fn merge_order_is_the_order_sources_were_added() {
        let mut set = HookSet::new();
        set.extend_from(vec![entry("SessionStart", None, "plugin")], Path::new("p"));
        set.extend_from(vec![entry("SessionStart", None, "global")], Path::new("g"));
        set.extend_from(vec![entry("SessionStart", None, "project")], Path::new("a"));
        let commands: Vec<&str> = set
            .matching(HookEvent::SessionStart, None)
            .iter()
            .map(|h| h.command.as_str())
            .collect();
        assert_eq!(commands, vec!["plugin", "global", "project"]);
    }

    #[test]
    fn each_hook_records_the_file_it_came_from() {
        let mut set = HookSet::new();
        set.extend_from(
            vec![entry("SessionEnd", None, "true")],
            Path::new("/home/u/.jan/config.toml"),
        );
        assert_eq!(
            set.all()[0].source,
            PathBuf::from("/home/u/.jan/config.toml")
        );
    }

    #[test]
    fn only_the_tool_events_are_inert_in_plan_mode() {
        assert!(HookEvent::PreToolUse.inert_in_plan_mode());
        assert!(HookEvent::PostToolUse.inert_in_plan_mode());
        assert!(!HookEvent::UserPromptSubmit.inert_in_plan_mode());
        assert!(!HookEvent::SessionStart.inert_in_plan_mode());
        assert!(!HookEvent::SessionEnd.inert_in_plan_mode());
        assert!(!HookEvent::PreCompact.inert_in_plan_mode());
    }

    #[test]
    fn empty_stdout_proceeds_unchanged() {
        let response = parse_response("   \n ").unwrap();
        assert!(!response.denies());
        assert!(response.context.is_none());
    }

    #[test]
    fn unparseable_stdout_is_an_error_not_consent() {
        assert!(parse_response("yes please").is_err());
        assert!(parse_response("{\"decision\":").is_err());
    }

    #[test]
    fn only_a_deny_decision_blocks() {
        assert!(parse_response(r#"{"decision":"deny"}"#).unwrap().denies());
        assert!(!parse_response(r#"{"decision":"allow"}"#).unwrap().denies());
        assert!(!parse_response(r#"{"context":"hi"}"#).unwrap().denies());
    }

    #[tokio::test]
    async fn a_pretooluse_deny_stops_the_call_and_carries_its_reason() {
        let root = unique_root("deny");
        let store = root.join("store");
        std::fs::create_dir_all(&store).unwrap();
        let empty: Vec<String> = Vec::new();
        let mut set = HookSet::new();
        set.extend_from(
            vec![entry(
                "PreToolUse",
                Some("bash"),
                r#"echo '{"decision":"deny","reason":"infra is off limits"}'"#,
            )],
            Path::new("x"),
        );
        let payload = HookPayload {
            tool_name: Some("bash".to_string()),
            ..Default::default()
        };
        let outcome = run_hooks(
            &set,
            HookEvent::PreToolUse,
            &payload,
            &ctx(&root, &store, &empty),
            false,
        )
        .await;
        assert_eq!(outcome.denied.as_deref(), Some("infra is off limits"));
        assert!(outcome.notices.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn a_deny_short_circuits_the_hooks_behind_it() {
        let root = unique_root("shortcircuit");
        let store = root.join("store");
        std::fs::create_dir_all(&store).unwrap();
        let marker = root.join("second-ran");
        let empty: Vec<String> = Vec::new();
        let mut set = HookSet::new();
        set.extend_from(
            vec![
                entry("PreToolUse", None, r#"echo '{"decision":"deny"}'"#),
                entry(
                    "PreToolUse",
                    None,
                    &format!("touch {}", marker.to_string_lossy()),
                ),
            ],
            Path::new("x"),
        );
        let payload = HookPayload {
            tool_name: Some("bash".to_string()),
            ..Default::default()
        };
        let outcome = run_hooks(
            &set,
            HookEvent::PreToolUse,
            &payload,
            &ctx(&root, &store, &empty),
            false,
        )
        .await;
        assert!(outcome.denied.is_some());
        assert!(!marker.exists(), "the hook behind a deny must not run");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn a_deny_from_a_non_pretooluse_event_is_ignored() {
        let root = unique_root("denyignored");
        let store = root.join("store");
        std::fs::create_dir_all(&store).unwrap();
        let empty: Vec<String> = Vec::new();
        let mut set = HookSet::new();
        set.extend_from(
            vec![entry("PostToolUse", None, r#"echo '{"decision":"deny"}'"#)],
            Path::new("x"),
        );
        let outcome = run_hooks(
            &set,
            HookEvent::PostToolUse,
            &HookPayload {
                tool_name: Some("edit".to_string()),
                ..Default::default()
            },
            &ctx(&root, &store, &empty),
            false,
        )
        .await;
        assert!(outcome.denied.is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn a_context_answer_is_collected_for_the_caller_to_attach() {
        let root = unique_root("context");
        let store = root.join("store");
        std::fs::create_dir_all(&store).unwrap();
        let empty: Vec<String> = Vec::new();
        let mut set = HookSet::new();
        set.extend_from(
            vec![entry(
                "UserPromptSubmit",
                None,
                r#"echo '{"context":"the build is red"}'"#,
            )],
            Path::new("x"),
        );
        let outcome = run_hooks(
            &set,
            HookEvent::UserPromptSubmit,
            &HookPayload::default(),
            &ctx(&root, &store, &empty),
            false,
        )
        .await;
        assert_eq!(outcome.context, vec!["the build is red".to_string()]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn the_payload_reaches_the_hook_on_stdin() {
        let root = unique_root("payload");
        let store = root.join("store");
        std::fs::create_dir_all(&store).unwrap();
        let out = root.join("stdin.json");
        let empty: Vec<String> = Vec::new();
        let mut set = HookSet::new();
        set.extend_from(
            vec![entry(
                "PreToolUse",
                None,
                &format!("cat > {}", out.to_string_lossy()),
            )],
            Path::new("x"),
        );
        let payload = HookPayload {
            tool_name: Some("edit".to_string()),
            tool_input: Some(serde_json::json!({"path": "a.rs"})),
            ..Default::default()
        };
        let outcome = run_hooks(
            &set,
            HookEvent::PreToolUse,
            &payload,
            &ctx(&root, &store, &empty),
            false,
        )
        .await;
        assert!(outcome.notices.is_empty(), "{:?}", outcome.notices);
        let written: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
        assert_eq!(written["event"], "PreToolUse");
        assert_eq!(written["tool_name"], "edit");
        assert_eq!(written["tool_input"]["path"], "a.rs");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn a_failing_hook_emits_one_notice_and_does_not_deny() {
        let root = unique_root("failing");
        let store = root.join("store");
        std::fs::create_dir_all(&store).unwrap();
        let empty: Vec<String> = Vec::new();
        let mut set = HookSet::new();
        set.extend_from(
            vec![
                entry("PreToolUse", None, "exit 3"),
                entry("PreToolUse", None, "echo not-json"),
            ],
            Path::new("x"),
        );
        let outcome = run_hooks(
            &set,
            HookEvent::PreToolUse,
            &HookPayload {
                tool_name: Some("bash".to_string()),
                ..Default::default()
            },
            &ctx(&root, &store, &empty),
            false,
        )
        .await;
        assert!(outcome.denied.is_none());
        assert_eq!(outcome.notices.len(), 2);
        assert!(outcome.notices[0].detail.contains("exited 3"));
        assert!(outcome.notices[1].detail.contains("not a JSON object"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn a_hook_that_outruns_its_timeout_is_a_notice_not_a_hang() {
        let root = unique_root("timeout");
        let store = root.join("store");
        std::fs::create_dir_all(&store).unwrap();
        let empty: Vec<String> = Vec::new();
        let mut set = HookSet::new();
        set.extend_from(
            vec![HookEntry {
                event: "PreToolUse".to_string(),
                matcher: None,
                command: "sleep 30".to_string(),
                timeout_secs: Some(1),
            }],
            Path::new("x"),
        );
        let outcome = run_hooks(
            &set,
            HookEvent::PreToolUse,
            &HookPayload {
                tool_name: Some("bash".to_string()),
                ..Default::default()
            },
            &ctx(&root, &store, &empty),
            false,
        )
        .await;
        assert!(outcome.denied.is_none());
        assert_eq!(outcome.notices.len(), 1);
        assert!(outcome.notices[0].detail.contains("timed out"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn plan_mode_makes_tool_hooks_inert() {
        let root = unique_root("planmode");
        let store = root.join("store");
        std::fs::create_dir_all(&store).unwrap();
        let marker = root.join("ran");
        let empty: Vec<String> = Vec::new();
        let mut set = HookSet::new();
        set.extend_from(
            vec![entry(
                "PreToolUse",
                None,
                &format!("touch {}", marker.to_string_lossy()),
            )],
            Path::new("x"),
        );
        let outcome = run_hooks(
            &set,
            HookEvent::PreToolUse,
            &HookPayload {
                tool_name: Some("bash".to_string()),
                ..Default::default()
            },
            &ctx(&root, &store, &empty),
            true,
        )
        .await;
        assert!(outcome.denied.is_none());
        assert!(outcome.notices.is_empty());
        assert!(!marker.exists(), "a tool hook must not run in plan mode");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn session_hooks_still_fire_in_plan_mode() {
        let root = unique_root("planlifecycle");
        let store = root.join("store");
        std::fs::create_dir_all(&store).unwrap();
        let empty: Vec<String> = Vec::new();
        let mut set = HookSet::new();
        set.extend_from(
            vec![entry("SessionStart", None, r#"echo '{"context":"hello"}'"#)],
            Path::new("x"),
        );
        let outcome = run_hooks(
            &set,
            HookEvent::SessionStart,
            &HookPayload::default(),
            &ctx(&root, &store, &empty),
            true,
        )
        .await;
        assert_eq!(outcome.context, vec!["hello".to_string()]);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The acceptance requirement that hooks wrap `execute_builtin` and not
    /// just the caller's invoker: a deny has to stop the tool from running even
    /// when nothing but `execute_builtin` is between the caller and the work.
    #[tokio::test]
    async fn a_deny_through_execute_builtin_stops_the_tool_from_running() {
        let root = unique_root("builtindeny");
        let store = root.join("store");
        std::fs::create_dir_all(&store).unwrap();
        let target = root.join("should-not-exist.txt");
        let empty: Vec<String> = Vec::new();
        let mut set = HookSet::new();
        set.extend_from(
            vec![entry(
                "PreToolUse",
                Some("write"),
                r#"echo '{"decision":"deny","reason":"no writes today"}'"#,
            )],
            Path::new("x"),
        );
        let ctx = ctx(&root, &store, &empty).with_hooks(&set, false, None);
        let tool = crate::tools::lookup("write").unwrap();
        let (content, _) = crate::tools::handlers::execute_builtin(
            tool,
            &serde_json::json!({"path": "should-not-exist.txt", "content": "hi"}),
            &ctx,
        )
        .await;
        assert!(
            content.starts_with("ERROR: tool 'write' denied:"),
            "{content}"
        );
        assert!(content.contains("no writes today"), "{content}");
        assert!(!target.exists(), "the denied write must not have happened");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// PostToolUse sees the result the tool produced, and its own "deny" is
    /// ignored: the call already happened, so there is nothing left to stop.
    #[tokio::test]
    async fn posttooluse_through_execute_builtin_sees_the_result() {
        let root = unique_root("builtinpost");
        let store = root.join("store");
        std::fs::create_dir_all(&store).unwrap();
        std::fs::write(root.join("a.txt"), "file body here").unwrap();
        let seen = root.join("seen.json");
        let empty: Vec<String> = Vec::new();
        let mut set = HookSet::new();
        set.extend_from(
            vec![entry(
                "PostToolUse",
                Some("read"),
                &format!("cat > {}", seen.to_string_lossy()),
            )],
            Path::new("x"),
        );
        let ctx = ctx(&root, &store, &empty).with_hooks(&set, false, None);
        let tool = crate::tools::lookup("read").unwrap();
        let (content, _) = crate::tools::handlers::execute_builtin(
            tool,
            &serde_json::json!({"path": "a.txt"}),
            &ctx,
        )
        .await;
        assert!(content.contains("file body here"), "{content}");
        let written: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&seen).unwrap()).unwrap();
        assert_eq!(written["event"], "PostToolUse");
        assert_eq!(written["tool_name"], "read");
        assert!(written["tool_result"]
            .as_str()
            .unwrap()
            .contains("file body here"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A context answer and a failure notice both reach the caller's sink, which
    /// is how they become `<SYSTEM>` reminders a turn later.
    #[tokio::test]
    async fn the_sink_receives_context_and_notices() {
        let root = unique_root("sink");
        let store = root.join("store");
        std::fs::create_dir_all(&store).unwrap();
        let empty: Vec<String> = Vec::new();
        let mut set = HookSet::new();
        set.extend_from(
            vec![
                entry("PostToolUse", None, r#"echo '{"context":"linted clean"}'"#),
                entry("PostToolUse", None, "exit 7"),
            ],
            Path::new("x"),
        );
        let reports = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let captured = reports.clone();
        let sink: crate::tools::HookSink =
            std::sync::Arc::new(move |report| captured.lock().unwrap().push(report));
        let ctx = ctx(&root, &store, &empty).with_hooks(&set, false, Some(sink));
        let denied = fire_from_context(
            HookEvent::PostToolUse,
            &HookPayload {
                tool_name: Some("edit".to_string()),
                ..Default::default()
            },
            &ctx,
        )
        .await;
        assert!(denied.is_none());
        let reports = reports.lock().unwrap();
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].context, vec!["linted clean".to_string()]);
        assert_eq!(reports[0].notices.len(), 1);
        assert!(reports[0].notices[0].message().contains("exited 7"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A context with no hooks configured costs nothing and changes nothing --
    /// the overwhelmingly common case.
    #[tokio::test]
    async fn a_run_without_hooks_is_unaffected() {
        let root = unique_root("nohooks");
        let store = root.join("store");
        std::fs::create_dir_all(&store).unwrap();
        std::fs::write(root.join("a.txt"), "body").unwrap();
        let empty: Vec<String> = Vec::new();
        let ctx = ctx(&root, &store, &empty);
        assert!(ctx.hooks.is_none());
        let tool = crate::tools::lookup("read").unwrap();
        let (content, _) = crate::tools::handlers::execute_builtin(
            tool,
            &serde_json::json!({"path": "a.txt"}),
            &ctx,
        )
        .await;
        assert!(content.contains("body"), "{content}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn plugin_hooks_are_read_from_hooks_json() {
        let root = unique_root("pluginhooks");
        std::fs::create_dir_all(root.join("hooks")).unwrap();
        std::fs::write(
            root.join("hooks").join("hooks.json"),
            r#"[{"event":"PostToolUse","matcher":"edit","command":"cargo fmt"}]"#,
        )
        .unwrap();
        let (entries, path) = plugin_hook_entries(&root);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].command, "cargo fmt");
        assert_eq!(path, root.join("hooks").join("hooks.json"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_plugin_without_hooks_or_with_broken_json_contributes_nothing() {
        let root = unique_root("pluginbroken");
        assert!(plugin_hook_entries(&root).0.is_empty());
        std::fs::create_dir_all(root.join("hooks")).unwrap();
        std::fs::write(root.join("hooks").join("hooks.json"), "{not json").unwrap();
        assert!(plugin_hook_entries(&root).0.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
}
