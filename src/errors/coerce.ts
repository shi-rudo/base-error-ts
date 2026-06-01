import { StructuredError } from "./StructuredError.js";

/** Fallback configuration for {@link toStructuredError}. */
export type CoerceOptions<
  TCode extends string = "UNKNOWN_ERROR",
  TCategory extends string = "INTERNAL",
> = {
  /** Internal code for the fallback. Default: `"UNKNOWN_ERROR"`. */
  code?: TCode;
  /** Internal category for the fallback. Default: `"INTERNAL"`. */
  category?: TCategory;
  /** Retryable flag for the fallback. Default: `false`. */
  retryable?: boolean;
  /** Override the technical message (otherwise derived from the value). */
  message?: string;
  /** Stable, client-safe public code for the fallback. */
  publicCode?: string;
  /** Client-safe public message for the fallback. */
  publicMessage?: string;
};

export function toStructuredError<
  TCode extends string = "UNKNOWN_ERROR",
  TCategory extends string = "INTERNAL",
>(
  value: unknown,
  options: CoerceOptions<TCode, TCategory> = {},
): StructuredError<TCode, TCategory> {
  // Pass-through: an existing structured error keeps its own identity.
  if (value instanceof StructuredError) {
    return value as StructuredError<TCode, TCategory>;
  }

  const code = (options.code ?? "UNKNOWN_ERROR") as TCode;
  const category = (options.category ?? "INTERNAL") as TCategory;
  const retryable = options.retryable ?? false;

  let message: string;
  let cause: unknown;
  if (value instanceof Error) {
    message = options.message ?? value.message;
    cause = value;
  } else if (typeof value === "string") {
    message = options.message ?? value;
    cause = undefined;
  } else {
    message = options.message ?? "Unknown error";
    // Preserve the raw value (object/number/null) for observability.
    cause = value;
  }

  return new StructuredError<TCode, TCategory>({
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
