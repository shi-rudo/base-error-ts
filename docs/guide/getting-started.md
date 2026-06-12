# Getting Started

`@shirudo/base-error` is a base error class for TypeScript that works the same
across Node.js, edge runtimes and browsers. It gives you typed structured
errors, cause chains, and a **public projection** that is safe at the boundary
by default.

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
    // Technical message: for logs, never shown to clients by default
    super(`User with id ${userId} not found in database lookup`);
    this.withUserMessage(`We couldn't find that user.`);
  }
}

throw new UserNotFoundError("123");
```

## The one mental model that matters

The library splits every error into **two output paths**. Keeping them straight
is the whole point of the design.

| Path                                  | Method                                                        | What it contains                                                         |
| ------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Observability** (logs, Sentry, APM) | `toLogObject()` / `toJSON()`                                  | Everything: technical message, stack, cause chain, raw `details`         |
| **Client / user-facing**              | `toPublicJSON()` · `toProblemDetails()` · `toErrorResponse()` | Safe by default: nothing internal leaks unless you project it explicitly |

```ts
const err = new UserNotFoundError("123");

// Full truth → your logger / Sentry
logger.error(err.toLogObject());

// Safe projection → HTTP response
return Response.json(err.toProblemDetails({ status: 404 }));
```

Continue with [Why safe by default](./safe-by-default) to understand the
guarantee, or jump to [StructuredError](./structured-error) for typed codes and
categories.
