
import { extensionManager } from '@/extension/ExtensionManager';
import { ExtensionTypeEnum } from '@janhq/core';
import { isCoreExtensionInstalled } from './extensionService';

test('isCoreExtensionInstalled returns true when both extensions are installed', () => {
  jest.spyOn(extensionManager, 'get').mockImplementation((type) => {
    if (type === ExtensionTypeEnum.Conversational || type === ExtensionTypeEnum.Model) return {};
    return undefined;
  });
  
  expect(isCoreExtensionInstalled()).toBe(true);
});


test('isCoreExtensionInstalled returns false when Model extension is not installed', () => {
  jest.spyOn(extensionManager, 'get').mockImplementation((type) => {
    if (type === ExtensionTypeEnum.Conversational) return {};
    if (type === ExtensionTypeEnum.Model) return undefined;
    return undefined;
  });
  
  expect(isCoreExtensionInstalled()).toBe(false);
});


test('isCoreExtensionInstalled returns false when Conversational extension is not installed', () => {
  jest.spyOn(extensionManager, 'get').mockImplementation((type) => {
    if (type === ExtensionTypeEnum.Conversational) return undefined;
    if (type === ExtensionTypeEnum.Model) return {};
    return undefined;
  });
  
  expect(isCoreExtensionInstalled()).toBe(false);
});
