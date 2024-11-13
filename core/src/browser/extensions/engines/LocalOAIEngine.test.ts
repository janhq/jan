/**
 * @jest-environment jsdom
 */
import { LocalOAIEngine } from './LocalOAIEngine'
import { events } from '../../events'
import { ModelEvent, Model } from '../../../types'
import { executeOnMain, systemInformation, dirName } from '../../core'

jest.mock('../../core', () => ({
  executeOnMain: jest.fn(),
  systemInformation: jest.fn(),
  dirName: jest.fn(),
}))

jest.mock('../../events', () => ({
  events: {
    on: jest.fn(),
    emit: jest.fn(),
  },
}))

class TestLocalOAIEngine extends LocalOAIEngine {
  inferenceUrl = ''
  nodeModule = 'testNodeModule'
  provider = 'testProvider'
}

describe('LocalOAIEngine', () => {
  let engine: TestLocalOAIEngine

  beforeEach(() => {
    engine = new TestLocalOAIEngine('', '')
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('should subscribe to events on load', () => {
    engine.onLoad()
    expect(events.on).toHaveBeenCalledWith(ModelEvent.OnModelInit, expect.any(Function))
    expect(events.on).toHaveBeenCalledWith(ModelEvent.OnModelStop, expect.any(Function))
  })

  it('should load model correctly', async () => {
    const model: any = { engine: 'testProvider', file_path: 'path/to/model' } as any
    const modelFolder = 'path/to'
    const systemInfo = { os: 'testOS' }
    const res = { error: null }

    ;(dirName as jest.Mock).mockResolvedValue(modelFolder)
    ;(systemInformation as jest.Mock).mockResolvedValue(systemInfo)
    ;(executeOnMain as jest.Mock).mockResolvedValue(res)

    await engine.loadModel(model)

    expect(dirName).toHaveBeenCalledWith(model.file_path)
    expect(systemInformation).toHaveBeenCalled()
    expect(executeOnMain).toHaveBeenCalledWith(
      engine.nodeModule,
      engine.loadModelFunctionName,
      { modelFolder, model },
      systemInfo
    )
    expect(events.emit).toHaveBeenCalledWith(ModelEvent.OnModelReady, model)
  })

  it('should handle load model error', async () => {
    const model: any = { engine: 'testProvider', file_path: 'path/to/model' } as any
    const modelFolder = 'path/to'
    const systemInfo = { os: 'testOS' }
    const res = { error: 'load error' }

    ;(dirName as jest.Mock).mockResolvedValue(modelFolder)
    ;(systemInformation as jest.Mock).mockResolvedValue(systemInfo)
    ;(executeOnMain as jest.Mock).mockResolvedValue(res)

    await expect(engine.loadModel(model)).rejects.toEqual('load error')

    expect(events.emit).toHaveBeenCalledWith(ModelEvent.OnModelFail, { error: res.error })
  })

  it('should unload model correctly', async () => {
    const model: Model = { engine: 'testProvider' } as any

    await engine.unloadModel(model)

    expect(executeOnMain).toHaveBeenCalledWith(engine.nodeModule, engine.unloadModelFunctionName)
    expect(events.emit).toHaveBeenCalledWith(ModelEvent.OnModelStopped, {})
  })

  it('should not unload model if engine does not match', async () => {
    const model: Model = { engine: 'otherProvider' } as any
    await engine.unloadModel(model)
    expect(executeOnMain).not.toHaveBeenCalled()
    expect(events.emit).not.toHaveBeenCalledWith(ModelEvent.OnModelStopped, {})
  })
})
