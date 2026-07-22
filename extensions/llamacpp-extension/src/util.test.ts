import { beforeEach, describe, expect, it, vi } from 'vitest'
import { logger } from '@janhq/core'
import {
  buildEmbedBatches,
  detectMtpLayersFromGgufMeta,
  detectTemplateKwargsFromChatTemplate,
  estimateTokensFromText,
  getProxyConfig,
  truncateToTokenBudget,
} from './util'
import { getBackendSetting } from './backend-settings'

vi.mock('./backend-settings')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getBackendSetting).mockReset()
})

describe('getProxyConfig', async () => {
  it('should return null when no proxy configuration is stored', async () => {
    vi.mocked(getBackendSetting).mockResolvedValue(null)

    const result = await getProxyConfig()

    expect(result).toBeNull()
    expect(getBackendSetting).toHaveBeenCalledWith('setting-proxy-config')
  })

  it('should return null when proxy is disabled', async () => {
    const proxyConfig = {
      state: {
        proxyEnabled: false,
        proxyUrl: 'http://proxy.example.com:8080',
        proxyUsername: 'user',
        proxyPassword: 'pass',
        proxyIgnoreSSL: false,
        verifyProxySSL: true,
        verifyProxyHostSSL: true,
        verifyPeerSSL: true,
        verifyHostSSL: true,
        noProxy: 'localhost,127.0.0.1',
      },
      version: 0,
    }

    vi.mocked(getBackendSetting).mockResolvedValue(JSON.stringify(proxyConfig))

    const result = await getProxyConfig()

    expect(result).toBeNull()
  })

  it('should return null when proxy is enabled but no URL is provided', async () => {
    const proxyConfig = {
      state: {
        proxyEnabled: true,
        proxyUrl: '',
        proxyUsername: 'user',
        proxyPassword: 'pass',
        proxyIgnoreSSL: false,
        verifyProxySSL: true,
        verifyProxyHostSSL: true,
        verifyPeerSSL: true,
        verifyHostSSL: true,
        noProxy: '',
      },
      version: 0,
    }

    vi.mocked(getBackendSetting).mockResolvedValue(JSON.stringify(proxyConfig))

    const result = await getProxyConfig()

    expect(result).toBeNull()
  })

  it('should return basic proxy configuration with SSL settings', async () => {
    const proxyConfig = {
      state: {
        proxyEnabled: true,
        proxyUrl: 'https://proxy.example.com:8080',
        proxyUsername: '',
        proxyPassword: '',
        proxyIgnoreSSL: true,
        verifyProxySSL: false,
        verifyProxyHostSSL: false,
        verifyPeerSSL: true,
        verifyHostSSL: true,
        noProxy: '',
      },
      version: 0,
    }

    vi.mocked(getBackendSetting).mockResolvedValue(JSON.stringify(proxyConfig))

    const result = await getProxyConfig()

    expect(result).toEqual({
      url: 'https://proxy.example.com:8080',
      ignore_ssl: true,
      verify_proxy_ssl: false,
      verify_proxy_host_ssl: false,
      verify_peer_ssl: true,
      verify_host_ssl: true,
    })
  })

  it('should include authentication when both username and password are provided', async () => {
    const proxyConfig = {
      state: {
        proxyEnabled: true,
        proxyUrl: 'http://proxy.example.com:8080',
        proxyUsername: 'testuser',
        proxyPassword: 'testpass',
        proxyIgnoreSSL: false,
        verifyProxySSL: true,
        verifyProxyHostSSL: true,
        verifyPeerSSL: true,
        verifyHostSSL: true,
        noProxy: '',
      },
      version: 0,
    }

    vi.mocked(getBackendSetting).mockResolvedValue(JSON.stringify(proxyConfig))

    const result = await getProxyConfig()

    expect(result).toEqual({
      url: 'http://proxy.example.com:8080',
      username: 'testuser',
      password: 'testpass',
      ignore_ssl: false,
      verify_proxy_ssl: true,
      verify_proxy_host_ssl: true,
      verify_peer_ssl: true,
      verify_host_ssl: true,
    })
  })

  it('should not include authentication when only username is provided', async () => {
    const proxyConfig = {
      state: {
        proxyEnabled: true,
        proxyUrl: 'http://proxy.example.com:8080',
        proxyUsername: 'testuser',
        proxyPassword: '',
        proxyIgnoreSSL: false,
        verifyProxySSL: true,
        verifyProxyHostSSL: true,
        verifyPeerSSL: true,
        verifyHostSSL: true,
        noProxy: '',
      },
      version: 0,
    }

    vi.mocked(getBackendSetting).mockResolvedValue(JSON.stringify(proxyConfig))

    const result = await getProxyConfig()

    expect(result).toEqual({
      url: 'http://proxy.example.com:8080',
      ignore_ssl: false,
      verify_proxy_ssl: true,
      verify_proxy_host_ssl: true,
      verify_peer_ssl: true,
      verify_host_ssl: true,
    })
    expect(result?.username).toBeUndefined()
    expect(result?.password).toBeUndefined()
  })

  it('should not include authentication when only password is provided', async () => {
    const proxyConfig = {
      state: {
        proxyEnabled: true,
        proxyUrl: 'http://proxy.example.com:8080',
        proxyUsername: '',
        proxyPassword: 'testpass',
        proxyIgnoreSSL: false,
        verifyProxySSL: true,
        verifyProxyHostSSL: true,
        verifyPeerSSL: true,
        verifyHostSSL: true,
        noProxy: '',
      },
      version: 0,
    }

    vi.mocked(getBackendSetting).mockResolvedValue(JSON.stringify(proxyConfig))

    const result = await getProxyConfig()

    expect(result).toEqual({
      url: 'http://proxy.example.com:8080',
      ignore_ssl: false,
      verify_proxy_ssl: true,
      verify_proxy_host_ssl: true,
      verify_peer_ssl: true,
      verify_host_ssl: true,
    })
    expect(result?.username).toBeUndefined()
    expect(result?.password).toBeUndefined()
  })

  it('should parse no_proxy list correctly', async () => {
    const proxyConfig = {
      state: {
        proxyEnabled: true,
        proxyUrl: 'http://proxy.example.com:8080',
        proxyUsername: '',
        proxyPassword: '',
        proxyIgnoreSSL: false,
        verifyProxySSL: true,
        verifyProxyHostSSL: true,
        verifyPeerSSL: true,
        verifyHostSSL: true,
        noProxy: 'localhost, 127.0.0.1, *.example.com , specific.domain.com',
      },
      version: 0,
    }

    vi.mocked(getBackendSetting).mockResolvedValue(JSON.stringify(proxyConfig))

    const result = await getProxyConfig()

    expect(result).toEqual({
      url: 'http://proxy.example.com:8080',
      no_proxy: [
        'localhost',
        '127.0.0.1',
        '*.example.com',
        'specific.domain.com',
      ],
      ignore_ssl: false,
      verify_proxy_ssl: true,
      verify_proxy_host_ssl: true,
      verify_peer_ssl: true,
      verify_host_ssl: true,
    })
  })

  it('should handle empty no_proxy entries', async () => {
    const proxyConfig = {
      state: {
        proxyEnabled: true,
        proxyUrl: 'http://proxy.example.com:8080',
        proxyUsername: '',
        proxyPassword: '',
        proxyIgnoreSSL: false,
        verifyProxySSL: true,
        verifyProxyHostSSL: true,
        verifyPeerSSL: true,
        verifyHostSSL: true,
        noProxy: 'localhost, , 127.0.0.1, ,',
      },
      version: 0,
    }

    vi.mocked(getBackendSetting).mockResolvedValue(JSON.stringify(proxyConfig))

    const result = await getProxyConfig()

    expect(result).toEqual({
      url: 'http://proxy.example.com:8080',
      no_proxy: ['localhost', '127.0.0.1'],
      ignore_ssl: false,
      verify_proxy_ssl: true,
      verify_proxy_host_ssl: true,
      verify_peer_ssl: true,
      verify_host_ssl: true,
    })
  })

  it('should handle mixed SSL verification settings', async () => {
    const proxyConfig = {
      state: {
        proxyEnabled: true,
        proxyUrl: 'https://proxy.example.com:8080',
        proxyUsername: 'user',
        proxyPassword: 'pass',
        proxyIgnoreSSL: true,
        verifyProxySSL: false,
        verifyProxyHostSSL: true,
        verifyPeerSSL: false,
        verifyHostSSL: true,
        noProxy: 'localhost',
      },
      version: 0,
    }

    vi.mocked(getBackendSetting).mockResolvedValue(JSON.stringify(proxyConfig))

    const result = await getProxyConfig()

    expect(result).toEqual({
      url: 'https://proxy.example.com:8080',
      username: 'user',
      password: 'pass',
      no_proxy: ['localhost'],
      ignore_ssl: true,
      verify_proxy_ssl: false,
      verify_proxy_host_ssl: true,
      verify_peer_ssl: false,
      verify_host_ssl: true,
    })
  })

  it('should handle all SSL verification settings as false', async () => {
    const proxyConfig = {
      state: {
        proxyEnabled: true,
        proxyUrl: 'http://proxy.example.com:8080',
        proxyUsername: '',
        proxyPassword: '',
        proxyIgnoreSSL: false,
        verifyProxySSL: false,
        verifyProxyHostSSL: false,
        verifyPeerSSL: false,
        verifyHostSSL: false,
        noProxy: '',
      },
      version: 0,
    }

    vi.mocked(getBackendSetting).mockResolvedValue(JSON.stringify(proxyConfig))

    const result = await getProxyConfig()

    expect(result).toEqual({
      url: 'http://proxy.example.com:8080',
      ignore_ssl: false,
      verify_proxy_ssl: false,
      verify_proxy_host_ssl: false,
      verify_peer_ssl: false,
      verify_host_ssl: false,
    })
  })

  it('should handle all SSL verification settings as true', async () => {
    const proxyConfig = {
      state: {
        proxyEnabled: true,
        proxyUrl: 'https://proxy.example.com:8080',
        proxyUsername: '',
        proxyPassword: '',
        proxyIgnoreSSL: true,
        verifyProxySSL: true,
        verifyProxyHostSSL: true,
        verifyPeerSSL: true,
        verifyHostSSL: true,
        noProxy: '',
      },
      version: 0,
    }

    vi.mocked(getBackendSetting).mockResolvedValue(JSON.stringify(proxyConfig))

    const result = await getProxyConfig()

    expect(result).toEqual({
      url: 'https://proxy.example.com:8080',
      ignore_ssl: true,
      verify_proxy_ssl: true,
      verify_proxy_host_ssl: true,
      verify_peer_ssl: true,
      verify_host_ssl: true,
    })
  })

  it('should log proxy configuration details', async () => {
    const proxyConfig = {
      state: {
        proxyEnabled: true,
        proxyUrl: 'https://proxy.example.com:8080',
        proxyUsername: 'testuser',
        proxyPassword: 'testpass',
        proxyIgnoreSSL: true,
        verifyProxySSL: false,
        verifyProxyHostSSL: true,
        verifyPeerSSL: false,
        verifyHostSSL: true,
        noProxy: 'localhost,127.0.0.1',
      },
      version: 0,
    }

    vi.mocked(getBackendSetting).mockResolvedValue(JSON.stringify(proxyConfig))

    await getProxyConfig()

    expect(logger.info).toHaveBeenCalledWith('Using proxy configuration:', {
      url: 'https://proxy.example.com:8080',
      hasAuth: true,
      noProxyCount: 2,
      ignoreSSL: true,
      verifyProxySSL: false,
      verifyProxyHostSSL: true,
      verifyPeerSSL: false,
      verifyHostSSL: true,
    })
  })

  it('should log proxy configuration without authentication', async () => {
    const proxyConfig = {
      state: {
        proxyEnabled: true,
        proxyUrl: 'http://proxy.example.com:8080',
        proxyUsername: '',
        proxyPassword: '',
        proxyIgnoreSSL: false,
        verifyProxySSL: true,
        verifyProxyHostSSL: true,
        verifyPeerSSL: true,
        verifyHostSSL: true,
        noProxy: '',
      },
      version: 0,
    }

    vi.mocked(getBackendSetting).mockResolvedValue(JSON.stringify(proxyConfig))

    await getProxyConfig()

    expect(logger.info).toHaveBeenCalledWith('Using proxy configuration:', {
      url: 'http://proxy.example.com:8080',
      hasAuth: false,
      noProxyCount: 0,
      ignoreSSL: false,
      verifyProxySSL: true,
      verifyProxyHostSSL: true,
      verifyPeerSSL: true,
      verifyHostSSL: true,
    })
  })

  it('should return null and log error when JSON parsing fails', async () => {
    vi.mocked(getBackendSetting).mockResolvedValue('invalid-json')

    const result = await getProxyConfig()

    expect(result).toBeNull()
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to parse proxy configuration:',
      expect.any(SyntaxError)
    )
  })

  it('should handle SOCKS proxy URLs', async () => {
    const proxyConfig = {
      state: {
        proxyEnabled: true,
        proxyUrl: 'socks5://proxy.example.com:1080',
        proxyUsername: 'user',
        proxyPassword: 'pass',
        proxyIgnoreSSL: false,
        verifyProxySSL: true,
        verifyProxyHostSSL: true,
        verifyPeerSSL: true,
        verifyHostSSL: true,
        noProxy: '',
      },
      version: 0,
    }

    vi.mocked(getBackendSetting).mockResolvedValue(JSON.stringify(proxyConfig))

    const result = await getProxyConfig()

    expect(result).toEqual({
      url: 'socks5://proxy.example.com:1080',
      username: 'user',
      password: 'pass',
      ignore_ssl: false,
      verify_proxy_ssl: true,
      verify_proxy_host_ssl: true,
      verify_peer_ssl: true,
      verify_host_ssl: true,
    })
  })

  it('should handle comprehensive proxy configuration', async () => {
    const proxyConfig = {
      state: {
        proxyEnabled: true,
        proxyUrl: 'https://secure-proxy.example.com:8443',
        proxyUsername: 'admin',
        proxyPassword: 'secretpass',
        proxyIgnoreSSL: true,
        verifyProxySSL: false,
        verifyProxyHostSSL: false,
        verifyPeerSSL: true,
        verifyHostSSL: true,
        noProxy: 'localhost,127.0.0.1,*.local,192.168.1.0/24',
      },
      version: 0,
    }

    vi.mocked(getBackendSetting).mockResolvedValue(JSON.stringify(proxyConfig))

    const result = await getProxyConfig()

    expect(result).toEqual({
      url: 'https://secure-proxy.example.com:8443',
      username: 'admin',
      password: 'secretpass',
      no_proxy: ['localhost', '127.0.0.1', '*.local', '192.168.1.0/24'],
      ignore_ssl: true,
      verify_proxy_ssl: false,
      verify_proxy_host_ssl: false,
      verify_peer_ssl: true,
      verify_host_ssl: true,
    })
  })
})

