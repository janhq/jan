import { describe, it, expect } from 'vitest'

import { foldSystemIntoFirstUserMessage } from '../custom-chat-transport'

const SYS = 'Always reply in Ukrainian.'

describe('foldSystemIntoFirstUserMessage', () => {
  it('prepends the system prompt to a string-content user message', () => {
    const messages = [
      { role: 'assistant', content: 'earlier' },
      { role: 'user', content: 'hello' },
    ]
    const out = foldSystemIntoFirstUserMessage(messages, SYS)

    expect(out[1].content).toBe(`${SYS}\n\nhello`)
    // Earlier (non-user) message untouched.
    expect(out[0].content).toBe('earlier')
    // Original array not mutated.
    expect(messages[1].content).toBe('hello')
  })

  it('prepends a text part to an array-content user message', () => {
    const messages = [
      {
        role: 'user',
        content: [{ type: 'image', image: 'data:...' }],
      },
    ]
    const out = foldSystemIntoFirstUserMessage(messages, SYS)

    const content = out[0].content as Array<Record<string, unknown>>
    expect(content).toHaveLength(2)
    expect(content[0]).toEqual({ type: 'text', text: `${SYS}\n\n` })
    expect(content[1]).toEqual({ type: 'image', image: 'data:...' })
  })

  it('targets the FIRST user message only', () => {
    const messages = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ]
    const out = foldSystemIntoFirstUserMessage(messages, SYS)

    expect(out[0].content).toBe(`${SYS}\n\nfirst`)
    expect(out[2].content).toBe('second')
  })

  it('inserts a user message when none exists', () => {
    const messages = [{ role: 'assistant', content: 'hi' }]
    const out = foldSystemIntoFirstUserMessage(messages, SYS)

    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ role: 'user', content: SYS })
    expect(out[1].role).toBe('assistant')
  })
})
