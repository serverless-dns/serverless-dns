module.exports = {
  root: true,
  env: {
    // Which globals variables are allowed.
    es2021: true,
    node: true,
    worker: true,
  },

  extends: [
    // Google JS Style Guide Rules
    // See: https://github.com/google/eslint-config-google
    "google",
  ],

  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },

  ignorePatterns: [
    "node_modules/",
    "dist/",
    "worker/",
    "pkg/",
    "test/data/cache/",

    // Ignore all files, except JS files (which may be in a directory)
    "*",
    "!*/",
    "!*.js",
    "!*.[mc]js",
  ],

  plugins: ["prettier"],
  rules: {
    // Google JS rules, missing in "eslint-config-google" package
    "eqeqeq": ["error", "smart"],

    // Rules disabled to avoid conflicts with prettier
    // See: https://github.com/prettier/eslint-config-prettier
    "indent": 0,
    "object-curly-spacing": 0,
    "operator-linebreak": 0,
    "space-before-function-paren": 0,

    // Our rules overrides.
    "comma-dangle": 0,
    "require-jsdoc": 0,
    "valid-jsdoc": 0,
    "quotes": ["error", "double", { allowTemplateLiterals: true }],
    "no-unused-vars": "warn",
    "new-cap": ["error", { properties: false }],
    "max-len": [
      "error",
      {
        code: 120,
        ignoreComments: true,
        ignoreUrls: true,
        ignoreStrings: true,
        ignoreTemplateLiterals: true,
      },
    ],
    "generator-star-spacing": [
      "error",
      {
        before: false,
        after: true, // function* () {}
        anonymous: "neither", // function*() {}
        method: { before: false, after: false }, // { *gen() {} }
      },
    ],

    // Enforces rules from .prettierrc file.
    // These should be fixed automatically with formatting.
    // See: https://github.com/prettier/eslint-plugin-prettier
    "prettier/prettier": "error",
  },
};
