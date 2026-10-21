// Loads both entry points of the packed package through the "require"
// condition of its exports map and runs one error through the core and the
// public-error pipeline.
const assert = require("node:assert/strict");

const { StructuredError, isStructuredError } = require("@shirudo/base-error");
const {
  definePublicErrors,
  project,
  toProblem,
} = require("@shirudo/base-error/public-error");

const error = new StructuredError({
  code: "EMAIL_TAKEN",
  category: "CONFLICT",
  retryable: false,
  message: "email taken",
});
const catalog = definePublicErrors({
  fallback: { publicCode: "internal_error", status: 500 },
}).registerByCode("EMAIL_TAKEN", { publicCode: "email_taken", status: 409 });

const { status, body } = toProblem(catalog, project(catalog, error));

assert.equal(error.name, "EMAIL_TAKEN");
assert.equal(isStructuredError(error), true);
assert.equal(error.toLogObject().code, "EMAIL_TAKEN");
assert.equal(status, 409);
assert.equal(body.code, "email_taken");
assert.equal(JSON.stringify(body).includes("email taken"), false);
console.log("cjs runtime: passed");
