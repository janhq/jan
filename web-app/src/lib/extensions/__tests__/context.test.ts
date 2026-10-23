import { describe, expect, it, vi } from 'vitest'
import type {
  ConversationsApi,
  HttpApi,
  PermissionString,
} from '@janhq/extension-api'
import { Emitter } from '@janhq/extension-api'
import { ContributionStore } from '../contributions'
import { createContext, type ContextDeps } from '../context'
import { PermissionDispatcher } from '../dispatcher'
import { ExtensionSettingsStore } from '../settings-store'
import { manifest } from './fixtures'
import { memoryAppSettings, memorySecrets } from './memory'

const conversationsBackend = (): ConversationsApi => ({
  listThreads: vi
    .fn()
    .mockResolvedValue([{ id: 't1', title: 'One', updatedAt: 1 }]),
  getThread: vi.fn().mockResolvedValue(undefined),
  listMessages: vi.fn().mockResolvedValue([]),
  createThread: vi
    .fn()
    .mockResolvedValue({ id: 't2', title: 'New', updatedAt: 2, createdAt: 2 }),
  appendMessage: vi.fn(),
  onDidCreateMessage: new Emitter<never>().event,
  onDidDeleteThread: new Emitter<never>().event,
})

const permission = expect.objectContaining({ code: 'E_PERMISSION' })

function setup(
  permissions: PermissionString[],
  overrides: Partial<ContextDeps> = {}
) {
  const m = manifest('acme.one', {
    permissions,
    contributes: {
      commands: [{ id: 'hello', title: 'Hello' }],
      statusItems: [{ id: 'status', text: 'idle' }],
      settings: [
        {
          key: 'greeting',
          title: 'Greeting',
          control: { type: 'input', default: 'Hello' },
        },
      ],
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
  const deps: ContextDeps = {
    dispatcher,
    contributions,
    settings,
    storage: memoryAppSettings(),
    notify: vi.fn(),
    ...overrides,
  }
  return { ctx: createContext(m, deps), deps, contributions }
}

describe('createContext', () => {
  it('describes the extension', () => {
    const { ctx } = setup([])
    expect(ctx.extension).toEqual({
      id: 'acme.one',
      version: '1.0.0',
      displayName: 'acme.one',
    })
  })

  it('denies conversations to a built-in without conversations:read or :write', async () => {
    const backend = conversationsBackend()
    const { ctx } = setup([], { conversations: backend })
    await expect(ctx.conversations.listThreads()).rejects.toEqual(permission)
    await expect(ctx.conversations.getThread('t1')).rejects.toEqual(permission)
    await expect(ctx.conversations.listMessages('t1')).rejects.toEqual(
      permission
    )
    await expect(
      ctx.conversations.createThread({ title: 'x' })
    ).rejects.toEqual(permission)
    expect(() => ctx.conversations.onDidCreateMessage(() => {})).toThrowError(
      permission
    )
    expect(backend.listThreads).not.toHaveBeenCalled()
  })

  it('separates reading from writing conversations', async () => {
    const backend = conversationsBackend()
    const { ctx } = setup(['conversations:read'], { conversations: backend })
    await expect(ctx.conversations.listThreads()).resolves.toHaveLength(1)
    await expect(
      ctx.conversations.createThread({ title: 'x' })
    ).rejects.toEqual(permission)
  })

  it('reports a missing conversations backend as E_NOT_FOUND once permitted', async () => {
    const { ctx } = setup(['conversations:read'])
    await expect(ctx.conversations.listThreads()).rejects.toMatchObject({
      code: 'E_NOT_FOUND',
    })
  })

  it('gates notifications on ui:notify and labels them with the extension name', () => {
    const denied = setup([])
    expect(() =>
      denied.ctx.ui.notify({ level: 'info', message: 'hi' })
    ).toThrowError(permission)
    const allowed = setup(['ui:notify'])
    allowed.ctx.ui.notify({ level: 'info', message: 'hi' })
    expect(allowed.deps.notify).toHaveBeenCalledWith({
      extensionName: 'acme.one',
      level: 'info',
      message: 'hi',
    })
  })

  it('lets an extension use its own commands and status items without a permission', async () => {
    const { ctx, contributions } = setup([])
    const handler = vi.fn().mockReturnValue('done')
    ctx.commands.registerCommand('hello', handler)
    await expect(ctx.commands.execute('hello', 1)).resolves.toBe('done')
    expect(handler).toHaveBeenCalledWith(
      { location: 'extension', extensionId: 'acme.one' },
      1
    )
    ctx.ui.setStatusItem('status', { text: 'busy' })
    expect(contributions.getState().statusItems['acme.one'].status.text).toBe(
      'busy'
    )
  })

  it('needs commands:execute for a command it does not own', async () => {
    const denied = setup([])
    await expect(denied.ctx.commands.execute('other.cmd')).rejects.toEqual(
      permission
    )
    const allowed = setup(['commands:execute'])
    await expect(
      allowed.ctx.commands.execute('other.cmd')
    ).rejects.toMatchObject({ code: 'E_NOT_FOUND' })
  })

  it('needs tools and providers for those registrations', () => {
    const denied = setup([])
    expect(() => denied.ctx.tools.registerTool('echo', vi.fn())).toThrowError(
      permission
    )
    expect(() => denied.ctx.providers.registerProvider('p', {})).toThrowError(
      permission
    )
    const allowed = setup(['tools'])
    expect(() => allowed.ctx.tools.registerTool('echo', vi.fn())).not.toThrow()
  })

  it('checks the host and scheme of every fetch', async () => {
    const http: HttpApi = {
      fetch: vi.fn().mockResolvedValue({ status: 200, headers: {}, body: '' }),
    }
    const { ctx } = setup(['network:api.acme.dev', 'network:localhost'], {
      http,
    })
    await expect(
      ctx.http.fetch('https://api.acme.dev/x')
    ).resolves.toMatchObject({ status: 200 })
    await expect(
      ctx.http.fetch('http://localhost:8080/x')
    ).resolves.toMatchObject({ status: 200 })
    await expect(ctx.http.fetch('https://example.com/')).rejects.toEqual(
      permission
    )
    await expect(ctx.http.fetch('http://api.acme.dev/x')).rejects.toEqual(
      permission
    )
    await expect(ctx.http.fetch('not a url')).rejects.toMatchObject({
      code: 'E_INVALID_ARGS',
    })
    expect(http.fetch).toHaveBeenCalledTimes(2)
  })

  it('scopes settings to the extension and forwards only its own changes', async () => {
    const { ctx, deps } = setup([])
    const listener = vi.fn()
    ctx.settings.onDidChange(listener)
    expect(await ctx.settings.get('greeting')).toBe('Hello')
    await ctx.settings.set('greeting', 'Hi')
    await deps.settings.setSettingValue('acme.one', 'greeting', 'Yo')
    expect(listener.mock.calls).toEqual([
      [{ key: 'greeting', value: 'Hi' }],
      [{ key: 'greeting', value: 'Yo' }],
    ])
  })

  it('stores data under the extension id', async () => {
    const storage = memoryAppSettings()
    const { ctx } = setup([], { storage })
    await ctx.storage.set('k', 1)
    expect(storage.data.has('extension:acme.one:storage')).toBe(true)
  })
})
