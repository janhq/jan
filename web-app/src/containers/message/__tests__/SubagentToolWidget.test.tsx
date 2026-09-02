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
    render(<SubagentToolWidget bar={bar} />)
    expect(screen.getByText('researcher')).toBeInTheDocument()
    expect(screen.getByText(bar.task)).toBeInTheDocument()
    expect(screen.getByText('tools:toolCall.dispatching')).toBeInTheDocument()
  })

  it('prompts for the subagent before the name arrives', () => {
    render(<SubagentToolWidget bar={{ variant: 'subagent', name: '', task: '' }} />)
    expect(
      screen.getByText('tools:toolCall.subagentPlaceholder')
    ).toBeInTheDocument()
  })
})
