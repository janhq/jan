
import { hostOptions } from './ApiServer.atom';

test('hostOptions correct values', () => {
  expect(hostOptions).toEqual([
    { name: '127.0.0.1', value: '127.0.0.1' },
    { name: '0.0.0.0', value: '0.0.0.0' },
  ]);
});
