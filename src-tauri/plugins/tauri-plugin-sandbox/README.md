# tauri-plugin-sandbox

Safe code execution for Jan. Provides two runtimes that `tauri-plugin-agent` can dispatch tool calls to:

- **WASM runtime** — always available; runs tools as WebAssembly modules inside Wasmtime.
- **MicroVM runtime** — requires a running [microsandbox](https://github.com/zerocore-ai/microsandbox) server; runs code in hardware-isolated VMs (Firecracker on Linux, Apple Hypervisor on macOS).

Both runtimes return the same `{ exit_code, stdout, stderr }` JSON shape so callers need no special-case logic.

## Architecture

```
tauri-plugin-agent (Dispatcher)
        │
        ▼
  executor::execute(wasm_path, input, mounts)
        │
        ├── reads schema/description from WASM exports
        ├── runs tool logic in Wasmtime (dual-metered)
        │
        └── host::exec_code  ──────────────────────────┐
                                                        │
                             ┌──────────────────────────▼──────────────────┐
                             │              microvm.rs                      │
                             │                                              │
                             │  workspace_exec  ──▶  persistent VM (REPL)  │
                             │  run_in_microvm  ──▶  ephemeral VM           │
                             │                           │                  │
                             │                    WASM fallback             │
                             │               (wasm_runtime.rs)              │
                             └──────────────────────────────────────────────┘
```

## WASM runtime (`executor.rs`)

Every tool is a `.wasm` binary compiled to `wasm32-wasip1`. The executor loads it with Wasmtime and calls its `run` export.

### Tool ABI

Each WASM binary must export:

| Export | Signature | Purpose |
|---|---|---|
| `memory` | memory | Linear memory the host reads/writes |
| `run` | `(ptr: i32, len: i32) -> i64` | Main entry point. Input JSON at `(ptr, len)`; returns `(out_ptr << 32 \| out_len)` |
| `schema` | `() -> i64` | Returns `(ptr << 32 \| len)` of a JSON Schema string |
| `description` | `() -> i64` | Returns `(ptr << 32 \| len)` of a plain-text description |

### Host imports

The executor provides these imports to every WASM module:

| Import | Signature | Description |
|---|---|---|
| `host::log` | `(ptr, len)` | Emit a UTF-8 log line (rate-limited: 1 000 lines, 4 KB each) |
| `host::http_get` | `(url_ptr, url_len, buf_ptr, buf_max) -> i32` | Synchronous HTTP GET; returns bytes written or -1. API keys are injected by the host from env vars — WASM never sees secrets. |
| `host::exec_code` | `(lang_ptr, lang_len, code_ptr, code_len, ws_ptr, ws_len, out_ptr, out_max) -> i32` | Execute code in a microVM (or WASM fallback) and write JSON result to `out_ptr` |

### Dual metering

Tool execution is bounded by two independent mechanisms so neither CPU abuse nor slow I/O can block the host indefinitely:

| Meter | Mechanism | Catches |
|---|---|---|
| **Fuel** | Wasmtime `consume_fuel` — ticks down with every WASM instruction | Tight infinite loops inside WASM guest |
| **Epoch** | Watchdog thread calls `engine.increment_epoch()` after the wall-clock deadline | Hangs inside host functions (slow HTTP, DNS, blocked I/O) |

Fuel only decrements while WASM is executing — it pauses inside host calls like `http_get`. The epoch watchdog covers that gap. On normal completion the executor drops the cancellation sender, waking the watchdog early so it does not fire against a later execution on the same engine.

Limits:

| Limit | Value |
|---|---|
| Fuel (full execution) | 1 000 000 000 instructions |
| Wall-clock timeout | 30 minutes (allows `npm install`, `build` etc.) |
| Fuel (metadata read) | 10 000 000 instructions |
| Wall-clock (metadata) | 5 seconds |

## MicroVM runtime (`microvm.rs`)

Used when a tool calls `host::exec_code`. Requires the microsandbox server to be running externally:

```bash
msb server start --dev
# or override the URL:
export MICROSANDBOX_URL=http://127.0.0.1:5555
```

### Workspace VMs (persistent)

When `exec_code` is called with a non-empty workspace ID the sandbox creates a persistent VM named `<session-prefix>-<workspace-id>` and reuses it across calls. This is the primary path used by the agent — the model passes the same workspace ID for every step of a task so state (files, processes, npm packages) survives between calls.

- Guest port 3000 is mapped to a free host port at VM creation time. If a web server starts inside the VM, the result JSON includes a `"url"` field.
- Idle workspaces are evicted after 30 minutes of inactivity.
- A session-unique prefix prevents name collisions when the process restarts while the server still has VMs from the previous run.

### Ephemeral VMs

When `exec_code` is called with no workspace ID, a fresh ephemeral VM is created and stopped immediately after the call.

### WASM fallback (`wasm_runtime.rs`)

If the microsandbox server is not reachable, `host::exec_code` falls back to running JavaScript via an embedded QuickJS binary (`js-runner.wasm`, compiled to `wasm32-wasip1` and bundled at compile time). Python falls back to `micropython.wasm` if it is present next to the executable.

The fallback is lighter than a microVM (no hardware virtualisation, no network isolation) but is sufficient for simple scripts when microsandbox is not available.

## Building the WASM binaries

From `plugins/tauri-plugin-sandbox/`:

```bash
make          # build everything: js-runner + all tools
make runner   # js-runner.wasm only (QuickJS fallback runtime)
make tools    # tool binaries only (web.search, http.fetch, code.exec)
make clean
```

Outputs:

| File | Source | Description |
|---|---|---|
| `wasm/js-runner.wasm` | `runner/` | QuickJS runtime for the WASM fallback |
| `wasm/tools/web/search.wasm` | `tools-src/web-search/` | DuckDuckGo web search tool |
| `wasm/tools/http/fetch.wasm` | `tools-src/http-fetch/` | HTTP fetch tool |
| `wasm/tools/code/exec.wasm` | `tools-src/code-exec/` | Code execution tool (delegates to `host::exec_code`) |

Requires the `wasm32-wasip1` target: `rustup target add wasm32-wasip1`.

## Replacing this plugin

`tauri-plugin-agent`'s `Dispatcher` calls `tauri_plugin_sandbox::executor::execute` directly as a library — there is no Tauri IPC between the two plugins. To swap the sandbox:

1. Create a new crate that exposes `executor::execute(wasm_path, input, mounts)` and `executor::get_tool_info(wasm_path)` with the same signatures.
2. Update the `tauri-plugin-agent` dependency in its `Cargo.toml`.
3. No changes to the agent loop or the frontend are needed.

Alternatively, implement a custom `ToolDispatcher` in `tauri-plugin-agent` that bypasses the WASM executor entirely (e.g. dispatching to a local HTTP service or native binaries) without touching the sandbox at all.
