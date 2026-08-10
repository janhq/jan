//! `agent.toml` project config parsing and `.jan/agent/` scaffolding.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use tauri_plugin_agent_tools::permissions::{PermissionDefault, ToolPermissions};

/// `[tools]`/`[skills]` are always modeled. `[agent]` and `[budget]` are only
/// compiled for the CLI (their sole consumer, via `jan cli agent run/step/status`).
#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct AgentToml {
    #[cfg(feature = "cli")]
    #[serde(default)]
    pub agent: AgentSection,
    #[cfg(feature = "cli")]
    #[serde(default)]
    pub budget: BudgetSection,
    #[cfg(feature = "cli")]
    #[serde(default)]
    pub provider: Option<ProviderSection>,
    #[serde(default)]
    pub tools: ToolsSection,
    #[serde(default)]
    pub skills: SkillsSection,
    #[serde(default)]
    pub plugins: PluginsSection,
}

/// `[plugins]` — plugin installs and marketplace. Installed plugins live in
/// `.jan/agent/plugins/`; this section only carries configuration.
#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct PluginsSection {
    /// URL of a JSON marketplace index (`[{ name, description, repo, ref? }]`).
    /// Unset disables name-based installs; direct git URLs still work.
    #[serde(default)]
    pub marketplace: Option<String>,
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

/// `[budget]` — the only cap on how long a run may go. The agent takes as many
/// turns as the task needs; `max_tokens` bounds the run's *marginal* token
/// spend (see `SessionBudget`: replayed context is not recharged each turn).
/// Unset applies `DEFAULT_MAX_SESSION_TOKENS`; an explicit `0` disables the
/// ceiling, leaving cancellation as the only guard.
#[cfg(feature = "cli")]
#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct BudgetSection {
    #[serde(default)]
    pub max_tokens: Option<u64>,
}

/// `[agent]` — resolves the model and per-run knobs for CLI agent runs.
#[cfg(feature = "cli")]
#[derive(Debug, Clone, Default, Deserialize)]
pub(crate) struct AgentSection {
    #[serde(default)]
    pub model: Option<String>,
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
    /// Expand `<think>` reasoning blocks in the TUI transcript instead of
    /// folding them to a `[thinking]`/`[thought for Ns]` status and a summary
    /// row. Default false (hidden); Ctrl-O still reveals a folded block, and
    /// this flips the default for every block in the session.
    #[serde(default)]
    pub show_reasoning: Option<bool>,
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
    /// Whether the sandboxed shell keeps its network namespace. `None` (unset)
    /// leaves the choice to the surface running the loop, which differ: the CLI
    /// prompts before every exec and allows it, the desktop's ephemeral chat
    /// sandbox does not and denies it.
    #[serde(default)]
    pub allow_network: Option<bool>,
    /// Whether the sandboxed shell may read the user's home directory (the
    /// CLI, for `git`/`ssh` credential helpers). `None` (unset) leaves the
    /// choice to the surface: the CLI defaults to true, the desktop masks
    /// `$HOME` entirely. Writes are confined to the workspace either way.
    #[serde(default)]
    pub allow_home_read: Option<bool>,
    /// Whether the shell runs under OS confinement. `None` (unset) leaves the
    /// choice to the surface: the desktop always confines, the CLI defaults to
    /// off and opts in with `--sandbox` or the global `sandbox` setting.
    /// Setting it here is how a repo requires confinement for everyone who
    /// checks it out.
    #[serde(default)]
    pub sandbox: Option<bool>,
}

const AGENT_TOML_TEMPLATE: &str = r#"[agent]
# model = "Jan-V4"
# context_window = 128000  # tokens; defaults to 128K if unset
# compaction_reserve_tokens = 16384  # headroom before auto-compaction; defaults to 16K
# max_tokens = 4096  # cap on tokens the model generates per response (OpenAI max_tokens); omitted if unset
# max_parallel_subagents = 10  # max concurrently-running subagents per run; extra dispatches queue FIFO
# show_reasoning = false  # expand  reasoning in the transcript (Ctrl-O still toggles)

