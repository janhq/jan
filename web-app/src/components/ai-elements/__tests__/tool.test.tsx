import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const named = options?.tool ?? options?.server
      return named ? `${key}:${named}` : key
    },
  }),
}))

const approvalState: { pending: Record<string, unknown> } = { pending: {} }
const resolveApproval = vi.fn()
let useRealApprovals = false
vi.mock('@/hooks/useToolApprovalRequests', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useToolApprovalRequests')>()
  const hook = (selector: (s: unknown) => unknown) => useRealApprovals
    ? actual.useToolApprovalRequests(selector)
    : selector({ ...approvalState, resolveApproval })
  hook.getState = actual.useToolApprovalRequests.getState
  return { ...actual, useToolApprovalRequests: hook }
})

vi.mock('../code-block', () => ({
  CodeBlock: ({ code }: { code: string }) => (
    <pre data-testid="code-block">{code}</pre>
  ),
}))

vi.mock('@/containers/CopyButton', () => ({
  CopyButton: ({ text }: { text: string }) => (
    <button data-testid="copy" data-text={text} />
  ),
}))

import {
  Tool,
  ToolApprovalActions,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '../tool'
import { approvalKey, useToolApprovalRequests } from '@/hooks/useToolApprovalRequests'
import { useToolApproval } from '@/hooks/useToolApproval'
import { useToolCallRuntime } from '@/hooks/useToolCallRuntime'

const resolver = (input: string) => Promise.resolve(input)

// The approval mock is module state; leaving a pending entry behind would make
// every later header render as awaiting approval.
beforeEach(() => {
  useRealApprovals = false
  approvalState.pending = {}
  resolveApproval.mockClear()
})

const renderHeader = (props: Partial<React.ComponentProps<typeof ToolHeader>> = {}) =>
  render(
    <Tool state="output-available" toolCallId="tc1" messageId="m1">
      <ToolHeader
        title="read_file"
        type="tool-read_file"
        state="output-available"
        {...props}
      />
    </Tool>
  )

const renderApproval = (pending: Record<string, unknown>) => {
  approvalState.pending = Object.fromEntries(Object.entries(pending).map(([id, entry]) => [JSON.stringify(['thread-a', id]), entry]))
  return render(
    <Tool state="input-available" toolCallId="tc1" messageId="m1" threadId="thread-a" defaultOpen>
      <ToolApprovalActions />
    </Tool>
  )
}

describe('ToolApprovalActions', () => {
  beforeEach(() => {
    resolveApproval.mockClear()
    approvalState.pending = {}
  })

  it('real same-ID prompts survive another thread decision and finally cleanup', async () => {
    useRealApprovals = true
    useToolApproval.setState({ approvedTools: {}, approvedMCPTools: [], approvedServers: [], approvedToolsGlobal: [], allowAllMCPPermissions: false })
    const requests = useToolApprovalRequests.getState()
    const a = requests.requestApproval('same-real', 'read', 'thread-a', 'alpha')
    let bSettled = false
    const b = requests.requestApproval('same-real', 'read', 'thread-b', 'beta')
    void b.then(() => { bSettled = true })
    render(<>
      <section data-testid="real-a"><Tool state="input-available" toolCallId="same-real" threadId="thread-a" defaultOpen><ToolApprovalActions /></Tool></section>
      <section data-testid="real-b"><Tool state="input-available" toolCallId="same-real" threadId="thread-b" defaultOpen><ToolApprovalActions /></Tool></section>
    </>)
    fireEvent.click(within(screen.getByTestId('real-a')).getByText('tools:toolApproval.allowOnce'))
    await expect(a).resolves.toBe(true)
    act(() => requests.cancelApproval('same-real', 'thread-a')) // route finally API
    expect(bSettled).toBe(false)
    expect(useToolApprovalRequests.getState().pending[approvalKey('thread-b', 'same-real')]).toBeDefined()
    fireEvent.click(within(screen.getByTestId('real-b')).getByText('tools:toolApproval.allowOnce'))
    await expect(b).resolves.toBe(true)
  })

  it('dispatches same-ID cards to their own thread only', () => {
    approvalState.pending = {
      [JSON.stringify(['thread-a', 'same'])]: { toolCallId: 'same', threadId: 'thread-a', serverName: 'alpha' },
      [JSON.stringify(['thread-b', 'same'])]: { toolCallId: 'same', threadId: 'thread-b', serverName: 'beta' },
    }
    render(<>
      <section data-testid="thread-a"><Tool state="input-available" toolCallId="same" threadId="thread-a" defaultOpen><ToolApprovalActions /></Tool></section>
      <section data-testid="thread-b"><Tool state="input-available" toolCallId="same" threadId="thread-b" defaultOpen><ToolApprovalActions /></Tool></section>
    </>)
    fireEvent.click(within(screen.getByTestId('thread-a')).getByText('tools:toolApproval.allowOnce'))
    expect(resolveApproval).toHaveBeenLastCalledWith('same', 'allow-once', 'thread-a')
    fireEvent.click(within(screen.getByTestId('thread-b')).getByText('tools:toolApproval.deny'))
    expect(resolveApproval).toHaveBeenLastCalledWith('same', 'deny', 'thread-b')
    expect(within(screen.getByTestId('thread-a')).getByText('tools:toolApproval.allowServerAlways:alpha')).toBeInTheDocument()
    expect(within(screen.getByTestId('thread-b')).getByText('tools:toolApproval.allowServerAlways:beta')).toBeInTheDocument()
  })

  it('renders nothing when no approval is pending', () => {
    renderApproval({})
    expect(
      screen.queryByText('tools:toolApproval.deny')
    ).not.toBeInTheDocument()
  })

  // Trusting a server tool-by-tool is the same decision repeated, so "always"
  // offers the server rather than the single tool.
  it('offers to trust the whole server by name', () => {
    renderApproval({
      tc1: { toolCallId: 'tc1', toolName: 'create_issue', serverName: 'github' },
    })
    expect(
      screen.getByText('tools:toolApproval.allowServerAlways:github')
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/tools:toolApproval.allowToolAlways/)
    ).not.toBeInTheDocument()
  })

  it('falls back to the tool name when it has no server', () => {
    renderApproval({ tc1: { toolCallId: 'tc1', toolName: 'do_thing' } })
    expect(
      screen.getByText('tools:toolApproval.allowToolAlways:do_thing')
    ).toBeInTheDocument()
  })

  it('keeps extension approvals session-scoped: no always button', () => {
    const controls = (pending: Record<string, unknown>) => {
      const view = renderApproval({ tc1: { toolCallId: 'tc1', ...pending } })
      const labels = screen.getAllByRole('button').map((b) => b.textContent)
      view.unmount()
      return labels
    }
    expect(controls({ toolName: 'run', serverName: 'ext:acme' })).toEqual([
      'tools:toolApproval.deny',
      'tools:toolApproval.allowOnce',
      'tools:toolApproval.allowInThread',
    ])
    expect(controls({ toolName: 'run', serverName: 'github' })).toEqual([
      'tools:toolApproval.deny',
      'tools:toolApproval.allowOnce',
      'tools:toolApproval.allowInThread',
      'tools:toolApproval.allowServerAlways:github',
    ])
    expect(controls({ toolName: 'do_thing' })).toEqual([
      'tools:toolApproval.deny',
      'tools:toolApproval.allowOnce',
      'tools:toolApproval.allowInThread',
      'tools:toolApproval.allowToolAlways:do_thing',
    ])
  })

  it('still grants extension tools once or in thread', () => {
    renderApproval({ tc1: { toolCallId: 'tc1', toolName: 'run', serverName: 'ext:acme' } })
    fireEvent.click(screen.getByText('tools:toolApproval.allowOnce'))
    fireEvent.click(screen.getByText('tools:toolApproval.allowInThread'))
    expect(resolveApproval.mock.calls.map((c) => c[1])).toEqual(['allow-once', 'allow-thread'])
  })

  it('grants each scope the reader picked', () => {
    renderApproval({
      tc1: { toolCallId: 'tc1', toolName: 'create_issue', serverName: 'github' },
    })
    fireEvent.click(screen.getByText('tools:toolApproval.allowOnce'))
    fireEvent.click(screen.getByText('tools:toolApproval.allowInThread'))
    fireEvent.click(
      screen.getByText('tools:toolApproval.allowServerAlways:github')
    )
    fireEvent.click(screen.getByText('tools:toolApproval.deny'))
    expect(resolveApproval.mock.calls.every((c) => c[2] === 'thread-a')).toBe(true)
    expect(resolveApproval.mock.calls.map((c) => c[1])).toEqual([
      'allow-once',
      'allow-thread',
      'allow-always',
      'deny',
    ])
  })
})

