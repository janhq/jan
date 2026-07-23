# Agent Activity Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a compact, truthful "what's happening right now" status line (tool name + target + elapsed time) on the assistant message while a tool is executing, in both regular chat and Cowork, replacing the current silent gap between `tool_call` and `tool_result`.

**Architecture:** Pure-function module (`agentActivity.ts`) computes label text from existing `UIMessage` parts / `SubagentRun[]` data — no backend change, no new events. `MessageItem` tracks per-`toolCallId` start timestamps in a `useRef` (parts carry no timestamp) and a `setInterval` re-render tick, then renders one row in the slot currently occupied by `<PromptProgress hideIdle={hasPendingToolCall} />`.

**Tech Stack:** React, TypeScript, Vitest + Testing Library (existing stack, no new deps).

## Global Constraints

- No backend/Rust changes.
- No fabricated byte/line/percentage progress.
- File-tool status shows basename only, never full path.
- Status row unmounts immediately (no fade/lingering) once the tool/subagent leaves the pending state.
- Reuse `formatDuration` from `@/lib/utils` for elapsed-time formatting.
- Reuse `humanizeToolName` pattern already in `MessageItem.tsx` for the unknown-tool fallback.

---

### Task 1: `agentActivity.ts` pure logic module

**Files:**
- Create: `web-app/src/lib/agentActivity.ts`
- Test: `web-app/src/lib/agentActivity.test.ts`

