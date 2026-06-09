# Codex App Server Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tested Codex app-server adapter that Jan can use as an agent backend while keeping the existing chat UI and session flow intact.

**Architecture:** Use GitHub and the generated app-server schema for protocol shape, but keep Jan's implementation as a small TypeScript boundary over an injectable stdio-like process. The first slice does not replace Jan's chat transport; it creates the protocol/session layer that future chat-provider wiring can consume.

**Tech Stack:** TypeScript, Vitest, Codex `app-server` JSONL transport, Tauri-compatible process abstraction.

---

## File Structure

- Create `web-app/src/lib/codex-app-server/types.ts`: shared JSON-RPC, process, session, and high-level stream event types.
- Create `web-app/src/lib/codex-app-server/json-rpc.ts`: line-delimited JSON-RPC client for app-server wire messages.
- Create `web-app/src/lib/codex-app-server/config.ts`: command/config helpers for isolated `CODEX_HOME` and provider/profile overrides.
- Create `web-app/src/lib/codex-app-server/process-manager.ts`: lifecycle wrapper around an injected app-server process spawner.
- Create `web-app/src/lib/codex-app-server/client.ts`: high-level session API for thread start/resume, turn start, streaming deltas, interruption, approvals, and shutdown.
- Create `web-app/src/lib/codex-app-server/tauri-process.ts`: desktop process spawner that talks to Tauri app-server process commands.
- Create `web-app/src/lib/codex-app-server/ui-stream.ts`: map Codex events into existing AI SDK UI stream chunks.
- Create `web-app/src/lib/codex-app-server/chat-backend.ts`: build runtime Codex config from app provider settings and route chat messages through app-server sessions.
- Create `web-app/src/lib/codex-app-server/index.ts`: public exports.
- Create `web-app/src/lib/codex-app-server/__tests__/json-rpc.test.ts`: protocol-level tests.
- Create `web-app/src/lib/codex-app-server/__tests__/client.test.ts`: session/stream tests with a fake process.
- Create `web-app/src/lib/codex-app-server/__tests__/tauri-process.test.ts`: frontend Tauri process bridge tests.
- Create `web-app/src/lib/codex-app-server/__tests__/live-app-server.test.ts`: live process test that starts the installed Codex app-server binary and completes one mocked provider turn.
- Modify `src-tauri/src/core/studio/commands.rs`: managed Codex app-server start/write/stop/list/config commands.
- Modify `src-tauri/src/lib.rs`: register Codex app-server commands with Tauri invoke handler.
- Modify `web-app/src/lib/custom-chat-transport.ts`: route the `codex` provider through Codex app-server while preserving the existing chat hook/UI.
- Modify `web-app/src/stores/chat-session-store.ts`: shut down Codex app-server transports when chat sessions are removed or cleared.
- Modify `web-app/src/constants/providers.ts`: add an app-level `codex` provider for runtime Codex target provider/model configuration.

## Task 1: JSONL Protocol Boundary

- [x] **Step 1: Write failing tests**

Run: `yarn workspace @janhq/web-app test src/lib/codex-app-server/__tests__/json-rpc.test.ts`
Expected: fail because `CodexJsonRpcClient` does not exist yet.

- [x] **Step 2: Implement JSON-RPC client**

Create `types.ts` and `json-rpc.ts` with request, response, notification, server request, timeout, malformed-line, and process-exit handling.

- [x] **Step 3: Verify tests pass**

Run: `yarn workspace @janhq/web-app test src/lib/codex-app-server/__tests__/json-rpc.test.ts`
Expected: pass.

## Task 2: Session Stream Adapter

- [x] **Step 1: Write failing tests**

Run: `yarn workspace @janhq/web-app test src/lib/codex-app-server/__tests__/client.test.ts`
Expected: fail because `CodexAppServerSession` does not exist yet.

- [x] **Step 2: Implement process/config/session wrappers**

Create `config.ts`, `process-manager.ts`, `client.ts`, and `index.ts`. Use `initialize`, `initialized`, `thread/start`, `turn/start`, `turn/interrupt`, and JSON-RPC server-request responses.

- [x] **Step 3: Verify tests pass**

