import JanModelExtension from './index'

let SETTINGS = []
// @ts-ignore
global.SETTINGS = SETTINGS

jest.mock('@janhq/core', () => ({
  ...jest.requireActual('@janhq/core/node'),
  events: {
    emit: jest.fn(),
  },
  joinPath: (paths) => paths.join('/'),
  ModelExtension: jest.fn().mockImplementation(function () {
    // @ts-ignore
    this.registerSettings = () => {
      return Promise.resolve()
    }
    // @ts-ignore
    return this
  }),
}))

describe('JanModelExtension', () => {
  let extension: JanModelExtension
  let mockCortexAPI: any

  beforeEach(() => {
    mockCortexAPI = {
      getModels: jest.fn().mockResolvedValue([]),
      pullModel: jest.fn().mockResolvedValue(undefined),
      importModel: jest.fn().mockResolvedValue(undefined),
      deleteModel: jest.fn().mockResolvedValue(undefined),
      updateModel: jest.fn().mockResolvedValue({}),
      cancelModelPull: jest.fn().mockResolvedValue(undefined),
    }

    // @ts-ignore
    extension = new JanModelExtension()
    extension.cortexAPI = mockCortexAPI
  })

  it('should register settings on load', async () => {
    // @ts-ignore
    const registerSettingsSpy = jest.spyOn(extension, 'registerSettings')
    await extension.onLoad()
    expect(registerSettingsSpy).toHaveBeenCalledWith(SETTINGS)
  })

  it('should pull a model', async () => {
    const model = 'test-model'
    await extension.pullModel(model)
    expect(mockCortexAPI.pullModel).toHaveBeenCalledWith(model)
  })

  it('should cancel model download', async () => {
    const model = 'test-model'
    await extension.cancelModelPull(model)
    expect(mockCortexAPI.cancelModelPull).toHaveBeenCalledWith(model)
  })

  it('should delete a model', async () => {
    const model = 'test-model'
    await extension.deleteModel(model)
    expect(mockCortexAPI.deleteModel).toHaveBeenCalledWith(model)
  })

  it('should get all models', async () => {
    const models = await extension.getModels()
    expect(models).toEqual([])
    expect(mockCortexAPI.getModels).toHaveBeenCalled()
  })

  it('should update a model', async () => {
    const model = { id: 'test-model' }
    const updatedModel = await extension.updateModel(model)
    expect(updatedModel).toEqual({})
    expect(mockCortexAPI.updateModel).toHaveBeenCalledWith(model)
  })

  it('should import a model', async () => {
    const model: any = { path: 'test-path' }
    const optionType: any = 'test-option'
    await extension.importModel(model, optionType)
    expect(mockCortexAPI.importModel).toHaveBeenCalledWith(
      model.path,
      optionType
    )
  })
})
