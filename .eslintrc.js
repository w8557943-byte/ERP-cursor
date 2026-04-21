module.exports = {
  "env": {
    "browser": true,
    "es2021": true,
    "node": true,
    "jest": true
  },
  "extends": [
    "eslint:recommended",
    "plugin:react/recommended",
    "plugin:react-hooks/recommended",
    "plugin:security/recommended-legacy",
    "prettier"
  ],
  "parserOptions": {
    "ecmaFeatures": {
      "jsx": true
    },
    "ecmaVersion": 12,
    "sourceType": "module"
  },
  "plugins": [
    "react",
    "react-hooks"
  ],
  "rules": {
    "no-console": "warn",
    "no-debugger": "error",
    "no-unused-vars": "error",
    "no-var": "error",
    "prefer-const": "error",
    "eqeqeq": "error",
    "curly": "error",
    "complexity": [
      "error",
      10
    ],
    "max-depth": [
      "error",
      4
    ],
    "max-params": [
      "error",
      5
    ],
    "max-lines": [
      "error",
      300
    ],
    "react/prop-types": "error",
    "react/jsx-key": "error",
    "react/jsx-no-duplicate-props": "error",
    "react/jsx-uses-react": "error",
    "react/jsx-uses-vars": "error"
  },
  "settings": {
    "react": {
      "version": "detect"
    }
  }
};