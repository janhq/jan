import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getBackendDir,
  getBackendExePath,
  isBackendInstalled,
  downloadBackend,
} from '../backend'
import { getSystemInfo } from '@janhq/tauri-plugin-hardware-api'
import { fs, getJanDataFolderPath, events } from '@janhq/core'
import { invoke } from '@tauri-apps/api/core'
import { dirname } from '@tauri-apps/api/path'

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
  basenameNoExt: vi.fn((name) => name.replace(/\.tar\.gz$/, '')),
}))
vi.mock('@tauri-apps/api/path', () => ({
  // Mock dirname to return the direct parent directory (used for decompress outputDir)
  dirname: vi.fn(async (path) => path.split('/').slice(0, -1).join('/')),
  basename: vi.fn(async (path) => path.split('/').pop()),
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

describe('Backend functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mock getJanDataFolderPath explicitly to a simple path
    vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')

    vi.mocked(getSystemInfo).mockResolvedValue({
      os_type: 'linux',
      cpu: {
        arch: 'x86_64',
        extensions: [],
      },
      gpus: [],
    } as any)

    // Default mock for isBackendInstalled dependencies
    vi.mocked(fs.existsSync).mockImplementation(async (path: string) => {
      if (path.includes('build')) return true // Assume build dir check passes
      return false
    })
    vi.mocked(window.core.extensionManager.getByName).mockReturnValue(
      mockDownloadManager
    )
    vi.mocked(mockDownloadManager.downloadFiles).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })


  describe('getBackendDir and getBackendExePath', () => {
    it('should use the specific backend name for directory path', async () => {
      vi.mocked(fs.existsSync).mockImplementation(async (path: string) =>
        path.includes('build')
      ) // Mock build dir check

      const dir = await getBackendDir('linux-avx2-x64', 'v1.2.3')
      expect(dir).toBe(`/path/to/jan/llamacpp/backends/v1.2.3/linux-avx2-x64`)

      const exePath = await getBackendExePath('linux-avx2-x64', 'v1.2.3')
      expect(exePath).toBe(
        `/path/to/jan/llamacpp/backends/v1.2.3/linux-avx2-x64/build/bin/llama-server`
      )
    })

    it('should use the new common backend name for directory path if it was the asset name', async () => {
      vi.mocked(fs.existsSync).mockImplementation(async (path: string) =>
        path.includes('build')
      ) // Mock build dir check

      const dir = await getBackendDir('win-common_cpus-x64', 'v2.0.0')
      expect(dir).toBe(
        `/path/to/jan/llamacpp/backends/v2.0.0/win-common_cpus-x64`
      )

      const exePath = await getBackendExePath('win-common_cpus-x64', 'v2.0.0')
      expect(exePath).toBe(
        `/path/to/jan/llamacpp/backends/v2.0.0/win-common_cpus-x64/build/bin/llama-server`
      )
    })
  })

  describe('isBackendInstalled', () => {
    it('should return true when backend is installed using its specific name', async () => {
      vi.stubGlobal('IS_WINDOWS', false) // Linux/macOS for llama-server
      // Mock both the check for the 'build' directory and the final executable path
      vi.mocked(fs.existsSync).mockImplementation(async (path: string) => {
        const expectedExePath = `/path/to/jan/llamacpp/backends/v1.0.0/win-avx2-x64/build/bin/llama-server`
        if (path === expectedExePath) return true
        if (path.endsWith('/build')) return true
        return false
      })

      const result = await isBackendInstalled('win-avx2-x64', 'v1.0.0')
      expect(result).toBe(true)
      // Check that it was called with the final exe path
      expect(fs.existsSync).toHaveBeenCalledWith(
        `/path/to/jan/llamacpp/backends/v1.0.0/win-avx2-x64/build/bin/llama-server`
      )
    })
  })
  describe('isBackendInstalled', () => {
    it('should return true when backend is installed using its specific name', async () => {
      vi.stubGlobal('IS_WINDOWS', false) // Linux/macOS for llama-server
      // Mock both the check for the 'build' directory and the final executable path
      vi.mocked(fs.existsSync).mockImplementation(async (path: string) => {
        const expectedExePath = `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v1.0.0/win-avx2-x64/build/bin/llama-server`
        if (path === expectedExePath) return true
        if (path.endsWith('/build')) return true
        return false
      })

      const result = await isBackendInstalled('win-avx2-x64', 'v1.0.0')
      expect(result).toBe(true)
      // Check that it was called with the final exe path
      expect(fs.existsSync).toHaveBeenCalledWith(
        `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v1.0.0/win-avx2-x64/build/bin/llama-server`
      )
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
        if (command === 'is_library_available') return false
        if (command === 'decompress') return undefined
        return undefined
      })
      vi.mocked(fs.rm).mockResolvedValue(undefined)
    })
    it('should include cudart for cuda-12-common_cpus if not installed', async () => {
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

      await downloadBackend('win-cuda-12-common_cpus-x64', 'v1.0.0')

      const downloadItems = vi.mocked(mockDownloadManager.downloadFiles).mock
        .calls[0][0]
      expect(downloadItems.length).toBe(2)
      expect(downloadItems[0].url).toContain(
        'win-cuda-12-common_cpus-x64.tar.gz'
      )
      expect(downloadItems[1].url).toContain(
        'cudart-llama-bin-win-cu12.0-x64.tar.gz'
      )
    })

    it('should include cudart for old cuda-cu11.7 if not installed', async () => {
      vi.stubGlobal('IS_WINDOWS', false)
      vi.mocked(getSystemInfo).mockResolvedValue({
        os_type: 'linux',
        cpu: { arch: 'x86_64', extensions: [] },
        gpus: [
          {
            driver_version: '452.39',
            nvidia_info: { compute_capability: '7.0' },
          },
        ],
      } as any)

      // Downloading old name asset
      await downloadBackend('linux-avx2-cuda-cu11.7-x64', 'v1.0.0')

      const downloadItems = vi.mocked(mockDownloadManager.downloadFiles).mock
        .calls[0][0]
      expect(downloadItems.length).toBe(2)
      expect(downloadItems[0].url).toContain(
        'linux-avx2-cuda-cu11.7-x64.tar.gz'
      )
      expect(downloadItems[1].url).toContain(
        'cudart-llama-bin-linux-cu11.7-x64.tar.gz'
      )
    })

    it('should correctly extract parent directory from Windows paths', async () => {
      vi.stubGlobal('IS_WINDOWS', true)

      // Mock getSystemInfo for Windows/x64
      vi.mocked(getSystemInfo).mockResolvedValue({
        os_type: 'windows',
        cpu: { arch: 'x86_64', extensions: [] },
        gpus: [],
      } as any)

      // Mock dirname to return Windows-style path components (for dirname mock)
      vi.mocked(dirname).mockResolvedValue(
        `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v1.0.0/win-avx2-x64`
      )

      await downloadBackend('win-avx2-x64', 'v1.0.0')

      // Verify decompress was called with correct parent directory
      expect(invoke).toHaveBeenCalledWith('decompress', {
        path: `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v1.0.0/win-avx2-x64/backend.tar.gz`,
        outputDir: `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v1.0.0/win-avx2-x64`,
      })
    })
  })
})
