module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest'
  },
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  collectCoverageFrom: [
    'app/backend/middleware/auth.js',
    'app/backend/services/reportService.js',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    'app/backend/server.js',
    'app/backend/routes/unified-api.js',
    'app/backend/routes/sqlite-api.js',
    'app/backend/routes/real-data.js',
    'app/backend/services/RealtimeDataSyncService.js',
    'app/backend/services/WebSocketConnectionPool.js',
    'app/backend/services/CacheService.js',
    'app/backend/controllers/',
    'app/backend/local-services/',
    'app/backend/main.js',
  ],
  testMatch: ['**/app/backend/tests/**/*.test.js'],
  verbose: false,
  transformIgnorePatterns: ['/node_modules/(?!uuid)'],
  coverageThreshold: {
    global: {
      lines: 80,
      statements: 80,
      functions: 70,
      branches: 60,
    },
  },
}
