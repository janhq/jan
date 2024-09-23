import { Extension } from './extension';

it('should call function associated with key in process method', () => {
  const mockFunc = jest.fn();
  const extension = new Extension();
  (extension as any).testKey = mockFunc;
  extension.process('testKey', 'arg1', 'arg2');
  expect(mockFunc).toHaveBeenCalledWith('arg1', 'arg2');
});


it('should_handle_empty_extension_list_for_install', async () => {
  jest.mock('../../extension/store', () => ({
    installExtensions: jest.fn(() => Promise.resolve([])),
  }));
  const extension = new Extension();
  const result = await extension.installExtension([]);
  expect(result).toEqual([]);
});


it('should_handle_empty_extension_list_for_update', async () => {
  jest.mock('../../extension/store', () => ({
    getExtension: jest.fn(() => ({ update: jest.fn(() => Promise.resolve(true)) })),
  }));
  const extension = new Extension();
  const result = await extension.updateExtension([]);
  expect(result).toEqual([]);
});


it('should_handle_empty_extension_list', async () => {
  jest.mock('../../extension/store', () => ({
    getExtension: jest.fn(() => ({ uninstall: jest.fn(() => Promise.resolve(true)) })),
    removeExtension: jest.fn(),
  }));
  const extension = new Extension();
  const result = await extension.uninstallExtension([]);
  expect(result).toBe(true);
});
