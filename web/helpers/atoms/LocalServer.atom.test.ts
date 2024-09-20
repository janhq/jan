
import { serverEnabledAtom } from './LocalServer.atom';

test('serverEnabledAtom_initialValue', () => {
  const result = serverEnabledAtom.init;
  expect(result).toBe(false);
});
