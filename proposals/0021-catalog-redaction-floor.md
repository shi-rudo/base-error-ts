# The catalog redaction policy is a floor

Status: implemented; release: 10.0.0.
Tracking: `base-error-ts-x1q`.

## Decision

A `redaction` policy in a `defineErrors` definition is a floor for every error that the catalog creates. A per-instance `redact`, `redactAllow` or `redactWith` adds to the floor. It never replaces it.

- The log applies the per-instance policy first, then the catalog policy.
- Per-instance calls keep last-wins among themselves: a second `redact` replaces the first `redact`, not the floor.
- An error without a catalog policy behaves as before.

| Catalog policy | Per-instance call | Result |
| --- | --- | --- |
| deny `password` | `redact(["email"])` | `password` and `email` masked |
| allow `userId` | `redact(["email"])` | every data leaf except `userId` masked |
| deny `password` | `redactAllow(["userId", "password"])` | every data leaf except `userId` masked |
| allow `userId` | `redactAllow(["userId", "email"])` | every data leaf except `userId` masked |
| any | `redactWith(fn)` | the output of `fn`, copied as log data, then the catalog policy |

The rule in one sentence: the catalog sets the floor, and a single error can only add.

## Problem

An error had one slot for its policy. The catalog filled that slot in its factory through the public `redact` or `redactAllow`, and every later call overwrote it. The most natural calls removed the protection that the catalog declared:

```ts
const AuthErrors = defineErrors({
  LOGIN_FAILED: {
    category: "AUTH",
    retryable: false,
    details: detailsType<{ userId: string; password: string; email: string }>(),
    redaction: { mode: "deny", keys: ["password"] },
  },
});

AuthErrors.create.LOGIN_FAILED("login failed", { details }).redact(["email"]);
// before: password in plain text in the log
```

With an allow-list in the catalog, the same call put every field except `email` into the log, also a field that a later change added to `details`. The catalog guide called the per-instance methods the way to a stricter policy.

The catalog is where an owner declares what never reaches a log store. Redaction is fail-closed: a call that looks like an addition must not remove protection without notice.

## Where the floor applies

The floor follows the policy of the error everywhere the log reads it:

- `toLogObject()`, `toJSON()` and `logObjectOf()`;
- the node of the error at a cause position, and in a list of aggregate members;
- the envelope of the error when it appears as data inside `details`;
- `toString()`: a catalog deny-list that holds `"message"` masks the message there, also after a per-instance `redactAllow` or `redactWith`.

The setups of `@shirudo/base-error/pino` and `@shirudo/base-error/sentry` write through `logObjectOf()`, so the floor holds at both sinks.

## The output of `redactWith` on a catalog error

Proposal 0013 lets the output of `redactWith` pass "without validation, copying, freezing, or another implicit redaction policy". On an error with a catalog policy, that rule has one exception: the log copies the output with the log-data copier, and the catalog policy walks the copy. The copy keeps the walk bounded, because a redaction walk reads plain data only. A `Date` in the output becomes its ISO string, as in `details`.

Without a catalog policy, proposal 0013 holds unchanged.

## Implementation

`BaseError` gets a second private slot for the floor. `defineErrors` fills it once, when the factory builds the error, through a function that a static block of the class sets. The function is internal: no entry point exports it, and no public method reads or clears the floor. A key that both policies mask passes the instance mask to the catalog mask; a string mask gives the same marker.

## Alternatives

- **Masking only grows, for every call.** `redact(a).redact(b)` would mask `a` and `b`. This is the pure form of the rule, but `redactWith` would lose its role as a full transform for every error, and the documented `redactAllow([]).redactWith(fn)` would no longer replace. Rejected for its blast radius.
- **A second policy throws unless the call passes `{ replace: true }`.** It fails loud, but `redact` often runs in a `catch` block, where a throw replaces the original error. It also needs a new option. Rejected.
- **Keep last-wins and document it.** No break, but the default stays fail-open, and the most natural call stays dangerous. Rejected.

Prior art for a floor that a local scope can only tighten: fail-safe defaults (Saltzer and Schroeder, 1975), several Content Security Policies on one page, which all apply, and the `redact` option of pino, which a single log call cannot switch off.

## Consequences

- Breaking: a consumer who relaxed a catalog policy on one error now gets more masked fields. To relax a field, change the definition, or build the error outside the catalog.
- `redactWith` on a catalog error with a policy returns a copied record, not its own object.
- The catalog guide, the observability guide, `MIGRATION.md` and the agent skill state the floor.
