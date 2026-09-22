import { describe, expect, it } from "vitest";
import { BaseError } from "../index.js";

describe("local redaction size cuts", () => {
  it.each([[], {}])(
    "masks denied revoked values before traversal",
    (target) => {
      class SecretRoot extends BaseError<"SecretRoot"> {}
      const { proxy, revoke } = Proxy.revocable(target, {});
      revoke();
      const inner = new BaseError("inner").redactWith(() => ({
        name: "Inner",
        message: "diagnosis",
        errors: proxy,
        code: 0,
        retryable: false,
      }));

      const log = new SecretRoot("outer", inner)
        .redact(["name", "errors"])
        .toLogObject();

      expect(log).toMatchObject({
        name: "[REDACTED]",
        message: "outer",
        cause: {
          name: "[REDACTED]",
          message: "diagnosis",
          errors: "[REDACTED]",
          code: 0,
          retryable: false,
        },
      });
      expect(log.stack).toEqual(expect.any(String));
      expect(JSON.stringify(log)).not.toContain("SecretRoot");
    },
  );

  it("keeps denied revoked aggregate fields masked through JSON serialization", () => {
    const { proxy, revoke } = Proxy.revocable([], {});
    revoke();
    const inner = new BaseError("inner").redactWith(() => ({ errors: proxy }));
    const aggregate = new AggregateError([inner], "aggregate");

    const log = JSON.parse(
      JSON.stringify(new BaseError("outer", aggregate).redact(["errors"])),
    );

    expect(log.message).toBe("outer");
    expect(log.cause).toMatchObject({
      message: "aggregate",
      errors: "[REDACTED]",
    });
  });

  it.each(["allow", "deny"])(
    "keeps unreadable unmasked errors fail-closed in %s mode",
    (mode) => {
      const { proxy, revoke } = Proxy.revocable([], {});
      revoke();
      const inner = new BaseError("inner").redactWith(() => ({
        errors: proxy,
      }));
      const error = new BaseError("outer", inner);

      const log = (
        mode === "allow" ? error.redactAllow([]) : error.redact([])
      ).toLogObject();

      expect(log.message).toBe("[log redaction failed]");
      expect(log).not.toHaveProperty("cause");
      expect(log).not.toHaveProperty("stack");
    },
  );

  it("visits a real cause before a large plain-object errors field", () => {
    const inner = new BaseError("inner").redactWith(() => ({
      errors: { ids: Array(120_000).fill(0), name: "private data name" },
      cause: { name: "Error", message: "leaf diagnosis", retryable: false },
      message: "inner diagnosis",
    }));

    const log = new BaseError("outer", inner).redactAllow([]).toLogObject();

    expect(log.cause).toMatchObject({
      message: "inner diagnosis",
      cause: { name: "Error", message: "leaf diagnosis", retryable: false },
    });
    expect(JSON.stringify(log)).not.toContain("private data name");
  });

  it("still fails closed when a deferred data mask throws", () => {
    const inner = new BaseError("inner").redactWith(() => ({
      details: { password: "private password" },
      message: "cause diagnosis",
      code: 0,
      retryable: false,
    }));

    const log = new BaseError("outer", inner)
      .redact(["password"], {
        mask() {
          throw new Error("mask failed");
        },
      })
      .toLogObject();

    expect(log.message).toBe("[log redaction failed]");
    expect(log).not.toHaveProperty("cause");
    expect(JSON.stringify(log)).not.toContain("private password");
  });
});
