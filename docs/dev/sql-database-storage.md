# SQL Database Storage for Conversations

This document provides a comprehensive guide to how Jan uses SQLite for storing conversations on mobile platforms (Android and iOS).

## Table of Contents

1. [Overview](#overview)
2. [Database Architecture](#database-architecture)
3. [Schema Design](#schema-design)
4. [Connection Management](#connection-management)
5. [CRUD Operations](#crud-operations)
6. [Migration Strategy](#migration-strategy)
7. [Performance Optimizations](#performance-optimizations)
8. [Platform Detection](#platform-detection)
9. [Error Handling](#error-handling)
10. [Comparison with File-Based Storage](#comparison-with-file-based-storage)

---

## Overview

### Why SQLite for Mobile?

Jan uses **SQLite** exclusively for mobile platforms (Android and iOS) while desktop platforms use file-based JSONL storage. This dual-strategy approach leverages the strengths of each storage method:

**SQLite Advantages for Mobile:**
- **ACID Guarantees**: Atomic transactions prevent data corruption
- **Efficient Queries**: SQL indexes enable fast lookups and filtering
- **Concurrent Access**: Better handling of simultaneous reads/writes
- **Data Integrity**: Foreign key constraints ensure referential integrity
- **Storage Efficiency**: Binary format more space-efficient than text files
- **Platform Native**: Android and iOS have optimized SQLite support

**Implementation Location:**
- Primary file: `src-tauri/src/core/threads/db.rs`
- Helper utilities: `src-tauri/src/core/threads/helpers.rs`
- Platform detection: `should_use_sqlite()` function

---

## Database Architecture

### File Location

```rust
// Database path construction
pub async fn init_database<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    
    let db_path = app_data_dir.join("jan.db");
    let db_url = format!("sqlite:{}", db_path.display());
    
    // Example paths:
    // Android: /data/data/ai.jan.app/files/jan.db
    // iOS: ~/Library/Application Support/ai.jan.app/jan.db
}
```

### Database Lifecycle

```
App Launch (Mobile)
    ↓
should_use_sqlite() returns true
    ↓
init_database() called
    ↓
Create/Open jan.db
    ↓
Run migrations (schema creation)
    ↓
Initialize connection pool (max 5 connections)
    ↓
Database ready for operations
```

---

## Schema Design

### Tables Overview

The database consists of two primary tables with a one-to-many relationship:

```
threads (1) ────────→ (N) messages
   ↑                        ↓
   │                   thread_id FK
   │                   ON DELETE CASCADE
   └────────────────────────┘
```

### Threads Table

**Purpose**: Stores thread metadata including title, configuration, and timestamps.

```sql
CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,                                    -- ULID identifier
    data TEXT NOT NULL,                                     -- JSON blob
    created_at INTEGER DEFAULT (strftime('%s', 'now')),     -- Unix timestamp
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))      -- Unix timestamp
);
```

**Data Column Structure** (JSON blob):
```json
{
  "id": "01JCXYZ123ABC",
  "object": "thread",
  "title": "Conversation about AI Ethics",
  "assistants": [
    {
      "assistant_id": "jan",
      "assistant_name": "Jan",
      "model": {
        "id": "llama-3-8b-instruct",
        "settings": {
          "ctx_len": 4096,
          "temperature": 0.7,
          "top_p": 0.95,
          "stream": true
        },
        "parameters": {
          "max_tokens": 2048,
          "stop": ["<|eot_id|>"],
          "frequency_penalty": 0,
          "presence_penalty": 0
        },
        "engine": "nitro"
      }
    }
  ],
  "created": 1699564800,
  "updated": 1699568400,
  "metadata": {
    "hasDocuments": false,
    "lastMessage": "What are the ethical implications?"
  }
}
```

**Column Details:**
- `id`: Unique identifier using ULID format (lexicographically sortable)
- `data`: Complete thread object serialized as JSON
- `created_at`: Automatic timestamp on row creation
- `updated_at`: Updated via triggers or manual updates

### Messages Table

**Purpose**: Stores individual messages within threads, linked via foreign key.

```sql
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,                                    -- ULID identifier
    thread_id TEXT NOT NULL,                                -- Foreign key to threads
    data TEXT NOT NULL,                                     -- JSON blob
    created_at INTEGER DEFAULT (strftime('%s', 'now')),     -- Unix timestamp
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);
```

**Data Column Structure** (JSON blob):
```json
{
  "id": "01JCXYZ456DEF",
  "object": "thread.message",
  "thread_id": "01JCXYZ123ABC",
  "role": "user",
  "status": "ready",
  "content": [
    {
      "type": "text",
      "text": {
        "value": "What are the ethical implications of AI?",
        "annotations": []
      }
    }
  ],
  "created_at": 1699564801,
  "completed_at": 1699564801,
  "metadata": {}
}
```

**Assistant Message Example** (with tool calls):
```json
{
  "id": "01JCXYZ789GHI",
  "object": "thread.message",
  "thread_id": "01JCXYZ123ABC",
  "role": "assistant",
  "status": "ready",
  "content": [
    {
      "type": "text",
      "text": {
        "value": "Let me search for information about AI ethics.",
        "annotations": []
      }
    }
  ],
  "created_at": 1699564802,
  "completed_at": 1699564805,
  "metadata": {
    "tool_calls": [
      {
        "id": "call_abc123",
        "type": "function",
        "function": {
          "name": "web_search",
          "arguments": "{\"query\": \"AI ethics implications\"}"
        }
      }
    ]
  }
}
```

**Multimodal Message Example** (text + image):
```json
{
  "id": "01JCXYZ012JKL",
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": {
        "value": "What's in this image?",
        "annotations": []
      }
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "file:///storage/emulated/0/DCIM/photo.jpg",
        "detail": "auto"
      }
    }
  ],
  "created_at": 1699564810
}
```

**Foreign Key Constraint:**
- `FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE`
- When a thread is deleted, **all associated messages are automatically deleted**
- Ensures referential integrity - no orphaned messages

### Indexes

**Purpose**: Optimize query performance for common access patterns.

```sql
-- Index for retrieving messages by thread
CREATE INDEX IF NOT EXISTS idx_messages_thread_id 
ON messages(thread_id);

-- Index for sorting messages chronologically
CREATE INDEX IF NOT EXISTS idx_messages_created_at 
ON messages(created_at);
```

**Query Performance Impact:**

Without indexes:
```sql
-- Full table scan - O(n)
SELECT * FROM messages WHERE thread_id = '01JCXYZ123ABC';
```

With `idx_messages_thread_id`:
```sql
-- Index seek - O(log n)
SELECT * FROM messages WHERE thread_id = '01JCXYZ123ABC';
```

**Composite Query Optimization:**
```sql
-- Benefits from both indexes
SELECT * FROM messages 
WHERE thread_id = '01JCXYZ123ABC' 
ORDER BY created_at ASC;
```

---

## Connection Management

### Connection Pool

Jan uses **sqlx** with a connection pool to efficiently manage database connections:

```rust
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions, SqliteConnectOptions};
use std::sync::OnceLock;
use tokio::sync::Mutex;

// Global singleton pool
static DB_POOL: OnceLock<Mutex<Option<SqlitePool>>> = OnceLock::new();

pub async fn init_database<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    // Configure connection options
    let connect_options = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .foreign_keys(true);  // Enable foreign key constraints
    
    // Create connection pool
    let pool = SqlitePoolOptions::new()
        .max_connections(5)  // Maximum 5 concurrent connections
        .connect_with(connect_options)
        .await
        .map_err(|e| format!("Failed to create pool: {}", e))?;
    
    // Run migrations (create tables, indexes)
    run_migrations(&pool).await?;
    
    // Store pool globally
    DB_POOL
        .get_or_init(|| Mutex::new(None))
        .lock()
        .await
        .replace(pool);
    
    Ok(())
}
```

### Pool Configuration Rationale

**Why 5 connections?**
- **Mobile constraints**: Limited resources compared to desktop
- **SQLite limitations**: Write operations serialize anyway (single-writer)
- **Read concurrency**: Multiple reads can happen simultaneously
- **Memory overhead**: Each connection has overhead (~100KB+)

**Connection Lifecycle:**
```
Request arrives
    ↓
pool.acquire() - Wait for available connection
    ↓
Execute query
    ↓
Connection returned to pool automatically (RAII)
```

### Retrieving Pool

```rust
async fn get_pool() -> Result<SqlitePool, String> {
    DB_POOL
        .get()
        .ok_or_else(|| "Database not initialized".to_string())?
        .lock()
        .await
        .clone()
        .ok_or_else(|| "Database pool is None".to_string())
}
```

**Usage Pattern:**
```rust
pub async fn db_list_threads<R: Runtime>(
    _app_handle: AppHandle<R>,
) -> Result<Vec<Value>, String> {
    let pool = get_pool().await?;  // Acquire pool
    
    let rows = sqlx::query("SELECT data FROM threads ORDER BY updated_at DESC")
        .fetch_all(&pool)  // Connection auto-acquired and released
        .await
        .map_err(|e| e.to_string())?;
    
    // Process rows...
    Ok(threads)
}
```

---

## CRUD Operations

### Create Operations

#### Create Thread

```rust
pub async fn db_create_thread<R: Runtime>(
    _app_handle: AppHandle<R>,
    thread: Value,
) -> Result<Value, String> {
    let pool = get_pool().await?;
    
    // Extract thread ID from JSON
    let thread_id: String = thread["id"]
        .as_str()
        .ok_or("Thread ID missing")?
        .to_string();
    
    // Serialize thread object to JSON string
    let data = serde_json::to_string(&thread)
        .map_err(|e| format!("JSON serialization failed: {}", e))?;
    
    // Insert into database
    sqlx::query(
        "INSERT INTO threads (id, data) VALUES (?1, ?2)"
    )
    .bind(&thread_id)
    .bind(&data)
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to create thread: {}", e))?;
    
    Ok(thread)
}
```

**Transaction Safety:**
- Single INSERT is atomic by default
- No explicit transaction needed for single operation
- Failures roll back automatically

#### Create Message

```rust
pub async fn db_create_message<R: Runtime>(
    _app_handle: AppHandle<R>,
    thread_id: String,
    message: Value,
) -> Result<Value, String> {
    let pool = get_pool().await?;
    
    let message_id: String = message["id"]
        .as_str()
        .ok_or("Message ID missing")?
        .to_string();
    
    let data = serde_json::to_string(&message)
        .map_err(|e| format!("JSON serialization failed: {}", e))?;
    
    // Insert message
    sqlx::query(
        "INSERT INTO messages (id, thread_id, data) VALUES (?1, ?2, ?3)"
    )
    .bind(&message_id)
    .bind(&thread_id)
    .bind(&data)
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to create message: {}", e))?;
    
    // Update parent thread's updated_at timestamp
    sqlx::query(
        "UPDATE threads SET updated_at = strftime('%s', 'now') WHERE id = ?1"
    )
    .bind(&thread_id)
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to update thread timestamp: {}", e))?;
    
    Ok(message)
}
```

**Foreign Key Validation:**
- If `thread_id` doesn't exist in `threads` table, INSERT fails
- Ensures data integrity - can't create orphaned messages

### Read Operations

#### List All Threads

```rust
pub async fn db_list_threads<R: Runtime>(
    _app_handle: AppHandle<R>,
) -> Result<Vec<Value>, String> {
    let pool = get_pool().await?;
    
    // Query all threads, ordered by most recently updated
    let rows = sqlx::query(
        "SELECT data FROM threads ORDER BY updated_at DESC"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to list threads: {}", e))?;
    
    // Deserialize JSON blobs
    let threads: Vec<Value> = rows
        .iter()
        .filter_map(|row| {
            let data: String = row.get("data");
            serde_json::from_str(&data).ok()
        })
        .collect();
    
    Ok(threads)
}
```

**Performance:**
- Uses `idx_messages_created_at` for efficient sorting
- Returns full thread objects (all metadata)
- O(n log n) for sorting, but n is typically small (< 1000 threads)

#### Retrieve Single Thread

```rust
pub async fn db_get_thread<R: Runtime>(
    _app_handle: AppHandle<R>,
    thread_id: String,
) -> Result<Value, String> {
    let pool = get_pool().await?;
    
    let row = sqlx::query(
        "SELECT data FROM threads WHERE id = ?1"
    )
    .bind(&thread_id)
    .fetch_one(&pool)
    .await
    .map_err(|e| format!("Thread not found: {}", e))?;
    
    let data: String = row.get("data");
    let thread: Value = serde_json::from_str(&data)
        .map_err(|e| format!("JSON deserialization failed: {}", e))?;
    
    Ok(thread)
}
```

**Error Handling:**
- `fetch_one()` returns error if no rows found
- Appropriate for cases where thread must exist
- Use `fetch_optional()` for "may not exist" scenarios

#### List Messages for Thread

```rust
pub async fn db_list_messages<R: Runtime>(
    _app_handle: AppHandle<R>,
    thread_id: String,
) -> Result<Vec<Value>, String> {
    let pool = get_pool().await?;
    
    let rows = sqlx::query(
        "SELECT data FROM messages 
         WHERE thread_id = ?1 
         ORDER BY created_at ASC"
    )
    .bind(&thread_id)
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("Failed to list messages: {}", e))?;
    
    let messages: Vec<Value> = rows
        .iter()
        .filter_map(|row| {
            let data: String = row.get("data");
            serde_json::from_str(&data).ok()
        })
        .collect();
    
    Ok(messages)
}
```

**Index Utilization:**
- `WHERE thread_id = ?1` uses `idx_messages_thread_id`
- `ORDER BY created_at` uses `idx_messages_created_at`
- Efficient even for threads with hundreds of messages

### Update Operations

#### Update Thread

```rust
pub async fn db_update_thread<R: Runtime>(
    _app_handle: AppHandle<R>,
    thread_id: String,
    thread: Value,
) -> Result<Value, String> {
    let pool = get_pool().await?;
    
    let data = serde_json::to_string(&thread)
        .map_err(|e| format!("JSON serialization failed: {}", e))?;
    
    sqlx::query(
        "UPDATE threads 
         SET data = ?1, updated_at = strftime('%s', 'now') 
         WHERE id = ?2"
    )
    .bind(&data)
    .bind(&thread_id)
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to update thread: {}", e))?;
    
    Ok(thread)
}
```

**Timestamp Management:**
- `updated_at` automatically updated with current timestamp
- Uses SQLite's `strftime('%s', 'now')` for consistency
- All timestamps in Unix epoch format (seconds since 1970-01-01)

### Delete Operations

#### Delete Thread (Cascade)

```rust
pub async fn db_delete_thread<R: Runtime>(
    _app_handle: AppHandle<R>,
    thread_id: String,
) -> Result<(), String> {
    let pool = get_pool().await?;
    
    // Single DELETE cascades to messages automatically
    sqlx::query("DELETE FROM threads WHERE id = ?1")
        .bind(&thread_id)
        .execute(&pool)
        .await
        .map_err(|e| format!("Failed to delete thread: {}", e))?;
    
    Ok(())
}
```

**Cascade Behavior:**
```sql
-- What happens internally:
DELETE FROM threads WHERE id = '01JCXYZ123ABC';
-- SQLite automatically executes:
DELETE FROM messages WHERE thread_id = '01JCXYZ123ABC';
```

**Advantages:**
- Single query deletes thread + all messages
- Atomic operation - either all deleted or none
- No orphaned messages possible
- Efficient - single transaction

#### Delete Individual Message

```rust
pub async fn db_delete_message<R: Runtime>(
    _app_handle: AppHandle<R>,
    thread_id: String,
    message_id: String,
) -> Result<(), String> {
    let pool = get_pool().await?;
    
    sqlx::query(
        "DELETE FROM messages WHERE id = ?1 AND thread_id = ?2"
    )
    .bind(&message_id)
    .bind(&thread_id)
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to delete message: {}", e))?;
    
    // Update parent thread timestamp
    sqlx::query(
        "UPDATE threads SET updated_at = strftime('%s', 'now') WHERE id = ?1"
    )
    .bind(&thread_id)
    .execute(&pool)
    .await
    .map_err(|e| format!("Failed to update thread timestamp: {}", e))?;
    
    Ok(())
}
```

**Double-Check Safety:**
- Requires both `message_id` AND `thread_id` to match
- Prevents accidental deletion of wrong message
- Updates parent thread timestamp for UI refresh

---

## Migration Strategy

### Initial Schema Creation

```rust
async fn run_migrations(pool: &SqlitePool) -> Result<(), String> {
    // Create threads table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS threads (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )"
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create threads table: {}", e))?;
    
    // Create messages table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            thread_id TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
        )"
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create messages table: {}", e))?;
    
    // Create indexes
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_messages_thread_id 
         ON messages(thread_id)"
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create thread_id index: {}", e))?;
    
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_messages_created_at 
         ON messages(created_at)"
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create created_at index: {}", e))?;
    
    Ok(())
}
```

### Future Migrations

**Versioning Approach** (recommended for future schema changes):

```rust
// Migration version tracking table
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER DEFAULT (strftime('%s', 'now'))
);

// Migration runner
async fn run_migrations(pool: &SqlitePool) -> Result<(), String> {
    let current_version = get_schema_version(pool).await?;
    
    // Migration 1: Initial schema
    if current_version < 1 {
        create_initial_schema(pool).await?;
        set_schema_version(pool, 1).await?;
    }
    
    // Migration 2: Add new column (example)
    if current_version < 2 {
        sqlx::query(
            "ALTER TABLE threads ADD COLUMN archived INTEGER DEFAULT 0"
        )
        .execute(pool)
        .await?;
        set_schema_version(pool, 2).await?;
    }
    
    // Future migrations here...
    
    Ok(())
}
```

**Best Practices:**
- Always use `CREATE TABLE IF NOT EXISTS` for idempotency
- Never drop columns (SQLite doesn't support it easily)
- Add new columns with DEFAULT values
- Create new tables/indexes only if not exist
- Version migrations for auditing

---

## Performance Optimizations

### Query Performance Tips

#### 1. Use Prepared Statements (Automatic with sqlx)

```rust
// ✓ Good - Parameterized query (sqlx auto-prepares)
sqlx::query("SELECT * FROM messages WHERE thread_id = ?1")
    .bind(&thread_id)
    .fetch_all(&pool)
    .await?;

// ✗ Bad - String concatenation (SQL injection risk + no caching)
let query = format!("SELECT * FROM messages WHERE thread_id = '{}'", thread_id);
sqlx::query(&query).fetch_all(&pool).await?;
```

**Benefits:**
- Query plan cached by SQLite
- Protection against SQL injection
- Faster execution for repeated queries

#### 2. Batch Inserts for Multiple Messages

```rust
// ✓ Efficient - Single transaction
async fn batch_insert_messages(
    pool: &SqlitePool,
    thread_id: &str,
    messages: &[Value],
) -> Result<(), String> {
    let mut tx = pool.begin().await?;
    
    for message in messages {
        let id: String = message["id"].as_str().unwrap().to_string();
        let data = serde_json::to_string(message)?;
        
        sqlx::query("INSERT INTO messages (id, thread_id, data) VALUES (?1, ?2, ?3)")
            .bind(&id)
            .bind(thread_id)
            .bind(&data)
            .execute(&mut *tx)
            .await?;
    }
    
    tx.commit().await?;
    Ok(())
}

// ✗ Slow - Individual transactions
async fn slow_insert_messages(pool: &SqlitePool, messages: &[Value]) {
    for message in messages {
        db_create_message(message).await?;  // Each is a separate transaction
    }
}
```

**Performance Impact:**
- 100 messages: ~10x faster with batching
- Single fsync vs. 100 fsyncs

#### 3. Use Covering Indexes When Possible

```sql
-- If you frequently query thread_id and created_at together:
CREATE INDEX idx_messages_thread_created 
ON messages(thread_id, created_at);

-- Query can be satisfied entirely from index:
SELECT created_at FROM messages WHERE thread_id = ?1;
```

#### 4. VACUUM Periodically

```rust
// Reclaim space from deleted rows
pub async fn vacuum_database() -> Result<(), String> {
    let pool = get_pool().await?;
    sqlx::query("VACUUM").execute(&pool).await?;
    Ok(())
}
```

**When to VACUUM:**
- After deleting many threads/messages
- App startup (if not done recently)
- User-triggered "optimize storage" action

### Memory Optimizations

#### 1. Lazy Loading Messages

```rust
// ✓ Load messages only when thread is opened
pub async fn open_thread(thread_id: &str) -> Result<Thread, String> {
    let thread = db_get_thread(thread_id).await?;
    // Messages loaded separately, on-demand
    Ok(thread)
}

// Later, when user views thread:
pub async fn load_messages(thread_id: &str) -> Result<Vec<Message>, String> {
    db_list_messages(thread_id).await
}
```

#### 2. Pagination for Large Threads

```rust
pub async fn db_list_messages_paginated<R: Runtime>(
    _app_handle: AppHandle<R>,
    thread_id: String,
    limit: i32,
    offset: i32,
) -> Result<Vec<Value>, String> {
    let pool = get_pool().await?;
    
    let rows = sqlx::query(
        "SELECT data FROM messages 
         WHERE thread_id = ?1 
         ORDER BY created_at ASC 
         LIMIT ?2 OFFSET ?3"
    )
    .bind(&thread_id)
    .bind(limit)
    .bind(offset)
    .fetch_all(&pool)
    .await?;
    
    // Deserialize...
    Ok(messages)
}
```

**Use Case:**
- Threads with 1000+ messages
- Load most recent 50 initially
- Load more on scroll (infinite scroll pattern)

---

## Platform Detection

### How Platform is Determined

```rust
// src-tauri/src/core/threads/helpers.rs

pub fn should_use_sqlite() -> bool {
    cfg!(target_os = "android") || cfg!(target_os = "ios")
}
```

**Compile-Time Detection:**
- `cfg!(target_os = "android")` - True when compiling for Android
- `cfg!(target_os = "ios")` - True when compiling for iOS
- Desktop platforms (macOS, Windows, Linux) return `false`

### Abstraction Layer

Frontend code doesn't need to know which storage backend is used:

```typescript
// web-app/src/services/threads.ts
class ThreadService {
  async list(): Promise<Thread[]> {
    // Tauri command routes to appropriate backend
    return invoke('list_threads')
  }
  
  async create(thread: Thread): Promise<Thread> {
    return invoke('create_thread', { thread })
  }
}
```

**Backend Routing** (`src-tauri/src/core/threads/commands.rs`):
```rust
#[tauri::command]
pub async fn list_threads<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Vec<Value>, String> {
    if should_use_sqlite() {
        db_list_threads(app).await  // SQLite implementation
    } else {
        file_list_threads(app).await  // JSONL implementation
    }
}
```

**Benefits:**
- Single API for frontend
- Platform-specific optimizations
- Easy to add new backends
- Testing with either backend

---

## Error Handling

### Database Errors

```rust
// Connection errors
pub async fn init_database<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(connect_options)
        .await
        .map_err(|e| {
            eprintln!("Database connection failed: {}", e);
            format!("Failed to initialize database: {}", e)
        })?;
    
    Ok(())
}

// Query errors
pub async fn db_get_thread<R: Runtime>(
    _app_handle: AppHandle<R>,
    thread_id: String,
) -> Result<Value, String> {
    let pool = get_pool().await?;
    
    let row = sqlx::query("SELECT data FROM threads WHERE id = ?1")
        .bind(&thread_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| {
            match e {
                sqlx::Error::RowNotFound => {
                    format!("Thread '{}' not found", thread_id)
                },
                _ => {
                    eprintln!("Database error: {}", e);
                    format!("Failed to retrieve thread: {}", e)
                }
            }
        })?;
    
    Ok(thread)
}
```

### Common Error Scenarios

#### 1. Foreign Key Violation

```rust
// Trying to insert message with non-existent thread_id
sqlx::query("INSERT INTO messages (id, thread_id, data) VALUES (?1, ?2, ?3)")
    .bind("msg_123")
    .bind("nonexistent_thread")  // ← This thread doesn't exist
    .bind("{}")
    .execute(&pool)
    .await?;

// Error: FOREIGN KEY constraint failed
```

**Handling:**
```rust
.map_err(|e| {
    if e.to_string().contains("FOREIGN KEY constraint") {
        "Thread does not exist. Please create thread first.".to_string()
    } else {
        e.to_string()
    }
})
```

#### 2. Unique Constraint Violation

```rust
// Trying to insert thread with duplicate ID
sqlx::query("INSERT INTO threads (id, data) VALUES (?1, ?2)")
    .bind("thread_123")  // ← Already exists
    .bind("{}")
    .execute(&pool)
    .await?;

// Error: UNIQUE constraint failed: threads.id
```

**Handling with Upsert:**
```rust
sqlx::query(
    "INSERT INTO threads (id, data) VALUES (?1, ?2)
     ON CONFLICT(id) DO UPDATE SET 
        data = excluded.data,
        updated_at = strftime('%s', 'now')"
)
.bind(&thread_id)
.bind(&data)
.execute(&pool)
.await?;
```

#### 3. JSON Deserialization Errors

```rust
let data: String = row.get("data");
let thread: Value = serde_json::from_str(&data)
    .map_err(|e| {
        eprintln!("Corrupted data in database: {}", e);
        format!("Failed to parse thread data: {}", e)
    })?;
```

**Prevention:**
- Validate JSON before inserting
- Use strong typing (structs instead of `Value`)
- Database schema validation triggers

---

## Comparison with File-Based Storage

### Desktop (JSONL Files) vs Mobile (SQLite)

| Aspect | JSONL Files (Desktop) | SQLite (Mobile) |
|--------|----------------------|-----------------|
| **Storage** | `threads/{id}/messages.jsonl` | `jan.db` single file |
| **Format** | Text (JSON Lines) | Binary (SQLite) |
| **Querying** | Read entire file, filter in-memory | SQL queries with indexes |
| **Concurrency** | Mutex locks per thread | Connection pool, SQLite locks |
| **Integrity** | Manual (file write atomicity) | ACID guarantees, foreign keys |
| **Performance** | Fast for small threads | Scales better for many threads |
| **Debuggability** | Human-readable (cat, grep work) | Requires SQLite tools |
| **Storage Size** | Larger (pretty JSON, overhead) | Smaller (binary, compressed) |
| **Portability** | Easy to copy/backup | Single file, easy to backup |
| **Platform Fit** | Desktop file systems | Mobile optimized |

### Migration Between Storage Types

**Export from SQLite to JSONL** (for debugging or backup):

```rust
pub async fn export_to_jsonl<R: Runtime>(
    app: AppHandle<R>,
    output_dir: PathBuf,
) -> Result<(), String> {
    let threads = db_list_threads(app.clone()).await?;
    
    for thread in threads {
        let thread_id = thread["id"].as_str().unwrap();
        let messages = db_list_messages(app.clone(), thread_id.to_string()).await?;
        
        // Create directory
        let thread_dir = output_dir.join(thread_id);
        fs::create_dir_all(&thread_dir)?;
        
        // Write thread.json
        let thread_path = thread_dir.join("thread.json");
        fs::write(&thread_path, serde_json::to_string_pretty(&thread)?)?;
        
        // Write messages.jsonl
        let messages_path = thread_dir.join("messages.jsonl");
        let mut file = File::create(&messages_path)?;
        for msg in messages {
            writeln!(file, "{}", serde_json::to_string(&msg)?)?;
        }
    }
    
    Ok(())
}
```

**Import from JSONL to SQLite**:

```rust
pub async fn import_from_jsonl<R: Runtime>(
    app: AppHandle<R>,
    input_dir: PathBuf,
) -> Result<(), String> {
    let pool = get_pool().await?;
    
    for entry in fs::read_dir(input_dir)? {
        let thread_dir = entry?.path();
        let thread_id = thread_dir.file_name().unwrap().to_str().unwrap();
        
        // Read thread.json
        let thread_path = thread_dir.join("thread.json");
        let thread_data = fs::read_to_string(&thread_path)?;
        let thread: Value = serde_json::from_str(&thread_data)?;
        
        // Insert thread
        db_create_thread(app.clone(), thread).await?;
        
        // Read messages.jsonl
        let messages_path = thread_dir.join("messages.jsonl");
        let file = File::open(&messages_path)?;
        let reader = BufReader::new(file);
        
        for line in reader.lines() {
            let message: Value = serde_json::from_str(&line?)?;
            db_create_message(app.clone(), thread_id.to_string(), message).await?;
        }
    }
    
    Ok(())
}
```

---

## Best Practices

### For Mobile Development

1. **Initialize Early**: Call `init_database()` on app launch, before any thread operations
2. **Handle Disconnections**: Mobile apps can be suspended - reconnect gracefully
3. **Batch Operations**: Group multiple writes into transactions for efficiency
4. **Lazy Load**: Don't load all threads/messages at startup - paginate
5. **VACUUM Periodically**: Especially after bulk deletions
6. **Test Migrations**: Ensure schema migrations work on existing user databases

### For Database Queries

1. **Always Use Parameterized Queries**: Prevents SQL injection, enables caching
2. **Leverage Indexes**: Ensure WHERE/ORDER BY columns are indexed
3. **Avoid SELECT ***: Specify columns needed (though with JSON blobs, less relevant)
4. **Use Transactions**: For multi-step operations that must be atomic
5. **Handle Errors Gracefully**: Provide user-friendly messages, log technical details

### For Data Integrity

1. **Validate Before Insert**: Check JSON structure before writing to database
2. **Use Foreign Keys**: Enabled by default, ensures referential integrity
3. **ON DELETE CASCADE**: Automatically cleanup related data
4. **Timestamp Consistency**: Use SQLite's `strftime('%s', 'now')` for uniformity
5. **Unique IDs**: Use ULIDs or UUIDs, never sequential integers for distributed systems

---

## Future Enhancements

### Potential Improvements

1. **Full-Text Search**:
```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(
    message_id UNINDEXED,
    content,
    content='messages',
    content_rowid='id'
);

-- Search across all messages
SELECT * FROM messages_fts WHERE content MATCH 'AI ethics';
```

2. **Attachment Storage**:
```sql
CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    type TEXT NOT NULL,  -- 'image', 'document', 'audio'
    url TEXT NOT NULL,
    metadata TEXT,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);
```

3. **Thread Statistics**:
```sql
-- Materialized view for thread stats
CREATE TABLE thread_stats (
    thread_id TEXT PRIMARY KEY,
    message_count INTEGER,
    last_message_at INTEGER,
    total_tokens INTEGER,
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

-- Update via triggers
CREATE TRIGGER update_thread_stats_insert
AFTER INSERT ON messages
BEGIN
    INSERT INTO thread_stats (thread_id, message_count, last_message_at)
    VALUES (NEW.thread_id, 1, NEW.created_at)
    ON CONFLICT(thread_id) DO UPDATE SET
        message_count = message_count + 1,
        last_message_at = NEW.created_at;
END;
```

4. **Encryption at Rest**:
```rust
// Use SQLCipher for encrypted SQLite
let connect_options = SqliteConnectOptions::new()
    .filename(&db_path)
    .pragma("key", encryption_key);
```

---

## Summary

Jan's SQLite implementation for mobile provides:

✅ **ACID Compliance**: Transactional integrity for all operations  
✅ **Referential Integrity**: Foreign keys prevent orphaned data  
✅ **Performance**: Indexes enable efficient queries even with large datasets  
✅ **Scalability**: Connection pooling handles concurrent access  
✅ **Platform Optimization**: Binary storage ideal for mobile constraints  
✅ **Automatic Cleanup**: CASCADE deletes simplify data management  
✅ **Future-Proof**: Migration strategy supports schema evolution  

The dual-storage approach (SQLite for mobile, JSONL for desktop) demonstrates thoughtful platform-specific optimization while maintaining a unified API for the frontend.
