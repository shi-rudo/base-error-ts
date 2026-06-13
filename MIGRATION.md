# Migration Guide

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

See the [presentation guide](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/presentation.md)
for the full surface.

## v4 to v5 (historical)

v5 tightened `StructuredError.toProblemDetails()` so the default was safer for
enterprise APIs. That serializer was **removed entirely in v6** (see above), so
this section is retained only for projects upgrading directly from v4 and then on
to v6. For the v4-to-v5 details, see the
[CHANGELOG](https://github.com/shi-rudo/base-error-ts/blob/main/CHANGELOG.md).
