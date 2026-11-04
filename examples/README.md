# BaseError Examples

This directory contains examples of how to use the `BaseError` and `StructuredError` classes in different scenarios.

## Examples

1. **Basic Usage** - Shows how to create custom error classes extending BaseError
2. **Error Handling** - Demonstrates error handling patterns with BaseError
3. **Structured Errors** - Using StructuredError with codes, categories, and retryability
4. **Error Codes** - Type-safe error codes with union types
5. **Domain Errors** - Domain error hierarchy with instanceof handling
6. **Automatic Name** - Automatic name inference feature
7. **Cause Chain** - Preserving and walking the cause chain
8. **Public Error E2E** - Hono `onError` → TanStack server fn → React `useQuery`, showing the project/localize/toProblem stages across a real wire (client- and backend-localized)
9. **pino Logger** (`pino-logger.ts`) - Logs a masked error through the subpath `@shirudo/base-error/pino`
10. **Sentry Reporter** (`sentry-reporter.ts`) - Reports a masked error through the subpath `@shirudo/base-error/sentry`, without a DSN and without a network call
11. **Voucher Service** (`voucher-service/`) - One small HTTP service that composes the whole feature set: catalog, validation, aggregate fan-out, retry decision, redacted logging, queue round-trip, and localized RFC 9457 responses
12. **Fastify Error Handler** (`fastify-error-handler.ts`) - `setErrorHandler`, `frameworkErrors` and `setNotFoundHandler` send only the result of the public-error pipeline and log the error. Real requests check the responses and the log lines
13. **Express Error Handler** (`express-error-handler.ts`) - An error middleware with four parameters and a not-found middleware send only the result of the public-error pipeline and log the error. Real requests check the responses and the log lines
14. **Nest Exception Filter** (`nest-exception-filter.ts`) - An exception filter with `@Catch()` sends only the result of the public-error pipeline and logs the exception. Real requests check the responses and the log lines

## Running the Examples

To run an example:

```bash
# Install dependencies first
pnpm install

# Run a specific example
pnpm tsx examples/basic-usage.ts
pnpm tsx examples/error-handling.ts
pnpm tsx examples/structured-errors-example.ts
pnpm tsx examples/public-error-e2e.ts

# Nest needs the legacy decorators of this config
pnpm tsx --tsconfig tsconfig.examples.json examples/nest-exception-filter.ts
```
