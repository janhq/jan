import { describe, it, expect, beforeEach } from 'vitest'
import { MessageRequest, ThreadMessage } from '../../types'
import { BaseExtension, ExtensionTypeEnum } from '../extension'
import { InferenceExtension } from './'

// Mock the MessageRequest and ThreadMessage types
type MockMessageRequest = {
  text: string
}

type MockThreadMessage = {
  text: string
  userId: string
}

// Mock the BaseExtension class
class MockBaseExtension extends BaseExtension {
  type(): ExtensionTypeEnum | undefined {
    return ExtensionTypeEnum.Base
  }
}

// Create a mock implementation of InferenceExtension
class MockInferenceExtension extends InferenceExtension {
  async inference(data: MessageRequest): Promise<ThreadMessage> {
    return { text: 'Mock response', userId: '123' } as unknown as ThreadMessage
  }
}

describe('InferenceExtension', () => {
  let inferenceExtension: InferenceExtension

  beforeEach(() => {
    inferenceExtension = new MockInferenceExtension()
  })

  it('should have the correct type', () => {
    expect(inferenceExtension.type()).toBe(ExtensionTypeEnum.Inference)
  })

  it('should implement the inference method', async () => {
    const messageRequest: MessageRequest = { text: 'Hello' } as unknown as MessageRequest
    const result = await inferenceExtension.inference(messageRequest)
    expect(result).toEqual({ text: 'Mock response', userId: '123' } as unknown as ThreadMessage)
  })
})
