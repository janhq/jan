//! Stream events emitted by the agent orchestration loop. Deliberately
//! Tauri-free: CLI/TUI consume these directly and `tauri-plugin-agent` bridges
//! them to a `tauri::ipc::Channel`. The loop emits per-token `Token` deltas
//! (the upstream call streams via SSE) plus per-step progress and one terminal
//! `Done`/`Error`.

/// Version of the wire contract the event stream speaks, carried as
/// `protocol_version` on the headless channel's `init` record and in the
/// terminal envelope of `--output-format json`.
///
/// Bump it only for a change a v1 consumer cannot survive: a renamed or removed
/// tag, a removed field, or a new meaning for an existing one. Adding a variant
/// or a field is not a bump -- the contract requires a consumer to ignore what
/// it does not know, which is what lets a provider-neutral field land without
/// breaking anyone. The full rule is documented next to the channel it governs,
/// in `docs/src/pages/docs/agent/cli.mdx` under `jan cli agent run`.
pub const PROTOCOL_VERSION: u32 = 1;

/// `Deserialize` as well as `Serialize`: a consumer validates what it received
/// against these shapes (and, for a future `jan cli agent schema`, generates its
/// own types from them), so the wire has to survive a round trip, not just a
/// write. `#[serde(tag = "type")]` keeps the tag on both sides.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    /// A streamed content delta from the model.
    Token { text: String },
    /// A streamed reasoning delta, carried natively when the upstream exposes
    /// it as a dedicated field (`reasoning_content`). Display-only: reasoning
    /// never joins the assistant `content` that is resent as history, and it
    /// must never leak into piped stdout. Providers that instead inline
    /// `<think>` tags in `content` stream those through [`Token`]; consumers
    /// fall back to stripping the tags manually.
    Reasoning { text: String },
    /// A new orchestration turn began (`index` is 1-based; `max` is the turn
    /// cap, `0` when the run is unbounded, which is the normal case).
    Step { index: u32, max: u32 },
    /// A tool call started streaming: emitted mid-stream the instant the model's
    /// tool-call `id` and `name` are known, before its arguments finish
    /// streaming. Lets a consumer show an in-progress indicator during the
    /// (potentially long) argument-streaming window; the full [`ToolCall`] with
    /// parsed `args` follows once the completion is assembled.
    ToolCallStarted { id: String, name: String },
    /// A chunk of a tool call's raw JSON arguments, exactly as it arrived on the
    /// wire. Emitted between [`ToolCallStarted`] and [`ToolCall`] so a consumer
    /// can render the arguments as they land -- the difference between a
    /// featureless spinner and a live preview while a large `write` streams.
    ///
    /// Deltas, not the accumulated buffer: re-sending the whole prefix on every
    /// chunk is quadratic in a file-sized argument. Consumers concatenate.
    /// The result is *incomplete JSON* until [`ToolCall`] arrives; parse it
    /// leniently or not at all.
    ToolCallArgsDelta { id: String, delta: String },
    /// The model requested a tool call. `args` is the parsed argument object
    /// (null if the model emitted non-JSON arguments).
    ToolCall {
        id: String,
        name: String,
        args: serde_json::Value,
    },
    /// A chunk of a tool's output, as it is produced. Emitted between
    /// [`ToolCall`] and [`ToolResult`] so a consumer can show a command's output
    /// while it runs instead of only once it exits.
    ///
    /// Deltas, not the accumulated buffer, for the same reason as
    /// [`ToolCallArgsDelta`]: resending the prefix on every chunk is quadratic in
    /// the output size. Chunks are raw fragments and may split a line.
    ///
    /// Keeps arriving after a `bash` call has backgrounded itself, so a
    /// long-running job reports progress under the id of the call that started it.
    ToolOutputDelta { id: String, delta: String },
    /// A tool finished. `is_error` reflects the upstream "ERROR" encoding.
    /// `diff` is display-only focused-change text (line-prefixed `-`/`+`) for
    /// `write`/`edit`; `None` for other tools.
    ToolResult {
        id: String,
        content: String,
        is_error: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        diff: Option<String>,
    },
    /// A backgrounded subagent run began. `run_id` identifies the run so a
    /// consumer can attribute concurrent children; brackets the child's wrapped
    /// events with `SubagentEnd`.
    SubagentStart {
        run_id: String,
        name: String,
        /// The task the child was dispatched with -- its sole user message.
        /// Carried on the event rather than left for consumers to correlate
        /// back to the `dispatch_subagent` call: two dispatches can share a
        /// `subagent_name`, so matching on name alone is ambiguous.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        task: Option<String>,
    },
    /// A backgrounded subagent dispatch found the parent run's concurrency cap
    /// (`max_parallel_subagents`) exhausted and queued the child in FIFO order.
    /// `waiting` is the child's 1-based position in the queue (1 = next to
    /// start). The child's `SubagentStart` follows once a slot frees; a queued
    /// child aborted at parent teardown is closed by `SubagentEnd` like any
    /// other.
    SubagentQueued {
        run_id: String,
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        task: Option<String>,
        waiting: u32,
    },
    /// A backgrounded subagent run finished (success or error). Pairs with the
    /// `SubagentStart` of the same `run_id`.
    SubagentEnd {
        run_id: String,
        name: String,
        /// Why the child failed, when it did: the same reason the parent's
        /// `<SYSTEM>` completion ping carries. Carried on the event because a
        /// background child's answer never reaches a consumer -- only the model
        /// reads it -- so without this a failed run is indistinguishable from a
        /// clean one on screen. `None` for a clean finish, and for a child cut
        /// off at parent teardown, which is not its own failure.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    /// The later phases of a phased dispatch, named up front so a consumer can
    /// show their subagents as WAITING on an earlier phase before they start.
    /// Each pending subagent is promoted by its own `SubagentStart` (or
    /// `SubagentQueued`), matched by `name`, which is unique across a plan.
    /// Display-only and never journaled; emitted only by the top-level run
    /// (children cannot dispatch), so it is never wrapped in `Subagent`.
    SubagentPlan { pending: Vec<PendingSubagent> },
    /// A backgrounded subagent's own internal event, tagged with its run so a
    /// consumer can attribute it to the right child even when several run
    /// concurrently. `event` is a non-terminal child event (Token/Step/ToolCall/
    /// ToolResult/PermissionRequest); the child's terminal Done/Error is never
    /// wrapped (its result is delivered via `await_subagent`).
    Subagent {
        run_id: String,
        name: String,
        event: Box<StreamEvent>,
    },
    /// The user-facing headline of a background ping the loop just delivered to
    /// the model as a `<SYSTEM>` reminder (today: a `monitor` condition
    /// matching). Emitted at delivery, not when the ping is queued, so the
    /// transcript reads in the order the model saw things. Display-only and
    /// transient, like notes: it is never journaled.
    Notice { text: String },
    /// The run's active file monitors, as a whole replacing the previous set.
    /// Emitted whenever the set changes (a `monitor` start or stop, a condition
    /// matching, a monitor finishing), so a consumer keeps a live view without
    /// bookkeeping of its own. Display-only and never journaled. Not forwarded
    /// from a child: a child's monitors are its own.
    Monitors {
        monitors: Vec<tauri_plugin_agent_tools::tools::monitor::MonitorSnapshot>,
    },
    /// The model has finished its turn and the loop is parked on background
    /// work it started (a subagent still running, a monitor still watching).
    /// Nothing is being generated until a ping resumes the run, which the next
    /// `Step` marks. Lets a consumer say "watching" rather than "working".
    Parked,
    /// The client should replace its session history with `messages` before
    /// subsequent turns. Includes accepted prompt guidance in its original
    /// position, but not a pending block from an unsuccessful request. Also
    /// carries compacted history when the loop retries a context overflow.
    MessagesUpdated { messages: Vec<serde_json::Value> },
    /// The `ask` tool is waiting for structured interactive input. Carries the
    /// `ask_timeout_secs` deadline (seconds until the loop auto-selects the
    /// recommended option) as `timeout_secs`, or `None` when no timeout is
    /// configured. It travels on the event so a client can render a countdown
    /// without re-reading config: the same value both arms the loop's timer and
    /// drives the display, keeping the two in agreement.
    AskRequest {
        request_id: String,
        request: crate::core::agent::interaction::AskRequest,
        timeout_secs: Option<u64>,
    },
    /// An `ask` request the loop resolved without a user answer (it timed out
    /// and auto-selected). Tells a client showing the live prompt for
    /// `request_id` to dismiss it, since no `respond` from that client is
    /// coming. User-driven answers never emit this: the client clears its own
    /// prompt as it responds.
    AskResolved { request_id: String },
    /// The canonical todo list changed (tool mutation or user edit in the
    /// TUI). Carries the full resulting snapshot for reconstruction.
    TodoUpdate {
        list: crate::core::agent::todo::TodoList,
    },
    /// Token usage for a single upstream request, emitted as soon as that
    /// request completes rather than waiting for the run to finish.
    ///
    /// `Done` carries only the *last* request's usage, which is too late and
    /// too little for a live display: a turn that calls tools makes many
    /// requests, and a subagent never emits `Done` into the parent stream at
    /// all. Consumers accumulate these to show context pressure, output
    /// volume, and throughput while the work is still happening -- for the
    /// parent run and, via the [`Subagent`] bracket, for each child.
    TurnUsage {
        usage: Usage,
        /// The provider's id for the execution that produced this usage, when
        /// it reported one. This is the handle a per-request billing lookup is
        /// keyed by, so a consumer can ask what this one request actually
        /// cost rather than only what it estimates.
        ///
        /// A sibling of `usage` rather than a field inside it, because it is a
        /// billing handle and not a token count. Absent on the default upstream
        /// path, which cannot see the response headers (see
        /// [`crate::core::agent::correlation`]); that is a limitation to report,
        /// not a reason to synthesize one.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        execution_id: Option<String>,
    },
    /// Terminal success: the model returned a final (tool-free) completion.
    Done {
        stop_reason: String,
        usage: Option<Usage>,
    },
    /// Terminal failure (setup error, upstream/tool failure, or max_turns).
    Error { code: String, message: String },
    /// The loop needs the user to approve a gated tool call. The client replies via
    /// the `agent_permission_respond` command referencing `request_id`.
    PermissionRequest {
        request_id: String,
        tool_name: String,
        capability: String,
        path: Option<String>,
        /// The shell command for exec prompts (drives the command-scoped
        /// "allow always" grant); `None` for non-exec tools.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        command: Option<String>,
        /// Focused diff preview for `write`/`edit` prompts so the user sees the
        /// change before approving; `None` for other tools.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        diff: Option<String>,
        prompt_kind: String,
        offers_always: bool,
    },
}

