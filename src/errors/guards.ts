/**
 * Type guard functions for error type narrowing.
 */

import { BaseError } from "./BaseError.js";
import { StructuredError } from "./StructuredError.js";

/** Portable fields shared by native and structurally recognized errors. */
export type ErrorLike = {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
};

/** A reusable predicate that narrows an unknown value to `T`. */
export type TypeGuard<T> = (value: unknown) => value is T;

/** Constructor for an Error subclass with any concrete argument list. */
export type ErrorClass<T extends Error = Error> = abstract new (
  ...args: never[]
) => T;

type GuardTarget<G> = G extends TypeGuard<infer T> ? T : never;

type UnionToIntersection<U> = (
  U extends unknown ? (value: U) => void : never
) extends (value: infer I) => void
  ? I
  : never;

type GuardIntersection<G extends readonly TypeGuard<unknown>[]> =
  UnionToIntersection<GuardTarget<G[number]>>;

/**
 * Checks for a native Error or a structurally equivalent cross-realm value.
 * Structural matches establish shape only, not trusted domain identity.
 */
export function isError(value: unknown): value is ErrorLike {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const { name, message, stack } = value as Record<string, unknown>;
    return (
      typeof name === "string" &&
      typeof message === "string" &&
      (stack === undefined || typeof stack === "string")
    );
  } catch {
    return false;
  }
}

/** Creates a guard for an error-like value with an exact string or numeric code. */
export function hasErrorCode<const C extends string | number>(
  code: C,
): TypeGuard<ErrorLike & { readonly code: C }> {
  return (value: unknown): value is ErrorLike & { readonly code: C } => {
    if (!isError(value)) return false;

    try {
      return (value as ErrorLike & { readonly code?: unknown }).code === code;
    } catch {
      return false;
    }
  };
}

/** Creates an instanceof guard with an optional additional runtime predicate. */
export function isErrorOf<T extends Error>(
  constructor: ErrorClass<T>,
  predicate?: (error: T) => boolean,
): TypeGuard<T> {
  return (value: unknown): value is T =>
    value instanceof constructor &&
    (predicate === undefined || predicate(value));
}

/** Checks whether a value is an instance of any listed Error constructor. */
export function isAnyErrorOf<const C extends readonly ErrorClass[]>(
  value: unknown,
  constructors: C,
): value is InstanceType<C[number]> {
  return constructors.some((constructor) => value instanceof constructor);
}

/** Checks that a value satisfies every guard and narrows to their intersection. */
export function isAllOf<
  const G extends readonly [TypeGuard<unknown>, ...TypeGuard<unknown>[]],
>(value: unknown, guards: G): value is GuardIntersection<G> {
  return guards.every((guard) => guard(value));
}

/**
 * Type guard to check if a value is a BaseError instance.
 *
 * @param value - The value to check
 * @returns True if the value is a BaseError instance
 *
 * @example
 * ```ts
 * try {
 *   await someOperation();
 * } catch (error) {
 *   if (isBaseError(error)) {
 *     console.log(error.timestamp);    // TypeScript knows this exists
 *     console.log(error.timestampIso);
 *   }
 * }
 * ```
 */
export function isBaseError(value: unknown): value is BaseError<string> {
  return value instanceof BaseError;
}

/**
 * Type guard to check if a value is a StructuredError.
 *
 * Uses a two-phase check:
 * 1. Fast path: `instanceof` check for real StructuredError instances
 * 2. Fallback: Duck-typing for cross-realm objects, serialized errors, or plain objects
 *
 * @param value - The value to check
 * @returns True if the value is a StructuredError or has the StructuredError shape
 *
 * @example
 * ```ts
 * try {
 *   await someOperation();
 * } catch (error) {
 *   if (isStructuredError(error)) {
 *     console.log(error.code);      // TypeScript knows this exists
 *     console.log(error.category);
 *     console.log(error.retryable);
 *
 *     if (error.retryable) {
 *       // Retry logic
 *     }
 *   }
 * }
 * ```
 */
export function isStructuredError(
  value: unknown,
): value is StructuredError<string, string> {
  // Fast path: instanceof check
  if (value instanceof StructuredError) return true;

  // Fallback: duck-typing for cross-realm or serialized errors
  if (typeof value !== "object" || value === null) return false;

  const err = value as Record<string, unknown>;
  return (
    typeof err.code === "string" &&
    typeof err.category === "string" &&
    typeof err.retryable === "boolean"
  );
}

/**
 * Type guard to check if an error is retryable.
 * Works with any error that has a `retryable` property (duck-typing).
 *
 * @param value - The value to check
 * @returns True if the value has retryable === true
 *
 * @example
 * ```ts
 * try {
 *   await someOperation();
 * } catch (error) {
 *   if (isRetryable(error)) {
 *     // Safe to retry
 *     await retry(someOperation);
 *   } else {
 *     // Don't retry, handle error
 *     throw error;
 *   }
 * }
 * ```
 */
export function isRetryable(
  value: unknown,
): value is { retryable: true } & Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "retryable" in value &&
    (value as Record<string, unknown>).retryable === true
  );
}
