// json.test.ts
import { safeJsonParse } from './json';

describe('safeJsonParse', () => {
  it('should correctly parse a valid JSON string', () => {
    const jsonString = '{"name": "John", "age": 30}';
    const result = safeJsonParse<{ name: string; age: number }>(jsonString);
    expect(result).toEqual({ name: 'John', age: 30 });
  });

  it('should return undefined for an invalid JSON string', () => {
    const jsonString = '{"name": "John", "age": 30';
    const result = safeJsonParse<{ name: string; age: number }>(jsonString);
    expect(result).toBeUndefined();
  });

  it('should return undefined for an empty string', () => {
    const jsonString = '';
    const result = safeJsonParse<unknown>(jsonString);
    expect(result).toBeUndefined();
  });
});