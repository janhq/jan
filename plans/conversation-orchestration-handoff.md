# Conversation orchestration: production shared todo/ask slice

Parent: `4f76f4db9`, integration PR #9529; #504/#505. This slice does not claim Chat orchestration activation or capability parity. Chat runner #9541, grants #9540 and MCP #9533 remain separately coordinated. No unmerged source imported, no route/hook/transport changes.

## Production consumption and exact API

`lib/conversationToolHandlers.ts` exports `createConversationToolHandlers(ctx: ConversationToolContext)`, returning existing `ClientToolHandlers` todo/ask callbacks. `containers/CoworkPage.tsx` consumes both in production through the existing gated `dispatchCoworkTool` → `dispatchClientTool` → `runTurn` path.

Context callbacks are bound to one conversation/run:
- `signal`: existing run cancellation; Stop/delete settles ask with cancelled/error, removes card/resolver, suppresses late answer policy.
- `getTodo()`: reads the last settled full snapshot from the authoritative transcript.
- `onTodo(list, toolCallId?)`: publishes the snapshot into the existing live transcript and updates existing UI projection. It must make the result visible to the next same-step call.
- `pendingAsks`: existing run-owned resolver map, not another suspension registry.
- `showAsk(id, request)` / `hideAsk(id)`: publish/remove the existing contextual card. Request id is the tool-call id; question ids remain request-local.
- optional `onAnswer(request, answers)`: caller-owned policy. Cowork keeps plan review here; Chat must not inherit it.

The dispatcher forwards todo call ids as an optional second argument for backward compatibility. Run-local promise receipts settle duplicate ids only once. They are not persisted or used as history. Ask validates structured answers before resuming, and distinguishes user dismissal from run cancellation. Existing `CoworkAskCard`, `CoworkTodoPanel`, shared session types and schemas are reused without a duplicate schema source.

`lib/conversationTaskPresentation.ts` exports `conversationTodos(readonly UIMessage[])`. It projects only valid settled todo output snapshots, including an intentional empty list; invalid/pending results cannot erase earlier progress. Cowork uses committed+live transcript output as authority, retaining session `todos` solely for legacy fallback and existing rail compatibility. No new transcript/todo store or empty dashboard.

## Coordinator-owned Chat integration (after merge notification)

The caller owns root route integration. Supply Chat-scoped transcript/UI/abort callbacks through this API; retain Chat's advertisement and approval/grant dispatch. Do not use Cowork stores or its permission context. No mode selector required by these modules; no network, durable-memory or write grant is introduced. Default remains currentChat. Unsupported/direct Chat is unchanged and has no planning call.

Task children must narrow the parent's advertised tools and dispatch with the SAME Chat approvals/grants. Monitor and child notices must use existing `runTurn` inbox; never add a ping loop or second transcript. Those capabilities are not activated by this slice.

## Verification evidence (2026-11-02)

- Independent follow-up review: PASS after fixing replacement-owner cleanup, cross-tool ID collision and malformed todo/ask payloads; reviewer ran 53 boundary tests.
- Separate verifier: 25 focused files / 306 tests pass, app typecheck and changed-file lint pass. Added two automated jsdom tests using the installed real AI SDK `streamText`/conversion → `runTurn` → shared dispatch → mounted existing ask card. Provider generation alone is mocked. Includes two same-step todo calls, transcript reload, answer/resume and Stop/no late policy effect.
- Final broader run: 375 files / 5095 tests pass. One suite excluded because the local dependency setup lacks built `@janhq/assistant-extension` (`services/core/__tests__/tauri.test.ts`); the initial full run confirmed that resolution failure. App `tsc --noEmit --incremental false`, changed production ESLint and `git diff --check` pass.
- Manual isolated browser QA is **blocked**: browser tool reports no connected extension. Automated jsdom is not manual/pixel/native/real-provider evidence. No readiness claim or PR until this original gate is satisfied or the coordinator explicitly changes it.
- Fetched integration parent remains `4f76f4db9`; no unmerged source imported. Local dependency symlinks only, ignored by Git.

## Readiness gates

Independent code review and a separate verifier are required before non-draft PR. Tests must cover once-only dispatch, per-run/thread ask ownership, malformed request/answer handling, Stop/delete cleanup/no late effects, transcript reload and same-step todo chaining, existing Cowork plan review and dispatch parity. Isolated UI/real SDK evidence must be labeled separately from native/provider verification. No real user data, providers or MCP calls. Coordinator merges only after bot feedback; no routine issue comments.
