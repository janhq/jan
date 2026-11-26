use super::commands::*;
use super::constants::{MESSAGES_FILE, THREADS_DIR, THREADS_FILE};
use super::helpers::{
    get_lock_for_thread, read_messages_from_file, should_use_sqlite, update_thread_metadata,
    write_messages_to_file,
};
use super::utils::{
    ensure_data_dirs, ensure_thread_dir_exists, get_data_dir, get_messages_path, get_thread_dir,
    get_thread_metadata_path, validate_thread_id, DELETING_PREFIX, PERMANENT_PREFIX,
};
use crate::core::app::commands::get_jan_data_folder_path;
use futures_util::future;
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use tauri::test::{mock_app, MockRuntime};

// RAII guard that removes the test data dir on drop (panic-safe cleanup).
struct DataDirGuard(PathBuf);
impl Drop for DataDirGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
impl std::ops::Deref for DataDirGuard {
    type Target = PathBuf;
    fn deref(&self) -> &PathBuf {
        &self.0
    }
}

// Helper to create a mock app handle with a temp data dir.
// The returned guard removes the directory when dropped, so the test is
// panic-safe and will not leak `test-data-*` directories into the workspace.
fn mock_app_with_temp_data_dir() -> (tauri::App<MockRuntime>, DataDirGuard) {
    let app = mock_app();
    // Get the actual data dir that will be used by storage code
    let data_dir = get_jan_data_folder_path(app.handle().clone());
    println!("Mock app data dir: {}", data_dir.display());
    (app, DataDirGuard(data_dir))
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
    let (app, _data_dir) = mock_app_with_temp_data_dir();
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
}

#[tokio::test]
async fn test_create_and_list_messages() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
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
}

#[tokio::test]
async fn test_create_and_get_thread_assistant() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
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
}

#[tokio::test]
async fn test_modify_and_delete_message() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();

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
}

#[tokio::test]
async fn test_modify_thread_assistant() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
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
}

#[tokio::test]
async fn test_thread_not_found_errors() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
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
}

#[tokio::test]
async fn test_message_without_id_gets_generated() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let app_handle = app.handle().clone();

    let created = create_thread(app_handle.clone(), create_test_thread("Message ID Test"))
        .await
        .unwrap();
    let thread_id = created["id"].as_str().unwrap();

    let message = json!({"object": "message", "thread_id": thread_id, "role": "user", "content": [], "status": "sent"});
    let created_msg = create_message(app_handle, message).await.unwrap();

    assert!(created_msg["id"].as_str().is_some_and(|id| !id.is_empty()));
}

#[tokio::test]
async fn test_concurrent_message_operations() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
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
}

#[tokio::test]
async fn test_empty_thread_list() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let threads = list_threads(app.handle().clone()).await.unwrap();
    assert_eq!(threads.len(), 0);
}

#[tokio::test]
async fn test_empty_message_list() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
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
}

// ---------- constants.rs ----------

#[test]
fn test_constants_values() {
    assert_eq!(THREADS_DIR, "threads");
    assert_eq!(THREADS_FILE, "thread.json");
    assert_eq!(MESSAGES_FILE, "messages.jsonl");
}

// ---------- utils.rs ----------

#[test]
fn test_get_data_dir_appends_threads_subdir() {
    let base = PathBuf::from("/tmp/jandata");
    assert_eq!(get_data_dir(&base), base.join("threads"));
}

#[test]
fn test_get_thread_dir_includes_thread_id() {
    let base = PathBuf::from("/tmp/jandata");
    let dir = get_thread_dir(&base, "abc-123").unwrap();
    assert_eq!(dir, base.join("threads").join("abc-123"));
}

#[test]
fn test_get_thread_metadata_path_layout() {
    let base = PathBuf::from("/tmp/jandata");
    let path = get_thread_metadata_path(&base, "tid").unwrap();
    assert!(path.ends_with("threads/tid/thread.json"));
}

#[test]
fn test_get_messages_path_layout() {
    let base = PathBuf::from("/tmp/jandata");
    let path = get_messages_path(&base, "tid").unwrap();
    assert!(path.ends_with("threads/tid/messages.jsonl"));
}

#[test]
fn test_ensure_data_dirs_creates_directory() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path();
    let target = get_data_dir(base);
    assert!(!target.exists());
    ensure_data_dirs(base).unwrap();
    assert!(target.exists() && target.is_dir());
    // Idempotent
    ensure_data_dirs(base).unwrap();
    assert!(target.exists());
}

#[test]
fn test_ensure_thread_dir_exists_creates_nested_dirs() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path();
    ensure_thread_dir_exists(base, "thread-xyz").unwrap();
    let dir = get_thread_dir(base, "thread-xyz").unwrap();
    assert!(dir.exists() && dir.is_dir());
    // Idempotent on second call
    ensure_thread_dir_exists(base, "thread-xyz").unwrap();
    assert!(dir.exists());
}

// ---------- helpers.rs ----------

