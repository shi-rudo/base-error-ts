# Migration Guide

## v7 to v8

v8 removes the `@shirudo/base-error/presentation` and
`@shirudo/base-error/problem-details` subpaths. Both are superseded by the
unified public-error pipeline at `@shirudo/base-error/public-error`. The core
(`BaseError`, `StructuredError`, `defineErrors`, `matchError`, guards, redaction)
is unchanged.

### Imports

`LocalizedMessageSet` and `resolveUserMessage` now live on the `public-error`
subpath:

```ts
// v7
import { LocalizedMessageSet } from "@shirudo/base-error/presentation";
// v8
import { LocalizedMessageSet } from "@shirudo/base-error/public-error";
```

### Presentation to pipeline

A `PublicErrorPresenter` plus its `PublicErrorRegistry` become a
`PublicErrorCatalog` and the `project` (plus optional `localize`) stages:

```ts
// v7
const presenter = new PublicErrorPresenter({ registry, fallback });
const view = presenter.present(error, { locales });

// v8
const errors = definePublicErrors({ fallback: { publicCode, status, userMessages } })
  .registerByCode("USER_NOT_FOUND", { publicCode, status, userMessages });
const view = project(errors, error); // message-free; localize(view, ...) is now optional
```

`PublicErrorDefinition` becomes `PublicErrorDescriptor` (one descriptor now also
carries the transport `status`/`type`/`title`, so registration is a single site).

### Problem details to `toProblem`

`defineProblemDetailsAdapter(...).map(view, ...)` becomes `toProblem(catalog,
view, ...)`. Typed `extensions` carry over into the `toProblem` context; the RFC
9457 body type is `ProblemDetails`, returned inside a `ProblemDetailsResult`.

```ts
// v7
const adapter = defineProblemDetailsAdapter({ definitions, fallback });
const { status, headers, body } = adapter.map(view, { extensions: { retry_after: 30 } });

// v8
const { status, headers, body } = toProblem(errors, view, { extensions: { retry_after: 30 } });
```

See the public error pipeline guide for the full model.

## v6 to v7

> **Note:** the `presentation` and `problem-details` subpaths this section
> introduces were removed in v8. If you are landing on v8, treat the
> `PublicErrorPresenter` / `PublicErrorDefinition` parts below as historical and
> use the public-error pipeline (see _v7 to v8_ above) instead.

v7 restructures `defineErrors` into a collision-free catalog object and adds
catalog-local provenance guards. The migration is mechanical.

### Factory namespace

Factories move under `create` so catalog operations can never collide with an
error code:

```ts
// v6
AppErrors.USER_NOT_FOUND("missing", { details: { userId: "123" } });

// v7
AppErrors.create.USER_NOT_FOUND("missing", {
  details: { userId: "123" },
});
```

Codes named `meta`, `create`, or `is` are now valid because all code factories
live inside `create`.

### Details and metadata

Use `detailsType<T>()` for compile-time detail shapes. Move transport-specific
fields such as HTTP status under generic JSON-safe `metadata`:

```ts
const AppErrors = defineErrors({
  USER_NOT_FOUND: {
    category: "NOT_FOUND",
    retryable: false,
    details: detailsType<{ userId: string }>(),
    metadata: { httpStatus: 404 },
  },
});

const status = AppErrors.meta("USER_NOT_FOUND").metadata.httpStatus;
```

Catalog definitions and returned metadata are snapshotted and frozen. Mutating
the source definition after `defineErrors` no longer changes future errors.

### Safe narrowing after `catch`

`is` accepts only instances produced by that exact catalog:

```ts
try {
  await loadUser();
} catch (error) {
  if (AppErrors.is(error)) {
    return matchError(error, {
      USER_NOT_FOUND: () => 404,
      RATE_LIMITED: () => 429,
    });
  }
  throw error;
}
```

Use `AppErrors.is(error, "USER_NOT_FOUND")` for per-code narrowing. An error
with the same structural fields, an error from another catalog, or a value
rebuilt with `StructuredError.fromJSON` is intentionally not trusted.

### Catalog redaction policy

Redaction can be attached once to a definition instead of repeated after every
factory call:

```ts
PASSWORD_REJECTED: {
  category: "AUTH",
  retryable: false,
  details: detailsType<{ userId: string; password: string }>(),
  redaction: { mode: "deny", keys: ["password"] },
}
```

## v5 to v6

v6 splits the library in two. The core (`@shirudo/base-error`) is now **purely
technical**: it models the failure for your logs and control flow and has no
client-facing serializer. All public, localized presentation moved to a
separate, optional subpath module, `@shirudo/base-error/presentation`.

