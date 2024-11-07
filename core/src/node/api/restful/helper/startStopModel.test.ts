import { startModel } from './startStopModel'

describe('startModel', () => {
  it('test_startModel_error', async () => {
    const modelId = 'testModelId'
    const settingParams = undefined

    expect(startModel(modelId, settingParams)).resolves.toThrow()
  })
})
