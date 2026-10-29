/**
 * Reports an error to Sentry through the subpath `@shirudo/base-error/sentry`,
 * so the redaction policy of the error holds in the event.
 *
 * Without `SENTRY_DSN`, Sentry sends nothing, so the demo makes no network
 * call. Run it with `npx tsx examples/sentry-reporter.ts`.
 */
import * as Sentry from "@sentry/node";

import { StructuredError } from "../src/index.js";
import {
  beforeSend,
  logObjectContextIntegration,
} from "../src/sentry/index.js";

const error = new StructuredError({
  code: "USER_NOT_FOUND",
  category: "NOT_FOUND",
  retryable: false,
  message: "lookup for ada@example.com failed",
  details: { email: "ada@example.com", userId: "123" },
}).redact(["message", "email"]);

// #region usage
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  beforeSend,
  integrations: [logObjectContextIntegration()],
});

Sentry.captureException(error);
// #endregion usage
