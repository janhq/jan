import { beforeEach, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { createJSONStorage, persist } from 'zustand/middleware'

const h = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/lib/platform/utils', () => ({ isPlatformTauri: () => true }))
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ core: () => ({ invoke: h.invoke }) }),
}))

beforeEach(() => { vi.resetModules(); h.invoke.mockReset() })

it('does not overwrite saved preferences after a failed Zustand hydration', async () => {
  const { backendStorage } = await import('../backendStorage')
  let disk = JSON.stringify({ state: { preference: 'USER', toggle: true }, version: 0 })
  h.invoke.mockImplementation(async (command: string, args: { value: string }) => {
    if (command === 'settings_get') throw new Error('IPC unavailable')
    if (command === 'settings_set') disk = args.value
  })
  const store = createStore(persist(() => ({ preference: 'DEFAULT', toggle: true }), {
    name: 'settings-read-failure', storage: createJSONStorage(() => backendStorage), skipHydration: true,
  }))
  await store.persist.rehydrate()
  store.setState({ toggle: false })
  await Promise.resolve()
  expect(store.persist.hasHydrated()).toBe(false)
  expect(JSON.parse(disk).state.preference).toBe('USER')
  expect(h.invoke.mock.calls.filter(([command]) => command === 'settings_set')).toHaveLength(0)
})

it('blocks writes and removals while reading and after failure, then allows recovery', async () => {
  const { backendStorage } = await import('../backendStorage')
  let reject!: (reason: Error) => void
  h.invoke.mockReturnValueOnce(new Promise((_, no) => { reject = no }))
  const reading = backendStorage.getItem('protected')
  const failed = expect(reading).rejects.toThrow('locked')
  await backendStorage.setItem('protected', 'defaults')
  await backendStorage.removeItem('protected')
  reject(new Error('locked'))
  await failed
  await backendStorage.setItem('protected', 'defaults')
  expect(h.invoke).toHaveBeenCalledTimes(1)
  h.invoke.mockResolvedValueOnce(null)
  expect(await backendStorage.getItem('protected')).toBeNull()
  await backendStorage.setItem('protected', 'recovered')
  expect(h.invoke).toHaveBeenLastCalledWith('settings_set', { key: 'protected', value: 'recovered' })
})

it('does not let an older successful read unlock a newer failed read', async () => {
  const { backendStorage } = await import('../backendStorage')
  let resolve!: (value: string) => void
  h.invoke.mockReturnValueOnce(new Promise<string>(yes => { resolve = yes }))
  const old = backendStorage.getItem('race')
  const superseded = expect(old).rejects.toThrow()
  h.invoke.mockRejectedValueOnce(new Error('new read failed'))
  await expect(backendStorage.getItem('race')).rejects.toThrow('new read failed')
  resolve('old saved value')
  await superseded
  await backendStorage.setItem('race', 'defaults')
  expect(h.invoke.mock.calls.filter(([command]) => command === 'settings_set')).toHaveLength(0)
})

it('does not let an older failed read block a newer successful read', async () => {
  const { backendStorage } = await import('../backendStorage')
  let reject!: (error: Error) => void
  h.invoke.mockReturnValueOnce(new Promise((_, no) => { reject = no }))
  const old = backendStorage.getItem('race')
  const failed = expect(old).rejects.toThrow('old failure')
  h.invoke.mockResolvedValueOnce('saved')
  expect(await backendStorage.getItem('race')).toBe('saved')
  reject(new Error('old failure'))
  await failed
  await backendStorage.setItem('race', 'new value')
  expect(h.invoke).toHaveBeenLastCalledWith('settings_set', { key: 'race', value: 'new value' })
})

it('rehydrates saved state on retry before allowing subsequent changes', async () => {
  const { backendStorage } = await import('../backendStorage')
  let disk = JSON.stringify({ state: { preference: 'USER', toggle: true }, version: 0 })
  h.invoke.mockImplementation(async (command: string, args: { value: string }) => {
    if (command === 'settings_get') return disk
    if (command === 'settings_set') disk = args.value
  })
  h.invoke.mockRejectedValueOnce(new Error('transient'))
  const store = createStore(persist(() => ({ preference: 'DEFAULT', toggle: true }), {
    name: 'settings-recovery', storage: createJSONStorage(() => backendStorage), skipHydration: true,
  }))
  await store.persist.rehydrate()
  store.setState({ toggle: false })
  await Promise.resolve()
  await store.persist.rehydrate()
  expect(store.persist.hasHydrated()).toBe(true)
  expect(store.getState().preference).toBe('USER')
  store.setState({ toggle: false })
  await Promise.resolve()
  expect(JSON.parse(disk).state).toEqual({ preference: 'USER', toggle: false })
})
