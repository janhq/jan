use super::commands::*;
use super::constants::{MESSAGES_FILE, THREADS_DIR, THREADS_FILE};
use super::helpers::{
    get_lock_for_thread, read_messages_from_file, should_use_sqlite, update_thread_metadata,
    write_messages_to_file,
};
use super::utils::{
    ensure_data_dirs, ensure_thread_dir_exists, get_data_dir, get_messages_path, get_thread_dir,
    get_thread_metadata_path, validate_thread_id,
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
    // Like production, resolve on each call: mock data roots are thread-local.
    tauri_plugin_agent_tools::thread_capabilities::set_consent_root_resolver(
        std::sync::Arc::new(|| get_jan_data_folder_path(mock_app().handle().clone())),
    );
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
async fn test_create_thread_honours_valid_supplied_id() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let mut thread = create_test_thread("Supplied id");
    thread["id"] = json!("0b6f1c1e-5a0e-4a53-9c1e-7f7d2a3b4c5d");
    let created = create_thread(app.handle().clone(), thread).await.unwrap();
    assert_eq!(created["id"], "0b6f1c1e-5a0e-4a53-9c1e-7f7d2a3b4c5d");
}

#[tokio::test]
async fn test_create_thread_invalid_or_missing_id_gets_uuid() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let mut bad = create_test_thread("Bad id");
    bad["id"] = json!("../escape");
    let created = create_thread(app.handle().clone(), bad).await.unwrap();
    let id = created["id"].as_str().unwrap();
    assert_ne!(id, "../escape");
    assert!(validate_thread_id(id).is_ok());

    let created = create_thread(app.handle().clone(), create_test_thread("No id"))
        .await
        .unwrap();
    assert!(validate_thread_id(created["id"].as_str().unwrap()).is_ok());
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
}

#[tokio::test]
async fn test_thread_extra_roundtrip_and_allowlist() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let mut thread = create_test_thread("Extra");
    thread["id"] = json!("extra-thread-1");
    create_thread(app.handle().clone(), thread).await.unwrap();

    let absent = read_thread_extra(app.handle().clone(), "extra-thread-1".into(), "cowork".into())
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
    let back = read_thread_extra(app.handle().clone(), "extra-thread-1".into(), "cowork".into())
        .await
        .unwrap();
    assert_eq!(back, Some(value));

    // Not allowlisted, or a traversal attempt, is rejected.
    assert!(
        write_thread_extra(app.handle().clone(), "extra-thread-1".into(), "thread".into(), json!({}), None)
            .await
            .is_err()
    );
    assert!(
        read_thread_extra(app.handle().clone(), "../x".into(), "cowork".into())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn test_write_thread_extra_refuses_threads_without_thread_json() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    // No thread.json: a late write (e.g. after delete) must not recreate the dir.
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
    assert!(err.starts_with("thread_missing:"), "{err}");
    let data_folder = get_jan_data_folder_path(app.handle().clone());
    assert!(!get_thread_dir(&data_folder, "ghost-thread").unwrap().exists());

    // create=true (migration / first commit) may create the directory.
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
}

#[tokio::test]
async fn test_deleted_thread_cannot_be_resurrected_by_sidecar_write() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let mut thread = create_test_thread("Doomed");
    thread["id"] = json!("doomed-thread");
    create_thread(app.handle().clone(), thread).await.unwrap();
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

fn capability_grant(enabled: bool) -> serde_json::Value {
    json!({"version":1,"folderScope":null,"shellNetwork":enabled,"memoryWrite":enabled})
}

#[test]
fn conversation_capabilities_reject_invalid_shapes_and_paths() {
    use super::capabilities::validate_conversation_capabilities as validate;
    assert!(validate(&capability_grant(false)).is_ok());
    for path in ["/work/tree", "C:\\work\\tree"] {
        let mut value = capability_grant(true);
        value["folderScope"] = json!({"path":path,"access":"write"});
        assert!(validate(&value).is_ok(), "{path}");
    }
    for path in [
        "",
        "/",
        "relative",
        "/work/../etc",
        "/work/",
        "//host/share",
        "C:\\",
        "C:\\work\\..",
        "/a\\b",
        "/a\n",
    ] {
        let mut value = capability_grant(true);
        value["folderScope"] = json!({"path":path,"access":"read"});
        assert!(validate(&value).is_err(), "{path}");
    }
    for value in [
        json!(null),
        json!({}),
        json!({"version":2,"folderScope":null,"shellNetwork":true,"memoryWrite":true}),
        json!({"version":1,"folderScope":null,"shellNetwork":1,"memoryWrite":false}),
        json!({"version":1,"folderScope":null,"shellNetwork":false,"memoryWrite":false,"extra":true}),
        json!({"version":1,"folderScope":{"path":"/work","access":"execute"},"shellNetwork":false,"memoryWrite":false}),
    ] {
        assert!(validate(&value).is_err(), "{value}");
    }
}

#[tokio::test]
async fn conversation_capabilities_patch_preserves_fields_and_rejects_missing() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let mut seed = create_test_thread("preserve");
    seed["metadata"] = json!({"project":{"id":"p1"},"other":{"nested":true}});
    seed["model"] = json!({"id":"test-model"});
    let original = create_thread(app.handle().clone(), seed).await.unwrap();
    let id = original["id"].as_str().unwrap().to_string();
    set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(true))
        .await
        .unwrap();
    let path = get_thread_metadata_path(&data_dir, &id).unwrap();
    let mut stored: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(
        stored["metadata"]["conversationCapabilities"],
        capability_grant(true)
    );
    stored["metadata"]
        .as_object_mut()
        .unwrap()
        .remove("conversationCapabilities");
    assert_eq!(stored, original);
    assert!(set_thread_conversation_capabilities(
        app.handle().clone(),
        "missing-thread".into(),
        capability_grant(true)
    )
    .await
    .is_err());
    assert!(!get_thread_dir(&data_dir, "missing-thread")
        .unwrap()
        .exists());
    assert!(
        set_thread_conversation_capabilities(app.handle().clone(), id, json!({"version":2}))
            .await
            .is_err()
    );
}

