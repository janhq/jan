//! Assembles system-prompt additions from a project's context. Today this is
//! skill loading: markdown files under `.jan/agent/skills/` concatenated
//! Claude-style into a single block appended to the agent's system prompt.

use std::path::Path;

use chrono::Local;

use crate::core::agent::git;
use tauri_plugin_agent_tools::{skills, workspace};

/// Default persona used only when no assistant instructions are supplied, so a
/// bare project run still opens with a role statement instead of "# Working
/// Directory". An assistant's own instructions replace this entirely.
const DEFAULT_IDENTITY: &str = "You are Jan, an AI coding agent. You help users by reading files, \
running commands, editing code, and writing new files.";

/// Always-on behavioral guidelines. Kept short and model-facing.
const GUIDELINES: &str =
    "# Guidelines\n\n- Be concise in your responses.\n- Show file paths clearly when working with files.\n\
- Reach for `todo` only when work genuinely needs tracking: several independent steps, or a task long enough that you or the user would otherwise lose the thread. When you do keep it current as tasks start, finish, or are abandoned. Most requests do not need one -- greetings, questions, single-file edits, and anything you can finish in a step or two are better done directly, and a plan for small work is noise the user has to read past.\n\
- Call `ask` when the user's answer would materially change scope, behavior, or an irreversible action and it cannot be safely inferred from the request or project context. Ask concise, decision-ready questions; otherwise make the reasonable choice and proceed.\n\
- Tool output is complete and verbatim. Trust it. Do not re-run a command to check for hidden or \
missing output: when output is cut it always carries an explicit `[output truncated ...]` notice, so \
its absence means you have everything. A command's `[exit N]` line is the authoritative result -- \
`[exit 0]` is success even if there is text on stderr (many tools write normal status there).";

/// Context-file names discovered by walking from the project root up to the
/// filesystem root, most general (top ancestor) first so the nearest file wins.
const CONTEXT_FILE_NAMES: &[&str] = &["AGENTS.md", "CLAUDE.md"];

/// Ingest project instruction files (`AGENTS.md` / `CLAUDE.md`) from the project
/// root and its ancestors, wrapped in a `<project_context>` block so the model
/// treats them as authoritative project instructions. Returns None when none
/// exist. At most one file per directory (first match by `CONTEXT_FILE_NAMES`).
pub(crate) fn load_context_files(project_root: &Path) -> Option<String> {
    let mut files: Vec<(std::path::PathBuf, String)> = Vec::new();
    let mut dir = Some(project_root);
    while let Some(current) = dir {
        for name in CONTEXT_FILE_NAMES {
            let path = current.join(name);
            if let Ok(content) = std::fs::read_to_string(&path) {
                if !content.trim().is_empty() {
                    files.push((path, content));
                }
                break;
            }
        }
        dir = current.parent();
    }
    if files.is_empty() {
        return None;
    }
    // Ancestors are collected nearest-first; reverse so the nearest (most
    // specific) instructions appear last and take precedence.
    files.reverse();
    let mut block = String::from(
        "<project_context>\n\nProject-specific instructions and guidelines:\n\n",
    );
    for (path, content) in files {
        block.push_str(&format!(
            "<project_instructions path=\"{}\">\n{}\n</project_instructions>\n\n",
            path.display(),
            content.trim()
        ));
    }
    block.push_str("</project_context>");
    Some(block)
}

/// Built-in guide teaching the model the skills/memory file conventions. Always
/// injected for project runs so the model can read and maintain both without
/// prior knowledge. Embedded in the binary at compile time.
const DEFAULT_SKILL_GUIDE: &str = include_str!("default_skill.md");

