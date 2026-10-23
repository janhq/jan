import { describe, expect, it, vi } from 'vitest'
import type { PermissionString } from '@janhq/extension-api'
import { ContributionStore } from '../contributions'
import { PermissionDispatcher } from '../dispatcher'
import {
  MAX_RESPONSE_BYTES,
  createHostApi,
  type FetchLike,
} from '../host-api'
import { ExtensionSettingsStore } from '../settings-store'
import { manifest } from './fixtures'
import { memoryAppSettings, memorySecrets } from './memory'

function setup(grants: PermissionString[], fetch: FetchLike) {
  const m = manifest('acme.net', { permissions: grants })
  const dispatcher = new PermissionDispatcher()
  dispatcher.grant(m.id, grants)
  const api = createHostApi(m, {
    dispatcher,
    contributions: new ContributionStore(),
    settings: new ExtensionSettingsStore({
      appSettings: memoryAppSettings(),
      secrets: memorySecrets(),
    }),
    storage: memoryAppSettings(),
    notify: vi.fn(),
    fetch,
  })
  return (url: string, init?: Parameters<typeof api['http.fetch']>[1]) =>
    dispatcher.dispatch(m, api, 'http.fetch', init ? [url, init] : [url])
}

const redirect = (status: number, location: string) =>
  new Response(null, { status, headers: { location } })

describe('ctx.http.fetch', () => {
  it('follows redirects itself and checks every hop against the grants', async () => {
    const fetch = vi.fn<FetchLike>(async (url) =>
      url === 'https://a.acme.dev/start'
        ? redirect(302, 'https://b.acme.dev/next')
        : url === 'https://b.acme.dev/next'
          ? redirect(307, 'https://evil.dev/steal')
          : new Response('unreachable')
    )
    const call = setup(['network:*.acme.dev'], fetch)
    await expect(call('https://a.acme.dev/start')).rejects.toMatchObject({
      code: 'E_PERMISSION',
    })
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://a.acme.dev/start',
      'https://b.acme.dev/next',
    ])
    // The platform must never follow a redirect on its own.
    for (const [, init] of fetch.mock.calls) {
      expect(init.maxRedirections).toBe(0)
      expect(init.redirect).toBe('manual')
      expect(init.credentials).toBe('omit')
    }
  })

  it('returns the final response of an allowed redirect chain', async () => {
    const fetch = vi.fn<FetchLike>(async (url) =>
      url.endsWith('/old')
        ? redirect(301, '/new')
        : new Response('hello', { status: 200, headers: { 'x-a': '1' } })
    )
    const call = setup(['network:api.acme.dev'], fetch)
    await expect(call('https://api.acme.dev/old')).resolves.toEqual({
      status: 200,
      headers: { 'content-type': 'text/plain;charset=UTF-8', 'x-a': '1' },
      body: 'hello',
    })
  })

  it('never sends or returns cookies and drops credentials across origins', async () => {
    const fetch = vi.fn<FetchLike>(async (url) =>
      url === 'https://a.acme.dev/'
        ? redirect(302, 'https://b.acme.dev/')
        : new Response('ok', { headers: { 'set-cookie': 'sid=1' } })
    )
    const call = setup(['network:*.acme.dev'], fetch)
    const response = await call('https://a.acme.dev/', {
      headers: { Cookie: 'sid=0', Authorization: 'Bearer t', 'X-Key': 'k' },
    })
    expect(response.headers['set-cookie']).toBeUndefined()
    const [first, second] = fetch.mock.calls.map(
      ([, init]) => new Headers(init.headers)
    )
    expect(first.get('cookie')).toBeNull()
    expect(first.get('authorization')).toBe('Bearer t')
    expect(second.get('authorization')).toBeNull()
    expect(second.get('x-key')).toBe('k')
  })

  it('caps the response body at 10 MiB', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i <= MAX_RESPONSE_BYTES / chunk.length; i++)
          controller.enqueue(chunk)
        controller.close()
      },
    })
    const call = setup(['network:api.acme.dev'], async () => new Response(body))
    await expect(call('https://api.acme.dev/big')).rejects.toMatchObject({
      code: 'E_TOO_LARGE',
    })
  })

  it('stops after too many redirects', async () => {
    let n = 0
    const call = setup(['network:api.acme.dev'], async () =>
      redirect(302, `https://api.acme.dev/${++n}`)
    )
    await expect(call('https://api.acme.dev/0')).rejects.toMatchObject({
      code: 'E_INVALID_ARGS',
    })
  })
})
