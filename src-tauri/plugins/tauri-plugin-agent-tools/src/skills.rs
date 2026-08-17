//! Skill storage under `<store_root>/skills/`. A skill is either a folder
//! `<name>/SKILL.md` (SKILL.md-ecosystem compatible; may bundle
//! scripts/resources alongside) or a legacy flat `<name>.md`. Both may carry
//! leading YAML frontmatter (`name`, `description`); the folder form is what
//! new/imported skills are written as.
//!
//! Like memory, every function takes a store root, so skills live in the
//! desktop's permanent store or a project's co-located one. A skill is a
//! reusable procedure, so it must outlive the ephemeral per-thread sandbox.
//!
//! Skills have two invocation sides, matching the SKILL.md ecosystem:
//! `user-invocable: false` hides a skill from the human (slash popup, `/skill:`
//! dispatch) while keeping it model-invocable; `disable-model-invocation: true`
//! hides it from the model (system-prompt catalog, `skill_list`/`skill_read`)
//! while keeping it user-invocable. Default is both sides; setting both keys
//! makes a skill private. `[skills].enabled` stays the orthogonal availability
//! whitelist applied to both sides.
//!
//! Sync (std::fs) so the sync `context::load_skills` and the async `agent_skill_*`
//! commands share one code path; the ops are tiny single-file reads/writes.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::workspace::{store_dir, workspace_filename};

const KIND: &str = "skills";

/// `<store_root>/skills`.
pub fn skills_dir(store: &Path) -> PathBuf {
    store_dir(store, KIND)
}

/// One skill on disk, located by its identity name (folder name or flat stem).
pub struct SkillEntry {
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
    /// Offered in the user-facing invoke surface (slash popup, `/skill:`).
    pub user_invocable: bool,
    /// Offered to the model (system-prompt catalog, `skill_list`/`skill_read`).
    pub model_invocable: bool,
}

/// Frontmatter fields we recognize; everything else is ignored.
#[derive(Debug, Default, Deserialize)]
struct Frontmatter {
    #[allow(dead_code)]
    name: Option<String>,
    description: Option<String>,
    /// Claude Code convention: `user-invocable: false` keeps the skill
    /// model-invocable while hiding it from the human's invoke list.
    #[serde(rename = "user-invocable")]
    user_invocable: Option<bool>,
    /// Matt Pocock's SKILL-MECHANICS convention: `disable-model-invocation:
    /// true` keeps the skill user-invocable while removing its description
    /// from the model's reach (no context load).
    #[serde(rename = "disable-model-invocation")]
    disable_model_invocation: Option<bool>,
}

/// A skill's parsed content: optional frontmatter description + markdown body
/// (body has the frontmatter fence stripped so it never leaks into the prompt).
pub struct ParsedSkill {
    pub description: Option<String>,
    pub body: String,
    pub user_invocable: bool,
    pub model_invocable: bool,
}

