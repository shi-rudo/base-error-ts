# A prefix that separates the catalog key from the error code

Status: implemented; release: 10.0.0.
Tracking: `base-error-ts-zk7`.

## Decision

`defineErrors` takes an optional second argument with a `prefix`. The prefix separates two names that were one name until now:

- The **key** names a definition in the source code. It names the factory, `create.<key>`.
- The **code** identifies an error at runtime. It is `StructuredError.code`, the contract that logs, dashboards and the public-error catalog read.

With a prefix, the catalog derives the code of each definition as `${prefix}.${key}`. Without a prefix, the key is the code, as before.

```ts
export const AuthzErrors = defineErrors(
  {
    not_a_member: { category: "FORBIDDEN", retryable: false },
    missing_role: {
      category: "FORBIDDEN",
      retryable: false,
      details: detailsType<{ role: string }>(),
    },
  },
  { prefix: "restaurant.authz" },
);

const error = AuthzErrors.create.not_a_member("actor 42 is not a member of org 7");
error.code; // "restaurant.authz.not_a_member", also as a literal type

AuthzErrors.code.not_a_member; // "restaurant.authz.not_a_member"
AuthzErrors.codes; // ["restaurant.authz.not_a_member", "restaurant.authz.missing_role"]

AuthzErrors.match(error, {
  not_a_member: () => "join the organization first",
  missing_role: (e) => `ask an owner for the role ${e.details?.role}`,
});
```

| Member | Takes | Returns |
| --- | --- | --- |
| `create.<key>(message, options?)` | the key | an error that carries the code |
| `code.<key>` | the key | the code |
| `codes` | | the codes, in key order |
| `match(error, { <key>: handler, _? })` | the key | the result of the handler |
| `is(value)`, `is(value, key)` | the key | a type guard |
| `meta(code)` | the code | the static facts of the definition |
| `CatalogErrorOf<C, key>` | the key | the error type, with the literal code |
| `CatalogError<C>` | | the union of the error types, with the literal codes |

## Problem

A codebase with several bounded contexts uses codes in the form `<context>.<area>.<reason>`, for example `restaurant.authz.not_a_member`. Such a code is no identifier. `defineErrors` used the code as the key, so each call needed brackets, and each team wrote a second object for the codes:

```ts
export const AuthzCodes = { NotAMember: "restaurant.authz.not_a_member" } as const;
export const AuthzErrors = defineErrors({
  [AuthzCodes.NotAMember]: { category: "FORBIDDEN", retryable: false },
});

AuthzErrors.create[AuthzCodes.NotAMember]("actor is not a member of the org");
matchError(e, { [AuthzCodes.NotAMember]: (x) => …, _: (x) => … });
```

This has three defects:

- Two objects state one error. They are two sources for one fact.
- Each access needs brackets.
- The name of the area occurs twice in one expression.

A flat code such as `CARD_DECLINED` is an identifier. It has none of these defects, and it keeps working without a prefix.

## The key and the code

The rule is: **the key names a definition in the source code, and the code is what an error carries.**

- `create`, `code`, `match`, `is` and `CatalogErrorOf` name a definition. They take the key. `is(value, "not_a_member")` reads as `create.not_a_member` does.
- `meta` takes the code. Its caller holds an error and reads `error.code`, for example at a transport boundary: `AuthzErrors.meta(error.code).metadata.httpStatus`. A key cannot come from an error without a second lookup.
- `codes` and `CatalogError` describe errors, so they hold codes. `registerByCode(AuthzErrors.code.not_a_member, …)` and `assertCoverage(AuthzErrors.codes)` connect the catalog to the public-error catalog without a copy of a code.

Without a prefix, the key and the code are the same string, so each member behaves as before. The types of `create`, `is`, `meta`, `codes`, `CatalogError` and `CatalogErrorOf` do not change for a catalog without a prefix.

## The prefix

