# Agent Activity Status — Spec

## Problem

While the agent is running a tool (`write`, `edit`, `bash`, subagent dispatch, etc.), the backend emits `tool_call` before execution and `tool_result` only after it finishes. During the gap the UI shows nothing new: the tool card is collapsed, and the generic `PromptProgress` "Working…" card is deliberately hidden once a tool call has arrived (`hasPendingToolCall` gates `hideIdle`). On a large `write`, this silent gap can be many seconds, and the UI reads as stuck.

Backend cannot honestly report byte/line progress for `write`/`edit` (single atomic `fs::write` / read-replace-write, no internal loop to hook). No backend change is justified.

## Goal

Add a compact, always-truthful "what's happening right now" status line to the assistant message while a tool is running, in both the regular chat (`$threadId.tsx`) and Cowork (`code.tsx`) surfaces — both render through the shared `MessageItem` component.

## Scope

- Frontend only. No Rust/backend changes.
- Applies to `MessageItem` (shared by chat threads and Cowork).
- Covers: main-agent tool activity, and Cowork's background subagents.

## Behavior

### Status line content, in priority order

1. **Active tool on the main agent**, if any part on the last assistant message is `state: 'input-available'` (pending) or `state: 'submitted'`:
   - Format: `Writing <filename> · <elapsed>` / `Editing <filename> · <elapsed>` / `Running <command> · <elapsed>` / `<HumanizedToolName> · <elapsed>` (fallback for tools without a special-cased label).
   - `<filename>` = basename of the tool's `path` arg (never the full path). `<command>` = the tool's `command` arg, truncated to 60 chars with the shell command escaped as-is (no full path leakage beyond what the model already put in the arg — acceptable since the model chose to run it, mirrors existing approval-dialog behavior which already shows the command).
   - Tool-name-to-verb map: `write` → "Writing", `edit` → "Editing", `bash` → "Running", `read`/`ls`/`find`/`grep` → "Reading"/"Listing"/"Finding"/"Searching", `memory_write` → "Saving memory", `memory_read`/`memory_list` → "Reading memory", else → humanized tool name unchanged (existing `humanizeToolName` helper), no verb prefix.
2. **No active tool, but a Cowork subagent is running** (`subagents` prop passed in, at least one entry has `status: 'running'`):
   - Exactly one running subagent: `<subagent name>: <its own active tool line, or "working"> · <elapsed>` using the subagent's own last live turn the same way as (1), elapsed from the subagent's `startedAt`.
   - More than one running subagent: `<N> subagents working · <elapsed>` where elapsed is from the earliest `startedAt`.
3. **Neither of the above, but the turn is submitted/streaming with no visible content yet** (existing `PromptProgress` gate): keep current `PromptProgress` behavior unchanged (model load / prompt-processing progress, or generic "Working…" once no better signal exists).
4. **Awaiting tool approval** (existing `awaitingApproval`): unchanged — no status line (the approval UI is the status).

### Elapsed time

- Ticks every second while visible. `Ns` under 60s, `Nm Ss` at/above 60s (reuse `formatDuration(startedAt)` from `@/lib/utils`, called with no `endTime` so it uses `Date.now()`).
- Timer starts when the relevant tool call/subagent is first observed running, stops (and the whole row unmounts) the instant it's no longer pending — no fade/lingering.

### Placement & style

