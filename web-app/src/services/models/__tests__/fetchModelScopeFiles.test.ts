import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DefaultModelsService } from '../default'

// Mock Tauri invoke
const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: any[]) => mockInvoke(...args),
}))

describe('DefaultModelsService.fetchModelScopeFiles', () => {
  let service: DefaultModelsService

  beforeEach(() => {
    service = new DefaultModelsService()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns parsed file list on success', async () => {
    const mockResult = {
      Files: [
        { Name: 'test.gguf', Path: 'test.gguf', Size: 123, Sha256: 'abc', IsLFS: true },
      ],
    }
    mockInvoke.mockResolvedValue(mockResult)

    const result = await service.fetchModelScopeFiles('owner/repo')

    expect(mockInvoke).toHaveBeenCalledWith('get_modelscope_model_files', {
      modelId: 'owner/repo',
    })
    expect(result).toEqual(mockResult)
  })

  it('returns null when invoke throws', async () => {
    mockInvoke.mockRejectedValue(new Error('Network error'))

    const result = await service.fetchModelScopeFiles('owner/repo')

    expect(result).toBeNull()
  })

  it('returns null when invoke returns null', async () => {
    mockInvoke.mockResolvedValue(null)

    const result = await service.fetchModelScopeFiles('owner/repo')

    expect(result).toBeNull()
  })

  it('passes modelId directly without modification', async () => {
    mockInvoke.mockResolvedValue({ Files: [] })

    await service.fetchModelScopeFiles('unsloth/DeepSeek-R1-Distill-Qwen-1.5B-GGUF')

    expect(mockInvoke).toHaveBeenCalledWith('get_modelscope_model_files', {
      modelId: 'unsloth/DeepSeek-R1-Distill-Qwen-1.5B-GGUF',
    })
  })
})
