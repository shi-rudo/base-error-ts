import { describe, expect, it } from "vitest";

import { StructuredError, defineErrors, detailsType } from "../index.js";

import {
  asyncSchema,
  schemaFrom,
  throwingSchema,
} from "./standard-schema.fixture.js";

type User = { userId: string; email: string };

function parseUser(value: unknown): User | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { userId, email } = value as Record<string, unknown>;
  return typeof userId === "string" && typeof email === "string"
    ? { userId, email }
    : undefined;
}

const AppErrors = defineErrors({
  USER_NOT_FOUND: {
    category: "NOT_FOUND",
    retryable: false,
    details: schemaFrom(parseUser),
    redaction: { mode: "deny", keys: ["email"] },
  },
  RATE_LIMITED: { category: "RATE_LIMIT", retryable: true },
  CONFLICT: {
    category: "CONFLICT",
    retryable: false,
    details: detailsType<{ resource: string }>(),
  },
});

const STACK = "USER_NOT_FOUND: user 7 missing\n    at worker (job.ts:12:5)";

/** The serialized form of a USER_NOT_FOUND error of a worker. */
function userNotFoundPayload(fields: Record<string, unknown> = {}): unknown {
  return {
    name: "USER_NOT_FOUND",
    message: "user 7 missing",
    timestamp: 1_700_000_000_000,
    stack: STACK,
    code: "USER_NOT_FOUND",
    category: "NOT_FOUND",
    retryable: false,
    details: { userId: "7", email: "ada@example.com" },
    cause: { name: "Error", message: "db timeout" },
    ...fields,
  };
}

describe("Catalog.fromJSON restores an error of the catalog", () => {
  it("restores the code, the message, the details, the stack, the time and the cause", () => {
    const revived = AppErrors.fromJSON(userNotFoundPayload());

    expect(revived).toBeInstanceOf(StructuredError);
    expect(revived?.code).toBe("USER_NOT_FOUND");
    expect(revived?.message).toBe("user 7 missing");
    expect(revived?.details).toEqual({ userId: "7", email: "ada@example.com" });
    expect(revived?.stack).toBe(STACK);
    expect(revived?.timestamp).toBe(1_700_000_000_000);
    expect((revived as unknown as { cause: Error }).cause.message).toBe(
      "db timeout",
    );
  });

  it("passes the guard of its catalog and of its key", () => {
    const revived = AppErrors.fromJSON(userNotFoundPayload());

    expect(AppErrors.is(revived)).toBe(true);
    expect(AppErrors.is(revived, "USER_NOT_FOUND")).toBe(true);
    expect(AppErrors.is(revived, "RATE_LIMITED")).toBe(false);
  });

  it("takes the category and the retryable flag from the definition, not from the payload", () => {
    const revived = AppErrors.fromJSON({
      code: "RATE_LIMITED",
      category: "FORGED",
      retryable: false,
      message: "slow down",
    });

    expect(revived?.category).toBe("RATE_LIMIT");
    expect(revived?.retryable).toBe(true);
  });

  it("masks the restored error under the redaction floor of its definition", () => {
    const revived = AppErrors.fromJSON(userNotFoundPayload());

    const details = revived?.toLogObject().details as Record<string, unknown>;

    expect(details).toEqual({ userId: "7", email: "[REDACTED]" });
  });

  it("keeps the output of the schema as the details", () => {
    const TrimmingErrors = defineErrors({
      USER_NOT_FOUND: {
        category: "NOT_FOUND",
        retryable: false,
        details: schemaFrom((value) => {
          const user = parseUser(value);
          return user && { userId: user.userId.trim(), email: user.email };
        }),
      },
    });

    const revived = TrimmingErrors.fromJSON(
      userNotFoundPayload({ details: { userId: " 7 ", email: "a@b.c" } }),
    );

    expect(revived?.details).toEqual({ userId: "7", email: "a@b.c" });
  });

  it("restores a payload without a message with the fallback message", () => {
    const revived = AppErrors.fromJSON({ code: "RATE_LIMITED" });

    expect(revived?.code).toBe("RATE_LIMITED");
    expect(revived?.message).toBe("Unknown error");
  });

  it("drops the details of a key whose definition has no schema", () => {
    const conflict = AppErrors.fromJSON({
      code: "CONFLICT",
      message: "taken",
      details: { resource: "order 7" },
    });
    const rateLimited = AppErrors.fromJSON({
      code: "RATE_LIMITED",
      message: "slow down",
      details: { retryAfter: 30 },
    });

    expect(conflict?.code).toBe("CONFLICT");
    expect(conflict?.details).toBeUndefined();
    expect(rateLimited?.details).toBeUndefined();
  });

  it("restores the members of an aggregate", () => {
    const revived = AppErrors.fromJSON(
      userNotFoundPayload({
        errors: [
          { name: "Error", message: "replica 1" },
          { name: "Error", message: "replica 2" },
        ],
      }),
    );

    const members = (revived as unknown as { errors: Error[] }).errors;

    expect(members.map((member) => member.message)).toEqual([
      "replica 1",
      "replica 2",
    ]);
  });

  it("restores an error of a catalog with a prefix by its full code", () => {
    const AuthzErrors = defineErrors(
      { not_a_member: { category: "FORBIDDEN", retryable: false } },
      { prefix: "restaurant.authz" },
    );

    const revived = AuthzErrors.fromJSON({
      code: "restaurant.authz.not_a_member",
      message: "actor 42 is not a member",
    });
    const unprefixed = AuthzErrors.fromJSON({
      code: "not_a_member",
      message: "actor 42 is not a member",
    });

    expect(AuthzErrors.is(revived, "not_a_member")).toBe(true);
    expect(unprefixed).toBeUndefined();
  });

  it("restores a masked field as the log object wrote it", () => {
    const original = AppErrors.create.USER_NOT_FOUND("user 7 missing", {
      details: { userId: "7", email: "ada@example.com" },
    });

    const revived = AppErrors.fromJSON(JSON.parse(JSON.stringify(original)));

    expect(revived?.details).toEqual({ userId: "7", email: "[REDACTED]" });
  });
});

