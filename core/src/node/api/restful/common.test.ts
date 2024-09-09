
import { commonRouter } from './common';
import { JanApiRouteConfiguration } from './helper/configuration';

test('commonRouter sets up routes for each key in JanApiRouteConfiguration', async () => {
  const mockHttpServer = {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  };
  await commonRouter(mockHttpServer as any);

  const expectedRoutes = Object.keys(JanApiRouteConfiguration);
  expectedRoutes.forEach((key) => {
    expect(mockHttpServer.get).toHaveBeenCalledWith(`/${key}`, expect.any(Function));
    expect(mockHttpServer.get).toHaveBeenCalledWith(`/${key}/:id`, expect.any(Function));
    expect(mockHttpServer.delete).toHaveBeenCalledWith(`/${key}/:id`, expect.any(Function));
  });
});
