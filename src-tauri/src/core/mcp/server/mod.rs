//! Jan as an MCP *server*: the built-in agent toolset offered to any other
//! agent that speaks MCP (Claude Code, Codex CLI, a custom orchestrator).
//!
//! This is the mirror of `core::mcp::helpers`, which consumes other people's
//! servers. Nothing here duplicates the tool layer: the advertised schemas come
//! from `tools::schema::builtin_tool_schemas()`, dispatch goes through
//! `tools::handlers::execute_builtin`, and the decision to run a call is made by
//! `tools::gate::resolve_decision` -- the same three functions the agent loop
//! uses. `tools::lookup()` stays the authority on capability and `path_args`.
//!
//! Tauri-free on purpose, so it compiles in the `cli` feature config and the
//! desktop one alike.
//!
//! An external caller is not a user standing at a permission prompt, so the two
//! answers the agent loop gets from a human are decided statically here:
//! anything the gate would prompt about is either pre-approved by an explicit
//! opt-in ([`ServedTools`]) or refused outright. Nothing ever blocks waiting for
//! an approval that cannot arrive.

use std::path::PathBuf;
use std::sync::Arc;

use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, Implementation,
    ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerInfo, Tool,
};
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{ErrorData as McpError, ServerHandler};
use tauri_plugin_agent_tools::tools::gate::{
    resolve_decision, Decision, DenyReason, GateContext, PromptKind, SessionGrants,
};
use tauri_plugin_agent_tools::tools::handlers::execute_builtin;
use tauri_plugin_agent_tools::tools::schema::{builtin_tool_schemas, search_tool_schemas};
use tauri_plugin_agent_tools::tools::{lookup, Capability, ToolContext};

pub mod http;
pub mod stdio;

#[cfg(test)]
mod tests;

/// Which built-in tools this server offers.
///
/// The default is the read/search/memory/skill/web set. The two classes that can
/// change the machine -- `bash` and the mutating filesystem tools (`write`,
/// `edit`) -- are opt-in, because the caller is another program rather than a
/// user who can be asked. Opting one in *is* the approval: the gate's prompt for
/// it is then treated as granted, but only for a target inside the served root
/// (an escaping path still prompts, and a prompt is always a refusal here).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ServedTools {
    /// Offer `write` and `edit`, confined to the served project root.
    pub allow_write: bool,
    /// Offer `bash`. Runs under the same OS confinement the agent's shell does.
    pub allow_exec: bool,
    /// Restrict the offering further to these names. Empty means "everything the
    /// two flags above permit"; a name the flags exclude is not re-admitted by
    /// listing it here.
    pub only: Vec<String>,
}

impl ServedTools {
    /// Whether `name` is offered. Unknown names are not served: `lookup()`
    /// decides what a built-in is, and `path_args`/`capability` come from there.
    pub fn is_served(&self, name: &str) -> bool {
        let Some(tool) = lookup(name) else {
            return false;
        };
        if !self.only.is_empty() && !self.only.iter().any(|n| n == name) {
            return false;
        }
        match tool.capability {
            Capability::Exec => self.allow_exec,
            // A `Write` tool with no path argument is a workspace tool
            // (`memory_write`, `skill_write`): it writes into the agent's own
            // store by sanitized name and can never reach a project file, so it
            // belongs to the memory/skill set rather than the mutating one.
            Capability::Write => self.allow_write || tool.path_args.is_empty(),
            Capability::Read | Capability::Net => true,
        }
    }
}

/// Everything the served tools run against. One project root per server, fixed
/// at start: the containment an external caller gets is the containment the
/// agent gets, and it cannot be renegotiated mid-session.
#[derive(Debug, Clone)]
pub struct ServeOptions {
    /// The one project root the served tools are confined to.
    pub project_root: PathBuf,
    /// Where `memory/` and `skills/` live; normally
    /// `workspace::project_store(project_root)`.
    pub store_root: PathBuf,
    /// The `[skills].enabled` whitelist; empty means every skill.
    pub enabled_skills: Vec<String>,
    /// Let the sandboxed shell reach the network.
    pub allow_network: bool,
    /// Run `bash` under OS confinement. Left on unless the operator turns it off.
    pub sandbox: bool,
    /// Session scratch shared by the shell and the filesystem tools.
    pub scratch_root: Option<PathBuf>,
    /// Which tools are offered. See [`ServedTools`].
    pub served: ServedTools,
}

impl ServeOptions {
    /// Defaults for a project root: its co-located store, the read-only served
    /// set, sandbox on.
    pub fn new(project_root: PathBuf) -> Self {
        let store_root = tauri_plugin_agent_tools::workspace::project_store(&project_root);
        Self {
            project_root,
            store_root,
            enabled_skills: Vec::new(),
            allow_network: false,
            sandbox: true,
            scratch_root: None,
            served: ServedTools::default(),
        }
    }
}

/// The MCP server: Jan's built-in toolset behind a `ServerHandler`.
///
/// Cheap to clone (one `Arc`), which is what the Streamable HTTP transport needs
/// -- it builds a fresh handler per session from a factory.
#[derive(Debug, Clone)]
pub struct JanToolServer {
    opts: Arc<ServeOptions>,
}

impl JanToolServer {
    pub fn new(opts: ServeOptions) -> Self {
        Self {
            opts: Arc::new(opts),
        }
    }

    pub fn options(&self) -> &ServeOptions {
        &self.opts
    }

