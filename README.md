# @shirudo/base-error

[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![npm](https://img.shields.io/npm/v/@shirudo/base-error?color=blue)](https://www.npmjs.com/package/@shirudo/base-error)
[![JSR](https://jsr.io/badges/@shirudo/base-error)](https://jsr.io/@shirudo/base-error)
[![Bundle Size](https://img.shields.io/bundlejs/size/%40shirudo%2Fbase-error)](https://bundlejs.com/?q=%40shirudo%2Fbase-error)
[![Tests](https://github.com/shi-rudo/base-error-ts/actions/workflows/tests.yml/badge.svg)](https://github.com/shi-rudo/base-error-ts/actions/workflows/tests.yml)

**Structured errors for TypeScript: the full error for your logs, a safe answer
for your clients.**

`@shirudo/base-error` gives each error a stable `code`, a `category` and a
`retryable` flag. Your logs get the whole error, with every cause. A client gets
only the answer that you registered for that code.

The package runs on Node.js, Bun, Deno, in browsers and on edge runtimes such
as Cloudflare Workers. It has no runtime dependencies.

## Why

A plain `Error` carries only text. In a service, that causes three problems:

- **You cannot handle it safely.** Code that tests
  `err.message.includes("not found")` breaks when somebody changes the text.
- **Your logs lose it.** `JSON.stringify(new Error("failed"))` gives `{}`. A
  logger that serializes an error this way loses the message, the stack and
  every cause.
- **Your clients can see too much.** An error handler that sends the error to
  the client also sends its stack and its database message. That is a known
  vulnerability
  ([CWE-209](https://cwe.mitre.org/data/definitions/209.html)).

This library removes the three problems:

| Problem             | With `@shirudo/base-error`                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Handling by text    | You match on a typed `code`. The compiler tells you when a code has no handler.                                                   |
| Errors lost in logs | `toLogObject()` writes the message, the stack, every cause and the details. You can mask fields that hold personal data.          |
| Leaks to clients    | The core cannot serialize an error for a client. A separate pipeline builds the response only from the codes that you registered. |

## How it works

An error that you throw takes one of two paths:

```text
                      ┌─▶ toLogObject() ──────────────────▶ your logger
                      │     message, stack, causes, details
throw StructuredError ┤
                      │
                      └─▶ project() ─▶ toProblem() ───────▶ HTTP response
                            registered public codes only (RFC 9457)
```

Each path has its own import:

| Import                             | Use it to                                                                |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `@shirudo/base-error`              | Throw, match, inspect and log errors.                                    |
| `@shirudo/base-error/public-error` | Build the response for a client. This is the only path to client output. |

## Installation

```bash
npm install @shirudo/base-error
```

The package is also on JSR: `deno add jsr:@shirudo/base-error`, or
`npx jsr add @shirudo/base-error`.

## Quick start

### 1. Define an error

```ts
import { StructuredError } from "@shirudo/base-error";

export class UserNotFoundError extends StructuredError<
  "USER_NOT_FOUND",
  "NOT_FOUND"
> {
  constructor(userId: string, cause?: unknown) {
    super({
      code: "USER_NOT_FOUND",
      category: "NOT_FOUND",
      retryable: false,
      message: `No user ${userId} in the primary database`, // for the log
      details: { userId },
      cause,
    });
  }
}
```

The `message` is technical text for the log. A client never sees it.

### 2. Log and handle it

```ts
import { matchError } from "@shirudo/base-error";

const error = new UserNotFoundError("123", dbError);

logger.error(error.toLogObject());
// { name, message, timestamp, timestampIso, stack,
//   cause: { name: "Error", message: "connection reset by peer", ... },
//   code: "USER_NOT_FOUND", category: "NOT_FOUND", retryable: false,
//   details: { userId: "123" } }

const user = matchError(error, {
  USER_NOT_FOUND: () => null, // a missing user is "no result" here
  _: (other) => {
    throw other;
  },
}); // null
```

`toLogObject()` copies the error into plain data. `JSON.stringify(error)` gives
the same result, so a logger that serializes the error gets the full content.
If a caught value has the type `unknown`, `toStructuredError(value)` turns it
into a `StructuredError`.

### 3. Mask personal data in the log (optional)

```ts
error.redact(["userId"]);
// Every log of this error now writes details.userId as "[REDACTED]".
```

The policy stays on the error. It also applies when another error logs this
one as its cause. `redactAllow` works the other way: it masks every data field
that you did not list.

### 4. Answer the client

```ts
import {
  definePublicErrors,
  project,
  toProblem,
} from "@shirudo/base-error/public-error";

// Register once, at startup. Only a registered code reaches a client.
const publicErrors = definePublicErrors({
  fallback: { publicCode: "internal_error", status: 500 },
}).registerByCode("USER_NOT_FOUND", {
  publicCode: "user_not_found",
  status: 404,
});

// In the error handler of your HTTP server:
const view = project(publicErrors, error);
const { status, headers, body } = toProblem(publicErrors, view);
// status:  404
// headers: { "content-type": "application/problem+json" }
// body:    { "status": 404, "code": "user_not_found" }
```

The technical message, the stack and the details do not cross. An error that
you did not register gets the fallback: `500` with the code `internal_error`.
The optional `localize` stage adds a message for the end user in the language
of the request.

## Features

**Define errors**

- `StructuredError` carries a typed `code`, a `category`, a `retryable` flag and
  `details`.
- `defineErrors` defines many codes in one place, with typed factories and
  metadata per code. A prefix gives dotted codes, such as
  `billing.card_declined`, factories without brackets.
- `StructuredAggregateError` collects many failures in one error, for example
  from `Promise.allSettled`.
- `ValidationError` collects field issues. The issue format is compatible with
  Standard Schema, and `publicIssues()` gives the subset that is safe for a
  client.

**Handle errors**

- `matchError` dispatches on `code`. The compiler makes sure that every code
  has a handler.
- `defineErrorClassSet` does the same for a set of error classes.
- `matchThrown` matches any caught value by class or by guard.
- Guards such as `isError`, `isStructuredError`, `hasErrorCode` and
  `isRetryable` narrow a caught value without a cast. They also work for an
  error from a worker or from a second copy of the package.
- The cause-chain helpers (`getRootCause`, `findInCauseChain`,
  `isChainRetryable` and more) follow the `cause` links, also into the members
  of an `AggregateError`.

**Log errors**

- `toLogObject()` writes the complete error as plain JSON data: the message,
  the stack, every cause, the members of an aggregate, and the details.
- `logObjectOf(value)` writes the log form of any thrown value: an error of
  this library, a native `Error`, or a value that is not an error.
- `redact`, `redactAllow`, `partialMask` and `redactWith` mask personal data in
  the log.
- `StructuredError.fromJSON` rebuilds a typed error from a log or from a worker
  message. `structuredClone` drops the members of an `AggregateError`, but this
  round trip keeps them.

**Answer clients**

- The public-error pipeline turns an error into a safe view (`project`), adds a
  localized message (`localize`) and builds an RFC 9457 body (`toProblem`).
- One registration per public code controls the status, the type, the message
  and the details that a client can see.

**Safe in a `catch` block**

- No function on the logging, rendering or traversal path throws. A getter that
  throws, a revoked Proxy or a cyclic cause chain costs only the affected
  value. The log shows a marker there, or leaves the field out.
- The work stays bounded for any value that code throws, also for very deep or
  very wide error graphs.

## When to use it

The library fits a service or an API that has more than a few error cases,
writes structured logs, or answers HTTP clients. For a small script, a plain
`Error` is enough.

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
- [Logging with pino](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/logging-with-pino.md)

**Reference**

- [Migration](https://github.com/shi-rudo/base-error-ts/blob/main/docs/guide/migration.md)
- [Changelog](CHANGELOG.md)

## Agent Skill

The package ships an agent skill for AI coding assistants in
[`skills/base-error/`](skills/base-error/), and the npm and JSR packages
include it. Copy the folder into your project's skill directory, such as
`.claude/skills/` for Claude Code or `.agents/skills/` for other agents. It
teaches the assistant the catalogs, the guards and matchers, the log path with
redaction, and the public-error pipeline of this major version, and it maps the
APIs of older majors onto the current ones. Every code example in it compiles
against `src`.

## Requirements

- Node.js 24 or a later version. Bun, Deno, modern browsers and edge runtimes
  work too.
- TypeScript 5.0 or a later version, with `strict` mode, for full type safety.
- `lib` ES2020 or a later version.
- Module resolution `node16`, `nodenext` or `bundler`. `node10` works with
  TypeScript 5 and 6. TypeScript 7 removed it.
- The package ships ESM, CommonJS and type declarations.

## Upgrade from 8.x

Version 9 changes the log output and some APIs. For example, it removes
`buildLogObject()` in favor of `buildOwnLogFields()`. Read the
[migration guide](MIGRATION.md#v8-to-v9) before you upgrade.

## License

[MIT](LICENSE)
