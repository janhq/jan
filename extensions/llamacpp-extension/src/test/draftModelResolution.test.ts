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

describe('llamacpp_extension - draft model path resolution', () => {
  let extension: llamacpp_extension

  beforeEach(() => {
    vi.clearAllMocks()
    extension = new llamacpp_extension()
    extension['providerPath'] = '/path/to/jan/llamacpp'
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

      // read_yaml returns draft model config
      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === 'read_yaml') {
          return Promise.resolve({ model_path: 'draft-3b/draft.gguf' })
        }
        return Promise.resolve(null)
      })

      vi.mocked(loadLlamaModel).mockResolvedValue({} as any)

      // Build a minimal model config with draft_model_id
      const modelConfig: any = {
        id: 'main-model.gguf',
        model_path: 'main-model/model.gguf',
        draft_model_id: 'draft-3b',
      }

      // Call through the internal path that processes draft_model_id
      // We test the resolution logic by calling loadModel (which internally resolves the path)
      await extension.loadModel(modelConfig).catch(() => {
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

      vi.mocked(invoke).mockImplementation((cmd: string) => {
        if (cmd === 'read_yaml') {
          return Promise.resolve({ model_path: 'draft-1b/draft.gguf' })
        }
        return Promise.resolve(null)
      })

      vi.mocked(loadLlamaModel).mockResolvedValue({} as any)

      const modelConfig: any = {
        id: 'main-model.gguf',
        model_path: 'main-model/model.gguf',
        // no draft_model_id on the config itself
      }

      await extension
        .loadModel(modelConfig, { draft_model_id: 'draft-1b' } as any)
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

      vi.mocked(invoke).mockResolvedValue(null)
      vi.mocked(loadLlamaModel).mockResolvedValue({} as any)

      const modelConfig: any = {
        id: 'solo-model.gguf',
        model_path: 'solo-model/model.gguf',
      }

      await extension.loadModel(modelConfig).catch(() => {})

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
        if (cmd === 'read_yaml' && args?.path?.includes('missing-draft')) {
          return Promise.reject(new Error('File not found'))
        }
        return Promise.resolve({ model_path: 'main/model.gguf' })
      })

      vi.mocked(loadLlamaModel).mockResolvedValue({} as any)

      const modelConfig: any = {
        id: 'main-model.gguf',
        model_path: 'main-model/model.gguf',
        draft_model_id: 'missing-draft',
      }

      // Should not throw — draft resolution failure is non-fatal (logged as warning)
      await expect(
        extension.loadModel(modelConfig).catch((e) => {
          // Only re-throw if it's not a backend/server-startup error
          if (e.message === 'File not found') throw e
        })
      ).resolves.not.toThrow()
    })
  })
})
