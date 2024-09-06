import { FSExt } from './fsExt';
import { defaultAppConfig } from '../../helper';

it('should handle errors in writeBlob', () => {
  const fsExt = new FSExt();
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  fsExt.writeBlob('invalid-path', 'data');
  expect(consoleSpy).toHaveBeenCalled();
  consoleSpy.mockRestore();
});

it('should call correct function in process method', () => {
  const fsExt = new FSExt();
  const mockFunction = jest.fn();
  (fsExt as any).mockFunction = mockFunction;
  fsExt.process('mockFunction', 'arg1', 'arg2');
  expect(mockFunction).toHaveBeenCalledWith('arg1', 'arg2');
});


it('should return correct user home path', () => {
  const fsExt = new FSExt();
  const userHomePath = fsExt.getUserHomePath();
  expect(userHomePath).toBe(defaultAppConfig().data_folder);
});



it('should return empty array when no files are provided', async () => {
  const fsExt = new FSExt();
  const result = await fsExt.getGgufFiles([]);
  expect(result.supportedFiles).toEqual([]);
  expect(result.unsupportedFiles).toEqual([]);
});