# Project-local provider override. Wins over ~/.jan/config.toml and any
# provider inherited from Jan Desktop's settings.json. Most projects don't
# need this and should rely on the global scope instead.
# [provider]
# name = "openai"
# api_key = "sk-..."
# base_url = "https://api.openai.com/v1"
# models = ["gpt-4o"]

# The run's only cap: new token spend across all turns (replayed context is not
# recharged each turn). There is no turn limit. Defaults to 128000 when unset;
# 0 disables the cap so the agent runs until the task is done or cancelled.
[budget]
# max_tokens = 128000

[tools]
# read-only | deny | allow. read-only (default) exposes MCP tools and built-in
# reads; built-in writes/exec go through the permission gate. deny locks down
# all MCP tools.
default = "read-only"
# Exposed even under deny; deny-list wins over everything:
allow = []
deny = []
# Write tools are opt-in only:
# allow_write = ["fs.write"]
allow_write = []
# Whether the sandboxed shell can reach the network. Unset follows the surface
# running the agent: the CLI allows it, the desktop's throwaway chat sandbox
# does not.
# allow_network = true
# Whether the sandboxed shell can read your home directory (for git/ssh
# credential helpers and ~/.ssh/config). Unset follows the surface: the CLI
# allows it (true), the desktop masks $HOME. Writes stay in the workspace.
# allow_home_read = true
# Whether `bash` runs under OS confinement at all. Unset follows the surface:
# the CLI runs unconfined unless you pass --sandbox or set sandbox = true in
# ~/.jan/config.toml; the desktop always confines. Set it here to require
# confinement for anyone working in this project.
# sandbox = true

[skills]
enabled = []
# always | relevance
inject = "always"
"#;

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

/// The per-run knobs a `ToolContext` needs from agent.toml.
///
/// The toolset owns no config format, so this is the one place that maps
/// agent.toml onto a `ToolContext`. Resolved once per run rather than per tool
/// call, and in a single parse rather than one per field.
#[derive(Debug, Clone, Default)]
pub(crate) struct RunSettings {
    /// `[skills].enabled` (empty = every skill).
    pub enabled_skills: Vec<String>,
    /// `[tools].allow_network`; `None` when unset, so the caller applies the
    /// default appropriate to its surface.
    pub allow_network: Option<bool>,
    /// `[tools].allow_home_read`; `None` when unset, so the caller applies the
    /// default appropriate to its surface.
    pub allow_home_read: Option<bool>,
    /// `[tools].sandbox`; `None` when unset, so the caller applies the default
    /// appropriate to its surface.
    pub sandbox: Option<bool>,
}

/// A missing or malformed config yields defaults rather than an error: a project
/// without an agent.toml should still run, advertising all of its skills.
pub(crate) fn run_settings(project_root: &Path) -> RunSettings {
    let Ok(cfg) = load_agent_config(project_root) else {
        return RunSettings::default();
    };
    RunSettings {
        enabled_skills: cfg.skills.enabled,
        allow_network: cfg.tools.allow_network,
        allow_home_read: cfg.tools.allow_home_read,
        sandbox: cfg.tools.sandbox,
    }
}

pub(crate) fn enabled_skills(project_root: &Path) -> Vec<String> {
    run_settings(project_root).enabled_skills
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

/// Ensure a usable `.jan/agent/{agent.toml, skills/, memory/}` exists under
/// `project_root`, creating only the pieces that don't already exist.
/// Idempotent and clobber-safe: preserves user edits on re-runs. Auto-managed
/// on both the CLI and desktop agent-run paths (there is no explicit init step).
///
/// The project instructions file (`<project_root>/JAN.md`) is deliberately not
/// scaffolded: an empty placeholder costs prompt space and teaches nothing, so
/// it is written by `/init` or by hand.
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

/// Persist a scalar key into the agent.toml at `path`, format-preserving
/// (comments kept). Keys are `section.key` with `agent` the default section,
/// so the `/settings` menu can reach `[agent]`, `[budget]`, `[tools]` and
/// `[skills]` scalars alike. `None` removes the key (default applies).
#[cfg(feature = "cli")]
pub(crate) fn set_agent_key(
    path: &Path,
    key: &str,
    value: Option<toml_edit::Item>,
) -> Result<(), String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    let mut doc = raw
        .parse::<toml_edit::DocumentMut>()
        .map_err(|e| format!("Failed to parse {}: {e}", path.display()))?;

    let (section, key) = match key.split_once('.') {
        Some((section, key)) => (section, key),
        None => ("agent", key),
    };

    match value {
        Some(v) => {
            let table = doc[section].or_insert(toml_edit::Item::Table(toml_edit::Table::new()));
            table[key] = v;
        }
        None => {
            if let Some(table) = doc.get_mut(section).and_then(|t| t.as_table_mut()) {
                table.remove(key);
            }
        }
    }

    std::fs::write(path, doc.to_string())
        .map_err(|e| format!("Failed to write {}: {e}", path.display()))
}

