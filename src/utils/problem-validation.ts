/**
 * Shared RFC 9457 / HTTP helpers. One definition of "a valid problem status", "a
 * usable type/title string", and the problem media type, reused across the
 * public-error pipeline (projection, catalog registration, and the transport
 * stage) so the rules cannot drift between them.
 */

/** Media type for RFC 9457 JSON problem details. */
export const PROBLEM_DETAILS_JSON = "application/problem+json" as const;

/** True for an integer HTTP status in the RFC 9457 range [100, 599]. */
export function isHttpStatusCode(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
  );
}

/** True for a non-empty string (an RFC 9457 `type` URI reference, or a code). */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * True for a non-negative safe integer, the delay-seconds form of `Retry-After`.
 * RFC 9110 requires plain digits, and `String()` writes a number of 1e21 or more
 * in exponent notation. A safe integer always prints as its exact digits.
 */
export function isRetryAfterSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
