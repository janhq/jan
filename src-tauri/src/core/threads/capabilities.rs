//! Narrow consent metadata only. Lexical paths are intent, never proof of
//! filesystem identity/containment; actual tool dispatch must validate again.
use serde_json::Value;
use std::path::Path;

fn exact_keys(value: &Value, keys: &[&str]) -> bool {
    value.as_object().is_some_and(|object| {
        object.len() == keys.len() && keys.iter().all(|key| object.contains_key(*key))
    })
}

fn lexical_folder_path(path: &str) -> bool {
    if path.encode_utf16().count() > 4096
        || path.trim_matches(|c| {
            matches!(c,
                '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}' |
                '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' |
                '\u{205f}' | '\u{3000}' | '\u{feff}'
            )
        }) != path
        || path.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
    {
        return false;
    }
    let bytes = path.as_bytes();
    let windows =
        bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\';
    if !windows && (!path.starts_with('/') || path.starts_with("//") || path.contains('\\')) {
        return false;
    }
    let rest = if windows { &path[3..] } else { &path[1..] };
    rest.split(if windows { '\\' } else { '/' }).all(|part| {
        !part.is_empty()
            && part != "."
            && part != ".."
            && !part.contains(':')
            && (!windows || !part.chars().any(|c| "/<>\"|?*".contains(c)))
    })
}

pub fn validate_conversation_capabilities(value: &Value) -> Result<(), String> {
    let valid = exact_keys(
        value,
        &["version", "folderScope", "shellNetwork", "memoryWrite"],
    ) && value["version"].as_f64() == Some(1.0)
        && value["shellNetwork"].is_boolean()
        && value["memoryWrite"].is_boolean()
        && (value["folderScope"].is_null() || {
            let folder = &value["folderScope"];
            exact_keys(folder, &["path", "access"])
                && folder["path"].as_str().is_some_and(lexical_folder_path)
                && matches!(folder["access"].as_str(), Some("read" | "write"))
        });
    if valid {
        Ok(())
    } else {
        Err("Invalid version 1 conversation capabilities".into())
    }
}

/// Caller must hold the SAME per-thread lock as modify/delete and assistants.
/// Never creates directories or thread.json, and changes no other field.
pub fn patch_conversation_capabilities(
    data_folder: &Path,
    thread_id: &str,
    value: Value,
) -> Result<(), String> {
    validate_conversation_capabilities(&value)?;
    let path = super::utils::get_thread_metadata_path(data_folder, thread_id)?;
    let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut thread: Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    if thread.get("id").and_then(Value::as_str) != Some(thread_id) {
        return Err("Thread id does not match stored thread".into());
    }
    if thread_id == "temporary-chat" || thread["metadata"]["mode"].as_str() == Some("cowork") {
        return Err("Conversation capabilities require a persistent Chat thread".into());
    }
    let object = thread.as_object_mut().ok_or("Invalid stored thread")?;
    let metadata = object.entry("metadata").or_insert(Value::Null);
    if metadata.is_null() {
        *metadata = serde_json::json!({});
    }
    metadata
        .as_object_mut()
        .ok_or("Invalid stored thread metadata")?
        .insert("conversationCapabilities".into(), value);
    super::helpers::update_thread_metadata(data_folder, thread_id, &thread)
}
