module.exports = {
  root: true,
  env: {
    node: true,
    es2021: true,
    jest: true
  },
  extends: [
    'eslint:recommended'
  ],
  parserOptions: {
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
