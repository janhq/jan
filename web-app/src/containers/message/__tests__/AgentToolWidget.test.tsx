import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'

vi.mock('@/i18n/react-i18next-compat', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/hooks/useToolCallRuntime', () => ({
  useToolCallRuntime: (selector: (s: unknown) => unknown) =>
    selector({ diffs: {} }),
}))

import { AgentToolWidget } from '../AgentToolWidget'

const renderRunning = (tool: string, target = '') =>
  render(
    <AgentToolWidget
      bar={{ variant: 'workspace', tool, target }}
      state="input-available"
      toolCallId="tc1"
    />
  )

describe('AgentToolWidget', () => {
  // A workspace call is not always a read; the verb is the only progress
  // signal the widget has while the call runs.
  it.each([
    ['write', 'tools:toolCall.writing'],
    ['edit', 'tools:toolCall.editing'],
    ['grep', 'tools:toolCall.searching'],
    ['ls', 'tools:toolCall.listing'],
    ['read', 'tools:toolCall.reading'],
  ])('names what %s is doing while it runs', (tool, key) => {
    renderRunning(tool, tool === 'ls' ? '' : 'a.txt')
    expect(screen.getByText(key)).toBeInTheDocument()
  })

  it('prompts for a pattern rather than a path on grep', () => {
    renderRunning('grep')
    expect(
      screen.getByText('tools:toolCall.patternPlaceholder')
    ).toBeInTheDocument()
  })
})
