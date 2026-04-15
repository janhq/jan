import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getBackendDir,
  getBackendExePath,
  isBackendInstalled,
  downloadBackend,
  listSupportedBackends,
} from '../backend'
import { getSystemInfo } from '@janhq/tauri-plugin-hardware-api'
import { fs, getJanDataFolderPath, events } from '@janhq/core'
import { invoke } from '@tauri-apps/api/core'
import { dirname } from '@tauri-apps/api/path'
import {
  isCudaInstalledFromRust,
  determineSupportedBackends,
} from '@janhq/tauri-plugin-llamacpp-api'

// Mock constants: Hardcode path string directly inside the mock to avoid hoisting issues
const MOCK_JAN_PATH_STRING = '/path/to/jan'

// Mock the core dependencies
vi.mock('@janhq/core', () => ({
  getJanDataFolderPath: vi.fn().mockResolvedValue('/path/to/jan'),
  fs: {
    existsSync: vi.fn(),
    readdirSync: vi.fn().mockResolvedValue([]),
    rm: vi.fn().mockResolvedValue(undefined),
  },
  joinPath: vi.fn(async (paths: string[]) => paths.join('/')),
  events: {
    emit: vi.fn(),
  },
}))
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))
vi.mock('@janhq/tauri-plugin-hardware-api', () => ({
  getSystemInfo: vi.fn(),
}))
vi.mock('../util', () => ({
  getProxyConfig: vi.fn().mockReturnValue({}),
}))
vi.mock('@tauri-apps/api/path', () => ({
  // Mock dirname to return the direct parent directory (used for decompress outputDir)
  dirname: vi.fn(async (path) => path.split('/').slice(0, -1).join('/')),
  basename: vi.fn(async (path) => path.split('/').pop()),
}))
vi.mock('@janhq/tauri-plugin-llamacpp-api', () => ({
  isCudaInstalledFromRust: vi.fn().mockResolvedValue(false),
  determineSupportedBackends: vi.fn().mockResolvedValue([
    'linux-common_cpus-x64',
    'linux-vulkan-common_cpus-x64',
    'win-common_cpus-x64',
    'win-vulkan-common_cpus-x64',
    'win-cuda-12-common_cpus-x64',
    'win-cuda-13-common_cpus-x64',
    'macos-arm64',
    'macos-x64',
  ]),
  getSupportedFeaturesFromRust: vi.fn().mockResolvedValue({}),
  normalizeFeatures: vi.fn((v: any) => v),
  getLocalInstalledBackendsInternal: vi.fn().mockResolvedValue([]),
  listSupportedBackendsFromRust: vi.fn(async (remote: any[]) => remote),
  mapOldBackendToNew: vi.fn(async (v: string) => v),
}))

// Mock the global fetch function
global.fetch = vi.fn()

// Mock IS_WINDOWS and window.core global for environment setup
vi.stubGlobal('IS_WINDOWS', false)
vi.stubGlobal('window', {
  core: {
    extensionManager: {
      getByName: vi.fn(),
    },
  },
})

// Setup global mock for `window.core.extensionManager.getByName` and the download manager
const mockDownloadManager = {
  downloadFiles: vi.fn().mockImplementation((items, taskId, onProgress) => {
    // Simulate successful download
    if (onProgress) onProgress(100, 100)
    return Promise.resolve()
  }),
}
vi.mocked(window.core.extensionManager.getByName).mockReturnValue(
  mockDownloadManager
)

function buildUpstreamRelease(tag: string, assetStems: string[]) {
  return {
    tag_name: tag,
    assets: assetStems.map((stem) => ({
      name: stem.endsWith('.zip') || stem.endsWith('.tar.gz')
        ? stem.startsWith('cudart-')
          ? stem
          : `llama-${tag}-bin-${stem}`
        : `llama-${tag}-bin-${stem}.tar.gz`,
    })),
  }
}

