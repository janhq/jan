//! `agent.toml` project config parsing and `.jan/agent/` scaffolding.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::core::agent::permissions::{PermissionDefault, ToolPermissions};

/// Only `[tools]` is modeled this phase. serde ignores unknown sections
/// (`[agent]`/`[budget]`/`[skills]`), which return when their consumers land.
#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct AgentToml {
    #[serde(default)]
    pub tools: ToolsSection,
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
max_turns = 8
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

/// Scaffold `<project_root>/.jan/agent/{agent.toml, AGENT.md, skills/, memory/}`.
/// Err if `agent.toml` already exists (no clobber). Returns the created agent dir.
pub(crate) fn init_project(project_root: &Path) -> Result<PathBuf, String> {
    let agent_dir = project_root.join(".jan").join("agent");
    let toml_path = agent_dir.join("agent.toml");
    if toml_path.exists() {
        return Err(format!(
            "agent.toml already exists at {}",
            toml_path.display()
        ));
    }

    std::fs::create_dir_all(agent_dir.join("skills"))
        .map_err(|e| format!("Failed to create skills dir: {e}"))?;
    std::fs::create_dir_all(agent_dir.join("memory"))
        .map_err(|e| format!("Failed to create memory dir: {e}"))?;

    std::fs::write(&toml_path, AGENT_TOML_TEMPLATE)
        .map_err(|e| format!("Failed to write {}: {e}", toml_path.display()))?;
    let md_path = agent_dir.join("AGENT.md");
    std::fs::write(&md_path, AGENT_MD_TEMPLATE)
        .map_err(|e| format!("Failed to write {}: {e}", md_path.display()))?;

    Ok(agent_dir)
}

/// Persist an always-allow grant for `tool_name` into agent.toml, format-preserving
/// (comments kept). Write/exec tools go into `[tools].allow_write`, read tools into
/// `[tools].allow`. Idempotent (no duplicate entries). Errs if agent.toml is missing.
pub(crate) fn grant_tool_in_agent_toml(
    project_root: &Path,
    tool_name: &str,
    write_capable: bool,
) -> Result<(), String> {
    let path = agent_toml_path(project_root);
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    let mut doc = raw
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| format!("Failed to parse {}: {e}", path.display()))?;

    let tools = doc["tools"].or_insert(toml_edit::Item::Table(toml_edit::Table::new()));
    let key = if write_capable {
        "allow_write"
    } else {
        "allow"
    };
    let list = tools[key].or_insert(toml_edit::value(toml_edit::Array::new()));
    let arr = list
        .as_array_mut()
        .ok_or_else(|| format!("[tools].{key} is not an array in {}", path.display()))?;

    if arr.iter().any(|v| v.as_str() == Some(tool_name)) {
        return Ok(());
    }
    arr.push(tool_name);

    std::fs::write(&path, doc.to_string())
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
    fn init_creates_artifacts_and_refuses_clobber() {
        let root = unique_root("init");
        let dir = init_project(&root).expect("init");
        assert!(dir.join("agent.toml").exists());
        assert!(dir.join("AGENT.md").exists());
        assert!(dir.join("skills").is_dir());
        assert!(dir.join("memory").is_dir());

        assert!(init_project(&root).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn load_roundtrips_template() {
        let root = unique_root("roundtrip");
        init_project(&root).expect("init");
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
        init_project(&root).expect("init");
        // The template carries [agent]/[budget]/[skills] we don't model yet;
        // parsing must succeed and read [tools].
        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.tools.default.as_deref(), Some("read-only"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn permissions_from_default_template_is_read_only() {
        let root = unique_root("perms");
        init_project(&root).expect("init");
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
    fn grant_persists_by_capability_and_is_idempotent_and_keeps_comments() {
        let root = unique_root("grant");
        init_project(&root).expect("init");

        grant_tool_in_agent_toml(&root, "write", true).expect("grant write");
        grant_tool_in_agent_toml(&root, "read", false).expect("grant read");
        // Idempotent: a second identical grant does not duplicate.
        grant_tool_in_agent_toml(&root, "write", true).expect("grant write again");

        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.tools.allow_write, vec!["write".to_string()]);
        assert_eq!(cfg.tools.allow, vec!["read".to_string()]);

        // Format-preserving: the template's comment survives the edit.
        let raw = std::fs::read_to_string(agent_toml_path(&root)).expect("read raw");
        assert!(raw.contains("Secure default"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn grant_missing_agent_toml_errors() {
        let root = unique_root("grant_missing");
        assert!(grant_tool_in_agent_toml(&root, "write", true).is_err());
    }
}
