# Log serialization measurement

Measured on 2026-09-09 with Node 24.11.1, macOS arm64. Values below are median
microseconds per `toLogObject()` call. The run followed the test and build gates;
no test or build from this task ran during measurement.

| Input | Sticky root policy | Counting JSON copy (`0ec0d0b`) | Position-tracking JSON copy (`dfe8c4e`) | Bounded walker in this change |
| --- | --- | ---: | ---: | ---: |
| Shallow cause with details | none | 2.08 | 3.47 | 5.10 |
| Shallow cause with details | deny secret | 5.26 | 7.56 | 8.98 |
| 100-member aggregate | none | 137.85 | 174.78 | 227.77 |
| 100-member aggregate | deny secret | 325.30 | 407.60 | 458.29 |
| 100-node cause chain | none | 140.37 | 172.72 | 221.67 |
| 100-node cause chain | deny secret | 322.63 | 407.20 | 458.36 |

The new walker is slower on these ordinary inputs: about 28–30% for the two
larger unredacted cases versus `dfe8c4e`, and about 12–13% with the sticky policy.
The shallow case rises from 3.47 to 5.10 microseconds without redaction.
These are whole-log measurements, not an isolated comparison of copy algorithms.

The extra cost buys checks before foreign descriptor and value reads. A native
JSON replacer cannot bound hidden descriptor reads, and independent field
budgets cannot bound a whole cause graph. The bounded walker is retained for
those guarantees. It also removes per-container WeakMap position tracking;
serialization and redaction now call the same position rule.

Timings do not prove bounded work or guarantee any Workers CPU limit. The
regression suite counts getters and descriptor traps instead. Consumer callbacks
and eager `Reflect.ownKeys` enumeration remain outside the enforceable work bound.

## Reproduce

The scenario and timing code is
[`scripts/benchmark-log-serialization.mjs`](https://github.com/shi-rudo/base-error-ts/blob/fix/cause-own-log-fields/scripts/benchmark-log-serialization.mjs).
It uses 100 warm-up calls, then nine samples of 200 calls. Revision order rotates
between samples. The script reports each median, minimum, and maximum as JSON.

Each scenario wraps structured errors in a base error, so their details take the
copy path. Fixtures are reused: construction and first stack formatting are
excluded. Each detail holds identifiers, a secret, a short array, and a nested
record. The sticky variant calls `redact(["secret"])` on the root only.

Bundle `src/index.ts` from each revision using the same esbuild installation,
with `bundle: true`, `format: "esm"`, `platform: "neutral"`, and `target: "es2020"`.
Then run:

```sh
node scripts/benchmark-log-serialization.mjs \
  0ec0d0b=/absolute/path/counting-copy.mjs \
  dfe8c4e=/absolute/path/position-copy.mjs \
  current=/absolute/path/bounded-walker.mjs
```

Repeat on the deployment runtime when assessing throughput. This host's timings
are not workerd timings; the workerd suite separately verifies behavior.
