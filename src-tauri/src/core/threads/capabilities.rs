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
    // Integer-only: `ThreadCapabilities::version` is a `u8`, so accepting a
    // float `1.0` here would write a record that later fails to deserialize.
    ) && value["version"].as_u64() == Some(1)
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

/// A consistent snapshot for scoped Chat tool dispatch. The host supplies the
/// configured data root, never a root supplied by the webview.
pub async fn read_conversation_capabilities(
    data_folder: &Path,
    thread_id: &str,
) -> Result<Value, String> {
    super::utils::validate_thread_id(thread_id)?;
    if super::helpers::should_use_sqlite() {
        return Err("Conversation capabilities are unavailable on mobile".into());
    }
    // Temporary Chat has no persisted consent record. Preserve its existing
    // scratch tools, but never consult disk or accept elevated caller grants.
    if thread_id == "temporary-chat" {
        return Ok(
            serde_json::json!({"version":1,"folderScope":null,"shellNetwork":false,"memoryWrite":false}),
        );
    }
    let lock = super::helpers::get_lock_for_thread(thread_id).await;
    let _guard = lock.lock().await;
    let path = super::utils::get_thread_metadata_path(data_folder, thread_id)?;
    let thread: Value = serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if thread["id"].as_str() != Some(thread_id)
        || thread["metadata"]["mode"].as_str() == Some("cowork")
        || !(thread["metadata"].is_null() || thread["metadata"].is_object())
    {
        return Err("Conversation capabilities require a persistent Chat thread".into());
    }
    let value = thread["metadata"]["conversationCapabilities"].clone();
    if value.is_null() {
        return Ok(
            serde_json::json!({"version":1,"folderScope":null,"shellNetwork":false,"memoryWrite":false}),
        );
    }
    validate_conversation_capabilities(&value)?;
    Ok(value)
}

/// Pure classification of a conversation id from what the host read.
/// `record` is the parsed `thread.json` (None when absent). Anything that is
/// not positively identified fails closed to `Unknown`.
pub fn classify_thread_kind(
    thread_id: &str,
    record: Option<&Value>,
    legacy_session: bool,
    deleted_legacy: bool,
) -> tauri_plugin_agent_tools::thread_capabilities::ThreadKind {
    use tauri_plugin_agent_tools::thread_capabilities::ThreadKind;
    if super::utils::validate_thread_id(thread_id).is_err() {
        return ThreadKind::Unknown;
    }
    if thread_id == "temporary-chat" {
        return ThreadKind::Chat;
    }
    match record {
        Some(thread) => {
            let metadata = &thread["metadata"];
            if thread["id"].as_str() != Some(thread_id)
                || !(metadata.is_null() || metadata.is_object())
            {
                ThreadKind::Unknown
            } else if metadata["mode"].as_str() == Some("cowork") {
                ThreadKind::Cowork
            } else {
                ThreadKind::Chat
            }
        }
        None if legacy_session && !deleted_legacy => ThreadKind::LegacyCowork,
        None => ThreadKind::Unknown,
    }
}

/// Whether `thread_id` is a session in the legacy `code-sessions` blob.
/// Err on a malformed blob so the caller fails closed.
pub fn legacy_blob_has_session(raw: Option<&str>, thread_id: &str) -> Result<bool, String> {
    let Some(raw) = raw.filter(|r| !r.is_empty()) else {
        return Ok(false);
    };
    let parsed: Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    let Some(sessions) = parsed["state"]["sessions"].as_array() else {
        return Ok(false);
    };
    Ok(sessions.iter().any(|s| s["id"].as_str() == Some(thread_id)))
}

/// The deletion journal (`cowork_deleted_ids`): absent is empty, anything
/// invalid is an error so the caller fails closed.
pub fn deleted_journal_has(raw: Option<&str>, thread_id: &str) -> Result<bool, String> {
    let Some(raw) = raw else { return Ok(false) };
    let parsed: Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
    let ids = parsed.as_array().ok_or("Invalid Cowork deletion journal")?;
    if !ids.iter().all(Value::is_string) {
        return Err("Invalid Cowork deletion journal".into());
    }
    Ok(ids.iter().any(|id| id.as_str() == Some(thread_id)))
}

