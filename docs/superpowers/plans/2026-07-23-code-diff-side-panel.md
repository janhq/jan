# Code Diff Side Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a shared Code UI right-panel shell with Subagents and live agent-event Diff views.

**Architecture:** Keep panel selection local to `CodePage` as `'subagents' | 'diff' | null`. Reuse one small shell component for panel chrome while preserving view-specific state inside each panel. Derive file-grouped changes from existing `CodeTurn.diff` and `args.path` data; do not add Git, Rust, PR, or remote APIs.

**Tech Stack:** React 18, TypeScript, Zustand session/run data, Tailwind CSS, Radix Tooltip, Lucide icons, Vitest.

## Global Constraints

- Pull-request creation, keyboard shortcuts, Git status/branch comparison, accept/reject, Artifact bodies, and Browser bodies are out of scope.
- Add no dependency and no Rust/Tauri command.
- The Diff view is explicitly labelled as agent changes; totals are operation totals, not net Git totals.
- Include successful built-in `write`/`edit` diffs from both the main agent and subagents.
- Exactly one right-side view may be open.
- Preserve current Subagent task list/detail/cancel behavior.
- Use the existing `DiffView` for operation rendering.
- Target issue: `janhq/jan-internal#285`.

---

### Task 1: Project agent diffs into file groups

**Files:**
- Create: `web-app/src/lib/codeDiffs.ts`
- Create: `web-app/src/lib/__tests__/codeDiffs.test.ts`

**Interfaces:**
- Consumes: `CodeTurn` and `SubagentRun` from `@/hooks/useCodeSessions`.
- Produces:

```ts
export type CodeDiffOperation = {
  diff: string
  source: 'main' | 'subagent'
  sourceName?: string
}

export type CodeFileDiff = {
  path: string
  additions: number
  deletions: number
  operations: CodeDiffOperation[]
}

export function collectCodeFileDiffs(
  turns: CodeTurn[],
  subagents: SubagentRun[]
): CodeFileDiff[]
```

- [ ] **Step 1: Write failing projection tests**

Cover observable behavior with concrete tool turns:

```ts
import { describe, expect, it } from 'vitest'
import { collectCodeFileDiffs } from '@/lib/codeDiffs'
import type { CodeTurn, SubagentRun } from '@/hooks/useCodeSessions'

const edit = (
  path: unknown,
  diff: string,
  extra: Partial<CodeTurn> = {}
): CodeTurn => ({
  role: 'tool',
  content: '',
  name: 'edit',
  args: { path },
  diff,
  status: 'done',
  ...extra,
})

describe('collectCodeFileDiffs', () => {
  it('groups repeated main-agent operations by path and preserves order', () => {
    const files = collectCodeFileDiffs([
      edit('src/a.ts', '-    1 | old\n+    1 | new'),
      edit('src/b.ts', '+    1 | b'),
      edit('src/a.ts', '@@ edit 1/1 @@\n+    2 | next'),
    ], [])

    expect(files.map((file) => file.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(files[0]).toMatchObject({ additions: 2, deletions: 1 })
    expect(files[0].operations).toHaveLength(2)
  })

  it('includes subagent operations with source metadata', () => {
    const subagent = {
      runId: 'r1',
      name: 'TestsScout',
      status: 'done',
      startedAt: 1,
      endedAt: 2,
      turns: [edit('test/a.test.ts', '+    1 | test')],
    } satisfies SubagentRun

    expect(collectCodeFileDiffs([], [subagent])[0].operations[0]).toMatchObject({
      source: 'subagent',
      sourceName: 'TestsScout',
    })
  })

  it('ignores failed, malformed, pathless, and empty-diff turns', () => {
    expect(collectCodeFileDiffs([
      edit('src/a.ts', '+    1 | ignored', { isError: true }),
      edit(42, '+    1 | ignored'),
      { role: 'tool', content: '', name: 'bash', args: {}, diff: '' },
    ], [])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the focused test and confirm red**

Run:

```bash
cd web-app
export PATH="$HOME/.bun/bin:$PATH"
bunx vitest --run src/lib/__tests__/codeDiffs.test.ts
```

Expected: FAIL because `@/lib/codeDiffs` does not exist.

- [ ] **Step 3: Implement the minimal pure projection**

Implement without a parser dependency:

```ts
import type { CodeTurn, SubagentRun } from '@/hooks/useCodeSessions'

