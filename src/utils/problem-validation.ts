/**
 * Shared RFC 9457 / HTTP helpers. One definition of "a valid problem status", "a
 * usable type/title string", and the problem media type, reused by the
 * problem-details adapter and the public-error catalog so the two cannot drift.
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

/** True for a non-negative integer, the delay-seconds form of `Retry-After`. */
export function isRetryAfterSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
