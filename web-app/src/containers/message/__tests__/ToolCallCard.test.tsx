import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.tool ? `${key}:${options.tool}` : key,
  }),
}))

vi.mock('@/hooks/useToolApprovalRequests', () => ({
  useToolApprovalRequests: (selector: (s: unknown) => unknown) =>
    selector({ pending: {} }),
}))

const origin = vi.fn()
vi.mock('@/hooks/useToolOrigin', () => ({
  useToolOrigin: () => origin(),
}))

vi.mock('../WebToolWidget', () => ({
  WebToolWidget: ({ bar }: { bar: { query?: string } }) => (
    <div data-testid="web-widget">{bar.query}</div>
  ),
}))

vi.mock('../RagToolWidget', () => ({
  RagToolWidget: () => <div data-testid="rag-widget" />,
}))

import { ToolCallCard } from '../ToolCallCard'

describe('ToolCallCard', () => {
  // The widget already shows the query in its search bar, so repeating it in
  // the header renders the same text twice, one line apart.
  it('leaves the argument preview to the widget when one renders', () => {
    origin.mockReturnValue({ kind: 'web-search', detail: 'Exa' })
    render(
      <ToolCallCard
        part={{
          type: 'tool-web_search',
          state: 'output-error',
          toolCallId: 'tc1',
          input: { query: 'deepfake prevention news' },
          errorText: 'rate limited',
        }}
        messageId="m1"
      />
    )
    expect(screen.getByTestId('web-widget')).toHaveTextContent(
      'deepfake prevention news'
    )
    expect(
      screen.queryByText('query: deepfake prevention news')
    ).not.toBeInTheDocument()
  })

  // Without a widget the header preview is the only thing describing the call
  // while it is collapsed.
  it('previews the arguments in the header for a tool with no widget', () => {
    origin.mockReturnValue({ kind: 'mcp', detail: 'github' })
    render(
      <ToolCallCard
        part={{
          type: 'tool-create_issue',
          state: 'output-available',
          toolCallId: 'tc2',
          input: { title: 'Bug' },
          output: 'done',
        }}
        messageId="m1"
      />
    )
    expect(screen.getByText('title: Bug')).toBeInTheDocument()
  })

  /// The launch is over the moment the call settles, and the tasks panel follows
  /// the run from there -- so the card collapses to its header rather than
  /// parking a frozen account of a run it stopped watching.
  it('shows a task widget only while the dispatch is in flight', () => {
    origin.mockReturnValue({ kind: 'subagent' })
    const part = {
      type: 'tool-task',
      toolCallId: 'tc1',
      input: { subagent_name: 'researcher', description: 'Research MCP' },
    }
    const { rerender } = render(
      <ToolCallCard
        part={{ ...part, state: 'input-streaming' }}
        messageId="m1"
      />
    )
    expect(screen.getByText('researcher')).toBeInTheDocument()

    rerender(
      <ToolCallCard
        part={{ ...part, state: 'output-available', output: 'started' }}
        messageId="m1"
      />
    )
    expect(screen.queryByText('Research MCP')).not.toBeInTheDocument()
    // The subagent stays named on the header, so a fan-out does not collapse
    // into three identical rows.
    expect(
      screen.getByText('tools:toolCall.used:task: researcher')
    ).toBeInTheDocument()
  })
})
