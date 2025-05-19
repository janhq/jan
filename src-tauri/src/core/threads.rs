/*!
    Thread and Message Persistence Module

    This module provides all logic for managing threads and their messages, including creation, modification, deletion, and listing.
    Messages for each thread are persisted in a JSONL file (messages.jsonl) per thread directory.

    **Concurrency and Consistency Guarantee:**
    - All operations that write or modify messages for a thread are protected by a global, per-thread asynchronous lock.
    - This design ensures that only one operation can write to a thread's messages.jsonl file at a time, preventing race conditions.
    - As a result, the messages.jsonl file for each thread is always consistent and never corrupted, even under concurrent access.
*/

use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use tauri::command;
use tauri::Runtime;
use uuid::Uuid;

// For async file write serialization
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

// Global per-thread locks for message file writes
static MESSAGE_LOCKS: Lazy<Mutex<HashMap<String, Arc<Mutex<()>>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

use super::utils::{
    ensure_data_dirs, ensure_thread_dir_exists, get_data_dir, get_messages_path, get_thread_dir,
    get_thread_metadata_path, THREADS_FILE,
};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Thread {
    pub id: String,
    pub object: String,
    pub title: String,
    pub assistants: Vec<ThreadAssistantInfo>,
    pub created: i64,
    pub updated: i64,
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThreadMessage {
    pub id: String,
    pub object: String,
    pub thread_id: String,
    pub assistant_id: Option<String>,
    pub attachments: Option<Vec<Attachment>>,
    pub role: String,
    pub content: Vec<ThreadContent>,
    pub status: String,
    pub created_at: i64,
    pub completed_at: i64,
    pub metadata: Option<serde_json::Value>,
    pub type_: Option<String>,
    pub error_code: Option<String>,
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Attachment {
    pub file_id: Option<String>,
    pub tools: Option<Vec<Tool>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum Tool {
    #[serde(rename = "file_search")]
    FileSearch,
    #[serde(rename = "code_interpreter")]
    CodeInterpreter,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThreadContent {
    pub type_: String,
    pub text: Option<ContentValue>,
    pub image_url: Option<ImageContentValue>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ContentValue {
    pub value: String,
    pub annotations: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImageContentValue {
    pub detail: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThreadAssistantInfo {
    pub id: String,
    pub name: String,
    pub model: ModelInfo,
    pub instructions: Option<String>,
    pub tools: Option<Vec<AssistantTool>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub settings: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type")]
pub enum AssistantTool {
    #[serde(rename = "code_interpreter")]
    CodeInterpreter,
    #[serde(rename = "retrieval")]
    Retrieval,
    #[serde(rename = "function")]
    Function {
        name: String,
        description: Option<String>,
        parameters: Option<serde_json::Value>,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThreadState {
    pub has_more: bool,
    pub waiting_for_response: bool,
    pub error: Option<String>,
    pub last_message: Option<String>,
}

/// Lists all threads by reading their metadata from the threads directory.
/// Returns a vector of thread metadata as JSON values.
#[command]
pub async fn list_threads<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<Vec<serde_json::Value>, String> {
    ensure_data_dirs(app_handle.clone())?;
    let data_dir = get_data_dir(app_handle.clone());
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
                        println!("Failed to parse thread file: {}", e);
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
#[command]
pub async fn create_thread<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    mut thread: serde_json::Value,
) -> Result<serde_json::Value, String> {
    ensure_data_dirs(app_handle.clone())?;
    let uuid = Uuid::new_v4().to_string();
    thread["id"] = serde_json::Value::String(uuid.clone());
    let thread_dir = get_thread_dir(app_handle.clone(), &uuid);
    if !thread_dir.exists() {
        fs::create_dir_all(&thread_dir).map_err(|e| e.to_string())?;
    }
    let path = get_thread_metadata_path(app_handle.clone(), &uuid);
    let data = serde_json::to_string_pretty(&thread).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())?;
    Ok(thread)
}

/// Modifies an existing thread's metadata by overwriting its thread.json file.
/// Returns an error if the thread directory does not exist.
#[command]
pub async fn modify_thread<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread: serde_json::Value,
) -> Result<(), String> {
    let thread_id = thread
        .get("id")
        .and_then(|id| id.as_str())
        .ok_or("Missing thread id")?;
    let thread_dir = get_thread_dir(app_handle.clone(), thread_id);
    if !thread_dir.exists() {
        return Err("Thread directory does not exist".to_string());
    }
    let path = get_thread_metadata_path(app_handle.clone(), thread_id);
    let data = serde_json::to_string_pretty(&thread).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())?;
    Ok(())
}

/// Deletes a thread and all its associated files by removing its directory.
#[command]
pub async fn delete_thread<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
) -> Result<(), String> {
    let thread_dir = get_thread_dir(app_handle.clone(), &thread_id);
    if thread_dir.exists() {
        fs::remove_dir_all(thread_dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Lists all messages for a given thread by reading and parsing its messages.jsonl file.
/// Returns a vector of message JSON values.
#[command]
pub async fn list_messages<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
) -> Result<Vec<serde_json::Value>, String> {
    let path = get_messages_path(app_handle, &thread_id);
    if !path.exists() {
        return Ok(vec![]);
    }

    let file = File::open(&path).map_err(|e| {
        eprintln!("Error opening file {}: {}", path.display(), e);
        e.to_string()
    })?;
    let reader = BufReader::new(file);

    let mut messages = Vec::new();
    for line in reader.lines() {
        let line = line.map_err(|e| {
            eprintln!("Error reading line from file {}: {}", path.display(), e);
            e.to_string()
        })?;
        let message: serde_json::Value = serde_json::from_str(&line).map_err(|e| {
            eprintln!(
                "Error parsing JSON from line in file {}: {}",
                path.display(),
                e
            );
            e.to_string()
        })?;
        messages.push(message);
    }

    Ok(messages)
}

/// Appends a new message to a thread's messages.jsonl file.
/// Uses a per-thread async lock to prevent race conditions and ensure file consistency.
#[command]
pub async fn create_message<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    mut message: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let thread_id = {
        let id = message
            .get("thread_id")
            .and_then(|v| v.as_str())
            .ok_or("Missing thread_id")?;
        id.to_string()
    };
    ensure_thread_dir_exists(app_handle.clone(), &thread_id)?;
    let path = get_messages_path(app_handle.clone(), &thread_id);

    if message.get("id").is_none() {
        let uuid = Uuid::new_v4().to_string();
        message["id"] = serde_json::Value::String(uuid);
    }

    // Acquire per-thread lock before writing
    {
        let mut locks = MESSAGE_LOCKS.lock().await;
        let lock = locks
            .entry(thread_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone();
        drop(locks); // Release the map lock before awaiting the file lock

        let _guard = lock.lock().await;

        let mut file: File = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|e| e.to_string())?;

        let data = serde_json::to_string(&message).map_err(|e| e.to_string())?;
        writeln!(file, "{}", data).map_err(|e| e.to_string())?;
    }

    Ok(message)
}

/// Modifies an existing message in a thread's messages.jsonl file.
/// Uses a per-thread async lock to prevent race conditions and ensure file consistency.
/// Rewrites the entire messages.jsonl file for the thread.
#[command]
pub async fn modify_message<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    message: serde_json::Value,
) -> Result<serde_json::Value, String> {
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
        let mut locks = MESSAGE_LOCKS.lock().await;
        let lock = locks
            .entry(thread_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone();
        drop(locks); // Release the map lock before awaiting the file lock

        let _guard = lock.lock().await;

        let mut messages = list_messages(app_handle.clone(), thread_id.to_string()).await?;
        if let Some(index) = messages
            .iter()
            .position(|m| m.get("id").and_then(|v| v.as_str()) == Some(message_id))
        {
            messages[index] = message.clone();

            // Rewrite all messages
            let path = get_messages_path(app_handle.clone(), thread_id);
            let mut file = File::create(path).map_err(|e| e.to_string())?;
            for msg in messages {
                let data = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
                writeln!(file, "{}", data).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(message)
}

/// Deletes a message from a thread's messages.jsonl file by message ID.
/// Rewrites the entire messages.jsonl file for the thread.
/// Uses a per-thread async lock to prevent race conditions and ensure file consistency.
#[command]
pub async fn delete_message<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
    message_id: String,
) -> Result<(), String> {
    // Acquire per-thread lock before modifying
    {
        let mut locks = MESSAGE_LOCKS.lock().await;
        let lock = locks
            .entry(thread_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone();
        drop(locks); // Release the map lock before awaiting the file lock

        let _guard = lock.lock().await;

        let mut messages = list_messages(app_handle.clone(), thread_id.clone()).await?;
        messages.retain(|m| m.get("id").and_then(|v| v.as_str()) != Some(message_id.as_str()));

        // Rewrite remaining messages
        let path = get_messages_path(app_handle.clone(), &thread_id);
        let mut file = File::create(path).map_err(|e| e.to_string())?;
        for msg in messages {
            let data = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
            writeln!(file, "{}", data).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// Retrieves the first assistant associated with a thread.
/// Returns an error if the thread or assistant is not found.
#[command]
pub async fn get_thread_assistant<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
) -> Result<serde_json::Value, String> {
    let path = get_thread_metadata_path(app_handle, &thread_id);
    if !path.exists() {
        return Err("Thread not found".to_string());
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let thread: serde_json::Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    if let Some(assistants) = thread.get("assistants").and_then(|a| a.as_array()) {
        if let Some(first) = assistants.get(0) {
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
#[command]
pub async fn create_thread_assistant<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
    assistant: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let path = get_thread_metadata_path(app_handle.clone(), &thread_id);
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
    let data = serde_json::to_string_pretty(&thread).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(assistant)
}

/// Modifies an existing assistant's information in a thread's metadata.
/// Updates thread.json with the modified assistant data.
#[command]
pub async fn modify_thread_assistant<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: String,
    assistant: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let path = get_thread_metadata_path(app_handle.clone(), &thread_id);
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
            let data = serde_json::to_string_pretty(&thread).map_err(|e| e.to_string())?;
            fs::write(&path, data).map_err(|e| e.to_string())?;
        }
    }
    Ok(assistant)
}

#[cfg(test)]
mod tests {
    use crate::core::cmd::get_jan_data_folder_path;

    use super::*;
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use tauri::test::{mock_app, MockRuntime};

    // Helper to create a mock app handle with a temp data dir
    fn mock_app_with_temp_data_dir() -> (tauri::App<MockRuntime>, PathBuf) {
        let app = mock_app();
        let data_dir = get_jan_data_folder_path(app.handle().clone());
        println!("Mock app data dir: {}", data_dir.display());
        // Patch get_data_dir to use temp dir (requires get_data_dir to be overridable or injectable)
        // For now, we assume get_data_dir uses tauri::api::path::app_data_dir(&app_handle)
        // and that we can set the environment variable to redirect it.
        (app, data_dir)
    }

    #[tokio::test]
    async fn test_create_and_list_threads() {
        let (app, data_dir) = mock_app_with_temp_data_dir();
        // Create a thread
        let thread = json!({
            "object": "thread",
            "title": "Test Thread",
            "assistants": [],
            "created": 1234567890,
            "updated": 1234567890,
            "metadata": null
        });
        let created = create_thread(app.handle().clone(), thread.clone())
            .await
            .unwrap();
        assert_eq!(created["title"], "Test Thread");

        // List threads
        let threads = list_threads(app.handle().clone()).await.unwrap();
        assert!(threads.len() > 0);

        // Clean up
        fs::remove_dir_all(data_dir).unwrap();
    }

    #[tokio::test]
    async fn test_create_and_list_messages() {
        let (app, data_dir) = mock_app_with_temp_data_dir();
        // Create a thread first
        let thread = json!({
            "object": "thread",
            "title": "Msg Thread",
            "assistants": [],
            "created": 123,
            "updated": 123,
            "metadata": null
        });
        let created = create_thread(app.handle().clone(), thread.clone())
            .await
            .unwrap();
        let thread_id = created["id"].as_str().unwrap().to_string();

        // Create a message
        let message = json!({
            "object": "message",
            "thread_id": thread_id,
            "assistant_id": null,
            "attachments": null,
            "role": "user",
            "content": [],
            "status": "sent",
            "created_at": 123,
            "completed_at": 123,
            "metadata": null,
            "type_": null,
            "error_code": null,
            "tool_call_id": null
        });
        let created_msg = create_message(app.handle().clone(), message).await.unwrap();
        assert_eq!(created_msg["role"], "user");

        // List messages
        let messages = list_messages(app.handle().clone(), thread_id.clone())
            .await
            .unwrap();
        assert!(messages.len() > 0);
        assert_eq!(messages[0]["role"], "user");

        // Clean up
        fs::remove_dir_all(data_dir).unwrap();
    }

    #[tokio::test]
    async fn test_create_and_get_thread_assistant() {
        let (app, data_dir) = mock_app_with_temp_data_dir();
        // Create a thread
        let thread = json!({
            "object": "thread",
            "title": "Assistant Thread",
            "assistants": [],
            "created": 1,
            "updated": 1,
            "metadata": null
        });
        let created = create_thread(app.handle().clone(), thread.clone())
            .await
            .unwrap();
        let thread_id = created["id"].as_str().unwrap().to_string();

        // Add assistant
        let assistant = json!({
            "id": "assistant-1",
            "assistant_name": "Test Assistant",
            "model": {
                "id": "model-1",
                "name": "Test Model",
                "settings": json!({})
            },
            "instructions": null,
            "tools": null
        });
        let _ = create_thread_assistant(app.handle().clone(), thread_id.clone(), assistant.clone())
            .await
            .unwrap();

        // Get assistant
        let got = get_thread_assistant(app.handle().clone(), thread_id.clone())
            .await
            .unwrap();
        assert_eq!(got["assistant_name"], "Test Assistant");

        // Clean up
        fs::remove_dir_all(data_dir).unwrap();
    }
}
