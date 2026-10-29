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

Other frameworks behave differently. Do not rely on a default handler. Install
your own error handler, and send only the result of the pipeline from it.

Your handler also gets the errors that the framework raises for a bad request,
for example a body that is not valid JSON. If the catalog does not register
them, the fallback answers `500` where the default handler answered `400`.
Register each error that a client can cause. In Fastify, these errors carry a
`code`:

```ts
const catalog = definePublicErrors({
  fallback: { publicCode: "internal_error", status: 500 },
})
  .registerByCode("FST_ERR_CTP_INVALID_JSON_BODY", {
    publicCode: "invalid_json",
    status: 400,
  })
  .registerByCode("FST_ERR_VALIDATION", {
    publicCode: "invalid_request",
    status: 400,
  })
  .registerByCode("FST_ERR_CTP_BODY_TOO_LARGE", {
    publicCode: "payload_too_large",
    status: 413,
  });

app.setErrorHandler((error, request, reply) => {
  const { status, headers, body } = toProblem(catalog, project(catalog, error));
  return reply.status(status).headers(headers).send(body);
});
```

Fastify has more of these codes, for example `FST_ERR_CTP_EMPTY_JSON_BODY`
(400) and `FST_ERR_CTP_INVALID_MEDIA_TYPE` (415).

In Express, register an error middleware with four parameters after the routes,
and send the same result from it. The errors of `express.json()` have no
`code`. They have a `type`, for example `entity.parse.failed` (400) and
`entity.too.large` (413). Register them with `register` and a `match` function.

Log the error in the same handler, see [Logging with pino](./logging-with-pino).

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

`_tag` (and an inferred `name`) fall back to `this.constructor.name`, which most
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

## 6. Redaction covers the log object, not `err.stack` or string interpolation

`redact` / `redactAllow` / `redactWith` rewrite `toLogObject()` / `toJSON()`.
A deny-listed `"name"` or `"message"` is also masked in log stack headers on
the root, causes, and aggregate members. Recognized headers reuse the masked
fields and keep the frames; other stacks are masked as a whole.
`toString()` masks a deny-listed message, but two common sinks stay raw:

```ts
err.redact(["message", "apiKey"]);

JSON.stringify(err); // ✓ redacted, stack headers included
`${err}`; // ✓ message masked (toString)
err.stack; // ✗ the property keeps the raw message in its header
console.log(err); // ✗ Node inspection prints that property → raw message
```

When redaction matters, route errors through a structured serializer that hits
`toJSON` (`logger.error({ err })`) instead of interpolating them into log
strings. See [Observability](./observability#redacting-pii-from-logs).

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
