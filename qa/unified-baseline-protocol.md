# Unified flow: baseline fixtures and local-model measurement protocol

Preparation for jan-internal#506 (parent #500, integration PR janhq/jan#9529).
**Status: preparation only.** Nothing in this file or its fixtures is a measured
result, a performance budget or a rollout sign-off. No real model has been run
against these fixtures yet. Rollout gates and budgets stay open in #506.

Release-level performance (cold start, idle memory, model load, tok/s, long
threads) is covered by the #491 method and #494; this protocol only adds what is
specific to the unified flow: the cost of the tool schemas and the agent system
prompt, and the extra model requests a tool-using turn makes.

## What is in the repo

| Path | What it is |
|---|---|
| `scripts/capture-cowork-schema-fixture.mjs` | Copies the built-in tool schemas out of `src-tauri/plugins/tauri-plugin-agent-tools/src/tools/schema.rs` into `qa/fixtures/unified-baseline/builtin-schemas.json`. `--check` fails on drift. Assumes desktop `tauri` feature, POSIX shell, no escalation. |
| `web-app/src/lib/__tests__/unifiedBaseline.test.ts` | Builds the first-turn request for each scenario with the production code paths (chat transport, Cowork tool and prompt builders, `getAgentToolSchemas` filtering). Only the native IPC boundary and app-state stores are stubbed. Writes `requests/*.json` and `summary.json` as file snapshots. Also checks how many model requests the current Cowork loop makes for scripted task shapes. |
| `qa/fixtures/unified-baseline/requests/*.json` | Replayable OpenAI-compatible `messages` + `tools` per scenario. |
| `qa/fixtures/unified-baseline/summary.json` | UTF-8 byte sizes of the system prompt, tools JSON and whole request per scenario. |
| `scripts/unified-baseline-replay.mjs` | Replays the request fixtures against a **loopback** server (literal `127.0.0.1` or `[::1]`) and records server-counted prompt tokens, TTFT, total latency and peak RSS of one PID. Refuses non-loopback URLs and redirects, redacts the key from errors, and rejects truncated streams. |
| `scripts/unified-baseline-replay.test.mjs` | Checks the replay mechanics against a fake loopback server only. |

Scenarios (one user turn `Reply with OK.`, no memory notes, no files, no
MCP/RAG, web search off, Cowork subagents off, fixed date 2026-01-01):

- `chat-bare`: chat with no assistant and the shell switched off. The floor.
- `chat-default-assistant`: chat with Jan's built-in default assistant, shell off (or no sandbox).
- `chat-default-assistant-shell`: same, plus the sandboxed `shell` tool and its prompt paragraph.
- `cowork-execute`, `cowork-plan`, `cowork-execute-no-sandbox`: the current Cowork request in each mode.

### What the bytes mean, and what they do not

Bytes are a deterministic way to spot request-shape changes in review. They are
**not** tokens (tokenizers and chat templates differ per model, and tool JSON
is re-rendered by the template), not latency, and not memory. The request
fixtures are a projection: they omit sampling options, llama.cpp slot
parameters (`id_slot`, `thread_id`), `stream`, and the provider wrapper the AI
SDK adds. The scripted model-request counts come from scripted streams, not from
model behaviour; a real model may take more or fewer steps.

### Regenerating

```sh
node scripts/capture-cowork-schema-fixture.mjs          # after schema.rs changes
(cd web-app && npx vitest run src/lib/__tests__/unifiedBaseline.test.ts -u)
node --test scripts/unified-baseline-replay.test.mjs
```

Review the fixture diff. A changed request is a changed prompt prefix for every
user, so a large jump in `summary.json` deserves a measured replay before merge.

## Measurement protocol (real local model)

Run on an isolated data folder, never the tester's real Jan data (see #493's
isolation guard). Use no remote providers and no credentials other than a
throwaway Local API key set for this run.

### Fixed inputs (same as #491, so results line up)

- Model: Qwen3.5-4B GGUF Q4_K_M (IQ4_XS on Windows x64 where Q4_K_M is not
  offered), default llama.cpp settings. Record the exact file name and its
  sha256.
- Second model for the non-tool path: one without the `tools` capability, named
  in the report.
- Record per row: machine, OS version, CPU/GPU, RAM, llama.cpp backend (Metal,
  CUDA, Vulkan, CPU), Jan build (CI artifact, not a local build; see #494 on
  toolchain skew), branch and commit.
- `temperature 0`, `max_tokens 256`, 1 warm-up + 3 measured runs, report the
  median and keep the raw runs.

