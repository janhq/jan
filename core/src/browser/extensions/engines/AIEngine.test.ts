import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AIEngine } from './AIEngine'
import { events } from '../../events'
import { ModelEvent, Model } from '../../../types'

vi.mock('../../events')
vi.mock('./EngineManager')
vi.mock('../../fs')

class TestAIEngine extends AIEngine {
  onUnload(): void {}
  provider = 'test-provider'

  inference(data: any) {}

  stopInference() {}

  async list(): Promise<any[]> {
    return []
  }

  async load(modelId: string): Promise<any> {
    return { pid: 1, port: 8080, model_id: modelId, model_path: '', api_key: '' }
  }

  async unload(sessionId: string): Promise<any> {
    return { success: true }
  }

  async chat(opts: any): Promise<any> {
    return { id: 'test', object: 'chat.completion', created: Date.now(), model: 'test', choices: [] }
  }

  async delete(modelId: string): Promise<void> {
    return
  }

  async import(modelId: string, opts: any): Promise<void> {
    return
  }

  async abortImport(modelId: string): Promise<void> {
    return
  }

  async getLoadedModels(): Promise<string[]> {
    return []
  }
}

describe('AIEngine', () => {
  let engine: TestAIEngine

  beforeEach(() => {
    engine = new TestAIEngine('', '')
    vi.clearAllMocks()
  })

  it('should load model successfully', async () => {
    const modelId = 'model1'

    const result = await engine.load(modelId)

    expect(result).toEqual({ pid: 1, port: 8080, model_id: modelId, model_path: '', api_key: '' })
  })

  it('should unload model successfully', async () => {
    const sessionId = 'session1'

    const result = await engine.unload(sessionId)

    expect(result).toEqual({ success: true })
  })

  it('should list models', async () => {
    const result = await engine.list()

    expect(result).toEqual([])
  })

  it('should get loaded models', async () => {
    const result = await engine.getLoadedModels()

    expect(result).toEqual([])
  })
})
