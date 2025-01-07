const nextJest = require('next/jest')

/** @type {import('jest').Config} */
const createJestConfig = nextJest({})

// Add any custom config to be passed to Jest
const config = {
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  moduleNameMapper: {
    // ...
    '^@/(.*)$': '<rootDir>/$1',
    'react-markdown': '<rootDir>/mock/empty-mock.tsx',
    'rehype-highlight': '<rootDir>/mock/empty-mock.tsx',
    'rehype-katex': '<rootDir>/mock/empty-mock.tsx',
    'rehype-raw': '<rootDir>/mock/empty-mock.tsx',
    'remark-math': '<rootDir>/mock/empty-mock.tsx',
    '^react$': '<rootDir>/node_modules/react',
    '^react/jsx-runtime$': '<rootDir>/node_modules/react/jsx-runtime',
    '^react-dom$': '<rootDir>/node_modules/react-dom',
  },
  // Add more setup options before each test is run
  // setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  runner: './testRunner.js',
  collectCoverageFrom: ['./**/*.{ts,tsx}'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        diagnostics: false,
      },
    ],
  },
}

// https://stackoverflow.com/a/72926763/5078746
// module.exports = createJestConfig(config)
module.exports = async () => ({
  ...(await createJestConfig(config)()),
  transformIgnorePatterns: ['/node_modules/(?!(layerr|nanoid|@uppy|preact)/)'],
})
