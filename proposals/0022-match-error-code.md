# `matchError` is now `matchErrorCode`

Status: implemented; release: 10.0.0.
Tracking: `base-error-ts-eooe`. Supersedes the naming decision of proposal 0001.

## Decision

The function that dispatches on the `code` of a structured error is `matchErrorCode`. 10.0.0 renames it without an alias.

- `matchErrorCode(error, { USER_NOT_FOUND: …, _: … })` keeps the signature, the compile-time checks and the runtime of `matchError`.
- The runtime message of an unhandled code starts with `matchErrorCode:`.
- The rule messages of the types and of `Catalog.match` name `matchErrorCode`.

## Problem

Proposal 0001 chose `matchError` over `match` and `fold`, because those names collide with the result libraries. The name `matchError` collides too. `@shirudo/result` has `result.matchError()`: a method that matches the error side of a result by class, guard or tag, through a builder chain (`when`, `whenGuard`, `whenTag`, `otherwise`). In a code base that uses both packages, `matchError(error, handlers)` and `result.matchError()` are two operations with one name. The reader of that code base sees one vocabulary, so the collision is real there, although each package is consistent alone.

The exact counterpart of this function in `@shirudo/result` is `matchTag(result, "code", handlers)`: a checked handler table over one key.

## Why this name

- It says what the function branches on: the `code`.
- It pairs with the guard `hasErrorCode`.
- It separates the function from `Catalog.match`. Since 10.0.0, a catalog with a prefix names its errors by key (`not_a_member`), and its `match` takes handlers by key. `matchErrorCode` takes handlers by the full code (`restaurant.authz.not_a_member`).
- `matchCode` is shorter, but `code` alone is ambiguous next to `publicCode`. `matchByCode` breaks the pattern of `hasErrorCode`.

## Why no alias

10.0.0 is a major release and is not published yet. A rename in a minor release would need a deprecated alias for one major. A clean break now costs one search-and-replace for a consumer and leaves no second name in the API.

## Consequences

- `MIGRATION.md` (v9 to v10) and the changelog list the rename as a breaking change.
- The guide, the README, the skill, the examples and the tests use `matchErrorCode`.
- The changelog sections and the migration steps of earlier releases keep `matchError`, because they describe those releases.
