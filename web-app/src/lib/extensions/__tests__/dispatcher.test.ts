import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { HOST_METHODS, type HostMethod } from '@janhq/extension-runtime'
import type { PermissionString } from '@janhq/extension-api'
import { ContributionStore } from '../contributions'
import { METHOD_POLICY, PermissionDispatcher } from '../dispatcher'
import { createHostApi, type HostApiDeps } from '../host-api'
import { ExtensionSettingsStore } from '../settings-store'
import { manifest } from './fixtures'
import { memoryAppSettings, memorySecrets } from './memory'

describe('PermissionDispatcher grants', () => {
  it('grants exactly what was granted, per extension', () => {
    const d = new PermissionDispatcher()
    d.grant('acme.one', ['ui:notify'])
    expect(d.has('acme.one', 'ui:notify')).toBe(true)
    expect(d.has('acme.one', 'tools')).toBe(false)
    expect(d.has('acme.two', 'ui:notify')).toBe(false)
    expect(() => d.check('acme.one', 'ui:notify')).not.toThrow()
    expect(() => d.check('acme.one', 'tools')).toThrowError(
      expect.objectContaining({ code: 'E_PERMISSION' })
    )
  })

  it('matches network permissions by host, wildcards included', () => {
    const d = new PermissionDispatcher()
    d.grant('acme.one', ['network:api.acme.dev', 'network:*.cdn.dev'])
    expect(d.has('acme.one', 'network:api.acme.dev')).toBe(true)
    expect(d.has('acme.one', 'network:img.cdn.dev')).toBe(true)
    expect(d.has('acme.one', 'network:cdn.dev')).toBe(false)
    expect(d.has('acme.one', 'network:acme.dev')).toBe(false)
  })

  it('forgets an extension on revokeAll', () => {
    const d = new PermissionDispatcher()
    d.grant('acme.one', ['tools'])
    d.revokeAll('acme.one')
    expect(d.has('acme.one', 'tools')).toBe(false)
  })
})

describe('METHOD_POLICY', () => {
  it('covers every host method, and nothing else', () => {
    expectTypeOf<keyof typeof METHOD_POLICY>().toEqualTypeOf<HostMethod>()
    expect(Object.keys(METHOD_POLICY).sort()).toEqual([...HOST_METHODS].sort())
  })
})

const permission = expect.objectContaining({ code: 'E_PERMISSION' })
const invalid = expect.objectContaining({ code: 'E_INVALID_ARGS' })

function setup(permissions: PermissionString[], deps: Partial<HostApiDeps> = {}) {
  const m = manifest('acme.one', {
    permissions,
    contributes: {
      commands: [{ id: 'hello', title: 'Hello' }],
      ...(permissions.includes('tools')
        ? {
            tools: [
              {
                name: 'echo',
                description: 'Echo',
                inputSchema: { type: 'object' as const },
              },
            ],
          }
        : {}),
    },
  })
  const dispatcher = new PermissionDispatcher()
  dispatcher.grant(m.id, m.permissions)
  const contributions = new ContributionStore()
  contributions.registerExtension(m)
  const settings = new ExtensionSettingsStore({
    appSettings: memoryAppSettings(),
    secrets: memorySecrets(),
  })
  settings.register(m)
  const fetch = vi.fn(async () => new Response('ok', { status: 200 }))
  const api = createHostApi(m, {
    dispatcher,
    contributions,
    settings,
    storage: memoryAppSettings(),
    notify: vi.fn(),
    fetch,
    ...deps,
  })
  const call = (method: HostMethod, args: unknown[]) =>
    dispatcher.dispatch(m, api, method, args)
  return { call, fetch, contributions }
}

describe('PermissionDispatcher.dispatch', () => {
  it('denies a gated method without its grant', () => {
    const { call } = setup([])
    expect(() => call('tools.register', ['echo', () => undefined])).toThrowError(permission)
    expect(() => call('ui.notify', [{ level: 'info', message: 'hi' }])).toThrowError(permission)
    expect(() =>
      call('events.subscribe', ['conversations.didCreateMessage', () => undefined])
    ).toThrowError(permission)
  })

  it('lets implicit methods through without any grant', async () => {
    const { call } = setup([])
    await expect(call('storage.set', ['k', { a: [1, null] }])).resolves.toBeUndefined()
    await expect(call('storage.get', ['k'])).resolves.toEqual({ a: [1, null] })
    expect(() =>
      call('events.subscribe', ['settings.didChange', () => undefined])
    ).not.toThrow()
  })

  it('needs commands:execute only for a command the extension does not declare', async () => {
    const denied = setup([])
    await expect(
      Promise.resolve().then(() => denied.call('commands.execute', ['other']))
    ).rejects.toEqual(permission)
    // Its own declared command needs nothing (it has no handler yet).
    await expect(
      Promise.resolve().then(() => denied.call('commands.execute', ['hello']))
    ).rejects.toMatchObject({ code: 'E_NOT_FOUND' })
  })

  it('matches *.example.com and rejects plain http for remote hosts', async () => {
    const { call, fetch } = setup(['network:*.example.com', 'network:127.0.0.1'])
    await expect(
      call('http.fetch', ['https://api.example.com/v1'])
    ).resolves.toMatchObject({ status: 200, body: 'ok' })
    await expect(
      call('http.fetch', ['http://127.0.0.1:11999/v1/models'])
    ).resolves.toMatchObject({ status: 200 })
    expect(() => call('http.fetch', ['https://example.com/'])).toThrowError(permission)
    expect(() => call('http.fetch', ['http://api.example.com/'])).toThrowError(permission)
    expect(() => call('http.fetch', ['https://evil.dev/'])).toThrowError(permission)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('rejects invalid arguments before checking anything else', () => {
    const { call } = setup(['tools', 'ui:notify'])
    expect(() => call('tools.register', ['echo', 'not a function'])).toThrowError(invalid)
    expect(() => call('tools.register', ['echo'])).toThrowError(invalid)
    expect(() => call('ui.notify', [{ level: 'loud', message: 'x' }])).toThrowError(invalid)
    expect(() => call('ui.notify', [{ level: 'info', message: 'x', html: '<b>' }])).toThrowError(invalid)
    expect(() => call('settings.set', ['k', { nested: true }])).toThrowError(invalid)
    expect(() => call('storage.set', ['k', undefined])).toThrowError(invalid)
    expect(() => call('storage.keys', ['extra'])).toThrowError(invalid)
    expect(() => call('http.fetch', ['not a url'])).toThrowError(invalid)
    expect(() =>
      call('http.fetch', ['https://x.dev', { method: 'TRACE' }])
    ).toThrowError(invalid)
    expect(() => call('events.subscribe', ['unknown.event', () => undefined])).toThrowError(invalid)
    expect(() =>
      call('conversations.listMessages', ['t1', { limit: -1 }])
    ).toThrowError(invalid)
  })

  it('binds a registration only to a declared contribution', () => {
    const { call, contributions } = setup(['tools'])
    const handler = vi.fn()
    const registration = call('tools.register', ['echo', handler]) as {
      dispose(): void
    }
    expect(contributions.getState().tools['acme.one'].echo.handler).toBe(handler)
    registration.dispose()
    expect(contributions.getState().tools['acme.one'].echo.handler).toBeUndefined()
    expect(() => call('tools.register', ['undeclared', handler])).toThrowError(
      expect.objectContaining({ code: 'E_NOT_FOUND' })
    )
  })
})
