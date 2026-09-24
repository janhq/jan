//! Tools a *host* process registers, and the callback that runs them.
//!
//! A plugin tool ([`tauri_plugin_agent_tools::tools::plugin_tools`]) is a
//! command this process spawns: arguments on stdin, stdout as the result. That
//! covers a tool someone can package as an executable, but not a tool whose
//! implementation lives in the caller -- a robot arm behind a Python host, an
//! editor's own buffer, a device only the host has a handle to. Those cannot be
//! a subprocess of this process, because the state they act on is not here.
//!
//! So a host tool is the inverse arrangement: the host declares the schema up
//! front, and when the model calls it the run emits a
//! [`StreamEvent::ToolRequest`](crate::core::agent::events::StreamEvent::ToolRequest)
//! and *waits* for the host to send a `tool_result` back on stdin. The
//! correlation is the same one-shot registry the permission prompt uses, for
//! the same reason: exactly one answer per request, and a client that goes away
//! must not park a turn forever.
//!
//! What this module does not do is decide policy. A host tool is treated
//! exactly as a plugin or MCP tool is -- prompted rather than auto-allowed, and
//! withheld entirely in read-only Plan mode -- because its capability is just as
//! opaque from here. That default is the shipped answer to "what class does an
//! undeclared tool land in", and a host tool that mutates the physical world is
//! the case it was written for.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::{oneshot, Mutex};

/// Prefix every host tool's advertised name carries, so a host cannot shadow a
/// built-in (`bash`, `read`) or collide with a plugin or MCP tool. Mirrors
/// `plugin_tools::NAME_PREFIX`; the model sees the qualified name and calls it
/// by that.
pub const NAME_PREFIX: &str = "host__";

/// Cap on the advertised `host__<name>` name. Several providers reject a
/// function name past 64 characters, and they reject the *request* rather than
/// just the tool, so one over-long name would break every call in the run.
const MAX_NAME_LEN: usize = 64;

static NEXT_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

/// What a host tool call is answered with. The host sends this back keyed by
/// the request id; `is_error` marks a failure the model should see as one
/// without ending the turn.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct HostToolResult {
    pub content: String,
    pub is_error: bool,
}

/// Why a host tool call produced no answer from the host.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum HostToolError {
    /// The client disconnected, or the run ended, before answering.
    ClientGone,
}

pub(crate) type HostToolOutcome = Result<HostToolResult, HostToolError>;

/// In-flight host tool calls keyed by request id, shared between the loop
/// (which inserts a one-shot sender before awaiting) and the input reader
/// (which removes and resolves it).
pub(crate) type HostToolRegistry = Arc<Mutex<HashMap<String, oneshot::Sender<HostToolOutcome>>>>;

pub(crate) fn new_registry() -> HostToolRegistry {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Reserve a request id and the channel its answer arrives on.
pub(crate) async fn register(registry: &HostToolRegistry) -> (String, oneshot::Receiver<HostToolOutcome>) {
    let id = format!("host-{}", NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed));
    let (sender, receiver) = oneshot::channel();
    registry.lock().await.insert(id.clone(), sender);
    (id, receiver)
}

/// Answer a pending call. Taking the sender is what makes an answer single-use:
/// a second `tool_result` for the same id finds nothing and is reported to the
/// client, rather than silently replacing a result the run already acted on.
pub(crate) async fn respond(
    registry: &HostToolRegistry,
    request_id: &str,
    outcome: HostToolOutcome,
) -> Result<(), String> {
    let sender = registry
        .lock()
        .await
        .remove(request_id)
        .ok_or_else(|| format!("no host tool request '{request_id}' is pending"))?;
    sender
        .send(outcome)
        .map_err(|_| format!("host tool request '{request_id}' is no longer pending"))
}

/// Fail every pending call closed. Called when the client's stdin closes: a
/// host that cannot answer must not leave the turn parked on a reply that can
/// never arrive.
pub(crate) async fn strand_all(registry: &HostToolRegistry) {
    let pending = std::mem::take(&mut *registry.lock().await);
    for (_, sender) in pending {
        let _ = sender.send(Err(HostToolError::ClientGone));
    }
}

/// One tool as the host declares it.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct HostToolDecl {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// JSON Schema for the tool's arguments, passed to the provider verbatim.
    #[serde(default)]
    pub parameters: Option<serde_json::Value>,
}

/// A registered host tool.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct HostTool {
    /// The name the model calls, already prefixed (`host__<name>`).
    pub qualified_name: String,
    /// The name the *host* used. `tool_request` carries this, not the qualified
    /// name: the host asked for `observe` and must be able to dispatch on
    /// `observe` without knowing this layer's prefixing rule.
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

