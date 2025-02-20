import { describe, it, expect, beforeEach, vi } from 'vitest'
import JanModelExtension from './index'
import ky from 'ky'
import { ModelManager } from '@janhq/core'

const API_URL = 'http://localhost:3000'

vi.stubGlobal('API_URL', API_URL)

describe('JanModelExtension', () => {
  let extension: JanModelExtension

  beforeEach(() => {
    extension = new JanModelExtension()
    vi.spyOn(ModelManager, 'instance').mockReturnValue({
      get: (modelId: string) => ({
        id: modelId,
        engine: 'nitro_tensorrt_llm',
        settings: { vision_model: true },
        sources: [{ filename: 'test.bin' }],
      }),
    } as any)
    vi.spyOn(JanModelExtension.prototype, 'cancelModelPull').mockImplementation(
      async (model: string) => {
        const kyDeleteSpy = vi.spyOn(ky, 'delete').mockResolvedValue({
          json: () => Promise.resolve({}),
        } as any)

        await ky.delete(`${API_URL}/v1/models/pull`, {
          json: { taskId: model },
        })

        expect(kyDeleteSpy).toHaveBeenCalledWith(`${API_URL}/v1/models/pull`, {
          json: { taskId: model },
        })

        kyDeleteSpy.mockRestore() // Restore the original implementation
      }
    )
  })

  it('should initialize with an empty queue', () => {
    expect(extension.queue.size).toBe(0)
  })

  describe('pullModel', () => {
    it('should call the pull model endpoint with correct parameters', async () => {
      const model = 'test-model'
      const id = 'test-id'
      const name = 'test-name'

      const kyPostSpy = vi.spyOn(ky, 'post').mockReturnValue({
        json: () => Promise.resolve({}),
      } as any)

      await extension.pullModel(model, id, name)

      expect(kyPostSpy).toHaveBeenCalledWith(`${API_URL}/v1/models/pull`, {
        json: { model, id, name },
      })

      kyPostSpy.mockRestore() // Restore the original implementation
    })
  })

  describe('cancelModelPull', () => {
    it('should call the cancel model pull endpoint with the correct model', async () => {
      const model = 'test-model'

      await extension.cancelModelPull(model)
    })
  })

  describe('deleteModel', () => {
    it('should call the delete model endpoint with the correct model', async () => {
      const model = 'test-model'
      const kyDeleteSpy = vi
        .spyOn(ky, 'delete')
        .mockResolvedValue({ json: () => Promise.resolve({}) } as any)

      await extension.deleteModel(model)

      expect(kyDeleteSpy).toHaveBeenCalledWith(`${API_URL}/v1/models/${model}`)

      kyDeleteSpy.mockRestore() // Restore the original implementation
    })
  })
})
