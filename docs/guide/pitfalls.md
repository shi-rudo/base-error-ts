# Pitfalls

A short list of the surprising-the-first-time behaviors. None are bugs; they
follow from the [safe-by-default](./safe-by-default) design, but they are worth
knowing.

## 1. `JSON.stringify(error)` and `res.json(error)` expose everything

This is the most important one. `toJSON()` is an alias of `toLogObject()`, so the
default JSON serialization is the **full, unredacted** payload: technical
message, stack, cause chain and raw `details`.

```ts
JSON.stringify(error); // ← full technical dump
res.json(error); // ← leaks it to the client
Response.json(error); // ← same
return error; // ← framework auto-serializes via toJSON → leak
```

Anything that auto-serializes an object reaches `toJSON()`. Never send
`toLogObject()` / `toJSON()` output to a client. **Produce the client payload
through the [public-error pipeline](./public-error):**

```ts
const view = presenter.present(error, { locales }); // ✓ safe public view
res.status(status).json(view);
```

Rule of thumb: `toLogObject()` / `toJSON()` go to your logger; the presenter's
`PublicErrorView` goes to the response.

## 2. `StructuredError.name` is the `code`, not `"StructuredError"`

A `StructuredError` sets its `name` (and stack header) to its `code`:

```ts
const e = new StructuredError({ code: "USER_NOT_FOUND" /* … */ });
e.name; // "USER_NOT_FOUND", not "StructuredError"
```

So `err.name === "StructuredError"` is always false. Use `instanceof`,
`isStructuredError(err)`, or switch on `err.code`.

## 3. `present` is total: an unmapped error becomes the generic fallback

`PublicErrorPresenter.present` never throws and never leaks. If an error matches
no registry entry, it degrades to the generic localized fallback, **silently**
from the caller's point of view:

```ts
presenter.present(somethingUnregistered, { locales });
// { code: "INTERNAL_ERROR", message: "Something went wrong...", locale: "en" }
```

That is the safety guarantee, but it can hide a missing registration. Use the
`onPresent` hook to surface `kind: "fallback"` outcomes to your telemetry so an
unmapped error class shows up as a metric rather than a generic 500.

## 4. Class-name minification and the `_tag` discriminant

`_tag` (and an inferred `name`) fall back to `this.constructor.name`, which most
production minifiers mangle by default (esbuild `keepNames: false`, terser/swc
`keep_classnames: false`). This only affects the **inference fallback**:

- `StructuredError` fixes `_tag` to a stable literal and uses `code` as its real
  discriminant (**safe out of the box**).
- `instanceof` / `isStructuredError` are unaffected (prototype-based).
- Only **plain `BaseError` subclasses relying on name inference** are at risk.
  Pass an explicit `name` (which now stabilizes both `name` and `_tag`), or
  override `_tag` with a literal:

```ts
class PaymentDeclinedError extends BaseError<"PaymentDeclinedError"> {
  readonly _tag = "PaymentDeclinedError" as const; // stable + strictly typed
}
```
