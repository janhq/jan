import { describe, expect, it, vi } from 'vitest'
import type { HttpRequestInit, PermissionString } from '@janhq/extension-api'
import { ContributionStore } from '../contributions'
import { PermissionDispatcher } from '../dispatcher'
import { MAX_CONCURRENT_FETCHES, createHostApi } from '../host-api'
import {
  MAX_REDIRECTS,
  MAX_UNREAD_BYTES,
  createProviderFetch,
  type ExtensionHttp,
} from '../http'
import { ExtensionSettingsStore } from '../settings-store'
import { fakeHttp, redirectTo, type FakeReply } from './fake-http'
import { manifest } from './fixtures'
import { memoryAppSettings, memorySecrets } from './memory'

const LOCAL_API_PORT = 1337
const ID = 'acme.net'

function dispatcherFor(grants: PermissionString[]) {
  const dispatcher = new PermissionDispatcher(() => LOCAL_API_PORT)
  dispatcher.grant(ID, grants)
  return dispatcher
}

function setup(grants: PermissionString[], http: ExtensionHttp | undefined) {
  const m = manifest(ID, { permissions: grants })
  const dispatcher = dispatcherFor(grants)
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
  return (url: string, init?: HttpRequestInit, signal?: AbortSignal) =>
    dispatcher.dispatch(m, api, 'http.fetch', init ? [url, init] : [url], {
      signal,
    })
}