describe('truncateToTokenBudget', () => {
  it('returns input unchanged when under the budget', () => {
    expect(truncateToTokenBudget('hello world', 100, 3)).toBe('hello world')
  })

  it('slices to maxTokens * charsPerToken when over the budget', () => {
    const long = 'a'.repeat(1000)
    const out = truncateToTokenBudget(long, 10, 3)
    expect(out.length).toBe(30)
  })
})

describe('buildEmbedBatches', () => {
  it('packs small inputs into a single batch', () => {
    const batches = buildEmbedBatches(['hi', 'there'], 512, 3)
    expect(batches).toHaveLength(1)
    expect(batches[0]).toEqual({ batch: ['hi', 'there'], offset: 0 })
  })

  it('splits inputs across batches when token budget is exceeded', () => {
    const oneSafeChunk = 'a'.repeat(3 * 200)
    const batches = buildEmbedBatches(
      [oneSafeChunk, oneSafeChunk, oneSafeChunk],
      512,
      3
    )
    expect(batches.length).toBeGreaterThanOrEqual(2)
    const flat = batches.flatMap((b) => b.batch)
    expect(flat).toHaveLength(3)
    const offsets = batches.map((b) => b.offset)
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b))
  })

  it('truncates oversize inputs instead of forwarding them whole', () => {
    const huge = 'x'.repeat(20000)
    const batches = buildEmbedBatches([huge], 512, 3)
    expect(batches).toHaveLength(1)
    const sent = batches[0].batch[0]
    expect(sent.length).toBeLessThan(huge.length)
    expect(estimateTokensFromText(sent, 3)).toBeLessThanOrEqual(
      Math.floor(512 * 0.5)
    )
  })

  it('throws on ubatch_size too small to satisfy the safety margin', () => {
    expect(() => buildEmbedBatches(['hi'], 1, 3)).toThrow(/too small/)
  })
})

