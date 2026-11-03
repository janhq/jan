import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: () => null,
}))
vi.mock('@/containers/CoworkSidePanel', () => ({
  CoworkPanelButton: (p: any) => <button {...p} />,
  CoworkSidePanel: ({ title, summary, children }: any) => (
    <aside>
      <span>{title}</span>
      {summary}
      {children}
    </aside>
  ),
}))
vi.mock('@/containers/CoworkPreviewPanel', () => ({
  PreviewBody: ({ state }: any) => (
    <div data-testid="body" data-status={state.status} data-kind={state.kind}>
      {state.status === 'ready'
        ? (state.assetUrl ?? state.content)
        : state.status === 'failed'
          ? state.reason
          : ''}
    </div>
  ),
}))

const executeAgentTool = vi.fn()
vi.mock('@/lib/agentTools', () => ({
  executeAgentTool: (...a: unknown[]) => executeAgentTool(...a),
}))

const getConversationCapabilities = vi.fn()
vi.mock('@/hooks/useThreads', () => ({
  useThreads: { getState: () => ({ getConversationCapabilities }) },
}))

// The webview must never reach the disk itself for a chat preview.
const convertFileSrc = vi.fn()
const fetchSpy = vi.fn()
vi.mock('@/hooks/useServiceHub', () => ({
  getServiceHub: () => ({ core: () => ({ convertFileSrc }) }),
  useServiceHub: () => ({ core: () => ({ convertFileSrc }) }),
}))

import { ChatPreviewPanel } from '../ChatPreviewPanel'

const GRANT = { version: 1, marker: 'current-grant' }
const body = () => screen.getByTestId('body')

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

beforeEach(() => {
  executeAgentTool.mockReset()
  getConversationCapabilities.mockReset().mockReturnValue(GRANT)
  convertFileSrc.mockReset()
  fetchSpy.mockReset()
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ChatPreviewPanel', () => {
  it('reads through the thread-scoped tool with the current grant as the 9th arg', async () => {
    executeAgentTool.mockResolvedValue({ content: '# hi' })
    render(<ChatPreviewPanel threadId="t1" path="/w/a.md" onClose={vi.fn()} />)
    await waitFor(() => expect(body()).toHaveAttribute('data-status', 'ready'))

    expect(executeAgentTool).toHaveBeenCalledTimes(1)
    const args = executeAgentTool.mock.calls[0]
    expect(args.slice(0, 8)).toEqual([
      'read',
      { path: '/w/a.md' },
      't1',
      null,
      'thread',
      false,
      false,
      null,
    ])
    expect(args[8]).toBe(GRANT)
    expect(getConversationCapabilities).toHaveBeenCalledWith('t1')
  })

  it('reads the grant afresh for each read so a revoke narrows the next one', async () => {
    executeAgentTool.mockResolvedValue({ content: 'x' })
    const narrowed = { version: 1, marker: 'narrowed' }
    const { rerender } = render(
      <ChatPreviewPanel threadId="t1" path="/w/a.txt" onClose={vi.fn()} />
    )
    await waitFor(() => expect(body()).toHaveAttribute('data-status', 'ready'))
    getConversationCapabilities.mockReturnValue(narrowed)
    rerender(<ChatPreviewPanel threadId="t1" path="/w/b.txt" onClose={vi.fn()} />)
    await waitFor(() => expect(executeAgentTool).toHaveBeenCalledTimes(2))
    expect(executeAgentTool.mock.calls[0][8]).toBe(GRANT)
    expect(executeAgentTool.mock.calls[1][8]).toBe(narrowed)
  })

  it('shows a visible failure when the host rejects the read (result error)', async () => {
    executeAgentTool.mockResolvedValue({ error: 'outside granted folders' })
    render(<ChatPreviewPanel threadId="t1" path="/etc/passwd.txt" onClose={vi.fn()} />)
    await waitFor(() => expect(body()).toHaveAttribute('data-status', 'failed'))
    expect(body()).toHaveTextContent('outside granted folders')
  })

  it('shows a visible failure when the read promise rejects, never stuck loading', async () => {
    executeAgentTool.mockRejectedValue(new Error('revoked mid-read'))
    render(<ChatPreviewPanel threadId="t1" path="/w/a.txt" onClose={vi.fn()} />)
    await waitFor(() => expect(body()).toHaveAttribute('data-status', 'failed'))
    expect(body()).toHaveTextContent('revoked mid-read')
  })

  it.each(['/w/v.mp4', '/w/s.mp3', '/w/blob.bin'])(
    'treats %s as unsupported without a read, convertFileSrc, or fetch',
    async (path) => {
      render(<ChatPreviewPanel threadId="t1" path={path} onClose={vi.fn()} />)
      await waitFor(() => expect(body()).toHaveAttribute('data-status', 'unsupported'))
      expect(executeAgentTool).not.toHaveBeenCalled()
      expect(convertFileSrc).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
    }
  )

  it('renders an image only from the host-returned data URL, never an asset URL', async () => {
    executeAgentTool.mockResolvedValue({
      images: [{ dataUrl: 'data:image/png;base64,AAAA' }],
    })
    render(<ChatPreviewPanel threadId="t1" path="/w/p.png" onClose={vi.fn()} />)
    await waitFor(() => expect(body()).toHaveAttribute('data-status', 'ready'))
    expect(body()).toHaveTextContent('data:image/png;base64,AAAA')
    expect(convertFileSrc).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('treats an image read with no data URL as unsupported', async () => {
    executeAgentTool.mockResolvedValue({ content: 'binary', images: [] })
    render(<ChatPreviewPanel threadId="t1" path="/w/p.png" onClose={vi.fn()} />)
    await waitFor(() => expect(body()).toHaveAttribute('data-status', 'unsupported'))
  })

  it('ignores a stale response after the thread switches', async () => {
    const first = deferred<any>()
    const second = deferred<any>()
    executeAgentTool
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const { rerender } = render(
      <ChatPreviewPanel threadId="t1" path="/w/a.txt" onClose={vi.fn()} />
    )
    rerender(<ChatPreviewPanel threadId="t2" path="/w/a.txt" onClose={vi.fn()} />)
    await waitFor(() => expect(executeAgentTool).toHaveBeenCalledTimes(2))
    expect(executeAgentTool.mock.calls[1][2]).toBe('t2')

    await act(async () => second.resolve({ content: 'thread two' }))
    await waitFor(() => expect(body()).toHaveTextContent('thread two'))
    await act(async () => first.resolve({ content: 'thread one SECRET' }))
    expect(body()).toHaveTextContent('thread two')
    expect(screen.queryByText(/SECRET/)).toBeNull()
  })

  it('ignores a stale rejection after the thread switches', async () => {
    const first = deferred<any>()
    executeAgentTool
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ content: 'thread two' })
    const { rerender } = render(
      <ChatPreviewPanel threadId="t1" path="/w/a.txt" onClose={vi.fn()} />
    )
    rerender(<ChatPreviewPanel threadId="t2" path="/w/a.txt" onClose={vi.fn()} />)
    await waitFor(() => expect(body()).toHaveTextContent('thread two'))
    await act(async () => {
      first.promise.catch(() => {})
      ;(first as any).resolve(Promise.reject(new Error('late')))
    })
    expect(body()).toHaveTextContent('thread two')
  })
})
