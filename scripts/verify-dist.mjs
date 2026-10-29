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
 *
 * The pino and sentry subpaths must share the core of the root entry. A
 * subpath bundle with its own copy of `BaseError` does not recognize an error
 * of the root entry, so the policy of that error does not hold, and the log
 * line or the Sentry event carries the raw message. The check builds a
 * masked error with the root bundle and runs it through both subpaths.
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

const subpathBundles = [
  [
    "esm",
    bundles[0][1],
    await import(new URL("../dist/pino/index.js", import.meta.url)),
    await import(new URL("../dist/sentry/index.js", import.meta.url)),
  ],
  [
    "cjs",
    bundles[1][1],
    require("../dist/pino/index.cjs"),
    require("../dist/sentry/index.cjs"),
  ],
];

for (const [format, core, pino, sentry] of subpathBundles) {
  const masked = new core.StructuredError({
    code: "SOME_CODE",
    category: "X",
    retryable: false,
    message: "raw message",
  }).redact(["message"]);
  assert.equal(
    pino.pinoErrorOptions.serializers.err(masked).message,
    "[REDACTED]",
    `${format}: the pino subpath must share the core of the root entry`,
  );
  const event = sentry.beforeSend(
    { exception: { values: [{ type: "Error", value: "raw message" }] } },
    { originalException: masked },
  );
  assert.equal(
    event.exception.values[0].value,
    "[REDACTED]",
    `${format}: the sentry subpath must share the core of the root entry`,
  );
}

console.log(
  "verify-dist: bundle class names are intact, and the subpaths share the core",
);
