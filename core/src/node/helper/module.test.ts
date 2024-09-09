import { ModuleManager } from './module';

it('should clear all imported modules', () => {
  const moduleManager = new ModuleManager();
  moduleManager.setModule('module1', { key: 'value1' });
  moduleManager.setModule('module2', { key: 'value2' });
  moduleManager.clearImportedModules();
  expect(moduleManager.requiredModules).toEqual({});
});


it('should set a module correctly', () => {
  const moduleManager = new ModuleManager();
  moduleManager.setModule('testModule', { key: 'value' });
  expect(moduleManager.requiredModules['testModule']).toEqual({ key: 'value' });
});


it('should return the singleton instance', () => {
  const instance1 = new ModuleManager();
  const instance2 = new ModuleManager();
  expect(instance1).toBe(instance2);
});
