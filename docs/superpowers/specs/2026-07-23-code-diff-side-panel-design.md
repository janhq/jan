# Code Diff Side Panel Design

**Date:** 2026-07-23
**Target repository:** `janhq/jan`
**Target branch:** `fix/code-ui-subagent-events`

## Goal

Add an extensible right-side panel to Jan Code UI. The first two views are **Subagents** and **Diff**. The Diff view shows changes produced by the main agent and its subagents during the current Code session. The panel boundary must allow later Artifact and Browser views without implementing them now.

Pull-request creation and keyboard shortcuts are explicitly out of scope.

## Existing Behavior

- `CodePage` conditionally mounts `SubagentTasksPanel` as a right-side flex sibling.
- `SubagentTasksPanel` owns its header, fixed/expanded width, close action, task list, and selected-task transcript.
- Jan agent-core emits a focused display diff for each successful built-in `write` or `edit` tool call through `StreamEvent::ToolResult.diff`.
- Each diff is stored with the corresponding `CodeTurn`, including turns inside persisted `SubagentRun` records.
- Jan agent-core has no aggregate Git diff or PR API. `pi-subagents` captures a Git diff only when an isolated worktree ends; it has no interactive diff panel or PR flow.

## Decision

Project existing agent-core diff events into a session-level Diff view. Do not introduce a Git-status backend, mutate the user's index, infer a base branch, or add remote-provider behavior.

The view represents **agent edit operations**, not a net branch/worktree diff. Repeated edits to the same path remain chronological diff blocks under one file. Additions and deletions are operation totals from focused diff lines; they are not presented as net Git totals.

## Panel Architecture

`CodePage` owns one local active-view state:

```ts
type CodeSidePanelView = 'subagents' | 'diff'
const [activePanel, setActivePanel] = useState<CodeSidePanelView | null>(null)
```

Only one right panel is mounted. Clicking the active toggle closes it; clicking the other toggle swaps the body in place.

A shared `CodeSidePanel` shell owns:

- right-side border and background;
- standard and expanded widths;
- shared header layout;
- optional leading/header actions;
- expand/collapse and close controls;
- content overflow boundary.

It does not own view-specific state or register speculative plugins. `SubagentTasksPanel` keeps selected task, timer, task sections, and transcript state. `CodeDiffPanel` keeps expanded-file state. Future views add one union member, one header toggle, and one body rendered through the same shell.

## Header Interaction

The Code page header gains icon-only **Subagents** and **Diff** toggles on its right edge.

- Both use accessible labels and ordinary text tooltips.
- Active view receives the selected button treatment.
- No keyboard shortcuts are shown or registered.
- Subagents may show the existing running/task count.
- Diff may show the number of changed files.
- The old bottom-dock Subagents toggle is removed to avoid duplicate controls.

## Diff Projection

A pure helper receives main-agent turns and subagent runs and returns:

```ts
type CodeFileDiff = {
  path: string
  additions: number
  deletions: number
  operations: Array<{ diff: string; source: 'main' | 'subagent'; name?: string }>
}
```

Projection rules:

1. Read main committed/live turns and committed/live subagent turns already selected by `CodePage`.
2. Keep successful tool turns with a non-empty `diff` and a string `args.path`.
3. Group by normalized displayed path while preserving first-seen file order and chronological operation order.
4. Count lines beginning with `+ ` as additions and `- ` as deletions. Ignore `@@` headers and all other lines.
5. Ignore malformed legacy turns, error turns, and unsupported tools without crashing the panel.
6. Do not deduplicate repeated operations: each is an actual agent-core edit event.

No new persisted store is required. Committed turns already survive restart, and live Zustand state updates the projection while a run is streaming.

## Diff View

The panel header identifies the current folder/branch and shows total operation additions/deletions.

The body contains one collapsed row per changed file:

- file path;
- per-file green addition and red deletion totals;
- disclosure indicator;
- click/keyboard activation.

Expanding a row renders its chronological operation blocks with the existing `DiffView`/shared diff syntax highlighting. A subagent operation identifies its source. Large content scrolls inside the panel; rows remain collapsed until selected.

Empty state: explain that successful agent `write`/`edit` changes will appear here. A session without a selected folder remains usable because projection is session-event based.

## Error Handling

- Malformed or legacy `args` are ignored.
- Missing paths never create ambiguous fake file names.
- Failed tool results are excluded.
- No backend request means there is no loading or transport error state.
- A file edited outside Jan's built-in `write`/`edit` tools is intentionally absent; the UI labels the view as agent changes rather than repository status.

## Verification

Focused unit tests for the pure projection helper cover:

- main-agent write/edit grouping;
- repeated operations on one path;
- addition/deletion counting;
- failed and malformed turns;
- subagent operations and source labels;
- stable first-seen ordering.

Implementation verification:

1. Web app TypeScript build.
2. Existing focused Code UI tests.
3. Launch Jan from the worktree.
4. Confirm top-right toggles open, swap, and close one shared side panel.
5. Run main-agent and subagent edits; confirm live and persisted file rows, counts, expansion, and source labels.
6. Confirm Subagent task list/detail/cancel behavior remains unchanged.

## Non-goals

- Create PR, create draft PR, push, commit, compare URL, or remote-provider handling.
- Git branch-to-base, staged, unstaged, or untracked repository diff.
- Accept/reject or revert controls.
- Artifact or Browser panel implementations.
- Keyboard shortcuts.
- A plugin registry, persistent global right-panel store, or new UI dependency.
