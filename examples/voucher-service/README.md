# Voucher Service

One small HTTP service that plays the whole feature set together. The single
examples beside this directory show each feature alone; this service shows the
composition: where each piece lives, and how an error travels from a throw to
a client response.

Run it:

```bash
npx tsx examples/voucher-service/main.ts
```

`main.ts` starts the server, sends nine scripted requests, and checks every
response. A failed check fails the process, so this example cannot drift from
the library in silence; CI runs it with the other examples.

## The composition

| File               | What lives there                                                                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `errors.ts`        | The `defineErrors` catalog: codes, categories, retryability, metadata, and a catalog redaction policy. `ValidationError` collects request issues.                            |
| `redemption.ts`    | The domain. It throws catalog errors, uses one `guard` invariant, and translates the gateway failure once, with its cause.                                                   |
| `notifications.ts` | The fan-out. Provider failures collect into a `StructuredAggregateError`.                                                                                                    |
| `logging.ts`       | The log edge: one structured line per handled failure, level by exhaustive `matchError`, masking with `partialMask` on top of the catalog policy.                            |
| `queue.ts`         | The queue boundary: a dead letter crosses as JSON and comes back through `StructuredError.fromJSON`, aggregate members included.                                             |
| `public-errors.ts` | The boundary catalog (`definePublicErrors`): one descriptor per public code, localized user messages, one vetted detail, field faults from `publicIssues`, and a retry hint. |
| `server.ts`        | The HTTP edge: `matchThrown` classifies the thrown value, `toStructuredError` coerces the rest, then `project` → `localize` → `toProblem` builds the response.               |

## What the scenarios show

- A conflict, a not-found, and an expired voucher map to their public codes;
  the technical message never crosses.
- A German `Accept-Language` gets the German user message and a
  `content-language` header.
- The expired response carries exactly one vetted detail (`expiredAt`),
  because the descriptor projects it; nothing else of the error crosses.
- Validation issues become field faults on the 422 body.
- A gateway outage maps to 503 with `Retry-After: 15`; the card number and the
  gateway address stay in the log, masked and internal.
- A failed notification fan-out never fails the redemption: one WARN line, a
  retry decision from the cause chain (`someCauseChain` with
  `{ aggregates: true }`), and a dead letter that survives the queue boundary.

Not shown here: `defineErrorClassSet`, for class-first error hierarchies. This
service is catalog-first; see `error-codes-example.ts` and the matching guide
for the class-set style.