describe('detectMtpLayersFromGgufMeta', () => {
  it('returns 0 for undefined or empty meta', () => {
    expect(detectMtpLayersFromGgufMeta(undefined)).toBe(0)
    expect(detectMtpLayersFromGgufMeta({})).toBe(0)
  })

  it('reads {arch}.nextn_predict_layers when general.architecture is set', () => {
    expect(
      detectMtpLayersFromGgufMeta({
        'general.architecture': 'glm',
        'glm.nextn_predict_layers': '1',
      })
    ).toBe(1)
  })

  it('accepts numeric values', () => {
    expect(
      detectMtpLayersFromGgufMeta({
        'general.architecture': 'mimo',
        'mimo.nextn_predict_layers': 2,
      })
    ).toBe(2)
  })

  it('falls back to suffix scan when arch key is missing', () => {
    expect(
      detectMtpLayersFromGgufMeta({
        'some_new_arch.nextn_predict_layers': '3',
      })
    ).toBe(3)
  })

  it('returns 0 when value is zero, negative, or unparseable', () => {
    expect(
      detectMtpLayersFromGgufMeta({
        'general.architecture': 'glm',
        'glm.nextn_predict_layers': '0',
      })
    ).toBe(0)
    expect(
      detectMtpLayersFromGgufMeta({
        'general.architecture': 'glm',
        'glm.nextn_predict_layers': '-1',
      })
    ).toBe(0)
    expect(
      detectMtpLayersFromGgufMeta({
        'general.architecture': 'glm',
        'glm.nextn_predict_layers': 'abc',
      })
    ).toBe(0)
  })

  it('floors non-integer values', () => {
    expect(
      detectMtpLayersFromGgufMeta({
        'general.architecture': 'glm',
        'glm.nextn_predict_layers': '2.7',
      })
    ).toBe(2)
  })
})

