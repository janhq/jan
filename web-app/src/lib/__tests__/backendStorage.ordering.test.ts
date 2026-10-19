import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/lib/platform/utils', () => ({ isPlatformTauri: () => true }))
vi.mock('@/hooks/useServiceHub', () => ({ getServiceHub: () => ({ core: () => ({ invoke: h.invoke }) }) }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('backend settings operation ordering', () => {
  beforeEach(() => { vi.resetModules(); h.invoke.mockReset() })

  it('persists the final A in an A -> B -> A change while B is saving', async () => {
    const { backendStorage } = await import('../backendStorage')
    const savingB = deferred<void>()
    let disk = 'A'
    h.invoke.mockImplementation(async (command: string, args: { value: string }) => {
      if (command === 'settings_get') return disk
      if (args.value === 'B') await savingB.promise
      disk = args.value
    })
    await backendStorage.getItem('theme')
    const b = backendStorage.setItem('theme', 'B')
    const a = backendStorage.setItem('theme', 'A')
    savingB.resolve()
    await Promise.all([a, b])
    expect(disk).toBe('A')
  })

  it('dispatches same-key writes in order and keeps other keys independent', async () => {
    const { backendStorage } = await import('../backendStorage')
    const first = deferred<void>()
    h.invoke.mockImplementation((_command: string, args: { value: string }) => args.value === 'first' ? first.promise : Promise.resolve())
    const a = backendStorage.setItem('one', 'first')
    const b = backendStorage.setItem('one', 'second')
    await backendStorage.setItem('two', 'independent')
    expect(h.invoke.mock.calls.map(([, args]) => args.value)).toEqual(['first', 'independent'])
    first.resolve()
    await Promise.all([a, b])
    expect(h.invoke.mock.calls.map(([, args]) => args.value)).toEqual(['first', 'independent', 'second'])
  })

  it('does not let a pending save restore a removed key', async () => {
    const { backendStorage } = await import('../backendStorage')
    const saving = deferred<void>()
    let disk: string | null = null
    h.invoke.mockImplementation(async (command: string) => {
      if (command === 'settings_set') { await saving.promise; disk = 'value' }
      if (command === 'settings_remove') disk = null
    })
    const set = backendStorage.setItem('key', 'value')
    const remove = backendStorage.removeItem('key')
    saving.resolve()
    await Promise.all([set, remove])
    expect(disk).toBeNull()
  })

  it('reads after prior writes have settled', async () => {
    const { backendStorage } = await import('../backendStorage')
    const saving = deferred<void>()
    let disk = 'old'
    h.invoke.mockImplementation(async (command: string) => {
      if (command === 'settings_get') return disk
      await saving.promise
      disk = 'new'
    })
    const set = backendStorage.setItem('key', 'new')
    const read = backendStorage.getItem('key')
    saving.resolve()
    await set
    expect(await read).toBe('new')
  })

  it('invalidates cached values when a read confirms the key is missing', async () => {
    const { backendStorage } = await import('../backendStorage')
    h.invoke.mockResolvedValue(undefined)
    await backendStorage.setItem('key', 'value')
    h.invoke.mockResolvedValueOnce(null)
    expect(await backendStorage.getItem('key')).toBeNull()
    await backendStorage.setItem('key', 'value')
    expect(h.invoke.mock.calls.filter(([command]) => command === 'settings_set')).toHaveLength(2)
  })

  it('continues queued writes after an earlier save fails', async () => {
    const { backendStorage } = await import('../backendStorage')
    const saving = deferred<void>()
    h.invoke.mockReturnValueOnce(saving.promise).mockResolvedValue(undefined)
    const a = backendStorage.setItem('key', 'value')
    const retry = backendStorage.setItem('key', 'value')
    saving.reject(new Error('simulated disk error'))
    await Promise.all([a, retry])
    expect(h.invoke).toHaveBeenCalledTimes(2)
  })
})
