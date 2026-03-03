module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  plugins: ["@typescript-eslint", "react-hooks"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: {
    browser: true,
    node: true,
    es2021: true,
    jest: true,
  },
  rules: {
    // React Hooks rules - these catch hooks-after-early-return bugs
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn",

    // Relax some TypeScript rules for existing codebase
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/no-require-imports": "off",
  },
  ignorePatterns: [
    "node_modules/",
    "dist/",
    ".expo/",
    "babel.config.js",
    "metro.config.js",
    "jest.setup.js",
    "jest.patch.js",
    "run-tests.js",
  ],
  settings: {
    react: {
      version: "detect",
    },
  },
};
