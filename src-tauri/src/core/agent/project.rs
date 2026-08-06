//! `agent.toml` project config parsing and `.jan/agent/` scaffolding.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::core::agent::permissions::{PermissionDefault, ToolPermissions};

/// `[tools]` is always modeled. `[agent]` is only compiled for the CLI (its
/// sole consumer, via `jan cli agent run/step/status`); serde still ignores the
/// remaining deferred sections (`[budget]`/`[skills]`).
#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct AgentToml {
    #[cfg(feature = "cli")]
    #[serde(default)]
    pub agent: AgentSection,
    #[cfg(feature = "cli")]
    #[serde(default)]
    pub provider: Option<ProviderSection>,
    #[serde(default)]
    pub tools: ToolsSection,
    #[serde(default)]
    pub skills: SkillsSection,
}

/// `[provider]` — project-local override of a single provider's config,
/// highest priority in the resolution chain (wins over the global
/// `~/.jan/config.toml` and the desktop-inherited config). Optional: most
/// projects rely on the global scope instead. CLI-only, like `AgentSection`.
#[cfg(feature = "cli")]
#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct ProviderSection {
    pub name: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub models: Vec<String>,
    #[serde(default)]
    pub api_type: Option<String>,
}

/// `[skills]` — which project skills are advertised to the model. An empty
/// `enabled` list means "all skills" (backward-compatible with the scaffold
/// template, which ships `enabled = []`); a non-empty list is a whitelist.
#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct SkillsSection {
    #[serde(default)]
    pub enabled: Vec<String>,
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
    /// Context window limit in tokens for the model (defaults to 128K if unset).
    /// Set this to match your model's actual context length so compaction
    /// triggers at the right threshold.
    #[serde(default)]
    pub context_window: Option<u64>,
    /// Tokens to hold back from the context window when deciding whether to
    /// compact (defaults to 16K if unset). Compaction triggers at
    /// `context_window - compaction_reserve_tokens`. This is a compaction
    /// heuristic only — it is NOT sent to the API as `max_tokens`.
    #[serde(default)]
    pub compaction_reserve_tokens: Option<u64>,
    /// Per-request output cap forwarded to the model as the OpenAI-compatible
    /// `max_tokens` field. Limits how many tokens the model may generate in a
    /// single response. Omitted from the request when unset (model default).
    #[serde(default)]
    pub max_tokens: Option<u64>,
    /// Cap on concurrently-running background subagents for a run (defaults to
    /// 10 if unset). Dispatches beyond the cap queue FIFO and start as running
    /// ones finish. Snapshot at run start: a mid-run change affects the next
    /// run only.
    #[serde(default)]
    pub max_parallel_subagents: Option<u32>,
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
# context_window = 128000  # tokens; defaults to 128K if unset
# compaction_reserve_tokens = 16384  # headroom before auto-compaction; defaults to 16K
# max_tokens = 4096  # cap on tokens the model generates per response (OpenAI max_tokens); omitted if unset
# max_parallel_subagents = 10  # max concurrently-running subagents per run; extra dispatches queue FIFO
instructions_file = "AGENT.md"

# Project-local provider override. Wins over ~/.jan/config.toml and any
# provider inherited from Jan Desktop's settings.json. Most projects don't
# need this and should rely on the global scope instead.
# [provider]
# name = "openai"
# api_key = "sk-..."
# base_url = "https://api.openai.com/v1"
# models = ["gpt-4o"]

[budget]
max_steps = 40
max_tokens = 200000

[tools]
# read-only | deny | allow. read-only (default) exposes MCP tools and built-in
# reads; built-in writes/exec still prompt. deny locks down all MCP tools.
default = "read-only"
# Exposed even under deny; deny-list wins over everything:
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
    if !project_root.is_dir() {
        return Err(format!(
            "project directory does not exist: {}. Pass --project with a path to an existing directory (paths are case-sensitive).",
            project_root.display()
        ));
    }
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
#[cfg(feature = "cli")]
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

/// Persist an unsigned-integer `[agent]` key (e.g. `max_parallel_subagents`)
/// into the agent.toml at `path`, format-preserving (comments kept). The key is
/// written under `[agent]` like the template's other knobs, so the value the
/// next run loads is exactly what the TUI `/settings` surface shows.
#[cfg(feature = "cli")]
pub(crate) fn set_agent_integer_key(path: &Path, key: &str, value: u64) -> Result<(), String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    let mut doc = raw
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| format!("Failed to parse {}: {e}", path.display()))?;

    let agent = doc["agent"].or_insert(toml_edit::Item::Table(toml_edit::Table::new()));
    agent[key] = toml_edit::value(value as i64);

    std::fs::write(path, doc.to_string())
        .map_err(|e| format!("Failed to write {}: {e}", path.display()))
}

