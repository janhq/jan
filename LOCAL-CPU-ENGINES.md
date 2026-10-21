# Local CPU engines and the native browser

Everything that was built on top of `janhq/jan` at `ce8fcd2` (upstream `main`,
v0.8.7), and how to run it.

Three things landed:

1. **Two local CPU inference engines** — LiteRT-LM and OpenVINO — driven from
   inside Jan, with the whole setup (runtime install, model import, chat)
   available in the app.
2. **A native headless browser** — six agent tools that drive a real Chrome
   over the DevTools protocol, with no MCP server and no Python.
3. **Fixes to the experience of both** — no console windows, processes named
   after their engine, and a runtime check that no longer loads two gigabytes
   of native libraries to answer a yes/no question.

---

## 1. The local CPU engines

### What they are

| Engine | Extension | Runtime | Model format |
| --- | --- | --- | --- |
| LiteRT-LM | `extensions/litert-lm-extension` | `litert_lm` (Google) | `.litertlm` bundle |
| OpenVINO | `extensions/openvino-extension` | `openvino_genai` (Intel) | OpenVINO IR (`.xml` + `.bin`) |

Both run on the CPU. They appear in **Settings → Providers** as
*LiteRT-LM Inference Engine* and *OpenVINO Inference Engine*, next to
llama.cpp and MLX.

### How a request flows

```
Jan UI  →  extension (TypeScript)  →  HTTP (OpenAI chat-completions)
                                        ▲
                        tauri-plugin-local-engine (Rust)
                          │  spawns / supervises / stops
                          ▼
                   python sidecar  (src-tauri/python-engines/server.py)
                     │                    │
              litert_lm runtime     openvino_genai
```

**The sidecar** (`src-tauri/python-engines/server.py`) is a standard-library
HTTP server that loads the model with the engine's own runtime and serves
`GET /health`, `GET /v1/models` and `POST /v1/chat/completions` (buffered and
streamed, with chunked transfer encoding). The script is embedded in the
plugin (`include_str!`) and written to the app data directory on first use, so
there is no runtime file dependency.

**The plugin** (`src-tauri/plugins/tauri-plugin-local-engine`) owns the
sidecar processes:

- resolves the interpreter — `JAN_<ENGINE>_PYTHON`, then `JAN_ENGINE_PYTHON`,
  then a virtualenv Jan manages under the data folder, then `python3`/`python`
  on `PATH`;
- starts the sidecar on a free port with a generated bearer token;
- waits for `GET /health` before reporting the session as ready;
- terminates the process tree when the model is unloaded or the app exits;
- `check_local_engine` reports whether the runtime is installed, and why not.

**The extensions** are thin: `packages/local-engine` holds the shared
`AIEngine` implementation (model discovery, load/unload, streaming chat,
import/delete), and each extension only declares its provider id and its
settings schema.

**The web app** starts the engine through the existing model service and
builds the AI SDK transport in `ModelFactory.createLocalEngineModel` — the
same shape MLX uses.

### Model layout on disk

```
<data folder>/local-engine/server.py                 the sidecar
<data folder>/local-engine/<engine>/venv/             the runtime
<data folder>/<engine>/models/<model id>/model.yml    metadata
<data folder>/<engine>/models/<model id>/<file>       the model
```

`model.yml` uses the same keys as llama.cpp:

```yaml
name: Qwen3 0.6B
model_path: model.litertlm   # relative to the model folder, or an absolute path
size_bytes: 344671744
embedding: false
```

A local file is referenced where it is; a URL is downloaded into the engine's
own folder by Jan's download manager.

### Doing it from the GUI

1. **Settings → Providers → LiteRT-LM / OpenVINO.** A banner says whether the
   runtime is ready. If it is not, it says why and offers an **Install**
   button, which creates a virtualenv under the data folder and pip-installs
   the runtime into it.
2. **Import.** The **Import** button takes a local file (`.litertlm`), a local
   folder (the OpenVINO IR), or a download URL.
3. **Chat.** The model appears in the model picker, loads on demand when a
   turn starts, and unloads when the model is stopped.

### Requirements

Python 3.10+ and the runtime package:

```bash
python -m venv ~/.jan-engines/litert
~/.jan-engines/litert/bin/pip install litert-lm
```

| Engine | Runtime package | Interpreter override |
| --- | --- | --- |
| LiteRT-LM | `litert_lm` | `JAN_LITERT_LM_PYTHON` |
| OpenVINO | `openvino_genai` | `JAN_OPENVINO_PYTHON` |

### Where the models come from

