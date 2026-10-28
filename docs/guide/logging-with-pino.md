# Logging with pino

[Pino](https://getpino.io) is a fast JSON logger for Node.js. Pino has its own
error handling, and without a setup that handling bypasses the redaction of
this library. This page shows the setup that keeps the policy of each error in
the log line.

## The problem

Pino has a standard serializer for the `err` key. It reads the error object
itself and never calls `toLogObject()`. So a policy that you set with `redact`
or `redactAllow` does not hold:

| Call                            | What pino writes without the setup                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| `logger.error(err)`             | The raw message, the raw `details` and the raw cause. Pino also copies the raw message into `msg`. |
| `logger.error({ err }, "text")` | The raw message, the raw `details` and the raw cause.                                              |
| `logger.error({ err })`         | The raw message, the raw `details` and the raw cause. Pino also copies the raw message into `msg`. |

An error under any other key is safe without the setup. Pino writes it with
`JSON.stringify`, which calls `toJSON()`, and `toJSON()` is an alias of
`toLogObject()`.

## The setup

Copy this module into your application. Pino stays a dependency of your
application, not of this library.

```ts
import pino, { type LogFn, type Logger, type LoggerOptions } from "pino";
import { isBaseError, toStructuredError } from "@shirudo/base-error";

export function serializeError(value: unknown): unknown {
  if (isBaseError(value)) return value.toLogObject();
  if (value instanceof Error) return toStructuredError(value).toLogObject();
  return value;
}

function logMethod(this: Logger, args: Parameters<LogFn>, method: LogFn): void {
  const [first, ...rest] = args as unknown[];
  if (first instanceof Error) {
    method.apply(this, [
      { err: serializeError(first) },
      ...rest,
    ] as Parameters<LogFn>);
    return;
  }
  if (typeof first === "object" && first !== null) {
    const fields = first as Record<string, unknown>;
    if (fields.err instanceof Error) {
      const serialized = { ...fields, err: serializeError(fields.err) };
      method.apply(this, [serialized, ...rest] as Parameters<LogFn>);
      return;
    }
  }
  method.apply(this, args);
}

export const pinoErrorOptions: LoggerOptions = {
  serializers: { err: serializeError },
  hooks: { logMethod },
};
```

Then create your logger with these options:

```ts
const logger = pino({ ...pinoErrorOptions, level: "info" });

logger.error(error);
logger.error({ err: error, requestId }, "user lookup failed");
```

If your logger has serializers or hooks of its own, merge them with
`pinoErrorOptions`. The repository has the module, with a demo, in
[`examples/pino-logger.ts`](https://github.com/shi-rudo/base-error-ts/blob/main/examples/pino-logger.ts).

## What the setup does

The setup has two parts:

- **The serializer for `err`.** An error of this library writes its own log
  object, with its policy. Any other `Error` becomes the log object of a
  `StructuredError` with the code `UNKNOWN_ERROR`, which holds the error and
  its cause chain as its cause. Any other value stays as it is.
- **The `logMethod` hook.** Pino reads `err.message` for `msg` before any
  serializer runs. The hook gives pino the serialized error first, so `msg`
  holds the message of the log object. If the policy denies `message`, `msg`
  is masked too.

For an error that denies `message` and `email`, the line looks like this
(shortened):

```json
{
  "level": 50,
  "err": {
    "name": "USER_NOT_FOUND",
    "message": "[REDACTED]",
    "stack": "USER_NOT_FOUND: [REDACTED]\n    at …",
    "cause": { "name": "Error", "message": "[REDACTED]", "stack": "…" },
    "code": "USER_NOT_FOUND",
    "category": "NOT_FOUND",
    "retryable": false,
    "details": { "email": "[REDACTED]", "userId": "123" }
  },
  "msg": "[REDACTED]"
}
```

Your log store can filter, count and alert on `err.code`, `err.category` and
`err.retryable`. These fields are part of the contract of the log object.

## Log levels

The library does not choose a log level. That is a policy of your
application. For example, you can log a retryable error as a warning:

```ts
const level = error.retryable ? "warn" : "error";
logger[level]({ err: error }, "request failed");
```

## Limits

- The setup expects the default `errorKey` of pino, `err`. If you change
  `errorKey`, change the key that the hook reads too.
- The setup recognizes an error with `instanceof Error`. An error from a
  worker or another realm fails that test. Convert such an error with
  `toStructuredError` before you log it.
- The `redact` option of pino is a separate mechanism. It masks paths in the
  whole line, for example `req.headers.authorization`. The policy of an error
  travels with the error, also when the error is the cause of another error.
  You can use both.
- A test of this repository runs the setup against pino 10.
