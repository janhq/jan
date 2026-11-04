use std::fs::{self, File};
use std::io::Write;
use tauri::Runtime;
use uuid::Uuid;

#[cfg(any(target_os = "android", target_os = "ios"))]
use super::db;
use super::helpers::{
    get_lock_for_thread, read_messages_from_file, should_use_sqlite, update_thread_metadata,
    write_file_atomic, write_messages_to_file,
};
use super::{
    constants::THREADS_FILE,
    utils::{
        ensure_data_dirs, ensure_thread_dir_exists, get_data_dir, get_messages_path,
        get_thread_dir, get_thread_metadata_path, validate_thread_id,
    },
};
use crate::core::app::commands::get_jan_data_folder_path;

/// Lists all threads by reading their metadata from the threads directory or database.
/// Returns a vector of thread metadata as JSON values.
#[tauri::command]
pub async fn list_threads<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<serde_json::Value>, String> {
    if should_use_sqlite() {
        // Use SQLite on mobile platforms
        #[cfg(any(target_os = "android", target_os = "ios"))]
        return db::db_list_threads(app_handle).await;
    }

    // Use file-based storage on desktop
    let data_folder = get_jan_data_folder_path(app_handle);
    ensure_data_dirs(&data_folder)?;
    let data_dir = get_data_dir(&data_folder);
    let mut threads = Vec::new();

    if !data_dir.exists() {
        return Ok(threads);
    }

    for entry in fs::read_dir(&data_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            let thread_metadata_path = path.join(THREADS_FILE);
            if thread_metadata_path.exists() {
                let data = fs::read_to_string(&thread_metadata_path).map_err(|e| e.to_string())?;
                match serde_json::from_str::<serde_json::Value>(&data) {
                    Ok(mut thread) => {
                        // Never expose stale disk consent as restorable authority.
                        if let Some(id) = thread.get("id").and_then(serde_json::Value::as_str).map(str::to_owned) {
                            if path.file_name().and_then(|name| name.to_str()) != Some(id.as_str()) {
                                // Stale/foreign record: never expose its consent, and fail closed.
                                let cowork = thread["metadata"]["mode"].as_str() == Some("cowork");
                                super::capabilities::apply_listed_capabilities(
                                    &mut thread,
                                    cowork,
                                    Err("Thread record does not match its directory".into()),
                                );
                                threads.push(thread);
                                continue;
                            }
                            let cowork = thread["metadata"]["mode"].as_str() == Some("cowork");
                            let read = if cowork {
                                super::capabilities::read_cowork_capabilities(&data_folder, &id).await
                            } else {
                                super::capabilities::read_conversation_capabilities(&data_folder, &id).await
                            };
                            // A host read error fails CLOSED (explicit all-off + error), never
                            // an absent field the frontend would default to a writable folder.
                            super::capabilities::apply_listed_capabilities(&mut thread, cowork, read);
                        }
                        threads.push(thread)
                    },
                    Err(e) => {
                        println!("Failed to parse thread file: {e}");
                        continue; // skip invalid thread files
                    }
                }
            }
        }
    }

    Ok(threads)
}

/// Creates a new thread, assigns it a unique ID, and persists its metadata.
/// Ensures the thread directory exists and writes thread.json.
#[tauri::command]
pub async fn create_thread<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    mut thread: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if should_use_sqlite() {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        return db::db_create_thread(app_handle, thread).await;
    }

    // Use file-based storage on desktop
    let data_folder = get_jan_data_folder_path(app_handle);
    ensure_data_dirs(&data_folder)?;
    // A caller-supplied id is kept when it is a valid thread id (a migrated
    // Cowork session keeps its id so its sandbox stays linked). A missing or
    // invalid id gets a fresh UUID, as before. Creation is idempotent: if
    // thread.json already exists for the id, it is returned untouched.
    let supplied = thread
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|id| validate_thread_id(id).is_ok())
        .map(str::to_string);
    let uuid = supplied.unwrap_or_else(|| Uuid::new_v4().to_string());
    // Creation shares the consent/modify/delete lock, including its idempotent
    // existing-record check. Concurrent supplied-id creates cannot overwrite a
    // successfully patched grant or each other's initial record.
    let lock = get_lock_for_thread(&uuid).await;
    let _guard = lock.lock().await;
    let existing = get_thread_metadata_path(&data_folder, &uuid)?;
    if existing.exists() {
        let data = fs::read_to_string(&existing).map_err(|e| e.to_string())?;
        return serde_json::from_str(&data).map_err(|e| e.to_string());
    }
    // Only the narrow consent setter may mint authority. Creation metadata is
    // ordinary caller content (including migration), not explicit consent.
    if let Some(metadata) = thread
        .get_mut("metadata")
        .and_then(serde_json::Value::as_object_mut)
    {
        metadata.remove("conversationCapabilities");
        metadata.remove("conversationCapabilitiesError");
    }
    thread["id"] = serde_json::Value::String(uuid.clone());
    let thread_dir = get_thread_dir(&data_folder, &uuid)?;
    if !thread_dir.exists() {
        fs::create_dir_all(&thread_dir).map_err(|e| e.to_string())?;
    }
    let path = get_thread_metadata_path(&data_folder, &uuid)?;
    let data = serde_json::to_string_pretty(&thread).map_err(|e| e.to_string())?;
    write_file_atomic(&path, data.as_bytes())?;
    Ok(thread)
}

