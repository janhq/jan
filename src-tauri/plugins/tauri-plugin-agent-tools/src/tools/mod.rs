//! Built-in agent tools: the capability classification and the `BUILTIN_TOOLS`
//! registry every other module in this crate keys off.

use std::path::{Path, PathBuf};

/// Windows-only confinement backend for [`jail`]. Present on every platform so
/// the argv it builds stays unit-testable.
pub mod appcontainer;
/// User attachments copied into a session workspace for the agent to read.
pub mod attachments;
pub mod cmdscan;
pub mod gate;
pub mod handlers;
pub mod image;
pub mod jail;
/// The `monitor` tool's core: file watching + condition-script evaluation.
/// Loop-dispatched (like the subagent tools), so it is not in `BUILTIN_TOOLS`.
pub mod monitor;
pub mod proc;
/// Path containment for the filesystem tools. Distinct from [`jail`], which is
/// kernel-level confinement for spawned commands.
pub mod sandbox;
pub mod schema;
pub mod spill;
pub mod web;

/// A single OpenAI `image_url` content part: the `data:<mime>;base64,<bytes>`
/// URL plus a display name. This is what the `read` tool returns for an image
/// file, and the agent loop threads into the tool-result message so a vision
/// model sees the image.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageContentPart {
    /// `data:image/png;base64,...` URL, ready to embed in an `image_url` part.
    pub data_url: String,
    /// Basename shown to the model and in the transcript.
    pub name: String,
}

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
/// Not `Copy`: the output sink is an `Arc`. Cloning is cheap either way (every
/// other field is a borrow or a bool), so callers that relied on implicit copies
/// clone explicitly.
#[derive(Clone)]
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
    /// A session-scoped host directory the shell and the filesystem tools share
    /// for temporary work, so scratch files persist across `bash` calls in the
    /// run. See [`Policy::scratch_root`] for how each backend exposes it, and
    /// [`crate::workspace::scratch_dir`] for where it lives. `None` keeps the
    /// default throwaway per-command tmpfs. Cleaned up with the session (run end
    /// on the CLI, thread teardown on the desktop).
    pub scratch_root: Option<&'a Path>,
    /// Whether `bash` runs under OS confinement. On by default, and the desktop
    /// keeps it that way: there, `bash` is either sandboxed or withheld.
    ///
    /// The CLI turns it off (see its `--sandbox` flag and the `sandbox` config
    /// key), which runs the shell exactly as the user's own terminal would --
    /// no mounts, no policy, the user's real `$HOME` and `/tmp`. The permission
    /// gate is then the only thing between the model and the machine, which is
    /// why nothing else about the gate changes when this is off.
    pub sandbox: bool,
    /// Where a tool sends output as it is produced, when the caller wants to
    /// show it live. `None` means "collect and return only", which is what every
    /// non-interactive caller wants.
    ///
    /// `Arc` and not a borrow because `bash` hands its child to a detached task:
    /// the sink has to outlive the call that created it, which is also what makes
    /// a backgrounded command keep reporting after the tool has returned its
    /// `job_id`.
    pub on_output: Option<OutputSink>,
    /// Folders attached read-only: readable by the file tools and the shell,
    /// never writable. Empty on every surface that has not attached one.
    ///
    /// Owned paths rather than borrows because they are canonicalized once at
    /// attach time; re-canonicalizing per call would be both slower and a
    /// check/use race of its own.
    pub read_roots: &'a [PathBuf],
    /// The subset of attached folders the caller marked writable: `write`/`edit`
    /// and the sandboxed shell treat them like the workspace. Every entry must
    /// also be in `read_roots` (a folder the agent can change but not read back
    /// is useless), and the default is empty -- attaching stays read-only unless
    /// a surface opts in.
    pub write_roots: &'a [PathBuf],
    /// Correlation id echoed on every streamed output chunk.
    ///
    /// Needed because `bash` with `timeout: 0` backgrounds and keeps streaming
    /// after the tool has returned: without an id the caller cannot route late
    /// chunks to the tool call that produced them. Minted by the caller (the
    /// frontend's tool-call id) rather than inside `bash`, so the sink can carry
    /// it from the first chunk.
    pub call_id: Option<&'a str>,
}

