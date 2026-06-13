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

  it("leaves toLogObject unchanged when no redactor is set", () => {
    const log = makeError().toLogObject();
    expect((log.details as Record<string, unknown>).ssn).toBe("123-45-6789");
  });

  describe("redactAllow (allow-list)", () => {
    it("keeps only allowed detail leaves and masks the rest (deep)", () => {
      const log = makeError().redactAllow(["userId", "phone"]).toLogObject();
      const details = log.details as Record<string, unknown>;
      expect(details.userId).toBe("1"); // allowed leaf kept
      expect(details.email).toBe("[REDACTED]"); // not allowed → masked
      expect(details.ssn).toBe("[REDACTED]");
      expect((details.profile as Record<string, unknown>).phone).toBe(
        "555-0100",
      ); // nested allowed leaf kept
    });

    it("does not touch the envelope (message/code/category survive)", () => {
      const log = makeError().redactAllow(["userId"]).toLogObject();
      expect(log.message).toBe("update failed");
      expect(log.code).toBe("USER_UPDATE_FAILED");
      expect(log.category).toBe("PERSISTENCE");
    });

    it("honors a custom mask and applies inside cause details", () => {
      const inner = new StructuredError({
        code: "DB",
        category: "I",
        retryable: true,
        message: "x",
        details: { ssn: "9", keep: "ok" },
      });
      const outer = new StructuredError({
        code: "O",
        category: "X",
        retryable: false,
        message: "m",
        cause: inner,
      }).redactAllow(["keep"], { mask: "•" });
      const causeDetails = (
        outer.toLogObject().cause as { details: Record<string, unknown> }
      ).details;
      expect(causeDetails.keep).toBe("ok");
      expect(causeDetails.ssn).toBe("•");
    });
  });

  describe("function mask", () => {
    const makeWith = (details: Record<string, unknown>) =>
      new StructuredError({
        code: "X",
        category: "Y",
        retryable: false,
        message: "m",
        details,
      });

    it("supports partial masking (preserve last chars)", () => {
      const log = makeWith({ card: "4111111111116789" })
        .redact(["card"], { mask: (v) => "****" + String(v).slice(-4) })
        .toLogObject();
      expect((log.details as Record<string, unknown>).card).toBe("****6789");
    });

    it("can preserve the value type (e.g. mask a number to 0)", () => {
      const log = makeWith({ age: 42 })
        .redact(["age"], { mask: () => 0 })
        .toLogObject();
      expect((log.details as Record<string, unknown>).age).toBe(0);
    });

    it("passes the original value and key to the mask function", () => {
      const log = makeWith({ email: "a@b.com" })
        .redact(["email"], { mask: (v, k) => `${k}:${String(v).length}` })
        .toLogObject();
      expect((log.details as Record<string, unknown>).email).toBe("email:7");
    });

    it("works with redactAllow too", () => {
      const log = makeWith({ keep: "ok", secret: "abcdef" })
        .redactAllow(["keep"], { mask: (v) => String(v).length })
        .toLogObject();
      const details = log.details as Record<string, unknown>;
      expect(details.keep).toBe("ok");
      expect(details.secret).toBe(6);
    });
  });

  describe("walker correctness (review #1, #2)", () => {
    it("redactAllow masks non-allowed data in a plain-object cause (no leak outside details)", () => {
      const err = new StructuredError({
        code: "O",
        category: "X",
        retryable: false,
        message: "m",
        cause: { apiKey: "SECRET123", id: "keep-me" },
      }).redactAllow(["id"]);

      const cause = err.toLogObject().cause as Record<string, unknown>;
      expect(cause.apiKey).toBe("[REDACTED]");
      expect(cause.id).toBe("keep-me");
    });

    it("redactAllow still keeps a structured cause's envelope and masks its details", () => {
      const inner = new StructuredError({
        code: "DB",
        category: "I",
        retryable: true,
        message: "rejected",
        details: { ssn: "999", keep: "ok" },
      });
      const err = new StructuredError({
        code: "O",
        category: "X",
        retryable: false,
        message: "m",
        cause: inner,
      }).redactAllow(["keep"]);

      const cause = err.toLogObject().cause as Record<string, unknown>;
      expect(cause.code).toBe("DB"); // structured envelope of the cause survives
      expect(cause.message).toBe("rejected");
      const d = cause.details as Record<string, unknown>;
      expect(d.ssn).toBe("[REDACTED]");
      expect(d.keep).toBe("ok");
    });

    it("redact preserves non-plain detail values (Date/Set) instead of collapsing to {}", () => {
      const when = new Date("2020-01-01T00:00:00.000Z");
      const err = new StructuredError({
        code: "D",
        category: "Z",
        retryable: false,
        message: "m",
        details: { when, tags: new Set(["a"]), userId: "1" },
      }).redact(["password"]); // non-matching key

      const d = err.toLogObject().details as Record<string, unknown>;
      expect(d.when).toBe(when); // not rebuilt into {}
      expect(d.tags).toBeInstanceOf(Set);
      expect(d.userId).toBe("1");
    });

    it("redactAllow masks a non-allowed non-plain detail value without collapsing allowed ones", () => {
      const when = new Date("2020-01-01T00:00:00.000Z");
      const err = new StructuredError({
        code: "D",
        category: "Z",
        retryable: false,
        message: "m",
        details: { when, kept: new Date("2021-01-01T00:00:00.000Z") },
      }).redactAllow(["kept"]);

      const d = err.toLogObject().details as Record<string, unknown>;
      expect(d.when).toBe("[REDACTED]"); // not allowed -> masked
      expect(d.kept).toBeInstanceOf(Date); // allowed -> preserved, not collapsed
    });
  });

  describe("walker depth + cause regions (review-2 #1/#2)", () => {
    class Session {
      userId = "u1";
      password = "hunter2";
    }

    it("redact masks a denied key nested inside a class instance (deny-list reaches non-plain objects)", () => {
      const err = new StructuredError({
        code: "X",
        category: "Y",
        retryable: false,
        message: "m",
        details: { session: new Session() },
      }).redact(["password"]);

      const session = (err.toLogObject().details as { session: Session })
        .session;
      expect(session.password).toBe("[REDACTED]");
      expect(session.userId).toBe("u1"); // non-denied sibling survives
    });

    it("redactAllow descends into a class instance, keeping allowed leaves and masking the rest", () => {
      const err = new StructuredError({
        code: "X",
        category: "Y",
        retryable: false,
        message: "m",
        details: { session: new Session() },
      }).redactAllow(["userId"]);

      const session = (err.toLogObject().details as { session: Session })
        .session;
      expect(session.userId).toBe("u1"); // allowed leaf kept
      expect(session.password).toBe("[REDACTED]"); // not allowed → masked
    });

    it("redactAllow masks foreign fields in a cause that mimics the structured shape", () => {
      const err = new StructuredError({
        code: "O",
        category: "X",
        retryable: false,
        message: "m",
        cause: { code: "E", category: "a", retryable: false, secret: "SHHH" },
      }).redactAllow(["id"]);

      const cause = err.toLogObject().cause as Record<string, unknown>;
      expect(cause.secret).toBe("[REDACTED]"); // foreign sibling masked (no bypass)
      expect(cause.code).toBe("E"); // structural envelope kept
      expect(cause.category).toBe("a");
      expect(cause.retryable).toBe(false);
    });

    it("redactAllow masks an envelope-named key nested inside a foreign cause field (no at-any-depth keep)", () => {
      const err = new StructuredError({
        code: "O",
        category: "X",
        retryable: false,
        message: "m",
        cause: {
          code: "E",
          category: "a",
          retryable: false,
          meta: { message: "SECRET-PII", token: "t" },
        },
      }).redactAllow([]);

      const cause = err.toLogObject().cause as Record<string, unknown>;
      expect(cause.code).toBe("E"); // cause-top envelope kept
      const meta = cause.meta as Record<string, unknown>;
      expect(meta.message).toBe("[REDACTED]"); // nested foreign data, NOT envelope
      expect(meta.token).toBe("[REDACTED]");
    });

    it("redactAllow masks envelope-named keys inside an array under a foreign cause field", () => {
      const err = new StructuredError({
        code: "O",
        category: "X",
        retryable: false,
        message: "m",
        cause: {
          code: "E",
          category: "a",
          retryable: false,
          items: [{ code: "S1" }],
        },
      }).redactAllow([]);

      const cause = err.toLogObject().cause as Record<string, unknown>;
      const items = cause.items as Array<Record<string, unknown>>;
      expect(items[0]?.code).toBe("[REDACTED]"); // data in array, not cause-top envelope
    });

    it("redactAllow keeps an absent cause as undefined instead of masking it", () => {
      // makeError() has no cause → buildLogObject emits cause: undefined.
      const log = makeError().redactAllow(["userId"]).toLogObject();
      expect(log.cause).toBeUndefined(); // structural slot, not "[REDACTED]"
    });

    it("redactAllow keeps the top-level structural envelope regardless of region-transition keys", () => {
      const log = makeError().redactAllow([]).toLogObject();
      expect(log.code).toBe("USER_UPDATE_FAILED");
      expect(log.message).toBe("update failed");
      expect(log.cause).toBeUndefined();
    });

    it("redactAllow preserves an empty plain object in details instead of masking it to a string", () => {
      const err = new StructuredError({
        code: "X",
        category: "Y",
        retryable: false,
        message: "m",
        details: { userId: "1", profile: {} },
      }).redactAllow(["userId"]);

      const details = err.toLogObject().details as Record<string, unknown>;
      expect(details.profile).toEqual({}); // kept as {}, not "[REDACTED]"
    });

    it("redactAllow treats structured and non-structured causes consistently (both keep envelope, mask foreign data)", () => {
      const structuredCauseSecret = new StructuredError({
        code: "DB",
        category: "I",
        retryable: true,
        message: "rejected",
        details: { ssn: "999" },
      });
      const err = new StructuredError({
        code: "O",
        category: "X",
        retryable: false,
        message: "wrap",
        cause: structuredCauseSecret,
      }).redactAllow([]);

      const cause = err.toLogObject().cause as Record<string, unknown>;
      expect(cause.code).toBe("DB"); // envelope kept
      expect(cause.message).toBe("rejected"); // envelope kept
      expect((cause.details as Record<string, unknown>).ssn).toBe("[REDACTED]"); // data masked
    });
  });

  describe("fail-closed on a throwing redactor", () => {
    it("does not crash the log path and does not leak the payload", () => {
      const err = makeError().redactWith(() => {
        throw new Error("redactor bug");
      });
      let log!: Record<string, unknown>;
      expect(() => {
        log = err.toLogObject();
      }).not.toThrow();
      // fail-closed: no details payload, just a safe marker
      expect(log).not.toHaveProperty("details");
      expect(JSON.stringify(log)).not.toContain("123-45-6789");
      expect(log.message).toBe("[log redaction failed]");
    });

    it("keeps non-sensitive triage fields in the fail-closed marker", () => {
      const err = makeError().redactWith(() => {
        throw new Error("redactor bug");
      });
      const log = err.toLogObject();
      // structural, non-sensitive fields survive for triage
      expect(log.code).toBe("USER_UPDATE_FAILED");
      expect(log.category).toBe("PERSISTENCE");
      expect(log.retryable).toBe(false);
      expect(log.timestamp).toBeTypeOf("number");
      // but the unredacted message/details never appear
      expect(log.message).toBe("[log redaction failed]");
      expect(log).not.toHaveProperty("details");
    });
  });
});
