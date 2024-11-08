import { AIEngine } from './AIEngine'
import { events } from '../../events'
import { ModelEvent, Model } from '../../../types'

jest.mock('../../events')
jest.mock('./EngineManager')
jest.mock('../../fs')

class TestAIEngine extends AIEngine {
  onUnload(): void {}
  provider = 'test-provider'

  inference(data: any) {}

  stopInference() {}
}

describe('AIEngine', () => {
  let engine: TestAIEngine

  beforeEach(() => {
    engine = new TestAIEngine('', '')
    jest.clearAllMocks()
  })

  it('should load model if provider matches', async () => {
    const model: any = { id: 'model1', engine: 'test-provider' } as any

    await engine.loadModel(model)

    expect(events.emit).toHaveBeenCalledWith(ModelEvent.OnModelReady, model)
  })

  it('should not load model if provider does not match', async () => {
    const model: any = { id: 'model1', engine: 'other-provider' } as any

    await engine.loadModel(model)

    expect(events.emit).not.toHaveBeenCalledWith(ModelEvent.OnModelReady, model)
  })

  it('should unload model if provider matches', async () => {
    const model: Model = { id: 'model1', version: '1.0', engine: 'test-provider' } as any

    await engine.unloadModel(model)

    expect(events.emit).toHaveBeenCalledWith(ModelEvent.OnModelStopped, model)
  })

  it('should not unload model if provider does not match', async () => {
    const model: Model = { id: 'model1', version: '1.0', engine: 'other-provider' } as any

    await engine.unloadModel(model)

    expect(events.emit).not.toHaveBeenCalledWith(ModelEvent.OnModelStopped, model)
  })
})
