/**
 * The guest-js of tauri-plugin-extensions against its Rust side: every
 * command in build.rs has a wrapper that sends the argument names the
 * command takes, and the host API version compiled into the plugin's
 * manifest validator is the one `@janhq/extension-api` ships.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { API_VERSION } from '@janhq/extension-api'

const invoke = vi.fn()
const channels: { onmessage?: (e: unknown) => void }[] = []

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  Channel: class {
    onmessage?: (e: unknown) => void
    constructor() {
      channels.push(this)
    }
  },
}))

import * as api from '@janhq/tauri-plugin-extensions-api'

const PLUGIN_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'src-tauri',
  'plugins',
  'tauri-plugin-extensions'
)

const COMMANDS = [
  ...readFileSync(join(PLUGIN_DIR, 'build.rs'), 'utf8').matchAll(/"([a-z_]+)"/g),
].map((m) => m[1])

describe('@janhq/tauri-plugin-extensions-api', () => {
  beforeEach(() => {
    invoke.mockReset()
    invoke.mockResolvedValue(undefined)
    channels.length = 0
  })

  it('wraps every command with the arguments the Rust side takes', async () => {
    const req = { url: 'https://api.example.com/' }
    const calls: [() => Promise<unknown>, string, Record<string, unknown> | undefined][] = [
      [() => api.stageBundle('/x.tgz'), 'stage_bundle', { path: '/x.tgz' }],
      [() => api.confirmInstall('s', ['ui:notify']), 'confirm_install', { stageId: 's', granted: ['ui:notify'] }],
      [() => api.discardStage('s'), 'discard_stage', { stageId: 's' }],
      [() => api.list(), 'list', undefined],
      [() => api.setEnabled('a.bc', false), 'set_enabled', { id: 'a.bc', enabled: false }],
      [() => api.setGrants('a.bc', []), 'set_grants', { id: 'a.bc', granted: [] }],
      [() => api.uninstall('a.bc'), 'uninstall', { id: 'a.bc' }],
      [() => api.rollback('a.bc'), 'rollback', { id: 'a.bc' }],
      [() => api.readEntry('a.bc'), 'read_entry', { id: 'a.bc' }],
      [() => api.setSafeMode(true), 'set_safe_mode', { on: true }],
      [() => api.httpFetch('a.bc', req, 'r1'), 'http_fetch', { id: 'a.bc', req, requestId: 'r1' }],
      [() => api.httpCancel('a.bc', 'r1'), 'http_cancel', { id: 'a.bc', requestId: 'r1' }],
    ]
    for (const [call, command, args] of calls) {
      invoke.mockClear()
      await call()
      const sent = args === undefined ? [`plugin:extensions|${command}`] : [`plugin:extensions|${command}`, args]
      expect(invoke).toHaveBeenCalledWith(...sent)
    }
    const covered = new Set([...calls.map(([, c]) => c), 'http_fetch_stream'])
    expect([...COMMANDS].sort()).toEqual([...covered].sort())
  })

  it('streams through a channel', async () => {
    const events: unknown[] = []
    invoke.mockImplementation(async () => {
      channels[0].onmessage?.({ event: 'head', status: 200, headers: {} })
      channels[0].onmessage?.({ event: 'end' })
      return 200
    })
    const req = { url: 'https://api.example.com/', method: 'POST' as const }
    const status = await api.httpFetchStream('a.bc', 'r1', req, (e) => events.push(e))
    expect(status).toBe(200)
    expect(invoke).toHaveBeenCalledWith('plugin:extensions|http_fetch_stream', {
      id: 'a.bc',
      requestId: 'r1',
      req,
      onEvent: channels[0],
    })
    expect(events).toEqual([{ event: 'head', status: 200, headers: {} }, { event: 'end' }])
  })

  it('compiles the host API version @janhq/extension-api ships', () => {
    const manifest = readFileSync(join(PLUGIN_DIR, 'src', 'manifest.rs'), 'utf8')
    const host = /pub const HOST_API_VERSION: &str = "([^"]+)";/.exec(manifest)?.[1]
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'packages', 'extension-api', 'package.json'), 'utf8')
    ) as { version: string }
    expect(host).toBe(API_VERSION)
    expect(host).toBe(pkg.version)
  })
})
