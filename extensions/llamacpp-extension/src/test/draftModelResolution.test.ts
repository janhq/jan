import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import llamacpp_extension from '../index'

// Mock fetch globally
global.fetch = vi.fn()

vi.mock('../backend', () => ({
  isBackendInstalled: vi.fn(),
  getBackendExePath: vi.fn(),
  downloadBackend: vi.fn(),
  listSupportedBackends: vi.fn(),
  getBackendDir: vi.fn(),
}))

vi.mock('@janhq/tauri-plugin-llamacpp-api', async () => {
  const actual = await vi.importActual<
    typeof import('@janhq/tauri-plugin-llamacpp-api')
  >('@janhq/tauri-plugin-llamacpp-api')
  return {
    ...actual,
    mapOldBackendToNew: vi.fn(),
    removeOldBackendVersions: vi.fn(),
    loadLlamaModel: vi.fn(),
  }
})

vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  attachConsole: vi.fn(),
}))

describe('llamacpp_extension - draft model path resolution', () => {
  let extension: llamacpp_extension

  beforeEach(() => {
    vi.clearAllMocks()
    extension = new llamacpp_extension()
    extension['providerPath'] = '/path/to/jan/llamacpp'
    extension['config'] = {
      version_backend: 'b6325/cpu',
      flash_attn: 'off',
    } as any
    extension.autoUnload = false

    vi.spyOn(extension as any, 'findSessionByModel').mockResolvedValue(null)
    vi.spyOn(extension as any, 'getLoadedModels').mockResolvedValue([])
    vi.spyOn(extension as any, 'ensureBackendReady').mockResolvedValue(undefined)
    vi.spyOn(extension as any, 'getRandomPort').mockResolvedValue(1234)
    vi.spyOn(extension as any, 'generateApiKey').mockResolvedValue('test-key')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('resolveDraftModelPath (via loadModel)', () => {
    it('resolves draft_model_path when draft_model_id is set in cfg', async () => {
      const { getJanDataFolderPath, joinPath } = await import('@janhq/core')
      const { invoke } = await import('@tauri-apps/api/core')
      const { loadLlamaModel } = await import('@janhq/tauri-plugin-llamacpp-api')

      vi.mocked(getJanDataFolderPath).mockResolvedValue('/jan-data')

      vi.mocked(joinPath).mockImplementation((paths: string[]) =>
        Promise.resolve(paths.join('/'))
      )

      // read_yaml returns the main model config first, then the draft model config.
      vi.mocked(invoke).mockImplementation((cmd: string, args: any) => {
        if (cmd === 'read_yaml' && args?.path?.includes('/models/main-model.gguf/model.yml')) {
          return Promise.resolve({
            id: 'main-model.gguf',
            model_path: 'main-model/model.gguf',
          })
        }
        if (cmd === 'read_yaml' && args?.path?.includes('/models/draft-3b/model.yml')) {
          return Promise.resolve({ model_path: 'draft-3b/draft.gguf' })
        }
        return Promise.resolve(null)
      })

      vi.mocked(loadLlamaModel).mockResolvedValue({} as any)
      extension['config'] = {
        ...extension['config'],
        draft_model_id: 'draft-3b',
      } as any

      // Call through the internal path that processes draft_model_id
      // We test the resolution logic by calling loadModel (which internally resolves the path)
      await extension.load('main-model.gguf').catch(() => {
        // loadModel may fail for other reasons (e.g. backend not set up) — that's fine
        // We only care that joinPath was called with the draft model paths
      })

      // Verify that joinPath was called to build the draft config path
      expect(joinPath).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.stringContaining('llamacpp'),
          'models',
          'draft-3b',
          'model.yml',
        ])
      )
    })

    it('resolves draft_model_path from overrideSettings when cfg lacks draft_model_id', async () => {
      const { getJanDataFolderPath, joinPath } = await import('@janhq/core')
      const { invoke } = await import('@tauri-apps/api/core')
      const { loadLlamaModel } = await import('@janhq/tauri-plugin-llamacpp-api')

      vi.mocked(getJanDataFolderPath).mockResolvedValue('/jan-data')

      vi.mocked(joinPath).mockImplementation((paths: string[]) =>
        Promise.resolve(paths.join('/'))
      )

      vi.mocked(invoke).mockImplementation((cmd: string, args: any) => {
        if (cmd === 'read_yaml' && args?.path?.includes('/models/main-model.gguf/model.yml')) {
          return Promise.resolve({
            id: 'main-model.gguf',
            model_path: 'main-model/model.gguf',
          })
        }
        if (cmd === 'read_yaml' && args?.path?.includes('/models/draft-1b/model.yml')) {
          return Promise.resolve({ model_path: 'draft-1b/draft.gguf' })
        }
        return Promise.resolve(null)
      })

      vi.mocked(loadLlamaModel).mockResolvedValue({} as any)

      await extension
        .load('main-model.gguf', { draft_model_id: 'draft-1b' } as any)
        .catch(() => {})

      expect(joinPath).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.stringContaining('llamacpp'),
          'models',
          'draft-1b',
          'model.yml',
        ])
      )
    })

    it('skips draft model resolution when no draft_model_id is provided', async () => {
      const { getJanDataFolderPath, joinPath } = await import('@janhq/core')
      const { invoke } = await import('@tauri-apps/api/core')
      const { loadLlamaModel } = await import('@janhq/tauri-plugin-llamacpp-api')

      vi.mocked(getJanDataFolderPath).mockResolvedValue('/jan-data')

      vi.mocked(joinPath).mockImplementation((paths: string[]) =>
        Promise.resolve(paths.join('/'))
      )

      vi.mocked(invoke).mockImplementation((cmd: string, args: any) => {
        if (cmd === 'read_yaml' && args?.path?.includes('/models/solo-model.gguf/model.yml')) {
          return Promise.resolve({
            id: 'solo-model.gguf',
            model_path: 'solo-model/model.gguf',
          })
        }
        return Promise.resolve(null)
      })
      vi.mocked(loadLlamaModel).mockResolvedValue({} as any)

      await extension.load('solo-model.gguf').catch(() => {})

      // read_yaml should not be called for draft model path resolution
      const readYamlCalls = vi.mocked(invoke).mock.calls.filter(
        ([cmd]) => cmd === 'read_yaml'
      )
      // All read_yaml calls should be for the model itself, not for a draft
      readYamlCalls.forEach(([, args]: any) => {
        if (args?.path) {
          expect(args.path).not.toContain('draft')
        }
      })
    })

    it('skips draft model resolution when draft_model_id is set to none', async () => {
      const { getJanDataFolderPath, joinPath } = await import('@janhq/core')
      const { invoke } = await import('@tauri-apps/api/core')
      const { loadLlamaModel } = await import('@janhq/tauri-plugin-llamacpp-api')

      vi.mocked(getJanDataFolderPath).mockResolvedValue('/jan-data')

      vi.mocked(joinPath).mockImplementation((paths: string[]) =>
        Promise.resolve(paths.join('/'))
      )

      vi.mocked(invoke).mockImplementation((cmd: string, args: any) => {
        if (cmd === 'read_yaml' && args?.path?.includes('/models/solo-model.gguf/model.yml')) {
          return Promise.resolve({
            id: 'solo-model.gguf',
            model_path: 'solo-model/model.gguf',
            draft_model_id: 'none',
          })
        }
        return Promise.resolve(null)
      })
      vi.mocked(loadLlamaModel).mockResolvedValue({} as any)

      await extension.load('solo-model.gguf').catch(() => {})

      const readYamlCalls = vi.mocked(invoke).mock.calls.filter(
        ([cmd]) => cmd === 'read_yaml'
      )

      readYamlCalls.forEach(([, args]: any) => {
        if (args?.path) {
          expect(args.path).not.toContain('/models/none/model.yml')
        }
      })
    })

    it('proceeds with model load even when draft model yaml read fails', async () => {
      const { getJanDataFolderPath, joinPath } = await import('@janhq/core')
      const { invoke } = await import('@tauri-apps/api/core')
      const { loadLlamaModel } = await import('@janhq/tauri-plugin-llamacpp-api')

      vi.mocked(getJanDataFolderPath).mockResolvedValue('/jan-data')
      vi.mocked(joinPath).mockImplementation((paths: string[]) =>
        Promise.resolve(paths.join('/'))
      )

      // Simulate read_yaml throwing for the draft model
      vi.mocked(invoke).mockImplementation((cmd: string, args: any) => {
        if (cmd === 'read_yaml' && args?.path?.includes('/models/main-model.gguf/model.yml')) {
          return Promise.resolve({
            id: 'main-model.gguf',
            model_path: 'main-model/model.gguf',
            draft_model_id: 'missing-draft',
          })
        }
        if (cmd === 'read_yaml' && args?.path?.includes('missing-draft')) {
          return Promise.reject(new Error('File not found'))
        }
        return Promise.resolve({ model_path: 'main/model.gguf' })
      })

      vi.mocked(loadLlamaModel).mockResolvedValue({} as any)

      // Should not throw — draft resolution failure is non-fatal (logged as warning)
      await expect(
        extension.load('main-model.gguf').catch((e) => {
          // Only re-throw if it's not a backend/server-startup error
          if (e.message === 'File not found') throw e
        })
      ).resolves.not.toThrow()
    })
  })
})
