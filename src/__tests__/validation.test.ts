import { describe, it, expect } from "vitest";
import { ValidationError, StructuredError } from "../index.js";
import type { ValidationIssue } from "../index.js";

describe("ValidationError", () => {
  describe("construction & identity", () => {
    it("is a StructuredError with validation defaults baked in", () => {
      const v = new ValidationError("Invalid input");
      expect(v).toBeInstanceOf(StructuredError);
      expect(v.code).toBe("VALIDATION_FAILED");
      expect(v.category).toBe("VALIDATION");
      expect(v.retryable).toBe(false);
      expect(v.message).toBe("Invalid input");
    });

    it("has a stable _tag literal", () => {
      expect(new ValidationError("x")._tag).toBe("ValidationError");
    });

    it("allows overriding code/category", () => {
      const v = new ValidationError("x", {
        code: "BAD_REQUEST",
        category: "CLIENT",
      });
      expect(v.code).toBe("BAD_REQUEST");
      expect(v.category).toBe("CLIENT");
    });
  });

  describe("accumulation", () => {
    it("starts empty", () => {
      const v = new ValidationError("x");
      expect(v.hasIssues()).toBe(false);
      expect(v.issues).toEqual([]);
    });

    it("collects issues via addIssue and chains", () => {
      const v = new ValidationError("x");
      const ret = v.addIssue({ message: "Bad email", path: ["email"] });
      expect(ret).toBe(v);
      expect(v.hasIssues()).toBe(true);
      expect(v.issues).toEqual([{ message: "Bad email", path: ["email"] }]);
    });

    it("collects many via addIssues", () => {
      const v = new ValidationError("x").addIssues([
        { message: "a", path: ["x"] },
        { message: "b", path: ["y"] },
      ]);
      expect(v.issues).toHaveLength(2);
    });

    it("pre-populates from the constructor", () => {
      const v = new ValidationError("x", {
        issues: [{ message: "a", path: ["x"] }],
      });
      expect(v.hasIssues()).toBe(true);
    });

    it("ingests Standard-Schema-shaped issues unchanged", () => {
      const fromValidator: ValidationIssue[] = [
        { message: "Required", path: ["address", "zip"] },
      ];
      const v = new ValidationError("x", { issues: fromValidator });
      expect(v.issues[0]?.path).toEqual(["address", "zip"]);
    });
  });

  describe("publicIssues: safe whitelist", () => {
    it("projects message/path and derives a pointer from the path", () => {
      const v = new ValidationError("x").addIssue({
        message: "Required",
        path: ["address", "zip"],
      });
      expect(v.publicIssues()).toEqual([
        {
          message: "Required",
          path: ["address", "zip"],
          pointer: "address.zip",
        },
      ]);
    });

    it("never leaks raw validator extras (e.g. the rejected value)", () => {
      const v = new ValidationError("x");
      // Simulate a Zod-native issue carrying the rejected input.
      v.addIssue({
        message: "Too short",
        path: ["password"],
        received: "hunter2",
      } as ValidationIssue);

      const pub = v.publicIssues();
      expect(pub[0]).not.toHaveProperty("received");
      expect(JSON.stringify(pub)).not.toContain("hunter2");
    });

    it("includes a code only when the source issue carries one", () => {
      const v = new ValidationError("x")
        .addIssue({
          message: "a",
          path: ["x"],
          code: "TOO_SHORT",
        } as ValidationIssue)
        .addIssue({ message: "b", path: ["y"] });
      const pub = v.publicIssues();
      expect(pub[0]?.code).toBe("TOO_SHORT");
      expect(pub[1]).not.toHaveProperty("code");
    });

    it("supports a mapIssue hook for a custom (RFC-7807) shape", () => {
      const v = new ValidationError("x").addIssue({
        message: "Required",
        path: ["address", "zip"],
      });
      const params = v.publicIssues({
        mapIssue: (i) =>
          ({
            message: i.message,
            name: (i.path ?? []).join("."),
            reason: i.message,
          }) as never,
      });
      expect(params[0]).toMatchObject({
        name: "address.zip",
        reason: "Required",
      });
    });
  });

  describe("serialization", () => {
    it("does NOT expose issues in toProblemDetails by default", () => {
      const v = new ValidationError("Invalid").addIssue({
        message: "Bad email",
        path: ["email"],
      });
      const problem = v.toProblemDetails({ status: 422 });
      expect(problem).not.toHaveProperty("errors");
      expect(problem.code).toBe("INTERNAL_ERROR");
    });

    it("exposes a safe errors[] only on explicit opt-in", () => {
      const v = new ValidationError("Invalid").addIssue({
        message: "Bad email",
        path: ["email"],
      });
      const problem = v.toProblemDetails({
        status: 422,
        extensions: { errors: v.publicIssues() },
      });
      expect(problem.status).toBe(422);
      expect((problem as { errors: unknown[] }).errors).toHaveLength(1);
      // standard members still win
      expect(problem.code).toBe("INTERNAL_ERROR");
    });

    it("carries the full issues (with extras) in toLogObject", () => {
      const v = new ValidationError("Invalid").addIssue({
        message: "Too short",
        path: ["password"],
        received: "hunter2",
      } as ValidationIssue);
      const log = v.toLogObject();
      const details = log.details as { issues: Array<Record<string, unknown>> };
      expect(details.issues[0]?.received).toBe("hunter2");
    });
  });
});
