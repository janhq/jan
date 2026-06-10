# Codex Clone Parity Tracker

This tracker defines what must be true before this Jan workspace can reasonably claim to be a full Codex app/CLI clone rather than a partial bridge.

## Implemented app-server transport and session core

- App-server and proto session transports are wired through `web-app/src/lib/codex-app-server`.
- Tauri process launching supports Codex app-server stdio and proto fallback paths.
- Chat streaming maps assistant, reasoning, plan, command output, file-change, process, account, MCP, remote-control, thread lifecycle, capability-change, review, moderation, and model status events into visible UI message chunks.
- Approval, server requests, interrupt, compact, reload, rollback, review, command execution, shell/process, filesystem, MCP, account, remote control, config/admin, plugins, skills, marketplace, thread lifecycle, realtime, and raw RPC controls are exposed through the Codex capabilities panel.
- Codex CLI helpers for `doctor`, `exec`, `resume`, and raw subcommands are exposed through the panel.

## Implemented visible control surfaces

- Review panel preserves git diff as authoritative and can start detached or advanced Codex reviews.
- Account block exposes account read/login/cancel/logout/rate-limit/usage/credits-nudge flows.
- Thread block exposes list/read/turns/turn-items/fork/archive/unarchive/unsubscribe/name/metadata/settings/goal/memory/reset/inject/terminal cleanup/realtime/review/interruption/compact/reload/rollback operations.
- Remote Control block exposes enable/disable/status/pairing/client list/client revoke operations.
- Config/Admin block exposes config read/value write/batch write/config requirements/permission profiles/collaboration modes/external agent detect/import/feedback upload/Windows sandbox setup.
- Models/Providers/Features block exposes model list/provider capabilities/experimental features/feature enablement/environment registration/user-input request.
- Raw app-server RPC block can call arbitrary app-server methods with JSON params for forward compatibility.
- Codex CLI block exposes CLI-native doctor/exec/resume/raw subcommand flows.
- Plugins/Marketplace/Skills block exposes plugin list/installed/read/install/uninstall/plugin skill read/marketplace add/remove/upgrade/skill config write/app list/skills/hooks.
- Runtime FS/Process block exposes filesystem read/write/list/metadata/mkdir/remove/copy/watch/unwatch, process spawn/stdin/resize/kill, and command exec/stdin/resize/terminate.
- MCP block exposes status/OAuth/config reload/resource read/tool call.

## Remaining implementation work

- Replace prompt-driven admin controls with structured forms where parameter schemas are stable enough to avoid JSON hand-entry. Structured account, MCP including OAuth, Codex CLI, config/admin, model/feature/environment, plugin/marketplace/skill config, remote-control pairing and client management, thread/review/realtime, and runtime filesystem/process fields are present. Thread rename no longer uses a prompt, and high-use turn-item/rollback params now use typed fields; raw JSON remains for flexible metadata/settings/injection/review payloads.
- Make loaded/stored Codex thread rows selectable instead of requiring manual thread id copy/paste. Thread, turn, and item chips are present for thread selection, turn item listing, and rollback params; turn/item chips now populate typed action fields. Richer row/table display remains.
- Add a dedicated command/process terminal UI for app-server spawned processes instead of only result JSON plus event stream output. Process-handle chips from runtime snapshots are present; full terminal UI remains.
- Add richer MCP browsing for server resources/tools once server descriptors are available. Structured MCP server/resource/tool fields and clickable server chips from status snapshots are present; descriptor-driven resource/tool browsing remains.
- Add first-class plugin marketplace browsing/install UX rather than raw name/source prompts. Structured plugin/skill fields plus clickable plugin and skill chips from snapshots are present; richer marketplace browsing remains.
- Add typed wrappers for high-use raw RPC controls currently routed through `callCodexAppServer`.
- Confirm exact upstream app-server method/parameter names against a current `@openai/codex` binary and adjust aliases where needed.
- Decide whether proto fallback should hide app-server-only controls or show explicit unsupported-state messaging per panel.

## Required validation before completion

- TypeScript build for the web app must pass.
- Codex app-server unit tests must pass, including `client.test.ts`, `ui-stream.test.ts`, `api.test.ts`, and `chat-backend.test.ts`.
- Existing live app-server/proto integration tests must pass against the available local Codex binary and, separately, a current `npx -y @openai/codex` app-server when practical.
- The desktop Tauri command bridge must be validated for CLI subcommands: doctor, exec, resume, and raw args.
- Rendered UI smoke test must confirm the Codex capabilities panel mounts after the added controls.
- Runtime smoke test must confirm at least one real Codex-backed chat can start, stream, approve/deny an action, run a command, show events, and shut down cleanly.
- Review smoke test must confirm detached review does not overwrite the authoritative git diff panel.
- MCP smoke test must confirm MCP status/OAuth/resource/tool paths either succeed or show actionable errors.
- Account smoke test must confirm unauthenticated and authenticated states render correctly without breaking chat.

