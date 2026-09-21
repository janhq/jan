//! Byte-level prefix-stability tests: the regression suite for epic #8956.
//!
//! Every failure in that epic was the same failure - two consecutive requests
//! that should share a prefix, and did not - so that is what this suite
//! measures. Each test assembles whole requests the way a run does (the
//! composed prompt through its placement policy, the per-turn block behind it,
//! the conversation after that, the tool array in front) and compares
//! *serialized bytes*, because those are what a provider caches. Comparing
//! `Value`s instead would miss key order and whitespace, which are part of the
//! prefix a provider matches on.
//!
//! A failing assertion reports the offset where two bodies diverge and a window
//! around it. With request bodies in the hundreds of kilobytes, the offset is
//! usually enough to name the culprit without attaching a debugger.
//!
//! These are plain unit tests, so the `cargo test (cli)` job in
//! `rust-check.yml` runs them on every PR into `main`: a change to the loop, the
//! composers, or the tool collection cannot land a prefix regression unnoticed.
//!
//! What they drive is the real production code for each contributor to the
//! prefix - `compose_system_prompt` and the placement policy, the two helpers
//! that place the stable prompt and marked tail guidance, `build_completion_request`,
//! and the tool-array assembly and reuse. The one thing not driven here is the
//! *order* in which `orchestrate_inner` calls those pieces, which is inline in
//! that function and only reachable with a live upstream. When that assembly is
//! extracted into a callable step, [`turn`] should call it instead of mirroring
//! it, and every assertion below keeps its meaning.
//!
//! Each test says what it protects, and names the epic item behind it where
//! there is one.

use super::compaction::compact_conversation;
use super::context::compose_system_prompt;
use super::events::StreamEvent;
use super::prompt::{Composer, Placement, PromptPolicy};
use super::r#loop::{build_completion_request, ModelInvoker};
use super::upstream::{
    append_prompt_tail, assemble_tool_array, reuse_last_good_listings, set_system_prompt,
    RenderedTool,
};
use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use tokio::sync::mpsc;

// What the tool-array test needs. `context_advertised_tools` is the CLI's
// entry point to the loop's advertisement path - only the TUI calls it - so the
// config that compiles the helper is the config that runs this test.
#[cfg(feature = "cli")]
use {
    super::r#loop::context_advertised_tools, crate::core::agent::plan::RunMode,
    crate::core::mcp::models::McpSettings, crate::core::state::SharedMcpServers, std::sync::Arc,
    tauri_plugin_agent_tools::permissions::ToolPermissions, tokio::sync::Mutex,
};

/// A date fixed by the test. Every assertion here is about bytes, and a test
/// that reads the clock would be testing the clock.
const DAY: &str = "2026-09-16";

/// How much of the conversation a compaction keeps.
const KEEP_RECENT: usize = 4;

// ---------------------------------------------------------------------------
// Comparing request bytes
// ---------------------------------------------------------------------------

/// Bytes two requests share, from offset 0.
fn common_prefix_len(before: &str, after: &str) -> usize {
    before
        .bytes()
        .zip(after.bytes())
        .take_while(|(a, b)| a == b)
        .count()
}

/// `radius` bytes either side of `center`, on char boundaries, so a failure
/// message can show the divergence instead of only counting to it.
fn window(text: &str, center: usize, radius: usize) -> String {
    let boundary = |mut index: usize| {
        index = index.min(text.len());
        while !text.is_char_boundary(index) {
            index -= 1;
        }
        index
    };
    format!(
        "`{}`",
        &text[boundary(center.saturating_sub(radius))..boundary(center + radius)]
    )
}

/// Assert `after` keeps at least the first `boundary` bytes of `before`.
///
/// `boundary` is the offset a provider could have cached: everything through
/// the previous request's last message. Bytes after it are new conversation and
/// are expected to differ.
fn assert_prefix_kept(what: &str, before: &str, after: &str, boundary: usize) {
    let shared = common_prefix_len(before, after);
    assert!(
        shared >= boundary,
        "{what}: the first {boundary} bytes should have been shared, but the bodies diverge at byte {shared}\n\
         before {}\n  after {}",
        window(before, shared, 60),
        window(after, shared, 60),
    );
}

