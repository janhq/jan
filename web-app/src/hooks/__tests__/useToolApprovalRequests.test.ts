import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useToolApprovalRequests } from '../useToolApprovalRequests'

// The grant rules themselves are Rust's (agent-tools `consent`, tested there);
// this store only carries the prompt between Rust and the UI.
const consent = vi.hoisted(() => ({
  request: vi.fn(),
  answer: vi.fn(),
  cancel: vi.fn(),
}))
vi.mock('@janhq/tauri-plugin-agent-tools-api', () => ({
  consentRequest: consent.request,
  consentAnswer: consent.answer,
  consentCancelThread: consent.cancel,
}))

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('useToolApprovalRequests', () => {
  beforeEach(() => {
    useToolApprovalRequests.setState({ pending: {} })
    consent.request.mockReset()
    consent.answer.mockReset()
    consent.cancel.mockReset().mockResolvedValue(undefined)
  })

  it('runs a call Rust allows without prompting', async () => {
    consent.request.mockResolvedValue('allowed')
    const approved = await useToolApprovalRequests
      .getState()
      .requestApproval('c1', 'search', 't1', 'web')
    expect(approved).toBe(true)
    expect(useToolApprovalRequests.getState().pending).toEqual({})
    expect(consent.request).toHaveBeenCalledWith({
      threadId: 't1',
      callId: 'c1',
      tool: 'search',
      server: 'web',
      origin: 'mcp',
      strict: false,
    })
  })

  it('prompts when Rust asks, and resolves with what Rust says the answer allows', async () => {
    consent.request.mockResolvedValue('ask')
    consent.answer.mockResolvedValue(true)
    const approved = useToolApprovalRequests
      .getState()
      .requestApproval('c1', 'notes', 't1', 'ext:acme', {
        strict: true,
        origin: 'extension',
      })
    await flush()
    expect(useToolApprovalRequests.getState().pending.c1).toMatchObject({
      serverName: 'ext:acme',
      strict: true,
      extension: true,
    })
    useToolApprovalRequests.getState().resolveApproval('c1', 'allow-thread')
    expect(useToolApprovalRequests.getState().pending.c1).toBeUndefined()
    await expect(approved).resolves.toBe(true)
    expect(consent.answer).toHaveBeenCalledWith('c1', 'allow-thread')
  })

  it('denies when Rust cannot be reached, asked or answered', async () => {
    consent.request.mockRejectedValueOnce(new Error('ipc'))
    await expect(
      useToolApprovalRequests.getState().requestApproval('c1', 'x', 't1')
    ).resolves.toBe(false)

    consent.request.mockResolvedValue('ask')
    consent.answer.mockRejectedValue(new Error('ipc'))
    const approved = useToolApprovalRequests
      .getState()
      .requestApproval('c2', 'x', 't1')
    await flush()
    useToolApprovalRequests.getState().resolveApproval('c2', 'allow-once')
    await expect(approved).resolves.toBe(false)
  })

  it('clearPendingForThread denies that thread only and ends its authorizations', async () => {
    consent.request.mockResolvedValue('ask')
    const a = useToolApprovalRequests.getState().requestApproval('a', 'x', 't1')
    const b = useToolApprovalRequests.getState().requestApproval('b', 'x', 't2')
    await flush()
    useToolApprovalRequests.getState().clearPendingForThread('t1')
    await expect(a).resolves.toBe(false)
    expect(consent.cancel).toHaveBeenCalledWith('t1')
    expect(useToolApprovalRequests.getState().pending.b).toBeDefined()
    consent.answer.mockResolvedValue(false)
    useToolApprovalRequests.getState().resolveApproval('b', 'deny')
    await expect(b).resolves.toBe(false)
  })
})