impl std::fmt::Debug for ToolContext<'_> {
    /// Hand-written because a sink is a closure: reported as present or absent,
    /// which is the only thing about it worth printing.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ToolContext")
            .field("project_root", &self.project_root)
            .field("store_root", &self.store_root)
            .field("enabled_skills", &self.enabled_skills)
            .field("allow_network", &self.allow_network)
            .field("confine_writes", &self.confine_writes)
            .field("mask_root", &self.mask_root)
            .field("home_readonly", &self.home_readonly)
            .field("scratch_root", &self.scratch_root)
            .field("sandbox", &self.sandbox)
            .field("on_output", &self.on_output.is_some())
            .field("read_roots", &self.read_roots)
            .field("write_roots", &self.write_roots)
            .field("call_id", &self.call_id)
            .finish()
    }
}

/// A tool's live-output channel: called with each chunk as it arrives, in order.
/// Chunks are raw fragments, not lines -- a caller that wants lines buffers them.
pub type OutputSink = std::sync::Arc<dyn Fn(String) + Send + Sync>;

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
            scratch_root: None,
            sandbox: true,
            on_output: None,
            read_roots: &[],
            write_roots: &[],
            call_id: None,
        }
    }

    /// Attach folders the tools may read but never write. Callers pass the
    /// canonical form from [`crate::workspace::validate_read_root`].
    pub fn with_read_roots(mut self, read_roots: &'a [PathBuf]) -> Self {
        self.read_roots = read_roots;
        self
    }

    /// Mark attached folders writable. See [`Self::write_roots`]; callers pass
    /// the same canonical paths they put in `read_roots`.
    pub fn with_write_roots(mut self, write_roots: &'a [PathBuf]) -> Self {
        self.write_roots = write_roots;
        self
    }

    /// Tag streamed output with `call_id`. See [`Self::call_id`].
    pub fn with_call_id(mut self, call_id: &'a str) -> Self {
        self.call_id = Some(call_id);
        self
    }

    /// Stream this call's output to `sink` as it is produced, as well as
    /// returning it. See [`Self::on_output`].
    pub fn with_output_sink(mut self, sink: OutputSink) -> Self {
        self.on_output = Some(sink);
        self
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

    /// Bind `scratch_root` over the sandbox's `/tmp` so scratch files survive
    /// across `bash` calls. See [`Self::scratch_root`].
    /// Ignored when the sandbox is off, so the two builders commute (see
    /// [`Self::with_sandbox`] for why an unconfined run has no scratch).
    pub fn with_scratch_root(mut self, scratch_root: &'a Path) -> Self {
        if self.sandbox {
            self.scratch_root = Some(scratch_root);
        }
        self
    }

    /// Run `bash` under OS confinement (the default). See [`Self::sandbox`].
    ///
    /// Turning it off also drops the scratch: the scratch only makes sense as
    /// the thing bound over the sandbox's `/tmp`. Unconfined, the shell sees the
    /// real `/tmp`, and leaving the scratch set would have the filesystem tools
    /// still rewriting `/tmp/...` into a directory the shell never looks at --
    /// two tools disagreeing about what one path means.
    pub fn with_sandbox(mut self, sandbox: bool) -> Self {
        self.sandbox = sandbox;
        if !sandbox {
            self.scratch_root = None;
        }
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
    // Read: it renders a file that is already reachable and writes nothing back.
    BuiltinTool {
        name: "screenshot",
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
        // 8 coding tools + 6 dedicated skill/memory tools + 2 native web tools.
        assert_eq!(BUILTIN_TOOLS.len(), 16);
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
