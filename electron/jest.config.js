module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    '**/tests/unit-test/**/*.(spec|test).[jt]s?(x)'
  ],
  transformIgnorePatterns: [
    '/node_modules/',
    '/build/',  // Add the build directory to ignore patterns
  ],
};