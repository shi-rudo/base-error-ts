import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

// Runtime compatibility: the published library must run on edge runtimes
// (workerd, Vercel Edge, Bun, Deno), so library source uses no Node globals or
// built-ins. Tests are exempt (they may use child_process/fs/path).
const EDGE_RESTRICTED_GLOBALS = [
  {
    name: "process",
    message:
      "Edge-incompatible: library code must not read process/process.env. Pass configuration via options.",
  },
  {
    name: "Buffer",
    message: "Edge-incompatible: avoid Buffer in library code.",
  },
];
const NODE_BUILTIN_IMPORTS = {
  group: ["node:*"],
  message:
    "Edge-incompatible: library code must not import Node built-ins (no node:* imports).",
};
// Dependency direction is public-error -> core. Core (and the root barrel) must
// never import the public-error module.
const PUBLIC_ERROR_BOUNDARY = {
  group: ["**/public-error", "**/public-error/**"],
  message:
    "Module boundary: core must not import the public-error module (dependency direction is public-error -> core).",
};

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
  // Upper layer (the public-error pipeline): edge-clean, may import core, may
  // not import Node built-ins.
  {
    files: ["src/public-error/**/*.ts"],
    rules: {
      "no-restricted-globals": ["error", ...EDGE_RESTRICTED_GLOBALS],
      "no-restricted-imports": ["error", { patterns: [NODE_BUILTIN_IMPORTS] }],
    },
  },
  // Core library source (everything outside the public-error subpath and tests):
  // edge-clean and forbidden from importing the public-error module.
  {
    files: ["src/**/*.ts"],
    ignores: ["src/public-error/**", "src/__tests__/**"],
    rules: {
      "no-restricted-globals": ["error", ...EDGE_RESTRICTED_GLOBALS],
      "no-restricted-imports": [
        "error",
        { patterns: [NODE_BUILTIN_IMPORTS, PUBLIC_ERROR_BOUNDARY] },
      ],
    },
  },
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**", "docs/**"],
  },
];
