//! Assembles system-prompt additions from a project's context. Today this is
//! skill loading: markdown files under `.jan/agent/skills/` concatenated
//! Claude-style into a single block appended to the agent's system prompt.

use std::path::Path;

use crate::core::agent::skills;

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

/// Assemble the project system prompt: the optional base prompt, the always-on
/// built-in skills/memory guide, then any project-authored skills. The guide is
/// always present for project runs, so this never returns None.
pub(crate) fn build_system_prompt(base: Option<&str>, project_root: &Path) -> Option<String> {
    let mut blocks: Vec<String> = Vec::new();
    if let Some(b) = base {
        blocks.push(b.to_string());
    }
    blocks.push(DEFAULT_SKILL_GUIDE.trim().to_string());
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
        let out = build_system_prompt(Some("You are Jan."), &root).expect("prompt");
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
        let out = build_system_prompt(None, &root).expect("guide always present");
        assert!(out.contains("Skills and Project Memory"));
        assert!(out.contains("skill_write"));
        assert!(out.contains("memory_write"));

        // Base is preserved and precedes the guide.
        let with_base = build_system_prompt(Some("base"), &root).expect("prompt");
        assert!(with_base.starts_with("base"));
        assert!(with_base.contains("Skills and Project Memory"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
