import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DefaultModelsService } from '../default'
import { EngineManager, events, DownloadEvent, ContentType } from '@janhq/core'

const { mockEvents, mockDownloadEvent, mockExtractContent, mockExtractMetadata } = vi.hoisted(() => ({
  mockEvents: { emit: vi.fn() },
  mockDownloadEvent: {
    onFileDownloadStopped: 'onFileDownloadStopped',
    onFileDownloadError: 'onFileDownloadError',
  } as Record<string, string>,
  mockExtractContent: vi.fn().mockReturnValue(''),
  mockExtractMetadata: vi.fn().mockReturnValue(''),
}))

vi.mock('@janhq/core', () => ({
  EngineManager: { instance: vi.fn() },
  events: mockEvents,
  DownloadEvent: mockDownloadEvent,
  ContentType: { Text: 'text', Image: 'image_url' },
}))

vi.mock('@/lib/utils', () => ({
  sanitizeModelId: (id: string) => id,
}))

vi.mock('../tokenCountToolContext', () => ({
  extractToolContextFromContent: mockExtractContent,
  extractToolContextFromMetadata: mockExtractMetadata,
}))

global.fetch = vi.fn()

Object.defineProperty(global, 'MODEL_CATALOG_URL', {
  value: 'https://example.com/models',
  writable: true,
  configurable: true,
})
Object.defineProperty(global, 'LATEST_JAN_MODEL_URL', {
  value: 'https://example.com/latest',
  writable: true,
  configurable: true,
})

