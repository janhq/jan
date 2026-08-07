//! Built-in agent tools: the capability classification and the `BUILTIN_TOOLS`
//! registry every other module in this crate keys off.

use std::path::Path;

/// Windows-only confinement backend for [`jail`]. Present on every platform so
/// the argv it builds stays unit-testable.
pub mod appcontainer;
pub mod cmdscan;
pub mod gate;
pub mod handlers;
pub mod jail;
pub mod proc;
/// Path containment for the filesystem tools. Distinct from [`jail`], which is
/// kernel-level confinement for spawned commands.
pub mod sandbox;
pub mod schema;
pub mod web;

/// Ambient context a tool call executes against.
///
/// The two roots are separate because they have different lifetimes.
/// `project_root` is the sandbox the filesystem tools are confined to, which the
/// desktop makes ephemeral and per-thread; `store_root` holds `memory/` and
/// `skills/`, which must survive every conversation. Keeping the store outside
/// `project_root` is also what stops the general filesystem tools from reaching
/// it -- `escapes_project` refuses the path, with no extra rule needed.
///
/// A project that co-locates its store (dev's layout, and the CLI agent) simply
/// passes `workspace::project_store(project_root)` as `store_root`.
///
/// `enabled_skills` is the `[skills].enabled` whitelist from the project's
/// `agent.toml` (empty = every skill enabled). It is passed in rather than read
/// here so this crate owns no config-file format: the desktop app and the CLI
/// already parse `agent.toml` themselves.
/// `allow_network` opens the sandboxed shell's network namespace. It defaults to
/// off and is a field rather than a `new` parameter so existing callers keep the
/// safe default without being rewritten.
#[derive(Debug, Clone, Copy)]
pub struct ToolContext<'a> {
    pub project_root: &'a Path,
    pub store_root: &'a Path,
    pub enabled_skills: &'a [String],
    pub allow_network: bool,
    /// When set, `write`/`edit` re-canonicalize the target and refuse a path
    /// that escapes `project_root`, closing the check/use race between the
    /// gate's decision-time canonicalization and the handler's raw-path write.
    /// The CLI leaves it off so a user-approved escaping write still works.
    pub confine_writes: bool,
    /// The Jan data-folder root, masked from the sandboxed shell on surfaces
    /// where it sits outside the workspace (the desktop). `None` on the CLI,
    /// where the project itself is the workspace.
    pub mask_root: Option<&'a Path>,
    /// Expose `$HOME` to the sandboxed shell read-only (the CLI) instead of
    /// hiding it (the desktop). Passed through to the `bash` sandbox policy.
    pub home_readonly: bool,
}

impl<'a> ToolContext<'a> {
    pub fn new(project_root: &'a Path, store_root: &'a Path, enabled_skills: &'a [String]) -> Self {
        Self {
            project_root,
            store_root,
            enabled_skills,
            allow_network: false,
            confine_writes: false,
            mask_root: None,
            home_readonly: false,
        }
    }

    pub fn with_network(mut self, allow: bool) -> Self {
        self.allow_network = allow;
        self
    }

    pub fn with_confined_writes(mut self, confine: bool) -> Self {
        self.confine_writes = confine;
        self
    }

    pub fn with_mask_root(mut self, mask_root: &'a Path) -> Self {
        self.mask_root = Some(mask_root);
        self
    }

