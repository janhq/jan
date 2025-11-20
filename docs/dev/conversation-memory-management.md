# Conversation Memory and Context Management in Jan

This document provides a comprehensive overview of how Jan manages conversation history, context windows, and memory for LLM interactions.

## Table of Contents

1. [Storage Architecture](#storage-architecture)
2. [Thread and Message Structure](#thread-and-message-structure)
3. [Context Window Management](#context-window-management)
4. [Message Flow and Processing](#message-flow-and-processing)
5. [KV Cache and Memory Optimization](#kv-cache-and-memory-optimization)
6. [Context Shift Mechanism](#context-shift-mechanism)
7. [Multi-Turn Conversations](#multi-turn-conversations)
8. [Performance Considerations](#performance-considerations)

---

## Storage Architecture

### Desktop vs Mobile Storage

Jan uses **different storage strategies** based on platform:

#### Desktop (macOS, Windows, Linux)

**File-Based Storage** (`src-tauri/src/core/threads/helpers.rs`):

```
<JanDataFolder>/threads/
  ├─ {thread-id}/
  │   ├─ thread.json          # Thread metadata
  │   └─ messages.jsonl       # Messages (JSON Lines format)
  └─ {another-thread-id}/
      ├─ thread.json
      └─ messages.jsonl
```

**thread.json Structure**:
```json
{
  "id": "01JCXYZ...",
  "object": "thread",
  "title": "Conversation about AI",
  "assistants": [{
    "assistant_id": "jan",
    "model": {
      "id": "llama-3-8b",
      "parameters": {...}
    }
  }],
  "created": 1699564800,
  "updated": 1699568400,
  "metadata": {
    "hasDocuments": true
  }
}
```

**messages.jsonl Format** (one JSON object per line):
```jsonl
{"id":"01JCXYZ1...","role":"user","content":[{"type":"text","text":{"value":"Hello"}}],"created_at":1699564800}
{"id":"01JCXYZ2...","role":"assistant","content":[{"type":"text","text":{"value":"Hi there!"}}],"created_at":1699564801}
```

**Key Implementation**:
```rust
// Read messages from JSONL file
pub fn read_messages_from_file<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    thread_id: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let path = get_messages_path(app_handle, thread_id);
    let file = File::open(&path)?;
    let reader = BufReader::new(file);
    
    let mut messages = Vec::new();
    for line in reader.lines() {
        let message: serde_json::Value = serde_json::from_str(&line?)?;
        messages.push(message);
    }
    Ok(messages)
}

// Write messages to JSONL file
pub fn write_messages_to_file(
    messages: &[serde_json::Value],
    path: &std::path::Path,
) -> Result<(), String> {
    let mut file = File::create(path)?;
    for msg in messages {
        writeln!(file, "{}", serde_json::to_string(msg)?)?;
    }
    Ok(())
}
```

**Thread-Safe Operations**:
```rust
// Global per-thread locks prevent concurrent writes
static MESSAGE_LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();

async fn get_lock_for_thread(thread_id: &str) -> Arc<Mutex<()>> {
    let locks = MESSAGE_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut locks = locks.lock().await;
    locks
        .entry(thread_id.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}
```

#### Mobile (Android, iOS)

**SQLite Database** (`src-tauri/src/core/threads/db.rs`):

```sql
-- Threads table
CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,              -- JSON blob
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- Messages table with foreign key
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    data TEXT NOT NULL,              -- JSON blob
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

-- Performance indexes
CREATE INDEX idx_messages_thread_id ON messages(thread_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
```

**Connection Pooling**:
```rust
static DB_POOL: OnceLock<Mutex<Option<SqlitePool>>> = OnceLock::new();

pub async fn init_database<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let db_path = app.path().app_data_dir()?.join("jan.db");
    let db_url = format!("sqlite:{}", db_path.display());
    
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(connect_options)
        .await?;
    
    DB_POOL.get_or_init(|| Mutex::new(None))
        .lock()
        .await
        .replace(pool);
    
    Ok(())
}
```

### Key Design Decisions

1. **No Summarization**: Messages are stored **verbatim** - there is no automatic summarization or compression of conversation history
2. **Complete History**: All messages in a thread are preserved indefinitely until manually deleted
3. **Platform Optimization**: File-based for desktop (simplicity, debuggability), SQLite for mobile (efficiency, ACID guarantees)
4. **Cascade Deletion**: Deleting a thread automatically removes all associated messages

---

## Thread and Message Structure

### Thread Object

**TypeScript Definition** (`@janhq/core`):
```typescript
interface Thread {
  id: string                    // ULID identifier
  object: 'thread'
  title: string                 // User-visible title
  assistants: Assistant[]       // Associated models/assistants
  created: number               // Unix timestamp
  updated: number               // Unix timestamp
  metadata?: {
    hasDocuments?: boolean      // RAG documents attached
    [key: string]: unknown
  }
}
```

### Message Object

**TypeScript Definition**:
```typescript
interface ThreadMessage {
  id: string                    // ULID identifier
  object: 'thread.message'
  thread_id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: MessageContent[]     // Multimodal content array
  status: MessageStatus
  created_at: number
  completed_at?: number
  metadata?: {
    error?: string
    tool_calls?: ToolCall[]
    reasoning?: string          // Chain-of-thought reasoning
    [key: string]: unknown
  }
}

// Content can be text, image, or tool result
type MessageContent = 
  | { type: 'text', text: { value: string, annotations: [] } }
  | { type: 'image_url', image_url: { url: string, detail: string } }
```

### Message Roles

1. **User** - Human input messages
   - Can contain text and images (multimodal)
   - Includes injected file metadata for RAG documents
2. **Assistant** - Model responses
   - Contains generated text
   - May include tool calls
   - May include reasoning (chain-of-thought)
3. **System** - System instructions
   - Optional, set per thread or model
   - Typically appears first in context
4. **Tool** - Tool execution results
   - Response to assistant tool calls
   - Links back to tool_call_id

---

## Context Window Management

### Understanding Context Windows

The **context window** (or context length) is the maximum number of tokens a model can process at once. This is a fundamental constraint of transformer-based LLMs.

**Key Parameters**:
- `ctx_size`: Configured context window (e.g., 4096, 8192, 32768 tokens)
- `n_predict`: Maximum tokens to generate in response
- Effective input limit: `ctx_size - n_predict`

### Context Window Planning

Before loading a model, Jan calculates safe context size based on available memory:

**Planning Process** (`planModelLoadInternal` in llamacpp extension):
```typescript
const plan = await planModelLoadInternal(
  modelPath,
  availableVRAM,
  availableRAM,
  systemInfo
)

// Returns:
{
  gpuLayers: 35,              // GPU-offloaded layers
  maxContextLength: 4096,     // Safe context size
  noOffloadKVCache: false,
  batchSize: 512,
  mode: 'GPU'                 // 'GPU' | 'Hybrid' | 'CPU'
}
```

**Memory Calculation**:
```rust
// From gguf/model_planner.rs
fn estimate_kv_cache_size(
    context_length: u32,
    n_layer: u32,
    n_embd: u32,
    cache_type: &str
) -> u64 {
    let bytes_per_element = match cache_type {
        "f32" => 4,
        "f16" | "bf16" => 2,
        "q8_0" => 1,
        "q4_0" | "q4_1" | "iq4_nl" => 0.5,
        _ => 2,
    };
    
    // Formula: 2 * context_length * n_layer * n_embd * bytes_per_element
    // (2 for K and V caches)
    let size_bytes = 2.0 * context_length as f64 
                   * n_layer as f64 
                   * n_embd as f64 
                   * bytes_per_element;
    
    size_bytes as u64
}
```

### Building Context for Inference

When sending a message, Jan constructs the context from conversation history:

**CompletionMessagesBuilder** (`web-app/src/lib/messages.ts`):
```typescript
class CompletionMessagesBuilder {
  private messages: ChatCompletionMessageParam[] = []

  constructor(messages: ThreadMessage[], systemInstruction?: string) {
    // 1. Add system message if provided
    if (systemInstruction) {
      this.messages.push({
        role: 'system',
        content: systemInstruction,
      })
    }
    
    // 2. Add conversation history (filtered, no errors)
    this.messages.push(
      ...messages
        .filter((e) => !e.metadata?.error)
        .map((msg) => this.toCompletionParam(msg))
    )
  }
  
  // Convert ThreadMessage to API format
  private toCompletionParam(msg: ThreadMessage) {
    if (msg.role === 'assistant') {
      return {
        role: 'assistant',
        content: msg.content?.[0]?.text?.value || '.',
        tool_calls: msg.metadata?.tool_calls
      }
    }
    
    // Handle multimodal user messages
    if (Array.isArray(msg.content) && msg.content.length > 1) {
      return {
        role: 'user',
        content: msg.content.map(part => {
          if (part.type === 'text') {
            return { type: 'text', text: part.text.value }
          }
          if (part.type === 'image_url') {
            return { type: 'image_url', image_url: part.image_url }
          }
        })
      }
    }
    
    return { role: 'user', content: msg.content?.[0]?.text?.value || '.' }
  }
}
```

**Context Construction Flow**:
```
1. Retrieve all messages for thread from storage
2. Filter out error messages
3. Add system instruction (if configured)
4. Convert to OpenAI-compatible format
5. Send entire history to model
```

**Important**: Jan sends **ALL messages in the thread** to the model on each request. There is no automatic truncation or sliding window - if the conversation exceeds the context window, it will fail unless context shift is enabled.

---

## Message Flow and Processing

### Complete Inference Flow

```
1. User types message in UI
   ↓
2. ChatInput component captures text + attachments
   ↓
3. useChat.sendMessage() called
   ├─ Process attachments (images, documents)
   │  ├─ Images: Convert to base64, embed in message
   │  └─ Documents: Ingest to vector DB, add metadata to text
   ├─ Create ThreadMessage with newUserThreadContent()
   ├─ Save to storage (append to messages.jsonl or SQLite)
   └─ Build context from full conversation history
   ↓
4. CompletionMessagesBuilder constructs API request
   ├─ System instruction (optional)
   ├─ All historical messages
   └─ New user message
   ↓
5. Send to model via AIEngine.chat()
   ├─ Validate context size
   ├─ Check for active model session
   └─ HTTP POST to llama-server
   ↓
6. Stream response chunks
   ├─ Track prompt processing progress
   ├─ Extract tool calls (if any)
   ├─ Extract reasoning (if present)
   └─ Accumulate content
   ↓
7. Save assistant message to storage
   ↓
8. Handle tool calls (if present)
   ├─ Request user approval (if not auto-approved)
   ├─ Execute tools via MCP
   ├─ Save tool results as tool messages
   └─ Send back to model with tool results
   ↓
9. Continue until finish_reason = 'stop'
```

### Message Persistence Strategy

**Desktop - Append-Only JSONL**:
```rust
// Lock thread for writing
let lock = get_lock_for_thread(thread_id).await;
let _guard = lock.lock().await;

// Read existing messages
let mut messages = read_messages_from_file(app_handle, thread_id)?;

// Append new message
messages.push(new_message);

// Write back atomically
write_messages_to_file(&messages, &messages_path)?;
```

**Mobile - Transactional SQL**:
```rust
pub async fn db_create_message<R: Runtime>(
    _app_handle: AppHandle<R>,
    thread_id: String,
    message: Value,
) -> Result<Value, String> {
    let pool = get_pool().await?;
    
    let id: String = message["id"].as_str().unwrap().to_string();
    let data = serde_json::to_string(&message)?;
    
    sqlx::query(
        "INSERT INTO messages (id, thread_id, data) VALUES (?1, ?2, ?3)"
    )
    .bind(&id)
    .bind(&thread_id)
    .bind(&data)
    .execute(&pool)
    .await?;
    
    // Update thread timestamp
    sqlx::query("UPDATE threads SET updated_at = strftime('%s', 'now') WHERE id = ?1")
        .bind(&thread_id)
        .execute(&pool)
        .await?;
    
    Ok(message)
}
```

---

## KV Cache and Memory Optimization

### What is KV Cache?

The **Key-Value (KV) Cache** stores previously computed attention keys and values, allowing the model to reuse them for subsequent tokens instead of recomputing from scratch.

**Without KV Cache**:
```
Token 1: Compute attention for token 1
Token 2: Compute attention for tokens 1-2
Token 3: Compute attention for tokens 1-3
... (O(n²) complexity)
```

**With KV Cache**:
```
Token 1: Compute attention, save K/V
Token 2: Reuse K/V from token 1, compute only for token 2
Token 3: Reuse K/V from tokens 1-2, compute only for token 3
... (O(n) complexity)
```

### KV Cache Configuration

**Settings** (from `llamacpp-extension/settings.json`):

```jsonc
{
  "cache_type_k": "f16",      // Key cache quantization
  "cache_type_v": "f16",      // Value cache quantization
  "defrag_thold": 0.1,        // Defragmentation threshold
  "no_kv_offload": false      // Keep cache on CPU?
}
```

**Quantization Options**:
- `f32`: Full precision (highest quality, most memory)
- `f16`: Half precision (default, good balance)
- `bf16`: Brain float 16
- `q8_0`: 8-bit quantization
- `q4_0`, `q4_1`, `iq4_nl`: 4-bit quantization (most memory efficient)
- `q5_0`, `q5_1`: 5-bit quantization

**Memory Trade-offs**:
```
Example: Llama 3 8B, 4096 context, 32 layers, 4096 embedding dim

f16 KV cache:  2 * 4096 * 32 * 4096 * 2 bytes = 2.1 GB
q8_0 KV cache: 2 * 4096 * 32 * 4096 * 1 byte  = 1.05 GB
q4_0 KV cache: 2 * 4096 * 32 * 4096 * 0.5 byte = 0.5 GB
```

### KV Cache Defragmentation

Over time, the KV cache can become fragmented as conversations have varying lengths. The `defrag_thold` parameter controls when defragmentation occurs.

**Configuration**:
```typescript
// From settings.json
{
  "key": "defrag_thold",
  "description": "Threshold for KV cache defragmentation (< 0 to disable).",
  "value": 0.1
}
```

**Passed to llama-server**:
```typescript
// In llamacpp-extension load()
if (cfg.defrag_thold && cfg.defrag_thold != 0.1) {
  args.push('--defrag-thold', String(cfg.defrag_thold))
}
```

**How it works**:
- When KV cache fragmentation exceeds threshold (10% by default)
- llama.cpp automatically reorganizes the cache
- Maintains performance for long conversations
- Small overhead during reorganization

---

## Context Shift Mechanism

### The Context Overflow Problem

When a conversation grows beyond the model's context window:

**Without Context Shift**:
```
Messages: [M1, M2, M3, ..., M50]  (total: 5000 tokens)
Model context: 4096 tokens
Result: ERROR - "out of context size"
```

**With Context Shift Enabled**:
```
Messages: [M1, M2, M3, ..., M50]  (total: 5000 tokens)
Model context: 4096 tokens
Action: Discard oldest tokens, keep most recent within limit
Result: SUCCESS - conversation continues
```

### Enabling Context Shift

**Setting** (from `llamacpp-extension/settings.json`):
```jsonc
{
  "key": "ctx_shift",
  "title": "Context Shift",
  "description": "Allow model to cut text in the beginning to accommodate new text in its memory",
  "controllerType": "checkbox",
  "value": false  // Disabled by default
}
```

**Passed to llama-server**:
```typescript
// In llamacpp-extension load()
if (cfg.ctx_shift) {
  args.push('--context-shift')
}
```

### How Context Shift Works

When enabled, llama.cpp automatically manages context overflow:

```
1. Context fills up to ctx_size (e.g., 4096 tokens)
   ↓
2. New tokens need to be added
   ↓
3. llama.cpp removes oldest tokens from KV cache
   ├─ Keeps system message (if present)
   ├─ Discards beginning of conversation
   └─ Retains most recent messages
   ↓
4. Adds new tokens to freed space
   ↓
5. Generation continues seamlessly
```

**Visual Example**:
```
Initial state (context full):
[SYS | M1 | M2 | M3 | M4 | M5 | NEW]
 ^--- 4096 tokens total ---^

After context shift:
[SYS | M4 | M5 | NEW | ...]
 ^--- 4096 tokens ---^
```

### Context Shift vs. Manual Management

**Option 1: Context Shift (Automatic)**
- ✅ Seamless - no user intervention
- ✅ Simple - just enable the setting
- ❌ Loses history - early messages forgotten
- ❌ No control - automatic pruning

**Option 2: Increase Context Size**
- ✅ Preserves all history
- ❌ Requires more VRAM
- ❌ Slower inference (O(n²) attention)
- ❌ Limited by model capabilities

**Option 3: Manual Thread Management**
- ✅ Full control
- ✅ Can save important context
- ❌ Requires user action
- ❌ Breaks conversation continuity

### User Experience Flow

**Without Context Shift** (default):
```
1. User sends message that would overflow context
   ↓
2. Model returns finish_reason='length'
   ↓
3. Extension throws OUT_OF_CONTEXT_SIZE error
   ↓
4. Frontend shows OutOfContextDialog
   ├─ "Your conversation has exceeded the context window"
   ├─ Option 1: Enable Context Shift
   └─ Option 2: Increase Context Size (if supported)
   ↓
5. User makes choice
   ├─ Context Shift: Conversation continues with history loss
   └─ Increase Context: Requires model reload with larger context
```

**With Context Shift** (enabled):
```
1. User sends message
   ↓
2. llama.cpp automatically shifts context
   ↓
3. Generation continues
   ↓
4. User sees response (unaware of shift)
```

**Implementation** (`web-app/src/containers/dialogs/OutOfContextDialog.tsx`):
```typescript
const OutOfContextDialog = ({ onApprove, onReject }) => {
  const handleContextShift = () => {
    onApprove('context_shift')  // Enable context shift
  }
  
  const handleIncreaseContext = () => {
    onApprove('ctx_len')  // Request larger context window
  }
  
  return (
    <Dialog>
      <DialogTitle>Context Limit Reached</DialogTitle>
      <DialogDescription>
        Your conversation has exceeded the model's context window.
      </DialogDescription>
      
      <Button onClick={handleContextShift}>
        Enable Context Shift (Continue with older messages removed)
      </Button>
      
      <Button onClick={handleIncreaseContext}>
        Increase Context Size (Requires model reload)
      </Button>
    </Dialog>
  )
}
```

---

## Multi-Turn Conversations

### How Previous Messages Are Handled

Jan follows a **full history approach** - every inference request includes the complete conversation history up to that point.

**Message Accumulation**:
```typescript
// Request 1 (turn 1):
{
  messages: [
    { role: "system", content: "You are helpful..." },
    { role: "user", content: "Hello" }
  ]
}

// Request 2 (turn 2):
{
  messages: [
    { role: "system", content: "You are helpful..." },
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi there!" },
    { role: "user", content: "What's the weather?" }
  ]
}

// Request 3 (turn 3):
{
  messages: [
    { role: "system", content: "You are helpful..." },
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi there!" },
    { role: "user", content: "What's the weather?" },
    { role: "assistant", content: "I don't have access to..." },
    { role: "user", content: "Tell me a joke" }
  ]
}
```

### Why No Automatic Summarization?

**Design Philosophy**:
1. **Accuracy**: Summaries can lose important context or introduce hallucinations
2. **User Control**: Users should decide what to keep/discard
3. **Simplicity**: No complex summarization logic to maintain
4. **Transparency**: What you see is what the model sees

**Manual Options**:
- Start new thread for new topics
- Delete unnecessary messages
- Enable context shift for automatic pruning

### Conversation Continuity

**Within Same Session**:
```typescript
// Messages stay in memory (Zustand store)
const messages = useMessages(state => state.getMessages(threadId))

// Fast access, no I/O
sendMessage(threadId, newMessage)
```

**Across Sessions**:
```typescript
// On app start, load thread from storage
useEffect(() => {
  const loadThread = async () => {
    const thread = await serviceHub.threads().retrieve(threadId)
    const messages = await serviceHub.messages().list(threadId)
    
    setThread(thread)
    setMessages(threadId, messages)
  }
  
  loadThread()
}, [threadId])
```

**Seamless Resume**: Conversations persist across app restarts, maintaining full history.

---

## Performance Considerations

### Token Count Optimization

**Prompt Caching** (llama.cpp feature):
When system messages and early conversation history don't change, llama.cpp can cache their KV values:

```
Turn 1: Compute system + user1 + assistant1
Turn 2: Reuse system (cached), compute user2 only
Turn 3: Reuse system (cached), compute user3 only
```

**Prompt Progress Tracking**:
```typescript
// Enable in llamacpp-extension
opts.return_progress = true

// Response includes:
{
  prompt_progress: {
    total: 36,       // Total prompt tokens
    cache: 15,       // Cached tokens (reused)
    processed: 36,   // Processed this turn
    time_ms: 5706    // Processing time
  }
}

// UI can show: "Processing context... 85% (from cache)"
```

### Continuous Batching

**Multiple Concurrent Users**:
```typescript
// Enable in settings
{
  "cont_batching": true
}
```

**How it helps**:
- Multiple inference requests can share KV cache
- Efficient for scenarios with multiple threads
- Reduces memory overhead
- Improves throughput

**When to use**:
- Running local API server (localhost:1337)
- Multiple users/threads active simultaneously
- Web application scenarios

### Memory-Conscious Settings

**For Limited VRAM**:
```jsonc
{
  "n_gpu_layers": 20,           // Partial GPU offload
  "cache_type_k": "q4_0",       // Aggressive KV quantization
  "cache_type_v": "q4_0",
  "ctx_size": 2048,             // Smaller context window
  "ubatch_size": 256            // Smaller batch size
}
```

**For Maximum Quality**:
```jsonc
{
  "n_gpu_layers": -1,           // All layers on GPU
  "cache_type_k": "f16",        // Full precision cache
  "cache_type_v": "f16",
  "ctx_size": 32768,            // Large context window
  "flash_attn": "on",           // Faster attention
  "cont_batching": true         // Efficient multi-request
}
```

---

## Best Practices

### For Users

1. **Start New Threads**: Begin new threads for unrelated topics
2. **Enable Context Shift**: For very long conversations
3. **Delete Unnecessary Messages**: Clean up threads periodically
4. **Monitor Context Usage**: Watch for "context full" warnings
5. **Adjust Context Size**: Based on conversation needs and available memory

### For Developers

1. **Validate Context Size**: Always check before sending requests
2. **Handle Overflow Gracefully**: Provide clear UI feedback
3. **Efficient Storage**: Use appropriate backend (files vs SQLite)
4. **Thread Safety**: Lock file access on desktop
5. **Message Filtering**: Exclude error messages from context
6. **Multimodal Support**: Handle images, documents properly

---

## Summary

Jan's conversation memory management is designed around these core principles:

1. **Complete Persistence**: All messages stored verbatim, no automatic summarization
2. **Platform-Optimized**: File-based (desktop) or SQLite (mobile)
3. **Full Context History**: Entire conversation sent to model each turn
4. **User-Controlled**: Manual thread management, optional context shift
5. **Memory-Efficient**: KV cache quantization, defragmentation
6. **Transparent**: What you see is what the model processes

**No Database Summarization**: Conversations are never automatically summarized - they're stored in full.

**Full History Processing**: Every message in a thread is sent to the model on each inference request (until context limit is reached).

**Context Management**: Handled via context shift (automatic pruning) or manual intervention (new threads, larger context windows).

This approach prioritizes **accuracy and transparency** over aggressive optimization, giving users full control over their conversation history while providing tools (context shift, KV cache, quantization) to manage memory constraints effectively.
