# Public issues without the validator message

Status: implemented; release: 9.0.0.
Tracking: `base-error-ts-dt6`.

## Decision

`publicIssues()` leaves the `message` of an issue out by default.
The message crosses only when the caller passes `messages: true`.
Each path segment carries only a property key. Any other key crosses as `null`.
`mapIssue` returns any wire shape, and the return type follows the mapper.

## Problem

The default whitelist was `{ message, path, code?, pointer? }`.
The whitelist copied `message` unchanged.
The default messages of Valibot and ArkType embed the rejected value.
Zod 3 does the same for `enum`.
A consumer who read only the API put a rejected password on the wire with one call.
The docs warned about it, but the safe default was the unsafe call.
That contradicts `docs/guide/safe-by-default.md`: exposing data is always explicit.

The path had a second, smaller gap.
The projection narrowed a segment object to `{ key }` and copied `key` as it was.
Valibot puts the parent input and the rejected value into a path item.
The narrowing dropped both.
But a `Map` path item of Valibot carries the `Map` key, and that key can be any object.
The projection put that object on the wire by reference.

`mapIssue` had a typing defect.
Its type was `(issue) => PublicIssue`, so a custom shape such as `{ name, reason }` did not typecheck.
The guide showed exactly that shape.

## Alternatives

| Option | Consequence | Decision |
| --- | --- | --- |
| Keep `message` and improve the docs | The unsafe call stays the default. | Rejected. Version 8 already documents the risk. |
| Remove `message` from the public shape | Consumers with their own messages must write a mapper. | Rejected. Own messages are a common, safe case. |
| Return a second type for `messages: true` | The type proves that `message` is present. A hostile issue without a string message breaks that proof. | Rejected. `message` stays optional, like `code`. |
| Remove `mapIssue`, because `error.issues.map(fn)` does the same | One fewer option. | Rejected. It breaks working consumer code for no safety gain. |
| Leave `message` out by default and add `messages: true` | The safe call is the default. Own messages need one option. | Selected. |

## Contract

`publicIssues()` returns `{ path?, pointer?, code? }` per issue.

- `path` is a fresh array. A segment object becomes `{ key }`, and nothing else of the object crosses.
- A key that is not a string, a number or a symbol becomes `null`. That covers a `Map` key object, the `null` key of a Valibot `Set` item, a `bigint` and a throwing `key` getter.
- `pointer` joins the projected keys with dots.
- `code` is present only when the issue carries a string `code`.

`publicIssues({ messages: true })` adds `message` when the issue carries a string message.
A message that is not a string, or a throwing getter, leaves `message` out.

`publicIssues({ mapIssue })` returns what the mapper returns.
The mapper receives the raw issue, so it owns its whitelist.
`messages` together with `mapIssue` is a type error, because the mapper replaces the projection.

## Compatibility

This is a breaking change of 9.0.0.

- A caller who reads `message` from `publicIssues()` gets `undefined`. The type `PublicIssue["message"]` is now `string | undefined`, so TypeScript reports each such read.
- `PublicIssue["path"]` admits `null` and `{ key: null }`.
- `PublicIssuesOptions` holds `messages` only. `mapIssue` moved to its own overload.

`MIGRATION.md` shows the recipes.
