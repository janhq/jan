/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    'node_modules/@janhq/core/.+\\.(j|t)s?$': 'ts-jest',
  },
  transformIgnorePatterns: ['node_modules/(?!@janhq/core/.*)'],
}
