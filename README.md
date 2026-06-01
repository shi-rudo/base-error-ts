# @shirudo/base-error

[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![npm](https://img.shields.io/npm/v/@shirudo/base-error?color=blue)](https://www.npmjs.com/package/@shirudo/base-error)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@shirudo/base-error)](https://bundlephobia.com/package/@shirudo/base-error)
[![Tests](https://github.com/shi-rudo/base-error-ts/actions/workflows/tests.yml/badge.svg)](https://github.com/shi-rudo/base-error-ts/actions/workflows/tests.yml)

A cross-environment base error class for TypeScript — Node.js, modern browsers,
and edge runtimes (Cloudflare Workers, Deno Deploy, Vercel Edge). Structured
errors, RFC 9457 Problem Details, and a public projection that **never leaks
internal state by default**. Zero runtime dependencies.

## Features

- 🌐 **Cross-platform** — Node.js, browsers, edge; rich stack traces, preserved cause chains.
- 🔒 **Safe by default, invariant** — client serializers never expose technical messages, internal codes/categories, or raw details unless you explicitly project them.
- 🧱 **Structured errors** — typed `code` / `category` / `retryable` / `details`, RFC 9457 Problem Details, discriminated API responses.
- 🎯 **Exhaustive `matchError`** — compile-time-checked dispatch on `code`.
- 📒 **Error catalog** — `defineErrors` generates typed factories from one declarative spec.
- ✅ **Validation aggregate** — collect field issues (Standard Schema compatible) into one error.
- 🔁 **Wire round-trip** — `toLogObject` / `fromJSON` for same-context reconstruction & log replay.
- 🌍 **i18n** — locale-aware public messages.
- 🛡️ **PII redaction** — opt-in, sticky log-path redaction (`redact` / `redactAllow` / `partialMask`).

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
      message: `User ${userId} not found in primary db`, // technical — for logs
      publicMessage: "We couldn't find that user.", // safe — for clients
    });
  }
}

const err = new UserNotFoundError("123");

// Two output paths — keep them straight:
logger.error(err.toLogObject()); // full truth: message, stack, cause, details
return err.toProblemDetails({ status: 404 }); // safe projection for the client

// Exhaustive handling:
const status = matchError(err, {
  USER_NOT_FOUND: () => 404,
  _: () => 500,
});
```

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
- [Problem Details (RFC 9457)](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/problem-details.md)
- [Error responses](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/error-responses.md)
- [Building API responses](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/building-responses.md)
- [Observability & logging (incl. PII redaction & `fromJSON`)](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/observability.md)

**Reference**
- [Migration v4 → v5](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/migration.md)
- [Changelog](CHANGELOG.md)

## TypeScript

Ships ESM + CommonJS + type declarations. Requires TypeScript 5.x with `strict`
mode for the full type-safety story.

## License

[MIT](LICENSE)
