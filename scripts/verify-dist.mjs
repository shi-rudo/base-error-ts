/**
 * Post-build check of the bundles in dist/. tsup runs it via `onSuccess`.
 *
 * The bundler rewrites a class into a renamed binding when its body reads its
 * own statics (`var _BaseError = class _BaseError ...`). Without a guard,
 * `constructor.name`, the fallback for `name`/`_tag`, reports that binding.
 * This check fails the build when a bundle leaks a mangled name.
 *
 * Coverage is derived in both directions. Every export whose prototype chain
 * reaches `Error` must have a recipe in CONSTRUCT, and every recipe must match
 * a detected export. A new error class without a recipe fails the build. A
 * class that stops matching the detection also fails the build, instead of
 * losing its check silently.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** One recipe per exported error class: how to build it, and the exact names an instance must carry. */
const CONSTRUCT = {
  BaseError: {
    make: (C) => new C("m"),
    name: "BaseError",
    tag: "BaseError",
  },
  StructuredError: {
    make: (C) =>
      new C({
        code: "SOME_CODE",
        category: "X",
        retryable: false,
        message: "m",
      }),
    name: "SOME_CODE",
    tag: "StructuredError",
  },
  StructuredAggregateError: {
    make: (C) =>
      new C({
        code: "SOME_CODE",
        category: "X",
        retryable: false,
        message: "m",
        errors: [],
      }),
    name: "SOME_CODE",
    tag: "StructuredAggregateError",
  },
  ValidationError: {
    make: (C) => new C("m"),
    name: "VALIDATION_FAILED",
    tag: "ValidationError",
  },
};

const bundles = [
  ["esm", await import(new URL("../dist/index.js", import.meta.url))],
  ["cjs", require("../dist/index.cjs")],
];

for (const [format, bundle] of bundles) {
  const detected = Object.entries(bundle)
    .filter(
      ([, value]) =>
        typeof value === "function" &&
        typeof value.prototype === "object" &&
        value.prototype instanceof Error,
    )
    .map(([exportName]) => exportName)
    .sort();

  assert.deepEqual(
    detected,
    Object.keys(CONSTRUCT).sort(),
    `${format}: the detected error-class exports and the CONSTRUCT recipes must be the same set. Update CONSTRUCT in scripts/verify-dist.mjs.`,
  );

  for (const exportName of detected) {
    const recipe = CONSTRUCT[exportName];
    const instance = recipe.make(bundle[exportName]);
    assert.equal(
      instance.name,
      recipe.name,
      `${format}: ${exportName} instance name`,
    );
    assert.equal(
      instance._tag,
      recipe.tag,
      `${format}: ${exportName} instance _tag`,
    );
  }

  class OrderRejectedError extends bundle.BaseError {}
  const subclass = new OrderRejectedError("m");
  assert.equal(
    subclass.name,
    "OrderRejectedError",
    `${format}: subclass name inference`,
  );
}

console.log("verify-dist: bundle class names are intact");
