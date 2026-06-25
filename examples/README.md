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
```
