import { describe, it, expect, vi, beforeEach } from 'vitest'

const httpFetch = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: httpFetch }))

import { LOOPBACK_DIRECT_PROXY, loopbackFetch } from '../loopback-fetch'

describe('loopbackFetch', () => {
  beforeEach(() => httpFetch.mockReset())

  // The engine is on loopback; a system or env proxy must never see the
  // request, or a VPN or corporate proxy breaks local inference.
  it('exempts every loopback host from proxies and keeps the caller init', async () => {
    httpFetch.mockResolvedValue(new Response('{}'))
    const signal = new AbortController().signal

    await loopbackFetch('http://127.0.0.1:3000/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer k' },
      body: '{}',
      signal,
      connectTimeout: 5000,
    })

    const [url, init] = httpFetch.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:3000/v1/chat/completions')
    expect(init).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer k' },
      body: '{}',
      signal,
      connectTimeout: 5000,
      proxy: LOOPBACK_DIRECT_PROXY,
    })
    expect(init.proxy.all.noProxy.split(',')).toEqual(
      expect.arrayContaining(['localhost', '127.0.0.1', '::1'])
    )
  })

  it('cannot be talked into a proxy by the caller', async () => {
    httpFetch.mockResolvedValue(new Response('{}'))
    const init = { proxy: { all: 'http://evil:8080' } } as RequestInit

    await loopbackFetch('http://localhost:1/x', init)

    expect(httpFetch.mock.calls[0][1].proxy).toEqual(LOOPBACK_DIRECT_PROXY)
  })

  it('accepts every loopback spelling, as a string, URL or Request', async () => {
    httpFetch.mockResolvedValue(new Response('{}'))
    await loopbackFetch('http://localhost:1/x')
    await loopbackFetch(new URL('http://127.0.0.1:1/x'))
    await loopbackFetch(new Request('http://[::1]:1/x'))
    expect(httpFetch).toHaveBeenCalledTimes(3)
  })

  // The proxy bypass would otherwise send a remote request around the
  // user's proxy. 0.0.0.0 is a listen address, not a loopback host.
  it.each([
    'https://api.openai.com/v1/chat/completions',
    'http://0.0.0.0:1/x',
    'http://127.0.0.2:1/x',
    'http://localhost.evil.com/x',
    'not a url',
  ])('refuses %s without sending it', async (url) => {
    await expect(loopbackFetch(url)).rejects.toThrow(
      /loopbackFetch only reaches localhost, 127\.0\.0\.1 or \[::1\]/
    )
    expect(httpFetch).not.toHaveBeenCalled()
  })

  // A chat stream is consumed while the engine is still writing it.
  it('hands back the body as a stream before it has ended', async () => {
    const encoder = new TextEncoder()
    let push!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => void (push = controller),
    })
    httpFetch.mockResolvedValue(new Response(body))

    const response = await loopbackFetch('http://localhost:1/v1/chat/completions')
    const reader = response.body!.getReader()
    push.enqueue(encoder.encode('data: one\n\n'))
    const first = await reader.read()

    expect(new TextDecoder().decode(first.value)).toBe('data: one\n\n')
    push.close()
    expect((await reader.read()).done).toBe(true)
  })
})
