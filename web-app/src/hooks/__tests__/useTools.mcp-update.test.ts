import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useTools } from '../useTools'
import { useChatSessions } from '@/stores/chat-session-store'

let mcpUpdateHandler: (() => Promise<void>) | undefined

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({
    events: () => ({
      listen: vi.fn(async (event: string, handler: () => Promise<void>) => {
        if (event === 'mcp-update') mcpUpdateHandler = handler
        return () => {}
      }),
    }),
    mcp: () => ({ getTools: vi.fn().mockResolvedValue([]) }),
    rag: () => ({ getToolNames: vi.fn().mockResolvedValue([]) }),
  }),
}))

vi.mock('@/lib/extension', () => ({
  ExtensionManager: {
    getInstance: () => ({ get: vi.fn().mockReturnValue(undefined) }),
  },
}))

vi.mock('@/lib/mcp-orchestrator/mcp-orchestrator', () => ({
  mcpOrchestrator: { invalidateCache: vi.fn() },
}))

const fakeTransport = () => ({
  invalidateFrozenTools: vi.fn(),
  refreshTools: vi.fn().mockResolvedValue(undefined),
})

const mountAndGetHandler = async () => {
  renderHook(() => useTools())
  await waitFor(() => expect(mcpUpdateHandler).toBeDefined())
  // let the mount-time setTools() settle before the test counts calls
  await mcpUpdateHandler!()
  return mcpUpdateHandler!
}

describe('useTools mcp-update', () => {
  beforeEach(() => {
    mcpUpdateHandler = undefined
  })

  it('invalidates and refreshes every session transport on mcp-update', async () => {
    const a = fakeTransport()
    const b = fakeTransport()
    useChatSessions.setState({
      sessions: { s1: { transport: a } as any, s2: { transport: b } as any },
    })
    const handler = await mountAndGetHandler()
    for (const t of [a, b]) {
      t.invalidateFrozenTools.mockClear()
      t.refreshTools.mockClear()
    }
    await handler()
    for (const t of [a, b]) {
      expect(t.invalidateFrozenTools).toHaveBeenCalledTimes(1)
      expect(t.refreshTools).toHaveBeenCalledTimes(1)
      expect(t.invalidateFrozenTools.mock.invocationCallOrder[0]).toBeLessThan(
        t.refreshTools.mock.invocationCallOrder[0]
      )
    }
  })

  it('one failing transport does not stop the others', async () => {
    const bad = {
      invalidateFrozenTools: vi.fn(() => {
        throw new Error('boom')
      }),
      refreshTools: vi.fn(),
    }
    const good = fakeTransport()
    useChatSessions.setState({
      sessions: { s1: { transport: bad } as any, s2: { transport: good } as any },
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const handler = await mountAndGetHandler()
    good.refreshTools.mockClear()
    await expect(handler()).resolves.toBeUndefined()
    expect(good.refreshTools).toHaveBeenCalledTimes(1)
    expect(bad.refreshTools).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('does nothing with no sessions', async () => {
    useChatSessions.setState({ sessions: {} })
    const handler = await mountAndGetHandler()
    await expect(handler()).resolves.toBeUndefined()
  })
})