export type CodeDiffOperation = {
  diff: string
  source: 'main' | 'subagent'
  sourceName?: string
}

export type CodeFileDiff = {
  path: string
  additions: number
  deletions: number
  operations: CodeDiffOperation[]
}

function addOperation(
  files: Map<string, CodeFileDiff>,
  turn: CodeTurn,
  operation: CodeDiffOperation
) {
  if (turn.isError || !turn.diff || turn.status === 'running') return
  const args = turn.args
  if (!args || typeof args !== 'object') return
  const path = (args as Record<string, unknown>).path
  if (typeof path !== 'string' || !path.trim()) return

  const additions = turn.diff.split('\n').filter((line) => line.startsWith('+ ')).length
  const deletions = turn.diff.split('\n').filter((line) => line.startsWith('- ')).length
  const current = files.get(path)
  if (current) {
    current.additions += additions
    current.deletions += deletions
    current.operations.push(operation)
  } else {
    files.set(path, { path, additions, deletions, operations: [operation] })
  }
}

export function collectCodeFileDiffs(turns: CodeTurn[], subagents: SubagentRun[]) {
  const files = new Map<string, CodeFileDiff>()
  for (const turn of turns) {
    if (turn.diff) addOperation(files, turn, { diff: turn.diff, source: 'main' })
  }
  for (const run of subagents) {
    for (const turn of run.turns) {
      if (turn.diff) addOperation(files, turn, {
        diff: turn.diff,
        source: 'subagent',
        sourceName: run.name,
      })
    }
  }
  return [...files.values()]
}
```

The implementation MAY tighten formatting, but must retain these types and rules. Do not normalize away meaningful relative path text supplied by the tool.

- [ ] **Step 4: Run focused tests and TypeScript build**

```bash
cd web-app
export PATH="$HOME/.bun/bin:$PATH"
bunx vitest --run src/lib/__tests__/codeDiffs.test.ts
bunx tsc -b --noEmit
```

Expected: projection tests pass; TypeScript exits 0.

- [ ] **Step 5: Commit the projection concern**

```bash
git add web-app/src/lib/codeDiffs.ts web-app/src/lib/__tests__/codeDiffs.test.ts
git commit -m "feat(code-ui): project agent diffs by file"
```

---

### Task 2: Extract shared right-panel chrome

**Files:**
- Create: `web-app/src/containers/CodeSidePanel.tsx`
- Modify: `web-app/src/containers/SubagentTasksPanel.tsx:155-276`

**Interfaces:**
- Produces:

```ts
type CodeSidePanelProps = {
  title: React.ReactNode
  leading?: React.ReactNode
  summary?: React.ReactNode
  children: React.ReactNode
  onClose: () => void
}

export function CodeSidePanel(props: CodeSidePanelProps): React.ReactElement
```

- Preserves the existing `SubagentTasksPanel` public props unchanged.

- [ ] **Step 1: Create the shared shell**

Move only shared chrome out of `SubagentTasksPanel`:

```tsx
import { useState, type ReactNode } from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n/react-i18next-compat'

