/**
 * Checks the packed package the way a consumer meets it. The script packs the
 * built package and installs the tarball into fresh fixtures outside the
 * repository. It runs every combination and exits with code 1 if one failed.
 *
 * - `packed-consumer/consumer.ts` compiles for each TypeScript version and
 *   module-resolution mode, as an ES module and as a CommonJS module. The
 *   fixture uses `lib: ES2020` and no `skipLibCheck`, so the declarations
 *   must hold at the documented floors.
 * - A generated parity file lists the runtime exports of each entry point.
 *   It does not compile when a declared value export is missing at runtime,
 *   or when a runtime export has no declaration.
 * - `runtime.mjs` and `runtime.cjs` load every entry point through the
 *   exports map. `runtime.cjs` loads the ES module build through require()
 *   and checks that require() and import() load the same classes.
 * - The fixtures install neither pino nor a Sentry SDK, so the declarations
 *   of the pino and sentry subpaths must resolve without them.
 *
 * Run it after the build: pnpm exec tsup && node scripts/verify-packed-consumer.mjs
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const templates = fileURLToPath(new URL("packed-consumer/", import.meta.url));

/**
 * The documented minimum for an ES module consumer, the first versions that
 * allow a CommonJS consumer to require an ES module (5.8 with
 * `module: nodenext`, 5.9 with `module: node20`), the latest 6.x, and the
 * latest release.
 */
const COMPILERS = ["5.0.4", "5.8", "5.9", "6", "latest"];

const ENTRIES = {
  root: "@shirudo/base-error",
  publicError: "@shirudo/base-error/public-error",
  pino: "@shirudo/base-error/pino",
  sentry: "@shirudo/base-error/sentry",
};

const COMMON_OPTIONS = {
  strict: true,
  noEmit: true,
  target: "ES2020",
  lib: ["ES2020"],
  types: [],
  skipLibCheck: false,
};

/**
 * `legacy` marks node10, which TypeScript 6 deprecates and 7 removes. The
 * package ships one ES module build, and a CommonJS file requires it through
 * require(esm). `requireEsmFrom` names the first TypeScript version whose
 * module setting allows that. Before that version, and with `module: node16`
 * in every version (`refusesRequireEsm`), the check compiles and expects
 * TS1479, so the documented refusal stays a measurement. `moduleFrom` names
 * the first version that knows the module setting at all. `node20-cjs` keeps
 * the default module resolution of `module: node20`.
 */
const MODES = [
  { name: "node16-esm", dir: "esm", module: "node16", resolution: "node16" },
  {
    name: "node16-cjs",
    dir: "cjs",
    module: "node16",
    resolution: "node16",
    refusesRequireEsm: true,
  },
  {
    name: "nodenext-esm",
    dir: "esm",
    module: "nodenext",
    resolution: "nodenext",
  },
  {
    name: "nodenext-cjs",
    dir: "cjs",
    module: "nodenext",
    resolution: "nodenext",
    requireEsmFrom: [5, 8],
  },
  {
    name: "node20-cjs",
    dir: "cjs",
    module: "node20",
    moduleFrom: [5, 9],
  },
  { name: "bundler", dir: "esm", module: "esnext", resolution: "bundler" },
  {
    name: "node10-cjs",
    dir: "cjs",
    module: "commonjs",
    resolution: "node10",
    legacy: true,
  },
];

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function pack(work) {
  if (!existsSync(join(repo, "dist/index.js"))) {
    throw new Error("dist/ is missing. Run pnpm exec tsup first.");
  }
  run("pnpm", ["pack", "--pack-destination", work], repo);
  const tarball = readdirSync(work).find((file) => file.endsWith(".tgz"));
  if (tarball === undefined) throw new Error("pnpm pack wrote no tarball.");
  return join(work, tarball);
}

function parityFile(runtimeExports) {
  const lines = Object.entries(ENTRIES).map(
    ([alias, entry]) => `import * as ${alias} from ${JSON.stringify(entry)};`,
  );
  for (const [alias, keys] of Object.entries(runtimeExports)) {
    lines.push(
      "",
      `export const ${alias}Exports: { [K in keyof typeof ${alias}]: true } = {`,
      ...keys.map((key) => `  ${JSON.stringify(key)}: true,`),
      "};",
    );
  }
  return `${lines.join("\n")}\n`;
}

