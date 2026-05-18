import { describe, it, expect } from 'vitest'
import { stripAssistantReasoningInBody } from '../model-factory'

describe('stripAssistantReasoningInBody', () => {
  it('removes reasoning_content and reasoning from assistant messages', () => {
    const body = {
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: 'hello',
          reasoning_content: 'thinking...',
          reasoning: 'also thinking',
        },
      ],
    }
    stripAssistantReasoningInBody(body)
    expect(body.messages[1]).toEqual({ role: 'assistant', content: 'hello' })
  })

  it('leaves user / tool / system messages untouched', () => {
    const body = {
      messages: [
        { role: 'user', content: 'q', reasoning_content: 'keep' },
        { role: 'system', content: 's', reasoning: 'keep' },
        { role: 'tool', content: 't', reasoning_content: 'keep' },
      ],
    }
    stripAssistantReasoningInBody(body)
    expect(body.messages[0]).toHaveProperty('reasoning_content', 'keep')
    expect(body.messages[1]).toHaveProperty('reasoning', 'keep')
    expect(body.messages[2]).toHaveProperty('reasoning_content', 'keep')
  })

  it('is a no-op when there are no messages', () => {
    const body: Record<string, unknown> = {}
    stripAssistantReasoningInBody(body)
    expect(body).toEqual({})
  })

  it('handles assistants without reasoning fields', () => {
    const body = {
      messages: [{ role: 'assistant', content: 'ok' }],
    }
    stripAssistantReasoningInBody(body)
    expect(body.messages[0]).toEqual({ role: 'assistant', content: 'ok' })
  })
})
