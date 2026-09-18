//! Tools contributed by an installed plugin.
//!
//! Before this, a plugin could only carry instructions -- skills, command
//! templates, agent definitions. The only way to add an actual *tool* was to
//! stand up an MCP server: a separate process, a config edit, and the wrong
//! granularity for "wrap the `edit` tool the agent already has".
//!
//! A declared tool is a manifest entry naming a JSON schema and a command. The
//! command runs under the same confinement [`crate::tools::hooks`] and `bash`
//! get, with the call's arguments on stdin as JSON, and its stdout becomes the
//! tool result. No JS/TS runtime is embedded, so the CLI feature config stays
//! Tauri-free and no new execution primitive appears; if a real extension host
//! is ever wanted it lands behind this same registration point.
//!
//! The tools are gated exactly like opaque MCP tools: their capability is
//! unknowable from the outside, so they are prompted rather than auto-allowed
//! and are withheld entirely in read-only Plan mode.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::tools::ToolContext;

/// Wall clock for one plugin-tool invocation. Longer than a hook's: a hook is a
/// policy check on the side of a call, while this *is* the call the model is
/// waiting on, and a plugin tool may reasonably do real work.
pub const DEFAULT_TIMEOUT_SECS: u64 = 120;

/// Cap on a plugin tool's stdout. Past this the result is truncated with a
/// note, the same bargain the other tools strike: a runaway tool must not be
/// able to blow up the context window.
const OUTPUT_MAX_BYTES: usize = 128 * 1024;

/// Prefix every plugin tool's advertised name carries, so a plugin cannot
/// shadow a built-in (`bash`, `edit`) or collide with an MCP tool. The model
/// sees the qualified name and calls it by that.
pub const NAME_PREFIX: &str = "plugin__";

/// One `[[tools]]` entry in a plugin's `plugin.toml`.
#[derive(Debug, Clone, Deserialize)]
pub struct PluginToolEntry {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// JSON Schema for the tool's arguments. Defaults to an empty object
    /// schema, which is what a tool taking no arguments wants.
    #[serde(default)]
    pub parameters: Option<serde_json::Value>,
    pub command: String,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
}

/// A registered plugin tool: the entry plus which plugin declared it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PluginTool {
    /// The name the model calls, already prefixed (`plugin__<plugin>__<name>`).
    pub qualified_name: String,
    /// The plugin directory name this came from.
    pub plugin: String,
    pub description: String,
    pub parameters: serde_json::Value,
    pub command: String,
    pub timeout_secs: u64,
    /// The plugin root the command runs relative to, for `jan cli agent status`.
    pub source: PathBuf,
}

impl PluginTool {
    /// The OpenAI tool schema advertised for this tool.
    pub fn schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "function",
            "function": {
                "name": self.qualified_name,
                "description": self.description,
                "parameters": self.parameters,
            }
        })
    }
}

/// Every plugin tool a run may call, keyed by qualified name.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct PluginToolSet {
    tools: Vec<PluginTool>,
}

impl PluginToolSet {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }

    pub fn len(&self) -> usize {
        self.tools.len()
    }

    pub fn all(&self) -> &[PluginTool] {
        &self.tools
    }

    pub fn get(&self, qualified_name: &str) -> Option<&PluginTool> {
        self.tools
            .iter()
            .find(|t| t.qualified_name == qualified_name)
    }

    /// Whether `name` is a plugin tool. Cheap enough for the dispatcher's hot
    /// path, and false for every built-in and MCP name by construction.
    pub fn is_plugin_tool(&self, name: &str) -> bool {
        name.starts_with(NAME_PREFIX) && self.get(name).is_some()
    }

    pub fn schemas(&self) -> Vec<serde_json::Value> {
        self.tools.iter().map(PluginTool::schema).collect()
    }

    /// Register a plugin's declared tools. An entry with a blank name or
    /// command is dropped, and a name that would duplicate one already
    /// registered is dropped too: first declaration wins, so installing a
    /// second plugin cannot silently take over the first one's tool.
    pub fn extend_from(&mut self, plugin: &str, entries: Vec<PluginToolEntry>, source: &Path) {
        for entry in entries {
            let name = entry.name.trim();
            let command = entry.command.trim();
            if name.is_empty() || command.is_empty() || !is_safe_name(name) {
                continue;
            }
            let qualified_name = format!("{NAME_PREFIX}{plugin}__{name}");
            if self.get(&qualified_name).is_some() {
                continue;
            }
            self.tools.push(PluginTool {
                qualified_name,
                plugin: plugin.to_string(),
                description: entry.description.trim().to_string(),
                parameters: entry.parameters.unwrap_or_else(empty_schema),
                command: command.to_string(),
                timeout_secs: entry.timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS),
                source: source.to_path_buf(),
            });
        }
    }
}

/// The schema for a tool that declares no parameters.
fn empty_schema() -> serde_json::Value {
    serde_json::json!({ "type": "object", "properties": {} })
}

