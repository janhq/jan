import { describe, it, expect } from 'vitest'
import { shouldShowTokenCounter } from '@/lib/tokenCounterVisibility'

const base = {
  hasSelectedModel: true,
  isAgentMode: false,
  isInitialMessage: false,
  hasMessages: true,
  hasPromptText: false,
}

describe('shouldShowTokenCounter', () => {
  it('shows when a model is selected and the thread has messages', () => {
    expect(shouldShowTokenCounter(base)).toBe(true)
  })

  it('shows when a model is selected and the prompt has text but no messages yet', () => {
    expect(
      shouldShowTokenCounter({
        ...base,
        hasMessages: false,
        hasPromptText: true,
      })
    ).toBe(true)
  })

  it('hides when no model is selected', () => {
    expect(shouldShowTokenCounter({ ...base, hasSelectedModel: false })).toBe(
      false
    )
  })

  it('hides in agent mode', () => {
    expect(shouldShowTokenCounter({ ...base, isAgentMode: true })).toBe(false)
  })

  it('hides for the initial-message (new-thread) input', () => {
    expect(shouldShowTokenCounter({ ...base, isInitialMessage: true })).toBe(
      false
    )
  })

  it('hides when there are neither messages nor prompt text', () => {
    expect(
      shouldShowTokenCounter({
        ...base,
        hasMessages: false,
        hasPromptText: false,
      })
    ).toBe(false)
  })

  // Regression: the token counter must NOT depend on whether the model is
  // currently in `activeModels`. Router-mode llama.cpp loads lazily and never
  // writes the model back into `activeModels` during a chat turn, so a gate on
  // "is the model active" hid the counter for llama.cpp entirely while remote
  // providers (which were gated only on model selection) kept showing it.
  // Visibility is decided by model selection + conversation state only; the
  // TokenCounter component itself decides whether it has data worth rendering.
  it('shows for a local (llama.cpp) model regardless of active-model state', () => {
    // There is no `isModelActive` input at all: the predicate is provider- and
    // load-state-agnostic by construction.
    expect(shouldShowTokenCounter(base)).toBe(true)
    expect(
      shouldShowTokenCounter({ ...base, hasMessages: false, hasPromptText: true })
    ).toBe(true)
  })

  it('shows identically for local and remote providers given the same inputs', () => {
    const inputs = { ...base, hasMessages: true, hasPromptText: false }
    // Predicate takes no provider argument; same inputs => same result.
    expect(shouldShowTokenCounter(inputs)).toBe(true)
  })

  it('agent mode wins even with a selected model and messages', () => {
    expect(
      shouldShowTokenCounter({
        ...base,
        isAgentMode: true,
        hasSelectedModel: true,
        hasMessages: true,
        hasPromptText: true,
      })
    ).toBe(false)
  })

  it('initial-message wins even with a selected model and prompt text', () => {
    expect(
      shouldShowTokenCounter({
        ...base,
        isInitialMessage: true,
        hasPromptText: true,
      })
    ).toBe(false)
  })

  it('requires a selected model even when messages exist', () => {
    expect(
      shouldShowTokenCounter({
        ...base,
        hasSelectedModel: false,
        hasMessages: true,
        hasPromptText: true,
      })
    ).toBe(false)
  })
})
