const nextJest = require('next/jest')

/** @type {import('jest').Config} */
const createJestConfig = nextJest({})

// Add any custom config to be passed to Jest
const config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  moduleNameMapper: {
    // ...
    '^@/(.*)$': '<rootDir>/$1',
  },
  // Add more setup options before each test is run
  // setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
}

// https://stackoverflow.com/a/72926763/5078746
// module.exports = createJestConfig(config)
module.exports = async () => ({
  ...(await createJestConfig(config)()),
  transformIgnorePatterns: ['/node_modules/(?!(layerr)/)'],
})