**Interfaces:**
- Consumes: `SubagentRun`, `CodeTurn` types from `@/hooks/useCodeSessions` (no changes to those types).
- Produces (used by Task 2):
  ```ts
  export type ActivityLabel = { text: string; startedAt: number } | null
  export function toolActivityText(toolName: string, input: unknown): string
  export function activeToolPart(
    parts: Array<{ type: string; state?: string; toolCallId?: string; input?: unknown }>
  ): { toolCallId: string; text: string } | null
  export function subagentActivityLabel(subagents: SubagentRun[]): ActivityLabel
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// web-app/src/lib/agentActivity.test.ts
import { describe, it, expect } from 'vitest'
import {
  toolActivityText,
  activeToolPart,
  subagentActivityLabel,
} from './agentActivity'
import type { SubagentRun } from '@/hooks/useCodeSessions'

describe('toolActivityText', () => {
  it('formats write with basename only', () => {
    expect(toolActivityText('write', { path: '/a/b/report.html' })).toBe(
      'Writing report.html'
    )
  })

  it('formats edit with basename only', () => {
    expect(toolActivityText('edit', { path: 'src/config.ts' })).toBe(
      'Editing config.ts'
    )
  })

  it('formats bash with truncated command', () => {
    expect(toolActivityText('bash', { command: 'ls -la' })).toBe(
      'Running ls -la'
    )
  })

  it('truncates long bash commands to 60 chars', () => {
    const long = 'echo ' + 'x'.repeat(100)
    const text = toolActivityText('bash', { command: long })
    expect(text.startsWith('Running echo ')).toBe(true)
    expect(text.length).toBeLessThanOrEqual('Running '.length + 60)
  })

  it('formats read/ls/find/grep with basename', () => {
    expect(toolActivityText('read', { path: '/x/y.md' })).toBe('Reading y.md')
    expect(toolActivityText('ls', { path: '/x' })).toBe('Listing x')
    expect(toolActivityText('find', { path: '/x' })).toBe('Finding x')
    expect(toolActivityText('grep', { path: '/x' })).toBe('Searching x')
  })

  it('formats memory tools without a path', () => {
    expect(toolActivityText('memory_write', {})).toBe('Saving memory')
    expect(toolActivityText('memory_read', {})).toBe('Reading memory')
    expect(toolActivityText('memory_list', {})).toBe('Reading memory')
  })

  it('falls back to humanized tool name for unknown tools', () => {
    expect(toolActivityText('web_search', { query: 'x' })).toBe('Web search')
  })

  it('falls back gracefully when path/command arg is missing', () => {
    expect(toolActivityText('write', {})).toBe('Writing')
    expect(toolActivityText('bash', {})).toBe('Running')
  })
})

describe('activeToolPart', () => {
  it('returns null when no part is pending', () => {
    const parts = [
      { type: 'text', state: undefined },
      {
        type: 'tool-write',
        state: 'output-available',
        toolCallId: 'c1',
        input: { path: 'a.ts' },
      },
    ]
    expect(activeToolPart(parts)).toBeNull()
  })

  it('returns the pending tool part text and id', () => {
    const parts = [
      {
        type: 'tool-write',
        state: 'input-available',
        toolCallId: 'c1',
        input: { path: 'report.html' },
      },
    ]
    expect(activeToolPart(parts)).toEqual({
      toolCallId: 'c1',
      text: 'Writing report.html',
    })
  })

  it('ignores non-tool parts', () => {
    const parts = [{ type: 'text', state: 'input-available' }]
    expect(activeToolPart(parts)).toBeNull()
  })
})

describe('subagentActivityLabel', () => {
  it('returns null when no subagent is running', () => {
    const subagents: SubagentRun[] = [
      { runId: 'r1', name: 'Researcher', status: 'done', startedAt: 1, turns: [] },
    ]
    expect(subagentActivityLabel(subagents)).toBeNull()
  })

  it('labels a single running subagent with its own tool activity', () => {
    const subagents: SubagentRun[] = [
      {
        runId: 'r1',
        name: 'Researcher',
        status: 'running',
        startedAt: 1000,
        turns: [
          {
            role: 'tool',
            content: '',
            name: 'write',
            args: { path: 'notes.md' },
            status: 'running',
          },
        ],
      },
    ]
    expect(subagentActivityLabel(subagents)).toEqual({
      text: 'Researcher: Writing notes.md',
      startedAt: 1000,
    })
  })

  it('labels a single running subagent with "working" when it has no tool turn', () => {
    const subagents: SubagentRun[] = [
      { runId: 'r1', name: 'Researcher', status: 'running', startedAt: 1000, turns: [] },
    ]
    expect(subagentActivityLabel(subagents)).toEqual({
      text: 'Researcher: working',
      startedAt: 1000,
    })
  })

  it('labels multiple running subagents with a count and earliest startedAt', () => {
    const subagents: SubagentRun[] = [
      { runId: 'r1', name: 'A', status: 'running', startedAt: 2000, turns: [] },
      { runId: 'r2', name: 'B', status: 'running', startedAt: 1000, turns: [] },
      { runId: 'r3', name: 'C', status: 'done', startedAt: 500, turns: [] },
    ]
    expect(subagentActivityLabel(subagents)).toEqual({
      text: '2 subagents working',
      startedAt: 1000,
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web-app && /Users/thinhlpg/.bun/bin/bunx vitest run src/lib/agentActivity.test.ts`
Expected: FAIL with "Cannot find module './agentActivity'" (or similar resolution error).

- [ ] **Step 3: Write the implementation**