/// Stable prefix of errors meaning the thread no longer exists on disk. The web
/// layer matches it to tell a permanent missing thread from a transient failure.
pub const THREAD_MISSING_ERROR_CODE: &str = "thread_missing";

fn thread_missing_error(detail: impl std::fmt::Display) -> String {
    format!("{THREAD_MISSING_ERROR_CODE}: {detail}")
}

/// Sidecar files a thread directory may hold besides thread.json/messages.jsonl.
/// Allowlisted so the command can never address an arbitrary file name.
const THREAD_EXTRA_NAMES: &[&str] = &["cowork"];

fn thread_extra_path(
    data_folder: &std::path::Path,
    thread_id: &str,
    name: &str,
) -> Result<std::path::PathBuf, String> {
    if !THREAD_EXTRA_NAMES.contains(&name) {
        return Err(format!("Unsupported thread extra: {name:?}"));
    }
    Ok(get_thread_dir(data_folder, thread_id)?.join(format!("{name}.json")))
}

/// Reads a per-thread sidecar (e.g. the Cowork transcript). `Ok(None)` when absent.
#[tauri::command]
pub async fn read_thread_extra<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
    name: String,
) -> Result<Option<serde_json::Value>, String> {
    let data_folder = get_jan_data_folder_path(app_handle);
    let path = thread_extra_path(&data_folder, &thread_id, &name)?;
    if !path.exists() {
        return Ok(None);
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data)
        .map(Some)
        .map_err(|e| e.to_string())
}

/// Writes a per-thread sidecar atomically (temp file + rename) under the
/// thread's lock. It only creates the thread directory when `create` is true
/// (migration and a session's first commit): a late write for a thread that was
/// deleted must fail instead of resurrecting a directory holding a lone sidecar.
#[tauri::command]
pub async fn write_thread_extra<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
    name: String,
    value: serde_json::Value,
    create: Option<bool>,
) -> Result<(), String> {
    let data_folder = get_jan_data_folder_path(app_handle);
    let path = thread_extra_path(&data_folder, &thread_id, &name)?;
    let lock = get_lock_for_thread(&thread_id).await;
    let _guard = lock.lock().await;
    if create.unwrap_or(false) {
        ensure_thread_dir_exists(&data_folder, &thread_id)?;
    } else if !get_thread_metadata_path(&data_folder, &thread_id)?.exists() {
        return Err(thread_missing_error(format!(
            "Thread '{thread_id}' has no thread.json; refusing to create it from a sidecar write"
        )));
    }
    let data = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    write_file_atomic(&path, &data)
}

