//! Where a run's hooks and plugin-declared tools come from.
//!
//! The toolset crate owns the hook *machinery* (matching, running, the stdin
//! protocol) but no config format, exactly as it owns no config format for
//! anything else. This module is the one place that maps the three on-disk
//! sources onto a [`HookSet`], and the plugin manifests onto a
//! [`PluginToolSet`], so a hook's precedence is decided once per run rather
//! than re-derived at each call site.
//!
//! Merge order is least specific first, so the most specific source runs last
//! and therefore has the final word on a deny:
//!
//! 1. installed plugins' `hooks/hooks.json` (shipped by a third party)
//! 2. `~/.jan/config.toml` `[[hooks]]` (this user, every project)
//! 3. `<project>/.jan/agent/agent.toml` `[[hooks]]` (this project)

use std::path::Path;

use tauri_plugin_agent_tools::tools::hooks::{self, HookSet};
use tauri_plugin_agent_tools::tools::plugin_tools::{PluginToolEntry, PluginToolSet};

/// Resolve every hook a run in `project_root` fires, in merge order.
///
/// A missing or malformed source contributes nothing rather than failing: the
/// same fail-open rule the rest of the config layer follows, since a run that
/// refuses to start over one bad hook line is worse than a run with one hook
/// fewer.
pub(crate) fn resolve_hooks(project_root: &Path) -> HookSet {
    let mut set = HookSet::new();
    for (dir, name) in plugin_dirs(project_root) {
        let _ = name;
        let (entries, source) = hooks::plugin_hook_entries(&dir);
        set.extend_from(entries, &source);
    }
    #[cfg(feature = "cli")]
    {
        if let Ok(path) = crate::core::agent::global_config::global_config_path() {
            set.extend_from(crate::core::agent::global_config::hook_entries(), &path);
        }
    }
    if let Ok(cfg) = crate::core::agent::project::load_agent_config(project_root) {
        set.extend_from(
            cfg.hooks,
            &crate::core::agent::project::agent_toml_path(project_root),
        );
    }
    set
}

/// Every tool the installed plugins declare, in plugin-directory order.
pub(crate) fn resolve_plugin_tools(project_root: &Path) -> PluginToolSet {
    let mut set = PluginToolSet::new();
    for (dir, name) in plugin_dirs(project_root) {
        set.extend_from(&name, plugin_tool_entries(&dir), &dir);
    }
    set
}

/// The `[[tools]]` a plugin declares in its `plugin.toml`. Read here rather
/// than in `plugins.rs` so the manifest's optional sections stay independent:
/// a plugin with no tools parses exactly as it did before.
pub(crate) fn plugin_tool_entries(plugin_dir: &Path) -> Vec<PluginToolEntry> {
    #[derive(serde::Deserialize)]
    struct ToolsManifest {
        #[serde(default)]
        tools: Vec<PluginToolEntry>,
    }
    std::fs::read_to_string(plugin_dir.join("plugin.toml"))
        .ok()
        .and_then(|raw| toml::from_str::<ToolsManifest>(&raw).ok())
        .map(|manifest| manifest.tools)
        .unwrap_or_default()
}

