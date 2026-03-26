import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UIMessage } from '@ai-sdk/react'
import {
  estimateTokens,
  estimateMessageTokens,
  trimMessages,
  compactMessages,
  type ContextManagerConfig,
} from '../context-manager'

function makeMessage(
  id: string,
  role: 'user' | 'assistant',
  text: string
): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text' as const, text }],
    createdAt: new Date(),
  }
}

describe('estimateTokens', () => {
  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('should estimate tokens based on character count', () => {
    // 35 chars / 3.5 chars per token = 10 tokens
    const text = 'Hello, this is a test of the token.'
    const result = estimateTokens(text)
    expect(result).toBe(Math.ceil(text.length / 3.5))
  })

  it('should handle short text', () => {
    expect(estimateTokens('Hi')).toBeGreaterThan(0)
  })
})

describe('estimateMessageTokens', () => {
  it('should estimate tokens for a simple text message', () => {
    const msg = makeMessage('1', 'user', 'Hello world')
    const tokens = estimateMessageTokens(msg)
    // text tokens + 4 overhead
    expect(tokens).toBe(estimateTokens('Hello world') + 4)
  })

  it('should include inline file contents in token count', () => {
    const msg: UIMessage = {
      id: '1',
      role: 'user',
      parts: [{ type: 'text' as const, text: 'Check this file' }],
      createdAt: new Date(),
      metadata: {
        inline_file_contents: [
          { name: 'readme.md', content: 'This is a long file content string' },
        ],
      },
    } as unknown as UIMessage
    const tokens = estimateMessageTokens(msg)
    expect(tokens).toBeGreaterThan(estimateTokens('Check this file') + 4)
  })

  it('should handle messages with no text parts', () => {
    const msg: UIMessage = {
      id: '1',
      role: 'assistant',
      parts: [],
      createdAt: new Date(),
    }
    const tokens = estimateMessageTokens(msg)
    expect(tokens).toBe(4) // just overhead
  })
})

describe('trimMessages', () => {
  const defaultConfig: ContextManagerConfig = {
    maxContextTokens: 200,
    maxOutputTokens: 50,
    autoCompact: false,
  }

  it('should return all messages when they fit within budget', () => {
    const messages = [
      makeMessage('1', 'user', 'Hi'),
      makeMessage('2', 'assistant', 'Hello'),
    ]
    const result = trimMessages(messages, defaultConfig)
    expect(result.trimmedCount).toBe(0)
    expect(result.messages).toHaveLength(2)
  })

  it('should not trim when maxContextTokens is 0 (disabled)', () => {
    const messages = Array.from({ length: 100 }, (_, i) =>
      makeMessage(
        String(i),
        i % 2 === 0 ? 'user' : 'assistant',
        'A'.repeat(500)
      )
    )
    const result = trimMessages(messages, {
      maxContextTokens: 0,
      maxOutputTokens: 50,
      autoCompact: false,
    })
    expect(result.trimmedCount).toBe(0)
    expect(result.messages).toHaveLength(100)
  })

  it('should trim oldest messages when conversation exceeds budget', () => {
    // Each message: ~143 tokens text + 4 overhead = ~147 tokens
    // Budget: 200 - 50 = 150 input tokens → only 1 message fits
    const messages = [
      makeMessage('1', 'user', 'A'.repeat(500)),
      makeMessage('2', 'assistant', 'B'.repeat(500)),
      makeMessage('3', 'user', 'C'.repeat(500)),
    ]
    const result = trimMessages(messages, defaultConfig)
    expect(result.trimmedCount).toBeGreaterThan(0)
    // Most recent message should always be kept
    expect(result.messages[result.messages.length - 1].id).toBe('3')
  })

  it('should keep at least the last message even if it exceeds budget', () => {
    const messages = [
      makeMessage('1', 'user', 'A'.repeat(5000)),
    ]
    const result = trimMessages(messages, {
      maxContextTokens: 100,
      maxOutputTokens: 50,
      autoCompact: false,
    })
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].id).toBe('1')
  })

  it('should account for system prompt tokens', () => {
    const messages = [
      makeMessage('1', 'user', 'Hello'),
      makeMessage('2', 'assistant', 'Hi there'),
    ]
    // With large system prompt, even small messages may not fit
    const result = trimMessages(messages, {
      maxContextTokens: 200,
      maxOutputTokens: 50,
      autoCompact: false,
    }, 180) // leaves only 200-50-180 = negative → only last message
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].id).toBe('2')
  })

  it('should preserve message order', () => {
    const messages = [
      makeMessage('1', 'user', 'First'),
      makeMessage('2', 'assistant', 'Second'),
      makeMessage('3', 'user', 'Third'),
      makeMessage('4', 'assistant', 'Fourth'),
    ]
    const result = trimMessages(messages, {
      maxContextTokens: 500,
      maxOutputTokens: 50,
      autoCompact: false,
    })
    const ids = result.messages.map((m) => m.id)
    for (let i = 1; i < ids.length; i++) {
      expect(Number(ids[i])).toBeGreaterThan(Number(ids[i - 1]))
    }
  })
})

describe('compactMessages', () => {
  const config: ContextManagerConfig = {
    maxContextTokens: 200,
    maxOutputTokens: 50,
    autoCompact: true,
  }

  const mockModel = {
    modelId: 'test-model',
    provider: 'test',
    specificationVersion: 'v1',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should pass through when no trimming needed', async () => {
    const messages = [
      makeMessage('1', 'user', 'Hi'),
      makeMessage('2', 'assistant', 'Hello'),
    ]
    const result = await compactMessages(
      messages,
      config,
      mockModel as any
    )
    expect(result.trimmedCount).toBe(0)
    expect(result.messages).toHaveLength(2)
  })

  it('should pass through when maxContextTokens is 0', async () => {
    const messages = Array.from({ length: 50 }, (_, i) =>
      makeMessage(String(i), i % 2 === 0 ? 'user' : 'assistant', 'A'.repeat(500))
    )
    const result = await compactMessages(
      messages,
      { maxContextTokens: 0, maxOutputTokens: 50, autoCompact: true },
      mockModel as any
    )
    expect(result.trimmedCount).toBe(0)
    expect(result.messages).toHaveLength(50)
  })

  it('should fall back to trim when summarization fails', async () => {
    // Use messages that exceed context
    const messages = [
      makeMessage('1', 'user', 'A'.repeat(500)),
      makeMessage('2', 'assistant', 'B'.repeat(500)),
      makeMessage('3', 'user', 'C'.repeat(100)),
    ]

    // The mock model doesn't implement the real interface, so generateText
    // will throw. compactMessages should catch and fall back to trimMessages.
    const result = await compactMessages(
      messages,
      config,
      mockModel as any
    )

    expect(result.trimmedCount).toBeGreaterThan(0)
    // Should still return valid messages (fallback to trim)
    expect(result.messages.length).toBeGreaterThan(0)
    // No summary generated on fallback
    expect(result.compactedSummary).toBeUndefined()
  })
})