#[test]
fn test_should_use_sqlite_matches_target_cfg() {
    let expected = cfg!(any(target_os = "android", target_os = "ios"));
    assert_eq!(should_use_sqlite(), expected);
}

#[test]
fn test_write_and_read_messages_round_trip() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path();
    ensure_thread_dir_exists(base, "trip").unwrap();
    let path = get_messages_path(base, "trip").unwrap();

    let msgs = vec![
        json!({"id": "m1", "role": "user", "content": "hello"}),
        json!({"id": "m2", "role": "assistant", "content": "hi"}),
    ];
    write_messages_to_file(&msgs, &path).unwrap();
    assert!(path.exists());

    let read = read_messages_from_file(base, "trip").unwrap();
    assert_eq!(read.len(), 2);
    assert_eq!(read[0]["id"], "m1");
    assert_eq!(read[1]["role"], "assistant");
}

#[test]
fn test_read_messages_missing_file_returns_empty() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path();
    let read = read_messages_from_file(base, "no-such-thread").unwrap();
    assert!(read.is_empty());
}

#[test]
fn test_write_messages_empty_creates_empty_file() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path();
    ensure_thread_dir_exists(base, "empty").unwrap();
    let path = get_messages_path(base, "empty").unwrap();
    write_messages_to_file(&[], &path).unwrap();
    assert!(path.exists());
    let contents = fs::read_to_string(&path).unwrap();
    assert!(contents.is_empty());
}

#[test]
fn test_write_messages_overwrites_existing() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path();
    ensure_thread_dir_exists(base, "ow").unwrap();
    let path = get_messages_path(base, "ow").unwrap();

    write_messages_to_file(&[json!({"id": "first"})], &path).unwrap();
    write_messages_to_file(&[json!({"id": "second"})], &path).unwrap();

    let read = read_messages_from_file(base, "ow").unwrap();
    assert_eq!(read.len(), 1);
    assert_eq!(read[0]["id"], "second");
}

#[test]
fn test_write_messages_jsonl_format_one_per_line() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path();
    ensure_thread_dir_exists(base, "lines").unwrap();
    let path = get_messages_path(base, "lines").unwrap();

    let msgs = vec![json!({"id": "a"}), json!({"id": "b"}), json!({"id": "c"})];
    write_messages_to_file(&msgs, &path).unwrap();

    let contents = fs::read_to_string(&path).unwrap();
    let lines: Vec<&str> = contents.lines().collect();
    assert_eq!(lines.len(), 3);
    for line in &lines {
        let _: serde_json::Value = serde_json::from_str(line).unwrap();
    }
}

#[test]
fn test_read_messages_invalid_json_errors() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path();
    ensure_thread_dir_exists(base, "bad").unwrap();
    let path = get_messages_path(base, "bad").unwrap();
    fs::write(&path, "this is not json\n").unwrap();
    assert!(read_messages_from_file(base, "bad").is_err());
}

#[test]
fn test_update_thread_metadata_writes_pretty_json() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path();
    ensure_thread_dir_exists(base, "meta").unwrap();

    let thread = json!({"id": "meta", "title": "Hello", "assistants": []});
    update_thread_metadata(base, "meta", &thread).unwrap();

    let path = get_thread_metadata_path(base, "meta").unwrap();
    assert!(path.exists());
    let contents = fs::read_to_string(&path).unwrap();
    // Pretty-printed JSON contains newlines
    assert!(contents.contains('\n'));
    let parsed: serde_json::Value = serde_json::from_str(&contents).unwrap();
    assert_eq!(parsed["title"], "Hello");
    assert_eq!(parsed["id"], "meta");
}

#[test]
fn test_update_thread_metadata_overwrites() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path();
    ensure_thread_dir_exists(base, "ovr").unwrap();

    update_thread_metadata(base, "ovr", &json!({"title": "v1"})).unwrap();
    update_thread_metadata(base, "ovr", &json!({"title": "v2"})).unwrap();

    let contents = fs::read_to_string(get_thread_metadata_path(base, "ovr").unwrap()).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&contents).unwrap();
    assert_eq!(parsed["title"], "v2");
}

#[tokio::test]
async fn test_get_lock_for_thread_same_id_returns_same_lock() {
    let l1 = get_lock_for_thread("lock-thread-a").await;
    let l2 = get_lock_for_thread("lock-thread-a").await;
    assert!(std::sync::Arc::ptr_eq(&l1, &l2));
}

#[tokio::test]
async fn test_get_lock_for_thread_distinct_ids_distinct_locks() {
    let l1 = get_lock_for_thread("lock-thread-x").await;
    let l2 = get_lock_for_thread("lock-thread-y").await;
    assert!(!std::sync::Arc::ptr_eq(&l1, &l2));
}

#[tokio::test]
async fn test_get_lock_for_thread_provides_mutual_exclusion() {
    let lock = get_lock_for_thread("mutex-test").await;
    let _g = lock.lock().await;
    // try_lock on the same Arc should fail while we hold it
    let lock2 = get_lock_for_thread("mutex-test").await;
    assert!(lock2.try_lock().is_err());
}

