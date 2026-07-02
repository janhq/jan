//! Built-in agent tools: capability classification + the 7 tools pi's
//! coding-agent exposes. Handlers and loop wiring land in a later phase; this
//! module is the pure metadata + gate surface.

pub mod gate;
pub mod handlers;
pub mod sandbox;
pub mod schema;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Capability {
    Read,
    Write,
    Exec,
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
];

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
    fn builtin_count_is_seven() {
        assert_eq!(BUILTIN_TOOLS.len(), 7);
    }
}
