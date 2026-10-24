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
import type { InstalledRegistry } from '../installed-loader'
import { manifest } from './fixtures'
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
  const { apiVersion = '^0.1.0', permissions = ['ui:notify'], ...rest } = extra
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

  it('skips a manifest the host refuses, and one whose files are another version', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { registry } = fakeRegistry([
      entry('acme.bad', { manifest: { name: 'x' } }),
      entry('acme.moved', { version: '2.0.0' }),
      entry('acme.ok'),
    ])
    const host = newHost(registry)
    await host.loadInstalled()
    expect(registry.readEntry).toHaveBeenCalledTimes(1)
    expect(states(host)).toEqual({ 'acme.ok': ['installed', 'active'] })
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
    expect(registry.readEntry).toHaveBeenCalledTimes(1)
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
