import { describe, it, expect, beforeEach, vi } from 'vitest'
import { OAIEngine } from './OAIEngine'
import { events } from '../../events'
import {
  MessageEvent,
  InferenceEvent,
  MessageRequest,
  MessageRequestType,
  MessageStatus,
  ChatCompletionRole,
  ContentType,
} from '../../../types'

vi.mock('../../events')

class TestOAIEngine extends OAIEngine {
  inferenceUrl = 'http://test-inference-url'
  provider = 'test-provider'

  async headers() {
    return { Authorization: 'Bearer test-token' }
  }
}

describe('OAIEngine', () => {
  let engine: TestOAIEngine

  beforeEach(() => {
    engine = new TestOAIEngine('', '')
    vi.clearAllMocks()
  })

  it('should subscribe to events on load', () => {
    engine.onLoad()
    expect(events.on).toHaveBeenCalledWith(
      MessageEvent.OnMessageSent,
      expect.any(Function)
    )
    expect(events.on).toHaveBeenCalledWith(
      InferenceEvent.OnInferenceStopped,
      expect.any(Function)
    )
  })

  it('should stop inference', () => {
    engine.stopInference()
    expect(engine.isCancelled).toBe(true)
    expect(engine.controller.signal.aborted).toBe(true)
  })
})