describe('ctx.http.fetch', () => {
  it('goes through the plugin and checks every redirect hop against the grants', async () => {
    const server = fakeHttp(({ url }) =>
      url === 'https://a.acme.dev/start'
        ? redirectTo(302, 'https://b.acme.dev/next')
        : url === 'https://b.acme.dev/next'
          ? redirectTo(307, 'https://evil.dev/steal')
          : { body: 'unreachable' }
    )
    const call = setup(['network:*.acme.dev'], server.http)
    await expect(call('https://a.acme.dev/start')).rejects.toMatchObject({
      code: 'E_PERMISSION',
    })
    expect(server.urls()).toEqual([
      'https://a.acme.dev/start',
      'https://b.acme.dev/next',
    ])
    // Each hop names the extension, so Rust re-checks its own grants too,
    // and carries a request id it can be cancelled by.
    for (const s of server.sent) {
      expect(s.extensionId).toBe(ID)
      expect(s.requestId).toMatch(/^[\w-]{1,64}$/)
    }
  })

  it('refuses a 307 to the local API server port', async () => {
    const server = fakeHttp(({ url }) =>
      url === 'http://127.0.0.1:8080/x'
        ? redirectTo(307, `http://127.0.0.1:${LOCAL_API_PORT}/v1/chat/completions`)
        : { body: 'proxied with the user keys' }
    )
    const call = setup(['network:127.0.0.1'], server.http)
    await expect(
      call('http://127.0.0.1:8080/x', { method: 'POST', body: '{}' })
    ).rejects.toMatchObject({ code: 'E_PERMISSION' })
    expect(server.urls()).toEqual(['http://127.0.0.1:8080/x'])
  })

  it('returns the final response of an allowed redirect chain', async () => {
    const server = fakeHttp(({ url }) =>
      url.endsWith('/old')
        ? redirectTo(301, '/new')
        : { body: 'hello', headers: { 'x-a': '1' } }
    )
    const call = setup(['network:api.acme.dev'], server.http)
    await expect(call('https://api.acme.dev/old')).resolves.toEqual({
      status: 200,
      headers: { 'x-a': '1' },
      body: 'hello',
    })
    expect(server.urls()).toEqual([
      'https://api.acme.dev/old',
      'https://api.acme.dev/new',
    ])
  })

  it('never sends or returns cookies and drops credentials across origins', async () => {
    const server = fakeHttp(({ url }) =>
      url === 'https://a.acme.dev/'
        ? redirectTo(302, 'https://b.acme.dev/')
        : { body: 'ok', headers: { 'Set-Cookie': 'sid=1' } }
    )
    const call = setup(['network:*.acme.dev'], server.http)
    const response = await call('https://a.acme.dev/', {
      headers: {
        Cookie: 'sid=0',
        cookie2: 'x',
        Authorization: 'Bearer t',
        'X-Key': 'k',
      },
    })
    expect(response.headers['set-cookie']).toBeUndefined()
    const [first, second] = server.headers()
    for (const h of [first, second]) {
      expect(h.cookie).toBeUndefined()
      expect(h.cookie2).toBeUndefined()
    }
    expect(first.authorization).toBe('Bearer t')
    expect(second.authorization).toBeUndefined()
    expect(second['x-key']).toBeUndefined()
  })

  it('keeps only CORS-safelisted headers across a cross-origin redirect', async () => {
    const server = fakeHttp(({ url }) =>
      url === 'https://a.acme.dev/'
        ? redirectTo(307, 'https://b.acme.dev/')
        : url === 'https://b.acme.dev/'
          ? redirectTo(307, 'https://b.acme.dev/same')
          : { body: 'ok' }
    )
    const call = setup(['network:*.acme.dev'], server.http)
    await call('https://a.acme.dev/', {
      method: 'POST',
      body: '{}',
      headers: {
        'X-Api-Key': 'k',
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Accept-Language': 'en',
      },
    })
    const [first, second, third] = server.headers()
    expect(first['x-api-key']).toBe('k')
    for (const h of [second, third]) {
      expect(h['x-api-key']).toBeUndefined()
      expect(h.accept).toBe('application/json')
      expect(h['content-type']).toBe('application/json')
      expect(h['accept-language']).toBe('en')
    }
    // A 307 keeps the method and body.
    expect(server.sent.map((s) => [s.req.method, s.req.body])).toEqual([
      ['POST', '{}'],
      ['POST', '{}'],
      ['POST', '{}'],
    ])
  })

  it('turns a 303 into a GET without a body', async () => {
    const server = fakeHttp(({ url }) =>
      url.endsWith('/form') ? redirectTo(303, '/done') : { body: 'ok' }
    )
    const call = setup(['network:api.acme.dev'], server.http)
    await call('https://api.acme.dev/form', { method: 'POST', body: 'a=1' })
    expect(server.sent[1].req).toMatchObject({ method: 'GET' })
    expect(server.sent[1].req.body).toBeUndefined()
  })

  it('runs at most MAX_CONCURRENT_FETCHES requests per extension at once', async () => {
    const release: (() => void)[] = []
    const server = fakeHttp(
      () => new Promise<FakeReply>((resolve) => release.push(() => resolve({ body: 'ok' })))
    )
    const call = setup(['network:api.acme.dev'], server.http)
    const running = Array.from({ length: MAX_CONCURRENT_FETCHES }, () =>
      call('https://api.acme.dev/')
    )
    await expect(call('https://api.acme.dev/')).rejects.toMatchObject({
      code: 'E_TOO_LARGE',
    })
    expect(server.http.httpFetch).toHaveBeenCalledTimes(MAX_CONCURRENT_FETCHES)
    for (const r of release) r()
    await Promise.all(running)
  })

  it('cancels the plugin request when the caller cancels', async () => {
    const server = fakeHttp(() => ({ hang: true }))
    const call = setup(['network:api.acme.dev'], server.http)
    const controller = new AbortController()
    const pending = call('https://api.acme.dev/', undefined, controller.signal)
    await vi.waitFor(() => expect(server.sent).toHaveLength(1))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'E_CANCELLED' })
    expect(server.http.httpCancel).toHaveBeenCalledWith(
      ID,
      server.sent[0].requestId
    )
    // Already cancelled: nothing is sent at all.
    await expect(
      call('https://api.acme.dev/', undefined, controller.signal)
    ).rejects.toMatchObject({ code: 'E_CANCELLED' })
    expect(server.sent).toHaveLength(1)
  })

  it('does not send the next hop once the caller cancelled after a redirect', async () => {
    const controller = new AbortController()
    const server = fakeHttp(({ url }) => {
      if (url.endsWith('/old')) {
        // The worker cancels while the redirect is on its way back.
        controller.abort()
        return redirectTo(302, '/new')
      }
      return { body: 'ok' }
    })
    const call = setup(['network:api.acme.dev'], server.http)
    await expect(
      call('https://api.acme.dev/old', undefined, controller.signal)
    ).rejects.toMatchObject({ code: 'E_CANCELLED' })
    expect(server.urls()).toEqual(['https://api.acme.dev/old'])
  })

  it('reports what the plugin refuses with the matching error code', async () => {
    const http = fakeHttp(() => ({})).http
    http.httpFetch.mockRejectedValueOnce({ kind: 'denied', message: 'revoked' })
    http.httpFetch.mockRejectedValueOnce({ kind: 'tooLarge', message: 'big' })
    http.httpFetch.mockRejectedValueOnce({ kind: 'network', message: 'down' })
    const call = setup(['network:api.acme.dev'], http)
    await expect(call('https://api.acme.dev/')).rejects.toMatchObject({
      code: 'E_PERMISSION',
      message: 'revoked',
    })
    await expect(call('https://api.acme.dev/')).rejects.toMatchObject({
      code: 'E_TOO_LARGE',
    })
    await expect(call('https://api.acme.dev/')).rejects.toMatchObject({
      code: 'E_INTERNAL',
      message: 'down',
    })
  })

  it('stops after too many redirects', async () => {
    let n = 0
    const server = fakeHttp(() => redirectTo(302, `https://api.acme.dev/${++n}`))
    const call = setup(['network:api.acme.dev'], server.http)
    await expect(call('https://api.acme.dev/0')).rejects.toMatchObject({
      code: 'E_INVALID_ARGS',
    })
    expect(server.sent).toHaveLength(MAX_REDIRECTS + 1)
  })

  it('is not available without the plugin path (built-ins, development folders)', async () => {
    const call = setup(['network:api.acme.dev'], undefined)
    await expect(call('https://api.acme.dev/')).rejects.toMatchObject({
      code: 'E_NOT_FOUND',
      message: expect.stringContaining('installed extensions'),
    })
  })
})

