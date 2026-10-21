import { readProperty } from "./guarded-read.js";

/**
 * Whether `value` is a native `Error` from any realm. `instanceof` is
 * realm-bound: an error from a worker, a `vm` context, an iframe, or a second
 * copy of this package fails it and would fall to the plain-object path,
 * which drops the non-enumerable `name`/`message`/`stack` and logs `{}`.
 * `Error.isError` (where the runtime has it) reads the `[[ErrorData]]`
 * slot; the `Object.prototype.toString` fallback approximates it. A plain
 * object that merely *looks* like an error is deliberately not matched: its
 * fields are enumerable, and the plain-object path keeps all of them.
 *
 * A string `Symbol.toStringTag` drives `Object.prototype.toString`, so for
 * a tag carrier the brand probes are consulted only when the value is at
 * least error-shaped (string `name` and `message`, the same shape `isError`
 * requires): a tagged non-error is data whatever a patched `Error.isError`
 * says, while a genuine cross-realm Error that carries a tag (a subclass
 * can add one) stays recognized on every runtime. The accepted residual: a
 * tagged, error-shaped forgery takes the native path and keeps only the
 * envelope. `Error.isError` runs inside its own try, and a broken patched
 * implementation falls through to the `toString` probe.
 */
export function isNativeError(value: unknown): value is Error {
  if (value instanceof Error) return true;
  if (typeof value !== "object" || value === null) return false;
  try {
    if (
      readProperty(value, Symbol.toStringTag) !== undefined &&
      (typeof readProperty(value, "name") !== "string" ||
        typeof readProperty(value, "message") !== "string")
    ) {
      return false;
    }
    const ErrorCtor = Error as { isError?: (value: unknown) => boolean };
    if (typeof ErrorCtor.isError === "function") {
      try {
        return ErrorCtor.isError(value) === true;
      } catch {
        // A broken patched Error.isError falls through to the probe below.
      }
    }
    return Object.prototype.toString.call(value) === "[object Error]";
  } catch {
    return false;
  }
}