Run: `yarn workspace @janhq/web-app test src/lib/codex-app-server/__tests__/client.test.ts`
Expected: pass.

## Task 3: Typecheck and Scope Verification

- [x] **Step 1: Run focused lint**

Run: `yarn workspace @janhq/web-app exec eslint src/lib/codex-app-server`
Expected: pass.

- [x] **Step 2: Run build**

Run: `yarn workspace @janhq/web-app build`
Expected: pass.

- [x] **Step 3: Review diff scope**

Run: `git diff -- web-app/src/lib/codex-app-server docs/superpowers/plans/2026-06-09-codex-app-server-integration.md`
Expected: only the app-server adapter and plan are changed by this slice.

## Task 4: Tauri Process Bridge

- [x] **Step 1: Write failing tests**

Run: `yarn workspace @janhq/web-app test src/lib/codex-app-server/__tests__/tauri-process.test.ts`
Expected: fail because `TauriCodexProcessSpawner` does not exist yet.

- [x] **Step 2: Implement host process commands**

Add Tauri commands for `write_codex_app_server_config`, `start_codex_app_server`, `write_codex_app_server_stdin`, `stop_codex_app_server`, and `list_codex_app_server_processes`. The commands manage child process stdin, emit stdout/stderr/exit events, and write app-managed Codex config into isolated `CODEX_HOME`.

- [x] **Step 3: Implement frontend Tauri process adapter**

Create `tauri-process.ts`, make the process spawner async, filter process events by session id, and route writes/stops through Tauri invoke commands.

- [x] **Step 4: Verify focused tests and builds**

Run:
- `yarn workspace @janhq/web-app test src/lib/codex-app-server/__tests__/json-rpc.test.ts src/lib/codex-app-server/__tests__/client.test.ts src/lib/codex-app-server/__tests__/tauri-process.test.ts`
- `yarn workspace @janhq/web-app exec eslint src/lib/codex-app-server`
- `cargo check --manifest-path src-tauri/Cargo.toml --lib`
- `yarn workspace @janhq/web-app build`

Expected: all pass. Rust may still show pre-existing warnings outside this slice.

## Task 7: Live App-Server Turn Verification and Event Coverage

- [x] **Step 1: Probe the installed app-server against a mock provider**

Start `/Applications/Codex.app/Contents/Resources/codex app-server --stdio` with a temporary `CODEX_HOME`, a generated provider config, and a local mock `/v1/responses` endpoint. Send `initialize`, `thread/start`, and `turn/start`.

Expected: app-server calls the mock provider, streams `item/agentMessage/delta`, and emits `turn/completed`.

- [x] **Step 2: Fix stderr log handling**

Treat app-server JSON stderr logs below `ERROR` as warning notifications instead of fatal stream errors. Keep process exits, JSON-RPC response errors, malformed stdout, and stderr `ERROR` logs as actionable errors.

- [x] **Step 3: Expand high-level event mapping**

Map item start/completion, thread status, token usage, plan deltas, reasoning deltas, command terminal interactions, process output/exits, warnings, and unknown notifications into the typed `CodexAppServerEvent` stream so the UI layer can render richer activity without protocol details.

- [x] **Step 4: Add repeatable live E2E test**

Add `live-app-server.test.ts`. It starts the real Codex binary when available, writes app-managed config into an isolated `CODEX_HOME`, serves a local mock Responses API provider, sends one user message through `CodexAppServerSession`, and asserts streamed assistant output plus turn completion.

- [x] **Step 5: Verify focused tests, lint, whitespace, web build, and Rust check**

Run:
- `yarn workspace @janhq/web-app test src/lib/__tests__/custom-chat-transport-class.test.ts src/stores/__tests__/chat-session-store.test.ts src/lib/codex-app-server/__tests__/json-rpc.test.ts src/lib/codex-app-server/__tests__/client.test.ts src/lib/codex-app-server/__tests__/tauri-process.test.ts src/lib/codex-app-server/__tests__/ui-stream.test.ts src/lib/codex-app-server/__tests__/chat-backend.test.ts src/lib/codex-app-server/__tests__/live-app-server.test.ts`
- `yarn workspace @janhq/web-app exec eslint src/lib/codex-app-server src/lib/custom-chat-transport.ts src/stores/chat-session-store.ts src/constants/providers.ts`
- `git diff --check`
- `yarn workspace @janhq/web-app build`
- `cargo check --manifest-path src-tauri/Cargo.toml --lib`

