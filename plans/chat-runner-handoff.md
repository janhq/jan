# Chat → existing runTurn (#504)

Current-access parity slice, rebased onto merged MCP/grants/typefix parent `c2b9b4458`. No capability activation.

## Production seam
- `hooks/use-chat.ts` gives the retained SDK `Chat` a streaming transport wrapper. `lib/chatRunTransport.ts` calls existing `coworkRunner.runTurn`; the route's sequential tool loop and SDK `sendAutomaticallyWhen` authority are removed, not feature-flagged beside it.
- `runTurn` retains its existing loop/budgets/retry/inbox authority. Its optional `assistantMessage` projection lets Chat retain canonical SDK parts rather than reconstruct a lossy Cowork transcript.
- Presentation receives one start/finish and one assistant across model steps. Internal text/reasoning ids are scoped per step. Chat's canonical accumulated assistant is the next request history, matching persisted/reloaded grouping. Sources, signatures, tool metadata and typed MCP/RAG outputs are retained.
- Route `dispatchTool(call, signal)` is the existing Chat permission/service boundary: existing auto-allow, exactly-one shared approval promise, web/shell/RAG/MCP routing, output budgets and cancellation. No orchestration tools, network shell grants, folder writes or durable memory writes are activated.
- `CustomChatTransport.beginChatRun` brackets prompt/schema/model freeze. Stop/delete abort the retained run; edit/regenerate await cancellation before replacement. Unsupported SDK approval protocol fails closed before execution. Duplicate tool-call ids fail closed, rather than executing twice.
- Persistence remains both existing `assistantRecordFields` sites. Continue/stopped, parentId branching and title handling stay in route callbacks.

## Next activation boundary (not this slice)
Grants prerequisite owns strict resolver, `useThreads.getConversationCapabilities(id)` effective deny-overlay getter, narrow atomic native patch and optional ChatInput prepare seam. Consume only after merge; re-read effective getter per dispatch before any auto-allow, retain native canonical scope containment. Consent controls stay unmounted until actual enforcement/advertisement activate together. No raw disk metadata bypass. `clientToolDispatch` remains the shared future todo/ask/task/monitor seam; no second ping path.

## Verification status
- Full web suite on current merged parent: **384 files / 5327 tests passed**. App TypeScript, production ESLint and diff checks pass.
- Typecheck and production-file ESLint passed.
- Route **106 tests** retain all **20 merged MCP cases**. Real SDK edit/regenerate replacements assert a second `regenerate-message` request and replacement assistant, with no old queued tool/follow-up. Cancellation waits the original SDK operation through reservation release, not the early send-admission receipt.
- Continue publishes its replacement receipt after original drain; streamed-partial/distinct-id regression asserts exact old-record deletion and new assistant persistence. Held-tool Continue is defensive handler-race coverage; normal UI exposes Continue only on a stopped reply.
- Composer acceptance, same-tick admission, model-scale completion-only budget and canonical reload/provider-request negative controls are covered.
- Independent early code review and removed-test audit led to cancellation/parser/freeze/approval fixes and additional mounted integration coverage.
- Independent controlled browser inspection verified pending approval, Stop with zero execution/no follow-up, and a subsequent approved typed-result completion with exactly one execution/follow-up. This was an isolated fixture with fake services, not native/provider QA; broader manual scenarios were not completed. Independent cancellation/MCP review and separate verifier passed the runtime fixes; the final parent-only rebase is separately checked before push. Ready PR #9541 is awaiting a new-head bot review, not merge-approved.
