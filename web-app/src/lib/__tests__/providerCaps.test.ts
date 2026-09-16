import { describe, it, expect } from 'vitest'
import { resolveProviderCaps, isPredefinedRemoteProvider } from '../providerCaps'

describe('resolveProviderCaps lemonade', () => {
  it('returns CUSTOM_PERMISSIVE for lemonade with openai api_type', () => {
    const caps = resolveProviderCaps({ provider: 'lemonade', api_type: 'openai' })
    // CUSTOM_PERMISSIVE has an empty supported set (only core/client_only)
    // and a large maybe set that includes 'penalties'
    expect(caps.maybe.has('penalties')).toBe(true)
    expect(caps.maybe.has('top_k')).toBe(true)
    expect(caps.maybe.has('mirostat')).toBe(true)
    // CUSTOM_PERMISSIVE: no samplers are in supported (they're all maybe)
    expect(caps.supported.has('penalties')).toBe(false)
    expect(caps.supported.has('top_k')).toBe(false)
  })

  it('returns ANTHROPIC caps for lemonade with anthropic api_type', () => {
    const caps = resolveProviderCaps({ provider: 'lemonade', api_type: 'anthropic' })
    // ANTHROPIC supports top_k and has empty maybe
    expect(caps.supported.has('top_k')).toBe(true)
    expect(caps.maybe.size).toBe(0)
  })

  it('isPredefinedRemoteProvider returns false for lemonade (sampler UI stays visible)', () => {
    expect(isPredefinedRemoteProvider('lemonade')).toBe(false)
  })
})
