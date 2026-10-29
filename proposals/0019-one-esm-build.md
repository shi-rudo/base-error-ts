# One ESM build

Status: proposed; release: 10.0.0.
Tracking: `base-error-ts-82a`.

## Decision

The package ships one build: ES modules. `import` and `require` load the same files, so a process holds one class per copy of the package.

- Each entry of the `exports` map names its declarations (`types`) and one module (`default`). The `require` condition, the `.cjs` bundles and the `.d.cts` declarations go away.
- `require()` loads the ES module through `require(esm)`. Node 24, the floor of the package, runs it without a flag. The module graph has no top-level `await`, which `require(esm)` does not allow.
- A test of the packed package requires and imports the package in one process and asserts that both load the same `BaseError` class.

## Problem

The package shipped an ESM build and a CJS build. Each build held its own `BaseError` class. A process that loads both, for example an application through `import` and a dependency through `require`, holds two classes:

- `logObjectOf` recognizes a `BaseError` by the private brand of its own class. A masked `StructuredError` of the CJS build came out of the ESM pino subpath as `secret message` and `ada@example.com`. Its own `toLogObject()` masked both.
- `instanceof StructuredError` in the code of a consumer fails for an error of the other build.
- The cause serializer writes a cause of the other build as a foreign error, without its policy.

A registry in which each class registers a writer for its own brand repairs `logObjectOf` only. It adds state for the whole process and a protocol between versions. It leaves the second class, and with it the other two failures.

## Consequences

The packed-consumer check measured the ESM build against TypeScript 5.0.4, 6 and 7:

| Consumer | Result |
| --- | --- |
| ES module, every module resolution | compiles |
| CommonJS with `module: nodenext`, TypeScript 5.8 or later | compiles |
| CommonJS with `module: commonjs` (resolution `node10`) | compiles |
| CommonJS with `module: node16`, every version | `TS1479` |
| CommonJS with `module: nodenext`, before TypeScript 5.8 | `TS1479` |
| `require()` in JavaScript on Node 24 | runs, with the same class as `import` |

- The change breaks the two failing groups, so it is a major release. `MIGRATION.md` names the exit: `module: nodenext` with TypeScript 5.8 or later, or an ES module.
- Jest supports `require(esm)` from Node 24.9, according to its documentation. A CommonJS test on an earlier Node 24 needs a newer Node.
- Two copies of the package in the dependency tree still hold two classes. The guides keep that limit and advise to deduplicate the package.
- The package halves its size, and the build, `verify-dist.mjs` and the packed-consumer check have one format to cover.

## Alternatives

- **A registry of log writers across builds.** Rejected for the reasons in *Problem*.
- **A CJS entry that re-exports the ESM build.** It gives one class too, but it adds a file per entry and gives the same runtime as the direct `default` entry. Rejected as the larger form of the same result.
