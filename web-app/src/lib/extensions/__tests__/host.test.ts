import { describe, expect, it, vi } from 'vitest'
import type { ExtensionContext, ExtensionModule } from '@janhq/extension-api'
import { ServiceKey, type InternalExtensionContext } from '@janhq/core'
import { ExtensionHost } from '../host'
import { builtin, manifest } from './fixtures'
import { memoryAppSettings, memorySecrets } from './memory'

const newHost = () =>
  new ExtensionHost({
    appSettings: memoryAppSettings(),
    secrets: memorySecrets(),
    notify: vi.fn(),
  })

const recorder = (order: string[], id: string): ExtensionModule => ({
  activate: () => {
    order.push(id)
  },
})

const states = (host: ExtensionHost) =>
  Object.fromEntries(host.list().map((e) => [e.id, e.state]))

describe('ExtensionHost', () => {
  it('accepts an empty built-in list', async () => {
    const host = newHost()
    await host.activateBuiltins([])
    expect(host.list()).toEqual([])
    await host.deactivateAll()
  })

  it('activates dependencies before their dependents', async () => {
    const order: string[] = []
    const host = newHost()
    await host.activateBuiltins([
      builtin(manifest('jan.rag'), recorder(order, 'jan.rag'), {
        dependsOn: ['jan.vector-db'],
      }),
      builtin(manifest('jan.vector-db'), recorder(order, 'jan.vector-db')),
      builtin(manifest('jan.other'), recorder(order, 'jan.other')),
    ])
    expect(order).toEqual(['jan.vector-db', 'jan.rag', 'jan.other'])
  })

  it('isolates a failing activate and fails its dependents', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const order: string[] = []
    const host = newHost()
    await expect(
      host.activateBuiltins([
        builtin(manifest('jan.broken'), {
          activate: () => {
            throw new Error('boom')
          },
        }),
        builtin(
          manifest('jan.needs-broken'),
          recorder(order, 'jan.needs-broken'),
          { dependsOn: ['jan.broken'] }
        ),
        builtin(
          manifest('jan.missing-dep'),
          recorder(order, 'jan.missing-dep'),
          { dependsOn: ['jan.nope'] }
        ),
        builtin(manifest('jan.fine'), recorder(order, 'jan.fine')),
      ])
    ).resolves.toBeUndefined()
    expect(order).toEqual(['jan.fine'])
    expect(states(host)).toEqual({
      'jan.broken': 'failed',
      'jan.needs-broken': 'failed',
      'jan.missing-dep': 'failed',
      'jan.fine': 'active',
    })
    expect(host.list().find((e) => e.id === 'jan.broken')?.error).toBe('boom')
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('fails a dependency cycle instead of hanging', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const host = newHost()
    await host.activateBuiltins([
      builtin(
        manifest('jan.a'),
        { activate: () => {} },
        { dependsOn: ['jan.b'] }
      ),
      builtin(
        manifest('jan.b'),
        { activate: () => {} },
        { dependsOn: ['jan.a'] }
      ),
    ])
    expect(states(host)).toEqual({ 'jan.a': 'failed', 'jan.b': 'failed' })
    error.mockRestore()
  })

  it('fails a built-in whose apiVersion this host does not satisfy, or whose module fails to load', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const activate = vi.fn()
    const host = newHost()
    await host.activateBuiltin(
      builtin(manifest('jan.future', { apiVersion: '^9.0.0' }), { activate })
    )
    await host.activateBuiltin({
      manifest: manifest('jan.unloadable'),
      load: () => Promise.reject(new Error('chunk failed')),
    })
    expect(activate).not.toHaveBeenCalled()
    expect(states(host)).toEqual({
      'jan.future': 'failed',
      'jan.unloadable': 'failed',
    })
    error.mockRestore()
  })

  it('gives built-ins an internal context that reaches the service registry', async () => {
    const key = new ServiceKey<{ ping(): string }>('ping')
    const host = newHost()
    await host.activateBuiltin(
      builtin(manifest('jan.pinger'), {
        activate: (ctx: ExtensionContext) => {
          const internal = ctx as InternalExtensionContext
          ctx.subscriptions.add(
            internal.internal.services.provide(key, { ping: () => 'pong' })
          )
        },
      })
    )
    expect(host.services.get(key)?.ping()).toBe('pong')
    await host.deactivateAll()
    expect(host.services.get(key)).toBeUndefined()
  })

  it('lets built-ins read host keyring secrets through the internal context', async () => {
    const secrets = memorySecrets()
    secrets.data.set('huggingface', 'hf_abc')
    const host = new ExtensionHost({
      appSettings: memoryAppSettings(),
      secrets,
      notify: vi.fn(),
    })
    const seen: (string | null)[] = []
    await host.activateBuiltin(
      builtin(manifest('jan.reader'), {
        activate: async (ctx: ExtensionContext) => {
          const { internal } = ctx as InternalExtensionContext
          seen.push(await internal.secrets.get('huggingface'))
          seen.push(await internal.secrets.get('absent'))
        },
      })
    )
    expect(seen).toEqual(['hf_abc', null])
  })

  it('grants a built-in exactly the permissions its manifest requests', async () => {
    const host = newHost()
    await host.activateBuiltin(
      builtin(manifest('jan.notifier', { permissions: ['ui:notify'] }), {
        activate: () => {},
      })
    )
    expect(host.dispatcher.has('jan.notifier', 'ui:notify')).toBe(true)
    expect(host.dispatcher.has('jan.notifier', 'tools')).toBe(false)
  })

  it('deactivates in reverse order, disposing subscriptions and contributions', async () => {
    const order: string[] = []
    const disposed = vi.fn()
    const host = newHost()
    const withCommand = manifest('jan.second', {
      contributes: { commands: [{ id: 'go', title: 'Go' }] },
    })
    await host.activateBuiltins([
      builtin(manifest('jan.first'), {
        activate: () => {},
        deactivate: () => void order.push('jan.first'),
      }),
      builtin(withCommand, {
        activate: (ctx) => {
          ctx.subscriptions.add({ dispose: disposed })
        },
        deactivate: () => void order.push('jan.second'),
      }),
    ])
    expect(host.contributions.getState().commands['jan.second']).toBeDefined()

    await host.deactivateAll()
    expect(order).toEqual(['jan.second', 'jan.first'])
    expect(disposed).toHaveBeenCalledTimes(1)
    expect(host.contributions.getState().commands['jan.second']).toBeUndefined()
    expect(states(host)).toEqual({
      'jan.first': 'inactive',
      'jan.second': 'inactive',
    })
  })

  it('keeps tearing down when a deactivate throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const disposed = vi.fn()
    const host = newHost()
    await host.activateBuiltin(
      builtin(manifest('jan.bad-exit'), {
        activate: (ctx) => void ctx.subscriptions.add({ dispose: disposed }),
        deactivate: () => {
          throw new Error('nope')
        },
      })
    )
    await host.deactivateAll()
    expect(disposed).toHaveBeenCalledTimes(1)
    expect(states(host)).toEqual({ 'jan.bad-exit': 'inactive' })
    error.mockRestore()
  })

  it('ignores a second activation of an active built-in and reactivates after deactivateAll', async () => {
    const activate = vi.fn()
    const host = newHost()
    const def = builtin(manifest('jan.once'), { activate })
    // Not awaited in between: React StrictMode mounts, unmounts and mounts again.
    const runs = [
      host.activateBuiltins([def]),
      host.activateBuiltins([def]),
      host.deactivateAll(),
      host.activateBuiltins([def]),
    ]
    await Promise.all(runs)
    expect(activate).toHaveBeenCalledTimes(2)
    expect(states(host)).toEqual({ 'jan.once': 'active' })
  })

  it('notifies listeners when the list changes', async () => {
    const host = newHost()
    const listener = vi.fn()
    host.onDidChange(listener)
    await host.activateBuiltin(
      builtin(manifest('jan.x'), { activate: () => {} })
    )
    expect(listener).toHaveBeenCalled()
  })
})
