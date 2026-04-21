module.exports = [
  {
    ignores: [
      'node_modules/**',
      'miniprogram_npm/**',
      'logs/**'
    ]
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module'
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-useless-catch': 'off',
      'no-empty': 'off',
      'no-case-declarations': 'off',
      'no-undef': 'off',
      'no-unreachable': 'off',
      'no-prototype-builtins': 'off',
      'no-dupe-keys': 'off'
    }
  }
]
