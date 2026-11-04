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
    patch_capabilities(data_folder, thread_id, value, false)
}

/// Marker failure permits only a subset of host-stored authority. The caller
/// holds the thread lock across this read/check and the durable replacement.
pub fn patch_narrowing_capabilities(
    data_folder: &Path,
    thread_id: &str,
    value: Value,
) -> Result<(), String> {
    patch_capabilities(data_folder, thread_id, value, true)
}

fn patch_capabilities(
    data_folder: &Path,
    thread_id: &str,
    mut value: Value,
    narrowing_only: bool,
) -> Result<(), String> {
    validate_conversation_capabilities(&value)?;
    let path = super::utils::get_thread_metadata_path(data_folder, thread_id)?;
    let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut thread: Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    if thread.get("id").and_then(Value::as_str) != Some(thread_id) {
        return Err("Thread id does not match stored thread".into());
    }
    // A migrated Cowork conversation keeps its folder grant in the same strict
    // record; only temporary Chat has no persisted consent at all.
    if thread_id == "temporary-chat" {
        return Err("Conversation capabilities require a persistent conversation".into());
    }
    if narrowing_only {
        use tauri_plugin_agent_tools::thread_capabilities::{denied, ThreadCapabilities};
        let stored = &thread["metadata"]["conversationCapabilities"];
        let previous: ThreadCapabilities = if stored.is_null() {
            denied()
        } else {
            validate_conversation_capabilities(stored)?;
            serde_json::from_value(stored.clone()).map_err(|e| e.to_string())?
        };
        previous.validate()?;
        // The frontend overlays app-wide network/memory settings on legacy
        // per-thread flags. Those settings remain host-authoritative; do not
        // mistake the overlay for a folder widening, or persist it as one.
        // Preserve legacy false flags while still permitting explicit revokes.
        value["shellNetwork"] =
            Value::Bool(value["shellNetwork"].as_bool().unwrap() && previous.shell_network);
        value["memoryWrite"] =
            Value::Bool(value["memoryWrite"].as_bool().unwrap() && previous.memory_write);
        let requested: ThreadCapabilities = serde_json::from_value(value.clone())
            .map_err(|e| e.to_string())?;
        requested.validate()?;
        let subset = requested.intersect(previous)?;
        if serde_json::to_value(subset).map_err(|e| e.to_string())? != value {
            return Err("Requested permissions widen stored authority; metadata was not changed".into());
        }
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
    super::helpers::update_thread_metadata(data_folder, thread_id, &thread)?;
    // The general metadata writer treats directory sync as best-effort. Consent
    // cannot: removing the durable denial before this rename is durable could
    // resurrect an older grant after a crash. Fail with the marker still present.
    #[cfg(test)]
    if FAIL_CONSENT_DIR_SYNC.lock().unwrap().as_deref() == Some(thread_id) {
        return Err("Injected consent directory sync failure".into());
    }
    #[cfg(unix)]
    std::fs::File::open(path.parent().ok_or("Missing thread directory")?)
        .and_then(|directory| directory.sync_all()).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
pub(super) static FAIL_CONSENT_DIR_SYNC: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

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
    let grant = serde_json::from_value(value.clone()).map_err(|e| format!("Invalid consent: {e}"))?;
    tauri_plugin_agent_tools::thread_capabilities::restore_async(thread_id.to_string(), grant).await?;
    let (mirror, _) = tauri_plugin_agent_tools::thread_capabilities::current(thread_id);
    let stored: tauri_plugin_agent_tools::thread_capabilities::ThreadCapabilities =
        serde_json::from_value(value).map_err(|e| e.to_string())?;
    serde_json::to_value(stored.intersect(mirror)?).map_err(|e| e.to_string())
}

/// Host-owned folder authority for a migrated Cowork conversation.
///
/// `Null` means the host holds no record: a legacy or never-granted session.
/// Its displayed folder stays inactive until the strict setter confirms access.
/// Any stored record --
/// including `folderScope: null` after a detach -- is authoritative from then
/// on and is restored through the same marker/ledger path as Chat, so a revoke
/// is never resurrected from `metadata.folder`.
pub async fn read_cowork_capabilities(
    data_folder: &Path,
    thread_id: &str,
) -> Result<Value, String> {
    super::utils::validate_thread_id(thread_id)?;
    if super::helpers::should_use_sqlite() {
        return Err("Conversation capabilities are unavailable on mobile".into());
    }
    let lock = super::helpers::get_lock_for_thread(thread_id).await;
    let _guard = lock.lock().await;
    let path = super::utils::get_thread_metadata_path(data_folder, thread_id)?;
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        // A legacy session has no thread record at all.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Value::Null),
        Err(e) => return Err(e.to_string()),
    };
    let thread: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if thread["id"].as_str() != Some(thread_id)
        || thread["metadata"]["mode"].as_str() != Some("cowork")
    {
        return Err("Folder authority requires a Cowork conversation record".into());
    }
    let value = thread["metadata"]["conversationCapabilities"].clone();
    if value.is_null() {
        return Ok(Value::Null);
    }
    validate_conversation_capabilities(&value)?;
    let stored: tauri_plugin_agent_tools::thread_capabilities::ThreadCapabilities =
        serde_json::from_value(value).map_err(|e| format!("Invalid consent: {e}"))?;
    tauri_plugin_agent_tools::thread_capabilities::restore_async(
        thread_id.to_string(),
        stored.clone(),
    )
    .await?;
    let (mirror, _) = tauri_plugin_agent_tools::thread_capabilities::current(thread_id);
    serde_json::to_value(stored.intersect(mirror)?).map_err(|e| e.to_string())
}

