import { describe, it, expect } from 'vitest'
import { modelPreservesReasoning } from '../model-factory'

const providerWith = (model: unknown): ProviderObject =>
  ({ provider: 'llamacpp', models: [model] }) as unknown as ProviderObject

describe('modelPreservesReasoning', () => {
  it('is true when the user-set preserve_thinking kwarg is on', () => {
    const provider = providerWith({
      id: 'qwen',
      settings: {
        chat_template_kwargs: {
          controller_props: { value: { preserve_thinking: true } },
        },
      },
    })
    expect(modelPreservesReasoning(provider, 'qwen')).toBe(true)
  })

  it('is false when the user-set preserve_thinking kwarg is off (overrides GGUF default)', () => {
    const provider = providerWith({
      id: 'qwen',
      template_kwargs: [
        { name: 'preserve_thinking', type: 'boolean', default: true },
      ],
      settings: {
        chat_template_kwargs: {
          controller_props: { value: { preserve_thinking: false } },
        },
      },
    })
    expect(modelPreservesReasoning(provider, 'qwen')).toBe(false)
  })

  it('falls back to the GGUF-detected template_kwargs default', () => {
    const provider = providerWith({
      id: 'qwen',
      template_kwargs: [
        { name: 'preserve_thinking', type: 'boolean', default: true },
      ],
    })
    expect(modelPreservesReasoning(provider, 'qwen')).toBe(true)
  })

  it('is false when neither a value nor a template default declares it', () => {
    const provider = providerWith({ id: 'qwen', settings: {} })
    expect(modelPreservesReasoning(provider, 'qwen')).toBe(false)
  })

  it('is false for an unknown model or missing provider', () => {
    const provider = providerWith({ id: 'other' })
    expect(modelPreservesReasoning(provider, 'qwen')).toBe(false)
    expect(modelPreservesReasoning(undefined, 'qwen')).toBe(false)
  })
})