    /// The tools this server advertises, derived from the toolset's own schemas
    /// and filtered by [`ServedTools`]. There is no second copy of any schema:
    /// the OpenAI function entry's `parameters` object *is* the MCP
    /// `inputSchema`.
    ///
    /// `ls`/`find`/`grep` come from [`search_tool_schemas`] and are served even
    /// though a model is not offered them. The reason they are withheld from a
    /// model is that `bash` covers listing and searching, and `bash` is opt-in
    /// here -- so on the default read-only set, withholding them too would leave
    /// a peer able to read a file only if it already knew its name.
    pub fn tools(&self) -> Vec<Tool> {
        builtin_tool_schemas()
            .into_iter()
            .chain(search_tool_schemas())
            .filter_map(|schema| {
                let function = schema.get("function")?;
                let name = function.get("name")?.as_str()?.to_string();
                if !self.opts.served.is_served(&name) {
                    return None;
                }
                let description = function
                    .get("description")
                    .and_then(|d| d.as_str())
                    .map(|d| d.to_string());
                let input_schema = function
                    .get("parameters")
                    .and_then(|p| p.as_object())
                    .cloned()
                    .unwrap_or_default();
                Some(Tool::new_with_raw(
                    name,
                    description.map(Into::into),
                    input_schema,
                ))
            })
            .collect()
    }

    /// The tool context a served call runs against.
    ///
    /// `confine_writes` is on and no read/write root is attached: unlike the CLI,
    /// which works *in* a project the user is sitting in, this caller only ever
    /// gets the one root it was started with.
    fn tool_context(&self) -> ToolContext<'_> {
        let mut ctx = ToolContext::new(
            &self.opts.project_root,
            &self.opts.store_root,
            &self.opts.enabled_skills,
        )
        .with_network(self.opts.allow_network)
        .with_sandbox(self.opts.sandbox)
        .with_confined_writes(true);
        if let Some(scratch) = self.opts.scratch_root.as_deref() {
            ctx = ctx.with_scratch_root(scratch);
        }
        ctx
    }

    /// Run one tool call, or explain why it was refused. The returned string is
    /// the tool result in the toolset's own convention: a failure starts with
    /// `ERROR`.
    ///
    /// Split out from [`ServerHandler::call_tool`] so the decision table is
    /// testable without a transport.
    pub async fn dispatch(
        &self,
        name: &str,
        args: &serde_json::Value,
    ) -> (String, Vec<ContentBlock>) {
        let Some(tool) = lookup(name) else {
            return (format!("ERROR: unknown tool '{name}'"), Vec::new());
        };
        if !self.opts.served.is_served(name) {
            return (
                format!(
                    "ERROR: tool '{name}' is not served by this Jan MCP server. \
                     Mutating filesystem tools and bash are opt-in."
                ),
                Vec::new(),
            );
        }
        let decision = resolve_decision(
            tool,
            args,
            &GateContext {
                project_root: &self.opts.project_root,
                scratch: self.opts.scratch_root.as_deref(),
                read_roots: &[],
                write_roots: &[],
                // The agent's own `.jan` state is never reachable as a path;
                // memory and skills are served through their own tools.
                hide_jan: true,
            },
            &Default::default(),
            &SessionGrants::default(),
        );
        match decision {
            Decision::Allow => {}
            Decision::HardDeny(DenyReason::Policy) => {
                return (format!("ERROR: tool '{name}' is denied by policy"), Vec::new())
            }
            Decision::HardDeny(DenyReason::Hidden) => {
                return (
                    format!(
                        "ERROR: tool '{name}' was refused: the path is inside the agent's \
                         hidden .jan state. Use the memory_* and skill_* tools instead."
                    ),
                    Vec::new(),
                )
            }
            // An in-project write or a shell command: the opt-in that made the
            // tool servable is the approval, so run it. `is_served` already
            // refused the tool when the opt-in was absent.
            Decision::Prompt(PromptKind::Write) | Decision::Prompt(PromptKind::Exec) => {}
            // Escapes the served root. There is no one to ask, and the whole
            // point of a served root is that it holds, so refuse.
            Decision::Prompt(kind @ (PromptKind::ReadEscape | PromptKind::WriteEscape)) => {
                let what = match kind {
                    PromptKind::ReadEscape => "read",
                    _ => "write",
                };
                return (
                    format!(
                        "ERROR: tool '{name}' was refused: the path escapes the served project \
                         root, and an external caller cannot be asked to approve a {what} \
                         outside it."
                    ),
                    Vec::new(),
                );
            }
        }
        let ctx = self.tool_context();
        let (content, images) = execute_builtin(tool, args, &ctx).await;
        let blocks = images
            .unwrap_or_default()
            .iter()
            .filter_map(|part| image_block(&part.data_url))
            .collect();
        (content, blocks)
    }
}

/// Split a `data:<mime>;base64,<payload>` URL into an MCP image block. Returns
/// `None` for anything that is not one, so a malformed part is dropped rather
/// than sent as a broken block.
fn image_block(data_url: &str) -> Option<ContentBlock> {
    let rest = data_url.strip_prefix("data:")?;
    let (mime, payload) = rest.split_once(";base64,")?;
    Some(ContentBlock::image(payload.to_string(), mime.to_string()))
}

impl ServerHandler for JanToolServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("jan", env!("CARGO_PKG_VERSION")))
            .with_instructions(
                "Jan's built-in agent tools, confined to one project root. Filesystem paths \
                 are resolved against that root and a path escaping it is refused. Tools that \
                 would need an interactive approval return an error instead of blocking.",
            )
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        Ok(ListToolsResult::with_all_items(self.tools()))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, McpError> {
        let args = serde_json::Value::Object(request.arguments.unwrap_or_default());
        let (content, mut blocks) = self.dispatch(&request.name, &args).await;
        let is_error = content.starts_with("ERROR");
        blocks.insert(0, ContentBlock::text(content));
        let result = if is_error {
            CallToolResult::error(blocks)
        } else {
            CallToolResult::success(blocks)
        };
        Ok(result.into())
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.tools().into_iter().find(|t| t.name == name)
    }
}