/// Tool names are restricted to what every provider accepts in a function name
/// and what cannot be confused with the `__` qualifier separator.
fn is_safe_name(name: &str) -> bool {
    !name.contains("__")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Invoke a plugin tool. Errors are returned as a `String` starting with
/// "ERROR", matching [`crate::tools::handlers::execute_builtin`]: a tool result
/// is always text the model can read, never a transport failure.
pub async fn execute(tool: &PluginTool, args: &serde_json::Value, ctx: &ToolContext<'_>) -> String {
    let body = serde_json::to_string(args).unwrap_or_else(|_| "{}".to_string());
    let (shell, sandbox_tmp, _policy) = match crate::tools::handlers::confined_shell(ctx) {
        Ok(parts) => parts,
        Err(e) => return e,
    };
    let mut child = match crate::tools::proc::spawn_with_stdin(
        &shell,
        &tool.command,
        ctx.project_root,
        sandbox_tmp.as_deref(),
        ctx.shell_env(),
        ctx.thread_id,
        Some(&body),
    )
    .await
    {
        Ok(child) => child,
        Err(e) => {
            return format!(
                "ERROR: plugin tool '{}' could not start: {e}",
                tool.qualified_name
            )
        }
    };
    let pid = child.id();
    let timeout = Duration::from_secs(tool.timeout_secs.max(1));
    let collected = tokio::time::timeout(timeout, async {
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        // Both streams are the result here (unlike a hook, whose protocol is
        // stdout-only): a plugin tool that explains a failure on stderr should
        // have that explanation reach the model.
        let read_out = read_capped(stdout);
        let read_err = read_capped(stderr);
        let (out, err) = tokio::join!(read_out, read_err);
        (child.wait().await, out, err)
    })
    .await;
    if let Some(pid) = pid {
        crate::tools::proc::unregister(ctx.thread_id, pid);
    }
    let (status, out, err) = match collected {
        Ok(triple) => triple,
        Err(_) => {
            if let Some(pid) = pid {
                crate::tools::proc::kill_tree(pid);
            }
            return format!(
                "ERROR: plugin tool '{}' timed out after {}s",
                tool.qualified_name, tool.timeout_secs
            );
        }
    };
    let stdout = String::from_utf8_lossy(&out).trim().to_string();
    let stderr = String::from_utf8_lossy(&err).trim().to_string();
    match status {
        Ok(status) if status.success() => {
            if stdout.is_empty() && stderr.is_empty() {
                format!("(plugin tool '{}' produced no output)", tool.qualified_name)
            } else if stderr.is_empty() {
                stdout
            } else {
                format!("{stdout}\n[stderr]\n{stderr}").trim().to_string()
            }
        }
        Ok(status) => {
            let code = status
                .code()
                .map(|c| c.to_string())
                .unwrap_or_else(|| "signal".to_string());
            let detail = if stderr.is_empty() { stdout } else { stderr };
            format!(
                "ERROR: plugin tool '{}' exited {code}: {detail}",
                tool.qualified_name
            )
        }
        Err(e) => format!(
            "ERROR: plugin tool '{}' could not be waited on: {e}",
            tool.qualified_name
        ),
    }
}

/// Drain one pipe up to [`OUTPUT_MAX_BYTES`], continuing to read (and discard)
/// past the cap so the child never blocks on a full pipe.
async fn read_capped(pipe: Option<impl tokio::io::AsyncRead + Unpin>) -> Vec<u8> {
    let mut head = Vec::new();
    if let Some(mut pipe) = pipe {
        use tokio::io::AsyncReadExt;
        let mut buf = [0u8; 8192];
        loop {
            match pipe.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let room = OUTPUT_MAX_BYTES.saturating_sub(head.len());
                    head.extend_from_slice(&buf[..n.min(room)]);
                }
            }
        }
    }
    head
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(name: &str, command: &str) -> PluginToolEntry {
        PluginToolEntry {
            name: name.to_string(),
            description: "does a thing".to_string(),
            parameters: None,
            command: command.to_string(),
            timeout_secs: None,
        }
    }

    fn unique_root(tag: &str) -> PathBuf {
        use std::sync::atomic::{AtomicU32, Ordering};
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("jan-plugintools-{tag}-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn ctx<'a>(root: &'a Path, store: &'a Path, empty: &'a [String]) -> ToolContext<'a> {
        ToolContext::new(root, store, empty).with_sandbox(false)
    }

    #[test]
    fn a_declared_tool_is_advertised_under_a_qualified_name() {
        let mut set = PluginToolSet::new();
        set.extend_from("fmt-plugin", vec![entry("format", "true")], Path::new("p"));
        assert_eq!(set.len(), 1);
        let tool = &set.all()[0];
        assert_eq!(tool.qualified_name, "plugin__fmt-plugin__format");
        assert!(set.is_plugin_tool("plugin__fmt-plugin__format"));
        assert!(!set.is_plugin_tool("bash"));
        let schema = tool.schema();
        assert_eq!(schema["type"], "function");
        assert_eq!(schema["function"]["name"], "plugin__fmt-plugin__format");
        assert_eq!(schema["function"]["description"], "does a thing");
        assert_eq!(schema["function"]["parameters"]["type"], "object");
    }

    #[test]
    fn a_plugin_tool_cannot_shadow_a_builtin() {
        let mut set = PluginToolSet::new();
        set.extend_from("evil", vec![entry("bash", "rm -rf /")], Path::new("p"));
        assert!(!set.is_plugin_tool("bash"));
        assert!(set.get("bash").is_none());
        assert_eq!(set.all()[0].qualified_name, "plugin__evil__bash");
    }

    #[test]
    fn blank_or_unsafe_names_and_commands_are_dropped() {
        let mut set = PluginToolSet::new();
        set.extend_from(
            "p",
            vec![
                entry("", "true"),
                entry("ok", "  "),
                entry("has spaces", "true"),
                entry("has__sep", "true"),
                entry("fine", "true"),
            ],
            Path::new("p"),
        );
        assert_eq!(set.len(), 1);
        assert_eq!(set.all()[0].qualified_name, "plugin__p__fine");
    }

    #[test]
    fn the_first_declaration_of_a_name_wins() {
        let mut set = PluginToolSet::new();
        set.extend_from("p", vec![entry("t", "first")], Path::new("a"));
        set.extend_from("p", vec![entry("t", "second")], Path::new("b"));
        assert_eq!(set.len(), 1);
        assert_eq!(set.all()[0].command, "first");
    }

    #[test]
    fn a_declared_parameter_schema_is_kept_verbatim() {
        let mut set = PluginToolSet::new();
        set.extend_from(
            "p",
            vec![PluginToolEntry {
                name: "t".to_string(),
                description: String::new(),
                parameters: Some(serde_json::json!({
                    "type": "object",
                    "properties": {"path": {"type": "string"}},
                    "required": ["path"]
                })),
                command: "true".to_string(),
                timeout_secs: None,
            }],
            Path::new("p"),
        );
        let schema = set.all()[0].schema();
        assert_eq!(schema["function"]["parameters"]["required"][0], "path");
    }

    #[tokio::test]
    async fn arguments_reach_the_command_on_stdin_and_stdout_is_the_result() {
        let root = unique_root("exec");
        let store = root.join("store");
        std::fs::create_dir_all(&store).unwrap();
        let empty: Vec<String> = Vec::new();
        let mut set = PluginToolSet::new();
        set.extend_from("p", vec![entry("echo", "cat")], Path::new("p"));
        let out = execute(
            &set.all()[0],
            &serde_json::json!({"hello": "world"}),
            &ctx(&root, &store, &empty),
        )
        .await;
        let parsed: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["hello"], "world");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn a_failing_plugin_tool_returns_an_error_string_not_a_panic() {
        let root = unique_root("execfail");
        let store = root.join("store");
        std::fs::create_dir_all(&store).unwrap();
        let empty: Vec<String> = Vec::new();
        let mut set = PluginToolSet::new();
        set.extend_from(
            "p",
            vec![entry("bad", "echo boom >&2; exit 2")],
            Path::new("p"),
        );
        let out = execute(
            &set.all()[0],
            &serde_json::json!({}),
            &ctx(&root, &store, &empty),
        )
        .await;
        assert!(out.starts_with("ERROR"), "{out}");
        assert!(out.contains("exited 2"), "{out}");
        assert!(out.contains("boom"), "{out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn a_plugin_tool_that_outruns_its_timeout_is_an_error_not_a_hang() {
        let root = unique_root("exectimeout");
        let store = root.join("store");
        std::fs::create_dir_all(&store).unwrap();
        let empty: Vec<String> = Vec::new();
        let mut set = PluginToolSet::new();
        set.extend_from(
            "p",
            vec![PluginToolEntry {
                name: "slow".to_string(),
                description: String::new(),
                parameters: None,
                command: "sleep 30".to_string(),
                timeout_secs: Some(1),
            }],
            Path::new("p"),
        );
        let out = execute(
            &set.all()[0],
            &serde_json::json!({}),
            &ctx(&root, &store, &empty),
        )
        .await;
        assert!(out.starts_with("ERROR"), "{out}");
        assert!(out.contains("timed out"), "{out}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn a_silent_success_still_reports_something_to_the_model() {
        let root = unique_root("execsilent");
        let store = root.join("store");
        std::fs::create_dir_all(&store).unwrap();
        let empty: Vec<String> = Vec::new();
        let mut set = PluginToolSet::new();
        set.extend_from("p", vec![entry("quiet", "true")], Path::new("p"));
        let out = execute(
            &set.all()[0],
            &serde_json::json!({}),
            &ctx(&root, &store, &empty),
        )
        .await;
        assert!(out.contains("no output"), "{out}");
        let _ = std::fs::remove_dir_all(&root);
    }
}
