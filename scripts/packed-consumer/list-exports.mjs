// Prints the runtime export names of each entry point, per module format, as
// the packed package resolves from this directory.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const entries = [
  "@shirudo/base-error",
  "@shirudo/base-error/public-error",
  "@shirudo/base-error/pino",
  "@shirudo/base-error/sentry",
];
const exportsOf = {};
for (const entry of entries) {
  exportsOf[entry] = {
    esm: Object.keys(await import(entry)).sort(),
    cjs: Object.keys(require(entry)).sort(),
  };
}
console.log(JSON.stringify(exportsOf));
