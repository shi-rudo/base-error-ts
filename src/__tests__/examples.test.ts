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
  "problem-details-example.ts",
  "error-response-builder-example.ts",
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

  describe("problem-details-example", () => {
    it("should produce RFC 9457 compliant output", { timeout: 60000 }, () => {
      const filePath = join(EXAMPLES_DIR, "problem-details-example.ts");
      const output = execSync(`TEST=true npx tsx "${filePath}"`, {
        encoding: "utf-8",
        timeout: 30000,
        env: { ...process.env, TEST: "true" },
      });

      expect(output).toContain("Problem Details Example");
      expect(output).toContain('"type":');
      expect(output).toContain('"title":');
      expect(output).toContain('"status":');
      expect(output).toContain('"detail":');
      expect(output).toContain('"instance":');
      expect(output).toContain('"traceId":');
      expect(output).toContain('"code":');
      expect(output).toContain('"category":');
      expect(output).toContain('"retryable":');
    });

    it("should include Japanese localized titles", { timeout: 60000 }, () => {
      const filePath = join(EXAMPLES_DIR, "problem-details-example.ts");
      const output = execSync(`TEST=true npx tsx "${filePath}"`, {
        encoding: "utf-8",
        timeout: 30000,
        env: { ...process.env, TEST: "true" },
      });

      expect(output).toContain("データベースエラー");
    });
  });

  describe("error-response-builder-example", () => {
    it("should produce ErrorResponse format", { timeout: 60000 }, () => {
      const filePath = join(EXAMPLES_DIR, "error-response-builder-example.ts");
      const output = execSync(`TEST=true npx tsx "${filePath}"`, {
        encoding: "utf-8",
        timeout: 30000,
        env: { ...process.env, TEST: "true" },
      });

      expect(output).toContain("Error Response Builder Example");
      expect(output).toContain('"isSuccess": false');
      expect(output).toContain('"code":');
      expect(output).toContain('"category":');
      expect(output).toContain('"ctx":');
      expect(output).toContain('"httpStatusCode":');
      expect(output).toContain('"messageLocalized":');
      expect(output).toContain("ユーザーが見つかりません");
    });

    it(
      "should include both English and Japanese localizations",
      { timeout: 60000 },
      () => {
        const filePath = join(
          EXAMPLES_DIR,
          "error-response-builder-example.ts",
        );
        const output = execSync(`npx tsx "${filePath}"`, {
          encoding: "utf-8",
          timeout: 30000,
        });

        expect(output).toContain("locale");
        expect(output).toContain("ja");
      },
    );

    it("should show success response format", { timeout: 60000 }, () => {
      const filePath = join(EXAMPLES_DIR, "error-response-builder-example.ts");
      const output = execSync(`TEST=true npx tsx "${filePath}"`, {
        encoding: "utf-8",
        timeout: 30000,
        env: { ...process.env, TEST: "true" },
      });

      expect(output).toContain('"isSuccess": true');
      expect(output).toContain("Success Response");
    });
  });
});
