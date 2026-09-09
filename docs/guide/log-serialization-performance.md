# Log serialization measurement

Measured on 2026-09-09 with Node 24.11.1, macOS arm64. Values below are median
microseconds per `toLogObject()` call. The run followed the test and build gates;
no test or build from this task ran during measurement.

| Input | Sticky root policy | Counting JSON copy (`0ec0d0b`) | Position-tracking JSON copy (`dfe8c4e`) | Initial bounded walker (`fae6274`) |
| --- | --- | ---: | ---: | ---: |
| Shallow cause with details | none | 2.08 | 3.47 | 5.10 |
| Shallow cause with details | deny secret | 5.26 | 7.56 | 8.98 |
| 100-member aggregate | none | 137.85 | 174.78 | 227.77 |
| 100-member aggregate | deny secret | 325.30 | 407.60 | 458.29 |
| 100-node cause chain | none | 140.37 | 172.72 | 221.67 |
| 100-node cause chain | deny secret | 322.63 | 407.20 | 458.36 |

The initial bounded walker is slower on these ordinary inputs: about 28–30% for the two
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

## Explicit builds and private-brand recognition

A second quiet run on the same host compares `fae6274` with the explicit-context
implementation. Both revisions were bundled with the same esbuild invocation.

| Input | Sticky root policy | `fae6274` | Explicit builds |
| --- | --- | ---: | ---: |
| Shallow cause with details | none | 4.93 | 4.58 |
| Shallow cause with details | deny secret | 9.57 | 9.06 |
| 100-member aggregate | none | 226.15 | 199.41 |
| 100-member aggregate | deny secret | 459.32 | 431.07 |
| 100-node cause chain | none | 220.95 | 199.24 |
| 100-node cause chain | deny secret | 457.61 | 432.60 |

The larger unredacted cases take about 10–12% less time than `fae6274` in this run.
The sticky cases take about 5–6% less time. The standalone contract inspector is
not called by the logging path and is not included in these timings.
The tables come from separate runs; compare revisions within each table.

An independent access-count test covers nested error recognition. For 100 data
references behind a 100-link Proxy prototype chain, the old `instanceof` guard
performed 10,100 prototype reads. Private-brand recognition performs zero.
This removes that implicit traversal; it does not bound work inside consumer callbacks.

## Contract corrections at traversal limits

A further quiet run compares `8274c53` with the decision, inspection, terminal,
and legacy-cut corrections. Both bundles use the same explicit `tsconfig.json`
and esbuild settings. The inspector is still outside the logging path.

| Input | Sticky root policy | `8274c53` | Contract corrections |
| --- | --- | ---: | ---: |
| Shallow cause with details | none | 4.74 | 4.61 |
| Shallow cause with details | deny secret | 9.35 | 9.09 |
| 100-member aggregate | none | 219.88 | 220.91 |
| 100-member aggregate | deny secret | 470.33 | 476.64 |
| 100-node cause chain | none | 219.28 | 221.00 |
| 100-node cause chain | deny secret | 464.65 | 476.32 |

The larger cases differ by about 0.5–2.5% in this run. Their sample ranges overlap.
These timings do not establish a statistically significant change or a workerd CPU guarantee.
Access-count regressions remain the evidence for inspection and expansion limits.

## Bounded redaction reads

A quiet paired run compares `d653be5` with the shared redaction read allowance
and captured stack headers. Both bundles again use the same explicit tsconfig
and esbuild settings.

| Input | Sticky root policy | `d653be5` | Bounded redaction reads |
| --- | --- | ---: | ---: |
| Shallow cause with details | none | 4.86 | 4.70 |
| Shallow cause with details | deny secret | 9.18 | 10.36 |
| 100-member aggregate | none | 211.13 | 213.47 |
| 100-member aggregate | deny secret | 452.73 | 541.22 |
| 100-node cause chain | none | 213.30 | 213.60 |
| 100-node cause chain | deny secret | 458.48 | 546.71 |

The larger redacted cases cost about 19–20% more in this run, with disjoint
sample ranges. The shallow redacted median rises about 13%. The larger
unredacted cases differ by about 0.1–1.1%, with overlapping ranges.
The guarded descriptor and value reads add measurable cost to ordinary redaction.
They bound work that the previous eager copy performed before its budget check.

These scenarios deny `secret`, not `message`, so they do not measure the removal
of the second stack-header pass. A separate regression counts that work: a
60,000-member legacy aggregate needs 60,000 index reads instead of 120,000
when masking messages. The changing-stack-getter regression verifies that the
copied secret is masked without rereading its source.

## Removing the legacy envelope hook

A quiet paired run compares `19788cd` with the removal of `buildLogObject()`
and its record-copy and fallback paths. Both bundles use the same explicit
tsconfig and esbuild settings.

| Input | Sticky root policy | `19788cd` | Internal envelope assembly |
| --- | --- | ---: | ---: |
| Shallow cause with details | none | 4.49 | 3.15 |
| Shallow cause with details | deny secret | 10.32 | 9.51 |
| 100-member aggregate | none | 202.04 | 203.16 |
| 100-member aggregate | deny secret | 530.29 | 514.58 |
| 100-node cause chain | none | 202.73 | 203.15 |
| 100-node cause chain | deny secret | 514.31 | 511.45 |

The shallow unredacted median falls about 30%; its redacted median falls about
8%. The larger cases differ by at most 3%. Sample ranges overlap in all six
comparisons, so these measurements do not establish statistical significance.
Removing root assembly overhead does not remove the cost of copying and
redacting a large cause graph. The main reduction is structural: five methods
and a net 175 production lines are removed, including the legacy record copier,
continuation, inspection-cut notice, and multi-stage fallback.

## Reproduce

The scenario and timing code is
[`scripts/benchmark-log-serialization.mjs`](https://github.com/shi-rudo/base-error-ts/blob/8274c5349f5c296857c70f2e279ec542bf96a6f2/scripts/benchmark-log-serialization.mjs).
It uses 100 warm-up calls, then nine samples of 200 calls. Revision order rotates
between samples. The script reports each median, minimum, and maximum as JSON.

Each scenario wraps structured errors in a base error, so their details take the
copy path. Fixtures are reused: construction and first stack formatting are
excluded. Each detail holds identifiers, a secret, a short array, and a nested
record. The sticky variant calls `redact(["secret"])` on the root only.

Bundle `src/index.ts` from each revision using the same esbuild installation,
with `bundle: true`, `format: "esm"`, `platform: "neutral"`, and `target: "es2020"`.
Pass the same explicit `tsconfig` path for both revisions to avoid different defaults outside the repository.
Then run:

```sh
node scripts/benchmark-log-serialization.mjs \
  0ec0d0b=/absolute/path/counting-copy.mjs \
  dfe8c4e=/absolute/path/position-copy.mjs \
  current=/absolute/path/bounded-walker.mjs
```

Repeat on the deployment runtime when assessing throughput. This host's timings
are not workerd timings; the workerd suite separately verifies behavior.

For the explicit-build comparison, use the same command with
`fae6274=/absolute/path/previous.mjs` and `explicit=/absolute/path/current.mjs`.
