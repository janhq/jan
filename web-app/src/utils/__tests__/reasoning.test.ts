import { describe, it, expect, beforeEach } from 'vitest'
import {
  ReasoningProcessor,
  extractReasoningFromMessage,
} from '../reasoning'
import { CompletionResponseChunk } from 'token.js'
import { chatCompletionChunk, chatCompletionRequestMessage } from '@janhq/core'

describe('extractReasoningFromMessage', () => {
  it('should extract reasoning from message with reasoning_content property', () => {
    const message = {
      role: 'assistant' as const,
      content: 'Hello',
      reasoning_content: 'This is my reasoning content',
    }

    const result = extractReasoningFromMessage(message)
    expect(result).toBe('This is my reasoning content')
  })

  it('should extract reasoning from message with legacy reasoning property', () => {
    const message = {
      role: 'assistant' as const,
      content: 'Hello',
      reasoning: 'This is my reasoning',
    }

    const result = extractReasoningFromMessage(message)
    expect(result).toBe('This is my reasoning')
  })

  it('should prefer reasoning_content over reasoning property', () => {
    const message = {
      role: 'assistant' as const,
      content: 'Hello',
      reasoning_content: 'New reasoning content',
      reasoning: 'Old reasoning',
    }

    const result = extractReasoningFromMessage(message)
    expect(result).toBe('New reasoning content')
  })

  it('should return null for message without reasoning', () => {
    const message = {
      role: 'assistant' as const,
      content: 'Hello',
    }

    const result = extractReasoningFromMessage(message)
    expect(result).toBeNull()
  })

  it('should return null for null/undefined message', () => {
    expect(extractReasoningFromMessage(null as any)).toBeNull()
    expect(extractReasoningFromMessage(undefined as any)).toBeNull()
  })
})

