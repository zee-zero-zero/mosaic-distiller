// ESLint flat configuration: typescript-eslint's recommended rules over every TypeScript and
// JavaScript source of the repository.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", "**/dist/**", "coverage/**", "rigs/e2e/.mosaic/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
      },
    },
  },
  {
    // Tests read results as loosely typed JSON; the engine's own sources stay strictly typed.
    // The end-to-end rig reaches into MosAIc's untyped `window.electronAPI`.
    files: ["**/test/**/*.ts", "scripts/**/*.ts", "rigs/e2e/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
);