/// Split leading `---\n...\n---` YAML frontmatter from the markdown body.
/// Tolerant: no opening/closing fence -> no frontmatter, whole input is body.
pub fn parse(content: &str) -> ParsedSkill {
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    let mut lines = content.lines();
    if lines.next().map(str::trim_end) != Some("---") {
        return ParsedSkill {
            description: None,
            body: content.to_string(),
            user_invocable: true,
            model_invocable: true,
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
            user_invocable: true,
            model_invocable: true,
        };
    }
    let fm = serde_yaml::from_str::<Frontmatter>(&yaml).unwrap_or_default();
    ParsedSkill {
        description: fm.description.map(|d| d.trim().to_string()),
        body: body.join("\n").trim_start_matches('\n').to_string(),
        user_invocable: fm.user_invocable.unwrap_or(true),
        model_invocable: !fm.disable_model_invocation.unwrap_or(false),
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
pub fn safe_stem(name: &str) -> Result<String, String> {
    let file = workspace_filename(name)?;
    Ok(file.trim_end_matches(".md").to_string())
}

/// All skills in the store, sorted by name. Folder skills (`<name>/SKILL.md`)
/// and legacy flat skills (`<name>.md`) are both discovered. When both forms
/// share a name, the folder form wins so a skill is never listed/injected twice.
pub fn discover(store: &Path) -> Vec<SkillEntry> {
    let dir = skills_dir(store);
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
fn resolve(store: &Path, name: &str) -> Result<SkillEntry, String> {
    let stem = safe_stem(name)?;
    let dir = skills_dir(store);
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
pub fn is_enabled(enabled: &[String], name: &str) -> bool {
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

/// A discovered skill's metadata with its invocation flags resolved.
const DEFAULT_JAN_SKILL_NAME: &str = "jan";
const DEFAULT_JAN_SKILL: &str = include_str!("default_jan_skill.md");

/// Whether a name refers to the built-in Jan skill (aliased `jan`), which is
/// always available even with no project skills installed.
fn is_default_jan_skill(name: &str) -> bool {
    safe_stem(name).ok().as_deref() == Some(DEFAULT_JAN_SKILL_NAME)
}
fn default_jan_skill_meta() -> SkillMeta {
    let parsed = parse(DEFAULT_JAN_SKILL);
    SkillMeta {
        name: DEFAULT_JAN_SKILL_NAME.to_string(),
        description: describe(&parsed),
        // The built-in Jan skill is available on both invocation sides: dev's
        // baseline ships it as the model-facing onboarding skill (listed in
        // `skill_list`, body loaded via `skill_read`), and the user may also
        // invoke it directly.
        user_invocable: true,
        model_invocable: true,
    }
}


fn meta_for(name: String, parsed: &ParsedSkill) -> SkillMeta {
    SkillMeta {
        name,
        description: describe(parsed),
        user_invocable: parsed.user_invocable,
        model_invocable: parsed.model_invocable,
    }
}

/// Metadata for every discovered skill (name + description + invocation
/// flags) — for the management UI, which must see disabled and private skills.
/// Keeps empty stubs so the user can see and edit them.
pub fn list_meta(store: &Path) -> Vec<SkillMeta> {
    discover(store)
        .into_iter()
        .filter_map(|e| {
            let parsed = parse(&std::fs::read_to_string(&e.file).ok()?);
            Some(meta_for(e.name, &parsed))
        })
        .collect()
}

/// Filter discovered skills by the `[skills].enabled` whitelist and one
/// invocation side. Skills with neither a description nor a body are skipped
/// (nothing to advertise or invoke).
fn side_catalog(
    root: &Path,
    enabled: &[String],
    side: impl Fn(&ParsedSkill) -> bool,
) -> Vec<SkillMeta> {
    let allow: Option<std::collections::HashSet<&str>> =
        (!enabled.is_empty()).then(|| enabled.iter().map(String::as_str).collect());
    let mut skills = discover(root)
        .into_iter()
        .filter_map(|e| {
            if let Some(allow) = &allow {
                if !allow.contains(e.name.as_str()) {
                    return None;
                }
            }
            let parsed = parse(&std::fs::read_to_string(&e.file).ok()?);
            if !side(&parsed) {
                return None;
            }
            let description = describe(&parsed);
            if description.is_empty() && parsed.body.trim().is_empty() {
                return None;
            }
            Some(meta_for(e.name, &parsed))
        })
        .collect::<Vec<_>>();
    if is_enabled(enabled, DEFAULT_JAN_SKILL_NAME)
        && side(&parse(DEFAULT_JAN_SKILL))
        && !skills
            .iter()
            .any(|skill| skill.name == DEFAULT_JAN_SKILL_NAME)
    {
        skills.push(default_jan_skill_meta());
    }
    skills
}

/// Skills worth advertising in the system prompt: name + description, skipping
/// skills with neither a description nor a body. This is the progressive-
/// disclosure catalog — the model calls `skill_read` to load a body on demand.
/// Skills with `disable-model-invocation: true` are excluded: their
/// description would cost permanent context load, and only the human may fire
/// them (Matt Pocock's SKILL-MECHANICS model-invoked vs user-invoked cut).
///
/// `enabled` is a whitelist of skill names; an empty list means "all skills"
/// (backward-compatible with the agent.toml scaffold, which ships `enabled = []`).
pub(crate) fn catalog(root: &Path, enabled: &[String]) -> Vec<SkillMeta> {
    side_catalog(root, enabled, |p| p.model_invocable)
}

/// Raw SKILL.md text (frontmatter included) for the editor.
pub fn read_raw(store: &Path, name: &str) -> Result<String, String> {
    if is_default_jan_skill(name) {
        return Ok(parse(DEFAULT_JAN_SKILL).body);
    }
    let entry = resolve(store, name)?;
    std::fs::read_to_string(&entry.file).map_err(|e| format!("ERROR: {e}"))
}

/// A skill's markdown body with the frontmatter fence stripped — what the
/// `skill_read` tool hands the model when it loads a skill on demand.
pub fn read_body(store: &Path, name: &str) -> Result<String, String> {
    Ok(parse(&read_raw(store, name)?).body)
}

/// Create or overwrite a skill. Existing skills are written in place (preserving
/// their form); new skills are written as the folder form `<name>/SKILL.md`.
pub fn write(store: &Path, name: &str, content: &str) -> Result<(), String> {
    let stem = safe_stem(name)?;
    let dir = skills_dir(store);
    let folder = dir.join(&stem);
    let folder_skill = folder.join("SKILL.md");
    // Mirror `resolve`/`discover`: the folder form `<name>/SKILL.md` is the
    // canonical one and wins over a legacy flat `<name>.md`. When the folder
    // form is absent we fall back to the flat file if one exists; a fresh skill
    // is created as the folder form. So an edit always lands where the skill
    // will be read back from, instead of updating a stale flat file that
    // `resolve` ignores (which would silently swallow the edit).
    let flat = dir.join(format!("{stem}.md"));
    let target = if folder_skill.is_file() {
        folder_skill
    } else if flat.is_file() {
        flat
    } else {
        std::fs::create_dir_all(&folder).map_err(|e| format!("ERROR: {e}"))?;
        folder_skill
    };
    std::fs::write(&target, content).map_err(|e| format!("ERROR: {e}"))
}

/// Delete a skill (folder or flat form). Idempotent: a missing skill is Ok.
pub fn delete(store: &Path, name: &str) -> Result<(), String> {
    let stem = safe_stem(name)?;
    let dir = skills_dir(store);
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
    fn parse_invocation_flags_from_frontmatter() {
        // Default: both sides.
        let p = parse("---\ndescription: d\n---\nbody");
        assert!(p.user_invocable && p.model_invocable);
        // Claude Code convention: model-only.
        let p = parse("---\ndescription: d\nuser-invocable: false\n---\nbody");
        assert!(!p.user_invocable && p.model_invocable);
        // Matt Pocock convention: user-only.
        let p = parse("---\ndescription: d\ndisable-model-invocation: true\n---\nbody");
        assert!(p.user_invocable && !p.model_invocable);
        // Both set: fully private.
        let p = parse("---\nuser-invocable: false\ndisable-model-invocation: true\n---\nbody");
        assert!(!p.user_invocable && !p.model_invocable);
        // No frontmatter at all: both sides.
        let p = parse("just a body");
        assert!(p.user_invocable && p.model_invocable);
    }

    #[test]
    fn catalog_respects_invocation_flags() {
        let root = std::env::temp_dir().join(format!(
            "jan_skills_sides_{}",
            std::time::SystemTime::UNIX_EPOCH
                .elapsed()
                .unwrap()
                .as_nanos()
        ));
        let dir = skills_dir(&root);
        let write = |name: &str, fm: &str| {
            std::fs::create_dir_all(dir.join(name)).unwrap();
            std::fs::write(
                dir.join(name).join("SKILL.md"),
                format!("---\ndescription: {name} desc\n{fm}---\nbody of {name}"),
            )
            .unwrap();
        };
        write("both", "");
        write("model_only", "user-invocable: false\n");
        write("user_only", "disable-model-invocation: true\n");

        let model: Vec<_> = catalog(&root, &[]).into_iter().map(|m| m.name).collect();
        assert_eq!(model, vec!["both", "model_only", "jan"], "model side: {model:?}");

        // Both flags still visible to the management list.
        let all = list_meta(&root);
        assert_eq!(all.len(), 3);
        assert!(
            !all.iter()
                .find(|m| m.name == "model_only")
                .unwrap()
                .user_invocable
        );
        assert!(
            !all.iter()
                .find(|m| m.name == "user_only")
                .unwrap()
                .model_invocable
        );
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
        assert_eq!(catalog(&root, &[]).len(), 3);

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

    #[test]
    fn write_prefers_folder_form_when_both_exist() {
        // When a folder form and a legacy flat form share a name, `resolve` and
        // `discover` read the folder form. `write` must land on the same file so
        // an edit isn't swallowed into a flat file the reader ignores.
        let root = std::env::temp_dir().join(format!(
            "jan_skills_both_{}",
            std::time::SystemTime::UNIX_EPOCH.elapsed().unwrap().as_nanos()
        ));
        let dir = skills_dir(&root);
        std::fs::create_dir_all(dir.join("dup")).unwrap();
        std::fs::write(dir.join("dup").join("SKILL.md"), "folder").unwrap();
        std::fs::write(dir.join("dup.md"), "flat").unwrap();

        write(&root, "dup", "updated").unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("dup").join("SKILL.md")).unwrap(),
            "updated",
            "the folder form, which resolve reads, must receive the edit"
        );
        assert_eq!(
            std::fs::read_to_string(dir.join("dup.md")).unwrap(),
            "flat",
            "the stale flat form must be left untouched"
        );
        let _ = std::fs::remove_dir_all(&root);
    }
}
