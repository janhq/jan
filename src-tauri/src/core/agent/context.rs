//! Assembles system-prompt additions from a project's context. Today this is
//! skill loading: markdown files under `.jan/agent/skills/` concatenated
//! Claude-style into a single block appended to the agent's system prompt.

use std::path::Path;

use crate::core::agent::skills;

/// Default persona used only when no assistant instructions are supplied, so a
/// bare project run still opens with a role statement instead of "# Working
/// Directory". An assistant's own instructions replace this entirely.
const DEFAULT_IDENTITY: &str = "You are Jan, an AI coding agent. You help users by reading files, \
running commands, editing code, and writing new files.";

/// Always-on behavioral guidelines. Kept short and model-facing.
const GUIDELINES: &str =
    "# Guidelines\n\n- Be concise in your responses.\n- Show file paths clearly when working with files.";

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
    // Honor the project's `[skills].enabled` whitelist (empty = all). Reading the
    // config here keeps load_skills self-contained; a missing/malformed config
    // falls back to "all skills" rather than erroring.
    let enabled = crate::core::agent::project::load_agent_config(project_root)
        .ok()
        .map(|c| c.skills.enabled)
        .unwrap_or_default();
    let entries = skills::catalog(project_root, &enabled);
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

/// Guidance injected only when subagent tools are actually available, so the
/// model delegates context-heavy exploration instead of exhausting its own
/// (limited) context window reading files and tool output directly.
const SUBAGENT_GUIDE: &str = "# Subagents\n\nYour own context window is limited. For open-ended exploration \
that could pull in a lot of file content or tool output (broad codebase search, reading many files, \
multi-step research), prefer `dispatch_subagent` over doing it inline: the subagent absorbs that context \
in its own window and returns only the distilled answer. Dispatch independent subagents in parallel when \
their work doesn't depend on each other, then `await_subagent` each. Do inline work yourself for small, \
targeted tasks where delegating would cost more than it saves.";

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
    if subagents_enabled {
        blocks.push(SUBAGENT_GUIDE.to_string());
    }
    blocks.push(DEFAULT_SKILL_GUIDE.trim().to_string());
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
}
