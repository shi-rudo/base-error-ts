# Validation errors

`ValidationError` collects multiple field-level failures into one
[`StructuredError`](./structured-error), and surfaces them — **on explicit
opt-in** — as a safe RFC 9457 `errors[]` extension.

```ts
import { ValidationError } from "@shirudo/base-error";

const v = new ValidationError("Registration is invalid");
if (!isEmail(email)) v.addIssue({ message: "Enter a valid email.", path: ["email"] });
if (age < 18) v.addIssue({ message: "Must be 18 or older.", path: ["age"] });
if (v.hasIssues()) throw v;
```

It is a normal structured error (`code` `"VALIDATION_FAILED"`, `category`
`"VALIDATION"`, stable `_tag`), so `instanceof StructuredError`, `code` and
[`matchError`](./matching) all work.

## Ingesting validator output (Standard Schema)

`ValidationIssue` matches the [Standard Schema](https://standardschema.dev)
`Issue` shape (`message` + `path`), so output from **Zod, Valibot, ArkType or
TanStack Form** pipes in with no remapping:

```ts
const result = schema["~standard"].validate(input);
if (result.issues) {
  throw new ValidationError("Invalid input", { issues: result.issues });
}
```

## Exposing issues safely

Issues are **not** exposed by default — there is no exception to
[safe-by-default](./safe-by-default). The stored issues (with any validator
extras) are kept for logs; surfacing them to a client is an explicit opt-in, and
only a fixed whitelist can ever cross.

`publicIssues()` yields that whitelist — `{ message, path, code?, pointer? }`,
**never** raw validator extras (a Zod-native issue may carry the rejected input
value; it can never reach the wire). A `pointer` string (e.g. `"address.zip"`)
is derived from the path for HTTP clients.

```ts
v.toProblemDetails({ status: 422, extensions: { errors: v.publicIssues() } });
// {
//   status: 422,
//   detail: "Registration is invalid",
//   code: "INTERNAL_ERROR",        // standard members still win
//   retryable: false,
//   errors: [
//     { message: "Enter a valid email.", path: ["email"], pointer: "email" },
//   ],
// }
```

### Custom wire shape (e.g. RFC 7807)

RFC 9457 mandates no validation format (`invalid-params` was only a non-normative
RFC 7807 example). Use `mapIssue` to emit any shape:

```ts
v.toProblemDetails({
  status: 422,
  extensions: {
    "invalid-params": v.publicIssues({
      mapIssue: (i) => ({ name: (i.path ?? []).join("."), reason: i.message }),
    }),
  },
});
```

## Logs keep the full truth

`toLogObject()` carries the complete issues — including any validator extras —
so observability loses nothing while the client sees only the whitelist:

```ts
logger.error(v.toLogObject()); // details.issues includes everything
```

## With a `Result` type

A `Result` short-circuits on the first error, so accumulate imperatively, then
return one `ValidationError`:

```ts
function parse(input: unknown): Result<Registration, ValidationError> {
  const v = new ValidationError("Registration is invalid");
  // ...collect issues...
  return v.hasIssues() ? Result.err(v) : Result.ok(registration);
}
```
