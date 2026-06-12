---
layout: home

hero:
  name: "@shirudo/base-error"
  text: "Errors that are safe at the boundary."
  tagline: A cross-environment base error class for TypeScript targeting Node.js, browsers and edge runtimes. Structured errors, RFC 9457 Problem Details, and a public projection that never leaks internal state by default.
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
  - title: Safe by default, invariant
    details: Client-facing serializers never expose technical messages, internal codes, categories or raw details. Standard and library fields always win; there is no override switch to audit.
  - title: Cross-environment
    details: Works across full Node.js, isolate edge runtimes (Cloudflare Workers, Deno Deploy, Vercel Edge) and modern browsers. Preserves native cause where available, degrades gracefully where not.
  - title: Structured & typed
    details: Typed error codes, categories, retryability and structured details. Discriminated _tag narrowing and instanceof that survives transpilation.
  - title: RFC 9457 Problem Details
    details: First-class toProblemDetails() and toErrorResponse(). Surface details only through explicit, reviewable mapDetails projections.
  - title: Built for observability
    details: toLogObject() keeps the full truth (technical message, stack, cause chain and raw details) for logs, Sentry and APM, separate from the client path.
  - title: Zero runtime dependencies
    details: Ships ESM + CJS + types, tree-shakeable, no peer dependencies.
---
