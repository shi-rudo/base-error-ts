# Pitfalls

A short list of the surprising-the-first-time behaviors. None are bugs. Most
follow from the [safe-by-default](./safe-by-default) design, and all of them are
worth knowing.

## 1. `JSON.stringify(error)` and `res.json(error)` expose everything

This is the most important one. `toJSON()` is an alias of `toLogObject()`, so the
default JSON serialization is the **full, unredacted** payload: technical
message, stack, cause chain and full `details`.

```ts
JSON.stringify(error); // ← full technical dump
res.json(error); // ← leaks it to the client
Response.json(error); // ← same
return error; // ← framework auto-serializes via toJSON → leak
```

Anything that auto-serializes an object reaches `toJSON()`. Never send
`toLogObject()` / `toJSON()` output to a client. **Produce the client payload
through the [public-error pipeline](./public-error):**

```ts
const { status, body } = toProblem(catalog, project(catalog, error));
res.status(status).json(body); // ✓ safe RFC 9457 problem body
```

Rule of thumb: `toLogObject()` / `toJSON()` go to your logger; the pipeline's
`PublicError` (or the `ProblemDetails` body from `toProblem`) goes to the
response.

## 2. The default error handler of a framework sends the `message`

A framework answers a thrown error with its default error handler. That handler
does not call the pipeline. It reads the fields of the error itself:

- Fastify 5 without `setErrorHandler` sends the internal `code` and the
  technical `message`:

  ```json
  {
    "statusCode": 500,
    "code": "USER_NOT_FOUND",
    "error": "Internal Server Error",
    "message": "No user 42 in the primary database"
  }
  ```

- Express 5 sends the stack when `NODE_ENV` is not `production`. The stack
  header holds the message. Express reads `NODE_ENV` when it creates the app,
  and a missing value means `development`. With `NODE_ENV=production`, Express
  sends only `Internal Server Error`.

- Nest 12 answers an error that is not an `HttpException` with
  `Internal server error`. It sends the text of an `HttpException` and of the
  JSON parser.

Other frameworks behave differently. Do not rely on a default handler. Install
your own error handler, and send only the result of the pipeline from it.

Your handler also gets the errors that the framework raises for a bad request,
for example a body that is not valid JSON. If the catalog does not register
them, the fallback answers `500` where the default handler answered `400`.
Register each error that a client can cause.

A handler of your own also replaces the logging of the default handler. Log the
error in your handler, or the error reaches no log. The snippets log a status
of 500 and more at the level `error`, so a client mistake starts no alert.

Some answers do not reach the error handler. Fastify and Express raise no error
for an unknown route, and Fastify answers a bad URL before the error handler can
run. Send the result of the pipeline on these paths too.

In Fastify, the errors of a bad request carry a `code`:

```ts
import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import { StructuredError } from "@shirudo/base-error";
import {
  definePublicErrors,
  project,
  toProblem,
} from "@shirudo/base-error/public-error";
```

<<< @/../examples/fastify-error-handler.ts#usage{ts}

Fastify has more of these codes. Register each code that your routes can raise.

In Express, register an error middleware with four parameters after the routes,
and send the same result from it. The errors of `express.json()` have no
`code`. They have a `type`, for example `entity.parse.failed` (400),
`entity.too.large` (413), `charset.unsupported` (415) and
`encoding.unsupported` (415). Register them with `register` and a `match`
function. The router raises a `URIError` with the status 400 for a bad URL.
Express has more of these errors. Register each one that your routes can raise.

```ts
import express from "express";
import type { ErrorRequestHandler } from "express";
import { StructuredError } from "@shirudo/base-error";
import {
  definePublicErrors,
  project,
  toProblem,
} from "@shirudo/base-error/public-error";
```

<<< @/../examples/express-error-handler.ts#usage{ts}

In Nest, register an exception filter with `@Catch()`. It receives each
exception, also the `HttpException` that Nest raises for an unknown route or a
bad request. Register an `HttpException` by its status with `register` and a
`match` function. If the catalog does not register the status, the fallback
answers `500`. So register each status that your controllers raise. The snippet
uses the Express platform of Nest.

```ts
import { Catch, HttpException } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import type { Response } from "express";
import {
  definePublicErrors,
  project,
  toProblem,
} from "@shirudo/base-error/public-error";
```

<<< @/../examples/nest-exception-filter.ts#usage{ts}

In these snippets, `logger` is a pino logger with `pinoErrorOptions`, see
[Logging with pino](./logging-with-pino). `routes` is the router that holds your
routes, and `app` is your Nest application.

After the first chunk of a response, an Express error middleware or a Nest
filter cannot send a problem. Close the connection with `response.destroy()`. In
Express, do not call `next(error)` there: Express then prints the raw error to
stderr, past the redaction of the log object.

