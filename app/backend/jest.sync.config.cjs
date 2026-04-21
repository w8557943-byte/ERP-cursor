module.exports = {
  rootDir: '../..',
  testEnvironment: 'node',
  transform: {},
  testMatch: [
    '**/app/backend/tests/sync/**/*.test.cjs',
    '**/app/backend/tests/cloudfunctions.user-backup.test.cjs'
  ],
  collectCoverageFrom: [
    'utils/cloud-sync.js',
    'utils/local-store.js',
    'utils/sync-collections.js',
    'cloudfunctions/user-backup/index.js'
  ],
  coverageDirectory: 'app/backend/coverage-sync',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 70,
      functions: 80,
      lines: 80
    }
  },
  testTimeout: 15000
}
