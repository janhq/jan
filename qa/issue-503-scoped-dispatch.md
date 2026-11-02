# Scoped Chat execution boundary (#503 / #505)

This slice enforces the existing `executeAgentTool` thread entry; it does not mount consent controls or expand the Chat adapter's advertised tools. Route/runner/transport changes remain with the runner owner until coordinated integration.

## Contract

- Thread dispatch re-reads `useThreads.getState().getConversationCapabilities(id)` after async setup, immediately before native invoke. No frozen schema or model-supplied argument authorizes capability access. Existing currentChat approvals remain the caller's prerequisite.
- Getter elevation requires strict setter success in this process. Persisted metadata alone does not confirm consent on restart; failed revoke cannot silently reactivate old disk grants. Basic scratch tools remain available with denied elevated grants.
- `executeThreadTool(threadId, toolName, args, effectiveGrant)` invokes `plugin:agent-tools|execute_thread_tool`. It accepts no data root, namespace, projectWritable or network flag. The host resolves its configured root and reads a consistent stored Chat consent snapshot under the existing per-thread writer lock. Missing persistent threads, Cowork and malformed records fail closed. The exact `temporary-chat` sentinel receives only hardcoded denied elevated grants before any disk read; it retains scratch tools but cannot persist consent or acquire folder/network/memory mutation authority. The lock is released before tool execution.
- Native intersects effective limits with stored consent: booleans AND, exact selected folder root match, write requires both sides. Existing canonical attachment validation, path containment and OS sandbox enforce execution; lexical folder validation is not containment. User-project metadata and caller project arguments do not imply folder access. Durable memory/skill mutations require memoryWrite; reads/context remain separate; mutations keep the permanent store.
- Legacy Thread execute_tool/streaming cannot elevate network, attached folder, writes outside scratch or durable memory. Legacy Session Cowork remains unchanged. Screenshot is deliberately unavailable to scoped Chat: its renderer can fetch remote subresources outside the shell jail. Legacy Thread also rejects screenshot/native web tools; separate approved websearch routing is unchanged. Monitor requires explicit Session; monitor/task/subagent tools cannot enter the scoped thread command. Later Chat children must retain the same thread authority and per-call getter, not switch to Session.
- Revocation affects the next dispatch snapshot, not cancellation of an already-running shell. Native snapshot and existing canonicalization do not promise atomic protection from a concurrent hostile host filesystem renaming/replacing paths during execution.

## Threat boundary

This is model-tool dispatch enforcement, not an arbitrary compromised-webview permissions framework. Dedicated native calls cannot forge wider stored Chat consent. Native management memory/skills commands remain trusted settings/editor paths, and legacy Session execution remains the trusted Cowork API. A compromised webview able to invoke arbitrary management or Session IPC is outside this scope. No new opt-in switch, engine or parallel Chat executor is introduced.

## Verification (isolated fixtures only)

- Frontend: 119 scoped tests across scoped production entry, real guest invoke wrapper, existing agentTools/cancellation, strict helper, and grant-store tests.
- Real AI SDK `generateText`/`tool` with fake `MockLanguageModelV3` consumes production module across shell and denied/granted/revoked memory calls. No live provider; does not claim pending runner/approval UI coverage.
- Independent verifier adds distinct native boundary mocks (no legacy-to-scoped alias) and tests deferred setup, mid-run overlay revoke, no fallback, caller flag forgery, Cowork preservation, result forwarding and exact IPC payload.
- Native: 43 command tests, 2 intersection/missing-resolver tests, 8 permission-policy tests (plus 2 command registration tests), and 53 full core thread tests run against temporary fixture roots. Read-only/write intersection, canonical symlink escape, memory store location, forged/absent stored grant, and legacy elevation refusal covered.
- TypeScript no-emit passes after parent #9543. Guest API built with existing Rollup script. Repository compile-only resource stubs used for app-core tests; never executed or committed. No providers, model downloads or real user data used.
- Independent Fable same-tree security review: no remaining blockers after screenshot/native web bypass fixes; report at `/tmp/jan-capability-fable-review.md`. Separate post-fix verifier checks legacy execute/streaming wiring and casing/aliases. No native UI/picker or full model/SDK activation QA is claimed by this module slice.

