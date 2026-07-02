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

    /// Deny always wins. Then an explicit allow / allow_write match permits.
    /// Otherwise fall back to the default policy: Allow permits, Deny/ReadOnly block.
    pub(crate) fn permits(&self, tool_name: &str) -> bool {
        if self.is_denied(tool_name) {
            return false;
        }
        self.is_allowed(tool_name) || matches!(self.default, PermissionDefault::Allow)
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
    fn read_only_default_blocks_unlisted_tools() {
        let perms = ToolPermissions::new(PermissionDefault::ReadOnly, &[], &[], &[]);
        assert!(!perms.permits("mcp.search"));

        let perms =
            ToolPermissions::new(PermissionDefault::ReadOnly, &s(&["mcp.search"]), &[], &[]);
        assert!(perms.permits("mcp.search"));
    }

    #[test]
    fn deny_wins_over_allow() {
        let perms = ToolPermissions::new(
            PermissionDefault::ReadOnly,
            &s(&["fs.*"]),
            &s(&["fs.delete"]),
            &[],
        );
        assert!(perms.permits("fs.read"));
        assert!(!perms.permits("fs.delete"));
    }

    #[test]
    fn write_is_opt_in() {
        let perms = ToolPermissions::new(PermissionDefault::ReadOnly, &[], &[], &[]);
        assert!(!perms.permits("fs.write"));

        let perms = ToolPermissions::new(PermissionDefault::ReadOnly, &[], &[], &s(&["fs.write"]));
        assert!(perms.permits("fs.write"));
    }

    #[test]
    fn allow_default_permits_unlisted_but_deny_blocks() {
        let perms = ToolPermissions::new(PermissionDefault::Allow, &[], &s(&["secret.*"]), &[]);
        assert!(perms.permits("anything"));
        assert!(!perms.permits("secret.key"));
    }

    #[test]
    fn glob_matching() {
        let perms = ToolPermissions::new(PermissionDefault::ReadOnly, &s(&["rag.*"]), &[], &[]);
        assert!(perms.permits("rag.query"));
        assert!(!perms.permits("mcp.search"));
    }

    #[test]
    fn allow_all_is_permissive() {
        assert!(ToolPermissions::allow_all().permits("x"));
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
