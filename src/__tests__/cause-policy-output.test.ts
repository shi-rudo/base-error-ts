import { describe, expect, it } from "vitest";
import { BaseError } from "../index.js";

describe("redaction of unreadable or oversized cause policy output", () => {
  it.each([[], {}])(
    "masks a denied revoked value of a cause policy",
    (target) => {
      class SecretRoot extends BaseError<"SecretRoot"> {}
      const { proxy, revoke } = Proxy.revocable(target, {});
      revoke();
      const inner = new BaseError("inner").redactWith(() => ({
        name: "Inner",
        message: "diagnosis",
        errors: proxy,
        code: 0,
        retryable: false,
      }));

      const log = new SecretRoot("outer", inner)
        .redact(["name", "errors"])
        .toLogObject();

      expect(log).toMatchObject({
        name: "[REDACTED]",
        message: "outer",
        cause: {
          name: "[REDACTED]",
          message: "diagnosis",
          errors: "[REDACTED]",
          code: 0,
          retryable: false,
        },
      });
      expect(log.stack).toEqual(expect.any(String));
      expect(JSON.stringify(log)).not.toContain("SecretRoot");
    },
  );

  it("keeps denied revoked aggregate fields masked through JSON serialization", () => {
    const { proxy, revoke } = Proxy.revocable([], {});
    revoke();
    const inner = new BaseError("inner").redactWith(() => ({ errors: proxy }));
    const aggregate = new AggregateError([inner], "aggregate");

    const log = JSON.parse(
      JSON.stringify(new BaseError("outer", aggregate).redact(["errors"])),
    );

    expect(log.message).toBe("outer");
    expect(log.cause).toMatchObject({
      message: "aggregate",
      errors: "[REDACTED]",
    });
  });

  it.each(["allow", "deny"])(
    "writes unreadable errors of a cause policy as the unserializable marker in %s mode",
    (mode) => {
      const { proxy, revoke } = Proxy.revocable([], {});
      revoke();
      const inner = new BaseError("inner").redactWith(() => ({
        errors: proxy,
      }));
      const error = new BaseError("outer", inner);

      const log = (
        mode === "allow" ? error.redactAllow([]) : error.redact([])
      ).toLogObject();

      expect(log.message).toBe("outer");
      expect(log.cause).toEqual({
        errors: mode === "allow" ? "[REDACTED]" : "[Unserializable value]",
      });
    },
  );

  it("writes cause policy output beyond the log budget as the size marker", () => {
    const inner = new BaseError("inner").redactWith(() => ({
      errors: { ids: Array(120_000).fill(0), name: "private data name" },
      cause: { name: "Error", message: "leaf diagnosis", retryable: false },
      message: "inner diagnosis",
    }));

    const log = new BaseError("outer", inner).redactAllow([]).toLogObject();

    expect(log.message).toBe("outer");
    expect(log.cause).toBe("[Max log size exceeded]");
    expect(JSON.stringify(log)).not.toContain("private data name");
  });

  it("still fails closed when a deferred data mask throws", () => {
    const inner = new BaseError("inner").redactWith(() => ({
      details: { password: "private password" },
      message: "cause diagnosis",
      code: 0,
      retryable: false,
    }));

    const log = new BaseError("outer", inner)
      .redact(["password"], {
        mask() {
          throw new Error("mask failed");
        },
      })
      .toLogObject();

    expect(log.message).toBe("[log redaction failed]");
    expect(log).not.toHaveProperty("cause");
    expect(JSON.stringify(log)).not.toContain("private password");
  });
});

type Log = Record<string, unknown>;
const secret = "private-policy-output-value";

/** An outer error whose cause returns `output` from a custom policy. */
function outerWithPolicyOutput(output: unknown): BaseError<"Outer"> {
  const inner = new BaseError("inner").redactWith(() => output as Log);
  return new BaseError<"Outer">("outer", inner, { name: "Outer" });
}

