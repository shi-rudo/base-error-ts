import { describe, expect, it } from "vitest";
import { BaseError } from "../index.js";

type Log = Record<string, unknown>;
class SecretDiagnosis extends BaseError<"SecretDiagnosis"> {
  readonly code = 0;
  readonly category = "PERMANENT";
  readonly retryable = false;
  readonly details = { secret: "private-payload" };
}

function throwingMask(): never {
  throw new Error("mask failed");
}

function render(error: SecretDiagnosis, route: string): Log {
  if (route === "root") return error.toLogObject();
  if (route === "json") return JSON.parse(JSON.stringify(error)) as Log;
  if (route === "cause") {
    return new BaseError("outer", error).toLogObject().cause as Log;
  }
  if (route === "aggregate") {
    const log = new BaseError(
      "outer",
      new AggregateError([error]),
    ).toLogObject();
    return ((log.cause as Log).errors as Log[])[0]!;
  }
  class Container extends BaseError<"Container"> {
    protected override buildOwnLogFields(): Log {
      return { data: { nested: error } };
    }
  }
  return (new Container("outer").toLogObject().data as Log).nested as Log;
}

describe("denied diagnostic fields stay absent from redaction recovery", () => {
  it.each(["root", "json", "cause", "aggregate", "data"])(
    "does not restore a denied name on the %s path",
    (route) => {
      let calls = 0;
      const error = new SecretDiagnosis("diagnosis").redact(["name"], {
        mask() {
          calls++;
          return throwingMask();
        },
      });

      const log = render(error, route);

      expect(log).not.toHaveProperty("name");
      expect(log).toMatchObject({
        message: "[log redaction failed]",
        code: 0,
        category: "PERMANENT",
        retryable: false,
      });
      expect(log).not.toHaveProperty("stack");
      expect(log).not.toHaveProperty("details");
      expect(JSON.stringify(log)).not.toContain("SecretDiagnosis");
      expect(calls).toBe(1);
    },
  );

  it.each([
    "name",
    "code",
    "category",
    "retryable",
    "timestamp",
    "timestampIso",
  ])("does not recover denied %s after a later mask throws", (key) => {
    const calls: string[] = [];
    const error = new SecretDiagnosis("diagnosis").redact([key, "secret"], {
      mask(_value, currentKey) {
        calls.push(currentKey);
        if (currentKey === "secret") return throwingMask();
        return "[REDACTED]";
      },
    });

    const log = error.toLogObject();

    expect(log.message).toBe("[log redaction failed]");
    expect(log).not.toHaveProperty(key);
    expect(log).not.toHaveProperty("details");
    expect(calls).toEqual([key, "secret"]);
  });

  it("honors denied names when reflection fails after successful masking", () => {
    const error = new SecretDiagnosis("diagnosis").redact(["name"]);
    Object.defineProperty(error.details, "unreadable", {
      enumerable: true,
      get: throwingMask,
    });

    const log = error.toLogObject();

    expect(log.message).toBe("[log redaction failed]");
    expect(log).not.toHaveProperty("name");
    expect(log.retryable).toBe(false);
  });

  it("uses the active deny policy even if its mask installs a replacement", () => {
    const error = new SecretDiagnosis("diagnosis");
    error.redact(["name"], {
      mask() {
        error.redactAllow([]);
        return throwingMask();
      },
    });

    const first = error.toLogObject();
    const next = error.toLogObject();

    expect(first).not.toHaveProperty("name");
    expect(first.message).toBe("[log redaction failed]");
    expect(next.name).toBe("SecretDiagnosis");
    expect(next.details).toEqual({ secret: "[REDACTED]" });
  });

  it("keeps the registered deny list independent of caller array changes", () => {
    const keys = ["name"];
    const error = new SecretDiagnosis("diagnosis").redact(keys, {
      mask: throwingMask,
    });
    keys.length = 0;

    const log = error.toLogObject();

    expect(log).not.toHaveProperty("name");
    expect(log.message).toBe("[log redaction failed]");
  });

  it.each(["allow", "custom", "deny"])(
    "uses replacement %s policy recovery without the previous deny list",
    (replacement) => {
      const error = new SecretDiagnosis("diagnosis").redact(["name"]);
      if (replacement === "allow")
        error.redactAllow([], { mask: throwingMask });
      else if (replacement === "custom") error.redactWith(throwingMask);
      else error.redact(["secret"], { mask: throwingMask });

      const log = error.toLogObject();

      expect(log).toMatchObject({
        message: "[log redaction failed]",
        name: "SecretDiagnosis",
        code: 0,
        retryable: false,
      });
    },
  );
});