// ---------- thread id validation ----------

#[test]
fn test_validate_thread_id_accepts_real_ids() {
    for id in [
        "784952d3-dc72-474e-ab24-0d78e7035280", // backend UUID
        "01JABCDEFGHJKMNPQRSTVWXYZ0",           // web-app ULID
        "temporary-chat",
        "jan_1712345678",
        "CONSOLE",
        "COM10",
        "nul_thread",
    ] {
        assert!(validate_thread_id(id).is_ok(), "{id} should be accepted");
    }
}

#[test]
fn test_validate_thread_id_rejects_path_like_ids() {
    for id in [
        "",
        ".",
        "..",
        "../x",
        "a/../../x",
        "/abs",
        "..\\x",
        "a\\b",
        "C:\\x",
        "C:x",
        "x\0y",
        "with space",
        "dot.ted",
        "CON",
        "nul",
        "Aux",
        "prn",
        "COM1",
        "com9",
        "LPT1",
        "lpt9",
    ] {
        assert!(validate_thread_id(id).is_err(), "{id:?} should be rejected");
        assert!(get_thread_dir(std::path::Path::new("/tmp/jandata"), id).is_err());
    }
    assert!(validate_thread_id(&"a".repeat(129)).is_err());
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
#[tokio::test]
async fn test_thread_commands_refuse_ids_outside_threads_dir() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let victim = data_dir.join("victim");
    fs::create_dir_all(&victim).unwrap();
    fs::write(victim.join("keep.txt"), "x").unwrap();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("keep.txt"), "x").unwrap();
    let abs = outside.path().to_string_lossy().to_string();

    for id in ["../victim".to_string(), "..\\victim".to_string(), abs.clone()] {
        assert!(delete_thread(app.handle().clone(), id.clone()).await.is_err());
        assert!(list_messages(app.handle().clone(), id.clone()).await.is_err());
        assert!(get_thread_assistant(app.handle().clone(), id.clone())
            .await
            .is_err());
        assert!(
            create_thread_assistant(app.handle().clone(), id.clone(), json!({"id": "a"}))
                .await
                .is_err()
        );
        assert!(
            modify_thread_assistant(app.handle().clone(), id.clone(), json!({"id": "a"}))
                .await
                .is_err()
        );
        assert!(
            delete_message(app.handle().clone(), id.clone(), "m".to_string())
                .await
                .is_err()
        );
        assert!(
            modify_thread(app.handle().clone(), json!({"id": id, "title": "t"}))
                .await
                .is_err()
        );
        assert!(create_message(app.handle().clone(), create_test_message(&id, "hi"))
            .await
            .is_err());
        assert!(modify_message(
            app.handle().clone(),
            json!({"id": "m", "thread_id": id, "role": "user"})
        )
        .await
        .is_err());
    }

    assert!(victim.join("keep.txt").exists());
    assert!(!victim.join("messages.jsonl").exists());
    assert!(!victim.join("thread.json").exists());
    assert!(outside.path().join("keep.txt").exists());
    assert!(!outside.path().join("messages.jsonl").exists());
    assert!(!outside.path().join("thread.json").exists());
}

#[tokio::test]
async fn test_modify_thread_missing_thread_uses_stable_error_code() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let err = modify_thread(app.handle().clone(), json!({"id": "ghost-modify"}))
        .await
        .unwrap_err();
    assert!(err.starts_with("thread_missing:"), "{err}");

    // A bare directory without thread.json is also "missing", and must not be
    // turned into a thread by a modify.
    let data_folder = get_jan_data_folder_path(app.handle().clone());
    ensure_thread_dir_exists(&data_folder, "ghost-modify-dir").unwrap();
    let err = modify_thread(app.handle().clone(), json!({"id": "ghost-modify-dir"}))
        .await
        .unwrap_err();
    assert!(err.starts_with("thread_missing:"), "{err}");
    assert!(!get_thread_metadata_path(&data_folder, "ghost-modify-dir")
        .unwrap()
        .exists());
}

#[tokio::test]
async fn test_write_thread_extra_and_messages_missing_thread_use_stable_error_code() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let err = write_thread_extra(
        app.handle().clone(),
        "ghost-extra".into(),
        "cowork".into(),
        json!({}),
        None,
    )
    .await
    .unwrap_err();
    assert!(err.starts_with("thread_missing:"), "{err}");
    let err = replace_thread_messages(app.handle().clone(), "ghost-extra".into(), vec![], None)
        .await
        .unwrap_err();
    assert!(err.starts_with("thread_missing:"), "{err}");
    let data_folder = get_jan_data_folder_path(app.handle().clone());
    assert!(!get_thread_dir(&data_folder, "ghost-extra").unwrap().exists());
}

