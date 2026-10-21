/**
 * Data that a consumer hands to the log through the custom redactor of a
 * cause. The log copies that output with the bounded copier, then the policy
 * of the outer error walks the copy.
 */
import { BaseError, StructuredError } from "../index.js";

type Log = Record<string, unknown>;

/** A cause whose custom redactor output carries `details` as given. */
export function causeWithRawDetails(
  details: unknown,
  message = "raw details",
): StructuredError<"RAW_DETAILS", "TEST"> {
  return new StructuredError({
    code: "RAW_DETAILS",
    category: "TEST",
    retryable: false,
    message,
  }).redactWith((log) => ({ ...log, details }));
}

/** An outer error whose cause returns `details` from its custom policy. */
export function errorWithRawDetails(
  details: unknown,
  message = "original",
): BaseError<"Outer"> {
  return new BaseError<"Outer">(message, causeWithRawDetails(details), {
    name: "Outer",
  });
}

/** The `details` of the cause node, after the outer policy processed them. */
export function rawDetailsOf(log: Log): unknown {
  return (log.cause as Log).details;
}