function createFixture(work, tarball, compiler) {
  const fixture = join(work, `typescript-${compiler}`);
  for (const [dir, type] of [
    ["", "module"],
    ["esm", "module"],
    ["cjs", "commonjs"],
  ]) {
    mkdirSync(join(fixture, dir), { recursive: true });
    writeJson(join(fixture, dir, "package.json"), { private: true, type });
  }
  run(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      tarball,
      `typescript@${compiler}`,
    ],
    fixture,
  );
  for (const file of ["runtime.mjs", "runtime.cjs", "list-exports.mjs"]) {
    copyFileSync(join(templates, file), join(fixture, file));
  }
  const listed = JSON.parse(run("node", ["list-exports.mjs"], fixture));
  for (const [dir, loader] of [
    ["esm", "import"],
    ["cjs", "require"],
  ]) {
    copyFileSync(
      join(templates, "consumer.ts"),
      join(fixture, dir, "consumer.ts"),
    );
    const runtimeExports = Object.fromEntries(
      Object.entries(ENTRIES).map(([alias, entry]) => [
        alias,
        listed[entry][loader],
      ]),
    );
    writeFileSync(
      join(fixture, dir, "export-parity.ts"),
      parityFile(runtimeExports),
    );
  }
  const { version } = JSON.parse(
    readFileSync(join(fixture, "node_modules/typescript/package.json"), "utf8"),
  );
  return { fixture, version };
}

function isBefore([major, minor], [fromMajor, fromMinor]) {
  return major < fromMajor || (major === fromMajor && minor < fromMinor);
}

function compile({ fixture, version }, mode) {
  const installed = version.split(".").map(Number);
  if (mode.legacy && installed[0] >= 7) {
    return "unsupported: TypeScript 7 removed moduleResolution node10";
  }
  if (mode.moduleFrom !== undefined && isBefore(installed, mode.moduleFrom)) {
    return `unsupported: module ${mode.module} needs TypeScript ${mode.moduleFrom.join(".")}`;
  }
  writeJson(join(fixture, `tsconfig.${mode.name}.json`), {
    compilerOptions: {
      ...COMMON_OPTIONS,
      module: mode.module,
      moduleResolution: mode.resolution,
      ...(mode.legacy && installed[0] === 6 && { ignoreDeprecations: "6.0" }),
    },
    files: [`${mode.dir}/consumer.ts`, `${mode.dir}/export-parity.ts`],
  });
  const tsc = join(fixture, "node_modules/.bin/tsc");
  const args = ["-p", `tsconfig.${mode.name}.json`];
  const refuses =
    mode.refusesRequireEsm === true ||
    (mode.requireEsmFrom !== undefined &&
      isBefore(installed, mode.requireEsmFrom));
  if (!refuses) {
    run(tsc, args, fixture);
    return "passed";
  }
  try {
    run(tsc, args, fixture);
  } catch (error) {
    if (`${error.stdout}`.includes("TS1479")) {
      return "unsupported, as expected: require of an ES module (TS1479)";
    }
    throw error;
  }
  throw new Error(
    `${mode.name} compiled, but TS1479 was expected. Update MODES and the docs.`,
  );
}

const work = mkdtempSync(join(tmpdir(), "base-error-consumer-"));
const failures = [];
try {
  const tarball = pack(work);
  for (const [index, compiler] of COMPILERS.entries()) {
    const installed = createFixture(work, tarball, compiler);
    if (index === 0) {
      for (const file of ["runtime.mjs", "runtime.cjs"]) {
        try {
          process.stdout.write(run("node", [file], installed.fixture));
        } catch (error) {
          failures.push(`${file}\n${error.stdout}${error.stderr}`);
          console.log(`${file}: FAILED`);
        }
      }
    }
    for (const mode of MODES) {
      const label = `typescript ${installed.version}, ${mode.name}`;
      try {
        console.log(`${label}: ${compile(installed, mode)}`);
      } catch (error) {
        failures.push(`${label}\n${error.stdout}${error.stderr}`);
        console.log(`${label}: FAILED`);
      }
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.join("\n\n")}`);
  process.exit(1);
}
