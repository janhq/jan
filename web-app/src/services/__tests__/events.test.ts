import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from '../events'

describe('EventEmitter', () => {
  let eventEmitter: EventEmitter

  beforeEach(() => {
    eventEmitter = new EventEmitter()
  })

  describe('constructor', () => {
    it('should create an instance with empty handlers map', () => {
      expect(eventEmitter).toBeInstanceOf(EventEmitter)
      expect(eventEmitter['handlers']).toBeInstanceOf(Map)
      expect(eventEmitter['handlers'].size).toBe(0)
    })
  })

  describe('on method', () => {
    it('should register a handler for a new event', () => {
      const handler = vi.fn()
      
      eventEmitter.on('test-event', handler)
      
      expect(eventEmitter['handlers'].has('test-event')).toBe(true)
      expect(eventEmitter['handlers'].get('test-event')).toContain(handler)
    })

    it('should add multiple handlers for the same event', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      
      eventEmitter.on('test-event', handler1)
      eventEmitter.on('test-event', handler2)
      
      const handlers = eventEmitter['handlers'].get('test-event')
      expect(handlers).toHaveLength(2)
      expect(handlers).toContain(handler1)
      expect(handlers).toContain(handler2)
    })

    it('should handle multiple different events', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      
      eventEmitter.on('event1', handler1)
      eventEmitter.on('event2', handler2)
      
      expect(eventEmitter['handlers'].has('event1')).toBe(true)
      expect(eventEmitter['handlers'].has('event2')).toBe(true)
      expect(eventEmitter['handlers'].get('event1')).toContain(handler1)
      expect(eventEmitter['handlers'].get('event2')).toContain(handler2)
    })

    it('should allow the same handler to be registered multiple times', () => {
      const handler = vi.fn()
      
      eventEmitter.on('test-event', handler)
      eventEmitter.on('test-event', handler)
      
      const handlers = eventEmitter['handlers'].get('test-event')
      expect(handlers).toHaveLength(2)
      expect(handlers![0]).toBe(handler)
      expect(handlers![1]).toBe(handler)
    })
  })

  describe('off method', () => {
    it('should remove a handler from an existing event', () => {
      const handler = vi.fn()
      
      eventEmitter.on('test-event', handler)
      expect(eventEmitter['handlers'].get('test-event')).toContain(handler)
      
      eventEmitter.off('test-event', handler)
      expect(eventEmitter['handlers'].get('test-event')).not.toContain(handler)
    })

    it('should do nothing when trying to remove handler from non-existent event', () => {
      const handler = vi.fn()
      
      // Should not throw an error
      expect(() => {
        eventEmitter.off('non-existent-event', handler)
      }).not.toThrow()
    })

    it('should do nothing when trying to remove non-existent handler', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      
      eventEmitter.on('test-event', handler1)
      
      // Should not throw an error
      expect(() => {
        eventEmitter.off('test-event', handler2)
      }).not.toThrow()
      
      // Original handler should still be there
      expect(eventEmitter['handlers'].get('test-event')).toContain(handler1)
    })

    it('should remove only the first occurrence of a handler', () => {
      const handler = vi.fn()
      
      eventEmitter.on('test-event', handler)
      eventEmitter.on('test-event', handler)
      
      expect(eventEmitter['handlers'].get('test-event')).toHaveLength(2)
      
      eventEmitter.off('test-event', handler)
      
      expect(eventEmitter['handlers'].get('test-event')).toHaveLength(1)
      expect(eventEmitter['handlers'].get('test-event')).toContain(handler)
    })

    it('should remove correct handler when multiple handlers exist', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      const handler3 = vi.fn()
      
      eventEmitter.on('test-event', handler1)
      eventEmitter.on('test-event', handler2)
      eventEmitter.on('test-event', handler3)
      
      eventEmitter.off('test-event', handler2)
      
      const handlers = eventEmitter['handlers'].get('test-event')
      expect(handlers).toHaveLength(2)
      expect(handlers).toContain(handler1)
      expect(handlers).not.toContain(handler2)
      expect(handlers).toContain(handler3)
    })
  })

  describe('emit method', () => {
    it('should call all handlers for an event', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      
      eventEmitter.on('test-event', handler1)
      eventEmitter.on('test-event', handler2)
      
      eventEmitter.emit('test-event', 'test-data')
      
      expect(handler1).toHaveBeenCalledWith('test-data')
      expect(handler2).toHaveBeenCalledWith('test-data')
    })

    it('should do nothing when emitting non-existent event', () => {
      // Should not throw an error
      expect(() => {
        eventEmitter.emit('non-existent-event', 'data')
      }).not.toThrow()
    })

    it('should pass arguments to handlers', () => {
      const handler = vi.fn()
      const testData = { message: 'test', number: 42 }
      
      eventEmitter.on('test-event', handler)
      eventEmitter.emit('test-event', testData)
      
      expect(handler).toHaveBeenCalledWith(testData)
    })

    it('should call handlers in the order they were added', () => {
      const callOrder: number[] = []
      const handler1 = vi.fn(() => callOrder.push(1))
      const handler2 = vi.fn(() => callOrder.push(2))
      const handler3 = vi.fn(() => callOrder.push(3))
      
      eventEmitter.on('test-event', handler1)
      eventEmitter.on('test-event', handler2)
      eventEmitter.on('test-event', handler3)
      
      eventEmitter.emit('test-event', null)
      
      expect(callOrder).toEqual([1, 2, 3])
    })

    it('should handle null and undefined arguments', () => {
      const handler = vi.fn()
      
      eventEmitter.on('test-event', handler)
      
      eventEmitter.emit('test-event', null)
      expect(handler).toHaveBeenCalledWith(null)
      
      eventEmitter.emit('test-event', undefined)
      expect(handler).toHaveBeenCalledWith(undefined)
    })

    it('should not affect other events', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      
      eventEmitter.on('event1', handler1)
      eventEmitter.on('event2', handler2)
      
      eventEmitter.emit('event1', 'data1')
      
      expect(handler1).toHaveBeenCalledWith('data1')
      expect(handler2).not.toHaveBeenCalled()
    })
  })

  describe('integration tests', () => {
    it('should support complete event lifecycle', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      
      // Register handlers
      eventEmitter.on('lifecycle-event', handler1)
      eventEmitter.on('lifecycle-event', handler2)
      
      // Emit event
      eventEmitter.emit('lifecycle-event', 'test-data')
      expect(handler1).toHaveBeenCalledWith('test-data')
      expect(handler2).toHaveBeenCalledWith('test-data')
      
      // Remove one handler
      eventEmitter.off('lifecycle-event', handler1)
      
      // Emit again
      eventEmitter.emit('lifecycle-event', 'test-data-2')
      expect(handler1).toHaveBeenCalledTimes(1) // Still only called once
      expect(handler2).toHaveBeenCalledTimes(2) // Called twice
      expect(handler2).toHaveBeenLastCalledWith('test-data-2')
    })

    it('should handle complex data types', () => {
      const handler = vi.fn()
      const complexData = {
        array: [1, 2, 3],
        object: { nested: true },
        function: () => 'test',
        symbol: Symbol('test'),
      }
      
      eventEmitter.on('complex-event', handler)
      eventEmitter.emit('complex-event', complexData)
      
      expect(handler).toHaveBeenCalledWith(complexData)
    })
  })
})