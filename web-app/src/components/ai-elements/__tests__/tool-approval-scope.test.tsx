import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
vi.mock('zustand/middleware', () => ({ persist: (fn: unknown) => fn, createJSONStorage: () => ({}) }))
vi.mock('@/i18n/react-i18next-compat', () => ({ useTranslation: () => ({
  t: (key: string, options?: { server?: string }) => options?.server ? `${key}:${options.server}` : key,
}) }))
import { Tool, ToolApprovalActions } from '../tool'
import { useToolApprovalRequests } from '@/hooks/useToolApprovalRequests'
import { useToolApproval } from '@/hooks/useToolApproval'

describe('approval controls use the owning thread', () => {
  beforeEach(() => {
    useToolApprovalRequests.setState({ pending: {} })
    useToolApproval.setState({ approvedTools: {}, approvedServers: [], approvedToolsGlobal: [], allowAllMCPPermissions: false })
  })
  afterEach(() => {
    act(() => {
      for (const request of Object.values(useToolApprovalRequests.getState().pending)) {
        useToolApprovalRequests.getState().clearPendingForThread(request.threadId)
      }
    })
  })
  const controls = (threadId: string) => <Tool state="input-available" toolCallId="same" threadId={threadId} defaultOpen><ToolApprovalActions /></Tool>

  it('allows one same-ID call without allowing the other, then denies its owner separately', async () => {
    const store = useToolApprovalRequests.getState()
    const a = store.requestApproval('same', 'read', 'A', 'alpha')
    const b = store.requestApproval('same', 'write', 'B', 'beta')
    const { rerender } = render(controls('B'))
    expect(screen.queryByText('tools:toolApproval.allowServerAlways:alpha')).toBeNull()
    expect(screen.getByText('tools:toolApproval.allowServerAlways:beta')).toBeInTheDocument()
    fireEvent.click(screen.getByText('tools:toolApproval.allowOnce'))
    expect(await b).toBe(true)
    expect(Object.values(useToolApprovalRequests.getState().pending).map((p) => p.threadId)).toEqual(['A'])
    rerender(controls('A'))
    fireEvent.click(screen.getByText('tools:toolApproval.deny'))
    expect(await a).toBe(false)
  })

  it('does not expose controls for a same-ID call owned by another thread', () => {
    useToolApprovalRequests.getState().requestApproval('same', 'write', 'A', 'alpha')
    render(controls('B'))
    expect(screen.queryByText('tools:toolApproval.allowOnce')).toBeNull()
    expect(screen.queryByText('tools:toolApproval.deny')).toBeNull()
  })

  it('does not offer approval on an old completed tool card with a reused ID', () => {
    useToolApprovalRequests.getState().requestApproval('same', 'write', 'A', 'alpha')
    render(<Tool state="output-available" toolCallId="same" threadId="A" defaultOpen><ToolApprovalActions /></Tool>)
    expect(screen.queryByText('tools:toolApproval.allowOnce')).toBeNull()
    expect(Object.values(useToolApprovalRequests.getState().pending)).toHaveLength(1)
  })
})
