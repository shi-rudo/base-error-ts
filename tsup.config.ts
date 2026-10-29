import { defineConfig, type Options } from "tsup";

type EsbuildPlugin = NonNullable<Options["esbuildPlugins"]>[number];

/**
 * The pino and sentry subpaths import the core through the root entry. Their
 * bundles keep that import as a relative path to the root bundle of the same
 * format, so a consumer loads one core. A subpath then recognizes an error of
 * the root entry by the private brand of its class. A copy of the core in a
 * subpath bundle would lose the policy of that error. verify-dist.mjs guards
 * this on every build.
 */
const subpathsShareTheCore: EsbuildPlugin = {
  name: "subpaths-share-the-core",
  setup(build) {
    // tsup builds both formats as esbuild "esm"; the extension tells them apart.
    const extension = build.initialOptions.outExtension?.[".js"] ?? ".js";
    const rootBundle = `../index${extension}`;
    build.onResolve({ filter: /^\.\.\/index\.js$/ }, ({ importer }) =>
      /[\\/]src[\\/](pino|sentry)[\\/]/.test(importer)
        ? { path: rootBundle, external: true }
        : undefined,
    );
  },
};

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "public-error/index": "src/public-error/index.ts",
    "pino/index": "src/pino/index.ts",
    "sentry/index": "src/sentry/index.ts",
  },
  format: ["esm", "cjs"],
  dts: {
    resolve: true,
  },
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  treeshake: true,
  outDir: "dist",
  noExternal: [], // Bundle all dependencies
  platform: "neutral", // Target both Node.js and browsers
  esbuildPlugins: [subpathsShareTheCore],
  onSuccess: "node scripts/verify-dist.mjs",
});
