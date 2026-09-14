import { describe, expect, it } from "vitest";
import { BaseError, StructuredError } from "../index.js";

describe("public logging during own log field processing", () => {
  it("keeps a self log envelope without invoking its hook again", () => {
    let calls = 0;
    class SelfLogging extends BaseError<"SelfLogging"> {
      protected override buildOwnLogFields(): Record<string, unknown> {
        calls++;
        return { self: this.toLogObject() };
      }
    }

    const log = new SelfLogging("diagnosis").toLogObject();

    expect(calls).toBe(1);
    expect(log.self).toMatchObject({
      name: "SelfLogging",
      message: "diagnosis",
      stack: expect.any(String),
      timestamp: expect.any(Number),
    });
    expect(log.self).not.toHaveProperty("self");
  });

  it("keeps a self toJSON envelope without invoking its hook again", () => {
    let calls = 0;
    class SelfJson extends BaseError<"SelfJson"> {
      protected override buildOwnLogFields(): Record<string, unknown> {
        calls++;
        return { self: this.toJSON() };
      }
    }

    const log = new SelfJson("diagnosis").toJSON();

    expect(calls).toBe(1);
    expect(log.self).toMatchObject({
      name: "SelfJson",
      message: "diagnosis",
      stack: expect.any(String),
      timestamp: expect.any(Number),
    });
    expect(log.self).not.toHaveProperty("self");
  });

  it("suppresses a different instance's hook during an explicit log call", () => {
    let nestedCalls = 0;
    class Related extends BaseError<"Related"> {
      protected override buildOwnLogFields(): Record<string, unknown> {
        nestedCalls++;
        return { requestId: "R" };
      }
    }
    const related = new Related("related diagnosis");
    class Outer extends BaseError<"Outer"> {
      protected override buildOwnLogFields(): Record<string, unknown> {
        return { related: related.toLogObject() };
      }
    }

    const log = new Outer("outer").toLogObject();

    expect(nestedCalls).toBe(0);
    expect(log.related).toMatchObject({
      name: "Related",
      message: "related diagnosis",
    });
    expect(log.related).not.toHaveProperty("requestId");
  });

  it("bounds hook calls when each hook creates a fresh error instance", () => {
    let calls = 0;
    class Fresh extends BaseError<"Fresh"> {
      protected override buildOwnLogFields(): Record<string, unknown> {
        calls++;
        // Keep a broken implementation's reproduction finite.
        if (calls === 32) return { safetyStop: true };
        return { next: new Fresh("next diagnosis").toLogObject() };
      }
    }

    const log = new Fresh("outer").toLogObject();

    expect(calls).toBe(1);
    expect(log.next).toMatchObject({
      name: "Fresh",
      message: "next diagnosis",
    });
    expect(log.next).not.toHaveProperty("next");
  });

  it("keeps decisions and sticky cause redaction while suppressing cause hooks", () => {
    let causeCalls = 0;
    class Cause extends BaseError<"Cause"> {
      readonly code = 0;
      readonly category = "VALIDATION";
      readonly retryable = false;
      readonly details = { password: "cause-secret", requestId: "R" };

      protected override buildOwnLogFields(): Record<string, unknown> {
        causeCalls++;
        return { contribution: "own field" };
      }
    }
    const cause = new Cause("cause diagnosis").redact(["password"]);
    const related = new StructuredError({
      code: "RELATED",
      category: "VALIDATION",
      retryable: false,
      message: "related diagnosis",
      details: { password: "root-secret" },
      cause,
    }).redact(["password"]);
    class Outer extends BaseError<"Outer"> {
      protected override buildOwnLogFields(): Record<string, unknown> {
        return { related: related.toJSON() };
      }
    }

    const log = new Outer("outer").toLogObject();

    expect(causeCalls).toBe(0);
    expect(log.related).toMatchObject({
      code: "RELATED",
      retryable: false,
      details: { password: "[REDACTED]" },
      cause: {
        name: "Cause",
        message: "cause diagnosis",
        code: 0,
        category: "VALIDATION",
        retryable: false,
        details: { password: "[REDACTED]", requestId: "R" },
      },
    });
    expect(log.related).not.toHaveProperty("cause.contribution");
    expect(JSON.stringify(log)).not.toContain("secret");
  });

  it.each(["getter", "toJSON"] as const)(
    "suppresses nested hooks while copying a returned %s value",
    (callback) => {
      let nestedCalls = 0;
      let callbackCalls = 0;
      class Related extends BaseError<"Related"> {
        protected override buildOwnLogFields(): Record<string, unknown> {
          nestedCalls++;
          return { requestId: "R" };
        }
      }
      const related = new Related("related diagnosis");
      const nestedLog = () => {
        callbackCalls++;
        return related.toLogObject();
      };
      class Outer extends BaseError<"Outer"> {
        protected override buildOwnLogFields(): Record<string, unknown> {
          return callback === "getter"
            ? {
                get related() {
                  return nestedLog();
                },
              }
            : { related: { toJSON: nestedLog } };
        }
      }

      const log = new Outer("outer").toLogObject();

      expect(callbackCalls).toBeGreaterThan(0);
      expect(nestedCalls).toBe(0);
      expect(log.related).toMatchObject({
        name: "Related",
        message: "related diagnosis",
      });
      expect(log.related).not.toHaveProperty("requestId");
    },
  );

  it.each(["throw", "invalid record"] as const)(
    "restores hook processing after a hook ends with %s",
    (failure) => {
      let nestedCalls = 0;
      class Related extends BaseError<"Related"> {
        protected override buildOwnLogFields(): Record<string, unknown> {
          nestedCalls++;
          return { requestId: "R" };
        }
      }
      const related = new Related("related diagnosis");
      class Failed extends BaseError<"Failed"> {
        protected override buildOwnLogFields(): Record<string, unknown> {
          related.toLogObject();
          if (failure === "throw") throw new Error("hook failed");
          return [] as unknown as Record<string, unknown>;
        }
      }

      const failed = new Failed("original diagnosis").toLogObject();
      const subsequent = related.toLogObject();

      expect(nestedCalls).toBe(1);
      expect(failed.message).toBe("original diagnosis");
      expect(subsequent).toMatchObject({
        message: "related diagnosis",
        requestId: "R",
      });
    },
  );

  it("invokes the hook once again on a subsequent independent public call", () => {
    let calls = 0;
    class SelfLogging extends BaseError<"SelfLogging"> {
      protected override buildOwnLogFields(): Record<string, unknown> {
        calls++;
        return { self: this.toLogObject(), requestId: "R" };
      }
    }
    const error = new SelfLogging("diagnosis");

    const first = error.toLogObject();
    const second = error.toJSON();

    expect(calls).toBe(2);
    expect(first.requestId).toBe("R");
    expect(second.requestId).toBe("R");
    expect(second.self).not.toHaveProperty("requestId");
  });

  it("distinguishes shallow data errors from an explicit public log call", () => {
    let nestedCalls = 0;
    class Related extends BaseError<"Related"> {
      protected override buildOwnLogFields(): Record<string, unknown> {
        nestedCalls++;
        return { requestId: "R" };
      }
    }
    const related = new Related("related diagnosis", new Error("leaf"));
    class Outer extends BaseError<"Outer"> {
      protected override buildOwnLogFields(): Record<string, unknown> {
        return {
          payload: { data: related },
          explicit: related.toLogObject(),
        };
      }
    }

    const log = new Outer("outer").toLogObject();

    expect(nestedCalls).toBe(0);
    expect(log.payload).toMatchObject({
      data: { message: "related diagnosis" },
    });
    expect(log.payload).not.toHaveProperty("data.cause");
    expect(log.explicit).toMatchObject({
      message: "related diagnosis",
      cause: { name: "Error", message: "leaf" },
    });
  });
});