/// Assert two bodies are byte-identical, reporting where they diverge.
///
/// The sibling of [`assert_prefix_kept`] for the cases where every byte has to
/// match: a restart, a project move, a failed listing. `assert_eq!` on two
/// bodies would print both of them - tens of kilobytes each - instead of the one
/// offset that matters.
fn assert_same_bytes(what: &str, before: &str, after: &str) {
    let shared = common_prefix_len(before, after);
    assert!(
        shared == before.len() && before.len() == after.len(),
        "{what}: the bodies diverge at byte {shared} ({} bytes before, {} after)\n  first  {}\n  second {}",
        before.len(),
        after.len(),
        window(before, shared, 60),
        window(after, shared, 60),
    );
}

/// One turn's request: the body as it goes on the wire, and the messages it was
/// built from, so a caller can point at the offset where the next turn is
/// allowed to diverge.
struct Request {
    messages: Vec<Value>,
    body: String,
}

impl Request {
    /// End of the last message, i.e. the offset a provider can reuse next turn.
    fn last_message_end(&self) -> usize {
        let last = serde_json::to_string(self.messages.last().expect("a request has messages"))
            .expect("a message serializes");
        // The last occurrence: a repeated message would otherwise point at the
        // earlier copy and weaken the assertion.
        self.body
            .rfind(&last)
            .expect("the last message is in the body")
            + last.len()
    }

    /// Assert this turn's bytes survive into the next one.
    fn assert_extended_by(&self, what: &str, next: &Request) {
        assert_prefix_kept(what, &self.body, &next.body, self.last_message_end());
    }

    /// The `tools` array of the body, as bytes.
    #[cfg(feature = "cli")]
    fn tools_section(&self) -> String {
        let body: Value = serde_json::from_str(&self.body).expect("the body is JSON");
        serde_json::to_string(body.get("tools").expect("the request advertises tools"))
            .expect("the tools array serializes")
    }
}

// ---------------------------------------------------------------------------
// The fixture and the request builder
// ---------------------------------------------------------------------------

/// A project with something for every composer to say, so the composed prompt
/// is representative rather than minimal: a prefix made of one block would not
/// catch a block that moved.
struct Project {
    root: PathBuf,
}

impl Project {
    fn new(tag: &str) -> Self {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let root = std::env::temp_dir().join(format!(
            "jan_prefix_stability_{tag}_{}",
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".jan/agent/skills")).unwrap();
        std::fs::create_dir_all(root.join(".jan/agent/memory")).unwrap();
        std::fs::write(
            root.join("JAN.md"),
            "# Project\n\nPrefix-stability fixture.\n",
        )
        .unwrap();
        std::fs::write(
            root.join(".jan/agent/skills/example.md"),
            "---\nname: example\ndescription: An example skill\n---\n\nSkill body.\n",
        )
        .unwrap();
        std::fs::write(
            root.join(".jan/agent/memory/note.md"),
            "A durable fact about the fixture project.\n\nLonger detail.\n",
        )
        .unwrap();
        Self { root }
    }

