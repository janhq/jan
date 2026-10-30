import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

const fake = vi.hoisted(() => ({
  invalidateFrozenTools: vi.fn(),
  refreshTools: vi.fn(),
  updateSystemMessage: vi.fn(),
  setOnTokenUsage: vi.fn(),
  updateRagToolsAvailability: vi.fn(),
  setContinueFromContent: vi.fn(),
}))

vi.mock('@/lib/custom-chat-transport', () => ({
  CustomChatTransport: vi.fn(function () {
    return fake
  }),
}))

vi.mock('@ai-sdk/react', () => ({
  Chat: vi.fn(function () {
    return {}
  }),
  useChat: vi.fn(() => ({ status: 'ready', messages: [] })),
}))

import { useChat } from '../use-chat'
import { useAppState } from '../useAppState'

describe('useChat MCP tool name changes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    act(() => {
      useAppState.getState().updateMcpToolNames([])
      useAppState.getState().updateRagToolNames([])
    })
  })

  it('does not invalidate on mount', () => {
    renderHook(() => useChat({ sessionId: 's1' }))

    expect(fake.invalidateFrozenTools).not.toHaveBeenCalled()
  })

  it('invalidates the frozen tools before refreshing when MCP tool names change', () => {
    renderHook(() => useChat({ sessionId: 's1' }))
    expect(fake.invalidateFrozenTools).not.toHaveBeenCalled()

    act(() => useAppState.getState().updateMcpToolNames(['fs::list']))

    expect(fake.invalidateFrozenTools).toHaveBeenCalledTimes(1)
    expect(fake.refreshTools).toHaveBeenCalledTimes(1)
    expect(fake.invalidateFrozenTools.mock.invocationCallOrder[0]).toBeLessThan(
      fake.refreshTools.mock.invocationCallOrder[0]
    )
  })

  it('does not invalidate when the tool names are re-set unchanged', () => {
    act(() => useAppState.getState().updateMcpToolNames(['fs::list']))
    renderHook(() => useChat({ sessionId: 's1' }))

    act(() => useAppState.getState().updateMcpToolNames(['fs::list']))

    expect(fake.invalidateFrozenTools).not.toHaveBeenCalled()
  })
})
