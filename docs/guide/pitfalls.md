# Pitfalls

A short list of the surprising-the-first-time behaviors. None are bugs — they
follow from the [safe-by-default](./safe-by-default) design — but they are worth
knowing.

## 1. `JSON.stringify(error)` and `res.json(error)` expose everything

This is the most important one. `toJSON()` is an alias of `toLogObject()`, so the
default JSON serialization is the **full, unredacted** payload — technical
message, stack, cause chain and raw `details`.

```ts
JSON.stringify(error);        // ← full technical dump
res.json(error);              // ← leaks it to the client
Response.json(error);         // ← same
return error;                 // ← framework auto-serializes via toJSON → leak
```

Anything that auto-serializes an object reaches `toJSON()` and bypasses the safe
path. **Always call a client serializer explicitly:**

```ts
res.json(error.toProblemDetails({ status: 500 }));   // ✓ safe
res.json(error.toErrorResponse({ httpStatusCode: 500 })); // ✓ safe
```

Rule of thumb: `toLogObject()` / `toJSON()` go to your logger; never to a
response.

## 2. `StructuredError.name` is the `code`, not `"StructuredError"`

A `StructuredError` sets its `name` (and stack header) to its `code`:

```ts
const e = new StructuredError({ code: "USER_NOT_FOUND", /* … */ });
e.name; // "USER_NOT_FOUND", not "StructuredError"
```

So `err.name === "StructuredError"` is always false. Use `instanceof`,
`isStructuredError(err)`, or switch on `err.code`.

## 3. Extension keys that collide with reserved members are silently dropped

[Safe-by-default is invariant](./safe-by-default): standard members (`type`,
`title`, `status`, `detail`, `instance`) and library members (`code`,
`category`, `retryable`, `traceId`) always win. An `extensions` key — or a
`mapDetails` output — using one of those names is **silently discarded**, with
no error:

```ts
error.toProblemDetails({
  status: 400,
  extensions: { status: 422, code: "X" }, // both ignored — reserved
});
```

This is the price of the guarantee. Name your extension members anything other
than the reserved keys above.

## 4. `expose: true` at construction is sticky

Setting `expose` on the constructor flips **every** client serialization of that
instance to include technical fields — it is not a per-response decision:

```ts
new StructuredError({ /* … */ expose: true });
// every toProblemDetails()/toPublicJSON() on this instance now exposes internals
```

Prefer per-call control (`toProblemDetails({ expose: true })`) or, better,
explicit `publicCode` / `publicMessage` / `publicCategory`. Reserve constructor
`expose` for errors that are public by their very nature.

## 5. Class-name minification and the `_tag` discriminant

`_tag` (and an inferred `name`) fall back to `this.constructor.name`, which most
production minifiers mangle by default (esbuild `keepNames: false`, terser/swc
`keep_classnames: false`). This only affects the **inference fallback**:

- `StructuredError` fixes `_tag` to a stable literal and uses `code` as its real
  discriminant — **safe out of the box.**
- `instanceof` / `isStructuredError` are unaffected (prototype-based).
- Only **plain `BaseError` subclasses relying on name inference** are at risk.
  Pass an explicit `name` (which now stabilizes both `name` and `_tag`), or
  override `_tag` with a literal:

```ts
class PaymentDeclinedError extends BaseError<"PaymentDeclinedError"> {
  readonly _tag = "PaymentDeclinedError" as const; // stable + strictly typed
}
```