describe('detectTemplateKwargsFromChatTemplate', () => {
  it('returns [] for missing or empty templates', () => {
    expect(detectTemplateKwargsFromChatTemplate(undefined)).toEqual([])
    expect(detectTemplateKwargsFromChatTemplate('')).toEqual([])
    expect(detectTemplateKwargsFromChatTemplate(123)).toEqual([])
  })

  it('detects the self-defaulting set idiom and infers types', () => {
    const tpl = [
      "{%- set enable_thinking = enable_thinking | default(false) -%}",
      "{%- set preserve_thinking = preserve_thinking | default(false) -%}",
      "{%- set reasoning_effort = reasoning_effort | default('medium') -%}",
      "{%- set max_turns = max_turns | default(8) -%}",
    ].join('\n')
    expect(detectTemplateKwargsFromChatTemplate(tpl)).toEqual([
      { name: 'preserve_thinking', type: 'boolean', default: false },
      { name: 'reasoning_effort', type: 'string', default: 'medium' },
      { name: 'max_turns', type: 'number', default: 8 },
    ])
  })

  it('excludes enable_thinking (owned by the reasoning control)', () => {
    const tpl = '{%- set enable_thinking = enable_thinking | default(true) -%}'
    expect(detectTemplateKwargsFromChatTemplate(tpl)).toEqual([])
  })

  it('deduplicates repeated kwargs and ignores non-self-defaulting sets', () => {
    const tpl = [
      '{%- set preserve_thinking = preserve_thinking | default(false) -%}',
      '{%- set preserve_thinking = preserve_thinking | default(false) -%}',
      '{%- set ns = namespace(x=1) -%}',
      '{%- set role = message.role -%}',
    ].join('\n')
    expect(detectTemplateKwargsFromChatTemplate(tpl)).toEqual([
      { name: 'preserve_thinking', type: 'boolean', default: false },
    ])
  })

  it('handles the {% %} form without the dash', () => {
    const tpl = '{% set add_notes = add_notes | default(true) %}'
    expect(detectTemplateKwargsFromChatTemplate(tpl)).toEqual([
      { name: 'add_notes', type: 'boolean', default: true },
    ])
  })
})
