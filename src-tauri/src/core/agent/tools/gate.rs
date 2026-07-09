use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::core::agent::permissions::ToolPermissions;
use crate::core::agent::tools::sandbox::{
    command_touches_restricted_agent_path, escapes_project, is_restricted_agent_path,
};
use crate::core::agent::tools::{BuiltinTool, Capability};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptKind {
    ReadEscape,
    Write,
    Exec,
}

/// The user's answer to a permission prompt (wire shape for a later IPC command).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionDecision {
    AllowOnce,
    AllowAlways,
    Deny,
}

/// In-memory, thread-scoped permission grants (never persisted). Exec grants are
/// per base command (e.g. granting `git` allows `git ...` but not `rm ...`),
/// matching the user's "allow all git commands" intent.
#[derive(Debug, Clone, Default)]
pub struct SessionGrants {
    read_escape: bool,
    write: bool,
    exec_commands: std::collections::BTreeSet<String>,
}

/// The base command a shell string runs: the first whitespace-delimited token,
/// with any directory prefix stripped (`/usr/bin/git` -> `git`). Returns `None`
/// for an empty command.
pub fn command_base(command: &str) -> Option<&str> {
    let first = command.split_whitespace().next()?;
    let base = first.rsplit(['/', '\\']).next().unwrap_or(first);
    (!base.is_empty()).then_some(base)
}

impl SessionGrants {
    pub fn covers(&self, kind: PromptKind) -> bool {
        match kind {
            PromptKind::ReadEscape => self.read_escape,
            PromptKind::Write => self.write,
            // Exec coverage is command-specific; use `covers_command`.
            PromptKind::Exec => false,
        }
    }

    /// Whether a previously granted base command covers this shell command.
    pub fn covers_command(&self, command: &str) -> bool {
        command_base(command).is_some_and(|b| self.exec_commands.contains(b))
    }

    pub fn grant(&mut self, kind: PromptKind) {
        match kind {
            PromptKind::ReadEscape => self.read_escape = true,
            PromptKind::Write => self.write = true,
            // No-op: exec is granted per command via `grant_command`.
            PromptKind::Exec => {}
        }
    }

