import { describe, it, expect } from 'vitest'
import { isLikelyLightweightRouterModel } from '../mcp-router-model-filter'

const m = (id: string, displayName?: string): Model => ({
  id,
  displayName,
})

describe('isLikelyLightweightRouterModel', () => {
  it('allows small / flash / haiku style names', () => {
    expect(isLikelyLightweightRouterModel(m('claude-3-5-haiku'))).toBe(true)
    expect(isLikelyLightweightRouterModel(m('gemini-2.0-flash'))).toBe(true)
    expect(isLikelyLightweightRouterModel(m('gpt-4o-mini'))).toBe(true)
  })

  it('rejects opus and heavy reasoning tiers', () => {
    expect(isLikelyLightweightRouterModel(m('claude-3-opus'))).toBe(false)
    expect(isLikelyLightweightRouterModel(m('x', 'Opus 4'))).toBe(false)
    expect(isLikelyLightweightRouterModel(m('o1-preview'))).toBe(false)
    expect(isLikelyLightweightRouterModel(m('gpt-4-turbo'))).toBe(false)
  })

  it('rejects unknown midsize ids with no signals', () => {
    expect(isLikelyLightweightRouterModel(m('company-prod-v2'))).toBe(false)
  })

  it('allows typical GGUF paths with small param counts', () => {
    expect(
      isLikelyLightweightRouterModel(
        m('models/Meta-Llama-3-8B-Q4_K_M.gguf')
      )
    ).toBe(true)
  })
})