| Engine | Source | Example |
| --- | --- | --- |
| LiteRT-LM | Hugging Face, `litert-community` | `litert-community/Qwen3-0.6B` → `Qwen3-0.6B_dynamic_wi4b32_afp32.litertlm` |
| OpenVINO | Hugging Face, the `OpenVINO` org | `OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov` (a directory) |

---

## 2. The native browser

### Why

Jan's `screenshot` tool already shelled out to a local Chrome, but only in
`--screenshot` mode: draw the page, write a PNG, exit. There was no way to
navigate to a URL, read what a page said, click anything, or run script against
it. Browser work was left to MCP servers.

The browser tool drives Chrome over the DevTools protocol instead. It is a
**built-in tool**, so it is advertised to the model under stable names,
dispatched by the same dispatcher as every other tool, and goes through the
same approval gate.

| Tool | What it does |
| --- | --- |
| `browser_open` | Navigate to a URL; returns the page's title and readable text |
| `browser_read` | The readable text of the page the browser is on |
| `browser_eval` | Run JavaScript in the page and return the result |
| `browser_click` | Click the first element matching a CSS selector |
| `browser_type` | Fill a field and fire the `input`/`change` events a form listens for |
| `browser_screenshot` | A PNG of the page, returned as an image the model can see |

### How it works

`src-tauri/plugins/tauri-plugin-agent-tools/src/tools/browser.rs`:

1. **Chrome is started headless** with `--remote-debugging-port=0`, a private
   profile under the temp directory, and the usual no-sandbox flags. Chrome
   publishes the port it picked in `DevToolsActivePort` in the profile, so
   nothing has to guess a port and race another process for it.
2. **The DevTools endpoint is read** over HTTP (`/json/version`), which gives
   the browser's WebSocket URL.
3. **A page target is created and attached** (`Target.createTarget` +
   `Target.attachToTarget` with flat sessions), so the tool never inherits a
   tab the user had open.
4. **Commands go over the WebSocket** (`Page.navigate`, `Runtime.evaluate`,
   `Page.captureScreenshot`, …). The client answers one request at a time and
   drops the browser's unsolicited events while it waits.

One browser is kept per session (thread) so a conversation keeps its page, its
cookies and its login. It is closed with the thread's sandbox, and every
browser process is registered with the session's process table, so the Stop
button and the app's shutdown reap it.

### What it is allowed to do

The browser drives a *live* page, with the session's cookies and the ability
to submit forms. That is more than a fetch, so the browser tools have their
own capability (`Capability::Browser`) and the gate asks for each call rather
than auto-allowing it the way `web_fetch` is. The user can allow the call
once, for the thread, or for the session.

The browser is advertised in both the chat and Cowork tool sets.

### Finding a browser

`CHROME_PATH` wins when set. Otherwise the standard install locations are
probed: Chrome, Chromium, Brave and Edge on Windows, the app bundles on
macOS, and the `/usr/bin` binaries on Linux.

**The Windows paths were missing.** On a stock Windows install the existing
`screenshot` tool only worked if `CHROME_PATH` was set; the Windows
candidates are probed now.

---

## 3. The experience fixes

### No console windows

A console process spawned from a GUI app opens a console window, and that
window stays open for as long as the process lives. Every interpreter the
engine plugin starts is a background helper the user never asked to see, so
none of them may put a window on screen: all of them are started with
`CREATE_NO_WINDOW` on Windows.

### Processes named after their engine

A sidecar running as `python.exe` is indistinguishable from every other
Python on the machine, which makes it both impossible to tell apart and easy
to kill by accident ("stop all python servers" would take the engine with
it). Each engine now runs under its own executable:

```
<data folder>/local-engine/openvino/venv/Scripts/jan-openvino.exe
<data folder>/local-engine/litert-lm/venv/Scripts/jan-litert_lm.exe
```

On Windows the interpreter is *copied* next to the original: a virtualenv's
`python.exe` finds `pyvenv.cfg` in its own directory, so a copy elsewhere
would stop being a virtualenv interpreter. On Unix a symlink is enough, and
the kernel takes the process name from the path it was exec'd with.

### A runtime check that costs nothing

The check used to **import** the engine to see whether it was installed.
Importing OpenVINO loads about two gigabytes of native libraries and takes
over a second, and the process lingered for the whole import.

It now asks the filesystem instead —
`importlib.util.find_spec('openvino_genai')` — which looks for the module
without executing it:

| | before | after |
| --- | --- | --- |
| check | `import openvino_genai` (1.3 s, ~2 GB RSS) | `importlib.util.find_spec(...)` (**97 ms**, a few MB) |
| window | console, stayed open | none |
| frequency | every settings-page open | cached 60 s |