/// Installed plugin directories with their directory names, sorted so a run's
/// hook order is stable across machines. Staging directories from interrupted
/// installs are skipped, matching `plugins::installed_entries`.
fn plugin_dirs(project_root: &Path) -> Vec<(std::path::PathBuf, String)> {
    let dir = crate::core::agent::skills::plugins_dir(project_root);
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut out: Vec<(std::path::PathBuf, String)> = rd
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| {
            let path = e.path();
            let name = path.file_name()?.to_str()?.to_string();
            (!name.starts_with(".installing-")).then_some((path, name))
        })
        .collect();
    out.sort_by(|a, b| a.1.cmp(&b.1));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_agent_tools::tools::hooks::HookEvent;

    fn unique_root(tag: &str) -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("jan-hookscfg-{tag}-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_agent_toml(root: &Path, body: &str) {
        let dir = root.join(".jan").join("agent");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("agent.toml"), body).unwrap();
    }

    fn write_plugin(root: &Path, name: &str, hooks_json: Option<&str>, manifest: Option<&str>) {
        let dir = crate::core::agent::skills::plugins_dir(root).join(name);
        std::fs::create_dir_all(&dir).unwrap();
        if let Some(json) = hooks_json {
            std::fs::create_dir_all(dir.join("hooks")).unwrap();
            std::fs::write(dir.join("hooks").join("hooks.json"), json).unwrap();
        }
        if let Some(toml) = manifest {
            std::fs::write(dir.join("plugin.toml"), toml).unwrap();
        }
    }

    #[test]
    fn agent_toml_hooks_are_discovered() {
        let root = unique_root("agenttoml");
        write_agent_toml(
            &root,
            r#"
[[hooks]]
event = "PostToolUse"
matcher = "edit"
command = "cargo fmt"
"#,
        );
        let set = resolve_hooks(&root);
        assert_eq!(set.len(), 1);
        let matched = set.matching(HookEvent::PostToolUse, Some("edit"));
        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0].command, "cargo fmt");
        assert_eq!(
            matched[0].source,
            crate::core::agent::project::agent_toml_path(&root)
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_plugins_hooks_json_is_discovered() {
        let root = unique_root("pluginjson");
        write_plugin(
            &root,
            "auditor",
            Some(r#"[{"event":"PreToolUse","command":"audit.sh"}]"#),
            None,
        );
        let set = resolve_hooks(&root);
        assert_eq!(set.len(), 1);
        assert_eq!(set.all()[0].command, "audit.sh");
        assert!(set.all()[0].source.ends_with("hooks/hooks.json"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The project file is merged last, so its hook runs last and gets the
    /// final say on a call a plugin hook already looked at.
    #[test]
    fn a_projects_hooks_are_merged_after_a_plugins() {
        let root = unique_root("mergeorder");
        write_plugin(
            &root,
            "auditor",
            Some(r#"[{"event":"PreToolUse","command":"from-plugin"}]"#),
            None,
        );
        write_agent_toml(
            &root,
            r#"
[[hooks]]
event = "PreToolUse"
command = "from-project"
"#,
        );
        let set = resolve_hooks(&root);
        let commands: Vec<&str> = set
            .matching(HookEvent::PreToolUse, Some("bash"))
            .iter()
            .map(|h| h.command.as_str())
            .collect();
        assert_eq!(commands, vec!["from-plugin", "from-project"]);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_project_with_no_config_at_all_resolves_to_no_hooks() {
        let root = unique_root("empty");
        assert!(resolve_hooks(&root).is_empty());
        assert!(resolve_plugin_tools(&root).is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_malformed_agent_toml_contributes_no_hooks_instead_of_failing() {
        let root = unique_root("malformed");
        write_agent_toml(&root, "this is not = = toml");
        assert!(resolve_hooks(&root).is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_plugin_can_declare_a_tool_in_its_manifest() {
        let root = unique_root("plugintool");
        write_plugin(
            &root,
            "fmt",
            None,
            Some(
                r#"
name = "fmt"

[[tools]]
name = "format"
description = "Format the tree"
command = "cargo fmt"
"#,
            ),
        );
        let set = resolve_plugin_tools(&root);
        assert_eq!(set.len(), 1);
        let tool = &set.all()[0];
        assert_eq!(tool.qualified_name, "plugin__fmt__format");
        assert_eq!(tool.plugin, "fmt");
        assert_eq!(tool.command, "cargo fmt");
        assert!(set.is_plugin_tool("plugin__fmt__format"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A manifest without a `[[tools]]` section is the common case and must
    /// keep parsing exactly as it did before plugin tools existed.
    #[test]
    fn a_manifest_without_tools_declares_none() {
        let root = unique_root("notools");
        write_plugin(
            &root,
            "p",
            None,
            Some("name = \"p\"\nversion = \"1.0.0\"\n"),
        );
        assert!(resolve_plugin_tools(&root).is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn staging_directories_from_an_interrupted_install_are_skipped() {
        let root = unique_root("staging");
        write_plugin(
            &root,
            ".installing-halfdone",
            Some(r#"[{"event":"SessionStart","command":"nope"}]"#),
            None,
        );
        assert!(resolve_hooks(&root).is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
}