/// The host's own classification, read from the configured data root and the
/// host settings store: never from anything the webview sends.
pub async fn resolve_thread_kind(
    data_folder: &Path,
    thread_id: &str,
) -> tauri_plugin_agent_tools::thread_capabilities::ThreadKind {
    use tauri_plugin_agent_tools::thread_capabilities::ThreadKind;
    if super::utils::validate_thread_id(thread_id).is_err() || super::helpers::should_use_sqlite()
    {
        return ThreadKind::Unknown;
    }
    if thread_id == "temporary-chat" {
        return ThreadKind::Chat;
    }
    let lock = super::helpers::get_lock_for_thread(thread_id).await;
    let _guard = lock.lock().await;
    let Ok(path) = super::utils::get_thread_metadata_path(data_folder, thread_id) else {
        return ThreadKind::Unknown;
    };
    let record = match std::fs::read(&path) {
        Ok(bytes) => match serde_json::from_slice::<Value>(&bytes) {
            Ok(value) => Some(value),
            Err(_) => return ThreadKind::Unknown,
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => return ThreadKind::Unknown,
    };
    let (mut legacy, mut deleted) = (false, false);
    if record.is_none() {
        let blob = crate::core::app::settings_store::settings_get("code-sessions".into());
        let journal = crate::core::app::settings_store::settings_get("cowork_deleted_ids".into());
        match (
            legacy_blob_has_session(blob.as_deref(), thread_id),
            deleted_journal_has(journal.as_deref(), thread_id),
        ) {
            (Ok(l), Ok(d)) => (legacy, deleted) = (l, d),
            _ => return ThreadKind::Unknown,
        }
    }
    classify_thread_kind(thread_id, record.as_ref(), legacy, deleted)
}

#[cfg(test)]
mod kind_tests {
    use super::*;
    use serde_json::json;
    use tauri_plugin_agent_tools::thread_capabilities::ThreadKind::*;

    #[test]
    fn classifies_records_and_fails_closed() {
        let chat = json!({"id":"a","metadata":null});
        let chat_meta = json!({"id":"a","metadata":{"mode":"chat"}});
        let cowork = json!({"id":"a","metadata":{"mode":"cowork"}});
        assert_eq!(classify_thread_kind("a", Some(&chat), false, false), Chat);
        assert_eq!(classify_thread_kind("a", Some(&chat_meta), true, false), Chat);
        assert_eq!(classify_thread_kind("a", Some(&cowork), false, false), Cowork);
        assert_eq!(classify_thread_kind("temporary-chat", None, true, false), Chat);
        // A record for another id, or malformed metadata, is Unknown.
        assert_eq!(classify_thread_kind("b", Some(&chat), false, false), Unknown);
        let bad = json!({"id":"a","metadata":"x"});
        assert_eq!(classify_thread_kind("a", Some(&bad), false, false), Unknown);
        assert_eq!(classify_thread_kind("../a", Some(&cowork), false, false), Unknown);
    }

    #[test]
    fn no_record_needs_host_legacy_evidence() {
        // A renderer-chosen fresh id has no record and no legacy entry.
        assert_eq!(classify_thread_kind("fresh", None, false, false), Unknown);
        assert_eq!(classify_thread_kind("old", None, true, false), LegacyCowork);
        assert_eq!(classify_thread_kind("old", None, true, true), Unknown);
    }

    #[test]
    fn legacy_blob_and_journal_parsing_fail_closed() {
        let blob = r#"{"state":{"sessions":[{"id":"old"}]},"version":1}"#;
        assert_eq!(legacy_blob_has_session(Some(blob), "old"), Ok(true));
        assert_eq!(legacy_blob_has_session(Some(blob), "fresh"), Ok(false));
        assert_eq!(legacy_blob_has_session(None, "old"), Ok(false));
        assert!(legacy_blob_has_session(Some("{not json"), "old").is_err());
        assert_eq!(deleted_journal_has(None, "old"), Ok(false));
        assert_eq!(deleted_journal_has(Some(r#"["old"]"#), "old"), Ok(true));
        assert!(deleted_journal_has(Some(""), "old").is_err());
        assert!(deleted_journal_has(Some("[1]"), "old").is_err());
    }
}
