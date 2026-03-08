import { it, expect, vi } from 'vitest'
import { events } from './events';

it('should emit an event', () => {
  const mockObject = { key: 'value' };
  globalThis.core = {
    events: {
      emit: vi.fn()
    }
  };
  events.emit('testEvent', mockObject);
  expect(globalThis.core.events.emit).toHaveBeenCalledWith('testEvent', mockObject);
});


it('should remove an observer for an event', () => {
  const mockHandler = vi.fn();
  globalThis.core = {
    events: {
      off: vi.fn()
    }
  };
  events.off('testEvent', mockHandler);
  expect(globalThis.core.events.off).toHaveBeenCalledWith('testEvent', mockHandler);
});


it('should add an observer for an event', () => {
  const mockHandler = vi.fn();
  globalThis.core = {
    events: {
      on: vi.fn()
    }
  };
  events.on('testEvent', mockHandler);
  expect(globalThis.core.events.on).toHaveBeenCalledWith('testEvent', mockHandler);
});