#[tokio::test]
async fn test_thread_json_writes_leave_no_temp_files() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let mut thread = create_test_thread("Atomic");
    thread["id"] = json!("atomic-thread");
    create_thread(app.handle().clone(), thread.clone())
        .await
        .unwrap();
    thread["title"] = json!("Atomic 2");
    modify_thread(app.handle().clone(), thread).await.unwrap();

    let data_folder = get_jan_data_folder_path(app.handle().clone());
    let dir = get_thread_dir(&data_folder, "atomic-thread").unwrap();
    let names: Vec<String> = fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert!(names.iter().all(|n| !n.ends_with(".tmp")), "{names:?}");
    let on_disk: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(dir.join(THREADS_FILE)).unwrap()).unwrap();
    assert_eq!(on_disk["title"], "Atomic 2");
}

#[tokio::test]
async fn test_modify_thread_waits_for_the_thread_lock() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let mut thread = create_test_thread("Locked");
    thread["id"] = json!("locked-modify");
    create_thread(app.handle().clone(), thread.clone())
        .await
        .unwrap();

    let lock = get_lock_for_thread("locked-modify").await;
    let guard = lock.lock().await;
    thread["title"] = json!("Locked 2");
    let handle = app.handle().clone();
    let pending = tokio::spawn(async move { modify_thread(handle, thread).await });
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert!(!pending.is_finished(), "modify_thread must take the thread lock");
    drop(guard);
    pending.await.unwrap().unwrap();
}

#[tokio::test]
async fn test_delete_thread_waits_for_the_thread_lock() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let mut thread = create_test_thread("Locked delete");
    thread["id"] = json!("locked-delete");
    create_thread(app.handle().clone(), thread).await.unwrap();

    let lock = get_lock_for_thread("locked-delete").await;
    let guard = lock.lock().await;
    let handle = app.handle().clone();
    let pending = tokio::spawn(async move { delete_thread(handle, "locked-delete".into()).await });
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    assert!(!pending.is_finished(), "delete_thread must take the thread lock");
    drop(guard);
    pending.await.unwrap().unwrap();
}

#[tokio::test]
async fn test_create_thread_honours_valid_supplied_id() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let mut thread = create_test_thread("Supplied id");
    thread["id"] = json!("0b6f1c1e-5a0e-4a53-9c1e-7f7d2a3b4c5d");
    let created = create_thread(app.handle().clone(), thread).await.unwrap();
    assert_eq!(created["id"], "0b6f1c1e-5a0e-4a53-9c1e-7f7d2a3b4c5d");

    let data_folder = get_jan_data_folder_path(app.handle().clone());
    assert!(
        get_thread_metadata_path(&data_folder, "0b6f1c1e-5a0e-4a53-9c1e-7f7d2a3b4c5d")
            .unwrap()
            .is_file()
    );
}

#[tokio::test]
async fn test_create_thread_keeps_ulid_ids_from_the_web_app() {
    // The web app mints ULIDs; they are valid thread ids and must round-trip.
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let mut thread = create_test_thread("Ulid");
    thread["id"] = json!("01HZX3Y9K2M4N6P8Q0R2S4T6V8");
    let created = create_thread(app.handle().clone(), thread).await.unwrap();
    assert_eq!(created["id"], "01HZX3Y9K2M4N6P8Q0R2S4T6V8");
}

#[tokio::test]
async fn test_create_thread_refuses_an_invalid_id_and_mints_one_when_missing() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let mut bad = create_test_thread("Bad id");
    bad["id"] = json!("../escape");
    let err = create_thread(app.handle().clone(), bad).await.unwrap_err();
    assert!(err.starts_with(PERMANENT_PREFIX), "{err}");
    assert!(!data_dir.join("escape").exists());

    let created = create_thread(app.handle().clone(), create_test_thread("No id"))
        .await
        .unwrap();
    assert!(validate_thread_id(created["id"].as_str().unwrap()).is_ok());

    let mut empty = create_test_thread("Empty id");
    empty["id"] = json!("");
    let created = create_thread(app.handle().clone(), empty).await.unwrap();
    assert!(validate_thread_id(created["id"].as_str().unwrap()).is_ok());
}

