# @shirudo/base-error

[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![npm](https://img.shields.io/npm/v/@shirudo/base-error?color=blue)](https://www.npmjs.com/package/@shirudo/base-error)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@shirudo/base-error)](https://bundlephobia.com/package/@shirudo/base-error)
[![Tests](https://github.com/shi-rudo/base-error-ts/actions/workflows/tests.yml/badge.svg)](https://github.com/shi-rudo/base-error-ts/actions/workflows/tests.yml)

A cross-environment base error class for TypeScript targeting Node.js, modern browsers,
and edge runtimes (Cloudflare Workers, Deno Deploy, Vercel Edge). A purely
technical core, plus a public-error pipeline that produces safe, localized
client-facing output. The core has no client serializer, so it **never leaks
internal state by default**. Zero runtime dependencies.

## Features

- 🌐 **Cross-platform**: Node.js, browsers, edge; rich stack traces, preserved cause chains.
- 🔒 **Safe by default**: the core has no public serializer; client output is produced only by the public-error pipeline's explicit allowlist.
- 🧱 **Structured errors**: typed `code` / `category` / `retryable` / `details`.
- 🎯 **Exhaustive `matchError`**: compile-time-checked dispatch on `code`.
- 🗂️ **Exhaustive class sets**: reusable `defineErrorClassSet` definitions with complete, precisely typed handler tables.
- 🧩 **Open-world `matchThrown`**: fluent constructor and guard matching for arbitrary caught values.
- 🧭 **General error guards**: narrow native, Node.js-style, and custom errors without casts.
- 📒 **Error catalog**: `defineErrors` provides namespaced factories, immutable metadata, provenance guards, and catalog-level redaction.
- ✅ **Validation aggregate**: collect field issues (Standard Schema compatible) into one error.
- 🔁 **Wire round-trip**: `toLogObject` / `fromJSON` for same-context reconstruction & log replay.
- 🌍 **Public error pipeline**: `@shirudo/base-error/public-error` turns an error into a curated view, an optional localized variant, and an RFC 9457 `application/problem+json` body, all from one descriptor per public code.
- 🛡️ **PII redaction**: opt-in, sticky log-path redaction (`redact` / `redactAllow` / `partialMask`).

## Installation

```bash
npm install @shirudo/base-error
```

## Quick start

```ts
import { StructuredError, matchError } from "@shirudo/base-error";

class UserNotFoundError extends StructuredError<"USER_NOT_FOUND", "NOT_FOUND"> {
  constructor(userId: string) {
    super({
      code: "USER_NOT_FOUND",
      category: "NOT_FOUND",
      retryable: false,
      message: `User ${userId} not found in primary db`, // technical (for logs)
    });
  }
}

const err = new UserNotFoundError("123");

// The technical truth goes to your logger:
logger.error(err.toLogObject()); // message, stack, cause, details

// Exhaustive handling on the stable code:
const status = matchError(err, {
  USER_NOT_FOUND: () => 404,
  _: () => 500,
});
```

For safe, client-facing output, use the public-error pipeline
(`@shirudo/base-error/public-error`): register your public errors in a catalog,
then `project` an error to a curated view, optionally `localize` it, and map it to
an RFC 9457 body with `toProblem`. See the [public-error guide](docs/guide/public-error.md).

## Main types

| Type | Layer | What it is |
| --- | --- | --- |
| `BaseError` | Core | Cross-runtime base error: preserved `cause` chain, rich stack, timestamps. |
| `StructuredError` | Core | The technical error you **throw** and log: `code`, `category`, `retryable`, `details`. |
| `PublicError` | Boundary | The safe, **message-free** view of an error; what crosses to the client. |
| `LocalizedPublicError` | Boundary | `PublicError` plus `message` + `locale`, only when the backend localizes. |
| `ProblemDetails` | Boundary | The RFC 9457 `application/problem+json` HTTP body. |

**Core** is what you throw and log. The three **Boundary** types are successive
shapes of the *same* error on its way out (curate, then optionally localize, then
RFC 9457), not alternatives. The `@shirudo/base-error/public-error` subpath drives
that flow from one descriptor per public code.

## Documentation

The full guide lives in [`docs/guide/`](https://github.com/shi-rudo/base-error-ts/tree/main/docs/guide)
(run it locally with `pnpm docs:dev`):

**Introduction**

- [Getting started](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/getting-started.md)
- [Why safe by default](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/safe-by-default.md)
- [Pitfalls](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/pitfalls.md)

**Core**

- [BaseError](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/base-error.md)
- [StructuredError](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/structured-error.md)
- [Error catalog (`defineErrors`)](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/catalog.md)
- [Validation errors](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/validation.md)
- [Matching errors (`matchError`)](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/matching.md)
- [Cause chains](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/cause-chains.md)
- [Type guards & assertions](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/guards.md)

**Boundaries**

- [Public error pipeline](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/public-error.md)
- [Observability & logging (incl. PII redaction & `fromJSON`)](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/observability.md)

**Reference**

- [Migration](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/migration.md)
- [Changelog](CHANGELOG.md)

## TypeScript

Ships ESM + CommonJS + type declarations. Requires TypeScript 5.x with `strict`
mode for the full type-safety story.

## License

[MIT](LICENSE)