export function CodeSidePanel({
  title,
  leading,
  summary,
  children,
  onClose,
}: {
  title: ReactNode
  leading?: ReactNode
  summary?: ReactNode
  children: ReactNode
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-l bg-main-view',
        expanded ? 'w-[32rem] max-w-[60vw]' : 'w-80'
      )}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        {leading}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        {summary}
        <button type="button" onClick={() => setExpanded((value) => !value)}
          aria-label={expanded ? t('common:collapse') : t('common:expand')}
          title={expanded ? t('common:collapse') : t('common:expand')}
          className="text-main-view-fg/60 hover:text-main-view-fg">
          {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
        <button type="button" onClick={onClose} aria-label={t('common:close')}
          className="text-main-view-fg/60 hover:text-main-view-fg">
          <X size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </aside>
  )
}
```

- [ ] **Step 2: Refactor `SubagentTasksPanel` through the shell**

Remove `expanded`, `Maximize2`, `Minimize2`, `X`, and the duplicated outer/header markup. Keep `selectedRunId`, timer behavior, task sections, detail rendering, and the existing back button. Render:

```tsx
<CodeSidePanel
  title={selected ? selected.name : t('common:backgroundTasks')}
  leading={selected ? (
    <button type="button" onClick={() => setSelectedRunId(null)}
      className="text-main-view-fg/60 hover:text-main-view-fg"
      aria-label={t('common:back')}>
      <ChevronLeft size={18} />
    </button>
  ) : undefined}
  onClose={onClose}
>
  {selected ? (
    <TaskDetail run={selected} />
  ) : (
    <div className="h-full overflow-y-auto p-3">{/* existing list body */}</div>
  )}
</CodeSidePanel>
```

- [ ] **Step 3: Typecheck the extraction**

```bash
cd web-app
export PATH="$HOME/.bun/bin:$PATH"
bunx tsc -b --noEmit
```

Expected: exit 0. No public prop or behavior change to `SubagentTasksPanel`.

- [ ] **Step 4: Commit the panel-shell concern**

```bash
git add web-app/src/containers/CodeSidePanel.tsx web-app/src/containers/SubagentTasksPanel.tsx
git commit -m "refactor(code-ui): share right-panel chrome"
```

---

### Task 3: Add Diff view and top-right panel controls

**Files:**
- Create: `web-app/src/containers/CodeDiffPanel.tsx`
- Modify: `web-app/src/routes/code.tsx:1-45,140-205,260-279,881-1050`
- Modify only if needed for full-height panel rendering: `web-app/src/components/DiffView.tsx:9-25`

**Interfaces:**
- Consumes `CodeFileDiff[]` from `collectCodeFileDiffs` and `CodeSidePanel`.
- Produces:

```ts
export function CodeDiffPanel({
  files,
  folderName,
  gitBranch,
  onClose,
}: {
  files: CodeFileDiff[]
  folderName?: string
  gitBranch: string | null
  onClose: () => void
}): React.ReactElement
```

- [ ] **Step 1: Build the Diff panel body**

Implement one accessible disclosure row per file. Keep the expanded-path set local:

```tsx
const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
const additions = files.reduce((sum, file) => sum + file.additions, 0)
const deletions = files.reduce((sum, file) => sum + file.deletions, 0)
```

Use `CodeSidePanel` with title `Agent changes`; place folder/branch and totals in a compact summary/header region. Each row must be a real button with `aria-expanded`. Expanded content maps `operations` in order and renders:

```tsx
{operation.source === 'subagent' && operation.sourceName ? (
  <p className="px-3 pt-2 text-xs text-muted-foreground">
    {operation.sourceName}
  </p>
) : null}
<DiffView diff={operation.diff} className="max-h-none rounded-none border-0" />
```

The empty state copy must say: `Successful agent write and edit changes will appear here.`

- [ ] **Step 2: Replace boolean panel state with the active-view union**

In `code.tsx`:

```ts
type CodeSidePanelView = 'subagents' | 'diff'
const [activePanel, setActivePanel] = useState<CodeSidePanelView | null>(null)
const togglePanel = (view: CodeSidePanelView) =>
  setActivePanel((current) => (current === view ? null : view))