Expected: all pass. Build may still show existing chunk/dynamic import warnings. Rust may still show pre-existing warnings outside this slice.

## Task 11: Approval Protocol Decision Mapping

- [x] **Step 1: Inspect generated approval response schema**

Generate TypeScript bindings from the installed Codex binary and inspect approval response types.

Evidence: `ReviewDecision` supports `approved`, `approved_for_session`, and `denied`; command/file approval response objects use `{ decision: ... }`.

- [x] **Step 2: Add failing bridge expectations**

Update the Codex chat backend approval tests to assert the generated protocol decision strings instead of the previous guessed `accept`, `acceptForSession`, and `decline` values.

Expected before fix: tests fail on the decision string mismatch.

- [x] **Step 3: Fix approval result mapping**

Change Jan's Codex approval bridge to respond with `{ decision: 'approved' }`, `{ decision: 'approved_for_session' }`, or `{ decision: 'denied' }`.

- [x] **Step 4: Verify focused suite and build gates**

Run:
- `yarn workspace @janhq/web-app test src/lib/__tests__/custom-chat-transport-class.test.ts src/stores/__tests__/chat-session-store.test.ts src/lib/codex-app-server/__tests__/json-rpc.test.ts src/lib/codex-app-server/__tests__/process-manager.test.ts src/lib/codex-app-server/__tests__/client.test.ts src/lib/codex-app-server/__tests__/tauri-process.test.ts src/lib/codex-app-server/__tests__/ui-stream.test.ts src/lib/codex-app-server/__tests__/chat-backend.test.ts src/lib/codex-app-server/__tests__/live-app-server.test.ts`
- `yarn workspace @janhq/web-app exec eslint src/lib/codex-app-server src/lib/custom-chat-transport.ts src/stores/chat-session-store.ts src/constants/providers.ts`
- `git diff --check`
- `yarn workspace @janhq/web-app build`
- `cargo check --manifest-path src-tauri/Cargo.toml --lib`

Expected: all pass. Build may still show existing chunk/dynamic import warnings. Rust may still show pre-existing warnings outside this slice.

## Task 12: Legacy Approval Request Compatibility

- [x] **Step 1: Add failing regression coverage**

Add `CodexAppServerSession` coverage for legacy `execCommandApproval` and `applyPatchApproval` server requests, and add chat backend coverage that legacy command approvals show useful command, cwd, and reason details in Jan's approval modal.

Expected before fix: legacy requests are emitted as generic `server_request` events, and legacy command modal details fall back to `Codex action`.

- [x] **Step 2: Recognize and normalize legacy approvals**

Map `execCommandApproval` and `applyPatchApproval` to `approval_request`, keep modern `requestApproval` handling, and normalize legacy array commands into the same display shape as modern command approvals.

- [x] **Step 3: Verify focused suite and build gates**

Run:
- `yarn workspace @janhq/web-app test src/lib/codex-app-server/__tests__/client.test.ts src/lib/codex-app-server/__tests__/chat-backend.test.ts`
- Full focused Codex app-server suite, eslint, whitespace check, web build, and Rust check.

Expected: all pass. Build may still show existing chunk/dynamic import warnings. Rust may still show pre-existing warnings outside this slice.

## Task 13: Runtime Provider and Workspace Config Hardening

- [x] **Step 1: Add failing runtime config coverage**

Add chat backend regressions that prove Codex session options are generated from project-bound workspaces, chat-bound workspaces, provider settings, API key env, and app-managed config TOML. Add a session cache regression for API key changes.

Expected before fix: the option builder is not exported for direct verification, and API key changes do not replace the existing app-server session.

- [x] **Step 2: Fix stale environment reuse**

Expose `buildCodexSessionOptions` for direct integration testing and include `options.env` in the app-server session signature so provider API key changes restart the managed Codex app-server process with the new environment.

- [x] **Step 3: Verify focused suite and build gates**

