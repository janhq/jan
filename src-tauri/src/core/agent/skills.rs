//! Per-project skill storage. A skill is either a folder `<name>/SKILL.md`
//! (SKILL.md-ecosystem compatible; may bundle scripts/resources alongside) or a
//! legacy flat `<name>.md`. Both may carry leading YAML frontmatter (`name`,
//! `description`); the folder form is what new/imported skills are written as.
//!
//! Sync (std::fs) so the sync `context::load_skills` and the async `agent_skill_*`
//! commands share one code path; the ops are tiny single-file reads/writes.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::core::agent::tools::handlers::workspace_filename;

/// `<project_root>/.jan/agent/skills`.
pub(crate) fn skills_dir(root: &Path) -> PathBuf {
    root.join(".jan").join("agent").join("skills")
}

/// One skill on disk, located by its identity name (folder name or flat stem).
pub(crate) struct SkillEntry {
    pub name: String,
    /// The markdown file to read (the `SKILL.md`, or the flat `<name>.md`).
    pub file: PathBuf,
    /// True for the folder form `<name>/SKILL.md`, false for legacy flat.
    pub is_folder: bool,
}

/// Summary for the management UI / prompt catalog.
#[derive(serde::Serialize)]
pub struct SkillMeta {
    pub name: String,
    pub description: String,
}

/// Frontmatter fields we recognize; everything else is ignored.
#[derive(Debug, Default, Deserialize)]
struct Frontmatter {
    #[allow(dead_code)]
    name: Option<String>,
    description: Option<String>,
}

/// A skill's parsed content: optional frontmatter description + markdown body
/// (body has the frontmatter fence stripped so it never leaks into the prompt).
pub(crate) struct ParsedSkill {
    pub description: Option<String>,
    pub body: String,
}

/// Split leading `---\n...\n---` YAML frontmatter from the markdown body.
/// Tolerant: no opening/closing fence -> no frontmatter, whole input is body.
pub(crate) fn parse(content: &str) -> ParsedSkill {
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    let mut lines = content.lines();
    if lines.next().map(str::trim_end) != Some("---") {
        return ParsedSkill {
            description: None,
            body: content.to_string(),
        };
    }
    let mut yaml = String::new();
    let mut body: Vec<&str> = Vec::new();
    let mut closed = false;
    for line in lines {
        if !closed {
            if line.trim_end() == "---" {
                closed = true;
                continue;
            }
            yaml.push_str(line);
            yaml.push('\n');
        } else {
            body.push(line);
        }
    }
    if !closed {
        // Unterminated fence: treat the whole file as body (no frontmatter).
        return ParsedSkill {
            description: None,
            body: content.to_string(),
        };
    }
    let fm = serde_yaml::from_str::<Frontmatter>(&yaml).unwrap_or_default();
    ParsedSkill {
        description: fm.description.map(|d| d.trim().to_string()),
        body: body.join("\n").trim_start_matches('\n').to_string(),
    }
}

/// First non-empty, non-heading line of `body`, capped at 120 chars. Fallback
/// description when a skill has no frontmatter `description`.
fn first_line(body: &str) -> String {
    body.lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with('#'))
        .unwrap_or("")
        .chars()
        .take(120)
        .collect()
}

/// Sanitized identity stem (no path escape, no `.md`). Reuses the workspace name
/// guard so a caller-supplied name can never escape the skills directory.
pub(crate) fn safe_stem(name: &str) -> Result<String, String> {
    let file = workspace_filename(name)?;
    Ok(file.trim_end_matches(".md").to_string())
}