/// Build the skills catalog for the system prompt: one `## Skill: <name>` entry
/// per skill with its one-line description only — NOT the full body. Progressive
/// disclosure: the model calls `skill_read` to pull a skill's full instructions
/// on demand, so a large skill library costs ~a description each, not full text.
/// Covers folder skills (`<name>/SKILL.md`) and legacy flat `<name>.md`. Returns
/// None when no advertisable skill exists.
pub(crate) fn load_skills(project_root: &Path) -> Option<String> {
    let enabled = crate::core::agent::project::enabled_skills(project_root);
    let entries = skills::catalog(&workspace::project_store(project_root), &enabled);
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
their work doesn't depend on each other, then `await_subagent` each. Do inline work yourself for small, \
targeted tasks where delegating would cost more than it saves.";

/// Build a compact runtime environment block injected into the system prompt at
/// session start so the agent is grounded from turn one. Mirrors the
/// `<workstation>` / cwd / date context blocks that harnesses like this one
/// already inject. Fields: working directory, OS/platform/arch, date, shell, and
/// git state (branch name when the project is inside a git repo). Kept short —
/// a few lines, not a wall of text.
fn runtime_environment_block(project_root: &Path) -> String {
    let cwd = std::env::current_dir()
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "unknown".to_string());

    let os = format!(
        "{} {}",
        std::env::consts::OS,
        std::env::consts::ARCH
    );

    let now = Local::now();
    let date = now.format("%Y-%m-%d").to_string();

    let shell = std::env::var("SHELL")
        .or_else(|_| std::env::var("COMSPEC"))
        .unwrap_or_else(|_| "unknown".to_string());

    let git_branch = git::current_branch(project_root);
    let git_line = match &git_branch {
        Some(branch) => format!("Git branch: `{branch}`"),
        None => "Git: not a git repository (or no commits yet)".to_string(),
    };

    format!(
        "# Runtime Environment\n\n\
Work directory: `{cwd}`\n\
OS: `{os}`\n\
Date: `{date}`\n\
Shell: `{shell}`\n\
{git_line}"
    )
}

