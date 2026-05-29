import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

export default [
  js.configs.recommended,
  ...compat.extends(
    "plugin:@typescript-eslint/recommended",
    "plugin:prettier/recommended",
  ),
  {
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      parser: await import("@typescript-eslint/parser"),
    },
    plugins: {
      "@typescript-eslint": (await import("@typescript-eslint/eslint-plugin"))
        .default,
    },
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/quotes": "off",
    },
  },
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**", "docs/**"],
  },
];
