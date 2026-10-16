import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriCoreService } from '../tauri'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn(),
}))

import { invoke, convertFileSrc } from '@tauri-apps/api/core'
const mockInvoke = invoke as ReturnType<typeof vi.fn>
const mockConvertFileSrc = convertFileSrc as ReturnType<typeof vi.fn>

describe('TauriCoreService', () => {
  let svc: TauriCoreService

  beforeEach(() => {
    svc = new TauriCoreService()
    vi.clearAllMocks()
  })

  describe('invoke', () => {
    it('delegates to Tauri invoke and returns result', async () => {
      mockInvoke.mockResolvedValue({ data: 'ok' })
      const result = await svc.invoke('my_command', { key: 'val' })
      expect(mockInvoke).toHaveBeenCalledWith('my_command', { key: 'val' })
      expect(result).toEqual({ data: 'ok' })
    })

    it('throws on Tauri invoke error', async () => {
      mockInvoke.mockRejectedValue(new Error('ipc fail'))
      await expect(svc.invoke('bad_cmd')).rejects.toThrow('ipc fail')
    })
  })

  describe('convertFileSrc', () => {
    it('delegates to Tauri convertFileSrc', () => {
      mockConvertFileSrc.mockReturnValue('asset://localhost/file.png')
      expect(svc.convertFileSrc('/file.png', 'asset')).toBe('asset://localhost/file.png')
      expect(mockConvertFileSrc).toHaveBeenCalledWith('/file.png', 'asset')
    })

    it('returns original path on error', () => {
      mockConvertFileSrc.mockImplementation(() => { throw new Error('fail') })
      expect(svc.convertFileSrc('/file.png')).toBe('/file.png')
    })
  })

  describe('getActiveExtensions', () => {
    const mockExtensionsManifest = (manifest: string | null) => {
      mockInvoke.mockImplementation(async (command: string) => {
        if (command === 'get_jan_data_folder_path') return '/jan/data'
        if (command === 'exists_sync') return manifest !== null
        if (command === 'read_file_sync') return manifest
        throw new Error(`unexpected command ${command}`)
      })
    }

    it('merges bundled extensions with user-installed entries from extensions.json', async () => {
      mockExtensionsManifest(
        JSON.stringify([
          {
            url: '/jan/data/extensions/@janhq/markdown-extension/dist/index.js',
            name: '@janhq/markdown-extension',
            productName: 'Markdown',
            active: true,
            description: 'Markdown support',
            version: '0.1.0',
          },
        ])
      )

      const exts = await svc.getActiveExtensions()
      const names = exts.map((e) => e.name)
      expect(names).toContain('@janhq/llamacpp-extension')
      expect(names).toContain('@janhq/markdown-extension')

      const userExt = exts.find((e) => e.name === '@janhq/markdown-extension')
      expect(userExt?.url).toBe(
        '/jan/data/extensions/@janhq/markdown-extension/dist/index.js'
      )
      // Loaded via dynamic import at activation time, not pre-instantiated.
      expect(userExt?.extensionInstance).toBeUndefined()
      expect(userExt?.active).toBe(true)
      expect(mockInvoke).toHaveBeenCalledWith(
        'get_jan_data_folder_path',
        undefined
      )
      expect(mockInvoke).toHaveBeenCalledWith('exists_sync', {
        args: ['/jan/data/extensions/extensions.json'],
      })
    })

    it('returns bundled extensions when extensions.json is absent', async () => {
      mockExtensionsManifest(null)
      const exts = await svc.getActiveExtensions()
      expect(exts.length).toBeGreaterThan(0)
      expect(exts.every((e) => e.url === 'built-in')).toBe(true)
      expect(exts.every((e) => e.extensionInstance)).toBe(true)
    })

    it('skips on-disk entries whose name matches a bundled extension', async () => {
      mockExtensionsManifest(
        JSON.stringify([
          {
            url: '/jan/data/extensions/@janhq/llamacpp-extension/dist/index.js',
            name: '@janhq/llamacpp-extension',
            active: true,
          },
        ])
      )
      const exts = await svc.getActiveExtensions()
      const llamacpp = exts.filter((e) => e.name === '@janhq/llamacpp-extension')
      expect(llamacpp).toHaveLength(1)
      expect(llamacpp[0].url).toBe('built-in')
    })

    it('skips malformed entries missing a name or url', async () => {
      mockExtensionsManifest(
        JSON.stringify([
          { name: '@janhq/markdown-extension' },
          { url: '/jan/data/extensions/orphan/dist/index.js' },
          'not-an-object',
          {
            url: '/jan/data/extensions/@janhq/markdown-extension/dist/index.js',
            name: '@janhq/markdown-extension',
          },
        ])
      )
      const exts = await svc.getActiveExtensions()
      expect(
        exts.filter((e) => e.name === '@janhq/markdown-extension')
      ).toHaveLength(1)
    })

    it('honors the legacy "_active" flag when "active" is absent', async () => {
      mockExtensionsManifest(
        JSON.stringify([
          {
            url: '/jan/data/extensions/legacy/dist/index.js',
            name: 'legacy-extension',
            _active: false,
          },
        ])
      )
      const exts = await svc.getActiveExtensions()
      expect(exts.find((e) => e.name === 'legacy-extension')?.active).toBe(false)
    })

    it('falls back to bundled extensions when the manifest cannot be parsed', async () => {
      mockExtensionsManifest('not json')
      const exts = await svc.getActiveExtensions()
      expect(exts.every((e) => e.url === 'built-in')).toBe(true)
    })

    it('falls back to bundled extensions when the backend read fails', async () => {
      mockInvoke.mockRejectedValue(new Error('ipc fail'))
      const exts = await svc.getActiveExtensions()
      expect(exts.every((e) => e.url === 'built-in')).toBe(true)
    })
  })

  describe('installExtensions', () => {
    it('is a no-op that does not invoke the backend', async () => {
      await expect(svc.installExtensions()).resolves.toBeUndefined()
      expect(mockInvoke).not.toHaveBeenCalled()
    })
  })

  describe('installExtension', () => {
    it('returns the merged bundled + user-installed extension list', async () => {
      mockInvoke.mockImplementation(async (command: string) => {
        if (command === 'get_jan_data_folder_path') return '/jan/data'
        if (command === 'exists_sync') return true
        if (command === 'read_file_sync')
          return JSON.stringify([
            {
              url: '/jan/data/extensions/@janhq/markdown-extension/dist/index.js',
              name: '@janhq/markdown-extension',
              active: true,
            },
          ])
        throw new Error(`unexpected command ${command}`)
      })
      const exts = await svc.installExtension([])
      const names = exts.map((e) => e.name)
      expect(names).toContain('@janhq/llamacpp-extension')
      expect(names).toContain('@janhq/markdown-extension')
    })
  })

  describe('uninstallExtension', () => {
    it('returns false (bundled extensions cannot be uninstalled)', async () => {
      expect(await svc.uninstallExtension(['ext1'])).toBe(false)
      expect(mockInvoke).not.toHaveBeenCalled()
    })
  })

  describe('getAppToken', () => {
    it('returns token string', async () => {
      mockInvoke.mockResolvedValue('token123')
      expect(await svc.getAppToken()).toBe('token123')
    })

    it('returns null on error', async () => {
      mockInvoke.mockRejectedValue(new Error('fail'))
      expect(await svc.getAppToken()).toBeNull()
    })
  })
})
