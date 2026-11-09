use std::fs::{self, File};
use std::io::Write;
use tauri::Runtime;
use uuid::Uuid;

#[cfg(any(target_os = "android", target_os = "ios"))]
use super::db;
use super::helpers::{
    get_lock_for_thread, read_messages_from_file, should_use_sqlite, update_thread_metadata,
    write_atomic, write_messages_to_file,
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
                match serde_json::from_str(&data) {
                    Ok(thread) => threads.push(thread),
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

/// Creates a new thread and persists its metadata.
/// Ensures the thread directory exists and writes thread.json.
///
/// A caller-supplied `id` is kept when it is a valid thread id (a migrated
/// Cowork session keeps its id so its sandbox stays linked). A missing or
/// invalid id gets a fresh UUID. Creation is idempotent: when thread.json
/// already exists for the id, that record is returned untouched. thread.json
/// is written atomically because it is the commit marker of a thread.
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
    let supplied = thread
        .get("id")
        .and_then(|v| v.as_str())
        .filter(|id| validate_thread_id(id).is_ok())
        .map(str::to_string);
    let uuid = supplied.unwrap_or_else(|| Uuid::new_v4().to_string());
    // Hold the thread lock across the existence check and the write so two
    // creates for one id cannot both pass the check and overwrite each other.
    let lock = get_lock_for_thread(&uuid).await;
    let _guard = lock.lock().await;
    let path = get_thread_metadata_path(&data_folder, &uuid)?;
    if path.exists() {
        let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        return serde_json::from_str(&data).map_err(|e| e.to_string());
    }
    thread["id"] = serde_json::Value::String(uuid.clone());
    let thread_dir = get_thread_dir(&data_folder, &uuid)?;
    if !thread_dir.exists() {
        fs::create_dir_all(&thread_dir).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(&thread).map_err(|e| e.to_string())?;
    write_atomic(&path, data.as_bytes())?;
    Ok(thread)
}

/// Sidecar files a thread directory may hold besides thread.json and
/// messages.jsonl. Allowlisted so the commands can never address an arbitrary
/// file name.
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

/// Guard for the `create: true` writes that run before thread.json commits a
/// thread. `create_message` makes the directory too, so a directory can hold a
/// real chat log with no thread.json yet, and an uncommitted migration must not
/// overwrite it. A non-empty messages.jsonl is only treated as the migration's
/// own when a sidecar is already there (the migration writes the sidecar first,
/// so any retry after a crash finds it) or, for a messages write, when the file
/// is byte-identical to the batch about to be written. Absent or empty logs
/// belong to nobody. `incoming` is the exact messages.jsonl body being written,
/// or `None` for a sidecar write.
fn ensure_uncommitted_dir_is_ours(
    data_folder: &std::path::Path,
    thread_id: &str,
    incoming: Option<&[u8]>,
) -> Result<(), String> {
    if get_thread_metadata_path(data_folder, thread_id)?.exists() {
        return Ok(());
    }
    let log = get_messages_path(data_folder, thread_id)?;
    let existing = match fs::read(&log) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    if existing.is_empty() || incoming == Some(existing.as_slice()) {
        return Ok(());
    }
    for name in THREAD_EXTRA_NAMES {
        if thread_extra_path(data_folder, thread_id, name)?.exists() {
            return Ok(());
        }
    }
    Err(format!(
        "Thread '{thread_id}' has messages but no thread.json; refusing to overwrite its messages"
    ))
}

/// Reads a per-thread sidecar (for example the Cowork transcript).
/// Returns `Ok(None)` when the sidecar does not exist.
#[tauri::command]
pub async fn read_thread_extra<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
    name: String,
) -> Result<Option<serde_json::Value>, String> {
    if should_use_sqlite() {
        return Err("Thread sidecars are not supported on mobile".to_string());
    }
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
/// thread's lock. The thread directory is only created when `create` is true
/// (the migration writes the sidecar before thread.json commits the thread): a
/// late write for a thread that was deleted must fail instead of resurrecting a
/// directory holding a lone sidecar.
#[tauri::command]
pub async fn write_thread_extra<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
    name: String,
    value: serde_json::Value,
    create: Option<bool>,
) -> Result<(), String> {
    if should_use_sqlite() {
        return Err("Thread sidecars are not supported on mobile".to_string());
    }
    let data_folder = get_jan_data_folder_path(app_handle);
    let path = thread_extra_path(&data_folder, &thread_id, &name)?;
    let lock = get_lock_for_thread(&thread_id).await;
    let _guard = lock.lock().await;
    if create.unwrap_or(false) {
        ensure_uncommitted_dir_is_ours(&data_folder, &thread_id, None)?;
        ensure_thread_dir_exists(&data_folder, &thread_id)?;
    } else if !get_thread_metadata_path(&data_folder, &thread_id)?.exists() {
        return Err(format!(
            "Thread '{thread_id}' has no thread.json; refusing to create it from a sidecar write"
        ));
    }
    let data = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    write_atomic(&path, &data)
}

/// Replaces a thread's whole messages.jsonl atomically (temp file + rename)
/// under the thread's lock. Unlike `create_message` it never appends, so
/// writing the same batch twice leaves identical bytes: the Cowork migration
/// relies on that to retry after a crash between this write and the thread.json
/// commit without duplicating the transcript. `create` has the same meaning as
/// in `write_thread_extra`. The batch is refused unless every message carries a
/// unique string id and this thread's id, the invariants `create_message` and
/// `modify_message` maintain for the log.
#[tauri::command]
pub async fn replace_thread_messages<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
    messages: Vec<serde_json::Value>,
    create: Option<bool>,
) -> Result<(), String> {
    if should_use_sqlite() {
        return Err("Replacing thread messages is not supported on mobile".to_string());
    }
    let mut seen = std::collections::HashSet::new();
    for message in &messages {
        let id = message
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or("Every message needs a string id")?;
        if !seen.insert(id) {
            return Err(format!("Duplicate message id {id:?}"));
        }
        if message.get("thread_id").and_then(|v| v.as_str()) != Some(thread_id.as_str()) {
            return Err(format!("Message {id:?} does not belong to thread {thread_id:?}"));
        }
    }
    let data_folder = get_jan_data_folder_path(app_handle);
    let path = get_messages_path(&data_folder, &thread_id)?;
    let lock = get_lock_for_thread(&thread_id).await;
    let _guard = lock.lock().await;
    let mut body = String::new();
    for message in &messages {
        body.push_str(&serde_json::to_string(message).map_err(|e| e.to_string())?);
        body.push('\n');
    }
    if create.unwrap_or(false) {
        ensure_uncommitted_dir_is_ours(&data_folder, &thread_id, Some(body.as_bytes()))?;
        ensure_thread_dir_exists(&data_folder, &thread_id)?;
    } else if !get_thread_metadata_path(&data_folder, &thread_id)?.exists() {
        return Err(format!(
            "Thread '{thread_id}' has no thread.json; refusing to create it from a messages write"
        ));
    }
    write_atomic(&path, body.as_bytes())
}

/// Modifies an existing thread's metadata by overwriting its thread.json file.
/// Returns an error if the thread directory does not exist.
#[tauri::command]
pub async fn modify_thread<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread: serde_json::Value,
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
    let thread_dir = get_thread_dir(&data_folder, thread_id)?;
    if !thread_dir.exists() {
        return Err("Thread directory does not exist".to_string());
    }
    let path = get_thread_metadata_path(&data_folder, thread_id)?;
    let data = serde_json::to_string_pretty(&thread).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())?;
    Ok(())
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
    let thread_dir = get_thread_dir(&data_folder, &thread_id)?;
    if thread_dir.exists() {
        let _ = fs::remove_dir_all(thread_dir);
    }
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
