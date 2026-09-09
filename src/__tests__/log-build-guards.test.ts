import { describe, expect, it } from "vitest";
import { BaseError } from "../errors/BaseError.js";
import { StructuredError } from "../errors/StructuredError.js";

type Log = Record<string, unknown>;

class OwnFieldsError extends BaseError<"OwnFieldsError"> {
  constructor(private readonly fields: () => Log) {
    super("probe");
  }

  protected override buildOwnLogFields(): Log {
    return this.fields();
  }
}

describe("log build guards", () => {
  it("omits a throwing code getter installed by a failed redactor", () => {
    const error = new StructuredError({
      code: "PERMANENT",
      category: "VALIDATION",
      retryable: false,
      message: "SECRET",
    }).redactWith((raw) => {
      Object.defineProperty(raw, "code", {
        get() {
          throw new Error("unreadable");
        },
      });
      throw new Error("redactor failed");
    });

    const log = error.toLogObject();

    expect(log).toMatchObject({
      message: "[log redaction failed]",
      category: "VALIDATION",
      retryable: false,
    });
    expect(log).not.toHaveProperty("code");
    expect(JSON.stringify(log)).not.toContain("SECRET");
  });

  it("does not recover an inherited code installed by a failed redactor", () => {
    const error = new StructuredError({
      code: "PERMANENT",
      category: "VALIDATION",
      retryable: false,
      message: "SECRET",
    }).redactWith((raw) => {
      delete raw.code;
      Object.setPrototypeOf(raw, { code: "FORGED" });
      throw new Error("redactor failed");
    });

    const log = error.toLogObject();

    expect(log).toMatchObject({
      message: "[log redaction failed]",
      category: "VALIDATION",
      retryable: false,
    });
    expect(log).not.toHaveProperty("code");
    expect(JSON.stringify(log)).not.toContain("FORGED");
  });

  it.each([
    "name",
    "code",
    "category",
    "retryable",
    "timestamp",
    "timestampIso",
  ])(
    "does not recover a consumer container under %s when redaction fails",
    (key) => {
      const error = new BaseError("probe").redactAllow([]);
      Object.defineProperty(error, key, { value: { token: "SECRET" } });
      Object.defineProperty(error, "details", {
        value: {
          get value() {
            throw new Error("read failed");
          },
        },
      });

      const log = error.toLogObject();

      expect(log.message).toBe("[log redaction failed]");
      expect(log[key]).toBeUndefined();
      expect(JSON.stringify(log)).not.toContain("SECRET");
    },
  );

  it("does not re-enter a hook through a nested error", () => {
    let calls = 0;
    const error = new OwnFieldsError(() => {
      calls++;
      return { nested: { error }, retained: "value" };
    });

    const log = error.toJSON();

    expect(calls).toBe(1);
    expect(log.retained).toBe("value");
    expect(log.nested).toMatchObject({
      error: { name: "OwnFieldsError", message: "probe" },
    });
  });

  it("does not start another error's hook from a data value", () => {
    let calls = 0;
    const nested = new OwnFieldsError(() => {
      calls++;
      return { token: "SECRET" };
    });
    const error = new OwnFieldsError(() => ({ nested: [nested] }));

    const log = error.toLogObject();

    expect(calls).toBe(0);
    expect(log.nested).toMatchObject([
      { name: "OwnFieldsError", message: "probe" },
    ]);
  });

  it("does not inspect inherited keys to collect own fields", () => {
    let descriptors = 0;
    const inherited: Log = {};
    for (let index = 0; index < 5000; index++) inherited[`k${index}`] = index;
    const raw = new Proxy(Object.create(inherited) as Log, {
      getOwnPropertyDescriptor(target, key) {
        descriptors++;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });

    new OwnFieldsError(() => raw).toLogObject();

    expect(descriptors).toBeLessThanOrEqual(1000);
  });

  it("charges non-enumerable keys to the inspection bound", () => {
    let descriptors = 0;
    const target: Log = {};
    for (let index = 0; index < 5000; index++) {
      Object.defineProperty(target, `k${index}`, { value: index });
    }
    const raw = new Proxy(target, {
      getOwnPropertyDescriptor(object, key) {
        descriptors++;
        return Reflect.getOwnPropertyDescriptor(object, key);
      },
    });

    new OwnFieldsError(() => raw).toLogObject();

    expect(descriptors).toBeLessThanOrEqual(1000);
  });

  it("masks marker-shaped data in a scalar errors field", () => {
    const error = new BaseError("probe", {
      errors: "[4111111111111111 more aggregated errors]",
    }).redactAllow([]);

    const log = error.toLogObject();

    expect(log.cause).toEqual({ errors: "[REDACTED]" });
  });

  it("stops reading a data chain at the depth cap", () => {
    let reads = 0;
    let nested: Log = {};
    for (let index = 0; index < 300; index++) {
      const child = nested;
      nested = {
        get next() {
          reads++;
          return child;
        },
      };
    }
    const error = new OwnFieldsError(() => ({ payload: nested, retained: 1 }));

    const log = error.toLogObject();

    expect(reads).toBeLessThanOrEqual(100);
    expect(log.retained).toBe(1);
    expect(typeof log.payload).toBe("object");
  });

  it("keeps logging total when the realm constructor probe throws", () => {
    const error = new BaseError("probe");
    const previous = Object.getOwnPropertyDescriptor(
      BaseError,
      Symbol.hasInstance,
    );
    Object.defineProperty(BaseError, Symbol.hasInstance, {
      configurable: true,
      get() {
        throw new Error("brand probe");
      },
    });

    try {
      expect(() => error.toLogObject()).not.toThrow();
      expect(error.toLogObject().message).toBe("probe");
    } finally {
      if (previous)
        Object.defineProperty(BaseError, Symbol.hasInstance, previous);
      else Reflect.deleteProperty(BaseError, Symbol.hasInstance);
    }
  });
});