A handler does not remove the headers that a route set before it threw. The
default handlers of Fastify 5 and Express 5 keep them too. If a route sets a
header such as `cache-control` or `set-cookie` before it can throw, remove that
header in your handler.

The snippets come from `examples/fastify-error-handler.ts`,
`examples/express-error-handler.ts` and `examples/nest-exception-filter.ts`. CI
runs them against Fastify 5, Express 5 and Nest 12. Each example sends real requests to its own routes. It compares the
status, the content type and the body of each response with the public problem,
and it reads the log lines. It checks no other header. Fastify answers a request
with a broken `Content-Length` before any handler can run, with the text
`Client Error`.

## 3. `StructuredError.name` is the `code`, not `"StructuredError"`

A `StructuredError` sets its `name` (and stack header) to its `code`:

```ts
const e = new StructuredError({ code: "USER_NOT_FOUND" /* … */ });
e.name; // "USER_NOT_FOUND", not "StructuredError"
```

So `err.name === "StructuredError"` is always false. Use `instanceof`,
`isStructuredError(err)`, or switch on `err.code`.

## 4. `project` is total: an unmapped error becomes the generic fallback

`project` never throws and never leaks. If an error matches no catalog entry, it
degrades to the generic fallback, **silently** from the caller's point of view:

```ts
project(catalog, somethingUnregistered);
// { code: "internal_error", category: "internal", retryable: false }
```

That is the safety guarantee, but it can hide a missing registration. Use the
`onProject` hook to surface `kind: "fallback"` outcomes to your telemetry so an
unmapped error class shows up as a metric rather than a generic 500.

## 5. Class-name minification and the `_tag` discriminant

`_tag` (and an inferred `name`) fall back to `new.target.name`, which most
production minifiers mangle by default (esbuild `keepNames: false`, terser/swc
`keep_classnames: false`). This only affects the **inference fallback**:

- `StructuredError` fixes `_tag` to a stable literal and uses `code` as its real
  discriminant (**safe out of the box**).
- `instanceof` / `isStructuredError` are unaffected (prototype-based).
- Only **plain `BaseError` subclasses relying on name inference** are at risk.
  Pass an explicit `name` (which now stabilizes both `name` and `_tag`), or
  override `_tag` with a literal:

```ts
class PaymentDeclinedError extends BaseError<"PaymentDeclinedError"> {
  readonly _tag = "PaymentDeclinedError" as const; // stable + strictly typed
}
```

## 6. Redaction covers the log object, not `err.stack`, `console.log` or string interpolation

`redact` / `redactAllow` / `redactWith` rewrite `toLogObject()` / `toJSON()`.
A deny-listed `"name"` or `"message"` is also masked in log stack headers on
the root, causes, and aggregate members. Recognized headers reuse the masked
fields and keep the frames; other stacks are masked as a whole.
`toString()` masks only a deny-listed message, and two common sinks stay raw:

```ts
err.redact(["message", "apiKey"]);

JSON.stringify(err); // ✓ redacted, stack headers included
console.log(logObjectOf(err)); // ✓ the same log object
`${err}`; // ✓ the message of the error and of each cause masked
err.stack; // ✗ the property keeps the raw message in its header
console.log(err); // ✗ prints the error itself, with raw values
```

`console.log`, `console.error` and `util.inspect` do not read the log object.
They print the error itself. On Node and Bun, that output holds the stack with
the raw message and every own field with its raw value, such as `details`. It
also holds the cause and the members of an aggregate, with their raw values.
Treat the output of every console as raw.

`toString()` applies a deny-list on `"message"` to the message of the error and
of every cause and aggregate member below it, as the log object does. It does
not apply `redactWith`, and it renders no `details`.

A deny-list matches only a key with the same case. `redact(["authorization"])`
does not mask `Authorization`. See
[Observability](./observability#redacting-pii-from-logs).

When redaction matters, log `logObjectOf(err)`, or use a logger setup that calls
it, such as the [pino setup](./logging-with-pino). A plain pino logger reads the
error itself, so `logger.error({ err })` leaks there too. Do not pass the error
to `console.log`, and do not interpolate it into log strings. See
[Observability](./observability#redacting-pii-from-logs).

## 7. `publicIssues({ messages: true })` passes the validator's `message` through

`publicIssues()` leaves the `message` of an issue out. With `messages: true` it
crosses unchanged. The default messages of Valibot and ArkType embed the rejected
value, and so does Zod 3 for `enum`:

```ts
v.publicIssues({ messages: true })[0].message;
// 'Invalid email: Received "hunter2"' ← Valibot's default message, on the wire
```

Pass `messages: true` only for messages that you wrote. Otherwise project
`pointer` and `code` only. See [Validation](./validation#messages-cross-only-on-opt-in).