impl HostTool {
    /// The OpenAI tool schema advertised for this tool.
    ///
    /// The host's `parameters` are embedded unchanged. That is deliberate and it
    /// is the whole point of R5 in the contract: a host compares the schema it
    /// gets back against the one it sent, so a normalization pass here -- even a
    /// well-meaning one that fills in a missing `type` -- would make that
    /// comparison fail and silently drop constraints like `minItems` that the
    /// host is relying on for validation.
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

/// Why a declaration was refused. A host tool set is rejected as a whole rather
/// than silently pruned: a host that asked for four tools and got three would
/// discover it at the first call, mid-task, instead of at startup.
#[derive(Clone, Debug, PartialEq)]
pub enum DeclError {
    EmptyName,
    UnsafeName(String),
    NameTooLong(String),
    Reserved(String),
    Duplicate(String),
    NonObjectSchema(String),
}

impl std::fmt::Display for DeclError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DeclError::EmptyName => write!(f, "a host tool has an empty name"),
            DeclError::UnsafeName(n) => write!(
                f,
                "host tool name '{n}' must be ASCII letters, digits, '_' or '-' and cannot contain '__'"
            ),
            DeclError::NameTooLong(n) => write!(
                f,
                "host tool name '{n}' is too long: '{NAME_PREFIX}{n}' exceeds {MAX_NAME_LEN} characters"
            ),
            DeclError::Reserved(n) => {
                write!(f, "host tool name '{n}' is reserved by a built-in tool")
            }
            DeclError::Duplicate(n) => write!(f, "host tool name '{n}' is declared twice"),
            DeclError::NonObjectSchema(n) => write!(
                f,
                "host tool '{n}' parameters must be a JSON Schema object"
            ),
        }
    }
}

/// Every host tool a run may call, keyed by qualified name.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct HostToolSet {
    tools: Vec<HostTool>,
}

impl HostToolSet {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }

    pub fn len(&self) -> usize {
        self.tools.len()
    }

    pub fn all(&self) -> &[HostTool] {
        &self.tools
    }

    pub fn get(&self, qualified_name: &str) -> Option<&HostTool> {
        self.tools
            .iter()
            .find(|t| t.qualified_name == qualified_name)
    }

    /// Whether `name` is a host tool. Cheap enough for the dispatcher's hot
    /// path, and false for every built-in, plugin and MCP name by construction.
    pub fn is_host_tool(&self, name: &str) -> bool {
        name.starts_with(NAME_PREFIX) && self.get(name).is_some()
    }

    pub fn schemas(&self) -> Vec<serde_json::Value> {
        self.tools.iter().map(HostTool::schema).collect()
    }

    /// Validate and register a host's declarations, rejecting the whole set on
    /// the first problem.
    pub fn declare(entries: Vec<HostToolDecl>) -> Result<Self, DeclError> {
        let mut set = Self::new();
        for entry in entries {
            let name = entry.name.trim().to_string();
            if name.is_empty() {
                return Err(DeclError::EmptyName);
            }
            if !is_safe_name(&name) {
                return Err(DeclError::UnsafeName(name));
            }
            let qualified_name = format!("{NAME_PREFIX}{name}");
            if qualified_name.len() > MAX_NAME_LEN {
                return Err(DeclError::NameTooLong(name));
            }
            // A host tool is prefixed, so it cannot collide with a built-in on
            // the wire. The check is on the *bare* name anyway: a host that
            // registers `bash` or `read` has almost certainly misunderstood
            // whose implementation will run, and failing at startup is kinder
            // than letting it call its own sandbox for a whole session.
            if is_reserved(&name) {
                return Err(DeclError::Reserved(name));
            }
            if set.get(&qualified_name).is_some() {
                return Err(DeclError::Duplicate(name));
            }
            let parameters = entry.parameters.unwrap_or_else(empty_schema);
            if !parameters.is_object() {
                return Err(DeclError::NonObjectSchema(name));
            }
            set.tools.push(HostTool {
                qualified_name,
                name,
                description: entry.description.trim().to_string(),
                parameters,
            });
        }
        Ok(set)
    }
}

/// The schema for a tool that declares no parameters.
fn empty_schema() -> serde_json::Value {
    serde_json::json!({ "type": "object", "properties": {} })
}

/// Names a host may not take. Built-ins plus the agent's own session tools:
/// every name this process would otherwise dispatch itself.
fn is_reserved(name: &str) -> bool {
    tauri_plugin_agent_tools::tools::lookup(name).is_some()
        || name == tauri_plugin_agent_tools::tools::monitor::MONITOR_TOOL_NAME
        || matches!(name, "ask" | "todo")
        || crate::core::agent::subagent::is_subagent_tool(name)
}