---

## 4. The bug behind the broken OpenVINO answers

The OpenVINO engine answered with two or three words and stopped. The model
was never at fault: called directly, the same model and the same prompt
answer in full every time.

**`openvino_genai`'s `streamer` callback is not a continue/stop flag.**
Returning `True` ends the generation right there. The sidecar's streamer
returned "not yet cancelled" — which is `True` while generating — so every
answer was cut after the first token or two:

| streamer returns | tokens streamed | answer |
| --- | --- | --- |
| `True` | 2 | `'The capital of France'` |
| `None` | 7 | `'The capital of France is Paris.'` |
| `False` | 7 | `'The capital of France is Paris.'` |

Raising from the callback does not work either: OpenVINO catches it, logs
it, and keeps generating. The fix is to return `None`.

A second bug made it look worse: OpenVINO's `LLMPipeline` is **one compiled
model**, so it runs one generation at a time. Jan sends a second request to
the same provider while a turn is still streaming (the thread-title
summarizer), and two generations driven from two threads interleave their
tokens, so each answer came out as fragments of *both*. The sidecar now
serializes them.

LiteRT-LM was never affected: it has no callback, and its streamed output
matches its one-shot output exactly.

---

## 5. Building and running it

```bash
# the web app first: the executable embeds it
yarn build:web

# then the app
cd src-tauri && cargo build --release --bin Jan-Desktop

# put it over the installed one (the original is kept as .orig)
node scripts/patch-installed-jan.mjs \
  --build src-tauri/target/release/Jan-Desktop.exe \
  --install "$LOCALAPPDATA/Programs/Jan"
```

`yarn build:web` and the cargo build must not overlap: the cargo build reads
the web app's `dist` while it embeds it, so a rebuild in the middle of it
makes the asset list stale and the build fails.

Undoing the patch is one copy: put `Jan-Desktop.exe.orig` back.

### Checking an engine end to end

```bash
node scripts/verify-local-engines.mjs \
  --engine openvino \
  --python "<venv>/bin/python" \
  --model "<model dir>"
```

The script starts the same sidecar the plugin runs, asks it a question over
the streaming endpoint, and prints the answer. It fails when the answer does
not end a sentence — a generation that stops early still returns text, so only
the *shape* of the answer catches that class of bug.

---

## 6. What was verified

Both engines were run on the machine, on the CPU only, through the exact
sidecar the plugin ships:

| Engine | Model | Result |
| --- | --- | --- |
| OpenVINO | `OpenVINO/Qwen2.5-1.5B-Instruct-int4-ov` | loads in ~2 s, answered *"Three colors: Red, Blue, Green."* |
| LiteRT-LM | `litert-community/Qwen3-0.6B` (`.litertlm`) | loads in ~2 s, answered with reasoning and *"…**Red, Green, and Blue**…"* |

The browser is covered by a Rust test that drives the real Chrome: it opens
a page, reads its text, evaluates script, clicks a button (the heading
changes), types into a field (the value arrives) and captures a PNG.

Test suites:

| Suite | Result |
| --- | --- |
| `yarn test:core` | 171 passed |
| `yarn test:web` | 4,284 (4,283 in a full parallel run; the one failure is a 30 s-timeout test that passes in isolation) |
| `yarn test:ext` | 368 passed |
| `yarn test:pkg` | 8 passed |
| `cargo test -p tauri-plugin-agent-tools` | 382 passed, 1 pre-existing failure (`monitor::an_unmatched_monitor_times_out`, which also fails on unmodified upstream code) |

---

## 7. Known limitations

- **LiteRT-LM model format.** The runtime accepts the `.litertlm` bundle. The
  older `.task` bundles (for example
  `Qwen2.5-0.5B-Instruct_multi-prefill-seq_q8_ekv1280.task`) load the engine
  but fail at prefill with *"Input token ids are too long … 70 >= 2"*: that
  bundle's static shape is not supported by the current runtime. Use
  `.litertlm`.
- **No tool calling.** Neither runtime exposes a tool-call API yet, so
  `isToolSupported` returns false and the engines cannot drive Jan's shell or
  web-search tools.
- **No embeddings.** The embedding side of the LiteRT-LM runtime exists but is
  not wired into the extensions yet.
- **Python is a runtime dependency.** Unlike llama.cpp (a bundled binary) and
  MLX (a bundled Swift server), these two runtimes are distributed as python
  packages. Jan can install them for the user, but a self-contained build
  would bundle a python and its wheels.
