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

An error of this library under any other key keeps its policy without the
setup. Pino writes it with `JSON.stringify`, which calls `toJSON()`, an alias of
`toLogObject()`. A native `Error` under any other key comes out as `{}`, because
its fields are not enumerable. To keep it, log it under `err`, or write
`logObjectOf(error)` under the other key.

## The setup

Copy these imports and the module that follows them into your application.
Pino stays a dependency of your application, not of this library.

```ts
import pino, { type LogFn, type Logger, type LoggerOptions } from "pino";
import { logObjectOf } from "@shirudo/base-error";
```

<<< @/../examples/pino-logger.ts#module{ts}

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

- **The `logMethod` hook.** Pino reads `err.message` for `msg` before any
  serializer runs. The hook gives pino the log object of the value first, so
  `msg` holds the message of the log object. If the policy denies `message`,
  `msg` is masked too.
- **The serializer for `err`.** It writes every value with
  [`logObjectOf()`](./observability#any-thrown-value-logobjectof). An error of
  this library writes its own log object, with its policy. A native `Error`
  keeps its own name and message, and its cause chain. Any other value becomes
  a copy of log data. The serializer passes a log object that the hook wrote
  through unchanged. A second pass would copy it as data and cut a deep cause
  chain at the data depth bound.

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
- Pino and the setup recognize an error in the first argument with
  `instanceof Error`. An error from a `node:vm` context fails this test, and
  pino writes it as a merge object without its message. Log such an error under
  `err`: `logger.error({ err: error })`. An error that a worker posts arrives as
  a copy in the receiving realm and passes the test.
- If your dependency tree holds two copies of this package, an error from the
  other copy logs without its policy. `logObjectOf` writes it like a foreign
  error. Deduplicate the package.
- The `redact` option of pino is a separate mechanism. It masks paths in the
  whole line, for example `req.headers.authorization`. The policy of an error
  travels with the error, also when the error is the cause of another error.
  You can use both.
- A test of this repository runs the setup against pino 10.
