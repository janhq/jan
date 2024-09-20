

  import { startModel } from './startStopModel'
  
  describe('startModel', () => {
    it('test_startModel_error', async () => {
      const modelId = 'testModelId'
      const settingParams = undefined
  
      const result = await startModel(modelId, settingParams)
  
      expect(result).toEqual({
        error: expect.any(Error),
      })
    })
  })