describe('createProviderFetch', () => {
  const SSE = [
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
    'data: [DONE]\n\n',
  ]

  function providerFetch(
    grants: PermissionString[],
    answer: Parameters<typeof fakeHttp>[0],
    stopped?: AbortSignal,
    mode: 'stream' | 'whole' = 'stream'
  ) {
    const server = fakeHttp(answer)
    const dispatcher = dispatcherFor(grants)
    const fetch = createProviderFetch({
      extensionId: ID,
      http: server.http,
      checkUrl: (url) => dispatcher.checkUrl(ID, url),
      stopped,
      mode,
    })
    return { server, fetch }
  }

  it('reads a whole response through httpFetch, checking every hop, in whole mode', async () => {
    const { server, fetch } = providerFetch(
      ['network:api.acme.dev'],
      ({ url }) =>
        url.endsWith('/old')
          ? redirectTo(308, '/v1/models')
          : { body: '{"data":[]}', headers: { 'content-type': 'application/json' } },
      undefined,
      'whole'
    )
    const response = await fetch('https://api.acme.dev/old', {
      headers: { Authorization: 'Bearer k' },
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{"data":[]}')
    expect(server.urls()).toEqual([
      'https://api.acme.dev/old',
      'https://api.acme.dev/v1/models',
    ])
    expect(server.http.httpFetchStream).not.toHaveBeenCalled()
    for (const s of server.sent) expect(s.requestId).toMatch(/^[\w-]{1,64}$/)
  })

  it('cancels a whole-mode request in Rust when the caller aborts', async () => {
    const { server, fetch } = providerFetch(
      ['network:api.acme.dev'],
      () => ({ hang: true }),
      undefined,
      'whole'
    )
    const controller = new AbortController()
    const pending = fetch('https://api.acme.dev/v1/models', {
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(server.sent).toHaveLength(1))
    controller.abort()
    await expect(pending).rejects.toBeDefined()
    expect(server.http.httpCancel).toHaveBeenCalledWith(ID, server.sent[0].requestId)
  })

  it('does not need AbortSignal.any to combine the caller and stop signals', async () => {
    const any = vi.spyOn(AbortSignal, 'any').mockImplementation(() => {
      throw new TypeError('AbortSignal.any is not a function')
    })
    try {
      const stopped = new AbortController()
      const { server, fetch } = providerFetch(
        ['network:127.0.0.1'],
        () => ({ hang: true }),
        stopped.signal
      )
      const controller = new AbortController()
      const pending = fetch('http://127.0.0.1:11999/v1/models', {
        signal: controller.signal,
      })
      await vi.waitFor(() => expect(server.sent).toHaveLength(1))
      controller.abort()
      await expect(pending).rejects.toBeDefined()
      expect(server.http.httpCancel).toHaveBeenCalledWith(
        ID,
        server.sent[0].requestId
      )
    } finally {
      any.mockRestore()
    }
  })

  it('cancels the stream when the Response cannot be built from the head', async () => {
    const { server, fetch } = providerFetch(['network:127.0.0.1'], () => ({
      // Rust decodes header values lossily; a U+FFFD is not Latin-1.
      headers: { 'x-name': 'caf\uFFFD' },
      chunks: ['data: 1\n\n', 'data: 2\n\n'],
    }))
    await expect(
      fetch('http://127.0.0.1:11999/v1/chat/completions')
    ).rejects.toBeInstanceOf(TypeError)
    expect(server.http.httpCancel).toHaveBeenCalledWith(ID, server.sent[0].requestId)
  })

  it('cancels a stream nobody reads once too much is buffered', async () => {
    const { server, fetch } = providerFetch(['network:127.0.0.1'], () => ({
      chunks: ['x'.repeat(MAX_UNREAD_BYTES), 'x'],
    }))
    const response = await fetch('http://127.0.0.1:11999/v1/chat/completions')
    await vi.waitFor(() =>
      expect(server.http.httpCancel).toHaveBeenCalledWith(
        ID,
        server.sent[0].requestId
      )
    )
    await expect(response.text()).rejects.toMatchObject({ code: 'E_TOO_LARGE' })
  })

  it('streams the body back as a web Response the AI SDK can read', async () => {
    const { server, fetch } = providerFetch(['network:127.0.0.1'], () => ({
      headers: { 'content-type': 'text/event-stream' },
      chunks: SSE,
    }))
    const response = await fetch('http://127.0.0.1:11999/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer k', 'Content-Type': 'application/json' },
      body: '{"stream":true}',
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(await response.text()).toBe(SSE.join(''))
    expect(server.sent).toEqual([
      expect.objectContaining({
        extensionId: ID,
        req: expect.objectContaining({
          url: 'http://127.0.0.1:11999/v1/chat/completions',
          method: 'POST',
          body: '{"stream":true}',
        }),
      }),
    ])
    expect(server.http.httpFetch).not.toHaveBeenCalled()
  })

  it('refuses a 307 to the local API server port without following it', async () => {
    const { server, fetch } = providerFetch(['network:127.0.0.1'], ({ url }) =>
      url.includes(':11999')
        ? redirectTo(307, `http://127.0.0.1:${LOCAL_API_PORT}/v1/chat/completions`)
        : { chunks: ['proxied'] }
    )
    await expect(
      fetch('http://127.0.0.1:11999/v1/chat/completions', {
        method: 'POST',
        body: '{}',
      })
    ).rejects.toMatchObject({ code: 'E_PERMISSION' })
    expect(server.urls()).toEqual(['http://127.0.0.1:11999/v1/chat/completions'])
  })

  it('checks the first URL before anything is sent', async () => {
    const { server, fetch } = providerFetch(['network:api.acme.dev'], () => ({}))
    await expect(fetch('https://evil.dev/v1/models')).rejects.toMatchObject({
      code: 'E_PERMISSION',
    })
    expect(server.sent).toEqual([])
  })

  it('never sends a Cookie and keeps the key with the first origin', async () => {
    const { server, fetch } = providerFetch(['network:*.acme.dev'], ({ url }) =>
      url === 'https://a.acme.dev/v1/models'
        ? redirectTo(308, 'https://b.acme.dev/v1/models')
        : { body: '{"data":[]}', headers: { 'set-cookie': 'sid=1' } }
    )
    const response = await fetch('https://a.acme.dev/v1/models', {
      headers: { Authorization: 'Bearer k', Cookie: 'sid=0' },
    })
    expect(response.headers.get('set-cookie')).toBeNull()
    const [first, second] = server.headers()
    expect(first.cookie).toBeUndefined()
    expect(second.cookie).toBeUndefined()
    expect(first.authorization).toBe('Bearer k')
    expect(second.authorization).toBeUndefined()
  })

  it('cancels the request in Rust when the caller aborts mid-stream', async () => {
    const { server, fetch } = providerFetch(['network:127.0.0.1'], () => ({
      chunks: SSE,
    }))
    const controller = new AbortController()
    const response = await fetch('http://127.0.0.1:11999/v1/chat/completions', {
      method: 'POST',
      body: '{}',
      signal: controller.signal,
    })
    const reader = response.body!.getReader()
    await reader.read()
    controller.abort()
    await expect(reader.read()).rejects.toBeDefined()
    expect(server.http.httpCancel).toHaveBeenCalledWith(ID, server.sent[0].requestId)
  })

  it('cancels a pending request when the extension stops', async () => {
    const stopped = new AbortController()
    const { server, fetch } = providerFetch(
      ['network:127.0.0.1'],
      () => ({ hang: true }),
      stopped.signal
    )
    const pending = fetch('http://127.0.0.1:11999/v1/models')
    await vi.waitFor(() => expect(server.sent).toHaveLength(1))
    stopped.abort()
    await expect(pending).rejects.toBeDefined()
    expect(server.http.httpCancel).toHaveBeenCalledWith(ID, server.sent[0].requestId)
  })

  it('surfaces an error after the head as a failed body read', async () => {
    const { server, fetch } = providerFetch(['network:127.0.0.1'], () => ({}))
    server.http.httpFetchStream.mockImplementationOnce(
      async (_id, _requestId, _req, onEvent) => {
        onEvent({ event: 'head', status: 200, headers: {} })
        onEvent({ event: 'chunk', data: 'data: 1\n\n' })
        onEvent({ event: 'error', kind: 'network', message: 'the stream stalled' })
        return 200
      }
    )
    const response = await fetch('http://127.0.0.1:11999/v1/chat/completions')
    await expect(response.text()).rejects.toMatchObject({
      message: 'the stream stalled',
    })
  })
})
