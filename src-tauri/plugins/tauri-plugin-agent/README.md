# tauri-plugin-agent

ReAct agent loop for Jan. Talks to any OpenAI-compatible chat completions endpoint and dispatches tool calls through a pluggable `ToolDispatcher` backend.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  tauri-plugin-agent                 │
│                                                     │
│  ┌──────────┐    ┌────────────┐    ┌─────────────┐  │
│  │AgentLoop │───▶│ToolDispatch│───▶│  Dispatcher │  │
│  │(ReAct)   │    │  er trait  │    │ (WASM impl) │  │
│  └──────────┘    └────────────┘    └──────┬──────┘  │
│       │                                   │         │
│  ┌────▼──────┐                            │         │
│  │ Manifest  │               tauri-plugin-sandbox   │
│  │(tool defs)│                   executor::execute  │
│  └───────────┘                            │         │
└───────────────────────────────────────────┼─────────┘
                                            ▼
                                     wasm/tools/*.wasm
```

## Pluggable design

`AgentLoop` holds a `Box<dyn ToolDispatcher>`. The trait is the only contract between the loop and execution:

```rust
#[async_trait]
pub trait ToolDispatcher: Send + Sync {
    async fn dispatch(&self, tool_id: &str, args: Value) -> Result<DispatchResult, String>;
    fn tool_schemas(&self) -> Vec<ToolMeta>;
}
```

To swap the execution backend — e.g. route tool calls over HTTP to a remote service, stub them in tests, or add a policy layer — implement `ToolDispatcher` on a new type and pass it to `AgentLoop::new_with_key`. No changes to the loop itself are required.

The built-in implementation is `Dispatcher` in `dispatcher.rs`, which scans a directory of `.wasm` files and routes each tool call to the matching binary via `tauri-plugin-sandbox`.

## ReAct loop (`agent.rs`)

The agent runs a standard Reason + Act loop:

1. Append the user message to history and send to the LLM.
2. If the response contains `tool_calls`, dispatch each one via `ToolDispatcher` and append the results as `role: tool` messages.
3. Repeat until the model returns a plain-text response with no tool calls.
4. Return `AgentResponse { content, tokens_used, steps, finish_reason }`.

The loop also handles:
- **Max steps** — hard stop after `AgentConfig::max_steps` (default 50).
- **Token budget** — emits a `TokenBudget` event and compacts context when usage exceeds `budget_warn_pct` (default 80 %).
- **Context compaction** — drops the oldest turns (keeping the last `compaction_keep`) and inserts a summary note so the model retains context without overflowing.
- **Retry with backoff** — retries 429 / 5xx responses up to `max_retries` times with exponential backoff.

## Events

Each step emits typed events via `app.emit("agent:event", ...)` so the frontend can stream progress:

| Event | When |
|---|---|
| `thinking` | Before each LLM call |
| `tool_call` | A tool is about to be dispatched |
| `tool_result` | Tool returned (ok / error, elapsed ms, summary) |
| `tool_log` | A log line emitted by the WASM tool via `host::log` |
| `retrying` | A retry is about to happen |
| `context_compacted` | Older turns were dropped |
| `token_budget` | Token usage crossed the warn threshold |

## Manifest (`manifest.rs`)

`Manifest` is a lightweight catalogue of available tools loaded from `tools/manifest.json` at startup. Each `ToolDef` records the tool ID, description, sandbox type (`wasm` or `microvm`), risk level, and JSON Schema for its parameters.

The manifest is separate from the dispatcher — it is exposed to the frontend via the `get_tool_manifest` command so the UI can display available tools without executing anything.

If `manifest.json` is missing, a built-in default is used.

## Tauri commands

| Command | Description |
|---|---|
| `agent_run` | Run the agent with a user message; streams events, returns `AgentResponse` |
| `agent_reset` | Clear conversation history |
| `get_tool_manifest` | Return the loaded `Manifest` |

## Configuration

The plugin reads these environment variables at startup:

| Variable | Default | Description |
|---|---|---|
| `AGENT_API_URL` | `http://localhost:1337` | Base URL of the OpenAI-compatible endpoint |
| `AGENT_MODEL` | `default` | Model ID sent in every request |
| `AGENT_API_KEY` | _(none)_ | Bearer token (optional) |

## Replacing this plugin

If you want a different agent strategy (e.g. a simple single-shot completion, a different loop, or a remote agent API):

1. Create a new Tauri plugin that exposes the same three commands (`agent_run`, `agent_reset`, `get_tool_manifest`).
2. In `src/lib.rs`, swap `.plugin(tauri_plugin_agent::init())` for your new plugin.
3. The frontend and CLI need no changes as long as the command signatures match.