/// The strict setter is what confirms host-process authority, and it narrows
/// first. A write that fails must leave the mirror denied, never restored, so
/// nothing keeps running under the authority the write was replacing.
#[tokio::test]
async fn capability_setter_narrows_first_and_confirms_only_on_a_successful_write() {
    use tauri_plugin_agent_tools::thread_capabilities::current;
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let created = create_thread(app.handle().clone(), create_test_thread("mirror"))
        .await
        .unwrap();
    let id = created["id"].as_str().unwrap().to_string();

    // Bootstrap: nothing is confirmed until a strict setter succeeds, even
    // though the thread exists on disk.
    assert!(!current(&id).0.shell_network, "bootstrap must deny");

    set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(true))
        .await
        .unwrap();
    assert!(
        current(&id).0.shell_network,
        "a successful strict write confirms host authority"
    );

    // Now make the write fail, by removing the thread the patch reads back.
    fs::remove_file(get_thread_metadata_path(&data_dir, &id).unwrap()).unwrap();
    assert!(
        set_thread_conversation_capabilities(
            app.handle().clone(),
            id.clone(),
            capability_grant(true)
        )
        .await
        .is_err(),
        "the write must fail once the thread metadata is gone"
    );
    assert!(
        !current(&id).0.shell_network,
        "a failed write narrowed first and must never restore the confirmation"
    );
}

/// An explicit revocation narrows the host mirror, and a later recreated id
/// cannot inherit the old confirmation.
#[tokio::test]
async fn revoking_capabilities_narrows_the_host_mirror() {
    use tauri_plugin_agent_tools::thread_capabilities::current;
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let created = create_thread(app.handle().clone(), create_test_thread("revoke"))
        .await
        .unwrap();
    let id = created["id"].as_str().unwrap().to_string();
    set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(true))
        .await
        .unwrap();
    assert!(current(&id).0.shell_network);
    set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(false))
        .await
        .unwrap();
    let (grant, _) = current(&id);
    assert!(!grant.shell_network && !grant.memory_write, "revoked");

    tauri_plugin_agent_tools::forget_thread_consent(&id).await;
    assert!(current(&id).0.folder_scope.is_none(), "a recreated id starts denied");
}

/// Deleting a thread must narrow on the ATTEMPT, so a delete that fails
/// part-way cannot leave the thread confirmed with its monitors still polling.
#[tokio::test]
async fn a_failed_delete_still_denies_the_thread() {
    use tauri_plugin_agent_tools::thread_capabilities::current;
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let created = create_thread(app.handle().clone(), create_test_thread("del-fail"))
        .await
        .unwrap();
    let id = created["id"].as_str().unwrap().to_string();
    set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(true))
        .await
        .unwrap();
    assert!(current(&id).0.shell_network, "granted before the delete");

    // Make the removal fail: replace the thread directory with a file, which
    // `remove_dir_all` refuses.
    let dir = get_thread_dir(&data_dir, &id).unwrap();
    fs::remove_dir_all(&dir).unwrap();
    fs::write(&dir, b"not a directory").unwrap();
    assert!(
        delete_thread(app.handle().clone(), id.clone()).await.is_err(),
        "the delete must fail once the directory is not a directory"
    );
    assert!(
        !current(&id).0.shell_network,
        "a failed delete narrowed on the attempt and must not stay confirmed"
    );
}

/// A successful delete forgets the thread, so the same id created again
/// cannot inherit the earlier confirmation.
#[tokio::test]
async fn a_recreated_thread_id_cannot_inherit_consent() {
    use tauri_plugin_agent_tools::thread_capabilities::current;
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let created = create_thread(app.handle().clone(), create_test_thread("del-reuse"))
        .await
        .unwrap();
    let id = created["id"].as_str().unwrap().to_string();
    set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(true))
        .await
        .unwrap();
    assert!(current(&id).0.shell_network);

    delete_thread(app.handle().clone(), id.clone()).await.unwrap();
    assert_ne!(current(&id).1, 0, "a deleted identity retains a denial barrier");

    // Recreate with the SAME id. Creation strips capabilities, and the mirror
    // has no entry, so both halves of the intersection deny.
    let mut seed = create_test_thread("del-reuse-again");
    seed["id"] = json!(id.clone());
    create_thread(app.handle().clone(), seed).await.unwrap();
    let (grant, generation) = current(&id);
    assert!(
        !grant.shell_network && !grant.memory_write && grant.folder_scope.is_none(),
        "a recreated id must start denied"
    );
    assert_ne!(generation, 0, "and explicitly denied");
}