/// All skills in the project, sorted by name. Folder skills (`<name>/SKILL.md`)
/// and legacy flat skills (`<name>.md`) are both discovered. When both forms
/// share a name, the folder form wins so a skill is never listed/injected twice.
pub(crate) fn discover(root: &Path) -> Vec<SkillEntry> {
    let dir = skills_dir(root);
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    // Keyed by name so a duplicate stem collapses to one entry; BTreeMap also
    // gives the sorted-by-name order for free.
    let mut by_name: std::collections::BTreeMap<String, SkillEntry> = std::collections::BTreeMap::new();
    let mut consider = |entry: SkillEntry| {
        match by_name.get(&entry.name) {
            // Keep an existing folder entry over an incoming flat one.
            Some(existing) if existing.is_folder && !entry.is_folder => {}
            _ => {
                by_name.insert(entry.name.clone(), entry);
            }
        }
    };
    for entry in rd.flatten() {
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            let skill_md = path.join("SKILL.md");
            if skill_md.is_file() {
                if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                    consider(SkillEntry {
                        name: name.to_string(),
                        file: skill_md,
                        is_folder: true,
                    });
                }
            }
        } else if path.extension().and_then(|x| x.to_str()) == Some("md") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                consider(SkillEntry {
                    name: stem.to_string(),
                    file: path,
                    is_folder: false,
                });
            }
        }
    }
    let mut out: Vec<SkillEntry> = by_name.into_values().collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Locate an existing skill by name, preferring the folder form.
fn resolve(root: &Path, name: &str) -> Result<SkillEntry, String> {
    let stem = safe_stem(name)?;
    let dir = skills_dir(root);
    let folder = dir.join(&stem).join("SKILL.md");
    if folder.is_file() {
        return Ok(SkillEntry {
            name: stem,
            file: folder,
            is_folder: true,
        });
    }
    let flat = dir.join(format!("{stem}.md"));
    if flat.is_file() {
        return Ok(SkillEntry {
            name: stem,
            file: flat,
            is_folder: false,
        });
    }
    Err(format!("ERROR: skill '{name}' not found"))
}

/// Whether a skill is advertised given the `[skills].enabled` whitelist. An
/// empty whitelist means every skill is enabled.
pub(crate) fn is_enabled(enabled: &[String], name: &str) -> bool {
    enabled.is_empty() || enabled.iter().any(|n| n == name)
}

/// A skill's summary line: the frontmatter `description`, or the first body line.
fn describe(parsed: &ParsedSkill) -> String {
    parsed
        .description
        .clone()
        .filter(|d| !d.is_empty())
        .unwrap_or_else(|| first_line(&parsed.body))
}

/// Metadata for every discovered skill (name + description) — for the UI list.
/// Keeps empty stubs so the user can see and edit them.
#[cfg(any(not(feature = "cli"), test))]
pub(crate) fn list_meta(root: &Path) -> Vec<SkillMeta> {
    discover(root)
        .into_iter()
        .filter_map(|e| {
            let parsed = parse(&std::fs::read_to_string(&e.file).ok()?);
            Some(SkillMeta {
                name: e.name,
                description: describe(&parsed),
            })
        })
        .collect()
}

/// Skills worth advertising in the system prompt: name + description, skipping
/// skills with neither a description nor a body. This is the progressive-
/// disclosure catalog — the model calls `skill_read` to load a body on demand.
///
/// `enabled` is a whitelist of skill names; an empty list means "all skills"
/// (backward-compatible with the agent.toml scaffold, which ships `enabled = []`).
pub(crate) fn catalog(root: &Path, enabled: &[String]) -> Vec<SkillMeta> {
    let allow: Option<std::collections::HashSet<&str>> =
        (!enabled.is_empty()).then(|| enabled.iter().map(String::as_str).collect());
    discover(root)
        .into_iter()
        .filter_map(|e| {
            if let Some(allow) = &allow {
                if !allow.contains(e.name.as_str()) {
                    return None;
                }
            }
            let parsed = parse(&std::fs::read_to_string(&e.file).ok()?);
            let description = describe(&parsed);
            if description.is_empty() && parsed.body.trim().is_empty() {
                return None;
            }
            Some(SkillMeta {
                name: e.name,
                description,
            })
        })
        .collect()
}

/// Raw SKILL.md text (frontmatter included) for the editor.
pub(crate) fn read_raw(root: &Path, name: &str) -> Result<String, String> {
    let entry = resolve(root, name)?;
    std::fs::read_to_string(&entry.file).map_err(|e| format!("ERROR: {e}"))
}

