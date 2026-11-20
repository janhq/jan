// The installed loader against a mocked guest-js registry and the real
// host, with workers in the node:vm sandbox.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PermissionString } from '@janhq/extension-api'
import {
  runInSandbox,
  type SandboxWorker,
} from '@janhq/extension-runtime/testing'
import type {
  InstalledExtension,
  ListResult,
} from '@janhq/tauri-plugin-extensions-api'
import { ExtensionHost } from '../host'
import { applySafeMode, type InstalledRegistry } from '../installed-loader'
import { builtin, manifest } from './fixtures'
import { memoryAppSettings, memorySecrets } from './memory'

// Registers a command, so the test can see it ran.
const BUNDLE = `var JanExtension = { activate: function (ctx) {
  ctx.subscriptions.add(ctx.commands.registerCommand('hello', function () { return 'hi' }));
} };`

function entry(
  id: string,
  extra: Partial<InstalledExtension> & {
    permissions?: PermissionString[]
    apiVersion?: string
  } = {}
): InstalledExtension {
  const { apiVersion = '^1.0.0', permissions = ['ui:notify'], ...rest } = extra
  const { name, version, ...jan } = manifest(id, {
    apiVersion,
    permissions,
    contributes: { commands: [{ id: 'hello', title: 'Hello' }] },
  })
  return {
    id,
    version,
    previous: null,
    enabled: true,
    granted: [...permissions],
    permissions: [...permissions],
    source: { kind: 'bundle', fileName: `${id}.tgz`, sha512: 'sha512-x' },
    verified: false,
    integrityChecked: false,
    installedAt: '2026-10-23T10:00:00Z',
    // package.json as read_entry's install wrote it.
    manifest: { name, version, jan },
    ...rest,
  }
}

function fakeRegistry(extensions: InstalledExtension[], safeMode = false) {
  const state = { safeMode, extensions }
  const registry = {
    list: vi.fn<InstalledRegistry['list']>(
      async (): Promise<ListResult> => ({
        safeMode: state.safeMode,
        safeModeForced: false,
        recoveredFrom: null,
        extensions: state.extensions.map((e) => ({ ...e })),
      })
    ),
    readEntry: vi.fn<InstalledRegistry['readEntry']>(async (id) => {
      const found = state.extensions.find((e) => e.id === id)
      if (!found?.enabled || state.safeMode)
        throw { kind: 'denied', message: `${id} may not run` }
      if (id === 'acme.tampered')
        throw { kind: 'tampered', message: 'the entry file changed' }
      return { code: BUNDLE, sha512: 'sha512-entry' }
    }),
  } satisfies InstalledRegistry
  return { state, registry }
}

const workers: SandboxWorker[] = []
const hosts: ExtensionHost[] = []

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.deactivateAll()
  workers.splice(0)
  vi.restoreAllMocks()
})

function newHost(installed: InstalledRegistry) {
  const host = new ExtensionHost({
    appSettings: memoryAppSettings(),
    secrets: memorySecrets(),
    notify: vi.fn(),
    installed,
    createWorker: (source, name) => {
      const worker = runInSandbox(source, { name })
      workers.push(worker)
      return worker
    },
  })
  hosts.push(host)
  return host
}

const states = (host: ExtensionHost) =>
  Object.fromEntries(host.list().map((e) => [e.id, [e.source, e.state]]))

