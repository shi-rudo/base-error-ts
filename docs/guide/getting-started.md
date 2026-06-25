# Getting Started

`@shirudo/base-error` is a base error class for TypeScript that works the same
across Node.js, edge runtimes and browsers. It gives you typed structured
errors, cause chains, and a separate, optional
[public-error pipeline](./public-error) for safe, localized client-facing output.

## Installation

::: code-group

```bash [pnpm]
pnpm add @shirudo/base-error
```

```bash [npm]
npm install @shirudo/base-error
```

```bash [yarn]
yarn add @shirudo/base-error
```

:::

The package ships ESM, CommonJS and type declarations, and has **zero runtime
dependencies**.

## Your first error

```ts
import { BaseError } from "@shirudo/base-error";

class UserNotFoundError extends BaseError<"UserNotFoundError"> {
  constructor(userId: string) {
    // Technical message: for logs, never shown to clients
    super(`User with id ${userId} not found in database lookup`);
  }
}

throw new UserNotFoundError("123");
```

## The one mental model that matters

There are **two output paths**, and they live in two places. Keeping them
straight is the whole point of the design.

| Path                                  | Where                                | What it contains                                                 |
| ------------------------------------- | ------------------------------------ | ---------------------------------------------------------------- |
| **Observability** (logs, Sentry, APM) | core `toLogObject()` / `toJSON()`    | Everything: technical message, stack, cause chain, raw `details` |
| **Client / user-facing**              | [public-error pipeline](./public-error) | Only an explicit allowlist: public code, localized message       |

```ts
const err = new UserNotFoundError("123");

// Full truth → your logger / Sentry
logger.error(err.toLogObject());

// Safe projection → HTTP response (see the presentation guide)
const view = presenter.present(err, { locales: ["en"] });
return Response.json(view, { status: 404 });
```

The core has no client serializer: anything a user sees is produced by the
[public-error pipeline](./public-error), which you opt into via the
`@shirudo/base-error/presentation` subpath.

Continue with [Why safe by default](./safe-by-default) to understand the
guarantee, or jump to [StructuredError](./structured-error) for typed codes and
categories.