- **No hub catalogue.** The model hub only knows GGUF, so these models are
  brought in by import (or a URL), not from the catalogue.
- **The local API server does not serve these engines.** Its proxy resolves a
  model to the engine session that holds it, and it only has session maps for
  llama.cpp and MLX, so the server's model list leaves the new engines out.
- **No e2e coverage.** The WebdriverIO suite exercises the llama.cpp path.

---

## 8. File map

### Added

| Area | Files |
| --- | --- |
| Engine sidecar | `src-tauri/python-engines/server.py` |
| Engine plugin | `src-tauri/plugins/tauri-plugin-local-engine/` (Rust crate + guest-js + permissions) |
| Engine capability | `src-tauri/capabilities/local-engine.json` |
| Shared engine base | `packages/local-engine/` (workspace package) |
| Engine extensions | `extensions/litert-lm-extension/`, `extensions/openvino-extension/` |
| Browser tool | `src-tauri/plugins/tauri-plugin-agent-tools/src/tools/browser.rs` |
| Runtime banner | `web-app/src/containers/LocalEngineRuntimeBanner.tsx` |
| Model import | `web-app/src/containers/dialogs/ImportLocalEngineModelDialog.tsx` |
| Engine provider list | `web-app/src/lib/localProviders.ts` |
| Scripts | `scripts/verify-local-engines.mjs`, `scripts/patch-installed-jan.mjs` |

### Changed

| Area | Files |
| --- | --- |
| Agent tools | `src-tauri/plugins/tauri-plugin-agent-tools/src/tools/{mod,schema,handlers,gate}.rs`, `src/commands.rs` |
| App crate | `src-tauri/src/core/agent/loop.rs`, `src/core/mcp/server/mod.rs`, `src/core/system/shutdown.rs`, `src/lib.rs` |
| Web app | `web-app/src/lib/{agentTools,model-factory,providerCaps,chatFinish,coworkModelControls,utils,localProviders,custom-chat-transport}.ts`, `web-app/src/containers/{DropdownModelProvider,ModelSetting}.tsx`, `web-app/src/hooks/useTokensCount.ts`, `web-app/src/routes/settings/{local-api-server.tsx,providers/$providerName.tsx}`, `web-app/src/services/core/bundled-extensions.ts` |
| Wiring | `package.json`, `vitest.config.ts`, `web-app/{package.json,vite.config.ts,vitest.config.ts}`, `src-tauri/{Cargo.toml,Cargo.lock}`, `src-tauri/capabilities/default.json` |

### One change worth calling out

The per-engine knowledge that used to be spelled out at a dozen call sites
(`provider === 'llamacpp' || provider === 'mlx'`) is now one list:

```ts
// web-app/src/lib/localProviders.ts
export const LOCAL_ENGINE_IDS = new Set(['llamacpp', 'mlx', 'litert-lm', 'openvino'])
```

It drives the sampler controls, the per-model `ctx_len` setting, the local API
server's model list, the stop-model button, the provider settings page and
Cowork's local-model controls, so a new engine is one line rather than a dozen
edits.

---

## 9. Adding another native tool

The browser was not a special case: there are two ways to add a native tool,
and they cost very different amounts.

### A TypeScript extension tool

An extension implements `getTools()` and `callTool()`; the tool flows through
the same registry as an MCP tool.
`extensions/rag-extension/src/tools.ts` is the template. No Rust, no sandbox
redesign, and it ships in the app bundle.

This is the way to add a tool that works with files, the OS, or an API.

### A Rust built-in

A tool that has to run inside the OS sandbox, or that touches native APIs,
belongs in the agent-tools plugin:

1. a schema in `src/tools/schema.rs` (one entry per tool),
2. an entry in `BUILTIN_TOOLS` in `src/tools/mod.rs`, with its capability,
3. a handler in `src/tools/handlers.rs`, dispatched by name,
4. the name in `AGENT_TOOL_NAMES` in `web-app/src/lib/agentTools.ts`, so the
   chat advertises it.

The gate gives the tool its approval behaviour from the capability alone: a
`Read` tool is allowed, a `Write` or `Exec` tool asks, a `Net` tool is allowed
like `web_fetch`, and `Browser` asks because it can act as the user on a site.

### Tooling that is already there but not exposed

- `tauri-plugin-hardware` — CPU, RAM and GPU usage
- `tauri-plugin-rag` — PDF and document parsing
- `tauri-plugin-vector-db` — sqlite-vec collections
- `tauri-plugin-dialog` — file and folder pickers
- `tauri-plugin-store` — the settings store
