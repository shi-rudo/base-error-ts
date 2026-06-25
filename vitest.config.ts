/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
    typecheck: {
      tsconfig: "./tsconfig.vitest.json",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/coverage/**",
        "**/*.test.ts",
        "**/*.types.ts",
      ],
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 100,
        lines: 95,
        "src/errors/catalog.ts": { 100: true },
      },
    },
  },
});
