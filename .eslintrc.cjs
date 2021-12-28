module.exports = {
  env: {
    // Which globals variables are allowed.
    es2021: true,
    node: true,
    worker: true,
  },

  extends: [
    // See: https://github.com/google/eslint-config-google
    "google",
  ],

  parserOptions: {
    ecmaVersion: 13,
    sourceType: "module",
  },

  plugins: ["prettier"],
  rules: {
    // Rules disabled to avoid conflicts with prettier
    // See: https://github.com/prettier/eslint-config-prettier
    "indent": 0,
    "object-curly-spacing": 0,
    "operator-linebreak": 0,
    "space-before-function-paren": 0,

    // Our rules overrides.
    "comma-dangle": 0,
    "require-jsdoc": 0,
    "quotes": ["error", "double", { allowTemplateLiterals: true }],
    "no-unused-vars": "warn",

    // Enforces rules from .prettierrc file.
    // These should be fixed automatically with formatting.
    // See: https://github.com/prettier/eslint-plugin-prettier
    "prettier/prettier": "warn",
  },
};