describe('ReasoningProcessor', () => {
  let processor: ReasoningProcessor

  beforeEach(() => {
    processor = new ReasoningProcessor()
  })

  describe('processReasoningChunk', () => {
    it('should start reasoning with opening think tag using reasoning_content', () => {
      const chunk: chatCompletionChunk = {
        choices: [{
          delta: {
            reasoning_content: 'Let me think about this...',
          },
        }],
      }

      const result = processor.processReasoningChunk(chunk)
      expect(result).toBe('<think>Let me think about this...')
      expect(processor.isReasoningInProgress()).toBe(true)
    })

    it('should start reasoning with opening think tag using legacy reasoning', () => {
      const chunk: chatCompletionChunk = {
        choices: [{
          delta: {
            reasoning: 'Let me think about this...',
          },
        }],
      }

      const result = processor.processReasoningChunk(chunk)
      expect(result).toBe('<think>Let me think about this...')
      expect(processor.isReasoningInProgress()).toBe(true)
    })

    it('should continue reasoning without opening tag', () => {
      // Start reasoning
      const chunk1: chatCompletionChunk = {
        choices: [{
          delta: {
            reasoning_content: 'First part',
          },
        }],
      }
      processor.processReasoningChunk(chunk1)

      // Continue reasoning
      const chunk2: chatCompletionChunk = {
        choices: [{
          delta: {
            reasoning_content: ' second part',
          },
        }],
      }

      const result = processor.processReasoningChunk(chunk2)
      expect(result).toBe(' second part')
      expect(processor.isReasoningInProgress()).toBe(true)
    })

    it('should end reasoning when content starts', () => {
      // Start reasoning
      const chunk1: chatCompletionChunk = {
        choices: [{
          delta: {
            reasoning_content: 'Thinking...',
          },
        }],
      }
      processor.processReasoningChunk(chunk1)

      // End reasoning with content
      const chunk2: chatCompletionChunk = {
        choices: [{
          delta: {
            content: 'Now I respond',
          },
        }],
      }

      const result = processor.processReasoningChunk(chunk2)
      expect(result).toBe('</think>')
      expect(processor.isReasoningInProgress()).toBe(false)
    })

    it('should handle empty reasoning chunks', () => {
      const chunk: chatCompletionChunk = {
        choices: [{
          delta: {
            reasoning_content: '',
          },
        }],
      }

      const result = processor.processReasoningChunk(chunk)
      expect(result).toBe('')
      expect(processor.isReasoningInProgress()).toBe(false)
    })

    it('should handle whitespace-only reasoning', () => {
      const chunk: chatCompletionChunk = {
        choices: [{
          delta: {
            reasoning_content: '   \n  ',
          },
        }],
      }

      const result = processor.processReasoningChunk(chunk)
      expect(result).toBe('')
      expect(processor.isReasoningInProgress()).toBe(false)
    })

    it('should handle non-string reasoning', () => {
      const chunk: chatCompletionChunk = {
        choices: [{
          delta: {
            reasoning_content: null as any,
          },
        }],
      }

      const result = processor.processReasoningChunk(chunk)
      expect(result).toBe('')
      expect(processor.isReasoningInProgress()).toBe(false)
    })

    it('should handle chunk without choices', () => {
      const chunk: chatCompletionChunk = {
        choices: undefined as any,
      }

      const result = processor.processReasoningChunk(chunk)
      expect(result).toBe('')
      expect(processor.isReasoningInProgress()).toBe(false)
    })

    it('should handle chunk without delta', () => {
      const chunk: chatCompletionChunk = {
        choices: [{
          delta: undefined as any,
        }],
      }

      const result = processor.processReasoningChunk(chunk)
      expect(result).toBe('')
      expect(processor.isReasoningInProgress()).toBe(false)
    })

    it('should handle content without active reasoning', () => {
      const chunk: chatCompletionChunk = {
        choices: [{
          delta: {
            content: 'Regular content',
          },
        }],
      }

      const result = processor.processReasoningChunk(chunk)
      expect(result).toBe('')
      expect(processor.isReasoningInProgress()).toBe(false)
    })
  })

  describe('finalize', () => {
    it('should close reasoning if still active', () => {
      // Start reasoning
      const chunk: chatCompletionChunk = {
        choices: [{
          delta: {
            reasoning_content: 'Unfinished thinking',
          },
        }],
      }
      processor.processReasoningChunk(chunk)

      const result = processor.finalize()
      expect(result).toBe('</think>')
      expect(processor.isReasoningInProgress()).toBe(false)
    })

    it('should return empty string if no active reasoning', () => {
      const result = processor.finalize()
      expect(result).toBe('')
      expect(processor.isReasoningInProgress()).toBe(false)
    })

    it('should handle multiple finalize calls', () => {
      // Start reasoning
      const chunk: chatCompletionChunk = {
        choices: [{
          delta: {
            reasoning_content: 'Thinking',
          },
        }],
      }
      processor.processReasoningChunk(chunk)

      // First finalize
      const result1 = processor.finalize()
      expect(result1).toBe('</think>')

      // Second finalize should return empty
      const result2 = processor.finalize()
      expect(result2).toBe('')
    })
  })

  describe('isReasoningInProgress', () => {
    it('should track reasoning state correctly', () => {
      expect(processor.isReasoningInProgress()).toBe(false)

      // Start reasoning
      const chunk1: chatCompletionChunk = {
        choices: [{
          delta: {
            reasoning_content: 'Start thinking',
          },
        }],
      }
      processor.processReasoningChunk(chunk1)
      expect(processor.isReasoningInProgress()).toBe(true)

      // End with content
      const chunk2: chatCompletionChunk = {
        choices: [{
          delta: {
            content: 'Response',
          },
        }],
      }
      processor.processReasoningChunk(chunk2)
      expect(processor.isReasoningInProgress()).toBe(false)
    })
  })

  describe('integration scenarios', () => {
    it('should handle complete reasoning flow', () => {
      const chunks: chatCompletionChunk[] = [
        {
          choices: [{
            delta: { reasoning_content: 'Let me think' },
          }],
        },
        {
          choices: [{
            delta: { reasoning_content: ' about this problem' },
          }],
        },
        {
          choices: [{
            delta: { reasoning_content: ' step by step.' },
          }],
        },
        {
          choices: [{
            delta: { content: 'Based on my analysis,' },
          }],
        },
        {
          choices: [{
            delta: { content: ' the answer is 42.' },
          }],
        },
      ]

      const results = chunks.map(chunk => processor.processReasoningChunk(chunk))

      expect(results[0]).toBe('<think>Let me think')
      expect(results[1]).toBe(' about this problem')
      expect(results[2]).toBe(' step by step.')
      expect(results[3]).toBe('</think>')
      expect(results[4]).toBe('')

      expect(processor.isReasoningInProgress()).toBe(false)
    })

    it('should handle reasoning without content', () => {
      const chunk: chatCompletionChunk = {
        choices: [{
          delta: { reasoning_content: 'Only reasoning, no content' },
        }],
      }

      const result1 = processor.processReasoningChunk(chunk)
      expect(result1).toBe('<think>Only reasoning, no content')

      const result2 = processor.finalize()
      expect(result2).toBe('</think>')
    })

    it('should handle mixed reasoning and content chunks', () => {
      // Reasoning then content then reasoning again (edge case)
      const chunk1: chatCompletionChunk = {
        choices: [{
          delta: { reasoning_content: 'First thought' },
        }],
      }

      const chunk2: chatCompletionChunk = {
        choices: [{
          delta: { content: 'Some content' },
        }],
      }

      const chunk3: chatCompletionChunk = {
        choices: [{
          delta: { reasoning_content: 'Second thought' },
        }],
      }

      const result1 = processor.processReasoningChunk(chunk1)
      const result2 = processor.processReasoningChunk(chunk2)
      const result3 = processor.processReasoningChunk(chunk3)

      expect(result1).toBe('<think>First thought')
      expect(result2).toBe('</think>')
      expect(result3).toBe('<think>Second thought')
    })
  })
})