describe('ToolHeader runtime state', () => {
  beforeEach(() => {
    useToolCallRuntime.getState().reset()
  })

  // A queued call and a running one are both `input-available`, so without the
  // queue the header claims every pending call is already running.
  it('says a call is queued until the executor reaches it', () => {
    useToolCallRuntime.getState().enqueue(['tc1'])
    renderHeader({ state: 'input-available' })
    expect(screen.getByText(/tools:toolCall.queued/)).toBeInTheDocument()
    expect(screen.queryByText(/tools:toolCall.running/)).not.toBeInTheDocument()
  })

  it('counts the calls waiting ahead of it', () => {
    useToolCallRuntime.getState().enqueue(['a', 'b', 'tc1'])
    renderHeader({ state: 'input-available' })
    expect(screen.getByText('tools:toolCall.queuedPosition')).toBeInTheDocument()
  })

  it('omits the position for the call that runs next', () => {
    useToolCallRuntime.getState().enqueue(['tc1', 'b'])
    renderHeader({ state: 'input-available' })
    expect(
      screen.queryByText('tools:toolCall.queuedPosition')
    ).not.toBeInTheDocument()
  })

  it('switches to running once the executor starts it', () => {
    useToolCallRuntime.getState().enqueue(['tc1'])
    useToolCallRuntime.getState().markRunning('tc1')
    renderHeader({ state: 'input-available' })
    expect(screen.getByText(/tools:toolCall.running/)).toBeInTheDocument()
  })

  it('shows how long a finished call took', () => {
    const runtime = useToolCallRuntime.getState()
    runtime.enqueue(['tc1'])
    runtime.markRunning('tc1')
    vi.setSystemTime(Date.now() + 5000)
    runtime.markSettled('tc1')
    renderHeader({ state: 'output-available' })
    expect(screen.getByText('common:duration.seconds')).toBeInTheDocument()
  })
})

