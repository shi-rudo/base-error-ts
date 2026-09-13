import { describe, expect, it } from "vitest";
import { BaseError } from "../index.js";

type Mode = "allow" | "deny";
type Log = Record<string, unknown>;
const sizeCut = "[Max redaction size exceeded]";
const secret = "private-hidden-envelope-value";

function hiddenEnvelope(prefix: Log = {}, count = 100_010) {
  let descriptorReads = 0;
  let hiddenGetterCalls = 0;
  const target = { ...prefix };
  for (let index = 0; index < count; index++) {
    Object.defineProperty(target, `hidden${index}`, {
      enumerable: false,
      get() {
        hiddenGetterCalls++;
        return secret;
      },
    });
  }
  const value = new Proxy(target, {
    getOwnPropertyDescriptor(inner, key) {
      descriptorReads++;
      return Reflect.getOwnPropertyDescriptor(inner, key);
    },
  });
  return {
    target,
    value,
    counts: () => ({ descriptorReads, hiddenGetterCalls }),
  };
}

function outerError(policyOutput: Log, mode: Mode) {
  class OuterError extends BaseError<"OuterError"> {
    readonly code = 0;
    readonly category = "PERMANENT";
    readonly retryable = false;
  }
  const inner = new BaseError("inner").redactWith(() => policyOutput);
  const outer = new OuterError("outer", inner);
  return mode === "allow" ? outer.redactAllow([]) : outer.redact([]);
}

function expectRootDiagnosis(log: Log, outer: BaseError<string>) {
  expect.soft(log).toMatchObject({
    name: "OuterError",
    message: "outer",
    code: 0,
    category: "PERMANENT",
    retryable: false,
    timestamp: outer.timestamp,
    timestampIso: outer.timestampIso,
  });
  expect.soft(log.stack).toEqual(expect.any(String));
}

describe.each<Mode>(["allow", "deny"])(
  "%s redaction distinguishes an empty cause from an inspection cut",
  (mode) => {
    it("marks a plain cause when hidden descriptors exhaust inspection", () => {
      const envelope = hiddenEnvelope();
      const outer = outerError(envelope.target, mode);

      const log = outer.toLogObject();

      const observed = envelope.counts();
      expectRootDiagnosis(log, outer);
      expect.soft(observed.hiddenGetterCalls).toBe(0);
      expect.soft(log.cause === envelope.target).toBe(false);
      expect.soft(JSON.stringify(log)).not.toContain(secret);
      expect(log.cause).toBe(sizeCut);
    });

    it("bounds descriptor work while marking an uninspected cause", () => {
      const envelope = hiddenEnvelope();
      const outer = outerError(envelope.value, mode);

      const log = outer.toLogObject();

      const observed = envelope.counts();
      expectRootDiagnosis(log, outer);
      expect.soft(observed.descriptorReads).toBeGreaterThan(0);
      expect.soft(observed.descriptorReads).toBeLessThanOrEqual(100_000);
      expect.soft(observed.hiddenGetterCalls).toBe(0);
      expect.soft(log.cause === envelope.value).toBe(false);
      expect.soft(JSON.stringify(log)).not.toContain(secret);
      expect(log.cause).toBe(sizeCut);
    });

    it("keeps a genuinely empty fully inspected cause empty", () => {
      const envelope = {};
      const outer = outerError(envelope, mode);

      const log = outer.toLogObject();

      expectRootDiagnosis(log, outer);
      expect(log.cause).toEqual({});
      expect(log.cause === envelope).toBe(false);
    });

    it("keeps a fully inspected hidden-only cause empty without calling getters", () => {
      const envelope = hiddenEnvelope({}, 3);
      const outer = outerError(envelope.value, mode);

      const log = outer.toLogObject();

      const observed = envelope.counts();
      expectRootDiagnosis(log, outer);
      expect(observed.hiddenGetterCalls).toBe(0);
      expect(log.cause).toEqual({});
      expect(log.cause === envelope.value).toBe(false);
    });

    it("preserves inspected falsy decision fields before hidden inspection runs out", () => {
      const envelope = hiddenEnvelope({ code: 0, retryable: false });
      const outer = outerError(envelope.value, mode);

      const log = outer.toLogObject();

      const observed = envelope.counts();
      expectRootDiagnosis(log, outer);
      expect(observed.descriptorReads).toBeGreaterThan(0);
      expect(observed.descriptorReads).toBeLessThanOrEqual(100_000);
      expect(observed.hiddenGetterCalls).toBe(0);
      expect(log.cause === envelope.value).toBe(false);
      expect(log.cause).toMatchObject({ code: 0, retryable: false });
      expect(JSON.stringify(log)).not.toContain(secret);
    });

    it("marks an exhausted cause when its inspected function field is discarded", () => {
      const envelope = hiddenEnvelope({ message: () => secret });
      const outer = outerError(envelope.value, mode);

      const log = outer.toLogObject();

      const observed = envelope.counts();
      expectRootDiagnosis(log, outer);
      expect.soft(observed.descriptorReads).toBeGreaterThan(0);
      expect.soft(observed.descriptorReads).toBeLessThanOrEqual(100_000);
      expect.soft(observed.hiddenGetterCalls).toBe(0);
      expect.soft(log.cause === envelope.value).toBe(false);
      expect.soft(JSON.stringify(log)).not.toContain(secret);
      expect(log.cause).toBe(sizeCut);
    });
  },
);
