import { describe, it, expect, vi, beforeEach } from 'vitest'

// Real zustand persist, fake disk, as in useCoworkConfig.test.ts.
const disk = vi.hoisted(() => new Map<string, string>())
vi.mock('@/lib/backendStorage', () => ({
  backendStorage: {
    getItem: async (name: string) => disk.get(name) ?? null,
    setItem: async (name: string, value: string) => {
      disk.set(name, value)
    },
    removeItem: async (name: string) => {
      disk.delete(name)
    },
  },
}))

import { useChatShell } from '../useChatShell'

describe('useChatShell', () => {
  beforeEach(() => {
    disk.clear()
    useChatShell.setState({ shellEnabled: true })
  })

  // Existing users must keep the shell they have today until they say no.
  it('is on by default', () => {
    expect(useChatShell.getState().shellEnabled).toBe(true)
  })

  it('flushes an off switch to the backend store', async () => {
    useChatShell.getState().setShellEnabled(false)
    await vi.waitFor(() => {
      expect(JSON.parse(disk.get('setting-chat-shell') ?? '{}').state).toEqual({
        shellEnabled: false,
      })
    })
  })

  // A record already on disk wins over the default: how an off switch survives
  // an app restart.
  it('hydrates an off switch from disk', async () => {
    disk.set(
      'setting-chat-shell',
      JSON.stringify({ state: { shellEnabled: false }, version: 0 })
    )
    await useChatShell.persist.rehydrate()
    expect(useChatShell.getState().shellEnabled).toBe(false)
  })
})