/// Rolling back a created thread is a delete: the attempt revokes, success
/// retains a denial barrier, and its shells are cancelled, so a grant saved
/// between creation and refusal cannot outlive the conversation.
#[tokio::test]
async fn a_rolled_back_thread_loses_consent_and_its_shells() {
    use tauri_plugin_agent_tools::thread_capabilities::current;
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let created = create_thread(app.handle().clone(), create_test_thread("rollback-consent"))
        .await
        .unwrap();
    let id = created["id"].as_str().unwrap().to_string();
    set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(true))
        .await
        .unwrap();
    assert!(current(&id).0.shell_network, "granted before the rollback");
    #[cfg(unix)]
    let mut child = tauri_plugin_agent_tools::tools::proc::spawn(
        tauri_plugin_agent_tools::tools::proc::shell(),
        "sleep 30",
        &data_dir,
        None,
        tauri_plugin_agent_tools::tools::proc::ShellEnv::default(),
        Some(&id),
    )
    .await
    .unwrap();

    rollback_created_thread(app.handle().clone(), id.clone(), created.clone())
        .await
        .unwrap();

    assert!(!get_thread_dir(&data_dir, &id).unwrap().exists());
    let (grant, generation) = current(&id);
    assert!(!grant.shell_network && !grant.memory_write, "rollback revokes");
    assert_ne!(generation, 0, "retains a denial barrier, exactly like delete");
    #[cfg(unix)]
    {
        let status = tokio::time::timeout(std::time::Duration::from_secs(10), child.wait())
            .await
            .expect("the rollback must kill the thread's running shells")
            .unwrap();
        assert!(!status.success(), "killed, not run to completion");
    }

    // Recreate with the SAME id: nothing is inherited.
    let mut seed = create_test_thread("rollback-consent-again");
    seed["id"] = json!(id.clone());
    create_thread(app.handle().clone(), seed).await.unwrap();
    let (grant, generation) = current(&id);
    assert!(!grant.shell_network && grant.folder_scope.is_none());
    assert_ne!(generation, 0, "reusing an id must not erase its denial barrier");
    tauri_plugin_agent_tools::thread_capabilities::restore_if_absent(
        &id, serde_json::from_value(capability_grant(true)).unwrap(),
    ).unwrap();
    assert!(!current(&id).0.shell_network, "stale disk grant cannot restore a reused id");
}

/// A rollback REFUSED by the receipt check keeps the conversation, so it must
/// keep its consent and monitors too: refusal is not a delete.
#[tokio::test]
async fn a_refused_rollback_keeps_consent() {
    use tauri_plugin_agent_tools::thread_capabilities::current;
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let created = create_thread(app.handle().clone(), create_test_thread("rollback-refused"))
        .await
        .unwrap();
    let id = created["id"].as_str().unwrap().to_string();
    set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(true))
        .await
        .unwrap();
    let mut receipt = created.clone();
    receipt["title"] = json!("tampered");
    assert!(
        rollback_created_thread(app.handle().clone(), id.clone(), receipt)
            .await
            .is_err(),
        "a mismatched receipt must refuse"
    );
    assert!(
        current(&id).0.shell_network,
        "a refused rollback keeps the thread's consent"
    );
}

/// A rollback whose removal FAILS must leave the thread denied: the teardown
/// narrows on the attempt, like `delete_thread`, and never restores. The
/// failure is forced through a per-thread test seam rather than directory
/// permissions, which a suite running as root would silently ignore.
#[tokio::test]
async fn a_failed_rollback_still_denies_the_thread() {
    use tauri_plugin_agent_tools::thread_capabilities::current;
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let created = create_thread(app.handle().clone(), create_test_thread("rollback-fail"))
        .await
        .unwrap();
    let id = created["id"].as_str().unwrap().to_string();
    set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(true))
        .await
        .unwrap();
    *ROLLBACK_REMOVAL_FAILS_FOR.lock().unwrap() = Some(id.clone());
    let refused = rollback_created_thread(app.handle().clone(), id.clone(), created.clone()).await;
    *ROLLBACK_REMOVAL_FAILS_FOR.lock().unwrap() = None;
    assert!(refused.is_err(), "the seam must have failed the removal");
    assert!(
        get_thread_dir(&data_dir, &id).unwrap().exists(),
        "the seam fails before anything is removed"
    );
    let (grant, generation) = current(&id);
    assert!(!grant.shell_network, "a failed rollback narrowed on the attempt");
    assert_ne!(generation, 0, "narrowed, not forgotten: the thread still exists");
}

/// Deleting a thread kills the shells running under its raw process bucket,
/// not only its monitor poll children.
#[cfg(unix)]
#[tokio::test]
async fn deleting_a_thread_kills_its_running_shells() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let created = create_thread(app.handle().clone(), create_test_thread("del-shells"))
        .await
        .unwrap();
    let id = created["id"].as_str().unwrap().to_string();
    let mut child = tauri_plugin_agent_tools::tools::proc::spawn(
        tauri_plugin_agent_tools::tools::proc::shell(),
        "sleep 30",
        &data_dir,
        None,
        tauri_plugin_agent_tools::tools::proc::ShellEnv::default(),
        Some(&id),
    )
    .await
    .unwrap();
    delete_thread(app.handle().clone(), id.clone())
        .await
        .unwrap();
    let status = tokio::time::timeout(std::time::Duration::from_secs(10), child.wait())
        .await
        .expect("the delete must kill the thread's running shells")
        .unwrap();
    assert!(!status.success(), "killed, not run to completion");
}

/// Bot finding on d9508e1b3: the setter must never report success when its
/// confirmation was dropped. `stop_all_thread_monitors` takes no per-thread
/// lock, so its barrier bump can land between the setter's narrow and its
/// confirm; the grant is then on disk but host-denied, and an Ok would have
/// the UI show it active while every poll and one-shot is refused.
#[tokio::test]
async fn a_dropped_confirmation_fails_the_setter_instead_of_faking_success() {
    use tauri_plugin_agent_tools::thread_capabilities::current;
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let created = create_thread(app.handle().clone(), create_test_thread("dropped-confirm"))
        .await
        .unwrap();
    let id = created["id"].as_str().unwrap().to_string();
    *SETTER_BUMP_BEFORE_CONFIRM.lock().unwrap() = Some(id.clone());
    let result =
        set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(true))
            .await;
    *SETTER_BUMP_BEFORE_CONFIRM.lock().unwrap() = None;
    let message = result.expect_err("a dropped confirmation must surface, not read as saved");
    assert!(message.contains("prevented its activation"), "{message}");
    assert!(
        !current(&id).0.shell_network,
        "the host stays denied -- fail closed"
    );
    // The written grant is on disk (reachable via the reconfirm flow), never
    // silently active.
    let stored: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(get_thread_metadata_path(&data_dir, &id).unwrap()).unwrap(),
    )
    .unwrap();
    assert_eq!(
        stored["metadata"]["conversationCapabilities"]["shellNetwork"],
        json!(true)
    );
    // Positive control: without the interleaving, the identical call confirms
    // and succeeds, so the error above is the seam's doing and nothing else.
    set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(true))
        .await
        .unwrap();
    assert!(current(&id).0.shell_network, "retry activates the grant");
}