```

Derive file changes from current committed/live data:

```ts
const codeDiffs = useMemo(
  () => collectCodeFileDiffs(displayedTurns, subagents),
  [displayedTurns, subagents]
)
```

Do not persist `activePanel` and do not add a registry/store.

- [ ] **Step 3: Add the top-right accessible toggles**

Import `Tooltip`, `TooltipContent`, and `TooltipTrigger` from the existing UI primitive and appropriate Lucide icons (`Sparkles` and `FileDiff`). Put both controls at the right edge of `HeaderPage`; active controls use the selected button treatment.

Required behavior:

```tsx
<Button
  variant={activePanel === 'subagents' ? 'secondary' : 'ghost'}
  size="icon-sm"
  onClick={() => togglePanel('subagents')}
  aria-label="Subagents"
>
  <Sparkles size={16} />
</Button>
```

and an equivalent Diff button with `FileDiff`, `aria-label="Diff"`, and `togglePanel('diff')`. Tooltips contain only `Subagents` and `Diff`; no shortcut text.

Remove the old bottom-dock Subagent button (`code.tsx` current lines 976-991) to avoid duplicate controls.

- [ ] **Step 4: Mount exactly one side-panel body**

Replace `tasksPanelOpen && <SubagentTasksPanel ...>` with:

```tsx
{activePanel === 'subagents' ? (
  <SubagentTasksPanel
    subagents={subagents}
    awaitingInputRunIds={awaitingInputRunIds}
    onClose={() => setActivePanel(null)}
    onCancel={handleCancelSubagent}
  />
) : activePanel === 'diff' ? (
  <CodeDiffPanel
    files={codeDiffs}
    folderName={folderName}
    gitBranch={gitBranch}
    onClose={() => setActivePanel(null)}
  />
) : null}
```

- [ ] **Step 5: Run focused automated verification**

```bash
cd web-app
export PATH="$HOME/.bun/bin:$PATH"
bunx vitest --run src/lib/__tests__/codeDiffs.test.ts
bunx tsc -b --noEmit
```

Expected: focused tests pass; TypeScript exits 0.

- [ ] **Step 6: Commit the Diff UI concern**

```bash
git add web-app/src/containers/CodeDiffPanel.tsx web-app/src/routes/code.tsx web-app/src/components/DiffView.tsx
git commit -m "feat(code-ui): add agent diff side panel"
```

---

### Task 4: Live Jan verification and cleanup

**Files:**
- Modify only files implicated by observed regressions.

**Interfaces:**
- Consumes the completed panel behavior from Tasks 1-3.
- Produces verified issue acceptance evidence.

- [ ] **Step 1: Start Jan from the feature worktree**

```bash
cd /Users/thinhlpg/code/jan/.claude/worktrees/fix-code-ui-subagent-events
yarn dev
```

Wait for the llama.cpp router-ready log and the Jan window.

- [ ] **Step 2: Exercise panel switching**

In Code UI, verify:

1. Subagents and Diff buttons are top-right and show text tooltips.
2. Each opens the right panel.
3. Selecting the other swaps the body without rendering two panels.
4. Selecting the active icon or close icon closes the panel.
5. Expand/collapse works in both views.

- [ ] **Step 3: Exercise live and persisted changes**

Run one main-agent edit and one subagent edit on separate files, then verify:

1. both files appear automatically;
2. rows are initially collapsed;
3. addition/deletion operation totals match the focused diff lines;
4. expansion preserves operation order within each source trace;
5. subagent source name is shown;
6. switching sessions and returning preserves committed rows.

- [ ] **Step 4: Regression-check Subagents**

Verify running duration, selected transcript, cancel, needs-input indicator, finished list, and task persistence still work.

- [ ] **Step 5: Run final focused verification**

```bash
cd web-app
export PATH="$HOME/.bun/bin:$PATH"
bunx vitest --run src/lib/__tests__/codeDiffs.test.ts
bunx tsc -b --noEmit
```

Expected: all focused checks pass and TypeScript exits 0.

- [ ] **Step 6: Commit only observed cleanup fixes**

If live verification required a fix, commit it with a scoped `fix(code-ui): ...` message. If no files changed, do not create an empty commit.
