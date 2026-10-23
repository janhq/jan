// The sandbox harness runs the real composed worker script (prelude plus
// bundle) in a node:vm realm over a node MessageChannel; jsdom needs no
// Worker. The host side under test is the code the app runs.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ValidatedManifest } from '@janhq/extension-api'
import {
  runInSandbox,
  type SandboxWorker,
} from '@janhq/extension-runtime/testing'
import { ExtensionHost } from '../host'
import { builtin, manifest } from './fixtures'
import { memoryAppSettings, memorySecrets } from './memory'

const sample = (overrides: Partial<ValidatedManifest> = {}) =>
  manifest('acme.worker', {
    apiVersion: '^0.1.0',
    permissions: ['tools', 'ui:notify'],
    contributes: {
      commands: [{ id: 'hello', title: 'Hello' }],
      statusItems: [{ id: 'status', text: 'idle' }],
      tools: [
        {
          name: 'wait_upper',
          description: 'Uppercases its input, or waits until cancelled',
          inputSchema: { type: 'object' as const },
        },
      ],
    },
    ...overrides,
  })

// Written as a rolldown IIFE would emit it: one global, no imports.
const BUNDLE = `
var JanExtension = (function () {
  function activate(ctx) {
    ctx.subscriptions.add(ctx.commands.registerCommand('hello', function () {
      ctx.ui.setStatusItem('status', { text: 'greeted' });
      ctx.ui.notify({ level: 'info', message: 'hi' });
      return 'done';
    }));
    ctx.subscriptions.add(ctx.tools.registerTool('wait_upper', function (input, token) {
      if (!input.wait) {
        return Promise.resolve({ content: [{ type: 'text', text: String(input.text).toUpperCase() }] });
      }
      return new Promise(function (resolve) {
        token.onCancellationRequested(function () {
          self.__cancelled = true;
          resolve({ content: [{ type: 'text', text: 'cancelled' }] });
        });
      });
    }));
  }
  return { activate: activate };
})();
`

const workers: SandboxWorker[] = []
const hosts: ExtensionHost[] = []

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.deactivateAll()
  workers.splice(0)
})

function newHost() {
  const notify = vi.fn()
  const host = new ExtensionHost({
    appSettings: memoryAppSettings(),
    secrets: memorySecrets(),
    notify,
    createWorker: (source, name) => {
      const worker = runInSandbox(source, { name })
      workers.push(worker)
      return worker
    },
  })
  hosts.push(host)
  return { host, notify }
}

