
import { expect } from '@jest/globals';

it('should re-export all exports from ./AIEngine', () => {
  expect(require('./index')).toHaveProperty('AIEngine');
});
