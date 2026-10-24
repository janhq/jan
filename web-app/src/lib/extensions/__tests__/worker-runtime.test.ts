// The sandbox harness runs the real composed worker script (prelude plus
// bundle) in a node:vm realm over a node MessageChannel; jsdom needs no
// Worker. The host side under test is the code the app runs.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ValidatedManifest } from '@janhq/extension-api'
import {
  runInSandbox,
  type SandboxWorker,
} from '@janhq/extension-runtime/testing'
import { HOST_BUILTINS } from '../builtins'
import { ContributionStore } from '../contributions'
import { METHOD_POLICY, PermissionDispatcher } from '../dispatcher'
import { ExtensionHost } from '../host'
import { createHostApi } from '../host-api'
import type { ExtensionHttp } from '../http'
import { ExtensionSettingsStore } from '../settings-store'
import {
  MAX_REJECTED_MESSAGES,
  MESSAGE_BURST,
  createBlobWorker,
  startWorker,
} from '../worker-runtime'
import { fakeHttp } from './fake-http'
import { builtin, manifest } from './fixtures'
import { memoryAppSettings, memorySecrets } from './memory'

const sample = (overrides: Partial<ValidatedManifest> = {}) =>
  manifest('acme.worker', {
    apiVersion: '^1.0.0',
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

  it('refuses a bundle with hoisted declarations before creating a worker', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { host } = newHost()
    const hosted = await host.spawnWorkerExtension({
      manifest: sample(),
      bundle: `function Set() { self.__net = fetch }\n${BUNDLE}`,
      grants: [],
      source: 'dev',
    })
    expect(hosted).toMatchObject({
      state: 'failed',
      error: expect.stringContaining("'var JanExtension = <expression>'"),
    })
    expect(workers).toHaveLength(0)
  })

  it('gives ctx.http.fetch to installed extensions only, through the plugin', async () => {
    const server = fakeHttp(() => ({ body: 'pong' }))
    const host = new ExtensionHost({
      appSettings: memoryAppSettings(),
      secrets: memorySecrets(),
      notify: vi.fn(),
      http: server.http,
      createWorker: (source, name) => {
        const worker = runInSandbox(source, { name })
        workers.push(worker)
        return worker
      },
    })
    hosts.push(host)
    const bundle = `var JanExtension = { activate: function (ctx) {
      return ctx.http.fetch('http://127.0.0.1:11999/').then(
        function (r) { self.__result = r.status + ' ' + r.body },
        function (e) { self.__result = e.code + ': ' + e.message }
      );
    } };`
    const spawn = (id: string, source: 'dev' | 'installed') =>
      host.spawnWorkerExtension({
        manifest: manifest(id, { permissions: ['network:127.0.0.1'] }),
        bundle,
        grants: ['network:127.0.0.1'],
        source,
      })
    await spawn('acme.installed', 'installed')
    expect(workers[0].scope.__result).toBe('200 pong')
    expect(server.sent).toEqual([
      expect.objectContaining({ extensionId: 'acme.installed' }),
    ])
    // A folder loaded for development has no registry entry for the plugin
    // to check its grants against, so it gets no network path.
    await spawn('acme.dev', 'dev')
    expect(workers[1].scope.__result).toMatch(
      /^E_NOT_FOUND: .*only available to installed extensions/
    )
    expect(server.sent).toHaveLength(1)
  })

  it("reserves built-in ids and the 'jan.' prefix for built-ins", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { host } = newHost()
    await host.activateBuiltin(builtin(manifest('acme.builtin'), { activate: () => {} }))
    await host.deactivateAll()
    for (const id of ['jan.assistant', 'jan.anything', 'acme.builtin']) {
      await expect(
        host.spawnWorkerExtension({
          manifest: sample({ id }),
          bundle: BUNDLE,
          grants: [],
          source: 'dev',
        })
      ).rejects.toMatchObject({ code: 'E_PERMISSION' })
    }
    // The inactive built-in keeps its entry.
    expect(host.list()).toEqual([
      expect.objectContaining({ id: 'acme.builtin', source: 'builtin' }),
    ])
    expect(workers).toHaveLength(0)
    for (const b of HOST_BUILTINS) expect(b.manifest.id).toMatch(/^jan\./)
  })

  it('refuses a network call outside the grants', async () => {
    const server = fakeHttp(() => ({}))
    const host = new ExtensionHost({
      appSettings: memoryAppSettings(),
      secrets: memorySecrets(),
      notify: vi.fn(),
      http: server.http,
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
      source: 'installed',
    })
    expect(workers[0].scope.__result).toBe('E_PERMISSION')
    expect(server.sent).toEqual([])
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

describe('startWorker', () => {
  function start(bundle: string, http?: ExtensionHttp) {
    const m = manifest('acme.net', { permissions: ['network:127.0.0.1'] })
    const dispatcher = new PermissionDispatcher()
    dispatcher.grant(m.id, m.permissions)
    const api = createHostApi(m, {
      dispatcher,
      contributions: new ContributionStore(),
      settings: new ExtensionSettingsStore({
        appSettings: memoryAppSettings(),
        secrets: memorySecrets(),
      }),
      storage: memoryAppSettings(),
      notify: vi.fn(),
      http,
    })
    let worker: SandboxWorker | undefined
    const started = startWorker({
      manifest: m,
      bundle,
      dispatcher,
      api,
      createWorker: (source, name) => {
        worker = runInSandbox(source, { name })
        return worker
      },
    })
    return { started, worker: () => worker }
  }

  it('cancels the plugin request when the worker cancels it', async () => {
    const server = fakeHttp(() => ({ hang: true }))
    // A request and its cancel on the wire, as the worker endpoint sends
    // them when a call times out or its token fires.
    const { started } = start(
      `var JanExtension = { activate: function () {
        self.postMessage({ v: 1, t: 'req', id: 9001, method: 'http.fetch', args: ['http://127.0.0.1:1/a'] });
        setTimeout(function () { self.postMessage({ v: 1, t: 'cancel', id: 9001 }) }, 20);
      } };`,
      server.http
    )
    const connection = await started
    await vi.waitFor(() =>
      expect(server.http.httpCancel).toHaveBeenCalledWith(
        'acme.net',
        server.sent[0].requestId
      )
    )
    connection.terminate()
  })

  it('cancels plugin requests when the worker is terminated', async () => {
    const server = fakeHttp(() => ({ hang: true }))
    const { started } = start(
      `var JanExtension = { activate: function (ctx) {
        ctx.http.fetch('http://127.0.0.1:1/b').catch(function () {});
      } };`,
      server.http
    )
    const connection = await started
    await vi.waitFor(() => expect(server.sent).toHaveLength(1))
    expect(server.http.httpCancel).not.toHaveBeenCalled()
    connection.terminate()
    expect(server.http.httpCancel).toHaveBeenCalledWith(
      'acme.net',
      server.sent[0].requestId
    )
  })

  it('terminates a worker that keeps sending refused messages', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { started, worker } = start(
      `var JanExtension = { activate: function () {
        for (var i = 0; i < ${MAX_REJECTED_MESSAGES}; i++) self.postMessage('junk');
        return new Promise(function () {});
      } };`
    )
    await expect(started).rejects.toMatchObject({ code: 'E_INVALID_ARGS' })
    expect(worker()?.terminated).toBe(true)
  })

  it('terminates a worker that floods well-formed calls', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const parse = vi.spyOn(METHOD_POLICY.log.args, 'safeParse')
    const { started, worker } = start(
      `var JanExtension = { activate: function () {
        setTimeout(function () {
          for (var i = 0; i < ${MESSAGE_BURST * 4}; i++)
            self.postMessage({ v: 1, t: 'req', id: i + 1, method: 'log', args: ['info', 'x'] });
        }, 10);
      } };`
    )
    await started
    await vi.waitFor(() => expect(worker()?.terminated).toBe(true))
    // Calls over the budget never reached argument validation.
    expect(parse.mock.calls.length).toBeLessThanOrEqual(MESSAGE_BURST + 1)
    parse.mockRestore()
  })

  it('terminates a worker that keeps making calls it is refused', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { started, worker } = start(
      `var JanExtension = { activate: function () {
        setTimeout(function () {
          for (var i = 0; i < ${MAX_REJECTED_MESSAGES}; i++)
            self.postMessage({ v: 1, t: 'req', id: i + 1, method: 'ui.notify', args: [{ level: 'info', message: 'x' }] });
        }, 10);
      } };`
    )
    await started
    await vi.waitFor(() => expect(worker()?.terminated).toBe(true))
  })

  it('lets a worker that stays within the budget run', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const { started, worker } = start(
      `var JanExtension = { activate: function (ctx) {
        for (var i = 0; i < ${MESSAGE_BURST - 10}; i++) ctx.log.info('x');
      } };`
    )
    const connection = await started
    await new Promise((r) => setTimeout(r, 50))
    expect(worker()?.terminated).toBe(false)
    connection.terminate()
  })

  it('terminates a running worker that floods oversized messages', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { started, worker } = start(
      `var JanExtension = { activate: function () {
        setTimeout(function () {
          var big = new Array(5 * 1024 * 1024).join('x');
          for (var i = 0; i < ${MAX_REJECTED_MESSAGES}; i++)
            self.postMessage({ v: 1, t: 'evt', sub: 1, value: big });
        }, 10);
      } };`
    )
    await started
    await vi.waitFor(() => expect(worker()?.terminated).toBe(true))
  })
})

describe('createBlobWorker', () => {
  it('revokes the blob URL on terminate even if the script never ran', () => {
    const revoke = vi.fn()
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, {
        createObjectURL: () => 'blob:test',
        revokeObjectURL: revoke,
      })
    )
    const terminate = vi.fn()
    class FakeWorker {
      addEventListener() {}
      removeEventListener() {}
      postMessage() {}
      terminate = terminate
    }
    vi.stubGlobal('Worker', FakeWorker)
    try {
      createBlobWorker('while (true) {}', 'ext:acme.loop').terminate()
      expect(terminate).toHaveBeenCalled()
      expect(revoke).toHaveBeenCalledWith('blob:test')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
