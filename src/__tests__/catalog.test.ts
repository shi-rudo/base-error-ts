import { describe, it, expect } from "vitest";
import { hostileProxy, revokedProxy } from "./hostile-values.fixture.js";
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

  it("rejects empty keys", () => {
    expect(() =>
      // @ts-expect-error runtime defense for JavaScript and unsafe casts
      defineErrors({ "": { category: "INTERNAL", retryable: false } }),
    ).toThrow(/keys must not be empty/);
  });

  it("rejects symbol keys at runtime", () => {
    expect(() => {
      // @ts-expect-error runtime defense for JavaScript and unsafe casts
      defineErrors({
        [Symbol("BROKEN")]: { category: "INTERNAL", retryable: false },
      });
    }).toThrow(/keys must be strings/);
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

  it("lets a per-instance redact replace the catalog policy instead of adding to it", () => {
    const SecureErrors = defineErrors({
      PROFILE_FAILED: {
        category: "PROFILE",
        retryable: false,
        details: detailsType<{ userId: string; email: string; iban: string }>(),
        redaction: { mode: "allow", keys: ["userId"] },
      },
    });

    const error = SecureErrors.create
      .PROFILE_FAILED("profile failed", {
        details: { userId: "u1", email: "private@example.com", iban: "DE89" },
      })
      .redact(["email"]);

    expect(error.toLogObject().details).toEqual({
      userId: "u1",
      email: "[REDACTED]",
      iban: "DE89",
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

  it("skips an undefined metadata property, as JSON.stringify does", () => {
    const metadata: { httpStatus: number; docsUrl?: string } = {
      httpStatus: 404,
      docsUrl: undefined,
    };

    const errors = defineErrors({
      NOT_FOUND: { category: "NOT_FOUND", retryable: false, metadata },
    });

    expect(errors.meta("NOT_FOUND").metadata).toEqual({ httpStatus: 404 });
    expect(Object.keys(errors.meta("NOT_FOUND").metadata)).toEqual([
      "httpStatus",
    ]);
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
    class RewritingList extends Array<number> {
      toJSON(): string {
        return "rewritten";
      }
    }

    const invalidValues: unknown[] = [
      1n,
      Symbol("value"),
      Number.NaN,
      Number.POSITIVE_INFINITY,
      new Date(),
      cyclic,
      symbolProperty,
      RewritingList.from([1]),
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

const AuthzErrors = defineErrors(
  {
    not_a_member: { category: "FORBIDDEN", retryable: false },
    missing_role: {
      category: "FORBIDDEN",
      retryable: false,
      metadata: { httpStatus: 403 },
      details: detailsType<{ role: string }>(),
      redaction: { mode: "deny", keys: ["role"] },
    },
  },
  { prefix: "restaurant.authz" },
);

type AuthzError = CatalogError<typeof AuthzErrors>;

describe("defineErrors with a prefix", () => {
  it("derives the code of each definition from the prefix and the key", () => {
    const cause = new Error("membership lookup failed");

    const error = AuthzErrors.create.missing_role("actor 42 lacks a role", {
      details: { role: "owner" },
      cause,
    });

    expect(error).toBeInstanceOf(StructuredError);
    expect(error.code).toBe("restaurant.authz.missing_role");
    expect(error.name).toBe("restaurant.authz.missing_role");
    expect(error.category).toBe("FORBIDDEN");
    expect(error.retryable).toBe(false);
    expect(error.message).toBe("actor 42 lacks a role");
    expect(error.details).toEqual({ role: "owner" });
    expect((error as unknown as { cause: unknown }).cause).toBe(cause);
    expect(JSON.stringify(error.toLogObject())).not.toContain("owner");
  });

  it("maps each key to its code in a frozen namespace", () => {
    expect(AuthzErrors.code.not_a_member).toBe("restaurant.authz.not_a_member");
    expect(AuthzErrors.code.missing_role).toBe("restaurant.authz.missing_role");
    expect(Object.isFrozen(AuthzErrors.code)).toBe(true);
    expect(Object.getPrototypeOf(AuthzErrors.code)).toBeNull();
  });

  it("lists the derived codes in key order", () => {
    expect(AuthzErrors.codes).toEqual([
      "restaurant.authz.not_a_member",
      "restaurant.authz.missing_role",
    ]);
  });

  it("looks up the static facts of a definition by its code", () => {
    const error = AuthzErrors.create.missing_role("actor 42 lacks a role", {
      details: { role: "owner" },
    });

    expect(AuthzErrors.meta(error.code)).toEqual({
      category: "FORBIDDEN",
      retryable: false,
      metadata: { httpStatus: 403 },
    });
    expect(() => AuthzErrors.meta("missing_role" as never)).toThrow(
      'meta: unknown error code "missing_role"',
    );
  });

  it("recognizes one definition by its key", () => {
    const error = AuthzErrors.create.not_a_member("actor 42 is not a member");

    expect(AuthzErrors.is(error)).toBe(true);
    expect(AuthzErrors.is(error, "not_a_member")).toBe(true);
    expect(AuthzErrors.is(error, "missing_role")).toBe(false);
    expect(
      AuthzErrors.is(error, "restaurant.authz.not_a_member" as never),
    ).toBe(false);
  });

  it("rejects a lookalike that carries the derived code", () => {
    const forged = new StructuredError({
      code: "restaurant.authz.not_a_member",
      category: "FORBIDDEN",
      retryable: false,
      message: "forged",
    });

    expect(AuthzErrors.is(forged)).toBe(false);
    expect(AuthzErrors.is(forged, "not_a_member")).toBe(false);
  });

  it("fails closed when a generated error loses its derived code", () => {
    const error = AuthzErrors.create.not_a_member("actor 42 is not a member");
    (error as unknown as { code: string }).code = "not_a_member";

    expect(AuthzErrors.is(error)).toBe(false);
  });

  it("keeps the key as the code without a prefix", () => {
    const definition = { FAILURE: { category: "INTERNAL", retryable: false } };

    const withEmptyOptions = defineErrors(definition, {});
    const withUndefinedPrefix = defineErrors(definition, {
      prefix: undefined,
    });

    expect(withEmptyOptions.create.FAILURE("failed").code).toBe("FAILURE");
    expect(withEmptyOptions.code.FAILURE).toBe("FAILURE");
    expect(withUndefinedPrefix.codes).toEqual(["FAILURE"]);
    expect(AppErrors.code.USER_NOT_FOUND).toBe("USER_NOT_FOUND");
  });

  it("derives the code of a key that matches an Object.prototype member", () => {
    const collisions = defineErrors(
      {
        ["__proto__"]: { category: "X", retryable: false },
        toString: { category: "X", retryable: false },
      },
      { prefix: "p" },
    );

    const prototypeNamed = collisions.create.__proto__("prototype key");

    expect(prototypeNamed.code).toBe("p.__proto__");
    expect(collisions.code.__proto__).toBe("p.__proto__");
    expect(collisions.code.toString).toBe("p.toString");
    expect(collisions.meta("p.__proto__").category).toBe("X");
    expect(collisions.is(prototypeNamed, "__proto__")).toBe(true);
  });

  it("rejects a key with a dot when a prefix is set", () => {
    for (const key of ["storage.not_found", ".x", "x."]) {
      expect(() =>
        defineErrors({ [key]: { category: "X", retryable: false } }, {
          prefix: "restaurant",
        } as never),
      ).toThrow(
        `defineErrors: key "${key}" contains "."; with a prefix, the prefix holds every segment before the key`,
      );
    }
  });

  it("keeps a dotted key as the code without a prefix", () => {
    const DbErrors = defineErrors({
      "db.deadlock": { category: "DEADLOCK", retryable: true },
    });

    expect(DbErrors.create["db.deadlock"]("deadlock").code).toBe("db.deadlock");
  });

  it("rejects an invalid prefix at runtime", () => {
    const definition = { FAILURE: { category: "INTERNAL", retryable: false } };
    const invalidPrefixes: unknown[] = [
      "",
      ".restaurant",
      "restaurant.",
      "restaurant..authz",
      42,
      null,
    ];

    for (const prefix of invalidPrefixes) {
      expect(() =>
        defineErrors(definition, { prefix: prefix as never }),
      ).toThrow(/defineErrors: invalid prefix/);
    }
  });

  it("names the rejected prefix and the expected form", () => {
    expect(() =>
      defineErrors(
        { FAILURE: { category: "INTERNAL", retryable: false } },
        { prefix: "restaurant." as never },
      ),
    ).toThrow(
      'defineErrors: invalid prefix "restaurant."; expected a non-empty string without a leading, trailing or doubled "."',
    );
  });

  it("rejects options that are no plain object at runtime", () => {
    const definition = { FAILURE: { category: "INTERNAL", retryable: false } };

    for (const options of [
      "restaurant",
      null,
      ["restaurant"],
      42,
      new Date(0),
    ]) {
      expect(() => defineErrors(definition, options as never)).toThrow(
        "defineErrors: options must be a plain object",
      );
    }
  });

  it("accepts null-prototype options", () => {
    const options = Object.assign(Object.create(null), {
      prefix: "restaurant.authz",
    }) as { prefix: "restaurant.authz" };

    const errors = defineErrors(
      { not_a_member: { category: "FORBIDDEN", retryable: false } },
      options,
    );

    expect(errors.codes).toEqual(["restaurant.authz.not_a_member"]);
  });

  it("rejects unknown and symbol options at runtime", () => {
    const definition = { FAILURE: { category: "INTERNAL", retryable: false } };

    expect(() =>
      defineErrors(definition, { prefx: "restaurant" } as never),
    ).toThrow('defineErrors: unknown option "prefx"');
    expect(() =>
      defineErrors(definition, { [Symbol("prefix")]: "restaurant" } as never),
    ).toThrow('defineErrors: unknown option "Symbol(prefix)"');
  });
});

describe("Catalog.match", () => {
  it("calls the handler of the key, with the error of that key", () => {
    const describeError = (error: AuthzError) =>
      AuthzErrors.match(error, {
        not_a_member: (e) => `not a member: ${e.code}`,
        missing_role: (e) => `missing role: ${e.details?.role}`,
      });

    expect(
      describeError(AuthzErrors.create.not_a_member("actor 42 is no member")),
    ).toBe("not a member: restaurant.authz.not_a_member");
    expect(
      describeError(
        AuthzErrors.create.missing_role("actor 42 lacks a role", {
          details: { role: "owner" },
        }),
      ),
    ).toBe("missing role: owner");
  });

  it("calls the catch-all for a key without a handler", () => {
    const error = AuthzErrors.create.not_a_member("actor 42 is no member");

    const result = AuthzErrors.match(error as AuthzError, {
      missing_role: () => "missing role",
      _: (e) => `caught ${e.code}`,
    });

    expect(result).toBe("caught restaurant.authz.not_a_member");
  });

  it("calls the catch-all for a code outside the catalog", () => {
    const foreign = AppErrors.create.RATE_LIMITED("slow down");

    const result = AuthzErrors.match(foreign as unknown as AuthzError, {
      not_a_member: () => "not a member",
      _: (e) => `caught ${e.code}`,
    });

    expect(result).toBe("caught RATE_LIMITED");
  });

  it("never routes a key to an inherited Object.prototype member", () => {
    const Collisions = defineErrors(
      {
        toString: { category: "X", retryable: false },
        other: { category: "X", retryable: false },
      },
      { prefix: "p" },
    );
    const error = Collisions.create.toString("prototype-named key");

    const result = Collisions.match(error as CatalogError<typeof Collisions>, {
      other: () => "other",
      _: () => "catch-all",
    });

    expect(result).toBe("catch-all");
  });

  it("throws with the key and the code when no handler matches", () => {
    const error = AuthzErrors.create.not_a_member("actor 42 is no member");
    const casesWithoutCatchAll = { missing_role: () => "missing role" };

    expect(() =>
      AuthzErrors.match(error as AuthzError, casesWithoutCatchAll as never),
    ).toThrow(
      'match: no case for key "not_a_member" of error code "restaurant.authz.not_a_member", and no "_" catch-all',
    );
  });

  it("throws with the code when a code outside the catalog has no catch-all", () => {
    const foreign = AppErrors.create.RATE_LIMITED("slow down");

    expect(() =>
      AuthzErrors.match(foreign as unknown as AuthzError, {
        not_a_member: () => "not a member",
        missing_role: () => "missing role",
      }),
    ).toThrow(
      'match: error code "RATE_LIMITED" is not defined in this catalog, and no "_" catch-all',
    );
  });

  it("refuses to match in a catalog that defines the key _", () => {
    const Underscore = defineErrors({
      _: { category: "C", retryable: false },
      z: { category: "D", retryable: false },
    });
    const error = Underscore.create.z("z failed");

    expect(() =>
      Underscore.match(error as never, { _: () => "catch-all" } as never),
    ).toThrow(
      'match: the key "_" of this catalog is also the catch-all; rename the key, or use matchError',
    );
  });

  it("dispatches on the code itself in a catalog without a prefix", () => {
    const error = AppErrors.create.USER_NOT_FOUND("user 42 missing", {
      details: { userId: "42" },
    });

    const result = AppErrors.match(error as AppError, {
      USER_NOT_FOUND: (e) => e.details?.userId,
      RATE_LIMITED: () => undefined,
    });

    expect(result).toBe("42");
  });
});

describe("Catalog.is against a value that cannot be inspected", () => {
  it("returns false for a revoked Proxy instead of throwing", () => {
    expect(AppErrors.is(revokedProxy())).toBe(false);
    expect(AppErrors.is(revokedProxy(), "USER_NOT_FOUND")).toBe(false);
  });

  it("returns false for a Proxy whose getPrototypeOf trap throws", () => {
    expect(AppErrors.is(hostileProxy(["getPrototypeOf"]))).toBe(false);
  });
});
