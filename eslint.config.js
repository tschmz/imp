import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "**/.venv/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        console: "readonly",
        globalThis: "readonly",
        process: "readonly",
        setTimeout: "readonly",
      },
    },
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: false,
      },
    },
    rules: {
      "no-console": "off",
    },
  },
);