### Layer 1: request-shape overhead, replayed

This isolates what the schemas and prompts cost the model, without UI or
scheduling noise.

1. Start Jan, load the model, and enable Local API Server (default
   `http://127.0.0.1:1337/v1`). Set a throwaway API key for the run if none is set.
2. Find the inference process: `pgrep -f jan-llama-worker` (macOS/Linux).
3. Cold prefill (no KV prefix reuse):

   ```sh
   node scripts/unified-baseline-replay.mjs --base-url http://127.0.0.1:1337/v1 \
     --model <model id> --api-key <throwaway local api key> --pid <worker pid> --out cold.json
   ```

4. Warm prefix (what a repeat turn in the same thread sees): add `--cache-prompt`
   and write `warm.json`.
5. Validity check: in `cold.json`, measured runs should report
   `serverPromptTokens` close to `promptTokens`. If it is much smaller on runs
   2 and 3, the prefix cache was hit, so the cold numbers are not cold. Record
   this rather than discarding it, and check whether the Local API forwards
   `cache_prompt`.

Differences from the app's own traffic: the app talks to the worker's
OS-assigned port directly with a per-session key, sends `cache_prompt: true`
and slot parameters (`id_slot`, `thread_id`). The replay goes through the Local
API proxy (one extra hop; the proxy re-serializes the body and normalizes
untyped tool properties, which changes nothing in the current fixtures) and
omits slot parameters, so requests land on the default slot.

What it reports: `promptTokens` as the server counted them (the real token
cost of each scenario for that model and template), TTFT (time to the first
streamed content, reasoning or tool-call delta), total latency, llama.cpp's own
prompt-processing time when exposed, and peak RSS of the worker process.

Limits: RSS is resident CPU memory of one process. On discrete GPUs, VRAM is
not in it; record it separately (for example `nvidia-smi` during the run). On
Apple Silicon unified memory, Metal buffers may not show up fully in RSS. The
sampler polls `ps` asynchronously every 100 ms, so it can miss short peaks
and adds a little scheduling noise to the timings. The script has no RSS
sampling on Windows; use Task Manager or `Get-Process` and say
so in the report.

### Layer 2: in-app tasks, current chat vs unified flow

Layer 1 does not see what users see: template rendering in the app, slot
parking, multiple model requests per tool turn, tool execution and UI. Run each
task in the current Chat surface and in the unified flow build under test, on
the same model and machine.

| ID | Task | Surfaces |
|---|---|---|
| T1 | Direct answer: `Reply with OK.` | Chat, unified |
| T2 | Read a seeded file in the workspace and answer a question about it | Cowork today, unified |
| T3 | Read a file, write a changed copy, confirm | Cowork today, unified |
| T4 | Permission failure: a write the user denies, then the model recovers | Cowork today, unified |
| T5 | T1 on the non-tool model | Chat, unified |
| T6 | T1 with networking disabled | Chat, unified |
| T7 | A thread pre-filled to near the context limit, then T1 | Chat, unified |
| T8 | T2 with one configured MCP server that fails to start | Chat, unified |

Per task, 1 warm-up + 3 timed runs for latency; for reliability, at least 10
attempts of T2 to T4 per model:

- TTFT: send to first visible token. Total: send to turn complete.
- Number of model requests in the turn (compare to the scripted counts in the
  test).
- Peak memory: summed RSS of the Jan process and its children, sampled every
  ~100 ms across the run (`ps` loop on macOS/Linux, `Get-Process` on Windows),
  plus VRAM where applicable.
- Tool reliability: right tool chosen, arguments valid, no malformed calls.
- Completion: the task's stated outcome reached without user rescue.

Where a number cannot be measured on a platform, write "not measured" and why.

### Reporting

Post results on #506 as a comment, one table per machine, with both raw JSON
outputs attached or linked. Compare with the #491 baseline for the shared
metrics. Name every gap (platforms, remote providers, GPUs) explicitly.

### Budgets

None are set here. Budgets are agreed from measured baselines, per the
unified-flow plan, after layers 1 and 2 have been run on the target hardware.

## Not covered by this preparation

- No real-model run and no numbers.
- Remote providers (excluded: no real providers or credentials in this task).
- Memory notes, attachments, web search, MCP tools and subagents in the request
  fixtures; multi-turn and compaction requests.
- Windows shell descriptions (`PowerShell`/`cmd` prefixes) and escalation
  schemas in the native schema fixture.
- Legacy history, migration, delete/cleanup, resume and feature-flag rollback QA
  (other #506 acceptance items).
