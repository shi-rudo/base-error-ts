import { describe, expect, it } from "vitest";
import { BaseError, StructuredError } from "../index.js";

type Log = Record<string, unknown>;
const secret = "private-size-cut-password";

function wideError(details: Log, cause: unknown = new Error("original cause")) {
  return new StructuredError({
    code: "WIDE",
    category: "INTERNAL",
    retryable: false,
    message: "technical diagnosis",
    cause,
    details,
  });
}

function expectDiagnosis(log: Log) {
  expect.soft(log).toMatchObject({
    message: "technical diagnosis",
    code: "WIDE",
    category: "INTERNAL",
    retryable: false,
    cause: { message: "original cause" },
  });
  expect.soft(log.stack).toEqual(expect.any(String));
  expect.soft(log.cause).toMatchObject({ stack: expect.any(String) });
}

describe("oversized redaction keeps the technical diagnosis", () => {
  it("cuts a wide numeric detail locally under a no-match deny-list", () => {
    const ids = Array.from({ length: 120_000 }, (_, index) => index);
    const error = wideError({ ids }).redact(["password"]);

    const log = error.toLogObject();

    expectDiagnosis(log);
    expect(log.details).toMatchObject({ ids: expect.any(Array) });
    const retained = (log.details as { ids: unknown[] }).ids;
    expect(retained[0]).toBe(0);
    expect(retained.length).toBeLessThan(ids.length);
    expect(JSON.stringify(log.details)).toContain(
      "[Max redaction size exceeded]",
    );
    expect(ids).toHaveLength(120_000);
  });

  it("masks retained data under an empty allow-list on the JSON logger path", () => {
    const error = wideError({
      password: secret,
      ids: Array(120_000).fill(secret),
    }).redactAllow([]);

    const log = JSON.parse(JSON.stringify(error)) as Log;

    expectDiagnosis(log);
    expect(log.details).toMatchObject({
      password: "[REDACTED]",
      ids: expect.any(Array),
    });
    const retained = (log.details as { ids: unknown[] }).ids;
    expect(retained[0]).toBe("[REDACTED]");
    expect(retained.length).toBeLessThan(120_000);
    expect(JSON.stringify(log)).not.toContain(secret);
  });

  it("bounds repeated DAG expansion without discarding the diagnosis", () => {
    const shared = { password: secret, ids: Array(60_000).fill(7) };
    const error = wideError({ first: shared, second: shared }).redact([
      "password",
    ]);

    const log = error.toLogObject();

    expectDiagnosis(log);
    expect(log.details).toMatchObject({
      first: { password: "[REDACTED]" },
    });
    const json = JSON.stringify(log);
    expect(json).toContain("[Max redaction size exceeded]");
    expect(json).not.toContain(secret);
    expect((log.details as Log).first === shared).toBe(false);
    expect((log.details as Log).second === shared).toBe(false);
  });

  it.each(["first", "last"])(
    "preserves cause diagnostics when oversized policy data is inserted %s",
    (position) => {
      const data = { details: { ids: Array(120_000).fill(1) } };
      const diagnostic = {
        name: "PolicyCause",
        message: "original cause",
        stack: "PolicyCause: original cause\n    at operation",
        code: 0,
        category: "PERMANENT",
        retryable: false,
        cause: { name: "Error", message: "leaf diagnosis" },
      };
      const policyOutput =
        position === "first"
          ? { ...data, ...diagnostic }
          : { ...diagnostic, ...data };
      const cause = new BaseError("inner").redactWith(() => policyOutput);
      const error = wideError({}, cause).redact(["password"]);

      const log = error.toLogObject();

      expectDiagnosis(log);
      expect(log.cause).toMatchObject({
        code: 0,
        category: "PERMANENT",
        retryable: false,
        cause: { message: "leaf diagnosis" },
      });
      expect(JSON.stringify(log.cause)).toContain(
        "[Max redaction size exceeded]",
      );
    },
  );

  it.each(["allow", "deny"])(
    "keeps diagnostics after %s redaction exhausts descriptor reads",
    (mode) => {
      let descriptorReads = 0;
      let valueReads = 0;
      const hiddenKeys = Array.from({ length: 60_000 }, (_, i) => `hidden${i}`);
      const keys = [...hiddenKeys, "password"];
      const target = Object.create({
        toJSON() {
          return { password: secret };
        },
      }) as Log;
      target.password = secret;
      const foreign = new Proxy(target, {
        ownKeys: () => keys,
        getOwnPropertyDescriptor(inner, key) {
          descriptorReads++;
          return key === "password"
            ? Reflect.getOwnPropertyDescriptor(inner, key)
            : { configurable: true, enumerable: false, value: secret };
        },
        get(inner, key) {
          valueReads++;
          return Reflect.get(inner, key);
        },
      });
      const details = Object.fromEntries(
        Array.from({ length: 30 }, (_, i) => [`sibling${i}`, foreign]),
      );
      const error = wideError(details);

      const log = (
        mode === "allow" ? error.redactAllow([]) : error.redact(["password"])
      ).toLogObject();

      const observedReads = descriptorReads + valueReads;
      expectDiagnosis(log);
      // The input offers more descriptor work than the walker can consume.
      // This asserts bounded work without fixing its internal read allowance.
      expect(observedReads).toBeGreaterThan(0);
      expect(observedReads).toBeLessThan(hiddenKeys.length * 30);
      expect(log.details === details).toBe(false);
      const retained = log.details;
      if (retained !== null && typeof retained === "object") {
        for (const value of Object.values(retained)) {
          expect(value === foreign).toBe(false);
        }
      }
      expect(JSON.stringify(log)).not.toContain(secret);
    },
  );
});

