

test('restAPI.baseApiUrl set correctly', () => {
  const originalEnv = process.env.API_BASE_URL;
  process.env.API_BASE_URL = 'http://test-api.com';
  
  // Re-import to get the updated value
  jest.resetModules();
  const { restAPI } = require('./restService');

  expect(restAPI.baseApiUrl).toBe('http://test-api.com');

  // Clean up
  process.env.API_BASE_URL = originalEnv;
});
