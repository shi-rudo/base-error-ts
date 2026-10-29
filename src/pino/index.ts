/**
 * The pino setup: it writes every value under `err` through
 * {@link logObjectOf}, so the redaction policy of an error holds in the log
 * line.
 *
 * Without it, pino's standard `err` serializer reads the error itself: it
 * writes the raw message, the raw `details` and the raw cause. Pino also
 * copies `err.message` into `msg` when a call has no text.
 *
 * The module imports nothing from pino. Its types describe the parts of the
 * pino options that it fills, so they fit `LoggerOptions` of pino.
 */
import { logObjectOf } from "../index.js";
import { isInstanceOf, readProperty } from "../errors/guarded-read.js";

/** The `hooks.logMethod` option of pino. */
type PinoLogMethod = (
  this: unknown,
  args: unknown[],
  method: (...args: never[]) => void,
) => void;

/** The parts of the pino options that the setup fills. */
type PinoErrorOptions = {
  readonly errorKey: "err";
  readonly serializers: { readonly err: (value: unknown) => unknown };
  readonly hooks: { readonly logMethod: PinoLogMethod };
};

/**
 * The log objects that the hook wrote. Pino runs the `err` serializer on them
 * again, and a second `logObjectOf` would copy them as data, which cuts a
 * cause chain at the data depth bound.
 */
const written = new WeakSet<object>();

function writeLogObject(value: unknown): unknown {
  const logObject = logObjectOf(value);
  if (typeof logObject === "object" && logObject !== null)
    written.add(logObject);
  return logObject;
}

function serializeError(value: unknown): unknown {
  if (typeof value === "object" && value !== null && written.has(value))
    return value;
  return logObjectOf(value);
}

/**
 * The merge object of a call with `err` replaced. A merge object that throws
 * while the hook copies it keeps only `err`, so the error still reaches the
 * line.
 */
function withLogObject(fields: object, logObject: unknown): object {
  try {
    return { ...fields, err: logObject };
  } catch {
    return { err: logObject };
  }
}

/**
 * Hands pino the log object before pino reads `err.message` for `msg`.
 * So `msg` holds the message of the log object, masked if a policy denies it.
 * Pino copies the message of a first argument only when it passes
 * `instanceof Error`. The hook uses the same test, so a merge object with a
 * `name` and a `message` stays a merge object. The first argument is often a
 * thrown value, so the hook reads it only through the guarded readers.
 */
const logMethod: PinoLogMethod = function (args, method) {
  const [first, ...rest] = args;
  if (isInstanceOf(first, Error)) {
    Reflect.apply(method, this, [{ err: writeLogObject(first) }, ...rest]);
    return;
  }
  const err = readProperty(first, "err");
  if (err !== undefined) {
    const fields = first as object;
    const merged = withLogObject(fields, writeLogObject(err));
    Reflect.apply(method, this, [merged, ...rest]);
    return;
  }
  Reflect.apply(method, this, args);
};

/**
 * Spread these options into the options of your pino logger. If your logger
 * has serializers or hooks of its own, read `serializers.err` and
 * `hooks.logMethod` from here and combine them with yours. The options set
 * `errorKey` to `err`, the key that the hook reads. With another `errorKey`,
 * pino copies the raw message of an error under that key into `msg`.
 */
export const pinoErrorOptions: PinoErrorOptions = {
  errorKey: "err",
  serializers: { err: serializeError },
  hooks: { logMethod },
};
