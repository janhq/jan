import { act, renderHook } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let useOpenUISettings: typeof import('../useOpenUISettings')['useOpenUISettings']

describe('useOpenUISettings', () => {
  beforeAll(async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    })
    ;({ useOpenUISettings } = await import('../useOpenUISettings'))
  })

  beforeEach(() => {
    useOpenUISettings.setState({
      enabledThreads: {},
      componentLibrary: 'chat',
    })
  })

  it('keeps OpenUI disabled for unknown threads', () => {
    const { result } = renderHook(() => useOpenUISettings())

    expect(result.current.isEnabled('unknown')).toBe(false)
  })

  it('tracks enablement independently for each thread', () => {
    const { result } = renderHook(() => useOpenUISettings())

    act(() => {
      result.current.setEnabled('thread-1', true)
      result.current.setEnabled('thread-2', false)
    })

    expect(result.current.isEnabled('thread-1')).toBe(true)
    expect(result.current.isEnabled('thread-2')).toBe(false)
  })

  it('toggles a single thread without changing another thread', () => {
    const { result } = renderHook(() => useOpenUISettings())

    act(() => {
      result.current.setEnabled('thread-2', true)
      result.current.toggleEnabled('thread-1')
    })

    expect(result.current.isEnabled('thread-1')).toBe(true)
    expect(result.current.isEnabled('thread-2')).toBe(true)

    act(() => {
      result.current.toggleEnabled('thread-1')
    })

    expect(result.current.isEnabled('thread-1')).toBe(false)
    expect(result.current.isEnabled('thread-2')).toBe(true)
  })

  it('transfers new-chat enablement to the created thread', () => {
    const { result } = renderHook(() => useOpenUISettings())

    act(() => {
      result.current.setEnabled('temporary', true)
      result.current.transferThread('temporary', 'thread-1')
    })

    expect(result.current.enabledThreads.temporary).toBeUndefined()
    expect(result.current.isEnabled('thread-1')).toBe(true)
  })

  it('removes settings for deleted threads', () => {
    const { result } = renderHook(() => useOpenUISettings())

    act(() => {
      result.current.setEnabled('thread-1', true)
      result.current.removeThread('thread-1')
    })

    expect(result.current.enabledThreads['thread-1']).toBeUndefined()
  })
})
