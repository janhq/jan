# Unified execution: adapters and cross-turn continuity

Tracks janhq/jan-internal#504, then #505. Parent: #500. Integration branch `jamesdam/unified-flow-foundation` (PR #9529). Runtime direction: #484 (Cortex). Capability inventory: `unified-conversation-capabilities.md`.

## Direction (decided 2026-11-02)
- **No new runtime and no new event union.** Chat (`hooks/use-chat.ts` → `lib/custom-chat-transport.ts`) and Cowork (`CoworkChatTransport extends CustomChatTransport`) already share AI SDK `UIMessageChunk`/`UIMessage` plus `StepMetadata` (`lib/stepMetadata.ts`). That is the contract. Cortex #484 P3 also maps to `UIMessageChunk`. The Desktop AI SDK loop stays in the webview; moving to Cortex is a separate task.
- **Option A: extend the Chat executor conservatively, without dual authority.** A Chat thread stays one store (`messages.jsonl` + `uiParts`) and one executor. **The goal is every Chat and Cowork capability in the single flow, including `todo`, `ask`, `task` and `monitor`.** A reduced-capability Chat is a step, not a finished state, and Cowork features must not be locked behind legacy mode for good. The constraint is *how*: no third loop. We share dispatch (and later consolidate the loops deliberately) instead of re-implementing Cowork's tools inside the route. The order is in "Next concrete tasks".
- **Product grant baseline:** folder scope is just in time and explicit. Network shell and durable memory are not expanded without consent. Chat's current access is unchanged: MCP, RAG, web, network-closed `shell`, Chat approvals. Direct answers make no extra inference call. Unsupported models keep direct chat.
- **Lossless adapters before any store switch.** We do not switch Chat to a sidecar, which would be lossy. Instead, the Chat store itself becomes lossless for assistant turns (this PR).

## Source findings that drive this PR
Paths are relative to `web-app/src`.
- Chat writes assistant turns at two sites in `routes/threads/$threadId.tsx`: `onFinish` (~626-695) and `rewriteStoredTurn` (~267, used on Stop). Both write `extractContentPartsFromUIMessage` + `toolErrorsOf`. Reload goes through `convertThreadMessageToUIMessage` (`lib/messages.ts`), and the full reloaded history is re-sent to the model each turn.
- Losses, verified by running the real converters:
  - text is trimmed;
  - `step-start`, `source-*`, `dynamic-tool` and non-media `file` parts are dropped;
  - `providerMetadata` (reasoning signatures) and `callProviderMetadata` are dropped;
  - a falsy tool output (`''`, `0`) and `output-denied` reload as `input-available` (shown as "running");
  - png reloads as `image/jpeg`;
  - literal `<think>` text is re-split into reasoning.
- Consequence: after a reload (thread switch or restart), the model request differs from the live one. That breaks prefix-cache stability and can misreport tool state.
- Correction to the earlier draft: the Cowork sidecar's `messages` are *not* a verbatim stream record (`coworkRunner.consumeStep` collapses the stream). They are not the lossless reference either.

## This PR: canonical assistant-record builder + lossless versioned parts
- `lib/messages.ts` `assistantRecordFields(message, baseMetadata, {stopped})` is the single builder. Both route write sites call it. `content` and the existing metadata (`stopped`, `toolErrors`) are byte-identical to before.
- Carrier `metadata.uiParts = {v: 1, parts}` holds the canonical sanitized parts (design B, chosen over a reference codec and over per-part merging after a Fable comparison).
  - It is written when the legacy `content` round trip is lossy, which is nearly every streamed turn because of `step-start`. Text is duplicated; only media `data:` URLs already in `content` become `contentRef`.
  - The sanitizer is an allowlist: text, reasoning, file, `tool-*`, dynamic-tool, step-start, `source-*`.
  - If a part type is unsupported, a provider field exceeds 8 KB, or the carrier exceeds 256 KB, `uiParts` is omitted and `metadata.uiPartsSkipped` records why. There is no silent truncation; the turn reloads as today.
