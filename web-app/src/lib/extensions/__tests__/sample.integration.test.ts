// The built hello-provider sample (extensions-samples/hello-provider, built
// by vitest.global-setup.mjs) through the same path the app runs: the real
// ExtensionHost composes it with the real prelude, and every call it makes
// goes through the real dispatcher into the real contribution and settings
// stores. Only the Worker is swapped for the node:vm sandbox, and the
// plugin's network commands, keyring and toasts for fakes.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateManifest, type ValidatedManifest } from '@janhq/extension-api'
import {
  runInSandbox,
  type SandboxWorker,
} from '@janhq/extension-runtime/testing'
import { ExtensionHost } from '../host'
import { extensionProviderName, listExtensionProviders } from '../providers'
import { listExtensionTools, toolWireName } from '../tools'
import { fakeHttp } from './fake-http'
import { memoryAppSettings, memorySecrets } from './memory'

// A path, not import.meta.url: under jsdom that URL is not a file: URL.
const SAMPLE = resolve(
  __dirname,
  '../../../../../extensions-samples/hello-provider'
)
const ID = 'jan-samples.hello-provider'

function loadSample(): { manifest: ValidatedManifest; bundle: string } {
  const result = validateManifest(
    JSON.parse(readFileSync(join(SAMPLE, 'package.json'), 'utf8'))
  )
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  return {
    manifest: result.manifest,
    bundle: readFileSync(join(SAMPLE, result.manifest.main), 'utf8'),
  }
}

let host: ExtensionHost
let worker: SandboxWorker | undefined
let notify: ReturnType<typeof vi.fn>
let server: ReturnType<typeof fakeHttp>

beforeEach(async () => {
  notify = vi.fn()
  server = fakeHttp(({ url }) =>
    url.endsWith('/chat/completions')
      ? {
          headers: { 'content-type': 'text/event-stream' },
          chunks: ['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', 'data: [DONE]\n\n'],
        }
      : { body: '{"data":[]}' }
  )
  worker = undefined
  host = new ExtensionHost({
    appSettings: memoryAppSettings(),
    secrets: memorySecrets(),
    notify,
    http: server.http,
    createWorker: (source, name) => {
      worker = runInSandbox(source, { name })
      return worker
    },
  })
  const { manifest, bundle } = loadSample()
  const hosted = await host.spawnWorkerExtension({
    manifest,
    bundle,
    // What a consent dialog would grant: everything requested.
    grants: manifest.permissions,
    source: 'installed',
  })
  expect(hosted).toMatchObject({ id: ID, state: 'active', source: 'installed' })
})

afterEach(async () => {
  await host.deactivateAll()
  // Nothing the sample did may have reached a network global in the worker.
  expect(worker?.leaks).toEqual([])
  vi.restoreAllMocks()
})

const statusText = () =>
  host.contributions.getState().statusItems[ID]?.['hello.status']?.text

