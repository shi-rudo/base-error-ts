/**
 * Post-build check of the bundles in dist/. tsup runs it via `onSuccess`.
 *
 * The bundler rewrites a class into a renamed binding when its body reads its
 * own statics (`var _BaseError = class _BaseError …`). Without a guard,
 * `constructor.name`, the fallback for `name`/`_tag`, reports that binding.
 * This check fails the build when a bundle leaks a mangled name.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const bundles = [
  ["esm", await import(new URL("../dist/index.js", import.meta.url))],
  ["cjs", require("../dist/index.cjs")],
];

for (const [format, { BaseError, StructuredError }] of bundles) {
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
    code: "C",
    category: "X",
    retryable: false,
    message: "m",
  });
  assert.equal(structured._tag, "StructuredError", `${format}: _tag literal`);
}

console.log("verify-dist: bundle class names are intact");
