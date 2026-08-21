/**
 * Post-build check of the bundles in dist/. tsup runs it via `onSuccess`.
 *
 * The bundler rewrites a class into a renamed binding when its body reads its
 * own statics (`var _BaseError = class _BaseError …`). Without a guard,
 * `constructor.name`, the fallback for `name`/`_tag`, reports that binding.
 * This check fails the build when a bundle leaks a mangled name.
 *
 * Coverage is derived, not remembered: every export whose prototype chain
 * reaches `Error` must have a construction recipe below. A new error class
 * without one fails the build, so the check can never silently lag behind
 * the export surface.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** One instance of each error class, keyed by export name. */
const CONSTRUCT = {
  BaseError: (C) => new C("m"),
  StructuredError: (C) =>
    new C({ code: "SOME_CODE", category: "X", retryable: false, message: "m" }),
  StructuredAggregateError: (C) =>
    new C({
      code: "SOME_CODE",
      category: "X",
      retryable: false,
      message: "m",
      errors: [],
    }),
  ValidationError: (C) => new C("m"),
};

const bundles = [
  ["esm", await import(new URL("../dist/index.js", import.meta.url))],
  ["cjs", require("../dist/index.cjs")],
];

for (const [format, bundle] of bundles) {
  const errorClasses = Object.entries(bundle).filter(
    ([, value]) =>
      typeof value === "function" &&
      typeof value.prototype === "object" &&
      value.prototype instanceof Error,
  );
  assert.ok(
    errorClasses.length >= 4,
    `${format}: expected the error classes among the exports, found ${errorClasses.length}`,
  );

  for (const [exportName, ErrorClass] of errorClasses) {
    const construct = CONSTRUCT[exportName];
    assert.ok(
      construct,
      `${format}: no construction recipe for exported error class "${exportName}" — add one to CONSTRUCT in scripts/verify-dist.mjs`,
    );
    const instance = construct(ErrorClass);
    assert.ok(
      !instance.name.startsWith("_"),
      `${format}: ${exportName} instance leaks a mangled name: ${instance.name}`,
    );
    assert.ok(
      !instance._tag.startsWith("_"),
      `${format}: ${exportName} instance leaks a mangled _tag: ${instance._tag}`,
    );
  }

  const { BaseError, StructuredError } = bundle;
  const base = new BaseError("m");
  assert.equal(base.name, "BaseError", `${format}: BaseError name`);
  assert.equal(base._tag, "BaseError", `${format}: BaseError _tag`);

  class OrderRejectedError extends BaseError {}
  const subclass = new OrderRejectedError("m");
  assert.equal(
    subclass.name,
    "OrderRejectedError",
    `${format}: subclass name inference`,
  );

  const structured = new StructuredError({
    code: "SOME_CODE",
    category: "X",
    retryable: false,
    message: "m",
  });
  assert.equal(structured._tag, "StructuredError", `${format}: _tag literal`);
}

console.log("verify-dist: bundle class names are intact");