describe('ToolHeader', () => {
  it('shows where the call came from', () => {
    renderHeader({ origin: 'filesystem' })
    expect(screen.getByText('filesystem')).toBeInTheDocument()
  })

  it('previews the arguments inline', () => {
    renderHeader({ input: { path: 'src/app.ts' } })
    expect(screen.getByText('path: src/app.ts')).toBeInTheDocument()
  })

  it('previews arguments that are still mid-stream', () => {
    renderHeader({ input: { path: 'src/ap' } })
    expect(screen.getByText('path: src/ap')).toBeInTheDocument()
  })

  it('renders no preview when there are no arguments', () => {
    renderHeader({ input: {} })
    expect(screen.getByText(/tools:toolCall.used/)).toBeInTheDocument()
  })
})

const renderInput = (input: unknown) =>
  render(
    <Tool state="input-available" toolCallId="tc1" messageId="m1" threadId="thread-a" defaultOpen>
      <ToolContent>
        <ToolInput input={input} />
      </ToolContent>
    </Tool>
  )

describe('ToolInput', () => {
  it('renders object arguments as key/value rows', () => {
    renderInput({ path: 'src/app.ts', limit: 5 })
    expect(screen.getByText('path')).toBeInTheDocument()
    expect(screen.getByText('src/app.ts')).toBeInTheDocument()
    expect(screen.queryByTestId('code-block')).not.toBeInTheDocument()
  })

  it('toggles to raw JSON and back', () => {
    renderInput({ path: 'src/app.ts' })
    fireEvent.click(screen.getByText('tools:toolCall.viewRaw'))
    expect(screen.getByTestId('code-block')).toHaveTextContent('"path"')
    fireEvent.click(screen.getByText('tools:toolCall.viewTable'))
    expect(screen.queryByTestId('code-block')).not.toBeInTheDocument()
  })

  it('copies the pretty-printed arguments', () => {
    renderInput({ path: 'a.ts' })
    expect(screen.getByTestId('copy')).toHaveAttribute(
      'data-text',
      '{\n  "path": "a.ts"\n}'
    )
  })

  it('falls back to the raw block for non-object arguments', () => {
    renderInput('not json at all')
    expect(screen.getByTestId('code-block')).toHaveTextContent('not json at all')
    expect(screen.queryByText('tools:toolCall.viewRaw')).not.toBeInTheDocument()
  })
})

