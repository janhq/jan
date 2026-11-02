# Chat MCP identity slice — controlled verification

Tracking: https://github.com/janhq/jan-internal/issues/503
Parent integration: https://github.com/janhq/jan/pull/9529
Base: `origin/jamesdam/unified-flow-foundation` including #9531. Capability inventory read with `git show jamesdam/unified-capability-contract:plans/unified-conversation-capabilities.md`; no sibling commits imported.

## Bounded behavior / compatibility

- Existing model-visible MCP names remain unchanged. Missing server identities and duplicate names are withheld, including rivals outside smart routing or disabled by the user. No name mangling, runtime, provider call, or new permission default.
- Chat snapshots the advertised MCP server mapping with the request schemas. Each received call retains that mapping for approval and execution; live menu refresh cannot replace it. Dispatch checks the full current inventory and disabled pair before approval and again after approval; replacement/disconnect/ambiguity/disablement fails closed.
- Enabled native web/shell retain precedence. An MCP call cannot turn into a newly enabled native tool while awaiting approval. Internal advertised RAG schemas retain precedence over MCP; an MCP tool sharing an unadvertised RAG name still needs MCP approval.
- MCP `allow-thread` persists structured `(threadId, serverName, toolName)` grants. Legacy bare thread/global tool grants remain readable for no-server compatibility but do not authorize server-qualified MCP calls. Existing explicit server-wide trust and explicit allow-all setting remain unchanged. No implicit migration/widening of trust.
- Rust explicit `server_name` never falls back. Legacy unnamed API calls remain supported only after complete, unambiguous discovery. Discovery failures fail closed. One configured timeout/cancellation boundary covers mutex wait, discovery and execution.
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
