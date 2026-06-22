import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "presentation/index": "src/presentation/index.ts",
    "problem-details/index": "src/problem-details/index.ts",
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
});
