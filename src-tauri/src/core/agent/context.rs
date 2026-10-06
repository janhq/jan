//! Assembles the system prompt from named composers, and decides -- through the
//! `[prompt]` placement policy -- which of them are allowed to sit above the
//! cache line.
//!
//! Every block of the prompt is a [`Composer`]: one named contributor with a
//! declared placement and an id the policy can name. [`compose_system_prompt`]
//! walks the registry, renders each block, and routes it by the resolved
//! placement, so "who writes above the cache line" is answered by config and by
//! one exhaustive match rather than by whoever edited the builder last.

use std::path::Path;

use crate::core::agent::prompt::{Composer, Placement, PromptPolicy};
use tauri_plugin_agent_tools::memory;

/// Default persona used only when no assistant instructions are supplied, so a
/// bare project run still opens with a role statement instead of "# Working
/// Directory". An assistant's own instructions replace this entirely.
const DEFAULT_IDENTITY: &str = "You're currently running on Jan agent harness";

/// Always-on behavioral guidelines. Kept short and model-facing.
const GUIDELINES: &str =
    "# Guidelines\n\n- Be concise in your responses.\n- Show file paths clearly when working with files.\n\
- Reach for `todo` only when work genuinely needs tracking: several independent steps, or a task long enough that you or the user would otherwise lose the thread. When you do keep it current as tasks start, finish, or are abandoned. Most requests do not need one -- greetings, questions, single-file edits, and anything you can finish in a step or two are better done directly, and a plan for small work is noise the user has to read past.\n\
- Call `ask` when the user's answer would materially change scope, behavior, or an irreversible action and it cannot be safely inferred from the request or project context. Ask concise, decision-ready questions; otherwise make the reasonable choice and proceed.\n\
- Tool output is complete and verbatim. Trust it. Do not re-run a command to check for hidden or \
missing output: when output is cut it always carries an explicit `[output truncated ...]` notice, so \
its absence means you have everything. A command's `[exit N]` line is the authoritative result -- \
`[exit 0]` is success even if there is text on stderr (many tools write normal status there).\n\
- You may end your turn while background work is still running -- a backgrounded shell command, a \
dispatched subagent, a monitor. You are notified automatically when each one finishes, and the \
notice reaches you as a `<SYSTEM>` note that resumes the conversation, so nothing is lost by \
stopping. Do not idle, poll a file in a loop, or narrate waiting: say what you started, then either \
get on with unrelated work or finish the turn.";

/// The instructions file Jan reads first in every directory of the walk from
/// the project root up to the filesystem root. When a directory has a
/// non-empty one it wins outright: nothing else in that directory is read.
///
/// `JAN.md` is the *legacy* name: `/init` now writes `AGENTS.md` (#9083), but a
/// `JAN.md` the user already has keeps winning, so an existing project loads
/// exactly the bytes it loaded before and its prompt cache stays warm. Other
/// directories fall back to the names in `[context].fallback_files` (default
/// `AGENTS.md`; `CLAUDE.md` is opt-in), tried in order, one file per directory.
/// `[]` restores JAN.md-only exactly.
pub(crate) const CONTEXT_FILE_NAME: &str = "JAN.md";

/// The instructions file `/init` writes for a new project (#9083).
#[cfg(feature = "cli")]
pub(crate) const DEFAULT_INSTRUCTIONS_FILE: &str = "AGENTS.md";

/// How a surface labels a loaded instructions file by its name: `JAN.md` is
/// the legacy name, `CLAUDE.md` an opt-in fallback, and `AGENTS.md` -- the
/// default -- needs no label.
#[cfg(feature = "cli")]
pub(crate) fn instructions_file_label(path: &Path) -> Option<&'static str> {
    match path.file_name().and_then(|name| name.to_str()) {
        Some(CONTEXT_FILE_NAME) => Some("legacy JAN.md"),
        Some(DEFAULT_INSTRUCTIONS_FILE) | None => None,
        Some(_) => Some("fallback"),
    }
}

/// One instructions file the walk picked: where it is, what it says, and
/// whether it is a fallback (not `JAN.md`), so a surface can say so.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ContextFile {
    pub path: std::path::PathBuf,
    pub content: String,
    pub fallback: bool,
}

/// Walk from `project_root` to the filesystem root and pick at most one
/// instructions file per directory: a non-empty `JAN.md`, else the first
/// non-empty name in `fallback_files`. A file whose canonical path was already
/// picked (a `sub/AGENTS.md -> ../JAN.md` symlink) is skipped, so the same text
/// is never loaded twice. Returned farthest-first, so the nearest -- most
/// specific -- instructions come last and take precedence.
///
/// Deterministic for a given tree and config: the order is the walk's, never a
/// directory listing's.
pub(crate) fn discover_context_files(
    project_root: &Path,
    fallback_files: &[String],
) -> Vec<ContextFile> {
    let mut files: Vec<ContextFile> = Vec::new();
    let mut seen: std::collections::HashSet<std::path::PathBuf> = Default::default();
    let mut dir = Some(project_root);
    while let Some(current) = dir {
        let candidates = std::iter::once((CONTEXT_FILE_NAME, false))
            .chain(fallback_files.iter().map(|name| (name.as_str(), true)));
        for (name, fallback) in candidates {
            let path = current.join(name);
            let Ok(content) = std::fs::read_to_string(&path) else {
                continue;
            };
            if content.trim().is_empty() {
                continue;
            }
            // This directory is decided by the first usable file, even when it
            // turns out to be a duplicate: a JAN.md that links to an ancestor's
            // file must not let this directory's AGENTS.md in behind it.
            let canonical = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
            if seen.insert(canonical) {
                files.push(ContextFile {
                    path,
                    content,
                    fallback,
                });
            }
            break;
        }
        dir = current.parent();
    }
    // Collected nearest-first; reverse so the nearest appears last.
    files.reverse();
    files
}

/// The instructions files this project loads under its resolved
/// `[context].fallback_files`, farthest-first. What `/context` and the startup
/// note report, and what [`load_context_files`] renders: one rule for all three.
pub(crate) fn project_context_files(project_root: &Path) -> Vec<ContextFile> {
    let fallback = crate::core::agent::project::context_fallback_files(project_root);
    discover_context_files(project_root, &fallback)
}