#[cfg(unix)]
#[tokio::test]
async fn test_delete_thread_failing_to_move_keeps_every_file() {
    use std::os::unix::fs::PermissionsExt;
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let mut thread = create_test_thread("Locked");
    thread["id"] = json!("locked-thread");
    create_thread(app.handle().clone(), thread).await.unwrap();
    let threads = data_dir.join(THREADS_DIR);
    let dir = threads.join("locked-thread");
    std::fs::write(dir.join("cowork.json"), "{}").unwrap();
    // Renaming an entry of a read-only directory fails, like a file held open
    // on Windows.
    std::fs::set_permissions(&threads, std::fs::Permissions::from_mode(0o500)).unwrap();
    let result = delete_thread(app.handle().clone(), "locked-thread".to_string()).await;
    std::fs::set_permissions(&threads, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(result.is_err(), "{result:?}");
    for file in [THREADS_FILE, "cowork.json"] {
        assert!(dir.join(file).exists(), "{file} survives a failed delete");
    }
}

#[cfg(unix)]
#[tokio::test]
async fn test_delete_thread_with_an_undeletable_file_still_removes_the_thread() {
    use std::os::unix::fs::PermissionsExt;
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let mut thread = create_test_thread("Stuck");
    thread["id"] = json!("stuck-thread");
    create_thread(app.handle().clone(), thread).await.unwrap();
    let threads = data_dir.join(THREADS_DIR);
    let inner = threads.join("stuck-thread").join("inner");
    std::fs::create_dir_all(&inner).unwrap();
    std::fs::write(inner.join("file"), "x").unwrap();
    // Removing entries of a read-only directory fails.
    std::fs::set_permissions(&inner, std::fs::Permissions::from_mode(0o500)).unwrap();

    delete_thread(app.handle().clone(), "stuck-thread".to_string())
        .await
        .unwrap();
    let leftovers = || {
        std::fs::read_dir(&threads)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.file_name().unwrap().to_str().unwrap().starts_with(DELETING_PREFIX))
            .collect::<Vec<_>>()
    };
    let stuck = leftovers();
    assert_eq!(stuck.len(), 1);
    assert!(!threads.join("stuck-thread").exists());
    let listed = list_threads(app.handle().clone()).await.unwrap();
    assert!(listed.iter().all(|t| t["id"] != "stuck-thread"));

    // Once the file can be removed, the next listing finishes the delete.
    std::fs::set_permissions(stuck[0].join("inner"), std::fs::Permissions::from_mode(0o700))
        .unwrap();
    list_threads(app.handle().clone()).await.unwrap();
    assert!(leftovers().is_empty());

    // A thread that is already gone is not an error.
    delete_thread(app.handle().clone(), "stuck-thread".to_string())
        .await
        .unwrap();
}

#[tokio::test]
async fn test_create_thread_with_existing_id_is_idempotent() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let mut first = create_test_thread("Original");
    first["id"] = json!("idem-thread-1");
    create_thread(app.handle().clone(), first).await.unwrap();

    let mut second = create_test_thread("Overwrite attempt");
    second["id"] = json!("idem-thread-1");
    let again = create_thread(app.handle().clone(), second).await.unwrap();
    assert_eq!(again["title"], "Original");

    let threads = list_threads(app.handle().clone()).await.unwrap();
    let stored = threads.iter().find(|t| t["id"] == "idem-thread-1").unwrap();
    assert_eq!(stored["title"], "Original");
}

#[tokio::test]
async fn test_concurrent_create_thread_with_same_id_keeps_the_first_record() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let creates = (0..8).map(|n| {
        let mut thread = create_test_thread(&format!("Racer {n}"));
        thread["id"] = json!("race-thread-1");
        create_thread(app.handle().clone(), thread)
    });
    let results = future::join_all(creates).await;
    let titles: std::collections::HashSet<String> = results
        .into_iter()
        .map(|r| r.unwrap()["title"].as_str().unwrap().to_string())
        .collect();
    // Every caller sees the one record that won; none sees its own overwrite.
    assert_eq!(titles.len(), 1, "{titles:?}");

    let data_folder = get_jan_data_folder_path(app.handle().clone());
    let path = get_thread_metadata_path(&data_folder, "race-thread-1").unwrap();
    let on_disk: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(
        on_disk["title"].as_str().unwrap(),
        titles.into_iter().next().unwrap()
    );
}

#[tokio::test]
async fn test_thread_extra_roundtrip_and_allowlist() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let mut thread = create_test_thread("Extra");
    thread["id"] = json!("extra-thread-1");
    create_thread(app.handle().clone(), thread).await.unwrap();

    let absent = read_thread_extra(
        app.handle().clone(),
        "extra-thread-1".into(),
        "cowork".into(),
    )
    .await
    .unwrap();
    assert!(absent.is_none());

    let value = json!({"turns": [{"role": "user", "content": "hi"}], "messages": [], "n": 1.5});
    write_thread_extra(
        app.handle().clone(),
        "extra-thread-1".into(),
        "cowork".into(),
        value.clone(),
        None,
    )
    .await
    .unwrap();
    let back = read_thread_extra(
        app.handle().clone(),
        "extra-thread-1".into(),
        "cowork".into(),
    )
    .await
    .unwrap();
    assert_eq!(back, Some(value));

    // A name outside the allowlist, or an id that escapes the threads dir, is refused.
    assert!(write_thread_extra(
        app.handle().clone(),
        "extra-thread-1".into(),
        "thread".into(),
        json!({}),
        None,
    )
    .await
    .is_err());
    assert!(
        read_thread_extra(app.handle().clone(), "../x".into(), "cowork".into())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn test_write_thread_extra_creates_the_directory_only_on_request() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let data_folder = get_jan_data_folder_path(app.handle().clone());

    // Without thread.json a late write (for example after a delete) must not
    // resurrect a directory holding a lone sidecar.
    let err = write_thread_extra(
        app.handle().clone(),
        "ghost-thread".into(),
        "cowork".into(),
        json!({"turns": []}),
        None,
    )
    .await
    .unwrap_err();
    assert!(err.contains("thread.json"), "{err}");
    assert!(!get_thread_dir(&data_folder, "ghost-thread").unwrap().exists());

    // The migration opts in: the sidecar lands first, thread.json is the commit marker.
    write_thread_extra(
        app.handle().clone(),
        "ghost-thread".into(),
        "cowork".into(),
        json!({"turns": []}),
        Some(true),
    )
    .await
    .unwrap();
    assert!(get_thread_dir(&data_folder, "ghost-thread").unwrap().exists());

    // A directory holding only the sidecar is not a thread yet.
    let listed = list_threads(app.handle().clone()).await.unwrap();
    assert!(listed.iter().all(|t| t["id"] != "ghost-thread"));
}

