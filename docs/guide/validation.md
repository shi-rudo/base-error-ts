# Validation errors

`ValidationError` collects multiple field-level failures into one
[`StructuredError`](./structured-error), and exposes a safe, whitelisted view of
them on explicit opt-in via `publicIssues()`.

```ts
import { ValidationError } from "@shirudo/base-error";

const v = new ValidationError("Registration is invalid");
if (!isEmail(email))
  v.addIssue({ message: "Enter a valid email.", path: ["email"] });
if (age < 18) v.addIssue({ message: "Must be 18 or older.", path: ["age"] });
if (v.hasIssues()) throw v;
```

It is a normal structured error (`code` `"VALIDATION_FAILED"`, `category`
`"VALIDATION"`, stable `_tag`), so `instanceof StructuredError`, `code` and
[`matchError`](./matching) all work.

## Runtime validation of catalog details

`detailsType<T>()` describes a catalog factory's `details` at compile time. It
does not create a runtime schema and cannot validate JavaScript callers,
deserialized payloads or values hidden behind unsafe casts.

Validate external data first, then pass the validated value to the factory:

```ts
const result = await detailsSchema["~standard"].validate(input);
if (result.issues) {
  throw new ValidationError("Invalid failure details", {
    issues: result.issues,
  });
}

throw AppErrors.create.REQUEST_REJECTED("request rejected", {
  details: result.value,
});
```

This separation keeps catalog definitions independent of a schema library while
making validation explicit at the boundary where untrusted data enters.

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

Issues are **not** exposed by default. There is no exception to
[safe-by-default](./safe-by-default). The stored issues (with any validator
extras) are kept for logs; surfacing them to a client is an explicit opt-in, and
only a fixed whitelist can ever cross.

`publicIssues()` yields that whitelist: `{ path?, pointer?, code? }`. It
**never** carries raw validator extras (a Zod-native issue may carry the
rejected input value in a `received` field; that field never reaches the wire),
and it leaves out the `message` of an issue. A `pointer` string (e.g.
`"address.zip"`) is derived from the path for HTTP clients. It joins the
segments with dots and is not an RFC 6901 JSON Pointer (`"/address/zip"`).

```ts
v.publicIssues();
// [{ path: ["email"], pointer: "email" }]
```

### Messages cross only on opt-in

The default messages of Valibot and ArkType embed the rejected value
(`Invalid email: Received "…"` and `must be an email address (was "…")`), and
so does Zod 3 for `enum`; Zod 4 does not. The `message` of an issue therefore
crosses only when you pass `messages: true`. Pass it only for messages that you
wrote:

```ts
v.publicIssues({ messages: true });
// [{ message: "Enter a valid email.", path: ["email"], pointer: "email" }]
```

When the messages are not yours, let the client render the text from the code,
as `examples/voucher-service/public-errors.ts` does:

```ts
projectFields: (error: ValidationError) =>
  error.publicIssues().map((issue) => ({
    field: issue.pointer ?? "",
    code: issue.code ?? "invalid",
  })),
```

With messages you wrote, the whole whitelist is the payload to surface at the
boundary. Project it onto a public view via the
[public-error pipeline](./public-error), where `projectDetails` is the explicit
allowlist that lets vetted error data through:

```ts
import type { PublicIssue } from "@shirudo/base-error";
import { LocalizedMessageSet } from "@shirudo/base-error/public-error";
import type { PublicErrorDescriptor } from "@shirudo/base-error/public-error";

const validationDescriptor: PublicErrorDescriptor<
  ValidationError,
  { issues: PublicIssue[] }
> = {
  publicCode: "VALIDATION_FAILED",
  status: 422,
  userMessages: new LocalizedMessageSet({
    baseLocale: "en",
    messages: { en: "Please correct the highlighted fields." },
  }),
  projectDetails: (error) => ({ issues: error.publicIssues({ messages: true }) }),
};
```

### Path keys

Each path segment carries only its key. A validator can attach more to a
segment: Valibot puts the parent input and the rejected value there. That data
never crosses. A key that is no property key, such as an object key of a `Map`,
crosses as `null`.

### Custom wire shape

Use `mapIssue` to emit any per-issue shape your client expects. The mapper
replaces the whitelist and receives the raw issue with all validator extras, so
it decides on its own what crosses:

```ts
v.publicIssues({
  mapIssue: (i) => ({ name: (i.path ?? []).join("."), reason: i.message }),
});
```

## Logs keep the full truth

`toLogObject()` carries the complete issues (including any validator extras),
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
