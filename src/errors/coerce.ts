import { StructuredError } from "./StructuredError.js";
import { UNKNOWN_ERROR_DEFAULTS } from "./defaults.js";

/** Fallback configuration for {@link toStructuredError}. */
export type CoerceOptions = {
  /** Internal code for the fallback. Default: `"UNKNOWN_ERROR"`. */
  code?: string;
  /** Internal category for the fallback. Default: `"INTERNAL"`. */
  category?: string;
  /** Retryable flag for the fallback. Default: `false`. */
  retryable?: boolean;
  /** Override the technical message (otherwise derived from the value). */
  message?: string;
  /** Stable, client-safe public code for the fallback. */
  publicCode?: string;
  /** Client-safe public message for the fallback. */
  publicMessage?: string;
};

export function toStructuredError(
  value: unknown,
  options: CoerceOptions = {},
): StructuredError<string, string> {
  // Pass-through: an existing structured error keeps its own identity. The
  // return type is intentionally `StructuredError<string, string>` (not the
  // option literals) because pass-through can return any code/category.
  if (value instanceof StructuredError) {
    return value;
  }

  const code = options.code ?? UNKNOWN_ERROR_DEFAULTS.code;
  const category = options.category ?? UNKNOWN_ERROR_DEFAULTS.category;
  const retryable = options.retryable ?? UNKNOWN_ERROR_DEFAULTS.retryable;

  let message: string;
  let cause: unknown;
  if (value instanceof Error) {
    message = options.message ?? value.message;
    cause = value;
  } else if (typeof value === "string") {
    message = options.message ?? value;
    cause = undefined;
  } else {
    message = options.message ?? UNKNOWN_ERROR_DEFAULTS.message;
    // Preserve the raw value (object/number/null) for observability.
    cause = value;
  }

  return new StructuredError<string, string>({
    code,
    category,
    retryable,
    message,
    ...(cause !== undefined && { cause }),
    ...(options.publicCode !== undefined && { publicCode: options.publicCode }),
    ...(options.publicMessage !== undefined && {
      publicMessage: options.publicMessage,
    }),
  });
}
