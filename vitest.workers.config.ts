import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// Runs the runtime-pure test suite on the real Workers runtime (workerd via
// miniflare), to catch edge incompatibilities that Node accepts. Three files
// stay on Node, because the Workers runtime has no child_process, no node:vm
// and no Node logger:
// - examples.test.ts shells out through child_process and fs.
// - cross-realm.test.ts builds a second realm with node:vm.
// - pino-setup.test.ts runs pino, a Node logger.
export default defineConfig({
  plugins: [cloudflareTest({ miniflare: { compatibilityDate: "2024-09-01" } })],
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    exclude: [
      "src/__tests__/examples.test.ts",
      "src/__tests__/cross-realm.test.ts",
      "src/__tests__/pino-setup.test.ts",
    ],
  },
});
