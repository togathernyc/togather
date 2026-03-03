module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleNameMapper: {
    // Map Convex generated modules to mocks for unit testing
    '^(\\.\\./)*_generated/server$': '<rootDir>/__mocks__/_generated/server',
    '^(\\.\\./)*_generated/api$': '<rootDir>/__mocks__/_generated/api',
    // Mock the auth module to avoid jose ESM issues
    '^(\\.\\./)*auth$': '<rootDir>/__mocks__/auth',
  },
};
