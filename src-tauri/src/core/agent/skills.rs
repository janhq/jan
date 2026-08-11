//! Per-project skill storage. A skill is either a folder `<name>/SKILL.md`
//! (SKILL.md-ecosystem compatible; may bundle scripts/resources alongside) or a
//! legacy flat `<name>.md`. Both may carry leading YAML frontmatter (`name`,
//! `description`); the folder form is what new/imported skills are written as.
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

use tauri_plugin_agent_tools::workspace::workspace_filename;

/// `<project_root>/.jan/agent/skills`.
pub(crate) fn skills_dir(root: &Path) -> PathBuf {
    root.join(".jan").join("agent").join("skills")
}

/// One skill on disk, located by its identity name (folder name or flat stem).
#[derive(Debug, Clone)]
pub(crate) struct SkillEntry {
    pub name: String,
    /// The markdown file to read (the `SKILL.md`, or the flat `<name>.md`).
    pub file: PathBuf,
    /// True for the folder form `<name>/SKILL.md`, false for legacy flat.
    pub is_folder: bool,
    /// The plugin this skill ships in (`Some`), or `None` for a project skill.
    pub plugin: Option<String>,
}

/// Summary for the management UI / prompt catalog.
#[derive(Clone, serde::Serialize)]
pub struct SkillMeta {
    pub name: String,
    pub description: String,
    /// The plugin this skill ships in, `None` for a project skill. Plugin
    /// skills are named `<plugin>:<skill>`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin: Option<String>,
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
pub(crate) struct ParsedSkill {
    pub description: Option<String>,
    pub body: String,
    pub user_invocable: bool,
    pub model_invocable: bool,
}

/// Split leading `---\n...\n---` YAML frontmatter from a markdown body.
/// Tolerant: no opening fence or an unterminated fence yields `(None, whole
/// input)`. Shared by skill, plugin-command, and plugin-agent parsing so the
/// fence rules never drift between the three.
pub(crate) fn split_frontmatter(content: &str) -> (Option<String>, String) {
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    let mut lines = content.lines();
    if lines.next().map(str::trim_end) != Some("---") {
        return (None, content.to_string());
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
        return (None, content.to_string());
    }
    (Some(yaml), body.join("\n").trim_start_matches('\n').to_string())
}

pub(crate) fn parse(content: &str) -> ParsedSkill {
    let (yaml, body) = split_frontmatter(content);
    let Some(yaml) = yaml else {
        return ParsedSkill {
            description: None,
            body,
            user_invocable: true,
            model_invocable: true,
        };
    };
    let fm = serde_yaml::from_str::<Frontmatter>(&yaml).unwrap_or_default();
    ParsedSkill {
        description: fm.description.map(|d| d.trim().to_string()),
        body,
        user_invocable: fm.user_invocable.unwrap_or(true),
        model_invocable: !fm.disable_model_invocation.unwrap_or(false),
    }
}

/// First non-empty, non-heading line of `body`, capped at 120 chars. Fallback
/// description when a skill has no frontmatter `description`.
pub(crate) fn first_line(body: &str) -> String {
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

/// Scan one skills directory for folder skills (`<name>/SKILL.md`) and legacy
/// flat skills (`<name>.md`), sorted by name. When both forms share a name,
/// the folder form wins so a skill is never listed/injected twice. Entries
/// come back with `plugin: None`; the caller tags plugin-owned entries.
pub(crate) fn scan_skill_dir(dir: &Path) -> Vec<SkillEntry> {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    // Keyed by name so a duplicate stem collapses to one entry; BTreeMap also
    // gives the sorted-by-name order for free.
    let mut by_name: std::collections::BTreeMap<String, SkillEntry> =
        std::collections::BTreeMap::new();
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
                        plugin: None,
                    });
                }
            }
        } else if path.extension().and_then(|x| x.to_str()) == Some("md") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                consider(SkillEntry {
                    name: stem.to_string(),
                    file: path,
                    is_folder: false,
                    plugin: None,
                });
            }
        }
    }
    let mut out: Vec<SkillEntry> = by_name.into_values().collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// All project skills (`.jan/agent/skills`), sorted by name.
pub(crate) fn discover(root: &Path) -> Vec<SkillEntry> {
    scan_skill_dir(&skills_dir(root))
}

/// The plugins directory `.jan/agent/plugins`.
pub(crate) fn plugins_dir(root: &Path) -> PathBuf {
    root.join(".jan").join("agent").join("plugins")
}

