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

  /// The body is the work, and a large write takes long enough that a verb
  /// says nothing about it -- so the preview takes the throbber's place.
  it('previews a write body instead of naming the verb', () => {
    render(
      <AgentToolWidget
        bar={{
          variant: 'workspace',
          tool: 'write',
          target: 'game.html',
          body: '<!doctype html>\n<html>',
        }}
        state="input-streaming"
        toolCallId="tc1"
      />
    )
    expect(screen.queryByText('tools:toolCall.writing')).not.toBeInTheDocument()
    expect(screen.getByText('<!doctype html>')).toBeInTheDocument()
    // Numbered, so a window onto a long file says where it sits.
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  /// Before the body opens there is nothing to preview, and the verb is all
  /// there is to say.
  it('keeps the verb until the body starts arriving', () => {
    render(
      <AgentToolWidget
        bar={{ variant: 'workspace', tool: 'write', target: 'game.html' }}
        state="input-streaming"
        toolCallId="tc1"
      />
    )
    expect(screen.getByText('tools:toolCall.writing')).toBeInTheDocument()
  })

  it('prompts for a pattern rather than a path on grep', () => {
    renderRunning('grep')
    expect(
      screen.getByText('tools:toolCall.patternPlaceholder')
    ).toBeInTheDocument()
  })
})