describe('hello-provider sample in a worker', () => {
  it('registers every contribution with the host', async () => {
    const state = host.contributions.getState()
    expect(state.extensions[ID]).toEqual({ displayName: 'Hello Provider' })
    expect(state.commands[ID]['hello.greet'].handler).toBeTypeOf('function')
    expect(state.commands[ID]['hello.ping'].handler).toBeTypeOf('function')
    expect(state.settings[ID].map((s) => s.key)).toEqual(['greeting'])
    expect(statusText()).toBe('Hello (0)')

    expect(listExtensionTools(state)).toMatchObject([
      {
        wireName: toolWireName(ID, 'echo_upper'),
        extensionId: ID,
        name: 'echo_upper',
        server: `ext:${ID}`,
      },
    ])
    expect(listExtensionProviders(state)).toEqual([
      {
        extensionId: ID,
        contribution: {
          id: 'hello-local',
          displayName: 'Hello Local',
          baseUrl: 'http://127.0.0.1:11999/v1',
        },
      },
    ])
    expect(extensionProviderName(ID, 'hello-local')).toBe(
      'jan-samples.hello-provider/hello-local'
    )
    await expect(host.listProviderModels(ID, 'hello-local')).resolves.toEqual([
      { id: 'hello-1', displayName: 'Hello 1' },
    ])
    expect(host.dispatcher.has(ID, 'network:127.0.0.1')).toBe(true)
  })

  it('hello.greet notifies and updates the status item', async () => {
    await expect(
      host.contributions.executeCommand(ID, 'hello.greet', {
        location: 'commandPalette',
      })
    ).resolves.toBe('Hello from Hello Provider!')
    await vi.waitFor(() => expect(statusText()).toBe('Hello (1)'))
    await vi.waitFor(() =>
      expect(notify).toHaveBeenCalledWith({
        extensionName: 'Hello Provider',
        level: 'info',
        message: 'Hello from Hello Provider!',
      })
    )
  })

  it('follows a greeting change made in the host settings store', async () => {
    await host.settings.setSettingValue(ID, 'greeting', 'Hola')
    await vi.waitFor(() => expect(statusText()).toBe('Hola (0)'))
    await expect(
      host.contributions.executeCommand(ID, 'hello.greet', {
        location: 'statusItem',
      })
    ).resolves.toBe('Hola from Hello Provider!')
    await vi.waitFor(() => expect(statusText()).toBe('Hola (1)'))
  })

  it('echo_upper answers through callTool', async () => {
    await expect(
      host.callTool(ID, 'echo_upper', { text: 'hello jan' })
    ).resolves.toEqual({ content: [{ type: 'text', text: 'HELLO JAN' }] })
    await expect(
      host.callTool(ID, 'echo_upper', { text: 42 })
    ).resolves.toMatchObject({ error: expect.stringContaining('Expected') })
  })

  it('echo_upper is cancelled inside the worker when the chat stops', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const stop = new AbortController()
    const pending = host.callTool(
      ID,
      'echo_upper',
      { text: 'slow', delayMs: 10_000 },
      { signal: stop.signal }
    )
    await new Promise((r) => setTimeout(r, 20))
    stop.abort()
    await expect(pending).resolves.toMatchObject({
      error: expect.stringMatching(/cancel/i),
    })
    // The worker heard the cancellation and gave up its timer, rather than
    // the host merely ceasing to wait.
    await vi.waitFor(() =>
      expect(info).toHaveBeenCalledWith(`[ext:${ID}]`, 'echo_upper cancelled')
    )
  })

  it('reaches the network through the plugin, and nothing outside its grants', async () => {
    await expect(
      host.contributions.executeCommand(ID, 'hello.ping', {
        location: 'commandPalette',
      })
    ).resolves.toBe(200)
    expect(server.sent).toEqual([
      expect.objectContaining({
        extensionId: ID,
        req: expect.objectContaining({
          url: 'http://127.0.0.1:11999/v1/models',
          method: 'GET',
        }),
      }),
    ])
    await expect(
      host.contributions.executeCommand(
        ID,
        'hello.ping',
        { location: 'commandPalette' },
        'https://example.com'
      )
    ).rejects.toMatchObject({ code: 'E_PERMISSION' })
    expect(server.sent).toHaveLength(1)
  })

  it('streams provider inference through the plugin', async () => {
    const fetch = host.providerFetch(ID, 'stream')
    expect(fetch).toBeTypeOf('function')
    const response = await fetch!(
      'http://127.0.0.1:11999/v1/chat/completions',
      { method: 'POST', body: '{"model":"hello-1","stream":true}' }
    )
    expect(await response.text()).toContain('"content":"hi"')
    expect(server.http.httpFetchStream).toHaveBeenCalledTimes(1)
    await host.terminate(ID)
    expect(host.providerFetch(ID, 'stream')).toBeUndefined()
  })

  it('terminate releases every registration', async () => {
    await host.terminate(ID)
    const state = host.contributions.getState()
    expect(state.commands[ID]).toBeUndefined()
    expect(state.tools[ID]).toBeUndefined()
    expect(state.providers[ID]).toBeUndefined()
    expect(worker?.terminated).toBe(true)
  })
})
