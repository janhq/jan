import { it, expect } from 'vitest'
import { AssistantEvent } from './assistantEvent';

it('dummy test', () => { expect(true).toBe(true); });

it('should contain OnAssistantsUpdate event', () => {
  expect(AssistantEvent.OnAssistantsUpdate).toBe('OnAssistantsUpdate');
});