/// Modifies an existing thread's metadata by overwriting its thread.json file.
/// Returns an error if the thread directory does not exist.
#[tauri::command]
pub async fn modify_thread<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    mut thread: serde_json::Value,
) -> Result<(), String> {
    if should_use_sqlite() {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        return db::db_modify_thread(app_handle, thread).await;
    }

    // Use file-based storage on desktop
    let data_folder = get_jan_data_folder_path(app_handle);
    let thread_id = thread
        .get("id")
        .and_then(|id| id.as_str())
        .ok_or("Missing thread id")?;
    let lock = get_lock_for_thread(thread_id).await;
    let _guard = lock.lock().await;
    let thread_dir = get_thread_dir(&data_folder, thread_id)?;
    if !thread_dir.exists() {
        return Err(thread_missing_error("Thread directory does not exist"));
    }
    let path = get_thread_metadata_path(&data_folder, thread_id)?;
    if !path.is_file() {
        return Err(thread_missing_error("Thread does not exist"));
    }
    // Ordinary whole-record updates are not consent authority. A stale UI
    // snapshot must not restore a revoked grant (or erase a newer grant).
    let stored: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let current = stored
        .get("metadata")
        .and_then(|m| m.get("conversationCapabilities"))
        .cloned();
    if let Some(metadata) = thread.get_mut("metadata").and_then(|m| m.as_object_mut()) {
        metadata.remove("conversationCapabilities");
        // List-only fail-closed annotation; never persisted from a UI snapshot.
        metadata.remove("conversationCapabilitiesError");
    }
    if let Some(current) = current {
        if !thread.get("metadata").is_some_and(|m| m.is_object()) {
            thread["metadata"] = serde_json::json!({});
        }
        thread["metadata"]["conversationCapabilities"] = current;
    }
    let data = serde_json::to_string_pretty(&thread).map_err(|e| e.to_string())?;
    write_file_atomic(&path, data.as_bytes())
}

/// Patch only explicit conversation consent. Mobile storage is unsupported and
/// must reject rather than falsely report that a grant/revocation was saved.
#[tauri::command]
pub async fn set_thread_conversation_capabilities<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
    value: serde_json::Value,
) -> Result<(), String> {
    super::capabilities::validate_conversation_capabilities(&value)?;
    validate_thread_id(&thread_id)?;
    if should_use_sqlite() {
        return Err("Conversation capabilities persistence is not supported on mobile".into());
    }
    let data_folder = get_jan_data_folder_path(app_handle);
    let lock = get_lock_for_thread(&thread_id).await;
    let _guard = lock.lock().await;
    // Narrow the host's in-process confirmation BEFORE the write, and for
    // every caller rather than only the frontend: a write that then fails --
    // or is lost -- must never leave an earlier confirmation live. The input
    // validation above runs first: a request rejected there writes nothing
    // and narrows nothing, and a user's revocation does not depend on this
    // setter accepting it -- the frontend narrows the host pre-queue via
    // `revoke_thread_capabilities` before this command is ever awaited.
    // This also stops the thread's monitors and reaps their poll children, so
    // nothing keeps running under the authority being replaced.
    // Deserialize and host-validate BEFORE narrowing or writing: a grant that
    // cannot pass `ThreadCapabilities::validate()` could never be confirmed,
    // so writing it first would persist a dead value, revoke the live one,
    // and misreport the dropped confirm as a concurrency race whose retry can
    // never succeed. The lexical check above is necessary but not sufficient:
    // a Windows drive path is lexically valid everywhere, while
    // `Path::is_absolute` accepts it only on Windows.
    let grant: tauri_plugin_agent_tools::thread_capabilities::ThreadCapabilities =
        serde_json::from_value(value.clone())
            .map_err(|e| format!("Invalid version 1 conversation capabilities: {e}"))?;
    grant.validate()?;
    let token = tauri_plugin_agent_tools::revoke_thread_consent(&thread_id).await;
    if let Err(marker_error) = tauri_plugin_agent_tools::thread_capabilities::denial_persisted(&thread_id) {
        // Even without a marker, a durable metadata narrowing prevents restart
        // from replaying the revoked part of the old grant. Never use this
        // fallback to save a widening, and never confirm on a marker error.
        return match super::capabilities::patch_narrowing_capabilities(&data_folder, &thread_id, value) {
            Ok(()) => Err(format!("{marker_error}; requested narrowing was saved, but access stays off in this process")),
            Err(patch_error) => Err(format!("{marker_error}; narrowing persistence also failed: {patch_error}; metadata durability is not assured")),
        };
    }
    super::capabilities::patch_conversation_capabilities(&data_folder, &thread_id, value)?;
    // Test seam for the reviewed interleaving: `stop_all_thread_monitors`
    // takes no per-thread lock, so its barrier bump can land between this
    // setter's narrow and its confirm in production. The seam reproduces
    // exactly that, deterministically.
    #[cfg(test)]
    if SETTER_BUMP_BEFORE_CONFIRM.lock().unwrap().as_deref() == Some(thread_id.as_str()) {
        tauri_plugin_agent_tools::thread_capabilities::bump_generation(&thread_id);
    }
    // Test seam: break the platform's durable store after the DENY+metadata
    // steps so both the CONFIRM and its compensating DENY fail.
    #[cfg(test)]
    if SETTER_BREAK_STORE_BEFORE_CONFIRM.lock().unwrap().as_deref() == Some(thread_id.as_str()) {
        let store = tauri_plugin_agent_tools::thread_capabilities::denial_store_path(&thread_id)
            .unwrap()
            .expect("consent root configured");
        fs::remove_file(&store).ok();
        fs::create_dir_all(&store).unwrap();
    }
    // Only a write that actually succeeded confirms, and only when no newer
    // narrow intervened. A skipped confirm leaves the thread denied, which the
    // per-poll intersection enforces regardless of what is on disk -- so a
    // dropped confirmation MUST surface as an error, never as success: the
    // grant is on disk but the host denies it, and an Ok here would have the
    // UI show it active. The error leaves the frontend overlay denied
    // (consistent with the host) and the on-disk value reachable through the
    // reconfirm flow; a retry simply runs the setter again. The grant was
    // validated before the write, so this false really is concurrency.
    if !tauri_plugin_agent_tools::confirm_thread_consent(&thread_id, grant, token).await {
        // Never relaxes the in-process denial. The wording follows what the
        // plugin knows: concurrency, a durable DENY after a failed confirm, or
        // an unknown outcome (then narrow metadata as a second durable channel).
        // One lock acquisition: the message and the rollback flag must describe
        // the same entry, or the metadata narrowing could be skipped wrongly.
        let (failure, rollback_failed) =
            tauri_plugin_agent_tools::thread_capabilities::confirm_failure_snapshot(&thread_id);
        return Err(super::capabilities::confirm_failure_error(
            &data_folder,
            &thread_id,
            failure,
            rollback_failed,
        ));
    }
    Ok(())
}

