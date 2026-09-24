//! The typed request shapes accepted by the JSON-RPC dispatcher. Schemas are
//! derived from the same types that deserialize incoming params.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InitializeParams {
    pub protocol_version: u32,
    pub client_info: ClientInfo,
    #[serde(default)]
    pub capabilities: serde_json::Value,
}

#[derive(Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ClientInfo {
    pub name: String,
    pub version: String,
}

#[derive(Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionStartParams {
    pub cwd: String,
    pub model: Option<String>,
    #[serde(default)]
    pub ephemeral: bool,
}

#[derive(Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionIdParams {
    pub session_id: String,
}

#[derive(Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TurnStartParams {
    pub session_id: String,
    pub input: serde_json::Value,
}

#[derive(Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TurnSteerParams {
    pub session_id: String,
    pub input: String,
}

#[derive(Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PermissionResponseParams {
    pub request_id: String,
    pub decision: String,
}

#[derive(Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RpcEnvelope {
    pub jsonrpc: String,
    pub id: Option<serde_json::Value>,
    pub method: String,
    pub params: Option<serde_json::Value>,
}

#[derive(Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RpcNotification {
    pub jsonrpc: &'static str,
    pub method: String,
    pub params: serde_json::Value,
}

pub fn document() -> serde_json::Value {
    serde_json::json!({
        "protocol_version": crate::core::agent::events::PROTOCOL_VERSION,
        "envelope": schemars::schema_for!(RpcEnvelope),
        "requests": {
            "initialize": schemars::schema_for!(InitializeParams),
            "session/start": schemars::schema_for!(SessionStartParams),
            "session/resume": schemars::schema_for!(SessionIdParams),
            "session/fork": schemars::schema_for!(SessionIdParams),
            "session/archive": schemars::schema_for!(SessionIdParams),
            "turn/start": schemars::schema_for!(TurnStartParams),
            "turn/steer": schemars::schema_for!(TurnSteerParams),
            "turn/interrupt": schemars::schema_for!(SessionIdParams),
            "permission/respond": schemars::schema_for!(PermissionResponseParams)
        },
        "notifications": schemars::schema_for!(RpcNotification),
        "events": schemars::schema_for!(crate::core::agent::events::StreamEvent)
    })
}
