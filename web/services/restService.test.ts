test('restAPI.openExternalUrl set correctly', () => {
  // Re-import to get the updated value
  jest.resetModules()
  const { restAPI } = require('./restService')

  expect(restAPI.openExternalUrl).toBeDefined()
})
