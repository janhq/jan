import { describe, it, expect, beforeEach } from 'vitest'
import {
  hasActiveLlamacppRequest,
  isEngineWorkInFlight,
} from './llamacppRouterError'
import { useAppState } from '@/hooks/useAppState'
import { useModelProvider } from '@/hooks/useModelProvider'

const resetApp = () =>
  useAppState.setState({
    abortControllers: {},
    busyThreads: {},
    loadingModels: {},
    streamingContents: {},
    currentStreamThreadId: undefined,
  })

beforeEach(() => {
  resetApp()
  useModelProvider.setState({ selectedProvider: 'llamacpp' })
})

describe('hasActiveLlamacppRequest', () => {
  it('is true while a token stream is in flight (currentStreamThreadId set)', () => {
    useAppState.setState({ currentStreamThreadId: 'thread-1' })
    expect(hasActiveLlamacppRequest()).toBe(true)
  })

  it('is false when idle (no active work)', () => {
    expect(hasActiveLlamacppRequest()).toBe(false)
  })

  // Separation: a router crash must not decorate chats on other providers.
  it('is false when the selected provider is not llamacpp, even mid-stream', () => {
    useModelProvider.setState({ selectedProvider: 'openai' })
    useAppState.setState({ currentStreamThreadId: 'thread-1' })
    expect(hasActiveLlamacppRequest()).toBe(false)
  })

  it('still detects activity via the legacy state slots', () => {
    useAppState.setState({ busyThreads: { 'thread-1': true } })
    expect(hasActiveLlamacppRequest()).toBe(true)
  })
})

// The hardware check reuses the predicate but not the provider gate: it runs
// from the llama.cpp settings page, which already knows which engine it is.
describe('isEngineWorkInFlight', () => {
  it('reports work regardless of which provider is selected', () => {
    useModelProvider.setState({ selectedProvider: 'openai' })
    useAppState.setState({ currentStreamThreadId: 'thread-1' })
    expect(isEngineWorkInFlight(useAppState.getState())).toBe(true)
    expect(hasActiveLlamacppRequest()).toBe(false)
  })

  it('is false when nothing is loading or streaming', () => {
    expect(isEngineWorkInFlight(useAppState.getState())).toBe(false)
  })

  it('counts a model that is still loading as work', () => {
    useAppState.setState({ loadingModels: { 'qwen3': true } })
    expect(isEngineWorkInFlight(useAppState.getState())).toBe(true)
  })
})
