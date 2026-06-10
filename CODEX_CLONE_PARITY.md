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

## Completion rule

Do not mark the goal complete until the implementation work above is either finished or intentionally de-scoped by the user, and every required validation item has current evidence.
