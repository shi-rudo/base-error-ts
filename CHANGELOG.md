# Changelog

## Unreleased

### Fixed

- **The catch paths no longer throw on a hostile cause.** The log serializer, `toString()`, the cause-chain helpers and the shape guards read `name`/`message`/`stack`/`code`/`category`/`retryable`/`details`/`cause` from values this library did not create, inside `catch` blocks where a new exception destroys the original error. Those reads were unguarded: a throwing getter on a cause's `stack` made `toLogObject`/`toJSON`/`JSON.stringify(err)` throw, a throwing `cause` getter broke `getRootCause`, `isChainRetryable`, `findInCauseChain` and `toString()`, and a Proxy with throwing traps made `isStructuredError`/`isRetryable`/`isErrorWithCause` throw instead of returning `false`. Every foreign read now goes through one guarded reader (a throwing getter reads as absent), the guards fail closed, and a cause node that still defeats serialization becomes a `"[Unserializable cause]"` marker while its well-behaved neighbors are logged in full.

- **`toString()` renders a cause with no string form.** A null-prototype object cause, or one whose `Symbol.toPrimitive` throws, made `String(cause)` throw out of `toString()`, which is exactly the render a template-literal log line runs in a `catch`. Such a node now renders as `[Unrenderable cause]`; an `Error` whose `name`/`message` getter throws falls back to the `Error.prototype` defaults.

- **`StructuredError.fromJSON` carries a total node budget.** Reconstruction bounded depth (100) and the members per aggregate (100), but not their product: a payload with a 100-wide aggregate nested three deep reconstructs a million `Error` objects, each capturing a stack (measured at 3 s), and a shared reference makes such a payload a few hundred bytes in memory. One `fromJSON` call now reconstructs at most 10,000 cause nodes, sized above the ~1500 nodes a maximal output of this library's own serializer carries, so a log-shape round-trip stays lossless while a hostile payload is capped at tens of milliseconds. Past the budget, a `cause` drops exactly as it does past the depth cap, and the remaining members of an aggregate collapse into the `[N more aggregated errors]` marker.

- **`PublicErrorCatalog` validates a descriptor before inserting it.** `registerByCode` and `register` stored the descriptor first and validated second, so a rejected descriptor (an invalid `status`, an empty `type`, a category outside the declared set) stayed half-registered: it resolved for its internal code, had no transport, so `toProblem` threw on it, and held the code, so the corrected registration was refused as a duplicate. The insert now happens only after validation; a throw leaves the catalog as it was.

- **The `exports` map pairs each build with its own declarations.** Both entry points declared one `types` file, the ESM `.d.ts`, for the `import` and the `require` condition alike, so a CommonJS TypeScript consumer under `moduleResolution: node16` resolved `require` to `index.cjs` but its types to the ESM declarations (TS1479, "masquerading as ESM"), and under the legacy `node10` resolution the `@shirudo/base-error/public-error` subpath did not resolve at all. tsup has always emitted the `.d.cts` twins; they were never referenced. `types` is now nested per condition (`import` pairs `.js` with `.d.ts`, `require` pairs `.cjs` with `.d.cts`) and a `typesVersions` map resolves the subpath under `node10`. Verified with `@arethetypeswrong/cli` on the packed tarball (all four resolution modes green) and by typechecking a CJS, an ESM and a `node10` consumer against the tarball with TypeScript 5.0.4.

- **The cause serializer, `toString()`, `toStructuredError` and `toProblem` recognize their inputs by shape, not `instanceof`.** `instanceof` is realm-bound: an `Error` from a worker, an iframe, a `vm` context or a second copy of this package (CJS next to ESM, two versions in one dependency tree) fails it. The cause serializer then took the plain-object path, which drops the non-enumerable `name`/`message`/`stack`, and logged `{}`; `toStructuredError` wrapped such an error as "Unknown error" and did not pass a foreign `StructuredError` through; `toProblem` mistook a catalog from the other copy for an explicit transport and threw on its missing `status`. The serializer and `toString()` now recognize a native error from any realm by its `Object.prototype.toString` tag (a plain object that merely looks like an error keeps the plain-object path, which preserves all of its fields); `toStructuredError` uses the library's own `isError`/`isStructuredError` guards, where "a `StructuredError`" means the shape together with its behavior (`toLogObject`), so a parsed payload with the three fields is still wrapped; `toProblem` tells a catalog from a transport by `transportFor`. The native-error check prefers `Error.isError` where the runtime has it; its `Object.prototype.toString` fallback rejects values carrying a `Symbol.toStringTag` first, because the tag overrides `toString`: a plain object tagged `"Error"` would otherwise masquerade as native and lose every enumerable field from the log. And `toStructuredError`'s pass-through requires the full shape it promises: an error-like value (string `name`/`message`) with the structured fields and `toLogObject`; a bare payload faking a method is wrapped instead of being returned as a `StructuredError` it cannot act as.

