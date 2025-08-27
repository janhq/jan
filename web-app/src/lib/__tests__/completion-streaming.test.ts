import { describe, it, expect } from 'vitest'
import { newAssistantThreadContent } from '../completion'

describe('Streaming Message ID Consistency', () => {
  it('should generate unique IDs when no messageId is provided', () => {
    const content1 = newAssistantThreadContent('thread-1', 'Hello')
    const content2 = newAssistantThreadContent('thread-1', 'World')
    
    expect(content1.id).toBeTruthy()
    expect(content2.id).toBeTruthy()
    expect(content1.id).not.toBe(content2.id)
  })

  it('should use provided messageId when specified', () => {
    const customId = 'custom-message-id'
    const content1 = newAssistantThreadContent('thread-1', 'Hello', {}, customId)
    const content2 = newAssistantThreadContent('thread-1', 'Hello world', {}, customId)
    
    expect(content1.id).toBe(customId)
    expect(content2.id).toBe(customId)
  })

  it('should maintain message properties correctly with custom ID', () => {
    const customId = 'streaming-message-123'
    const threadId = 'thread-456'
    const content = 'Streaming content'
    const metadata = { tool_calls: [] }
    
    const message = newAssistantThreadContent(threadId, content, metadata, customId)
    
    expect(message).toMatchObject({
      id: customId,
      thread_id: threadId,
      content: [
        {
          type: 'text',
          text: {
            value: content,
            annotations: []
          }
        }
      ],
      metadata,
      role: 'assistant',
      type: 'text',
      object: 'thread.message',
      status: 'ready',
      created_at: 0,
      completed_at: 0
    })
  })

  it('should work with empty metadata when custom ID is provided', () => {
    const customId = 'test-id'
    const message = newAssistantThreadContent('thread-1', 'Test', undefined, customId)
    
    expect(message.id).toBe(customId)
    expect(message.metadata).toEqual({})
  })

  it('should simulate streaming scenario with consistent ID', () => {
    const streamingId = 'streaming-session-id'
    const threadId = 'thread-123'
    
    // Simulate multiple streaming updates with same ID
    const updates = [
      newAssistantThreadContent(threadId, 'Hello', {}, streamingId),
      newAssistantThreadContent(threadId, 'Hello world', { tool_calls: [] }, streamingId),
      newAssistantThreadContent(threadId, 'Hello world!', { tool_calls: [], final: true }, streamingId)
    ]
    
    // All should have the same ID
    updates.forEach(update => {
      expect(update.id).toBe(streamingId)
      expect(update.thread_id).toBe(threadId)
    })
    
    // Content should be different
    expect(updates[0].content[0].text.value).toBe('Hello')
    expect(updates[1].content[0].text.value).toBe('Hello world')
    expect(updates[2].content[0].text.value).toBe('Hello world!')
  })
})