const renderOutput = (
  props: Partial<React.ComponentProps<typeof ToolOutput>> = {}
) =>
  render(
    <Tool state="output-available" toolCallId="tc1" messageId="m1" defaultOpen>
      <ToolContent>
        <ToolOutput
          output="short result"
          errorText={undefined}
          resolver={resolver}
          {...props}
        />
      </ToolContent>
    </Tool>
  )

describe('ToolOutput', () => {
  it('offers no expand control for a short payload', () => {
    renderOutput()
    expect(screen.queryByText('tools:toolCall.showMore')).not.toBeInTheDocument()
  })

  it('expands and collapses a long payload', () => {
    renderOutput({ output: 'x'.repeat(2000) })
    fireEvent.click(screen.getByText('tools:toolCall.viewRaw'))
    fireEvent.click(screen.getByText('tools:toolCall.showMore'))
    expect(screen.getByText('tools:toolCall.showLess')).toBeInTheDocument()
    fireEvent.click(screen.getByText('tools:toolCall.showLess'))
    expect(screen.getByText('tools:toolCall.showMore')).toBeInTheDocument()
  })

  // Native web search / RAG results render as citation cards, which live
  // outside the scroll box, so an expand toggle would be inert.
  it('offers no expand control for citation output', () => {
    renderOutput({
      output: {
        kind: 'web',
        query: 'q',
        results: Array.from({ length: 12 }, (_, i) => ({
          url: `https://example.com/${i}`,
          title: `Result ${i}`,
          text: 'x'.repeat(120),
        })),
      },
    })
    expect(screen.queryByText('tools:toolCall.showMore')).not.toBeInTheDocument()
  })

  it('leads with a summary and hides the raw payload', () => {
    renderOutput({
      output: { content: [{ type: 'text', text: 'first line\nrest' }] },
    })
    expect(screen.getByText('tools:toolCall.summaryText')).toBeInTheDocument()
    expect(screen.queryByTestId('code-block')).not.toBeInTheDocument()
  })

  it('reveals the raw payload on demand', () => {
    renderOutput({
      output: { content: [{ type: 'text', text: 'first line' }] },
    })
    fireEvent.click(screen.getByText('tools:toolCall.viewRaw'))
    expect(screen.getByTestId('code-block')).toBeInTheDocument()
    fireEvent.click(screen.getByText('tools:toolCall.hideRaw'))
    expect(screen.queryByTestId('code-block')).not.toBeInTheDocument()
  })

  // Expanding is meaningless while the payload is summarised away.
  it('offers expansion only once the raw payload is shown', () => {
    renderOutput({ output: 'x'.repeat(2000) })
    expect(screen.queryByText('tools:toolCall.showMore')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('tools:toolCall.viewRaw'))
    expect(screen.getByText('tools:toolCall.showMore')).toBeInTheDocument()
  })

  it('copies the error text when the call failed', () => {
    renderOutput({ output: undefined, errorText: 'boom' })
    expect(screen.getByTestId('copy')).toHaveAttribute('data-text', 'boom')
  })

  it('renders nothing without output or error', () => {
    const { container } = render(
      <Tool state="input-available" toolCallId="tc1" messageId="m1" threadId="thread-a" defaultOpen>
        <ToolContent>
          <ToolOutput
            output={undefined}
            errorText={undefined}
            resolver={resolver}
          />
        </ToolContent>
      </Tool>
    )
    expect(container).not.toHaveTextContent('tools:toolCall.result')
  })
})
