# Error responses

`toErrorResponse()` produces a discriminated `ErrorResponse` — the mirror of a
`SuccessResponse` — for RPC-style and HTTP APIs that use a
`{ isSuccess, ... }` envelope.

```ts
const response = error.toErrorResponse({
  httpStatusCode: 404,
  messageLocalized: { locale: "en", message: "User not found" },
  traceId: "trace-abc-123",
});
// {
//   isSuccess: false,
//   error: {
//     code: "INTERNAL_ERROR",
//     category: "INTERNAL",
//     retryable: false,
//     traceId: "trace-abc-123",
//     ctx: { httpStatusCode: 404, message: "An unexpected error occurred.", messageLocalized: {...} },
//     details: {}
//   }
// }
```

Like [Problem Details](./problem-details), it is safe by default and shares the
same vocabulary.

## Options

| Option | Notes |
| --- | --- |
| `httpStatusCode` | Placed in `ctx` |
| `messageLocalized` | `{ locale, message }` for client i18n |
| `traceId` | Distributed tracing id |
| `publicCode` | Deliberate client-safe code |
| `publicCategory` | Deliberate client-safe category |
| `message` | Public message override |
| `expose` | Opt in to technical name/category/message |
| `mapDetails` | Explicit projection into the `details` field |

## Surfacing details

The `details` field is `{}` by default. Populate it the same way as Problem
Details — with an explicit projection:

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
