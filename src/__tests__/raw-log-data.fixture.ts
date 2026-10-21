/**
 * Raw data for the redaction walker. The library copies every value that it
 * reads from an error, so the walker meets uncopied data only in the custom
 * redactor output of a cause. The policy of the outer error processes that
 * output as it is.
 */
import { BaseError, StructuredError } from "../index.js";

type Log = Record<string, unknown>;

/** A cause whose custom redactor output carries `details` uncopied. */
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

/** An outer error whose cause hands `details` uncopied to its policy. */
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
