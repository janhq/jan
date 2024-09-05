import Extension from './extension';
import { join } from 'path';
import 'pacote';

it('should set active and call emitUpdate', () => {
  const extension = new Extension();
  extension.emitUpdate = jest.fn();
  
  extension.setActive(true);
  
  expect(extension._active).toBe(true);
  expect(extension.emitUpdate).toHaveBeenCalled();
});


it('should return correct specifier', () => {
  const origin = 'test-origin';
  const options = { version: '1.0.0' };
  const extension = new Extension(origin, options);
  
  expect(extension.specifier).toBe('test-origin@1.0.0');
});


it('should set origin and installOptions in constructor', () => {
  const origin = 'test-origin';
  const options = { someOption: true };
  const extension = new Extension(origin, options);
  
  expect(extension.origin).toBe(origin);
  expect(extension.installOptions.someOption).toBe(true);
  expect(extension.installOptions.fullMetadata).toBe(true); // default option
});

it('should install extension and set url', async () => {
  const origin = 'test-origin';
  const options = {};
  const extension = new Extension(origin, options);
  
  const mockManifest = {
    name: 'test-name',
    productName: 'Test Product',
    version: '1.0.0',
    main: 'index.js',
    description: 'Test description'
  };
  
  jest.mock('pacote', () => ({
    manifest: jest.fn().mockResolvedValue(mockManifest),
    extract: jest.fn().mockResolvedValue(null)
  }));
  
  extension.emitUpdate = jest.fn();
  await extension._install();
  
  expect(extension.url).toBe('extension://test-name/index.js');
  expect(extension.emitUpdate).toHaveBeenCalled();
});


it('should call all listeners in emitUpdate', () => {
  const extension = new Extension();
  const callback1 = jest.fn();
  const callback2 = jest.fn();
  
  extension.subscribe('listener1', callback1);
  extension.subscribe('listener2', callback2);
  
  extension.emitUpdate();
  
  expect(callback1).toHaveBeenCalledWith(extension);
  expect(callback2).toHaveBeenCalledWith(extension);
});


it('should remove listener in unsubscribe', () => {
  const extension = new Extension();
  const callback = jest.fn();
  
  extension.subscribe('testListener', callback);
  extension.unsubscribe('testListener');
  
  expect(extension.listeners['testListener']).toBeUndefined();
});


it('should add listener in subscribe', () => {
  const extension = new Extension();
  const callback = jest.fn();
  
  extension.subscribe('testListener', callback);
  
  expect(extension.listeners['testListener']).toBe(callback);
});


it('should set properties from manifest', async () => {
  const origin = 'test-origin';
  const options = {};
  const extension = new Extension(origin, options);
  
  const mockManifest = {
    name: 'test-name',
    productName: 'Test Product',
    version: '1.0.0',
    main: 'index.js',
    description: 'Test description'
  };
  
  jest.mock('pacote', () => ({
    manifest: jest.fn().mockResolvedValue(mockManifest)
  }));
  
  await extension.getManifest();
  
  expect(extension.name).toBe('test-name');
  expect(extension.productName).toBe('Test Product');
  expect(extension.version).toBe('1.0.0');
  expect(extension.main).toBe('index.js');
  expect(extension.description).toBe('Test description');
});

