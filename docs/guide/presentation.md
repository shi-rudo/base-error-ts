# Public error presentation

The core of `@shirudo/base-error` is purely technical: a `StructuredError`
carries a stable `code`, a `category`, a `retryable` flag, a technical
`message`, structured `details` and a `cause`. None of that is meant for an end
user. Turning a technical error into safe, localized, client-facing text is a
**boundary concern**, so it lives in a separate, optional subpath module:

```ts
import {
  LocalizedMessageSet,
  resolveUserMessage,
  PublicErrorRegistry,
  PublicErrorPresenter,
} from "@shirudo/base-error/presentation";
import type {
  PublicErrorDefinition,
  PublicErrorView,
} from "@shirudo/base-error/presentation";
```

## Why presentation is separate from the core

Two design rules drive the split:

1. **The `code` is the contract.** Your control flow, your logs and your tests
   switch on the technical `code` (`USER_NOT_FOUND`, `DB_UNIQUE_VIOLATION`). That
   code is stable and machine-readable. It should never depend on what language a
   user happens to read, or on which transport you serve.
2. **Localization is a boundary concern.** Which locales you support, what the
   fallback text is, and how an error maps to a public code are decisions that
   change per deployment and per audience. Baking them onto the error class
   couples the model to the presentation. Keeping them in a registry at the edge
   keeps the core technical and the boundary explicit.

The core therefore has **no public serializer**. `toLogObject()` / `toJSON()`
are full-fidelity log output and are not safe to send to clients. The only way
error data reaches a client is through this presentation layer, which projects
an explicit allowlist (a public code, a resolved localized message, and any
fields you deliberately project).

## `LocalizedMessageSet`

An immutable set of messages keyed by BCP 47 locale. Construction enforces the
write-side invariants: every key is canonicalized (an invalid tag throws), keys
that collide after canonicalization throw, every message must be non-empty, and
the `baseLocale` is mandatory and must have an entry. The `baseLocale` is the
guaranteed floor for resolution.

```ts
const userMessages = new LocalizedMessageSet({
  baseLocale: "en",
  messages: {
    en: "We could not find that account.",
    "de-DE": "Dieses Konto wurde nicht gefunden.",
    fr: "Ce compte est introuvable.",
  },
});

userMessages.baseLocale; // "en"
userMessages.has("de-DE"); // true
userMessages.get("de-DE"); // "Dieses Konto wurde nicht gefunden."
userMessages.get("xx"); // undefined (invalid tag is a miss, never a throw)
userMessages.entries(); // [["en", "..."], ["de-DE", "..."], ["fr", "..."]]
```

Lookups via `get` / `has` are exact canonical matches with no parent fallback.
Walking up a tag (`de-DE` to `de`) and choosing between preferences is the
resolver's job. `getCanonical` is a fast path for callers that already hold a
canonical tag (the resolver uses it).

## `resolveUserMessage`

Resolves a single message from a set against an ordered list of locale
preferences (RFC 4647 lookup). For each preference, in order, the canonical tag
and its truncation chain are tried; the first present entry wins. The
`baseLocale` is consulted only after every preference, so it is the guaranteed
floor: **this function never returns `undefined`**.

```ts
resolveUserMessage(userMessages, { locales: ["de-DE", "en"] });
// { locale: "de-DE", message: "Dieses Konto...", matchedPreferenceIndex: 0, match: "exact" }

resolveUserMessage(userMessages, { locales: ["de-CH"] });
// matches the parent "de" if present, otherwise falls to the base locale

resolveUserMessage(userMessages, { locales: ["ja"] });
// { locale: "en", message: "We could not find that account.", match: "base" }
```

`matchedPreferenceIndex` and `match` (`"exact"` / `"parent"` / `"base"`) are
diagnostic. They are useful in tests and for finding missing translations, and
need not reach a public view.

## `PublicErrorDefinition`

A definition describes how one class of error renders publicly:

```ts
type PublicErrorDefinition<TError = unknown, TDetails = never> = {
  publicCode: string;
  userMessages: LocalizedMessageSet;
  projectDetails?: (error: TError) => TDetails;
};
```

- `publicCode` is the wire contract, deliberately distinct from the technical
  `StructuredError.code`. Map an internal `DB_UNIQUE_VIOLATION` to a public
  `EMAIL_ALREADY_REGISTERED`.
- `userMessages` is the `LocalizedMessageSet` for this error class.
- `projectDetails` is the **only** way error data reaches the public view. It is
  an explicit allowlist: you return a vetted, typed subset. The raw error is
  never spread.