describe('loadInstalled', () => {
  it('starts every enabled extension in a worker with its grants', async () => {
    const { registry } = fakeRegistry([
      entry('acme.one'),
      entry('acme.two', { permissions: ['ui:notify', 'tools'], granted: ['tools'] }),
    ])
    const host = newHost(registry)
    await host.loadInstalled()
    expect(states(host)).toEqual({
      'acme.one': ['installed', 'active'],
      'acme.two': ['installed', 'active'],
    })
    expect(host.dispatcher.has('acme.two', 'tools')).toBe(true)
    expect(host.dispatcher.has('acme.two', 'ui:notify')).toBe(false)
    await expect(
      host.contributions.executeCommand('acme.one', 'hello', {
        location: 'commandPalette',
      })
    ).resolves.toBe('hi')
  })

  it('spawns nothing in safe mode', async () => {
    const { registry } = fakeRegistry([entry('acme.one')], true)
    const host = newHost(registry)
    await host.loadInstalled()
    expect(registry.readEntry).not.toHaveBeenCalled()
    expect(workers).toHaveLength(0)
    expect(host.list()).toEqual([])
  })

  it('does not load a disabled extension', async () => {
    const { registry } = fakeRegistry([
      entry('acme.off', { enabled: false }),
      entry('acme.on'),
    ])
    const host = newHost(registry)
    await host.loadInstalled()
    expect(registry.readEntry).toHaveBeenCalledTimes(1)
    expect(registry.readEntry).toHaveBeenCalledWith('acme.on')
    expect(states(host)).toEqual({ 'acme.on': ['installed', 'active'] })
  })

  it('marks an incompatible apiVersion failed without spawning, and loads the rest', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { registry } = fakeRegistry([
      entry('acme.future', { apiVersion: '^9.0.0' }),
      entry('acme.ok'),
    ])
    const host = newHost(registry)
    await host.loadInstalled()
    expect(host.list().find((e) => e.id === 'acme.future')).toMatchObject({
      source: 'installed',
      state: 'failed',
      error: expect.stringContaining('^9.0.0'),
    })
    expect(workers).toHaveLength(1)
    expect(states(host)['acme.ok']).toEqual(['installed', 'active'])
  })

  it('marks an extension whose entry Rust refuses failed with the reason', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { registry } = fakeRegistry([entry('acme.tampered'), entry('acme.ok')])
    const host = newHost(registry)
    await host.loadInstalled()
    expect(host.list().find((e) => e.id === 'acme.tampered')).toMatchObject({
      state: 'failed',
      error: 'the entry file changed',
    })
    expect(states(host)['acme.ok']).toEqual(['installed', 'active'])
  })

  it('marks a manifest the host refuses, or files of another version, failed and loads the rest', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { registry } = fakeRegistry([
      entry('acme.bad', { manifest: { name: 'x' } }),
      entry('acme.moved', { version: '2.0.0' }),
      entry('acme.ok'),
    ])
    const host = newHost(registry)
    await host.loadInstalled()
    expect(registry.readEntry).toHaveBeenCalledTimes(1)
    expect(states(host)).toEqual({
      'acme.bad': ['installed', 'failed'],
      'acme.moved': ['installed', 'failed'],
      'acme.ok': ['installed', 'active'],
    })
    expect(host.list().find((e) => e.id === 'acme.moved')).toMatchObject({
      manifest: { id: 'acme.moved', version: '2.0.0', displayName: 'acme.moved' },
      error: expect.stringContaining('the registry names acme.moved@2.0.0'),
    })
    expect(host.list().find((e) => e.id === 'acme.bad')?.error).toMatch(/jan/)
  })

  it('reads the entries of all extensions at once rather than one by one', async () => {
    const { registry } = fakeRegistry([entry('acme.one'), entry('acme.two')])
    const release: (() => void)[] = []
    const read = registry.readEntry.getMockImplementation()!
    registry.readEntry.mockImplementation(async (id) => {
      await new Promise<void>((resolve) => release.push(resolve))
      return read(id)
    })
    const host = newHost(registry)
    const loading = host.loadInstalled()
    await vi.waitFor(() => expect(registry.readEntry).toHaveBeenCalledTimes(2))
    for (const r of release) r()
    await loading
    expect(states(host)).toEqual({
      'acme.one': ['installed', 'active'],
      'acme.two': ['installed', 'active'],
    })
  })

  it('leaves a built-in or development copy of the same id alone', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { registry } = fakeRegistry([entry('acme.dev')])
    const host = newHost(registry)
    await host.spawnWorkerExtension({
      manifest: manifest('acme.dev', {
        contributes: { commands: [{ id: 'hello', title: 'Hello' }] },
      }),
      bundle: BUNDLE,
      grants: [],
      source: 'dev',
    })
    await host.loadInstalled()
    expect(states(host)).toEqual({ 'acme.dev': ['dev', 'active'] })
    await host.reload('acme.dev')
    expect(states(host)).toEqual({ 'acme.dev': ['dev', 'active'] })
    expect(registry.readEntry).not.toHaveBeenCalled()
  })
})

