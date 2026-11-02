# Unified conversation — current capability contract

Status: **descriptive source inventory, not an agreed unified policy or implementation**.
Tracking: [#502 capability contract](https://github.com/janhq/jan-internal/issues/502), under [#500 unified flow](https://github.com/janhq/jan-internal/issues/500). Follow-on policy (#503), execution/continuity (#504), UI (#505) and benchmarks/QA (#506) are separate subtasks/PRs targeting the foundation branch, with sequential QA merges.
Audited 2026-11-02 at `753bbc96cbdedf599261090e497d2cd5cbaa2347` (rebased foundation). Static inspection only; no runtime/platform parity claim. Paths below are relative to the repository root. Existing comments are not enforcement: several still say `bash`, read-only Cowork folder, or that all writes are refused, contrary to the executable branches.

## Architectural boundary: Cortex, not another loop

[jan-internal#484](https://github.com/janhq/jan-internal/issues/484) proposes one headless Cortex runtime owning sessions, agent execution, tools, permissions, models, memory, skills and schedules; Desktop owns input/rendering/approval UI and client-only host tools. Its loop-migration choice remains an explicit open question. Today Desktop Chat and Cowork still execute through the webview/AI SDK paths described here.

This document supplies a parity/handshake inventory for that direction. It does **not** authorize a new Desktop agent loop, classifier/router call, registry implementation, RPC schema fork, or execution migration. A future capability contract should describe identity/schema, availability and reason, scope, permission requirements, execution host and UI metadata; it should map onto Cortex's existing additive `protocol/rpc-schema.json`, not compete with it. Remote filesystem paths and client attachments are not automatically paths on the Cortex host.

**Preserve prefixes, not just names.** #484 requires append-only messages and frozen system/tool lists per session, including byte-identical requests across attach/detach/observe. Current Desktop behavior is narrower: Cowork freezes the tool record for a run and reuses it between runs when its signature is unchanged; Chat freezes smart-routed MCP selection until connected server names/disabled-tool keys change. Those are current mechanisms, not proof of #484 compliance. Do not add per-step discovery, reorder/reword schemas, or splice changing capability state into the system prefix. Agree how capability changes start a new stable boundary; enforce revocation at dispatch even while an older schema remains frozen. Direct answers must not require planning or an additional routing inference.

Sources: `web-app/src/lib/coworkTools.ts` (`coworkToolSignature`, `buildCoworkTools`), `coworkTransport.ts` (`refreshTools`, `unfreezeTools`), `custom-chat-transport.ts` (`refreshTools`, frozen MCP routing and history normalization); #484 rules and open questions.

## Exact model-visible inventory

Names below are built-in identities, not a promise that every installed MCP server has these names. “None” means absent from the audited builder, not impossible through an independently configured MCP tool or shell command.

| Capability / exact tool names | Chat advertisement | Cowork parent advertisement |
|---|---|---|
| Shell: `shell` | Model supports `tools`; global Chat shell switch on; enforcing OS sandbox available | Enforcing OS sandbox available; normal mode only |
| Filesystem: `read`, `ls`, `find`, `grep` | None dedicated | Always in builder, including plan mode |
| Filesystem mutation: `write`, `edit` | None dedicated (shell can still write its workspace) | Normal mode only |
| Web: `web_search`, `web_fetch` | Tool-capable model and global web-search setting on | Global web-search setting snapshotted into run config; retained in plan mode |
| Screenshot: `screenshot` | None dedicated | Included in normal and plan modes; renders a local HTML/SVG, not arbitrary screen capture |
| Memory: `memory` | No model-callable memory tool; background digest is separate | One tool with `op`: `view`, `search`, `write`, `edit`, `delete`, `move`. Advertised in normal and plan modes; mutating ops refused in plan mode |
| Skills: `skill_list`, `skill_read`, `skill_write` | None dedicated | List/read in both modes; write only in normal mode |
| Interaction: `todo`, `ask` | None | Both modes; client-dispatched session todo and structured user questions |
| Delegation: `task` | None | Normal mode and `allowSubagents`; parent UI config enables it |
| Monitoring: `monitor` | None | Normal mode; `start`/`stop`/`list` routed by client to Rust watchers |
| Retrieval: `list_attachments`, `retrieve`, `get_chunks` | Tool-capable model, thread/project documents available, RAG enabled/available, and individual tool not disabled | None; attachments are imported workspace files instead |
| MCP tools: names/schemas supplied by connected servers | Tool-capable model; enabled tools from service discovery, optionally smart-routed server selection | No MCP discovery/advertisement in Cowork's overridden builder |
| Extension-contributed tools | No generic extension-tool injection found in this checkout's builder | No generic extension-tool injection found in overridden builder |

Chat's model gate encloses **all** tool loading; absent tool support, Chat can still answer directly. Cowork's page rejects sending with a missing/non-tool-capable model; its builder itself is not the same Chat capability gate. No separate local-versus-remote provider whitelist appears in these builders; capability metadata is not evidence a given provider/model actually executes tools correctly.

Authoritative schema sources: `src-tauri/plugins/tauri-plugin-agent-tools/src/tools/schema.rs` via `toolSchemas()` for native tools; `web-app/src/lib/coworkTools.ts` for `todo`, `ask`, `task`; `coworkMonitor.ts` for `monitor`; `webSearchTool.ts` for web tools; `extensions/rag-extension/src/tools.ts` for retrieval. MCP schemas are runtime service results and cannot be exhaustively named by a source-only inventory. Legacy recorded `bash` calls retain display support, but `bash` is not an advertised/dispatch alias. Legacy memory management IPC names are not the model-visible tool list.

Exposure anchors: `web-app/src/lib/agentTools.ts` (`AGENT_TOOL_NAMES`, `CHAT_AGENT_TOOL_NAMES`, `getAgentToolSchemas`), `custom-chat-transport.ts:refreshTools`, `coworkTools.ts:buildCoworkTools`, `coworkTransport.ts:refreshTools`, `web-app/src/containers/CoworkPage.tsx` (send model gate and transport config).

### Children are a narrower advertised set, not a second capability source

`coworkSubagent.ts:subagentTools` starts with the parent's actual advertised record, removes `task`, `ask`, `todo`, `monitor`, `memory`, then applies the resolved saved/requested allowlist. `intersectAllowedTools()` intersects saved/requested restrictions but automatically adds `skill_list` and `skill_read` whenever the parent advertises them, even if neither restriction lists them. A child requested with only `read` can therefore also receive both skill-reading tools. This exception cannot widen the advertised parent set; an empty request list is treated as omitted. The resolved list, including implicit skill reads, is distinct from dispatch-time enforcement. Children receive a focused brief rather than the parent's full conversation or memory catalog. `CoworkPage.tsx` supplies refusal callbacks for child todo/ask/task and no monitor lane.

**Enforcement gap to resolve, not a safety guarantee:** the child dispatch callback passes other calls into `dispatchCoworkTool` without an explicit check against the child's narrowed record. That dispatcher also falls through unknown-to-client names to Rust built-in lookup, rather than checking the advertised parent record. Thus schema withholding/narrowing (notably child `memory` and per-child allowlists) must not be described as an independent dispatcher deny. SDK/model rejection may intervene, but was not verified as a security boundary. Plan mutation/web-off checks and Rust scope gates are separate enforcement that does exist.

## Dispatch and permission semantics today

### Chat

`web-app/src/routes/threads/$threadId.tsx` owns the tool loop and routing. Internal RAG, enabled native web and enabled native shell calls are auto-allowed by `isAutoAllowedTool`; MCP calls otherwise enter `useToolApprovalRequests`. Its defaults have no trusted tools/servers and `allowAllMCPPermissions: false`. Choices are allow once, allow thread, allow always, deny. Thread-tool grants, server-wide grants and global no-server tool grants are **persisted**, even though a grant is called “thread” scoped. Allow always trusts the entire server when a server identity is present. Denial produces a tool error; deleting the chat resolves pending requests as denied and stops work.

Shell/web settings are rechecked before approval and execution; disabled built-ins return refusal, including in-flight/replayed calls. An MCP tool of the same name can still route to MCP when the built-in is off, with MCP approval semantics. Enabled built-ins take precedence. RAG routing precedes MCP routing. Chat builds its record in order RAG → MCP → native web → native shell, so names can overwrite; duplicate MCP names warn and the last server wins **schema advertisement only**. Execution is not bound to that winner: the route calls `callToolWithCancellation()` without `serverName`, and Rust `call_tool` searches connected servers for the first matching tool name in a `HashMap`. The execution server need not match the advertised/approved server. This is an identity/enforcement gap, not a reliable collision policy. The global disabled `server::tool` keys filter RAG/MCP advertisement; that filter is not a universal filesystem/network permission policy or proof of dispatch-time revocation.

Chat passes only tool name/input/thread id into `executeAgentTool`: `scope='thread'`, network closed, no attached folder, no writable-project opt-in. The wrapper's optional read-only attachment parameter is **not evidence that Chat currently exposes a folder picker or passes one here**.

Sources: route functions `chatShellRoute`, `webRoute`, `isAutoAllowedTool`, approval/dispatch loop (including `callToolWithCancellation`); `src-tauri/src/core/mcp/commands.rs:call_tool` (unbound name lookup); `web-app/src/hooks/useToolApproval.ts`, `useToolApprovalRequests.ts`, `useToolAvailable.ts`; `agentTools.ts:executeAgentTool`.

### Cowork

`coworkDispatch.ts` explicitly refuses `write`, `edit`, `shell`, `skill_write`, `task`, `monitor` in plan mode and `memory` ops `write`/`edit`/`delete`/`move`. Read/search memory remains callable with the same schema. Plan mode is therefore a mutation restriction, **not an offline mode**: native web remains available when enabled. `todo` still updates planning state and `ask` can suspend for user review; neither is a generic per-write permission grant. Repeated failed reads in plan mode can force a plan-review question.

The dispatcher refuses native web calls when the run's `webSearch` flag is off. This is separate from the shell network setting. It dispatches todo/ask/task/monitor client-side, native web via `executeWebTool`, and other names through Rust. It does not use Chat's MCP approval store. Folder selection opts Cowork into writes/edits **in place**, not read-only access, despite `readOnlyFolder` parameter naming. Calls pass `scope='session'`, `projectWritable=true` and the attached folder as a skill overlay. With a writable attachment, Rust resolves it as the workspace root and retains sandbox access as an additional root.

Cowork shell network defaults **on**, read from `useCoworkConfig` per command/monitor start; Chat shell network is always closed. The global web-search setting defaults **on**, independently of shell network. Chat's shell switch also defaults **on** but does not control Cowork. A change to Cowork's web/tool schema config waits for its run boundary; shell network changes can affect the next dispatch without changing tool JSON.

Sources: `coworkDispatch.ts`, `coworkTools.ts`, `coworkMonitor.ts`, `web-app/src/hooks/useCoworkConfig.ts`, `useChatShell.ts`, `useWebSearchConfig.ts`; `src-tauri/plugins/tauri-plugin-agent-tools/src/commands.rs:resolve_workspace_root` and `execute_tool_inner`.

### Rust is an additional containment boundary, not the CLI approval policy

`commands.rs:execute_tool_inner` validates the attachment, constructs workspace/read/write/hidden roots, looks up the built-in and invokes `tools/gate.rs:resolve_decision` with default tool permissions and fresh session grants. Desktop does **not** thereby inherit the CLI's configured `agent.toml` approval workflow. `ToolPermissions::default()` is allow-all policy; containment/capability checks still apply.

The executable match allows ordinary writes inside permitted roots without a frontend round trip; allows exec prompts only with an enforcing sandbox; refuses read/write escapes, sandbox escalation and remaining unsupported approval prompts. Hidden Jan-home access is hard-denied, with the gate's narrow attached-root exception. `shell` schemas are withheld without enforcement; backend names are Seatbelt (macOS), bubblewrap (Linux), AppContainer (Windows), or none. Machine availability was not tested. `screenshot` uses a Desktop webview backend where compiled, otherwise headless rendering; success is platform-dependent.

Memory's built-in capability is classified read so individual mutation semantics live in its handler/plan checks; “read capability” does not imply `memory write` is non-mutating or prompts. Native filesystem containment does not mean persistent memory/skill writes are ephemeral: they have a separate store root. Hooks are resolved for Desktop calls (global, plus Cowork attached project), but hook behavior/configuration was not audited here.

Sources: `src-tauri/plugins/tauri-plugin-agent-tools/src/commands.rs`, `permissions.rs`, `tools/gate.rs`, `tools/mod.rs`, `tools/handlers.rs`, `tools/jail.rs`, `tools/sandbox.rs`.

## Attachments, retrieval, MCP and extensions are not synonyms

- **Chat attachments/context:** model media/file parts, injected file metadata and retrieval indexes are separate from advertised tools. Thread/project documents enable the internal RAG extension's three tools. RAG uses the `MCPTool` shape and an internal server marker but routes to `serviceHub.rag()`, not an external MCP process. The route supplies thread/project scope; current RAG schema descriptions mention `scope` although the actual schemas do not expose that argument. Do not invent a model-selectable scope parameter. Media support remains model/provider-dependent.
- **Cowork attachments:** `coworkAttachments.ts` parses and copies documents into the session workspace, optionally with extracted-text siblings; user-turn text identifies those paths or import failure. This does not install a RAG/MCP tool or grant arbitrary source-path access. A shared attached folder is a distinct writable mount, not just a copied document.
- **MCP:** external service-discovered tools have dynamic names/schemas, server identities, optional routing and user approval/trust. Native web tools come from Jan's websearch plugin, **not MCP**; shell networking is yet another route to network. Turning off web tools is not a blanket offline guarantee.
- **Extensions:** existing extension infrastructure supplies services such as RAG/vector storage and model engines; being an extension is not automatically being a model-callable tool. No generic worker extension-tool injection appears in the audited current builders. #484 discusses draft extension work as future client host tools; do not treat that issue's planned/draft feature inventory as shipped in this checkout. Extension providers, host callbacks and remote placement need separate future contracts.

Sources: `web-app/src/lib/custom-chat-transport.ts` (file/media conversion, files instruction, tool loading), `web-app/src/lib/fileMetadata.ts`, `coworkAttachments.ts`, `webSearchTool.ts`, `extension.ts`; `extensions/rag-extension/src/tools.ts`; route RAG/MCP dispatch.

## Memory and skills after the rebase

The old Cowork `memory_list`/`memory_read`/`memory_write` inventory is stale: model access is now **one `memory` tool**, with six ops. Management IPC still has list/read/write/catalog/delete commands; those are used by settings/UI and prompt loading, not advertised under those names.

`agentTools.ts` snapshots the shared permanent Desktop store: Archived (`status: done`) notes are excluded from this recall catalog. Cowork gets at most 50 newest listed notes as a name-sorted catalog; Chat gets whole nonempty listed notes under a 2048 JavaScript-character budget (described as 2 KiB in a comment), newest first, skipping notes that do not fit. Chat has no memory tool to dereference catalog entries. In-app mutation invalidates the snapshot; external edits are picked up after restart. Chat's explicit Remember action is UI persistence, not autonomous memory-tool exposure (`web-app/src/containers/RememberButton.tsx`, `MessageItem.tsx`).

Desktop `execute_tool_inner` always keeps memory and authored skills in the permanent store, independent of the attached project. Cowork overlays attached-folder project skills for discovery/read only. The shared native schema mentions `user:` and cross-project memory and user-scoped skill writes, but this Desktop context does not set `memory_home` or `skill_user_root`; those scopes are not promised by schema text. The default Desktop store is durable even where its schema calls an unprefixed note “this project.”

**Not established:** temporary-chat memory isolation, per-project memory policy, consent to automatic durable writes in a unified flow, and parity with CLI memory scopes. Chat digest loading/building has no temporary-thread check in the audited methods; do not claim temporary chats have no memory effects based on lack of a tool alone.

Sources: `agentTools.ts` memory snapshot/invalidation; `custom-chat-transport.ts:buildMemorySystemInstruction`; `coworkPrompt.ts:memoryBlock`; Rust `commands.rs`, `tools/schema.rs`, `tools/handlers.rs`, `tools/mod.rs:memory_scopes`, `memory.rs:Scopes`.

## Remaining decisions and proposed defaults (not agreed)

| Decision still required | Candidate default for review — not implemented/agreed |
|---|---|
| Unified tools/network activation | Preserve direct answers; never silently inherit Cowork's network-on/writable-folder scope for existing Chat. Separate native web, shell network and MCP activation visibly. Exact new-conversation defaults remain open. |
| Workspace and attachment policy | Managed scratch until a user selects additional scope; explicit writable-folder consent. Confirm lifecycle, migration and remote upload/path semantics first. |
| Memory consent and scope | Explicitly define recall versus mutation, temporary-chat exclusion and project/user isolation before enabling autonomous writes in more conversations. Do not infer consent from existing digest recall. |
| Enforcement parity | Require dispatch-time checks for effective capability/child allowlists and revocations, not just schema filtering; bind MCP dispatch to the advertised/approved server identity, reject ambiguous collisions, and reconcile persisted MCP grant identities. No safety expansion in the inventory slice. |
| Unsupported models/providers/platforms | Retain direct Chat; explain unavailable capabilities and offer an explicit model switch, never silently upload local context to a remote model. Live compatibility matrix still needed. |
| Stable capability boundary | Reconcile current per-run tool freeze with Cortex's per-session prefix rule; transitions must preserve old history and have prefix-stability tests, not churn schemas each step. |
| Runtime ownership | Follow #484's owner decision on migration/host tools; use this inventory as parity evidence rather than introduce another execution architecture. |

Unknown from this audit: installed MCP inventory and effective credentials/settings/grants; live sandbox/tool success on each OS; external hook policy; end-to-end temporary-chat behavior; provider/media parity; generic extension work not present in this checkout; remote host placement; live cancellation/resume and cache performance. No runtime tests were run for this docs-only slice. These require follow-up QA/decisions, not assumptions embedded in a capability registry.