/// A subagent in a not-yet-started phase of a phased dispatch: its name (unique
/// across the plan, and its blackboard file) and 1-based phase number. Carried by
/// [`StreamEvent::SubagentPlan`] so a consumer can show it waiting on the phase
/// before it.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct PendingSubagent {
    pub name: String,
    pub phase: u32,
}

/// If `path` targets a file in the agent's skill or memory workspace, return the
/// kind (`"skill"`/`"memory"`) and the item name (file stem). None otherwise.
fn classify_agent_path(path: &str) -> Option<(&'static str, String)> {
    let norm = path.replace('\\', "/");
    for (needle, kind) in [
        (".jan/agent/skills/", "skill"),
        (".jan/agent/memory/", "memory"),
    ] {
        if let Some(idx) = norm.find(needle) {
            let rest = &norm[idx + needle.len()..];
            if rest.is_empty() || rest.ends_with('/') {
                return Some((kind, String::new()));
            }
            let stem = std::path::Path::new(rest)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(rest);
            return Some((kind, stem.to_string()));
        }
    }
    None
}

/// Human-facing one-line status for a tool call. Reads/writes of skill or memory
/// files get a semantic label (e.g. "Reading skill: deploy", "Updating memory:
/// decisions") instead of the raw tool name + path. Everything else falls back
/// to `name` + compact args.
pub fn describe_tool_call(name: &str, args: &serde_json::Value) -> String {
    // Dedicated skill/memory tools are self-describing via their name + `name` arg.
    let dedicated = match name {
        "memory_list" => Some(("Reading", "memory", String::new())),
        "skill_list" => Some(("Reading", "skill", String::new())),
        "memory_read" => Some(("Reading", "memory", arg_name(args))),
        "memory_write" => Some(("Updating", "memory", arg_name(args))),
        "skill_read" => Some(("Reading", "skill", arg_name(args))),
        "skill_write" => Some(("Updating", "skill", arg_name(args))),
        _ => None,
    };
    // Fallback: generic read/write/edit hitting the workspace by path.
    let labelled = dedicated.or_else(|| {
        args.get("path")
            .and_then(|v| v.as_str())
            .and_then(classify_agent_path)
            .map(|(kind, item)| {
                let verb = if matches!(name, "write" | "edit") {
                    "Updating"
                } else {
                    "Reading"
                };
                (verb, kind, item)
            })
    });
    if let Some((verb, kind, item)) = labelled {
        return if item.is_empty() {
            let plural = if kind == "memory" { "memory notes" } else { "skills" };
            format!("{verb} {plural}")
        } else {
            format!("{verb} {kind}: {item}")
        };
    }
    format!("{name} {args}")
}

