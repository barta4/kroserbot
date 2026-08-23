module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/backend/tests/setup.js'],
  collectCoverageFrom: ['backend/**/*.js', '!backend/tests/**'],
  coverageDirectory: 'coverage',
  testTimeout: 10000,
};