/// Test seam: replaces the thread's durable denial store with a directory just
/// before the confirm, so the CONFIRM append fails (Windows ledger: its
/// compensating DENY fails too; Unix marker: the remove fails).
#[cfg(test)]
pub(super) static SETTER_BREAK_STORE_BEFORE_CONFIRM: std::sync::Mutex<Option<String>> =
    std::sync::Mutex::new(None);

/// Test seam: forces a `stop_all_thread_monitors`-style barrier bump between
/// the strict setter's narrow and its confirm (per-thread id, so parallel
/// tests never collide). stop-all takes no per-thread lock, which is exactly
/// why this interleaving is reachable in production.
#[cfg(test)]
pub(super) static SETTER_BUMP_BEFORE_CONFIRM: std::sync::Mutex<Option<String>> =
    std::sync::Mutex::new(None);

/// Roll back only an unchanged, empty desktop creation. The expected raw
/// creation response is a compare-and-delete receipt, not arbitrary authority
/// to delete a conversation that another window has edited or started.
#[tauri::command]
pub async fn rollback_created_thread<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
    mut expected: serde_json::Value,
) -> Result<(), String> {
    validate_thread_id(&thread_id)?;
    if should_use_sqlite() || thread_id == "temporary-chat" {
        return Err("Created chat rollback is unsupported for this conversation".into());
    }
    if expected["id"].as_str() != Some(thread_id.as_str()) || expected["metadata"]["mode"].as_str() == Some("cowork") {
        return Err("Invalid created chat receipt".into());
    }
    let data_folder = get_jan_data_folder_path(app_handle);
    let lock = get_lock_for_thread(&thread_id).await;
    let _guard = lock.lock().await;
    let directory = get_thread_dir(&data_folder, &thread_id)?;
    let path = get_thread_metadata_path(&data_folder, &thread_id)?;
    let mut current: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&path).map_err(|e| e.to_string())?
    ).map_err(|e| e.to_string())?;
    // Grant saves are the only permitted change between creation and refusal.
    for record in [&mut current, &mut expected] {
        if let Some(metadata) = record.get_mut("metadata").and_then(|v| v.as_object_mut()) {
            metadata.remove("conversationCapabilities");
        }
        if record.get("metadata").is_none_or(|m| m.is_null() || m.as_object().is_some_and(|o| o.is_empty())) {
            record.as_object_mut().ok_or("Invalid created chat receipt")?.remove("metadata");
        }
    }
    if current != expected {
        return Err("Created chat changed; refusing rollback".into());
    }
    for entry in fs::read_dir(&directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_name() == THREADS_FILE { continue; }
        // An empty messages file is harmless; sidecars or any other content
        // indicate the conversation has acquired data and must be retained.
        if entry.path() == get_messages_path(&data_folder, &thread_id)?
            && entry.file_type().map_err(|e| e.to_string())?.is_file()
            && fs::read(entry.path()).map_err(|e| e.to_string())?.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        return Err("Created chat contains data; refusing rollback".into());
    }
    // Past every refusal, this IS a delete, so it tears down exactly as
    // `delete_thread` does: revoke on the ATTEMPT (a removal that fails must
    // not leave the thread confirmed with monitors polling), cancel the
    // shells the thread itself started, and forget only once the directory is
    // really gone so the id cannot be recreated into the old confirmation.
    // A rollback refused above keeps the conversation -- and its consent.
    tauri_plugin_agent_tools::revoke_thread_consent(&thread_id).await;
    tauri_plugin_agent_tools::thread_capabilities::denial_persisted(&thread_id)?;
    tauri_plugin_agent_tools::cancel_thread_shells(&thread_id);
    // Test seam below: proving "a failed removal leaves the thread denied"
    // needs the removal to fail on demand, and a permissions-based failure is
    // not deterministic -- a suite running as root ignores directory modes.
    #[cfg(test)]
    if ROLLBACK_REMOVAL_FAILS_FOR.lock().unwrap().as_deref() == Some(thread_id.as_str()) {
        return Err("forced removal failure (test seam)".into());
    }
    fs::remove_dir_all(directory).map_err(|e| e.to_string())?;
    #[cfg(test)]
    fail_marker_writes_after_removal(&data_folder, &thread_id);
    tauri_plugin_agent_tools::forget_thread_consent(&thread_id).await;
    Ok(())
}

