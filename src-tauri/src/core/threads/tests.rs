use crate::core::app::commands::get_jan_data_folder_path;

use super::commands::*;
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
    let _ = fs::remove_dir_all(data_dir);
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
    let _ = fs::remove_dir_all(data_dir);
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
    let _ = fs::remove_dir_all(data_dir);
}
