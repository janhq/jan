
import { EventEmitter } from './eventsService';

test('should do nothing when no handlers for event', () => {
  const emitter = new EventEmitter();
  
  expect(() => {
    emitter.emit('nonExistentEvent', 'test data');
  }).not.toThrow();
});


test('should call all handlers for event', () => {
  const emitter = new EventEmitter();
  const handler1 = jest.fn();
  const handler2 = jest.fn();
  
  emitter.on('testEvent', handler1);
  emitter.on('testEvent', handler2);
  
  emitter.emit('testEvent', 'test data');
  
  expect(handler1).toHaveBeenCalledWith('test data');
  expect(handler2).toHaveBeenCalledWith('test data');
});


test('should remove handler for event', () => {
  const emitter = new EventEmitter();
  const handler = jest.fn();
  
  emitter.on('testEvent', handler);
  emitter.off('testEvent', handler);
  
  expect(emitter['handlers'].get('testEvent')).not.toContain(handler);
});


test('should add handler for event', () => {
  const emitter = new EventEmitter();
  const handler = jest.fn();
  
  emitter.on('testEvent', handler);
  
  expect(emitter['handlers'].has('testEvent')).toBe(true);
  expect(emitter['handlers'].get('testEvent')).toContain(handler);
});
