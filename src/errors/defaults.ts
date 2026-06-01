/**
 * Canonical fallback identity for an unclassified or unrecognized error.
 *
 * Shared by {@link toStructuredError} (coercing a caught value) and
 * `StructuredError.fromJSON` (reconstructing a malformed payload) so the two
 * paths can never drift on what the library's default error looks like.
 */
export const UNKNOWN_ERROR_DEFAULTS = {
  /** Internal code used when none is known. */
  code: "UNKNOWN_ERROR",
  /** Internal category used when none is known. */
  category: "INTERNAL",
  /** Unknown errors are not retryable by default. */
  retryable: false,
  /** Technical message used when none can be derived. */
  message: "Unknown error",
} as const;