/// Host tool names are restricted to what every provider accepts in a function
/// name and what cannot be confused with the `__` qualifier separator. A host
/// whose internal name is outside this set maps it on its own side and maps it
/// back on the result, which is what the reference consumer already does.
fn is_safe_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains("__")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn decl(name: &str) -> HostToolDecl {
        HostToolDecl {
            name: name.to_string(),
            description: "does a thing".to_string(),
            parameters: None,
        }
    }

    #[test]
    fn a_declared_tool_is_advertised_under_a_qualified_name() {
        let set = HostToolSet::declare(vec![decl("observe")]).expect("declares");
        assert_eq!(set.len(), 1);
        let tool = &set.all()[0];
        assert_eq!(tool.qualified_name, "host__observe");
        // The host's own name survives alongside it: tool_request carries this.
        assert_eq!(tool.name, "observe");
        assert!(set.is_host_tool("host__observe"));
        // A bare name is not a host tool: the model only ever sees the prefix.
        assert!(!set.is_host_tool("observe"));
    }

    #[test]
    fn the_host_schema_is_advertised_byte_for_byte() {
        // R5: the host compares what it gets back to what it sent. Constraints
        // a normalizer would strip or add are exactly what this pins.
        let parameters = json!({
            "type": "object",
            "properties": {
                "joints": {
                    "type": "array",
                    "items": { "type": "number" },
                    "minItems": 6,
                    "maxItems": 6
                },
                "when": { "type": "string", "format": "date-time" }
            },
            "required": ["joints"],
            "additionalProperties": false
        });
        let set = HostToolSet::declare(vec![HostToolDecl {
            name: "move_arm".to_string(),
            description: "move".to_string(),
            parameters: Some(parameters.clone()),
        }])
        .expect("declares");
        assert_eq!(set.all()[0].schema()["function"]["parameters"], parameters);
    }

    #[test]
    fn a_tool_with_no_parameters_gets_an_empty_object_schema() {
        let set = HostToolSet::declare(vec![decl("observe")]).expect("declares");
        assert_eq!(
            set.all()[0].parameters,
            json!({ "type": "object", "properties": {} })
        );
    }

    #[test]
    fn a_duplicate_name_is_rejected_not_replaced() {
        // R3: rejected, never silently resolved. A host that declared two tools
        // and got one would find out at the first call.
        let err = HostToolSet::declare(vec![decl("observe"), decl("observe")])
            .expect_err("duplicate refused");
        assert_eq!(err, DeclError::Duplicate("observe".to_string()));
    }

    #[test]
    fn reserved_names_are_refused() {
        for name in [
            "bash",
            "read",
            "edit",
            "monitor",
            "ask",
            "todo",
            "dispatch_subagent",
        ] {
            let err = HostToolSet::declare(vec![decl(name)]);
            assert_eq!(
                err,
                Err(DeclError::Reserved(name.to_string())),
                "'{name}' must be reserved"
            );
        }
    }

    #[test]
    fn an_unsafe_name_is_refused() {
        for name in ["yam.move_ee_ik", "has space", "unicode\u{00e9}", "a__b"] {
            assert_eq!(
                HostToolSet::declare(vec![decl(name)]),
                Err(DeclError::UnsafeName(name.to_string())),
                "'{name}' must be refused"
            );
        }
    }

    #[test]
    fn an_empty_name_is_refused() {
        assert_eq!(
            HostToolSet::declare(vec![decl("   ")]),
            Err(DeclError::EmptyName)
        );
    }

    #[test]
    fn an_over_long_name_is_refused() {
        let long = "t".repeat(MAX_NAME_LEN);
        assert_eq!(
            HostToolSet::declare(vec![decl(&long)]),
            Err(DeclError::NameTooLong(long))
        );
    }

    #[test]
    fn a_non_object_schema_is_refused() {
        let err = HostToolSet::declare(vec![HostToolDecl {
            name: "observe".to_string(),
            description: String::new(),
            parameters: Some(json!("string")),
        }]);
        assert_eq!(err, Err(DeclError::NonObjectSchema("observe".to_string())));
    }

    #[tokio::test]
    async fn an_answer_is_single_use() {
        let registry = new_registry();
        let (id, receiver) = register(&registry).await;
        let result = HostToolResult {
            content: "ok".to_string(),
            is_error: false,
        };
        respond(&registry, &id, Ok(result.clone()))
            .await
            .expect("first answer lands");
        assert_eq!(receiver.await.expect("delivered"), Ok(result));
        // A second answer for the same id has nothing to resolve and is
        // reported, rather than overwriting a result the run already used.
        assert!(respond(&registry, &id, Ok(HostToolResult {
            content: "again".to_string(),
            is_error: false,
        }))
        .await
        .is_err());
    }

    #[tokio::test]
    async fn a_disconnecting_client_strands_pending_calls_closed() {
        let registry = new_registry();
        let (_id, receiver) = register(&registry).await;
        strand_all(&registry).await;
        assert_eq!(
            receiver.await.expect("delivered"),
            Err(HostToolError::ClientGone)
        );
    }
}
