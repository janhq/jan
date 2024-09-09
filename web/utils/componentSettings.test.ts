
import { getConfigurationsData } from './componentSettings';

it('should process checkbox setting', () => {
  const settings = { embedding: true };
  const result = getConfigurationsData(settings);
  expect(result[0].controllerProps.value).toBe(true);
});


it('should process input setting and handle array input', () => {
  const settings = { prompt_template: ['Hello', 'World', ''] };
  const result = getConfigurationsData(settings);
  expect(result[0].controllerProps.value).toBe('Hello World ');
});


it('should return an empty array when settings object is empty', () => {
  const settings = {};
  const result = getConfigurationsData(settings);
  expect(result).toEqual([]);
});
