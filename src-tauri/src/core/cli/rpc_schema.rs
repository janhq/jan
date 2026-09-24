//! The typed request shapes accepted by the JSON-RPC dispatcher. Schemas are
//! derived from the same types that deserialize incoming params.
//!
//! `jan cli agent rpc-schema` prints the document, and `--out` writes the copy
//! committed at `protocol/rpc-schema.json`, which CI regenerates and diffs: an
//! envelope change cannot land without the artifact moving with it. It is the
//! RPC counterpart of `protocol/schema.json`, and covers this surface only -
//! the stream-json records are in that file, and ACP has no document yet.
//!
//! Like that one, the document has to regenerate byte-identically: keys are
//! sorted by `serde_json`, nothing iterates a hash map on the way out, and the
//! order of the `requests` entries is the order written here.
use std::path::Path;

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
            // No params, and the dispatcher reads none: an empty object rather
            // than an omission, so the artifact names every callable method.
            "session/list": serde_json::json!({"type": "object", "properties": {}}),
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

/// The artifact as text: pretty-printed with a trailing newline, the way
/// `protocol/schema.json` is written, so both files diff the same way.
pub(crate) fn artifact() -> String {
    let mut text = serde_json::to_string_pretty(&document()).expect("a schema prints as JSON");
    text.push('\n');
    text
}

/// Write the artifact to `out`, or print the document when there is no file to
/// write. CI and `make protocol-rpc-schema` pass a path, which also keeps
/// cargo's own build noise off stdout.
pub fn run(out: Option<&Path>) -> Result<(), String> {
    let artifact = artifact();
    match out {
        Some(path) => std::fs::write(path, artifact)
            .map_err(|e| format!("could not write {}: {e}", path.display())),
        None => {
            print!("{artifact}");
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The committed file, which CI diffs against a fresh generation.
    const COMMITTED: &str = include_str!("../../../../protocol/rpc-schema.json");

    /// The file is committed, so regenerating an unchanged envelope must not
    /// produce a diff: two runs in one process have to agree, which is also what
    /// rules out iteration over a hash map reaching the output.
    #[test]
    fn regenerating_the_schema_is_byte_identical() {
        assert_eq!(artifact(), artifact());
    }

    /// Without this the file is a snapshot that is right on the day it lands.
    #[test]
    fn the_committed_schema_matches_the_types() {
        let generated = artifact();
        if generated == COMMITTED {
            return;
        }
        let first = generated
            .lines()
            .zip(COMMITTED.lines())
            .position(|(a, b)| a != b)
            .unwrap_or(0);
        panic!(
            "protocol/rpc-schema.json no longer matches the RPC types; run \
             `make protocol-rpc-schema` and commit the result.\n\
             first difference at line {}:\n  committed: {}\n  generated: {}",
            first + 1,
            COMMITTED.lines().nth(first).unwrap_or("<end of file>"),
            generated.lines().nth(first).unwrap_or("<end of file>"),
        );
    }

    /// The verbs in the document are the surface a client may call, one entry
    /// each: a verb the dispatcher answers but the document omits is a client
    /// that cannot generate its call, and a verb the document invents is a
    /// promise nothing keeps. `initialized` is absent because it is a
    /// notification, not a request.
    ///
    /// The list is pinned by hand because the dispatcher is a `match` over
    /// literals rather than a table: a new verb has to change this test too,
    /// which is the point - the surface is a decision, not an accident of the
    /// match arms.
    #[test]
    fn the_document_names_the_request_surface() {
        let document = document();
        let mut documented: Vec<&str> = document["requests"]
            .as_object()
            .expect("the document lists its requests")
            .keys()
            .map(String::as_str)
            .collect();
        documented.sort_unstable();
        assert_eq!(
            documented,
            [
                "initialize",
                "permission/respond",
                "session/archive",
                "session/fork",
                "session/list",
                "session/resume",
                "session/start",
                "turn/interrupt",
                "turn/start",
                "turn/steer",
            ]
        );
    }
}
