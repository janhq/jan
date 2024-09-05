import { events } from './events';
import { jest } from '@jest/globals';

it('should emit an event', () => {
  const mockObject = { key: 'value' };
  globalThis.core = {
    events: {
      emit: jest.fn()
    }
  };
  events.emit('testEvent', mockObject);
  expect(globalThis.core.events.emit).toHaveBeenCalledWith('testEvent', mockObject);
});


it('should remove an observer for an event', () => {
  const mockHandler = jest.fn();
  globalThis.core = {
    events: {
      off: jest.fn()
    }
  };
  events.off('testEvent', mockHandler);
  expect(globalThis.core.events.off).toHaveBeenCalledWith('testEvent', mockHandler);
});


it('should add an observer for an event', () => {
  const mockHandler = jest.fn();
  globalThis.core = {
    events: {
      on: jest.fn()
    }
  };
  events.on('testEvent', mockHandler);
  expect(globalThis.core.events.on).toHaveBeenCalledWith('testEvent', mockHandler);
});
