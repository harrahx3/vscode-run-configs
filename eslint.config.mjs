import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "out/**", "node_modules/**", ".vscode-test/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Node scripts; the browser tests also run snippets inside the page.
    files: ["**/*.mjs", "test/vscode/**/*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