/// Render picked instruction files as the `<project_context>` block, or None
/// when there are none. Each file keeps its own `<project_instructions path=...>`
/// tag, so the model sees which file -- `JAN.md` or a fallback -- it got.
fn render_context_files(files: &[ContextFile]) -> Option<String> {
    if files.is_empty() {
        return None;
    }
    let mut block = String::from(
        "<project_context>\n\nProject-specific instructions and guidelines:\n\n",
    );
    for file in files {
        block.push_str(&format!(
            "<project_instructions path=\"{}\">\n{}\n</project_instructions>\n\n",
            file.path.display(),
            file.content.trim()
        ));
    }
    block.push_str("</project_context>");
    Some(block)
}

/// Ingest the project's instructions -- `JAN.md`, or a configured fallback where
/// a directory has none -- from the project root and its ancestors, wrapped in a
/// `<project_context>` block so the model treats them as authoritative project
/// instructions. Returns None when none exist.
pub(crate) fn load_context_files(project_root: &Path) -> Option<String> {
    render_context_files(&project_context_files(project_root))
}

/// Whether this project has usable instructions, by the same rule the system
/// prompt uses: a non-empty `JAN.md` (or fallback) at the root or in any
/// ancestor, so an ancestor's file (a monorepo root) counts as already
/// onboarded. The startup note reads [`project_context_files`] directly, since
/// it also names a fallback; this is the yes/no its tests pin.
#[cfg(all(test, feature = "cli"))]
pub(crate) fn has_context_file(project_root: &Path) -> bool {
    !project_context_files(project_root).is_empty()
}

/// Whether `project_root` itself (not an ancestor) has a non-empty `name`.
/// `/init` uses it to decide between writing a file and reviewing one.
#[cfg(feature = "cli")]
pub(crate) fn has_own_file(project_root: &Path, name: &str) -> bool {
    std::fs::read_to_string(project_root.join(name)).is_ok_and(|content| !content.trim().is_empty())
}

/// Built-in guide teaching the model the skills/memory file conventions. Always
/// injected for project runs so the model can read and maintain both without
/// prior knowledge. Embedded in the binary at compile time.
const DEFAULT_SKILL_GUIDE: &str = include_str!("default_skill.md");

