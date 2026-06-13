import { describe, expect, it } from "vitest";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const EXAMPLES_DIR = join(__dirname, "..", "..", "examples");

const EXAMPLE_FILES = [
  "basic-usage.ts",
  "error-handling.ts",
  "structured-errors-example.ts",
  "error-codes-example.ts",
  "domain-errors-example.ts",
  "automatic-name-example.ts",
] as const;

describe("Examples", () => {
  describe("all example files should exist", () => {
    for (const file of EXAMPLE_FILES) {
      it(`should have ${file}`, () => {
        const filePath = join(EXAMPLES_DIR, file);
        expect(existsSync(filePath)).toBe(true);
      });
    }
  });

  describe("all examples should execute without errors", () => {
    for (const file of EXAMPLE_FILES) {
      it(`should run ${file} successfully`, { timeout: 60000 }, () => {
        const filePath = join(EXAMPLES_DIR, file);
        expect(existsSync(filePath)).toBe(true);

        expect(() => {
          execSync(`TEST=true npx tsx "${filePath}"`, {
            encoding: "utf-8",
            stdio: "pipe",
            timeout: 30000,
            env: { ...process.env, TEST: "true" },
          });
        }).not.toThrow();
      });
    }
  });
});