```ts
// web-app/src/lib/agentActivity.ts
import type { CodeTurn, SubagentRun } from '@/hooks/useCodeSessions'

export type ActivityLabel = { text: string; startedAt: number } | null

const MAX_COMMAND_LEN = 60

function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  return idx === -1 ? trimmed : trimmed.slice(idx + 1) || trimmed
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function stringArg(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function humanizeToolName(name: string): string {
  const spaced = name.replace(/[_-]+/g, ' ').trim()
  if (!spaced) return 'tool'
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

const VERB_BY_TOOL: Record<string, string> = {
  write: 'Writing',
  edit: 'Editing',
  bash: 'Running',
  read: 'Reading',
  ls: 'Listing',
  find: 'Finding',
  grep: 'Searching',
}

const NO_DETAIL_TOOLS: Record<string, string> = {
  memory_write: 'Saving memory',
  memory_read: 'Reading memory',
  memory_list: 'Reading memory',
}

/** Text for one tool call, given its name and args. Pure formatting, no timestamp. */
export function toolActivityText(toolName: string, input: unknown): string {
  const fixed = NO_DETAIL_TOOLS[toolName]
  if (fixed) return fixed

  const verb = VERB_BY_TOOL[toolName]
  if (!verb) return humanizeToolName(toolName)

  if (toolName === 'bash') {
    const command = stringArg(input, 'command')
    return command ? `${verb} ${truncate(command, MAX_COMMAND_LEN)}` : verb
  }

  const path = stringArg(input, 'path')
  return path ? `${verb} ${basename(path)}` : verb
}

type ToolPartLike = {
  type: string
  state?: string
  toolCallId?: string
  input?: unknown
}

const PENDING_STATES = new Set(['input-available', 'submitted'])

/** Finds the first pending tool part; returns its id + activity text, or null. */
export function activeToolPart(
  parts: ToolPartLike[]
): { toolCallId: string; text: string } | null {
  for (const part of parts) {
    if (!part.type.startsWith('tool-')) continue
    if (!part.state || !PENDING_STATES.has(part.state)) continue
    if (!part.toolCallId) continue
    const toolName = part.type.slice('tool-'.length)
    return { toolCallId: part.toolCallId, text: toolActivityText(toolName, part.input) }
  }
  return null
}

function lastRunningToolTurn(turns: CodeTurn[]): CodeTurn | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]
    if (turn.role === 'tool' && turn.status === 'running') return turn
  }
  return undefined
}

/** null if no subagent is running; else a combined label + earliest startedAt. */
export function subagentActivityLabel(subagents: SubagentRun[]): ActivityLabel {
  const running = subagents.filter((s) => s.status === 'running')
  if (running.length === 0) return null

  if (running.length === 1) {
    const run = running[0]
    const activeTurn = lastRunningToolTurn(run.turns)
    const detail = activeTurn
      ? toolActivityText(activeTurn.name ?? 'tool', activeTurn.args)
      : 'working'
    return { text: `${run.name}: ${detail}`, startedAt: run.startedAt }
  }

  const startedAt = Math.min(...running.map((s) => s.startedAt))
  return { text: `${running.length} subagents working`, startedAt }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web-app && /Users/thinhlpg/.bun/bin/bunx vitest run src/lib/agentActivity.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add web-app/src/lib/agentActivity.ts web-app/src/lib/agentActivity.test.ts
git commit -m "feat(code-ui): add agent activity label logic"
```

---

### Task 2: Wire activity status into `MessageItem`

