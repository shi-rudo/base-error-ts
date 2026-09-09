import { describe, expect, it } from "vitest";
import { BaseError } from "../errors/BaseError.js";

type Log = Record<string, unknown>;

class OwnFieldsError extends BaseError<"OwnFieldsError"> {
  constructor(private readonly fields: () => Log) {
    super("probe");
  }

  protected override buildOwnLogFields(): Log {
    return this.fields();
  }
}

class CustomLogError extends BaseError<"CustomLogError"> {
  constructor(private readonly log: Log) {
    super("probe");
  }

  protected override buildLogObject(): Log {
    return this.log;
  }

  protected override buildOwnLogFields(): Log {
    return { own: 1 };
  }
}

describe("log build guards", () => {
  it("does not recover inherited fields when redaction fails", () => {
    const raw = Object.create({ code: { token: "SECRET" } }) as Log;
    Object.defineProperty(raw, "hostile", {
      enumerable: true,
      get() {
        throw new Error("read failed");
      },
    });
    const error = new CustomLogError(raw).redactAllow([]);

    const log = error.toLogObject();

    expect(log.code).toBeUndefined();
    expect(JSON.stringify(log)).not.toContain("SECRET");
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
      const error = new CustomLogError({
        [key]: { token: "SECRET" },
        hostile: {
          get value() {
            throw new Error("read failed");
          },
        },
      }).redactAllow([]);

      const log = error.toLogObject();

      expect(log.message).toBe("[log redaction failed]");
      expect(log[key]).toBeUndefined();
      expect(JSON.stringify(log)).not.toContain("SECRET");
    },
  );

  it("does not invoke a foreign setter while adding own fields", () => {
    const pair = Proxy.revocable(
      { message: "retained" },
      {
        set() {
          pair.revoke();
          return true;
        },
      },
    );
    const error = new CustomLogError(pair.proxy);

    expect(() => JSON.stringify(error)).not.toThrow();
    expect(error.toLogObject()).toMatchObject({ message: "retained", own: 1 });
  });

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

  it("bounds copying a frozen custom log while retaining its envelope", () => {
    let reads = 0;
    const raw: Log = {};
    for (let index = 0; index < 5000; index++) {
      Object.defineProperty(raw, `k${index}`, {
        enumerable: true,
        get() {
          reads++;
          return index;
        },
      });
    }
    raw.message = "retained";
    Object.freeze(raw);

    const log = new CustomLogError(raw).toLogObject();

    expect(reads).toBeLessThanOrEqual(1000);
    expect(log.message).toBe("retained");
    expect(log.own).toBe(1);
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

  it("bounds the record-shape probe of a custom log", () => {
    let descriptors = 0;
    const target = Object.create({}) as Log;
    for (let index = 0; index < 5000; index++) {
      Object.defineProperty(target, `k${index}`, { value: index });
    }
    const raw = new Proxy(target, {
      getOwnPropertyDescriptor(object, key) {
        descriptors++;
        return Reflect.getOwnPropertyDescriptor(object, key);
      },
    });

    const log = new CustomLogError(raw).toLogObject();

    expect(descriptors).toBeLessThanOrEqual(1000);
    expect(log.message).toBe("probe");
  });

  it("keeps the base envelope when no custom field is readable", () => {
    const raw = new Proxy({} as Log, {
      get() {
        throw new Error("unreadable");
      },
      ownKeys() {
        throw new Error("unreadable");
      },
    });

    const log = new CustomLogError(raw).toLogObject();

    expect(log.message).toBe("probe");
    expect(log.name).toBe("CustomLogError");
    expect(log.own).toBe(1);
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
