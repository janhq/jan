use super::commands::*;
use super::helpers::should_use_sqlite;
use crate::core::app::commands::get_jan_data_folder_path;
use futures_util::future;
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use tauri::test::{mock_app, MockRuntime};

// Helper to create a mock app handle with a temp data dir
fn mock_app_with_temp_data_dir() -> (tauri::App<MockRuntime>, PathBuf) {
    let app = mock_app();
    // Get the actual data dir that will be used by storage code
    let data_dir = get_jan_data_folder_path(app.handle().clone());
    println!("Mock app data dir: {}", data_dir.display());
    (app, data_dir)
}

// Helper to create a basic thread
fn create_test_thread(title: &str) -> serde_json::Value {
    json!({
        "object": "thread",
        "title": title,
        "assistants": [],
        "created": 123,
        "updated": 123,
        "metadata": null
    })
}

// Helper to create a basic message
fn create_test_message(thread_id: &str, content_text: &str) -> serde_json::Value {
    json!({
        "object": "message",
        "thread_id": thread_id,
        "role": "user",
        "content": [{"type": "text", "text": content_text}],
        "status": "sent",
        "created_at": 123,
        "completed_at": 123,
        "metadata": null
    })
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
    assert!(!threads.is_empty());

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
    assert!(
        !messages.is_empty(),
        "Expected at least one message, but got none. Thread ID: {thread_id}"
    );
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

#[test]
fn test_should_use_sqlite_platform_detection() {
    // Test that should_use_sqlite returns correct value based on platform
    // On desktop platforms (macOS, Linux, Windows), it should return false
    // On mobile platforms (Android, iOS), it should return true

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        assert!(
            should_use_sqlite(),
            "should_use_sqlite should return true on mobile platforms"
        );
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        assert!(
            !should_use_sqlite(),
            "should_use_sqlite should return false on desktop platforms"
        );
    }
}

#[tokio::test]
async fn test_desktop_storage_backend() {
    // This test verifies that on desktop platforms, the file-based storage is used
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let (app, _data_dir) = mock_app_with_temp_data_dir();

        // Create a thread
        let thread = json!({
            "object": "thread",
            "title": "Desktop Test Thread",
            "assistants": [],
            "created": 1234567890,
            "updated": 1234567890,
            "metadata": null
        });

        let created = create_thread(app.handle().clone(), thread.clone())
            .await
            .unwrap();
        let thread_id = created["id"].as_str().unwrap().to_string();

        // Verify we can retrieve the thread (which proves file storage works)
        let threads = list_threads(app.handle().clone()).await.unwrap();
        let found = threads.iter().any(|t| t["id"] == thread_id);
        assert!(
            found,
            "Thread should be retrievable from file-based storage"
        );

        // Create a message
        let message = json!({
            "object": "message",
            "thread_id": thread_id,
            "role": "user",
            "content": [],
            "status": "sent",
            "created_at": 123,
            "completed_at": 123,
            "metadata": null
        });

        let _created_msg = create_message(app.handle().clone(), message).await.unwrap();

        // Verify we can retrieve the message (which proves file storage works)
        let messages = list_messages(app.handle().clone(), thread_id.clone())
            .await
            .unwrap();
        assert_eq!(
            messages.len(),
            1,
            "Message should be retrievable from file-based storage"
        );

        // Clean up
        let _ = fs::remove_dir_all(&_data_dir);
    }
}

#[tokio::test]
async fn test_modify_and_delete_thread() {
    let (app, data_dir) = mock_app_with_temp_data_dir();

    // Create a thread
    let thread = json!({
        "object": "thread",
        "title": "Original Title",
        "assistants": [],
        "created": 1234567890,
        "updated": 1234567890,
        "metadata": null
    });

    let created = create_thread(app.handle().clone(), thread.clone())
        .await
        .unwrap();
    let thread_id = created["id"].as_str().unwrap().to_string();

    // Modify the thread
    let mut modified_thread = created.clone();
    modified_thread["title"] = json!("Modified Title");

    modify_thread(app.handle().clone(), modified_thread.clone())
        .await
        .unwrap();

    // Verify modification by listing threads
    let threads = list_threads(app.handle().clone()).await.unwrap();
    let found_thread = threads.iter().find(|t| t["id"] == thread_id);
    assert!(found_thread.is_some(), "Modified thread should exist");
    assert_eq!(found_thread.unwrap()["title"], "Modified Title");

    // Delete the thread
    delete_thread(app.handle().clone(), thread_id.clone())
        .await
        .unwrap();

    // Verify deletion
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let thread_dir = data_dir.join(&thread_id);
        assert!(!thread_dir.exists(), "Thread directory should be deleted");
    }

    // Clean up
    let _ = fs::remove_dir_all(data_dir);
}

