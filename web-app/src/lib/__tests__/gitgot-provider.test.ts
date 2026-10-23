import { describe, expect, it } from 'vitest'

import { predefinedProviders } from '@/constants/providers'
import { getProviderLogo } from '@/lib/utils'

const gitgot = predefinedProviders.find((p) => p.provider === 'gitgot')

describe('gitgot provider', () => {
  it('is registered with the inference base URL', () => {
    expect(gitgot).toBeDefined()
    expect(gitgot?.base_url).toBe('https://inference.gitgot.ai/v1')
  })

  it('has a logo mapped, so it does not render as a blank tile', () => {
    expect(getProviderLogo('gitgot')).toBe('/images/model-provider/gitgot.svg')
  })

  it('asks for an API key', () => {
    expect(gitgot?.settings.map((s) => s.key)).toContain('api-key')
  })

  // The listed models are the open-weight set this host publishes. Every id
  // must be one the endpoint actually accepts, or the first request a user
  // makes after picking it from the list fails.
  it('lists only open-weight models, by their exact served ids', () => {
    expect(gitgot?.models.map((m) => m.id).sort()).toEqual([
      'deepseek-ai/DeepSeek-V4-Flash',
      'deepseek-ai/DeepSeek-V4-Flash-0731',
      'deepseek-ai/DeepSeek-V4-Pro',
      'meta-llama/Llama-3.3-70B-Instruct',
      'moonshotai/Kimi-K2.6',
      'moonshotai/Kimi-K2.7-Code',
      'openai/gpt-oss-120b',
    ])
  })

  it('gives every model a display name and completion capability', () => {
    for (const m of gitgot?.models ?? []) {
      expect(m.name).toBeTruthy()
      expect(m.capabilities).toContain('completion')
    }
  })
})