/// Persist `[skills].enabled` into the agent.toml at `path`, format-preserving
/// (comments kept). An empty list clears the whitelist (= all skills enabled).
#[cfg(not(feature = "cli"))]
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

    /// The pid keeps the path unique across concurrently-running test binaries
    /// (the `cli` and `tauri` feature configs both compile this module), which a
    /// per-process counter alone does not: a leftover root from one run makes
    /// `ensure_project` skip scaffolding in the next.
    fn unique_root(tag: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let pid = std::process::id();
        let root = std::env::temp_dir().join(format!("jan_agent_test_{tag}_{pid}_{n}"));
        std::fs::create_dir_all(&root).expect("create test project root");
        root
    }

    /// `ensure_project` scaffolds `.jan/agent/{skills,memory}` by hand, while the
    /// toolset resolves those same directories through `workspace::project_store`.
    /// Nothing but this test ties the two together, and if they ever drift a
    /// user's existing skills and memories simply stop being found.
    #[test]
    fn scaffolded_dirs_match_the_toolset_store_layout() {
        use tauri_plugin_agent_tools::workspace;

        let root = unique_root("store_layout");
        ensure_project(&root).expect("scaffold project");

        let store = workspace::project_store(&root);
        assert_eq!(store, root.join(".jan").join("agent"));
        assert!(
            tauri_plugin_agent_tools::skills::skills_dir(&store).is_dir(),
            "skills dir the toolset reads is not the one ensure_project created"
        );
        assert!(
            workspace::store_dir(&store, "memory").is_dir(),
            "memory dir the toolset reads is not the one ensure_project created"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    fn write_agent_toml(root: &Path, body: &str) {
        let dir = root.join(".jan").join("agent");
        std::fs::create_dir_all(&dir).expect("create agent dir");
        std::fs::write(dir.join("agent.toml"), body).expect("write agent.toml");
    }

    #[test]
    fn run_settings_reads_allow_network_both_ways() {
        let root = unique_root("allow_net");
        write_agent_toml(&root, "[tools]\nallow_network = true\n");
        assert_eq!(run_settings(&root).allow_network, Some(true));

        write_agent_toml(&root, "[tools]\nallow_network = false\n");
        assert_eq!(run_settings(&root).allow_network, Some(false));

        let _ = std::fs::remove_dir_all(&root);
    }

    /// Unset must stay `None` rather than collapsing to `false`, or the caller
    /// cannot tell "explicitly denied" from "not configured" and every CLI
    /// project silently loses the network.
    #[test]
    fn run_settings_leaves_unset_allow_network_undecided() {
        let root = unique_root("allow_net_unset");

        write_agent_toml(&root, "[tools]\ndefault = \"read-only\"\n");
        assert_eq!(run_settings(&root).allow_network, None);

        // A project with no agent.toml at all resolves the same way.
        let bare = unique_root("allow_net_bare");
        assert_eq!(run_settings(&bare).allow_network, None);

        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&bare);
    }

    /// The scaffold documents the key, so it has to stay parseable as written.
    #[test]
    fn scaffold_template_parses_with_allow_network_documented() {
        let cfg: AgentToml = toml::from_str(AGENT_TOML_TEMPLATE).expect("scaffold template parses");
        assert_eq!(cfg.tools.allow_network, None);
        assert!(AGENT_TOML_TEMPLATE.contains("allow_network"));
    }

    #[test]
    fn ensure_errors_when_project_dir_missing() {
        // A mistyped --project (e.g. wrong case) must fail fast, not scaffold a
        // phantom project dir from nothing.
        let root = std::env::temp_dir().join(format!(
            "jan_agent_missing_{}",
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        assert!(!root.exists());
        let err = ensure_project(&root).expect_err("must reject missing dir");
        assert!(err.contains("does not exist"), "err: {err}");
        assert!(!root.exists(), "must not create the missing project dir");
    }

    /// The instructions file lives at the project root as `JAN.md` and is the
    /// user's (or `/init`'s) to create -- the scaffold must not plant an empty
    /// one under `.jan/agent/`, which nothing reads.
    #[test]
    fn ensure_does_not_scaffold_an_instructions_file() {
        let root = unique_root("no_instructions");
        let dir = ensure_project(&root).expect("ensure");
        assert!(!dir.join("AGENT.md").exists());
        assert!(!root.join("JAN.md").exists());
        assert!(!AGENT_TOML_TEMPLATE.contains("instructions_file"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn ensure_creates_artifacts_and_is_idempotent() {
        let root = unique_root("ensure");
        let dir = ensure_project(&root).expect("ensure");
        assert!(dir.join("agent.toml").exists());
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
        assert_eq!(
            cfg.agent.max_parallel_subagents, None,
            "template leaves it unset"
        );

        // Explicit value round-trips through the /settings writer; unset removes.
        let path = agent_toml_path(&root);
        set_agent_key(
            &path,
            "max_parallel_subagents",
            Some(toml_edit::value(4i64)),
        )
        .expect("write");
        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.agent.max_parallel_subagents, Some(4));
        set_agent_key(&path, "max_parallel_subagents", None).expect("unset");
        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.agent.max_parallel_subagents, None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(feature = "cli")]
    #[test]
    fn show_reasoning_parses_and_defaults_to_false() {
        let root = unique_root("show_reasoning");
        ensure_project(&root).expect("scaffold");
        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.agent.show_reasoning, None, "template leaves it unset");

        // Explicit value round-trips through the /settings writer; unset removes.
        let path = agent_toml_path(&root);
        set_agent_key(&path, "show_reasoning", Some(toml_edit::value(true))).expect("write");
        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.agent.show_reasoning, Some(true));
        set_agent_key(&path, "show_reasoning", None).expect("unset");
        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.agent.show_reasoning, None);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(feature = "cli")]
    #[test]
    fn dotted_keys_write_and_remove_under_their_section() {
        let root = unique_root("dotted");
        ensure_project(&root).expect("scaffold");
        let path = agent_toml_path(&root);

        set_agent_key(&path, "budget.max_tokens", Some(toml_edit::value(60i64))).expect("write");
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(raw.contains("max_tokens = 60"), "written under [budget]: {raw}");

        set_agent_key(&path, "budget.max_tokens", None).expect("unset");
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(!raw.contains("max_tokens = 60"), "removed: {raw}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn full_template_parses() {
        let root = unique_root("full");
        ensure_project(&root).expect("scaffold");
        let cfg = load_agent_config(&root).expect("load");
        assert_eq!(cfg.tools.default.as_deref(), Some("read-only"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The scaffold leaves the key commented out, so a fresh project picks up
    /// `DEFAULT_MAX_SESSION_TOKENS` rather than a hardcoded template value.
    #[cfg(feature = "cli")]
    #[test]
    fn scaffold_template_leaves_session_budget_unset() {
        let cfg: AgentToml =
            toml::from_str(AGENT_TOML_TEMPLATE).expect("scaffold template parses");
        assert_eq!(cfg.budget.max_tokens, None);
    }

    #[cfg(feature = "cli")]
    #[test]
    fn budget_max_tokens_parses_when_set() {
        let cfg: AgentToml =
            toml::from_str("[budget]\nmax_tokens = 200000\n").expect("parses");
        assert_eq!(cfg.budget.max_tokens, Some(200_000));
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
