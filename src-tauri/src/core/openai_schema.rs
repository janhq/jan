//! OpenAI wire-format helpers shared by the proxy server and the agent's
//! upstream layer: tool-schema normalization and key-rotation status checks.
//! Tauri-free so the headless CLI build can use it without the proxy.

use reqwest::StatusCode;

const SCHEMA_PRIMITIVE_TYPES: &[&str] = &[
    "string", "number", "integer", "boolean", "null", "array", "object",
];

// llama.cpp's json-schema-to-grammar emits PCRE `\d` for these formats,
// which GBNF rejects; the failed grammar silently disables tool-call JSON.
const LLAMACPP_BROKEN_STRING_FORMATS: &[&str] = &["date", "time", "date-time"];

fn pattern_has_pcre_shorthand(pattern: &str) -> bool {
    let bytes = pattern.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'\\' && matches!(bytes[i + 1], b'd' | b'D' | b'w' | b'W' | b's' | b'S') {
            return true;
        }
        i += 1;
    }
    false
}

/// If `value` is a bare string naming a JSON-schema primitive type (e.g.
/// `"string"`), expand it to `{ "type": <that> }`. Some tool generators emit
/// shorthand like `{ "properties": { "foo": "string" } }`; llama.cpp's
/// json-schema-to-grammar rejects that with `Unrecognized schema: "string"`.
fn coerce_schema_node(value: &mut serde_json::Value) {
    if let serde_json::Value::String(s) = value {
        if SCHEMA_PRIMITIVE_TYPES.contains(&s.as_str()) {
            let mut obj = serde_json::Map::new();
            obj.insert(
                "type".to_string(),
                serde_json::Value::String(std::mem::take(s)),
            );
            *value = serde_json::Value::Object(obj);
        }
    }
    normalize_openai_tool_parameters_schema(value);
}

/// Some OpenAI tool schema generators (and some MCP servers) may emit schemas where
/// a property schema only contains `description` but omits `type`, or where a
/// schema-node slot holds a bare type-name string instead of a sub-schema object.
///
/// A strict JSON schema converter inside the upstream server rejects those schemas.
/// To be robust, we default `type` to `"string"` for description-only leaf schemas
/// and expand bare-string sub-schemas to `{ "type": <name> }`.
/// Keep this behavior aligned with `normalizeToolInputSchema` in the frontend.
pub(crate) fn normalize_openai_tool_parameters_schema(schema: &mut serde_json::Value) {
    match schema {
        serde_json::Value::Object(map) => {
            let has_description = map.contains_key("description");
            let has_type = map.contains_key("type");
            let is_object_type = map.get("type").and_then(|v| v.as_str()) == Some("object");
            let has_nested_schema_keywords = map.contains_key("properties")
                || map.contains_key("items")
                || map.contains_key("anyOf")
                || map.contains_key("oneOf")
                || map.contains_key("allOf")
                || map.contains_key("$ref");

            if is_object_type && !map.contains_key("properties") {
                map.insert(
                    "properties".to_string(),
                    serde_json::Value::Object(serde_json::Map::new()),
                );
            }

            // Only patch leaf nodes (description without `type` AND without nested schema keywords).
            if has_description && !has_type && !has_nested_schema_keywords {
                map.insert(
                    "type".to_string(),
                    serde_json::Value::String("string".to_string()),
                );
            }

            let drop_format = map
                .get("format")
                .and_then(|v| v.as_str())
                .map(|f| LLAMACPP_BROKEN_STRING_FORMATS.contains(&f))
                .unwrap_or(false);
            if drop_format {
                map.remove("format");
            }

            let drop_pattern = map
                .get("pattern")
                .and_then(|v| v.as_str())
                .map(pattern_has_pcre_shorthand)
                .unwrap_or(false);
            if drop_pattern {
                map.remove("pattern");
            }

            // Recurse, with shorthand expansion for keys whose direct children
            // are schema nodes.
            for (key, v) in map.iter_mut() {
                match key.as_str() {
                    "properties" | "patternProperties" | "definitions" | "$defs" => {
                        if let serde_json::Value::Object(inner) = v {
                            for (_, child) in inner.iter_mut() {
                                coerce_schema_node(child);
                            }
                        } else {
                            normalize_openai_tool_parameters_schema(v);
                        }
                    }
                    "anyOf" | "oneOf" | "allOf" | "prefixItems" => {
                        if let serde_json::Value::Array(arr) = v {
                            for child in arr.iter_mut() {
                                coerce_schema_node(child);
                            }
                        } else {
                            normalize_openai_tool_parameters_schema(v);
                        }
                    }
                    "items" => match v {
                        serde_json::Value::Array(arr) => {
                            for child in arr.iter_mut() {
                                coerce_schema_node(child);
                            }
                        }
                        _ => coerce_schema_node(v),
                    },
                    _ => normalize_openai_tool_parameters_schema(v),
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr.iter_mut() {
                normalize_openai_tool_parameters_schema(v);
            }
        }
        _ => {}
    }
}

#[cfg(any(not(feature = "cli"), test))]
pub(crate) fn normalize_openai_tools_in_chat_body(body: &mut serde_json::Value) {
    let tools = match body.get_mut("tools") {
        Some(t) => t,
        None => return,
    };

    let tools_arr = match tools.as_array_mut() {
        Some(a) => a,
        None => return,
    };

    for tool in tools_arr.iter_mut() {
        let function = match tool.get_mut("function") {
            Some(f) => f,
            None => continue,
        };
        let parameters = match function.get_mut("parameters") {
            Some(p) => p,
            None => continue,
        };

        normalize_openai_tool_parameters_schema(parameters);
    }
}

pub(crate) fn http_status_indicates_api_key_retry(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS
    )
}
