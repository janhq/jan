# Jan - AI Coding Agent Guide

Jan is a desktop AI assistant that runs models 100% locally. This is a **monorepo** with Yarn workspaces managing a Tauri-based app with React frontend, TypeScript core SDK, and an extension system.

## Architecture: The Three-Layer System

### Layer 1: Frontend (JavaScript/Browser)
```
web-app/ (React UI)  ──imports──►  core/ (TypeScript SDK)  ◄──uses── extensions/ (Features)
```
- **web-app/**: React + TanStack Router + Zustand for state + Radix UI components
- **core/**: Platform-agnostic TypeScript SDK with event bus and extension system
- **extensions/**: Self-contained modules (assistant, conversational, download, llamacpp, rag, vector-db)

All three run in the browser/webview and communicate with the backend via **Tauri IPC**.

### Layer 2: Backend Communication (Tauri IPC)
```typescript
// Any JS layer can invoke Rust commands independently
await invoke('command_name', { param: 'value' })
```

### Layer 3: Rust Backend (Native System)
```
src-tauri/src/core/  (Commands & logic)
    ↓
src-tauri/plugins/  (Hardware, LlamaCPP native plugins)
```

## Critical Developer Workflows

### Build & Run
```bash
make dev                    # Full desktop dev (builds extensions → core → starts Tauri)
make dev-web-app            # Web-only mode (no Tauri, browser testing)
make dev-android            # Android emulator
make dev-ios                # iOS simulator (macOS only)
```

**Build order matters**: Extensions → Core → Web App → Tauri. The Makefile handles this. Manual builds risk missing dependencies.

### Testing
```bash
yarn test                   # All tests (uses vitest.config.ts projects)
cd src-tauri && cargo test  # Rust tests (use --test-threads=1)
cd autoqa && python main.py # End-to-end tests
```

### Extension System Pattern
Extensions extend base classes from `@janhq/core`:
```typescript
// extensions/*/src/index.ts
import { AssistantExtension } from '@janhq/core'

export default class MyExtension extends AssistantExtension {
  async onLoad() { /* Initialize */ }
  async onUnload() { /* Cleanup */ }
}
```

**Build & Discovery Flow**:
1. `yarn build:extensions` → Generates `.tgz` files in `pre-install/`
2. Tauri copies to `resources/` during app build
3. `ExtensionManager.registerActive()` called on app startup (see `web-app/src/providers/ExtensionProvider.tsx`)
4. Manager calls `getActiveExtensions()` → Returns manifest with extension metadata
5. `activateExtension()` for each:
   - **Web extensions**: Pre-loaded via `extensionInstance` property (mobile/web builds)
   - **Tauri extensions**: Dynamic import from `file://` URL, instantiate class
6. Each extension's `onLoad()` called → Extension registers services/models/settings

**Extension Types** (see `core/src/browser/extension.ts`):
- `AssistantExtension` - Assistant CRUD operations
- `ConversationalExtension` - Message/thread handling
- `AIEngine` - Model inference engines (llama.cpp, OpenAI-compatible)
- `BaseExtension` - Generic extension (downloads, utilities)
- `RAGExtension` - Retrieval-Augmented Generation
- `VectorDBExtension` - Vector database operations

## Project-Specific Conventions

### File System Abstraction
Use `file://` protocol URIs for cross-platform paths:
```typescript
import { fs, joinPath } from '@janhq/core'

// ✓ Correct
const path = await joinPath(['file://assistants', assistantId, 'assistant.json'])
const data = await fs.readFileSync(path)

// ✗ Avoid raw paths - breaks platform abstraction
const data = fs.readFileSync('/Users/...')
```

### Tauri Command Pattern
Commands live in `src-tauri/src/core/*/commands.rs`, registered in `lib.rs`:
```rust
#[tauri::command]
async fn my_command(param: String) -> Result<String, String> {
    Ok(format!("Result: {}", param))
}

// In lib.rs:
.invoke_handler(tauri::generate_handler![my_command])
```