describe('ExtensionHost.reload', () => {
  it('respawns with the new grants after a revoke', async () => {
    const { state, registry } = fakeRegistry([
      entry('acme.one', { permissions: ['ui:notify', 'tools'] }),
    ])
    const host = newHost(registry)
    await host.loadInstalled()
    expect(host.dispatcher.has('acme.one', 'tools')).toBe(true)
    const first = workers[0]

    state.extensions[0].granted = ['ui:notify']
    await host.reload('acme.one')

    expect(first.terminated).toBe(true)
    expect(workers).toHaveLength(2)
    expect(states(host)).toEqual({ 'acme.one': ['installed', 'active'] })
    expect(host.dispatcher.has('acme.one', 'tools')).toBe(false)
    expect(host.dispatcher.has('acme.one', 'ui:notify')).toBe(true)
  })

  it('ends with the latest grants when two reloads overlap', async () => {
    const { state, registry } = fakeRegistry([
      entry('acme.one', { permissions: ['ui:notify', 'tools'] }),
    ])
    const host = newHost(registry)
    await host.loadInstalled()
    // Each read of the entry waits for its own gate, so the first reload
    // has read the old grants when the second one starts.
    const gates: (() => void)[] = []
    const opened = [0, 1].map(
      () => new Promise<void>((resolve) => gates.push(resolve))
    )
    const read = registry.readEntry.getMockImplementation()!
    let reads = 0
    registry.readEntry.mockImplementation(async (id) => {
      await opened[reads++]
      return read(id)
    })

    const first = host.reload('acme.one')
    await vi.waitFor(() => expect(reads).toBe(1))
    state.extensions[0].granted = ['ui:notify']
    const second = host.reload('acme.one')
    gates[0]()
    gates[1]()
    await Promise.all([first, second])

    expect(states(host)).toEqual({ 'acme.one': ['installed', 'active'] })
    expect(host.dispatcher.has('acme.one', 'tools')).toBe(false)
    expect(host.dispatcher.has('acme.one', 'ui:notify')).toBe(true)
  })

  it('stops a disabled or uninstalled extension and drops it from the list', async () => {
    const { state, registry } = fakeRegistry([entry('acme.one'), entry('acme.two')])
    const host = newHost(registry)
    await host.loadInstalled()

    state.extensions[0].enabled = false
    await host.reload('acme.one')
    state.extensions = state.extensions.filter((e) => e.id !== 'acme.two')
    await host.reload('acme.two')

    expect(workers.every((w) => w.terminated)).toBe(true)
    expect(host.list()).toEqual([])
    expect(host.contributions.getState().commands['acme.one']).toBeUndefined()
  })

  it('starts an extension that was just installed or enabled', async () => {
    const { state, registry } = fakeRegistry([entry('acme.one', { enabled: false })])
    const host = newHost(registry)
    await host.loadInstalled()
    expect(host.list()).toEqual([])
    state.extensions[0].enabled = true
    await host.reload('acme.one')
    expect(states(host)).toEqual({ 'acme.one': ['installed', 'active'] })
    expect(registry.readEntry).toHaveBeenCalledWith('acme.one')
  })

  it('retries a failed extension', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { state, registry } = fakeRegistry([
      entry('acme.one', { apiVersion: '^9.0.0' }),
    ])
    const host = newHost(registry)
    await host.loadInstalled()
    expect(states(host)).toEqual({ 'acme.one': ['installed', 'failed'] })
    state.extensions[0] = entry('acme.one')
    await host.reload('acme.one')
    expect(states(host)).toEqual({ 'acme.one': ['installed', 'active'] })
  })
})

