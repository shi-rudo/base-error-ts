import { describe, it, expect } from "vitest";
import {
  detailsType,
  defineErrors,
  matchError,
  StructuredError,
  isStructuredError,
} from "../index.js";
import type { CatalogError } from "../index.js";

const AppErrors = defineErrors({
  USER_NOT_FOUND: {
    category: "NOT_FOUND",
    retryable: false,
    metadata: { httpStatus: 404, transport: { kind: "http" } },
    details: detailsType<{ userId: string }>(),
  },
  RATE_LIMITED: {
    category: "RATE_LIMIT",
    retryable: true,
    metadata: { httpStatus: 429 },
  },
});

type AppError = CatalogError<typeof AppErrors>;
const defineErrorsUnsafe = defineErrors as unknown as (
  catalog: unknown,
) => unknown;

describe("defineErrors", () => {
  it("builds a StructuredError with catalog metadata baked in", () => {
    const err = AppErrors.create.USER_NOT_FOUND(
      "user 123 missing in primary db",
      {
        details: { userId: "123" },
      },
    );

    expect(err).toBeInstanceOf(StructuredError);
    expect(isStructuredError(err)).toBe(true);
    expect(err.code).toBe("USER_NOT_FOUND");
    expect(err.category).toBe("NOT_FOUND");
    expect(err.retryable).toBe(false);
    expect(err.message).toBe("user 123 missing in primary db");
    expect(err.details).toEqual({ userId: "123" });
  });

  it("preserves a provided cause", () => {
    const cause = new Error("db down");
    const err = AppErrors.create.RATE_LIMITED("slow down", { cause });
    expect((err as unknown as { cause: unknown }).cause).toBe(cause);
  });

  it("exposes static metadata via meta()", () => {
    expect(AppErrors.meta("USER_NOT_FOUND").metadata.httpStatus).toBe(404);
    expect(AppErrors.meta("RATE_LIMITED").retryable).toBe(true);
  });

  it("allows codes that match catalog operation names", () => {
    const collisions = defineErrors({
      meta: { category: "X", retryable: false },
      create: { category: "X", retryable: false },
      is: { category: "X", retryable: false },
      ["__proto__"]: { category: "X", retryable: false },
    });

    expect(collisions.create.meta("meta").code).toBe("meta");
    expect(collisions.create.create("create").code).toBe("create");
    expect(collisions.create.is("is").code).toBe("is");
    const prototypeNamed = collisions.create.__proto__("prototype code");
    expect(prototypeNamed.code).toBe("__proto__");
    expect(collisions.meta("__proto__").category).toBe("X");
    expect(collisions.is(prototypeNamed, "__proto__")).toBe(true);
  });

  it("throws a clear error for an unknown code instead of returning undefined", () => {
    expect(() => AppErrors.meta("NOPE" as never)).toThrow(/unknown/i);
  });

  it("returns immutable metadata that cannot poison the catalog", () => {
    const row = AppErrors.meta("USER_NOT_FOUND");
    expect(() => {
      (row.metadata as { httpStatus?: number }).httpStatus = 999;
    }).toThrow(TypeError);
    expect(AppErrors.meta("USER_NOT_FOUND").metadata.httpStatus).toBe(404);
  });

  it("deep-freezes nested catalog metadata", () => {
    const row = AppErrors.meta("USER_NOT_FOUND");
    expect(() => {
      (row.metadata.transport as { kind: string }).kind = "mutated";
    }).toThrow(TypeError);
    expect(AppErrors.meta("USER_NOT_FOUND").metadata.transport).toEqual({
      kind: "http",
    });
  });

  it("resolves the boundary status from the catalog", () => {
    const err = AppErrors.create.USER_NOT_FOUND("x", {
      details: { userId: "1" },
    });
    const status = AppErrors.meta(err.code).metadata.httpStatus;
    expect(status).toBe(404);
  });

  it("produces a union that matchError handles exhaustively with narrowing", () => {
    const toStatus = (err: AppError) =>
      matchError(err, {
        USER_NOT_FOUND: (e) => ({ status: 404, user: e.details?.userId }),
        RATE_LIMITED: () => ({ status: 429, user: undefined }),
      });

    expect(
      toStatus(
        AppErrors.create.USER_NOT_FOUND("x", {
          details: { userId: "42" },
        }),
      ),
    ).toEqual({ status: 404, user: "42" });
    expect(toStatus(AppErrors.create.RATE_LIMITED("y"))).toEqual({
      status: 429,
      user: undefined,
    });
  });

  it("exposes the finite catalog codes", () => {
    expect(AppErrors.codes).toEqual(["USER_NOT_FOUND", "RATE_LIMITED"]);
  });

  it("rejects empty definitions", () => {
    expect(() => {
      // @ts-expect-error runtime defense for JavaScript and unsafe casts
      defineErrors({});
    }).toThrow(/must not be empty/);
  });

  it("rejects invalid catalog roots", () => {
    expect(() =>
      // @ts-expect-error runtime defense for JavaScript and unsafe casts
      defineErrors(null),
    ).toThrow(/catalog must be a plain object/);

    expect(() =>
      // @ts-expect-error runtime defense for JavaScript and unsafe casts
      defineErrors([{ category: "INTERNAL", retryable: false }]),
    ).toThrow(/catalog must be a plain object/);
  });

  it("rejects empty error codes", () => {
    expect(() =>
      // @ts-expect-error runtime defense for JavaScript and unsafe casts
      defineErrors({ "": { category: "INTERNAL", retryable: false } }),
    ).toThrow(/error codes must not be empty/);
  });

  it("rejects symbol codes at runtime", () => {
    expect(() => {
      // @ts-expect-error runtime defense for JavaScript and unsafe casts
      defineErrors({
        [Symbol("BROKEN")]: { category: "INTERNAL", retryable: false },
      });
    }).toThrow(/codes must be strings/);
  });

  it("rejects malformed definitions at runtime", () => {
    expect(() =>
      // @ts-expect-error runtime defense for JavaScript and unsafe casts
      defineErrors({
        BROKEN: { category: "", retryable: "no" },
      }),
    ).toThrow(/invalid definition/);
  });

  it("snapshots definitions and freezes every exposed catalog surface", () => {
    const definition: {
      FAILURE: {
        category: string;
        retryable: boolean;
        metadata: { httpStatus: number };
      };
    } = {
      FAILURE: {
        category: "INTERNAL",
        retryable: false,
        metadata: { httpStatus: 500 },
      },
    };
    const errors = defineErrors(definition);
    definition.FAILURE.category = "MUTATED";
    definition.FAILURE.retryable = true;
    definition.FAILURE.metadata.httpStatus = 200;

    const error = errors.create.FAILURE("failed");
    const meta = errors.meta("FAILURE");

    expect(error.category).toBe("INTERNAL");
    expect(error.retryable).toBe(false);
    expect(meta.metadata.httpStatus).toBe(500);
    expect(Object.isFrozen(errors)).toBe(true);
    expect(Object.isFrozen(errors.create)).toBe(true);
    expect(Object.isFrozen(errors.codes)).toBe(true);
    expect(Object.isFrozen(meta)).toBe(true);
  });

  it("recognizes errors created by this exact catalog", () => {
    const user = AppErrors.create.USER_NOT_FOUND("missing", {
      details: { userId: "123" },
    });
    const limited = AppErrors.create.RATE_LIMITED("slow down");

    expect(AppErrors.is(user)).toBe(true);
    expect(AppErrors.is(user, "USER_NOT_FOUND")).toBe(true);
    expect(AppErrors.is(user, "RATE_LIMITED")).toBe(false);
    expect(AppErrors.is(limited)).toBe(true);
  });

  it("rejects errors from another catalog even when their codes match", () => {
    const OtherErrors = defineErrors({
      USER_NOT_FOUND: { category: "NOT_FOUND", retryable: false },
    });
    const foreign = OtherErrors.create.USER_NOT_FOUND("missing");

    expect(AppErrors.is(foreign)).toBe(false);
  });

  it("rejects forged and reconstructed errors", () => {
    const forged = new StructuredError({
      code: "USER_NOT_FOUND",
      category: "NOT_FOUND",
      retryable: false,
      message: "forged",
      details: { userId: "123" },
    });
    const reconstructed = StructuredError.fromJSON(
      AppErrors.create
        .USER_NOT_FOUND("missing", {
          details: { userId: "123" },
        })
        .toJSON(),
    );

    expect(AppErrors.is(forged)).toBe(false);
    expect(AppErrors.is(reconstructed)).toBe(false);
    expect(AppErrors.is("USER_NOT_FOUND")).toBe(false);
  });

  it("fails closed when a generated error's identity fields are mutated", () => {
    const error = AppErrors.create.USER_NOT_FOUND("missing", {
      details: { userId: "123" },
    });
    (error as unknown as { code: string }).code = "RATE_LIMITED";

    expect(AppErrors.is(error)).toBe(false);
  });

  it("applies a catalog deny-list redaction policy to every generated error", () => {
    const SecureErrors = defineErrors({
      CREDENTIAL_FAILED: {
        category: "AUTH",
        retryable: false,
        details: detailsType<{ userId: string; password: string }>(),
        redaction: { mode: "deny", keys: ["password"] },
      },
    });
    const error = SecureErrors.create.CREDENTIAL_FAILED("login failed", {
      details: { userId: "u1", password: "secret" },
    });

    expect(error.toLogObject().details).toEqual({
      userId: "u1",
      password: "[REDACTED]",
    });
  });

  it("applies a catalog allow-list redaction policy", () => {
    const SecureErrors = defineErrors({
      PROFILE_FAILED: {
        category: "PROFILE",
        retryable: false,
        details: detailsType<{ userId: string; email: string }>(),
        redaction: { mode: "allow", keys: ["userId"] },
      },
    });
    const error = SecureErrors.create.PROFILE_FAILED("profile failed", {
      details: { userId: "u1", email: "private@example.com" },
    });

    expect(error.toLogObject().details).toEqual({
      userId: "u1",
      email: "[REDACTED]",
    });
  });

  it("rejects non-JSON catalog metadata at runtime", () => {
    expect(() =>
      // @ts-expect-error runtime defense for JavaScript and unsafe casts
      defineErrors({
        BROKEN: {
          category: "INTERNAL",
          retryable: false,
          metadata: { transform: () => "invalid" },
        },
      }),
    ).toThrow(/metadata must be JSON-safe/);
  });

  it("rejects a non-object metadata root at runtime", () => {
    expect(() =>
      // @ts-expect-error runtime defense for JavaScript and unsafe casts
      defineErrors({
        BROKEN: {
          category: "INTERNAL",
          retryable: false,
          metadata: ["invalid"],
        },
      }),
    ).toThrow(/metadata must be an object/);
  });

  it("rejects malformed catalog redaction policies", () => {
    expect(() =>
      // @ts-expect-error runtime defense for JavaScript and unsafe casts
      defineErrors({
        BROKEN: {
          category: "INTERNAL",
          retryable: false,
          redaction: { mode: "unknown", keys: ["secret"] },
        },
      }),
    ).toThrow(/invalid redaction policy/);
  });

  it("rejects unknown redaction policy fields at runtime", () => {
    expect(() =>
      // @ts-expect-error runtime defense for JavaScript and unsafe casts
      defineErrors({
        BROKEN: {
          category: "INTERNAL",
          retryable: false,
          redaction: { mode: "deny", keys: ["secret"], unexpected: true },
        },
      }),
    ).toThrow(/unknown redaction field/);
  });

  it("preserves prototype-named metadata as inert own data", () => {
    const metadata = JSON.parse('{"__proto__":{"polluted":true}}') as Record<
      string,
      { polluted: boolean }
    >;
    const errors = defineErrors({
      SAFE: { category: "INTERNAL", retryable: false, metadata },
    });
    const snapshot = errors.meta("SAFE").metadata;

    expect(Object.prototype.hasOwnProperty.call(snapshot, "__proto__")).toBe(
      true,
    );
    expect(snapshot.__proto__).toEqual({ polluted: true });
    expect(Object.getPrototypeOf(snapshot)).toBeNull();
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("rejects sparse metadata arrays as non-JSON-safe input", () => {
    const sparse: string[] = [];
    sparse.length = 1;

    expect(() =>
      defineErrors({
        BROKEN: {
          category: "INTERNAL",
          retryable: false,
          metadata: { sparse },
        },
      }),
    ).toThrow(/metadata must be JSON-safe/);
  });

  it("rejects unknown definition fields at runtime", () => {
    expect(() =>
      // @ts-expect-error runtime defense for v6 definitions and unsafe casts
      defineErrors({
        BROKEN: { category: "INTERNAL", retryable: false, httpStatus: 500 },
      }),
    ).toThrow(/unknown definition field/);
  });

  it("snapshots every supported JSON metadata value", () => {
    const items = [null, true, 42, "value", { nested: [false, 1] }] as const;
    const errors = defineErrors({
      COMPLETE: {
        category: "INTERNAL",
        retryable: false,
        metadata: { items },
      },
    });

    const metadata = errors.meta("COMPLETE").metadata;
    expect(metadata.items).toEqual(items);
    expect(Object.isFrozen(metadata.items)).toBe(true);
    expect(Object.isFrozen(metadata.items[4])).toBe(true);
    expect(Object.isFrozen(metadata.items[4].nested)).toBe(true);
  });

  it("rejects every unsupported metadata value at runtime", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const symbolProperty = { valid: true } as Record<PropertyKey, unknown>;
    symbolProperty[Symbol("hidden")] = true;

    const invalidValues: unknown[] = [
      undefined,
      1n,
      Symbol("value"),
      Number.NaN,
      Number.POSITIVE_INFINITY,
      new Date(),
      cyclic,
      symbolProperty,
    ];

    for (const value of invalidValues) {
      expect(() =>
        defineErrors({
          BROKEN: {
            category: "INTERNAL",
            retryable: false,
            metadata: { value } as never,
          },
        }),
      ).toThrow(/metadata must be JSON-safe/);
    }
  });

  it("fails closed when category or retryability is mutated", () => {
    const categoryChanged = AppErrors.create.RATE_LIMITED("limited");
    (categoryChanged as unknown as { category: string }).category = "OTHER";

    const retryabilityChanged = AppErrors.create.RATE_LIMITED("limited");
    (retryabilityChanged as unknown as { retryable: boolean }).retryable =
      false;

    expect(AppErrors.is(categoryChanged)).toBe(false);
    expect(AppErrors.is(retryabilityChanged)).toBe(false);
  });

  it("applies fixed and functional catalog redaction masks", () => {
    const FixedMaskErrors = defineErrors({
      SECRET: {
        category: "AUTH",
        retryable: false,
        details: detailsType<{ secret: string }>(),
        redaction: { mode: "deny", keys: ["secret"], mask: "***" },
      },
    });
    const FunctionalMaskErrors = defineErrors({
      SECRET: {
        category: "AUTH",
        retryable: false,
        details: detailsType<{ secret: string }>(),
        redaction: {
          mode: "deny",
          keys: ["secret"],
          mask: (value: unknown, key: string) =>
            `${key}:${String(value).length}`,
        },
      },
    });

    expect(
      FixedMaskErrors.create
        .SECRET("failed", {
          details: { secret: "token" },
        })
        .toLogObject().details,
    ).toEqual({ secret: "***" });
    expect(
      FunctionalMaskErrors.create
        .SECRET("failed", {
          details: { secret: "token" },
        })
        .toLogObject().details,
    ).toEqual({ secret: "secret:5" });
  });

  it("snapshots catalog redaction keys", () => {
    const keys = ["secret"];
    const redaction = { mode: "deny" as const, keys, mask: "***" };
    const errors = defineErrors({
      SECRET: {
        category: "AUTH",
        retryable: false,
        details: detailsType<{ secret: string; other: string }>(),
        redaction,
      },
    });
    keys[0] = "other";
    (redaction as { mode: string }).mode = "allow";
    redaction.mask = "changed";

    const log = errors.create
      .SECRET("failed", { details: { secret: "token", other: "visible" } })
      .toLogObject();
    expect(log.details).toEqual({ secret: "***", other: "visible" });
  });

  it("rejects every malformed redaction policy shape", () => {
    const invalidPolicies: unknown[] = [
      null,
      "deny",
      { mode: "deny", keys: "secret" },
      { mode: "deny", keys: ["secret", 1] },
      { mode: "deny", keys: ["secret"], mask: 42 },
    ];

    for (const redaction of invalidPolicies) {
      expect(() =>
        defineErrorsUnsafe({
          BROKEN: {
            category: "INTERNAL",
            retryable: false,
            redaction: redaction as never,
          },
        }),
      ).toThrow(/invalid redaction policy/);
    }
  });

  it("rejects symbol fields in definitions and redaction policies", () => {
    expect(() =>
      defineErrorsUnsafe({
        BROKEN: {
          category: "INTERNAL",
          retryable: false,
          [Symbol("field")]: true,
        } as never,
      }),
    ).toThrow(/unknown definition field/);

    expect(() =>
      defineErrorsUnsafe({
        BROKEN: {
          category: "INTERNAL",
          retryable: false,
          redaction: {
            mode: "deny",
            keys: ["secret"],
            [Symbol("field")]: true,
          } as never,
        },
      }),
    ).toThrow(/unknown redaction field/);
  });

  it("accepts a null-prototype definition safely", () => {
    const definition = Object.assign(Object.create(null), {
      SAFE: { category: "INTERNAL", retryable: false },
    }) as {
      SAFE: { category: string; retryable: boolean };
    };
    const errors = defineErrors(definition);

    expect(errors.create.SAFE("safe").code).toBe("SAFE");
  });

  it("returns a frozen compile-time details marker", () => {
    const marker = detailsType<{ value: string }>();
    expect(marker).toEqual({});
    expect(Object.isFrozen(marker)).toBe(true);
  });
});