/// Persist `[skills].enabled` into the agent.toml at `path`, format-preserving
/// (comments kept). An empty list clears the whitelist (= all skills enabled).
#[cfg(any(not(feature = "cli"), test))]
pub(crate) fn set_skills_enabled_in_agent_toml(
    path: &Path,
    enabled: &[String],
) -> Result<(), String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    let mut doc = raw
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| format!("Failed to parse {}: {e}", path.display()))?;

    let skills = doc["skills"].or_insert(toml_edit::Item::Table(toml_edit::Table::new()));
    let mut arr = toml_edit::Array::new();
    for name in enabled {
        arr.push(name.as_str());
    }
    skills["enabled"] = toml_edit::value(arr);

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
        let root = std::env::temp_dir().join(format!("jan_agent_test_{tag}_{n}"));
        std::fs::create_dir_all(&root).expect("create test project root");
        root
    }

    #[test]
    fn ensure_errors_when_project_dir_missing() {
        // A mistyped --project (e.g. wrong case) must fail fast, not scaffold a
        // phantom project dir from nothing.
        let root = std::env::temp_dir()
            .join(format!("jan_agent_missing_{}", COUNTER.fetch_add(1, Ordering::SeqCst)));
        assert!(!root.exists());
        let err = ensure_project(&root).expect_err("must reject missing dir");
        assert!(err.contains("does not exist"), "err: {err}");
        assert!(!root.exists(), "must not create the missing project dir");
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

    #[cfg(feature = "cli")]
    #[test]
    fn template_provider_section_absent_by_default() {
        let root = unique_root("provider_absent");
        ensure_project(&root).expect("scaffold");
        let cfg = load_agent_config(&root).expect("load");
        assert!(cfg.provider.is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(feature = "cli")]
    #[test]
    fn provider_section_parses_when_present() {
        let root = unique_root("provider_present");
        ensure_project(&root).expect("scaffold");
        let path = agent_toml_path(&root);
        let mut raw = std::fs::read_to_string(&path).unwrap();
        raw.push_str(
            "\n[provider]\nname = \"openai\"\napi_key = \"sk-test\"\nmodels = [\"gpt-4o\"]\n",
        );
        std::fs::write(&path, raw).unwrap();

        let cfg = load_agent_config(&root).expect("load");
        let provider = cfg.provider.expect("provider section present");
        assert_eq!(provider.name, "openai");
        assert_eq!(provider.api_key.as_deref(), Some("sk-test"));
        assert_eq!(provider.models, vec!["gpt-4o".to_string()]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(feature = "cli")]
    #[test]
    fn max_parallel_subagents_parses_and_defaults_to_none() {
        let root = unique_root("max_parallel");
        ensure_project(&root).expect("scaffold");
        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.agent.max_parallel_subagents, None, "template leaves it unset");

        // Explicit value round-trips through the /settings writer.
        let path = agent_toml_path(&root);
        set_agent_integer_key(&path, "max_parallel_subagents", 4).expect("write");
        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.agent.max_parallel_subagents, Some(4));
        let _ = std::fs::remove_dir_all(&root);
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

    #[cfg(feature = "cli")]
    #[test]
    fn context_window_defaults_to_none_when_unset() {
        // The scaffolded template leaves context_window commented out, so the
        // parsed value is None and callers fall back to their default (128K).
        let root = unique_root("ctx_unset");
        ensure_project(&root).expect("scaffold");
        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.agent.context_window, None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(feature = "cli")]
    #[test]
    fn context_window_parses_when_present() {
        let root = unique_root("ctx_present");
        ensure_project(&root).expect("scaffold");
        let path = agent_toml_path(&root);
        let raw = std::fs::read_to_string(&path).unwrap();
        // Prepend an explicit context_window under [agent].
        let raw = raw.replace("[agent]", "[agent]\ncontext_window = 32000");
        std::fs::write(&path, raw).unwrap();
        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.agent.context_window, Some(32000));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(feature = "cli")]
    #[test]
    fn compaction_reserve_tokens_defaults_to_none_when_unset() {
        let root = unique_root("reserve_unset");
        ensure_project(&root).expect("scaffold");
        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.agent.compaction_reserve_tokens, None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(feature = "cli")]
    #[test]
    fn compaction_reserve_tokens_parses_when_present() {
        let root = unique_root("reserve_present");
        ensure_project(&root).expect("scaffold");
        let path = agent_toml_path(&root);
        let raw = std::fs::read_to_string(&path).unwrap();
        let raw = raw.replace("[agent]", "[agent]\ncompaction_reserve_tokens = 8192");
        std::fs::write(&path, raw).unwrap();
        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.agent.compaction_reserve_tokens, Some(8192));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(feature = "cli")]
    #[test]
    fn max_tokens_defaults_to_none_when_unset() {
        let root = unique_root("maxtok_unset");
        ensure_project(&root).expect("scaffold");
        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.agent.max_tokens, None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(feature = "cli")]
    #[test]
    fn max_tokens_parses_when_present() {
        let root = unique_root("maxtok_present");
        ensure_project(&root).expect("scaffold");
        let path = agent_toml_path(&root);
        let raw = std::fs::read_to_string(&path).unwrap();
        let raw = raw.replace("[agent]", "[agent]\nmax_tokens = 4096");
        std::fs::write(&path, raw).unwrap();
        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.agent.max_tokens, Some(4096));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn permissions_from_default_template_advertises_mcp() {
        // The scaffolded read-only default must still advertise MCP tools.
        let root = unique_root("perms");
        ensure_project(&root).expect("scaffold");
        let cfg = load_agent_config(&root).expect("load");
        let perms = permissions_from(&cfg);
        assert!(perms.advertises_mcp("mcp.search"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn permissions_from_deny_default_blocks_mcp() {
        let mut cfg = AgentToml::default();
        cfg.tools.default = Some("deny".to_string());
        let perms = permissions_from(&cfg);
        assert!(!perms.advertises_mcp("mcp.search"));

        cfg.tools.allow = vec!["mcp.search".to_string()];
        let perms = permissions_from(&cfg);
        assert!(perms.advertises_mcp("mcp.search"));
    }

    #[cfg(feature = "cli")]
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
        assert!(raw.contains("read-only | deny | allow"));
        let _ = std::fs::remove_dir_all(&root);
    }
}
