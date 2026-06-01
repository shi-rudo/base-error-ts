import { describe, it, expect } from "vitest";
import { StructuredError, BaseError } from "../index.js";

class TestError extends BaseError<"TestError"> {}

const makeError = () =>
  new StructuredError({
    code: "USER_UPDATE_FAILED",
    category: "PERSISTENCE",
    retryable: false,
    message: "update failed",
    details: {
      userId: "1",
      email: "a@b.com",
      ssn: "123-45-6789",
      profile: { phone: "555-0100" },
    },
  });

describe("log redaction", () => {
  it("masks matching detail keys with the default mask", () => {
    const log = makeError().redact(["email", "ssn"]).toLogObject();
    const details = log.details as Record<string, unknown>;
    expect(details.userId).toBe("1");
    expect(details.email).toBe("[REDACTED]");
    expect(details.ssn).toBe("[REDACTED]");
  });

  it("masks nested detail keys (deep)", () => {
    const log = makeError().redact(["phone"]).toLogObject();
    const profile = (log.details as { profile: Record<string, unknown> })
      .profile;
    expect(profile.phone).toBe("[REDACTED]");
  });

  it("honors a custom mask", () => {
    const log = makeError().redact(["ssn"], { mask: "******" }).toLogObject();
    expect((log.details as Record<string, unknown>).ssn).toBe("******");
  });

  it("leaves non-matching fields untouched", () => {
    const log = makeError().redact(["ssn"]).toLogObject();
    const details = log.details as Record<string, unknown>;
    expect(details.email).toBe("a@b.com");
    expect(details.userId).toBe("1");
  });

  it("is sticky: JSON.stringify / zero-arg toJSON apply redaction (logger path)", () => {
    const err = makeError().redact(["ssn", "email"]);
    const fromStringify = JSON.parse(JSON.stringify(err));
    expect(fromStringify.details.ssn).toBe("[REDACTED]");
    expect(fromStringify.details.email).toBe("[REDACTED]");
    expect((err.toJSON().details as Record<string, unknown>).ssn).toBe(
      "[REDACTED]",
    );
  });

  it("masks matching keys inside a serialized cause chain", () => {
    const inner = new StructuredError({
      code: "DB_ERROR",
      category: "INFRASTRUCTURE",
      retryable: true,
      message: "rejected",
      details: { ssn: "999-99-9999" },
    });
    const outer = new StructuredError({
      code: "OUTER",
      category: "X",
      retryable: false,
      message: "wrap",
      cause: inner,
    }).redact(["ssn"]);

    const cause = outer.toLogObject().cause as {
      details: Record<string, unknown>;
    };
    expect(cause.details.ssn).toBe("[REDACTED]");
  });

  it("redactWith transforms the whole log object (allow-list / message scrub)", () => {
    const log = makeError()
      .redactWith((l) => ({
        ...l,
        message: "scrubbed",
        details: { userId: (l.details as Record<string, unknown>).userId },
      }))
      .toLogObject();
    expect(log.message).toBe("scrubbed");
    expect(log.details).toEqual({ userId: "1" });
  });

  it("uses the last configured redactor", () => {
    const log = makeError()
      .redact(["email"])
      .redact(["ssn"], { mask: "X" })
      .toLogObject();
    const details = log.details as Record<string, unknown>;
    expect(details.email).toBe("a@b.com"); // first redactor replaced
    expect(details.ssn).toBe("X");
  });

  it("is chainable (returns this)", () => {
    const err = new TestError("boom");
    expect(err.redact(["x"])).toBe(err);
    expect(err.redactWith((l) => l)).toBe(err);
  });

  it("does not affect the client path (toProblemDetails)", () => {
    const problem = makeError()
      .redact(["email", "ssn"])
      .toProblemDetails({ status: 500 });
    // client path was already safe (details never exposed); redaction is moot there
    expect(problem).not.toHaveProperty("ssn");
    expect(problem.code).toBe("INTERNAL_ERROR");
  });

  it("leaves toLogObject unchanged when no redactor is set", () => {
    const log = makeError().toLogObject();
    expect((log.details as Record<string, unknown>).ssn).toBe("123-45-6789");
  });
});
