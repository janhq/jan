
import { it, expect } from 'vitest'
import { MessageStatus } from './messageEntity';

it('should have correct values', () => {
  expect(MessageStatus.Ready).toBe('ready');
  expect(MessageStatus.Pending).toBe('pending');
  expect(MessageStatus.Error).toBe('error');
  expect(MessageStatus.Stopped).toBe('stopped');
})
