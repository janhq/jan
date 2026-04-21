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

// Mock constants
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
  getProxyConfig: vi.fn().mockReturnValue({ enabled: false }),
  basenameNoExt: vi.fn((name: string) => name.replace(/\.tar\.gz$/, '')),
}))
vi.mock('@tauri-apps/api/path', () => ({
  dirname: vi.fn(async (path: string) => path.split('/').slice(0, -1).join('/')),
  basename: vi.fn(async (path: string) => path.split('/').pop()),
}))
vi.mock('@janhq/tauri-plugin-llamacpp-api', async () => {
  const actual = await vi.importActual<
    typeof import('@janhq/tauri-plugin-llamacpp-api')
  >('@janhq/tauri-plugin-llamacpp-api')

  return {
    ...actual,
  }
})

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
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(getJanDataFolderPath).mockResolvedValue(MOCK_JAN_PATH_STRING)

    vi.mocked(getSystemInfo).mockResolvedValue({
      os_type: 'linux',
      cpu: {
        arch: 'x86_64',
        extensions: [],
      },
      gpus: [],
    } as any)

    vi.mocked(window.core.extensionManager.getByName).mockReturnValue(
      mockDownloadManager
    )
    vi.mocked(mockDownloadManager.downloadFiles).mockClear()
    // Re-apply after clearAllMocks wipes return values
    const { getProxyConfig } = await import('../util')
    vi.mocked(getProxyConfig).mockReturnValue({ enabled: false } as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getBackendDir', () => {
    it('should call invoke with correct params and return the path', async () => {
      const expectedDir = `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v1.2.3/linux-avx2-x64`
      vi.mocked(invoke).mockResolvedValueOnce(expectedDir)

      const dir = await getBackendDir('linux-avx2-x64', 'v1.2.3')

      expect(invoke).toHaveBeenCalledWith('plugin:llamacpp|get_backend_dir', {
        backend: 'linux-avx2-x64',
        version: 'v1.2.3',
        janDataFolder: MOCK_JAN_PATH_STRING,
      })
      expect(dir).toBe(expectedDir)
    })

    it('should call invoke with correct params for new common backend name', async () => {
      const expectedDir = `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v2.0.0/win-common_cpus-x64`
      vi.mocked(invoke).mockResolvedValueOnce(expectedDir)

      const dir = await getBackendDir('win-common_cpus-x64', 'v2.0.0')

      expect(invoke).toHaveBeenCalledWith('plugin:llamacpp|get_backend_dir', {
        backend: 'win-common_cpus-x64',
        version: 'v2.0.0',
        janDataFolder: MOCK_JAN_PATH_STRING,
      })
      expect(dir).toBe(expectedDir)
    })
  })

  describe('getBackendExePath', () => {
    it('should call invoke with correct params including isWindows', async () => {
      vi.stubGlobal('IS_WINDOWS', false)
      const expectedExe = `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v1.2.3/linux-avx2-x64/llama-server`
      vi.mocked(invoke).mockResolvedValueOnce(expectedExe)

      const exePath = await getBackendExePath('linux-avx2-x64', 'v1.2.3')

      expect(invoke).toHaveBeenCalledWith(
        'plugin:llamacpp|get_backend_exe_path',
        {
          backend: 'linux-avx2-x64',
          version: 'v1.2.3',
          janDataFolder: MOCK_JAN_PATH_STRING,
          isWindows: false,
        }
      )
      expect(exePath).toBe(expectedExe)
    })

    it('should pass isWindows=true on Windows', async () => {
      vi.stubGlobal('IS_WINDOWS', true)
      const expectedExe = `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v1.2.3/win-avx2-x64/llama-server.exe`
      vi.mocked(invoke).mockResolvedValueOnce(expectedExe)

      const exePath = await getBackendExePath('win-avx2-x64', 'v1.2.3')

      expect(invoke).toHaveBeenCalledWith(
        'plugin:llamacpp|get_backend_exe_path',
        {
          backend: 'win-avx2-x64',
          version: 'v1.2.3',
          janDataFolder: MOCK_JAN_PATH_STRING,
          isWindows: true,
        }
      )
      expect(exePath).toBe(expectedExe)
    })
  })

  describe('isBackendInstalled', () => {
    it('should call invoke with correct params and return true when installed', async () => {
      vi.stubGlobal('IS_WINDOWS', false)
      vi.mocked(invoke).mockResolvedValueOnce(true)

      const result = await isBackendInstalled('win-avx2-x64', 'v1.0.0')

      expect(invoke).toHaveBeenCalledWith(
        'plugin:llamacpp|check_backend_installed',
        {
          backend: 'win-avx2-x64',
          version: 'v1.0.0',
          janDataFolder: MOCK_JAN_PATH_STRING,
          isWindows: false,
        }
      )
      expect(result).toBe(true)
    })

    it('should return false when backend is not installed', async () => {
      vi.stubGlobal('IS_WINDOWS', false)
      vi.mocked(invoke).mockResolvedValueOnce(false)

      const result = await isBackendInstalled('win-avx2-x64', 'v1.0.0')

      expect(result).toBe(false)
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
    })

    it('should call build_backend_download_items and pass items with proxy to downloadFiles', async () => {
      vi.stubGlobal('IS_WINDOWS', false)
      const taskId = 'llamacpp-v1-0-0-linux-avx2-x64'
      const mockItems = [
        {
          url: 'https://github.com/janhq/llama.cpp/releases/download/v1.0.0/llama-v1.0.0-bin-linux-avx2-x64.tar.gz',
          save_path: `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v1.0.0/linux-avx2-x64/backend.tar.gz`,
          model_id: taskId,
        },
      ]

      vi.mocked(invoke).mockImplementation(async (command: string) => {
        if (command === 'plugin:llamacpp|build_backend_download_items')
          return mockItems
        if (command === 'decompress') return undefined
        return undefined
      })

      await downloadBackend('linux-avx2-x64', 'v1.0.0')

      expect(invoke).toHaveBeenCalledWith(
        'plugin:llamacpp|build_backend_download_items',
        {
          backend: 'linux-avx2-x64',
          version: 'v1.0.0',
          source: 'github',
          janDataFolder: MOCK_JAN_PATH_STRING,
          osType: 'linux',
        }
      )

      const downloadItems =
        vi.mocked(mockDownloadManager.downloadFiles).mock.calls[0][0]
      expect(downloadItems.length).toBe(1)
      expect(downloadItems[0].url).toContain('linux-avx2-x64.tar.gz')
      expect(downloadItems[0].proxy).toBeDefined()
    })

    it('should include cudart for cuda-12-common_cpus if Rust returns two items', async () => {
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

      const taskId = 'llamacpp-v1-0-0-win-cuda-12-common_cpus-x64'
      const mockItems = [
        {
          url: 'https://github.com/janhq/llama.cpp/releases/download/v1.0.0/llama-v1.0.0-bin-win-cuda-12-common_cpus-x64.tar.gz',
          save_path: `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v1.0.0/win-cuda-12-common_cpus-x64/backend.tar.gz`,
          model_id: taskId,
        },
        {
          url: 'https://github.com/janhq/llama.cpp/releases/download/v1.0.0/cudart-llama-bin-win-cu12.0-x64.tar.gz',
          save_path: `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v1.0.0/win-cuda-12-common_cpus-x64/build/bin/cuda12.tar.gz`,
          model_id: taskId,
        },
      ]

      vi.mocked(invoke).mockImplementation(async (command: string) => {
        if (command === 'plugin:llamacpp|build_backend_download_items')
          return mockItems
        if (command === 'decompress') return undefined
        return undefined
      })

      await downloadBackend('win-cuda-12-common_cpus-x64', 'v1.0.0')

      const downloadItems =
        vi.mocked(mockDownloadManager.downloadFiles).mock.calls[0][0]
      expect(downloadItems.length).toBe(2)
      expect(downloadItems[0].url).toContain('win-cuda-12-common_cpus-x64.tar.gz')
      expect(downloadItems[0].save_path).toBe(
        `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v1.0.0/win-cuda-12-common_cpus-x64/backend.tar.gz`
      )
      expect(downloadItems[1].url).toContain('cudart-llama-bin-win-cu12.0-x64.tar.gz')
      expect(downloadItems[1].save_path).toBe(
        `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v1.0.0/win-cuda-12-common_cpus-x64/build/bin/cuda12.tar.gz`
      )
      expect(downloadItems[0].proxy).toBeDefined()
      expect(downloadItems[1].proxy).toBeDefined()
    })

    it('should include cudart for old cuda-cu11.7 if Rust returns two items', async () => {
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

      const taskId = 'llamacpp-v1-0-0-linux-avx2-cuda-cu11-7-x64'
      const mockItems = [
        {
          url: 'https://github.com/janhq/llama.cpp/releases/download/v1.0.0/llama-v1.0.0-bin-linux-avx2-cuda-cu11.7-x64.tar.gz',
          save_path: `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v1.0.0/linux-avx2-cuda-cu11.7-x64/backend.tar.gz`,
          model_id: taskId,
        },
        {
          url: 'https://github.com/janhq/llama.cpp/releases/download/v1.0.0/cudart-llama-bin-linux-cu11.7-x64.tar.gz',
          save_path: `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v1.0.0/linux-avx2-cuda-cu11.7-x64/build/bin/cuda11.tar.gz`,
          model_id: taskId,
        },
      ]

      vi.mocked(invoke).mockImplementation(async (command: string) => {
        if (command === 'plugin:llamacpp|build_backend_download_items')
          return mockItems
        if (command === 'decompress') return undefined
        return undefined
      })

      await downloadBackend('linux-avx2-cuda-cu11.7-x64', 'v1.0.0')

      const downloadItems =
        vi.mocked(mockDownloadManager.downloadFiles).mock.calls[0][0]
      expect(downloadItems.length).toBe(2)
      expect(downloadItems[0].url).toContain('linux-avx2-cuda-cu11.7-x64.tar.gz')
      expect(downloadItems[0].save_path).toBe(
        `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v1.0.0/linux-avx2-cuda-cu11.7-x64/backend.tar.gz`
      )
      expect(downloadItems[1].url).toContain('cudart-llama-bin-linux-cu11.7-x64.tar.gz')
      expect(downloadItems[1].save_path).toBe(
        `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v1.0.0/linux-avx2-cuda-cu11.7-x64/build/bin/cuda11.tar.gz`
      )
    })

    it('should correctly call decompress for .tar.gz files and use dirname for outputDir', async () => {
      vi.stubGlobal('IS_WINDOWS', true)
      vi.mocked(getSystemInfo).mockResolvedValue({
        os_type: 'windows',
        cpu: { arch: 'x86_64', extensions: [] },
        gpus: [],
      } as any)

      const taskId = 'llamacpp-v1-0-0-win-avx2-x64'
      const backendTarPath = `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v1.0.0/win-avx2-x64/backend.tar.gz`
      const mockItems = [
        {
          url: 'https://github.com/janhq/llama.cpp/releases/download/v1.0.0/llama-v1.0.0-bin-win-avx2-x64.tar.gz',
          save_path: backendTarPath,
          model_id: taskId,
        },
      ]

      vi.mocked(invoke).mockImplementation(async (command: string) => {
        if (command === 'plugin:llamacpp|build_backend_download_items')
          return mockItems
        if (command === 'decompress') return undefined
        return undefined
      })

      vi.mocked(dirname).mockResolvedValue(
        `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v1.0.0/win-avx2-x64`
      )

      await downloadBackend('win-avx2-x64', 'v1.0.0')

      expect(invoke).toHaveBeenCalledWith('decompress', {
        path: backendTarPath,
        outputDir: `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v1.0.0/win-avx2-x64`,
      })
    })

    it('should fall back to CDN when GitHub download fails', async () => {
      vi.stubGlobal('IS_WINDOWS', false)
      vi.mocked(getSystemInfo).mockResolvedValue({
        os_type: 'linux',
        cpu: { arch: 'x86_64', extensions: [] },
        gpus: [],
      } as any)

      const taskId = 'llamacpp-v1-0-0-linux-avx2-x64'
      const mockItems = [
        {
          url: 'https://github.com/janhq/llama.cpp/releases/download/v1.0.0/llama-v1.0.0-bin-linux-avx2-x64.tar.gz',
          save_path: `${MOCK_JAN_PATH_STRING}/llamacpp/backends/v1.0.0/linux-avx2-x64/backend.tar.gz`,
          model_id: taskId,
        },
      ]

      // invoke always returns items (both github and cdn calls)
      vi.mocked(invoke).mockImplementation(async (command: string) => {
        if (command === 'plugin:llamacpp|build_backend_download_items')
          return mockItems
        if (command === 'decompress') return undefined
        return undefined
      })

      // First downloadFiles call (github) throws; second (cdn) succeeds
      vi.mocked(mockDownloadManager.downloadFiles)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockImplementation((items, _taskId, onProgress) => {
          if (onProgress) onProgress(100, 100)
          return Promise.resolve()
        })

      await downloadBackend('linux-avx2-x64', 'v1.0.0')

      // Should have been called twice (github + cdn fallback)
      expect(mockDownloadManager.downloadFiles).toHaveBeenCalledTimes(2)
      // Second call should use cdn source
      expect(invoke).toHaveBeenCalledWith(
        'plugin:llamacpp|build_backend_download_items',
        expect.objectContaining({ source: 'cdn' })
      )
    })
  })
})
