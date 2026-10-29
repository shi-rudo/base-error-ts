# The pino and Sentry setups as subpaths

Status: implemented; release: 9.1.0.
Tracking: `base-error-ts-fiq`.

## Decision

The library ships its setups for pino and Sentry as two subpaths:

| Subpath | Source | Exports |
| --- | --- | --- |
| `@shirudo/base-error/pino` | `src/pino/index.ts` | `pinoErrorOptions` |
| `@shirudo/base-error/sentry` | `src/sentry/index.ts` | `beforeSend`, `logObjectContextIntegration` |

The exports keep the names and the behavior of the tested setups in `examples/`.

- `pinoErrorOptions` holds `serializers.err` and `hooks.logMethod`. A consumer spreads it into the options of pino. A consumer with own serializers or hooks reads the two parts from it.
- `beforeSend` writes each exception of a Sentry event through `logObjectOf`. `logObjectContextIntegration()` adds the log object as the `error` context.

The subpaths add no dependency:

- The source imports no runtime value of pino or Sentry. Neither SDK is a dependency or a peer dependency.
- The declarations use own structural types and name no type of an SDK. A consumer needs no SDK to resolve them.
- Type tests (`.types.ts`) assert that `pinoErrorOptions` fits `LoggerOptions` of pino, and that `beforeSend` and the integration fit `Options` of `@sentry/core`. `NodeOptions` of `@sentry/node` extends that type and does not declare the two fields again. The SDKs stay dev dependencies for these tests and for the runtime tests.

## Problem

Both setups keep the redaction policy of an error at a third-party sink. As modules that a consumer copies, they had two weaknesses:

- A copy never receives a fix. One review of the Sentry setup found nine defects, among them an event that lost its exceptions and an event that Sentry dropped. A consumer who copied the first version keeps these defects.
- The guide showed the module with imports from `@sentry/node`, and no test compiled that import. A first draft imported a type that `@sentry/node` does not export.

## Placement

Each subpath gets its own area in `src/`, as `src/public-error/` does for the client boundary. An area has the name of its subpath, so the tree shows what the package ships.

The dependency points one way: a subpath imports the core, and the core never imports a subpath. The lint rule that guards `public-error` extends to `pino` and `sentry`.

Structure rule 6 of the project rules places a technical helper in the consumer. A setup is no such helper. It speaks the vocabulary of the error model: the log object, the policy, the cause and the members. It is an adapter between the log boundary of this library and one sink, as `public-error` is an adapter between the error and a client. So it lives in the library.

## Surface

Two subpaths enter the public surface, and every list of the surface names them:

- the `exports` and `typesVersions` of `package.json`, and the `exports` of `jsr.json`;
- the entries of `tsup.config.ts`;
- `src/__tests__/package-exports.test.ts`;
- the packed-consumer check in `scripts/packed-consumer/` and `scripts/verify-packed-consumer.mjs`.

Both modules are edge-clean: they read no `process` and import no `node:*` module.

## Supported versions

The tests run against the versions in the lockfile: pino 10 and `@sentry/core` 11. The guides name these versions. A new major version of an SDK gets a test run before a release states support for it.

The Sentry setup relies on two parts of the event protocol: `hint.originalException`, and the `exception_id`, `parent_id` and `source` of an exception mechanism. The pino setup relies on `hooks.logMethod` and the default `errorKey`.

## Alternatives

- **Modules to copy.** No fix reaches a consumer, and the guide must carry the code. Rejected for the reasons in *Problem*.
- **Optional peer dependencies, with SDK types in the declarations.** The declarations then need the SDK to resolve. The package manager reports peer warnings, and the package metadata couples the release of this library to the versions of each SDK. Rejected.
- **Separate packages, for example `@shirudo/base-error-sentry`.** Each package needs its own release, version and publish workflow. The subpaths share the release and the tests of the core. Rejected.

## Consequences

- Semantic versioning covers the two subpaths. A breaking change in an SDK can force a release of this library.
- The guides show an import instead of a module. The examples become demos of the subpaths.
- `CLAUDE.local.md` names `src/pino/` and `src/sentry/` as areas, next to `errors/`, `traversal/` and `public-error/`.