describe("the log copies the output of a custom cause policy", () => {
  it("decouples the copy from the policy output", () => {
    const details = { keep: "v" };
    const output = { message: "inner", details };

    const log = outerWithPolicyOutput(output).redact([]).toLogObject();

    expect(log.cause).toEqual({ message: "inner", details: { keep: "v" } });
    expect(log.cause === output).toBe(false);
    expect((log.cause as Log).details === details).toBe(false);
  });

  it("copies a shared reference once per reference and masks each copy", () => {
    const shared = { keep: "v", password: secret };

    const log = outerWithPolicyOutput({ details: { a: shared, b: shared } })
      .redact(["password"])
      .toLogObject();

    const details = (log.cause as Log).details as Log;
    expect(details.a).toEqual({ keep: "v", password: "[REDACTED]" });
    expect(details.b).toEqual({ keep: "v", password: "[REDACTED]" });
    expect(JSON.stringify(log)).not.toContain(secret);
  });

  it("writes a hostile value as the unserializable marker and masks a denied key", () => {
    const { proxy, revoke } = Proxy.revocable({ password: secret }, {});
    revoke();
    const masked: unknown[] = [];

    const log = outerWithPolicyOutput({ details: { secret: proxy } })
      .redact(["secret"], {
        mask(value) {
          masked.push(value);
          return "[REDACTED]";
        },
      })
      .toLogObject();

    expect((log.cause as Log).details).toEqual({ secret: "[REDACTED]" });
    expect(masked).toEqual(["[Unserializable value]"]);
  });

  it("does not call hidden getters and keeps a hidden-only output empty", () => {
    let getterCalls = 0;
    const output = {};
    Object.defineProperty(output, "hidden", {
      enumerable: false,
      get() {
        getterCalls++;
        return secret;
      },
    });

    const log = outerWithPolicyOutput(output).redactAllow([]).toLogObject();

    expect(log.cause).toEqual({});
    expect(getterCalls).toBe(0);
  });

  it("masks containers under decision keys of the output under an allow-list", () => {
    const malformed = { password: secret };

    const log = outerWithPolicyOutput({
      message: "inner",
      code: malformed,
      category: malformed,
      retryable: malformed,
    })
      .redactAllow([])
      .toLogObject();

    const cause = log.cause as Log;
    for (const key of ["code", "category", "retryable"]) {
      expect(cause[key]).toEqual({ password: "[REDACTED]" });
    }
    expect(JSON.stringify(log)).not.toContain(secret);
  });

  it("reads a stack getter of the output once and masks its denied header", () => {
    let stackReads = 0;
    const output = {
      name: "PrivateCauseName",
      message: secret,
      get stack() {
        stackReads++;
        return stackReads === 1
          ? `PrivateCauseName: ${secret}\n    at operation`
          : `OtherName: ${secret}\n    at changedOperation`;
      },
    };

    const log = outerWithPolicyOutput(output)
      .redact(["name", "message"])
      .toLogObject();

    expect(log.cause).toMatchObject({
      name: "[REDACTED]",
      message: "[REDACTED]",
      stack: "[REDACTED]: [REDACTED]\n    at operation",
    });
    expect(stackReads).toBe(1);
    expect(JSON.stringify(log)).not.toContain(secret);
  });
});

describe("the log copies each result of a function mask", () => {
  it("writes a Date that the mask returns as its ISO string", () => {
    const log = new BaseError("outer")
      .redact(["message"], { mask: () => new Date(0) })
      .toLogObject();

    expect(log.message).toBe("1970-01-01T00:00:00.000Z");
  });

  it("writes an unreadable value that the mask returns as the unserializable marker", () => {
    const log = new BaseError("outer")
      .redact(["message"], {
        mask: () => ({
          get text(): string {
            throw new Error("unreadable");
          },
        }),
      })
      .toLogObject();

    expect(log.message).toEqual({ text: "[Unserializable value]" });
  });

  it("writes a bigint that the mask returns as its decimal string", () => {
    const log = new BaseError("outer")
      .redact(["message"], { mask: () => 10n })
      .toLogObject();

    expect(log.message).toBe("10");
  });
});
