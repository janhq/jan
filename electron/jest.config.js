module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  collectCoverageFrom: ['src/**/*.{ts,tsx}'],
  modulePathIgnorePatterns: ['<rootDir>/tests'],
  moduleNameMapper: {
    '@/(.*)': '<rootDir>/src/$1',
  },
  runner: './testRunner.js',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        diagnostics: false,
      },
    ],
  },
}