#[tokio::test]
async fn test_deleted_thread_cannot_be_resurrected_by_sidecar_write() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let mut thread = create_test_thread("Doomed");
    thread["id"] = json!("doomed-thread");
    create_thread(app.handle().clone(), thread).await.unwrap();
    write_thread_extra(
        app.handle().clone(),
        "doomed-thread".into(),
        "cowork".into(),
        json!({"turns": []}),
        None,
    )
    .await
    .unwrap();
    delete_thread(app.handle().clone(), "doomed-thread".into())
        .await
        .unwrap();

    assert!(write_thread_extra(
        app.handle().clone(),
        "doomed-thread".into(),
        "cowork".into(),
        json!({}),
        None,
    )
    .await
    .is_err());
    assert!(read_thread_extra(
        app.handle().clone(),
        "doomed-thread".into(),
        "cowork".into(),
    )
    .await
    .unwrap()
    .is_none());
}

#[tokio::test]
async fn test_create_thread_write_leaves_no_temp_files() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let mut thread = create_test_thread("Atomic");
    thread["id"] = json!("atomic-thread");
    create_thread(app.handle().clone(), thread).await.unwrap();

    let data_folder = get_jan_data_folder_path(app.handle().clone());
    let dir = get_thread_dir(&data_folder, "atomic-thread").unwrap();
    let names: Vec<String> = fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, vec![THREADS_FILE.to_string()]);
}

fn migrated_message(thread_id: &str, id: &str, text: &str) -> serde_json::Value {
    json!({
        "id": id,
        "object": "thread.message",
        "thread_id": thread_id,
        "role": "user",
        "content": [{"type": "text", "text": {"value": text, "annotations": []}}],
        "status": "ready",
        "created_at": 1,
        "completed_at": 1
    })
}

#[tokio::test]
async fn test_replace_thread_messages_replaces_instead_of_appending() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let data_folder = get_jan_data_folder_path(app.handle().clone());
    let batch = vec![
        migrated_message("replace-thread", "replace-thread-msg-0", "one"),
        migrated_message("replace-thread", "replace-thread-msg-1", "two"),
    ];

    // The migration writes the sidecar first, so a retry always finds it; that
    // marks a later uncommitted log as the migration's own.
    write_thread_extra(
        app.handle().clone(),
        "replace-thread".into(),
        "cowork".into(),
        json!({"turns": []}),
        Some(true),
    )
    .await
    .unwrap();

    // The migration writes before thread.json exists, so it must be allowed to
    // create the directory.
    replace_thread_messages(
        app.handle().clone(),
        "replace-thread".into(),
        batch.clone(),
        Some(true),
    )
    .await
    .unwrap();
    let path = get_messages_path(&data_folder, "replace-thread").unwrap();
    let first = fs::read(&path).unwrap();

    // A retry after a crash writes the same batch again: same bytes, no duplicates.
    replace_thread_messages(
        app.handle().clone(),
        "replace-thread".into(),
        batch.clone(),
        Some(true),
    )
    .await
    .unwrap();
    assert_eq!(fs::read(&path).unwrap(), first);
    let listed = list_messages(app.handle().clone(), "replace-thread".into())
        .await
        .unwrap();
    assert_eq!(listed, batch);

    // A shorter batch replaces the file whole.
    replace_thread_messages(
        app.handle().clone(),
        "replace-thread".into(),
        batch[..1].to_vec(),
        Some(true),
    )
    .await
    .unwrap();
    let listed = list_messages(app.handle().clone(), "replace-thread".into())
        .await
        .unwrap();
    assert_eq!(listed, batch[..1].to_vec());

    // No temp file is left beside it, and the thread is still uncommitted.
    let names: Vec<String> = fs::read_dir(path.parent().unwrap())
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names.len(), 2, "{names:?}");
    assert!(names.contains(&MESSAGES_FILE.to_string()));
    assert!(names.contains(&"cowork.json".to_string()));
    let threads = list_threads(app.handle().clone()).await.unwrap();
    assert!(threads.iter().all(|t| t["id"] != "replace-thread"));
}

