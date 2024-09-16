
import { hostAtom } from './AppConfig.atom';

test('hostAtom default value', () => {
  const result = hostAtom.init;
  expect(result).toBe('http://localhost:1337/');
});