- **`redactAllow` keeps the serializer's own markers on a nested cause, and only there.** The cycle and depth markers (`[Circular cause chain]`, `[Max cause depth exceeded]`) the serializer writes under a nested cause's `cause` key sat in the cause region under a non-envelope key, so an allow-list masked them to `[REDACTED]`: a log cut short by a cycle looked like a log whose cause was a secret. Both walker branches now keep the markers, matched exactly and **only in the cause region**, where the serializer writes them. That region gate also closes the reverse gap, present since 8.2.0 in the array branch: a user value that is byte-identical to a marker (`details.password = "[Circular cause chain]"`) counted as the library's own words and slipped past the deny- and the allow-list; in a data region it is user data and is masked. The new `[Unserializable cause]` marker is covered the same way.

- **Construction no longer symbolizes the stack on Node 20.** The lazy-stack installer redefines `this.stack` with its memoizing accessor. On V8 11 (Node 20) that redefinition first materializes the stack `super()` captured, which calls `Error.prepareStackTrace` eagerly on every construction, for frames nobody reads; V8 12+ (Node 22+, where `stack` is a plain accessor pair) does not. The engine-managed property is now deleted before the accessor is installed, which discards the unread frames without formatting them on every engine. This also turned the `test (20.x)` CI job red on every `main` run since 8.1.0; `test (22.x)` and workerd were unaffected.

- **The bundles no longer report the base class as `_BaseError`.** The bundler rewrites a class into a renamed binding when its body reads its own statics, so in `dist/` a direct `new BaseError(message)` inferred `name` and `_tag` as `"_BaseError"` from `constructor.name`. A direct construction now uses the literal `"BaseError"`; subclasses keep constructor-name inference (with the documented advice to pass an explicit `name` or a literal `_tag` under minification), and every other class in the package already sets an explicit name. A post-build check (`scripts/verify-dist.mjs`, run by tsup after each build) now fails the build when a bundle leaks a mangled name.

- **Four guard-then-raw-read gaps closed.** `toStructuredError` read `value.toLogObject` and `value.message`, and `isRetryableStructuredError` read `value.retryable`, unguarded right after their fail-closed guards; `readErrorCode`'s `"code" in error` probe sat outside its try block. A throwing getter, a stateful getter, or a Proxy with a throwing `has` trap threw out of coercion, retry decisions, and catalog resolution (`project` lost its totality). All four sites now read through the guarded reader; a message that stops being readable falls back to the default message.

- **A `bigint` cause is logged as its decimal string.** `#serializeCause` returned primitives as-is, but a `bigint` has no JSON form, so `JSON.stringify(err)` threw inside the consumer's logger, where the fail-closed redaction catch cannot reach. The plain-object cause path already guarded `BigInt`; the primitive path now writes `10n` as `"10"`. `details` stay the caller's raw data, as documented.

## 8.2.0 - 2026-08-18

Aggregate errors, end to end. An `AggregateError` used to enter this library and lose everything that made it useful: its members never reached a log, never survived the wire, and never reached a retry decision. This release closes that path in the serializer, the redaction walker, `fromJSON`, `toString` and the cause-chain helpers, adds a first-class aggregate of your own, and fixes one unrelated allow-list gap found on the way.

### Added

- **`StructuredAggregateError`**: a `StructuredError` that collects several failures in `errors`, for a `Promise.allSettled` fan-out, a batch job, or saga compensation. It carries the members in the same field a native `AggregateError` uses, so every aggregate-aware path in this library works on it unchanged. It deliberately does **not** extend `AggregateError`: single inheritance is already spent on `BaseError`, the iterable-first constructor conflicts with the options object used everywhere else, and consumers duck-type `errors` anyway. The members are copied on construction, so a later mutation of the caller's array cannot change what gets logged.

