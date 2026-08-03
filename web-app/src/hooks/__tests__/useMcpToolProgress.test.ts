import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const listen = vi.fn()
vi.mock('@/hooks/useServiceHub', () => ({
  useServiceHub: () => ({ events: () => ({ listen }) }),
}))

const isTauri = vi.fn(() => true)
vi.mock('@/lib/platform/utils', () => ({
  isPlatformTauri: () => isTauri(),
}))

import {
  MCP_TOOL_PROGRESS_EVENT,
  useMcpToolProgress,
} from '../useMcpToolProgress'
import { useToolCallRuntime } from '../useToolCallRuntime'

const update = { server: 'github', progress: 2, total: 4, percent: 50 }

describe('useMcpToolProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isTauri.mockReturnValue(true)
    useToolCallRuntime.getState().reset()
    listen.mockResolvedValue(() => {})
  })

  it('records an update against the running call', async () => {
    let handler: ((e: { payload: unknown }) => void) | undefined
    listen.mockImplementation(async (_event: string, fn: typeof handler) => {
      handler = fn
      return () => {}
    })
    const runtime = useToolCallRuntime.getState()
    runtime.enqueue(['a'])
    runtime.markRunning('a')

    renderHook(() => useMcpToolProgress())
    await vi.waitFor(() => expect(handler).toBeTypeOf('function'))
    handler!({ payload: update })

    expect(useToolCallRuntime.getState().progress['a']).toMatchObject(update)
  })

  it('subscribes to the event the Rust handler emits', () => {
    renderHook(() => useMcpToolProgress())
    expect(listen).toHaveBeenCalledWith(
      MCP_TOOL_PROGRESS_EVENT,
      expect.any(Function)
    )
  })

  it('unsubscribes on unmount', async () => {
    const unlisten = vi.fn()
    listen.mockResolvedValue(unlisten)
    const { unmount } = renderHook(() => useMcpToolProgress())
    await vi.waitFor(() => expect(listen).toHaveBeenCalled())
    unmount()
    expect(unlisten).toHaveBeenCalled()
  })

  // listen() is async, so a short-lived mount can resolve after teardown and
  // leave the subscription behind.
  it('unsubscribes when listen resolves after unmount', async () => {
    const unlisten = vi.fn()
    let resolve: ((fn: () => void) => void) | undefined
    listen.mockReturnValue(
      new Promise<() => void>((r) => {
        resolve = r
      })
    )
    const { unmount } = renderHook(() => useMcpToolProgress())
    unmount()
    resolve!(unlisten)
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalled())
  })

  it('does not subscribe outside Tauri', () => {
    isTauri.mockReturnValue(false)
    renderHook(() => useMcpToolProgress())
    expect(listen).not.toHaveBeenCalled()
  })
})
