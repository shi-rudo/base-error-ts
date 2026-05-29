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

## Quick compatibility migration

If you want v4-style output while migrating, opt in explicitly:

```ts
const problem = error.toProblemDetails({
  status: 400,
  includeDetails: true,
});
```

## Collision behavior

In v5, standard/library fields win by default:

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
  includeDetails: true,
});

// problem.status === 400
// problem.detail === "Public detail"
```

Power users can still opt into overrides:

```ts
const problem = error.toProblemDetails({
  status: 400,
  extensions: { status: 422, detail: "Custom detail" },
  allowExtensionOverrides: true,
});
```

## New option summary

- `detail`: public/client-safe Problem Details detail. Defaults to `error.message` for convenience.
- `extensions`: explicit public extension members.
- `mapDetails`: maps raw `details` to public extension members.
- `includeDetails`: exposes raw `details` as extensions when set to `true`.
- `allowExtensionOverrides`: lets extensions override standard/library fields when set to `true`.
