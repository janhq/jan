//! Tool-permission gate built from the `[tools]` section of `agent.toml`.
//! Tools are MCP-only, so read/write cannot be inferred from a tool; classification
//! is purely by the explicit name/glob lists. Deny always wins.

use glob::Pattern;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum PermissionDefault {
    Allow,
    Deny,
    #[default]
    ReadOnly,
}

impl PermissionDefault {
    /// Lenient parser: unknown/empty falls back to the secure default (ReadOnly).
    pub(crate) fn from_str_lenient(s: &str) -> Self {
        match s.trim().to_ascii_lowercase().as_str() {
            "allow" => PermissionDefault::Allow,
            "deny" => PermissionDefault::Deny,
            "read-only" | "readonly" => PermissionDefault::ReadOnly,
            _ => PermissionDefault::ReadOnly,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ToolPermissions {
    default: PermissionDefault,
    allow: Vec<Pattern>,
    deny: Vec<Pattern>,
    allow_write: Vec<Pattern>,
}

fn compile(patterns: &[String]) -> Vec<Pattern> {
    patterns
        .iter()
        .filter_map(|p| Pattern::new(p).ok())
        .collect()
}

impl ToolPermissions {
    pub(crate) fn new(
        default: PermissionDefault,
        allow: &[String],
        deny: &[String],
        allow_write: &[String],
    ) -> Self {
        Self {
            default,
            allow: compile(allow),
            deny: compile(deny),
            allow_write: compile(allow_write),
        }
    }

    /// Permissive: allow-by-default with no lists. Used when no `[tools]` section
    /// is configured, preserving the loop's historical "run all tools" behavior.
    pub(crate) fn allow_all() -> Self {
        Self {
            default: PermissionDefault::Allow,
            allow: Vec::new(),
            deny: Vec::new(),
            allow_write: Vec::new(),
        }
    }

    pub(crate) fn is_denied(&self, name: &str) -> bool {
        self.deny.iter().any(|p| p.matches(name))
    }

    /// Explicit allow-list membership (allow OR allow_write); does NOT consider deny or default.
    pub(crate) fn is_allowed(&self, name: &str) -> bool {
        self.allow.iter().any(|p| p.matches(name))
            || self.allow_write.iter().any(|p| p.matches(name))
    }

    /// Whether an MCP tool is advertised to the model. Deny always wins. Otherwise
    /// an explicit allow, or any default except `deny`, advertises it. Unlike
    /// built-in fs/exec tools, MCP tools are opaque and the user opted into them by
    /// configuring the server, so `read-only` does not suppress them (`deny` locks
    /// everything down). Execution of built-ins is gated separately at call time.
    pub(crate) fn advertises_mcp(&self, tool_name: &str) -> bool {
        if self.is_denied(tool_name) {
            return false;
        }
        self.is_allowed(tool_name) || !matches!(self.default, PermissionDefault::Deny)
    }
}

impl Default for ToolPermissions {
    fn default() -> Self {
        Self::allow_all()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(items: &[&str]) -> Vec<String> {
        items.iter().map(|v| v.to_string()).collect()
    }

    #[test]
    fn read_only_advertises_unlisted_mcp_tools() {
        // read-only (the CLI default) must not suppress opaque MCP tools.
        let perms = ToolPermissions::new(PermissionDefault::ReadOnly, &[], &[], &[]);
        assert!(perms.advertises_mcp("mcp.search"));
    }

    #[test]
    fn deny_default_locks_down_mcp_unless_allowed() {
        let perms = ToolPermissions::new(PermissionDefault::Deny, &[], &[], &[]);
        assert!(!perms.advertises_mcp("mcp.search"));

        let perms = ToolPermissions::new(PermissionDefault::Deny, &s(&["mcp.search"]), &[], &[]);
        assert!(perms.advertises_mcp("mcp.search"));
    }

    #[test]
    fn deny_wins_over_default_and_allow() {
        let perms = ToolPermissions::new(
            PermissionDefault::Allow,
            &s(&["fs.*"]),
            &s(&["fs.delete"]),
            &[],
        );
        assert!(perms.advertises_mcp("fs.read"));
        assert!(!perms.advertises_mcp("fs.delete"));
    }

    #[test]
    fn is_allowed_matches_globs_only() {
        let perms = ToolPermissions::new(PermissionDefault::ReadOnly, &s(&["rag.*"]), &[], &[]);
        assert!(perms.is_allowed("rag.query"));
        assert!(!perms.is_allowed("mcp.search"));
    }

    #[test]
    fn allow_all_advertises_everything() {
        assert!(ToolPermissions::allow_all().advertises_mcp("x"));
    }

    #[test]
    fn lenient_parse() {
        assert_eq!(
            PermissionDefault::from_str_lenient("allow"),
            PermissionDefault::Allow
        );
        assert_eq!(
            PermissionDefault::from_str_lenient("DENY"),
            PermissionDefault::Deny
        );
        assert_eq!(
            PermissionDefault::from_str_lenient("read-only"),
            PermissionDefault::ReadOnly
        );
        assert_eq!(
            PermissionDefault::from_str_lenient("readonly"),
            PermissionDefault::ReadOnly
        );
        assert_eq!(
            PermissionDefault::from_str_lenient("bogus"),
            PermissionDefault::ReadOnly
        );
    }
}