Run:
- `yarn workspace @janhq/web-app test src/lib/codex-app-server/__tests__/chat-backend.test.ts`
- Full focused Codex app-server suite, eslint, whitespace check, web build, and Rust check.

Expected: all pass. Build may still show existing chunk/dynamic import warnings. Rust may still show pre-existing warnings outside this slice.

## Task 14: Abort Listener Cleanup

- [x] **Step 1: Add failing cleanup regression**

Add chat backend coverage proving that an abort signal attached to a Codex chat request is removed once the stream finishes normally.

Expected before fix: aborting the old controller after stream completion still calls `interruptTurn` for the completed thread.

- [x] **Step 2: Remove abort listeners during stream cleanup**

Store the abort listener remover and invoke it from the existing Codex stream cleanup wrapper so completed or cancelled streams do not retain stale interrupt callbacks.

- [x] **Step 3: Verify focused suite and build gates**

Run:
- `yarn workspace @janhq/web-app test src/lib/codex-app-server/__tests__/chat-backend.test.ts`
- Full focused Codex app-server suite, eslint, whitespace check, web build, and Rust check.

Expected: all pass. Build may still show existing chunk/dynamic import warnings. Rust may still show pre-existing warnings outside this slice.

## Task 15: Public Integration API Facade

- [x] **Step 1: Add failing facade coverage**

Add an API-level regression for `startCodexSession`, `sendToCodex`, `approveAction`, `interruptTurn`, and `shutdownCodex` using the same fake stdio process shape as the session tests.

Expected before fix: `api.ts` does not exist, so consumers must import `CodexAppServerSession` internals directly.

- [x] **Step 2: Implement thin client facade**

Create `api.ts` with `CodexAppServerClient` and `startCodexSession`. The facade delegates to `CodexAppServerSession`, preserves the typed event stream, and exposes stable method names for app backend code.

- [x] **Step 3: Export the facade from the module boundary**

Export the facade class, factory, and types from `index.ts` so application code can depend on the integration API rather than transport/session internals.

- [x] **Step 4: Verify focused suite and build gates**

Run:
- `yarn workspace @janhq/web-app test src/lib/codex-app-server/__tests__/api.test.ts`
- Full focused Codex app-server suite, eslint, whitespace check, web build, and Rust check.

Expected: all pass. Build may still show existing chunk/dynamic import warnings. Rust may still show pre-existing warnings outside this slice.

## Task 16: Chat Backend Facade Alignment

- [x] **Step 1: Move chat backend tests to the public facade contract**

Update chat backend tests to mock `CodexAppServerClient` rather than `CodexAppServerSession`, proving the chat transport path uses the same clean integration API exported for the rest of the app.

Expected before fix: tests fail because chat backend still constructs the internal session directly.

- [x] **Step 2: Refactor chat backend to use `CodexAppServerClient`**

Replace direct `sendMessage`, `respondToServerRequest`, and `shutdown` calls with `sendToCodex`, `approveAction`, and `shutdownCodex`. Keep lazy startup semantics by constructing the facade client directly instead of forcing eager initialization.

- [x] **Step 3: Verify focused suite and build gates**

Run:
- `yarn workspace @janhq/web-app test src/lib/codex-app-server/__tests__/chat-backend.test.ts`
- Full focused Codex app-server suite, eslint, whitespace check, web build, and Rust check.

Expected: all pass. Build may still show existing chunk/dynamic import warnings. Rust may still show pre-existing warnings outside this slice.

## Task 10: Reconnect Thread Resume Coverage

- [x] **Step 1: Add reconnect/resume regression coverage**

Add a `CodexAppServerSession` test where the first app-server process completes a turn, exits, and a second message on the same Jan thread starts a fresh app-server process.

Expected: the second process uses `thread/resume` with the previously mapped Codex thread id before `turn/start`; it must not create a new Codex thread with `thread/start`.

- [x] **Step 2: Verify current lifecycle behavior**

Run the new test against the current implementation.

Expected: pass. The session already preserves the app-thread to Codex-thread mapping across process generations and resumes it after reconnect.

- [x] **Step 3: Verify focused suite and build gates**

