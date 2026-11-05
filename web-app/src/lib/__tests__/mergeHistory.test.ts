import { describe, it, expect } from 'vitest'
import { mergeHistory } from '@/lib/mergeHistory'

const thread = (id: string, updated: number, metadata: Record<string, unknown> = {}) =>
  ({ id, title: id, updated, metadata }) as unknown as Thread
const session = (id: string, updated: number, turns = 1, extra = {}) =>
  ({
    id,
    title: id,
    folder: null,
    turns: Array.from({ length: turns }, () => ({ role: 'user', content: 'x' })),
    messages: [],
    updated,
    ...extra,
  }) as never

describe('mergeHistory', () => {
  it('interleaves chats and Cowork sessions newest first, across seconds and milliseconds', () => {
    const rows = mergeHistory(
      [thread('chat-old', 1_700_000_000), thread('chat-new', 1_700_000_300)],
      [session('cw-mid', 1_700_000_200_000)],
      {}
    )
    expect(rows.map((r) => r.id)).toEqual(['chat-new', 'cw-mid', 'chat-old'])
    expect(rows.map((r) => r.kind)).toEqual(['chat', 'cowork', 'chat'])
  })

  it('leaves out chats that belong to a project and Cowork threads mirrored into the thread list', () => {
    const rows = mergeHistory(
      [
        thread('in-project', 5, { project: { id: 'p' } }),
        thread('cowork-thread', 6, { mode: 'cowork' }),
        thread('plain', 7),
      ],
      [],
      {}
    )
    expect(rows.map((r) => r.id)).toEqual(['plain'])
  })

  it('lists a chat whose project does not exist, and hides one whose project does', () => {
    const threads = [
      thread('orphan', 5, { project: { id: 'gone' } }),
      thread('homed', 6, { project: { id: 'p' } }),
      thread('plain', 7),
    ]
    expect(mergeHistory(threads, [], {}, new Set(['p'])).map((r) => r.id)).toEqual(['plain', 'orphan'])
  })

  it('hides every project chat until the project list has loaded', () => {
    const threads = [thread('orphan', 5, { project: { id: 'gone' } }), thread('plain', 7)]
    expect(mergeHistory(threads, [], {}, null).map((r) => r.id)).toEqual(['plain'])
  })

  it('lists a Cowork session once it has messages, or while its first run is streaming', () => {
    const rows = mergeHistory(
      [],
      [session('empty', 3_000_000_000_000, 0), session('streaming', 2_000_000_000_000, 0), session('used', 1_000_000_000_000)],
      { streaming: {} }
    )
    expect(rows.map((r) => r.id).sort()).toEqual(['streaming', 'used'])
  })

  it('keeps an unavailable session visible so a failed load never hides it', () => {
    const rows = mergeHistory([], [session('broken', 1, 0, { unavailable: 'unreadable-sidecar' })], {})
    expect(rows.map((r) => r.id)).toEqual(['broken'])
  })

  it('lists a Cowork session of an existing project only under that project, but keeps an orphan-project one', () => {
    const proj = (id: string) => ({ project: { id, name: id, updated_at: 1 } })
    const sessions = [
      session('homed', 1_000_000_000_000, 1, proj('p')),
      session('orphan', 2_000_000_000_000, 1, proj('gone')),
      session('plain', 3_000_000_000_000),
    ]
    expect(mergeHistory([], sessions, {}, new Set(['p'])).map((r) => r.id)).toEqual(['plain', 'orphan'])
    // Project list not loaded yet: project rows stay hidden, as chat rows do.
    expect(mergeHistory([], sessions, {}, null).map((r) => r.id)).toEqual(['plain'])
  })

  it('lists a cleared session (used, then emptied) but not a never-used blank placeholder', () => {
    const rows = mergeHistory(
      [],
      [session('cleared', 2_000_000_000_000, 0, { cleared: true }), session('blank', 3_000_000_000_000, 0)],
      {}
    )
    expect(rows.map((r) => r.id)).toEqual(['cleared'])
  })

  it('lists a project session whose mirror thread is gone: history is the only way to delete it', () => {
    const project = { id: 'p', name: 'p', updated_at: 1 }
    const rows = mergeHistory(
      [],
      [session('gone', 1_000_000_000_000, 1, { project, unavailable: 'missing-thread' }), session('ok', 2_000_000_000_000, 1, { project })],
      {},
      new Set(['p'])
    )
    expect(rows.map((r) => r.id)).toEqual(['gone'])
  })

  it.each(['missing-sidecar', 'unreadable-sidecar', 'id-collision'])(
    'does not list a %s project session in history: its mirror thread is still listed under the project',
    (unavailable) => {
      const project = { id: 'p', name: 'p', updated_at: 1 }
      const rows = mergeHistory(
        [],
        [session('s', 1_000_000_000_000, 1, { project, unavailable })],
        {},
        new Set(['p'])
      )
      expect(rows).toEqual([])
    }
  )
})