describe('Backend functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')

    vi.mocked(getSystemInfo).mockResolvedValue({
      os_type: 'linux',
      cpu: {
        arch: 'x86_64',
        extensions: [],
      },
      gpus: [],
    } as any)

    vi.mocked(fs.existsSync).mockImplementation(async (path: string) => {
      if (path.includes('build')) return true
      return false
    })
    vi.mocked(window.core.extensionManager.getByName).mockReturnValue(
      mockDownloadManager
    )
    vi.mocked(mockDownloadManager.downloadFiles).mockClear()
    vi.mocked(isCudaInstalledFromRust).mockResolvedValue(false)
    vi.mocked(determineSupportedBackends).mockResolvedValue([
      'linux-common_cpus-x64',
      'linux-vulkan-common_cpus-x64',
      'win-common_cpus-x64',
      'win-vulkan-common_cpus-x64',
      'win-cuda-12-common_cpus-x64',
      'win-cuda-13-common_cpus-x64',
      'macos-arm64',
      'macos-x64',
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getBackendDir and getBackendExePath', () => {
    it('should use the specific backend name for directory path', async () => {
      vi.mocked(fs.existsSync).mockImplementation(async (path: string) =>
        path.includes('build')
      )

      const dir = await getBackendDir('linux-vulkan-common_cpus-x64', 'b8802')
      expect(dir).toBe(
        `/path/to/jan/llamacpp/backends/b8802/linux-vulkan-common_cpus-x64`
      )

      const exePath = await getBackendExePath(
        'linux-vulkan-common_cpus-x64',
        'b8802'
      )
      expect(exePath).toBe(
        `/path/to/jan/llamacpp/backends/b8802/linux-vulkan-common_cpus-x64/build/bin/llama-server`
      )
    })
  })

  describe('isBackendInstalled', () => {
    it('should return true when backend executable exists', async () => {
      vi.stubGlobal('IS_WINDOWS', false)
      vi.mocked(fs.existsSync).mockImplementation(async (path: string) => {
        const expectedExePath = `${MOCK_JAN_PATH_STRING}/llamacpp/backends/b8802/linux-vulkan-common_cpus-x64/build/bin/llama-server`
        if (path === expectedExePath) return true
        if (path.endsWith('/build')) return true
        return false
      })

      const result = await isBackendInstalled(
        'linux-vulkan-common_cpus-x64',
        'b8802'
      )
      expect(result).toBe(true)
    })
  })

  describe('downloadBackend', () => {
    beforeEach(() => {
      vi.mocked(mockDownloadManager.downloadFiles).mockClear()
      vi.mocked(mockDownloadManager.downloadFiles).mockImplementation(
        (items, taskId, onProgress) => {
          if (onProgress) onProgress(100, 100)
          return Promise.resolve()
        }
      )
      vi.mocked(invoke).mockImplementation(async (command: string) => {
        if (command === 'decompress') return undefined
        return undefined
      })
      vi.mocked(fs.rm).mockResolvedValue(undefined)
    })

    it('downloads upstream ubuntu-vulkan asset for linux-vulkan-common_cpus-x64', async () => {
      vi.stubGlobal('IS_WINDOWS', false)
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => [
          buildUpstreamRelease('b8802', ['ubuntu-vulkan-x64', 'ubuntu-x64']),
        ],
      } as any)

      await listSupportedBackends()
      await downloadBackend('linux-vulkan-common_cpus-x64', 'b8802')

      const downloadItems = vi.mocked(mockDownloadManager.downloadFiles).mock
        .calls[0][0]
      expect(downloadItems).toHaveLength(1)
      expect(downloadItems[0].url).toBe(
        'https://github.com/ggml-org/llama.cpp/releases/download/b8802/llama-b8802-bin-ubuntu-vulkan-x64.tar.gz'
      )
      expect(downloadItems[0].save_path).toBe(
        `${MOCK_JAN_PATH_STRING}/llamacpp/backends/b8802/linux-vulkan-common_cpus-x64/backend.tar.gz`
      )
    })

    it('downloads win-cuda archive plus matching cudart zip', async () => {
      vi.stubGlobal('IS_WINDOWS', true)
      vi.mocked(getSystemInfo).mockResolvedValue({
        os_type: 'windows',
        cpu: { arch: 'x86_64', extensions: [] },
        gpus: [
          {
            driver_version: '530.41',
            nvidia_info: { compute_capability: '8.6' },
          },
        ],
      } as any)
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => [
          {
            tag_name: 'b8802',
            assets: [
              { name: 'llama-b8802-bin-win-cuda-12.4-x64.zip' },
              { name: 'cudart-llama-bin-win-cuda-12.4-x64.zip' },
            ],
          },
        ],
      } as any)

      await listSupportedBackends()
      await downloadBackend('win-cuda-12-common_cpus-x64', 'b8802')

      const downloadItems = vi.mocked(mockDownloadManager.downloadFiles).mock
        .calls[0][0]
      expect(downloadItems).toHaveLength(2)
      expect(downloadItems[0].url).toBe(
        'https://github.com/ggml-org/llama.cpp/releases/download/b8802/llama-b8802-bin-win-cuda-12.4-x64.zip'
      )
      expect(downloadItems[0].save_path).toBe(
        `${MOCK_JAN_PATH_STRING}/llamacpp/backends/b8802/win-cuda-12-common_cpus-x64/backend.zip`
      )
      expect(downloadItems[1].url).toBe(
        'https://github.com/ggml-org/llama.cpp/releases/download/b8802/cudart-llama-bin-win-cuda-12.4-x64.zip'
      )
      expect(downloadItems[1].save_path).toBe(
        `${MOCK_JAN_PATH_STRING}/llamacpp/backends/b8802/win-cuda-12-common_cpus-x64/build/bin/cuda12.zip`
      )
    })

    it('throws a clear error when no upstream asset is known for the requested backend', async () => {
      vi.stubGlobal('IS_WINDOWS', false)
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => [],
      } as any)

      await expect(
        downloadBackend('linux-cuda-12-common_cpus-x64', 'b8802')
      ).rejects.toThrow(/No upstream release asset known/)
    })
  })
})
