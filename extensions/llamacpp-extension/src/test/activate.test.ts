import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { InternalExtensionContext } from '@janhq/core'
import { ServiceKeys } from '@janhq/core'
import llamacpp_extension, { activate } from '../index'

vi.mock('../backend-settings')

type Disposable = { dispose(): void }

function fakeContext() {
  const disposables: Disposable[] = []
  const provided = new Map<string, unknown>()
  const unregister = vi.fn()
  const engines = { register: vi.fn().mockReturnValue({ dispose: unregister }) }
  const services = {
    get: vi.fn((key: { id: string }) => provided.get(key.id)),
    provide: vi.fn((key: { id: string }, impl: unknown) => {
      provided.set(key.id, impl)
      return { dispose: () => provided.delete(key.id) }
    }),
  }
  const ctx = {
    subscriptions: {
      add: <T extends Disposable>(d: T) => (disposables.push(d), d),
    },
    internal: { services, engines },
  } as unknown as InternalExtensionContext
  const deactivate = () => disposables.splice(0).reverse().forEach((d) => d.dispose())
  return { ctx, engines, unregister, provided, deactivate }
}

describe('activate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // The engine's own startup is covered elsewhere; here only the wiring.
    vi.spyOn(llamacpp_extension.prototype, 'start').mockResolvedValue(undefined)
  })

  it('registers the engine with the engine manager and starts it', async () => {
    const fake = fakeContext()
    await activate(fake.ctx)
    expect(fake.engines.register).toHaveBeenCalledTimes(1)
    const engine = fake.engines.register.mock.calls[0][0]
    expect(engine).toBeInstanceOf(llamacpp_extension)
    expect(engine.provider).toBe('llamacpp')
    expect(llamacpp_extension.prototype.start).toHaveBeenCalled()
  })

  it('provides the llamacpp service backed by the registered engine', async () => {
    const fake = fakeContext()
    await activate(fake.ctx)
    const engine = fake.engines.register.mock.calls[0][0] as llamacpp_extension
    const props = { nCtx: 4096 }
    vi.spyOn(engine, 'getModelProps').mockResolvedValue(props)
    vi.spyOn(engine, 'unload').mockResolvedValue({ success: true })
    vi.spyOn(engine, 'getDevices').mockResolvedValue([])
    vi.spyOn(engine, 'reconcileEngineDevices').mockResolvedValue('busy')

    const service = fake.provided.get(ServiceKeys.Llamacpp.id) as {
      getModelProps(id: string): Promise<unknown>
      unload(id: string): Promise<unknown>
      getDevices(): Promise<unknown>
      reconcileEngineDevices(): Promise<unknown>
    }
    await expect(service.getModelProps('m')).resolves.toBe(props)
    expect(engine.getModelProps).toHaveBeenCalledWith('m')
    await expect(service.unload('m')).resolves.toEqual({ success: true })
    await expect(service.getDevices()).resolves.toEqual([])
    await expect(service.reconcileEngineDevices()).resolves.toBe('busy')
  })

  it('reaches the Downloads service through the host registry', async () => {
    const fake = fakeContext()
    const downloads = { pauseDownload: vi.fn().mockResolvedValue(undefined) }
    fake.provided.set(ServiceKeys.Downloads.id, downloads)
    await activate(fake.ctx)
    const engine = fake.engines.register.mock.calls[0][0] as llamacpp_extension
    await engine.pauseImport('m1')
    expect(downloads.pauseDownload).toHaveBeenCalledWith('llamacpp/m1')
  })

  it('unregisters the engine and withdraws the service on deactivation', async () => {
    const fake = fakeContext()
    await activate(fake.ctx)
    const engine = fake.engines.register.mock.calls[0][0] as llamacpp_extension
    const dispose = vi.spyOn(engine, 'dispose')
    fake.deactivate()
    expect(fake.unregister).toHaveBeenCalled()
    expect(dispose).toHaveBeenCalled()
    expect(fake.provided.has(ServiceKeys.Llamacpp.id)).toBe(false)
  })
})

describe('activate when startup fails', () => {
  it('logs the failure and keeps the engine registered', async () => {
    vi.spyOn(llamacpp_extension.prototype, 'start').mockRejectedValue(new Error('boom'))
    const error = vi.fn()
    const disposables: { dispose(): void }[] = []
    const register = vi.fn().mockReturnValue({ dispose: vi.fn() })
    const ctx = {
      subscriptions: { add: <T extends { dispose(): void }>(d: T) => (disposables.push(d), d) },
      log: { error },
      internal: {
        engines: { register },
        services: { get: vi.fn(), provide: vi.fn().mockReturnValue({ dispose: vi.fn() }) },
      },
    } as unknown as InternalExtensionContext
    await expect(activate(ctx)).resolves.toBeUndefined()
    expect(register).toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('Engine startup failed:', expect.any(Error))
  })
})
