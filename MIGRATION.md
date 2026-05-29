# Migration Guide: v4 to v5

v5 tightens `StructuredError.toProblemDetails()` so the default is safer for enterprise APIs and more aligned with DDD boundaries.

## What changed?

In v4, `StructuredError.details` were automatically spread as top-level Problem Details extension members:

```ts
const error = new StructuredError({
  code: "VALIDATION_FAILED",
  category: "VALIDATION",
  retryable: false,
  message: "Validation failed",
  details: { field: "email" },
});

const problem = error.toProblemDetails({ status: 400 });
// v4: problem.field === "email"
```

In v5, raw details are not exposed by default:

```ts
const problem = error.toProblemDetails({ status: 400 });
// v5: problem.field === undefined
```

This prevents accidental leaking of internal domain/application state and prevents `details` from silently overriding fields such as `status`, `detail`, `code`, or `traceId`.

## Recommended enterprise/DDD migration

Map domain/application details at the HTTP/RPC boundary:

```ts
const problem = error.toProblemDetails({
  status: 400,
  title: "Validation failed",
  detail: "Please correct the highlighted fields.",
  mapDetails: (details) => ({
    field: details?.field,
  }),
});
```

Use explicit extensions when the boundary already knows the public shape:

```ts
const problem = error.toProblemDetails({
  status: 429,
  title: "Too many requests",
  detail: "Please retry later.",
  extensions: {
    retryAfterSeconds: 60,
  },
});
```

## Reproducing v4-style output

There is no raw passthrough in v5. If you genuinely want every detail field in a
client response, name them in an explicit projection:

```ts
const problem = error.toProblemDetails({
  status: 400,
  mapDetails: (details) => ({ ...details }), // deliberate and reviewable
});
```

Need the full, unredacted error for logs/Sentry/APM? That is a separate,
server-side path — use `toLogObject()`, which keeps the technical message,
stack, cause chain and raw `details`. The client-facing serializers never carry
internal state.

## Collision behavior

Safety is invariant. Standard/library fields always win — there is no override
switch, so a call site cannot accidentally leak:

```ts
const error = new StructuredError({
  code: "VALIDATION_FAILED",
  category: "VALIDATION",
  retryable: false,
  message: "Technical message",
  details: { status: 200, detail: "Unsafe detail" },
});

const problem = error.toProblemDetails({
  status: 400,
  detail: "Public detail",
  mapDetails: (details) => ({ status: details?.status, detail: details?.detail }),
});

// problem.status === 400  (library member wins)
// problem.detail === "Public detail"
```

## Option summary

- `detail`: public/client-safe Problem Details detail. When omitted, a safe public message is used (the technical `message` is only emitted when `expose` is set).
- `publicCode` / `publicCategory`: deliberate, client-safe code and category overrides.
- `extensions`: explicit public extension members.
- `mapDetails`: the only way to surface `details` in a client response — an explicit, reviewable projection.
- `expose`: opt in to emitting the technical name/category/message.
