import { FileSystem } from './fs';

it('should throw an error when the route does not exist in process', async () => {
  const fileSystem = new FileSystem();
  await expect(fileSystem.process('nonExistentRoute', 'arg1')).rejects.toThrow();
});


it('should throw an error for invalid argument in mkdir', async () => {
  const fileSystem = new FileSystem();
  expect(() => fileSystem.mkdir(123)).toThrow('mkdir error: Invalid argument [123]');
});


it('should throw an error for invalid argument in rm', async () => {
  const fileSystem = new FileSystem();
  expect(() => fileSystem.rm(123)).toThrow('rm error: Invalid argument [123]');
});
