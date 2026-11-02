import { describe, it } from 'vitest'

/**
 * Scoped Chat activation — contract targets (issue #503/#505 activation).
 *
 * These specs pin the coordinator-decided contracts for the activation work
 * that lands after the scoped-dispatch (#9544), runner (#9541) and
 * orchestration (#9542) dependencies merge. They are intentionally `it.todo`
 * until the implementing slice flips each one into a real test: the modules
 * under test are not merged yet, and this branch must not import unmerged
 * source. Security dispositions: qa/issue-503-scoped-dispatch.md (after
 * #9544 merges).
 */

describe('grant-aware approval (decided: normal approval path, no new persisted allow mechanism)', () => {
  it.todo(
    'auto-allows the built-in shell only while the effective grant has shellNetwork=false and no folder write elevation'
  )
  it.todo(
    'routes an elevated-grant shell call through the existing approval request path, exactly once per call'
  )
  it.todo(
    'does not persist any new allow state for elevated shell: a later identical call prompts again unless covered by existing stores'
  )
  it.todo(
    're-reads getConversationCapabilities(threadId) on every dispatch: a revoke between calls denies the next call without schema refresh'
  )
  it.todo('Stop and thread deletion resolve pending elevated-shell approvals as deny')
})

describe('grant-driven advertisement (decided: scratch-safe defaults, folder grant extends scope not advertisement)', () => {
  it.todo(
    'advertises only scoped names with real native schemas (no invented names; ls/find/grep only if builtin_tool_schemas exposes them)'
  )
  it.todo('never advertises screenshot, web tools, monitor, or task as native thread tools')
  it.todo(
    'a folder grant does not change the advertised name set; it extends native containment scope for already-advertised tools'
  )
  it.todo('write/edit advertise scratch-safe; folder writes are refused natively without folderScope.access=write')
  it.todo('memory advertises for reads; mutating ops require memoryWrite (native-gated), skill_write behind memoryWrite')
  it.todo('advertisement recomputes only at turn boundaries; a mid-turn grant change affects dispatch immediately but schemas next turn')
})

describe('task children (decided: same narrowed context, no Session fallback)', () => {
  it.todo('children narrow from the parent Chat frozen advertised record and can never widen it')
  it.todo('children dispatch native names through the same threadId and per-call grant getter, never scope=session or Cowork flags')
  it.todo('child approvals use the same Chat approval stores; no inherited auto-approval from a parent allow-once')
  it.todo('task/ask/todo/monitor/memory are withheld from children')
  it.todo('child completion notices reach the parent only through the existing runTurn inbox')
})