- **Opt-in aggregate traversal for the cause-chain helpers.** `findInCauseChain`, `filterCauseChain`, `someCauseChain`, `everyCauseChain`, `isChainRetryable`, `someChainRetryable` and `getFirstRetryableCause` now accept `CauseTraversalOptions` (`{ maxDepth?, aggregates?, maxNodes? }`) wherever they accepted a `maxDepth` number, which still works. With `aggregates: true` the walk becomes depth-first over the tree (a node, then its `cause`, then its members) and is bounded by `maxNodes` (default 1000), because depth bounds a chain but not the width of a tree. The default stays linear on purpose: turning a chain into a tree changes what `everyCauseChain` means, and an existing retry decision must not change meaning on upgrade. `getRootCause` takes no such option, since a tree has no single deepest node.

- **`toString()` shows aggregate members.** An aggregate node gets a `(+N aggregated)` count, and each member is rendered as its own chain, indented below it, capped at 100 with a count marker. Cycles and repeated branches end in the existing `[Circular cause chain]` marker, and a deny-listed `message` stays masked per `BaseError` in the tree. The recursion carries the same depth cap as the log serializer, so a pathologically deep tree degrades to a marker rather than overflowing the host stack, which is far smaller on an edge isolate.

### Fixed

- **Aggregate causes no longer vanish from logs.** When a cause carries an `errors` array (a native `AggregateError` from `Promise.any` or from a dual-stack connect failure, or a custom fan-out error with the same shape), `toLogObject`/`toJSON` now serialize its members. `errors` is a **non-enumerable** own property on every supported runtime (verified on Node 20+/24, Bun 1.3, Deno 2.7 and workerd), exactly like `message` and `stack`, so it was silently dropped: a `fetch()` failure against an unreachable dual-stack host logged `AggregateError` with no indication of what actually failed on either address. Members are read by shape rather than by `instanceof AggregateError`, so cross-realm and custom aggregates serialize too. Each aggregate node is capped at 100 members (the remainder collapses to a `"[N more aggregated errors]"` marker), shares the existing cause-depth cap of 100, and reuses the chain's cycle detection, so a self-referencing or shared branch is marked instead of walked twice.

- **`redactAllow` keeps the structural envelope of aggregate members.** An aggregate's members are further cause nodes, so each one keeps the documented cause envelope (`name`/`message`/`stack`/`code`/`category`/`retryable`) while everything else it carries stays data and is masked. Without this the fix above would have logged a fully masked array under an allow-list. The transition is by key name only, the same trust model `cause` already uses, and it applies at the root as well, so an aggregating error of your own logs readable members. `errors` is deliberately **not** in the root envelope key set: only a container transitions region, so a scalar sitting at `errors` stays a masked data leaf. A member that is not error-shaped is data too: a `Promise.allSettled` reason can be any value, and a string member is masked like any other scalar. Aggregate members also stay out of the data-depth budget, like the rest of the cause spine, so a deep aggregate cannot marker-truncate a shallow `details` beneath it.

- **`StructuredError.fromJSON` reconstructs aggregates.** An aggregate cause comes back as a real `AggregateError` with its members, own `stack` and nested `cause` restored; a structured error that carried its own `errors` keeps them as a non-enumerable property, the way a native aggregate holds them. This closes the round-trip opened by the serialization fix and matters more than it looks: `structuredClone` drops an `AggregateError`'s members and degrades the class to a plain `Error` on all four runtimes (Bun additionally drops `cause`), so for aggregates this is the only lossless way across a worker or queue boundary.

- **`StructuredError.fromJSON` restores a Node-style errno `code` on plain errors.** The serializer has always written `code` for a non-structured cause, but reconstruction dropped it unless the full `code`/`category`/`retryable` triple was present, so an `ECONNREFUSED` error came back as an anonymous `Error` that `hasErrorCode("ECONNREFUSED")` no longer matched. Surfaced by the aggregate work, since an aggregate's members are typically exactly those errno errors. The field stays alone: without `category`/`retryable` the result still does not read as a `StructuredError`.

- **`redactAllow` masks scalar values inside an array.** The allow-list judges a leaf by its key, and an array element has no key, so every scalar element passed through unmasked: `details.tokens: ["s3cret"]` survived a `redactAllow([])` in full while the sibling `details.nested.token` was masked. An element is now judged under the key of the array that holds it, in every region, so a list of tokens is masked element by element unless that key is allowed. The one exception is a marker the serializer itself wrote (`[Circular cause chain]`, `[Max cause depth exceeded]`, `[N more aggregated errors]`), matched exactly: those are the library's own words, and masking them would make a truncated log look complete. **This masks values that logs kept before**; allow-list the array's key to keep them.

