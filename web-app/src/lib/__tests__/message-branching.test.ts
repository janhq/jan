import { describe, it, expect } from 'vitest'
import { ContentType, MessageStatus, type ThreadMessage } from '@janhq/core'
import {
  hasBranching,
  getParentId,
  getSiblings,
  getVersionInfo,
  pickActiveChild,
  computeActivePath,
  backfillParentIds,
  makeSibling,
  withActiveChild,
} from '../message-branching'

let clock = 1000
function msg(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  metadata?: Record<string, unknown>
): ThreadMessage {
  const t = ++clock
  return {
    id,
    object: 'thread.message',
    thread_id: 'thr',
    role: role as ThreadMessage['role'],
    content: [{ type: ContentType.Text, text: { value: text, annotations: [] } }],
    status: MessageStatus.Ready,
    created_at: t,
    completed_at: t,
    metadata,
  }
}

const ids = (ms: ThreadMessage[]) => ms.map((m) => m.id)

describe('message-branching', () => {
  it('treats legacy un-branched threads as linear', () => {
    const m = [msg('a', 'user', 'hi'), msg('b', 'assistant', 'yo')]
    expect(hasBranching(m)).toBe(false)
    expect(ids(computeActivePath(m))).toEqual(['a', 'b'])
    expect(getVersionInfo(m, m[0])).toEqual({ index: 1, count: 1 })
  })

  it('backfills parent ids along a linear path, then is idempotent', () => {
    const m = [msg('a', 'user', 'hi'), msg('b', 'assistant', 'yo')]
    const filled = backfillParentIds(m)
    expect(filled).toHaveLength(2)
    expect(getParentId(filled[0])).toBeNull()
    expect(getParentId(filled[1])).toBe('a')
    expect(backfillParentIds(filled)).toEqual([])
  })

  it('makeSibling shares the parent and clears active/error state', () => {
    const u = msg('a', 'user', 'orig', { parentId: null })
    const sib = makeSibling(u, { id: 'a2', createdAt: 5000, text: 'edited' })
    expect(getParentId(sib)).toBeNull()
    expect(sib.id).toBe('a2')
    expect(sib.content[0].text?.value).toBe('edited')
    expect((sib.metadata as Record<string, unknown>).activeChildId).toBeUndefined()
  })

  it('newest sibling is active by default; activeChildId overrides', () => {
    // root user a -> assistant b1 (v1) and b2 (v2, newer)
    const a = msg('a', 'user', 'q', { parentId: null })
    const b1 = msg('b1', 'assistant', 'first', { parentId: 'a' })
    const b2 = msg('b2', 'assistant', 'second', { parentId: 'a' })
    let m = [a, b1, b2]
    expect(pickActiveChild(m, a)?.id).toBe('b2')
    expect(ids(computeActivePath(m))).toEqual(['a', 'b2'])

    // pin a's active child back to b1
    m = [withActiveChild(a, 'b1'), b1, b2]
    expect(pickActiveChild(m, m[0])?.id).toBe('b1')
    expect(ids(computeActivePath(m))).toEqual(['a', 'b1'])
  })

  it('reconstructs a full downstream branch, not just the forked node', () => {
    // a -> b1 -> c1 (branch 1);  a -> b2 -> c2 (branch 2, newer)
    const a = msg('a', 'user', 'q', { parentId: null })
    const b1 = msg('b1', 'assistant', 'a1', { parentId: 'a' })
    const c1 = msg('c1', 'user', 'follow1', { parentId: 'b1' })
    const b2 = msg('b2', 'assistant', 'a2', { parentId: 'a' })
    const c2 = msg('c2', 'user', 'follow2', { parentId: 'b2' })
    const m = [a, b1, c1, b2, c2]
    expect(ids(computeActivePath(m))).toEqual(['a', 'b2', 'c2'])
    expect(ids(computeActivePath([withActiveChild(a, 'b1'), b1, c1, b2, c2]))).toEqual([
      'a',
      'b1',
      'c1',
    ])
  })

  it('reports version index/count among siblings sorted by time', () => {
    const a = msg('a', 'user', 'q', { parentId: null })
    const b1 = msg('b1', 'assistant', 'a1', { parentId: 'a' })
    const b2 = msg('b2', 'assistant', 'a2', { parentId: 'a' })
    const m = [a, b1, b2]
    expect(getSiblings(m, b1).map((x) => x.id)).toEqual(['b1', 'b2'])
    expect(getVersionInfo(m, b1)).toEqual({ index: 1, count: 2 })
    expect(getVersionInfo(m, b2)).toEqual({ index: 2, count: 2 })
  })

  it('selects the active root among sibling roots', () => {
    const a1 = msg('a1', 'user', 'q1', { parentId: null })
    const a2 = msg('a2', 'user', 'q2', { parentId: null })
    const m = [a1, a2]
    expect(ids(computeActivePath(m))).toEqual(['a2'])
    expect(ids(computeActivePath(m, 'a1'))).toEqual(['a1'])
  })
})