/// Scoped to one thread id so the other rollback tests, running in parallel
/// in the same process, never see a forced failure.
#[cfg(test)]
pub(super) static ROLLBACK_REMOVAL_FAILS_FOR: std::sync::Mutex<Option<String>> =
    std::sync::Mutex::new(None);

// Fault injection is identity-scoped and consumed only after successful removal.
#[cfg(test)]
pub(super) static FAIL_MARKER_AFTER_REMOVAL: std::sync::Mutex<Vec<String>> =
    std::sync::Mutex::new(Vec::new());

#[cfg(test)]
fn fail_marker_writes_after_removal(_data_folder: &std::path::Path, thread_id: &str) {
    let mut ids = FAIL_MARKER_AFTER_REMOVAL.lock().unwrap();
    if let Some(index) = ids.iter().position(|id| id == thread_id) {
        ids.remove(index);
        // The real platform store (Unix marker / Windows ledger), not a fixed name.
        let marker = tauri_plugin_agent_tools::thread_capabilities::denial_store_path(thread_id)
            .unwrap()
            .expect("consent root configured");
        fs::remove_file(&marker).unwrap();
        // Still a denial on restart, but any redundant write now fails.
        fs::create_dir(&marker).unwrap();
    }
}

/// Deletes a thread and all its associated files by removing its directory.
#[tauri::command]
pub async fn delete_thread<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
) -> Result<(), String> {
    if should_use_sqlite() {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        return db::db_delete_thread(app_handle, &thread_id).await;
    }

    // Use file-based storage on desktop
    let data_folder = get_jan_data_folder_path(app_handle);
    let lock = get_lock_for_thread(&thread_id).await;
    let _guard = lock.lock().await;
    // `get_thread_dir` validates the id, so this runs before anything is
    // keyed on it.
    let thread_dir = get_thread_dir(&data_folder, &thread_id)?;
    // Narrow on the delete ATTEMPT, before the removal, for the same reason
    // the consent setter narrows before it writes: a delete that then fails
    // must not leave this thread confirmed with its monitors still polling.
    // Scoped to this thread id alone; no other thread is touched.
    tauri_plugin_agent_tools::revoke_thread_consent(&thread_id).await;
    tauri_plugin_agent_tools::thread_capabilities::denial_persisted(&thread_id)?;
    // The conversation itself is going away, so the shells it started go with
    // it: the raw bucket is disjoint from the monitor bucket the revoke reaps.
    tauri_plugin_agent_tools::cancel_thread_shells(&thread_id);
    if thread_dir.exists() {
        fs::remove_dir_all(thread_dir).map_err(|error| error.to_string())?;
    }
    // Finalize without more persistence: retain the acknowledged denial and
    // invalidate stale work, so an out-of-band restore or reused id cannot
    // inherit the old confirmation. No fallible step may follow removal.
    #[cfg(test)]
    fail_marker_writes_after_removal(&data_folder, &thread_id);
    tauri_plugin_agent_tools::forget_thread_consent(&thread_id).await;
    Ok(())
}

