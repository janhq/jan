/*!
   SQLite Database Module for Mobile Thread Storage

   This module provides SQLite-based storage for threads and messages on mobile platforms.
   It ensures data persistence and retrieval work correctly on Android and iOS devices.

   Note: This module is only compiled and used on mobile platforms (Android/iOS).
   On desktop, the file-based storage in helpers.rs is used instead.
*/

#![allow(dead_code)] // Functions only used on mobile platforms

use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::Row;
use std::str::FromStr;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::Mutex;

const DB_NAME: &str = "jan.db";

/// Global database pool for mobile platforms
static DB_POOL: OnceLock<Mutex<Option<SqlitePool>>> = OnceLock::new();

/// Initialize database with connection pool and run migrations
pub async fn init_database<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    // Get app data directory
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Ensure directory exists
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir: {}", e))?;

    // Create database path
    let db_path = app_data_dir.join(DB_NAME);
    let db_url = format!("sqlite:{}", db_path.display());

    log::info!("Initializing SQLite database at: {}", db_url);

    // Create connection options
    let connect_options = SqliteConnectOptions::from_str(&db_url)
        .map_err(|e| format!("Failed to parse connection options: {}", e))?
        .create_if_missing(true);

    // Create connection pool
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(connect_options)
        .await
        .map_err(|e| format!("Failed to create connection pool: {}", e))?;

    // Run migrations
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS threads (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        );
        "#,
    )
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to create threads table: {}", e))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
        );
        "#,
    )
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to create messages table: {}", e))?;

    // Create indexes
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);")
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create thread_id index: {}", e))?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);")
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create created_at index: {}", e))?;

    // Store pool globally
    DB_POOL
        .get_or_init(|| Mutex::new(None))
        .lock()
        .await
        .replace(pool);

    log::info!("SQLite database initialized successfully for mobile platform");
    Ok(())
}

/// Get database pool
async fn get_pool() -> Result<SqlitePool, String> {
    let pool_mutex = DB_POOL.get().ok_or("Database not initialized")?;

    let pool_guard = pool_mutex.lock().await;
    pool_guard
        .clone()
        .ok_or("Database pool not available".to_string())
}

/// List all threads from database
pub async fn db_list_threads<R: Runtime>(_app_handle: AppHandle<R>) -> Result<Vec<Value>, String> {
    let pool = get_pool().await?;

    let rows = sqlx::query("SELECT data FROM threads ORDER BY updated_at DESC")
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to list threads: {}", e))?;

    let threads: Result<Vec<Value>, _> = rows
        .iter()
        .map(|row| {
            let data: String = row.get("data");
            serde_json::from_str(&data).map_err(|e| e.to_string())
        })
        .collect();

    threads
}

/// Create a new thread in database
pub async fn db_create_thread<R: Runtime>(
    _app_handle: AppHandle<R>,
    thread: Value,
) -> Result<Value, String> {
    let pool = get_pool().await?;

    let thread_id = thread
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Missing thread id")?;

    let data = serde_json::to_string(&thread).map_err(|e| e.to_string())?;

    sqlx::query("INSERT INTO threads (id, data) VALUES (?1, ?2)")
        .bind(thread_id)
        .bind(&data)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create thread: {}", e))?;

    Ok(thread)
}

