import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// Runs the runtime-pure test suite on the real Workers runtime (workerd via
// miniflare), to catch edge-incompatibilities Node would not. examples.test.ts
// is excluded because it shells out via child_process/fs, which the Workers
// runtime does not provide.
export default defineConfig({
  plugins: [cloudflareTest({ miniflare: { compatibilityDate: "2024-09-01" } })],
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    exclude: ["src/__tests__/examples.test.ts"],
  },
});
