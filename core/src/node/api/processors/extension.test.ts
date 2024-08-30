// @auto-generated
import { Extension } from './extension';

it('should call function associated with key in process method', () => {
  const mockFunc = jest.fn();
  const extension = new Extension();
  (extension as any).testKey = mockFunc;
  extension.process('testKey', 'arg1', 'arg2');
  expect(mockFunc).toHaveBeenCalledWith('arg1', 'arg2');
});
