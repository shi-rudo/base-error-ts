# A threat model for the error model

Status: accepted; release: 9.0.0.
Tracking: `base-error-ts-af5.2`.

## Decision

The library separates two kinds of input and holds each to its own rule.

| Input | Examples | Rule |
| --- | --- | --- |
| Untrusted values | A thrown value and everything that it reaches. Data in an error, such as `details`. A `fromJSON` payload. | Safe for any value: no throw, bounded work, no leak, no header injection. Correct content for an honest value. |
| Consumer code | `buildOwnLogFields`, a `redactWith` callback, a mask, a projector, a matcher, a catalog descriptor, a view or a context passed to `toProblem`. | The library calls it inside one `try`/`catch` where a throw would replace the original error. It adds no other defense. |

An honest value is a value that nobody built against the internals of this library.
Examples of a crafted value: a forged `Symbol.toStringTag`, a string that equals a serializer marker, a getter that returns another value on the second read.
A crafted value gets a safe result. It does not always get the correct result.

The library reads an untrusted value once, at the entry, through the guarded reader (`guarded-read.ts`) or the bounded copier (`serializeLogData`).
After the entry, the library works on its own plain data and needs no further defense against hostile input.

## Problem

The defenses grew one finding at a time, and no rule said where they stop.

- The unreleased section of the changelog has 52 entries. About 30 of them are about hostile getters, Proxies, budgets or markers.
- At least 7 of these entries repair the defenses themselves, for example "Budget exhaustion preserves scalar cause decisions".
- Two bugs of this release cycle came from the interplay of budget, marker, region and policy: `base-error-ts-4vw` drops fields silently, and in `base-error-ts-clk` the member order decides whether a secret reaches the log.
- The redaction walker defends against Proxies and throwing reflection. Since proposal 0015, the log build copies every value that it reads. Raw data reaches the walker only through the output of a custom `redactWith` of a cause and through the results of a mask. Both are consumer code.

A silent loss of data in a log costs more than the crafted inputs that these defenses target.

## Defenses and decisions

| Defense | Input that it serves | Decision |
| --- | --- | --- |
| Guarded reads, the bounded copier, the caps and `seen` sets of the cause walks | Untrusted values | Keep |
| Whitelist and budgets of `fromJSON` | Untrusted values | Keep |
| Line budget of `toString` | Untrusted values: a getter can grow the tree while the render reads it | Keep: one counter |
| Shape checks instead of `instanceof` | Honest values from another realm | Keep |
| One read per checked value in `toProblem` and `project` | Consumer code, but the check prevents header injection | Keep: read, check and write is ordinary code |
| Recovery record of a throwing redactor | Consumer code | Keep: one `try`/`catch` at the boundary |
| Recursion guard of the own-fields hook | Consumer code, totality | Keep: one flag |
| Hostile-input defenses of the redaction walker: reflection guards, the read allowance `MAX_REDACTION_READS`, the read-cut queue, its own depth and cycle markers, the provenance of depth cuts | Consumer code only, since proposal 0015 | Remove. Copy the custom redactor output of a cause and each mask result with the bounded copier, and walk plain data |
| Provenance of serializer markers (a private `WeakMap`) | Crafted strings | Remove. Recognize a marker by its value |
| `inspectOwnLogFields` | Consumer code: a test helper that reports crafted hook results | Remove. The API is unreleased |
| Handling of a forged `Symbol.toStringTag` in `isNativeError` and in the unboxing of the copier | Crafted values | Remove the forgery branches, keep the `try`/`catch` |

## Contract after the change

- The bounded copier copies the custom redactor output of a cause before the policy of an outer error walks it. The output follows the rules of `serializeLogData`: a `Date` becomes its ISO string, a cycle becomes a `[Circular …]` marker, and output beyond the log budget becomes `[Max log size exceeded]`. The copy shares the budget of the log build.
- The bounded copier copies each mask result. A mask that returns a string, a number, a boolean or `null` sees no change.
- The redaction walker writes no markers of its own. `[Max redaction depth exceeded]`, `[Circular reference]` and `[Max redaction size exceeded]` disappear. `[log redaction failed]` stays.
- On the cause spine, `redactAllow` keeps a string that equals a serializer marker. A crafted string of that kind carries the marker text only, and in `[N more aggregated errors]` a number.
- `inspectOwnLogFields` and `OwnLogFieldsIssue` are gone.

## Cost

- The custom redactor output of a cause costs one more copy and spends the shared budget a second time. A large subtree under such a redactor reaches the size cut earlier.
- If that copy does not fit the remaining budget, the whole `cause` slot becomes `[Max log size exceeded]`. The removed walker cut locally and kept the name, message and code of the cause. The root keeps its diagnosis in both cases.
- A consumer string that equals a serializer marker stays readable on the cause spine under `redactAllow`.
- The tests that fed crafted values to the walker through a custom cause redactor now pin the rules of the copier instead.

## Alternatives

| Option | Consequence | Decision |
| --- | --- | --- |
| Keep the hardened walker and fix `4vw` inside it | The interplay of budget, marker, region and policy grows further. | Rejected. |
| Copy the output of the root's own custom redactor too | Nothing in the library walks that output. It goes to the consumer. | Rejected. |
| Give each copy of a custom redactor output a budget of its own | The total work of one log build is no longer bounded. | Rejected. |
| Keep marker provenance, drop only the walker hardening | Provenance needs mark and copy calls in every branch of the serializer and the walker. It protects a constant string. | Rejected. |

## Migration

`MIGRATION.md` has the section "Next major: redaction walks plain data".
