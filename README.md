# @shirudo/base-error

[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![npm](https://img.shields.io/npm/v/@shirudo/base-error?color=blue)](https://www.npmjs.com/package/@shirudo/base-error)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@shirudo/base-error)](https://bundlephobia.com/package/@shirudo/base-error)
[![Tests](https://github.com/shi-rudo/base-error-ts/actions/workflows/tests.yml/badge.svg)](https://github.com/shi-rudo/base-error-ts/actions/workflows/tests.yml)

A cross-environment base error class for TypeScript targeting Node.js, modern browsers,
and edge runtimes (Cloudflare Workers, Deno Deploy, Vercel Edge). A purely
technical core, plus an optional presentation layer that produces safe, localized
client-facing output. The core has no client serializer, so it **never leaks
internal state by default**. Zero runtime dependencies.

## Features

- 🌐 **Cross-platform**: Node.js, browsers, edge; rich stack traces, preserved cause chains.
- 🔒 **Safe by default**: the core has no public serializer; client output is produced only by the presentation layer's explicit allowlist.
- 🧱 **Structured errors**: typed `code` / `category` / `retryable` / `details`.
- 🎯 **Exhaustive `matchError`**: compile-time-checked dispatch on `code`.
- 🗂️ **Exhaustive class sets**: reusable `defineErrorClassSet` definitions with complete, precisely typed handler tables.
- 🧩 **Open-world `matchThrown`**: fluent constructor and guard matching for arbitrary caught values.
- 🧭 **General error guards**: narrow native, Node.js-style, and custom errors without casts.
- 📒 **Error catalog**: `defineErrors` generates typed factories from one declarative spec.
- ✅ **Validation aggregate**: collect field issues (Standard Schema compatible) into one error.
- 🔁 **Wire round-trip**: `toLogObject` / `fromJSON` for same-context reconstruction & log replay.
- 🌍 **Public presentation**: `@shirudo/base-error/presentation` for localized, transport-neutral public views.
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

For safe, localized client-facing output, use the optional presentation layer
(`@shirudo/base-error/presentation`): register a `PublicErrorPresenter` at your
boundary and call `present(error, { locales })` to get a transport-neutral
`PublicErrorView`. See the [presentation guide](docs/guide/presentation.md).

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

- [Public error presentation](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/presentation.md)
- [Observability & logging (incl. PII redaction & `fromJSON`)](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/observability.md)

**Reference**

- [Migration](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/migration.md)
- [Changelog](CHANGELOG.md)

## TypeScript

Ships ESM + CommonJS + type declarations. Requires TypeScript 5.x with `strict`
mode for the full type-safety story.

## License

[MIT](LICENSE)
