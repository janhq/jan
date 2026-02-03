/*!
   Thread and Message Persistence Module

   This module provides all logic for managing threads and their messages, including creation, modification, deletion, and listing.
   Messages for each thread are persisted in a JSONL file (messages.jsonl) per thread directory.

   **Concurrency and Consistency Guarantee:**
   - All operations that write or modify messages for a thread are protected by a global, per-thread asynchronous lock.
   - This design ensures that only one operation can write to a thread's messages.jsonl file at a time, preventing race conditions.
   - As a result, the messages.jsonl file for each thread is always consistent and never corrupted, even under concurrent access.
*/

pub mod commands;
mod constants;
#[cfg(any(target_os = "android", target_os = "ios"))]
pub mod db;
pub mod helpers;
pub mod utils;

#[cfg(test)]
mod tests;

use std::fs::{self, File};
use std::io::Write;
use tauri::Runtime;
use uuid::Uuid;
use super::threads::helpers::{
    get_lock_for_thread, read_messages_from_file, should_use_sqlite, update_thread_metadata,
    write_messages_to_file,
};
use super::threads::utils::{
    ensure_data_dirs, ensure_thread_dir_exists, get_data_dir, get_messages_path,
    get_thread_dir, get_thread_metadata_path,
};

/// Internal function to create a thread from Rust code (e.g., gateway)
pub async fn create_thread_internal<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let title = thread.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled").to_string();
    log::info!("[Threads] Creating new thread: '{}'", title);

    if should_use_sqlite() {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        return db::db_create_thread(app_handle, thread).await;
    }

    // Use file-based storage on desktop
    ensure_data_dirs(app_handle.clone())?;
    let uuid = Uuid::new_v4().to_string();
    let mut thread = thread;
    thread["id"] = serde_json::Value::String(uuid.clone());
    let thread_dir = get_thread_dir(app_handle.clone(), &uuid);
    if !thread_dir.exists() {
        fs::create_dir_all(&thread_dir).map_err(|e| e.to_string())?;
    }
    let path = get_thread_metadata_path(app_handle.clone(), &uuid);
    let data = serde_json::to_string_pretty(&thread).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())?;

    log::info!("[Threads] Thread created successfully: {} ({})", uuid, title);
    Ok(thread)
}

/// Internal function to create a message from Rust code (e.g., gateway)
pub async fn create_message_internal<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    message: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let thread_id = {
        let id = message
            .get("thread_id")
            .and_then(|v| v.as_str())
            .ok_or("Missing thread_id")?;
        id.to_string()
    };

    let content = if let Some(v) = message.get("content").and_then(|v| v.as_str()) {
        v
    } else if let Some(arr) = message.get("content").and_then(|v| v.as_array()) {
        &*format!("[{} items]", arr.len())
    } else {
        "N/A"
    };

    let role = message.get("role").and_then(|v| v.as_str()).unwrap_or("unknown");
    let content_preview = if content.chars().next().is_some() {
        format!("'{}...'", content)
    } else {
        "'N/A'".to_string()
    };

    log::info!("[Threads] Creating message in thread {}: role={}, content={}",
        thread_id, role, content_preview.chars().take(60).collect::<String>());

    if should_use_sqlite() {
        #[cfg(any(target_os = "android", target_os = "ios"))]
        return db::db_create_message(app_handle, message).await;
    }

    // Use file-based storage on desktop
    let path = get_messages_path(app_handle.clone(), &thread_id);

    let mut message = message;
    if message.get("id").is_none() {
        let uuid = Uuid::new_v4().to_string();
        message["id"] = serde_json::Value::String(uuid);
    }

    // Acquire per-thread lock before writing
    {
        let lock = get_lock_for_thread(&thread_id).await;
        let _guard = lock.lock().await;

        // Ensure directory exists right before file operations to handle race conditions
        ensure_thread_dir_exists(app_handle.clone(), &thread_id)?;

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

    let msg_id = message.get("id").and_then(|v| v.as_str()).unwrap_or("unknown");
    log::info!("[Threads] Message created successfully in thread {}: id={}", thread_id, msg_id);

    Ok(message)
}
