import { describe, it } from 'vitest'

/**
 * Scoped Chat security contract targets (`it.todo` entries are not assertions).
 *
 * Native dispatch intersects stored, effective and process-confirmed consent.
 * Revocation applies to the next admitted call, not cancellation of an already
 * running shell; Stop is separate. Chat must not switch to legacy Session IPC
 * for elevation. Elevated legacy Session calls require host-verified Cowork
 * identity; renderer-supplied scope alone is not authority.
 *
 * Screenshot rendering can fetch remote subresources outside the shell jail.
 * Chat excludes screenshot/native web tools; the existing Cowork screenshot
 * renderer risk is not fixed by scoped Chat dispatch.
 *
 * Read-only root validation rejects roots containing/equal to the data folder,
 * but does not exclude every strict descendant selected with explicit consent.
 * Roots are canonicalized per call; atomic protection against a hostile local
 * actor swapping the selected root after consent is outside this boundary.
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

describe('temporary chats (scratch only, never persistent consent)', () => {
  it.todo('a temporary chat keeps direct answers and the scratch-sandbox shell baseline')
  it.todo(
    'no consent control is offered on a temporary chat, even as a pending draft (prepareThreadCreation refuses; scope control renders nothing)'
  )
  it.todo(
    'temporary threads never persist grants: the setter rejects and the getter returns denied defaults'
  )
  it.todo('no elevated grant or durable memory write is reachable from a temporary chat')
})

describe('task children (decided: same narrowed context, no Session fallback)', () => {
  it.todo('children narrow from the parent Chat frozen advertised record and can never widen it')
  it.todo('children dispatch native names through the same threadId and per-call grant getter, never scope=session or Cowork flags')
  it.todo('child approvals use the same Chat approval stores; no inherited auto-approval from a parent allow-once')
  it.todo('task/ask/todo/monitor/memory are withheld from children')
  it.todo('child completion notices reach the parent only through the existing runTurn inbox')
})

describe('thread monitor route integration (after the native thread-monitor subtask ships)', () => {
  it.todo(
    'monitor start passes only threadId/args/onUpdate — never a caller-supplied effective overlay; consent is resolved natively per poll'
  )
  it.todo('monitor pings reach the run only through the existing runTurn inbox lane')
})