/// Bot question on ddd2d07df: a grant that passes the lexical check but can
/// never pass `ThreadCapabilities::validate()` (a Windows drive path is
/// lexically fine everywhere but `Path::is_absolute` only on Windows) must be
/// rejected UP FRONT -- not narrowed, not persisted, and never misreported as
/// a concurrency race whose retry can never succeed.
#[cfg(unix)]
#[tokio::test]
async fn an_unconfirmable_grant_is_rejected_before_anything_changes() {
    use tauri_plugin_agent_tools::thread_capabilities::current;
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let created = create_thread(app.handle().clone(), create_test_thread("unconfirmable"))
        .await
        .unwrap();
    let id = created["id"].as_str().unwrap().to_string();
    set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(true))
        .await
        .unwrap();
    assert!(current(&id).0.shell_network, "a real grant is live");

    let unconfirmable = json!({
        "version": 1,
        "folderScope": { "path": "C:\\Users\\someone\\project", "access": "read" },
        "shellNetwork": false,
        "memoryWrite": false
    });
    let message =
        set_thread_conversation_capabilities(app.handle().clone(), id.clone(), unconfirmable)
            .await
            .expect_err("an unconfirmable grant must be rejected");
    assert!(
        !message.contains("concurrent change"),
        "must not be misreported as a race: {message}"
    );
    assert!(
        current(&id).0.shell_network,
        "rejected input must not narrow the live confirmation"
    );
    let stored: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(get_thread_metadata_path(&data_dir, &id).unwrap()).unwrap(),
    )
    .unwrap();
    assert_eq!(
        stored["metadata"]["conversationCapabilities"]["shellNetwork"],
        json!(true),
        "rejected input must not be persisted"
    );
}

#[tokio::test]
async fn conversation_capabilities_stale_writer_cannot_restore_revocation() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let mut seed = create_test_thread("stale");
    seed["metadata"] = json!({"conversationCapabilities":capability_grant(true),"project":"old"});
    let mut stale = create_thread(app.handle().clone(), seed).await.unwrap();
    let id = stale["id"].as_str().unwrap().to_string();
    set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(true))
        .await
        .unwrap();
    stale["metadata"]["conversationCapabilities"] = capability_grant(true);
    set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(false))
        .await
        .unwrap();
    stale["metadata"]["project"] = json!("new");
    modify_thread(app.handle().clone(), stale).await.unwrap();
    let stored: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(get_thread_metadata_path(&data_dir, &id).unwrap()).unwrap(),
    )
    .unwrap();
    assert_eq!(stored["metadata"]["project"], "new");
    assert_eq!(
        stored["metadata"]["conversationCapabilities"],
        capability_grant(false)
    );
}

#[tokio::test]
async fn conversation_capabilities_delete_and_writers_share_lock() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let original = create_thread(app.handle().clone(), create_test_thread("race"))
        .await
        .unwrap();
    let id = original["id"].as_str().unwrap().to_string();
    let lock = get_lock_for_thread(&id).await;
    let guard = lock.lock().await;
    let handle = app.handle().clone();
    let delete_id = id.clone();
    let deleting = tokio::spawn(async move { delete_thread(handle, delete_id).await });
    tokio::task::yield_now().await; // queue deletion before late writers
    let handle = app.handle().clone();
    let patch_id = id.clone();
    let patching = tokio::spawn(async move {
        set_thread_conversation_capabilities(handle, patch_id, capability_grant(true)).await
    });
    let handle = app.handle().clone();
    let modifying = tokio::spawn(async move { modify_thread(handle, original).await });
    tokio::task::yield_now().await;
    assert!(!deleting.is_finished());
    assert!(!patching.is_finished());
    assert!(!modifying.is_finished());
    drop(guard);
    deleting.await.unwrap().unwrap();
    assert!(patching.await.unwrap().is_err());
    assert!(modifying.await.unwrap().is_err());
    assert!(!get_thread_dir(&data_dir, &id).unwrap().exists());
}

#[tokio::test]
async fn conversation_capabilities_concurrent_unrelated_writer_keeps_both_changes() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let mut original = create_thread(app.handle().clone(), create_test_thread("writer"))
        .await
        .unwrap();
    let id = original["id"].as_str().unwrap().to_string();
    original["metadata"] = json!({"project":"latest", "unrelated":{"keep":42}, "conversationCapabilities":capability_grant(false)});
    let (patched, modified) = tokio::join!(
        set_thread_conversation_capabilities(
            app.handle().clone(),
            id.clone(),
            capability_grant(true)
        ),
        modify_thread(app.handle().clone(), original),
    );
    patched.unwrap();
    modified.unwrap();
    let stored: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(get_thread_metadata_path(&data_dir, &id).unwrap()).unwrap(),
    )
    .unwrap();
    assert_eq!(
        stored["metadata"]["conversationCapabilities"],
        capability_grant(true)
    );
    assert_eq!(stored["metadata"]["project"], "latest");
    assert_eq!(stored["metadata"]["unrelated"], json!({"keep":42}));
}

