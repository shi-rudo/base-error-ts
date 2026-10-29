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
 * The package ships one ES module build, so `require` and `import` of the
 * package must load the same `BaseError` class, and the pino and sentry
 * subpaths must share it. With a second class, `logObjectOf` does not
 * recognize an error of the other class, so the policy of that error does not
 * hold, and the log line or the Sentry event carries the raw message. The
 * check builds a masked error through `import` and through `require` and runs
 * it through both subpaths.
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

const bundle = await import(new URL("../dist/index.js", import.meta.url));

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
  "the detected error-class exports and the CONSTRUCT recipes must be the same set. Update CONSTRUCT in scripts/verify-dist.mjs.",
);

for (const exportName of detected) {
  const recipe = CONSTRUCT[exportName];
  const instance = recipe.make(bundle[exportName]);
  assert.equal(instance.name, recipe.name, `${exportName} instance name`);
  assert.equal(instance._tag, recipe.tag, `${exportName} instance _tag`);
}

class OrderRejectedError extends bundle.BaseError {}
assert.equal(
  new OrderRejectedError("m").name,
  "OrderRejectedError",
  "subclass name inference",
);

const required = require("@shirudo/base-error");
assert.equal(
  required.BaseError,
  bundle.BaseError,
  "require and import of the package must load the same BaseError class",
);

const pino = await import(new URL("../dist/pino/index.js", import.meta.url));
const sentry = await import(
  new URL("../dist/sentry/index.js", import.meta.url)
);

for (const [loader, core] of [
  ["import", bundle],
  ["require", required],
]) {
  const masked = new core.StructuredError({
    code: "SOME_CODE",
    category: "X",
    retryable: false,
    message: "raw message",
  }).redact(["message"]);
  assert.equal(
    pino.pinoErrorOptions.serializers.err(masked).message,
    "[REDACTED]",
    `${loader}: the pino subpath must share the core of the root entry`,
  );
  const event = sentry.beforeSend(
    { exception: { values: [{ type: "Error", value: "raw message" }] } },
    { originalException: masked },
  );
  assert.equal(
    event.exception.values[0].value,
    "[REDACTED]",
    `${loader}: the sentry subpath must share the core of the root entry`,
  );
}

console.log(
  "verify-dist: bundle class names are intact, and require, import and the subpaths share one core",
);
