

import { test, expect } from 'vitest'
import { ModelEvent } from './modelEvent';

test('testOnModelInit', () => {
      expect(ModelEvent.OnModelInit).toBe('OnModelInit');
    });
