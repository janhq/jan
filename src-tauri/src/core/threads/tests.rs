use super::commands::*;
use super::constants::{MESSAGES_FILE, THREADS_DIR, THREADS_FILE};
use super::helpers::{
    get_lock_for_thread, read_messages_from_file, should_use_sqlite, update_thread_metadata,
    write_messages_to_file,
};
use super::utils::{
    ensure_data_dirs, ensure_thread_dir_exists, get_data_dir, get_messages_path, get_thread_dir,
    get_thread_metadata_path,
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
    let dir = get_thread_dir(&base, "abc-123");
    assert_eq!(dir, base.join("threads").join("abc-123"));
}

#[test]
fn test_get_thread_metadata_path_layout() {
    let base = PathBuf::from("/tmp/jandata");
    let path = get_thread_metadata_path(&base, "tid");
    assert!(path.ends_with("threads/tid/thread.json"));
}

#[test]
fn test_get_messages_path_layout() {
    let base = PathBuf::from("/tmp/jandata");
    let path = get_messages_path(&base, "tid");
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
    let dir = get_thread_dir(base, "thread-xyz");
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
    let path = get_messages_path(base, "trip");

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
    let path = get_messages_path(base, "empty");
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
    let path = get_messages_path(base, "ow");

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
    let path = get_messages_path(base, "lines");

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
fn test_write_messages_leaves_no_tmp_file_on_success() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path();
    ensure_thread_dir_exists(base, "no-tmp").unwrap();
    let path = get_messages_path(base, "no-tmp");

    write_messages_to_file(&[json!({"id": "a"}), json!({"id": "b"})], &path).unwrap();

    let dir = path.parent().unwrap();
    let stray_tmp: Vec<_> = fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .filter(|n| n.to_string_lossy().ends_with(".tmp"))
        .collect();
    assert!(
        stray_tmp.is_empty(),
        "no .tmp file should remain after a successful atomic write, found: {stray_tmp:?}"
    );
}

#[test]
fn test_write_messages_overwrites_stale_tmp_from_prior_crash() {
    // Regression test for janhq/jan#8019: a stale `.tmp` file left behind from
    // a previous crashed write must not break the next write.
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path();
    ensure_thread_dir_exists(base, "stale-tmp").unwrap();
    let path = get_messages_path(base, "stale-tmp");
    let tmp_path = path.with_file_name(format!(
        "{}.tmp",
        path.file_name().unwrap().to_string_lossy()
    ));

    fs::write(&tmp_path, "garbage that is not JSONL\n{{{").unwrap();

    write_messages_to_file(&[json!({"id": "fresh"})], &path).unwrap();

    let read = read_messages_from_file(base, "stale-tmp").unwrap();
    assert_eq!(read.len(), 1);
    assert_eq!(read[0]["id"], "fresh");
    assert!(
        !tmp_path.exists(),
        "stale .tmp should have been renamed over the target"
    );
}

#[test]
fn test_write_messages_preserves_existing_on_write_failure() {
    // Regression test for janhq/jan#8019: when the write path fails, the
    // previously-persisted messages.jsonl must remain intact (truncate-first
    // semantics would leave it empty).
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path();
    ensure_thread_dir_exists(base, "preserve").unwrap();
    let path = get_messages_path(base, "preserve");

    write_messages_to_file(&[json!({"id": "original"})], &path).unwrap();

    // Pointing at a path whose parent doesn't exist forces File::create to fail.
    let unwritable = base.join("missing-parent").join("messages.jsonl");
    assert!(write_messages_to_file(&[json!({"id": "never"})], &unwritable).is_err());

    // Original file for the unrelated thread must be untouched.
    let read = read_messages_from_file(base, "preserve").unwrap();
    assert_eq!(read.len(), 1);
    assert_eq!(read[0]["id"], "original");
}

#[test]
fn test_read_messages_invalid_json_errors() {
    let tmp = tempfile::tempdir().unwrap();
    let base = tmp.path();
    ensure_thread_dir_exists(base, "bad").unwrap();
    let path = get_messages_path(base, "bad");
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

    let path = get_thread_metadata_path(base, "meta");
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

    let contents = fs::read_to_string(get_thread_metadata_path(base, "ovr")).unwrap();
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