#[tokio::test]
async fn test_modify_and_delete_message() {
    let (app, data_dir) = mock_app_with_temp_data_dir();

    // Create a thread
    let thread = json!({
        "object": "thread",
        "title": "Message Test Thread",
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
        "role": "user",
        "content": [{"type": "text", "text": "Original content"}],
        "status": "sent",
        "created_at": 123,
        "completed_at": 123,
        "metadata": null
    });

    let created_msg = create_message(app.handle().clone(), message).await.unwrap();
    let message_id = created_msg["id"].as_str().unwrap().to_string();

    // Modify the message
    let mut modified_msg = created_msg.clone();
    modified_msg["content"] = json!([{"type": "text", "text": "Modified content"}]);

    modify_message(app.handle().clone(), modified_msg.clone())
        .await
        .unwrap();

    // Verify modification
    let messages = list_messages(app.handle().clone(), thread_id.clone())
        .await
        .unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["content"][0]["text"], "Modified content");

    // Delete the message
    delete_message(app.handle().clone(), thread_id.clone(), message_id.clone())
        .await
        .unwrap();

    // Verify deletion
    let messages = list_messages(app.handle().clone(), thread_id.clone())
        .await
        .unwrap();
    assert_eq!(messages.len(), 0, "Message should be deleted");

    // Clean up
    let _ = fs::remove_dir_all(data_dir);
}

#[tokio::test]
async fn test_modify_thread_assistant() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let app_handle = app.handle().clone();

    let created = create_thread(
        app_handle.clone(),
        create_test_thread("Assistant Mod Thread"),
    )
    .await
    .unwrap();
    let thread_id = created["id"].as_str().unwrap();

    let assistant = json!({
        "id": "assistant-1",
        "assistant_name": "Original Assistant",
        "model": {"id": "model-1", "name": "Test Model"}
    });

    create_thread_assistant(app_handle.clone(), thread_id.to_string(), assistant.clone())
        .await
        .unwrap();

    let mut modified_assistant = assistant;
    modified_assistant["assistant_name"] = json!("Modified Assistant");

    modify_thread_assistant(
        app_handle.clone(),
        thread_id.to_string(),
        modified_assistant,
    )
    .await
    .unwrap();

    let retrieved = get_thread_assistant(app_handle, thread_id.to_string())
        .await
        .unwrap();
    assert_eq!(retrieved["assistant_name"], "Modified Assistant");

    let _ = fs::remove_dir_all(data_dir);
}

#[tokio::test]
async fn test_thread_not_found_errors() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let app_handle = app.handle().clone();
    let fake_thread_id = "non-existent-thread-id".to_string();
    let assistant = json!({"id": "assistant-1", "assistant_name": "Test Assistant"});

    assert!(
        get_thread_assistant(app_handle.clone(), fake_thread_id.clone())
            .await
            .is_err()
    );
    assert!(create_thread_assistant(
        app_handle.clone(),
        fake_thread_id.clone(),
        assistant.clone()
    )
    .await
    .is_err());
    assert!(
        modify_thread_assistant(app_handle, fake_thread_id, assistant)
            .await
            .is_err()
    );

    let _ = fs::remove_dir_all(data_dir);
}

#[tokio::test]
async fn test_message_without_id_gets_generated() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let app_handle = app.handle().clone();

    let created = create_thread(app_handle.clone(), create_test_thread("Message ID Test"))
        .await
        .unwrap();
    let thread_id = created["id"].as_str().unwrap();

    let message = json!({"object": "message", "thread_id": thread_id, "role": "user", "content": [], "status": "sent"});
    let created_msg = create_message(app_handle, message).await.unwrap();

    assert!(created_msg["id"].as_str().is_some_and(|id| !id.is_empty()));

    let _ = fs::remove_dir_all(data_dir);
}

#[tokio::test]
async fn test_concurrent_message_operations() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let app_handle = app.handle().clone();

    let created = create_thread(app_handle.clone(), create_test_thread("Concurrent Test"))
        .await
        .unwrap();
    let thread_id = created["id"].as_str().unwrap().to_string();

    let handles: Vec<_> = (0..5)
        .map(|i| {
            let app_h = app_handle.clone();
            let tid = thread_id.clone();
            tokio::spawn(async move {
                create_message(app_h, create_test_message(&tid, &format!("Message {i}"))).await
            })
        })
        .collect();

    let results = future::join_all(handles).await;
    assert!(results
        .iter()
        .all(|r| r.is_ok() && r.as_ref().unwrap().is_ok()));

    let messages = list_messages(app_handle, thread_id).await.unwrap();
    assert_eq!(messages.len(), 5);

    let _ = fs::remove_dir_all(data_dir);
}

#[tokio::test]
async fn test_empty_thread_list() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let threads = list_threads(app.handle().clone()).await.unwrap();
    assert_eq!(threads.len(), 0);
    let _ = fs::remove_dir_all(data_dir);
}

#[tokio::test]
async fn test_empty_message_list() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let app_handle = app.handle().clone();

    let created = create_thread(
        app_handle.clone(),
        create_test_thread("Empty Messages Test"),
    )
    .await
    .unwrap();
    let thread_id = created["id"].as_str().unwrap();

    let messages = list_messages(app_handle, thread_id.to_string())
        .await
        .unwrap();
    assert_eq!(messages.len(), 0);

    let _ = fs::remove_dir_all(data_dir);
}
