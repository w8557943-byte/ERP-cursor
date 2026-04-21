module.exports = {
  "extends": [
    "stylelint-config-standard",
    "stylelint-config-prettier"
  ],
  "plugins": [
    "stylelint-order"
  ],
  "rules": {
    "indentation": 2,
    "string-quotes": "single",
    "color-hex-case": "lower",
    "color-hex-length": "short",
    "selector-max-id": 0,
    "selector-max-nesting-depth": 3,
    "declaration-no-important": true,
    "order/properties-alphabetical-order": true
  }
};