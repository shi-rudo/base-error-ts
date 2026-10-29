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

    expect(error.toLogObject()).toEqual({ message: "[log redaction failed]" });
    expect(outer.toLogObject().cause).toBe("[log redaction failed]");
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
