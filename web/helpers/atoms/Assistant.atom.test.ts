
import { assistantsAtom } from './Assistant.atom';

test('assistantsAtom initializes as an empty array', () => {
  const initialValue = assistantsAtom.init;
  expect(Array.isArray(initialValue)).toBe(true);
  expect(initialValue).toHaveLength(0);
});