Frontend calls:
```typescript
import { invoke } from '@tauri-apps/api/core'
const result = await invoke<string>('my_command', { param: 'value' })
```

### State Management Layers
1. **React Local**: `useState` for component-scoped data
2. **Zustand Global**: `useAppState`, `useMessages`, `useThreads` for cross-component state
3. **Tauri State**: `AppState` in Rust for backend state (MCP servers, downloads, etc.)

### Model Loading Flow (Real Example)
1. User clicks download → `extensions/download-extension`
2. Extension calls Tauri → `src-tauri/core/downloads/commands.rs`
3. File saved → Extension emits event
4. `extensions/llamacpp-extension` receives event
5. Extension calls `src-tauri/plugins/llamacpp` → Starts llama.cpp process
6. Hardware plugin (`src-tauri/plugins/hardware`) detects GPU, optimizes settings

### Model Context Protocol (MCP) Integration
Jan implements the [Model Context Protocol](https://modelcontextprotocol.io) standard for agentic AI capabilities - connecting LLMs to external tools and data sources.

**Architecture**:
```
Frontend (Tools UI) → Tauri Commands → MCP Manager (Rust) → External MCP Servers
                                              ↓
                                        rmcp library (Rust MCP SDK)
                                              ↓
                                  SSE/HTTP/Stdio Transport → Server Process
```

**Key Components**:
- **`src-tauri/src/core/mcp/`**: Complete MCP implementation
  - `commands.rs`: Tauri commands (`activate_mcp_server`, `call_tool`, `get_tools`, etc.)
  - `helpers.rs`: Server lifecycle (start, stop, restart with exponential backoff)
  - `models.rs`: MCP config structures (`McpServerConfig`, `McpSettings`, `ToolWithServer`)
- **`AppState.mcp_*`**: Rust state tracking active servers, restart counts, tool call cancellations
- **`mcp_config.json`**: User config in Jan data folder defining available servers

**MCP Server Lifecycle**:
1. **Startup**: `run_mcp_commands()` reads `mcp_config.json` → starts enabled servers
2. **Activation**: `activate_mcp_server` command → spawns subprocess/HTTP client → connects via transport
3. **Tool Discovery**: Server announces tools → stored in state → exposed to frontend
4. **Tool Execution**: Frontend calls `call_tool` → routed to correct server → result returned
5. **Auto-restart**: Server crashes → exponential backoff retry (configurable via `McpSettings`)
6. **Deactivation**: `deactivate_mcp_server` → graceful shutdown → removed from active list

**Transport Types** (from `helpers.rs`):
- **Stdio**: Spawns child process, communicates via stdin/stdout (most common)
- **SSE**: Server-Sent Events over HTTP
- **HTTP**: StreamableHttpClient for request/response

**Critical Patterns**:
```rust
// Starting MCP server with auto-restart
start_mcp_server_with_restart(app, servers, name, config, Some(3)).await

// Tool call with timeout (prevents hanging)
timeout(tool_call_timeout(&state).await, server.call_tool(params)).await

// Exponential backoff prevents thundering herd
let delay = calculate_exponential_backoff_delay(attempt, &settings);
sleep(Duration::from_millis(delay)).await;
```

**Frontend Integration**:
```typescript
// Activate MCP server (see web-app/src/services/mcp/tauri.ts)
await invoke('activate_mcp_server', { name: 'fetch', config: {...} })

// Call tool during chat
await invoke('call_tool', { serverName: 'fetch', toolName: 'get_url', params: {...} })
```

**Testing MCP** (from `tests/checklist.md`):
- Banana test: Enable fetch MCP → ask model to fetch/summarize banana history from Wikipedia
- Tests context shift, tool calling, long-running operations

## Integration Points

### Extension Registration & Loading
**Two Loading Strategies** based on build target:

1. **Tauri Desktop/Mobile** (`activateExtension` in `web-app/src/lib/extension.ts`):
   ```typescript
   // Dynamic import from file:// URL
   const extensionUrl = extension.url // e.g., file://resources/extensions/assistant.js
   const extensionClass = await import(convertFileSrc(extensionUrl))
   this.register(extension.name, new extensionClass.default(...))
   ```

2. **Web-only builds** (`web-app/src/services/core/web.ts`):
   ```typescript
   // Pre-bundled, passed as extensionInstance
   import ExtensionClass from '@jan/extensions-web/assistant'
   extensionInstance: new ExtensionClass(url, name, ...)
   ```

**Registration Flow** (see `ExtensionProvider.tsx`):
```typescript
useEffect(() => {
  ExtensionManager.getInstance()
    .registerActive()      // Get manifests → activate each
    .then(() => load())    // Call onLoad() for all
}, [])
```

**Singleton Pattern**: `ExtensionManager.getInstance()` maintains global registry - accessible via `window.core.extensionManager`

### Core → Extensions Communication
```typescript
import { events } from '@janhq/core'

// Extension emits
events.emit('model:loaded', { modelId: 'llama-3' })

// Another extension listens
events.on('model:loaded', (data) => { /* Handle */ })
```

### Frontend → Core API
```typescript
// web-app imports core
const config = await window.core?.api?.getAppConfigurations()
```

### Cross-Platform Mobile
```rust
// src-tauri/lib.rs
#[cfg_attr(
    all(mobile, any(target_os = "android", target_os = "ios")),
    tauri::mobile_entry_point
)]
```

Mobile builds use `--features mobile` flag and different Tauri configs (`tauri.android.conf.json`, `tauri.ios.conf.json`).

## Common Patterns & Gotchas

### ✓ DO
- **Thread safety in Rust**: `Arc<Mutex<T>>` for shared state (see `AppState` in `lib.rs`)
- **Error handling**: `Result<T, E>` in Rust, try/catch in TypeScript
- **Type everything**: No `any` types, leverage TypeScript fully
- **Event-driven**: Use `events.emit/on` for decoupled communication
- **Platform checks**: Use `#[cfg(target_os = "...")]` for OS-specific code

### ✗ AVOID
- **Circular dependencies**: Core can't import web-app, extensions use core APIs only
- **Direct plugin calls from frontend**: Always go through Tauri commands
- **Hardcoded paths**: Use `file://` URIs and `joinPath`
- **Blocking operations**: Use async/await, especially in Rust with Tokio

## Security: Snyk Integration
Per `.github/instructions/snyk_rules.instructions.md`:
1. Run `snyk_code_scan` on new/modified code
2. Fix reported issues
3. Re-scan until clean

## Key Files to Reference

- **`Makefile`**: Build orchestration, all commands
- **`package.json`**: Workspace structure, scripts
- **`CONTRIBUTING.md`**: Component deep-dives
- **`src-tauri/lib.rs`**: Command registration, plugin initialization
- **`core/src/browser/index.ts`**: Core API exports
- **`web-app/src/hooks/useChat.ts`**: Complex chat logic example (1099 lines - study this for patterns)

## Testing Conventions
- Vitest for TypeScript (`yarn test`)
- Cargo test for Rust (`cargo test --test-threads=1` - single-threaded to avoid state conflicts)
- Mock Tauri APIs in tests:
```typescript
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))
```

## When Adding Features
1. **Identify layer**: Frontend UI? Core API? Backend system integration? Extension module?
2. **Check existing patterns**: Search codebase for similar features first
3. **Follow build order**: Extensions → Core → Web App
4. **Test across platforms**: Desktop (macOS/Linux/Windows) and mobile if applicable
5. **Update types**: Add to `core/src/types` if new data structures
6. **Document Tauri commands**: They're the contract between frontend/backend