**Files:**
- Modify: `web-app/src/containers/MessageItem.tsx`
- Test: `web-app/src/containers/MessageItem.test.tsx` (create if it doesn't exist; check first)

**Interfaces:**
- Consumes: `toolActivityText`, `activeToolPart`, `subagentActivityLabel`, `ActivityLabel` from `@/lib/agentActivity` (Task 1). `formatDuration` from `@/lib/utils` (existing). `SubagentRun` from `@/hooks/useCodeSessions` (existing).
- Produces: `MessageItem` gains an optional prop `subagents?: SubagentRun[]`. Existing props unchanged.

- [ ] **Step 1: Check for an existing `MessageItem` test file**

Run: `ls web-app/src/containers/MessageItem.test.tsx 2>/dev/null || echo "none"`

If a file exists, add new `describe('agent activity status', ...)` block to it; otherwise create a new minimal test file with just this block (do not attempt full existing-component coverage).

- [ ] **Step 2: Write the failing test**

```tsx
// web-app/src/containers/MessageItem.test.tsx (new block, or new file if none exists)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MessageItem } from './MessageItem'
import type { UIMessage } from 'ai'

// Adjust these mocks to match whatever the existing MessageItem test file
// (if present) already mocks for i18n/router/stores; keep them minimal.
vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({}),
}))

describe('agent activity status', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2024, 0, 1, 0, 0, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const baseMessage: UIMessage = {
    id: 'm1',
    role: 'assistant',
    parts: [
      {
        type: 'tool-write',
        toolCallId: 'c1',
        state: 'input-available',
        input: { path: '/proj/report.html' },
      } as never,
    ],
  } as UIMessage

  it('shows the active tool label and ticks elapsed time', () => {
    render(
      <MessageItem
        message={baseMessage}
        isFirstMessage={false}
        isLastMessage={true}
        status="streaming"
      />
    )
    expect(screen.getByText(/Writing report\.html/)).toBeInTheDocument()
    expect(screen.getByText(/0s/)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByText(/3s/)).toBeInTheDocument()
  })

  it('removes the status row once the tool result lands', () => {
    const doneMessage: UIMessage = {
      ...baseMessage,
      parts: [
        {
          type: 'tool-write',
          toolCallId: 'c1',
          state: 'output-available',
          input: { path: '/proj/report.html' },
          output: 'ok',
        } as never,
      ],
    } as UIMessage

    render(
      <MessageItem
        message={doneMessage}
        isFirstMessage={false}
        isLastMessage={true}
        status="ready"
      />
    )
    expect(screen.queryByText(/Writing report\.html/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web-app && /Users/thinhlpg/.bun/bin/bunx vitest run src/containers/MessageItem.test.tsx`
Expected: FAIL — no "Writing report.html" text found (current code renders `PromptProgress` with `hideIdle`, which returns null once a tool call has arrived).

- [ ] **Step 4: Implement in `MessageItem.tsx`**

Add the import (near the other `@/lib` imports, after the existing `import { cn } from '@/lib/utils'` line):

```tsx
import { formatDuration } from '@/lib/utils'
import {
  activeToolPart,
  subagentActivityLabel,
  type ActivityLabel,
} from '@/lib/agentActivity'
import type { SubagentRun } from '@/hooks/useCodeSessions'
```

Add `subagents` to `MessageItemProps` (after `hideActions?: boolean`):

```tsx
  hideActions?: boolean
  // Cowork only: the session's background subagent runs. Omitted in regular
  // chat threads, which never spawn subagents.
  subagents?: SubagentRun[]
```

Destructure it in the component signature alongside the other props (find the prop destructuring list starting at `message,` — add `subagents,` in the same list).

Add the toolCallId → startedAt tracking ref and the activity-label computation, right after the existing `hasPendingToolCall` / `awaitingApproval` `useMemo`s (after the `awaitingApproval` block, before `isStreaming`):

```tsx
  // Tool parts carry no start timestamp; track first-seen time per
  // toolCallId locally so the elapsed-time readout is stable across
  // re-renders (not reset every render, not reused across a new call
  // with the same id after a session reset -- cleared once a step
  // becomes non-pending in the effect below).
  const toolStartedAtRef = useRef<Map<string, number>>(new Map())

  const pendingTool = useMemo(() => {
    if (!isLastMessage || message.role !== 'assistant') return null
    return activeToolPart(message.parts as never)
  }, [isLastMessage, message.role, message.parts])

  useEffect(() => {
    const map = toolStartedAtRef.current
    if (pendingTool && !map.has(pendingTool.toolCallId)) {
      map.set(pendingTool.toolCallId, Date.now())
    }
    if (!pendingTool) {
      map.clear()
    }
  }, [pendingTool])

  const subagentLabel = useMemo<ActivityLabel>(() => {
    if (pendingTool || !subagents || subagents.length === 0) return null
    return subagentActivityLabel(subagents)
  }, [pendingTool, subagents])

  const activityLabel: ActivityLabel = pendingTool
    ? {
        text: pendingTool.text,
        startedAt:
          toolStartedAtRef.current.get(pendingTool.toolCallId) ?? Date.now(),
      }
    : subagentLabel

  // Re-render once a second while a label is showing, purely to advance the
  // elapsed-time readout -- no state carried, just a tick.
  const [, forceTick] = useState(0)
  useEffect(() => {
    if (!activityLabel) return
    const id = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [activityLabel])
```

Add `useEffect` and `useRef` to the existing React import at the top of the file (the import already includes `useState, useCallback, useEffect` per the file header — add `useRef` to that list):

```tsx
import { memo, useState, useCallback, useEffect, useRef, cloneElement } from 'react'
```

Replace the `PromptProgress` render block (the one gated by `hasPendingToolCall || status === CHAT_STATUS.SUBMITTED`) with a branch that prefers the new activity label:

```tsx
        {isLastMessage &&
          message.role === 'assistant' &&
          !awaitingApproval &&
          (hasPendingToolCall || status === CHAT_STATUS.SUBMITTED) && (
            <div className="mt-2">
              {activityLabel ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="flex items-center gap-2 text-xs"
                >
                  <Loader className="animate-spin w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="font-medium text-foreground">
                    {activityLabel.text}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {formatDuration(activityLabel.startedAt)}
                  </span>
                </div>
              ) : (
                <PromptProgress hideIdle={hasPendingToolCall} />
              )}
            </div>
          )}
```

Add the `Loader` import from `lucide-react` (check the existing `@tabler/icons-react` import block is separate — `Loader` comes from `lucide-react`, matching `PromptProgress.tsx`'s own import):

```tsx
import { Loader } from 'lucide-react'
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web-app && /Users/thinhlpg/.bun/bin/bunx vitest run src/containers/MessageItem.test.tsx`
Expected: PASS, both new cases green.

- [ ] **Step 6: Typecheck**

Run: `cd web-app && /Users/thinhlpg/.bun/bin/bunx tsc -b --noEmit` (run from `web-app/`)
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add web-app/src/containers/MessageItem.tsx web-app/src/containers/MessageItem.test.tsx
git commit -m "feat(code-ui): render live tool/subagent activity status"
```

---

### Task 3: Pass Cowork's subagents into `MessageItem`

**Files:**
- Modify: `web-app/src/routes/code.tsx`

**Interfaces:**
- Consumes: `MessageItem`'s new `subagents?: SubagentRun[]` prop (Task 2). Consumes the already-computed `subagents` value in `code.tsx` (existing `useMemo` merging `committedSubagents` and `liveSubagents`, see lines ~196-203).
- Produces: nothing new for later tasks — this is the final wiring task.

- [ ] **Step 1: Add the prop at the call site**

In `web-app/src/routes/code.tsx`, find the `<MessageItem ... />` call (around line 959) and add `subagents={subagents}`:

```tsx
                    <MessageItem
                      key={message.id}
                      message={message}
                      isFirstMessage={i === 0}
                      isLastMessage={i === uiMessages.length - 1}
                      status={running ? 'streaming' : 'ready'}
                      subagents={subagents}
                      reasoningContainerRef={reasoningContainerRef}
                      isReasoningAtBottom={isReasoningAtBottom}
                      onReasoningScroll={handleReasoningScroll}
                      onReasoningScrollToBottom={forceScrollReasoningToBottom}
                      onRegenerate={handleRegenerate}
                    />
```

- [ ] **Step 2: Typecheck**

Run: `cd web-app && /Users/thinhlpg/.bun/bin/bunx tsc -b --noEmit`
Expected: no errors (prop is optional and already typed on `MessageItem`; `subagents` in scope is `SubagentRun[]`).

- [ ] **Step 3: Manual smoke test**

Run: `cd .. && cargo tauri dev` (from repo root; or `cd web-app && bun run dev` for a browser-only smoke of the UI logic), open Cowork, run a prompt that triggers a `write` on a non-trivial file and, separately, one that dispatches a subagent.
Expected:
- During the `write`, a row reading `Writing <filename> · Ns` appears immediately under the assistant message and updates every second.
- The row disappears the instant the result arrives (no flash/lingering).
- With a subagent running and the main agent idle, a row reading `<name>: <activity> · Ns` (or `N subagents working · Ns` for 2+) appears.
- No full file path or unredacted long command is visible in the row.

- [ ] **Step 4: Commit**

```bash
git add web-app/src/routes/code.tsx
git commit -m "feat(code-ui): wire subagent activity into Cowork message list"
```

---

## Self-Review Notes (already applied above)

- **Spec coverage:** verb map (Task 1), basename-only paths (Task 1), command truncation (Task 1), single/multi subagent labels (Task 1), priority order tool > subagent > PromptProgress fallback (Task 2), elapsed-time ticking (Task 2), row disappears on non-pending (Task 2 effect clearing the ref + `activeToolPart` returning null), `subagents` prop wiring (Task 3), a11y `role="status" aria-live="polite"` (Task 2) — all covered.
- **Type consistency:** `ActivityLabel`, `toolActivityText`, `activeToolPart`, `subagentActivityLabel` names match between Task 1's exports and Task 2's imports. `subagents?: SubagentRun[]` matches between Task 2's prop definition and Task 3's call-site usage.
- **No placeholders:** every step has real code, real commands, real expected output.
