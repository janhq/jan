import { useExtensions } from './index'

test('testUseExtensionsMissingPath', () => {
  expect(() => useExtensions(undefined as any)).toThrow(
    'A path to the extensions folder is required to use extensions'
  )
})