    fn root(&self) -> &Path {
        &self.root
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// A tool as the advertised array carries it.
fn tool(name: &str) -> RenderedTool {
    (
        name.to_string(),
        json!({
            "type": "function",
            "function": {
                "name": name,
                "description": format!("the {name} tool"),
                "parameters": { "type": "object", "properties": {} }
            }
        }),
    )
}

/// The advertised array for a set of tool names: what a provider sees in front
/// of the request, with the per-server grouping already flattened away.
fn advertised(names: &[&str]) -> Vec<Value> {
    names.iter().map(|name| tool(name).1).collect()
}

/// One turn's request, assembled the way `orchestrate_inner` assembles one: the
/// composed prompt at the front, then accepted history, then the policy's tail
/// blocks plus the per-turn blocks merged in registry order.
///
/// The per-turn blocks are the date and a fixed git line - the two the loop
/// always has - rather than the memory/plan/todo blocks, which depend on
/// session state this suite does not drive. What the assertions here need is
/// the *shape*: one marked guidance message after the conversation.
fn turn(project: &Path, history: &[Value], date: &str, tools: &[Value]) -> Request {
    let composed =
        compose_system_prompt(None, project, None, false, &PromptPolicy::default()).unwrap();
    let mut tail = composed.tail;
    tail.push((Composer::Date, format!("Today's date is {date}.")));
    tail.push((
        Composer::GitState,
        "# Git\n\nGit: not a git repository (or no commits yet)".to_string(),
    ));
    tail.sort_by_key(|(composer, _)| composer.order());
    let volatile = tail
        .iter()
        .map(|(_, block)| block.as_str())
        .collect::<Vec<_>>()
        .join("\n\n");

    let mut messages = history.to_vec();
    set_system_prompt(&mut messages, &composed.prefix);
    append_prompt_tail(&mut messages, &volatile);

    let body = serde_json::to_string(&build_completion_request(
        "test-model",
        &messages,
        tools,
        &json!({}),
        None,
    ))
    .expect("the request serializes");

    Request { messages, body }
}

/// The tool array as the loop advertises it for a project: the real path - the
/// MCP listings, the capability gate, then the local tools.
#[cfg(feature = "cli")]
async fn advertise(project: &Path) -> Vec<Value> {
    let servers: SharedMcpServers = Default::default();
    let settings = Arc::new(Mutex::new(McpSettings::default()));
    let permissions = ToolPermissions::default();
    let tools = context_advertised_tools(
        &servers,
        &settings,
        &permissions,
        Some(project),
        RunMode::Normal,
        false,
        4,
        false,
        true,
    )
    .await;
    // An empty array would make every array comparison below vacuous.
    assert!(
        tools.len() >= 10,
        "the fixture advertises {} tools",
        tools.len()
    );
    tools
}

/// A model that returns a fixed summary, so the compaction path can run
/// without an upstream: the shape of the array it leaves behind is what the
/// turn after it has to keep its prefix across.
struct StubSummarizer;

#[async_trait]
impl ModelInvoker for StubSummarizer {
    async fn invoke(
        &self,
        _request: &Value,
        _events: &mpsc::UnboundedSender<StreamEvent>,
    ) -> Result<Value, String> {
        Ok(json!({ "choices": [{ "message": { "content": "The story so far." } }] }))
    }
}

/// One real compaction: the array `orchestrate_inner` would hand the next turn.
async fn compacted(history: &[Value]) -> Vec<Value> {
    compact_conversation(history, "test-model", &StubSummarizer, KEEP_RECENT)
        .await
        .expect("the stub summarizer always answers")
}

/// A user turn with a given text.
fn user(text: &str) -> Value {
    json!({ "role": "user", "content": text })
}

/// An assistant turn with a given text.
fn assistant(text: &str) -> Value {
    json!({ "role": "assistant", "content": text })
}

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

/// #8957, #8958: the stable prompt is the head of every request, so turn two
/// has to start with everything turn one sent.
#[test]
fn consecutive_turns_extend_the_previous_request() {
    let project = Project::new("turns");
    let tools = advertised(&["read_file"]);

    let first = turn(project.root(), &[user("first question")], DAY, &tools);
    let mut history = first.messages.clone();
    history.push(assistant("first answer"));
    history.push(user("second question"));
    let second = turn(project.root(), &history, DAY, &tools);

    first.assert_extended_by("an unchanged project on the next turn", &second);
}

/// The fixture is only worth what it exercises: if a composer stops finding any
/// content here, the assertions in this module quietly stop covering it. Every
/// block below is one the default policy puts above the cache line.
#[test]
fn the_fixture_reaches_every_prefix_composer() {
    let project = Project::new("fixture");
    let request = turn(
        project.root(),
        &[user("a question")],
        DAY,
        &advertised(&["read_file"]),
    );

    let stable = request.messages[0]["content"]
        .as_str()
        .expect("message 0 is the stable prompt");
    for block in [
        "# Guidelines",
        "# Working Directory",
        "# Runtime Environment",
        "# Skills and Project Memory",
        "# Web Access",
        "<project_context>",
        "# Available Skills",
        "## Skill: example",
        "# Available Memories",
        "- `note` - A durable fact about the fixture project.",
    ] {
        assert!(
            stable.contains(block),
            "the fixture no longer exercises {block:?}"
        );
    }
}

/// #8959, one level up: the same input composed twice has to produce the same
/// bytes. Nothing above the cache line may be read out of a container whose
/// iteration order is not part of the configuration - that is what made the MCP
/// tool array unstable across process restarts, and the same mistake is
/// available to any composer.
#[test]
fn composing_the_same_input_twice_produces_the_same_bytes() {
    let project = Project::new("determinism");
    let tools = advertised(&["read_file", "commit"]);
    let history = [user("a question"), assistant("an answer")];

    let first = turn(project.root(), &history, DAY, &tools);
    let second = turn(project.root(), &history, DAY, &tools);

    assert_same_bytes(
        "the same input must compose the same bytes",
        &first.body,
        &second.body,
    );
}

/// #8958: the date changes once a day. It belongs below the cache line, so a
/// session that runs over midnight keeps its prefix and diverges inside the
/// volatile block instead of at the top of the prompt.
#[test]
fn a_midnight_crossing_diverges_inside_the_volatile_block() {
    let project = Project::new("midnight");
    let tools = advertised(&["read_file"]);

    let before = turn(project.root(), &[], "2026-09-16", &tools);
    let after = turn(project.root(), &[], "2026-09-17", &tools);

    // Every byte of the stable prompt (message 0) has to survive the date
    // change; if this fails, a varying block is sitting above the cache line.
    let stable = serde_json::to_string(&before.messages[0]).unwrap();
    let stable_end = before
        .body
        .find(&stable)
        .expect("the stable prompt is in the body")
        + stable.len();
    assert_prefix_kept(
        "the turn after midnight",
        &before.body,
        &after.body,
        stable_end,
    );

    // And the divergence is *inside* the volatile block: something in it
    // changed, rather than the block's arrival or departure moving the prompt.
    let volatile = serde_json::to_string(&before.messages[1]).unwrap();
    let volatile_start = before
        .body
        .find(&volatile)
        .expect("the volatile block is in the body");
    let shared = common_prefix_len(&before.body, &after.body);
    assert!(
        shared > volatile_start && shared <= volatile_start + volatile.len(),
        "the shared prefix ends at byte {shared}, outside the volatile block at {volatile_start}..{}: \
         a block above the cache line is varying",
        volatile_start + volatile.len(),
    );
}

#[test]
fn a_changing_tail_preserves_all_accepted_history() {
    let project = Project::new("tail-history");
    let tools = advertised(&["read_file"]);
    let first = turn(
        project.root(),
        &[user("first question")],
        "2026-09-20",
        &tools,
    );
    let mut history = first.messages.clone();
    history.push(assistant("first answer"));
    history.push(user("second question"));

    let second = turn(project.root(), &history, "2026-09-21", &tools);
    first.assert_extended_by("changed context belongs after accepted history", &second);
}

/// #8959: the tool array sits at the front of the request, so it has to be a
/// function of configuration alone. Moving a project changes the prompt - the
/// working directory names it - but must not move the tools in front of it.
#[cfg(feature = "cli")]
#[tokio::test]
async fn a_project_move_does_not_move_the_tool_array() {
    let first = Project::new("move-a");
    let second = Project::new("move-b");

    let before = turn(first.root(), &[], DAY, &advertise(first.root()).await);
    let after = turn(second.root(), &[], DAY, &advertise(second.root()).await);

    assert_same_bytes(
        "the advertised tools must not depend on where the project lives",
        &before.tools_section(),
        &after.tools_section(),
    );
    // The prompt legitimately differs: that difference is in the prompt, not in
    // the array in front of it.
    assert_ne!(before.body, after.body);
}

/// #8959: the advertised bytes have to be a function of the listings' contents,
/// not of the order they were walked in. The listings arrive from a map whose
/// iteration order is seeded per instance, which is what a process restart hands
/// it, and one server's own listing order is the server's business, not ours.
#[test]
fn a_restart_advertises_the_same_tool_bytes() {
    let project = Project::new("restart");
    let git = || vec![tool("commit"), tool("status")];
    let fs = || vec![tool("read_file")];

    let walks = [
        vec![("git".to_string(), git()), ("fs".to_string(), fs())],
        vec![("fs".to_string(), fs()), ("git".to_string(), git())],
        vec![
            ("git".to_string(), vec![tool("status"), tool("commit")]),
            ("fs".to_string(), fs()),
        ],
        vec![
            ("fs".to_string(), fs()),
            ("git".to_string(), vec![tool("status"), tool("commit")]),
        ],
    ];

    let mut bodies: Vec<String> = Vec::new();
    let mut mappings: Vec<HashMap<String, String>> = Vec::new();
    for walk in walks {
        let (tools, mapping) = assemble_tool_array(walk);
        bodies.push(turn(project.root(), &[], DAY, &tools).body);
        mappings.push(mapping);
    }

    // Three tools, so equality between these bodies is not the equality of
    // emptiness: a reordered array moves bytes in the request prefix.
    assert_eq!(mappings[0].len(), 3, "the fixture advertises three tools");
    for (index, body) in bodies.iter().enumerate().skip(1) {
        assert_same_bytes(
            &format!("walk order {index} advertised different bytes"),
            &bodies[0],
            body,
        );
    }
    assert!(
        mappings.iter().all(|mapping| *mapping == mappings[0]),
        "the tool -> server mapping has to follow the array"
    );
}

/// #8959: a listing that times out must not change the advertised array. The
/// server reuses its last known tools instead of vanishing, which would pay a
/// cold cache on that turn and again on the turn it came back.
#[test]
fn a_failed_listing_keeps_the_advertised_tools() {
    let project = Project::new("listing-failure");
    let mut cache = HashMap::new();

    let listed = vec![("git".to_string(), Some(vec![tool("commit")]))];
    let warm = reuse_last_good_listings(&mut cache, listed);
    let (warm_tools, _) = assemble_tool_array(warm);
    let before = turn(project.root(), &[], DAY, &warm_tools);

    let timed_out = reuse_last_good_listings(&mut cache, vec![("git".to_string(), None)]);
    let (reused_tools, _) = assemble_tool_array(timed_out);
    let after = turn(project.root(), &[], DAY, &reused_tools);

    assert_same_bytes(
        "a timed-out listing must not change the advertised array",
        &before.body,
        &after.body,
    );

    // A server that has never listed successfully has nothing to reuse, so a
    // first-run failure still omits it rather than advertising a guess.
    let never_listed = reuse_last_good_listings(&mut cache, vec![("new".to_string(), None)]);
    assert!(never_listed.is_empty());
}

/// #8957, #8958: compaction rewrites the middle of the conversation, so exactly
/// one turn cannot extend its predecessor - the one after the summary lands.
/// Every other turn has to.
#[tokio::test]
async fn compaction_breaks_the_prefix_exactly_once() {
    let project = Project::new("compaction");
    let tools = advertised(&["read_file"]);
    let mut history: Vec<Value> = Vec::new();
    let mut previous: Option<Request> = None;
    let mut breaks = 0;

    for index in 0..6 {
        history.push(user(&format!("question {index}")));
        let request = turn(project.root(), &history, DAY, &tools);
        if let Some(previous) = &previous {
            if common_prefix_len(&previous.body, &request.body) < previous.last_message_end() {
                breaks += 1;
            }
        }
        history = request.messages.clone();
        previous = Some(request);
        history.push(assistant(&format!("answer {index}")));
        if index == 2 {
            let before = history.len();
            history = compacted(&history).await;
            assert!(
                history.len() < before,
                "the fixture has to compact for the break count below to mean anything"
            );
        }
    }

    assert_eq!(
        breaks, 1,
        "one compaction has to break the prefix exactly once; every other turn extends the last"
    );
}

/// The guard on the cache line: this list is every composer permitted to write
/// above it.
///
/// Adding one is a cache-behaviour change - it joins the prefix of every
/// request - so it has to be decided here, deliberately, in the same review
/// that adds the composer. A composer whose declared placement is `Tail` cannot
/// be on this list: it varies within a session, and the turn its value changes
/// would cost a cold cache.
const PREFIX_CONTRIBUTORS: &[Composer] = &[
    Composer::AssistantInstructions,
    Composer::Guidelines,
    Composer::WorkingDirectory,
    Composer::RuntimeEnvironment,
    Composer::SubagentGuide,
    Composer::SkillGuide,
    Composer::WebToolsGuide,
    Composer::ProjectContext,
    Composer::Skills,
    Composer::MemoryCatalog,
    Composer::ToolSchemas,
];

#[test]
fn the_permitted_prefix_contributors_are_exactly_this_list() {
    for composer in Composer::ALL.iter().copied() {
        assert_eq!(
            PREFIX_CONTRIBUTORS.contains(&composer),
            composer.declared() == Some(Placement::Prefix),
            "`{}` ({}) is {} the list of permitted prefix contributors; decide deliberately",
            composer.id(),
            composer.what(),
            if PREFIX_CONTRIBUTORS.contains(&composer) {
                "in"
            } else {
                "missing from"
            },
        );

        if PREFIX_CONTRIBUTORS.contains(&composer) {
            assert!(
                composer.constant(),
                "`{}` is permitted above the cache line but varies within a session",
                composer.id(),
            );
        }
    }
}

/// The registry is the only source of placement, so the policy has to agree
/// with it: a composer the policy moves onto the cache line is the same
/// decision as one declared there.
#[test]
fn the_default_policy_places_exactly_the_permitted_contributors_in_the_prefix() {
    let policy = PromptPolicy::default();
    let mut prefix: Vec<Composer> = Vec::new();

    for composer in Composer::ALL.iter().copied() {
        if policy
            .placement_of(composer)
            .expect("the default policy is valid")
            == Placement::Prefix
        {
            prefix.push(composer);
        }
    }

    assert_eq!(
        prefix, PREFIX_CONTRIBUTORS,
        "the default policy's prefix contributors have to be the permitted list, in registry order"
    );
}
