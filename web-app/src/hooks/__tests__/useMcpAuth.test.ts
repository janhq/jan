import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { needsAuthDetail, useMcpAuth } from '../useMcpAuth'
import type { MCPAuthStatus } from '@/services/mcp/types'

const listeners: Array<(event: { payload: unknown }) => void> = []
const unlisten = vi.fn()

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_event: string, cb: (e: { payload: unknown }) => void) => {
    listeners.push(cb)
    return Promise.resolve(unlisten)
  }),
}))

const mcp = {
  getMCPAuthStatus: vi.fn(),
  authorizeMCPServer: vi.fn(),
  clearMCPAuth: vi.fn(),
}

vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ mcp: () => mcp }),
}))

const status = (over: Partial<MCPAuthStatus> = {}): MCPAuthStatus => ({
  state: 'unauthenticated',
  canAuthenticate: true,
  hasCredentials: false,
  expiresAt: null,
  ...over,
})

describe('needsAuthDetail', () => {
  it('splits the backend marker off an activation error', () => {
    expect(needsAuthDetail('NEEDS_AUTH: no credentials are stored')).toBe(
      'no credentials are stored'
    )
    expect(needsAuthDetail(new Error('NEEDS_AUTH: expired'))).toBe('expired')
    expect(needsAuthDetail({ message: 'NEEDS_AUTH: stale' })).toBe('stale')
  })

  it('leaves an ordinary failure alone', () => {
    // The whole point of the marker: a broken server must not be reported as
    // one that needs signing in.
    expect(needsAuthDetail('Failed to connect to server: ECONNREFUSED')).toBeNull()
    expect(needsAuthDetail(undefined)).toBeNull()
    expect(needsAuthDetail({})).toBeNull()
  })
})

describe('useMcpAuth', () => {
  beforeEach(() => {
    listeners.length = 0
    vi.clearAllMocks()
    mcp.getMCPAuthStatus.mockResolvedValue(status())
  })

  it('reads a status per server on mount', async () => {
    const { result } = renderHook(() => useMcpAuth(['a', 'b']))

    await waitFor(() => {
      expect(Object.keys(result.current.statuses)).toEqual(['a', 'b'])
    })
    expect(mcp.getMCPAuthStatus).toHaveBeenCalledWith('a')
    expect(mcp.getMCPAuthStatus).toHaveBeenCalledWith('b')
  })

  /// A new array identity on every render must not re-run the read loop.
  it('does not refetch when the same names arrive in a new array', async () => {
    const { result, rerender } = renderHook(({ names }) => useMcpAuth(names), {
      initialProps: { names: ['a'] },
    })
    await waitFor(() => expect(result.current.statuses.a).toBeDefined())
    const callsAfterMount = mcp.getMCPAuthStatus.mock.calls.length

    rerender({ names: ['a'] })
    await waitFor(() =>
      expect(mcp.getMCPAuthStatus.mock.calls.length).toBe(callsAfterMount)
    )

    rerender({ names: ['a', 'b'] })
    await waitFor(() => expect(result.current.statuses.b).toBeDefined())
  })

  it('drops a server whose status cannot be read instead of failing the batch', async () => {
    mcp.getMCPAuthStatus.mockImplementation((name: string) =>
      name === 'gone' ? Promise.reject(new Error('not found')) : Promise.resolve(status())
    )
    const { result } = renderHook(() => useMcpAuth(['ok', 'gone']))

    await waitFor(() => expect(result.current.statuses.ok).toBeDefined())
    expect(result.current.statuses.gone).toBeUndefined()
  })

  it('marks a server as authorizing for the duration and refreshes after', async () => {
    let release: () => void = () => {}
    mcp.authorizeMCPServer.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve
      })
    )
    const { result } = renderHook(() => useMcpAuth(['a']))
    await waitFor(() => expect(result.current.statuses.a).toBeDefined())

    let pending!: Promise<void>
    act(() => {
      pending = result.current.authorize('a')
    })
    await waitFor(() => expect(result.current.authorizing.a).toBe(true))

    mcp.getMCPAuthStatus.mockResolvedValue(
      status({ state: 'authenticated', hasCredentials: true })
    )
    await act(async () => {
      release()
      await pending
    })

    expect(result.current.authorizing.a).toBe(false)
    expect(result.current.statuses.a.state).toBe('authenticated')
  })

  it('clears the authorizing flag and refreshes even when the flow fails', async () => {
    mcp.authorizeMCPServer.mockRejectedValue(new Error('denied'))
    const { result } = renderHook(() => useMcpAuth(['a']))
    await waitFor(() => expect(result.current.statuses.a).toBeDefined())

    await act(async () => {
      await expect(result.current.authorize('a')).rejects.toThrow('denied')
    })
    expect(result.current.authorizing.a).toBe(false)
  })

  it('captures the consent url from the backend event', async () => {
    const { result } = renderHook(() => useMcpAuth(['a']))
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0))

    act(() => {
      listeners.forEach((cb) =>
        cb({ payload: { server: 'a', url: 'https://idp/authorize?x=1' } })
      )
    })
    expect(result.current.consentUrls.a).toBe('https://idp/authorize?x=1')
  })

  it('reports whether clearing found anything, and refreshes', async () => {
    mcp.clearMCPAuth.mockResolvedValue(true)
    const { result } = renderHook(() => useMcpAuth(['a']))
    await waitFor(() => expect(result.current.statuses.a).toBeDefined())

    let cleared!: boolean
    await act(async () => {
      cleared = await result.current.clearAuth('a')
    })
    expect(cleared).toBe(true)
    expect(mcp.clearMCPAuth).toHaveBeenCalledWith('a')
  })
})
