// @auto-generated
import { App } from './app';

it('should stop server', () => {
  const app = new App();
  const stopServerMock = jest.fn();
  jest.mock('@janhq/server', () => ({
    stopServer: stopServerMock,
  }));
  app.stopServer();
  expect(stopServerMock).toHaveBeenCalled();
});


it('should retrieve basename correctly', () => {
  const app = new App();
  const result = app.baseName('/path/to/file.txt');
  expect(result).toBe('file.txt');
});


it('should identify subdirectories correctly', async () => {
  const app = new App();
  const result = await app.isSubdirectory('/path/to', '/path/to/subdir');
  expect(result).toBe(true);
});


it('should join multiple paths correctly', () => {
  const app = new App();
  const result = app.joinPath(['path', 'to', 'file']);
  expect(result).toBe('path/to/file');
});
