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
    const model: Model = { engine: 'testProvider', file_path: 'path/to/model' } as any

    expect(engine.loadModel(model)).toBeTruthy()
  })

  it('should unload model correctly', async () => {
    const model: Model = { engine: 'testProvider' } as any

    expect(engine.unloadModel(model)).toBeTruthy()
  })

  it('should not unload model if engine does not match', async () => {
    const model: Model = { engine: 'otherProvider' } as any

    await engine.unloadModel(model)

    expect(executeOnMain).not.toHaveBeenCalled()
    expect(events.emit).not.toHaveBeenCalledWith(ModelEvent.OnModelStopped, {})
  })
})