- **Documented that the cause-chain helpers do not descend into `errors` by default.** `someChainRetryable`, `isChainRetryable`, `getRootCause` and the rest follow `cause` unless you opt in, so a retryable branch inside an aggregate does not influence a retry decision by default. Both guides describe the opt-in and the reason for the default. The retryability table in the cause-chain guide also described `isChainRetryable` as "every `StructuredError` in the chain is retryable"; it has always been an existence check, and the table now says so.

### Changed

- **The TypeScript `lib` is pinned to ES2021** (the emit `target` stays ES2020). `AggregateError` is an ES2021 global and is now referenced by name in the serializer; every supported host ships it. Declaring `lib` explicitly also drops the implicit DOM lib, which this package never used. This is a build setting only: no public type names `AggregateError`, so a consumer on an ES2020 `lib` is unaffected. The floor for consumers is unchanged at TypeScript 5.0, verified by typechecking a full consumer against the built declarations with 5.0.4 under `strict` and `skipLibCheck: false`. `typescript` stays out of `peerDependencies`, as decided in 5.0.0.

## 8.1.0 - 2026-07-04

Hardening release from a full code audit: two redaction gaps, totality of the traversal helpers, reference leaks at the curation boundaries, CPU-exhaustion bounds on the clone walkers, and a faster constructor. All changes are fixes within the documented contracts; the individually noted behavior tightenings are deliberate.

### Fixed

- **`redactAllow` no longer leaks subclass-added top-level fields.** A field a subclass added via `buildLogObject` (the documented extension pattern) inherited the root region's keep-everything, so every leaf beneath it survived the allow-list unmasked. Now only the library's own structural envelope (`name`/`message`/`stack`/`code`/`category`/`retryable`/`timestamp`/`timestampIso`/`cause`/`details`) is kept at the top level; any other top-level key and its whole subtree get the same leaf-level allow-list protection as `details`, so a newly added field leaks nothing by default. Logs may now mask subclass fields that previously passed through: allow-list their leaf keys explicitly to keep them. The deny-list (`redact`) is unaffected.

- **`toString()` honors a deny-listed `"message"`.** After `err.redact(["message", ...])`, the one-line render (and each redacted `BaseError` in the printed cause chain) shows the mask instead of the raw technical message, fail-closed if a function mask throws. The remaining scope is documented on `redact`/`redactAllow`/`redactWith`, in the observability guide, and as a new pitfall: `err.stack` (whose header carries the raw message) and Node's `console.log(err)` inspection stay unredacted, so route errors through a structured serializer that hits `toJSON` when redaction matters.