/// Lists all messages for a given thread by reading and parsing its messages.jsonl file.
/// Returns a vector of message JSON values.
#[tauri::command]
pub async fn list_messages<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    if should_use_sqlite() {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        return db::db_list_messages(app_handle, &thread_id).await;
    }

    // Use file-based storage on desktop
    let data_folder = get_jan_data_folder_path(app_handle);
    read_messages_from_file(&data_folder, &thread_id)
}

/// Appends a new message to a thread's messages.jsonl file.
/// Uses a per-thread async lock to prevent race conditions and ensure file consistency.
#[tauri::command]
pub async fn create_message<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    mut message: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if should_use_sqlite() {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        return db::db_create_message(app_handle, message).await;
    }

    // Use file-based storage on desktop
    let data_folder = get_jan_data_folder_path(app_handle);
    let thread_id = {
        let id = message
            .get("thread_id")
            .and_then(|v| v.as_str())
            .ok_or("Missing thread_id")?;
        id.to_string()
    };
    let path = get_messages_path(&data_folder, &thread_id)?;

    if message.get("id").is_none() {
        let uuid = Uuid::new_v4().to_string();
        message["id"] = serde_json::Value::String(uuid);
    }

    // Acquire per-thread lock before writing
    {
        let lock = get_lock_for_thread(&thread_id).await;
        let _guard = lock.lock().await;

        // Ensure directory exists right before file operations to handle race conditions
        ensure_thread_dir_exists(&data_folder, &thread_id)?;

        // Dedupe against a modify_message upsert that landed first.
        let message_id = message
            .get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        if let Some(ref id) = message_id {
            let existing = read_messages_from_file(&data_folder, &thread_id)?;
            if existing
                .iter()
                .any(|m| m.get("id").and_then(|v| v.as_str()) == Some(id.as_str()))
            {
                return Ok(message);
            }
        }

        let mut file: File = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|e| e.to_string())?;

        let data = serde_json::to_string(&message).map_err(|e| e.to_string())?;
        writeln!(file, "{data}").map_err(|e| e.to_string())?;

        // Explicitly flush to ensure data is written before returning
        file.flush().map_err(|e| e.to_string())?;
    }

    Ok(message)
}

/// Modifies an existing message in a thread's messages.jsonl file.
/// Uses a per-thread async lock to prevent race conditions and ensure file consistency.
/// Rewrites the entire messages.jsonl file for the thread.
#[tauri::command]
pub async fn modify_message<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    message: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if should_use_sqlite() {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        return db::db_modify_message(app_handle, message).await;
    }

    // Use file-based storage on desktop
    let data_folder = get_jan_data_folder_path(app_handle);
    let thread_id = message
        .get("thread_id")
        .and_then(|v| v.as_str())
        .ok_or("Missing thread_id")?;
    let message_id = message
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Missing message id")?;

    // Acquire per-thread lock before modifying
    {
        let lock = get_lock_for_thread(thread_id).await;
        let _guard = lock.lock().await;

        let mut messages = read_messages_from_file(&data_folder, thread_id)?;
        match messages
            .iter()
            .position(|m| m.get("id").and_then(|v| v.as_str()) == Some(message_id))
        {
            Some(index) => {
                messages[index] = message.clone();
            }
            // Upsert when create_message lost the lock race; its dedupe path
            // reconciles a subsequent late create.
            None => {
                ensure_thread_dir_exists(&data_folder, thread_id)?;
                messages.push(message.clone());
            }
        }

        let path = get_messages_path(&data_folder, thread_id)?;
        write_messages_to_file(&messages, &path)?;
    }
    Ok(message)
}

