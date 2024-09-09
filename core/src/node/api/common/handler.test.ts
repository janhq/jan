import { CoreRoutes } from '../../../types/api';
import { RequestHandler } from './handler';
import { RequestAdapter } from './adapter';

it('should not call handler if CoreRoutes is empty', () => {
  const mockHandler = jest.fn();
  const mockObserver = jest.fn();
  const requestHandler = new RequestHandler(mockHandler, mockObserver);

  CoreRoutes.length = 0; // Ensure CoreRoutes is empty

  requestHandler.handle();

  expect(mockHandler).not.toHaveBeenCalled();
});


it('should initialize handler and adapter correctly', () => {
  const mockHandler = jest.fn();
  const mockObserver = jest.fn();
  const requestHandler = new RequestHandler(mockHandler, mockObserver);

  expect(requestHandler.handler).toBe(mockHandler);
  expect(requestHandler.adapter).toBeInstanceOf(RequestAdapter);
});
