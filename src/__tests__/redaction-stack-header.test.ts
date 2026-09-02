import { describe, it, expect } from "vitest";
import { BaseError, StructuredAggregateError, partialMask } from "../index.js";

class TestError extends BaseError<"TestError"> {}

/** A subclass whose log object carries a hand-built cause. */
class ForgedCauseError extends BaseError<"ForgedCauseError"> {
  readonly #forgedCause: unknown;

  constructor(message: string, forgedCause: unknown) {
    super(message);
    this.#forgedCause = forgedCause;
  }

  protected override buildLogObject(): Record<string, unknown> {
    return { ...super.buildLogObject(), cause: this.#forgedCause };
  }
}

const SECRET = "password=hunter2";

function headerOf(stack: unknown): string | undefined {
  return typeof stack === "string" ? stack.split("\n")[0] : undefined;
}

/** The lines after a single-line header. */
function framesOf(stack: unknown): string[] {
  return typeof stack === "string" ? stack.split("\n").slice(1) : [];
}

function nodeOf(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

describe("redact: a deny-listed message is masked in the stack of the log object", () => {
  it("rewrites the header with the masked message and keeps the frames", () => {
    const err = new TestError(SECRET).redact(["message"]);

    const log = err.toLogObject();

    expect(log.message).toBe("[REDACTED]");
    expect(headerOf(log.stack)).toBe("TestError: [REDACTED]");
    expect(framesOf(log.stack).length).toBeGreaterThan(0);
    expect(framesOf(log.stack)).toEqual(framesOf(err.stack));
  });

  it("leaves no message text in the JSON.stringify output", () => {
    const err = new TestError(SECRET).redact(["message"]);

    expect(JSON.stringify(err)).not.toContain("hunter2");
  });

  it("masks the header of every node on the cause chain", () => {
    const native = new Error("native secret");
    const middle = new TestError("middle secret", native);
    const outer = new TestError(SECRET, middle).redact(["message"]);

    const log = outer.toLogObject();

    const cause = nodeOf(log.cause);
    const inner = nodeOf(cause.cause);
    expect(headerOf(cause.stack)).toBe("TestError: [REDACTED]");
    expect(framesOf(cause.stack)).toEqual(framesOf(middle.stack));
    expect(headerOf(inner.stack)).toBe("Error: [REDACTED]");
    expect(framesOf(inner.stack)).toEqual(framesOf(native.stack));
    expect(JSON.stringify(outer)).not.toContain("secret");
    expect(JSON.stringify(outer)).not.toContain("hunter2");
  });

  it("masks the header of every aggregate member", () => {
    const members = [
      new Error("member secret 1"),
      new Error("member secret 2"),
    ];
    const aggregate = new AggregateError(members, "aggregate secret");
    const err = new TestError(SECRET, aggregate).redact(["message"]);

    const log = err.toLogObject();

    const cause = nodeOf(log.cause);
    expect(headerOf(cause.stack)).toBe("AggregateError: [REDACTED]");
    const errors = cause.errors as unknown[];
    expect(errors).toHaveLength(2);
    errors.forEach((member, index) => {
      expect(headerOf(nodeOf(member).stack)).toBe("Error: [REDACTED]");
      expect(framesOf(nodeOf(member).stack)).toEqual(
        framesOf(members[index]?.stack),
      );
    });
    expect(JSON.stringify(err)).not.toContain("secret");
  });

  it("masks the header of every member of an aggregate root", () => {
    const members = [
      new Error("member secret 1"),
      new Error("member secret 2"),
    ];
    const err = new StructuredAggregateError({
      code: "FAN_OUT_FAILED",
      category: "UPSTREAM",
      retryable: false,
      message: SECRET,
      errors: members,
    }).redact(["message"]);

    const log = err.toLogObject();

    expect(headerOf(log.stack)).toBe("FAN_OUT_FAILED: [REDACTED]");
    const errors = log.errors as unknown[];
    expect(errors).toHaveLength(2);
    for (const member of errors) {
      expect(headerOf(nodeOf(member).stack)).toBe("Error: [REDACTED]");
    }
    expect(JSON.stringify(err)).not.toContain("secret");
    expect(JSON.stringify(err)).not.toContain("hunter2");
  });

  it("renders the result of a function mask in the header", () => {
    const err = new TestError(SECRET).redact(["message"], {
      mask: (value) => `<${String(value).length}>`,
    });

    const log = err.toLogObject();

    expect(log.message).toBe("<16>");
    expect(headerOf(log.stack)).toBe("TestError: <16>");
  });

  it("renders a partialMask in the header", () => {
    const err = new TestError(SECRET).redact(["message"], {
      mask: partialMask({ keepStart: 0, keepEnd: 2 }),
    });

    const log = err.toLogObject();

    expect(headerOf(log.stack)).toBe("TestError: …r2");
    expect(log.stack).not.toContain("hunter2");
  });

  it("keeps the fail-closed envelope when the mask throws", () => {
    const err = new TestError(SECRET).redact(["message"], {
      mask: () => {
        throw new Error("mask failed");
      },
    });

    const log = err.toLogObject();

    expect(log.message).toBe("[log redaction failed]");
    expect(log).not.toHaveProperty("stack");
    expect(JSON.stringify(err)).not.toContain("hunter2");
  });

  it("keeps a multi-line message out of the header and the frames", () => {
    const err = new TestError("line one\nsecret line two").redact(["message"]);

    const log = err.toLogObject();

    expect(headerOf(log.stack)).toBe("TestError: [REDACTED]");
    expect(log.stack).not.toContain("secret line two");
    const rawFrames = (err.stack as string).split("\n").slice(2);
    expect(framesOf(log.stack)).toEqual(rawFrames);
  });

  it("masks the header of an empty message and keeps the frames", () => {
    const native = new Error("");
    const err = new TestError("", native).redact(["message"]);

    const log = err.toLogObject();

    expect(headerOf(log.stack)).toBe("TestError: [REDACTED]");
    expect(framesOf(log.stack)).toEqual(framesOf(err.stack));
    const cause = nodeOf(log.cause);
    expect(headerOf(cause.stack)).toBe("Error: [REDACTED]");
    expect(framesOf(cause.stack)).toEqual(
      (native.stack as string).split("\n").slice(1),
    );
  });

  it("masks the header of a JSON-revived cause and keeps its frames", () => {
    const revived = {
      name: "RevivedError",
      message: "revived secret",
      stack: "RevivedError: revived secret\n    at revived (file:1:1)",
    };
    const err = new TestError(SECRET, revived).redact(["message"]);

    const log = err.toLogObject();

    expect(nodeOf(log.cause).stack).toBe(
      "RevivedError: [REDACTED]\n    at revived (file:1:1)",
    );
  });

  it("masks a stack that lacks a header as a whole", () => {
    const cause = {
      name: "E",
      message: "cause secret",
      stack: "    at fn (file:1:1)",
    };
    const err = new TestError(SECRET, cause).redact(["message"]);

    const log = err.toLogObject();

    expect(nodeOf(log.cause).stack).toBe("[REDACTED]");
  });

  it("masks a stack whose header disagrees with the message as a whole", () => {
    const cause = {
      name: "E",
      message: "m",
      stack: "E: other secret\n    at fn (file:1:1)",
    };
    const err = new TestError(SECRET, cause).redact(["message"]);

    const log = err.toLogObject();

    expect(nodeOf(log.cause).stack).toBe("[REDACTED]");
  });

  it("hands a stack it masks as a whole to a function mask under the key stack", () => {
    const cause = { name: "E", message: "m", stack: "    at fn (file:1:1)" };
    const err = new TestError(SECRET, cause).redact(["message"], {
      mask: (value, key) => `${key}:${String(value).length}`,
    });

    const log = err.toLogObject();

    expect(nodeOf(log.cause).stack).toBe(`stack:${cause.stack.length}`);
  });

  it("leaves a non-string stack alone", () => {
    const cause = { name: "E", message: "cause secret", stack: 42 };
    const err = new TestError(SECRET, cause).redact(["message"]);

    const log = err.toLogObject();

    expect(nodeOf(log.cause).stack).toBe(42);
  });

  it("masks the stack as a whole when stack itself is deny-listed", () => {
    const err = new TestError(SECRET).redact(["message", "stack"]);

    const log = err.toLogObject();

    expect(log.stack).toBe("[REDACTED]");
  });

  it("does not rewrite a cause object that a subclass hands in", () => {
    const shared = {
      name: "E",
      message: "shared secret",
      stack: "E: shared secret\n    at shared (file:1:1)",
    };
    const err = new ForgedCauseError(SECRET, shared).redact(["message"]);

    const log = err.toLogObject();

    expect(nodeOf(log.cause).stack).toBe(
      "E: [REDACTED]\n    at shared (file:1:1)",
    );
    expect(shared.stack).toBe("E: shared secret\n    at shared (file:1:1)");
    expect(shared.message).toBe("shared secret");
  });

  it("covers a forged chain deeper than the data depth cap", () => {
    let chain: Record<string, unknown> = {
      name: "E",
      message: "secret 0",
      stack: "E: secret 0\n    at fn (file:1:1)",
    };
    for (let index = 1; index < 200; index++) {
      chain = {
        name: "E",
        message: `secret ${index}`,
        stack: `E: secret ${index}\n    at fn (file:1:1)`,
        cause: chain,
      };
    }
    const err = new ForgedCauseError(SECRET, chain).redact(["message"]);

    const json = JSON.stringify(err);

    expect(json).not.toContain("secret");
    expect(json).toContain("E: [REDACTED]\\n    at fn (file:1:1)");
  });

  it("stops at a size marker on the spine without throwing", () => {
    const leaf = {
      name: "E",
      message: "leaf secret",
      stack: "E: leaf secret\n    at fn (file:1:1)",
    };
    const middle = { ...leaf, errors: new Array<unknown>(50).fill(leaf) };
    const top = { ...leaf, errors: new Array<unknown>(50).fill(middle) };
    const forged = { ...leaf, errors: new Array<unknown>(50).fill(top) };
    const err = new ForgedCauseError(SECRET, forged).redact(["message"]);

    const json = JSON.stringify(err);

    expect(json).not.toContain("secret");
    expect(json).not.toContain("hunter2");
  });
});

describe("redact: the stack header outside a deny-listed message", () => {
  it("keeps the header raw when message is not deny-listed", () => {
    const err = new TestError(SECRET).redact(["password"]);

    const log = err.toLogObject();

    expect(headerOf(log.stack)).toBe(`TestError: ${SECRET}`);
  });

  it("leaves the err.stack property raw", () => {
    const err = new TestError(SECRET).redact(["message"]);
    err.toLogObject();

    expect(headerOf(err.stack)).toBe(`TestError: ${SECRET}`);
  });

  it("leaves the header raw under redactAllow, where message is envelope", () => {
    const err = new TestError(SECRET).redactAllow([]);

    const log = err.toLogObject();

    expect(headerOf(log.stack)).toBe(`TestError: ${SECRET}`);
  });
});
