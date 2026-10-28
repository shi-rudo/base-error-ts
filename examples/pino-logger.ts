/**
 * A pino setup that writes every error through `toLogObject()`, so the
 * redaction policy of an error holds in the log line.
 *
 * Without it, pino's standard `err` serializer reads the error itself: it
 * writes the raw message, the raw `details` and the raw cause. Pino also
 * copies `err.message` into `msg` when a call has no text.
 *
 * Run the demo with `npx tsx examples/pino-logger.ts`.
 */
import { pathToFileURL } from "node:url";

import pino, { type LogFn, type Logger, type LoggerOptions } from "pino";

import {
  StructuredError,
  isBaseError,
  toStructuredError,
} from "../src/index.js";

/**
 * The value that pino writes under `err`. An error of this library writes
 * its own log object, with its redaction policy. Any other `Error` becomes
 * the log object of a `StructuredError` that holds it as its cause. Every
 * other value stays as it is.
 */
export function serializeError(value: unknown): unknown {
  if (isBaseError(value)) return value.toLogObject();
  if (value instanceof Error) return toStructuredError(value).toLogObject();
  return value;
}

/**
 * Hands pino the serialized error before pino reads `err.message` for `msg`.
 * So `msg` holds the message of the log object, masked if a policy denies it.
 */
function logMethod(this: Logger, args: Parameters<LogFn>, method: LogFn): void {
  const [first, ...rest] = args as unknown[];
  if (first instanceof Error) {
    method.apply(this, [
      { err: serializeError(first) },
      ...rest,
    ] as Parameters<LogFn>);
    return;
  }
  if (typeof first === "object" && first !== null) {
    const fields = first as Record<string, unknown>;
    if (fields.err instanceof Error) {
      const serialized = { ...fields, err: serializeError(fields.err) };
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

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) demo();
