import { describe, it, expect } from 'vitest'
import { hasContent } from '@/lib/codeHistory'
import type { CodeMessage } from '@/hooks/useCodeSessions'

// Regression coverage for a silent, total submit failure.
//
// The agent core represents a tool-call turn as
// `{ role: 'assistant', content: null, tool_calls: [...] }` — legal OpenAI
// protocol — and streams it to the front-end via `messages_updated`. Persisting
// that verbatim left assistant entries with `content: null` in session history,
// because `CodeMessage` cannot model `tool_calls`. On the *next* submit,
// `capHistory` evaluated `messages[i].content.length`, which threw inside an
// async function: an unhandled rejection with no toast, no console error, and no
// log. The user pressed Enter and absolutely nothing happened, for every message
// after the agent's first tool call.
describe('hasContent (history sanitation)', () => {
  it('rejects the core tool-call turn that has no usable content', () => {
    // The exact shape observed in a real persisted session.
    const toolCallTurn = { role: 'assistant', content: null } as unknown as CodeMessage
    expect(hasContent(toolCallTurn)).toBe(false)
  })

  it('rejects undefined and empty content', () => {
    expect(hasContent({ role: 'assistant' } as unknown as CodeMessage)).toBe(false)
    expect(hasContent({ role: 'user', content: '' })).toBe(false)
    expect(hasContent({ role: 'user', content: '   \n ' })).toBe(false)
    expect(hasContent({ role: 'user', content: [] })).toBe(false)
  })

  it('keeps real text and multimodal content', () => {
    expect(hasContent({ role: 'user', content: 'hi' })).toBe(true)
    expect(
      hasContent({ role: 'user', content: [{ type: 'text', text: 'hi' }] })
    ).toBe(true)
    expect(
      hasContent({
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'data:,' } }],
      })
    ).toBe(true)
  })

  it('filtering a poisoned history leaves only replayable turns', () => {
    // Mirrors the failing session: 'hi', then tool-call turns with null content.
    const history = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: null },
      { role: 'assistant', content: 'done' },
      { role: 'assistant', content: null },
    ] as unknown as CodeMessage[]
    expect(history.filter(hasContent)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'done' },
    ])
  })
})
