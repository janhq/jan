import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getProxyConfig,
  isConcreteVersionBackend,
  matchesMtpLoadFailure,
  isCpuBackend,
  cpuHasAvx,
  isUnsupportedNoAvxCpu,
} from './util'

// Mock console.log and console.error to avoid noise in tests
const mockConsole = {
  log: vi.fn(),
  error: vi.fn(),
}

// Set up mocks
beforeEach(() => {
  // Clear all mocks
  vi.clearAllMocks()

  // Clear localStorage mocks
  vi.mocked(localStorage.getItem).mockClear()

  // Mock console
  Object.defineProperty(console, 'log', {
    value: mockConsole.log,
    writable: true,
  })
  Object.defineProperty(console, 'error', {
    value: mockConsole.error,
    writable: true,
  })
})

describe('getProxyConfig', () => {
  it('should return null when no proxy configuration is stored', () => {
    vi.mocked(localStorage.getItem).mockReturnValue(null)

    const result = getProxyConfig()

    expect(result).toBeNull()
    expect(localStorage.getItem).toHaveBeenCalledWith('setting-proxy-config')
  })

  it('should return null when proxy is disabled', () => {
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

    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(proxyConfig))

    const result = getProxyConfig()

    expect(result).toBeNull()
  })

  it('should return null when proxy is enabled but no URL is provided', () => {
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

    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(proxyConfig))

    const result = getProxyConfig()

    expect(result).toBeNull()
  })

  it('should return basic proxy configuration with SSL settings', () => {
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

    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(proxyConfig))

    const result = getProxyConfig()

    expect(result).toEqual({
      url: 'https://proxy.example.com:8080',
      ignore_ssl: true,
      verify_proxy_ssl: false,
      verify_proxy_host_ssl: false,
      verify_peer_ssl: true,
      verify_host_ssl: true,
    })
  })

  it('should include authentication when both username and password are provided', () => {
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

    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(proxyConfig))

    const result = getProxyConfig()

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

  it('should not include authentication when only username is provided', () => {
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

    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(proxyConfig))

    const result = getProxyConfig()

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

  it('should not include authentication when only password is provided', () => {
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

    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(proxyConfig))

    const result = getProxyConfig()

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

  it('should parse no_proxy list correctly', () => {
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

    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(proxyConfig))

    const result = getProxyConfig()

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

  it('should handle empty no_proxy entries', () => {
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

    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(proxyConfig))

    const result = getProxyConfig()

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

  it('should handle mixed SSL verification settings', () => {
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

    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(proxyConfig))

    const result = getProxyConfig()

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

  it('should handle all SSL verification settings as false', () => {
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

    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(proxyConfig))

    const result = getProxyConfig()

    expect(result).toEqual({
      url: 'http://proxy.example.com:8080',
      ignore_ssl: false,
      verify_proxy_ssl: false,
      verify_proxy_host_ssl: false,
      verify_peer_ssl: false,
      verify_host_ssl: false,
    })
  })

  it('should handle all SSL verification settings as true', () => {
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

    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(proxyConfig))

    const result = getProxyConfig()

    expect(result).toEqual({
      url: 'https://proxy.example.com:8080',
      ignore_ssl: true,
      verify_proxy_ssl: true,
      verify_proxy_host_ssl: true,
      verify_peer_ssl: true,
      verify_host_ssl: true,
    })
  })

  it('should log proxy configuration details', () => {
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

    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(proxyConfig))

    getProxyConfig()

    expect(mockConsole.log).toHaveBeenCalledWith('Using proxy configuration:', {
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

  it('should log proxy configuration without authentication', () => {
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

    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(proxyConfig))

    getProxyConfig()

    expect(mockConsole.log).toHaveBeenCalledWith('Using proxy configuration:', {
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

  it('should return null and log error when JSON parsing fails', () => {
    vi.mocked(localStorage.getItem).mockReturnValue('invalid-json')

    const result = getProxyConfig()

    expect(result).toBeNull()
    expect(mockConsole.error).toHaveBeenCalledWith(
      'Failed to parse proxy configuration:',
      expect.any(SyntaxError)
    )
  })

  it('should handle SOCKS proxy URLs', () => {
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

    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(proxyConfig))

    const result = getProxyConfig()

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

  it('should handle comprehensive proxy configuration', () => {
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

    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify(proxyConfig))

    const result = getProxyConfig()

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

describe('isConcreteVersionBackend (ATO-124)', () => {
  it('accepts a concrete <tag>/<backend>', () => {
    expect(isConcreteVersionBackend('b9562/win-cpu-x64')).toBe(true)
  })

  it('rejects the unresolved latest/<backend> sentinel', () => {
    expect(isConcreteVersionBackend('latest/win-cpu-x64')).toBe(false)
  })

  it('rejects an empty string', () => {
    expect(isConcreteVersionBackend('')).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isConcreteVersionBackend(undefined)).toBe(false)
  })

  it('rejects null', () => {
    expect(isConcreteVersionBackend(null)).toBe(false)
  })

  it("rejects the literal 'none'", () => {
    expect(isConcreteVersionBackend('none')).toBe(false)
  })

  it('rejects a value with no slash', () => {
    expect(isConcreteVersionBackend('b9562')).toBe(false)
  })

  it('rejects the literal "latest" (no slash)', () => {
    expect(isConcreteVersionBackend('latest')).toBe(false)
  })

  it('strips a leading BOM before checking a concrete value', () => {
    expect(isConcreteVersionBackend('\uFEFFb9562/win-cpu-x64')).toBe(true)
  })

  it('strips a BOM that precedes the latest sentinel and still rejects', () => {
    expect(isConcreteVersionBackend('\uFEFFlatest/win-cpu-x64')).toBe(false)
  })

  it('trims surrounding whitespace around a concrete value', () => {
    expect(isConcreteVersionBackend('  b9562/linux-cpu-x64  ')).toBe(true)
  })

  it('trims whitespace around the latest sentinel and still rejects', () => {
    expect(isConcreteVersionBackend('  latest/linux-cpu-x64  ')).toBe(false)
  })

  it('rejects whitespace-only input', () => {
    expect(isConcreteVersionBackend('   ')).toBe(false)
  })
})

describe('matchesMtpLoadFailure (ATO-125)', () => {
  it('matches "failed to create MTP context"', () => {
    expect(matchesMtpLoadFailure('error: failed to create MTP context')).toBe(
      true
    )
  })

  it('matches "context type MTP requested"', () => {
    expect(
      matchesMtpLoadFailure('context type MTP requested but model ...')
    ).toBe(true)
  })

  it("matches \"doesn't contain MTP layers\" (with apostrophe)", () => {
    expect(
      matchesMtpLoadFailure("model doesn't contain MTP layers")
    ).toBe(true)
  })

  it('matches "doesnt contain MTP layers" (without apostrophe)', () => {
    expect(matchesMtpLoadFailure('model doesnt contain MTP layers')).toBe(true)
  })

  it('matches case-insensitively', () => {
    expect(matchesMtpLoadFailure('FAILED TO CREATE MTP CONTEXT')).toBe(true)
  })

  it('does not match an OOM error', () => {
    expect(
      matchesMtpLoadFailure('ggml_backend_cuda_buffer_type_alloc: out of memory')
    ).toBe(false)
  })

  it('does not match an unrelated error', () => {
    expect(matchesMtpLoadFailure('some unrelated failure')).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(matchesMtpLoadFailure('')).toBe(false)
  })
})

describe('isCpuBackend (ATO-185)', () => {
  it('matches the Windows x64 CPU backend', () => {
    expect(isCpuBackend('win-cpu-x64')).toBe(true)
  })

  it('matches the Linux x64 CPU backend', () => {
    expect(isCpuBackend('linux-cpu-x64')).toBe(true)
  })

  it('matches arm64 CPU backends', () => {
    expect(isCpuBackend('win-cpu-arm64')).toBe(true)
    expect(isCpuBackend('linux-cpu-arm64')).toBe(true)
  })

  it('does not match GPU backends', () => {
    expect(isCpuBackend('win-cuda-13-x64')).toBe(false)
    expect(isCpuBackend('win-vulkan-x64')).toBe(false)
    expect(isCpuBackend('linux-vulkan-x64')).toBe(false)
  })

  it('does not match macOS backends', () => {
    expect(isCpuBackend('macos-x64')).toBe(false)
    expect(isCpuBackend('macos-arm64')).toBe(false)
  })

  it('strips BOM / whitespace and is case-insensitive', () => {
    expect(isCpuBackend('\uFEFF  WIN-CPU-X64 ')).toBe(true)
  })

  it('returns false for nullish input', () => {
    expect(isCpuBackend(undefined)).toBe(false)
    expect(isCpuBackend(null)).toBe(false)
    expect(isCpuBackend('')).toBe(false)
  })
})

describe('cpuHasAvx (ATO-185)', () => {
  it('is true when AVX is present', () => {
    expect(cpuHasAvx(['sse', 'sse2', 'avx'])).toBe(true)
  })

  it('is true when AVX2 is present (implies AVX)', () => {
    expect(cpuHasAvx(['sse4_2', 'avx2'])).toBe(true)
  })

  it('is true when an AVX-512 sub-feature is present', () => {
    expect(cpuHasAvx(['avx512_f', 'avx512_dq'])).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(cpuHasAvx(['AVX2'])).toBe(true)
  })

  it('is false for an SSE-only (no-AVX) CPU', () => {
    expect(cpuHasAvx(['fpu', 'mmx', 'sse', 'sse2', 'sse3', 'ssse3'])).toBe(false)
  })

  it('is false for an empty / nullish list', () => {
    expect(cpuHasAvx([])).toBe(false)
    expect(cpuHasAvx(undefined)).toBe(false)
    expect(cpuHasAvx(null)).toBe(false)
  })
})

describe('isUnsupportedNoAvxCpu (ATO-185)', () => {
  const noAvxExts = ['fpu', 'mmx', 'sse', 'sse2', 'sse3', 'ssse3', 'sse4_1']

  it('blocks an x86_64 CPU backend with no AVX', () => {
    expect(isUnsupportedNoAvxCpu('x86_64', 'win-cpu-x64', noAvxExts)).toBe(true)
    expect(isUnsupportedNoAvxCpu('x86_64', 'linux-cpu-x64', noAvxExts)).toBe(
      true
    )
  })

  it('allows an x86 CPU that has AVX', () => {
    expect(
      isUnsupportedNoAvxCpu('x86_64', 'win-cpu-x64', [...noAvxExts, 'avx'])
    ).toBe(false)
  })

  it('does not block GPU backends even on a no-AVX CPU', () => {
    expect(isUnsupportedNoAvxCpu('x86_64', 'win-vulkan-x64', noAvxExts)).toBe(
      false
    )
  })

  it('does not block non-x86 hosts (no AVX concept)', () => {
    expect(isUnsupportedNoAvxCpu('arm64', 'linux-cpu-arm64', [])).toBe(false)
    expect(isUnsupportedNoAvxCpu('aarch64', 'win-cpu-arm64', [])).toBe(false)
  })

  it('never blocks when the extension list is empty (probe failure)', () => {
    expect(isUnsupportedNoAvxCpu('x86_64', 'win-cpu-x64', [])).toBe(false)
    expect(isUnsupportedNoAvxCpu('x86_64', 'win-cpu-x64', null)).toBe(false)
  })

  it('accepts the amd64 arch alias', () => {
    expect(isUnsupportedNoAvxCpu('amd64', 'win-cpu-x64', noAvxExts)).toBe(true)
  })
})
