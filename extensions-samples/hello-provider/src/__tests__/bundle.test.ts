// The built dist/index.js (vitest.global-setup.mjs rebuilds it) against the
// bundle contract: one IIFE assigning `JanExtension`, nothing imported at
// runtime, and it boots behind the real prelude in the worker sandbox.
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateManifest, type ValidatedManifest } from '@janhq/extension-api'
import {
  Endpoint,
  assertBundleShape,
  composeWorkerSource,
  workerTransport,
  type ControlMessage,
} from '@janhq/extension-runtime'
import prelude from '@janhq/extension-runtime/prelude-source'
import { runInSandbox } from '@janhq/extension-runtime/testing'

const root = new URL('../../', import.meta.url)
const bundle = readFileSync(new URL('dist/index.js', root), 'utf8')
const validated = validateManifest(
  JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
)

function manifest(): ValidatedManifest {
  if (!validated.ok) throw new Error('invalid manifest')
  return validated.manifest
}

const hosts: Endpoint[] = []
afterEach(() => {
  for (const host of hosts.splice(0)) host.close()
})

describe('hello-provider bundle', () => {
  it('is a single IIFE with no runtime imports', () => {
    // The host refuses anything but one top-level `var JanExtension = ...`.
    expect(() => assertBundleShape(bundle)).not.toThrow()
    expect(bundle).toMatch(/^var JanExtension = \(function/m)
    expect(bundle).not.toMatch(/\bimport\s*[({"'*]|\brequire\s*\(|^export\b/m)
  })

  it('activates behind the real prelude without touching the network', async () => {
    const worker = runInSandbox(composeWorkerSource(prelude, bundle), {
      name: 'ext:jan-samples.hello-provider',
    })
    const controls: ControlMessage[] = []
    const methods: string[] = []
    let nextDisposable = 1
    const host = new Endpoint(workerTransport(worker), {
      onControl: (m) => controls.push(m),
      handle: async (method) => {
        methods.push(method)
        if (method.endsWith('.register') || method === 'events.subscribe')
          return { disposable: nextDisposable++ }
        if (method === 'settings.get') return 'Hello'
        return undefined
      },
    })
    hosts.push(host)
    host.sendControl({ v: 1, t: 'init', manifest: manifest() })
    await vi.waitFor(() =>
      expect(
        controls.find((m) => m.t === 'ready' || m.t === 'activateFailed')
      ).toEqual({ v: 1, t: 'ready' })
    )
    expect(methods.sort()).toEqual([
      'commands.register',
      'commands.register',
      'events.subscribe',
      'providers.register',
      'settings.get',
      'tools.register',
      'ui.setStatusItem',
    ])
    expect(worker.leaks).toEqual([])
  })
})
