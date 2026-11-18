import { describe, expect, it, vi } from 'vitest'
import {
  fetchWithoutTauriWebviewOrigin,
  headersWithoutTauriWebviewOrigin,
  isTauriWebviewOrigin,
} from '../omitTauriWebviewOrigin'

describe('isTauriWebviewOrigin', () => {
  it('detects the Tauri webview host', () => {
    expect(isTauriWebviewOrigin('http://tauri.localhost')).toBe(true)
    expect(isTauriWebviewOrigin('https://tauri.localhost')).toBe(true)
    expect(isTauriWebviewOrigin('http://tauri.localhost:1420')).toBe(true)
    expect(isTauriWebviewOrigin('tauri://localhost')).toBe(true)
    expect(isTauriWebviewOrigin('null')).toBe(true)
    expect(isTauriWebviewOrigin('http://tauri.localhost/index.html')).toBe(true)
  })

  it('leaves real provider origins alone', () => {
    expect(isTauriWebviewOrigin('https://api.openai.com')).toBe(false)
    expect(isTauriWebviewOrigin('http://localhost:11434')).toBe(false)
    expect(isTauriWebviewOrigin('')).toBe(false)
  })
})

describe('headersWithoutTauriWebviewOrigin', () => {
  it('sets empty Origin so plugin-http omits the webview host', () => {
    const headers = headersWithoutTauriWebviewOrigin({
      'Content-Type': 'application/json',
      Origin: 'http://tauri.localhost',
    }) as Record<string, string>
    expect(headers.Origin).toBe('')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('strips tauri://localhost Origin', () => {
    const headers = headersWithoutTauriWebviewOrigin({
      Origin: 'tauri://localhost',
    }) as Record<string, string>
    expect(headers.Origin).toBe('')
  })

  it('injects empty Origin when the caller omitted it', () => {
    const headers = headersWithoutTauriWebviewOrigin({
      Authorization: 'Bearer k',
    }) as Record<string, string>
    expect(headers.Origin).toBe('')
    expect(headers.Authorization).toBe('Bearer k')
  })

  it('keeps a non-webview Origin', () => {
    const headers = headersWithoutTauriWebviewOrigin({
      Origin: 'https://jan.ai',
    }) as Record<string, string>
    expect(headers.Origin).toBe('https://jan.ai')
  })

  it('drops a tauri.localhost Referer', () => {
    const headers = headersWithoutTauriWebviewOrigin({
      Referer: 'http://tauri.localhost/',
      'Content-Type': 'application/json',
    }) as Record<string, string>
    expect(headers.Referer).toBeUndefined()
    expect(headers.Origin).toBe('')
  })
})

describe('fetchWithoutTauriWebviewOrigin', () => {
  it('does not send Origin: http://tauri.localhost to the upstream fetch', async () => {
    const inner = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    const wrapped = fetchWithoutTauriWebviewOrigin(inner as unknown as typeof fetch)

    await wrapped('http://127.0.0.1:11434/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://tauri.localhost',
      },
      body: '{}',
    })

    expect(inner).toHaveBeenCalledTimes(1)
    const passed = inner.mock.calls[0][1]?.headers as Record<string, string>
    expect(passed.Origin).toBe('')
    expect(passed.Origin).not.toBe('http://tauri.localhost')
  })
})
