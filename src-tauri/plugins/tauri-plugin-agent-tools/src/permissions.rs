//! Tool-permission gate built from the `[tools]` section of `agent.toml`.
//! Tools are MCP-only, so read/write cannot be inferred from a tool; classification
//! is purely by the explicit name/glob lists. Deny always wins.

use glob::Pattern;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PermissionDefault {
    Allow,
    Deny,
    #[default]
    ReadOnly,
}

impl PermissionDefault {
    /// Lenient parser: unknown/empty falls back to the secure default (ReadOnly).
    pub fn from_str_lenient(s: &str) -> Self {
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

/// Each pattern as written, plus `memory` for one that named the old memory
/// tools (see [`crate::tools::names_legacy_memory`]), so such a rule keeps
/// applying -- a deny to the whole tool, which is the conservative reading.
fn compile(patterns: &[String]) -> Vec<Pattern> {
    patterns
        .iter()
        .flat_map(|p| {
            let alias = crate::tools::names_legacy_memory(p).then_some(crate::tools::MEMORY_TOOL);
            std::iter::once(p.as_str()).chain(alias)
        })
        .filter_map(|p| Pattern::new(p).ok())
        .collect()
}

impl ToolPermissions {
    pub fn new(
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
    pub fn allow_all() -> Self {
        Self {
            default: PermissionDefault::Allow,
            allow: Vec::new(),
            deny: Vec::new(),
            allow_write: Vec::new(),
        }
    }

    /// These permissions with `name` denied as well: hidden from the tool list
    /// and refused at the gate, whatever the allow lists say. How a caller takes
    /// one tool away from a run (a subagent's memory) without a config edit.
    pub fn with_denied(mut self, name: &str) -> Self {
        if let Ok(pattern) = Pattern::new(&Pattern::escape(name)) {
            self.deny.push(pattern);
        }
        self
    }

    pub fn is_denied(&self, name: &str) -> bool {
        self.deny.iter().any(|p| p.matches(name))
    }

    /// Explicit allow-list membership (allow OR allow_write); does NOT consider deny or default.
    pub fn is_allowed(&self, name: &str) -> bool {
        self.allow.iter().any(|p| p.matches(name))
            || self.allow_write.iter().any(|p| p.matches(name))
    }

    /// Whether an MCP tool is advertised to the model. Deny always wins. Otherwise
    /// an explicit allow, or any default except `deny`, advertises it. Unlike
    /// built-in fs/exec tools, MCP tools are opaque and the user opted into them by
    /// configuring the server, so `read-only` does not suppress them (`deny` locks
    /// everything down). Execution of built-ins is gated separately at call time.
    pub fn advertises_mcp(&self, tool_name: &str) -> bool {
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
    fn with_denied_takes_one_exact_tool_away_even_from_an_allow_list() {
        let perms = ToolPermissions::new(PermissionDefault::Allow, &s(&["memory"]), &[], &[])
            .with_denied("memory");
        assert!(perms.is_denied("memory"));
        assert!(!perms.is_denied("memory_extra"), "an exact name, not a prefix");
        assert!(!perms.is_denied("read"));
    }

    /// A rule on an old memory tool name still applies, to the one `memory`
    /// tool: a deny on `memory_read` denies every op rather than none.
    #[test]
    fn old_memory_tool_names_apply_to_the_memory_tool() {
        for old in ["memory_write", "memory_read", "memory_list", "memory_*"] {
            let perms = ToolPermissions::new(PermissionDefault::Allow, &[], &s(&[old]), &[]);
            assert!(perms.is_denied("memory"), "deny {old}");
            let perms = ToolPermissions::new(PermissionDefault::ReadOnly, &s(&[old]), &[], &[]);
            assert!(perms.is_allowed("memory"), "allow {old}");
            let perms = ToolPermissions::new(PermissionDefault::ReadOnly, &[], &[], &s(&[old]));
            assert!(perms.is_allowed("memory"), "allow_write {old}");
        }
        let broad = ToolPermissions::new(PermissionDefault::Allow, &[], &s(&["*write*"]), &[]);
        assert!(!broad.is_denied("memory"), "a glob that never named memory is left alone");
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
