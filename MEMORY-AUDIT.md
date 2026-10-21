# Memory audit — Jan-AI-modded

Static audit of the working tree (`feat/local-cpu-engines`, on top of `janhq/jan@ce8fcd2`).
Scope: the new LiteRT-LM / OpenVINO engines, the native browser tool, and the
llama.cpp defaults they now sit next to.

No runtime profiling was done. Numbers marked **est.** are derived from the code
and the KV-cache formula, not measured on this machine.

> **Status (2026-10-21):** every finding below was fixed in the working tree.
> See [Fix pass](#fix-pass) for the change made against each one. The analysis
> itself is kept as originally written.

---

## Verdict

The new engines are deliberately light: a 4k default context, a small stdlib
sidecar, no model data in the UI process, and bounded agent-tool output. That is
the right shape for a 16 GB laptop.

At the time of the audit the repo had three OOM-shaped defects:

1. **Nothing unloaded a model of another engine.** llama.cpp at a large context
   and an OpenVINO model could be resident together.
2. **llama.cpp defaulted to `f16` KV cache** with auto-fit off, so a 131k
   context could reserve more RAM than the machine has.
3. **Cowork persisted browser screenshots as base64 in `settings.json`.** The
   new screenshot path had no size cap, and the transcript kept the base64.

Everything else below was a spike or a leak of tens to hundreds of megabytes,
not an immediate OOM.

---

## Fix pass

| Finding | Change |
| --- | --- |
| **C1** cross-engine models | `services/models/default.ts`: `startModel` calls `stopOtherEngines(provider)` before an auto-unload load; `stopAllModels()` unloads every engine. |
| **C2** f16 KV / fit off | `llamacpp-extension/settings.json`: `fit` on, `cache_type_k = q8_0`, `cache_type_v = q4_0`; `src/preset.ts` emits cache types only when they differ from `f16`, so the default stays llama.cpp's. `src/index.ts`: `migrateMemoryDefaults` rewrites the old f16/fit-off values that a persisted settings file would otherwise keep; the old `migrateFitOff` (which would have undone the new default on first run) is gone. |
| **C3** screenshots in `settings.json` | `browser.rs`: 4 MiB cap (PNG → JPEG q80/q55/q35 with a shrinking viewport, error past that). `tool-image-sentinel.ts`: `withoutToolImageSentinels` strips them when Cowork messages are committed and in the v2 migration; `messages.ts` strips them from chat tool output before storage. |
| **H1** full page text | `browser.rs`: `innerText` is sliced in the page before the WebSocket reply; `browser_eval` stringifies and slices the result inside the evaluated expression. |
| **H2** LiteRT concurrency | `server.py`: `LiteRtLmBackend.generate` runs under `self._lock`, and the conversation is closed in `finally`. |
| **H3** OpenVINO ctx_size | `server.py`: pipeline gets `MAX_PROMPT_LEN`/`MIN_RESPONSE_LEN` derived from `ctx_size`, `GenerationConfig(max_length=ctx_size)` where supported, and prompts are truncated to the remaining window. Runtime note: the 2026.4.1 CPU plugin rejects `MAX_PROMPT_LEN` (`Unsupported property ... by CPU plugin`), so on this machine the fallback (`max_length` + truncation) is what applies. |
| **H4** aborted generation | `server.py`: per-request `threading.Event`, bounded queue, generator closed on `BrokenPipe`/`ConnectionReset`, and the consumer drains and joins the worker. |
| **H5** idle Chrome | `browser.rs`: `last_used` per session, a 10-minute idle reaper checked every minute, `close_thread` falls back to an async lock, and thread stop closes the browser (`commands.rs`). |
| **M1** unbounded body | `server.py`: 16 MiB `Content-Length` cap answered with 413 before reading. |
| **M2** cosmetic dimensions | `browser.rs`: `Emulation.setDeviceMetricsOverride` applies the requested viewport. |
| **M3** duplicated answer | `server.py`: running `streamed_len` instead of a token list plus join. |
| **M4** chat tool images | `routes/threads/$threadId.tsx`: tool results append `encodeToolImageSentinel` parts, so the model sees them; the transcript keeps only the note. |
| **M5** token meter | `packages/local-engine/src/index.ts`: `getModelProps` returns the session's `ctx_size`; `llamacppRouterProps.ts` resolves it for the new engines; `useTokensCount.ts` re-reads the provider setting. |
| **M6** unbounded listing | `packages/local-engine/src/index.ts`: depth cap 3 and hidden directories skipped. |
| **M7** full process refresh | `commands.rs`: `refresh_processes(ProcessesToUpdate::Some(&[target]))`. |
| **M8** buffered pip | `process.rs`: stdout/stderr streamed to the log, only the last 40 lines retained for the error message. |

Verification: `python -m py_compile`, `cargo check` for both plugins, the new
`base64_size_is_estimated_without_decoding` test, targeted Vitest suites, and
`tsc -b` all pass. The resident-memory figures below were measured afterwards
on this machine; see **Runtime measurements**.

---

## Realistic worst case on this machine

| Component | Resident estimate |
| --- | --- |
| llama.cpp, 4B Q4_K_M, 131k ctx, `f16` KV | **~19 GB KV + ~2.5 GB weights** → will not fit |
| llama.cpp, same, `q8_0` K + `q4_0` V | **~7.7 GB KV + ~2.5 GB weights** → ~10 GB, tight |
| OpenVINO 1.5B INT4 (+ runtime) | ~1.5–2.5 GB |
| LiteRT-LM 0.6B | ~0.5–1 GB |
| One headless Chrome | ~200–400 MB |
| Python sidecar baseline | ~30–60 MB |
| Jan webview + Rust core + Qoder | ~2–4 GB |

KV estimate for a Qwen3-4B layout (36 layers, 8 KV heads, head_dim 128):

```
values/token = 2 × 36 × 8 × 128 = 73,728
f16        ≈ 144 KB/token   → 131k ≈ 18.9 GB
q8_0/q8_0  ≈  76 KB/token   → 131k ≈ 10.0 GB
q8_0/q4_0  ≈  58 KB/token   → 131k ≈  7.7 GB
q4_0/q4_0  ≈  40 KB/token   → 131k ≈  5.3 GB
```

The largest single win available is `q8_0`/`q4_0` KV and a context the machine
can actually hold, not an engine refactor.

---

## Runtime measurements (this machine)

Installed build, 16 GB machine, Windows 11. Values are MiB of Working Set;
"private" is `PrivateMemorySize64`. Each row is one run with the same sidecar
and binaries the app uses, driven directly at the HTTP port (no WebView
overhead), one chat request of up to 128 new tokens.

### Idle app

| Process | Working set |
| --- | --- |
| `Jan-Desktop.exe` (Rust core) | 87.8 |
| WebView2 process group | 439.5 |
| idle `jan-llama-worker.exe` (no model) | 186 |
| **Jan total, no model loaded** | **~713** |
| user-configured MCP servers (3 × python) | ~225 (not Jan's own cost) |

### llama.cpp (`jan-llama-worker.exe`)

| Model | ctx | KV cache | Peak WS | Peak private |
| --- | --- | --- | --- | --- |
| Qwen2.5 1.5B Q4_K_M | 32,768 | `f16` | 2,284 | 2,324 |
| Qwen2.5 1.5B Q4_K_M | 32,768 | `q4_0` / `q4_0` | 1,629 | 1,677 |
| Gemma-4-E2B Q4_K_M | 32,768 | `f16` | 4,252 | 4,342 |
| Gemma-4-E2B Q4_K_M | 32,768 | `q4_0` / `q4_0` | 4,035 | 4,134 |
| Qwen2.5 1.5B Q4_K_M | 65,536 | `q4_0` / `q4_0` | 1,953 | 2,002 |
| Qwen2.5 1.5B Q4_K_M | 65,536 | `q8_0` / `q4_0` | 2,177 | 2,226 |
| Qwen2.5 1.5B Q4_K_M | 131,072 | `q4_0` / `q4_0` | 2,589 | 2,638 |
| Qwen2.5 1.5B Q4_K_M | 131,072 | `q8_0` / `q4_0` | 3,049 | 3,090 |
| Qwen2.5 1.5B Q4_K_M | 131,072 | `q8_0` / `q8_0` | 3,497 | 3,541 |
| Qwen2.5 1.5B Q4_K_M | 131,072 | `q8_0` / `q4_0`, no KV offload | 3,024 | 3,073 |

What the measurements confirm:

- Quantized KV saves **655 MiB** on Qwen 1.5B at 32k (29%) and **217 MiB** on
  Gemma E2B (5%). Gemma's SWA model keeps a window-sized cache by default
  (`swa-full` off), so its KV is small and there is less to save.
- The context is the dominant term and the growth is linear: Qwen 1.5B adds
  ~9.7 KiB per token (`q4_0`/`q4_0`), 324 MiB from 32k to 64k and 630 MiB from
  64k to 128k. `q8_0`/`q8_0` costs another 700 MiB at 131k over `q8_0`/`q4_0`.
- `no-kv-offload` changes nothing measurable on this UMA iGPU (25 MiB, noise):
  the KV buffer is in the same system RAM either way.
- **Quality, not just size:** with `q4_0` keys at 64k and 131k the Qwen model
  answered with "You You You" loops in two separate runs. `q8_0` keys produced
  coherent answers at the same contexts. K carries the attention addressing and
  is the half to keep at 8 bits; `q8_0` K + `q4_0` V is the right default.

### LiteRT-LM (Qwen3 0.6B, 345 MB bundle)

| ctx | After load (health OK) | After first reply | 32 tokens |
| --- | --- | --- | --- |
| 4,096 | 1,053 WS / 1,344 private | **1,512 WS / 1,479 private** | 16.5 s |
| 8,192 | 1,950 WS / 2,242 private | **2,521 WS / 2,491 private** | 25.5 s |
| 16,384 | 3,741 WS / 4,036 private | **4,543 WS / 4,513 private** | 43.1 s |
| 32,768 | 7,326 WS / 7,627 private | **8,489 WS / 8,575 private** | 128.3 s |
| 65,536 | 7,326 WS / 7,628 private | **8,583 WS / 8,566 private** | 39.4 s |
| 131,072 | 7,327 WS / 7,627 private | **8,585 WS / 8,566 private** | 38.3 s |

LiteRT preallocates per position, not just KV: roughly **250 MiB per 1,000
tokens** between 4k and 32k on a 0.6B model. Eight times the context costs
about **7 GiB more** than 4k — more than ten times the model bundle.

Above 32,768 the bundle clamps silently. The loader logs `Target number hint
131072 is ... larger than magic number 32771. Use default target number
32768`, so 64k and 131k allocate exactly the 32k buffers and the extra window
is not real. The extension's 4,096 default is safe; its 32,768 maximum costs
8.5 GiB and is not safe beside the rest of the desktop on 16 GB.

### OpenVINO GenAI (Qwen2.5 1.5B INT4, 910 MB weights)

| ctx | After load (health OK) | After first reply | 32 tokens |
| --- | --- | --- | --- |
| 4,096 | 241 WS / 575 private | **1,968 WS / 1,489 private** | 11.6 s |
| 32,768 | 243 WS / 577 private | **1,972 WS / 1,494 private** | 5.2 s |
| 65,536 | 243 WS / 577 private | **1,966 WS / 1,488 private** | 6.8 s |
| 131,072 | 248 WS / 582 private | **1,971 WS / 1,492 private** | 11.5 s |

Three findings:

- `health` returning OK does **not** mean the weights are resident: the
  pipeline compiles and allocates at the first generation, so the real surge
  (+1.7 GiB) happens on the first message, not when the model is "loaded".
- The CPU plugin rejects the pipeline window properties at every context size:
  `NotFound: Unsupported property MAX_PROMPT_LEN by CPU plugin`. The H3 fix's
  `MAX_PROMPT_LEN`/`MIN_RESPONSE_LEN` path therefore never applies on this
  OpenVINO build; the per-request `max_length` and prompt truncation are the
  only caps that run. The code already falls back, so behavior is safe, but
  the pipeline property is not what keeps memory flat.
- The stateful pipeline allocates on demand and does not preallocate the
  window; 4k and 131k are indistinguishable for a short prompt. The 1.5B model
  is trained to 32k, so 64k/131k requests fall back to the model's own window.
  Its footprint is dominated by weights plus the runtime.

### Caveats

- One run per row except the `q4_0`-key quality check; private/working set are
  per-process and WebView2 is a process group.
- Cross-engine unload (`stopOtherEngines`) is covered by unit tests that assert
  the other engine's `unload` runs before the new engine's `load`. It was
  **not** driven end-to-end through the installed UI, because WebView2 exposes
  no scriptable controls in this build.
- The sidecars were driven directly, not through the UI, so the numbers exclude
  WebView/React overhead (~0.5 GiB) but include everything the model does.

---

## Critical

### C1. Models from different engines are loaded at the same time

`startModel` loads inside the target engine only, and each engine's `autoUnload`
only walks its own sessions:

- `web-app/src/services/models/default.ts:405-446` — resolves one engine and
  calls its `load`.
- `packages/local-engine/src/index.ts:268-274` — unloads only entries in
  `this.sessions`, i.e. this engine's models.
- llama.cpp's `models_max` limit is router-scoped
  (`extensions/llamacpp-extension/settings.json:15`), not global.

**Scenario:** a 131k llama.cpp model is loaded; the user switches the picker to
an OpenVINO model. OpenVINO starts, llama.cpp stays resident. That is the
documented OOM shape on 16 GB.

**Fix:** before `load`, stop every *other* local engine's loaded models (or keep
one global "active local model" and unload it first). Also expose an idle TTL.

### C2. llama.cpp reserves `f16` KV by default, and fit is off

- `extensions/llamacpp-extension/settings.json:330-380` — `cache_type_k` and
  `cache_type_v` default to `f16`.
- `extensions/llamacpp-extension/settings.json:39-45` — `fit` defaults to
  `false`.
- `extensions/llamacpp-extension/src/preset.ts:97,243-252` — the 8192 fallback
  exists, but a per-model `ctx_len` overrides it
  (`preset.ts:595`), with no memory guard.
- `src-tauri/plugins/tauri-plugin-llamacpp` allocates the KV cache from the
  requested `ctx-size`.

**Scenario:** per-model `ctx_len = 131072` with untouched KV settings. For a
4B-class model that is ~19 GB of KV before weights. The machine swaps or the
allocation fails.

**Fix:** default KV to `q8_0`/`q4_0` (or warn above a threshold), turn `fit` on
by default, and cap the context UI at a value derived from installed RAM.

### C3. Browser screenshots are persisted as base64 in `settings.json`

- `src-tauri/plugins/tauri-plugin-agent-tools/src/tools/browser.rs:751-772` —
  `browser_screenshot` returns the PNG as a data URL with **no size cap**.
  The existing `screenshot` tool caps at 4 MiB
  (`handlers.rs:1449,1597`); the browser path does not.
- `web-app/src/lib/coworkRunner.ts:285-320` — the image is encoded as a
  `__JAN_TOOL_IMAGE__<base64>` sentinel inside the tool output text.
- `web-app/src/hooks/useCoworkSessions.ts:140-150,233-244` — `messages` (which
  carry those sentinels) are persisted through `backendStorage` into
  `<jan_data>/settings.json`.
- Sentinels are stripped only for token estimation
  (`context-manager.ts:69`) and for text-only models
  (`custom-chat-transport.ts:547`), not before persistence.

**Scenario:** a dozen screenshots across Cowork sessions → tens of MB of base64
in `settings.json`, read into memory at startup and rewritten on every session
update. The comment at `coworkRunner.ts:43` says images are never persisted; the
code does persist them.

**Fix:** strip sentinels when committing session messages and keep only a
reference (or a scratch-file path); cap the PNG at 4 MiB like the `screenshot`
tool; prefer JPEG/quality or a smaller viewport.

---

## High

### H1. Page text is transferred in full, then truncated

`browser.rs:444-459` evaluates `document.body.innerText` with
`returnByValue: true`; the 40k-character cap is applied afterwards
(`browser.rs:431-441`), after the WebSocket frame has been buffered and parsed
into a `Value`.

A page with 20 MB of text costs tens of MB of transient heap, and a single frame
over tungstenite's default maximum fails the call entirely.

**Fix:** slice in the page (`document.body.innerText.slice(0, 80000)`) and cap
`browser_eval` results the same way (stringify + slice inside the evaluated
expression).

### H2. LiteRT-LM requests are not serialized

`EngineBackend.__init__` creates `self._lock`
(`src-tauri/python-engines/server.py:54`), but `LiteRtLmBackend.generate`
(`server.py:109-132`) never takes it. OpenVINO does take it
(`server.py:160,213`).

**Scenario:** the chat turn and the thread-title summarizer overlap, creating
two conversations and two KV caches against one `Engine`, at up to `ctx_size`
each (32k in the current UI). That is a double allocation spike and a
thread-safety risk in the runtime.

**Fix:** wrap `generate` in `with self._lock:`.

### H3. OpenVINO ignores the configured context size

`ctx_size` is parsed and passed to the sidecar
(`packages/local-engine/src/index.ts:285-288`, `process.rs:285-288`), and LiteRT
uses it (`server.py:86-88`), but `OpenVinoBackend` never applies it
(`server.py:148-160,215-217`). The pipeline runs with the model's own maximum.

Meanwhile the UI now treats these engines as context-aware
(`web-app/src/lib/chatFinish.ts:15-17`), and chat can send a much larger prompt
than the engine was configured for.

**Fix:** pass a max length / truncate the rendered prompt to `ctx_size`, and
report the effective window.

### H4. An aborted generation keeps generating (OpenVINO)

Streaming writes go straight to `wfile` (`server.py:438-457`). When the client
aborts, the write raises and the loop exits (`server.py:458-460`), but:

- the worker thread has no cancellation flag and keeps generating to
  `max_new_tokens`;
- `streamed` and the queue keep growing while it does
  (`server.py:192-239`);
- the generation holds `self._lock`, so the next request waits behind work
  nobody wants.

`self._chunks` is also an instance attribute, not per request
(`server.py:193,250`).

**Fix:** a per-request `threading.Event` checked in `streamer`; return a sentinel
or raise a private exception to stop; key the queue locally in `generate`.

### H5. One Chrome per thread, never reaped while idle

- `browser.rs:132-135` — a process-global map keyed by thread.
- `browser.rs:415-428` — only explicit close or app shutdown kills it.
- `browser.rs:776-783` — `close_thread` uses `try_lock` and silently does
  nothing if the lock is held. `call_page` holds that lock for the whole CDP
  command (`browser.rs:407-411`), including a 60 s navigation, so a stop during
  navigation can leave the browser running.

Each idle Chrome is ~200–400 MB. Several Cowork sessions with browsing → over a
gigabyte of browsers that nothing will free until exit.

**Fix:** idle timeout per session, `close_thread` with `lock().await` or a
per-session mutex, and close on thread stop rather than only on deletion.

---

## Medium

### M1. Unbounded request body in the sidecar

`server.py:303-317` reads `Content-Length` bytes with no cap, decodes the whole
body to a string, then parses it. Base64 images in a long chat are re-sent every
turn, so the body grows with the transcript; peak is roughly 3–4× the JSON size.

**Fix:** reject bodies over a configured limit (e.g. 16 MB) and stream-decode
nothing else.

### M2. Screenshot dimensions are cosmetic

`browser.rs:740-755` clamps `width`/`height` and prints them, but the CDP call
passes only `format` and `captureBeyondViewport: false`. The capture is the
default 800×600 viewport regardless of the request, so the label lies and the
caller cannot shrink the image.

**Fix:** `Emulation.setDeviceMetricsOverride` or a `clip` with the requested
size.

### M3. The whole OpenVINO answer is duplicated

`server.py:194,222-231` accumulates every token in `streamed`, joins it, and
compares it with the returned string to compute a remainder. Peak holds the
answer three times (list of tokens, join, result).

**Fix:** trust the streamer and keep only the remainder bookkeeping when the
result is actually longer, or build a running length instead of a list.

### M4. Chat silently discards tool images

`web-app/src/routes/threads/$threadId.tsx:823-836` records only
`result.content`; `result.images` is dropped. `browser_screenshot` therefore
returns a text line and no image in chat. Cowork keeps them.

**Fix:** append the sentinel for chat too, or make the tool return a file path
the model can `read`.

### M5. Token meter and context guard do not know the new engines

`web-app/src/lib/llamacppRouterProps.ts:40-46` returns a props extension only
for `llamacpp` and `mlx`, so `useTokensCount` gets no `modelProps` for
`litert-lm`/`openvino` (`useTokensCount.ts:140-160`). The meter shows
0/undefined, so nothing warns before a long prompt is sent.

New engines also have a provider-level `ctx_size`, not the per-model `ctx_len`
that the context logic reads.

**Fix:** implement `getModelProps` in `LocalEngineExtension` (return the
configured `ctx_size`), and add it to `getLocalPropsExtension`.

### M6. Recursive model listing descends without bounds

`packages/local-engine/src/index.ts:230-252` walks every subdirectory until it
finds a `model.yml`, following stat. A symlink loop or an imported folder that
contains a large tree makes `list()` slow (and keeps paths in memory). It is
called on provider open.

**Fix:** skip symlinks, hidden directories, and cap depth (a model is at
`<models>/<id>/model.yml`).

### M7. `is_local_engine_process_running` refreshes every process

`src-tauri/plugins/tauri-plugin-local-engine/src/commands.rs:89-106` builds a
new `sysinfo::System` and refreshes **all** processes per call. Nothing calls it
today, so it is dormant — but if it is wired to a UI poll it allocates and walks
the process table on every tick.

**Fix:** refresh only the target PID (`ProcessesToUpdate::Some(&[pid])`).

### M8. `pip install` output is buffered whole

`process.rs:495-506` uses `.output()`, capturing all of pip's stdout/stderr.
Tens of MB worst case, transient.

**Fix:** stream to the log if this ever becomes visible.

---

## What is already good (do not "optimize" these)

- New engines default to **4096** context, capped at 32768
  (`extensions/litert-lm-extension/settings.json`), and their models load in a
  **separate process** — the webview never holds weights.
- Agent tools cap output at **64 KB**, spill shell overflow to a file, and cap
  `read` images at 20 MB (`handlers.rs:22-33`).
- The existing `screenshot` tool caps PNGs at **4 MiB**
  (`handlers.rs:1449`).
- The runtime probe uses `find_spec`, is cached 60 s, and does not import the
  runtime (`commands.rs:150-208`).
- Sidecars start without a console window, are named per engine, and are reaped
  on unload and shutdown (`process.rs`, `shutdown.rs`).
- llama.cpp keeps `models_max = 1` and `mmap` on by default.
- Browser text is bounded to 40k characters and screenshots do not capture
  beyond the viewport (`browser.rs:40,754`).
- The sidecar streams with chunked encoding instead of buffering the answer
  (`server.py:417-457`).

---

## Suggested order of work

Implemented in this order during the fix pass:

1. **KV cache defaults** (`q8_0`/`q4_0`) and a RAM-aware context cap — biggest
   single win, no engine changes.
2. **Global local-model unload** across engines before a load.
3. **Strip screenshot sentinels before persisting** Cowork sessions; cap the
   PNG at 4 MiB.
4. **Serialize LiteRT** and add OpenVINO cancellation/`ctx_size`.
5. **Idle-close browsers**, and bound page text in the page itself.
6. **Token meter** for the new engines, so the user sees the window before it
   hurts.

The RAM-aware context cap (the second half of step 1) was **not** implemented:
the defaults changed, but the UI still accepts a context larger than installed
memory can hold. That remains an open item.

---

## How to confirm on this machine

- Watch the three processes separately while a model is resident:
  `jan-litert_lm` / `jan-openvino` (sidecar), the llama-server child, and
  `chrome.exe` (the browser tool).
- After stopping a model, confirm the sidecar is gone (no `jan-*` process) and
  check free RAM before starting another engine.
- Reproduce C2 by loading a 4B model at 32k with `f16` KV, then at 131k, and
  comparing `Working Set`; the delta should track the KV formula above.
- Reproduce C3 by taking three browser screenshots in one Cowork session, then
  checking the size of `<jan_data>/settings.json`.
