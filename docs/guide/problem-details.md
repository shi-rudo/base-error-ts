# Problem Details (RFC 9457)

`toProblemDetails()` converts a [`StructuredError`](./structured-error) into an
[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) Problem Details object
for HTTP responses. It is [safe by default](./safe-by-default): nothing internal
appears unless you project it explicitly.

```ts
error.toProblemDetails({ status: 404 });
// {
//   status: 404,
//   detail: "An unexpected error occurred.",
//   code: "INTERNAL_ERROR",
//   retryable: false
// }
```

## Public code, message & category {#public-code-message-category}

Set deliberate, client-safe values per call (or on the error via
`withPublicCode` / `withPublicMessage`):

```ts
error.toProblemDetails({
  status: 409,
  type: "https://api.example.com/problems/email-taken",
  title: "Email already registered",
  publicCode: "EMAIL_ALREADY_REGISTERED",
  publicCategory: "CONFLICT",
  detail: "That email address is already in use.",
  traceId: "trace-abc-123",
});
```

`publicCategory` projects a deliberate category. The **internal** category is
otherwise omitted (unless you `expose`).

## Localized detail {#localized-detail}

If the error carries author-provided localized messages
([`addLocalizedMessage`](./base-error#user-facing-public-messages)), pass a
`locale` (and optional `fallbackLocale`) to use one as the `detail`. These are
client-safe by design, so they surface **without** `expose`:

```ts
error
  .addLocalizedMessage("de", "Diese E-Mail ist bereits registriert.")
  .toProblemDetails({ status: 409, locale: "de" });
// detail: "Diese E-Mail ist bereits registriert."
```

An explicit `detail` still wins; a missing locale falls back to `publicMessage`
(never the default user message). Same `locale`/`fallbackLocale` options apply to
`toErrorResponse()` and `toPublicJSON()`.

## Projecting details {#projecting-details}

Raw `details` never cross into a client response. To surface any of them, write
an explicit, reviewable projection with `mapDetails` — this is the only path:

```ts
error.toProblemDetails({
  status: 400,
  detail: "Please correct the highlighted fields.",
  mapDetails: (details) => ({
    field: details?.publicField, // select & rename, deliberately
  }),
});
// { ..., field: "email" }
```

For metadata the boundary already knows (not derived from `details`), use
`extensions`:

```ts
error.toProblemDetails({
  status: 429,
  title: "Too many requests",
  extensions: { retryAfterSeconds: 60 },
});
```

::: tip Need every field?
`mapDetails: (d) => ({ ...d })` is a deliberate "expose all" projection. If what
you actually want is the full error for logging, that belongs on the
[observability path](./observability), not the client response.
:::

## Collisions are safe

Standard members (`type`, `title`, `status`, `detail`, `instance`) and library
members (`code`, `category`, `retryable`, `traceId`) **always** win over
colliding keys from `extensions` or `mapDetails`. There is no override switch.

```ts
error.toProblemDetails({
  status: 400,
  detail: "Public detail",
  extensions: { status: 422, code: "OVERRIDE", retryable: true },
});
// status stays 400, code stays the safe public code, retryable unchanged
```

## Exposing technical fields {#exposing-technical-fields}

For internal/admin surfaces you can opt in to the technical name, category and
message at once:

```ts
error.toProblemDetails({ status: 400, expose: true });
```
