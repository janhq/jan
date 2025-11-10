import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from '../events/EventEmitter'

describe('EventEmitter', () => {
  let eventEmitter: EventEmitter

  beforeEach(() => {
    eventEmitter = new EventEmitter()
  })

  describe('constructor', () => {
    it('should create an instance of EventEmitter', () => {
      expect(eventEmitter).toBeInstanceOf(EventEmitter)
    })
  })

  describe('on method', () => {
    it('should register an event handler', () => {
      const handler = vi.fn()
      eventEmitter.on('test-event', handler)
      
      eventEmitter.emit('test-event', 'test-data')
      
      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith('test-data')
    })

    it('should register multiple handlers for the same event', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      
      eventEmitter.on('test-event', handler1)
      eventEmitter.on('test-event', handler2)
      
      eventEmitter.emit('test-event', 'test-data')
      
      expect(handler1).toHaveBeenCalledOnce()
      expect(handler2).toHaveBeenCalledOnce()
    })
  })

  describe('off method', () => {
    it('should remove an event handler', () => {
      const handler = vi.fn()
      
      eventEmitter.on('test-event', handler)
      eventEmitter.emit('test-event', 'data1')
      expect(handler).toHaveBeenCalledTimes(1)
      
      eventEmitter.off('test-event', handler)
      eventEmitter.emit('test-event', 'data2')
      expect(handler).toHaveBeenCalledTimes(1) // Should not be called again
    })

    it('should not affect other handlers when removing one', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      
      eventEmitter.on('test-event', handler1)
      eventEmitter.on('test-event', handler2)
      
      eventEmitter.off('test-event', handler1)
      eventEmitter.emit('test-event', 'test-data')
      
      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).toHaveBeenCalledOnce()
    })
  })

  describe('emit method', () => {
    it('should emit events with data', () => {
      const handler = vi.fn()
      const testData = { message: 'test', number: 42 }
      
      eventEmitter.on('test-event', handler)
      eventEmitter.emit('test-event', testData)
      
      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith(testData)
    })

    it('should emit events without data', () => {
      const handler = vi.fn()
      
      eventEmitter.on('test-event', handler)
      eventEmitter.emit('test-event')
      
      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith(undefined)
    })

    it('should handle different event types independently', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      
      eventEmitter.on('event1', handler1)
      eventEmitter.on('event2', handler2)
      
      eventEmitter.emit('event1', 'data1')
      eventEmitter.emit('event2', 'data2')
      
      expect(handler1).toHaveBeenCalledOnce()
      expect(handler2).toHaveBeenCalledOnce()
      expect(handler1).toHaveBeenCalledWith('data1')
      expect(handler2).toHaveBeenCalledWith('data2')
    })
  })

  describe('integration tests', () => {
    it('should support complete event lifecycle', () => {
      const handler = vi.fn()
      
      // Register handler
      eventEmitter.on('lifecycle-event', handler)
      
      // Emit event
      eventEmitter.emit('lifecycle-event', 'lifecycle-data')
      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith('lifecycle-data')
      
      // Remove handler
      eventEmitter.off('lifecycle-event', handler)
      
      // Emit again - should not call handler
      eventEmitter.emit('lifecycle-event', 'new-data')
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should handle complex data types', () => {
      const handler = vi.fn()
      const complexData = {
        array: [1, 2, 3],
        object: { nested: true },
        function: () => 'test',
        symbol: Symbol('test')
      }
      
      eventEmitter.on('complex-event', handler)
      eventEmitter.emit('complex-event', complexData)
      
      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith(complexData)
    })
  })
})