#[tokio::test]
async fn conversation_capabilities_ordinary_writer_cannot_introduce_grant() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let mut original = create_thread(app.handle().clone(), create_test_thread("no-authority"))
        .await
        .unwrap();
    let id = original["id"].as_str().unwrap().to_string();
    original["metadata"] = json!({"conversationCapabilities":capability_grant(true),"keep":true});
    modify_thread(app.handle().clone(), original).await.unwrap();
    let stored: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(get_thread_metadata_path(&data_dir, &id).unwrap()).unwrap(),
    )
    .unwrap();
    assert!(stored["metadata"].get("conversationCapabilities").is_none());
    assert_eq!(stored["metadata"]["keep"], true);
}

#[tokio::test]
async fn conversation_capabilities_reject_non_chat_and_malformed_stored_records() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let original = create_thread(app.handle().clone(), create_test_thread("invalid-stored")).await.unwrap();
    let id = original["id"].as_str().unwrap().to_string();
    let path = get_thread_metadata_path(&data_dir, &id).unwrap();
    for patch in [json!({"metadata":{"mode":"cowork"}}), json!({"metadata":[]}), json!({"id":"different-id"})] {
        let mut stored = original.clone();
        for (key, value) in patch.as_object().unwrap() { stored[key] = value.clone(); }
        let bytes = serde_json::to_vec(&stored).unwrap();
        fs::write(&path, &bytes).unwrap();
        assert!(set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(true)).await.is_err());
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
    let temp_path = get_thread_metadata_path(&data_dir, "temporary-chat").unwrap();
    fs::create_dir_all(temp_path.parent().unwrap()).unwrap();
    let temp = json!({"id":"temporary-chat","metadata":{}});
    let bytes = serde_json::to_vec(&temp).unwrap();
    fs::write(&temp_path, &bytes).unwrap();
    assert!(set_thread_conversation_capabilities(app.handle().clone(), "temporary-chat".into(), capability_grant(true)).await.is_err());
    assert_eq!(fs::read(&temp_path).unwrap(), bytes);
}

#[tokio::test]
async fn rollback_created_thread_refuses_external_changes_and_content() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    for case in ["metadata", "message", "sidecar"] {
        let original = create_thread(app.handle().clone(), create_test_thread(case)).await.unwrap();
        let id = original["id"].as_str().unwrap().to_string();
        let path = get_thread_metadata_path(&data_dir, &id).unwrap();
        if case == "metadata" {
            let mut changed = original.clone(); changed["title"] = json!("external edit");
            modify_thread(app.handle().clone(), changed).await.unwrap();
        } else if case == "message" {
            fs::write(get_messages_path(&data_dir, &id).unwrap(), b"{\"role\":\"user\"}\n").unwrap();
        } else {
            fs::write(get_thread_dir(&data_dir, &id).unwrap().join("cowork.json"), b"{}").unwrap();
        }
        let before = fs::read(&path).unwrap();
        assert!(rollback_created_thread(app.handle().clone(), id.clone(), original).await.is_err());
        assert_eq!(fs::read(path).unwrap(), before);
    }
}

#[tokio::test]
async fn rollback_created_thread_deletes_only_unchanged_creation_after_grant_failure() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    for _ in 0..2 {
        let original = create_thread(app.handle().clone(), create_test_thread("retry")).await.unwrap();
        let id = original["id"].as_str().unwrap().to_string();
        set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(false)).await.unwrap();
        rollback_created_thread(app.handle().clone(), id.clone(), original).await.unwrap();
        assert!(!get_thread_dir(&data_dir, &id).unwrap().exists());
    }
}

#[tokio::test]
async fn rollback_created_thread_checks_external_edit_under_writer_lock() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let original = create_thread(app.handle().clone(), create_test_thread("lock")).await.unwrap();
    let id = original["id"].as_str().unwrap().to_string();
    let lock = get_lock_for_thread(&id).await;
    let guard = lock.lock().await;
    let mut changed = original.clone(); changed["title"] = json!("other window");
    let handle = app.handle().clone();
    let editing = tokio::spawn(async move { modify_thread(handle, changed).await });
    tokio::task::yield_now().await;
    let handle = app.handle().clone(); let target = id.clone();
    let rollback = tokio::spawn(async move { rollback_created_thread(handle, target, original).await });
    tokio::task::yield_now().await;
    assert!(!rollback.is_finished()); drop(guard);
    editing.await.unwrap().unwrap();
    assert!(rollback.await.unwrap().is_err());
    assert!(get_thread_metadata_path(&data_dir, &id).unwrap().exists());
}

#[tokio::test]
async fn conversation_capabilities_dispatch_reader_rejects_non_chat_and_reads_revocation() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let original = create_thread(app.handle().clone(), create_test_thread("dispatch-reader"))
        .await
        .unwrap();
    let id = original["id"].as_str().unwrap().to_string();
    let read = super::capabilities::read_conversation_capabilities;
    assert_eq!(read(&data_dir, &id).await.unwrap(), capability_grant(false));
    set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(true))
        .await
        .unwrap();
    assert_eq!(read(&data_dir, &id).await.unwrap(), capability_grant(true));
    set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(false))
        .await
        .unwrap();
    assert_eq!(read(&data_dir, &id).await.unwrap(), capability_grant(false));
    for invalid in ["missing-dispatch-thread", "../escape"] {
        assert!(read(&data_dir, invalid).await.is_err());
    }
    // Temporary Chat cannot persist consent, even a forged on-disk record is
    // never authority. It keeps only the ungranted scratch baseline.
    assert_eq!(
        read(&data_dir, "temporary-chat").await.unwrap(),
        capability_grant(false)
    );
    let temp_path = get_thread_metadata_path(&data_dir, "temporary-chat").unwrap();
    fs::create_dir_all(temp_path.parent().unwrap()).unwrap();
    fs::write(
        &temp_path,
        serde_json::to_vec(&json!({"id":"temporary-chat","metadata":{
            "conversationCapabilities":capability_grant(true)
        }})).unwrap(),
    ).unwrap();
    assert_eq!(
        read(&data_dir, "temporary-chat").await.unwrap(),
        capability_grant(false)
    );
    let path = get_thread_metadata_path(&data_dir, &id).unwrap();
    for metadata in [
        json!({"mode":"cowork"}),
        json!([]),
        json!({"conversationCapabilities":{"version":2}}),
    ] {
        let mut stored = original.clone();
        stored["metadata"] = metadata;
        fs::write(&path, serde_json::to_vec(&stored).unwrap()).unwrap();
        assert!(read(&data_dir, &id).await.is_err());
    }
}

