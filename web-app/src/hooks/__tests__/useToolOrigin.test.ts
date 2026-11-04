import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

vi.mock('@/hooks/useWebSearchConfig', () => ({
  getProviderMeta: () => ({ label: 'fixture' }),
  useWebSearchConfig: (select: (s: unknown) => unknown) => select({ searchProvider: 'fixture', webSearchEnabled: false }),
}))
vi.mock('@/lib/agentTools', () => ({ AGENT_TOOL_NAMES: new Set(), isRecordedShellCall: () => false }))

import { useAppState } from '../useAppState'
import { useToolCallRuntime } from '../useToolCallRuntime'
import { useMessages } from '../useMessages'
import { useToolOrigin } from '../useToolOrigin'

const menu = (server: string) => [{ name: 'retrieve', server, description: '', inputSchema: { type: 'object' } }]

describe('request-bound card origin', () => {
  beforeEach(() => {
    useToolCallRuntime.getState().reset()
    useMessages.setState({ messages: {} })
    useAppState.setState({ tools: menu('menu-beta'), ragToolNames: new Set(['retrieve']) })
  })

  it('labels the bound MCP server before approval/execution despite RAG overlap and menu refresh', () => {
    const { result } = renderHook(() => useToolOrigin('retrieve', 'call'))
    act(() => useToolCallRuntime.getState().recordOrigin('call', 'request-alpha'))
    expect(result.current).toEqual({ kind: 'mcp', detail: 'request-alpha' })
    act(() => useAppState.setState({ tools: menu('replacement') }))
    expect(result.current).toEqual({ kind: 'mcp', detail: 'request-alpha' })
  })

  it('labels advertised internal retrieval as RAG, not the overlapping MCP server', () => {
    useToolCallRuntime.getState().recordOrigin('internal', undefined)
    const { result } = renderHook(() => useToolOrigin('retrieve', 'internal'))
    expect(result.current).toEqual({ kind: 'rag' })
  })
  it('restores only the recorded message identity after runtime reset; unknown overlaps stay unlabelled', () => {
    useMessages.setState({ messages: { thread: [{
      id: 'historical', metadata: { toolOrigins: { old: 'persisted-alpha', internal: null } },
    } as never] } })
    const { result } = renderHook(() => [
      useToolOrigin('retrieve', 'old', 'historical', 'thread'),
      useToolOrigin('retrieve', 'internal', 'historical', 'thread'),
      useToolOrigin('retrieve', 'old', 'different-message', 'thread'),
    ])
    expect(result.current).toEqual([
      { kind: 'mcp', detail: 'persisted-alpha' }, { kind: 'rag' }, undefined,
    ])
  })

  it('never enumerates unrelated threads when selecting historical origin', () => {
    const messages = { thread: [{ id: 'same-id', metadata: { toolOrigins: { old: 'alpha' } } } as never] }
    Object.defineProperty(messages, 'unrelated', { enumerable: true, get: () => { throw new Error('foreign thread scanned') } })
    useMessages.setState({ messages })
    const { result } = renderHook(() => useToolOrigin('retrieve', 'old', 'same-id', 'thread'))
    expect(result.current).toEqual({ kind: 'mcp', detail: 'alpha' })
    act(() => useMessages.setState({ messages }))
    expect(result.current).toEqual({ kind: 'mcp', detail: 'alpha' })
  })

  it('scopes live provider call IDs to their thread before persisting history', () => {
    useToolCallRuntime.getState().recordOrigin('reused', 'alpha', 'thread-a')
    useToolCallRuntime.getState().recordOrigin('reused', 'beta', 'thread-b')
    const { result } = renderHook(() => [
      useToolOrigin('retrieve', 'reused', 'same-message', 'thread-a'),
      useToolOrigin('retrieve', 'reused', 'same-message', 'thread-b'),
    ])
    expect(result.current).toEqual([{ kind: 'mcp', detail: 'alpha' }, { kind: 'mcp', detail: 'beta' }])
  })

  it('keeps historical message identity when a later call reuses its wire ID', () => {
    useMessages.setState({ messages: { thread: [{ id: 'old-message', metadata: { toolOrigins: { reused: 'old-alpha' } } } as never] } })
    useToolCallRuntime.getState().recordOrigin('reused', 'new-beta', 'thread')
    const { result } = renderHook(() => useToolOrigin('retrieve', 'reused', 'old-message', 'thread'))
    expect(result.current).toEqual({ kind: 'mcp', detail: 'old-alpha' })
  })

})