#[tokio::test]
async fn test_replace_thread_messages_creates_the_directory_only_on_request() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let data_folder = get_jan_data_folder_path(app.handle().clone());
    let batch = vec![migrated_message("late-thread", "late-thread-msg-0", "x")];

    // Without thread.json a late write (for example after a delete) must not
    // resurrect a thread directory.
    let err = replace_thread_messages(
        app.handle().clone(),
        "late-thread".into(),
        batch.clone(),
        None,
    )
    .await
    .unwrap_err();
    assert!(err.contains("thread.json"), "{err}");
    assert!(!get_thread_dir(&data_folder, "late-thread").unwrap().exists());

    // Once the thread is committed a plain replace is allowed.
    let mut thread = create_test_thread("Late");
    thread["id"] = json!("late-thread");
    create_thread(app.handle().clone(), thread).await.unwrap();
    replace_thread_messages(app.handle().clone(), "late-thread".into(), batch.clone(), None)
        .await
        .unwrap();
    let listed = list_messages(app.handle().clone(), "late-thread".into())
        .await
        .unwrap();
    assert_eq!(listed, batch);
}

#[tokio::test]
async fn test_replace_thread_messages_rejects_a_batch_that_would_corrupt_the_log() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let ok = migrated_message("guard-thread", "guard-thread-msg-0", "x");

    // A message for another thread, a missing id and a repeated id would each
    // break the per-thread log create_message and modify_message maintain.
    let foreign = migrated_message("other-thread", "other-msg-0", "x");
    let mut anonymous = ok.clone();
    anonymous.as_object_mut().unwrap().remove("id");
    for bad in [
        vec![ok.clone(), foreign],
        vec![ok.clone(), anonymous],
        vec![ok.clone(), ok.clone()],
    ] {
        assert!(replace_thread_messages(
            app.handle().clone(),
            "guard-thread".into(),
            bad,
            Some(true),
        )
        .await
        .is_err());
    }
    // Nothing was written for a refused batch.
    let listed = list_messages(app.handle().clone(), "guard-thread".into())
        .await
        .unwrap();
    assert!(listed.is_empty());
}

/// Doubles whose shortest decimal text serde_json parses one ULP off unless
/// `float_roundtrip` is on. A deterministic spread of arithmetic results plus
/// the classic 0.1 + 0.2.
fn awkward_doubles() -> Vec<f64> {
    let mut out = vec![0.1 + 0.2];
    let mut x: u64 = 0x9E37_79B9_7F4A_7C15;
    for _ in 0..4000 {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        out.push((x >> 11) as f64 / (1u64 << 53) as f64 * 1e3);
    }
    out
}

#[test]
fn test_serde_json_parses_floats_back_to_the_same_double() {
    for n in awkward_doubles() {
        let text = serde_json::to_string(&n).unwrap();
        let back: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(back.as_f64().unwrap().to_bits(), n.to_bits(), "{text}");
    }
}

#[tokio::test]
async fn test_thread_extra_and_messages_roundtrip_non_representable_doubles() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let doubles = awkward_doubles();

    // Through the command boundary the value arrives as parsed JSON text.
    let text = serde_json::to_string(&json!({ "usage": doubles })).unwrap();
    let value: serde_json::Value = serde_json::from_str(&text).unwrap();
    write_thread_extra(
        app.handle().clone(),
        "float-thread".into(),
        "cowork".into(),
        value.clone(),
        Some(true),
    )
    .await
    .unwrap();
    let back = read_thread_extra(
        app.handle().clone(),
        "float-thread".into(),
        "cowork".into(),
    )
    .await
    .unwrap()
    .unwrap();
    for (got, want) in back["usage"].as_array().unwrap().iter().zip(&doubles) {
        assert_eq!(got.as_f64().unwrap().to_bits(), want.to_bits());
    }

    let mut message = migrated_message("float-thread", "float-thread-msg-0", "x");
    message["metadata"] = json!({ "usage": doubles });
    let message: serde_json::Value =
        serde_json::from_str(&serde_json::to_string(&message).unwrap()).unwrap();
    replace_thread_messages(
        app.handle().clone(),
        "float-thread".into(),
        vec![message],
        Some(true),
    )
    .await
    .unwrap();
    let listed = list_messages(app.handle().clone(), "float-thread".into())
        .await
        .unwrap();
    for (got, want) in listed[0]["metadata"]["usage"]
        .as_array()
        .unwrap()
        .iter()
        .zip(&doubles)
    {
        assert_eq!(got.as_f64().unwrap().to_bits(), want.to_bits());
    }
}

fn thread_dir_of(app: &tauri::App<MockRuntime>, id: &str) -> PathBuf {
    let data_folder = get_jan_data_folder_path(app.handle().clone());
    get_thread_dir(&data_folder, id).unwrap()
}

