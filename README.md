# @shirudo/base-error

[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![npm](https://img.shields.io/npm/v/@shirudo/base-error?color=blue)](https://www.npmjs.com/package/@shirudo/base-error)
[![Bundle Size](https://img.shields.io/bundlejs/size/%40shirudo%2Fbase-error)](https://bundlejs.com/?q=%40shirudo%2Fbase-error)
[![Tests](https://github.com/shi-rudo/base-error-ts/actions/workflows/tests.yml/badge.svg)](https://github.com/shi-rudo/base-error-ts/actions/workflows/tests.yml)

A base error class for TypeScript. It runs on Node.js, on modern browsers, and
on edge runtimes (Cloudflare Workers, Deno Deploy, Vercel Edge). The package
has no runtime dependencies.

The library separates two audiences: your logs and your clients. An error that
you throw carries the full technical truth for your logs: message, stack,
cause chain, and details. None of that reaches a client by accident, because
the core cannot serialize an error for a client at all. When a client must see
an error, the separate public-error pipeline builds the response from an
allowlist that you registered. That response is a safe view, an optional
localized message, and an RFC 9457 body.

## The problem

A leaked exception message, stack trace, or database detail in an API response
is a recognized vulnerability
([CWE-209](https://cwe.mitre.org/data/definitions/209.html)). The usual generic
error handler must choose between two bad answers: it serializes the error and
leaks, or it flattens every failure into a blank 500. This library removes the
choice. The error that you throw keeps its full technical truth for the log,
and the client response comes only from an allowlist that you registered.

## Installation

```bash
npm install @shirudo/base-error
```

## Quick start

### Throw and log

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

### Answer the client

```ts
import {
  definePublicErrors,
  project,
  toProblem,
} from "@shirudo/base-error/public-error";

// Register once, at startup. Only what you register can reach a client.
const publicErrors = definePublicErrors({
  fallback: { publicCode: "internal_error", status: 500 },
}).registerByCode("USER_NOT_FOUND", {
  publicCode: "user_not_found",
  status: 404,
});

// In the error handler at your HTTP edge:
const view = project(publicErrors, err); // total: any input gives a safe view
const { status, body } = toProblem(publicErrors, view);
// status: 404
// body:   { "status": 404, "code": "user_not_found" }
// The technical message, the stack, and the details never cross.
```

An unregistered error degrades to the fallback (`500`, `internal_error`)
instead of a leak. The optional `localize` stage adds an end-user message per
locale, and a descriptor can project vetted fields into the response. Read the
[public-error guide](docs/guide/public-error.md).

## Two entry points

| Import                             | What it holds                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `@shirudo/base-error`              | The core: error classes, matching, guards, cause-chain traversal, redaction.      |
| `@shirudo/base-error/public-error` | The boundary: the pipeline that builds the client response. The only client path. |

## Features

**What you throw**

- 🧱 **Structured errors**: Each error has a typed `code`, a `category`, a `retryable` flag, and `details`.
- 🧵 **Fan-out errors**: `StructuredAggregateError` collects many failures in one error. The cause-chain helpers walk the members with `{ aggregates: true }`.
- ✅ **Validation aggregate**: You can collect field issues into one error. The issues are compatible with Standard Schema.
- 🌐 **Cross-platform**: The package runs on Node.js, on browsers, and on edge runtimes. It keeps rich stack traces and the cause chain.

**How you handle**

- 🎯 **Exhaustive `matchError`**: The compiler checks the dispatch on `code`.
- 🗂️ **Exhaustive class sets**: A `defineErrorClassSet` definition gives a complete and precisely typed handler table. You can use one definition many times.
- 🧩 **Open-world `matchThrown`**: A fluent matcher accepts constructors and guards for any caught value.
- 🧭 **General error guards**: You can narrow native errors, Node.js-style errors, and custom errors without a cast.
- 📒 **Error catalog**: `defineErrors` gives namespaced factories, immutable metadata, provenance guards, and redaction for the catalog.

**What the client sees**

- 🔒 **Safe by default**: The core has no public serializer. Only the explicit allowlist of the public-error pipeline makes client output.
- 🌍 **Public error pipeline**: `@shirudo/base-error/public-error` turns an error into a curated view, an optional localized variant, and an RFC 9457 `application/problem+json` body. One descriptor per public code controls all three.

**What you log**

- 🛡️ **PII redaction**: `redact`, `redactAllow` and `partialMask` add sticky redaction to the log path. This redaction is opt-in.
- 🔁 **Wire round-trip**: `toLogObject` writes an error, and `fromJSON` rebuilds it in the same context, also from a stored log. Both keep the members of an `AggregateError`, which `structuredClone` drops.

## Main types

| Type                       | Layer    | What it is                                                                                          |
| -------------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `BaseError`                | Core     | The base error for every runtime. It keeps the `cause` chain, a rich stack, and timestamps.         |
| `StructuredError`          | Core     | The technical error that you **throw** and log. It adds `code`, `category`, `retryable`, `details`. |
| `StructuredAggregateError` | Core     | A `StructuredError` that collects many failures in `errors`.                                        |
| `PublicError`              | Boundary | The safe and **message-free** view of an error. This view crosses to the client.                    |
| `LocalizedPublicError`     | Boundary | A `PublicError` with a `message` and a `locale`. The backend makes it only when it localizes.       |
| `ProblemDetails`           | Boundary | The RFC 9457 `application/problem+json` body for HTTP.                                              |

You throw and log a **Core** type. The three **Boundary** types are not
alternatives. They are the shapes that one error takes in order on its way out.
First, `project` curates the error. Then `localize` can add a message. Last,
`toProblem` maps the result to RFC 9457. The subpath
`@shirudo/base-error/public-error` drives this flow from one descriptor per
public code.

## Documentation

The full guide is in
[`docs/guide/`](https://github.com/shi-rudo/base-error-ts/tree/main/docs/guide).
To read it locally, run `pnpm docs:dev`.

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
- [Type guards and assertions](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/guards.md)

**Boundaries**

- [Public error pipeline](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/public-error.md)
- [Observability and logging (with PII redaction and `fromJSON`)](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/observability.md)

**Reference**

- [Migration](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/migration.md)
- [Changelog](CHANGELOG.md)

## Requirements

- Node.js 20 or a later version. Modern browsers and edge runtimes work too.
- TypeScript 5.0 or a later version, with `strict` mode, for full type safety.
- The package ships ESM, CommonJS, and type declarations.

## License

[MIT](LICENSE)