/// Deletes a message from a thread's messages.jsonl file by message ID.
/// Rewrites the entire messages.jsonl file for the thread.
/// Uses a per-thread async lock to prevent race conditions and ensure file consistency.
#[tauri::command]
pub async fn delete_message<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
    message_id: String,
) -> Result<(), String> {
    if should_use_sqlite() {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        return db::db_delete_message(app_handle, &thread_id, &message_id).await;
    }

    // Use file-based storage on desktop
    let data_folder = get_jan_data_folder_path(app_handle);
    // Acquire per-thread lock before modifying
    {
        let lock = get_lock_for_thread(&thread_id).await;
        let _guard = lock.lock().await;

        let mut messages = read_messages_from_file(&data_folder, &thread_id)?;
        messages.retain(|m| m.get("id").and_then(|v| v.as_str()) != Some(message_id.as_str()));

        // Rewrite remaining messages
        let path = get_messages_path(&data_folder, &thread_id)?;
        write_messages_to_file(&messages, &path)?;
    }

    Ok(())
}

/// Retrieves the first assistant associated with a thread.
/// Returns an error if the thread or assistant is not found.
#[tauri::command]
pub async fn get_thread_assistant<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
) -> Result<serde_json::Value, String> {
    if should_use_sqlite() {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        return db::db_get_thread_assistant(app_handle, &thread_id).await;
    }

    // Use file-based storage on desktop
    let data_folder = get_jan_data_folder_path(app_handle);
    let path = get_thread_metadata_path(&data_folder, &thread_id)?;
    if !path.exists() {
        return Err("Thread not found".to_string());
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let thread: serde_json::Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    if let Some(assistants) = thread.get("assistants").and_then(|a| a.as_array()) {
        if let Some(first) = assistants.first() {
            Ok(first.clone())
        } else {
            Err("Assistant not found".to_string())
        }
    } else {
        Err("Assistant not found".to_string())
    }
}

/// Adds a new assistant to a thread's metadata.
/// Updates thread.json with the new assistant information.
#[tauri::command]
pub async fn create_thread_assistant<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
    assistant: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if should_use_sqlite() {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        return db::db_create_thread_assistant(app_handle, &thread_id, assistant).await;
    }

    // Use file-based storage on desktop
    let data_folder = get_jan_data_folder_path(app_handle);
    let lock = get_lock_for_thread(&thread_id).await;
    let _guard = lock.lock().await;
    let path = get_thread_metadata_path(&data_folder, &thread_id)?;
    if !path.exists() {
        return Err("Thread not found".to_string());
    }
    let mut thread: serde_json::Value = {
        let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&data).map_err(|e| e.to_string())?
    };
    if let Some(assistants) = thread.get_mut("assistants").and_then(|a| a.as_array_mut()) {
        assistants.push(assistant.clone());
    } else {
        thread["assistants"] = serde_json::Value::Array(vec![assistant.clone()]);
    }
    update_thread_metadata(&data_folder, &thread_id, &thread)?;
    Ok(assistant)
}

/// Modifies an existing assistant's information in a thread's metadata.
/// Updates thread.json with the modified assistant data.
#[tauri::command]
pub async fn modify_thread_assistant<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
    assistant: serde_json::Value,
) -> Result<serde_json::Value, String> {
    if should_use_sqlite() {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        return db::db_modify_thread_assistant(app_handle, &thread_id, assistant).await;
    }

    // Use file-based storage on desktop
    let data_folder = get_jan_data_folder_path(app_handle);
    let lock = get_lock_for_thread(&thread_id).await;
    let _guard = lock.lock().await;
    let path = get_thread_metadata_path(&data_folder, &thread_id)?;
    if !path.exists() {
        return Err("Thread not found".to_string());
    }
    let mut thread: serde_json::Value = {
        let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&data).map_err(|e| e.to_string())?
    };
    let assistant_id = assistant
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Missing id")?;
    if let Some(assistants) = thread
        .get_mut("assistants")
        .and_then(|a: &mut serde_json::Value| a.as_array_mut())
    {
        if let Some(index) = assistants
            .iter()
            .position(|a| a.get("id").and_then(|v| v.as_str()) == Some(assistant_id))
        {
            assistants[index] = assistant.clone();
            update_thread_metadata(&data_folder, &thread_id, &thread)?;
        }
    }
    Ok(assistant)
}