- Validity on reload needs no hash. Reload re-sanitizes and rehydrates media (its `mediaType` comes from the stored part), re-derives `content` with the production extractor, and requires it to equal the stored `content` after a JSON round trip. Otherwise it takes the legacy path. So any writer that changes `content` (an old build's Stop rewrite, an edit) invalidates `uiParts` by construction.
- `uiParts` and `uiPartsSkipped` are stripped from inherited metadata before rebuilding (continue/regenerate) and from reloaded UIMessage metadata. Existing records are not rewritten; they keep reloading through the legacy path.
- Tool state: `input-streaming`/`approval-requested` persist as `input-available`, today's semantics. Chat stores that state between steps before `onFinish` executes the call.
- Compatibility:
  - Older builds and the CLI (`cli_list_messages`, `rebuild_wire_history`) read only `content` and ignore the extra metadata key.
  - `uiParts` is a desktop UI projection, not wire history.
  - User turns are unchanged (`newUserThreadContent`).
- Tests (`lib/__tests__/assistant-record.test.ts`):
  - characterisation of the old `content`/metadata;
  - no carrier on lossless turns;
  - lossless reload per loss case;
  - media dedup;
  - content reordered, edited, removed or appended, and corrupt or unknown versions, all falling back;
  - size cap;
  - inherited-carrier stripping;
  - stopped semantics;
  - user and legacy records unchanged;
  - prompt-cache stability: the model messages from the reloaded history equal those from the live history, and the same check fails on the old path.

Not covered: Cowork sidecar storage, approvals persistence (grants remain in `useToolApproval`), and migration of Cowork into `messages.jsonl`.

## Risks to address in later slices
1. Chat `refreshTools` runs on every `sendMessages` and on MCP/RAG changes, so a mid-turn tool change breaks the prefix. Freeze per turn (capability-policy workspace / S2).
2. `isAutoAllowedTool` decides by name. Any future network-enabled `shell` grant in Chat must not inherit auto-approval. Cowork reads its network flag from the global store at dispatch, not per thread.
3. Cowork `messages.jsonl` is empty, while `cowork.json` holds its transcript. Converging the two needs an explicit deletion path for the sidecar (see `merge-chat-cowork-data-model.md`) before Cowork turns can live in `messages.jsonl`.

## Next concrete tasks (each a fresh workspace and PR into foundation)
1. **Capability policy** (parallel workspace `unified-capability-policy`): bounded builder policy and shared refusal helper, keeping current exposure; per-turn tool freeze for Chat.
2. **Shared orchestration dispatch seam (next execution slice).** Extract Cowork's client-side handlers (`todo`, `ask`, `task` → `runSubagent`, `monitor`) out of `coworkDispatch.ts` behind one dispatcher. The dispatcher takes explicit per-thread context callbacks: todo sink, ask suspension, subagent runner, monitor lane, abort signal. The Chat route's existing tool executor calls this dispatcher for those names, so there is no new loop.
   - Chat awaits `ask` the same way it already awaits approvals, and Stop resolves both.
   - `todo` state is derived from transcript tool parts, which stay lossless through `uiParts`, rather than from a second store.
   - Default: Chat still advertises none of these names, so behaviour is unchanged. Parity tests show Cowork dispatch is byte-identical before and after.
   - This builds on 1's refusal helper rather than duplicating it.
3. **Enable orchestration tools in Chat behind a flag (default off)**, in this order: `todo` + `ask` (client-only, no new permissions); then `task` (children narrowed from Chat's advertised record and Chat approvals); then `monitor` (needs a ping injection into the Chat stream at a step boundary, like Cowork's `attachPings`).
   - Also the explicit just-in-time folder scope, with read-only first; writes need separate consent.
   - Network shell and durable memory each need an explicit consent UI.
4. **Loop consolidation decision:** keep the Chat executor plus the shared dispatcher, or move Chat onto `coworkRunner.runTurn` with Chat's MCP/RAG/web/shell approvals as a dispatcher and delete the route loop. This is decided with the #484 owner, informed by 2-3. Either way the result is one loop, one transcript authority (`messages.jsonl` + `uiParts`) and a removal path for the Cowork sidecar.
   Fable's rationale (2026-11-02):
   - (i) shared dispatch next, (ii) consolidation as the end state. `dispatchCoworkTool(call, ctx)` already injects `onTodo`/`onAsk`/`onTask` and returns `ToolOutcome`, and the route's `onFinish` is already a sequential per-call loop that awaits approvals. Both fit `RunDeps.dispatch: (call, signal) => ToolOutcome`.
   - Risk of (i): `task`/`monitor` pings. `runTurn` has an inbox and parks, while Chat resubmits through `sendAutomaticallyWhen`, so a synthetic-turn ping would be a second resume mechanism. Keep task/monitor for (ii) unless a ping path is proven equivalent.
   - Risk of (ii): Chat's UI is `useChat` streaming state. The move must carry continuation/stopped, branching `parentId`, titles, MCP image encoding and RAG. It is large, but it is the only path that deletes an executor.
   - PR 2 must prove:
     - dispatcher parity (`coworkDispatch.test.ts` through the seam, including the plan-mode, unadvertised and web-off refusals);
     - Chat parity with no grants: same names, `shell` network-closed;
     - exactly one `requestApproval` per non-auto-allowed call, with Stop/delete resolving deny;
     - a granted network `shell` is not auto-allowed (`isAutoAllowedTool` stops being name-only);
     - transcript invariants live and after reload: unique ids, each toolCallId settled once;
     - tool JSON frozen per turn;
     - flag default off, and removing it deletes no shared code.
5. **#505 composer** behind a rollout flag (workspace `unified-conversation-surface`). The selector is removed only after 3 reaches capability parity.
