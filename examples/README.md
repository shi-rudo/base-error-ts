# BaseError Examples

This directory contains examples of how to use the `BaseError` and `StructuredError` classes in different scenarios.

## Examples

1. **Basic Usage** - Shows how to create custom error classes extending BaseError
2. **Error Handling** - Demonstrates error handling patterns with BaseError
3. **Structured Errors** - Using StructuredError with codes, categories, and retryability
4. **Error Codes** - Type-safe error codes with union types
5. **Domain Errors** - Domain error hierarchy with instanceof handling
6. **Automatic Name** - Automatic name inference feature
7. **Problem Details** - RFC 9457 compliant error responses with `toProblemDetails()`
8. **Error Response Builder** - Type-safe error responses with the builder pattern

## Running the Examples

To run an example:

```bash
# Install dependencies first
pnpm install

# Run a specific example
pnpm tsx examples/basic-usage.ts
pnpm tsx examples/error-handling.ts
pnpm tsx examples/problem-details-example.ts
pnpm tsx examples/error-response-builder-example.ts
```
