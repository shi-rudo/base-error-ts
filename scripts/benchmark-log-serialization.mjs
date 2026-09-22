// Run against equally bundled ESM revisions: node scripts/benchmark-log-serialization.mjs label=/absolute/bundle.mjs ...
// Timings describe this host; access-count tests enforce bounds independently.
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const revisions = await Promise.all(
  process.argv.slice(2).map(async (argument) => {
    const separator = argument.indexOf("=");
    return {
      label: argument.slice(0, separator),
      api: await import(pathToFileURL(argument.slice(separator + 1)).href),
    };
  }),
);
if (revisions.length === 0)
  throw new Error("Pass label=/absolute/bundle.mjs arguments");

function scenario({ BaseError, StructuredError }, shape, sticky) {
  const make = (cause) =>
    new StructuredError({
      code: "FAILED",
      category: "INTERNAL",
      retryable: false,
      message: "request failed",
      cause,
      details: {
        requestId: "r-1",
        secret: "private",
        attempts: [1, 2, 3],
        context: { region: "eu" },
      },
    });
  let cause;
  if (shape === "shallow") cause = make();
  if (shape === "fanout100")
    cause = new AggregateError(
      Array.from({ length: 100 }, () => make()),
      "fanout",
    );
  if (shape === "chain100") for (let i = 0; i < 100; i++) cause = make(cause);
  const error = new BaseError("outer", cause);
  return sticky ? error.redact(["secret"]) : error;
}
const results = [];
for (const shape of ["shallow", "fanout100", "chain100"]) {
  for (const sticky of [false, true]) {
    const runs = revisions.map(({ label, api }) => ({
      label,
      error: scenario(api, shape, sticky),
      samples: [],
    }));
    for (const run of runs)
      for (let i = 0; i < 100; i++) run.error.toLogObject();
    // Rotate revisions between samples to reduce order and thermal bias.
    for (let sample = 0; sample < 9; sample++) {
      for (let offset = 0; offset < runs.length; offset++) {
        const run = runs[(sample + offset) % runs.length];
        const start = performance.now();
        for (let iteration = 0; iteration < 200; iteration++)
          run.error.toLogObject();
        run.samples.push(((performance.now() - start) * 1000) / 200);
      }
    }
    for (const { label, samples } of runs) {
      samples.sort((a, b) => a - b);
      results.push({
        shape,
        sticky,
        revision: label,
        median_us: +samples[4].toFixed(2),
        min_us: +samples[0].toFixed(2),
        max_us: +samples[8].toFixed(2),
      });
    }
  }
}
console.log(
  JSON.stringify(
    {
      runtime: process.version,
      platform: `${process.platform}/${process.arch}`,
      warmup: 100,
      samples: 9,
      iterations: 200,
      results,
    },
    null,
    2,
  ),
);
