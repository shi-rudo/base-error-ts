# Building API responses

Besides projecting an *error* into a response with
[`toErrorResponse()`](./error-responses), the package ships standalone helpers to
construct success/error envelopes from scratch — useful at the API layer where
not every response originates from a thrown error.

```ts
import {
  errorResponse,
  successResponse,
  createErrorResponse,
  createSuccessResponse,
} from "@shirudo/base-error";
```

## The discriminated union

Every response is an `ApiResponse<TData>` — a discriminated union on
`isSuccess`:

```ts
type ApiResponse<TData> = SuccessResponse<TData> | ErrorResponse;

if (res.isSuccess) {
  res.data; // success branch
} else {
  res.error.code; // error branch
}
```

## Success responses

```ts
successResponse({ id: "123", name: "Ada" });
// { isSuccess: true, data: { id: "123", name: "Ada" } }

successResponse();                       // void payload
createSuccessResponse({ data: { id: "123" } }); // object-syntax variant
```

## Error responses — the builder

`errorResponse({ code, category, retryable? })` returns a type-safe
`ErrorResponseBuilder`. (Construct builders through this factory, not the class
directly.) Each method returns a new builder whose type reflects the fields you
have set, so `build()` produces the exact shape you configured:

```ts
const res = errorResponse({ code: "USER_NOT_FOUND", category: "NOT_FOUND" })
  .httpStatus(404)
  .message("User 123 not found")            // technical ctx message
  .localized("en", "User not found")        // client-facing localized message
  .traceId("trace-abc-123")
  .details({ userId: "123" })
  .build();
```

| Method | Sets |
| --- | --- |
| `httpStatus(code)` | `ctx.httpStatusCode` |
| `message(msg)` | `ctx.message` (technical) |
| `localized(locale, msg)` | `ctx.messageLocalized` |
| `traceId(id)` | top-level `traceId` |
| `details(obj)` | `error.details` (replaces the details type) |
| `withCtx(obj)` | merges extra `ctx` fields |
| `build()` | returns the final `ErrorResponse` |

`retryable` defaults to `false`.

## Error responses — one-shot factory

When you don't need the builder, `createErrorResponse` builds the envelope in a
single call and infers the exact type from the input:

```ts
createErrorResponse({
  code: "RATE_LIMITED",
  category: "RATE_LIMIT",
  retryable: true,
  ctx: { message: "Too many requests", httpStatusCode: 429 },
  details: { retryAfter: 60 },
});
```

Only `code` and `category` are required; `retryable` → `false`, `ctx` → `{}`,
`details` → `{}`.

## Builder/factory vs `toErrorResponse()`

- Use [`toErrorResponse()`](./error-responses) when you already hold a
  `StructuredError` — it applies the safe public projection.
- Use these builders/factories when you are assembling a response directly at
  the API layer. Their `ctx.message` is the **technical** message; keep
  client-facing text in `localized` or map it explicitly.