describe("size cuts preserve redaction safeguards", () => {
  it("does not retain malformed decision objects under an empty allow-list", () => {
    const malformed = { password: secret };
    const cause = new BaseError("inner").redactWith(() => ({
      details: { ids: Array(120_000).fill(1) },
      name: "PolicyCause",
      message: "original cause",
      stack: "PolicyCause: original cause\n    at operation",
      code: malformed,
      category: malformed,
      retryable: malformed,
    }));
    const error = wideError({}, cause).redactAllow([]);

    const log = error.toLogObject();

    expectDiagnosis(log);
    expect(log.cause).toEqual(expect.any(Object));
    const retainedCause = log.cause as Log;
    for (const key of ["code", "category", "retryable"]) {
      expect(retainedCause[key] === malformed).toBe(false);
    }
    expect(JSON.stringify(log)).not.toContain(secret);
  });

  it("masks denied cause headers from one stack read after oversized data", () => {
    let stackReads = 0;
    const cause = new BaseError("inner").redactWith(() => ({
      details: { ids: Array(120_000).fill(1) },
      name: "PrivateCauseName",
      message: secret,
      get stack() {
        stackReads++;
        return stackReads === 1
          ? `PrivateCauseName: ${secret}\n    at operation`
          : `OtherName: ${secret}\n    at changedOperation`;
      },
    }));
    const error = wideError({}, cause).redact(["name", "message"]);

    const log = error.toLogObject();

    expect.soft(log.message).toBe("[REDACTED]");
    expect.soft(log.stack).toEqual(expect.any(String));
    expect(log.cause).toMatchObject({
      name: "[REDACTED]",
      message: "[REDACTED]",
      stack: "[REDACTED]: [REDACTED]\n    at operation",
    });
    expect(stackReads).toBe(1);
    expect(JSON.stringify(log)).not.toContain(secret);
    expect(JSON.stringify(log)).not.toContain("PrivateCauseName");
  });

  it("cuts an uninspected sibling cause after the first list consumes the read allowance", () => {
    let indexReads = 0;
    let siblingReads = 0;
    const first = new Proxy(Array(120_000).fill(null), {
      get(inner, key) {
        if (typeof key === "string" && /^\d+$/.test(key)) indexReads++;
        return Reflect.get(inner, key);
      },
    });
    const second = new Proxy(
      { name: "Error", message: secret, password: secret },
      {
        get(inner, key) {
          siblingReads++;
          return Reflect.get(inner, key);
        },
        ownKeys(inner) {
          siblingReads++;
          return Reflect.ownKeys(inner);
        },
        getOwnPropertyDescriptor(inner, key) {
          siblingReads++;
          return Reflect.getOwnPropertyDescriptor(inner, key);
        },
      },
    );
    const cause = new BaseError("inner").redactWith(() => ({
      name: "PolicyCause",
      message: "original cause",
      stack: "PolicyCause: original cause\n    at operation",
      errors: [first, second],
    }));
    const error = wideError({}, cause).redact(["password"]);

    const log = error.toLogObject();

    const observedIndexReads = indexReads;
    const observedSiblingReads = siblingReads;
    expectDiagnosis(log);
    expect(log.cause).toMatchObject({ errors: expect.any(Array) });
    const errors = (log.cause as { errors: unknown[] }).errors;
    expect(errors[errors.length - 1]).toBe("[Max redaction size exceeded]");
    expect(errors.some((value) => value === first || value === second)).toBe(
      false,
    );
    expect(observedIndexReads).toBeGreaterThan(0);
    expect(observedIndexReads).toBeLessThan(120_000);
    expect(observedSiblingReads).toBe(0);
    expect(JSON.stringify(log)).not.toContain(secret);
  });
});
