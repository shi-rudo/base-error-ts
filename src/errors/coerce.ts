import { StructuredError } from "./StructuredError.js";
import { UNKNOWN_ERROR_DEFAULTS } from "./defaults.js";
import { readProperty } from "./guarded-read.js";
import { isError, isStructuredError } from "./guards.js";

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
};

export function toStructuredError(
  value: unknown,
  options: CoerceOptions = {},
): StructuredError<string, string> {
  // Pass-through: an existing structured error keeps its own identity. The
  // return type is intentionally `StructuredError<string, string>` (not the
  // option literals) because pass-through can return any code/category.
  // Recognized by shape, not `instanceof`, so a structured error from another
  // realm or a second copy of this package passes through too. The shape
  // includes the behavior: a plain object with the three fields (a parsed
  // payload) cannot log itself and is wrapped like any other value.
  // `toLogObject` is a foreign read like any other: a throwing getter behind
  // the passing guard must wrap, not escape the catch path.
  if (
    isStructuredError(value) &&
    typeof readProperty(value, "toLogObject") === "function"
  ) {
    return value;
  }

  const code = options.code ?? UNKNOWN_ERROR_DEFAULTS.code;
  const category = options.category ?? UNKNOWN_ERROR_DEFAULTS.category;
  const retryable = options.retryable ?? UNKNOWN_ERROR_DEFAULTS.retryable;

  let message: string;
  let cause: unknown;
  if (isError(value)) {
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
  });
}