fn arg_name(args: &serde_json::Value) -> String {
    args.get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().trim_end_matches(".md").to_string())
        .unwrap_or_default()
}

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct Usage {
    pub prompt_tokens: Option<u64>,
    pub completion_tokens: Option<u64>,
    pub total_tokens: Option<u64>,
    /// Prompt tokens served from the provider's prompt cache (a read/hit).
    /// OpenAI reports it under `prompt_tokens_details.cached_tokens`; Anthropic
    /// under `cache_read_input_tokens`. A thrashing cache shows here as a low
    /// value against a high `prompt_tokens`.
    pub cached_tokens: Option<u64>,
    /// Prompt tokens written into the provider cache this request (a write).
    /// Only Anthropic bills this separately (`cache_creation_input_tokens`);
    /// absent for providers that do not distinguish reads from writes.
    pub cache_write_tokens: Option<u64>,
}

impl Usage {
    pub(crate) fn from_completion(completion: &serde_json::Value) -> Option<Self> {
        let usage = completion.get("usage")?;
        let cached_tokens = usage
            .get("prompt_tokens_details")
            .and_then(|d| d.get("cached_tokens"))
            .and_then(|v| v.as_u64())
            .or_else(|| usage.get("cache_read_input_tokens").and_then(|v| v.as_u64()));
        let cache_write_tokens = usage
            .get("cache_creation_input_tokens")
            .and_then(|v| v.as_u64())
            .or_else(|| {
                usage
                    .get("prompt_tokens_details")
                    .and_then(|d| d.get("cache_creation_tokens"))
                    .and_then(|v| v.as_u64())
            });
        Some(Self {
            prompt_tokens: usage.get("prompt_tokens").and_then(|v| v.as_u64()),
            completion_tokens: usage.get("completion_tokens").and_then(|v| v.as_u64()),
            total_tokens: usage.get("total_tokens").and_then(|v| v.as_u64()),
            cached_tokens,
            cache_write_tokens,
        })
    }
}

