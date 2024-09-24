/**
 * @jest-environment jsdom
 */
jest.mock('@janhq/core', () => ({
  ...jest.requireActual('@janhq/core/node'),
  RemoteOAIEngine: jest.fn().mockImplementation(() => ({
    onLoad: jest.fn(),
    registerSettings: jest.fn(),
    registerModels: jest.fn(),
    getSetting: jest.fn(),
    onSettingUpdate: jest.fn(),
  })),
}))
import JanInferenceOpenAIExtension, { Settings } from '.'

describe('JanInferenceOpenAIExtension', () => {
  let extension: JanInferenceOpenAIExtension

  beforeEach(() => {
    // @ts-ignore
    extension = new JanInferenceOpenAIExtension()
  })

  it('should initialize with settings and models', async () => {
    await extension.onLoad()
    // Assuming there are some default SETTINGS and MODELS being registered
    expect(extension.apiKey).toBe(undefined)
    expect(extension.inferenceUrl).toBe('')
  })

  it('should transform the payload for preview models', () => {
    const payload: any = {
      max_tokens: 100,
      model: 'o1-mini',
      // Add other required properties...
    }

    const transformedPayload = extension.transformPayload(payload)
    expect(transformedPayload.max_completion_tokens).toBe(payload.max_tokens)
    expect(transformedPayload).not.toHaveProperty('max_tokens')
    expect(transformedPayload).toHaveProperty('max_completion_tokens')
  })

  it('should not transform the payload for non-preview models', () => {
    const payload: any = {
      max_tokens: 100,
      model: 'non-preview-model',
      // Add other required properties...
    }

    const transformedPayload = extension.transformPayload(payload)
    expect(transformedPayload).toEqual(payload)
  })
})
