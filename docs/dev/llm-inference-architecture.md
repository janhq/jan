# LLM Inference Architecture in Jan

This document provides a comprehensive overview of how LLM inference works in Jan, focusing on the llamacpp integration and the complete flow from user interaction to model response.

## Table of Contents

1. [High-Level Architecture](#high-level-architecture)
2. [Component Overview](#component-overview)
3. [Model Loading Flow](#model-loading-flow)
4. [Inference Flow](#inference-flow)
5. [Key Events and Communication](#key-events-and-communication)
6. [Backend Management](#backend-management)
7. [State Management](#state-management)
8. [Error Handling](#error-handling)

---

## High-Level Architecture

Jan uses a **native llama.cpp backend** for local LLM inference, eschewing Python-based frameworks for maximum performance. The architecture is:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                         │
│  • Chat UI                                                      │
│  • Message handling via useChat hook                           │
│  • Model selection & configuration                             │
└────────────────┬────────────────────────────────────────────────┘
                 │ (calls EngineManager)
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│               Extension: llamacpp-extension                     │
│  (TypeScript - extensions/llamacpp-extension/src/index.ts)     │
│                                                                 │
│  • AIEngine implementation                                     │
│  • Model lifecycle management (load/unload)                    │
│  • Backend version management                                  │
│  • Inference request orchestration                             │
└────────────────┬────────────────────────────────────────────────┘
                 │ (Tauri IPC via invoke())
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│          Tauri Plugin: tauri-plugin-llamacpp                   │
│  (Rust - src-tauri/plugins/tauri-plugin-llamacpp/)            │
│                                                                 │
│  • Process spawning & management                               │
│  • Port allocation                                             │
│  • Session tracking                                            │
│  • GGUF metadata reading                                       │
└────────────────┬────────────────────────────────────────────────┘
                 │ (spawns subprocess)
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│              llama-server (C++ Binary)                         │
│  • Native llama.cpp implementation                             │
│  • OpenAI-compatible HTTP API                                  │
│  • Hardware optimization (CPU/GPU)                             │
│  • Context management & KV cache                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Overview

### 1. Frontend Layer

**Location**: `web-app/src/hooks/useChat.ts`

The chat hook orchestrates user interactions and model communication:

```typescript
// Key responsibilities:
// - Send user messages
// - Stream model responses
// - Handle tool calls (MCP integration)
// - Manage context and attachments
```

**EngineManager** (from `@janhq/core`) acts as the registry:
- Maps provider names → AIEngine instances
- Example: `EngineManager.instance().getEngine('llamacpp')`

### 2. Extension Layer: llamacpp-extension

**Location**: `extensions/llamacpp-extension/src/index.ts`

This TypeScript extension implements the `AIEngine` interface and serves as the bridge between frontend and Rust backend.

**Class**: `llamacpp_extension extends AIEngine`

**Key Properties**:
```typescript
provider: string = 'llamacpp'
providerId: string = 'llamacpp'
autoUnload: boolean = true
timeout: number = 600
loadingModels: Map<string, Promise<SessionInfo>>  // Track concurrent loads
```

**Critical Methods**:

#### `onLoad()` - Extension Initialization
- Reads/migrates settings from localStorage
- Discovers available backends (CUDA, Vulkan, CPU-only, etc.)
- Downloads missing backends if needed
- Listens for download events and validation events

#### `load(modelId, settings)` - Model Loading
```typescript
async load(modelId: string, settings?: unknown): Promise<SessionInfo>
```
- Reads model configuration from `llamacpp/models/{modelId}/model.yml`
- Plans GPU layers and context size using `planModelLoadInternal()`
- Prepares launch arguments for llama-server
- Calls Tauri command `plugin:llamacpp|load_llama_model`
- Returns session info (port, PID, model_id, API key)

#### `chat(opts, abortController)` - Inference Request
```typescript
async chat(
  opts: chatCompletionRequest,
  abortController?: AbortController
): Promise<chatCompletion | AsyncIterable<chatCompletionChunk>>
```
- Finds active session for model
- Validates process is alive
- Constructs OpenAI-compatible request
- Routes to `http://localhost:{port}/v1/chat/completions`
- Returns streaming or non-streaming response

#### `unload(modelId)` - Model Cleanup
```typescript
async unload(modelId: string): Promise<UnloadResult>
```
- Calls Tauri command `plugin:llamacpp|unload_llama_model`
- Gracefully terminates llama-server process
- Cleans up session state

### 3. Tauri Plugin: tauri-plugin-llamacpp

**Location**: `src-tauri/plugins/tauri-plugin-llamacpp/`

Written in Rust, this plugin manages native process lifecycle and system integration.

**State Management** (`state.rs`):
```rust
pub struct LlamacppState {
    pub llama_server_process: Arc<Mutex<HashMap<String, LLamaBackendSession>>>,
}

pub struct LLamaBackendSession {
    pub port: u16,
    pub pid: u32,
    pub model_id: String,
    pub api_key: String,
    pub model_path: String,
    pub mmproj_path: Option<String>,
}
```

**Key Commands** (`commands.rs`):

#### `load_llama_model` - Spawn llama-server
```rust
#[tauri::command]
pub async fn load_llama_model<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    backend_path: &str,
    args: Vec<String>,
    envs: HashMap<String, String>,
    is_embedding: bool,
    timeout: u64,
) -> ServerResult<SessionInfo>
```

**Process**:
1. **Validate paths**: Binary, model file, optional mmproj file
2. **Parse configuration**: Extract port, model path, API key from args
3. **Spawn subprocess**:
   ```rust
   Command::new(&bin_path)
       .args(args)
       .envs(envs)
       .stdout(Stdio::piped())
       .stderr(Stdio::piped())
   ```
4. **Monitor stdout/stderr** for readiness signals:
   - `"server is listening on"`
   - `"all slots are idle"`
   - `"starting the main loop"`
5. **Health check**: Poll `http://localhost:{port}/health`
6. **Store session**: Add to state map
7. **Return session info** to extension

#### `unload_llama_model` - Graceful Shutdown
```rust
#[tauri::command]
pub async fn unload_llama_model(
    state: State<LlamacppState>,
    model_id: String
) -> Result<UnloadResult, String>
```

**Process**:
1. Find session by model_id
2. Send SIGTERM (Unix) or TerminateProcess (Windows)
3. Wait up to 10 seconds for graceful exit
4. Force kill if timeout
5. Remove from state map

**GGUF Utilities** (`gguf/` module):
- `read_gguf_metadata()`: Parse model architecture, context size, quantization
- `estimate_kv_cache_size()`: Calculate memory requirements
- `get_model_size()`: Read file size
- `is_model_supported()`: Check architecture compatibility
- `plan_model_load()`: Determine optimal GPU layers and settings based on hardware

### 4. llama-server Binary

**Location**: `<JanDataFolder>/llamacpp/backends/{version}/{backend}/build/bin/llama-server`

Native C++ executable from llama.cpp project:
- Implements OpenAI-compatible REST API
- Manages model context and KV cache
- Hardware-optimized inference (CUDA, Vulkan, Metal, CPU)
- Supports continuous batching for concurrent requests

**Endpoints**:
- `POST /v1/chat/completions` - Main inference endpoint
- `POST /v1/embeddings` - Generate embeddings
- `GET /health` - Health check
- `GET /v1/models` - List loaded models

---

## Model Loading Flow

### Step-by-Step Process

```
1. User clicks "Start" on model
   ↓
2. Frontend calls EngineManager.instance().getEngine('llamacpp').load(modelId)
   ↓
3. llamacpp-extension.load(modelId, settings)
   ├─ Read model.yml configuration
   ├─ Check backend availability (download if needed)
   ├─ Call planModelLoadInternal() for optimal settings
   │  ├─ Read GGUF metadata (architecture, layers, context size)
   │  ├─ Query system memory (RAM, VRAM)
   │  ├─ Calculate GPU layers based on available memory
   │  └─ Return ModelPlan (gpuLayers, maxContextLength, mode)
   ├─ Build llama-server launch arguments:
   │  └─ Example: [
   │       '--host', '127.0.0.1',
   │       '--port', '53821',
   │       '-m', '/path/to/model.gguf',
   │       '-ngl', '35',              // GPU layers
   │       '-c', '4096',              // Context size
   │       '--api-key', 'generated_key',
   │       '-a', 'model-id',
   │       '--log-format', 'text',
   │       ...
   │     ]
   └─ invoke('plugin:llamacpp|load_llama_model', { backend_path, args, envs })
   ↓
4. Rust Plugin: load_llama_model command
   ├─ Validate binary path (ensure exists, is executable)
   ├─ Validate model path (ensure GGUF file exists)
   ├─ Check for port conflicts
   ├─ Spawn llama-server subprocess
   │  ├─ Set up stdout/stderr pipes
   │  ├─ Configure environment (CUDA paths, library paths)
   │  └─ Create child process
   ├─ Monitor logs for readiness signals (with timeout)
   ├─ Perform health check: GET http://localhost:{port}/health
   ├─ Create LLamaBackendSession
   └─ Store in state.llama_server_process map
   ↓
5. Return SessionInfo to extension
   {
     port: 53821,
     pid: 12345,
     model_id: "llama-3-8b",
     api_key: "generated_key"
   }
   ↓
6. Extension stores session, emits 'model:loaded' event
   ↓
7. Frontend updates UI (model status → "Ready")
```

### Configuration Files

**model.yml structure** (`llamacpp/models/{modelId}/model.yml`):
```yaml
model_path: "huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/Llama-3.2-3B-Instruct-Q4_K_M.gguf"
mmproj_path: null  # Optional vision model
name: "Llama 3.2 3B Instruct"
size_bytes: 1234567890
sha256: "abc123..."
```

**Extension Settings** (stored in localStorage):
```typescript
{
  version_backend: "b6399/win-cuda-12.4-x64",  // Backend version/type
  auto_update_engine: true,
  auto_unload: true,
  timeout: 600,
  n_gpu_layers: 35,        // User override
  ctx_size: 4096,          // Context window
  threads: 8,
  batch_size: 512,
  cont_batching: true,     // Continuous batching
  flash_attn: "auto",
  cache_type_k: "f16",     // KV cache quantization
  cache_type_v: "f16",
  ...
}
```

---

## Inference Flow

### Streaming Inference (Most Common)

```
1. User sends message in chat
   ↓
2. useChat hook constructs chatCompletionRequest
   {
     model: "llama-3-8b",
     messages: [
       { role: "system", content: "You are helpful..." },
       { role: "user", content: "Hello!" }
     ],
     stream: true,
     temperature: 0.7,
     max_tokens: 2048,
     return_progress: true  // Enable prompt processing progress
   }
   ↓
3. EngineManager.instance().getEngine('llamacpp').chat(request)
   ↓
4. llamacpp-extension.chat(opts, abortController)
   ├─ Find session: findSessionByModel(opts.model)
   ├─ Validate process: invoke('is_process_running', { pid })
   ├─ Health check: fetch(`http://localhost:{port}/health`)
   ├─ Build request URL: `http://localhost:{port}/v1/chat/completions`
   ├─ Set headers:
   │  {
   │    'Content-Type': 'application/json',
   │    'Authorization': 'Bearer {api_key}'
   │  }
   └─ Return handleStreamingResponse(url, headers, body, abortController)
   ↓
5. handleStreamingResponse() - Server-Sent Events (SSE)
   ├─ fetch(url, { method: 'POST', body: JSON.stringify(opts) })
   ├─ Parse response.body as SSE stream
   └─ Yield chatCompletionChunk for each token:
      {
        choices: [{
          delta: { content: "Hello" },
          finish_reason: null
        }],
        prompt_progress: {  // Added in b6399+
          total: 36,        // Total prompt tokens
          cache: 0,         // Cached tokens
          processed: 36,    // Currently processed
          time_ms: 5706     // Processing time
        }
      }
   ↓
6. Frontend consumes async iterable
   for await (const chunk of response) {
     // Update UI with chunk.choices[0].delta.content
     // Show progress: (chunk.prompt_progress.processed / total) * 100
   }
   ↓
7. Last chunk signals completion
   {
     choices: [{ finish_reason: "stop", delta: {} }],
     usage: {
       prompt_tokens: 36,
       completion_tokens: 120,
       total_tokens: 156
     }
   }
```

### Non-Streaming Inference

```
1. Same as streaming through step 4
   ↓
2. llamacpp-extension.chat() with stream=false
   ├─ fetch(url, { method: 'POST', body, signal: abortController.signal })
   ├─ await response.json()
   └─ Return complete chatCompletion:
      {
        choices: [{
          message: { role: "assistant", content: "Full response here" },
          finish_reason: "stop"
        }],
        usage: { ... }
      }
   ↓
3. Check finish_reason for errors:
   - 'length' → OUT_OF_CONTEXT_SIZE error (context limit hit)
   - 'stop' → Normal completion
```

---

## Key Events and Communication

### Event Bus (from `@janhq/core`)

The extension system uses a centralized event bus for decoupled communication:

```typescript
import { events } from '@janhq/core'

// Extension emits events
events.emit('model:loaded', { modelId, sessionInfo })
events.emit('model:unloaded', { modelId })
events.emit('download:progress', { modelId, percent })

// Other components listen
events.on('model:loaded', (data) => {
  console.log(`Model ${data.modelId} is ready`)
})
```

### Download Events

The llamacpp-extension listens for model download completion:

```typescript
events.on(DownloadEvent.onFileDownloadSuccess, async (data) => {
  if (data.metadata?.modelId) {
    // Auto-configure downloaded model
    await this.importModel(data.downloadPath, data.metadata.modelId)
  }
})
```

### Validation Events

For multimodal models requiring mmproj files:

```typescript
// Listener setup in onLoad()
this.unlistenValidationStarted = await listen(
  'validation:started',
  async (event) => {
    const modelId = event.payload.modelId
    // Check if mmproj.gguf exists, download if missing
  }
)
```

### Tauri Event Emission

The Rust backend can emit events to frontend:

```rust
use tauri::Emitter;

app_handle.emit("model:progress", json!({
    "model_id": model_id,
    "percent": 0.75
})).ok();
```

---

## Backend Management

### Backend Discovery

llamacpp-extension supports multiple backend types optimized for different hardware:

**Backend Types**:
- `win-cuda-12.4-x64` - Windows NVIDIA GPU (CUDA 12.4)
- `win-vulkan-x64` - Windows AMD/Intel GPU (Vulkan)
- `win-cpu-avx2` - Windows CPU (AVX2 instructions)
- `linux-cuda-12.4-x64` - Linux NVIDIA GPU
- `mac-metal-arm64` - macOS Apple Silicon (Metal)
- `mac-cpu-arm64` - macOS Apple Silicon (CPU fallback)

### Backend Auto-Update

```typescript
async checkBackendForUpdates(): Promise<{
  updateNeeded: boolean
  newVersion: string
  targetBackend?: string
}> {
  // Parse current: "b6399/win-cuda-12.4-x64"
  const [currentVersion, currentBackend] = this.config.version_backend.split('/')
  
  // Find latest version for current backend type
  const latestBackend = this.findLatestVersionForBackend(backends, currentBackend)
  
  // Compare versions (b6399 vs b6400)
  if (parseVersion(latest) > parseVersion(current)) {
    return { updateNeeded: true, newVersion: latest }
  }
}
```

### Backend Installation

When a backend is missing:

```typescript
async ensureBackendReady(backend: string, version: string) {
  const installed = await isBackendInstalled(backend, version)
  
  if (!installed) {
    // Download from CDN
    await downloadBackend(backend, version, {
      onProgress: (percent) => {
        events.emit('download:progress', { percent })
      }
    })
  }
}
```

**Backend Structure**:
```
<JanDataFolder>/llamacpp/backends/
  └─ b6399/                    # Version
      ├─ win-cuda-12.4-x64/   # Backend type
      │   └─ build/
      │       └─ bin/
      │           └─ llama-server.exe
      └─ win-vulkan-x64/
          └─ build/
              └─ bin/
                  └─ llama-server.exe
```

---

## State Management

### Extension-Level State (TypeScript)

**Stored in localStorage**:
- Extension settings (GPU layers, context size, backend version)
- Model migration flags
- Backend type preferences

**In-Memory**:
```typescript
class llamacpp_extension {
  private loadingModels = new Map<string, Promise<SessionInfo>>()
  private pendingDownloads = new Map<string, Promise<void>>()
  private isConfiguringBackends: boolean = false
}
```

### Plugin-Level State (Rust)

**LlamacppState** (thread-safe):
```rust
pub struct LlamacppState {
    pub llama_server_process: Arc<Mutex<HashMap<String, LLamaBackendSession>>>,
}
```

**Accessed in commands**:
```rust
#[tauri::command]
pub async fn get_loaded_models(
    state: State<LlamacppState>
) -> Result<Vec<String>, String> {
    let process_map = state.llama_server_process.lock().await;
    Ok(process_map.keys().cloned().collect())
}
```

### Session Tracking

Each loaded model has a session:

```rust
pub struct LLamaBackendSession {
    pub port: u16,           // Random port (e.g., 53821)
    pub pid: u32,            // Process ID
    pub model_id: String,    // Unique model identifier
    pub api_key: String,     // Generated HMAC-SHA256 key
    pub model_path: String,  // Absolute path to .gguf
    pub mmproj_path: Option<String>,  // Optional mmproj
}
```

**Key Lookups**:
- `find_session_by_model_id()` - Get session for inference
- `get_all_active_sessions()` - List all running models
- `get_all_loaded_model_ids()` - Get model IDs only

---

## Error Handling

### Common Error Scenarios

#### 1. Out of Context Size
```typescript
// Extension detects finish_reason='length'
if (completionResponse.choices?.[0]?.finish_reason === 'length') {
  throw new Error(OUT_OF_CONTEXT_SIZE)
}

// Frontend catches and prompts user to enable context shift
```

#### 2. Model Crashed
```typescript
// Check process alive
const isAlive = await invoke('is_process_running', { pid })
if (!isAlive) {
  throw new Error('Model have crashed! Please reload!')
}

// Validate health endpoint
try {
  await fetch(`http://localhost:${port}/health`)
} catch (e) {
  this.unload(modelId)
  throw new Error('Model appears to have crashed! Please reload!')
}
```

#### 3. Backend Not Found
```rust
// Rust plugin validates binary path
fn validate_binary_path(path: &str) -> ServerResult<PathBuf> {
    let bin_path = PathBuf::from(path);
    
    if !bin_path.exists() {
        return Err(LlamacppError::BinaryNotFound(path.to_string()).into());
    }
    
    Ok(bin_path)
}
```

#### 4. Port Conflict
```rust
// Extension requests random port
let port = invoke('plugin:llamacpp|get_random_port').await?;

// Rust finds available port
pub fn get_random_available_port() -> u16 {
    (49152..=65535)
        .find(|&port| TcpListener::bind(("127.0.0.1", port)).is_ok())
        .unwrap_or(49152)
}
```

#### 5. CUDA Not Found
```rust
// Rust checks for CUDA dependencies
let cuda_found = add_cuda_paths(&mut command);
if !cuda_found && binary_requires_cuda(&bin_path) {
    log::warn!("CUDA required but not found. Process may fail!");
}
```

### Error Propagation

```
llama-server (stderr) 
    ↓
Rust monitors stderr 
    ↓
Parse error message, create LlamacppError 
    ↓
Return ServerError to extension 
    ↓
Extension throws Error 
    ↓
Frontend catches, displays to user
```

**Error Types** (Rust):
```rust
pub enum LlamacppError {
    BinaryNotFound(String),
    ModelNotFound(String),
    ProcessSpawnFailed(String),
    ProcessStartTimeout,
    HealthCheckFailed,
    OutOfMemory,
    UnsupportedModel(String),
}
```

---

## Performance Optimizations

### 1. Model Planning
Before loading, the extension calculates optimal settings:

```typescript
const plan = await planModelLoadInternal(
  modelPath,
  availableVRAM,
  availableRAM,
  systemInfo
)

// Returns:
{
  gpuLayers: 35,          // How many layers fit in VRAM
  maxContextLength: 4096, // Safe context size
  noOffloadKVCache: false,
  batchSize: 512,
  mode: 'GPU'             // 'GPU' | 'Hybrid' | 'CPU'
}
```

### 2. Continuous Batching
Multiple concurrent requests share KV cache:

```typescript
cont_batching: true  // Enable in settings
```

### 3. Flash Attention
Faster attention mechanism:

```typescript
flash_attn: "auto"  // Use if available
```

### 4. KV Cache Quantization
Reduce memory usage:

```typescript
cache_type_k: "f16",  // Key cache
cache_type_v: "f16"   // Value cache
// Options: f32, f16, q8_0, q4_0
```

### 5. Context Shift
Handle long conversations:

```typescript
ctx_shift: true  // Automatically shift context when full
```

---

## Debugging Tips

### 1. Enable Detailed Logging

**TypeScript**:
```typescript
import { info, error } from '@tauri-apps/plugin-log'
info('Loading model:', modelId)
```

**Rust**:
```rust
log::info!("Spawning llama-server at {}", backend_path);
log::debug!("Args: {:?}", args);
```

### 2. Monitor llama-server Output

Check logs at:
```
<JanDataFolder>/logs/app.log
```

Look for:
- `[llamacpp]` - Server logs
- `server is listening on` - Readiness signal
- `error` - Failures

### 3. Inspect Active Sessions

```typescript
const sessions = await invoke('plugin:llamacpp|get_all_sessions')
console.log(sessions)
```

### 4. Test Health Endpoint

```bash
curl http://localhost:{port}/health
```

### 5. Validate GGUF File

```typescript
const metadata = await readGgufMetadata(modelPath)
console.log(metadata)
// Check: architecture, context_length, quantization
```

---

## Summary

Jan's LLM inference architecture is designed for:
- **Performance**: Native C++ inference, no Python overhead
- **Flexibility**: Multiple backend types (CUDA, Vulkan, Metal, CPU)
- **Reliability**: Process isolation, health checks, automatic recovery
- **User Experience**: Streaming responses, progress tracking, auto-configuration

The key innovation is the **three-layer separation**:
1. **TypeScript extension** - Business logic, model management
2. **Rust plugin** - Process lifecycle, system integration
3. **llama.cpp server** - Core inference engine

This architecture enables Jan to deliver desktop-class performance while maintaining the flexibility and extensibility of a web-based application.