/// Test-only, and reachable from the sibling test in `core::cli::run_report`
/// that checks the documented tag list against these variants: the table has to
/// live with the enum it enumerates, but the contract it defends is the one the
/// CLI channel documents.
#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::core::agent::interaction::{AskRequest, OptionItem, Question};
    use crate::core::agent::todo::{TodoItem, TodoList, TodoPhase, TodoStatus};
    use serde_json::json;

    /// One instance of every variant, paired with the variant's name as the
    /// enum spells it. The tag is read from serde when this list is serialized,
    /// so a variant's tag is never restated here -- only its coverage is.
    ///
    /// [`every_variant_is_sampled`] is what keeps this list honest: it matches
    /// every variant with no wildcard arm, so adding one to `StreamEvent` fails
    /// the build until it is added here too.
    pub(crate) fn sample_events() -> Vec<(&'static str, StreamEvent)> {
        vec![
            ("Token", StreamEvent::Token { text: "hi".into() }),
            ("Reasoning", StreamEvent::Reasoning { text: "hmm".into() }),
            ("Step", StreamEvent::Step { index: 1, max: 0 }),
            (
                "ToolCallStarted",
                StreamEvent::ToolCallStarted {
                    id: "t1".into(),
                    name: "read".into(),
                },
            ),
            (
                "ToolCallArgsDelta",
                StreamEvent::ToolCallArgsDelta {
                    id: "t1".into(),
                    delta: "{\"pa".into(),
                },
            ),
            (
                "ToolCall",
                StreamEvent::ToolCall {
                    id: "t1".into(),
                    name: "read".into(),
                    args: json!({ "path": "a.txt" }),
                },
            ),
            (
                "ToolOutputDelta",
                StreamEvent::ToolOutputDelta {
                    id: "t1".into(),
                    delta: "line\n".into(),
                },
            ),
            (
                "ToolResult",
                StreamEvent::ToolResult {
                    id: "t1".into(),
                    content: "ok".into(),
                    is_error: false,
                    diff: Some("-a\n+b\n".into()),
                },
            ),
            (
                "SubagentStart",
                StreamEvent::SubagentStart {
                    run_id: "r1".into(),
                    name: "scout".into(),
                    task: Some("look".into()),
                },
            ),
            (
                "SubagentQueued",
                StreamEvent::SubagentQueued {
                    run_id: "r1".into(),
                    name: "scout".into(),
                    task: None,
                    waiting: 2,
                },
            ),
            (
                "SubagentEnd",
                StreamEvent::SubagentEnd {
                    run_id: "r1".into(),
                    name: "scout".into(),
                    error: Some("boom".into()),
                },
            ),
            (
                "SubagentPlan",
                StreamEvent::SubagentPlan {
                    pending: vec![PendingSubagent {
                        name: "scout".into(),
                        phase: 2,
                    }],
                },
            ),
            (
                "Subagent",
                StreamEvent::Subagent {
                    run_id: "r1".into(),
                    name: "scout".into(),
                    event: Box::new(StreamEvent::Token { text: "hi".into() }),
                },
            ),
            (
                "Notice",
                StreamEvent::Notice {
                    text: "monitor matched".into(),
                },
            ),
            (
                "Monitors",
                StreamEvent::Monitors {
                    monitors: vec![tauri_plugin_agent_tools::tools::monitor::MonitorSnapshot {
                        monitor_id: "m1".into(),
                        name: "ci".into(),
                        script: "true".into(),
                        polls: 3,
                    }],
                },
            ),
            ("Parked", StreamEvent::Parked),
            (
                "MessagesUpdated",
                StreamEvent::MessagesUpdated {
                    messages: vec![json!({ "role": "user", "content": "hi" })],
                },
            ),
            (
                "AskRequest",
                StreamEvent::AskRequest {
                    request_id: "ask-1".into(),
                    request: AskRequest {
                        questions: vec![Question {
                            id: "q1".into(),
                            question: "which?".into(),
                            options: vec![OptionItem {
                                label: "a".into(),
                                description: None,
                            }],
                            multi: false,
                            recommended: Some(0),
                        }],
                    },
                    timeout_secs: Some(30),
                },
            ),
            (
                "AskResolved",
                StreamEvent::AskResolved {
                    request_id: "ask-1".into(),
                },
            ),
            (
                "TodoUpdate",
                StreamEvent::TodoUpdate {
                    list: TodoList {
                        phases: vec![TodoPhase {
                            name: "Implement".into(),
                            tasks: vec![TodoItem {
                                content: "wire the record".into(),
                                status: TodoStatus::InProgress,
                            }],
                        }],
                    },
                },
            ),
            (
                "TurnUsage",
                StreamEvent::TurnUsage {
                    usage: Usage {
                        prompt_tokens: Some(120),
                        completion_tokens: Some(8),
                        total_tokens: Some(128),
                        cached_tokens: Some(64),
                        cache_write_tokens: None,
                    },
                    execution_id: None,
                },
            ),
            (
                "Done",
                StreamEvent::Done {
                    stop_reason: "stop".into(),
                    usage: None,
                },
            ),
            (
                "Error",
                StreamEvent::Error {
                    code: "upstream_error".into(),
                    message: "boom".into(),
                },
            ),
            (
                "PermissionRequest",
                StreamEvent::PermissionRequest {
                    request_id: "perm-1".into(),
                    tool_name: "bash".into(),
                    capability: "exec".into(),
                    path: None,
                    command: Some("ls".into()),
                    diff: None,
                    prompt_kind: "exec".into(),
                    offers_always: true,
                },
            ),
        ]
    }

    /// Exhaustive on purpose: a variant added to `StreamEvent` stops this
    /// matching, and the error names the arm that is missing, which is the
    /// prompt to add it to [`sample_events`] as well.
    #[allow(dead_code)]
    fn every_variant_is_sampled(ev: &StreamEvent) {
        match ev {
            StreamEvent::Token { .. }
            | StreamEvent::Reasoning { .. }
            | StreamEvent::Step { .. }
            | StreamEvent::ToolCallStarted { .. }
            | StreamEvent::ToolCallArgsDelta { .. }
            | StreamEvent::ToolCall { .. }
            | StreamEvent::ToolOutputDelta { .. }
            | StreamEvent::ToolResult { .. }
            | StreamEvent::SubagentStart { .. }
            | StreamEvent::SubagentQueued { .. }
            | StreamEvent::SubagentEnd { .. }
            | StreamEvent::SubagentPlan { .. }
            | StreamEvent::Subagent { .. }
            | StreamEvent::Notice { .. }
            | StreamEvent::Monitors { .. }
            | StreamEvent::Parked
            | StreamEvent::MessagesUpdated { .. }
            | StreamEvent::AskRequest { .. }
            | StreamEvent::AskResolved { .. }
            | StreamEvent::TodoUpdate { .. }
            | StreamEvent::TurnUsage { .. }
            | StreamEvent::Done { .. }
            | StreamEvent::Error { .. }
            | StreamEvent::PermissionRequest { .. } => {}
        }
    }

    /// A consumer validates what it receives against these shapes, so every
    /// variant has to survive a write/read pair unchanged -- optional fields
    /// included, since a `skip_serializing_if` field that cannot be read back is
    /// how a consumer ends up with a struct it cannot deserialize at all.
    #[test]
    fn every_variant_round_trips_through_the_wire() {
        let samples = sample_events();
        assert!(samples.len() >= 24, "{} variants sampled", samples.len());
        for (name, ev) in samples {
            let line = serde_json::to_string(&ev).expect(name);
            let back: StreamEvent = serde_json::from_str(&line)
                .unwrap_or_else(|e| panic!("{name} does not read back: {e}\n{line}"));
            assert_eq!(
                serde_json::to_value(&back).unwrap(),
                serde_json::to_value(&ev).unwrap(),
                "{name} changed across a round trip"
            );
        }
    }

    /// `sample_events` pairs each instance with its variant name, and this is
    /// what makes the pairing meaningful: the names it uses are the ones the
    /// enum declares, and no two variants share a tag.
    #[test]
    fn sampled_names_are_distinct_and_match_their_tags() {
        let mut names: Vec<&str> = sample_events().iter().map(|(name, _)| *name).collect();
        let total = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), total, "a variant is sampled twice");

        let mut tags: Vec<String> = sample_events()
            .iter()
            .map(|(name, ev)| {
                serde_json::to_value(ev).unwrap()["type"]
                    .as_str()
                    .unwrap_or_else(|| panic!("{name} has no tag"))
                    .to_string()
            })
            .collect();
        let total = tags.len();
        tags.sort();
        tags.dedup();
        assert_eq!(tags.len(), total, "two variants share one tag");
    }

    #[test]
    fn token_serializes_with_snake_case_tag() {
        let v = serde_json::to_value(StreamEvent::Token { text: "hi".into() }).unwrap();
        assert_eq!(v, json!({ "type": "token", "text": "hi" }));
    }

    #[test]
    fn reasoning_serializes_with_snake_case_tag() {
        let v = serde_json::to_value(StreamEvent::Reasoning { text: "hmm".into() }).unwrap();
        assert_eq!(v, json!({ "type": "reasoning", "text": "hmm" }));
    }

    #[test]
    fn step_serializes_with_snake_case_tag() {
        let v = serde_json::to_value(StreamEvent::Step { index: 1, max: 8 }).unwrap();
        assert_eq!(v, json!({ "type": "step", "index": 1, "max": 8 }));
    }

    #[test]
    fn describe_labels_dedicated_skill_and_memory_tools() {
        assert_eq!(
            describe_tool_call("memory_write", &json!({"name": "decisions"})),
            "Updating memory: decisions"
        );
        assert_eq!(
            describe_tool_call("memory_read", &json!({"name": "drift.md"})),
            "Reading memory: drift"
        );
        assert_eq!(
            describe_tool_call("skill_write", &json!({"name": "deploy"})),
            "Updating skill: deploy"
        );
        assert_eq!(
            describe_tool_call("memory_list", &json!({})),
            "Reading memory notes"
        );
        assert_eq!(describe_tool_call("skill_list", &json!({})), "Reading skills");
    }

    #[test]
    fn describe_labels_fallback_path_ops() {
        assert_eq!(
            describe_tool_call("read", &json!({"path": ".jan/agent/skills/deploy.md"})),
            "Reading skill: deploy"
        );
        assert_eq!(
            describe_tool_call("write", &json!({"path": ".jan/agent/memory/decisions.md"})),
            "Updating memory: decisions"
        );
    }

    #[test]
    fn describe_falls_back_for_non_workspace_calls() {
        assert_eq!(
            describe_tool_call("read", &json!({"path": "src/main.rs"})),
            "read {\"path\":\"src/main.rs\"}"
        );
        assert_eq!(
            describe_tool_call("search", &json!({"q": "rust"})),
            "search {\"q\":\"rust\"}"
        );
    }

    #[test]
    fn tool_call_started_serializes_to_wire_shape() {
        let v = serde_json::to_value(StreamEvent::ToolCallStarted {
            id: "c1".into(),
            name: "write".into(),
        })
        .unwrap();
        assert_eq!(
            v,
            json!({ "type": "tool_call_started", "id": "c1", "name": "write" })
        );
    }

    #[test]
    fn tool_call_and_result_serialize_to_wire_shape() {
        let call = serde_json::to_value(StreamEvent::ToolCall {
            id: "c1".into(),
            name: "search".into(),
            args: json!({ "q": "rust" }),
        })
        .unwrap();
        assert_eq!(
            call,
            json!({ "type": "tool_call", "id": "c1", "name": "search", "args": { "q": "rust" } })
        );

        let result = serde_json::to_value(StreamEvent::ToolResult {
            id: "c1".into(),
            content: "ok".into(),
            is_error: false,
            diff: None,
        })
        .unwrap();
        assert_eq!(
            result,
            json!({ "type": "tool_result", "id": "c1", "content": "ok", "is_error": false })
        );
    }

    #[test]
    fn done_and_error_serialize_to_wire_shape() {
        let done = serde_json::to_value(StreamEvent::Done {
            stop_reason: "stop".into(),
            usage: None,
        })
        .unwrap();
        assert_eq!(
            done,
            json!({ "type": "done", "stop_reason": "stop", "usage": null })
        );

        let err = serde_json::to_value(StreamEvent::Error {
            code: "error".into(),
            message: "boom".into(),
        })
        .unwrap();
        assert_eq!(
            err,
            json!({ "type": "error", "code": "error", "message": "boom" })
        );
    }

    #[test]
    fn permission_request_serializes_to_wire_shape() {
        let v = serde_json::to_value(StreamEvent::PermissionRequest {
            request_id: "perm-1".into(),
            tool_name: "write".into(),
            capability: "write".into(),
            path: Some("out.txt".into()),
            command: None,
            diff: Some("@@ created file @@\n+ hi".into()),
            prompt_kind: "write".into(),
            offers_always: true,
        })
        .unwrap();
        assert_eq!(
            v,
            json!({
                "type": "permission_request",
                "request_id": "perm-1",
                "tool_name": "write",
                "capability": "write",
                "path": "out.txt",
                "diff": "@@ created file @@\n+ hi",
                "prompt_kind": "write",
                "offers_always": true
            })
        );
    }

    #[test]
    fn subagent_bracket_events_serialize_to_wire_shape() {
        let start = serde_json::to_value(StreamEvent::SubagentStart {
            run_id: "sub-1".into(),
            name: "rust-reviewer".into(),
            task: None,
        })
        .unwrap();
        assert_eq!(
            start,
            json!({ "type": "subagent_start", "run_id": "sub-1", "name": "rust-reviewer" })
        );
        let queued = serde_json::to_value(StreamEvent::SubagentQueued {
            run_id: "sub-2".into(),
            name: "rust-reviewer".into(),
            task: None,
            waiting: 2,
        })
        .unwrap();
        assert_eq!(
            queued,
            json!({
                "type": "subagent_queued",
                "run_id": "sub-2",
                "name": "rust-reviewer",
                "waiting": 2
            })
        );
        let end = serde_json::to_value(StreamEvent::SubagentEnd {
            run_id: "sub-1".into(),
            name: "rust-reviewer".into(),
            error: None,
        })
        .unwrap();
        assert_eq!(
            end,
            json!({ "type": "subagent_end", "run_id": "sub-1", "name": "rust-reviewer" })
        );
    }

    #[test]
    fn wrapped_subagent_event_nests_inner_event() {
        let v = serde_json::to_value(StreamEvent::Subagent {
            run_id: "sub-1".into(),
            name: "reviewer".into(),
            event: Box::new(StreamEvent::Token { text: "hi".into() }),
        })
        .unwrap();
        assert_eq!(
            v,
            json!({
                "type": "subagent",
                "run_id": "sub-1",
                "name": "reviewer",
                "event": { "type": "token", "text": "hi" }
            })
        );
    }

    #[test]
    fn usage_parses_present_fields_and_none_when_absent() {
        let parsed = Usage::from_completion(&json!({
            "usage": { "prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15 }
        }))
        .unwrap();
        assert_eq!(parsed.prompt_tokens, Some(10));
        assert_eq!(parsed.completion_tokens, Some(5));
        assert_eq!(parsed.total_tokens, Some(15));

        assert!(Usage::from_completion(&json!({ "choices": [] })).is_none());
    }

    #[test]
    fn usage_parses_openai_cached_tokens() {
        let parsed = Usage::from_completion(&json!({
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 5,
                "total_tokens": 105,
                "prompt_tokens_details": { "cached_tokens": 80 }
            }
        }))
        .unwrap();
        assert_eq!(parsed.cached_tokens, Some(80));
        assert_eq!(parsed.cache_write_tokens, None);
    }

    #[test]
    fn usage_parses_anthropic_cache_read_and_write() {
        let parsed = Usage::from_completion(&json!({
            "usage": {
                "prompt_tokens": 100,
                "cache_read_input_tokens": 60,
                "cache_creation_input_tokens": 40
            }
        }))
        .unwrap();
        assert_eq!(parsed.cached_tokens, Some(60));
        assert_eq!(parsed.cache_write_tokens, Some(40));
    }

    #[test]
    fn usage_parses_nested_cache_creation_tokens() {
        let parsed = Usage::from_completion(&json!({
            "usage": {
                "prompt_tokens": 100,
                "prompt_tokens_details": { "cached_tokens": 60, "cache_creation_tokens": 40 }
            }
        }))
        .unwrap();
        assert_eq!(parsed.cached_tokens, Some(60));
        assert_eq!(parsed.cache_write_tokens, Some(40));
    }

    #[test]
    fn usage_cache_fields_none_when_absent() {
        let parsed = Usage::from_completion(&json!({
            "usage": { "prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15 }
        }))
        .unwrap();
        assert_eq!(parsed.cached_tokens, None);
        assert_eq!(parsed.cache_write_tokens, None);
    }
}