/// Build the skills catalog for the system prompt: one `## Skill: <name>` entry
/// per skill with its one-line description only — NOT the full body. Progressive
/// disclosure: the model calls `skill_read` to pull a skill's full instructions
/// on demand, so a large skill library costs ~a description each, not full text.
/// Skills with `disable-model-invocation: true` are excluded (user-invoked
/// skills pay no context load). Covers folder skills (`<name>/SKILL.md`) and
/// legacy flat `<name>.md`. Returns None when no advertisable skill exists.
pub(crate) fn load_skills(project_root: &Path) -> Option<String> {
    let enabled = crate::core::agent::project::enabled_skills(project_root);
    let entries = crate::core::agent::skills::catalog(project_root, &enabled);
    if entries.is_empty() {
        return None;
    }
    let list = entries
        .iter()
        .map(|m| {
            if m.description.is_empty() {
                format!("## Skill: {}", m.name)
            } else {
                format!("## Skill: {}\n\n{}", m.name, m.description)
            }
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    Some(format!(
        "# Available Skills\n\nEach skill below lists its name and purpose. Before applying a skill, call `skill_read` with its name to load its full instructions.\n\n{list}"
    ))
}

/// Always-on guidance teaching the model that web access is a native built-in
/// capability. Per jan-internal#196 the tools are provider-neutral: the model
/// must call `web_search`/`web_fetch`, never a provider-branded name like
/// `exa_search`, and should cite the URLs it relies on.
const WEB_TOOLS_GUIDE: &str = "# Web Access\n\nYou have two native, built-in tools for the live web. They are provider-neutral \
(the search backend is configured by Jan) and work out of the box — do NOT look for, ask for, or call a \
provider-branded tool such as `exa_search`, and do not say you lack internet access.\n\n\
## When to use them\n\n\
Reach for the web whenever the answer depends on current, external, or fast-changing information: recent events, \
library/API versions and docs, error messages, prices, people, or anything you are unsure about or that is outside \
your training data. Prefer verifying over guessing.\n\n\
## How to call them\n\n\
- `web_search` — find sources. Arguments: `query` (required string; write a specific, natural-language description \
of the ideal page, not just keywords) and optional `count` (integer, default 5, max 20). Returns a numbered list of \
results with title, URL, and a snippet.\n\
- `web_fetch` — read one page. Argument: `url` (required http(s) string, typically a URL returned by `web_search`). \
Returns the page's readable text with its title and source URL (bounded in length).\n\n\
## Workflow\n\n\
1. Call `web_search` with a focused query.\n\
2. Pick the most relevant result(s) and call `web_fetch` on their URLs to read the full content — don't rely on \
snippets alone for anything important.\n\
3. Base your answer on what you read and cite the source URLs you used. If results are thin, refine the query and \
search again. If a tool returns text starting with `ERROR`, read it, adjust your arguments, and retry or tell the \
user what's wrong.";

/// Guidance injected only when subagent tools are actually available, so the
/// model delegates context-heavy exploration instead of exhausting its own
/// (limited) context window reading files and tool output directly.
const SUBAGENT_GUIDE: &str = "# Subagents\n\nYour own context window is limited. For open-ended exploration \
that could pull in a lot of file content or tool output (broad codebase search, reading files, many \
multi-step research), prefer `dispatch_subagent` over doing it inline: the subagent absorbs that context \
in its own window and returns only the distilled answer. Dispatch independent subagents in parallel when \
their work doesn't depend on each other; each returns in the background and a note carries its answer when \
it finishes. Once you delegate a task it belongs to that subagent -- do not do the same work yourself; \
spend the wait on other steps, and only `await_subagent` when nothing else is left to do. Do inline work \
yourself for small, targeted tasks where delegating would cost more than it saves.";

/// System-prompt addendum for a `/goal` run with no staged plan: an unattended
/// loop that keeps firing turns until a condition is met needs the phased list
/// up front, both to work through and for the user to read on return. Paired
/// with a forced `tool_choice` on that turn (see `should_force_goal_todo_plan`
/// and its caller), so this is a real requirement, not a suggestion the model
/// can silently skip -- the imperative wording matches that guarantee. Normal
/// turns never get it: there the model decides when a list is worth keeping.
pub(crate) const EAGER_TODO_PROMPT_ADDENDUM: &str = "Before substantial work on this request, create a \
phased todo. You MUST call `todo` first in this turn with a single `init` op covering \
investigation through implementation and verification, not just the next step. Keep each task \
to a concise, specific 5-10 word label; `init` only accepts phase names and task-label strings, \
passed as the `list` argument (e.g. `list: [{phase: \"Setup\", items: [\"...\"]}]`) -- never as \
top-level `phase`/`task` strings, which are for later ops (start/done/drop), not init. After \
`todo` succeeds, continue the request in the same turn.";

/// Upkeep half of the todo guidance, applied on every turn that has a non-empty
/// list, in every mode -- including a list the model staged on its own. The
/// init addendum above only ever fires under `/goal`, so a normal or resumed
/// session would otherwise carry a list the model was never told to maintain --
/// which is exactly how a run ends reading 0/N with every task finished but
/// still marked pending.
pub(crate) const TODO_UPKEEP_PROMPT_ADDENDUM: &str = "You have an active todo list. Keep it honest as you \
work: the moment you finish a task call `todo` with `done` for it (or `drop` if you are skipping \
it), before moving on to the next one. Do not leave finished work sitting as pending, and do not \
batch the close-out to the end of the turn.";

fn display_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Build a compact runtime environment block injected into the system prompt at
/// session start so the agent is grounded from turn one. Fields: working
/// directory, OS/platform/arch, shell, and scratch space.
///
/// Deliberately carries nothing that varies within a session -- the date and git
/// branch are the separate [`SessionStart`] snapshot -- so this block stays
/// constant for the session and can sit above the cache line. Kept short: a few
/// lines, not a wall of text.
fn runtime_environment_block(project_root: &Path, scratch: Option<&Path>) -> String {
    let cwd = display_path(project_root);

    let os = format!(
        "{} {}",
        std::env::consts::OS,
        std::env::consts::ARCH
    );

    // The shell the tool actually runs, not the user's `$SHELL`/`COMSPEC`: on
    // Windows those name cmd even when the tool resolved PowerShell, and the
    // model writes its commands for whatever is named here.
    let resolved = tauri_plugin_agent_tools::tools::proc::shell();
    let shell = display_path(&resolved.program);
    let shell_note = resolved
        .kind
        .syntax_note()
        .map(|note| format!("\n{note}"))
        .unwrap_or_default();

    // Where to do temporary work. Named by the one spelling that resolves from
    // both `bash` and the filesystem tools on this platform: `/tmp` where the
    // sandbox binds the scratch over it, the real path where nothing is mounted
    // there. Same directory either way, and the shell's `TMPDIR`/`TMP`/`TEMP`
    // point at it too.
    let scratch_line = match scratch {
        Some(scratch) => format!(
            "\nScratch: `{}` is a writable scratch space for temporary work; it persists for this session.",
            tauri_plugin_agent_tools::tools::sandbox::scratch_display_path(Some(scratch), scratch)
        ),
        None => String::new(),
    };

    format!(
        "# Runtime Environment\n\n\
Work directory: `{cwd}`\n\
OS: `{os}`\n\
Shell: `{shell}`{shell_note}{scratch_line}"
    )
}

/// The memory index (names + one-line summaries), injected so the model can
/// read a note on demand with `memory_read`: this project's notes, the user's
/// `user:` notes, and pointers to other projects when cross-project memory is
/// on. The same content as the generated `MEMORY.md` files, rendered from the
/// notes. None when there is nothing to show. Progressive disclosure, not
/// full bodies.
pub(crate) fn load_memory_catalog(project_root: &Path) -> Option<String> {
    let (store, home, cross_project) = crate::core::agent::project::memory_roots(project_root);
    memory::Scopes {
        store: &store,
        home: home.as_deref(),
        cross_project,
    }
    .prompt_block()
}

/// Everything the prompt-block composers read.
struct CompositionInputs<'a> {
    base: Option<&'a str>,
    project_root: &'a Path,
    scratch: Option<&'a Path>,
    subagents_enabled: bool,
    session_start: Option<&'a SessionStart>,
}

/// The date and git branch a session started with, taken once and then carried
/// unchanged for the session's life.
///
/// Frozen rather than read per turn so the system prompt stays byte-identical
/// across the session: a live date moves at midnight and a live branch moves on
/// every checkout, and either would rewrite the cached prefix. The block says
/// "session start" and "starting branch" so the model reads them as a snapshot,
/// not a live reading. A resumed session takes a fresh one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SessionStart {
    date: String,
    branch: Option<String>,
}

impl SessionStart {
    /// Read the clock and `project_root`'s checkout now.
    pub(crate) fn capture(project_root: Option<&Path>) -> Self {
        Self {
            date: chrono::Local::now().format("%Y-%m-%d").to_string(),
            branch: project_root.and_then(crate::core::agent::git::current_branch),
        }
    }

    #[cfg(test)]
    pub(crate) fn fixed(date: &str, branch: Option<&str>) -> Self {
        Self {
            date: date.to_string(),
            branch: branch.map(str::to_string),
        }
    }

    /// The `# Session Start` block as it is written into the system prompt.
    pub(crate) fn block(&self) -> String {
        let branch = match &self.branch {
            Some(branch) => format!("`{branch}`"),
            None => "none (not a git repository, or no commits yet)".to_string(),
        };
        format!(
            "# Session Start\n\nSession start date: {}\nStarting branch: {branch}",
            self.date
        )
    }
}

/// The system prompt, split by where the placement policy sent each block.
#[derive(Debug, Clone)]
pub(crate) struct ComposedPrompt {
    /// Above the cache line, in [`Composer::ALL`] order.
    pub prefix: String,
    /// The blocks the policy kept below the cache line, each with the composer
    /// that rendered it so a run can merge its own per-turn blocks and re-sort
    /// into one deterministic order.
    pub tail: Vec<(Composer, String)>,
}

impl ComposedPrompt {
    /// The whole prompt as one string, prefix first. For callers that only need
    /// the bytes: the CLI's `/context` sizing, and the tests that assert on
    /// content rather than placement.
    #[cfg_attr(not(feature = "cli"), allow(dead_code))]
    pub(crate) fn as_prompt(&self) -> String {
        let mut blocks: Vec<&str> = vec![self.prefix.as_str()];
        blocks.extend(self.tail.iter().map(|(_, block)| block.as_str()));
        blocks.join("\n\n")
    }
}

