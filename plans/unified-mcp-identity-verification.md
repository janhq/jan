# Chat MCP identity slice — controlled verification

Tracking: https://github.com/janhq/jan-internal/issues/503
Parent integration: https://github.com/janhq/jan/pull/9529
Base: `origin/jamesdam/unified-flow-foundation` including #9531. Capability inventory read with `git show jamesdam/unified-capability-contract:plans/unified-conversation-capabilities.md`; no sibling commits imported.

## Bounded behavior / compatibility

- Existing model-visible MCP names remain unchanged. Missing server identities and duplicate names are withheld, including rivals outside smart routing or disabled by the user. No name mangling, runtime, provider call, or new permission default.
- Chat snapshots the advertised MCP server mapping with the request schemas. Each received call retains that mapping for approval and execution; live menu refresh cannot replace it. Approval and execution freshly check the explicitly bound target and disabled pair; target replacement/disconnect/disablement fails closed. Unrelated server names/collisions affect advertisement, not explicit dispatch.
- Advertised native web/shell retain precedence. A request-bound MCP shell remains MCP even when the global shell switch is on but the sandbox withheld the native schema. An MCP call cannot turn into a newly enabled native tool while awaiting approval. Internal advertised RAG schemas retain precedence over MCP; an MCP tool sharing an unadvertised RAG name still needs MCP approval.
- MCP `allow-thread` persists structured `(threadId, serverName, toolName)` grants. Legacy bare thread/global tool grants remain readable for no-server compatibility but do not authorize server-qualified MCP calls. Existing explicit server-wide trust and explicit allow-all setting remain unchanged. No implicit migration/widening of trust.
- Rust explicit `server_name` never falls back. Legacy unnamed API calls remain supported only after complete, unambiguous discovery. Discovery failures fail closed. Cancellation covers mutex wait, discovery and execution; the configured discovery/execution timeout starts only after acquiring the MCP server guard, so queue contention does not consume the call budget.
- Pending prompts are dismissed without granting trust when a call fails validation or ends. Cancellation retains the existing cancellable MCP service path.

Identity here is the existing configured server name plus tool name, not a cryptographic server identity or connection/schema generation. Reconfiguration/reconnect under the same name and schema revision tracking remain future work, as do broader #503 policy, Cowork MCP parity, Cortex runtime ownership, and real provider/platform QA. The existing smart-router cache boundary is retained; no per-step schema churn is introduced.

## Automated validation (2026-11-02)

Local dependencies: `yarn install --immutable`, `yarn workspace @janhq/core build`, `yarn build:tauri:plugin:api` (successful; no dependency changes committed).

