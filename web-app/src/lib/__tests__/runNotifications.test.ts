import { describe, it, expect } from 'vitest'
import {
  kindIsEnabled,
  shouldNotify,
  threadIsOnScreen,
} from '../runNotifications'

const all = {
  enabled: true,
  onFinish: true,
  onError: true,
  onApproval: true,
  onCancel: false,
}

describe('kindIsEnabled', () => {
  it('skips user cancellations unless opted in', () => {
    expect(kindIsEnabled(all, 'cancel')).toBe(false)
    expect(kindIsEnabled({ ...all, onCancel: true }, 'cancel')).toBe(true)
  })

  it('is off for every kind when the master switch is off', () => {
    const off = { ...all, enabled: false }
    expect(kindIsEnabled(off, 'finish')).toBe(false)
    expect(kindIsEnabled(off, 'approval')).toBe(false)
  })

  it('honours each per-event toggle', () => {
    expect(kindIsEnabled({ ...all, onError: false }, 'error')).toBe(false)
    expect(kindIsEnabled({ ...all, onError: false }, 'finish')).toBe(true)
  })
})

describe('threadIsOnScreen', () => {
  it('needs both focus and the matching thread route', () => {
    expect(threadIsOnScreen('t1', true, '/threads/t1')).toBe(true)
    expect(threadIsOnScreen('t1', false, '/threads/t1')).toBe(false)
    expect(threadIsOnScreen('t1', true, '/threads/t2')).toBe(false)
    expect(threadIsOnScreen('t1', true, '/settings')).toBe(false)
  })
})

describe('shouldNotify', () => {
  const input = { kind: 'finish', threadId: 't1', eventId: 'm1' } as const
  it('stays quiet while the conversation is visible', () => {
    expect(shouldNotify(all, input, true)).toBe(false)
    expect(shouldNotify(all, input, false)).toBe(true)
  })
})
