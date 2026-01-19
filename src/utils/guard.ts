import type { BaseError } from "../errors/BaseError.js";

/**
 * Asserts that a condition is truthy, throwing the provided error if it's falsy.
 * This function provides TypeScript type narrowing through assertion signatures.
 *
 * @template T - The error name type extending string
 * @param condition - The value to check for truthiness
 * @param error - The BaseError instance to throw if condition is falsy
 * @throws {BaseError<T>} The provided error when condition is falsy
 *
 * @example
 * ```ts
 * const user = getUser();
 * guard(user, new UserNotFoundError("User not found"));
 * // TypeScript now knows user is not null/undefined
 * console.log(user.name);
 * ```
 *
 * @example
 * ```ts
 * guard(isValidEmail(email), new ValidationError("Invalid email format"));
 * // Continues execution only if email is valid
 * ```
 */
export function guard<T extends string>(
  condition: unknown,
  error: BaseError<T>,
): asserts condition {
  if (!condition) {
    throw error;
  }
}
