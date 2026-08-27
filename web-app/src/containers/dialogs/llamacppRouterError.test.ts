import { describe, it, expect, beforeEach, vi } from 'vitest'
import { hasActiveLlamacppRequest } from './llamacppRouterError'
import { useAppState } from '@/hooks/useAppState'
import { useModelProvider } from '@/hooks/useModelProvider'
import { useCodeRun } from '@/hooks/useCodeRun'

// This test mutates the persisted provider store. Keep the assertion focused
// on router activity instead of depending on the browser storage shim.
vi.mock('@/lib/backendStorage', () => ({
  backendStorage: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}))

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

  // Cowork keeps its own loading/model-load-progress Records in useCodeRun
  // specifically so this stays false when only a Cowork session (no real
  // chat thread) is loading a local model — writing a Cowork session id into
  // useAppState.loadingModels here would make this true and misattribute a
  // Cowork-only failure onto whatever chat thread happens to be open.
  it('is false when only a Cowork session (no chat thread) is loading a model', () => {
    useCodeRun.setState({ loadingModels: { 'cowork-session-1': true } })
    expect(hasActiveLlamacppRequest()).toBe(false)
  })
})
