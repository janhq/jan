
import { v1Router } from './v1';
import { commonRouter } from './common';

test('should define v1Router function', () => {
  expect(v1Router).toBeDefined();
});

test('should register commonRouter', () => {
  const mockApp = {
    register: jest.fn(),
  };
  v1Router(mockApp as any);
  expect(mockApp.register).toHaveBeenCalledWith(commonRouter);
});

