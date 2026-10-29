// Prints the runtime export names of each entry point, as the packed package
// resolves from this directory. The package ships one ES module build, so
// both loaders read the same module: `import` directly and `require`
// through require(esm).
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
    import: Object.keys(await import(entry)).sort(),
    require: Object.keys(require(entry)).sort(),
  };
}
console.log(JSON.stringify(exportsOf));