#[tokio::test]
async fn conversation_capabilities_create_strips_forged_grants_preserving_chat_and_cowork() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    for cowork in [false, true] {
        for supplied_id in [false, true] {
            let mut input = create_test_thread("untrusted creation");
            input["metadata"] = json!({
                "project":{"id":"p1","path":"/work/project"},
                "unrelated":{"nested":[1,2,3]},
                "conversationCapabilities":capability_grant(true)
            });
            if cowork {
                input["metadata"]["mode"] = json!("cowork");
                input["metadata"]["coworkSessionId"] = json!("session-1");
            }
            if supplied_id {
                input["id"] = json!(format!("forged-create-{cowork}"));
            }
            let created = create_thread(app.handle().clone(), input.clone())
                .await
                .unwrap();
            let id = created["id"].as_str().unwrap();
            let mut expected = input;
            expected["id"] = json!(id);
            expected["metadata"]
                .as_object_mut()
                .unwrap()
                .remove("conversationCapabilities");
            assert_eq!(created, expected);
            let stored: serde_json::Value = serde_json::from_slice(
                &fs::read(get_thread_metadata_path(&data_dir, id).unwrap()).unwrap(),
            )
            .unwrap();
            assert_eq!(stored, expected);
            if !cowork {
                assert_eq!(
                    super::capabilities::read_conversation_capabilities(&data_dir, id)
                        .await
                        .unwrap(),
                    capability_grant(false)
                );
            }
        }
    }
}

#[tokio::test]
async fn conversation_capabilities_create_existing_id_preserves_real_grant_under_lock() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let mut input = create_test_thread("original");
    input["id"] = json!("existing-real-grant");
    input["metadata"] = json!({"project":{"id":"original-project"}});
    create_thread(app.handle().clone(), input).await.unwrap();
    let id = "existing-real-grant".to_string();
    set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(true))
        .await
        .unwrap();
    let path = get_thread_metadata_path(&data_dir, &id).unwrap();
    let before = fs::read(&path).unwrap();
    let expected: serde_json::Value = serde_json::from_slice(&before).unwrap();
    let mut forged = create_test_thread("forged overwrite");
    forged["id"] = json!(id);
    forged["metadata"] = json!({"conversationCapabilities":capability_grant(false),"project":"forged","mode":"cowork"});
    let lock = get_lock_for_thread(&id).await;
    let guard = lock.lock().await;
    let handle = app.handle().clone();
    let mut creating = tokio::spawn(async move { create_thread(handle, forged).await });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(30), &mut creating)
            .await
            .is_err(),
        "existing-record check must also take the shared lock"
    );
    assert_eq!(fs::read(&path).unwrap(), before);
    drop(guard);
    assert_eq!(creating.await.unwrap().unwrap(), expected);
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[tokio::test]
async fn conversation_capabilities_create_setter_and_delete_share_chosen_id_lock() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let id = "create-set-delete-lock".to_string();
    let mut input = create_test_thread("locked creation");
    input["id"] = json!(id);
    input["metadata"] = json!({"conversationCapabilities":capability_grant(true)});
    let lock = get_lock_for_thread(&id).await;
    let guard = lock.lock().await;
    let handle = app.handle().clone();
    let mut creating = tokio::spawn(async move { create_thread(handle, input).await });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(30), &mut creating)
            .await
            .is_err()
    );
    assert!(!get_thread_metadata_path(&data_dir, &id).unwrap().exists());
    let handle = app.handle().clone();
    let target = id.clone();
    let mut granting = tokio::spawn(async move {
        set_thread_conversation_capabilities(handle, target, capability_grant(true)).await
    });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(30), &mut granting)
            .await
            .is_err()
    );
    let handle = app.handle().clone();
    let target = id.clone();
    let mut deleting = tokio::spawn(async move { delete_thread(handle, target).await });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(30), &mut deleting)
            .await
            .is_err()
    );
    drop(guard);
    let created = creating.await.unwrap().unwrap();
    assert!(created["metadata"]
        .get("conversationCapabilities")
        .is_none());
    granting.await.unwrap().unwrap();
    deleting.await.unwrap().unwrap();
    assert!(!get_thread_dir(&data_dir, &id).unwrap().exists());
}

#[tokio::test]
async fn conversation_capabilities_concurrent_same_id_creates_keep_first_record() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let id = "concurrent-create-id";
    let mut first = create_test_thread("first creator");
    first["id"] = json!(id);
    first["metadata"] =
        json!({"project":"first","conversationCapabilities":capability_grant(true)});
    let mut second = create_test_thread("second creator");
    second["id"] = json!(id);
    second["metadata"] = json!({"project":"second","mode":"cowork","conversationCapabilities":capability_grant(true)});
    let lock = get_lock_for_thread(id).await;
    let guard = lock.lock().await;
    let handle = app.handle().clone();
    let mut creating_first = tokio::spawn(async move { create_thread(handle, first).await });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(30), &mut creating_first)
            .await
            .is_err()
    );
    let handle = app.handle().clone();
    let mut creating_second = tokio::spawn(async move { create_thread(handle, second).await });
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(30), &mut creating_second)
            .await
            .is_err()
    );
    drop(guard);
    let first = creating_first.await.unwrap().unwrap();
    let second = creating_second.await.unwrap().unwrap();
    assert_eq!(first["title"], "first creator");
    assert_eq!(first["metadata"], json!({"project":"first"}));
    assert_eq!(second, first);
    let stored: serde_json::Value = serde_json::from_slice(
        &fs::read(get_thread_metadata_path(&data_dir, id).unwrap()).unwrap(),
    )
    .unwrap();
    assert_eq!(stored, first);
}

