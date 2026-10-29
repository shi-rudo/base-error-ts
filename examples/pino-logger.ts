/**
 * A pino setup that writes every value under `err` through `logObjectOf()`,
 * so the redaction policy of an error holds in the log line.
 *
 * Without it, pino's standard `err` serializer reads the error itself: it
 * writes the raw message, the raw `details` and the raw cause. Pino also
 * copies `err.message` into `msg` when a call has no text.
 *
 * Run the demo with `npx tsx examples/pino-logger.ts`.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pino, { type LogFn, type Logger, type LoggerOptions } from "pino";

import { StructuredError, logObjectOf } from "../src/index.js";

// #region module
/**
 * The log objects that the hook wrote. Pino runs the `err` serializer on them
 * again, and a second `logObjectOf` would copy them as data, which cuts a
 * cause chain at the data depth bound.
 */
const written = new WeakSet<object>();

function writeLogObject(value: unknown): unknown {
  const logObject = logObjectOf(value);
  if (typeof logObject === "object" && logObject !== null)
    written.add(logObject);
  return logObject;
}

/** The value that pino writes under `err`. */
export function serializeError(value: unknown): unknown {
  if (typeof value === "object" && value !== null && written.has(value))
    return value;
  return logObjectOf(value);
}

/**
 * Hands pino the log object before pino reads `err.message` for `msg`.
 * So `msg` holds the message of the log object, masked if a policy denies it.
 * Pino copies the message of a first argument only when it passes
 * `instanceof Error`. The hook uses the same test, so a merge object with a
 * `name` and a `message` stays a merge object.
 */
function logMethod(this: Logger, args: Parameters<LogFn>, method: LogFn): void {
  const [first, ...rest] = args as unknown[];
  if (first instanceof Error) {
    method.apply(this, [
      { err: writeLogObject(first) },
      ...rest,
    ] as Parameters<LogFn>);
    return;
  }
  if (typeof first === "object" && first !== null) {
    const fields = first as Record<string, unknown>;
    if (fields.err !== undefined) {
      const serialized = { ...fields, err: writeLogObject(fields.err) };
      method.apply(this, [serialized, ...rest] as Parameters<LogFn>);
      return;
    }
  }
  method.apply(this, args);
}

/** Spread these options into the options of your pino logger. */
export const pinoErrorOptions: LoggerOptions = {
  serializers: { err: serializeError },
  hooks: { logMethod },
};

// #endregion module

function demo(): void {
  const logger = pino(pinoErrorOptions);
  const error = new StructuredError({
    code: "USER_NOT_FOUND",
    category: "NOT_FOUND",
    retryable: false,
    message: "lookup for ada@example.com failed",
    details: { email: "ada@example.com", userId: "123" },
    cause: new Error("db password=hunter2 rejected"),
  }).redact(["message", "email"]);

  logger.error(error);
  logger.error({ err: error, requestId: "r-1" }, "user lookup failed");
}

const entry = process.argv[1];
if (
  entry !== undefined &&
  realpathSync(entry) === fileURLToPath(import.meta.url)
)
  demo();
