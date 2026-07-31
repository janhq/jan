import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/useToolApprovalRequests', () => ({
  useToolApprovalRequests: (selector: (s: unknown) => unknown) =>
    selector({ pending: {} }),
}))

vi.mock('streamdown', () => ({
  Streamdown: ({ children }: { children: string }) => <span>{children}</span>,
}))

vi.mock('@/components/ai-elements/tool', () => ({
  Tool: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tool">{children}</div>
  ),
  ToolContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ToolHeader: ({ title }: { title: string }) => (
    <div data-testid="tool-header">{title}</div>
  ),
  ToolInput: () => null,
  ToolOutput: () => null,
  ToolApprovalActions: () => null,
}))

import { ChainOfThoughtGroup } from '../ChainOfThoughtGroup'
import { REASONING_STEP_MAX_CHARS } from '@/lib/reasoning'
import { useToolCallRuntime } from '@/hooks/useToolCallRuntime'

beforeEach(() => {
  useToolCallRuntime.getState().reset()
})

// Long enough to have settled at least one step plus an in-progress tail.
const LONG_TEXT = `${'word '.repeat(REASONING_STEP_MAX_CHARS)}tailtoken`

const renderGroup = (
  overrides: Partial<React.ComponentProps<typeof ChainOfThoughtGroup>> = {}
) => {
  const parts = [{ type: 'reasoning', text: LONG_TEXT }]
  return render(
    <ChainOfThoughtGroup
      entries={parts.map((part, index) => ({ part, index }))}
      messageId="m1"
      totalParts={parts.length}
      isStreaming
      hasFollowingContent={false}
      awaitingApproval={false}
      citationOffsets={new Map()}
      {...overrides}
    />
  )
}

const navButton = () =>
  screen.queryByRole('button', { name: 'chat:reasoning.showFullTimeline' })
const backButton = () =>
  screen.queryByRole('button', { name: 'chat:reasoning.showCurrentStep' })

describe('ChainOfThoughtGroup view switching', () => {
  it('starts condensed with a forward affordance while streaming', () => {
    renderGroup()
    expect(navButton()).toBeInTheDocument()
    expect(backButton()).not.toBeInTheDocument()
    // Condensed shows the settled step, never the tail being written. Assert the
    // settled text is present too, so the exclusion below is meaningful rather
    // than an artefact of a collapsed panel.
    expect(screen.getByText(/^word word/)).toBeInTheDocument()
    expect(screen.queryByText(/tailtoken/)).not.toBeInTheDocument()
  })

  it('switches to the extended timeline and follows the live step', () => {
    renderGroup()
    fireEvent.click(navButton()!)
    expect(screen.getByText(/tailtoken/)).toBeInTheDocument()
    expect(backButton()).toBeInTheDocument()
  })

  it('returns to the condensed view', () => {
    renderGroup()
    fireEvent.click(navButton()!)
    fireEvent.click(backButton()!)
    expect(screen.queryByText(/tailtoken/)).not.toBeInTheDocument()
    expect(navButton()).toBeInTheDocument()
  })

  it('omits the Done marker while still streaming', () => {
    renderGroup()
    fireEvent.click(navButton()!)
    expect(screen.queryByText('chat:done')).not.toBeInTheDocument()
  })

  it('shows earlier tool calls that the condensed view truncates away', () => {
    const parts = [
      { type: 'tool-alpha', state: 'output-available', toolCallId: 'a' },
      { type: 'reasoning', text: LONG_TEXT },
    ]
    renderGroup({
      entries: parts.map((part, index) => ({ part, index })),
      totalParts: parts.length,
    })
    expect(screen.queryByTestId('tool-header')).not.toBeInTheDocument()
    fireEvent.click(navButton()!)
    expect(screen.getByTestId('tool-header')).toHaveTextContent('alpha')
  })

  // The tool card (and its live search/address bar) lives inside the
  // collapsible, so a collapsed frame hides the call entirely while it runs.
  it('expands the frame while a tool call is in flight', () => {
    const parts = [
      { type: 'reasoning', text: LONG_TEXT },
      { type: 'tool-web_search', state: 'input-streaming', toolCallId: 'tc1' },
    ]
    renderGroup({
      entries: parts.map((part, index) => ({ part, index })),
      totalParts: parts.length,
    })
    expect(screen.getByTestId('tool-header')).toHaveTextContent('web_search')
  })

  it('stays expanded once the tool result arrives', () => {
    const parts = [
      { type: 'reasoning', text: LONG_TEXT },
      {
        type: 'tool-web_search',
        state: 'output-available',
        toolCallId: 'tc1',
        output: 'ok',
      },
    ]
    renderGroup({
      entries: parts.map((part, index) => ({ part, index })),
      totalParts: parts.length,
    })
    expect(screen.getByTestId('tool-header')).toBeInTheDocument()
  })

  // Calls execute one at a time, so with several in a turn the last part is the
  // one at the back of the queue. Showing it would report "queued" while the
  // call actually doing the work is hidden.
  it('shows the running call, not the last one queued', () => {
    const parts = [
      { type: 'tool-alpha', state: 'input-available', toolCallId: 'a' },
      { type: 'tool-beta', state: 'input-available', toolCallId: 'b' },
    ]
    useToolCallRuntime.getState().enqueue(['a', 'b'])
    useToolCallRuntime.getState().markRunning('a')
    renderGroup({
      entries: parts.map((part, index) => ({ part, index })),
      totalParts: parts.length,
    })
    expect(screen.getByTestId('tool-header')).toHaveTextContent('alpha')
  })

  // Before execution starts nothing is running, so the newest part is still
  // the right thing to show as it streams in.
  it('shows the newest call while the arguments are still streaming', () => {
    const parts = [
      { type: 'tool-alpha', state: 'input-available', toolCallId: 'a' },
      { type: 'tool-beta', state: 'input-streaming', toolCallId: 'b' },
    ]
    renderGroup({
      entries: parts.map((part, index) => ({ part, index })),
      totalParts: parts.length,
    })
    expect(screen.getByTestId('tool-header')).toHaveTextContent('beta')
  })

  it('renders the completed rail with a Done marker and no view switch', () => {
    renderGroup({ isStreaming: false })
    expect(navButton()).not.toBeInTheDocument()
    expect(backButton()).not.toBeInTheDocument()
    expect(screen.getByText('chat:done')).toBeInTheDocument()
    expect(screen.getByText(/tailtoken/)).toBeInTheDocument()
  })
})