## Validation evidence - 2026-06-09

- Connector inventory confirmed the active flow: `CustomChatTransport` now routes every selected chat provider/model to `sendCodexAppServerChatMessage`; Codex sessions run through `TauriCodexProcessSpawner`, and Jan MCP settings are projected through `mcp-config-bridge`.
- Found and fixed a product-level runtime bypass: fresh chats still defaulted through the normal `llamacpp` provider path, so the assistant could truthfully report that it had no Codex/code-execution tools. The model store now defaults to `codex`, and fresh agent chats prefer the first active Codex model before falling back to direct local providers.
- Collapsed chat execution to one runtime path: normal providers such as `ollama`, `llamacpp`, `mlx`, `vllm`, and remote OpenAI-compatible providers are projected into Codex config as the target model provider instead of being executed directly through AI SDK `streamText`. Jan-hosted local engines are loaded through the existing model service and exposed through Jan's local OpenAI-compatible API before Codex starts the turn.
- Focused Codex/app-server tests passed: 13 files / 112 tests covering JSON-RPC, process manager, client facade, Tauri process adapter, UI stream mapping, MCP config bridge, chat backend, proto adapter/session, live app-server, custom chat transport, and chat-session cleanup.
- Single-path chat regressions passed: `DropdownModelProvider` now selects `codex` for new agent chats when available, `CustomChatTransport` routes both `codex` and normal providers into the Codex app-server backend, `buildCodexSessionOptions` projects direct providers into Codex config with managed reserved ids such as `jan-ollama`, and local Jan providers start the selected model plus local API server before Codex chat.
- Local model connector tests passed: 5 files / 115 tests covering `ModelFactory`, `llamacpp`, `mlx`, OpenAI-compatible providers, reasoning params, and custom fetch behavior.
- MCP validation passed: 3 files / 36 tests covering `[mcp_servers.*]` TOML projection, runtime MCP refresh config, API facade MCP methods, and intentional host-proxy rejection for Codex-owned `item/tool/call` execution.
- Lint passed for connector files and the touched reasoning dropdown; IDE diagnostics reported no linter errors for the edited files.
- Web build passed after dependency/native-resource setup.
- Native Rust validation passed: `cargo check --manifest-path src-tauri/Cargo.toml --lib` completed after materializing Bun/UV with `yarn download:bin` and `mlx-server` with `yarn build:mlx-server`. Remaining Rust output was warnings only.
- Codex binary validation passed for `/Applications/Codex.app/Contents/Resources/codex app-server --help`; `doctor`, `exec`, and `resume` help surfaces are available.
- Codex runtime smoke passed against a streaming mock Responses provider: app-server starts, emits `item/agentMessage/delta`, completes the turn with `smoke-ok`, and shuts down.
- Local model smoke passed for Ollama: `http://127.0.0.1:11434/v1/models` lists local models, and Codex streams through the Ollama endpoint with `mistral-small3.1:latest` using a Jan-scoped provider id (`jan-ollama`) and returns `jan-local-ok`.
- Fixed a validation tooling mismatch: `scripts/codex-smoke-test.mjs` now rewrites reserved Codex provider ids such as `ollama` to app-managed ids such as `jan-ollama`, matching `buildCodexSessionOptions`.
- Fixed lint/build blockers found during validation: replaced loose `any` usage in Codex process types, made proto fallback unsupported-method stubs lint-clean, typed dynamic Codex event payload access, and normalized boolean reasoning values before using them as React keys.
- Residual environment notes: vLLM at `http://127.0.0.1:8000/v1/models` is not currently available in OpenAI-compatible shape (`{"detail":"Not Found"}`); the installed Ollama model `qwen2.5-coder:1.5b-base` rejects Codex requests because it does not support tools; full interactive desktop UI smoke was not run in this terminal-only validation pass. The focused dropdown test emits existing React `act(...)` warnings from asynchronous status effects, but assertions pass and no unhandled errors remain after mocking the Tauri-only XAI OAuth listener.

## Completion rule

Do not mark the goal complete until the implementation work above is either finished or intentionally de-scoped by the user, and every required validation item has current evidence.