/// A skill's markdown body with the frontmatter fence stripped — what the
/// `skill_read` tool hands the model when it loads a skill on demand.
pub(crate) fn read_body(root: &Path, name: &str) -> Result<String, String> {
    Ok(parse(&read_raw(root, name)?).body)
}

/// Parse a `/skill:<name>` invocation in a user draft.
///
/// Returns `(name, args)` for:
///   - the leading form (`/skill:deploy staging` -> `deploy`, `staging`), and
///   - a mid-prompt token (`fix the bug /skill:deploy focus on auth` ->
///     `deploy`, with the surrounding prose collapsed into `args`).
///
/// Mid-prompt detection is skipped when the draft starts with another slash
/// command (`/compact /skill:foo` is a command argument, not an invocation) or
/// a local-execution sigil (`!cmd` / `$ cmd`), whose bodies routinely contain
/// `/skill:` references that are not meant as skill invocations.
pub(crate) fn parse_invocation(text: &str) -> Option<(String, String)> {
    let trimmed = text.trim_start();
    if let Some(rest) = trimmed.strip_prefix("/skill:") {
        let name = rest.split_whitespace().next()?;
        if name.is_empty() {
            return None;
        }
        let args = rest[name.len()..].trim();
        return Some((name.to_string(), args.to_string()));
    }
    if trimmed.starts_with('/') || trimmed.starts_with('!') || trimmed.starts_with('$') {
        return None;
    }
    // Mid-prompt: `/skill:<name>` preceded by start/space and followed by
    // space/end. The name excludes `/` so a path like `/skill:foo/bar` is not
    // an invocation.
    let bytes = text.as_bytes();
    let mut search_from = 0;
    while search_from < text.len() {
        let Some(rel) = text[search_from..].find("/skill:") else {
            return None;
        };
        let start = search_from + rel;
        let prev_ok = start == 0 || bytes[start - 1].is_ascii_whitespace();
        let after = start + "/skill:".len();
        let name_end = text[after..]
            .find(|c: char| c.is_whitespace() || c == '/')
            .map(|i| after + i)
            .unwrap_or(text.len());
        let name = &text[after..name_end];
        let next_ok = name_end == text.len()
            || text[name_end..]
                .chars()
                .next()
                .is_some_and(char::is_whitespace);
        if prev_ok && next_ok && !name.is_empty() {
            let before = text[..start].trim_end();
            let after_part = text[name_end..].trim_start();
            let args = [before, after_part]
                .into_iter()
                .filter(|p| !p.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            return Some((name.to_string(), args));
        }
        search_from = (start + 1).max(name_end);
    }
    None
}

/// Build the user message for invoking an enabled skill: the full skill body
/// (frontmatter stripped) wrapped in an invocation header, the skill's
/// directory announced so bundled files resolve relative paths, and the user's
/// `args` threaded in. Returns `(message, description)`; `Err` when the skill
/// is unknown or disabled (same visibility rules as the `skill_read` tool).
pub(crate) fn build_invocation_message(
    root: &Path,
    name: &str,
    args: &str,
) -> Result<(String, String), String> {
    let enabled = crate::core::agent::project::load_agent_config(root)
        .ok()
        .map(|c| c.skills.enabled)
        .unwrap_or_default();
    let meta = catalog(root, &enabled)
        .into_iter()
        .find(|m| m.name == name)
        .ok_or_else(|| format!("skill '{name}' not found"))?;
    let body = read_body(root, name)?;
    let args = args.trim();
    let mut msg = format!(
        "[IMPORTANT: You have invoked the \"{name}\" skill - follow its instructions. The full skill content is loaded below.]\n\n{body}"
    );
    let base = skills_dir(root).join(name);
    if base.is_dir() {
        msg.push_str(&format!(
            "\n\n---\n[Skill directory: {}]\nResolve relative paths in the skill against that directory.\n",
            base.display()
        ));
    }
    if !args.is_empty() {
        msg.push_str(&format!("User: {args}\n"));
    }
    Ok((msg, meta.description))
}

/// Create or overwrite a skill. Existing skills are written in place (preserving
/// their form); new skills are written as the folder form `<name>/SKILL.md`.
pub(crate) fn write(root: &Path, name: &str, content: &str) -> Result<(), String> {
    let stem = safe_stem(name)?;
    let dir = skills_dir(root);
    let flat = dir.join(format!("{stem}.md"));
    let target = if flat.is_file() {
        flat
    } else {
        let folder = dir.join(&stem);
        std::fs::create_dir_all(&folder).map_err(|e| format!("ERROR: {e}"))?;
        folder.join("SKILL.md")
    };
    std::fs::write(&target, content).map_err(|e| format!("ERROR: {e}"))
}

/// Delete a skill (folder or flat form). Idempotent: a missing skill is Ok.
#[cfg(any(not(feature = "cli"), test))]
pub(crate) fn delete(root: &Path, name: &str) -> Result<(), String> {
    let stem = safe_stem(name)?;
    let dir = skills_dir(root);
    let folder = dir.join(&stem);
    let flat = dir.join(format!("{stem}.md"));
    if folder.is_dir() {
        std::fs::remove_dir_all(&folder).map_err(|e| format!("ERROR: {e}"))
    } else if flat.is_file() {
        std::fs::remove_file(&flat).map_err(|e| format!("ERROR: {e}"))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_extracts_description_and_strips_frontmatter() {
        let p = parse("---\nname: deploy\ndescription: Ship it\n---\n\nRun the script.");
        assert_eq!(p.description.as_deref(), Some("Ship it"));
        assert_eq!(p.body, "Run the script.");
    }

    #[test]
    fn parse_without_frontmatter_returns_whole_body() {
        let p = parse("Just a body.\nMore.");
        assert!(p.description.is_none());
        assert_eq!(p.body, "Just a body.\nMore.");
    }

    #[test]
    fn parse_unterminated_fence_is_all_body() {
        let p = parse("---\nname: x\nbody without close");
        assert!(p.description.is_none());
        assert!(p.body.starts_with("---"));
    }

    #[test]
    fn discover_finds_folder_and_flat_skills_sorted() {
        let root = std::env::temp_dir().join(format!(
            "jan_skills_test_{}",
            std::time::SystemTime::UNIX_EPOCH.elapsed().unwrap().as_nanos()
        ));
        let dir = skills_dir(&root);
        std::fs::create_dir_all(dir.join("b_folder")).unwrap();
        std::fs::write(dir.join("b_folder").join("SKILL.md"), "folder body").unwrap();
        std::fs::write(dir.join("a_flat.md"), "flat body").unwrap();

        let names: Vec<_> = discover(&root).into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["a_flat", "b_folder"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn write_new_creates_folder_form_read_delete_roundtrip() {
        let root = std::env::temp_dir().join(format!(
            "jan_skills_rt_{}",
            std::time::SystemTime::UNIX_EPOCH.elapsed().unwrap().as_nanos()
        ));
        write(&root, "deploy", "---\ndescription: d\n---\nbody").unwrap();
        assert!(skills_dir(&root).join("deploy").join("SKILL.md").is_file());

        let meta = list_meta(&root);
        assert_eq!(meta.len(), 1);
        assert_eq!(meta[0].name, "deploy");
        assert_eq!(meta[0].description, "d");

        assert!(read_raw(&root, "deploy").unwrap().contains("body"));
        delete(&root, "deploy").unwrap();
        assert!(!skills_dir(&root).join("deploy").exists());
        delete(&root, "deploy").unwrap(); // idempotent
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn parse_invocation_leading_and_mid_prompt_forms() {
        // Leading form: name + args.
        let (name, args) = parse_invocation("/skill:deploy staging --force").unwrap();
        assert_eq!(name, "deploy");
        assert_eq!(args, "staging --force");
        // Bare leading form.
        let (name, args) = parse_invocation("/skill:deploy").unwrap();
        assert_eq!(name, "deploy");
        assert_eq!(args, "");
        // Mid-prompt: surrounding prose collapses into args.
        let (name, args) = parse_invocation("fix the auth flow /skill:deploy focus on security").unwrap();
        assert_eq!(name, "deploy");
        assert_eq!(args, "fix the auth flow focus on security");
        // Token at the end: only the prose before it.
        let (name, args) = parse_invocation("fix the auth flow /skill:deploy").unwrap();
        assert_eq!(name, "deploy");
        assert_eq!(args, "fix the auth flow");
        // Trailing token with nothing before.
        let (name, args) = parse_invocation("/skill:deploy harden").unwrap();
        assert_eq!(name, "deploy");
        assert_eq!(args, "harden");
    }

    #[test]
    fn parse_invocation_skips_commands_sigils_and_paths() {
        // Another slash command takes precedence.
        assert!(parse_invocation("/compact /skill:deploy").is_none());
        // Local-execution sigils pass through.
        assert!(parse_invocation("!run /skill:deploy now").is_none());
        assert!(parse_invocation("$ python /skill:deploy.py").is_none());
        // A path-like token is not an invocation.
        assert!(parse_invocation("see /skill:foo/bar for details").is_none());
        // Unknown/plain text has no token.
        assert!(parse_invocation("just some words").is_none());
    }

    #[test]
    fn build_invocation_message_injects_body_and_args() {
        let root = std::env::temp_dir().join(format!(
            "jan_skills_inv_{}",
            std::time::SystemTime::UNIX_EPOCH.elapsed().unwrap().as_nanos()
        ));
        std::fs::create_dir_all(skills_dir(&root).join("deploy")).unwrap();
        std::fs::write(
            skills_dir(&root).join("deploy").join("SKILL.md"),
            "---\ndescription: Ship it\n---\n\n# Deploy\n\nRun the script.\n",
        )
        .unwrap();

        let (msg, description) = build_invocation_message(&root, "deploy", "staging").unwrap();
        assert_eq!(description, "Ship it");
        assert!(msg.contains("You have invoked the \"deploy\" skill"), "{msg}");
        assert!(msg.contains("# Deploy\n\nRun the script."), "body: {msg}");
        assert!(msg.contains("Skill directory:"), "folder announced: {msg}");
        assert!(msg.contains("User: staging"), "{msg}");

        // Unknown or disabled skills are rejected.
        assert!(build_invocation_message(&root, "nope", "").is_err());
        std::fs::write(
            root.join(".jan").join("agent").join("agent.toml"),
            "[skills]\nenabled = [\"other\"]\n",
        )
        .unwrap();
        assert!(build_invocation_message(&root, "deploy", "").is_err(), "disabled");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn catalog_enabled_whitelist_filters() {
        let root = std::env::temp_dir().join(format!(
            "jan_skills_wl_{}",
            std::time::SystemTime::UNIX_EPOCH.elapsed().unwrap().as_nanos()
        ));
        write(&root, "a", "body a").unwrap();
        write(&root, "b", "body b").unwrap();

        // Empty whitelist = all skills.
        assert_eq!(catalog(&root, &[]).len(), 2);

        // Non-empty whitelist restricts to the listed names.
        let only_a = catalog(&root, &["a".to_string()]);
        assert_eq!(only_a.len(), 1);
        assert_eq!(only_a[0].name, "a");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn write_existing_flat_stays_flat() {
        let root = std::env::temp_dir().join(format!(
            "jan_skills_flat_{}",
            std::time::SystemTime::UNIX_EPOCH.elapsed().unwrap().as_nanos()
        ));
        let dir = skills_dir(&root);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("legacy.md"), "old").unwrap();

        write(&root, "legacy", "new").unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("legacy.md")).unwrap(), "new");
        assert!(!dir.join("legacy").exists());
        let _ = std::fs::remove_dir_all(&root);
    }
}
