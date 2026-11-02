# Chat MCP identity slice — controlled verification

Tracking: https://github.com/janhq/jan-internal/issues/503
Parent integration: https://github.com/janhq/jan/pull/9529
Base: `origin/jamesdam/unified-flow-foundation` including #9531. Capability inventory read with `git show jamesdam/unified-capability-contract:plans/unified-conversation-capabilities.md`; no sibling commits imported.

## Bounded behavior / compatibility

- Existing model-visible MCP names remain unchanged. Missing server identities and duplicate names are withheld, including rivals outside smart routing or disabled by the user. No name mangling, runtime, provider call, or new permission default.
- Chat snapshots the advertised MCP server mapping with the request schemas. Each received call retains that mapping for approval and execution; live menu refresh cannot replace it. Dispatch checks the full current inventory and disabled pair before approval and again after approval; replacement/disconnect/ambiguity/disablement fails closed.
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