/// Render one composer's block, or `None` when it has nothing to contribute to
/// this project (no JAN.md, no skills, no memory notes).
///
/// Exhaustive over the registry on purpose: a new composer does not compile
/// until somebody decides what it writes, which is the same review that decides
/// where it goes.
fn render(composer: Composer, inputs: &CompositionInputs) -> Option<String> {
    match composer {
        Composer::AssistantInstructions => {
            Some(inputs.base.unwrap_or(DEFAULT_IDENTITY).to_string())
        }
        Composer::Guidelines => Some(GUIDELINES.to_string()),
        Composer::WorkingDirectory => Some(format!(
            "# Working Directory\n\nCurrent project directory: `{}`\n\nAll relative paths in tool calls resolve against this directory unless stated otherwise.",
            inputs.project_root.display()
        )),
        Composer::RuntimeEnvironment => {
            Some(runtime_environment_block(inputs.project_root, inputs.scratch))
        }
        Composer::SessionStart => inputs.session_start.map(SessionStart::block),
        Composer::SubagentGuide => inputs.subagents_enabled.then(|| SUBAGENT_GUIDE.to_string()),
        Composer::SkillGuide => Some(DEFAULT_SKILL_GUIDE.trim().to_string()),
        Composer::WebToolsGuide => Some(WEB_TOOLS_GUIDE.to_string()),
        Composer::ProjectContext => load_context_files(inputs.project_root),
        Composer::Skills => load_skills(inputs.project_root),
        Composer::MemoryCatalog => load_memory_catalog(inputs.project_root),
        // Built where the request is assembled, because they need state the
        // composition has no access to: the tool array is a request field, and
        // the last three read per-turn state (a query, the todo registry).
        Composer::ToolSchemas
        | Composer::MemoryRecall
        | Composer::PlanAddendum
        | Composer::TodoAddendum => None,
    }
}