#[tokio::test]
async fn conversation_capabilities_native_setter_grants_after_forged_creation_is_stripped() {
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let mut input = create_test_thread("explicit consent after creation");
    input["metadata"] =
        json!({"project":{"id":"p1"},"conversationCapabilities":capability_grant(true)});
    let created = create_thread(app.handle().clone(), input).await.unwrap();
    let id = created["id"].as_str().unwrap().to_string();
    assert!(created["metadata"]
        .get("conversationCapabilities")
        .is_none());
    assert_eq!(
        super::capabilities::read_conversation_capabilities(&data_dir, &id)
            .await
            .unwrap(),
        capability_grant(false)
    );
    set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(true))
        .await
        .unwrap();
    assert_eq!(
        super::capabilities::read_conversation_capabilities(&data_dir, &id)
            .await
            .unwrap(),
        capability_grant(true)
    );
    let mut expected = created;
    expected["metadata"]["conversationCapabilities"] = capability_grant(true);
    let stored: serde_json::Value = serde_json::from_slice(
        &fs::read(get_thread_metadata_path(&data_dir, &id).unwrap()).unwrap(),
    )
    .unwrap();
    assert_eq!(stored, expected);
}

// ---- ACL invoke harness ----------------------------------------------------
//
// Drives the thread-monitor commands through Tauri's real IPC entry point
// against the PRODUCTION resolved ACL: `generate_context!(test = true)`
// suppresses duplicate macOS plist symbols, but still embeds the shipped
// capabilities (window "main" holds `agent-tools:default`), so a pass
// here is the ACL's own resolution of `plugin:agent-tools|<command>` plus
// argument deserialization and dispatch -- what the plugin's string-level
// guard tests cannot see. It is deliberately NOT native UI acceptance.

fn acl_invoke(
    webview: &tauri::WebviewWindow<MockRuntime>,
    command: &str,
    body: serde_json::Value,
) -> Result<tauri::ipc::InvokeResponseBody, serde_json::Value> {
    tauri::test::get_ipc_response(
        webview,
        tauri::webview::InvokeRequest {
            cmd: command.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: if cfg!(any(windows, target_os = "android")) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .unwrap(),
            body: tauri::ipc::InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        },
    )
}

#[test]
fn thread_monitor_commands_pass_the_real_acl_and_dispatch() {
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_agent_tools::init())
        .build(tauri::generate_context!(test = true))
        .unwrap();
    let main = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let id = "acl-harness";

    // Every new command must resolve through the production ACL for the real
    // "main" window and dispatch into the plugin, camelCase arguments and all.
    let list = acl_invoke(&main, "plugin:agent-tools|list_thread_monitors", json!({"threadId": id}))
        .unwrap_or_else(|e| panic!("list_thread_monitors was refused: {e}"));
    assert_eq!(list.deserialize::<String>().unwrap(), "No active monitors.");

    let stop = acl_invoke(
        &main,
        "plugin:agent-tools|stop_thread_monitor",
        json!({"threadId": id, "monitorId": "mon-404"}),
    )
    .unwrap_or_else(|e| panic!("stop_thread_monitor was refused: {e}"));
    assert!(stop
        .deserialize::<String>()
        .unwrap()
        .contains("unknown or already-stopped"));

    acl_invoke(&main, "plugin:agent-tools|stop_all_thread_monitors", json!({"threadId": id}))
        .unwrap_or_else(|e| panic!("stop_all_thread_monitors was refused: {e}"));
    acl_invoke(&main, "plugin:agent-tools|revoke_thread_capabilities", json!({"threadId": id}))
        .unwrap_or_else(|e| panic!("revoke_thread_capabilities was refused: {e}"));

    // `start_thread_monitor` carries an IPC channel and resolves host consent;
    // whatever it answers in this headless harness must be the COMMAND's own
    // answer (here: an authorization refusal), never an ACL rejection.
    let started = acl_invoke(
        &main,
        "plugin:agent-tools|start_thread_monitor",
        json!({"threadId": id, "args": {"op": "start", "script": "true"}, "onUpdate": "__CHANNEL__:1"}),
    );
    let refusal = started.expect_err(
        "start_thread_monitor must refuse in this headless harness: no consent \
         was ever granted for this thread",
    );
    let text = refusal.to_string();
    assert!(
        !text.contains("not allowed"),
        "start_thread_monitor never reached the plugin: {text}"
    );
    assert!(
        text.contains("Thread consent resolver")
            || text.contains("no longer granted")
            || text.contains("no OS sandbox"),
        "the refusal must be the native consent path's own answer, got: {text}"
    );

    // Negative control: the same invoke from a window OUTSIDE the capability
    // is refused, so the passes above are the ACL's doing, not a permissive
    // mock. Without this the harness would prove nothing.
    let outsider = tauri::WebviewWindowBuilder::new(&app, "outsider", Default::default())
        .build()
        .unwrap();
    let denied = acl_invoke(&outsider, "plugin:agent-tools|list_thread_monitors", json!({"threadId": id}))
        .expect_err("a window outside the capability must be refused");
    assert!(denied.to_string().contains("not allowed"), "{denied}");
}

