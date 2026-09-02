import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { SubagentToolWidget } from '../SubagentToolWidget'

const bar = {
  variant: 'subagent' as const,
  name: 'researcher',
  task: 'Research MCP servers for physical hardware',
}

describe('SubagentToolWidget', () => {
  it('names the subagent and its brief while the call streams', () => {
    render(<SubagentToolWidget bar={bar} state="input-streaming" />)
    expect(screen.getByText('researcher')).toBeInTheDocument()
    expect(screen.getByText(bar.task)).toBeInTheDocument()
    expect(screen.getByText('tools:toolCall.dispatching')).toBeInTheDocument()
  })

  it('prompts for the subagent before the name arrives', () => {
    render(
      <SubagentToolWidget
        bar={{ variant: 'subagent', name: '', task: '' }}
        state="input-streaming"
      />
    )
    expect(
      screen.getByText('tools:toolCall.subagentPlaceholder')
    ).toBeInTheDocument()
  })

  /// `task` returns as soon as the child starts, so a settled card means
  /// "dispatched", not "finished" -- the tasks panel is what follows the run.
  it('reads as running once the call settles', () => {
    render(<SubagentToolWidget bar={bar} state="output-available" />)
    expect(
      screen.getByText('tools:toolCall.subagentRunning')
    ).toBeInTheDocument()
  })

  /// A rejected dispatch is the one thing on this card the user may need to
  /// act on, so it is not left folded away in the raw output.
  it('shows a refused dispatch', () => {
    render(
      <SubagentToolWidget
        bar={bar}
        state="output-error"
        errorText="unknown subagent 'researcher': no saved definition"
      />
    )
    expect(screen.getByText(/no saved definition/)).toBeInTheDocument()
    expect(
      screen.queryByText('tools:toolCall.subagentRunning')
    ).not.toBeInTheDocument()
  })
})
