import { describe, it, expect } from 'vitest'
import { mergeHistory } from '@/lib/mergeHistory'

const thread = (id: string, updated: number, metadata: Record<string, unknown> = {}) =>
  ({ id, title: id, updated, metadata }) as unknown as Thread
const cowork = (id: string, updated: number, metadata: Record<string, unknown> = {}) =>
  thread(id, updated, { mode: 'cowork', ...metadata })
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

const project = { id: 'p', name: 'p', updated_at: 1 }

describe('mergeHistory', () => {
  it('lists chat and Cowork threads together, newest first', () => {
    const rows = mergeHistory(
      [thread('chat-old', 1_700_000_000), cowork('cw-mid', 1_700_000_200), thread('chat-new', 1_700_000_300)],
      [],
      {}
    )
    expect(rows.map((r) => r.id)).toEqual(['chat-new', 'cw-mid', 'chat-old'])
    expect(rows.every((r) => r.kind === 'thread')).toBe(true)
  })

  it('renders a persisted Cowork session once, from its mirror thread', () => {
    const rows = mergeHistory(
      [cowork('cw', 1_700_000_200)],
      [session('cw', 1_700_000_200_000)],
      {}
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('thread')
    expect(rows[0].id).toBe('cw')
  })

  it('still renders each id once while the session is running and mirrored', () => {
    const rows = mergeHistory([cowork('cw', 1_700_000_200)], [session('cw', 1_700_000_200_000, 0)], { cw: 'run' })
    expect(rows.map((r) => `${r.kind}:${r.id}`)).toEqual(['thread:cw'])
  })

  it('adds a store-only row for a running first turn that is not persisted yet', () => {
    const rows = mergeHistory([thread('chat', 1_700_000_000)], [session('fresh', 1_700_000_100_000, 0)], { fresh: 'run' })
    expect(rows.map((r) => `${r.kind}:${r.id}`)).toEqual(['session:fresh', 'thread:chat'])
  })

  it('adds a store-only row for committed turns that are not mirrored yet', () => {
    const rows = mergeHistory([], [session('unsynced', 1_700_000_100_000)], {})
    expect(rows.map((r) => `${r.kind}:${r.id}`)).toEqual(['session:unsynced'])
  })

  it('sorts across seconds (threads) and milliseconds (sessions)', () => {
    const rows = mergeHistory(
      [thread('chat-old', 1_700_000_000), thread('chat-new', 1_700_000_300)],
      [session('cw-mid', 1_700_000_200_000)],
      {}
    )
    expect(rows.map((r) => r.id)).toEqual(['chat-new', 'cw-mid', 'chat-old'])
  })

  it('does not list an empty, never-used session', () => {
    expect(mergeHistory([], [session('blank', 3_000_000_000_000, 0)], {})).toEqual([])
  })

  it('lists a cleared session (used, then emptied) that has no mirror yet', () => {
    const rows = mergeHistory([], [session('cleared', 2_000_000_000_000, 0, { cleared: true })], {})
    expect(rows.map((r) => r.id)).toEqual(['cleared'])
  })

  it('keeps an unavailable session visible so a failed load never hides it', () => {
    const rows = mergeHistory([], [session('broken', 1, 0, { unavailable: 'unreadable-sidecar' })], {})
    expect(rows.map((r) => r.id)).toEqual(['broken'])
  })

  it('leaves out threads that belong to an existing project, Cowork or not', () => {
    const rows = mergeHistory(
      [
        thread('in-project', 5, { project }),
        cowork('cw-in-project', 6, { project }),
        thread('plain', 7),
      ],
      [],
      {},
      new Set(['p'])
    )
    expect(rows.map((r) => r.id)).toEqual(['plain'])
  })

  it('lists a thread whose project does not exist, and hides one whose project does', () => {
    const threads = [
      thread('orphan', 5, { project: { id: 'gone' } }),
      cowork('orphan-cw', 6, { project: { id: 'gone' } }),
      thread('homed', 6, { project }),
      thread('plain', 8),
    ]
    expect(mergeHistory(threads, [], {}, new Set(['p'])).map((r) => r.id)).toEqual([
      'plain',
      'orphan-cw',
      'orphan',
    ])
  })

  it('hides every project thread until the project list has loaded', () => {
    const threads = [thread('orphan', 5, { project: { id: 'gone' } }), thread('plain', 7)]
    expect(mergeHistory(threads, [], {}, null).map((r) => r.id)).toEqual(['plain'])
  })

  it('does not list a store-only session twice when its mirror lives under a project', () => {
    const rows = mergeHistory(
      [cowork('cw', 5, { project })],
      [session('cw', 5_000, 1, { project })],
      {},
      new Set(['p'])
    )
    expect(rows).toEqual([])
  })

  describe('a session sharing its id with a chat thread (id-collision placeholder)', () => {
    it('is a separate row, keyed apart from the chat', () => {
      const rows = mergeHistory(
        [thread('same', 1_700_000_000)],
        [session('same', 1_700_000_100_000, 1, { unavailable: 'id-collision' })],
        {}
      )
      expect(rows.map((r) => `${r.kind}:${r.id}`)).toEqual(['session:same', 'thread:same'])
    })

    it('is hidden when the chat it collides with sits under an existing project', () => {
      const rows = mergeHistory(
        [thread('same', 1, { project })],
        [session('same', 1_000, 1, { unavailable: 'id-collision', project })],
        {},
        new Set(['p'])
      )
      expect(rows).toEqual([])
    })
  })

  it('lists a project session whose mirror thread is gone: history is the only way to delete it', () => {
    const rows = mergeHistory(
      [],
      [session('gone', 1_000_000_000_000, 1, { project, unavailable: 'missing-thread' })],
      {},
      new Set(['p'])
    )
    expect(rows.map((r) => r.id)).toEqual(['gone'])
  })
})
