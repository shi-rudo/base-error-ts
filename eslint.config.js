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
// The totality invariant: catch paths read foreign values, and a raw read
// throws on a hostile getter or Proxy trap. Two read shapes are detectable by
// syntax and banned in library source; readProperty (guarded-read.ts) is the
// intended replacement for a foreign read, and a deliberate own-object cast
// binds to a named variable first. Reads behind a passing type guard stay a
// review concern: the types accept them, so no rule can see them.
const GUARDED_READ_SYNTAX = [
  {
    selector: "BinaryExpression[operator='in']",
    message:
      "A property probe with `in` throws on a hostile Proxy. Read through readProperty (src/errors/guarded-read.ts), or use Object.prototype.hasOwnProperty.call for an own object.",
  },
  {
    selector: "MemberExpression[object.type='TSAsExpression']",
    message:
      "A member access on an inline cast reads raw. For a foreign value use readProperty (src/errors/guarded-read.ts); for a deliberate own-object cast, bind the cast to a named variable first.",
  },
];

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
      // Underscore prefix marks deliberately unused values (e.g. the parameter
      // of a type-guard signature used only in its type predicate).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  // Upper layer (the public-error pipeline): edge-clean, may import core, may
  // not import Node built-ins.
  {
    files: ["src/public-error/**/*.ts"],
    rules: {
      "no-restricted-globals": ["error", ...EDGE_RESTRICTED_GLOBALS],
      "no-restricted-imports": ["error", { patterns: [NODE_BUILTIN_IMPORTS] }],
      "no-restricted-syntax": ["error", ...GUARDED_READ_SYNTAX],
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
      "no-restricted-syntax": ["error", ...GUARDED_READ_SYNTAX],
    },
  },
  // The one home of guarded foreign reads implements them with the raw
  // operations the rule bans everywhere else.
  {
    files: ["src/errors/guarded-read.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  // Build scripts run on Node only; declare the runtime globals they use.
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        URL: "readonly",
        process: "readonly",
        AggregateError: "readonly",
      },
    },
  },
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**", "docs/**"],
  },
];
