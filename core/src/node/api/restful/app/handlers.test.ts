// @auto-generated
import { jest } from '@jest/globals';

import { HttpServer } from '../../HttpServer';
import { handleRequests } from './handlers';
import { Handler, RequestHandler } from '../../common/handler';

it('should initialize RequestHandler and call handle', () => {
  const mockHandle = jest.fn();
  jest.spyOn(RequestHandler.prototype, 'handle').mockImplementation(mockHandle);
  
  const mockApp = { post: jest.fn() };
  handleRequests(mockApp as unknown as HttpServer);
  
  expect(mockHandle).toHaveBeenCalled();
});
