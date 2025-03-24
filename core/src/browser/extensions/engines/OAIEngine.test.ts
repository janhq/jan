/**
 * @jest-environment jsdom
 */
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
import { requestInference } from './helpers/sse'
import { ulid } from 'ulidx'

jest.mock('./helpers/sse')
jest.mock('ulidx')
jest.mock('../../events')

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
    jest.clearAllMocks()
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

  it('should handle inference request', async () => {
    const data: MessageRequest = {
      model: { engine: 'test-provider', id: 'test-model' } as any,
      threadId: 'test-thread',
      type: MessageRequestType.Thread,
      assistantId: 'test-assistant',
      messages: [{ role: ChatCompletionRole.User, content: 'Hello' }],
    }

    ;(ulid as jest.Mock).mockReturnValue('test-id')
    ;(requestInference as jest.Mock).mockReturnValue({
      subscribe: ({ next, complete }: any) => {
        next('test response')
        complete()
      },
    })

    await engine.inference(data)

    expect(requestInference).toHaveBeenCalledWith(
      'http://test-inference-url',
      expect.objectContaining({ model: 'test-model' }),
      expect.any(Object),
      expect.any(AbortController),
      { Authorization: 'Bearer test-token' },
      undefined
    )

    expect(events.emit).toHaveBeenCalledWith(
      MessageEvent.OnMessageResponse,
      expect.objectContaining({ id: 'test-id' })
    )
    expect(events.emit).toHaveBeenCalledWith(
      MessageEvent.OnMessageUpdate,
      expect.objectContaining({
        content: [
          {
            type: ContentType.Text,
            text: { value: 'test response', annotations: [] },
          },
        ],
        status: MessageStatus.Ready,
      })
    )
  })

  it('should handle inference error', async () => {
    const data: MessageRequest = {
      model: { engine: 'test-provider', id: 'test-model' } as any,
      threadId: 'test-thread',
      type: MessageRequestType.Thread,
      assistantId: 'test-assistant',
      messages: [{ role: ChatCompletionRole.User, content: 'Hello' }],
    }

    ;(ulid as jest.Mock).mockReturnValue('test-id')
    ;(requestInference as jest.Mock).mockReturnValue({
      subscribe: ({ error }: any) => {
        error({ message: 'test error', code: 500 })
      },
    })

    await engine.inference(data)

    expect(events.emit).toHaveBeenLastCalledWith(
      MessageEvent.OnMessageUpdate,
      expect.objectContaining({
        status: 'error',
        error_code: 500,
      })
    )
  })

  it('should stop inference', () => {
    engine.stopInference()
    expect(engine.isCancelled).toBe(true)
    expect(engine.controller.signal.aborted).toBe(true)
  })
})