/// Modify an existing thread in database
pub async fn db_modify_thread<R: Runtime>(
    _app_handle: AppHandle<R>,
    thread: Value,
) -> Result<(), String> {
    let pool = get_pool().await?;

    let thread_id = thread
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Missing thread id")?;

    let data = serde_json::to_string(&thread).map_err(|e| e.to_string())?;

    sqlx::query("UPDATE threads SET data = ?1, updated_at = strftime('%s', 'now') WHERE id = ?2")
        .bind(&data)
        .bind(thread_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to modify thread: {}", e))?;

    Ok(())
}

/// Delete a thread from database
pub async fn db_delete_thread<R: Runtime>(
    _app_handle: AppHandle<R>,
    thread_id: &str,
) -> Result<(), String> {
    let pool = get_pool().await?;

    // Messages will be auto-deleted via CASCADE
    sqlx::query("DELETE FROM threads WHERE id = ?1")
        .bind(thread_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to delete thread: {}", e))?;

    Ok(())
}

/// List all messages for a thread from database
pub async fn db_list_messages<R: Runtime>(
    _app_handle: AppHandle<R>,
    thread_id: &str,
) -> Result<Vec<Value>, String> {
    let pool = get_pool().await?;

    let rows =
        sqlx::query("SELECT data FROM messages WHERE thread_id = ?1 ORDER BY created_at ASC")
            .bind(thread_id)
            .fetch_all(&pool)
            .await
            .map_err(|e| format!("Failed to list messages: {}", e))?;

    let messages: Result<Vec<Value>, _> = rows
        .iter()
        .map(|row| {
            let data: String = row.get("data");
            serde_json::from_str(&data).map_err(|e| e.to_string())
        })
        .collect();

    messages
}

/// Create a new message in database
pub async fn db_create_message<R: Runtime>(
    _app_handle: AppHandle<R>,
    message: Value,
) -> Result<Value, String> {
    let pool = get_pool().await?;

    let message_id = message
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Missing message id")?;

    let thread_id = message
        .get("thread_id")
        .and_then(|v| v.as_str())
        .ok_or("Missing thread_id")?;

    let data = serde_json::to_string(&message).map_err(|e| e.to_string())?;

    sqlx::query("INSERT INTO messages (id, thread_id, data) VALUES (?1, ?2, ?3)")
        .bind(message_id)
        .bind(thread_id)
        .bind(&data)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to create message: {}", e))?;

    Ok(message)
}

/// Modify an existing message in database
pub async fn db_modify_message<R: Runtime>(
    _app_handle: AppHandle<R>,
    message: Value,
) -> Result<Value, String> {
    let pool = get_pool().await?;

    let message_id = message
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Missing message id")?;

    let data = serde_json::to_string(&message).map_err(|e| e.to_string())?;

    sqlx::query("UPDATE messages SET data = ?1 WHERE id = ?2")
        .bind(&data)
        .bind(message_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to modify message: {}", e))?;

    Ok(message)
}

/// Delete a message from database
pub async fn db_delete_message<R: Runtime>(
    _app_handle: AppHandle<R>,
    _thread_id: &str,
    message_id: &str,
) -> Result<(), String> {
    let pool = get_pool().await?;

    sqlx::query("DELETE FROM messages WHERE id = ?1")
        .bind(message_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to delete message: {}", e))?;

    Ok(())
}

/// Get thread assistant information from thread metadata
pub async fn db_get_thread_assistant<R: Runtime>(
    _app_handle: AppHandle<R>,
    thread_id: &str,
) -> Result<Value, String> {
    let pool = get_pool().await?;

    let row = sqlx::query("SELECT data FROM threads WHERE id = ?1")
        .bind(thread_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| format!("Failed to get thread: {}", e))?
        .ok_or("Thread not found")?;

    let data: String = row.get("data");
    let thread: Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;

    if let Some(assistants) = thread.get("assistants").and_then(|a| a.as_array()) {
        assistants
            .first()
            .cloned()
            .ok_or("Assistant not found".to_string())
    } else {
        Err("Assistant not found".to_string())
    }
}

/// Create thread assistant in database
pub async fn db_create_thread_assistant<R: Runtime>(
    app_handle: AppHandle<R>,
    thread_id: &str,
    assistant: Value,
) -> Result<Value, String> {
    let pool = get_pool().await?;

    let row = sqlx::query("SELECT data FROM threads WHERE id = ?1")
        .bind(thread_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| format!("Failed to get thread: {}", e))?
        .ok_or("Thread not found")?;

    let data: String = row.get("data");
    let mut thread: Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;

    if let Some(assistants) = thread.get_mut("assistants").and_then(|a| a.as_array_mut()) {
        assistants.push(assistant.clone());
    } else {
        thread["assistants"] = Value::Array(vec![assistant.clone()]);
    }

    db_modify_thread(app_handle, thread).await?;
    Ok(assistant)
}

/// Modify thread assistant in database
pub async fn db_modify_thread_assistant<R: Runtime>(
    app_handle: AppHandle<R>,
    thread_id: &str,
    assistant: Value,
) -> Result<Value, String> {
    let pool = get_pool().await?;

    let row = sqlx::query("SELECT data FROM threads WHERE id = ?1")
        .bind(thread_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| format!("Failed to get thread: {}", e))?
        .ok_or("Thread not found")?;

    let data: String = row.get("data");
    let mut thread: Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;

    let assistant_id = assistant
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Missing assistant id")?;

    if let Some(assistants) = thread.get_mut("assistants").and_then(|a| a.as_array_mut()) {
        if let Some(index) = assistants
            .iter()
            .position(|a| a.get("id").and_then(|v| v.as_str()) == Some(assistant_id))
        {
            assistants[index] = assistant.clone();
            db_modify_thread(app_handle, thread).await?;
        }
    }

    Ok(assistant)
}