/// Recursively yield every `*.md` file under `dir`, skipping dotfiles and
/// `README` files (any case). Callers read each file themselves so read-failure
/// handling stays with them. Shared by plugin command and plugin agent
/// discovery.
pub(crate) fn walk_markdown_files(dir: &Path, visit: &mut dyn FnMut(&Path)) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in rd.flatten() {
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            walk_markdown_files(&path, visit);
            continue;
        }
        if !ft.is_file() || path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if file_name.starts_with('.') {
            continue;
        }
        if path
            .file_stem()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.eq_ignore_ascii_case("README"))
        {
            continue;
        }
        visit(&path);
    }
}

/// The machine-generated wrapper line for a skill/command invocation message.
/// `cli::invocation_label` parses exactly this shape back into a compact
/// transcript label on resume, so every producer uses this one helper and the
/// parser's expectations cannot silently drift from what is written.
pub(crate) fn invocation_wrapper(name: &str, kind: &str) -> String {
    format!(
        "[IMPORTANT: You have invoked the \"{name}\" {kind} - follow its instructions. The full {kind} content is loaded below.]"
    )
}

/// Skills shipped by installed plugins, qualified with their plugin name.
/// Each installed plugin is scanned conventionally: a `skills/` subdirectory
/// (folder and flat forms, same rules as project skills) plus an optional
/// single `SKILL.md` at the plugin root (a repo that is itself one skill).
pub(crate) fn discover_plugins(root: &Path) -> Vec<SkillEntry> {
    let dir = plugins_dir(root);
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out: Vec<SkillEntry> = Vec::new();
    for entry in rd.flatten() {
        let path = entry.path();
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let Some(plugin) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        let mut tagged = Vec::new();
        for e in scan_skill_dir(&path.join("skills")) {
            tagged.push(SkillEntry {
                plugin: Some(plugin.to_string()),
                ..e
            });
        }
        let root_md = path.join("SKILL.md");
        if root_md.is_file() {
            tagged.push(SkillEntry {
                name: plugin.to_string(),
                file: root_md,
                is_folder: false,
                plugin: Some(plugin.to_string()),
            });
        }
        out.extend(tagged);
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Project skills followed by plugin skills (qualified). Project skills shadow
/// plugin skills of the same plain name.
pub(crate) fn discover_all(root: &Path) -> Vec<SkillEntry> {
    let mut out = discover(root);
    out.extend(discover_plugins(root));
    out
}

/// The user-facing identity of a skill entry: `name` for project skills,
/// `<plugin>:<name>` for plugin skills.
pub(crate) fn qualified_name(entry: &SkillEntry) -> String {
    match &entry.plugin {
        Some(plugin) => format!("{plugin}:{}", entry.name),
        None => entry.name.clone(),
    }
}

/// Locate a project skill by name, preferring the folder form. Plugin skills
/// are not resolved here — `resolve_readable` handles those.
fn resolve(root: &Path, name: &str) -> Result<SkillEntry, String> {
    let stem = safe_stem(name)?;
    let dir = skills_dir(root);
    let folder = dir.join(&stem).join("SKILL.md");
    if folder.is_file() {
        return Ok(SkillEntry {
            name: stem,
            file: folder,
            is_folder: true,
            plugin: None,
        });
    }
    let flat = dir.join(format!("{stem}.md"));
    if flat.is_file() {
        return Ok(SkillEntry {
            name: stem,
            file: flat,
            is_folder: false,
            plugin: None,
        });
    }
    Err(format!("ERROR: skill '{name}' not found"))
}

/// Locate a skill inside an installed plugin: `plugins/<plugin>/skills/<plain>`
/// (folder or flat) plus the single-skill case `<plugin>/SKILL.md` when the
/// plain name equals the plugin name. Both names are stem-validated so a
/// caller-supplied name can never escape the plugins directory.
fn resolve_in_plugin(root: &Path, plugin: &str, plain: &str) -> Option<SkillEntry> {
    if safe_stem(plugin).ok()? != plugin || safe_stem(plain).ok()? != plain {
        return None;
    }
    let base = plugins_dir(root).join(plugin);
    let folder = base.join("skills").join(plain).join("SKILL.md");
    if folder.is_file() {
        return Some(SkillEntry {
            name: plain.to_string(),
            file: folder,
            is_folder: true,
            plugin: Some(plugin.to_string()),
        });
    }
    let flat = base.join("skills").join(format!("{plain}.md"));
    if flat.is_file() {
        return Some(SkillEntry {
            name: plain.to_string(),
            file: flat,
            is_folder: false,
            plugin: Some(plugin.to_string()),
        });
    }
    if plain == plugin {
        let root_md = base.join("SKILL.md");
        if root_md.is_file() {
            return Some(SkillEntry {
                name: plain.to_string(),
                file: root_md,
                is_folder: false,
                plugin: Some(plugin.to_string()),
            });
        }
    }
    None
}

/// Locate any readable skill: project skill first (project shadows plugins),
/// then the explicit `<plugin>:<plain>` form, then a plain name that is unique
/// across installed plugins. Used by `read_raw`/`read_body` so `skill_read`
/// and invocation dispatch reach plugin skills with the same names the
/// catalogs advertise.
pub(crate) fn resolve_readable(root: &Path, name: &str) -> Result<SkillEntry, String> {
    if let Ok(entry) = resolve(root, name) {
        return Ok(entry);
    }
    if let Some((plugin, plain)) = name.split_once(':') {
        if let Some(entry) = resolve_in_plugin(root, plugin, plain) {
            return Ok(entry);
        }
    }
    let mut matches = discover_plugins(root)
        .into_iter()
        .filter(|e| e.name == name);
    match (matches.next(), matches.next()) {
        (Some(only), None) => Ok(only),
        _ => Err(format!("ERROR: skill '{name}' not found")),
    }
}

/// Whether a skill is advertised given the `[skills].enabled` whitelist. An
/// empty whitelist means every skill is enabled; matching accepts the
/// qualified `<plugin>:<skill>` name, the plain skill name, or the plugin
/// name alone (enables every skill a plugin ships).
pub(crate) fn is_enabled(enabled: &[String], entry: &SkillEntry) -> bool {
    if enabled.is_empty() {
        return true;
    }
    let qualified = qualified_name(entry);
    enabled
        .iter()
        .any(|n| n == &qualified || n == &entry.name || Some(n) == entry.plugin.as_ref())
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
fn meta_for(entry: &SkillEntry, parsed: &ParsedSkill) -> SkillMeta {
    SkillMeta {
        name: qualified_name(entry),
        description: describe(parsed),
        plugin: entry.plugin.clone(),
        user_invocable: parsed.user_invocable,
        model_invocable: parsed.model_invocable,
    }
}

/// Metadata for every project skill (name + description + invocation
/// flags) — for the management UI, which must see disabled and private skills
/// and only edits project skills (plugin skills are managed via plugins).
/// Keeps empty stubs so the user can see and edit them.
#[cfg(any(not(feature = "cli"), test))]
pub(crate) fn list_meta(root: &Path) -> Vec<SkillMeta> {
    discover(root)
        .into_iter()
        .filter_map(|e| {
            let parsed = parse(&std::fs::read_to_string(&e.file).ok()?);
            Some(meta_for(&e, &parsed))
        })
        .collect()
}

/// Filter discovered skills (project + plugins) by the `[skills].enabled`
/// whitelist and one invocation side. Skills with neither a description nor a
/// body are skipped (nothing to advertise or invoke).
fn side_catalog(
    root: &Path,
    enabled: &[String],
    side: impl Fn(&ParsedSkill) -> bool,
) -> Vec<SkillMeta> {
    discover_all(root)
        .into_iter()
        .filter(|e| is_enabled(enabled, e))
        .filter_map(|e| {
            let parsed = parse(&std::fs::read_to_string(&e.file).ok()?);
            if !side(&parsed) {
                return None;
            }
            let description = describe(&parsed);
            if description.is_empty() && parsed.body.trim().is_empty() {
                return None;
            }
            Some(meta_for(&e, &parsed))
        })
        .collect()
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

/// User-invocable skills: what the slash popup offers and `/skill:<name>`
/// dispatches. Skills with `user-invocable: false` (Claude Code convention)
/// are excluded — the human must not be able to fire them; the agent still
/// can. Both sides of the popup share this list.
pub(crate) fn user_catalog(root: &Path, enabled: &[String]) -> Vec<SkillMeta> {
    side_catalog(root, enabled, |p| p.user_invocable)
}

/// Metadata for every skill one plugin ships (both invocation sides), for the
/// `/plugin list` view. The enabled whitelist is intentionally ignored here:
/// the management view shows what the plugin contributes, not what is active.
#[cfg(feature = "cli")]
pub(crate) fn plugin_skill_metas(root: &Path, plugin: &str) -> Vec<SkillMeta> {
    let mut metas = side_catalog(root, &[], |_| true);
    metas.retain(|m| m.plugin.as_deref() == Some(plugin));
    metas
}

/// Raw SKILL.md text (frontmatter included) for the editor. Resolves project
/// and plugin skills alike.
#[cfg(any(not(feature = "cli"), test))]
pub(crate) fn read_raw(root: &Path, name: &str) -> Result<String, String> {
    let entry = resolve_readable(root, name)?;
    std::fs::read_to_string(&entry.file).map_err(|e| format!("ERROR: {e}"))
}

/// A skill's markdown body with the frontmatter fence stripped — what the
/// `skill_read` tool hands the model when it loads a skill on demand.
#[cfg(any(not(feature = "cli"), test))]
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

/// Build the user message for invoking a user-invocable skill (`/skill:<name>` /
/// `<skill>` semantics shared with the console): the full skill body
/// (frontmatter stripped) wrapped in an invocation header, the skill's
/// directory announced so bundled files resolve relative paths, and the user's
/// `args` threaded in. Returns `(message, description)`; `Err` when the skill
/// is unknown, disabled, or not user-invocable (same visibility rules as the
/// slash popup; the opposite side of the `skill_read` tool).
pub(crate) fn build_invocation_message(
    root: &Path,
    name: &str,
    args: &str,
) -> Result<(String, String), String> {
    let enabled = crate::core::agent::project::load_agent_config(root)
        .ok()
        .map(|c| c.skills.enabled)
        .unwrap_or_default();
    let user_skills = user_catalog(root, &enabled);
    let meta =
        find_user_skill(&user_skills, name).ok_or_else(|| format!("skill '{name}' not found"))?;
    let entry = resolve_readable(root, name)?;
    let body =
        parse(&std::fs::read_to_string(&entry.file).map_err(|e| format!("ERROR: {e}"))?).body;
    let args = args.trim();
    let mut msg = format!(
        "{}\n\n{body}",
        invocation_wrapper(name, "skill")
    );
    // Folder skills (and single-skill plugins) may bundle files next to their
    // SKILL.md; announce that directory so relative paths resolve.
    if entry.is_folder {
        let base = entry.file.parent().unwrap_or_else(|| root);
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

/// Find a skill in a user-side catalog by the name a human typed: exact
/// match first (project names and the explicit `<plugin>:<skill>` form), then
/// a plain name that is unique across plugin skills.
fn find_user_skill(user_skills: &[SkillMeta], name: &str) -> Option<SkillMeta> {
    if let Some(meta) = user_skills.iter().find(|m| m.name == name).cloned() {
        return Some(meta);
    }
    let mut matches = user_skills
        .iter()
        .filter(|m| m.plugin.is_some() && m.name.rsplit_once(':').map(|(_, s)| s) == Some(name));
    let first = matches.next()?.clone();
    matches.next().is_none().then_some(first)
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
            std::time::SystemTime::UNIX_EPOCH
                .elapsed()
                .unwrap()
                .as_nanos()
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
            std::time::SystemTime::UNIX_EPOCH
                .elapsed()
                .unwrap()
                .as_nanos()
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
        let (name, args) =
            parse_invocation("fix the auth flow /skill:deploy focus on security").unwrap();
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
    fn catalog_and_user_catalog_split_invocation_sides() {
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
        assert_eq!(model, vec!["both", "model_only"], "model side: {model:?}");
        let user: Vec<_> = user_catalog(&root, &[])
            .into_iter()
            .map(|m| m.name)
            .collect();
        assert_eq!(user, vec!["both", "user_only"], "user side: {user:?}");

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

        // User invocation refuses model-only skills.
        assert!(build_invocation_message(&root, "model_only", "").is_err());
        assert!(build_invocation_message(&root, "user_only", "").is_ok());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn build_invocation_message_injects_body_and_args() {
        let root = std::env::temp_dir().join(format!(
            "jan_skills_inv_{}",
            std::time::SystemTime::UNIX_EPOCH
                .elapsed()
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(skills_dir(&root).join("deploy")).unwrap();
        std::fs::write(
            skills_dir(&root).join("deploy").join("SKILL.md"),
            "---\ndescription: Ship it\n---\n\n# Deploy\n\nRun the script.\n",
        )
        .unwrap();

        let (msg, description) = build_invocation_message(&root, "deploy", "staging").unwrap();
        assert_eq!(description, "Ship it");
        assert!(
            msg.contains("You have invoked the \"deploy\" skill"),
            "{msg}"
        );
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
        assert!(
            build_invocation_message(&root, "deploy", "").is_err(),
            "disabled"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn catalog_enabled_whitelist_filters() {
        let root = std::env::temp_dir().join(format!(
            "jan_skills_wl_{}",
            std::time::SystemTime::UNIX_EPOCH
                .elapsed()
                .unwrap()
                .as_nanos()
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
            std::time::SystemTime::UNIX_EPOCH
                .elapsed()
                .unwrap()
                .as_nanos()
        ));
        let dir = skills_dir(&root);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("legacy.md"), "old").unwrap();

        write(&root, "legacy", "new").unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.join("legacy.md")).unwrap(),
            "new"
        );
        assert!(!dir.join("legacy").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    fn temp_root(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "jan_pluginskills_{tag}_{}",
            std::time::SystemTime::UNIX_EPOCH
                .elapsed()
                .unwrap()
                .as_nanos()
        ))
    }

    /// A folder skill inside an installed plugin.
    fn plugin_skill(root: &std::path::Path, plugin: &str, name: &str, body: &str) {
        let dir = plugins_dir(root).join(plugin).join("skills").join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("SKILL.md"), body).unwrap();
    }

    /// A single-skill plugin: `SKILL.md` at the plugin root.
    fn single_plugin(root: &std::path::Path, plugin: &str, body: &str) {
        let dir = plugins_dir(root).join(plugin);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("SKILL.md"), body).unwrap();
    }

    /// A project folder skill.
    fn project_skill(root: &std::path::Path, name: &str, body: &str) {
        let dir = skills_dir(root).join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("SKILL.md"), body).unwrap();
    }

    #[test]
    fn discover_all_tags_plugin_skills_and_single_skill_plugins() {
        let root = temp_root("disc");
        project_skill(&root, "deploy", "---\ndescription: d\n---\nproj body\n");
        plugin_skill(
            &root,
            "release",
            "prepare",
            "---\ndescription: prep\n---\nrel body\n",
        );
        plugin_skill(&root, "release", "changelog", "flat body");
        single_plugin(
            &root,
            "triage",
            "---\ndescription: triage\n---\ntriage body\n",
        );

        let entries = discover_all(&root);
        let names: Vec<(String, Option<String>)> = entries
            .iter()
            .map(|e| (qualified_name(e), e.plugin.clone()))
            .collect();
        assert_eq!(
            names,
            vec![
                ("deploy".to_string(), None),
                ("release:changelog".to_string(), Some("release".to_string())),
                ("release:prepare".to_string(), Some("release".to_string())),
                ("triage:triage".to_string(), Some("triage".to_string())),
            ]
        );
        // Project-only discovery stays project-only.
        let project_names: Vec<_> = discover(&root).into_iter().map(|e| e.name).collect();
        assert_eq!(project_names, vec!["deploy"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_readable_project_shadows_plugin_and_qualified_form_wins() {
        let root = temp_root("prec");
        project_skill(&root, "deploy", "proj\n");
        plugin_skill(&root, "release", "deploy", "plugin\n");

        // Plain name resolves to the project skill (project shadows plugins).
        let entry = resolve_readable(&root, "deploy").unwrap();
        assert_eq!(entry.plugin, None);
        // Explicit qualified form reaches the plugin copy.
        let entry = resolve_readable(&root, "release:deploy").unwrap();
        assert_eq!(entry.plugin.as_deref(), Some("release"));
        assert_eq!(entry.name, "deploy");
        assert!(entry.is_folder);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_readable_unique_plain_name_and_ambiguity() {
        let root = temp_root("ambig");
        plugin_skill(&root, "release", "prepare", "rel\n");
        plugin_skill(&root, "triage", "prepare", "tri\n");
        plugin_skill(&root, "triage", "labels", "lab\n");

        // Duplicated plain name across plugins is ambiguous.
        let err = resolve_readable(&root, "prepare").unwrap_err();
        assert!(err.contains("not found"), "{err}");
        // Qualified forms both work.
        assert!(resolve_readable(&root, "release:prepare").is_ok());
        assert!(resolve_readable(&root, "triage:prepare").is_ok());
        // A plain name unique across plugins resolves.
        let entry = resolve_readable(&root, "labels").unwrap();
        assert_eq!(entry.plugin.as_deref(), Some("triage"));
        // Single-skill plugin: the plugin name itself resolves.
        single_plugin(&root, "triage", "---\ndescription: t\n---\nbody\n");
        let entry = resolve_readable(&root, "triage").unwrap();
        assert_eq!(entry.plugin.as_deref(), Some("triage"));
        assert_eq!(entry.name, "triage");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn catalog_and_user_catalog_include_plugin_skills_with_flags() {
        let root = temp_root("cat");
        project_skill(&root, "deploy", "---\ndescription: ship\n---\nbody\n");
        plugin_skill(
            &root,
            "release",
            "prepare",
            "---\ndescription: prep\n---\nbody\n",
        );
        // Model-only plugin skill: hidden from the user catalog, visible to the model.
        plugin_skill(
            &root,
            "release",
            "internals",
            "---\ndescription: impl\ndisable-model-invocation: false\nuser-invocable: false\n---\nbody\n",
        );
        // User-only plugin skill: hidden from the model catalog.
        plugin_skill(
            &root,
            "triage",
            "labels",
            "---\ndescription: lab\ndisable-model-invocation: true\n---\nbody\n",
        );

        let enabled: Vec<String> = Vec::new();
        let model: Vec<String> = catalog(&root, &enabled)
            .into_iter()
            .map(|m| m.name)
            .collect();
        assert!(model.contains(&"deploy".to_string()));
        assert!(model.contains(&"release:prepare".to_string()));
        assert!(model.contains(&"release:internals".to_string()));
        assert!(!model.contains(&"triage:labels".to_string()));

        let user: Vec<String> = user_catalog(&root, &enabled)
            .into_iter()
            .map(|m| m.name)
            .collect();
        assert!(user.contains(&"release:prepare".to_string()));
        assert!(user.contains(&"triage:labels".to_string()));
        assert!(!user.contains(&"release:internals".to_string()));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn is_enabled_whitelist_matches_plugin_names() {
        let root = temp_root("en");
        project_skill(&root, "deploy", "body\n");
        plugin_skill(&root, "release", "prepare", "body\n");
        plugin_skill(&root, "release", "changelog", "body\n");

        let entries = discover_all(&root);
        // Plugin name alone enables every skill it ships.
        let enabled = vec!["release".to_string()];
        let active: Vec<_> = entries
            .iter()
            .filter(|e| is_enabled(&enabled, e))
            .map(qualified_name)
            .collect();
        assert_eq!(active, vec!["release:changelog", "release:prepare"]);
        // Qualified name enables a single skill.
        let enabled = vec!["release:prepare".to_string()];
        let active: Vec<_> = entries
            .iter()
            .filter(|e| is_enabled(&enabled, e))
            .map(qualified_name)
            .collect();
        assert_eq!(active, vec!["release:prepare"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn build_invocation_message_reaches_plugin_skills() {
        let root = temp_root("invoke");
        let plugin_dir = plugins_dir(&root).join("release");
        std::fs::create_dir_all(plugin_dir.join("skills").join("prepare")).unwrap();
        std::fs::write(
            plugin_dir.join("skills").join("prepare").join("SKILL.md"),
            "---\ndescription: Prep the release\n---\n\nRun the release steps.\n",
        )
        .unwrap();
        std::fs::write(plugin_dir.join("assets.txt"), "bundled").unwrap();

        let (msg, description) =
            build_invocation_message(&root, "release:prepare", "staging").unwrap();
        assert_eq!(description, "Prep the release");
        assert!(msg.contains("Run the release steps."));
        assert!(msg.contains("User: staging"));
        // The announced base directory is the plugin skill folder, so bundled
        // files resolve.
        let expected_dir = plugin_dir.join("skills").join("prepare");
        assert!(
            msg.contains(&format!("[Skill directory: {}]", expected_dir.display())),
            "{msg}"
        );

        // Short plain form works when unambiguous.
        let (msg, _) = build_invocation_message(&root, "prepare", "").unwrap();
        assert!(msg.contains("Run the release steps."));
        // Unknown skill errors.
        assert!(build_invocation_message(&root, "nope", "").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