    /// Grant the base command of `command` for the rest of this session.
    pub fn grant_command(&mut self, command: &str) {
        if let Some(base) = command_base(command) {
            self.exec_commands.insert(base.to_string());
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Decision {
    Allow,
    HardDeny,
    Prompt(PromptKind),
}

/// Decide how a built-in tool call should be gated, combining the static
/// agent.toml policy, capability class, sandbox escape, and session grants.
///
/// Precedence: deny (agent.toml) > explicit allow/allow_write (agent.toml) >
/// session grant > capability rules. Reads inside the project are silently
/// allowed; reads that escape the project, and all writes/exec, prompt (unless
/// already granted this session or pre-approved in agent.toml).
pub fn resolve_decision(
    tool: &BuiltinTool,
    args: &serde_json::Value,
    project_root: &Path,
    perms: &ToolPermissions,
    grants: &SessionGrants,
) -> Decision {
    if perms.is_denied(tool.name) {
        return Decision::HardDeny;
    }
    // Only the agent's own skills/memory/AGENT.md are reachable under .jan/agent/.
    // Any other path there (agent.toml, the dir listing) is off-limits to every
    // tool, ahead of allow rules so an allowed tool name cannot bypass it.
    let hits_restricted = tool.path_args.iter().any(|key| {
        args.get(key)
            .and_then(|v| v.as_str())
            .map(|p| is_restricted_agent_path(project_root, p))
            .unwrap_or(false)
    });
    let exec_hits_restricted = tool.capability == Capability::Exec
        && args
            .get("command")
            .and_then(|v| v.as_str())
            .map(|c| command_touches_restricted_agent_path(project_root, c))
            .unwrap_or(false);
    if hits_restricted || exec_hits_restricted {
        return Decision::HardDeny;
    }
    if perms.is_allowed(tool.name) {
        return Decision::Allow;
    }
    // Dedicated skill/memory tools act only on the agent's own workspace by a
    // sanitized name, so they never prompt (deny above still wins).
    if crate::core::agent::tools::is_workspace_tool(tool.name) {
        return Decision::Allow;
    }
    match tool.capability {
        Capability::Read => {
            let escapes = tool.path_args.iter().any(|key| {
                args.get(key)
                    .and_then(|v| v.as_str())
                    .map(|p| escapes_project(project_root, p).unwrap_or(true))
                    .unwrap_or(false)
            });
            if !escapes || grants.covers(PromptKind::ReadEscape) {
                Decision::Allow
            } else {
                Decision::Prompt(PromptKind::ReadEscape)
            }
        }
        Capability::Write => gated(PromptKind::Write, grants),
        Capability::Exec => {
            let command = args.get("command").and_then(|v| v.as_str()).unwrap_or("");
            if grants.covers_command(command) {
                Decision::Allow
            } else {
                Decision::Prompt(PromptKind::Exec)
            }
        }
    }
}

fn gated(kind: PromptKind, grants: &SessionGrants) -> Decision {
    if grants.covers(kind) {
        Decision::Allow
    } else {
        Decision::Prompt(kind)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::agent::permissions::{PermissionDefault, ToolPermissions};
    use crate::core::agent::tools::lookup;
    use serde_json::json;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn unique_root() -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("jan_gate_test_{}_{}", std::process::id(), n));
        std::fs::create_dir_all(&dir).expect("create test root");
        dir
    }

    fn s(items: &[&str]) -> Vec<String> {
        items.iter().map(|v| v.to_string()).collect()
    }

    #[test]
    fn in_project_read_allows() {
        let root = unique_root();
        std::fs::write(root.join("inner.txt"), b"x").unwrap();
        let perms = ToolPermissions::allow_all();
        let grants = SessionGrants::default();
        let d = resolve_decision(
            lookup("read").unwrap(),
            &json!({"path": "inner.txt"}),
            &root,
            &perms,
            &grants,
        );
        assert_eq!(d, Decision::Allow);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn escaping_read_prompts() {
        let root = unique_root();
        let perms = ToolPermissions::new(PermissionDefault::ReadOnly, &[], &[], &[]);
        let grants = SessionGrants::default();
        let d = resolve_decision(
            lookup("read").unwrap(),
            &json!({"path": "../x"}),
            &root,
            &perms,
            &grants,
        );
        assert_eq!(d, Decision::Prompt(PromptKind::ReadEscape));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn agent_config_is_off_limits_to_every_tool() {
        let root = unique_root();
        std::fs::create_dir_all(root.join(".jan/agent")).unwrap();
        std::fs::write(root.join(".jan/agent/agent.toml"), b"[tools]\n").unwrap();
        let perms = ToolPermissions::allow_all();
        let grants = SessionGrants::default();
        // Read/ls/find/grep and write/edit all hard-deny on agent.toml.
        for tool in ["read", "ls", "find", "grep", "write", "edit"] {
            let d = resolve_decision(
                lookup(tool).unwrap(),
                &json!({ "path": ".jan/agent/agent.toml" }),
                &root,
                &perms,
                &grants,
            );
            assert_eq!(d, Decision::HardDeny, "{tool} on agent.toml must be denied");
        }
        // bash referencing it is denied too.
        let d = resolve_decision(
            lookup("bash").unwrap(),
            &json!({"command": "cat .jan/agent/agent.toml"}),
            &root,
            &perms,
            &grants,
        );
        assert_eq!(d, Decision::HardDeny);
        // AGENT.md remains readable.
        std::fs::write(root.join(".jan/agent/AGENT.md"), b"x").unwrap();
        let d = resolve_decision(
            lookup("read").unwrap(),
            &json!({"path": ".jan/agent/AGENT.md"}),
            &root,
            &perms,
            &grants,
        );
        assert_eq!(d, Decision::Allow);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn write_prompts_by_default() {
        let root = unique_root();
        let perms = ToolPermissions::new(PermissionDefault::ReadOnly, &[], &[], &[]);
        let grants = SessionGrants::default();
        let d = resolve_decision(
            lookup("write").unwrap(),
            &json!({"path": "out.txt"}),
            &root,
            &perms,
            &grants,
        );
        assert_eq!(d, Decision::Prompt(PromptKind::Write));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn bash_prompts_exec() {
        let root = unique_root();
        let perms = ToolPermissions::new(PermissionDefault::ReadOnly, &[], &[], &[]);
        let grants = SessionGrants::default();
        let d = resolve_decision(
            lookup("bash").unwrap(),
            &json!({"command": "ls"}),
            &root,
            &perms,
            &grants,
        );
        assert_eq!(d, Decision::Prompt(PromptKind::Exec));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn command_base_strips_path_and_args() {
        assert_eq!(command_base("git status"), Some("git"));
        assert_eq!(command_base("/usr/bin/git commit -m x"), Some("git"));
        assert_eq!(command_base("   "), None);
        assert_eq!(command_base(""), None);
    }

    #[test]
    fn exec_grant_is_scoped_to_base_command() {
        let root = unique_root();
        let perms = ToolPermissions::new(PermissionDefault::ReadOnly, &[], &[], &[]);
        let mut grants = SessionGrants::default();
        grants.grant_command("git status");

        // Same base command -> allowed without prompting.
        let d = resolve_decision(
            lookup("bash").unwrap(),
            &json!({"command": "git push"}),
            &root,
            &perms,
            &grants,
        );
        assert_eq!(d, Decision::Allow);

        // A different command still prompts.
        let d = resolve_decision(
            lookup("bash").unwrap(),
            &json!({"command": "rm -rf /"}),
            &root,
            &perms,
            &grants,
        );
        assert_eq!(d, Decision::Prompt(PromptKind::Exec));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn general_tools_cannot_reach_skills_memory_or_config() {
        let root = unique_root();
        let perms = ToolPermissions::allow_all();
        let grants = SessionGrants::default();
        // skills/ and memory/ are reachable only via the dedicated tools; general
        // read/write/edit/ls/find/grep hard-deny there, same as agent.toml.
        let paths = [
            ".jan/agent/skills/deploy.md",
            ".jan/agent/memory/notes.md",
            ".jan/agent/agent.toml",
        ];
        for tool in ["read", "ls", "find", "grep", "write", "edit"] {
            for path in paths {
                let d = resolve_decision(
                    lookup(tool).unwrap(),
                    &json!({ "path": path }),
                    &root,
                    &perms,
                    &grants,
                );
                assert_eq!(d, Decision::HardDeny, "{tool} on {path} must be denied");
            }
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn workspace_tools_auto_allow_but_deny_still_wins() {
        let root = unique_root();
        let grants = SessionGrants::default();
        let perms = ToolPermissions::new(PermissionDefault::ReadOnly, &[], &[], &[]);
        for name in ["memory_read", "memory_write", "skill_write", "memory_list"] {
            let d = resolve_decision(
                lookup(name).unwrap(),
                &json!({"name": "x", "content": "y"}),
                &root,
                &perms,
                &grants,
            );
            assert_eq!(d, Decision::Allow, "{name} should auto-allow");
        }
        // Explicit deny in agent.toml still overrides the auto-allow.
        let denied = ToolPermissions::new(PermissionDefault::ReadOnly, &[], &s(&["memory_write"]), &[]);
        let d = resolve_decision(
            lookup("memory_write").unwrap(),
            &json!({"name": "x", "content": "y"}),
            &root,
            &denied,
            &grants,
        );
        assert_eq!(d, Decision::HardDeny);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn deny_wins_over_prompt() {
        let root = unique_root();
        let perms = ToolPermissions::new(PermissionDefault::ReadOnly, &[], &s(&["write"]), &[]);
        let grants = SessionGrants::default();
        let d = resolve_decision(
            lookup("write").unwrap(),
            &json!({"path": "out.txt"}),
            &root,
            &perms,
            &grants,
        );
        assert_eq!(d, Decision::HardDeny);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn explicit_allow_write_skips_prompt() {
        let root = unique_root();
        let perms = ToolPermissions::new(PermissionDefault::ReadOnly, &[], &[], &s(&["write"]));
        let grants = SessionGrants::default();
        let d = resolve_decision(
            lookup("write").unwrap(),
            &json!({"path": "out.txt"}),
            &root,
            &perms,
            &grants,
        );
        assert_eq!(d, Decision::Allow);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn session_grant_allows_write() {
        let root = unique_root();
        let perms = ToolPermissions::new(PermissionDefault::ReadOnly, &[], &[], &[]);
        let mut grants = SessionGrants::default();
        grants.grant(PromptKind::Write);
        let d = resolve_decision(
            lookup("write").unwrap(),
            &json!({"path": "out.txt"}),
            &root,
            &perms,
            &grants,
        );
        assert_eq!(d, Decision::Allow);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn session_grant_allows_read_escape() {
        let root = unique_root();
        let perms = ToolPermissions::new(PermissionDefault::ReadOnly, &[], &[], &[]);
        let mut grants = SessionGrants::default();
        grants.grant(PromptKind::ReadEscape);
        let d = resolve_decision(
            lookup("read").unwrap(),
            &json!({"path": "../x"}),
            &root,
            &perms,
            &grants,
        );
        assert_eq!(d, Decision::Allow);
        let _ = std::fs::remove_dir_all(&root);
    }
}
