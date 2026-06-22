---
layout: home

hero:
  name: "@shirudo/base-error"
  text: "Errors that are safe at the boundary."
  tagline: A cross-environment base error class for TypeScript targeting Node.js, browsers and edge runtimes. A purely technical core plus an optional presentation layer for safe, localized public output that never leaks internal state by default.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Why safe by default
      link: /guide/safe-by-default
    - theme: alt
      text: View on GitHub
      link: https://github.com/shi-rudo/base-error-ts

features:
  - title: Safe by default
    details: The core has no client serializer. Client-facing output is produced only by the presentation layer's explicit allowlist (a public code, a localized message, and any deliberately projected details), so internal state never leaks by accident.
  - title: Cross-environment
    details: Works across full Node.js, isolate edge runtimes (Cloudflare Workers, Deno Deploy, Vercel Edge) and modern browsers. Preserves native cause where available, degrades gracefully where not.
  - title: Structured & typed
    details: Typed error codes, categories, retryability and structured details. Discriminated _tag narrowing and instanceof that survives transpilation.
  - title: Public presentation layer
    details: Optional subpath modules turn a technical error into a safe, localized PublicErrorView and map that view to framework-neutral RFC 9457 Problem Details without exposing the technical error.
  - title: Built for observability
    details: toLogObject() keeps the full truth (technical message, stack, cause chain and raw details) for logs, Sentry and APM, separate from the client path.
  - title: Zero runtime dependencies
    details: Ships ESM + CJS + types, tree-shakeable, no peer dependencies.
---