- Renders in the same slot `PromptProgress` currently occupies (`isLastMessage && role === 'assistant' && !awaitingApproval`), replacing the bare `<PromptProgress hideIdle={hasPendingToolCall} />` call with a component that picks between the new status row and `PromptProgress` per the priority list above.
- Single line: small spinner icon (reuse `Loader` from `lucide-react`, same classes as `PromptProgress`'s spinner: `animate-spin w-3.5 h-3.5 text-primary shrink-0`) + text (`text-xs font-medium text-foreground`) + elapsed (`text-xs text-muted-foreground tabular-nums`, same row).
- `role="status" aria-live="polite"` on the row.
- Never expands the tool card, never renders full arguments/paths/diff content.

## New prop on `MessageItem`

```ts
subagents?: SubagentRun[]  // Cowork only; regular chat omits this (undefined -> subagent branch never taken)
```

Passed by `code.tsx` from its existing `subagents` value (the live+committed merge already computed there). `$threadId.tsx` passes nothing (regular chat has no subagents).

## New module: `web-app/src/lib/agentActivity.ts`

Pure, backend-untouched, unit-testable logic — no React, no timers.

```ts
export type ActivityLabel = {
  text: string       // e.g. "Writing report.html" or "3 subagents working"
  startedAt: number  // ms epoch, feeds the elapsed-time ticker
} | null

// Text for one tool call, given its name and args. Pure string formatting,
// no timestamp involved. "Writing report.html", "Running ls -la", etc.
export function toolActivityText(toolName: string, input: unknown): string

// Finds the first pending part on `parts` (state 'input-available' or
// 'submitted'), returns its { toolCallId, text: toolActivityText(...) }, or
// null if none pending. Caller pairs toolCallId with its own tracked
// startedAt (see "Timestamp sourcing" below) to build an ActivityLabel.
export function activeToolPart(
  parts: UIMessagePart[]
): { toolCallId: string; text: string } | null

// null if no running subagent. Single running subagent -> its name + its own
// last running tool turn's toolActivityText() (or "working" if no tool turn
// yet), startedAt = that subagent's startedAt. Multiple running -> "N
// subagents working", startedAt = min(startedAt) of the running ones.
export function subagentActivityLabel(subagents: SubagentRun[]): ActivityLabel
```

### Timestamp sourcing

`UIMessage` tool parts carry no start timestamp. `MessageItem` tracks it itself: a `useRef<Map<toolCallId, number>>` recording `Date.now()` the first render a given `toolCallId` is seen pending, cleared when that id leaves the pending set. `activeToolPart` returns text only; `MessageItem` looks up (or sets, on first sight) the timestamp for the returned `toolCallId` in its ref to build the final `ActivityLabel`. Subagents need no ref: `SubagentRun.startedAt` is already backend-set (from `startSubagent`).

## Files touched

- New: `web-app/src/lib/agentActivity.ts` (+ `web-app/src/lib/agentActivity.test.ts`)
- Modify: `web-app/src/containers/MessageItem.tsx` — replace the `PromptProgress` render block (lines ~805-812) with the new `AgentActivityStatus` inline component/logic; add `subagents` prop; add the toolCallId→startedAt ref.
- Modify: `web-app/src/routes/code.tsx` — pass `subagents={subagents}` to `MessageItem` (line ~959-970).
- No change to `web-app/src/routes/threads/$threadId.tsx` (prop omitted, defaults to no subagent branch).
- No change to `web-app/src/components/PromptProgress.tsx` (still used as the fallback/model-load case).
- No backend changes.

## Non-goals

- No byte/line/percentage progress for `write`/`edit`.
- No backend `ToolProgress` event.
- No change to `SubagentTasksPanel` (already shows full subagent detail elsewhere; this is just the inline transcript nudge).
- No full command/path disclosure beyond what the tool's own `args` already contain (basename only for file tools).

## Verification

- Unit tests for `agentActivity.ts`: tool verb mapping (all 9 builtin tools + unknown fallback), basename extraction, single vs multi subagent label, "no pending tool" → null.
- Component test (`MessageItem`, fake timers): pending `write` tool part renders `Writing <file> · 0s`, advancing timers updates elapsed, part transitioning to `output-available` removes the row.
- Manual smoke: run Cowork against a real project, issue a prompt causing a large `write`, confirm the status row appears immediately after `tool_call`, updates every second, and disappears exactly when `tool_result` lands (no flash of stale content, no lingering).