Run:
- `yarn workspace @janhq/web-app test src/lib/__tests__/custom-chat-transport-class.test.ts src/stores/__tests__/chat-session-store.test.ts src/lib/codex-app-server/__tests__/json-rpc.test.ts src/lib/codex-app-server/__tests__/process-manager.test.ts src/lib/codex-app-server/__tests__/client.test.ts src/lib/codex-app-server/__tests__/tauri-process.test.ts src/lib/codex-app-server/__tests__/ui-stream.test.ts src/lib/codex-app-server/__tests__/chat-backend.test.ts src/lib/codex-app-server/__tests__/live-app-server.test.ts`
- `yarn workspace @janhq/web-app exec eslint src/lib/codex-app-server src/lib/custom-chat-transport.ts src/stores/chat-session-store.ts src/constants/providers.ts`
- `git diff --check`
- `yarn workspace @janhq/web-app build`
- `cargo check --manifest-path src-tauri/Cargo.toml --lib`

Expected: all pass. Build may still show existing chunk/dynamic import warnings. Rust may still show pre-existing warnings outside this slice.

## Task 9: Initialization Failure Retry

- [x] **Step 1: Add failing regression**

Add a `CodexAppServerProcessManager` regression where the first child process rejects `initialize` with a protocol error and a later initialize attempt should spawn a fresh process and succeed.

Expected before fix: the failed child is not killed/reset, and retry behavior is stuck on the failed initialization state.

- [x] **Step 2: Reset failed init state**

On initialization failure, close the JSON-RPC client, kill the failed child process, clear process/client state, clear the failed initialize promise, and only increment the manager generation after a successful `initialize` response.

- [x] **Step 3: Verify focused suite and build gates**

Run:
- `yarn workspace @janhq/web-app test src/lib/__tests__/custom-chat-transport-class.test.ts src/stores/__tests__/chat-session-store.test.ts src/lib/codex-app-server/__tests__/json-rpc.test.ts src/lib/codex-app-server/__tests__/process-manager.test.ts src/lib/codex-app-server/__tests__/client.test.ts src/lib/codex-app-server/__tests__/tauri-process.test.ts src/lib/codex-app-server/__tests__/ui-stream.test.ts src/lib/codex-app-server/__tests__/chat-backend.test.ts src/lib/codex-app-server/__tests__/live-app-server.test.ts`
- `yarn workspace @janhq/web-app exec eslint src/lib/codex-app-server src/lib/custom-chat-transport.ts src/stores/chat-session-store.ts src/constants/providers.ts`
- `git diff --check`
- `yarn workspace @janhq/web-app build`
- `cargo check --manifest-path src-tauri/Cargo.toml --lib`

Expected: all pass. Build may still show existing chunk/dynamic import warnings. Rust may still show pre-existing warnings outside this slice.

## Task 8: Mid-Turn Process Exit Recovery

- [x] **Step 1: Add failing regression**

Add a `CodexAppServerSession` regression where `turn/start` succeeds, some turn activity streams, and then the child app-server process exits before `turn/completed`.

Expected before fix: the async stream hangs because process exit only rejects pending JSON-RPC requests.

- [x] **Step 2: Emit process-exit errors to active stream subscribers**

Change `CodexJsonRpcClient.handleExit` to create one actionable exit error, reject pending requests, and emit that same error through `onError` so active `sendMessage` streams yield an error event and terminate instead of hanging.

- [x] **Step 3: Verify focused suite and build gates**

Run:
- `yarn workspace @janhq/web-app test src/lib/__tests__/custom-chat-transport-class.test.ts src/stores/__tests__/chat-session-store.test.ts src/lib/codex-app-server/__tests__/json-rpc.test.ts src/lib/codex-app-server/__tests__/client.test.ts src/lib/codex-app-server/__tests__/tauri-process.test.ts src/lib/codex-app-server/__tests__/ui-stream.test.ts src/lib/codex-app-server/__tests__/chat-backend.test.ts src/lib/codex-app-server/__tests__/live-app-server.test.ts`
- `yarn workspace @janhq/web-app exec eslint src/lib/codex-app-server src/lib/custom-chat-transport.ts src/stores/chat-session-store.ts src/constants/providers.ts`
- `git diff --check`
- `yarn workspace @janhq/web-app build`
- `cargo check --manifest-path src-tauri/Cargo.toml --lib`