describe('DefaultModelsService - additional coverage', () => {
  let svc: DefaultModelsService

  const mockEngine = {
    get: vi.fn(),
    list: vi.fn(),
    updateSettings: vi.fn(),
    import: vi.fn(),
    abortImport: vi.fn(),
    delete: vi.fn(),
    getLoadedModels: vi.fn(),
    unload: vi.fn(),
    load: vi.fn(),
    isModelSupported: vi.fn(),
    isToolSupported: vi.fn(),
    checkMmprojExists: vi.fn(),
    validateGgufFile: vi.fn(),
    getTokensCount: vi.fn(),
  }

  const mockEngineManager = {
    get: vi.fn().mockReturnValue(mockEngine),
  }

  beforeEach(() => {
    svc = new DefaultModelsService()
    vi.clearAllMocks()
    ;(EngineManager.instance as any).mockReturnValue(mockEngineManager)
    mockEngineManager.get.mockReturnValue(mockEngine)
    mockExtractContent.mockReturnValue('')
    mockExtractMetadata.mockReturnValue('')
  })

  // ── getModel ──
  describe('getModel', () => {
    it('returns model info from engine', async () => {
      mockEngine.get.mockReturnValue({ id: 'm1' })
      const result = await svc.getModel('m1')
      expect(result).toEqual({ id: 'm1' })
    })

    it('returns undefined when engine is missing', async () => {
      mockEngineManager.get.mockReturnValueOnce(undefined)
      const result = await svc.getModel('m1')
      expect(result).toBeUndefined()
    })
  })

  // ── fetchModels with no engine ──
  describe('fetchModels', () => {
    it('returns empty array when engine is missing', async () => {
      mockEngineManager.get.mockReturnValueOnce(undefined)
      const result = await svc.fetchModels()
      expect(result).toEqual([])
    })
  })

  // ── fetchLatestJanModel ──
  describe('fetchLatestJanModel', () => {
    it('returns model on success (object response)', async () => {
      const model = { model_name: 'jan-nano' }
      ;(fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(model),
      })
      const result = await svc.fetchLatestJanModel()
      expect(result).toEqual(model)
    })

    it('returns first element when response is array', async () => {
      const models = [{ model_name: 'jan-nano' }, { model_name: 'jan-micro' }]
      ;(fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(models),
      })
      const result = await svc.fetchLatestJanModel()
      expect(result).toEqual(models[0])
    })

    it('returns null on non-ok response', async () => {
      ;(fetch as any).mockResolvedValue({ ok: false, status: 500, statusText: 'Error' })
      const result = await svc.fetchLatestJanModel()
      expect(result).toBeNull()
    })

    it('returns null on network error', async () => {
      ;(fetch as any).mockRejectedValue(new Error('network'))
      const result = await svc.fetchLatestJanModel()
      expect(result).toBeNull()
    })

    it('returns null when response is empty array', async () => {
      ;(fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue([]),
      })
      const result = await svc.fetchLatestJanModel()
      expect(result).toBeNull()
    })
  })

  // ── pullModelWithMetadata ──
  describe('pullModelWithMetadata', () => {
    it('calls pullModel with default params when skipVerification is true', async () => {
      mockEngine.import.mockResolvedValue(undefined)
      await svc.pullModelWithMetadata('id1', 'https://huggingface.co/org/repo/resolve/main/model.gguf')
      expect(mockEngine.import).toHaveBeenCalledWith('id1', {
        modelPath: 'https://huggingface.co/org/repo/resolve/main/model.gguf',
        mmprojPath: undefined,
        modelSha256: undefined,
        modelSize: undefined,
        mmprojSha256: undefined,
        mmprojSize: undefined,
      })
    })

    it('fetches metadata when skipVerification is false', async () => {
      const repoInfo = {
        siblings: [
          { rfilename: 'model.gguf', lfs: { sha256: 'abc', size: 1000 } },
          { rfilename: 'mmproj.gguf', lfs: { sha256: 'def', size: 500 } },
        ],
      }
      ;(fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(repoInfo),
      })
      mockEngine.import.mockResolvedValue(undefined)

      await svc.pullModelWithMetadata(
        'id1',
        'https://huggingface.co/org/repo/resolve/main/model.gguf',
        'https://huggingface.co/org/repo/resolve/main/mmproj.gguf',
        undefined,
        false
      )

      expect(mockEngine.import).toHaveBeenCalledWith('id1', {
        modelPath: 'https://huggingface.co/org/repo/resolve/main/model.gguf',
        mmprojPath: 'https://huggingface.co/org/repo/resolve/main/mmproj.gguf',
        modelSha256: 'abc',
        modelSize: 1000,
        mmprojSha256: 'def',
        mmprojSize: 500,
      })
    })

    it('continues without metadata when HF fetch fails', async () => {
      ;(fetch as any).mockRejectedValue(new Error('fail'))
      mockEngine.import.mockResolvedValue(undefined)

      await svc.pullModelWithMetadata(
        'id1',
        'https://huggingface.co/org/repo/resolve/main/model.gguf',
        undefined,
        undefined,
        false
      )

      expect(mockEngine.import).toHaveBeenCalled()
    })

    it('emits download error event when pullModel throws', async () => {
      mockEngine.import.mockRejectedValue(new Error('download failed'))

      await expect(
        svc.pullModelWithMetadata('id1', 'https://huggingface.co/org/repo/resolve/main/model.gguf')
      ).rejects.toThrow('download failed')

      expect(mockEvents.emit).toHaveBeenCalledWith(
        'onFileDownloadError',
        expect.objectContaining({ modelId: 'id1' })
      )
    })

    it('emits download error with string error', async () => {
      mockEngine.import.mockRejectedValue('string error')

      await expect(
        svc.pullModelWithMetadata('id1', 'https://huggingface.co/org/repo/resolve/main/model.gguf')
      ).rejects.toBe('string error')

      expect(mockEvents.emit).toHaveBeenCalledWith(
        'onFileDownloadError',
        expect.objectContaining({ error: 'string error' })
      )
    })

    it('works with non-HF URL (no metadata extraction)', async () => {
      mockEngine.import.mockResolvedValue(undefined)
      await svc.pullModelWithMetadata('id1', '/local/path/model.gguf', undefined, undefined, false)
      expect(mockEngine.import).toHaveBeenCalled()
    })
  })

  // ── isToolSupported ──
  describe('isToolSupported', () => {
    it('returns true when engine says so', async () => {
      mockEngine.isToolSupported.mockResolvedValue(true)
      expect(await svc.isToolSupported('m1')).toBe(true)
    })

    it('returns false when no engine', async () => {
      mockEngineManager.get.mockReturnValueOnce(undefined)
      expect(await svc.isToolSupported('m1')).toBe(false)
    })
  })

  // ── checkMmprojExists ──
  describe('checkMmprojExists', () => {
    it('returns true when engine confirms', async () => {
      mockEngine.checkMmprojExists.mockResolvedValue(true)
      expect(await svc.checkMmprojExists('m1')).toBe(true)
    })

    it('returns false when engine has no method', async () => {
      mockEngineManager.get.mockReturnValueOnce({ notCheckMmprojExists: true })
      expect(await svc.checkMmprojExists('m1')).toBe(false)
    })

    it('returns false on error', async () => {
      mockEngine.checkMmprojExists.mockRejectedValue(new Error('fail'))
      expect(await svc.checkMmprojExists('m1')).toBe(false)
    })
  })

  // ── checkMmprojExistsAndUpdateOffloadMMprojSetting ──
  describe('checkMmprojExistsAndUpdateOffloadMMprojSetting', () => {
    it('updates provider when mmproj exists and setting missing', async () => {
      mockEngine.checkMmprojExists.mockResolvedValue(true)
      const updateProvider = vi.fn()
      const getProviderByName = vi.fn().mockReturnValue({
        models: [{ id: 'm1', settings: { ctx_len: {} } }],
      })

      const result = await svc.checkMmprojExistsAndUpdateOffloadMMprojSetting(
        'm1', updateProvider, getProviderByName
      )

      expect(result).toEqual({ exists: true, settingsUpdated: true })
      expect(updateProvider).toHaveBeenCalledWith('llamacpp', expect.any(Object))
    })

    it('does not update when offload_mmproj already exists', async () => {
      mockEngine.checkMmprojExists.mockResolvedValue(true)
      const updateProvider = vi.fn()
      const getProviderByName = vi.fn().mockReturnValue({
        models: [{ id: 'm1', settings: { offload_mmproj: {} } }],
      })

      const result = await svc.checkMmprojExistsAndUpdateOffloadMMprojSetting(
        'm1', updateProvider, getProviderByName
      )

      expect(result).toEqual({ exists: true, settingsUpdated: false })
      expect(updateProvider).not.toHaveBeenCalled()
    })

    it('does not update when mmproj does not exist', async () => {
      mockEngine.checkMmprojExists.mockResolvedValue(false)
      const updateProvider = vi.fn()
      const getProviderByName = vi.fn().mockReturnValue({
        models: [{ id: 'm1', settings: { ctx_len: {} } }],
      })

      const result = await svc.checkMmprojExistsAndUpdateOffloadMMprojSetting(
        'm1', updateProvider, getProviderByName
      )

      expect(result).toEqual({ exists: false, settingsUpdated: false })
    })

    it('falls back to localStorage when no store functions', async () => {
      mockEngine.checkMmprojExists.mockResolvedValue(true)
      const storageData = {
        state: {
          providers: [
            { provider: 'llamacpp', models: [{ id: 'm1', settings: {} }] },
          ],
        },
      }
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify(storageData))
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})

      const result = await svc.checkMmprojExistsAndUpdateOffloadMMprojSetting('m1')

      expect(result).toEqual({ exists: true, settingsUpdated: true })
      expect(setItemSpy).toHaveBeenCalled()

      getItemSpy.mockRestore()
      setItemSpy.mockRestore()
    })

    it('localStorage: does not add setting if already exists', async () => {
      mockEngine.checkMmprojExists.mockResolvedValue(true)
      const storageData = {
        state: {
          providers: [
            { provider: 'llamacpp', models: [{ id: 'm1', settings: { offload_mmproj: {} } }] },
          ],
        },
      }
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify(storageData))
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})

      const result = await svc.checkMmprojExistsAndUpdateOffloadMMprojSetting('m1')

      expect(result).toEqual({ exists: true, settingsUpdated: false })
      expect(setItemSpy).not.toHaveBeenCalled()

      getItemSpy.mockRestore()
      setItemSpy.mockRestore()
    })

    it('handles localStorage error gracefully', async () => {
      mockEngine.checkMmprojExists.mockResolvedValue(true)
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })

      const result = await svc.checkMmprojExistsAndUpdateOffloadMMprojSetting('m1')

      expect(result).toEqual({ exists: true, settingsUpdated: false })
      vi.restoreAllMocks()
    })

    it('returns false when engine has no checkMmprojExists method', async () => {
      mockEngineManager.get.mockReturnValueOnce({})
      const result = await svc.checkMmprojExistsAndUpdateOffloadMMprojSetting('m1')
      expect(result).toEqual({ exists: false, settingsUpdated: false })
    })

    it('returns false on engine error', async () => {
      mockEngine.checkMmprojExists.mockRejectedValue(new Error('fail'))
      const result = await svc.checkMmprojExistsAndUpdateOffloadMMprojSetting('m1')
      expect(result).toEqual({ exists: false, settingsUpdated: false })
    })

    it('handles provider not found', async () => {
      mockEngine.checkMmprojExists.mockResolvedValue(true)
      const updateProvider = vi.fn()
      const getProviderByName = vi.fn().mockReturnValue(undefined)

      const result = await svc.checkMmprojExistsAndUpdateOffloadMMprojSetting(
        'm1', updateProvider, getProviderByName
      )
      expect(result).toEqual({ exists: true, settingsUpdated: false })
    })

    it('handles model not found in provider', async () => {
      mockEngine.checkMmprojExists.mockResolvedValue(true)
      const updateProvider = vi.fn()
      const getProviderByName = vi.fn().mockReturnValue({
        models: [{ id: 'other', settings: {} }],
      })

      const result = await svc.checkMmprojExistsAndUpdateOffloadMMprojSetting(
        'm1', updateProvider, getProviderByName
      )
      expect(result).toEqual({ exists: true, settingsUpdated: false })
    })

    it('localStorage: handles missing provider', async () => {
      mockEngine.checkMmprojExists.mockResolvedValue(true)
      vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify({ state: { providers: [] } }))

      const result = await svc.checkMmprojExistsAndUpdateOffloadMMprojSetting('m1')
      expect(result).toEqual({ exists: true, settingsUpdated: false })

      vi.restoreAllMocks()
    })

    it('localStorage: mmproj does not exist', async () => {
      mockEngine.checkMmprojExists.mockResolvedValue(false)
      vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify({
        state: { providers: [{ provider: 'llamacpp', models: [{ id: 'm1', settings: {} }] }] },
      }))

      const result = await svc.checkMmprojExistsAndUpdateOffloadMMprojSetting('m1')
      expect(result).toEqual({ exists: false, settingsUpdated: false })

      vi.restoreAllMocks()
    })
  })

  // ── validateGgufFile ──
  describe('validateGgufFile', () => {
    it('returns result from engine', async () => {
      mockEngine.validateGgufFile.mockResolvedValue({ isValid: true })
      const result = await svc.validateGgufFile('/path/model.gguf')
      expect(result).toEqual({ isValid: true })
    })

    it('returns fallback when method not available', async () => {
      mockEngineManager.get.mockReturnValueOnce({})
      const result = await svc.validateGgufFile('/path/model.gguf')
      expect(result).toEqual({ isValid: true, error: 'Validation method not available' })
    })

    it('returns error result on exception', async () => {
      mockEngine.validateGgufFile.mockRejectedValue(new Error('corrupt'))
      const result = await svc.validateGgufFile('/path/model.gguf')
      expect(result).toEqual({ isValid: false, error: 'corrupt' })
    })

    it('returns error result on non-Error exception', async () => {
      mockEngine.validateGgufFile.mockRejectedValue('weird error')
      const result = await svc.validateGgufFile('/path/model.gguf')
      expect(result).toEqual({ isValid: false, error: 'Unknown error' })
    })
  })

  // ── getTokensCount ──
  describe('getTokensCount', () => {
    it('returns count from engine for text messages', async () => {
      mockEngine.getTokensCount.mockResolvedValue(42)

      const messages = [
        {
          role: 'user',
          content: [{ type: ContentType.Text, text: { value: 'Hello' } }],
        },
      ] as any

      const result = await svc.getTokensCount('m1', messages)
      expect(result).toBe(42)
    })

    it('handles image content', async () => {
      mockEngine.getTokensCount.mockResolvedValue(10)

      const messages = [
        {
          role: 'user',
          content: [
            { type: ContentType.Text, text: { value: 'Look at this' } },
            { type: ContentType.Image, image_url: { url: 'data:image/png;base64,...', detail: 'high' } },
          ],
        },
      ] as any

      const result = await svc.getTokensCount('m1', messages)
      expect(result).toBe(10)
      expect(mockEngine.getTokensCount).toHaveBeenCalledWith(
        expect.objectContaining({ model: 'm1' })
      )
    })

    it('filters out empty messages', async () => {
      mockEngine.getTokensCount.mockResolvedValue(5)

      const messages = [
        { role: 'user', content: [{ type: ContentType.Text, text: { value: '' } }] },
        { role: 'assistant', content: [{ type: ContentType.Text, text: { value: 'hi' } }] },
      ] as any

      await svc.getTokensCount('m1', messages)
      const call = mockEngine.getTokensCount.mock.calls[0][0]
      // Empty string content filtered out
      expect(call.messages.length).toBe(1)
    })

    it('returns 0 when engine has no method', async () => {
      mockEngineManager.get.mockReturnValueOnce({})
      const result = await svc.getTokensCount('m1', [])
      expect(result).toBe(0)
    })

    it('returns 0 on error', async () => {
      mockEngine.getTokensCount.mockRejectedValue(new Error('fail'))
      const result = await svc.getTokensCount('m1', [{ role: 'user', content: [{ type: ContentType.Text, text: { value: 'hi' } }] }] as any)
      expect(result).toBe(0)
    })

    it('handles messages with empty content array', async () => {
      mockEngine.getTokensCount.mockResolvedValue(0)
      const messages = [{ role: 'user', content: [] }] as any
      const result = await svc.getTokensCount('m1', messages)
      expect(result).toBe(0)
    })

    it('handles unknown content types in image messages', async () => {
      mockEngine.getTokensCount.mockResolvedValue(5)

      const messages = [
        {
          role: 'user',
          content: [
            { type: ContentType.Image, image_url: { url: 'http://img.png' } },
            { type: 'unknown_type', text: { value: 'fallback' }, image_url: { url: 'http://x.png' } },
          ],
        },
      ] as any

      const result = await svc.getTokensCount('m1', messages)
      expect(result).toBe(5)
    })

    it('returns 0 when no engine at all', async () => {
      mockEngineManager.get.mockReturnValueOnce(undefined)
      const result = await svc.getTokensCount('m1', [])
      expect(result).toBe(0)
    })
  })

  // ── startModel edge: no engine ──
  describe('startModel', () => {
    it('returns undefined when engine not found', async () => {
      mockEngineManager.get.mockReturnValueOnce(undefined)
      const result = await svc.startModel({ provider: 'unknown', models: [] } as any, 'model1')
      expect(result).toBeUndefined()
    })

    it('handles model without settings', async () => {
      mockEngine.getLoadedModels.mockResolvedValue({ includes: () => false })
      mockEngine.load.mockResolvedValue({ id: 'session' })

      const result = await svc.startModel(
        { provider: 'llamacpp', models: [{ id: 'm1' }] } as any,
        'm1'
      )
      expect(result).toEqual({ id: 'session' })
      expect(mockEngine.load).toHaveBeenCalledWith('m1', undefined, false, false)
    })

    it('passes bypassAutoUnload', async () => {
      mockEngine.getLoadedModels.mockResolvedValue({ includes: () => false })
      mockEngine.load.mockResolvedValue({ id: 'session' })

      await svc.startModel(
        { provider: 'llamacpp', models: [{ id: 'm1' }] } as any,
        'm1',
        true
      )
      expect(mockEngine.load).toHaveBeenCalledWith('m1', undefined, false, true)
    })

    it('handles model not found in provider models list', async () => {
      mockEngine.getLoadedModels.mockResolvedValue({ includes: () => false })
      mockEngine.load.mockResolvedValue({ id: 'session' })

      await svc.startModel(
        { provider: 'llamacpp', models: [] } as any,
        'm1'
      )
      expect(mockEngine.load).toHaveBeenCalledWith('m1', undefined, false, false)
    })
  })

  // ── pullModel edge ──
  describe('pullModel', () => {
    it('handles all optional params', async () => {
      mockEngine.import.mockResolvedValue(undefined)
      await svc.pullModel('id1', '/path', 'sha256', 1000, '/mmproj', 'msha', 500)
      expect(mockEngine.import).toHaveBeenCalledWith('id1', {
        modelPath: '/path',
        mmprojPath: '/mmproj',
        modelSha256: 'sha256',
        modelSize: 1000,
        mmprojSha256: 'msha',
        mmprojSize: 500,
      })
    })
  })

  // ── getTokensCount with tool context ──
  describe('getTokensCount with tool context', () => {
    afterEach(() => {
      mockExtractContent.mockReturnValue('')
      mockExtractMetadata.mockReturnValue('')
    })

    it('appends tool context to string content', async () => {
      mockExtractContent.mockReturnValue('tool output here')
      mockEngine.getTokensCount.mockResolvedValue(20)

      const messages = [
        { role: 'assistant', content: [{ type: ContentType.Text, text: { value: 'response' } }] },
      ] as any

      await svc.getTokensCount('m1', messages)
      const call = mockEngine.getTokensCount.mock.calls[0][0]
      expect(call.messages[0].content).toContain('tool output here')
    })

    it('appends tool context to array content', async () => {
      mockExtractContent.mockReturnValue('tool output here')
      mockEngine.getTokensCount.mockResolvedValue(20)

      const messages = [
        {
          role: 'user',
          content: [
            { type: ContentType.Image, image_url: { url: 'http://img.png' } },
          ],
        },
      ] as any

      await svc.getTokensCount('m1', messages)
      const call = mockEngine.getTokensCount.mock.calls[0][0]
      expect(Array.isArray(call.messages[0].content)).toBe(true)
      expect(call.messages[0].content).toContainEqual({ type: 'text', text: 'tool output here' })
    })

    it('uses metadata context when content context is empty', async () => {
      mockExtractContent.mockReturnValue('')
      mockExtractMetadata.mockReturnValue('metadata tool context')
      mockEngine.getTokensCount.mockResolvedValue(15)

      const messages = [
        { role: 'assistant', content: [{ type: ContentType.Text, text: { value: 'resp' } }] },
      ] as any

      await svc.getTokensCount('m1', messages)
      const call = mockEngine.getTokensCount.mock.calls[0][0]
      expect(call.messages[0].content).toContain('metadata tool context')
    })

    it('appends tool context to empty string content', async () => {
      mockExtractContent.mockReturnValue('tool output')
      mockEngine.getTokensCount.mockResolvedValue(5)

      const messages = [
        { role: 'user', content: [{ type: ContentType.Text, text: { value: '' } }] },
      ] as any

      await svc.getTokensCount('m1', messages)
      const call = mockEngine.getTokensCount.mock.calls[0][0]
      expect(call.messages[0].content).toBe('tool output')
    })
  })

  // ── deleteModel with provider ──
  describe('deleteModel', () => {
    it('calls engine delete with provider', async () => {
      mockEngine.delete.mockResolvedValue(undefined)
      await svc.deleteModel('m1', 'llamacpp')
      expect(mockEngineManager.get).toHaveBeenCalledWith('llamacpp')
    })
  })

  // ── abortDownload edge case ──
  describe('abortDownload', () => {
    it('emits stop event even if abort throws', async () => {
      mockEngine.abortImport.mockRejectedValue(new Error('abort fail'))
      await svc.abortDownload('m1')
      expect(mockEvents.emit).toHaveBeenCalledWith(
        'onFileDownloadStopped',
        expect.objectContaining({ modelId: 'm1' })
      )
    })
  })
})
