
import { it, expect } from 'vitest'

it('should declare global object core when importing the module and then deleting it', () => {
  import('./index');
  delete globalThis.core;
  expect(typeof globalThis.core).toBe('undefined');
});
