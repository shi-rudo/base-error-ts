# Security

This library exists to prevent one leak: internal error state in a client
response ([CWE-209](https://cwe.mitre.org/data/definitions/209.html)). This
document is the authoritative map of its trust boundary, its posture against
hostile inputs, and the risks that the project accepts. Judge every
security-adjacent change against it, and update it in the same change.

## Trust boundary

The package has two sides, split by import path.

| Side     | Import                             | Trust level                                                                                                                                       |
| -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core     | `@shirudo/base-error`              | Internal. `toLogObject()` and `toJSON()` carry the full technical truth: message, stack, cause chain, details. This output is for your logs only. |
| Boundary | `@shirudo/base-error/public-error` | The only client path. Output comes only from descriptors that you registered.                                                                     |

The boundary holds because the core has no client serializer, and because the
pipeline is allowlist-based: `project` is total over `unknown` and message-free,
an unregistered error degrades to the fallback, and `toProblem` deep-clones the
result into a frozen, JSON-safe body.

## Posture against hostile inputs

An error is foreign input: whatever a caller threw, including values built to
break the handler. The library holds four invariants against that. The project
rules file carries them for contributors; the tests pin them.

- **Catch paths are total.** Logging, redaction, traversal, and string
  rendering never throw. Foreign properties are read through a guarded reader
  (`src/errors/guarded-read.ts`): a throwing getter or Proxy trap reads as
  absent, and a node that defeats serialization becomes a marker.
- **Every walker is bounded.** Depth caps, node budgets, width caps, and
  `seen` sets bound each walk, because depth does not bound width and a shared
  reference expands per reference.
- **Shape over `instanceof`.** Cross-realm values (workers, `vm` contexts, two
  copies of the package) are recognized by shape and slot probes, not by
  realm-bound checks.
- **Redaction is fail-closed.** Under an allowlist, an unknown key is data and
  gets masked. The serializer's own markers stay readable only on the cause
  spine, where the serializer writes them.

## Accepted risks

These are deliberate trade-offs, documented here so nobody rediscovers them as
surprises.

1. **`toJSON` leaks on misuse.** `JSON.stringify(err)`, `res.json(err)`, and
   `Response.json(err)` reach `toJSON` and emit the full log shape. This is
   deliberate: the `fromJSON` wire round-trip needs the serialization. The
   guides warn loudly: never serialize an error straight into a response; the
   public-error pipeline is the client path.
2. **`fromJSON` output is not an authority on trust.** Whoever produced the
   payload can forge every field. Reconstruct within one trust boundary, and
   translate foreign payloads at an anti-corruption layer.
3. **A tagged, error-shaped forgery keeps only the envelope.** A plain object
   with a string `Symbol.toStringTag`, a string `name`, and a string `message`
   takes the native-error path in the cause serializer. Its envelope fields
   survive in the log, and its other fields drop.
4. **Redaction rewrites the log object only.** `err.stack` and `toString()`
   carry the raw technical message, except a deny-listed `"message"`, which
   `toString()` masks. When redaction matters, log only through the structured
   path.
5. **The cause serializer has no total-node cap.** Its depth and width caps
   compound, so a legal in-memory tree can serialize large. Reconstruction is
   the guarded side: `fromJSON` caps at 10,000 cause nodes and truncates with
   a count marker.

## Out of scope

The package has zero runtime dependencies, performs no I/O, and holds no
secrets, authentication, or authorization of its own. Supply-chain surface is
the published package itself; releases publish over OIDC trusted publishing,
with no long-lived token.

## Report a vulnerability

Use GitHub private vulnerability reporting:
<https://github.com/shi-rudo/base-error-ts/security/advisories/new>. Do not
open a public issue for a suspected vulnerability.