describe('spawnWorkerExtension', () => {
  it('maps the worker registrations into the contribution store', async () => {
    const { host, notify } = newHost()
    const hosted = await host.spawnWorkerExtension({
      manifest: sample(),
      bundle: BUNDLE,
      grants: ['tools', 'ui:notify'],
      source: 'dev',
    })
    expect(hosted).toMatchObject({ id: 'acme.worker', state: 'active', source: 'dev' })
    const state = host.contributions.getState()
    expect(state.tools['acme.worker'].wait_upper.handler).toBeTypeOf('function')
    expect(state.commands['acme.worker'].hello.handler).toBeTypeOf('function')

    await expect(
      host.contributions.executeCommand('acme.worker', 'hello', {
        location: 'commandPalette',
      })
    ).resolves.toBe('done')
    await vi.waitFor(() =>
      expect(
        host.contributions.getState().statusItems['acme.worker'].status.text
      ).toBe('greeted')
    )
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith({
        extensionName: 'acme.worker',
        level: 'info',
        message: 'hi',
      })
    )
    expect(workers[0].leaks).toEqual([])
  })

  it('round-trips a tool call and cancels it on Stop', async () => {
    const { host } = newHost()
    await host.spawnWorkerExtension({
      manifest: sample(),
      bundle: BUNDLE,
      grants: ['tools', 'ui:notify'],
      source: 'dev',
    })
    const stop = new AbortController()
    await expect(
      host.callTool('acme.worker', 'wait_upper', { text: 'jan' }, { signal: stop.signal })
    ).resolves.toEqual({ content: [{ type: 'text', text: 'JAN' }] })

    const pending = host.callTool(
      'acme.worker',
      'wait_upper',
      { wait: true },
      { signal: stop.signal }
    )
    await new Promise((r) => setTimeout(r, 20))
    stop.abort()
    await expect(pending).resolves.toMatchObject({
      error: expect.stringContaining('cancelled'),
    })
    await vi.waitFor(() => expect(workers[0].scope.__cancelled).toBe(true))
  })

  it('terminate clears every registration and stops the worker', async () => {
    const { host } = newHost()
    await host.spawnWorkerExtension({
      manifest: sample(),
      bundle: BUNDLE,
      grants: ['tools', 'ui:notify'],
      source: 'dev',
    })
    await host.terminate('acme.worker')
    const state = host.contributions.getState()
    expect(state.tools['acme.worker']).toBeUndefined()
    expect(state.commands['acme.worker']).toBeUndefined()
    expect(workers[0].terminated).toBe(true)
    expect(host.dispatcher.has('acme.worker', 'tools')).toBe(false)
    expect(host.list()[0].state).toBe('inactive')
  })

  it('fails activation when a registration needs a permission the user did not grant', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { host } = newHost()
    const hosted = await host.spawnWorkerExtension({
      manifest: sample(),
      bundle: BUNDLE,
      grants: ['ui:notify'],
      source: 'dev',
    })
    expect(hosted.state).toBe('failed')
    expect(hosted.error).toMatch(/tools/)
    expect(host.contributions.getState().tools['acme.worker']).toBeUndefined()
    expect(workers[0].terminated).toBe(true)
  })

  it('never grants more than the manifest requests', async () => {
    const { host } = newHost()
    await host.spawnWorkerExtension({
      manifest: sample(),
      bundle: BUNDLE,
      grants: ['tools', 'ui:notify', 'conversations:read'],
      source: 'dev',
    })
    expect(host.dispatcher.has('acme.worker', 'conversations:read')).toBe(false)
  })

  it('reports a bundle that does not load as failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { host } = newHost()
    const syntax = await host.spawnWorkerExtension({
      manifest: sample(),
      bundle: 'var JanExtension = {',
      grants: [],
      source: 'dev',
    })
    expect(syntax.state).toBe('failed')
    const missing = await host.spawnWorkerExtension({
      manifest: sample(),
      bundle: 'var Other = {}',
      grants: [],
      source: 'dev',
    })
    expect(missing).toMatchObject({
      state: 'failed',
      error: expect.stringContaining('JanExtension'),
    })
  })

  it('refuses a network call outside the grants', async () => {
    const fetch = vi.fn()
    const host = new ExtensionHost({
      appSettings: memoryAppSettings(),
      secrets: memorySecrets(),
      notify: vi.fn(),
      fetch,
      createWorker: (source, name) => {
        const worker = runInSandbox(source, { name })
        workers.push(worker)
        return worker
      },
    })
    hosts.push(host)
    const bundle = `var JanExtension = { activate: function (ctx) {
      return ctx.http.fetch('https://example.com/').then(
        function () { self.__result = 'allowed' },
        function (e) { self.__result = e.code }
      );
    } };`
    await host.spawnWorkerExtension({
      manifest: manifest('acme.net', { permissions: ['network:127.0.0.1'] }),
      bundle,
      grants: ['network:127.0.0.1'],
      source: 'dev',
    })
    expect(workers[0].scope.__result).toBe('E_PERMISSION')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('unload stops a worker extension and removes it from the list', async () => {
    const { host } = newHost()
    await host.spawnWorkerExtension({
      manifest: sample(),
      bundle: BUNDLE,
      grants: ['tools', 'ui:notify'],
      source: 'dev',
    })
    const listener = vi.fn()
    host.onDidChange(listener)
    await host.unload('acme.worker')
    expect(host.list()).toEqual([])
    expect(workers[0].terminated).toBe(true)
    expect(host.contributions.getState().tools['acme.worker']).toBeUndefined()
    expect(listener).toHaveBeenCalled()
  })

  it('unload removes a failed worker extension too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { host } = newHost()
    await host.spawnWorkerExtension({
      manifest: sample(),
      bundle: 'var Other = {}',
      grants: [],
      source: 'dev',
    })
    await host.unload('acme.worker')
    expect(host.list()).toEqual([])
  })

  it('refuses to unload a built-in', async () => {
    const { host } = newHost()
    await host.activateBuiltin(
      builtin(manifest('jan.core'), { activate: () => {} })
    )
    await expect(host.unload('jan.core')).rejects.toThrow(/built-in/)
    expect(host.list()[0].state).toBe('active')
  })

  it('honours proposals only for dev loads', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { host } = newHost()
    const proposing = sample({ proposals: ['chat'] })
    const installed = await host.spawnWorkerExtension({
      manifest: proposing,
      bundle: BUNDLE,
      grants: ['tools', 'ui:notify'],
      source: 'installed',
    })
    expect(installed).toMatchObject({
      state: 'failed',
      error: expect.stringContaining('proposals'),
    })
    await host.unload('acme.worker')
    const dev = await host.spawnWorkerExtension({
      manifest: proposing,
      bundle: BUNDLE,
      grants: ['tools', 'ui:notify'],
      source: 'dev',
    })
    expect(dev.state).toBe('active')
  })
})
