import { describe, expect, it } from "vitest";
import {
  StructuredError,
  defineErrors,
  detailsType,
  logObjectOf,
} from "../index.js";

const AccountErrors = defineErrors({
  LOGIN_FAILED: {
    category: "AUTH",
    retryable: false,
    details: detailsType<{
      userId: string;
      password: string;
      email: string;
      iban: string;
    }>(),
    redaction: { mode: "deny", keys: ["password"] },
  },
  PROFILE_FAILED: {
    category: "PROFILE",
    retryable: false,
    details: detailsType<{ userId: string; email: string; iban: string }>(),
    redaction: { mode: "allow", keys: ["userId"] },
  },
  SESSION_FAILED: {
    category: "AUTH",
    retryable: false,
    redaction: { mode: "deny", keys: ["message"] },
  },
  UNPROTECTED: { category: "OTHER", retryable: false },
});

const loginDetails = {
  userId: "u1",
  password: "hunter2",
  email: "ada@example.com",
  iban: "DE89",
};
const profileDetails = { userId: "u1", email: "ada@example.com", iban: "DE89" };

function loginFailed() {
  return AccountErrors.create.LOGIN_FAILED("login for u1 failed", {
    details: { ...loginDetails },
  });
}

function profileFailed() {
  return AccountErrors.create.PROFILE_FAILED("profile of u1 failed", {
    details: { ...profileDetails },
  });
}

