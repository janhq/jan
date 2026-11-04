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
})
