
import { getBase64 } from './base64';

test('getBase64_converts_file_to_base64', async () => {
  const file = new File(['test'], 'test.txt', { type: 'text/plain' });
  const base64String = await getBase64(file);
  expect(base64String).toBe('data:text/plain;base64,dGVzdA==');
});
