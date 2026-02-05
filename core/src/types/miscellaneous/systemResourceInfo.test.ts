
import { it, expect } from 'vitest'
import { SupportedPlatforms } from './systemResourceInfo';

it('should contain the correct values', () => {
  expect(SupportedPlatforms).toEqual(['win32', 'linux', 'darwin']);
});
