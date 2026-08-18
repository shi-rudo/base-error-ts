import { describe, expect, it } from "vitest";
import {
  someChainRetryable,
  StructuredAggregateError,
  StructuredError,
} from "../index.js";

const branch = (code: string, retryable: boolean) =>
  new StructuredError({
    code,
    category: "TEST",
    retryable,
    message: `${code} failed`,
    details: { host: "node-1", token: "s3cret" },
  });

const batch = (members: unknown[] = [branch("ITEM_1", true)]) =>
  new StructuredAggregateError({
    code: "BATCH_FAILED",
    category: "INTERNAL",
    retryable: false,
    message: "3 of 10 items failed",
    errors: members,
  });

describe("StructuredAggregateError", () => {
  describe("construction", () => {
    it("keeps the structured fields of its parent", () => {
      const error = batch();

      expect(error).toBeInstanceOf(StructuredError);
      expect(error.code).toBe("BATCH_FAILED");
      expect(error.category).toBe("INTERNAL");
      expect(error.retryable).toBe(false);
      expect(error._tag).toBe("StructuredAggregateError");
    });

    it("copies the members, so later mutation cannot reach the log", () => {
      const members: unknown[] = [branch("ITEM_1", true)];
      const error = new StructuredAggregateError({
        code: "B",
        category: "C",
        retryable: false,
        message: "m",
        errors: members,
      });

      members.push(branch("ITEM_2", false));

      expect(error.errors).toHaveLength(1);
    });

    it("accepts any iterable of members", () => {
      const error = new StructuredAggregateError({
        code: "B",
        category: "C",
        retryable: false,
        message: "m",
        errors: new Set([branch("ITEM_1", true)]),
      });

      expect(error.errors).toHaveLength(1);
    });
  });

  describe("log serialization", () => {
    it("emits the members at the top level", () => {
      const log = batch().toLogObject();
      const members = log.errors as Record<string, unknown>[];

      expect(members).toHaveLength(1);
      expect(members[0]).toMatchObject({
        code: "ITEM_1",
        message: "ITEM_1 failed",
        retryable: true,
      });
    });

    it("caps the width like any other aggregate", () => {
      const members = Array.from({ length: 130 }, (_, index) =>
        branch(`ITEM_${index}`, false),
      );

      const log = batch(members).toLogObject();

      expect(log.errors).toHaveLength(101);
      expect((log.errors as unknown[])[100]).toBe(
        "[30 more aggregated errors]",
      );
    });

    it("marks a self-referencing member instead of recursing", () => {
      const members: unknown[] = [];
      const error = new StructuredAggregateError({
        code: "B",
        category: "C",
        retryable: false,
        message: "m",
        errors: members,
      });
      // The constructor copied the array, so reach the stored one.
      (error.errors as unknown[]).push(error);

      expect((error.toLogObject().errors as unknown[])[0]).toBe(
        "[Circular cause chain]",
      );
    });
  });

  describe("redaction", () => {
    it("masks denied keys inside the members", () => {
      const log = batch().redact(["token"]).toLogObject();
      const member = (log.errors as Record<string, unknown>[])[0];

      expect(member?.details).toEqual({
        host: "node-1",
        token: "[REDACTED]",
      });
    });

    it("keeps the member envelope under an allow-list", () => {
      const log = batch().redactAllow(["host"]).toLogObject();
      const member = (log.errors as Record<string, unknown>[])[0];

      expect(member).toMatchObject({
        code: "ITEM_1",
        message: "ITEM_1 failed",
        retryable: true,
        details: { host: "node-1", token: "[REDACTED]" },
      });
    });

    it("still masks a scalar `errors` field, which is not structural", () => {
      class Odd extends StructuredError<"ODD", "C"> {
        public readonly errors = "not-an-array";
        public constructor() {
          super({
            code: "ODD",
            category: "C",
            retryable: false,
            message: "m",
          });
        }
        protected override buildLogObject(): Record<string, unknown> {
          return { ...super.buildLogObject(), errors: this.errors };
        }
      }

      expect(new Odd().redactAllow([]).toLogObject().errors).toBe("[REDACTED]");
    });
  });

  describe("the rest of the library reads it by shape", () => {
    it("is traversed by the opt-in cause walk", () => {
      const error = batch([branch("ITEM_1", true)]);

      expect(someChainRetryable(error)).toBe(false);
      expect(someChainRetryable(error, { aggregates: true })).toBe(true);
    });

    it("counts its members in toString()", () => {
      expect(batch().toString()).toContain("(+1 aggregated)");
    });

    it("round-trips its members through fromJSON", () => {
      const restored = StructuredError.fromJSON(
        JSON.parse(JSON.stringify(batch())) as unknown,
      ) as StructuredError<string, string> & { errors?: unknown[] };

      expect(restored.code).toBe("BATCH_FAILED");
      expect(restored.errors).toHaveLength(1);
      expect(
        (restored.errors?.[0] as StructuredError<string, string>).code,
      ).toBe("ITEM_1");
    });
  });
});

describe("non-error members are data", () => {
  const withMembers = (members: unknown[]) =>
    new StructuredAggregateError({
      code: "BATCH_FAILED",
      category: "INTERNAL",
      retryable: false,
      message: "m",
      errors: members,
    });

  it("masks scalar members under an allow-list", () => {
    // Promise.allSettled reasons are arbitrary values, not always Errors.
    const log = withMembers(["api-key-super-secret", 42])
      .redactAllow([])
      .toLogObject();

    expect(log.errors).toEqual(["[REDACTED]", "[REDACTED]"]);
  });

  it("keeps them when `errors` is allowed explicitly", () => {
    const log = withMembers(["visible"]).redactAllow(["errors"]).toLogObject();

    expect(log.errors).toEqual(["visible"]);
  });

  it("masks scalar members of an aggregate cause too", () => {
    const outer = new StructuredError({
      code: "OUTER",
      category: "X",
      retryable: false,
      message: "m",
      cause: new AggregateError(["s3cret"], "agg"),
    }).redactAllow([]);

    const cause = outer.toLogObject().cause as Record<string, unknown>;

    expect(cause.errors).toEqual(["[REDACTED]"]);
  });

  it("keeps the library's own markers readable", () => {
    const members = Array.from({ length: 130 }, (_, index) =>
      branch(`ITEM_${index}`, false),
    );

    const log = withMembers(members).redactAllow([]).toLogObject();

    expect((log.errors as unknown[])[100]).toBe("[30 more aggregated errors]");
  });

  it("leaves the deny-list untouched", () => {
    const log = withMembers(["visible"]).redact(["token"]).toLogObject();

    expect(log.errors).toEqual(["visible"]);
  });
});
