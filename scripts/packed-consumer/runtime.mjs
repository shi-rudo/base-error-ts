// Loads every entry point of the packed package through the "import"
// condition of its exports map. It runs one error through the core, the
// public-error pipeline, the pino setup and the Sentry setup.
import assert from "node:assert/strict";

import { StructuredError, isStructuredError } from "@shirudo/base-error";
import {
  definePublicErrors,
  project,
  toProblem,
} from "@shirudo/base-error/public-error";
import { pinoErrorOptions } from "@shirudo/base-error/pino";
import { beforeSend } from "@shirudo/base-error/sentry";

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
assert.equal(pinoErrorOptions.serializers.err(error).code, "EMAIL_TAKEN");
const event = beforeSend(
  { exception: { values: [{ type: "Error", value: "raw" }] } },
  { originalException: error },
);
assert.equal(event.exception.values[0].type, "EMAIL_TAKEN");
assert.equal(event.exception.values[0].value, "email taken");
const masked = new StructuredError({
  code: "EMAIL_TAKEN",
  category: "CONFLICT",
  retryable: false,
  message: "ada@example.com is taken",
}).redact(["message"]);
assert.equal(pinoErrorOptions.serializers.err(masked).message, "[REDACTED]");
const maskedEvent = beforeSend(
  { exception: { values: [{ type: "Error", value: "raw" }] } },
  { originalException: masked },
);
assert.equal(maskedEvent.exception.values[0].value, "[REDACTED]");
console.log("esm runtime: passed");