#[tokio::test]
async fn test_replace_thread_messages_create_refuses_a_foreign_log_without_thread_json() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    // A chat message landed first (create_message makes the directory) but its
    // thread.json is not there: a migration must not overwrite that log.
    create_message(
        app.handle().clone(),
        create_test_message("clash-thread", "keep me"),
    )
    .await
    .unwrap();
    let path = get_messages_path(
        &get_jan_data_folder_path(app.handle().clone()),
        "clash-thread",
    )
    .unwrap();
    let before = fs::read(&path).unwrap();

    let batch = vec![migrated_message("clash-thread", "clash-thread-msg-0", "x")];
    let err = replace_thread_messages(
        app.handle().clone(),
        "clash-thread".into(),
        batch,
        Some(true),
    )
    .await
    .unwrap_err();
    assert!(err.contains("messages"), "{err}");
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[tokio::test]
async fn test_replace_thread_messages_create_allows_the_migrations_own_retry() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let batch = vec![migrated_message("retry-thread", "retry-thread-msg-0", "x")];
    // First run crashed before thread.json: the log holds exactly this batch.
    replace_thread_messages(
        app.handle().clone(),
        "retry-thread".into(),
        batch.clone(),
        Some(true),
    )
    .await
    .unwrap();
    // The retry writes the same bytes again and is allowed.
    replace_thread_messages(
        app.handle().clone(),
        "retry-thread".into(),
        batch.clone(),
        Some(true),
    )
    .await
    .unwrap();
    // A different batch over that uncommitted log is not the same run.
    let other = vec![migrated_message("retry-thread", "retry-thread-msg-0", "y")];
    assert!(replace_thread_messages(
        app.handle().clone(),
        "retry-thread".into(),
        other,
        Some(true),
    )
    .await
    .is_err());
    // An empty leftover log is not anyone's data.
    let empty = thread_dir_of(&app, "empty-thread");
    fs::create_dir_all(&empty).unwrap();
    fs::write(empty.join(MESSAGES_FILE), "").unwrap();
    replace_thread_messages(
        app.handle().clone(),
        "empty-thread".into(),
        vec![migrated_message("empty-thread", "empty-thread-msg-0", "x")],
        Some(true),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn test_write_thread_extra_create_refuses_a_foreign_log_without_thread_json() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    create_message(
        app.handle().clone(),
        create_test_message("extra-clash", "keep me"),
    )
    .await
    .unwrap();
    let dir = thread_dir_of(&app, "extra-clash");

    let err = write_thread_extra(
        app.handle().clone(),
        "extra-clash".into(),
        "cowork".into(),
        json!({"turns": []}),
        Some(true),
    )
    .await
    .unwrap_err();
    assert!(err.contains("messages"), "{err}");
    assert!(!dir.join("cowork.json").exists());

    // Once the migration's own sidecar is there, the retry after a crash that
    // came after the messages write is allowed to rewrite it.
    fs::write(dir.join("cowork.json"), "{}").unwrap();
    write_thread_extra(
        app.handle().clone(),
        "extra-clash".into(),
        "cowork".into(),
        json!({"turns": []}),
        Some(true),
    )
    .await
    .unwrap();
}

/// Refusals that retrying can never fix carry the stable `PERMANENT: ` prefix,
/// so the Cowork migration classifies them by code, not by message text.
#[tokio::test]
async fn test_permanent_refusals_carry_the_stable_prefix() {
    use super::utils::PERMANENT_PREFIX;
    assert_eq!(PERMANENT_PREFIX, "PERMANENT: ");
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let handle = || app.handle().clone();

    // Invalid id, through the validator and through a command.
    assert!(validate_thread_id("a/b").unwrap_err().starts_with(PERMANENT_PREFIX));
    assert!(validate_thread_id("").unwrap_err().starts_with(PERMANENT_PREFIX));
    let err = write_thread_extra(handle(), "../x".into(), "cowork".into(), json!({}), Some(true))
        .await
        .unwrap_err();
    assert!(err.starts_with(PERMANENT_PREFIX), "{err}");

    // An unknown sidecar name.
    let err = read_thread_extra(handle(), "ok-id".into(), "other".into())
        .await
        .unwrap_err();
    assert!(err.starts_with(PERMANENT_PREFIX), "{err}");

    // A directory holding someone's messages with no thread.json.
    create_thread(handle(), json!({"id": "other-thread", "title": "t"}))
        .await
        .unwrap();
    create_message(handle(), create_test_message("clash-code", "keep me"))
        .await
        .unwrap();
    let batch = vec![migrated_message("clash-code", "clash-code-msg-0", "x")];
    let err = replace_thread_messages(handle(), "clash-code".into(), batch, Some(true))
        .await
        .unwrap_err();
    assert!(err.starts_with(PERMANENT_PREFIX), "{err}");

    // A batch that can never be valid.
    let bad = vec![migrated_message("someone-else", "m-0", "x")];
    let err = replace_thread_messages(handle(), "mine".into(), bad, Some(true))
        .await
        .unwrap_err();
    assert!(err.starts_with(PERMANENT_PREFIX), "{err}");

    // An I/O style failure is not permanent: a write to a missing thread
    // without `create` stays a plain message (retry after the thread exists).
    let err = write_thread_extra(handle(), "ghost-2".into(), "cowork".into(), json!({}), None)
        .await
        .unwrap_err();
    assert!(!err.starts_with(PERMANENT_PREFIX), "{err}");
}