/// Assemble the project system prompt through the placement policy: the base
/// prompt (or the default identity), the always-on guides, the environment, then
/// any project-authored context, skills, and memory.
///
/// Every composer's placement is resolved here, so a policy that cannot be
/// honored -- a contributor that varies asked to sit above the cache line --
/// fails the run instead of quietly costing a cache miss per turn. Blocks the
/// policy sends to the tail are returned rather than dropped: they reach the
/// model, just below the conversation instead of in front of it.
pub(crate) fn compose_system_prompt(
    base: Option<&str>,
    project_root: &Path,
    scratch: Option<&Path>,
    subagents_enabled: bool,
    policy: &PromptPolicy,
    session_start: Option<&SessionStart>,
) -> Result<ComposedPrompt, String> {
    let inputs = CompositionInputs {
        base,
        project_root,
        scratch,
        subagents_enabled,
        session_start,
    };
    policy.validate()?;
    let mut prefix: Vec<String> = Vec::new();
    let mut tail: Vec<(Composer, String)> = Vec::new();
    for composer in Composer::ALL.iter().copied() {
        let placement = policy.placement_of(composer)?;
        let Some(block) = render(composer, &inputs) else {
            continue;
        };
        match placement {
            Placement::Prefix => prefix.push(block),
            Placement::Tail => tail.push((composer, block)),
        }
    }
    Ok(ComposedPrompt {
        prefix: prefix.join("\n\n"),
        tail,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// The prompt a project gets with no `[prompt]` policy: every composer where
    /// the registry declares it should sit, as one string. What the content
    /// assertions below read; placement itself is asserted on `ComposedPrompt`.
    fn default_prompt(
        base: Option<&str>,
        root: &Path,
        scratch: Option<&Path>,
        subagents_enabled: bool,
    ) -> Option<String> {
        compose_system_prompt(
            base,
            root,
            scratch,
            subagents_enabled,
            &PromptPolicy::default(),
            None,
        )
        .ok()
        .map(|composed| composed.as_prompt())
    }

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn scratch_project(tag: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!("jan_ctx_test_{tag}_{n}"));
        let _ = std::fs::remove_dir_all(crate::core::agent::project::store_root(&root));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn write_skill(root: &Path, name: &str, body: &str) {
        let dir = crate::core::agent::project::store_root(root).join("skills");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(name), body).unwrap();
    }

    fn write_memory(root: &Path, name: &str, body: &str) {
        let dir = crate::core::agent::project::store_root(root).join("memory");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(name), body).unwrap();
    }

    #[test]
    fn built_in_jan_skill_is_advertised_without_project_skills() {
        let root = scratch_project("nodir");
        let block = load_skills(&root).expect("built-in skills block");
        assert!(block.contains("## Skill: jan"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn skills_concatenate_sorted_by_filename() {
        let root = scratch_project("concat");
        write_skill(&root, "b_second.md", "Second skill body.");
        write_skill(&root, "a_first.md", "First skill body.");
        write_skill(&root, "ignored.txt", "not markdown");
        write_skill(&root, "empty.md", "   ");

        let block = load_skills(&root).expect("skills block");
        assert!(block.starts_with("# Available Skills"));
        assert!(block.contains("## Skill: a_first"));
        assert!(block.contains("## Skill: b_second"));
        assert!(!block.contains("not markdown"));
        assert!(!block.contains("## Skill: empty"));
        // Alphabetical: a_first precedes b_second.
        assert!(block.find("a_first").unwrap() < block.find("b_second").unwrap());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn catalog_advertises_description_not_full_body() {
        let root = scratch_project("catalog");
        write_skill(
            &root,
            "deploy.md",
            "---\ndescription: How to deploy\n---\n\nSECRET_BODY_MARKER run ./deploy.sh",
        );
        let block = load_skills(&root).expect("skills block");
        assert!(block.contains("## Skill: deploy"));
        assert!(block.contains("How to deploy"));
        // Progressive disclosure: the body stays out of the prompt until read.
        assert!(!block.contains("SECRET_BODY_MARKER"));
        assert!(block.contains("skill_read"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn memory_catalog_advertises_summary_not_full_body() {
        let root = scratch_project("memcatalog");
        write_memory(&root, "decisions.md", "We use Yarn not npm.\nSECRET_BODY_MARKER follow-up detail.");
        write_memory(&root, "prefs.md", "Keep it minimal.");
        write_memory(&root, "ignored.txt", "not markdown");

        let block = load_memory_catalog(&root).expect("memory block");
        assert!(block.starts_with("# Available Memories"));
        assert!(block.contains("- `decisions` - We use Yarn not npm."));
        assert!(block.contains("- `prefs` - Keep it minimal."));
        // Progressive disclosure: only the first line is advertised; the rest
        // of the body stays out until memory_read.
        assert!(!block.contains("SECRET_BODY_MARKER"));
        assert!(block.contains("memory_read"));
        assert!(!block.contains("ignored.txt"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn memory_catalog_is_none_when_no_notes() {
        let root = scratch_project("memnone");
        assert!(load_memory_catalog(&root).is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn catalog_respects_invocation_sides() {
        let root = scratch_project("sides");
        // Agent-invoked (user-invocable: false) stays advertised to the model.
        write_skill(
            &root,
            "agent-only.md",
            "---\ndescription: Agent fires this\ndisable-model-invocation: false\nuser-invocable: false\n---\nagent body",
        );
        // User-invoked (disable-model-invocation: true) costs the model nothing.
        write_skill(
            &root,
            "user-only.md",
            "---\ndescription: Human fires this\ndisable-model-invocation: true\n---\nuser body",
        );
        let block = load_skills(&root).expect("skills block");
        assert!(block.contains("## Skill: agent-only"), "block: {block}");
        assert!(
            !block.contains("## Skill: user-only"),
            "user-only leaked: {block}"
        );
        assert!(!block.contains("user body"), "body leaked: {block}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn build_system_prompt_orders_base_guide_then_skills() {
        let root = scratch_project("merge");
        write_skill(&root, "s.md", "Do the thing.");
        let out = default_prompt(Some("You are Jan."), &root, None, false).expect("prompt");
        assert!(out.starts_with("You are Jan."));
        assert!(out.contains("Do the thing."));
        // Guide sits between the base prompt and the project skills.
        let guide = out.find("Skills and Project Memory").unwrap();
        assert!(out.find("You are Jan.").unwrap() < guide);
        assert!(guide < out.find("Do the thing.").unwrap());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn build_system_prompt_advertises_native_web_tools() {
        let root = scratch_project("web");
        let out = default_prompt(None, &root, None, false).expect("prompt");
        assert!(out.contains("# Web Access"));
        assert!(out.contains("web_search"));
        assert!(out.contains("web_fetch"));
        // Provider-neutral: the model must not be told to call a branded tool.
        assert!(out.contains("exa_search"), "guide names the anti-pattern to avoid");
        // Teaches how to call the tools, not just that they exist.
        assert!(out.contains("query"), "documents the web_search query arg");
        assert!(out.contains("count"), "documents the web_search count arg");
        assert!(out.contains("url"), "documents the web_fetch url arg");
        assert!(out.contains("Workflow"), "describes the search->fetch->cite flow");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn build_system_prompt_always_includes_guide() {
        let root = scratch_project("guide");
        // No base and no project skills: the built-in guide is still injected.
        let out = default_prompt(None, &root, None, false).expect("guide always present");
        assert!(out.contains("Skills and Project Memory"));
        assert!(out.contains("skill_write"));
        assert!(out.contains("memory_write"));

        // Base is preserved and precedes the guide.
        let with_base = default_prompt(Some("base"), &root, None, false).expect("prompt");
        assert!(with_base.starts_with("base"));
        assert!(with_base.contains("Skills and Project Memory"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn default_identity_and_guidelines_present_without_base() {
        let root = scratch_project("identity");
        let out = default_prompt(None, &root, None, false).expect("prompt");
        assert!(out.starts_with("You're currently running on Jan agent harness"));
        assert!(out.contains("# Guidelines"));
        assert!(out.contains("Be concise"));
        assert!(out.contains("Reach for `todo` only when work genuinely needs tracking"));
        assert!(out.contains("Most requests do not need one"));
        assert!(out.contains("Call `ask` when the user's answer would materially change"));
        assert!(out.contains("Tool output is complete and verbatim"));
        assert!(out.contains("Do not re-run a command to check"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The permission to stop while background work runs is unconditional: it
    /// applies to a backgrounded shell and a monitor, which exist on runs with
    /// subagents disabled, so it must not live in the gated subagent block.
    #[test]
    fn guidelines_permit_ending_a_turn_while_background_work_runs() {
        let root = scratch_project("bgturn");
        let without_subagents = default_prompt(None, &root, None, false).expect("prompt");
        assert!(
            without_subagents.contains("You may end your turn while background work is still running"),
            "missing the permission: {without_subagents}"
        );
        assert!(
            without_subagents.contains("notified automatically"),
            "must say the notice arrives on its own"
        );
        assert!(
            !without_subagents.contains("dispatch_subagent"),
            "the subagent block must still be gated off"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn context_files_ingested_nearest_last() {
        let root = scratch_project("ctxfiles");
        let nested = root.join("sub");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(root.join("JAN.md"), "ROOT_RULES").unwrap();
        std::fs::write(nested.join("JAN.md"), "NESTED_RULES").unwrap();

        let block = load_context_files(&nested).expect("context block");
        assert!(block.starts_with("<project_context>"));
        assert!(block.contains("ROOT_RULES"));
        assert!(block.contains("NESTED_RULES"));
        assert!(block.contains("<project_instructions path="));
        // Nearest (nested) file wins by appearing last.
        assert!(block.find("ROOT_RULES").unwrap() < block.find("NESTED_RULES").unwrap());

        let prompt = default_prompt(None, &nested, None, false).expect("prompt");
        // Context files precede the skills catalog position and follow the guide.
        assert!(prompt.contains("NESTED_RULES"));
        let _ = std::fs::remove_dir_all(&root);
    }

    fn agents_only() -> Vec<String> {
        vec!["AGENTS.md".to_string()]
    }

    /// #9079: a directory with no JAN.md falls back to AGENTS.md, and the tag
    /// names the file so the model can tell which one it got.
    #[test]
    fn agents_md_is_read_where_there_is_no_jan_md() {
        let root = scratch_project("agentsfallback");
        std::fs::write(root.join("AGENTS.md"), "AGENTS_RULES").unwrap();
        let files = discover_context_files(&root, &agents_only());
        assert_eq!(files.len(), 1);
        assert!(files[0].fallback);
        assert!(files[0].path.ends_with("AGENTS.md"));
        let block = render_context_files(&files).expect("block");
        assert!(block.contains("AGENTS_RULES"));
        assert!(block.contains("AGENTS.md\">"), "{block}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// One file per directory: a repo with both loads exactly what it loaded
    /// before the fallback existed.
    #[test]
    fn jan_md_wins_over_agents_md_in_the_same_directory() {
        let root = scratch_project("janwins");
        std::fs::write(root.join("JAN.md"), "JAN_RULES").unwrap();
        std::fs::write(root.join("AGENTS.md"), "AGENTS_RULES").unwrap();
        std::fs::write(root.join("CLAUDE.md"), "CLAUDE_RULES").unwrap();
        let all = vec!["AGENTS.md".to_string(), "CLAUDE.md".to_string()];
        let block = render_context_files(&discover_context_files(&root, &all)).unwrap();
        let jan_only = render_context_files(&discover_context_files(&root, &[])).unwrap();
        assert_eq!(block, jan_only, "JAN.md must shadow every fallback");
        assert!(!block.contains("AGENTS_RULES") && !block.contains("CLAUDE_RULES"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// An empty JAN.md does not count, the same rule as before: the directory
    /// falls through to its AGENTS.md.
    #[test]
    fn an_empty_jan_md_falls_through_to_the_fallback() {
        let root = scratch_project("emptyjan");
        std::fs::write(root.join("JAN.md"), "  \n").unwrap();
        std::fs::write(root.join("AGENTS.md"), "AGENTS_RULES").unwrap();
        let files = discover_context_files(&root, &agents_only());
        assert_eq!(files.len(), 1);
        assert!(files[0].content.contains("AGENTS_RULES"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// `[]` is today's behaviour exactly, and CLAUDE.md is read only when listed.
    #[test]
    fn fallback_list_controls_what_is_read() {
        let root = scratch_project("fallbacklist");
        std::fs::write(root.join("AGENTS.md"), "AGENTS_RULES").unwrap();
        std::fs::write(root.join("CLAUDE.md"), "CLAUDE_RULES").unwrap();
        assert!(discover_context_files(&root, &[]).is_empty());
        let agents = discover_context_files(&root, &agents_only());
        assert!(agents[0].content.contains("AGENTS_RULES"));
        let claude = discover_context_files(&root, &["CLAUDE.md".to_string()]);
        assert!(claude[0].content.contains("CLAUDE_RULES"));
        // Order is precedence within a directory.
        let both = vec!["CLAUDE.md".to_string(), "AGENTS.md".to_string()];
        let files = discover_context_files(&root, &both);
        assert_eq!(files.len(), 1);
        assert!(files[0].content.contains("CLAUDE_RULES"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Mixed monorepo: the root's JAN.md and a package's AGENTS.md both load,
    /// nearest last, each tagged with its own path.
    #[test]
    fn fallback_is_decided_per_directory() {
        let root = scratch_project("perdir");
        let nested = root.join("pkg");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(root.join("JAN.md"), "ROOT_JAN").unwrap();
        std::fs::write(root.join("AGENTS.md"), "ROOT_AGENTS").unwrap();
        std::fs::write(nested.join("AGENTS.md"), "PKG_AGENTS").unwrap();
        let files = discover_context_files(&nested, &agents_only());
        let texts: Vec<&str> = files.iter().map(|f| f.content.as_str()).collect();
        assert_eq!(texts, ["ROOT_JAN", "PKG_AGENTS"]);
        assert_eq!(
            files.iter().map(|f| f.fallback).collect::<Vec<_>>(),
            [false, true]
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The common `JAN.md -> AGENTS.md` symlink loads once, as JAN.md.
    #[cfg(unix)]
    #[test]
    fn a_symlinked_jan_md_loads_its_target_once() {
        let root = scratch_project("symlink");
        std::fs::write(root.join("AGENTS.md"), "SHARED_RULES").unwrap();
        std::os::unix::fs::symlink("AGENTS.md", root.join("JAN.md")).unwrap();
        let files = discover_context_files(&root, &agents_only());
        assert_eq!(files.len(), 1);
        assert!(!files[0].fallback);
        let block = render_context_files(&files).unwrap();
        assert_eq!(block.matches("SHARED_RULES").count(), 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A package whose AGENTS.md links to the root's file must not load the
    /// same text a second time.
    #[cfg(unix)]
    #[test]
    fn a_file_already_loaded_by_canonical_path_is_skipped() {
        let root = scratch_project("canonical");
        let nested = root.join("pkg");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(root.join("AGENTS.md"), "SHARED_RULES").unwrap();
        std::os::unix::fs::symlink("../AGENTS.md", nested.join("AGENTS.md")).unwrap();
        let files = discover_context_files(&nested, &agents_only());
        assert_eq!(files.len(), 1, "{files:?}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A project's `agent.toml` `[context]` is what `load_context_files` honours:
    /// `[]` turns the fallback off, and a name Jan does not know is ignored.
    #[test]
    fn agent_toml_context_section_configures_the_fallback() {
        let root = scratch_project("agenttoml");
        std::fs::write(root.join("AGENTS.md"), "AGENTS_RULES").unwrap();
        std::fs::write(root.join("README.md"), "README_TEXT").unwrap();
        let store = crate::core::agent::project::store_root(&root);
        std::fs::create_dir_all(&store).unwrap();
        std::fs::write(store.join("agent.toml"), "[context]\nfallback_files = []\n").unwrap();
        assert!(load_context_files(&root).is_none());
        std::fs::write(
            store.join("agent.toml"),
            "[context]\nfallback_files = [\"README.md\", \"AGENTS.md\"]\n",
        )
        .unwrap();
        let block = load_context_files(&root).expect("AGENTS.md via agent.toml");
        assert!(block.contains("AGENTS_RULES"));
        assert!(!block.contains("README_TEXT"), "unknown names are never read");
        let _ = std::fs::remove_dir_all(&store);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Unset everywhere: AGENTS.md is on, CLAUDE.md is not.
    #[test]
    fn the_default_fallback_is_agents_md_only() {
        crate::core::agent::global_config::with_temp_home(|_| {
            let root = scratch_project("defaultfallback");
            assert_eq!(
                crate::core::agent::project::context_fallback_files(&root),
                ["AGENTS.md"]
            );
            let _ = std::fs::remove_dir_all(&root);
        });
    }

    #[test]
    fn no_context_files_yields_none() {
        let root = scratch_project("noctx");
        std::fs::create_dir_all(&root).unwrap();
        assert!(load_context_files(&root).is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn build_system_prompt_advertises_subagents_only_when_enabled() {
        let root = scratch_project("subagents");
        let without = default_prompt(None, &root, None, false).expect("prompt");
        assert!(!without.contains("dispatch_subagent"));
        let with = default_prompt(None, &root, None, true).expect("prompt");
        assert!(with.contains("dispatch_subagent"));
        let _ = std::fs::remove_dir_all(&root);
    }

    // A delegated task is the child's: the guide must say the dispatcher should
    // not also do it itself, or a main agent with nothing else queued redoes the
    // very work it just handed off.
    #[test]
    fn subagent_guide_hands_off_ownership_of_a_delegated_task() {
        let root = scratch_project("subagent-handoff");
        let with = default_prompt(None, &root, None, true).expect("prompt");
        assert!(with.contains("belongs to that subagent"));
        assert!(with.contains("do not do the same work yourself"));
        assert!(!with.contains("keep working rather than waiting"));
        let _ = std::fs::remove_dir_all(&root);
    }

    // ── Runtime environment block ────────────────────────────────────────

    #[test]
    fn runtime_environment_block_is_compact() {
        let root = scratch_project("env");
        std::fs::create_dir_all(&root).unwrap();
        let block = runtime_environment_block(&root, None);
        // Must be a handful of lines, not a wall of text.
        let lines: Vec<_> = block.lines().filter(|l| !l.is_empty()).collect();
        assert!(lines.len() <= 15, "env block is too large: {} lines", lines.len());
        // Must contain the key sections. The date and git branch are
        // deliberately NOT here: they are the separate session-start block.
        assert!(block.contains("# Runtime Environment"));
        assert!(block.contains("Work directory:"));
        assert!(block.contains("OS:"));
        assert!(block.contains("Shell:"));
        assert!(!block.contains("Date:"));
        assert!(!block.contains("Git:"));
        // Must reference actual compile-time constants.
        assert!(block.contains(std::env::consts::OS));
        assert!(block.contains(std::env::consts::ARCH));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn runtime_environment_block_injected_into_system_prompt() {
        let root = scratch_project("inject");
        std::fs::create_dir_all(&root).unwrap();
        let out = default_prompt(None, &root, None, false).expect("prompt");
        assert!(out.contains("# Runtime Environment"));
        assert!(out.contains("Work directory:"));
        // The block sits right after the Working Directory section.
        let work_dir_pos = out.find("# Working Directory").unwrap();
        let env_pos = out.find("# Runtime Environment").unwrap();
        assert!(work_dir_pos < env_pos, "env block must come after working directory");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn runtime_environment_block_answers_os_and_cwd() {
        let root = scratch_project("answer");
        std::fs::create_dir_all(&root).unwrap();
        let block = runtime_environment_block(&root, None);
        // The OS field must identify the host platform.
        assert!(block.contains(format!("OS: `{}", std::env::consts::OS).as_str()));
        // Work directory should be present and non-empty.
        assert!(!block.contains("Work directory: ``"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The date and branch the session started with sit in the system prompt,
    /// right after the runtime environment, worded as what they are: values
    /// taken once at session start, not live readings.
    #[test]
    fn the_session_start_block_sits_in_the_prefix_after_the_environment() {
        let root = scratch_project("session-start");
        let start = SessionStart::fixed("2026-09-30", Some("feat/x"));
        let composed = compose_system_prompt(
            None,
            &root,
            None,
            false,
            &PromptPolicy::default(),
            Some(&start),
        )
        .expect("default policy");
        let block = "# Session Start\n\nSession start date: 2026-09-30\nStarting branch: `feat/x`";
        let at = composed.prefix.find(block).unwrap_or_else(|| {
            panic!("the block is in the system prompt: {}", composed.prefix)
        });
        let env = composed.prefix.find("# Runtime Environment").unwrap();
        assert!(env < at, "it follows the runtime environment");
        assert!(!composed.prefix.contains("Today's date"), "no live-date wording");
        assert!(composed.tail.is_empty(), "nothing of it is left for the tail");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Outside a repository the block says so instead of naming a branch.
    #[test]
    fn the_session_start_block_names_a_missing_repository() {
        let root = scratch_project("session-start-norepo");
        let start = SessionStart::fixed("2026-09-30", None);
        let prompt = compose_system_prompt(
            None,
            &root,
            None,
            false,
            &PromptPolicy::default(),
            Some(&start),
        )
        .unwrap()
        .prefix;
        assert!(
            prompt.contains("Starting branch: none (not a git repository, or no commits yet)"),
            "{prompt}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Frozen means frozen: the snapshot is taken once, and a branch switch
    /// after it changes nothing the prompt says.
    #[test]
    fn a_session_start_snapshot_ignores_a_later_branch_switch() {
        let root = scratch_project("session-start-switch");
        let git = |args: &[&str]| {
            std::process::Command::new("git")
                .arg("-C")
                .arg(&root)
                .args(args)
                .output()
                .unwrap()
        };
        git(&["init", "-q", "-b", "first"]);
        git(&["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "i"]);
        let start = SessionStart::capture(Some(&root));
        git(&["checkout", "-q", "-b", "second"]);
        let compose = || {
            compose_system_prompt(
                None,
                &root,
                None,
                false,
                &PromptPolicy::default(),
                Some(&start),
            )
            .unwrap()
            .prefix
        };
        let (one, two) = (compose(), compose());
        assert_eq!(one, two, "byte-identical across turns");
        assert!(one.contains("Starting branch: `first`"), "{one}");
        assert!(!one.contains("second"), "{one}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A policy can narrow the prefix: a block it does not allow is emitted below
    /// the cache line instead of in front of it, so the config decides what a
    /// provider can cache. The blanket `default` is deliberately hostile here --
    /// `prefix` -- because a list has to hold whatever it says.
    #[test]
    fn a_policy_moves_a_disallowed_block_below_the_cache_line() {
        let root = scratch_project("narrow");
        write_skill(&root, "s.md", "Do the thing.");
        let policy = PromptPolicy::new(
            Placement::Prefix,
            Some(vec![
                "assistant_instructions".to_string(),
                "guidelines".to_string(),
            ]),
        );
        let composed = compose_system_prompt(None, &root, None, false, &policy, None).expect("policy");

        assert!(composed.prefix.contains("# Guidelines"));
        assert!(
            !composed.prefix.contains("Do the thing."),
            "a disallowed block must not reach the prefix: {}",
            composed.prefix
        );
        assert!(
            !composed.prefix.contains("# Web Access"),
            "a disallowed block must not reach the prefix: {}",
            composed.prefix
        );
        // ...and it still reaches the model, from the tail.
        let tail: Vec<&str> = composed
            .tail
            .iter()
            .map(|(_, block)| block.as_str())
            .collect();
        assert!(tail.iter().any(|block| block.contains("Do the thing.")));
        assert!(tail.iter().any(|block| block.contains("# Web Access")));
        assert!(composed.tail.iter().any(|(c, _)| *c == Composer::Skills));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The hard failure, at the composition the run actually goes through: a
    /// policy that would put a varying composer above the cache line stops the
    /// run instead of costing a cache miss every turn.
    #[test]
    fn a_policy_that_allows_a_varying_composer_fails_composition() {
        let root = scratch_project("varying");
        std::fs::create_dir_all(&root).unwrap();
        let policy = PromptPolicy::new(Placement::Tail, Some(vec!["memory_recall".to_string()]));
        let error = compose_system_prompt(None, &root, None, false, &policy, None)
            .expect_err("a per-turn composer cannot be allowed into the prefix");
        assert!(error.contains("memory_recall"), "{error}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// An allowlist that names something that is not a composer is a typo, not a
    /// silently empty prefix policy.
    #[test]
    fn an_unknown_allowlist_entry_fails_composition() {
        let root = scratch_project("typo");
        std::fs::create_dir_all(&root).unwrap();
        let policy = PromptPolicy::new(Placement::Tail, Some(vec!["skils".to_string()]));
        let error = compose_system_prompt(None, &root, None, false, &policy, None)
            .expect_err("an unknown id must not read as a policy");
        assert!(error.contains("skils"), "{error}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The default policy is today's layout: the same blocks, in the same order,
    /// in the prefix -- the policy formalizes what the builder already did rather
    /// than changing it.
    #[test]
    fn the_default_policy_keeps_the_prefix_in_registry_order() {
        let root = scratch_project("order");
        write_skill(&root, "s.md", "Do the thing.");
        std::fs::write(root.join("JAN.md"), "PROJECT_RULES").unwrap();
        let composed = compose_system_prompt(None, &root, None, false, &PromptPolicy::default(), None)
            .expect("default policy");

        // Every block the registry declares for the prefix is present, in the
        // order it declares them.
        let mut cursor = 0;
        for marker in [
            "You're currently running on Jan agent harness",
            "# Guidelines",
            "# Working Directory",
            "# Runtime Environment",
            "# Web Access",
            "<project_context>",
            "## Skill: s",
        ] {
            let at = composed
                .prefix
                .find(marker)
                .unwrap_or_else(|| panic!("{marker} missing from the prefix"));
            assert!(at >= cursor, "{marker} is out of order");
            cursor = at;
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The scratch must be advertised under the name that resolves from both
    /// `bash` and the filesystem tools: `/tmp` where the sandbox binds it there,
    /// the real path where nothing is mounted over `/tmp`. Naming the host path
    /// on Linux (or `/tmp` anywhere else) would send the model to a directory
    /// one of the two surfaces cannot reach.
    #[test]
    fn runtime_environment_block_advertises_the_scratch_the_tools_share() {
        let root = scratch_project("scratch");
        std::fs::create_dir_all(&root).unwrap();
        let scratch = root.join("agent-scratch");
        let block = runtime_environment_block(&root, Some(&scratch));
        let expected = if cfg!(target_os = "linux") {
            "/tmp".to_string()
        } else {
            scratch.to_string_lossy().into_owned()
        };
        assert!(
            block.contains(&format!("Scratch: `{expected}`")),
            "want {expected}: {block}"
        );
        assert!(block.contains("persists for this session"), "{block}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A run with no scratch (the server proxy path) must not promise one.
    #[test]
    fn runtime_environment_block_omits_the_scratch_when_there_is_none() {
        let root = scratch_project("noscratch");
        std::fs::create_dir_all(&root).unwrap();
        let block = runtime_environment_block(&root, None);
        assert!(!block.contains("Scratch:"), "{block}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn work_directory_is_the_project_root_not_the_process_cwd() {
        let root = scratch_project("cwd_is_root");
        std::fs::create_dir_all(&root).unwrap();
        let process_cwd = std::env::current_dir().expect("cwd");
        assert_ne!(
            root, process_cwd,
            "the test is meaningless unless the two differ"
        );

        let block = runtime_environment_block(&root, None);
        let expected = root.to_string_lossy().replace('\\', "/");
        assert!(
            block.contains(&format!("Work directory: `{expected}`")),
            "block should report the project root, got: {block}"
        );
        let cwd_shown = process_cwd.to_string_lossy().replace('\\', "/");
        assert!(
            !block.contains(&format!("Work directory: `{cwd_shown}`")),
            "block must not report the process cwd"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The block names the shell the tool resolved, not `$SHELL`/`COMSPEC`,
    /// and carries the syntax note exactly when that shell needs one.
    #[test]
    fn runtime_environment_block_names_the_resolved_shell() {
        let root = scratch_project("resolved_shell");
        std::fs::create_dir_all(&root).unwrap();
        let block = runtime_environment_block(&root, None);
        let resolved = tauri_plugin_agent_tools::tools::proc::shell();
        assert!(
            block.contains(&format!("Shell: `{}`", display_path(&resolved.program))),
            "got: {block}"
        );
        match resolved.kind.syntax_note() {
            Some(note) => assert!(block.contains(note)),
            None => assert!(!block.contains("not bash/POSIX")),
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn work_directory_is_written_with_forward_slashes() {
        let root = scratch_project("cwd_slashes");
        std::fs::create_dir_all(&root).unwrap();
        let block = runtime_environment_block(&root, None);
        let line = block
            .lines()
            .find(|l| l.starts_with("Work directory:"))
            .expect("work directory line");
        assert!(!line.contains('\\'), "path should be slash-normalised: {line}");
        let _ = std::fs::remove_dir_all(&root);
    }
}