- The separator is a fixed `.`. The dot is the separator of the convention that needs this feature. A free concatenation turns a forgotten separator into a different code (`restaurant.authznot_a_member`), and the code is a contract. A code in another format, such as `AUTHZ_NOT_A_MEMBER`, is an identifier already and needs no prefix.
- The prefix must be a non-empty string without a leading, a trailing or a doubled `.`. `defineErrors` throws at creation for any other value, and for an unknown option.
- The prefix must be a string literal type. A prefix of type `string` turns every code into `${string}.key`, so `CatalogError` loses its literal codes. The compiler rejects it, as it rejects a widened definition.
- With a prefix, a key must not contain a `.`. The prefix holds every segment before the key, so the key is always the last segment of the code. A key such as `.x` would otherwise give the code `restaurant..x`, and the catalog `a` with the key `b.c` would give the same code as the catalog `a.b` with the key `c`. Without a prefix, a key keeps its rules: any non-empty string.
- The prefix belongs to the catalog, not to a definition. Definitions of one area compose with object spread before `defineErrors`, as before. Definitions of two areas belong in two catalogs.

## `match`

`match` is `matchError` with handlers named by key. It has the same rules:

- It reads `error.code`, finds the key, and calls the handler of that key, or `_`.
- It reads only own properties of the handler object. A key such as `toString` never reaches `Object.prototype`.
- The compiler requires a handler for each key, unless `_` is present. The type of `error` can be a part of the catalog union, for example after a guard. Then only the keys of that part need a handler.
- Each handler receives the error type of its key, so `details` has the type of that definition.
- The compiler rejects a key that the catalog does not define. A misspelled key next to `_` would otherwise send its errors to `_` without notice.
- If no handler matches and no `_` is present, `match` throws an error that names the code and the key. Only a call that bypasses the types reaches this path.
- A catalog with the key `_` cannot use `match`. The handler of that key and the catch-all would be one property, and the compiler would stop checking the other keys. The compiler rejects the call, and `match` throws at runtime. `defineErrors` still accepts the key, so an existing catalog keeps working.

`match` checks no provenance, as `matchError` checks none. `is` remains the trust boundary of a catalog.

`matchError` remains the matcher for a union of several catalogs. A quoted code is a valid key of an object literal, so it needs no brackets: `matchError(e, { "restaurant.authz.not_a_member": …, "restaurant.storage.not_found": … })`. A split of the union with `is` is wrong: `is` checks provenance, so an error rebuilt with `fromJSON` fails it and reaches the `match` of the other catalog, which throws.

## Searching a code

The source contains the prefix and the key, but not the full code. A search for `restaurant.authz.not_a_member` from a log finds no definition. A search for the prefix finds the catalog, and the key is the last segment of the code.

A key rename changes the code. This is true for a catalog without a prefix too, but a rename tool makes it look like a refactor. The code is a contract, so the guide recommends a test that pins the codes of a catalog:

```ts
expect(AuthzErrors.codes).toEqual([
  "restaurant.authz.not_a_member",
  "restaurant.authz.missing_role",
]);
```

The test puts each full code into the repository, so a search finds it. A key rename then fails the test.

## Alternatives

- **A `code` field in each definition.** A search finds the full code, and a key rename keeps the code. But each concept gets two hand-written names, and the key and the last segment of the code can drift apart. The prefix repeats in each definition and can drift too, and the catalog needs a check against duplicate codes. Rejected: the prefix derives the code from one source.
- **A prefix with an optional `code` override per definition.** This gives two ways to state a code, and an override has the drift of the first alternative. Rejected.
- **A free separator, or a prefix that includes its separator.** Rejected, see *The prefix*.
- **`matchError` with keys.** `matchError` knows no catalog and cannot map a key to a code. A catalog as a third argument makes it a catalog method in another place. Rejected.
- **`meta` by key.** The boundary call `meta(error.code)` then fails for a catalog with a prefix. Rejected.
- **A default message per definition**, so that `create.not_a_member()` takes no message. A message states the operation and the input, for example the actor and the organization. A fixed text per definition cannot state them and invites a message without context. The feature is also independent of the prefix. Rejected.

## Consequences

- `Catalog` takes a second type parameter, the prefix. Its default keeps `Catalog<T>` as before.
- Every catalog gets `code` and `match`, also without a prefix. Without a prefix, `AppErrors.match` and `matchError` dispatch the same way.
- The second argument of `defineErrors` can carry later options. A catalog that bypasses the types and passes a value other than an options object now throws at creation.
