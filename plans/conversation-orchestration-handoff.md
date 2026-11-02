# Conversation orchestration: production shared todo/ask slice

Original parent: `4f76f4db9`; rebased onto merged grants/MCP parent `8b8d47ba1`, integration PR #9529; #504/#505. This slice does not claim Chat orchestration activation or capability parity. Chat runner #9541 remains separately coordinated; grants #9540 and MCP #9533 are merged, without activation by this slice. No unmerged source imported, no route/hook/transport changes.

## Production consumption and exact API

`lib/conversationToolHandlers.ts` exports `createConversationToolHandlers(ctx: ConversationToolContext)`, returning existing `ClientToolHandlers` todo/ask callbacks. `containers/CoworkPage.tsx` consumes both in production through the existing gated `dispatchCoworkTool` → `dispatchClientTool` → `runTurn` path.

Context callbacks are bound to one conversation/run:
- `signal`: existing run cancellation; Stop/delete settles ask with cancelled/error, removes card/resolver, suppresses late answer policy.
- `getTodo()`: reads the last settled full snapshot from the authoritative transcript.
- `onTodo(list, toolCallId?)`: publishes the snapshot into the existing live transcript and updates existing UI projection. It must make the result visible to the next same-step call.
- `pendingAsks`: existing run-owned resolver map, not another suspension registry.
- `showAsk(id, request)` / `hideAsk(id)`: publish/remove the existing contextual card. Request id is the tool-call id; question ids remain request-local.
- optional `onAnswer(request, answers)`: caller-owned policy. Cowork keeps plan review here; Chat must not inherit it.

The dispatcher forwards todo call ids as an optional second argument for backward compatibility. Run-local receipts share only in-flight duplicate calls. Reuse of a settled id fails closed with an explicit tool error instead of replaying a stale result; cross-name reuse also fails closed. They are not persisted or used as history. Ask validates structured answers before resuming, and distinguishes user dismissal from run cancellation. Existing `CoworkAskCard`, `CoworkTodoPanel`, shared session types and schemas are reused without a duplicate schema source.

`lib/conversationTaskPresentation.ts` exports `conversationTodos(readonly UIMessage[])`. It projects only valid settled todo output snapshots, including an intentional empty list; invalid/pending results cannot erase earlier progress. Cowork uses committed+live transcript output as authority, retaining session `todos` solely for legacy fallback and existing rail compatibility. No new transcript/todo store or empty dashboard.

## Coordinator-owned Chat integration (after merge notification)

The caller owns root route integration. Supply Chat-scoped transcript/UI/abort callbacks through this API; retain Chat's advertisement and approval/grant dispatch. Do not use Cowork stores or its permission context. No mode selector required by these modules; no network, durable-memory or write grant is introduced. Default remains currentChat. Unsupported/direct Chat is unchanged and has no planning call.

Task children must narrow the parent's advertised tools and dispatch with the SAME Chat approvals/grants. Monitor and child notices must use existing `runTurn` inbox; never add a ping loop or second transcript. Those capabilities are not activated by this slice.

## Verification evidence (2026-11-02)

- Independent follow-up review: PASS after fixing replacement-owner cleanup, cross-tool ID collision and malformed todo/ask payloads; reviewer ran 53 boundary tests.
- Separate verifier: 25 focused files / 306 tests pass, app typecheck and changed-file lint pass. Added two automated jsdom tests using the installed real AI SDK `streamText`/conversion → `runTurn` → shared dispatch → mounted existing ask card. Provider generation alone is mocked. Includes two same-step todo calls, transcript reload, answer/resume and Stop/no late policy effect.
- Local artifact gap repaired with workspace-local `yarn install --immutable`, `yarn build:tauri:plugin:api` and `yarn build:extensions`; no tracked dependency changes. Unexcluded `yarn test:web`: **384 files / 5332 tests pass**, including the previously missing extension suite. Final run includes bot fixes and the merged grants parent with no exclusions. The final optional-id guard requires a nonempty string and an exact todo tool row before transcript mutation; production callback tests cover absent/empty/nonstring IDs and wrong-tool isolation. Independent tiny-delta review: 21 Page tests PASS. Bot fixes independently reviewed (56 focused tests PASS) and separately verified through repeated-ID multi-step SDK and null-parity tests (27 tests PASS). App `tsc --noEmit --incremental false`, changed production ESLint and `git diff --check` pass.
- Browser tool reports no connected extension. Coordinator clarified that this handler-only extraction has no visual changes and needs no native QA: task-appropriate real installed SDK execution plus manual inspection of synthetic mounted existing UI snapshots satisfies this slice. This is not pixel/native/real-provider verification. Separate final verifier reran 57 tests across five files and manually inspected temporary printed mounted DOM: expected prompt, Small/Large radio options, selected aria state, submit control, two todo labels, and exact card removal after Stop. Temporary instrumentation was removed. This used the real installed SDK test path, not a separate standalone manual SDK script. Evidence: `/tmp/final-verifier-vitest.log`, `/tmp/final-verifier-dom.log`, `/tmp/final-verifier-tsc.log`.
- Fetched merged integration parent is `8b8d47ba1` (grants #9540 and MCP #9533 merged); clean rebase, no unmerged source imported. Workspace-local dependency install/build artifacts only, ignored by Git.

## Readiness gates

Independent code review and a separate verifier are required before non-draft PR. Tests must cover once-only dispatch, per-run/thread ask ownership, malformed request/answer handling, Stop/delete cleanup/no late effects, transcript reload and same-step todo chaining, existing Cowork plan review and dispatch parity. Isolated UI/real SDK evidence must be labeled separately from native/provider verification. No real user data, providers or MCP calls. Coordinator merges only after bot feedback; no routine issue comments.
