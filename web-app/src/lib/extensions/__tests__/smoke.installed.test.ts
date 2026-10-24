// The web-app half of the end-to-end smoke install (`make
// test-extensions-smoke`). tests/smoke.rs of tauri-plugin-extensions
// installed the packed sample into JAN_EXT_SMOKE_ROOT; this reads that
// root from disk the way `list` and `read_entry` return it, loads it
// through the installed loader into the real host (workers in the node:vm
// sandbox), and checks what the extension registered.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  runInSandbox,
  type SandboxWorker,
} from '@janhq/extension-runtime/testing'
import type {
  ExtensionSource,
  InstalledExtension,
} from '@janhq/tauri-plugin-extensions-api'
import { ExtensionHost } from '../host'
import type { InstalledRegistry } from '../installed-loader'
import { listExtensionProviders } from '../providers'
import { listExtensionTools, toolWireName } from '../tools'
import { fakeHttp } from './fake-http'
import { memoryAppSettings, memorySecrets } from './memory'

const ROOT = process.env.JAN_EXT_SMOKE_ROOT
const ID = 'jan-samples.hello-provider'

interface RegistryEntry {
  enabled: boolean
  active: string
  previous?: string
  granted: string[]
  source: ExtensionSource
  verified: boolean
  integrityChecked: boolean
  main: string
  permissions: string[]
  entrySha512: string
  installedAt: string
}

interface RegistryFile {
  schema: number
  safeMode: boolean
  extensions: Record<string, RegistryEntry>
}

const sri = (bytes: Buffer) =>
  `sha512-${createHash('sha512').update(bytes).digest('base64')}`

/**
 * The guest-js `list` and `read_entry` over the files on disk, with the
 * same checks: read_entry refuses a disabled extension, safe mode and an
 * entry whose hash no longer matches the registry.
 */
function diskRegistry(root: string): InstalledRegistry {
  const load = (): RegistryFile =>
    JSON.parse(readFileSync(join(root, 'extensions.json'), 'utf8'))
  const versionDir = (id: string, version: string) => join(root, id, version)
  return {
    list: async () => {
      const file = load()
      const extensions: InstalledExtension[] = Object.entries(
        file.extensions
      ).map(([id, e]) => ({
        id,
        version: e.active,
        previous: e.previous ?? null,
        enabled: e.enabled,
        granted: e.granted,
        permissions: e.permissions,
        source: e.source,
        verified: e.verified,
        integrityChecked: e.integrityChecked,
        installedAt: e.installedAt,
        manifest: JSON.parse(
          readFileSync(join(versionDir(id, e.active), 'package.json'), 'utf8')
        ),
      }))
      return {
        safeMode: file.safeMode,
        safeModeForced: false,
        recoveredFrom: null,
        extensions,
      }
    },
    readEntry: async (id) => {
      const file = load()
      const e = file.extensions[id]
      if (file.safeMode || !e?.enabled)
        throw { kind: 'denied', message: `${id} may not run` }
      const bytes = readFileSync(join(versionDir(id, e.active), e.main))
      const sha512 = sri(bytes)
      if (sha512 !== e.entrySha512)
        throw { kind: 'tampered', message: `the entry file of ${id} changed` }
      return { code: bytes.toString('utf8'), sha512 }
    },
  }
}

describe.runIf(ROOT)('smoke: the installed sample bundle', () => {
  let host: ExtensionHost
  let worker: SandboxWorker | undefined
  const notify = vi.fn()
  const server = fakeHttp(() => ({ body: '{"data":[]}' }))

  beforeAll(async () => {
    host = new ExtensionHost({
      appSettings: memoryAppSettings(),
      secrets: memorySecrets(),
      notify,
      http: server.http,
      installed: diskRegistry(ROOT!),
      createWorker: (source, name) => {
        worker = runInSandbox(source, { name })
        return worker
      },
    })
    await host.loadInstalled()
  })

  afterAll(async () => {
    await host.deactivateAll()
    expect(worker?.leaks).toEqual([])
  })

  it('loads it as an active installed extension with its grants', () => {
    expect(host.list()).toEqual([
      expect.objectContaining({ id: ID, source: 'installed', state: 'active' }),
    ])
    for (const p of ['ui:notify', 'tools', 'providers', 'network:127.0.0.1'])
      expect(host.dispatcher.has(ID, p)).toBe(true)
  })

  it('registers its command, setting, status item, tool and provider', () => {
    const state = host.contributions.getState()
    expect(Object.keys(state.commands[ID]).sort()).toEqual([
      'hello.greet',
      'hello.ping',
    ])
    expect(state.settings[ID].map((s) => s.key)).toEqual(['greeting'])
    expect(state.statusItems[ID]['hello.status']?.text).toBe('Hello (0)')
    expect(listExtensionTools(state)).toEqual([
      expect.objectContaining({
        wireName: toolWireName(ID, 'echo_upper'),
        name: 'echo_upper',
      }),
    ])
    expect(listExtensionProviders(state)).toEqual([
      expect.objectContaining({
        extensionId: ID,
        contribution: expect.objectContaining({
          id: 'hello-local',
          baseUrl: 'http://127.0.0.1:11999/v1',
        }),
      }),
    ])
  })

  it('round-trips a tool call through the worker', async () => {
    await expect(
      host.callTool(ID, 'echo_upper', { text: 'smoke' })
    ).resolves.toEqual({ content: [{ type: 'text', text: 'SMOKE' }] })
  })

  it('runs its command and reaches the network only through the plugin', async () => {
    await expect(
      host.contributions.executeCommand(ID, 'hello.greet', {
        location: 'commandPalette',
      })
    ).resolves.toBe('Hello from Hello Provider!')
    await expect(
      host.contributions.executeCommand(ID, 'hello.ping', {
        location: 'commandPalette',
      })
    ).resolves.toBe(200)
    expect(server.sent).toEqual([
      expect.objectContaining({
        extensionId: ID,
        req: expect.objectContaining({ url: 'http://127.0.0.1:11999/v1/models' }),
      }),
    ])
    await expect(host.listProviderModels(ID, 'hello-local')).resolves.toEqual([
      { id: 'hello-1', displayName: 'Hello 1' },
    ])
  })
})
