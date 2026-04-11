import { describe, it, expect, beforeEach } from 'vitest'
import { useMessageQueue } from '../message-queue-store'

function resetStore() {
  useMessageQueue.setState({ queues: {} })
}

function makeMessage(id: string, text: string) {
  return { id, text, createdAt: Date.now() }
}

describe('useMessageQueue', () => {
  beforeEach(() => {
    resetStore()
  })

  describe('enqueue', () => {
    it('adds a message to an empty queue', () => {
      const { enqueue, getQueue } = useMessageQueue.getState()
      enqueue('thread-1', makeMessage('m1', 'hello'))

      expect(getQueue('thread-1')).toHaveLength(1)
      expect(getQueue('thread-1')[0].text).toBe('hello')
    })

    it('appends messages in FIFO order', () => {
      const { enqueue, getQueue } = useMessageQueue.getState()
      enqueue('thread-1', makeMessage('m1', 'first'))
      enqueue('thread-1', makeMessage('m2', 'second'))
      enqueue('thread-1', makeMessage('m3', 'third'))

      const queue = getQueue('thread-1')
      expect(queue).toHaveLength(3)
      expect(queue.map((m) => m.text)).toEqual(['first', 'second', 'third'])
    })

    it('keeps queues isolated per thread', () => {
      const { enqueue, getQueue } = useMessageQueue.getState()
      enqueue('thread-1', makeMessage('m1', 'for thread 1'))
      enqueue('thread-2', makeMessage('m2', 'for thread 2'))

      expect(getQueue('thread-1')).toHaveLength(1)
      expect(getQueue('thread-2')).toHaveLength(1)
      expect(getQueue('thread-1')[0].text).toBe('for thread 1')
      expect(getQueue('thread-2')[0].text).toBe('for thread 2')
    })
  })

  describe('dequeue', () => {
    it('removes and returns the first message', () => {
      const { enqueue, dequeue, getQueue } = useMessageQueue.getState()
      enqueue('thread-1', makeMessage('m1', 'first'))
      enqueue('thread-1', makeMessage('m2', 'second'))

      const msg = dequeue('thread-1')
      expect(msg?.text).toBe('first')
      expect(getQueue('thread-1')).toHaveLength(1)
      expect(getQueue('thread-1')[0].text).toBe('second')
    })

    it('returns undefined when the queue is empty', () => {
      const { dequeue } = useMessageQueue.getState()
      expect(dequeue('thread-1')).toBeUndefined()
    })

    it('returns undefined for a non-existent thread', () => {
      const { dequeue } = useMessageQueue.getState()
      expect(dequeue('non-existent')).toBeUndefined()
    })
  })

  describe('removeMessage', () => {
    it('removes a specific message by id', () => {
      const { enqueue, removeMessage, getQueue } = useMessageQueue.getState()
      enqueue('thread-1', makeMessage('m1', 'first'))
      enqueue('thread-1', makeMessage('m2', 'second'))
      enqueue('thread-1', makeMessage('m3', 'third'))

      removeMessage('thread-1', 'm2')
      const queue = getQueue('thread-1')
      expect(queue).toHaveLength(2)
      expect(queue.map((m) => m.text)).toEqual(['first', 'third'])
    })

    it('is a no-op if the message id does not exist', () => {
      const { enqueue, removeMessage, getQueue } = useMessageQueue.getState()
      enqueue('thread-1', makeMessage('m1', 'first'))

      removeMessage('thread-1', 'non-existent')
      expect(getQueue('thread-1')).toHaveLength(1)
    })

    it('is a no-op for a non-existent thread', () => {
      const { removeMessage } = useMessageQueue.getState()
      removeMessage('non-existent', 'm1')
      // Should not throw
    })
  })

  describe('clearQueue', () => {
    it('removes all messages for a thread', () => {
      const { enqueue, clearQueue, getQueue } = useMessageQueue.getState()
      enqueue('thread-1', makeMessage('m1', 'a'))
      enqueue('thread-1', makeMessage('m2', 'b'))
      enqueue('thread-1', makeMessage('m3', 'c'))

      clearQueue('thread-1')
      expect(getQueue('thread-1')).toHaveLength(0)
    })

    it('does not affect other threads', () => {
      const { enqueue, clearQueue, getQueue } = useMessageQueue.getState()
      enqueue('thread-1', makeMessage('m1', 'a'))
      enqueue('thread-2', makeMessage('m2', 'b'))

      clearQueue('thread-1')
      expect(getQueue('thread-1')).toHaveLength(0)
      expect(getQueue('thread-2')).toHaveLength(1)
    })

    it('is a no-op for an empty or non-existent queue', () => {
      const { clearQueue, getQueue } = useMessageQueue.getState()
      // Should not throw
      clearQueue('non-existent')
      expect(getQueue('non-existent')).toHaveLength(0)
    })
  })

  describe('getQueue', () => {
    it('returns an empty array for unknown threads', () => {
      const { getQueue } = useMessageQueue.getState()
      expect(getQueue('unknown')).toEqual([])
    })

    it('returns the same reference for empty queues (avoids re-renders)', () => {
      const { getQueue } = useMessageQueue.getState()
      const a = getQueue('unknown-1')
      const b = getQueue('unknown-2')
      expect(a).toBe(b)
    })
  })

  describe('sequential dequeue (simulates auto-processing)', () => {
    it('processes messages one at a time in order', () => {
      const { enqueue, dequeue } = useMessageQueue.getState()
      enqueue('thread-1', makeMessage('m1', 'first'))
      enqueue('thread-1', makeMessage('m2', 'second'))
      enqueue('thread-1', makeMessage('m3', 'third'))

      const results: string[] = []
      let msg = dequeue('thread-1')
      while (msg) {
        results.push(msg.text)
        msg = dequeue('thread-1')
      }

      expect(results).toEqual(['first', 'second', 'third'])
    })
  })
})