/// The all-off grant, as the wire value.
pub fn denied_value() -> Value {
    serde_json::json!({"version":1,"folderScope":null,"shellNetwork":false,"memoryWrite":false})
}

/// Second durable channel after a failed confirmation whose compensating DENY
/// also failed: narrow stored metadata to all-off. Restore is CONFIRM ∩
/// metadata, so a CONFIRM that persists late meets nothing to grant. Never
/// widens (it goes through the narrowing-only patch). Caller holds the thread lock.
pub fn narrow_after_failed_compensation(data_folder: &Path, thread_id: &str) -> Result<(), String> {
    patch_narrowing_capabilities(data_folder, thread_id, denied_value())
}

/// Truthful setter error for a grant whose confirmation returned false.
/// `failure` is the plugin's `confirm_failure`, `rollback_failed` its
/// `confirm_rollback_failed`. The in-process denial is never relaxed here.
pub fn confirm_failure_error(
    data_folder: &Path,
    thread_id: &str,
    failure: Option<String>,
    rollback_failed: bool,
) -> String {
    match failure {
        None => "The permission change was written but a concurrent change prevented its \
             activation; elevated access stays off. Try again."
            .into(),
        Some(detail) if !rollback_failed => format!(
            "The permission change could not be activated; access stays off and a durable \
             denial was recorded. Try again. ({detail})"
        ),
        Some(detail) => {
            let narrowed = match narrow_after_failed_compensation(data_folder, thread_id) {
                Ok(()) => "Saved permissions were narrowed to off as a precaution.".to_string(),
                Err(e) => format!("Narrowing saved permissions also failed ({e}); durability is not assured."),
            };
            format!(
                "Access is off now, but the permission change may return after a crash: its \
                 confirmation failed and could not be undone durably. {narrowed} ({detail})"
            )
        }
    }
}

/// Attach host-owned consent to a listed thread. A host read error fails
/// CLOSED with an explicit all-off grant plus `conversationCapabilitiesError`:
/// dropping the field would let the frontend fall back to its legacy default
/// (a writable folder for Cowork). Only a Cowork thread the host holds no
/// record for (`Null`) keeps the field absent, which is the legacy default.
pub fn apply_listed_capabilities(thread: &mut Value, cowork: bool, read: Result<Value, String>) {
    if thread["metadata"].is_null() {
        if matches!(&read, Ok(v) if cowork && v.is_null()) {
            return;
        }
        thread["metadata"] = serde_json::json!({});
    }
    // A non-object, non-null metadata cannot carry the field; it is listed as is.
    let Some(metadata) = thread["metadata"].as_object_mut() else { return };
    match read {
        Ok(value) if cowork && value.is_null() => {
            metadata.remove("conversationCapabilities");
            metadata.remove("conversationCapabilitiesError");
        }
        Ok(value) => {
            metadata.insert("conversationCapabilities".into(), value);
            metadata.remove("conversationCapabilitiesError");
        }
        Err(error) => {
            metadata.insert("conversationCapabilities".into(), denied_value());
            metadata.insert("conversationCapabilitiesError".into(), Value::String(error));
        }
    }
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
    let (legacy, deleted) = if record.is_none() {
        // The headless host has no desktop settings-store snapshot. Without
        // positive legacy identity evidence, an absent record stays Unknown.
        #[cfg(feature = "cli")]
        return ThreadKind::Unknown;

        #[cfg(not(feature = "cli"))]
        {
            let blob = crate::core::app::settings_store::settings_get("code-sessions".into());
            let journal = crate::core::app::settings_store::settings_get("cowork_deleted_ids".into());
            match (
                legacy_blob_has_session(blob.as_deref(), thread_id),
                deleted_journal_has(journal.as_deref(), thread_id),
            ) {
                (Ok(l), Ok(d)) => (l, d),
                _ => return ThreadKind::Unknown,
            }
        }
    } else {
        (false, false)
    };
    classify_thread_kind(thread_id, record.as_ref(), legacy, deleted)
}

#[cfg(test)]
mod kind_tests {
    use super::*;
    use serde_json::json;
    use tauri_plugin_agent_tools::thread_capabilities::ThreadKind::*;

    #[cfg(feature = "cli")]
    #[tokio::test]
    async fn cli_resolver_requires_persisted_identity() {
        let root = tempfile::tempdir().unwrap();
        let id = "cli-identity";
        let path = super::super::utils::get_thread_metadata_path(root.path(), id).unwrap();
        assert_eq!(resolve_thread_kind(root.path(), id).await, Unknown);
        // Resolving an absent id must not create a record or directory.
        assert!(!path.parent().unwrap().exists());
        assert_eq!(resolve_thread_kind(root.path(), "../invalid").await, Unknown);
        assert_eq!(resolve_thread_kind(root.path(), "temporary-chat").await, Chat);

        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        for (record, expected) in [
            (json!({"id":id,"metadata":null}), Chat),
            (json!({"id":id,"metadata":{"mode":"cowork"}}), Cowork),
            (json!({"id":"another-id","metadata":null}), Unknown),
            (json!({"id":id,"metadata":"invalid"}), Unknown),
        ] {
            std::fs::write(&path, serde_json::to_vec(&record).unwrap()).unwrap();
            assert_eq!(resolve_thread_kind(root.path(), id).await, expected);
        }
        std::fs::write(&path, "{invalid json").unwrap();
        assert_eq!(resolve_thread_kind(root.path(), id).await, Unknown);
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();
        assert_eq!(resolve_thread_kind(root.path(), id).await, Unknown);
    }

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
