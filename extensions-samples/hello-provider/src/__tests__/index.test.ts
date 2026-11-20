// activate() against an in-memory ExtensionContext: the extension's own
// logic, without a worker. The worker path is covered by bundle.test.ts
// here and by web-app's sample.integration.test.ts against the real host.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DisposableStore,
  Emitter,
  type CancellationToken,
  type CommandHandler,
  type ExtensionContext,
  type HttpRequestInit,
  type HttpResponse,
  type ProviderHandlers,
  type SettingValue,
  type ToolHandler,
} from '@janhq/extension-api'
import { activate, deactivate } from '../index.js'

const unused = () => {
  throw new Error('not used by the sample')
}

function fakeContext() {
  const settings = new Map<string, SettingValue>()
  const settingChanges = new Emitter<{ key: string; value: SettingValue }>()
  const commands = new Map<string, CommandHandler>()
  const tools = new Map<string, ToolHandler>()
  const providers = new Map<string, ProviderHandlers>()
  const status = new Map<string, { text?: string; tooltip?: string }>()
  const notify = vi.fn()
  const info = vi.fn()
  const fetch = vi.fn(
    async (url: string, init?: HttpRequestInit): Promise<HttpResponse> => {
      void url
      void init
      return { status: 200, headers: {}, body: '{"data":[]}' }
    }
  )
  const bind =
    <T>(map: Map<string, T>) =>
    (id: string, value: T) => {
      map.set(id, value)
      return { dispose: () => void map.delete(id) }
    }
  const ctx: ExtensionContext = {
    extension: {
      id: 'jan-samples.hello-provider',
      version: '0.1.0',
      displayName: 'Hello Provider',
    },
    subscriptions: new DisposableStore(),
    log: { debug: vi.fn(), info, warn: vi.fn(), error: vi.fn() },
    settings: {
      get: async <T extends SettingValue>(key: string) =>
        (settings.get(key) ?? (key === 'greeting' ? 'Hello' : undefined)) as
          | T
          | undefined,
      set: async (key, value) => {
        settings.set(key, value)
        settingChanges.fire({ key, value })
      },
      onDidChange: settingChanges.event,
    },
    storage: { get: unused, set: unused, delete: unused, keys: unused },
    commands: { registerCommand: bind(commands), execute: unused },
    ui: {
      notify,
      setStatusItem: (id, update) => void status.set(id, update),
    },
    conversations: {
      listThreads: unused,
      getThread: unused,
      listMessages: unused,
      createThread: unused,
      appendMessage: unused,
      onDidCreateMessage: unused,
      onDidDeleteThread: unused,
    },
    tools: { registerTool: bind(tools) },
    providers: { registerProvider: bind(providers) },
    http: { fetch },
    proposed: {},
  }
  return { ctx, commands, tools, providers, status, notify, info, fetch }
}

function token() {
  const cancelled = new Emitter<void>()
  let requested = false
  const t: CancellationToken = {
    get isCancellationRequested() {
      return requested
    },
    onCancellationRequested: cancelled.event,
  }
  return {
    token: t,
    cancel: () => {
      requested = true
      cancelled.fire()
    },
  }
}

const palette = { location: 'commandPalette' } as const

afterEach(() => {
  vi.useRealTimers()
})

describe('hello-provider activate', () => {
  it('registers every contribution it declares', async () => {
    const f = fakeContext()
    await activate(f.ctx)
    expect([...f.commands.keys()].sort()).toEqual(['hello.greet', 'hello.ping'])
    expect([...f.tools.keys()]).toEqual(['echo_upper'])
    expect([...f.providers.keys()]).toEqual(['hello-local'])
    expect(f.status.get('hello.status')).toEqual({ text: 'Hello (0)' })
  })

  it('greets with the configured greeting and counts in the status item', async () => {
    const f = fakeContext()
    await f.ctx.settings.set('greeting', 'Hi')
    await activate(f.ctx)
    const greet = f.commands.get('hello.greet')!
    expect(greet(palette)).toBe('Hi from Hello Provider!')
    await greet(palette)
    expect(f.notify).toHaveBeenLastCalledWith({
      level: 'info',
      message: 'Hi from Hello Provider!',
    })
    expect(f.status.get('hello.status')).toEqual({ text: 'Hi (2)' })
  })

  it('follows a greeting change in the status item', async () => {
    const f = fakeContext()
    await activate(f.ctx)
    await f.ctx.settings.set('greeting', 'Hola')
    expect(f.status.get('hello.status')).toEqual({ text: 'Hola (0)' })
  })

  it('stops following settings once its subscriptions are disposed', async () => {
    const f = fakeContext()
    await activate(f.ctx)
    f.ctx.subscriptions.dispose()
    await f.ctx.settings.set('greeting', 'Hola')
    expect(f.status.get('hello.status')).toEqual({ text: 'Hello (0)' })
    expect(f.commands.size).toBe(0)
    deactivate()
  })

  it('echo_upper upper-cases its input', async () => {
    const f = fakeContext()
    await activate(f.ctx)
    const echo = f.tools.get('echo_upper')!
    await expect(echo({ text: 'hello jan' }, token().token)).resolves.toEqual({
      content: [{ type: 'text', text: 'HELLO JAN' }],
    })
  })

  it('echo_upper reports bad input as a tool error', async () => {
    const f = fakeContext()
    await activate(f.ctx)
    const echo = f.tools.get('echo_upper')!
    for (const input of [
      undefined,
      {},
      { text: 1 },
      { text: 'a', delayMs: -1 },
    ])
      await expect(echo(input, token().token)).resolves.toMatchObject({
        isError: true,
      })
  })

  it('echo_upper waits for delayMs and stops when cancelled', async () => {
    vi.useFakeTimers()
    const f = fakeContext()
    await activate(f.ctx)
    const echo = f.tools.get('echo_upper')!

    const slow = echo({ text: 'late', delayMs: 1000 }, token().token)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(slow).resolves.toEqual({
      content: [{ type: 'text', text: 'LATE' }],
    })

    const t = token()
    const pending = echo({ text: 'never', delayMs: 5000 }, t.token)
    t.cancel()
    await expect(pending).resolves.toEqual({
      content: [{ type: 'text', text: 'Cancelled' }],
      isError: true,
    })
    expect(vi.getTimerCount()).toBe(0)
    expect(f.info).toHaveBeenCalledWith('echo_upper cancelled')
  })

  it('echo_upper does no work for a call cancelled before it started', async () => {
    const f = fakeContext()
    await activate(f.ctx)
    const t = token()
    t.cancel()
    await expect(
      f.tools.get('echo_upper')!({ text: 'x' }, t.token)
    ).resolves.toMatchObject({ isError: true })
  })

  it('hello-local lists its one model', async () => {
    const f = fakeContext()
    await activate(f.ctx)
    await expect(
      f.providers.get('hello-local')!.listModels!()
    ).resolves.toEqual([{ id: 'hello-1', displayName: 'Hello 1' }])
  })

  it('hello.ping fetches the local server through ctx.http', async () => {
    const f = fakeContext()
    await activate(f.ctx)
    const ping = f.commands.get('hello.ping')!
    await expect(ping(palette)).resolves.toBe(200)
    await ping(palette, 'https://example.com/')
    expect(f.fetch.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:11999/v1/models',
      'https://example.com/',
    ])
  })
})