This removes the entire response/serialization layer from the core. The win is
that "safe by default" is now structural: the core literally cannot emit a client
payload, so a leak requires deliberately reaching for the presentation layer,
which only emits what you registered.

> **Engines**: v6 requires Node.js `>=20`.

### What was removed, and what replaces it

| Removed (v5)                                                                                                                                                                          | Replacement (v6)                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toProblemDetails()`, `toErrorResponse()`, `toPublicJSON()`                                                                                                                           | A `PublicErrorPresenter` at the boundary: register definitions, call `present(error, { locales })` to get a `PublicErrorView`, map it to your transport. |
| `withUserMessage()`, `addLocalizedMessage()`, `updateLocalizedMessage()`, `getUserMessage()`                                                                                          | `PublicErrorDefinition.userMessages`, a `LocalizedMessageSet` keyed by `publicCode` at the boundary.                                                     |
| `expose` flag (and `exposeToClients()`)                                                                                                                                               | Removed. The core has no public serializer; never send `toLogObject()` output to a client.                                                               |
| `publicCode` / `publicMessage` on `ErrorOptions` and the catalog `ErrorSpec`                                                                                                          | `publicCode` lives on a `PublicErrorDefinition`; `publicMessage` becomes `userMessages` (a `LocalizedMessageSet`).                                       |
| `errorResponse`, `successResponse`, `createErrorResponse`, `createSuccessResponse`, `ErrorResponseBuilder`, `ApiResponse`, `SuccessResponse`, `ErrorResponse`, `ProblemDetails` types | Build your wire shape in a transport adapter from a `PublicErrorView`.                                                                                   |
| `LocalizedMessage`, `ProblemDetailsOptions`, `messageLocalized`, `.localized()`                                                                                                       | Resolved by `resolveUserMessage` / the presenter; the view's `message` and `locale` carry the result.                                                    |

The catalog keeps `httpStatus` and `meta(code)`. Resolve a status from the
catalog (`AppErrors.meta(err.code).httpStatus`) in your transport adapter, then
attach it to the presenter's `PublicErrorView`.

### Before and after

```ts
// ── BEFORE (old v5 API, removed) ─────────────────────────────────
class UserNotFoundError extends StructuredError<"USER_NOT_FOUND", "NOT_FOUND"> {
  constructor(userId: string) {
    super({
      code: "USER_NOT_FOUND",
      category: "NOT_FOUND",
      retryable: false,
      message: `User ${userId} not found`,
      publicCode: "ACCOUNT_NOT_FOUND",
      publicMessage: "We could not find that account.",
    });
  }
}

const err = new UserNotFoundError("123");
return Response.json(err.toProblemDetails({ status: 404 }), { status: 404 });
```

```ts
// ── AFTER (v6) ───────────────────────────────────────────────────
// 1. The error stays purely technical.
class UserNotFoundError extends StructuredError<"USER_NOT_FOUND", "NOT_FOUND"> {
  constructor(userId: string) {
    super({
      code: "USER_NOT_FOUND",
      category: "NOT_FOUND",
      retryable: false,
      message: `User ${userId} not found`,
    });
  }
}

// 2. Presentation lives at the boundary.
import {
  LocalizedMessageSet,
  PublicErrorRegistry,
  PublicErrorPresenter,
} from "@shirudo/base-error/presentation";

const registry = new PublicErrorRegistry().registerByCode("USER_NOT_FOUND", {
  publicCode: "ACCOUNT_NOT_FOUND",
  userMessages: new LocalizedMessageSet({
    baseLocale: "en",
    messages: { en: "We could not find that account." },
  }),
});

const presenter = new PublicErrorPresenter({
  registry,
  fallback: {
    publicCode: "INTERNAL_ERROR",
    userMessages: new LocalizedMessageSet({
      baseLocale: "en",
      messages: { en: "Something went wrong. Please try again." },
    }),
  },
});

// 3. Map the transport-neutral view to your channel.
const err = new UserNotFoundError("123");
const view = presenter.present(err, { locales: ["en"] });
return Response.json(view, { status: 404 });
```

In v8 this maps to the public-error pipeline; see the
[public error pipeline guide](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/public-error.md)
for the full surface.

## v4 to v5 (historical)

v5 tightened `StructuredError.toProblemDetails()` so the default was safer for
enterprise APIs. That serializer was **removed entirely in v6** (see above), so
this section is retained only for projects upgrading directly from v4 and then on
to v6. For the v4-to-v5 details, see the
[CHANGELOG](https://github.com/shi-rudo/base-error-ts/blob/main/CHANGELOG.md).
