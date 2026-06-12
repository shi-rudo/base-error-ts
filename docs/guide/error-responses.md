# Error responses

`toErrorResponse()` produces a discriminated `ErrorResponse` (the mirror of a
`SuccessResponse`) for RPC-style and HTTP APIs that use a
`{ isSuccess, ... }` envelope.

```ts
const error = new StructuredError({
  code: "USER_NOT_FOUND",
  category: "NOT_FOUND",
  retryable: false,
  message: "User 123 not found",
}).addLocalizedMessage("de", "Benutzer nicht gefunden");

const response = error.toErrorResponse({
  httpStatusCode: 404,
  locale: "de",
  traceId: "trace-abc-123",
});
// {
//   isSuccess: false,
//   error: {
//     code: "INTERNAL_ERROR",
//     category: "INTERNAL",
//     retryable: false,
//     traceId: "trace-abc-123",
//     ctx: {
//       httpStatusCode: 404,
//       message: "Benutzer nicht gefunden",
//       messageLocalized: { locale: "de", message: "Benutzer nicht gefunden" },
//     },
//     details: {}
//   }
// }
```

Like [Problem Details](./problem-details), it is safe by default and shares the
same vocabulary.

## Localized messages

`ctx.message` is the rendered client-safe string; `ctx.messageLocalized` is that
same string **tagged with its locale**, so a client knows which language it got.

You don't assemble `messageLocalized` by hand. Pass `locale` (optionally
`fallbackLocale`) and `toErrorResponse()` resolves an author-provided
[localized message](./base-error) from the same source `ctx.message` uses,
tagging it with the locale that actually matched (the fallback, if that's what
hit). The two fields therefore agree by construction, and `messageLocalized` is
simply omitted when no locale resolves.

Server-side localization is an opt-in escape hatch. In a typical app the client
maps the stable `code` to its own translations. See
[when it makes sense](./base-error#when-server-side-localization-makes-sense).

An explicit `messageLocalized` option still wins, for injecting a localized
string sourced outside the error's own locale entries.

## Options

| Option             | Notes                                                                         |
| ------------------ | ----------------------------------------------------------------------------- |
| `httpStatusCode`   | Placed in `ctx`                                                               |
| `locale`           | Preferred locale; resolves `message` + `messageLocalized`                     |
| `fallbackLocale`   | Locale used when `locale` has no entry                                        |
| `messageLocalized` | Explicit `{ locale, message }` override (usually omit; derived from `locale`) |
| `traceId`          | Distributed tracing id                                                        |
| `publicCode`       | Deliberate client-safe code                                                   |
| `publicCategory`   | Deliberate client-safe category                                               |
| `message`          | Public message override                                                       |
| `expose`           | Opt in to technical name/category/message                                     |
| `mapDetails`       | Explicit projection into the `details` field                                  |

## Surfacing details

The `details` field is `{}` by default. Populate it the same way as Problem
Details: with an explicit projection:

```ts
error.toErrorResponse({
  httpStatusCode: 400,
  mapDetails: (details) => ({ field: details?.publicField }),
});
```

## Discriminated unions

`ApiResponse<TData>` is `SuccessResponse<TData> | ErrorResponse`, so the
`isSuccess` discriminant narrows cleanly:

```ts
if (response.isSuccess) {
  response.data; // success branch
} else {
  response.error.code; // error branch
}
```
