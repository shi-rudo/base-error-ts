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

// Dependency direction is subpath -> core. Core (and the root barrel) must
// never import a subpath module: public-error, pino or sentry. The pino and
// sentry patterns need a file below the folder, so the npm package `pino` and
// the scope `@sentry` stay outside them.
const SUBPATH_BOUNDARY = {
  group: ["**/public-error", "**/public-error/**", "**/pino/*", "**/sentry/*"],
  message:
    "Module boundary: core must not import a subpath module (dependency direction is subpath -> core).",
};

// The pino and sentry subpaths reach the core through the root entry, which
// their bundles load from the root bundle (tsup.config.ts). A direct import of
// a class module would bundle a second copy of the class, and an error of the
// root entry would lose its policy there. Pure helpers may come directly.
const LOG_SINK_CORE_IMPORTS = {
  regex:
    "^\\.\\./(?!index\\.js$|errors/(?:guarded-read|native-error|walker-bounds)\\.js$)",
  message:
    "A pino or sentry subpath imports the core through ../index.js. Only the pure helpers guarded-read, native-error and walker-bounds may come directly.",
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
  // Upper layer (the subpath modules): edge-clean, may import core, may not
  // import Node built-ins.
  {
    files: [
      "src/public-error/**/*.ts",
      "src/pino/**/*.ts",
      "src/sentry/**/*.ts",
    ],
    rules: {
      "no-restricted-globals": ["error", ...EDGE_RESTRICTED_GLOBALS],
      "no-restricted-imports": ["error", { patterns: [NODE_BUILTIN_IMPORTS] }],
      "no-restricted-syntax": ["error", ...GUARDED_READ_SYNTAX],
    },
  },
  {
    files: ["src/pino/**/*.ts", "src/sentry/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [NODE_BUILTIN_IMPORTS, LOG_SINK_CORE_IMPORTS] },
      ],
    },
  },
  // Core library source (everything outside the subpaths and tests):
  // edge-clean and forbidden from importing a subpath module.
  {
    files: ["src/**/*.ts"],
    ignores: [
      "src/public-error/**",
      "src/pino/**",
      "src/sentry/**",
      "src/__tests__/**",
    ],
    rules: {
      "no-restricted-globals": ["error", ...EDGE_RESTRICTED_GLOBALS],
      "no-restricted-imports": [
        "error",
        { patterns: [NODE_BUILTIN_IMPORTS, SUBPATH_BOUNDARY] },
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
  // A CommonJS consumer fixture loads the package through require().
  {
    files: ["scripts/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: {
        console: "readonly",
        require: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**", "docs/**"],
  },
];