## Follow-up activation gate

Only after boundary review/tests and coordinator merge notification: wire the Chat adapter's additional native names through SAME currentChat approval gate; mount controlled draft/active consent and explicit restart reconfirm UI; keep failed-save warning blocking. Verify the real SDK/tool boundary with a fake provider and native UI flows before claiming complete #503/#505 activation. MCP/web-search approvals remain independent; shellNetwork does not automatically authorize web tools.

## Independent review dispositions

Fable reviewed this same working tree after both network bypass fixes and found no remaining blockers. F1 legacy Thread native web egress: fixed by shared non-Session guard, used by execute and streaming. F2 screenshot subresource egress: fixed by removing screenshot from dedicated Chat allowlist and rejecting it in legacy Thread; **Cowork's existing screenshot renderer risk is not fixed here**. Casing/aliases fail closed through exact allowlist and registry lookup.

Approved limitations, explicitly accepted for this model-dispatch foundation:
- **L1 — next-call revocation:** snapshot lock released before long execution; revocation affects next dispatch, not an already-running command. Activation owner must state this in scope/consent UI copy; Stop remains separate.
- **L2 — forged Session IPC:** existing trusted Cowork/management IPC remains callable by a compromised webview; not hostile model tool args. No Chat tool bridge may select Session or inherit its elevation flags. Host-attested Cowork identity is a hardening follow-up, not implemented here.
- **L3 — read-only data subtree:** existing root validator rejects roots containing/equal to the data folder, not every strict descendant. Explicit picker consent is required; protected data subtree read exclusion is a bounded hardening follow-up, not claimed fixed.
- **L4 — local grant-root swap:** lexical selected root is canonicalized each dispatch; a local actor replacing it after consent can retarget future reads. Existing protected writable-root checks remain. Atomic resistance to hostile host filesystem replacement is outside this scope, not claimed fixed.

Native production app build/picker/UI acceptance remains pending on the final integrated revision; compile-only unit resource stubs do not establish that acceptance. No stub files are committed.

## Exact-head bot follow-up dispositions

- Temporary Chat scratch regression: fixed inside the dedicated native snapshot path, no legacy fallback. Native ignores any forged temp disk consent, AND intersection strips forged effective folder/network/memory grants. Separate verifier confirms jailed shell/scratch baseline, folder and durable mutation refusal; core reader tests confirm no disk authority; Fable follow-up approves no elevation path. Getter/setter persistent-consent denial unchanged.
- MCP important: inherited merged policy (`c6e928a6c1`, `da59aa9372`, parent `c2b9b4458`), not a scoped-dispatch routing change. Existing `run_tool_call` imposes one finite discovery/execution timeout; current Chat supplies qualified `serverName` and only queries selected server. Unknown unqualified discovery still fails closed because uniqueness cannot be proven. Per-peer subdeadline availability improvement queued locally in `/tmp/jan-mcp-per-server-timeout-followup.md`; no speculative skip-failure or broad MCP rewrite in this PR. Only redundant borrow CI fix touched MCP source.

## Create-only consent ingress hardening (R4 / L8)

New `create_thread` metadata strips `conversationCapabilities`; only the strict native setter can mint stored grants. Existing idempotent records return unchanged, preserving real setter authority. Supplied/generated ID is resolved before acquiring the existing per-thread lock, then existence-check and write run under that lock, serializing creation with setter/delete/rollback and another supplied-ID creation. Ordinary project/Cowork migration metadata is preserved. Fable narrow follow-up approves no mint bypass and sound ordering; separate verifier covers forged creation, real-grant preservation, chosen-ID lock queues, concurrent same-ID creation, and explicit setter after creation. Persistence helpers/durability remain separately owned.

The orphaned thread-workspace sweep comment is restored above its own function. MCP incomplete-discovery error already instructs `retry or specify a healthy server_name`; its fail-closed identity behavior is intentionally unchanged.
