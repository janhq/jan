//! `agent.toml` project config parsing and `.jan/agent/` scaffolding.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::core::agent::permissions::{PermissionDefault, ToolPermissions};

/// `[tools]` is always modeled. `[agent]` is only compiled for the CLI (its
/// sole consumer, via `jan agent run/step/status`); serde still ignores the
/// remaining deferred sections (`[budget]`/`[skills]`).
#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct AgentToml {
    #[cfg(feature = "cli")]
    #[serde(default)]
    pub agent: AgentSection,
    #[serde(default)]
    pub tools: ToolsSection,
}

/// `[agent]` — resolves the model and default turn cap for CLI agent runs.
/// `max_turns` is a soft default; the loop clamps it to 1..=400.
#[cfg(feature = "cli")]
#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct AgentSection {
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub max_turns: Option<u32>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct ToolsSection {
    #[serde(default)]
    pub default: Option<String>,
    #[serde(default)]
    pub allow: Vec<String>,
    #[serde(default)]
    pub deny: Vec<String>,
    #[serde(default)]
    pub allow_write: Vec<String>,
}

const AGENT_TOML_TEMPLATE: &str = r#"[agent]
# model = "Jan-V4"
max_turns = 400
instructions_file = "AGENT.md"

[budget]
max_steps = 40
max_tokens = 200000

[tools]
# read-only | deny | allow. Secure default: read-only.
default = "read-only"
allow = []
deny = []
# Write tools are opt-in only:
# allow_write = ["fs.write"]
allow_write = []

[skills]
enabled = []
# always | relevance
inject = "always"
"#;

const AGENT_MD_TEMPLATE: &str =
    "# Agent Instructions\n\nDescribe how this project's agent should behave.\n";

/// Path to `<project_root>/.jan/agent/agent.toml`.
pub(crate) fn agent_toml_path(project_root: &Path) -> PathBuf {
    project_root.join(".jan").join("agent").join("agent.toml")
}

/// Load + parse agent.toml. Err if missing or malformed (path included in message).
pub(crate) fn load_agent_config(project_root: &Path) -> Result<AgentToml, String> {
    let path = agent_toml_path(project_root);
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    toml::from_str(&raw).map_err(|e| format!("Failed to parse {}: {e}", path.display()))
}

/// Build a `ToolPermissions` from the parsed `[tools]` section.
pub(crate) fn permissions_from(cfg: &AgentToml) -> ToolPermissions {
    let default = cfg
        .tools
        .default
        .as_deref()
        .map(PermissionDefault::from_str_lenient)
        .unwrap_or_default();
    ToolPermissions::new(
        default,
        &cfg.tools.allow,
        &cfg.tools.deny,
        &cfg.tools.allow_write,
    )
}

/// Ensure a usable `.jan/agent/{agent.toml, AGENT.md, skills/, memory/}` exists
/// under `project_root`, creating only the pieces that don't already exist.
/// Idempotent and clobber-safe: preserves user edits on re-runs. Auto-managed
/// on both the CLI and desktop agent-run paths (there is no explicit init step).
pub(crate) fn ensure_project(project_root: &Path) -> Result<PathBuf, String> {
    let agent_dir = project_root.join(".jan").join("agent");
    std::fs::create_dir_all(agent_dir.join("skills"))
        .map_err(|e| format!("Failed to create skills dir: {e}"))?;
    std::fs::create_dir_all(agent_dir.join("memory"))
        .map_err(|e| format!("Failed to create memory dir: {e}"))?;

    let toml_path = agent_dir.join("agent.toml");
    if !toml_path.exists() {
        std::fs::write(&toml_path, AGENT_TOML_TEMPLATE)
            .map_err(|e| format!("Failed to write {}: {e}", toml_path.display()))?;
    }
    let md_path = agent_dir.join("AGENT.md");
    if !md_path.exists() {
        std::fs::write(&md_path, AGENT_MD_TEMPLATE)
            .map_err(|e| format!("Failed to write {}: {e}", md_path.display()))?;
    }

    Ok(agent_dir)
}

/// Persist `[agent].model` into the agent.toml at `path`, format-preserving
/// (comments kept). Remembers a TUI `/model` selection across sessions.
pub(crate) fn set_model_in_agent_toml(path: &Path, model: &str) -> Result<(), String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    let mut doc = raw
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| format!("Failed to parse {}: {e}", path.display()))?;

    let agent = doc["agent"].or_insert(toml_edit::Item::Table(toml_edit::Table::new()));
    agent["model"] = toml_edit::value(model);

    std::fs::write(path, doc.to_string())
        .map_err(|e| format!("Failed to write {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn unique_root(tag: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!("jan_agent_test_{tag}_{n}"))
    }

    #[test]
    fn ensure_creates_artifacts_and_is_idempotent() {
        let root = unique_root("ensure");
        let dir = ensure_project(&root).expect("ensure");
        assert!(dir.join("agent.toml").exists());
        assert!(dir.join("AGENT.md").exists());
        assert!(dir.join("skills").is_dir());
        assert!(dir.join("memory").is_dir());

        // Second call must not error and must preserve user edits.
        std::fs::write(dir.join("agent.toml"), "[tools]\ndefault = \"deny\"\n").unwrap();
        ensure_project(&root).expect("ensure again");
        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.tools.default.as_deref(), Some("deny"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn load_roundtrips_template() {
        let root = unique_root("roundtrip");
        ensure_project(&root).expect("scaffold");
        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.tools.default.as_deref(), Some("read-only"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn load_missing_errors() {
        let root = unique_root("missing");
        assert!(load_agent_config(&root).is_err());
    }

    #[test]
    fn full_template_parses_ignoring_deferred_sections() {
        let root = unique_root("full");
        ensure_project(&root).expect("scaffold");
        // The template carries [agent]/[budget]/[skills] we don't model yet;
        // parsing must succeed and read [tools].
        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.tools.default.as_deref(), Some("read-only"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn permissions_from_default_template_is_read_only() {
        let root = unique_root("perms");
        ensure_project(&root).expect("scaffold");
        let cfg = load_agent_config(&root).expect("load");
        let perms = permissions_from(&cfg);
        assert!(!perms.permits("mcp.search"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn permissions_from_respects_allow_list() {
        let mut cfg = AgentToml::default();
        cfg.tools.default = Some("read-only".to_string());
        cfg.tools.allow = vec!["mcp.search".to_string()];
        let perms = permissions_from(&cfg);
        assert!(perms.permits("mcp.search"));
    }

    #[test]
    fn set_model_persists_and_reloads_and_keeps_comments() {
        let root = unique_root("setmodel");
        ensure_project(&root).expect("scaffold");
        let path = agent_toml_path(&root);

        set_model_in_agent_toml(&path, "claude-sonnet-5").expect("set");
        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.agent.model.as_deref(), Some("claude-sonnet-5"));

        // Overwrites on a second set; template comment survives.
        set_model_in_agent_toml(&path, "gpt-4o").expect("set again");
        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.agent.model.as_deref(), Some("gpt-4o"));
        let raw = std::fs::read_to_string(&path).expect("read");
        assert!(raw.contains("Secure default"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
