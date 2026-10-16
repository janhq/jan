import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@janhq/tauri-plugin-websearch-api', () => ({
  webSearch: vi.fn().mockResolvedValue([]),
  webFetch: vi.fn().mockResolvedValue({
    url: 'https://example.com',
    title: 'Example',
    content: 'body',
    truncated: false,
  }),
}))

vi.mock('@/hooks/useWebSearchConfig', () => ({
  useWebSearchConfig: { getState: vi.fn() },
}))

vi.mock('@/hooks/useProxyConfig', () => ({
  useProxyConfig: { getState: vi.fn() },
}))

import { webSearch, webFetch } from '@janhq/tauri-plugin-websearch-api'
import { useWebSearchConfig } from '@/hooks/useWebSearchConfig'
import { useProxyConfig } from '@/hooks/useProxyConfig'
import { executeWebTool } from './webSearchTool'

const noProxyState = {
  proxyEnabled: false,
  proxyUrl: '',
  proxyUsername: '',
  proxyPassword: '',
  proxyIgnoreSSL: false,
  noProxy: '',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useWebSearchConfig.getState).mockReturnValue({
    apiKeys: {},
    endpoints: {},
    searchProvider: 'exa',
  } as any)
  vi.mocked(useProxyConfig.getState).mockReturnValue(noProxyState as any)
})

describe('executeWebTool', () => {
  it('does not pass a proxy when the proxy setting is disabled', async () => {
    await executeWebTool('web_search', { query: 'hello' })

    expect(webSearch).toHaveBeenCalledWith(
      'hello',
      undefined,
      undefined,
      'exa',
      undefined,
      undefined
    )
  })

  it('forwards the configured proxy to web_search', async () => {
    vi.mocked(useProxyConfig.getState).mockReturnValue({
      ...noProxyState,
      proxyEnabled: true,
      proxyUrl: 'http://proxy.internal:8080',
      proxyUsername: 'alice',
      proxyPassword: 'secret',
      noProxy: 'localhost, 127.0.0.1',
    } as any)

    await executeWebTool('web_search', { query: 'hello' })

    expect(webSearch).toHaveBeenCalledWith('hello', undefined, undefined, 'exa', undefined, {
      url: 'http://proxy.internal:8080',
      username: 'alice',
      password: 'secret',
      no_proxy: ['localhost', '127.0.0.1'],
      ignore_ssl: undefined,
    })
  })

  it('forwards the configured proxy to web_fetch', async () => {
    vi.mocked(useProxyConfig.getState).mockReturnValue({
      ...noProxyState,
      proxyEnabled: true,
      proxyUrl: 'http://proxy.internal:8080',
    } as any)

    await executeWebTool('web_fetch', { url: 'https://example.com' })

    expect(webFetch).toHaveBeenCalledWith(
      'https://example.com',
      undefined,
      'exa',
      undefined,
      {
        url: 'http://proxy.internal:8080',
        username: undefined,
        password: undefined,
        no_proxy: undefined,
        ignore_ssl: undefined,
      }
    )
  })

  it('treats an enabled proxy with no URL as unset', async () => {
    vi.mocked(useProxyConfig.getState).mockReturnValue({
      ...noProxyState,
      proxyEnabled: true,
      proxyUrl: '',
    } as any)

    await executeWebTool('web_search', { query: 'hello' })

    expect(webSearch).toHaveBeenCalledWith(
      'hello',
      undefined,
      undefined,
      'exa',
      undefined,
      undefined
    )
  })
})
