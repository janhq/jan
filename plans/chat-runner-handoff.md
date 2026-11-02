# Chat → existing runTurn (#504)

Current-access parity slice, based on merged serializer parent `4f76f4db9`.

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
- Full web suite: 376 files / 5103 tests passed after building local extension artifacts.
- Typecheck and production-file ESLint passed.
- Route replacement tests plus real hook/SDK/runner tests and canonical reload/request negative controls are present.
- Independent early code review and removed-test audit led to cancellation/parser/freeze/approval fixes and additional mounted integration coverage.
- Independent controlled browser inspection verified pending approval, Stop with zero execution/no follow-up, and a subsequent approved typed-result completion with exactly one execution/follow-up. This was an isolated fixture with fake services, not native/provider QA; broader manual scenarios were not completed. Final follow-up review and separate verification remain gates, not yet claimed complete. No ready PR until they pass and latest merged parent is rebased/retested.