describe('applySafeMode', () => {
  // The service the settings page and the crash-loop guard hand in: it
  // persists the flag the registry then reports.
  const service = (state: { safeMode: boolean }, registry: InstalledRegistry) => ({
    setSafeMode: vi.fn(async (on: boolean) => {
      state.safeMode = on
    }),
    list: () => registry.list(),
  })

  it('turning it on stops every running installed extension and drops its contributions', async () => {
    const { state, registry } = fakeRegistry([entry('acme.one'), entry('acme.two')])
    const host = newHost(registry)
    await host.loadInstalled()
    expect(host.contributions.getState().commands['acme.one']).toBeDefined()

    const svc = service(state, registry)
    await applySafeMode(host, svc, true)

    expect(svc.setSafeMode).toHaveBeenCalledWith(true)
    expect(workers.every((w) => w.terminated)).toBe(true)
    expect(host.list()).toEqual([])
    expect(host.contributions.getState().commands['acme.one']).toBeUndefined()
    expect(host.dispatcher.has('acme.one', 'ui:notify')).toBe(false)
  })

  it('turning it off starts the enabled installed extensions as at startup', async () => {
    const { state, registry } = fakeRegistry(
      [entry('acme.one'), entry('acme.off', { enabled: false })],
      true
    )
    const host = newHost(registry)
    await host.loadInstalled()
    expect(host.list()).toEqual([])

    await applySafeMode(host, service(state, registry), false)

    expect(states(host)).toEqual({ 'acme.one': ['installed', 'active'] })
    await expect(
      host.contributions.executeCommand('acme.one', 'hello', {
        location: 'commandPalette',
      })
    ).resolves.toBe('hi')
  })

  it('changes nothing that runs when the flag cannot be saved', async () => {
    const { state, registry } = fakeRegistry([entry('acme.one')])
    const host = newHost(registry)
    await host.loadInstalled()
    const svc = service(state, registry)
    svc.setSafeMode.mockRejectedValue(new Error('registry I/O'))

    await expect(applySafeMode(host, svc, true)).rejects.toThrow('registry I/O')
    expect(states(host)).toEqual({ 'acme.one': ['installed', 'active'] })
  })

  it('leaves built-ins and development copies running', async () => {
    const { state, registry } = fakeRegistry([entry('acme.one')])
    const host = newHost(registry)
    await host.activateBuiltins([
      builtin(manifest('jan.core'), { activate: () => undefined }),
    ])
    await host.spawnWorkerExtension({
      manifest: manifest('acme.dev', {
        contributes: { commands: [{ id: 'hello', title: 'Hello' }] },
      }),
      bundle: BUNDLE,
      grants: [],
      source: 'dev',
    })
    await host.loadInstalled()

    await applySafeMode(host, service(state, registry), true)

    expect(states(host)).toEqual({
      'jan.core': ['builtin', 'active'],
      'acme.dev': ['dev', 'active'],
    })
  })

  it('still stops what runs when the registry cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { state, registry } = fakeRegistry([entry('acme.one')])
    const host = newHost(registry)
    await host.loadInstalled()
    registry.list.mockRejectedValue(new Error('registry gone'))
    const svc = service(state, registry)

    await applySafeMode(host, svc, true)

    expect(host.list()).toEqual([])
  })

  it('also stops an extension whose start was still in flight', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { state, registry } = fakeRegistry([entry('acme.one')])
    const host = newHost(registry)
    // The start has read the registry before safe mode went on, and is
    // still reading the entry, so the host does not hold it yet.
    let open = () => {}
    const gate = new Promise<void>((resolve) => (open = resolve))
    const read = registry.readEntry.getMockImplementation()!
    let reads = 0
    registry.readEntry.mockImplementation(async (id) => {
      reads += 1
      await gate
      return read(id)
    })
    const loading = host.loadInstalled()
    await vi.waitFor(() => expect(reads).toBe(1))

    const applied = applySafeMode(host, service(state, registry), true)
    open()
    await Promise.all([loading, applied])

    expect(host.list()).toEqual([])
    expect(workers.every((w) => w.terminated)).toBe(true)
  })
})