describe("Catalog.fromJSON returns undefined for a payload that does not fit", () => {
  it("returns undefined for a code outside the catalog", () => {
    expect(
      AppErrors.fromJSON(userNotFoundPayload({ code: "OTHER" })),
    ).toBeUndefined();
  });

  it("returns undefined for a payload that is no object", () => {
    expect(AppErrors.fromJSON(null)).toBeUndefined();
    expect(AppErrors.fromJSON("USER_NOT_FOUND")).toBeUndefined();
    expect(AppErrors.fromJSON(42)).toBeUndefined();
  });

  it("returns undefined for a payload without a code, also in a catalog that defines the fallback code", () => {
    const FallbackErrors = defineErrors({
      UNKNOWN_ERROR: { category: "INTERNAL", retryable: false },
    });

    expect(FallbackErrors.fromJSON({ message: "no code" })).toBeUndefined();
  });

  it("returns undefined when the details fail the schema", () => {
    const revived = AppErrors.fromJSON(
      userNotFoundPayload({ details: { userId: 7, email: "a@b.c" } }),
    );

    expect(revived).toBeUndefined();
  });

  it("returns undefined when the schema answers with an output that is no record", () => {
    const ListErrors = defineErrors({
      USER_NOT_FOUND: {
        category: "NOT_FOUND",
        retryable: false,
        details: schemaFrom(() => ["7"] as unknown as User),
      },
    });

    expect(ListErrors.fromJSON(userNotFoundPayload())).toBeUndefined();
  });

  it("returns undefined when the payload of a key with a schema has no details", () => {
    expect(
      AppErrors.fromJSON(userNotFoundPayload({ details: undefined })),
    ).toBeUndefined();
  });
});

describe("Catalog.fromJSON for a hostile payload and a faulty schema", () => {
  it("does not throw for a payload whose getters throw", () => {
    const payload = {
      get code(): string {
        throw new Error("getter");
      },
    };
    const proxy = new Proxy(
      {},
      {
        get() {
          throw new Error("trap");
        },
      },
    );

    expect(AppErrors.fromJSON(payload)).toBeUndefined();
    expect(AppErrors.fromJSON(proxy)).toBeUndefined();
  });

  it("keeps an own __proto__ key of the details as data", () => {
    const payload: unknown = JSON.parse(
      '{"code":"USER_NOT_FOUND","message":"m","details":{"userId":"7","email":"a@b.c","__proto__":{"polluted":true}}}',
    );
    const PassThroughErrors = defineErrors({
      USER_NOT_FOUND: {
        category: "NOT_FOUND",
        retryable: false,
        details: schemaFrom((value) =>
          parseUser(value) ? (value as User) : undefined,
        ),
      },
    });

    const revived = PassThroughErrors.fromJSON(payload);

    expect(Object.getPrototypeOf(revived?.details)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("lets an exception of the schema propagate", () => {
    const failure = new Error("schema bug");
    const FaultyErrors = defineErrors({
      USER_NOT_FOUND: {
        category: "NOT_FOUND",
        retryable: false,
        details: throwingSchema<User>(failure),
      },
    });

    expect(() => FaultyErrors.fromJSON(userNotFoundPayload())).toThrow(failure);
  });

  it("throws for a schema that answers with a promise", () => {
    const AsyncErrors = defineErrors({
      USER_NOT_FOUND: {
        category: "NOT_FOUND",
        retryable: false,
        details: asyncSchema<User>(),
      },
    });

    expect(() => AsyncErrors.fromJSON(userNotFoundPayload())).toThrow(
      'fromJSON: the details schema of key "USER_NOT_FOUND" returned a promise; a details schema must validate synchronously',
    );
  });
});

describe("defineErrors with a details schema", () => {
  it("rejects a details value that claims Standard Schema without a validate function", () => {
    expect(() =>
      defineErrors({
        USER_NOT_FOUND: {
          category: "NOT_FOUND",
          retryable: false,
          details: { "~standard": { version: 1, vendor: "x" } } as never,
        },
      }),
    ).toThrow(
      'defineErrors: the details of key "USER_NOT_FOUND" are not a Standard Schema v1 validator',
    );
  });

  it("validates with a schema that is a function, as an ArkType type is", () => {
    const callable = Object.assign(
      (value: unknown) => value,
      schemaFrom(parseUser),
    );
    const CallableErrors = defineErrors({
      USER_NOT_FOUND: {
        category: "NOT_FOUND",
        retryable: false,
        details: callable,
      },
    });

    const valid = CallableErrors.fromJSON(userNotFoundPayload());
    const invalid = CallableErrors.fromJSON(
      userNotFoundPayload({ details: { userId: 7 } }),
    );

    expect(valid?.details).toEqual({ userId: "7", email: "ada@example.com" });
    expect(invalid).toBeUndefined();
  });

  it("does not run the schema in a factory", () => {
    const failure = new Error("schema ran");
    const FaultyErrors = defineErrors({
      USER_NOT_FOUND: {
        category: "NOT_FOUND",
        retryable: false,
        details: throwingSchema<User>(failure),
      },
    });

    const error = FaultyErrors.create.USER_NOT_FOUND("m", {
      details: { userId: "7", email: "a@b.c" },
    });

    expect(error.details).toEqual({ userId: "7", email: "a@b.c" });
  });
});
