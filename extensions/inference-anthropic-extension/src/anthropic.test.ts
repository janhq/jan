// Import necessary modules
import JanInferenceAnthropicExtension, { Settings } from '.'
import { PayloadType, ChatCompletionRole } from '@janhq/core'

// Mocks
jest.mock('@janhq/core', () => ({
  RemoteOAIEngine: jest.fn().mockImplementation(() => ({
    registerSettings: jest.fn(),
    registerModels: jest.fn(),
    getSetting: jest.fn(),
    onChange: jest.fn(),
    onSettingUpdate: jest.fn(),
    onLoad: jest.fn(),
    headers: jest.fn(),
  })),
  PayloadType: jest.fn(),
  ChatCompletionRole: {
    User: 'user' as const,
    Assistant: 'assistant' as const,
    System: 'system' as const,
  },
}))

// Helper functions
const createMockPayload = (): PayloadType => ({
  messages: [
    { role: ChatCompletionRole.System, content: 'Meow' },
    { role: ChatCompletionRole.User, content: 'Hello' },
    { role: ChatCompletionRole.Assistant, content: 'Hi there' },
  ],
  model: 'claude-v1',
  stream: false,
})

describe('JanInferenceAnthropicExtension', () => {
  let extension: JanInferenceAnthropicExtension

  beforeEach(() => {
    extension = new JanInferenceAnthropicExtension('', '')
    extension.apiKey = 'mock-api-key'
    extension.inferenceUrl = 'mock-endpoint'
    jest.clearAllMocks()
  })

  it('should initialize with correct settings', async () => {
    await extension.onLoad()
    expect(extension.apiKey).toBe('mock-api-key')
    expect(extension.inferenceUrl).toBe('mock-endpoint')
  })

  it('should transform payload correctly', () => {
    const payload = createMockPayload()
    const transformedPayload = extension.transformPayload(payload)

    expect(transformedPayload).toEqual({
      max_tokens: 4096,
      model: 'claude-v1',
      stream: false,
      system: 'Meow',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
    })
  })

  it('should transform response correctly', () => {
    const nonStreamResponse = { content: [{ text: 'Test response' }] }
    const streamResponse =
      'data: {"type":"content_block_delta","delta":{"text":"Hello"}}'

    expect(extension.transformResponse(nonStreamResponse)).toBe('Test response')
    expect(extension.transformResponse(streamResponse)).toBe('Hello')
    expect(extension.transformResponse('')).toBe('')
    expect(extension.transformResponse('event: something')).toBe('')
  })
})