- **The cause-chain traversal helpers are total over circular chains.** `getRootCause`, `findInCauseChain`, `filterCauseChain`, `someCauseChain`, `everyCauseChain`, and the retryability helpers built on them no longer throw `"Circular cause chain detected"`. They run inside catch paths, where a circular chain (a bug in someone's error wiring) must not turn a retry decision into a new crash; `BaseError`'s own serialization already degrades gracefully on cycles. A cycle now terminates the traversal once the repeated node is reached: every node is visited exactly once (previously the repeated node was yielded a second time before the throw), `getRootCause` returns the deepest error before the repeat, and the predicate helpers evaluate over each distinct node. Callers that caught the circular-chain error can drop that handling. `maxDepth` is documented as the number of cause hops followed (up to `maxDepth + 1` nodes), matching existing behavior.

- **`project()` emits `fields` as a frozen, curated copy** of exactly `{ field, code }` per fault. Previously the projector's array and fault objects rode into the view by reference, so foreign extra properties on a fault (validator internals) survived curation, and later mutation of internal state reached the view. `details` intentionally stays by reference (the in-process view may hold rich values; `toProblem` remains the wire boundary); the `projectDetails` contract now documents that projectors must return fresh, vetted data.

- **`ValidationError.publicIssues()` emits `path` as a fresh copy** with object segments narrowed to `{ key }`. Previously the stored path array and its segment objects crossed the whitelist by reference, so extra properties a validator attached to a segment (and later mutations of the stored issue) reached the wire shape. A custom `mapIssue` replaces the whitelist entirely and must narrow forwarded paths itself; its JSDoc now says so.

- **The deep-clone paths carry a 100,000-node budget** as a CPU-exhaustion guard: cycles were already rejected, but shared (DAG) references clone once per reference, so a small hostile value could legally expand exponentially. Past the budget, `cloneJsonSafe` (the `toProblem` wire boundary) fails like any other non-JSON-safe value (the member drops to `outcome.omitted`), `defineErrors` rejects the metadata at definition time, log redaction degrades the subtree to a `"[Max redaction size exceeded]"` marker, and a plain-object `cause` degrades to the descriptive fallback marker during log serialization (enforced by a counting replacer on the native `JSON.stringify` round-trip, which measures faster than any JS-walker replacement).

- **`defineErrorClassSet` validates its definition more strictly**: it rejects empty/whitespace-only keys (matching `defineErrors`) and throws at definition time when a base class is listed before one of its subclasses, where first-match-wins dispatch would silently make the subclass handler unreachable; the error message names both keys and the fix (list subclasses first). Previously-accepted definitions with that ordering bug now fail fast.

- **`StructuredError.fromJSON` copies `details` shallowly** instead of keeping the payload's object by reference, so mutating the input payload after reconstruction no longer changes the error's details (top level; nested values stay shared, as documented).

- **`timestampIso` is derived from `timestamp`** instead of a second clock read, so the two fields can no longer disagree when construction straddles a millisecond boundary.

- **The JSR manifest declares a publish filter** (`src` without tests, plus README/LICENSE/CHANGELOG), so a `jsr publish` no longer ships `proposals/`, `docs/`, `coverage/`, `examples/`, or `dist/` to the registry.

### Changed

- **Stack traces are captured eagerly but symbolized and filtered lazily** on the first `stack` read, and the constructor's `setPrototypeOf` runs only when the prototype actually needs repair (ES5-transpiled subclasses). Constructing an error whose stack is never read no longer pays for V8 stack formatting: about 37% faster construction at 50-frame call depth in a local benchmark, in exchange for a few percent extra on the first read. `stack` is a memoizing accessor until first read (then a plain writable property); assigning `stack` before the first read wins unfiltered, and filtering, header rewriting, and non-V8 fallback behavior are unchanged.

## 8.0.0 - 2026-06-25

### Added

- New `@shirudo/base-error/public-error` subpath: a public-error pipeline of three independent stages over one descriptor per public code, `project` (curation, total over `unknown`, message-free), `localize` (optional localization, keyed on the public code), and `toProblem` (RFC 9457 transport producing a JSON-safe, frozen `ProblemDetails` body). Serves three consumption modes from one registration: client-localizing (SPA/Edge), backend-localizing (SSR/email), and a consumable third-party API. Includes a typed public-code union (`PublicCodeOf`) for exhaustive client branching, typed `extensions` on the problem body, an `onProject` observability hook, catalog-free entry points (`projectWithDescriptor`, explicit transports), and registration-time validation and conflict checks for the wire identity. See proposal 0011 and the runnable `examples/public-error-e2e.ts`.

### Removed

- **BREAKING:** the `@shirudo/base-error/presentation` and `@shirudo/base-error/problem-details` subpaths, superseded by the public-error pipeline. `PublicErrorPresenter` / `PublicErrorRegistry` / `PublicErrorDefinition` are replaced by `project` + `localize` + `PublicErrorCatalog` + `PublicErrorDescriptor`; `defineProblemDetailsAdapter` by `toProblem`. The localization primitives `LocalizedMessageSet` and `resolveUserMessage` now live on the `public-error` subpath.

### Changed

- Extracted shared internal helpers (a JSON-safe clone-and-freeze, the RFC 9457 status/type validation and the `application/problem+json` media type, and the code-then-predicate error resolution) into `src/utils`, reused across the library.

## 7.1.1 - 2026-06-23

### Fixed

- `matchError` now looks up handlers by own property only, so an error `code` that collides with an `Object.prototype` member (`toString`, `valueOf`, `hasOwnProperty`, `constructor`, …) routes to its explicit case or the `_` catch-all instead of an inherited method. Such codes are already valid in `defineErrors`, so a catalog union could previously mis-dispatch (or throw a confusing error) on match.
- `BaseError` cause serialization (`toLogObject`/`toJSON`) caps the cause chain at depth 100, matching `StructuredError.fromJSON` and the traversal helpers, so a pathologically deep but acyclic chain no longer risks a stack overflow while logging. Beyond the cap the chain ends in `"[Max cause depth exceeded]"`.
- Log redaction (`redact`/`redactAllow`/`redactWith`) now clones into null-prototype objects, so an own `__proto__` (or `constructor`) key in untrusted `details` (e.g. from `JSON.parse`/`fromJSON`) is masked as ordinary data instead of routing through a prototype setter. Closes a local prototype-reassignment footgun on the redacted log clone; global prototypes were never affected. (OWASP Prototype Pollution Prevention.)
- Log redaction caps its walk depth at 100: a pathologically deep `details` tree degrades to a `"[Max redaction depth exceeded]"` marker at the deep end (shallow fields survive) instead of overflowing the stack and tripping the fail-closed path. The bound is host-stack independent, so redaction behaves identically on small isolate stacks (edge runtimes).

### Documentation

- Documented on `toLogObject`/`toJSON` that the output is a log shape carrying the technical message, stack, cause chain and raw `details`, must never be returned to a client, and that the `presentation` subpath is the client-safe path. The `toJSON`/`toLogObject` equality is intentional: it is the shape `StructuredError.fromJSON` reconstructs.

## 7.1.0 - 2026-06-22

### Added

- Added the optional `@shirudo/base-error/problem-details` subpath with a framework-neutral RFC 9457 adapter for safe `PublicErrorView` values.
- Added finite public-code mappings, an explicit fallback, consistent HTTP/body status output, localized titles, occurrence details and instances, JSON-safe extensions, immutable snapshots, mapping diagnostics, and compile-time collision protection.
- Added literal public-code typing to `PublicErrorView<TDetails, TCode>` while preserving the existing default `string` code type.

## 7.0.0 - 2026-06-22

### Breaking Changes

- Catalog factories now live under `catalog.create`: migrate `AppErrors.CODE(message, options)` to `AppErrors.create.CODE(message, options)`.
- Catalog definitions declare transport-neutral `metadata` instead of the fixed top-level `httpStatus`; read it through `AppErrors.meta(code).metadata`.
- Catalog detail shapes use `detailsType<T>()` instead of consumer-side type assertions.
- Catalog definitions must be non-empty finite plain objects with non-empty string codes and are snapshotted and frozen at creation.

### Added

- Added catalog-local provenance guards: `AppErrors.is(value)` narrows to the catalog union and `AppErrors.is(value, code)` narrows to one generated error type. Forged, reconstructed, mutated, and foreign-catalog errors fail closed.
- Added `CatalogErrorOf<Catalog, Code>`, immutable `codes`, JSON-safe generic catalog metadata, and catalog-level deny/allow log-redaction policies.
- Error codes no longer collide with catalog operations, so codes such as `meta`, `create`, and `is` are valid.

## 6.3.0 - 2026-06-21

### Added

- Added `defineErrorClassSet` for reusable exhaustive matching over a finite set of local Error classes. Definitions preserve literal string keys, reject empty or duplicate constructor sets, snapshot their input, and require an exact handler table with precise inputs and result unions.

## 6.2.0 - 2026-06-21

### Added

- Added `matchThrown` and `ThrownMatcher` for immutable, first-match-wins handling of arbitrary caught values with constructor cases, constructor groups, type guards, boolean predicates, an explicit fallback, precise result unions, and native promise inference.

## 6.1.0 - 2026-06-21

### Added

- Added general-purpose guards for caught `unknown` values: `isError`, `hasErrorCode`, `isErrorOf`, `isAnyErrorOf`, and `isAllOf`, plus the `ErrorLike`, `ErrorClass`, and `TypeGuard` types. Structural guards fail closed on hostile property access; constructor guards retain precise class unions, and guard composition narrows to intersections.

## 6.0.0 - 2026-06-13

### Breaking Changes

- The core is now purely technical. Localization, the `expose` flag, and every public serializer were removed from `BaseError` and `StructuredError`. Removed: `toPublicJSON()`, `toProblemDetails()`, `toErrorResponse()`, `withUserMessage()`, `addLocalizedMessage()`, `updateLocalizedMessage()`, `getUserMessage()`, `withPublicCode()`, `withPublicMessage()`, `exposeToClients()`, the `expose` flag, and `publicCode`/`publicMessage` on `ErrorOptions` and the catalog `ErrorSpec`. The `TPublicCode` generic parameter is gone.
- Removed the entire response layer: `errorResponse`, `successResponse`, `createErrorResponse`, `createSuccessResponse`, `ErrorResponseBuilder`, `ApiResponse`, `SuccessResponse`, `ErrorResponse`, `LocalizedMessage`, and the `ProblemDetails` / `ProblemDetailsOptions` types.
- `StructuredError.fromJSON` no longer restores user or localized messages.
- `defineErrors` keeps `httpStatus` and `meta(code)` but no longer accepts `publicCode` / `publicMessage`.
- Requires Node.js `>=20`.

See the [migration guide](./MIGRATION.md) for the removed-API to replacement mapping.

### Added

- New optional subpath export `@shirudo/base-error/presentation` for safe, localized, transport-neutral public output: `LocalizedMessageSet`, `resolveUserMessage`, `PublicErrorDefinition`, `PublicErrorRegistry` (with `assertCoverage`), and a total `PublicErrorPresenter` that produces a `PublicErrorView`. Transport (HTTP status, gRPC, CLI exit code) is a consumer adapter concern.

### Changed

- The module and edge boundaries are enforced by ESLint: the core may not import the presentation module, and library source may not use Node globals (`process`, `Buffer`) or `node:*` imports. The runtime-pure suite also runs on workerd (via `@cloudflare/vitest-pool-workers`) in CI.

## 5.0.0 - 2026-06-01

### Breaking Changes

- `StructuredError.toProblemDetails()` and `StructuredError.toErrorResponse()` are safe by default. They no longer expose technical messages, internal codes, categories, or raw `details` unless public fields or explicit exposure options are used.
- Safe-by-default is invariant: standard Problem Details members (`type`, `title`, `status`, `detail`, `instance`) and library members (`code`, `category`, `retryable`, `traceId`) always win over colliding extension keys. There is no override switch.
- Raw `details` never cross into client responses. Surfacing details is always an explicit `mapDetails` projection on both `toProblemDetails()` and `toErrorResponse()`; full-fidelity details remain available for observability via `toLogObject()`.
- The `_tag` discriminant and inferred `name` derive from a single resolved name (an explicit `name` option, otherwise the constructor name), so they never diverge and an explicit `name` stabilizes both. `StructuredError` fixes `_tag` to the stable literal `"StructuredError"`, making the discriminant minification-safe out of the box; subclasses inherit it (override with a literal for a distinct tag). Narrow on `code` to distinguish individual structured errors.
- `typescript` is no longer a peer dependency. The package still ships TypeScript declarations.
- Updated the package version from `4.7.0` to `5.0.0`.

### Added

- Added `toLogObject()` for explicit logging serialization with stack and cause chains.
- Added `toPublicJSON()` for client-safe serialization.
- Added `publicCode`, `publicMessage`, and `expose` options to map internal domain/infrastructure errors to stable public API errors.
- Added `BaseErrorOptions` and exported it from the package root.
- Added `ProblemDetailsOptions` and exported it from the package root.
- Added `detail` to `toProblemDetails()` options so boundary layers can provide a public, client-safe message separately from the technical error message.
- Added `extensions` for explicit public Problem Details extension members.
- Added `mapDetails` to `toProblemDetails()` and `toErrorResponse()` for DDD-friendly boundary mapping from raw domain/application details to public members. This is the only path for surfacing details to clients. It is invoked only when the error carries `details` and receives a defined `TDetails`, so callbacks never have to guard against `undefined`.
- Added `publicCategory` to `toProblemDetails()` for projecting a deliberate, client-safe category (symmetric with `toErrorResponse()`).
- `guard()` now also accepts an error factory (`() => BaseError`) so the error is constructed only when the assertion fails.
- Added `matchError(error, cases)`: exhaustive, type-narrowing dispatch on a structured error's `code`. Omitting a case is a compile error unless a `_` catch-all is given; each handler receives the error narrowed to its case, and the result type is the union of the handler return types.
- Added `redact(keys, { mask? })`, `redactAllow(keys, { mask? })` and `redactWith(fn)`: sticky, opt-in PII redaction on the **log** path (`toLogObject`/`toJSON`), so even a logger's `JSON.stringify(error)` is masked. `redact` deep-masks matching keys (deny-list, default mask `"[REDACTED]"`, configurable); `redactAllow` is an allow-list that masks every `details` leaf except the listed ones (higher assurance, meaning new fields leak nothing); `redactWith` transforms the whole log object (e.g. scrubbing free text in `message`, or delegating to a dedicated redaction library). The mask may be a string or a function `(value, key) => unknown` for partial masking (`****6789`) or type preservation.
- `StructuredError.fromJSON` now restores author-provided `userMessage` and localized messages on round-trip (previously dropped). Documented that it always returns a base `StructuredError`: subclass identity (e.g. `ValidationError`) and `publicCode`/`publicMessage` (not in the log shape) are not reconstructed.
- `defineErrors` now rejects `"meta"` as an error code (it is the metadata accessor), and `meta(code)` throws a clear "unknown error code" error for codes absent from the catalog (instead of returning `undefined` and crashing the `.httpStatus` access) and returns a copy of the spec row so callers can't mutate the catalog.
- `toStructuredError` now returns `StructuredError<string, string>` instead of the option's literal code/category. A pre-existing `StructuredError` passes through unchanged, so promising the option literal in the return type was unsound (downstream `code === '…'` / matchError would compile but never match).
- Hardened redaction. `redactAllow` masks every non-allowed leaf across **any** data region (a `details` subtree at any depth and a cause's data fields) while leaving the top-level envelope and a cause's structural envelope keys (`name`/`message`/`stack`/`code`/`category`/`retryable`) intact; any _other_ field on a cause is data, so an object that merely resembles a structured error can't smuggle siblings past the allow-list (the classification is by position, not by a spoofable shape check). The deny-list (`redact`) masks matching keys at any depth, **including inside class instances**. The shared walker treats `Date`/`Map`/`Set` (and other own-key-less objects) as preserved leaves instead of collapsing them to `{}`, and descends into objects that carry own enumerable keys. The fail-closed marker keeps non-sensitive triage fields (`name`/`code`/`category`/`retryable`/timestamps).
- Added `partialMask({ keepStart?, keepEnd?, fill? })`: a `RedactMask` builder that reveals a prefix/suffix and masks the middle (`sk_live…AbCd`), useful to show _which_ secret it was. Fully masks values too short to reveal safely (`length <= keepStart + keepEnd`) and non-strings. A throwing redactor is **fail-closed**: it neither crashes the logging path nor leaks the payload. The client serializers are unaffected (already safe). Defense-in-depth, not a replacement for logger-level redaction.
- Added `StructuredError.fromJSON(json)`, the inverse of `toJSON`: reconstructs a typed `StructuredError` (with `code`/`category`/`retryable`/`details`, the original `stack`/`timestamp`, and the cause chain) from the serialized shape. For reconstruction within one trust/bounded-context boundary (worker/`postMessage`, queues/storage, log replay); lenient (malformed input → a safe envelope, never throws) and prototype-pollution-safe (whitelisted fields only). Across services, translate through an ACL rather than trusting reconstructed fields.
- Added `ValidationError`: an aggregate that collects N field-level issues into one `StructuredError`. Issues match the Standard Schema `Issue` shape (so Zod/Valibot/ArkType/TanStack Form output pipes in), are kept in full for logs, and cross to a client only via the explicit `publicIssues()` whitelist (`message`/`path`/`code?`/`pointer?`, never raw validator extras). `mapIssue` emits any wire shape (e.g. RFC-7807 `{ name, reason }`). Exposes `ValidationIssue`/`PublicIssue` types.
- Added `toStructuredError(value, options?)`: coerces any caught value into a `StructuredError` (a consistent boundary envelope; a `StructuredError` passes through, other `Error`s are preserved as `cause`). Honest defaults (`UNKNOWN_ERROR`/`INTERNAL`/non-retryable) and an optional second parameter so it fits the `errorMapper` slot of a `Result` type.
- Added `defineErrors(catalog)`: a declarative error catalog that generates a typed factory per `code` (with `category`, `retryable` and the public mapping baked in) plus a `meta(code)` accessor for boundary metadata such as `httpStatus`. Exposes the `ErrorSpec`, `Catalog` and `CatalogError` types; `CatalogError<typeof catalog>` is the closed union to pass to `matchError`.
- The public serializers (`toPublicJSON`, `toProblemDetails`, `toErrorResponse`) accept `locale` / `fallbackLocale`. When a matching author-provided localized message exists it becomes the public message, surfaced without `expose`, since these strings are client-safe by design. An explicit `message`/`detail` still wins, and missing locales fall back to `publicMessage` without leaking the default user message.
- Added package metadata for `sideEffects`, `engines`, `packageManager`, and homepage.

### Fixed

- `StructuredError` now captures stack headers with the configured error code instead of rewriting `name` after stack capture.
- Cause-chain traversal (`getRootCause`, `findInCauseChain`, `filterCauseChain`, `someCauseChain`, `everyCauseChain`, and the retryability helpers) no longer steps onto a spurious `undefined` when an error carries an explicit `cause: undefined` (e.g. `new Error(msg, { cause: undefined })`).
- `toProblemDetails()` return type no longer falsely includes the raw `details` shape; it reflects only the mapped/explicit extensions actually present at runtime, so the type can no longer invite reading internal fields that are absent.
- `mapDetails` is invoked only when the error carries `details`, so a naive mapper can no longer throw while serializing an error inside an error handler.
- Build no longer runs `lint:fix`; it verifies lint deterministically.
- CI now runs `pnpm test:run` explicitly.

### Migration

See [`MIGRATION.md`](./MIGRATION.md) for v4-to-v5 migration examples.