    /// Expose `$HOME` to the sandboxed shell read-only. See [`Self::home_readonly`].
    pub fn with_home_readonly(mut self, home_readonly: bool) -> Self {
        self.home_readonly = home_readonly;
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Capability {
    Read,
    Write,
    Exec,
    /// Network egress (native web tools). Distinct from `Read`/`Exec` so the
    /// gate can treat outbound web access as its own auto-allowed class rather
    /// than a filesystem or shell operation.
    Net,
}

#[derive(Debug, Clone, Copy)]
pub struct BuiltinTool {
    pub name: &'static str,
    pub capability: Capability,
    /// JSON argument keys that carry a filesystem path to sandbox-check.
    pub path_args: &'static [&'static str],
}

/// The 7 tools mirror pi's coding-agent set exactly (read/ls/find/grep/write/edit/bash).
pub const BUILTIN_TOOLS: &[BuiltinTool] = &[
    BuiltinTool {
        name: "read",
        capability: Capability::Read,
        path_args: &["path"],
    },
    BuiltinTool {
        name: "ls",
        capability: Capability::Read,
        path_args: &["path"],
    },
    BuiltinTool {
        name: "find",
        capability: Capability::Read,
        path_args: &["path"],
    },
    BuiltinTool {
        name: "grep",
        capability: Capability::Read,
        path_args: &["path"],
    },
    BuiltinTool {
        name: "write",
        capability: Capability::Write,
        path_args: &["path"],
    },
    BuiltinTool {
        name: "edit",
        capability: Capability::Write,
        path_args: &["path"],
    },
    BuiltinTool {
        name: "bash",
        capability: Capability::Exec,
        path_args: &[],
    },
    // Dedicated skill/memory tools. They operate on `.jan/agent/{skills,memory}/`
    // by name (never a path), so they are always workspace-scoped and never
    // prompt. `path_args` is empty: there is no path to sandbox-check.
    BuiltinTool {
        name: "memory_list",
        capability: Capability::Read,
        path_args: &[],
    },
    BuiltinTool {
        name: "memory_read",
        capability: Capability::Read,
        path_args: &[],
    },
    BuiltinTool {
        name: "memory_write",
        capability: Capability::Write,
        path_args: &[],
    },
    BuiltinTool {
        name: "skill_list",
        capability: Capability::Read,
        path_args: &[],
    },
    BuiltinTool {
        name: "skill_read",
        capability: Capability::Read,
        path_args: &[],
    },
    BuiltinTool {
        name: "skill_write",
        capability: Capability::Write,
        path_args: &[],
    },
    // Native, provider-neutral web tools. They are compiled into the agent
    // core (NOT provided by an MCP server); Exa is only the default backend
    // behind an adapter. They take no filesystem path, so `path_args` is empty.
    BuiltinTool {
        name: "web_search",
        capability: Capability::Net,
        path_args: &[],
    },
    BuiltinTool {
        name: "web_fetch",
        capability: Capability::Net,
        path_args: &[],
    },
];

/// Tools that act only on the agent's own `.jan/agent/{skills,memory}/`
/// workspace. They are auto-allowed by the gate (no prompt), since a sanitized
/// name can never escape the workspace. `deny` in agent.toml still overrides.
pub fn is_workspace_tool(name: &str) -> bool {
    matches!(
        name,
        "memory_list"
            | "memory_read"
            | "memory_write"
            | "skill_list"
            | "skill_read"
            | "skill_write"
    )
}

pub fn lookup(name: &str) -> Option<&'static BuiltinTool> {
    BUILTIN_TOOLS.iter().find(|t| t.name == name)
}

pub fn is_builtin(name: &str) -> bool {
    lookup(name).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lookup_read_is_read_capability() {
        let t = lookup("read").expect("read is builtin");
        assert_eq!(t.capability, Capability::Read);
        assert_eq!(t.path_args, &["path"]);
    }

    #[test]
    fn lookup_bash_is_exec_no_paths() {
        let t = lookup("bash").expect("bash is builtin");
        assert_eq!(t.capability, Capability::Exec);
        assert!(t.path_args.is_empty());
    }

    #[test]
    fn unknown_is_not_builtin() {
        assert!(lookup("nope").is_none());
        assert!(!is_builtin("nope"));
    }

    #[test]
    fn builtin_count_matches_expected() {
        // 7 coding tools + 6 dedicated skill/memory tools + 2 native web tools.
        assert_eq!(BUILTIN_TOOLS.len(), 15);
    }

    #[test]
    fn web_tools_are_net_capability() {
        let s = lookup("web_search").expect("web_search is builtin");
        assert_eq!(s.capability, Capability::Net);
        assert!(s.path_args.is_empty());
        let f = lookup("web_fetch").expect("web_fetch is builtin");
        assert_eq!(f.capability, Capability::Net);
        assert!(f.path_args.is_empty());
    }

    #[test]
    fn workspace_tools_are_classified() {
        assert!(is_workspace_tool("memory_write"));
        assert!(is_workspace_tool("skill_list"));
        assert!(!is_workspace_tool("write"));
        assert!(!is_workspace_tool("bash"));
    }
}