- Focused web suites: transport (including smart-routing/prefix/turn-model/shell), identity helper, approvals/persistence, useTools, thread route. 13 files, 293 tests passed (including 96 thread-route tests).
- `yarn workspace @janhq/web-app exec tsc -b --pretty false` — passed.
- Focused ESLint on all changed production TypeScript — passed.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib call_tool_routing_tests --no-default-features --features test-tauri` — 9 passed. Initial attempt was blocked by missing bundled bun resource; repository `node scripts/stub-tauri-resources.mjs` supplied compile-only stubs, then the actual crate tests passed. No stubs committed or executed as tools.
- `git diff --check` — passed.

Independent local default-backend subagent review found and prompted fixes for mutable request identity, RAG overlap, smart-routing hidden rivals, stranded approvals, and discovery cancellation. Follow-up independent review checked those corrections before PR creation. No OpenAI/Codex agents launched.

## Manual controlled browser verification (not native Desktop E2E)

Started this workspace Vite on loopback port 5193. Opened a temporary static fixture page via Orca browser automation, without application bootstrap, installed Jan data, credentials, providers, or external MCP connections. Imported the real production modules directly; all tool inventories were in-memory `alpha`/`beta` fixtures. Temporary page removed afterward.

Observed browser results:

1. `uniqueMcpTools([alpha.lookup, beta.lookup])` withheld the collision.
2. `assertMcpIdentityAvailable` accepted bound alpha; rejected beta replacement, empty/disconnected inventory, and disabled alpha. All five checks returned true.
3. Real approval stores: seeded legacy bare thread grant; server-qualified alpha request still prompted with `serverName: alpha`. `allow-thread` granted alpha only; beta remained untrusted. All four checks returned true.
4. Real approval cancellation: pending alpha request resolved false, prompt disappeared, and a late `allow-always` saved no trust. All three checks returned true.

Only fixture-origin localStorage was used and cleared. These browser checks supplement automated route/cancellation tests; they do not claim native UI rendering, real MCP interoperability, credentials, or live provider verification.


## External review follow-up (2026-11-02)

Rebased the existing READY PR #9533 onto parent foundation `6e8207fa333803dcbd9f2d9fb2c8459e62b1bc05` before editing (previous PR tip `182af979e0cc80eae2e6c611d6da28f030642933`).

- Shell dispatch now respects the request-bound MCP identity, not just the global shell switch. Tests cover native switch on/no native schema: approve and execute the same MCP server, never native; genuinely advertised native shell still wins over a same-name MCP inventory entry.
- Full-inventory diagnostics name withheld tool names and all colliding servers (including disabled/smart-routing-hidden rivals), or explicitly mark missing/blank server identity. Only names are logged; no descriptions, schemas, arguments, connection config or credentials.
- Independent review additionally found an early-approval trust race in the previous slice. Chat now supplies a bound identity validator to the approval store, which validates before publishing an actionable prompt (including existing-trust fast paths), and revalidates before granting/persisting a decision. Cancellation/clear-thread cover both initial and decision-time validation; late completion cannot revive prompts or save trust. Existing non-validator callers retain their synchronous behavior.

Validation commands use workspace-local/root binaries because `yarn workspace @janhq/web-app test` could not resolve the hoisted `cross-env` binary in this installation:

- `yarn install --immutable`, core build, and plugin API build passed; pre-existing peer warnings, no dependency changes retained.
- From `web-app`: `NODE_OPTIONS=--max-old-space-size=4096 ../node_modules/.bin/vitest --run src/lib/__tests__/custom-chat-transport*.test.ts src/lib/__tests__/chatMcpIdentity.test.ts src/hooks/__tests__/useToolApproval*.test.ts src/hooks/__tests__/useTools.test.ts 'src/routes/threads/__tests__/$threadId.test.tsx'` — 13 files / 322 tests passed at the initial follow-up validation; final rerun recorded below.
- `./node_modules/.bin/tsc -b --pretty false` and focused ESLint on all four changed production TypeScript files passed. `git diff --check` passed.
- No Rust changes in this follow-up; previous nine routing/cancellation Rust tests are documented above, not claimed rerun.

Separate controlled verifier used minimal Vite on `127.0.0.1:5197`, no application bootstrap, and isolated headless Chrome with a fresh temporary user-data directory. Browser automation connection was unavailable, so Chrome ran directly. Actual production identity helpers passed **13/13** checks: collisions/missing/blank diagnostics, names-only logging against canary descriptions/schema/args/config, unique inventory silent, valid alpha shell, rejection of collision/replacement/disconnect/disabled/missing identity, and disablement during discovery. Separate filtered route checks passed **5 tests**. Temporary page/test/server/profile cleaned up. Evidence retained locally in `/tmp/jan-pr9533-verifier-dom.txt` and `/tmp/jan-pr9533-verifier-shell-tests.log` (not committed).

All verification is controlled fixture/module/route QA, **not native Desktop E2E**, actual sandbox enforcement, live provider, or real MCP interoperability QA. No production/provider MCP connections or data, installed Jan profile, global settings changes, alternate backend selection, or merge.

Final follow-up evidence: **13 files / 324 tests passed**, TypeScript build and four-file production ESLint passed. Independent final read-only review found no concrete issues (155 focused tests plus final 48-test hook rerun). Separate controlled trust verifier passed **23/23** scenarios using real approval/availability stores, real persistence middleware/serialization and only in-memory backend storage: invalid identities before prompt; removal/rebinding/collision/disablement after prompt for thread/server grants; cancellation/clear/deny during initial and decision validation; valid alpha trust persisted while beta still prompted. Evidence: `/tmp/jan-pr9533-controlled-trust-race.log`, with fixture/config retained in `/tmp`; temporary workspace files removed.

Before push, remote foundation advanced to `c831c103de2ae98a6d88d0807e728c462f3d9698` (capability docs and Cowork skills-test merges only). Rebased onto that parent too and reran the targeted validation; no production overlap/conflicts.


## Second external review correction (2026-11-02)

Reviewed the complete bot review of `5be449f881fe8e38ff388296d19f10e22fdcd0e7`; its approval did not waive the actionable timeout regression. Parent remains `c831c103de2ae98a6d88d0807e728c462f3d9698`.

- Rust cancellation still covers a queued `mcp_servers` lock waiter, discovery, and execution. The single configured discovery/execution timeout starts after acquisition. Controlled paused-time tests queue a call for 20s against a 10s budget, then allow 6s discovery + 3s execution successfully; discovery/execution still share a budget. Cancellation removes the queued waiter with no late dispatch; discovery cancellation/timeout release the guard. Existing explicit-server/no-fallback tests remain.
- Tool cards read the request-bound MCP identity recorded at call arrival, before approval, rather than infer overlapping RAG names from the global menu. An advertised internal identity is explicitly null; MCP strings win over name-only families. A minimal per-message `metadata.toolOrigins` map preserves the call ID/server-or-null pairs for history; no transcript codec/serializer changes. The hook uses message-scoped metadata after runtime reset. Legacy overlapping RAG/MCP cards without recorded identity remain unlabelled instead of guessing. Tests cover menu refresh, internal RAG, history lookup scoped to message, runtime reset, and route recording.
- Actual locked Rust crate routing tests: **11 passed**, no additional compile stubs needed. Controlled fixture coverage, not a live MCP server/native E2E claim.

Final second-correction validation: **374 web tests across 17 suites passed**, TypeScript and focused production ESLint passed, `git diff --check` passed. Added a route assertion that only the current message’s captured call origins are written into minimal metadata. Independent read-only code review reported no actionable issues. Separate verifier reran the actual Rust crate (**11/11**) and exercised the real origin hook/resolver/runtime/messages/app stores in an isolated controlled fixture (**5/5**): alpha versus beta/RAG/menu refresh, internal null, JSON-round-tripped history after runtime reset, message-scoped historical lookup, unknown overlap, and live-versus-stored priority. Temporary workspace fixture removed; logs `/tmp/jan-pr9533-independent-rust.log`, `/tmp/jan-pr9533-independent-origin.log`, fixture `/tmp/jan-pr9533-independent-origin-fixture.ts`. These are controlled jsdom/store and Rust unit checks, not native UI/live MCP/provider E2E; backend storage isolated, standard test ServiceHub mock. No new workspace, unrelated codec change, global settings change, provider call, or production MCP data.


## Shared policy foundation rebase (2026-11-02)

Fetched and rebased the three MCP identity commits from `6e99a6de4abfdba7b789ae35fd733e13a39d3473` onto foundation `edd3def3864c3003bd48eb53b5fe492fd2245a5e` after #9535. The expected native advertisement conflict was resolved by retaining **both** `policy.webSearch` and `policy.loadNativeTools`/`policy.allowsNativeTool` gates, plus deletion of overlapping MCP bindings only inside those native advertisement branches. No policy fixtures/signature expectations, Cowork builder, or policy module were changed. Range-diff shows only these first-commit conflict adaptations; the later two review-correction commits are patch-identical after rebase.

Post-rebase automated validation: **414 tests across 19 suites passed**, including the **32 unchanged Chat/Cowork baseline builder signature fixtures**, shared policy tests, transport/MCP identity/shell/abort/freeze tests, full 99-test thread route, approval/cancellation/trust and origin suites. TypeScript build, focused production ESLint, and `git diff --check` passed. No new workspace or production/provider MCP calls/settings changes.


## Lock lifecycle and thread-scoped origin correction (2026-11-02)

Read the complete bot review of `51a493e145d5d53e9444d0be145947339d12b5fc` and rebased onto foundation `9207feb315ff35c39ed13e9c2a5827038a334ffe` before editing.

- Verified rmcp 3.2.0 ownership: `RunningService` is not Clone; its Arc-backed `Peer<RoleClient>` is Clone. Commands snapshot peers under brief map locks, then release before discovery/execution. Health/startup probes likewise release the map lock before remote waits. Failed probes remove only the same connection; removed owners are cancelled outside the map mutex. Cache publication atomically follows lifecycle order `servers -> active -> cache` with no remote await under these guards.
- Stable advertisement uses the existing last-known fallback. Current authorization calls `getTools({validationServer: serverName, validationTool: toolName})` (the earlier global `freshOnly` authorization mode is superseded). It freshly queries only that target, bypassing last-known/rmcp response cache for the target. Missing/disconnected/replaced/deactivated targets fail closed; explicit server never falls back. Unrelated servers cannot block a bound call. Dispatch revalidates the selected connection after discovery.
- Fresh identity validation uses the configured MCP toolCallTimeoutSeconds (30s default, backend-aligned minimum1s) and AbortSignal; Stop/clear/cancel abort pending approval validation, clean timers/listeners, and prevent late prompt, trust, or execution continuations. IPC discovery already in flight may finish, but cannot authorize the cancelled request.
- Origin context now propagates threadId through the existing message/card chain. Historical selector reads only `messages[threadId]`, no `Object.values/flat` allocation or foreign-thread scan. Runtime origin keys are thread scoped; stored per-message identity takes precedence over a later reused provider call ID. No transcript codec/serializer changes.

Final validation: **520 tests across 23 web suites passed**, including unchanged 32 builder signature fixtures/full 99-test route/service bridge/rendering/approval/identity/origin tests; TypeScript, focused production ESLint and diff checks passed. Actual locked expanded Rust MCP crate suite: **121 passed** (`cargo test --locked --manifest-path src-tauri/Cargo.toml --lib core::mcp:: --no-default-features --features test-tauri`, `/tmp/jan-mcp-lock-tests-final.log`). Includes **14 routing/collector tests**, concurrency via actual snapshot/cancellation helpers with controlled fake remote gates, full timeout budgets, no late dispatch on Stop, and actual fresh collector rejection of disconnected cached advertisement.

Independent reviewer explicitly audited entire lock lifecycle and selector complexity: **no actionable findings** in final code; Rust routing14/14 and focused web84/84 passed, prior route-inclusive250/250 passed. Selector work is O(selected-thread messages + menu size) per card/store update with constant auxiliary space. Separate verifier: **20/20 JS checks** (5 temporary real-store/validator fixtures +15 service tests), **14/14 actual Rust routing tests**. Checked pending fake A vs B preprompt; Stop during initial/grant validation with no zombie trust/dispatch; disconnected fresh inventory despite existing server trust; zero foreign-thread getter reads; duplicate wire IDs/history; freshOnly/default advertisement separation. Logs `/tmp/pr9533-manual-verifier/js-final-stored-origin.log`, `/tmp/pr9533-manual-verifier/rust-final.log`, fixture `/tmp/pr9533-manual-verifier/fixture-final.ts`. Temporary workspace fixtures removed.

Limits: controlled fake gates/module/store/jsdom QA, not actual Peer transport/native UI/provider E2E. Snapshot revalidation cannot atomically prevent remote schema mutation/new rivals after the final local check; cancellation cannot undo remote side effects already dispatched. Configured server+tool names remain the identity contract; generation/schema revision pinning across turns/reconnects is future work, not cryptographic identity. No production/provider MCP calls/data, global settings/backend changes, new workspace, or merge.


## Target-specific ownership and typed failures correction (2026-11-02, ownership policy superseded below)

Read all four CHANGES_REQUESTED findings on `2a192cb7e318a5d714e3072c6df96f141a76f782`. Foundation `9207feb31` was initially current. This bounded correction adds optional `validationServer` + `validationTool` IPC arguments (both required together): freshly query only the requested connected target, then prove target-name uniqueness against complete last-successful inventories of every unrelated enabled owner. Offline unrelated known-disjoint/known-empty owners do not block. Missing or malformed ownership is explicitly `MCP ownership unavailable`; cached collisions, target disconnect/failure/replacement/disablement or enabled config change refuse validation. No global outage fallback, no querying offline rivals, no broad inventory redesign.

Contract tradeoff: unrelated ownership is last-successful complete discovery, not live proof. Newly introduced rival names await ownership refresh; cached collisions can remain conservatively blocked. Unknown ownership cannot safely establish uniqueness and remains an explicit refusal until successful discovery or deactivation. Target revocation/disconnect remains freshly checked before prompt/grant and again before dispatch; Rust dispatch retains its existing fresh connection/discovery boundary. Same-name generation/schema pinning remains outside this configured-name contract.

Validation failures resolve to typed `{kind:'validation-error', errorText}` instead of user denial; the route records the identity diagnostic. Explicit deny/cancel retain existing boolean handling and Stop fences late decisions. Routed collision inventory is frozen with the routed set, refreshed only on invalidation; the orchestrator all-tools fallback reuses the same fetched inventory, avoiding duplicate discovery. Actual request-count regressions cover repeated turns and disabled/server-set invalidation. The requested indentation is fixed.

Final pre-rebase validation: **523 web tests across23 suites**, TypeScript and focused ESLint passed. Actual locked expanded Rust MCP suite **123/123** passed (`/tmp/jan-target-validation-rust.log`), including16 routing/collector tests with actual duplex MCP target discovery for healthy/offline-disjoint, collisions, unknown/malformed ownership, known-empty inventory, target disconnect/missing tool, replacement/deactivation during gated discovery. Independent review reported no actionable findings after explicitly auditing multi-server offline behavior, typed errors, discovery counts, dispatch revocation and indentation (170 web +22 latest bridge/freeze checks, Rust16). Separate verifier reran actual Rust123/123, JS real stores/router/full route155/155, and an independent removable actual-transport fixture confirming counts across3 turns/invalidation and fresh revocation refusal (1/1). No production/provider calls, settings changes, workspace creation, or serializer edits.


Before push, foundation advanced to `db714205c14b4a0446114d57a76ea149a539fa0c` (home-scope preparation and shared client-dispatch merges). Rebased cleanly with no conflicts. Post-rebase integration: **625 tests across28 web suites passed**, including full MCP/approval/route/builder coverage and the new parent client-dispatch/home suites. TypeScript, focused production ESLint and diff checks passed. Rust changes are unchanged by the parent/rebase. Contract limits above remain unchanged; native/live interoperability is not claimed.


## Explicit-target simplification and thread-isolated approvals (2026-11-02)

All four findings on `8508cf7c9d47f957c45763e9276d79b354ef8bb6` read before editing. Current contract supersedes the unrelated ownership policy above: **explicit bound calls validate only the requested active connected server and its freshly listed tool**. No global cache-completeness, rival ownership or collision prerequisite remains. Unknown/never-listed/offline unrelated servers do not block healthy target calls; even a cached same-name rival cannot reroute an explicit call. Collision filtering remains advertisement-only; legacy unqualified Rust dispatch still requires complete, unambiguous discovery. No additional ownership error modes or global redesign.

Non-fresh default enumeration preserves an active server's last-known tools if it disconnects/reconnects during remote listing; fresh enumeration/target validation remain strict. Pending and internal in-flight approvals are keyed by collision-safe `(threadId, toolCallId)`. Resolve, cancel, UI pending selectors/action context and route finally cancellation all carry the thread. Same provider ID in two threads cannot replace, grant, deny or cancel the other thread's request. Typed validation failures and Stop fences retained. No serializer edits/new production files/workspace/provider settings.


Final validation of this simplification: **653 web tests across29 suites passed**, TypeScript and focused production ESLint/diff checks passed. Actual crate full `core::mcp::` suite **126/126 passed** (worker and independent verifier). Includes actual duplex tests for never-listed/offline/cached-collision unrelated rivals; explicit alpha succeeds, legacy unnamed collision refuses; unrelated activation does not invalidate target; target replacement/disable/disconnect rejects; default reconnect-midlisting retains last-known while fresh mode rejects. Independent reviewer found no production correctness defect; requested real-store two-thread UI/finally regression was added to existing `tool.test.tsx`: A's decision plus `cancelApproval(id,A)` leaves B's same-ID promise pending and prompt actionable, then B resolves independently. Mock UI two-thread context forwarding also covered. Approval store51/51 includes duplicate-ID validation/Stop/grant isolation. No new files.

Separate verifier exact-gap result **4/4 controlled real-store/UI fixtures passed**: two simultaneous same-ID requests, A Allow-in-thread, A actual finally cancellation leaves B pending/actionable, B Allow-in-thread, isolated thread/server grants, and Stop during either validation stage with no zombie trust. Explicit target accepts rivals while advertisement still withholds duplicates. Evidence `/tmp/pr9533-verifier-final-independent-js.log`, reproducible fixture `/tmp/pr9533-verifier-final-independent.fixture.tsx`; temporary repository fixture removed. Independent Rust126/126 log `/tmp/pr9533-verifier-final-rust.log`. Controlled jsdom/in-memory persistence and local duplex MCP tests, not native Desktop/provider/live settings QA. Parent remained `db714205c`; no rebase necessary.


## Final four-finding cleanup on serializer foundation (2026-11-02)

Read all four review findings on `04f1a3bd710f3c67b412be5c2cb4e7ce534cdc2a`. Rebased onto foundation `4f76f4db971c57070ae6245a7dd3c95e5b12efc2` (serializer #9538). Resolved the route save conflict by preserving `assistantRecordFields` as the serializer owner and passing only this message's request-bound `toolOrigins` as metadata; no serializer/codec implementation edits.

- Identity listing uses MCP configured `toolCallTimeoutSeconds`, default30s and minimum1s matching backend semantics; raised timeout permits a20s listing (no hard15s ceiling). AbortSignal/timer cleanup remains.
- One pre-prompt fresh target Promise is retained per bound call and reused by loop/decision/pre-dispatch local checks. No repeated remote listings in Chat. A compact settings/disabled/menu/MCP-update revision snapshot invalidates reuse; the existing MCP_UPDATE refresh invalidates synchronously before async discovery. Rust `call_tool` retains live target discovery/connection recheck at execution. Failed/aborted snapshots do not retry silently or grant late trust. Server/thread grant writes do not invalidate their own decision.
- Superseded health monitor returns instead of continuing. Actual in-memory duplex RMCP test gates the old failing probe, registers a replacement, and proves old monitor termination, zero replacement probes, unchanged replacement identity/PID.
- `releaseSettled(owner)` builds composite origin keys from that owner's released call IDs and prunes only those keys, preserving other threads/queued/running calls. Repeated100-call growth test plus persisted message origins cover bounded state and history after pruning.

Current broad web validation **704 tests across30 suites passed**, including serializer/message tests, one-query count regressions, configured timeout/default/minimum, event invalidation, Stop, origin growth/sibling isolation and full101-test route. TypeScript, focused production ESLint, diff checks passed. Actual locked Rust full MCP suite **127/127 passed**, including monitor lifecycle regression. No new production framework/files, workspace, settings/backend changes or provider/production MCP calls. Controlled local duplex/jsdom/module tests, not native/live-provider E2E.


Reviewer10 identified a missing origin lifecycle despite the initial verifier's4/4 helper pass: streaming Stop after capture but before enqueue has no timing entry for releaseSettled. Fixed with exact `(owner,callID)` release after shared serializer persistence in the isAbort path, before clearing queued call data. Existing store/route files now regress recordOrigin -> pre-enqueue Stop -> persisted metadata -> runtime removal, repeated100 times, preserving sibling same-ID entries. Follow-up reviewer11 explicitly passed this tiny delta; no codec change. Final rerun: **706 web tests across30 suites**, TypeScript, focused ESLint, diff checks passed. Earlier Rust127 and timeout/helper/serializer verification remain unchanged. Initial broad verifier PASS is not claimed to cover the missed case; separate exact-case verification recorded below.

Exact-case verifier16 PASS: existing targeted store/route4/4 plus independent removable actual-route fixture1/1 over100 pre-enqueue Stop cycles. It asserted persistence-before-release using actual assistantRecordFields; exact stopped owner/call deletion; sibling same-ID running timing/origin and unrelated same-owner origin preserved; origin count fixed at2 throughout. Temporary fixture removed, no tracked verifier edits. Separate verifier15 had independently passed Rust127 plus4 timeout/reuse/serializer/store fixtures, including actual20s listing under60s configuration (not claimed for pre-enqueue Stop). All gates now complete; parent remains4f76f4db9.
