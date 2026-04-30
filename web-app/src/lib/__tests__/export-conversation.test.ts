import { describe, it, expect } from 'vitest'
import {
  buildMarkdown,
  buildJson,
  toSafeFilename,
  cleanThreadTitle,
} from '../export-conversation'
import { ContentType, MessageStatus, type ThreadMessage } from '@janhq/core'

function makeMessage(
  role: 'user' | 'assistant',
  content: ThreadMessage['content']
): ThreadMessage {
  return {
    id: 'msg-1',
    object: 'thread.message',
    thread_id: 'thread-1',
    role,
    content,
    status: MessageStatus.Ready,
    created_at: 1700000000000,
    completed_at: 1700000000000,
  }
}

function textContent(value: string): ThreadMessage['content'][0] {
  return { type: ContentType.Text, text: { value, annotations: [] } }
}

function reasoningContent(value: string): ThreadMessage['content'][0] {
  return { type: ContentType.Reasoning, text: { value, annotations: [] } }
}

describe('cleanThreadTitle', () => {
  it('strips HTML and falls back for empty input', () => {
    expect(cleanThreadTitle('<span>Hello</span> World')).toBe('Hello World')
    expect(cleanThreadTitle(undefined)).toBe('Conversation')
    expect(cleanThreadTitle('')).toBe('Conversation')
  })
})

describe('toSafeFilename', () => {
  it('strips trailing dots and falls back for unsanitizable input', () => {
    expect(toSafeFilename('foo...')).toBe('foo')
    expect(toSafeFilename('...')).toBe('conversation')
    expect(toSafeFilename('')).toBe('conversation')
  })

  it('preserves Unicode characters', () => {
    expect(toSafeFilename('日本語のチャット')).toBe('日本語のチャット')
  })
})

describe('buildMarkdown', () => {
  it('shows reasoning as plain text when message has no other text content', () => {
    const messages = [makeMessage('assistant', [reasoningContent('deep thought')])]
    const md = buildMarkdown({ threadTitle: 'Test', messages, format: 'markdown' })

    expect(md).toContain('deep thought')
    expect(md).not.toContain('<details>')
  })

  it('collapses reasoning when message also has text content', () => {
    const messages = [
      makeMessage('assistant', [
        reasoningContent('thinking...'),
        textContent('The answer is 42'),
      ]),
    ]
    const md = buildMarkdown({ threadTitle: 'Test', messages, format: 'markdown' })

    expect(md).toContain('<details>')
    expect(md).toContain('thinking...')
    expect(md).toContain('The answer is 42')
  })

  it('handles old-format <think> tags with body text', () => {
    const messages = [
      makeMessage('assistant', [textContent('<think>reasoning here</think>The actual answer')]),
    ]
    const md = buildMarkdown({ threadTitle: 'Test', messages, format: 'markdown' })

    expect(md).toContain('<details>')
    expect(md).toContain('reasoning here')
    expect(md).toContain('The actual answer')
  })

  it('handles old-format <think> tags without body text', () => {
    const messages = [
      makeMessage('assistant', [textContent('<think>only reasoning</think>')]),
    ]
    const md = buildMarkdown({ threadTitle: 'Test', messages, format: 'markdown' })

    expect(md).toContain('only reasoning')
    expect(md).not.toContain('<details>')
  })
})

describe('buildJson', () => {
  it('produces valid JSON with correct structure', () => {
    const messages = [makeMessage('user', [textContent('Hello')])]
    const parsed = JSON.parse(buildJson({ threadTitle: 'Test', messages, format: 'json' }))

    expect(parsed.title).toBe('Test')
    expect(parsed.exported_at).toBeDefined()
    expect(parsed.messages).toHaveLength(1)
    expect(parsed.messages[0].role).toBe('user')
  })
})
