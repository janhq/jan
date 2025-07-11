

import { test, expect } from 'vitest'
import { ChatCompletionMessage, ChatCompletionRole } from './inferenceEntity';

test('test_chatCompletionMessage_withStringContent_andSystemRole', () => {
    const message: ChatCompletionMessage = {
      content: 'Hello, world!',
      role: ChatCompletionRole.System,
    };
  
    expect(message.content).toBe('Hello, world!');
    expect(message.role).toBe(ChatCompletionRole.System);
  });
