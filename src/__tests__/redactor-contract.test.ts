import { describe, expect, it } from "vitest";

import { BaseError, StructuredError } from "../index.js";

type Log = Record<string, unknown>;

function paymentFailure(): StructuredError<"PAYMENT_FAILED", "UPSTREAM"> {
  const error = new StructuredError({
    code: "PAYMENT_FAILED",
    category: "UPSTREAM",
    retryable: false,
    message: "private payment diagnosis",
    details: { token: "private-token" },
    cause: new Error("private cause"),
  });
  Object.defineProperties(error, {
    timestamp: { value: 0 },
    timestampIso: { value: "1970-01-01T00:00:00.000Z" },
  });
  return error;
}

const originalRootTriage: Log = {
  message: "[log redaction failed]",
  name: "PAYMENT_FAILED",
  code: "PAYMENT_FAILED",
  category: "UPSTREAM",
  retryable: false,
  timestamp: 0,
  timestampIso: "1970-01-01T00:00:00.000Z",
};

const originalCauseTriage: Log = {
  message: "[log redaction failed]",
  name: "PAYMENT_FAILED",
  code: "PAYMENT_FAILED",
  category: "UPSTREAM",
  retryable: false,
};

describe("trusted custom redactor results", () => {
  it("returns the replacement record by identity without restoring its envelope", () => {
    const replacement = Object.freeze({ delivered: "adapter-owned" });
    const error = paymentFailure().redactWith(() => replacement);

    const log = error.toLogObject();

    expect(log).toBe(replacement);
  });

  it("allows mutation of the supplied record", () => {
    let supplied: Log | undefined;
    const error = paymentFailure().redactWith((raw) => {
      supplied = raw;
      delete raw.code;
      raw.message = "reformatted";
      return raw;
    });

    const log = error.toLogObject();

    expect(log.message).toBe("reformatted");
    expect(log).toBe(supplied);
    expect(log).not.toHaveProperty("code");
  });

  it("leaves JSON safety of a successful result to the consumer", () => {
    const replacement: Log = { amount: 1n };
    replacement.self = replacement;
    const error = paymentFailure().redactWith(() => replacement);

    const log = error.toLogObject();

    expect(log.amount).toBe(1n);
    expect(log.self).toBe(replacement);
  });

  it("lets a custom policy replace an earlier built-in policy", () => {
    const error = paymentFailure()
      .redactAllow([])
      .redactWith((raw) => ({ details: raw.details }));

    const log = error.toLogObject();

    expect(log.details).toEqual({ token: "private-token" });
  });

  it("lets a built-in policy replace an earlier custom policy", () => {
    const error = paymentFailure()
      .redactWith(() => ({ custom: "unused" }))
      .redactAllow([]);

    const log = error.toLogObject();

    expect(log.details).toEqual({ token: "[REDACTED]" });
    expect(log).not.toHaveProperty("custom");
  });

  it("passes already transformed causes to the enclosing custom policy", () => {
    const leaf = new BaseError("leaf").redactWith(() => ({ stages: ["leaf"] }));
    const middle = new BaseError("middle", leaf).redactWith((raw) => ({
      stages: [...((raw.cause as Log).stages as string[]), "middle"],
    }));
    const outer = new BaseError("outer", middle).redactWith((raw) => ({
      stages: [...((raw.cause as Log).stages as string[]), "outer"],
    }));

    const log = outer.toLogObject();

    expect(log).toEqual({ stages: ["leaf", "middle", "outer"] });
  });

  it("lets an enclosing built-in policy mask a custom cause result", () => {
    const inner = new BaseError("inner").redactWith(() => ({
      token: "private-token",
    }));
    const outer = new BaseError("outer", inner).redactAllow([]);

    const log = outer.toLogObject();

    expect(log.cause).toEqual({ token: "[REDACTED]" });
  });
});