Expected: all pass. Build may still show existing chunk/dynamic import warnings. Rust may still show pre-existing warnings outside this slice.

- [x] **Step 5: Smoke-test installed app-server initialization**

Run a one-off Node stdio smoke test against `/Applications/Codex.app/Contents/Resources/codex app-server --stdio` with a temporary `CODEX_HOME`.
Expected: receive an `initialize` response with a Codex Desktop user agent.

## Task 5: Existing Chat Transport Wiring

- [x] **Step 1: Write failing UI stream tests**

Run: `yarn workspace @janhq/web-app test src/lib/codex-app-server/__tests__/ui-stream.test.ts`
Expected: fail because `codexEventsToUIMessageStream` does not exist yet.

- [x] **Step 2: Implement Codex event to AI SDK stream mapping**

Create `ui-stream.ts`. Map assistant deltas into `text-start`/`text-delta`/`text-end`, map non-text Codex activity into `data-codex-event`, and emit finish/error chunks for the existing chat UI stream processor.

- [x] **Step 3: Add Codex chat backend module**

Create `chat-backend.ts`. Resolve workspace directory from project/chat bindings, generate isolated Codex config, create/reuse `CodexAppServerSession`, pass provider/model/base URL/API key at runtime, and clean up existing stream state on finish/cancel.

- [x] **Step 4: Wire `CustomChatTransport`**

Modify `custom-chat-transport.ts` so selected provider `codex` routes through `sendCodexAppServerChatMessage` and every other provider keeps the existing `streamText` path.

- [x] **Step 5: Add app-level Codex provider**

Modify `providers.ts` with provider id `codex`, runtime settings for API key, base URL, target Codex provider id, and Codex binary path.

- [x] **Step 6: Verify focused tests and build**

Run:
- `yarn workspace @janhq/web-app test src/lib/codex-app-server/__tests__/json-rpc.test.ts src/lib/codex-app-server/__tests__/client.test.ts src/lib/codex-app-server/__tests__/tauri-process.test.ts src/lib/codex-app-server/__tests__/ui-stream.test.ts src/lib/__tests__/custom-chat-transport-class.test.ts`
- `yarn workspace @janhq/web-app exec eslint src/lib/codex-app-server src/lib/custom-chat-transport.ts src/constants/providers.ts`
- `yarn workspace @janhq/web-app build`

Expected: all pass. Build may still show existing Vite chunk/dynamic import warnings.

## Task 6: Approval Bridge and Session Cleanup

- [x] **Step 1: Add app-server approval request handling**

Extend the Codex event stream so `item/commandExecution/requestApproval` and `item/fileChange/requestApproval` use Jan's existing tool approval modal and respond to the app-server request with `accept` or `decline`.

- [x] **Step 2: Add transport shutdown cleanup**

Expose `shutdown()` on `CustomChatTransport` and have `chat-session-store` call it when sessions are removed or all sessions are cleared. This lets Codex app-server child processes stop when their chat session is gone.

- [x] **Step 3: Verify focused tests, lint, whitespace, and builds**

Run:
- `yarn workspace @janhq/web-app test src/lib/__tests__/custom-chat-transport-class.test.ts src/stores/__tests__/chat-session-store.test.ts src/lib/codex-app-server/__tests__/chat-backend.test.ts src/lib/codex-app-server/__tests__/json-rpc.test.ts src/lib/codex-app-server/__tests__/client.test.ts src/lib/codex-app-server/__tests__/tauri-process.test.ts src/lib/codex-app-server/__tests__/ui-stream.test.ts`
- `yarn workspace @janhq/web-app exec eslint src/lib/codex-app-server src/lib/custom-chat-transport.ts src/stores/chat-session-store.ts src/constants/providers.ts`
- `git diff --check`
- `yarn workspace @janhq/web-app build`
- `cargo check --manifest-path src-tauri/Cargo.toml --lib`

Expected: all pass. Rust may still show pre-existing warnings outside this slice.
