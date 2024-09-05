import * as fs from 'fs';
import { join } from 'path';
import { ExtensionManager } from './manager';

it('should throw an error when an invalid path is provided', () => {
  const manager = new ExtensionManager();
  jest.spyOn(fs, 'existsSync').mockReturnValue(false);
  expect(() => manager.setExtensionsPath('')).toThrow('Invalid path provided to the extensions folder');
});


it('should return an empty string when extensionsPath is not set', () => {
  const manager = new ExtensionManager();
  expect(manager.getExtensionsFile()).toBe(join('', 'extensions.json'));
});


it('should return undefined if no path is set', () => {
  const manager = new ExtensionManager();
  expect(manager.getExtensionsPath()).toBeUndefined();
});


it('should return the singleton instance', () => {
  const instance1 = new ExtensionManager();
  const instance2 = new ExtensionManager();
  expect(instance1).toBe(instance2);
});
