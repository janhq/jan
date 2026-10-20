import { describe, it, expect, vi, afterEach } from 'vitest'
import { createStepMetadata } from '../stepMetadata'

const START = new Date('2026-01-01T00:00:00Z')

const finish = (usage: {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}) => ({
  type: 'finish',
  totalUsage: usage,
  finishReason: 'stop',
})

describe('createStepMetadata', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const withClock = () => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
  }

  // llama.cpp reports the engine's own rate; measuring the arrival of tokens
  // over the wire would report the network and the renderer instead.
  it('prefers the provider timings when the engine reports them', () => {
    withClock()
    const meta = createStepMetadata()
    meta.onPart({ type: 'text-start' })
    meta.onPart({
      type: 'finish-step',
      providerMetadata: { providerMetadata: { tokensPerSecond: 30, promptPerSecond: 120 } },
    })
    vi.advanceTimersByTime(4000) // Observed rate is 15; provider rate is 30.

    const out = meta.onPart(
      finish({ inputTokens: 900, outputTokens: 60, totalTokens: 960 })
    )
    expect(out?.tokenSpeed.tokenSpeed).toBe(30)
    expect(out?.tokenSpeed.promptSpeed).toBe(120)
    expect(out?.usage).toEqual({
      inputTokens: 900,
      outputTokens: 60,
      totalTokens: 960,
    })
    expect(out?.finishReason).toBe('stop')
  })

  // The clock starts when the model starts writing, so prompt processing (which
  // can dwarf generation on a long conversation) is not charged to the rate.
  it('times the observed rate from the first content part', () => {
    withClock()
    const meta = createStepMetadata()
    vi.advanceTimersByTime(30_000)
    meta.onPart({ type: 'reasoning-start' })
    vi.advanceTimersByTime(2000)

    const out = meta.onPart(finish({ outputTokens: 100, totalTokens: 100 }))
    expect(out?.tokenSpeed.tokenSpeed).toBe(50)
    expect(out?.tokenSpeed.tokenCount).toBe(100)
    expect(out?.tokenSpeed.durationMs).toBe(2000)
  })

  it('reports no rate for a step that produced nothing', () => {
    withClock()
    const meta = createStepMetadata()
    meta.onPart({ type: 'text-start' })
    vi.advanceTimersByTime(1000)

    const out = meta.onPart(finish({ outputTokens: 0, totalTokens: 40 }))
    expect(out?.tokenSpeed.tokenSpeed).toBe(0)
    // A prompt-only total still has to survive: the budget reads it.
    expect(out?.usage.totalTokens).toBe(40)
  })

  it('stamps nothing until the step finishes', () => {
    withClock()
    const meta = createStepMetadata()
    expect(meta.onPart({ type: 'text-start' })).toBeUndefined()
    expect(meta.onPart({ type: 'text-delta' })).toBeUndefined()
    expect(meta.onPart({ type: 'finish-step' })).toBeUndefined()
  })
})
