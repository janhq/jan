import { RequestAdapter } from './adapter';

it('should return undefined for unknown route', () => {
  const adapter = new RequestAdapter();
  const route = 'unknownRoute';
  
  const result = adapter.process(route, 'arg1', 'arg2');
  
  expect(result).toBeUndefined();
});
