import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  listSupportedBackends,
  getBackendDir,
  getBackendExePath,
  isBackendInstalled,
  downloadBackend,
} from '../backend'

// Mock the global fetch function
global.fetch = vi.fn()

describe('Backend functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('listSupportedBackends', () => {
    it('should return supported backends for Windows x64', async () => {
      // Mock system info
      const getSystemInfo = vi.fn().mockResolvedValue({
        os_type: 'windows',
        cpu: {
          arch: 'x86_64',
          extensions: ['avx', 'avx2'],
        },
        gpus: [],
      })

      // Mock GitHub releases
      const mockReleases = [
        {
          tag_name: 'v1.0.0',
          assets: [
            { name: 'llama-v1.0.0-bin-win-avx2-x64.tar.gz' },
            { name: 'llama-v1.0.0-bin-win-avx-x64.tar.gz' },
          ],
        },
      ]

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockReleases),
      })

      const result = await listSupportedBackends()

      expect(result).toEqual([
        { version: 'v1.0.0', backend: 'win-avx2-x64' },
        { version: 'v1.0.0', backend: 'win-avx-x64' },
      ])
    })

    it('should return CUDA backends with proper CPU instruction detection for Windows', async () => {
      // Mock system info with CUDA support and AVX512
      const getSystemInfo = vi.fn().mockResolvedValue({
        os_type: 'windows',
        cpu: {
          arch: 'x86_64',
          extensions: ['avx', 'avx2', 'avx512'],
        },
        gpus: [
          {
            driver_version: '530.41',
            nvidia_info: { compute_capability: '8.6' },
          },
        ],
      })

      // Mock GitHub releases with CUDA backends
      const mockReleases = [
        {
          tag_name: 'v1.0.0',
          assets: [
            { name: 'llama-v1.0.0-bin-win-avx512-cuda-cu12.0-x64.tar.gz' },
            { name: 'llama-v1.0.0-bin-win-avx2-cuda-cu12.0-x64.tar.gz' },
            { name: 'llama-v1.0.0-bin-win-avx-cuda-cu12.0-x64.tar.gz' },
            { name: 'llama-v1.0.0-bin-win-noavx-cuda-cu12.0-x64.tar.gz' },
          ],
        },
      ]

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockReleases),
      })

      const result = await listSupportedBackends()

      expect(result).toContain({ version: 'v1.0.0', backend: 'win-avx512-cuda-cu12.0-x64' })
    })

    it('should select appropriate CUDA backend based on CPU features - AVX2 only', async () => {
      // Mock system info with CUDA support but only AVX2
      const getSystemInfo = vi.fn().mockResolvedValue({
        os_type: 'windows',
        cpu: {
          arch: 'x86_64',
          extensions: ['avx', 'avx2'], // No AVX512
        },
        gpus: [
          {
            driver_version: '530.41',
            nvidia_info: { compute_capability: '8.6' },
          },
        ],
      })

      const mockReleases = [
        {
          tag_name: 'v1.0.0',
          assets: [
            { name: 'llama-v1.0.0-bin-win-avx512-cuda-cu12.0-x64.tar.gz' },
            { name: 'llama-v1.0.0-bin-win-avx2-cuda-cu12.0-x64.tar.gz' },
            { name: 'llama-v1.0.0-bin-win-avx-cuda-cu12.0-x64.tar.gz' },
            { name: 'llama-v1.0.0-bin-win-noavx-cuda-cu12.0-x64.tar.gz' },
          ],
        },
      ]

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockReleases),
      })

      const result = await listSupportedBackends()

      expect(result).toContain({ version: 'v1.0.0', backend: 'win-avx2-cuda-cu12.0-x64' })
      expect(result).not.toContain({ version: 'v1.0.0', backend: 'win-avx512-cuda-cu12.0-x64' })
    })

    it('should select appropriate CUDA backend based on CPU features - no AVX', async () => {
      // Mock system info with CUDA support but no AVX
      const getSystemInfo = vi.fn().mockResolvedValue({
        os_type: 'windows',
        cpu: {
          arch: 'x86_64',
          extensions: [], // No AVX extensions
        },
        gpus: [
          {
            driver_version: '530.41',
            nvidia_info: { compute_capability: '8.6' },
          },
        ],
      })

      const mockReleases = [
        {
          tag_name: 'v1.0.0',
          assets: [
            { name: 'llama-v1.0.0-bin-win-avx512-cuda-cu12.0-x64.tar.gz' },
            { name: 'llama-v1.0.0-bin-win-avx2-cuda-cu12.0-x64.tar.gz' },
            { name: 'llama-v1.0.0-bin-win-avx-cuda-cu12.0-x64.tar.gz' },
            { name: 'llama-v1.0.0-bin-win-noavx-cuda-cu12.0-x64.tar.gz' },
          ],
        },
      ]

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockReleases),
      })

      const result = await listSupportedBackends()

      expect(result).toContain({ version: 'v1.0.0', backend: 'win-noavx-cuda-cu12.0-x64' })
      expect(result).not.toContain({ version: 'v1.0.0', backend: 'win-avx2-cuda-cu12.0-x64' })
      expect(result).not.toContain({ version: 'v1.0.0', backend: 'win-avx512-cuda-cu12.0-x64' })
    })

    it('should return CUDA backends with proper CPU instruction detection for Linux', async () => {
      // Mock system info with CUDA support and AVX support
      const getSystemInfo = vi.fn().mockResolvedValue({
        os_type: 'linux',
        cpu: {
          arch: 'x86_64',
          extensions: ['avx'], // Only AVX, no AVX2
        },
        gpus: [
          {
            driver_version: '530.60.13',
            nvidia_info: { compute_capability: '8.6' },
          },
        ],
      })

      const mockReleases = [
        {
          tag_name: 'v1.0.0',
          assets: [
            { name: 'llama-v1.0.0-bin-linux-avx512-cuda-cu12.0-x64.tar.gz' },
            { name: 'llama-v1.0.0-bin-linux-avx2-cuda-cu12.0-x64.tar.gz' },
            { name: 'llama-v1.0.0-bin-linux-avx-cuda-cu12.0-x64.tar.gz' },
            { name: 'llama-v1.0.0-bin-linux-noavx-cuda-cu12.0-x64.tar.gz' },
          ],
        },
      ]

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockReleases),
      })

      const result = await listSupportedBackends()

      expect(result).toContain({ version: 'v1.0.0', backend: 'linux-avx-cuda-cu12.0-x64' })
      expect(result).not.toContain({ version: 'v1.0.0', backend: 'linux-avx2-cuda-cu12.0-x64' })
      expect(result).not.toContain({ version: 'v1.0.0', backend: 'linux-avx512-cuda-cu12.0-x64' })
    })

    it('should return supported backends for macOS arm64', async () => {
      const getSystemInfo = vi.fn().mockResolvedValue({
        os_type: 'macos',
        cpu: {
          arch: 'aarch64',
          extensions: [],
        },
        gpus: [],
      })

      const mockReleases = [
        {
          tag_name: 'v1.0.0',
          assets: [{ name: 'llama-v1.0.0-bin-macos-arm64.tar.gz' }],
        },
      ]

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockReleases),
      })

      const result = await listSupportedBackends()

      expect(result).toEqual([{ version: 'v1.0.0', backend: 'macos-arm64' }])
    })
  })

  describe('getBackendDir', () => {
    it('should return correct backend directory path', async () => {
      const { getJanDataFolderPath, joinPath } = await import('@janhq/core')

      vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')
      vi.mocked(joinPath).mockResolvedValue(
        '/path/to/jan/llamacpp/backends/v1.0.0/win-avx2-x64'
      )

      const result = await getBackendDir('win-avx2-x64', 'v1.0.0')

      expect(result).toBe('/path/to/jan/llamacpp/backends/v1.0.0/win-avx2-x64')
      expect(joinPath).toHaveBeenCalledWith([
        '/path/to/jan',
        'llamacpp',
        'backends',
        'v1.0.0',
        'win-avx2-x64',
      ])
    })
  })

  describe('getBackendExePath', () => {
    it('should return correct exe path for Windows', async () => {
      const getSystemInfo = vi.fn().mockResolvedValue({
        os_type: 'windows',
      })

      const { getJanDataFolderPath, joinPath, fs } = await import('@janhq/core')

      vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')
      vi.mocked(joinPath)
        .mockResolvedValueOnce(
          '/path/to/jan/llamacpp/backends/v1.0.0/win-avx2-x64'
        )
        .mockResolvedValueOnce(
          '/path/to/jan/llamacpp/backends/v1.0.0/win-avx2-x64/build'
        )
        .mockResolvedValueOnce(
          '/path/to/jan/llamacpp/backends/v1.0.0/win-avx2-x64/build/bin/llama-server.exe'
        )
      
      vi.mocked(fs.existsSync).mockResolvedValue(true)

      const result = await getBackendExePath('win-avx2-x64', 'v1.0.0')

      expect(result).toBe(
        '/path/to/jan/llamacpp/backends/v1.0.0/win-avx2-x64/build/bin/llama-server.exe'
      )
    })

    it('should return correct exe path for Linux/macOS', async () => {
      const getSystemInfo = vi.fn().mockResolvedValue({
        os_type: 'linux',
      })

      const { getJanDataFolderPath, joinPath, fs } = await import('@janhq/core')

      vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')
      vi.mocked(joinPath)
        .mockResolvedValueOnce(
          '/path/to/jan/llamacpp/backends/v1.0.0/linux-avx2-x64'
        )
        .mockResolvedValueOnce(
          '/path/to/jan/llamacpp/backends/v1.0.0/linux-avx2-x64/build'
        )
        .mockResolvedValueOnce(
          '/path/to/jan/llamacpp/backends/v1.0.0/linux-avx2-x64/build/bin/llama-server'
        )
      
      vi.mocked(fs.existsSync).mockResolvedValue(true)

      const result = await getBackendExePath('linux-avx2-x64', 'v1.0.0')

      expect(result).toBe(
        '/path/to/jan/llamacpp/backends/v1.0.0/linux-avx2-x64/build/bin/llama-server'
      )
    })
  })

  describe('isBackendInstalled', () => {
    it('should return true when backend is installed', async () => {
      const { fs } = await import('@janhq/core')

      vi.mocked(fs.existsSync).mockResolvedValue(true)

      const result = await isBackendInstalled('win-avx2-x64', 'v1.0.0')

      expect(result).toBe(true)
    })

    it('should return false when backend is not installed', async () => {
      const { fs } = await import('@janhq/core')

      vi.mocked(fs.existsSync).mockResolvedValue(false)

      const result = await isBackendInstalled('win-avx2-x64', 'v1.0.0')

      expect(result).toBe(false)
    })
  })

  describe('downloadBackend', () => {
    it('should download backend successfully', async () => {
      const mockDownloadManager = {
        downloadFiles: vi
          .fn()
          .mockImplementation((items, taskId, onProgress) => {
            // Simulate successful download
            onProgress(100, 100)
            return Promise.resolve()
          }),
      }

      window.core.extensionManager.getByName = vi
        .fn()
        .mockReturnValue(mockDownloadManager)

      const { getJanDataFolderPath, joinPath, fs, events } = await import(
        '@janhq/core'
      )
      const { invoke } = await import('@tauri-apps/api/core')

      vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')
      vi.mocked(joinPath).mockImplementation((paths) =>
        Promise.resolve(paths.join('/'))
      )
      vi.mocked(fs.rm).mockResolvedValue(undefined)
      vi.mocked(invoke).mockResolvedValue(undefined)

      await downloadBackend('win-avx2-x64', 'v1.0.0')

      expect(mockDownloadManager.downloadFiles).toHaveBeenCalled()
      expect(events.emit).toHaveBeenCalledWith('onFileDownloadSuccess', {
        modelId: 'llamacpp-v1-0-0-win-avx2-x64',
        downloadType: 'Engine',
      })
    })

    it('should handle download errors', async () => {
      const mockDownloadManager = {
        downloadFiles: vi.fn().mockRejectedValue(new Error('Download failed')),
      }

      window.core.extensionManager.getByName = vi
        .fn()
        .mockReturnValue(mockDownloadManager)

      const { events } = await import('@janhq/core')

      await expect(downloadBackend('win-avx2-x64', 'v1.0.0')).rejects.toThrow(
        'Download failed'
      )

      expect(events.emit).toHaveBeenCalledWith('onFileDownloadError', {
        modelId: 'llamacpp-v1-0-0-win-avx2-x64',
        downloadType: 'Engine',
      })
    })

    it('should correctly extract parent directory from Windows paths', async () => {
      const { dirname } = await import('@tauri-apps/api/path')

      // Mock dirname to simulate Windows path handling
      vi.mocked(dirname).mockResolvedValue('C:\\path\\to\\backend')

      const mockDownloadManager = {
        downloadFiles: vi
          .fn()
          .mockImplementation((items, taskId, onProgress) => {
            onProgress(100, 100)
            return Promise.resolve()
          }),
      }

      window.core.extensionManager.getByName = vi
        .fn()
        .mockReturnValue(mockDownloadManager)

      const { getJanDataFolderPath, joinPath, fs, events } = await import(
        '@janhq/core'
      )
      const { invoke } = await import('@tauri-apps/api/core')

      vi.mocked(getJanDataFolderPath).mockResolvedValue('C:\\path\\to\\jan')
      vi.mocked(joinPath).mockImplementation((paths) =>
        Promise.resolve(paths.join('\\'))
      )
      vi.mocked(fs.rm).mockResolvedValue(undefined)
      vi.mocked(invoke).mockResolvedValue(undefined)

      await downloadBackend('win-avx2-x64', 'v1.0.0')

      // Verify that dirname was called for path extraction
      expect(dirname).toHaveBeenCalledWith(
        'C:\\path\\to\\jan\\llamacpp\\backends\\v1.0.0\\win-avx2-x64\\backend.tar.gz'
      )

      // Verify decompress was called with correct parent directory
      expect(invoke).toHaveBeenCalledWith('decompress', {
        path: 'C:\\path\\to\\jan\\llamacpp\\backends\\v1.0.0\\win-avx2-x64\\backend.tar.gz',
        outputDir: 'C:\\path\\to\\backend',
      })
    })

    it('should correctly extract parent directory from Unix paths', async () => {
      const { dirname } = await import('@tauri-apps/api/path')

      // Mock dirname to simulate Unix path handling
      vi.mocked(dirname).mockResolvedValue('/path/to/backend')

      const mockDownloadManager = {
        downloadFiles: vi
          .fn()
          .mockImplementation((items, taskId, onProgress) => {
            onProgress(100, 100)
            return Promise.resolve()
          }),
      }

      window.core.extensionManager.getByName = vi
        .fn()
        .mockReturnValue(mockDownloadManager)

      const { getJanDataFolderPath, joinPath, fs, events } = await import(
        '@janhq/core'
      )
      const { invoke } = await import('@tauri-apps/api/core')

      vi.mocked(getJanDataFolderPath).mockResolvedValue('/path/to/jan')
      vi.mocked(joinPath).mockImplementation((paths) =>
        Promise.resolve(paths.join('/'))
      )
      vi.mocked(fs.rm).mockResolvedValue(undefined)
      vi.mocked(invoke).mockResolvedValue(undefined)

      await downloadBackend('linux-avx2-x64', 'v1.0.0')

      // Verify that dirname was called for path extraction
      expect(dirname).toHaveBeenCalledWith(
        '/path/to/jan/llamacpp/backends/v1.0.0/linux-avx2-x64/backend.tar.gz'
      )

      // Verify decompress was called with correct parent directory
      expect(invoke).toHaveBeenCalledWith('decompress', {
        path: '/path/to/jan/llamacpp/backends/v1.0.0/linux-avx2-x64/backend.tar.gz',
        outputDir: '/path/to/backend',
      })
    })
  })
})
