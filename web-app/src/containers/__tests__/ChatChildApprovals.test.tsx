import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const named = options?.tool ?? options?.server
      return named ? `${key}:${named}` : key
    },
  }),
}))
vi.mock('@/components/ai-elements/code-block', () => ({ CodeBlock: () => null }))
vi.mock('@/containers/CopyButton', () => ({ CopyButton: () => null }))

import { ChatChildApprovals } from '../ChatChildApprovals'
import { useChildApprovalCalls } from '@/hooks/useChildApprovalCalls'
import { useToolApprovalRequests } from '@/hooks/useToolApprovalRequests'
import { useToolApproval } from '@/hooks/useToolApproval'

const request = (callId: string, threadId = 't1', tool = 'fetch', server: string | undefined = 'srv') =>
  useToolApprovalRequests.getState().requestApproval(callId, tool, threadId, server)

const reset = () => {
  useToolApprovalRequests.getState().clearPendingForThread('t1')
  useToolApprovalRequests.getState().clearPendingForThread('t2')
  useChildApprovalCalls.setState({ owned: {} })
  useToolApproval.setState({ approvedTools: {}, allowAllMCPPermissions: false } as never)
}

describe('ChatChildApprovals', () => {
  beforeEach(reset)
  afterEach(reset)

  it('renders nothing for a pending call the route does not own as a child (parent prompts are not duplicated)', async () => {
    render(<ChatChildApprovals threadId="t1" />)
    await act(async () => { void request('parent-call') })
    expect(screen.queryByTestId('chat-child-approvals')).toBeNull()
  })

  it('shows a pending child call with tool name and server identity, and nothing before the prompt is pending', async () => {
    render(<ChatChildApprovals threadId="t1" />)
    await act(async () => { useChildApprovalCalls.getState().register('t1', 'task1:c1') })
    expect(screen.queryByTestId('chat-child-approvals')).toBeNull()
    await act(async () => { void request('task1:c1') })
    const card = screen.getByTestId('chat-child-approvals')
    expect(card).toHaveTextContent('srv')
    expect(card).toHaveTextContent('fetch')
    expect(screen.getByText('tools:toolApproval.deny')).toBeInTheDocument()
  })

  it.each([
    ['tools:toolApproval.allowOnce', true],
    ['tools:toolApproval.deny', false],
  ] as const)('%s resolves the bound thread/call exactly once through the standard store', async (label, expected) => {
    render(<ChatChildApprovals threadId="t1" />)
    let result!: Promise<unknown>
    await act(async () => {
      useChildApprovalCalls.getState().register('t1', 'task1:c1')
      result = request('task1:c1')
      void request('task1:other', 't2')
    })
    await act(async () => { fireEvent.click(screen.getByText(label)) })
    await expect(result).resolves.toBe(expected)
    expect(screen.queryByTestId('chat-child-approvals')).toBeNull()
    // The other thread's prompt, never rendered here, is untouched.
    expect(useToolApprovalRequests.getState().pending[JSON.stringify(['t2', 'task1:other'])]).toBeDefined()
  })

  it('never approves on its own: a pending child call stays pending until a decision', async () => {
    render(<ChatChildApprovals threadId="t1" />)
    let settled = false
    await act(async () => {
      useChildApprovalCalls.getState().register('t1', 'task1:c1')
      void request('task1:c1').then(() => { settled = true })
    })
    await act(async () => { await Promise.resolve() })
    expect(settled).toBe(false)
    expect(useToolApproval.getState().approvedTools).toEqual({})
  })

  it('disappears on cancel, on thread clear, and when the route releases the call', async () => {
    render(<ChatChildApprovals threadId="t1" />)
    await act(async () => {
      useChildApprovalCalls.getState().register('t1', 'a')
      useChildApprovalCalls.getState().register('t1', 'b')
      useChildApprovalCalls.getState().register('t1', 'c')
      void request('a'); void request('b'); void request('c')
    })
    expect(screen.getAllByText('tools:toolApproval.deny')).toHaveLength(3)
    await act(async () => { useToolApprovalRequests.getState().cancelApproval('a', 't1') })
    expect(screen.getAllByText('tools:toolApproval.deny')).toHaveLength(2)
    await act(async () => { useChildApprovalCalls.getState().release('t1', 'b') })
    expect(screen.getAllByText('tools:toolApproval.deny')).toHaveLength(1)
    await act(async () => { useToolApprovalRequests.getState().clearPendingForThread('t1') })
    expect(screen.queryByTestId('chat-child-approvals')).toBeNull()
  })

  it('drops the card when the thread on screen changes', async () => {
    const { rerender } = render(<ChatChildApprovals threadId="t1" />)
    await act(async () => {
      useChildApprovalCalls.getState().register('t1', 'a')
      void request('a')
    })
    expect(screen.getByTestId('chat-child-approvals')).toBeInTheDocument()
    rerender(<ChatChildApprovals threadId="t2" />)
    expect(screen.queryByTestId('chat-child-approvals')).toBeNull()
  })
})