```ts
const accountNotFound: PublicErrorDefinition<
  { details?: { accountId?: string } },
  { accountId?: string }
> = {
  publicCode: "ACCOUNT_NOT_FOUND",
  userMessages,
  projectDetails: (error) => ({ accountId: error.details?.accountId }),
};
```

## `PublicErrorRegistry`

The registry maps an error to a definition, deterministically.

```ts
const registry = new PublicErrorRegistry()
  // 1. exact match on the technical code:
  .registerByCode("USER_NOT_FOUND", accountNotFound)
  // 2. predicate matcher (type guard), tried after code matches:
  .register({
    match: (error): error is ValidationError =>
      error instanceof ValidationError,
    definition: validationDefinition,
  });
```

Resolution order is fixed:

1. **`registerByCode`**: an exact match on the error's `code` (any object with a
   string `code` is eligible). `registerByCode` throws if the same code is
   registered twice.
2. **`register`**: predicate matchers, tried in **registration order**. A
   matcher that throws is treated as a miss (it does not break resolution).
3. **Miss**: nothing matched, and the presenter falls back to the generic
   definition.

`registerByCode` is the common case and the fastest path. Use `register` when
routing depends on the error's type or shape rather than a single code (for
example, every `ValidationError` regardless of code).

## `PublicErrorPresenter`

The presenter ties it together. It is constructed with the registry and a
**generic fallback** for unmapped errors, plus an optional observability hook:

```ts
const fallbackMessages = new LocalizedMessageSet({
  baseLocale: "en",
  messages: {
    en: "Something went wrong. Please try again.",
    "de-DE": "Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.",
  },
});

const presenter = new PublicErrorPresenter({
  registry,
  fallback: { publicCode: "INTERNAL_ERROR", userMessages: fallbackMessages },
  onPresent: (error, view, outcome) => {
    // Fire-and-forget telemetry, invoked once per present(). If it throws,
    // the presenter swallows it: telemetry must never break totality.
    if (outcome.kind === "fallback") {
      metrics.increment("error.unmapped", { reason: outcome.reason });
    }
  },
});
```

### `present(error, { locales })`

`present` turns any `unknown` into a `PublicErrorView`:

```ts
const view = presenter.present(error, { locales: ["de-DE", "en"] });
// { code: "ACCOUNT_NOT_FOUND", message: "Dieses Konto...", locale: "de-DE", details: { accountId: "123" } }
```

It is **total over `unknown`**. Every input yields a view; there is no path that
throws and no path that leaks the technical message. An unmapped error degrades
to the localized generic fallback. A `projectDetails` that throws is contained:
the matched view still stands, just without `details`.

### `onPresent` observability hook

The hook receives the original `error`, the produced `view`, and a
`PresentationOutcome` describing what happened (a `"matched"` outcome carries
`via: "code" | "predicate"`, the `publicCode`, and how the details projection
went; a `"fallback"` outcome carries a `reason`). It is the seam for metrics on
unmapped errors, broken matchers and failed projections, without coupling the
presenter to any telemetry library.

## The transport-neutral `PublicErrorView`

```ts
type PublicErrorView<TDetails = never> = {
  code: string;
  message: string;
  locale: string;
  details?: TDetails;
};
```

The view carries public **meaning** only. An HTTP status, a gRPC status code, a
CLI exit code, response headers: those are a transport adapter's concern, not
part of this library. `details` is populated only by an explicit
`projectDetails`.

## Transport adapters

A transport adapter maps a `PublicErrorView` to whatever your channel needs. The
view's `code` is the natural key. You can map it directly, or read an HTTP status
from your [error catalog](./catalog) via `AppErrors.meta(code).httpStatus`.

An HTTP example (mapping `view.code` to a status):

```ts
import { isStructuredError } from "@shirudo/base-error";

const STATUS_BY_CODE: Record<string, number> = {
  ACCOUNT_NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  INTERNAL_ERROR: 500,
};

function toHttpResponse(error: unknown, acceptLanguage: string): Response {
  // Always log the full technical truth, separately from the client path.
  if (isStructuredError(error)) logger.error(error.toLogObject());

  const locales = parseAcceptLanguage(acceptLanguage); // adapter's job
  const view = presenter.present(error, { locales });
  const status = STATUS_BY_CODE[view.code] ?? 500;

  return Response.json(view, { status });
}
```

RFC 9457 `application/problem+json` is just another adapter over the same view:
map `view.code` to a `type` URI and a `status`, carry `view.message` as `detail`
and `view.details` as extension members. The library stays transport-neutral;
the wire shape is yours to define at the boundary.