/// Assemble the project system prompt: the optional base prompt, the always-on
/// built-in skills/memory guide, then any project-authored skills. The guide is
/// always present for project runs, so this never returns None.
pub(crate) fn build_system_prompt(
    base: Option<&str>,
    project_root: &Path,
    subagents_enabled: bool,
) -> Option<String> {
    let mut blocks: Vec<String> = Vec::new();
    match base {
        Some(b) => blocks.push(b.to_string()),
        None => blocks.push(DEFAULT_IDENTITY.to_string()),
    }
    blocks.push(GUIDELINES.to_string());
    blocks.push(format!(
        "# Working Directory\n\nCurrent project directory: `{}`\n\nAll relative paths in tool calls resolve against this directory unless stated otherwise.",
        project_root.display()
    ));
    blocks.push(runtime_environment_block(project_root));
    if subagents_enabled {
        blocks.push(SUBAGENT_GUIDE.to_string());
    }
    blocks.push(DEFAULT_SKILL_GUIDE.trim().to_string());
    blocks.push(WEB_TOOLS_GUIDE.to_string());
    if let Some(context) = load_context_files(project_root) {
        blocks.push(context);
    }
    if let Some(skills) = load_skills(project_root) {
        blocks.push(skills);
    }
    Some(blocks.join("\n\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn scratch_project(tag: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!("jan_ctx_test_{tag}_{n}"))
    }

    fn write_skill(root: &Path, name: &str, body: &str) {
        let dir = root.join(".jan").join("agent").join("skills");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(name), body).unwrap();
    }

    #[test]
    fn no_skills_dir_yields_none() {
        let root = scratch_project("nodir");
        assert!(load_skills(&root).is_none());
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
    fn build_system_prompt_orders_base_guide_then_skills() {
        let root = scratch_project("merge");
        write_skill(&root, "s.md", "Do the thing.");
        let out = build_system_prompt(Some("You are Jan."), &root, false).expect("prompt");
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
        let out = build_system_prompt(None, &root, false).expect("prompt");
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
        let out = build_system_prompt(None, &root, false).expect("guide always present");
        assert!(out.contains("Skills and Project Memory"));
        assert!(out.contains("skill_write"));
        assert!(out.contains("memory_write"));

        // Base is preserved and precedes the guide.
        let with_base = build_system_prompt(Some("base"), &root, false).expect("prompt");
        assert!(with_base.starts_with("base"));
        assert!(with_base.contains("Skills and Project Memory"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn default_identity_and_guidelines_present_without_base() {
        let root = scratch_project("identity");
        let out = build_system_prompt(None, &root, false).expect("prompt");
        assert!(out.starts_with("You are Jan, an AI coding agent."));
        assert!(out.contains("# Guidelines"));
        assert!(out.contains("Be concise"));
        assert!(out.contains("Reach for `todo` only when work genuinely needs tracking"));
        assert!(out.contains("Most requests do not need one"));
        assert!(out.contains("Call `ask` when the user's answer would materially change"));
        assert!(out.contains("Tool output is complete and verbatim"));
        assert!(out.contains("Do not re-run a command to check"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn context_files_ingested_nearest_last() {
        let root = scratch_project("ctxfiles");
        let nested = root.join("sub");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(root.join("AGENTS.md"), "ROOT_RULES").unwrap();
        std::fs::write(nested.join("CLAUDE.md"), "NESTED_RULES").unwrap();

        let block = load_context_files(&nested).expect("context block");
        assert!(block.starts_with("<project_context>"));
        assert!(block.contains("ROOT_RULES"));
        assert!(block.contains("NESTED_RULES"));
        assert!(block.contains("<project_instructions path="));
        // Nearest (nested) file wins by appearing last.
        assert!(block.find("ROOT_RULES").unwrap() < block.find("NESTED_RULES").unwrap());

        let prompt = build_system_prompt(None, &nested, false).expect("prompt");
        // Context files precede the skills catalog position and follow the guide.
        assert!(prompt.contains("NESTED_RULES"));
        let _ = std::fs::remove_dir_all(&root);
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
        let without = build_system_prompt(None, &root, false).expect("prompt");
        assert!(!without.contains("dispatch_subagent"));
        let with = build_system_prompt(None, &root, true).expect("prompt");
        assert!(with.contains("dispatch_subagent"));
        let _ = std::fs::remove_dir_all(&root);
    }

    // ── Runtime environment block ────────────────────────────────────────

    #[test]
    fn runtime_environment_block_is_compact() {
        let root = scratch_project("env");
        std::fs::create_dir_all(&root).unwrap();
        let block = runtime_environment_block(&root);
        // Must be a handful of lines, not a wall of text.
        let lines: Vec<_> = block.lines().filter(|l| !l.is_empty()).collect();
        assert!(lines.len() <= 15, "env block is too large: {} lines", lines.len());
        // Must contain the key sections.
        assert!(block.contains("# Runtime Environment"));
        assert!(block.contains("Work directory:"));
        assert!(block.contains("OS:"));
        assert!(block.contains("Date:"));
        assert!(block.contains("Shell:"));
        assert!(block.contains("Git:"));
        // Must reference actual compile-time constants.
        assert!(block.contains(std::env::consts::OS));
        assert!(block.contains(std::env::consts::ARCH));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn runtime_environment_block_injected_into_system_prompt() {
        let root = scratch_project("inject");
        std::fs::create_dir_all(&root).unwrap();
        let out = build_system_prompt(None, &root, false).expect("prompt");
        assert!(out.contains("# Runtime Environment"));
        assert!(out.contains("Work directory:"));
        // The block sits right after the Working Directory section.
        let work_dir_pos = out.find("# Working Directory").unwrap();
        let env_pos = out.find("# Runtime Environment").unwrap();
        assert!(work_dir_pos < env_pos, "env block must come after working directory");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn runtime_environment_block_answers_os_date_cwd() {
        let root = scratch_project("answer");
        std::fs::create_dir_all(&root).unwrap();
        let block = runtime_environment_block(&root);
        // The date field must be a real-looking ISO date.
        assert!(block.contains("Date: `20"), "date should be a 20xx year");
        // The OS field must identify the host platform.
        assert!(block.contains(format!("OS: `{}", std::env::consts::OS).as_str()));
        // Work directory should be present and non-empty.
        assert!(!block.contains("Work directory: ``"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