#[tokio::test]
async fn test_modify_thread_missing_thread_uses_stable_error_code() {
    let (app, _data_dir) = mock_app_with_temp_data_dir();
    let err = modify_thread(app.handle().clone(), json!({"id": "ghost-modify"}))
        .await
        .unwrap_err();
    assert!(err.starts_with("thread_missing:"), "{err}");
}

#[tokio::test]
async fn consent_directory_sync_failure_cannot_confirm_replacement() {
    use tauri_plugin_agent_tools::thread_capabilities::current;
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let created = create_thread(app.handle().clone(), create_test_thread("consent-dir-sync"))
        .await.unwrap();
    let id = created["id"].as_str().unwrap().to_string();
    set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(true))
        .await.unwrap();
    *super::capabilities::FAIL_CONSENT_DIR_SYNC.lock().unwrap() = Some(id.clone());
    let result = set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(true)).await;
    *super::capabilities::FAIL_CONSENT_DIR_SYNC.lock().unwrap() = None;
    assert!(result.unwrap_err().contains("directory sync"));
    let denied = current(&id).0;
    assert!(denied.folder_scope.is_none() && !denied.shell_network && !denied.memory_write);
    // No mirror entry exists for this identity: copy precisely the disk state
    // a new host would see, without exposing a production mirror-reset API.
    let restarted_id = uuid::Uuid::new_v4().to_string();
    let mut stored: serde_json::Value = serde_json::from_slice(
        &fs::read(get_thread_metadata_path(&data_dir, &id).unwrap()).unwrap(),
    ).unwrap();
    assert_eq!(stored["metadata"]["conversationCapabilities"], capability_grant(true));
    stored["id"] = json!(restarted_id);
    ensure_thread_dir_exists(&data_dir, &restarted_id).unwrap();
    update_thread_metadata(&data_dir, &restarted_id, &stored).unwrap();
    fs::copy(data_dir.join("conversation-denials").join(&id),
        data_dir.join("conversation-denials").join(&restarted_id)).unwrap();
    assert_eq!(current(&restarted_id).1, 0, "simulated fresh host has no mirror entry");
    let restored = super::capabilities::read_conversation_capabilities(&data_dir, &restarted_id).await.unwrap();
    assert_eq!(restored, capability_grant(false), "durable denial survives host restart");
}

// A durable-denial failure must abort each removal path independently, before
// any conversation data is removed, while still narrowing the live mirror.
async fn marker_failure_aborts_removal(rollback: bool) {
    use tauri_plugin_agent_tools::thread_capabilities::{current, denial_persisted};
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let created = create_thread(app.handle().clone(), create_test_thread("marker-failure")).await.unwrap();
    let id = created["id"].as_str().unwrap().to_string();
    set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(true)).await.unwrap();
    let metadata = get_thread_metadata_path(&data_dir, &id).unwrap();
    let before = fs::read(&metadata).unwrap();
    // A directory at the marker path deterministically prevents File::create.
    let marker = data_dir.join("conversation-denials").join(&id);
    fs::create_dir_all(&marker).unwrap();
    let result = if rollback {
        rollback_created_thread(app.handle().clone(), id.clone(), created).await
    } else {
        delete_thread(app.handle().clone(), id.clone()).await
    };
    assert!(result.unwrap_err().contains("restart-safe revocation failed"));
    assert_eq!(fs::read(metadata).unwrap(), before, "abort before removal");
    assert!(denial_persisted(&id).is_err());
    let grant = current(&id).0;
    assert!(!grant.shell_network && !grant.memory_write && grant.folder_scope.is_none());
}

#[tokio::test]
async fn delete_marker_persistence_failure_preserves_conversation() {
    marker_failure_aborts_removal(false).await;
}

#[tokio::test]
async fn rollback_marker_persistence_failure_preserves_conversation() {
    marker_failure_aborts_removal(true).await;
}

// Finalization must not turn a successful removal into an error that makes the
// renderer restore a conversation whose directory is already gone.
async fn marker_failure_after_removal_still_succeeds(rollback: bool) {
    use tauri_plugin_agent_tools::thread_capabilities::{current, denial_persisted};
    let (app, data_dir) = mock_app_with_temp_data_dir();
    let created = create_thread(app.handle().clone(), create_test_thread("post-removal-marker"))
        .await.unwrap();
    let id = created["id"].as_str().unwrap().to_string();
    set_thread_conversation_capabilities(app.handle().clone(), id.clone(), capability_grant(true))
        .await.unwrap();
    super::commands::FAIL_MARKER_AFTER_REMOVAL.lock().unwrap().push(id.clone());
    let result = if rollback {
        rollback_created_thread(app.handle().clone(), id.clone(), created).await
    } else {
        delete_thread(app.handle().clone(), id.clone()).await
    };
    assert!(!get_thread_dir(&data_dir, &id).unwrap().exists(), "removal succeeded");
    assert!(data_dir.join("conversation-denials").join(&id).is_dir(), "post-removal fault was injected");
    assert!(result.is_ok(), "successful removal must not restore a frontend ghost: {result:?}");
    denial_persisted(&id).expect("the pre-removal denial remains acknowledged");
    let (grant, barrier) = current(&id);
    assert!(barrier != 0, "retain an explicit barrier against stale work");
    assert!(grant.folder_scope.is_none() && !grant.shell_network && !grant.memory_write);
    assert!(list_threads(app.handle().clone()).await.unwrap().iter().all(|thread| thread["id"] != id));
}

#[tokio::test]
async fn delete_post_removal_marker_failure_does_not_restore_ghost() {
    marker_failure_after_removal_still_succeeds(false).await;
}

#[tokio::test]
async fn rollback_post_removal_marker_failure_does_not_restore_ghost() {
    marker_failure_after_removal_still_succeeds(true).await;
}
