import { describe, expect, it } from "vitest";
import { BaseError, StructuredError } from "../index.js";
import { MAX_LOG_NODES } from "../errors/walker-bounds.js";

class NumberFieldsError extends BaseError<string> {
  constructor(private readonly value: number) {
    super("numbers");
  }

  protected override buildOwnLogFields() {
    return {
      direct: this.value,
      nested: { value: this.value },
      array: [this.value],
    };
  }
}

const cases = [
  { label: "NaN", value: NaN, expected: null },
  { label: "positive infinity", value: Infinity, expected: null },
  { label: "negative infinity", value: -Infinity, expected: null },
  { label: "negative zero", value: -0, expected: 0 },
  { label: "zero", value: 0, expected: 0 },
  { label: "finite fraction", value: -1.25, expected: -1.25 },
];

describe("numbers in copied log values", () => {
  it.each(cases)(
    "normalizes $label in own fields at every depth",
    ({ value, expected }) => {
      const error = new NumberFieldsError(value);

      const log = error.toLogObject();

      expect(log.direct).toBe(expected);
      expect(log.nested).toEqual({ value: expected });
      expect(log.array).toEqual([expected]);
    },
  );

  it.each(cases)(
    "normalizes $label on a native cause",
    ({ value, expected }) => {
      const cause = Object.assign(new Error("cause"), {
        code: value,
        retryable: false,
        details: { value, nested: { value }, array: [value] },
      });

      const log = new BaseError("outer", cause).toLogObject();

      expect(log.cause).toMatchObject({
        code: expected,
        retryable: false,
        details: {
          value: expected,
          nested: { value: expected },
          array: [expected],
        },
      });
    },
  );

  it.each(cases)(
    "normalizes $label on a plain cause",
    ({ value, expected }) => {
      const cause = { code: value, retryable: false, details: { value } };

      const log = new BaseError("outer", cause).toJSON();

      expect(log.cause).toEqual({
        code: expected,
        retryable: false,
        details: { value: expected },
      });
    },
  );

  it.each(cases)(
    "normalizes $label returned by a conversion",
    ({ value, expected }) => {
      const cause = {
        boxed: Object(value),
        converted: { toJSON: () => value },
      };

      const log = new BaseError("outer", cause).toLogObject();

      expect(log.cause).toEqual({ boxed: expected, converted: expected });
    },
  );

  it.each(cases)(
    "normalizes $label in a root envelope after budget exhaustion",
    ({ value, expected }) => {
      const error = Object.assign(
        new BaseError("outer", new Array(MAX_LOG_NODES).fill(1)),
        {
          code: value,
          retryable: false,
        },
      );

      const log = error.toLogObject();

      expect(log.cause).toBe("[Max log size exceeded]");
      expect(log.code).toBe(expected);
      expect(log.retryable).toBe(false);
    },
  );

  it.each(cases)(
    "normalizes $label in a cause envelope after budget exhaustion",
    ({ value, expected }) => {
      const cause = Object.assign(new Error("cause"), {
        stack: new Array(MAX_LOG_NODES).fill(1),
        code: value,
        retryable: false,
      });

      const log = new BaseError("outer", cause).toLogObject();

      expect(log.cause).toMatchObject({ code: expected, retryable: false });
      expect(log.cause).toHaveProperty("stack", "[Max log size exceeded]");
    },
  );

  it("masks normalized consumer numbers under an empty allow-list", () => {
    const error = new NumberFieldsError(NaN).redactAllow([]);

    const log = error.toLogObject();

    expect(log.direct).toBe("[REDACTED]");
    expect(log.nested).toEqual({ value: "[REDACTED]" });
    expect(log.array).toEqual(["[REDACTED]"]);
  });

  it("retains the separate raw root-details contract", () => {
    const details = { value: NaN, zero: -0 };
    const error = new StructuredError({
      code: "NUMBERS",
      category: "TEST",
      retryable: false,
      message: "numbers",
      details,
    });

    const log = error.toLogObject();

    expect(log.details).toBe(details);
    expect(details.value).toBeNaN();
    expect(details.zero).toBe(-0);
  });
});
