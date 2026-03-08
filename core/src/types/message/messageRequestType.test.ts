

import { test, expect } from 'vitest'
import { MessageRequestType } from './messageRequestType';

test('testMessageRequestTypeEnumContainsThread', () => {
    expect(MessageRequestType.Thread).toBe('Thread');
  });
