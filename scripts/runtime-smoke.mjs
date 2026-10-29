/**
 * Smoke check of the built package on the current JavaScript runtime.
 * The vitest suite runs on Node and workerd only; this script carries the
 * load-bearing behaviors to runtimes the suite cannot reach (Bun, Deno).
 * Run `npx tsup` first, then run this file with the target runtime.
 */
import { BaseError, StructuredError } from "../dist/index.js";
import {
  definePublicErrors,
  project,
  toProblem,
} from "../dist/public-error/index.js";
import { pinoErrorOptions } from "../dist/pino/index.js";
import { beforeSend } from "../dist/sentry/index.js";

const failures = [];
function check(name, ok) {
  if (!ok) failures.push(name);
}

// Construction and identity.
const base = new BaseError("m");
check("BaseError name", base.name === "BaseError");
check("lazy stack reads as a string", typeof base.stack === "string");

// Totality: a hostile cause must not break the log path.
const hostile = new Error("hostile");
Object.defineProperty(hostile, "stack", {
  get() {
    throw new Error("stack getter");
  },
});
const hostileLog = new BaseError("outer", hostile).toLogObject();
check(
  "throwing stack getter reads as absent",
  hostileLog.cause.message === "hostile" &&
    hostileLog.cause.stack === undefined,
);
check(
  "bigint cause serializes as its decimal string",
  new BaseError("outer", 10n).toLogObject().cause === "10",
);

// Redaction masks a denied key.
const redacted = new StructuredError({
  code: "C",
  category: "X",
  retryable: false,
  message: "m",
  details: { password: "secret", keep: "visible" },
})
  .redact(["password"])
  .toLogObject();
check(
  "redact masks the denied key and keeps the rest",
  redacted.details.password === "[REDACTED]" &&
    redacted.details.keep === "visible",
);

// Wire round-trip keeps aggregate members.
const aggregate = new AggregateError(
  [new Error("branch 0"), new Error("branch 1")],
  "fan-out",
);
const wrapped = new StructuredError({
  code: "OUTER",
  category: "INTERNAL",
  retryable: false,
  message: "outer",
  cause: aggregate,
});
const restored = StructuredError.fromJSON(JSON.parse(JSON.stringify(wrapped)));
check(
  "fromJSON restores the aggregate members",
  restored.code === "OUTER" &&
    Array.isArray(restored.cause?.errors) &&
    restored.cause.errors.length === 2 &&
    restored.cause.errors[1].message === "branch 1",
);

// The public-error pipeline: registered code and fallback.
const publicErrors = definePublicErrors({
  fallback: { publicCode: "internal_error", status: 500 },
}).registerByCode("OUTER", { publicCode: "outer_failed", status: 502 });
const problem = toProblem(publicErrors, project(publicErrors, wrapped));
check(
  "toProblem maps a registered code",
  problem.status === 502 && problem.body.code === "outer_failed",
);
const fallback = toProblem(
  publicErrors,
  project(publicErrors, new Error("unregistered")),
);
check(
  "an unregistered error degrades to the fallback",
  fallback.status === 500 &&
    fallback.body.code === "internal_error" &&
    JSON.stringify(fallback.body).includes("unregistered") === false,
);

// The pino and sentry subpaths share the core of the root entry, so the
// policy of an error of the root entry holds in both.
const masked = new StructuredError({
  code: "LOOKUP_FAILED",
  category: "INTERNAL",
  retryable: false,
  message: "raw message",
}).redact(["message"]);
check(
  "the pino subpath keeps the policy of a root-entry error",
  pinoErrorOptions.serializers.err(masked).message === "[REDACTED]",
);
const event = beforeSend(
  { exception: { values: [{ type: "Error", value: "raw message" }] } },
  { originalException: masked },
);
check(
  "the sentry subpath keeps the policy of a root-entry error",
  event.exception.values[0].value === "[REDACTED]",
);

if (failures.length > 0) {
  console.error(`runtime smoke: ${failures.length} checks failed:`);
  for (const name of failures) console.error(`  FAIL ${name}`);
  throw new Error("runtime smoke failed");
}
console.log("runtime smoke: all checks passed");
