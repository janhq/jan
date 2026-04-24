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

vi.mock('@/lib/utils', () => ({ sanitizeModelId: (id: string) => id }))
vi.mock('../tokenCountToolContext', () => ({
  extractToolContextFromContent: mockExtractContent,
  extractToolContextFromMetadata: mockExtractMetadata,
}))

global.fetch = vi.fn()
Object.defineProperty(global, 'MODEL_CATALOG_URL', { value: 'https://example.com/models', writable: true, configurable: true })
Object.defineProperty(global, 'LATEST_JAN_MODEL_URL', { value: 'https://example.com/latest', writable: true, configurable: true })

describe('DefaultModelsService - additional coverage', () => {
  let svc: DefaultModelsService

  const mockEngine = {
    get: vi.fn(), list: vi.fn(), updateSettings: vi.fn(), import: vi.fn(),
    abortImport: vi.fn(), delete: vi.fn(), getLoadedModels: vi.fn(), unload: vi.fn(),
    load: vi.fn(), isModelSupported: vi.fn(), isToolSupported: vi.fn(),
    checkMmprojExists: vi.fn(), validateGgufFile: vi.fn(), getTokensCount: vi.fn(),
  }

  const mockEngineManager = { get: vi.fn().mockReturnValue(mockEngine) }

  beforeEach(() => {
    svc = new DefaultModelsService()
    vi.clearAllMocks()
    ;(EngineManager.instance as any).mockReturnValue(mockEngineManager)
    mockEngineManager.get.mockReturnValue(mockEngine)
    mockExtractContent.mockReturnValue('')
    mockExtractMetadata.mockReturnValue('')
  })

  describe('getModel', () => {
    it('returns model info from engine', async () => {
      mockEngine.get.mockReturnValue({ id: 'm1' })
      expect(await svc.getModel('m1')).toEqual({ id: 'm1' })
    })

    it('returns undefined when engine is missing', async () => {
      mockEngineManager.get.mockReturnValueOnce(undefined)
      expect(await svc.getModel('m1')).toBeUndefined()
    })
  })

  describe('fetchModels', () => {
    it('returns empty array when engine is missing', async () => {
      mockEngineManager.get.mockReturnValueOnce(undefined)
      expect(await svc.fetchModels()).toEqual([])
    })
  })

  describe('fetchLatestJanModel', () => {
    it.each([
      ['object response', { model_name: 'jan-nano' }, { model_name: 'jan-nano' }],
      ['array response', [{ model_name: 'jan-nano' }, { model_name: 'jan-micro' }], { model_name: 'jan-nano' }],
      ['empty array', [], null],
    ])('handles %s', async (_label, response, expected) => {
      ;(fetch as any).mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue(response) })
      expect(await svc.fetchLatestJanModel()).toEqual(expected)
    })

    it('returns null on non-ok response', async () => {
      ;(fetch as any).mockResolvedValue({ ok: false, status: 500, statusText: 'Error' })
      expect(await svc.fetchLatestJanModel()).toBeNull()
    })

    it('returns null on network error', async () => {
      ;(fetch as any).mockRejectedValue(new Error('network'))
      expect(await svc.fetchLatestJanModel()).toBeNull()
    })
  })

  describe('pullModelWithMetadata', () => {
    const hfUrl = 'https://huggingface.co/org/repo/resolve/main/model.gguf'
    const mmprojUrl = 'https://huggingface.co/org/repo/resolve/main/mmproj.gguf'

    it('calls pullModel with default params when skipVerification is true', async () => {
      mockEngine.import.mockResolvedValue(undefined)
      await svc.pullModelWithMetadata('id1', hfUrl)
      expect(mockEngine.import).toHaveBeenCalledWith('id1', expect.objectContaining({
        modelPath: hfUrl, mmprojPath: undefined, modelSha256: undefined,
      }))
    })

    it('fetches metadata when skipVerification is false', async () => {
      ;(fetch as any).mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          siblings: [
            { rfilename: 'model.gguf', lfs: { sha256: 'abc', size: 1000 } },
            { rfilename: 'mmproj.gguf', lfs: { sha256: 'def', size: 500 } },
          ],
        }),
      })
      mockEngine.import.mockResolvedValue(undefined)
      await svc.pullModelWithMetadata('id1', hfUrl, mmprojUrl, undefined, false)
      expect(mockEngine.import).toHaveBeenCalledWith('id1', expect.objectContaining({
        modelSha256: 'abc', modelSize: 1000, mmprojSha256: 'def', mmprojSize: 500,
      }))
    })

    it('continues without metadata when HF fetch fails', async () => {
      ;(fetch as any).mockRejectedValue(new Error('fail'))
      mockEngine.import.mockResolvedValue(undefined)
      await svc.pullModelWithMetadata('id1', hfUrl, undefined, undefined, false)
      expect(mockEngine.import).toHaveBeenCalled()
    })

    it.each([
      ['Error object', new Error('download failed'), 'download failed'],
      ['string error', 'string error', 'string error'],
    ])('emits download error event with %s', async (_label, error, expectedError) => {
      mockEngine.import.mockRejectedValue(error)
      await expect(svc.pullModelWithMetadata('id1', hfUrl)).rejects.toThrow()
      expect(mockEvents.emit).toHaveBeenCalledWith(
        'onFileDownloadError',
        expect.objectContaining({ modelId: 'id1' })
      )
    })

    it('works with non-HF URL', async () => {
      mockEngine.import.mockResolvedValue(undefined)
      await svc.pullModelWithMetadata('id1', '/local/path/model.gguf', undefined, undefined, false)
      expect(mockEngine.import).toHaveBeenCalled()
    })
  })

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

  describe('checkMmprojExists', () => {
    it.each([
      ['confirms', true, true],
      ['denies', false, false],
    ])('returns %s from engine', async (_label, engineResult, expected) => {
      mockEngine.checkMmprojExists.mockResolvedValue(engineResult)
      expect(await svc.checkMmprojExists('m1')).toBe(expected)
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

  describe('checkMmprojExistsAndUpdateOffloadMMprojSetting', () => {
    it('updates provider when mmproj exists and setting missing', async () => {
      mockEngine.checkMmprojExists.mockResolvedValue(true)
      const updateProvider = vi.fn()
      const getProviderByName = vi.fn().mockReturnValue({
        models: [{ id: 'm1', settings: { ctx_len: {} } }],
      })
      const result = await svc.checkMmprojExistsAndUpdateOffloadMMprojSetting('m1', updateProvider, getProviderByName)
      expect(result).toEqual({ exists: true, settingsUpdated: true })
      expect(updateProvider).toHaveBeenCalledWith('llamacpp', expect.any(Object))
    })

    it('does not update when offload_mmproj already exists', async () => {
      mockEngine.checkMmprojExists.mockResolvedValue(true)
      const updateProvider = vi.fn()
      const getProviderByName = vi.fn().mockReturnValue({
        models: [{ id: 'm1', settings: { offload_mmproj: {} } }],
      })
      const result = await svc.checkMmprojExistsAndUpdateOffloadMMprojSetting('m1', updateProvider, getProviderByName)
      expect(result).toEqual({ exists: true, settingsUpdated: false })
      expect(updateProvider).not.toHaveBeenCalled()
    })

    it.each([
      ['mmproj does not exist', false, { exists: false, settingsUpdated: false }],
      ['provider not found', true, { exists: true, settingsUpdated: false }],
    ])('handles %s', async (_label, mmprojExists, expected) => {
      mockEngine.checkMmprojExists.mockResolvedValue(mmprojExists)
      const updateProvider = vi.fn()
      const getProviderByName = vi.fn().mockReturnValue(
        _label === 'provider not found' ? undefined : { models: [{ id: 'm1', settings: { ctx_len: {} } }] }
      )
      const result = await svc.checkMmprojExistsAndUpdateOffloadMMprojSetting('m1', updateProvider, getProviderByName)
      expect(result).toEqual(expected)
    })

    it('handles model not found in provider', async () => {
      mockEngine.checkMmprojExists.mockResolvedValue(true)
      const getProviderByName = vi.fn().mockReturnValue({ models: [{ id: 'other', settings: {} }] })
      const result = await svc.checkMmprojExistsAndUpdateOffloadMMprojSetting('m1', vi.fn(), getProviderByName)
      expect(result).toEqual({ exists: true, settingsUpdated: false })
    })

    it('falls back to localStorage when no store functions', async () => {
      mockEngine.checkMmprojExists.mockResolvedValue(true)
      const storageData = {
        state: { providers: [{ provider: 'llamacpp', models: [{ id: 'm1', settings: {} }] }] },
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
        state: { providers: [{ provider: 'llamacpp', models: [{ id: 'm1', settings: { offload_mmproj: {} } }] }] },
      }
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify(storageData))
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})
      const result = await svc.checkMmprojExistsAndUpdateOffloadMMprojSetting('m1')
      expect(result).toEqual({ exists: true, settingsUpdated: false })
      expect(setItemSpy).not.toHaveBeenCalled()
      getItemSpy.mockRestore()
      setItemSpy.mockRestore()
    })

    it.each([
      ['error', () => { throw new Error('denied') }],
    ])('handles localStorage %s gracefully', async (_label, mockImpl) => {
      mockEngine.checkMmprojExists.mockResolvedValue(true)
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(mockImpl)
      const result = await svc.checkMmprojExistsAndUpdateOffloadMMprojSetting('m1')
      expect(result).toEqual({ exists: true, settingsUpdated: false })
      vi.restoreAllMocks()
    })

    it.each([
      ['no engine method', () => mockEngineManager.get.mockReturnValueOnce({})],
      ['engine error', () => mockEngine.checkMmprojExists.mockRejectedValue(new Error('fail'))],
    ])('returns false on %s', async (_label, setup) => {
      setup()
      const result = await svc.checkMmprojExistsAndUpdateOffloadMMprojSetting('m1')
      expect(result).toEqual({ exists: false, settingsUpdated: false })
    })

    it.each([
      ['missing provider', { state: { providers: [] } }],
      ['mmproj false', { state: { providers: [{ provider: 'llamacpp', models: [{ id: 'm1', settings: {} }] }] } }],
    ])('localStorage: %s', async (_label, storageData) => {
      if (_label === 'mmproj false') mockEngine.checkMmprojExists.mockResolvedValue(false)
      else mockEngine.checkMmprojExists.mockResolvedValue(true)
      vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify(storageData))
      const result = await svc.checkMmprojExistsAndUpdateOffloadMMprojSetting('m1')
      expect(result.settingsUpdated).toBe(false)
      vi.restoreAllMocks()
    })
  })

  describe('validateGgufFile', () => {
    it.each([
      ['valid result', () => mockEngine.validateGgufFile.mockResolvedValue({ isValid: true }), { isValid: true }],
      ['no method', () => mockEngineManager.get.mockReturnValueOnce({}), { isValid: true, error: 'Validation method not available' }],
      ['Error exception', () => mockEngine.validateGgufFile.mockRejectedValue(new Error('corrupt')), { isValid: false, error: 'corrupt' }],
      ['non-Error exception', () => mockEngine.validateGgufFile.mockRejectedValue('weird'), { isValid: false, error: 'Unknown error' }],
    ])('handles %s', async (_label, setup, expected) => {
      setup()
      expect(await svc.validateGgufFile('/path/model.gguf')).toEqual(expected)
    })
  })

  describe('getTokensCount', () => {
    const textMsg = (text: string) => ({ role: 'user', content: [{ type: ContentType.Text, text: { value: text } }] })
    const imageMsg = () => ({
      role: 'user',
      content: [
        { type: ContentType.Text, text: { value: 'Look' } },
        { type: ContentType.Image, image_url: { url: 'data:image/png;base64,...', detail: 'high' } },
      ],
    })

    it('returns count from engine for text messages', async () => {
      mockEngine.getTokensCount.mockResolvedValue(42)
      expect(await svc.getTokensCount('m1', [textMsg('Hello')] as any)).toBe(42)
    })

    it('handles image content', async () => {
      mockEngine.getTokensCount.mockResolvedValue(10)
      expect(await svc.getTokensCount('m1', [imageMsg()] as any)).toBe(10)
    })

    it('filters out empty messages', async () => {
      mockEngine.getTokensCount.mockResolvedValue(5)
      await svc.getTokensCount('m1', [textMsg(''), textMsg('hi')] as any)
      expect(mockEngine.getTokensCount.mock.calls[0][0].messages.length).toBe(1)
    })

    it.each([
      ['no engine method', () => mockEngineManager.get.mockReturnValueOnce({})],
      ['no engine at all', () => mockEngineManager.get.mockReturnValueOnce(undefined)],
      ['error', () => mockEngine.getTokensCount.mockRejectedValue(new Error('fail'))],
    ])('returns 0 when %s', async (_label, setup) => {
      setup()
      expect(await svc.getTokensCount('m1', _label === 'error' ? [textMsg('hi')] as any : [])).toBe(0)
    })

    it('handles empty content array', async () => {
      mockEngine.getTokensCount.mockResolvedValue(0)
      expect(await svc.getTokensCount('m1', [{ role: 'user', content: [] }] as any)).toBe(0)
    })

    it('handles unknown content types', async () => {
      mockEngine.getTokensCount.mockResolvedValue(5)
      const messages = [{
        role: 'user',
        content: [
          { type: ContentType.Image, image_url: { url: 'http://img.png' } },
          { type: 'unknown_type', text: { value: 'fallback' }, image_url: { url: 'http://x.png' } },
        ],
      }] as any
      expect(await svc.getTokensCount('m1', messages)).toBe(5)
    })
  })

  describe('getTokensCount with tool context', () => {
    afterEach(() => {
      mockExtractContent.mockReturnValue('')
      mockExtractMetadata.mockReturnValue('')
    })

    it('appends tool context to string content', async () => {
      mockExtractContent.mockReturnValue('tool output here')
      mockEngine.getTokensCount.mockResolvedValue(20)
      await svc.getTokensCount('m1', [{ role: 'assistant', content: [{ type: ContentType.Text, text: { value: 'response' } }] }] as any)
      expect(mockEngine.getTokensCount.mock.calls[0][0].messages[0].content).toContain('tool output here')
    })

    it('appends tool context to array content', async () => {
      mockExtractContent.mockReturnValue('tool output here')
      mockEngine.getTokensCount.mockResolvedValue(20)
      await svc.getTokensCount('m1', [{ role: 'user', content: [{ type: ContentType.Image, image_url: { url: 'http://img.png' } }] }] as any)
      const call = mockEngine.getTokensCount.mock.calls[0][0]
      expect(call.messages[0].content).toContainEqual({ type: 'text', text: 'tool output here' })
    })

    it('uses metadata context when content context is empty', async () => {
      mockExtractMetadata.mockReturnValue('metadata tool context')
      mockEngine.getTokensCount.mockResolvedValue(15)
      await svc.getTokensCount('m1', [{ role: 'assistant', content: [{ type: ContentType.Text, text: { value: 'resp' } }] }] as any)
      expect(mockEngine.getTokensCount.mock.calls[0][0].messages[0].content).toContain('metadata tool context')
    })

    it('appends tool context to empty string content', async () => {
      mockExtractContent.mockReturnValue('tool output')
      mockEngine.getTokensCount.mockResolvedValue(5)
      await svc.getTokensCount('m1', [{ role: 'user', content: [{ type: ContentType.Text, text: { value: '' } }] }] as any)
      expect(mockEngine.getTokensCount.mock.calls[0][0].messages[0].content).toBe('tool output')
    })
  })

  describe('startModel', () => {
    it('returns undefined when engine not found', async () => {
      mockEngineManager.get.mockReturnValueOnce(undefined)
      expect(await svc.startModel({ provider: 'unknown', models: [] } as any, 'model1')).toBeUndefined()
    })

    it.each([
      ['without settings', undefined, false],
      ['with bypassAutoUnload', undefined, true],
    ])('handles model %s', async (_label, settings, bypass) => {
      mockEngine.getLoadedModels.mockResolvedValue({ includes: () => false })
      mockEngine.load.mockResolvedValue({ id: 'session' })
      await svc.startModel({ provider: 'llamacpp', models: [{ id: 'm1', ...(settings ? { settings } : {}) }] } as any, 'm1', bypass)
      expect(mockEngine.load).toHaveBeenCalledWith('m1', undefined, false, bypass)
    })

    it('handles model not found in provider models list', async () => {
      mockEngine.getLoadedModels.mockResolvedValue({ includes: () => false })
      mockEngine.load.mockResolvedValue({ id: 'session' })
      await svc.startModel({ provider: 'llamacpp', models: [] } as any, 'm1')
      expect(mockEngine.load).toHaveBeenCalledWith('m1', undefined, false, false)
    })
  })

  describe('pullModel', () => {
    it('handles all optional params', async () => {
      mockEngine.import.mockResolvedValue(undefined)
      await svc.pullModel('id1', '/path', 'sha256', 1000, '/mmproj', 'msha', 500)
      expect(mockEngine.import).toHaveBeenCalledWith('id1', {
        modelPath: '/path', mmprojPath: '/mmproj',
        modelSha256: 'sha256', modelSize: 1000, mmprojSha256: 'msha', mmprojSize: 500,
      })
    })
  })

  describe('deleteModel', () => {
    it('calls engine delete with provider', async () => {
      await svc.deleteModel('m1', 'llamacpp')
      expect(mockEngineManager.get).toHaveBeenCalledWith('llamacpp')
    })
  })

  describe('abortDownload', () => {
    it('emits stop event even if abort throws', async () => {
      mockEngine.abortImport.mockRejectedValue(new Error('abort fail'))
      await svc.abortDownload('m1')
      expect(mockEvents.emit).toHaveBeenCalledWith('onFileDownloadStopped', expect.objectContaining({ modelId: 'm1' }))
    })
  })
})