describe("custom redactor failure preserves the original safe envelope", () => {
  it("preserves all original safe fields after the callback overwrites them", () => {
    const error = paymentFailure().redactWith((raw) => {
      Object.assign(raw, {
        name: "FORGED",
        code: raw.message,
        category: "FORGED",
        retryable: true,
        timestamp: 99,
        timestampIso: "forged",
        additional: "private callback payload",
      });
      throw new Error("callback failed");
    });

    const log = error.toLogObject();

    expect(log).toEqual(originalRootTriage);
  });

  it("retains deleted fields despite an inherited replacement", () => {
    const error = paymentFailure().redactWith((raw) => {
      for (const key of Object.keys(raw)) delete raw[key];
      Object.setPrototypeOf(raw, { code: "INHERITED", retryable: true });
      throw new Error("callback failed");
    });

    const log = error.toLogObject();

    expect(log).toEqual(originalRootTriage);
  });

  it("ignores throwing getters installed over the captured fields", () => {
    const error = paymentFailure().redactWith((raw) => {
      for (const key of Object.keys(originalRootTriage)) {
        Object.defineProperty(raw, key, {
          get() {
            throw new Error("callback getter");
          },
        });
      }
      throw new Error("callback failed");
    });

    const log = error.toLogObject();

    expect(log).toEqual(originalRootTriage);
  });

  it("does not adopt valid-looking replacements for invalid original fields", () => {
    const error = new BaseError("private diagnosis");
    Object.defineProperties(error, {
      name: { value: 42 },
      code: { value: Infinity },
      category: { value: false },
      retryable: { value: "yes" },
      timestamp: { value: NaN },
      timestampIso: { value: 0 },
    });
    error.redactWith((raw) => {
      Object.assign(raw, {
        name: "FORGED",
        code: "FORGED",
        category: "FORGED",
        retryable: true,
        timestamp: 1,
        timestampIso: "forged",
      });
      throw new Error("callback failed");
    });

    const log = error.toLogObject();

    expect(log).toEqual({ message: "[log redaction failed]" });
  });

  it("retains a finite numeric code without substituting the callback's code", () => {
    class NumericFailure extends BaseError<"NumericFailure"> {
      readonly code = 0;
    }
    const error = new NumericFailure("private diagnosis").redactWith((raw) => {
      raw.code = 404;
      throw new Error("callback failed");
    });

    const log = error.toJSON();

    expect(log.code).toBe(0);
    expect(log.message).toBe("[log redaction failed]");
    expect(log).not.toHaveProperty("stack");
  });

  it("preserves the original cause decisions when its policy corrupts its input", () => {
    const inner = paymentFailure().redactWith((raw) => {
      raw.code = "FORGED";
      raw.retryable = true;
      throw new Error("callback failed");
    });
    const outer = new BaseError("outer diagnosis", inner);

    const log = outer.toLogObject();

    expect(log.cause).toEqual(originalCauseTriage);
    expect(log.message).toBe("outer diagnosis");
  });

  it("preserves an aggregate member's decisions after its policy deletes them", () => {
    const member = paymentFailure().redactWith((raw) => {
      delete raw.code;
      delete raw.retryable;
      throw new Error("callback failed");
    });
    const outer = new BaseError(
      "batch diagnosis",
      new AggregateError([member], "batch"),
    );

    const log = outer.toLogObject();

    expect((log.cause as Log).errors).toEqual([originalCauseTriage]);
  });

  it("preserves the diagnostic snapshot of an error nested in copied data", () => {
    const nested = paymentFailure().redactWith((raw) => {
      raw.code = "FORGED";
      raw.category = "FORGED";
      throw new Error("callback failed");
    });
    class RelatedFailure extends BaseError<"RelatedFailure"> {
      protected override buildOwnLogFields(): Log {
        return { context: { related: nested } };
      }
    }
    const error = new RelatedFailure("outer diagnosis");

    const log = error.toLogObject();

    expect((log.context as Log).related).toEqual(originalRootTriage);
  });
});

describe("consumer-owned custom redactor effects", () => {
  it("retains a mutation through the root details alias after the callback throws", () => {
    const error = paymentFailure();
    let suppliedDetails: unknown;
    error.redactWith((raw) => {
      suppliedDetails = raw.details;
      (raw.details as Log).token = "mutated-by-consumer";
      throw new Error("callback failed");
    });

    const log = error.toLogObject();

    expect(error.details?.token).toBe("mutated-by-consumer");
    expect(suppliedDetails).toBe(error.details);
    expect(log).not.toHaveProperty("details");
  });

  it("starts a complete independent build for a finite public callback reentry", () => {
    const error = paymentFailure();
    let reentered = false;
    error.redactWith((raw) => {
      if (reentered) return raw;
      reentered = true;
      return { nested: error.toLogObject() };
    });

    const log = error.toLogObject();

    expect(log.nested).toMatchObject({
      name: "PAYMENT_FAILED",
      code: "PAYMENT_FAILED",
      category: "UPSTREAM",
      retryable: false,
      message: "private payment diagnosis",
      stack: expect.any(String),
      details: { token: "private-token" },
      cause: { name: "Error", message: "private cause" },
      timestamp: 0,
      timestampIso: "1970-01-01T00:00:00.000Z",
    });
  });

  it.each([
    [
      "getter",
      {
        get payload(): never {
          throw new Error("consumer getter");
        },
      },
    ],
    [
      "toJSON",
      {
        toJSON(): never {
          throw new Error("consumer toJSON");
        },
      },
    ],
  ] as const)(
    "leaves a returned %s failure to later JSON serialization",
    (_, replacement) => {
      const error = paymentFailure().redactWith(() => replacement);

      const log = error.toLogObject();

      expect(log).toBe(replacement);
      expect(() => JSON.stringify(log)).toThrow();
    },
  );
});
