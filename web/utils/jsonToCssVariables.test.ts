
import cssVars from './jsonToCssVariables';

test('should convert nested JSON object to CSS variables', () => {
  const input = { theme: { color: 'blue', font: { size: '14px', weight: 'bold' } } };
  const expectedOutput = '--theme-color: blue;--theme-font-size: 14px;--theme-font-weight: bold;';
  const result = cssVars(input);
  expect(result).toBe(expectedOutput);
});


test('should convert simple JSON object to CSS variables', () => {
  const input = { color: 'red', fontSize: '16px' };
  const expectedOutput = '--color: red;--fontSize: 16px;';
  const result = cssVars(input);
  expect(result).toBe(expectedOutput);
});
