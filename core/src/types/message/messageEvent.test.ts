

import { test, expect } from 'vitest'
import { MessageEvent } from './messageEvent';

test('testOnMessageSentValue', () => {
      expect(MessageEvent.OnMessageSent).toBe('OnMessageSent');
    });
