# #504: production-used client dispatch seam

Bounded extraction, not Chat/Cowork execution convergence. No new loop, tool advertisement, permission, schema, transport request, or transcript writer.

## Production change
- `web-app/src/lib/clientToolDispatch.ts` owns `PendingToolCall`, `ToolOutcome`, `ClientToolHandlers`, and `dispatchClientTool(call, handlers): Promise<ToolOutcome | undefined>`.
- `coworkDispatch.dispatchCoworkTool` consumes it after existing mode, memory-op and own-property advertised-record refusals, inside the existing exception-to-tool-error boundary.
- `todo` receives input; `ask`/`task` receive call id and input; `monitor` receives input. Exactly one handler is awaited. Unknown names return `undefined` to the adapter's existing web/native routing. Rejections propagate to that adapter; no detached promise, retry, or cancellation race is introduced.
- Cowork retains monitor lane/native calls, session workspace namespace, folder access and per-call network settings. The shared module has no ambient configuration or grant defaults.
- `coworkRunner` type-reexports the call/outcome types for compatibility. Its existing `runTurn`, inbox and assistant write logic are unchanged.

## Exact next integration (fresh workspace after merge)
1. Wait for serializer #9538 and MCP identity/approval #9533 to merge, then rebase foundation. Do not copy their unmerged code.
2. Extract the Chat route's per-call executor into `lib/chatRunDeps.ts`, preserving RAG/MCP/web/shell ordering, the frozen advertised record, and one approval per non-auto call. Wrap the existing `CustomChatTransport.sendMessages` as `RunDeps.sendStep`.
3. Feed that executor into the existing `runTurn` as `RunDeps.dispatch`; delete the superseded Chat tool-loop authority rather than introducing another loop. Keep Chat live UI state and wire completed/stopped writes through `assistantRecordFields` from #9538. Preserve Continue, branching parents, titles, MCP images, RAG and unsupported-model direct answers.
4. For client names, call `dispatchClientTool` only AFTER Chat's policy and advertised-record gates, with conversation-owned `ClientToolHandlers`. Callbacks capture that run's abort signal; Stop must settle asks/approvals and child work exactly once. Do not reuse Cowork's session/folder/network grants. Do not advertise these names until their Chat handlers are production wired.
5. `todo` derives from transcript tool parts, not a second store; task/monitor completion uses `RunDeps.inbox`, never a second ping/resume path. Requested folder scope is not authorization: writable folders, network shell, MCP and durable memory require their own explicit consent. No model/provider fallback.
6. Gate convergence on live/reloaded request and schema/cache parity, direct answer one model call, tool sequence, Stop/approval exactly once, unique ids/no lost events, Continue/branch/title parity and controlled native UI QA. This extraction does not claim those Chat integration gates are complete.

## Validation
- Final full web run: **372 files / 4,988 tests passed**. Initial full run failed to load the missing assistant extension artifact; building the local extension bundles resolved it. No test or implementation workaround.
- TypeScript build and changed production-file ESLint passed; whitespace check passed. Repository lint ignores tests by default; the independent verifier also linted its new integration test with `--no-ignore`.
- Independent implementation review: no blockers. Separate final delta review: no findings; new integration tests and identity invariant passed 17/17.
- Separate verifier: 8 focused files / 152 tests passed before the final invariant addition, covering runner/dispatch/tools/transports and existing Chat freeze/prefix tests. Added five controlled tests exercising real `runTurn → dispatchCoworkTool → dispatchClientTool`: one-call direct answer, serial promises, approval exactly once, Stop settling/aborting lanes exactly once, and rejected-promise normalization without unhandled errors. Events/results/unique message IDs retained; display diff stays off wire; frozen advertisement unchanged.
- Router identity invariant ties all four names to builder constants and `CLIENT_TOOL_NAMES`, avoiding a production import cycle and failing on drift.

Limits: approval registration is a synthetic conversation-owned stand-in; CoworkPage UI/store lifecycle is not mounted. No native UI parity claim or live KV-cache measurement. Existing Chat behavior is regression-tested but no Chat adapter ships here. All execution fixtures are synthetic with native/web boundaries mocked; no user data, providers or real tool calls.
