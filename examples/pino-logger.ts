/**
 * Logs an error with pino through the subpath `@shirudo/base-error/pino`, so
 * the redaction policy of the error holds in the log line.
 *
 * Run the demo with `npx tsx examples/pino-logger.ts`.
 */
import pino from "pino";

import { StructuredError } from "../src/index.js";
import { pinoErrorOptions } from "../src/pino/index.js";

const error = new StructuredError({
  code: "USER_NOT_FOUND",
  category: "NOT_FOUND",
  retryable: false,
  message: "lookup for ada@example.com failed",
  details: { email: "ada@example.com", userId: "123" },
  cause: new Error("db password=hunter2 rejected"),
}).redact(["message", "email"]);

// #region usage
const logger = pino({ ...pinoErrorOptions, level: "info" });

logger.error(error);
logger.error({ err: error, requestId: "r-1" }, "user lookup failed");
// #endregion usage
