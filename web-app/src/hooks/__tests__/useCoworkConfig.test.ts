import { describe, it, expect, vi, beforeEach } from 'vitest'

// Real zustand persist, fake disk: an in-memory record standing in for the
// Rust settings store behind backendStorage, so the tests verify the flush
// path (key name and payload) up to the storage boundary.
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

import { useCoworkConfig } from '../useCoworkConfig'

describe('useCoworkConfig', () => {
  beforeEach(() => {
    disk.clear()
    useCoworkConfig.setState({ networkEnabled: true })
  })

  // On by default: an agent surface without package installs or curl is
  // crippled for the work it exists to do.
  it('defaults the sandbox network on', () => {
    expect(useCoworkConfig.getState().networkEnabled).toBe(true)
  })

  it('toggles the network switch off and back on', () => {
    useCoworkConfig.getState().setNetworkEnabled(false)
    expect(useCoworkConfig.getState().networkEnabled).toBe(false)
    useCoworkConfig.getState().setNetworkEnabled(true)
    expect(useCoworkConfig.getState().networkEnabled).toBe(true)
  })

  // Pins the on-disk contract: every toggle lands under `setting-cowork` in
  // the backend settings store.
  it('flushes a toggle to the backend store', async () => {
    useCoworkConfig.getState().setNetworkEnabled(false)
    // persist's storage is async; give the write a turn to land.
    await vi.waitFor(() => {
      expect(JSON.parse(disk.get('setting-cowork') ?? '{}').state).toEqual({
        networkEnabled: false,
      })
    })
  })

  // A record already on disk wins over the in-memory default on hydration —
  // which is how a toggle survives an app restart.
  it('hydrates from an existing on-disk record', async () => {
    disk.set(
      'setting-cowork',
      JSON.stringify({ state: { networkEnabled: false }, version: 0 })
    )
    await useCoworkConfig.persist.rehydrate()
    expect(useCoworkConfig.getState().networkEnabled).toBe(false)
  })
})