describe("a catalog redaction policy as a floor", () => {
  it("keeps a catalog deny-list when an instance denies one more key", () => {
    const error = loginFailed().redact(["email"]);

    expect(error.toLogObject().details).toEqual({
      userId: "u1",
      password: "[REDACTED]",
      email: "[REDACTED]",
      iban: "DE89",
    });
  });

  it("keeps a catalog allow-list when an instance denies one key", () => {
    const error = profileFailed().redact(["email"]);

    expect(error.toLogObject().details).toEqual({
      userId: "u1",
      email: "[REDACTED]",
      iban: "[REDACTED]",
    });
  });

  it("keeps a catalog deny-list under an instance allow-list that names the denied key", () => {
    const error = loginFailed().redactAllow(["userId", "password"]);

    expect(error.toLogObject().details).toEqual({
      userId: "u1",
      password: "[REDACTED]",
      email: "[REDACTED]",
      iban: "[REDACTED]",
    });
  });

  it("keeps a catalog allow-list under a wider instance allow-list", () => {
    const error = profileFailed().redactAllow(["userId", "email"]);

    expect(error.toLogObject().details).toEqual({
      userId: "u1",
      email: "[REDACTED]",
      iban: "[REDACTED]",
    });
  });

  it("keeps last-wins among the instance calls, above the floor", () => {
    const error = loginFailed().redact(["email"]).redact(["iban"]);

    expect(error.toLogObject().details).toEqual({
      userId: "u1",
      password: "[REDACTED]",
      email: "ada@example.com",
      iban: "[REDACTED]",
    });
  });

  it("masks the output of an instance redactWith with the catalog policy", () => {
    const error = loginFailed().redactWith((log) => ({
      ...log,
      details: { ...loginDetails },
      loggedAt: new Date(0),
    }));

    const log = error.toLogObject();

    expect(log.details).toEqual({
      userId: "u1",
      password: "[REDACTED]",
      email: "ada@example.com",
      iban: "DE89",
    });
    expect(log.loggedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("holds the floor when the error is the cause of another error", () => {
    const cause = loginFailed().redact(["email"]);
    const outer = new StructuredError({
      code: "CHECKOUT_FAILED",
      category: "CHECKOUT",
      retryable: false,
      message: "checkout failed",
      cause,
    });

    const causeNode = outer.toLogObject().cause as {
      details: Record<string, unknown>;
    };

    expect(causeNode.details.password).toBe("[REDACTED]");
    expect(causeNode.details.email).toBe("[REDACTED]");
  });

  it("holds the floor in logObjectOf", () => {
    const error = profileFailed().redact(["email"]);

    expect(logObjectOf(error)).toEqual(error.toLogObject());
    expect(JSON.stringify(logObjectOf(error))).not.toContain("DE89");
  });

  it("masks a message that the catalog denies in toString after an instance allow-list", () => {
    const error = AccountErrors.create
      .SESSION_FAILED("session for ada@example.com expired")
      .redactAllow([]);

    expect(error.toString()).not.toContain("ada@example.com");
    expect(error.toLogObject().message).toBe("[REDACTED]");
  });

  it("masks a message that the catalog denies when the error appears as data", () => {
    const inner = AccountErrors.create
      .SESSION_FAILED("session for ada@example.com expired")
      .redactWith((log) => log);
    const outer = new StructuredError({
      code: "AUDIT_FAILED",
      category: "AUDIT",
      retryable: false,
      message: "audit failed",
      details: { inner },
    });

    expect(JSON.stringify(outer.toLogObject())).not.toContain(
      "ada@example.com",
    );
  });

  it("fails closed when an instance redactWith returns no record", () => {
    const error = loginFailed().redactWith(
      () => ["hunter2"] as unknown as Record<string, unknown>,
    );
    const outer = new StructuredError({
      code: "CHECKOUT_FAILED",
      category: "CHECKOUT",
      retryable: false,
      message: "checkout failed",
      cause: error,
    });

    const log = error.toLogObject();
    const causeNode = outer.toLogObject().cause as Record<string, unknown>;

    expect(log).toMatchObject({
      message: "[log redaction failed]",
      code: "LOGIN_FAILED",
      category: "AUTH",
      retryable: false,
    });
    expect(JSON.stringify(log)).not.toContain("hunter2");
    expect(causeNode).toMatchObject({
      message: "[log redaction failed]",
      code: "LOGIN_FAILED",
    });
  });

  it("writes the size marker as the message of the triage record when the custom output is that marker", () => {
    const error = loginFailed().redactWith(
      () => "[Max log size exceeded]" as unknown as Record<string, unknown>,
    );

    expect(error.toLogObject()).toMatchObject({
      message: "[Max log size exceeded]",
      code: "LOGIN_FAILED",
    });
  });

  it("keeps the size marker at a cause position when the copy of the custom output exceeds the budget", () => {
    const blob = Array.from({ length: 99_990 }, (_, index) => index);
    const cause = AccountErrors.create
      .LOGIN_FAILED("login for u1 failed", {
        details: { ...loginDetails, blob } as typeof loginDetails,
      })
      .redactWith((log) => log);
    const outer = new StructuredError({
      code: "CHECKOUT_FAILED",
      category: "CHECKOUT",
      retryable: false,
      message: "checkout failed",
      cause,
    });

    expect(outer.toLogObject().cause).toBe("[Max log size exceeded]");
  });

  it("keeps a floor deny-list on the message in toString under an instance message mask", () => {
    const error = AccountErrors.create
      .SESSION_FAILED("session for ada@example.com expired")
      .redact(["message"], { mask: (value) => value });

    expect(error.toString()).not.toContain("ada@example.com");
  });

  it("logs a large detail in full under redactWith and a floor", () => {
    const blob = Array.from({ length: 60_000 }, (_, index) => index);
    const error = AccountErrors.create
      .LOGIN_FAILED("login for u1 failed", {
        details: { ...loginDetails, blob } as typeof loginDetails,
      })
      .redactWith((log) => log);

    const log = error.toLogObject();
    const details = log.details as Record<string, unknown>;

    expect(log.code).toBe("LOGIN_FAILED");
    expect(details.password).toBe("[REDACTED]");
    expect((details.blob as unknown[]).length).toBe(60_000);
  });

  it("copies the output of redactWith for errors inside details on the budget of the enclosing log", () => {
    let indexReads = 0;
    const big = new Proxy(
      Array.from({ length: 60_000 }, (_, index) => index),
      {
        get(target, key, receiver) {
          if (typeof key === "string" && /^\d+$/.test(key)) indexReads += 1;
          return Reflect.get(target, key, receiver);
        },
      },
    );
    const inners = [1, 2, 3].map(() =>
      AccountErrors.create
        .SESSION_FAILED("session expired")
        .redactWith((log) => ({ ...log, big })),
    );
    const outer = new StructuredError({
      code: "AUDIT_FAILED",
      category: "AUDIT",
      retryable: false,
      message: "audit failed",
      details: { inners },
    });

    const serialized = JSON.stringify(outer.toLogObject());

    expect(serialized).toContain("[Max log size exceeded]");
    expect(indexReads).toBeLessThan(120_000);
  });

  it("leaves an error without a catalog policy on last-wins", () => {
    const error = AccountErrors.create
      .UNPROTECTED("unprotected failure", {})
      .redactWith(() => ({ kept: "as returned" }));

    expect(error.toLogObject()).toEqual({ kept: "as returned" });
  });

  it("leaves a plain StructuredError on last-wins", () => {
    const error = new StructuredError({
      code: "PLAIN",
      category: "OTHER",
      retryable: false,
      message: "plain",
      details: { a: "1", b: "2" },
    })
      .redact(["a"])
      .redact(["b"]);

    expect(error.toLogObject().details).toEqual({ a: "1", b: "[REDACTED]" });
  });
});
