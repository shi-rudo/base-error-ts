import { describe, expect, it } from "vitest";
import { BaseError, StructuredError } from "../index.js";

function tenantError() {
  const error = new StructuredError({
    code: "TENANT_9931_SECRET",
    category: "INTERNAL",
    retryable: false,
    message: "Request failed",
  });
  Object.defineProperty(error, "stack", {
    value: "TENANT_9931_SECRET: Request failed\n    at operation",
  });
  return error;
}

describe("StructuredError name and code redaction are independent", () => {
  it.each(["root", "cause"])(
    "keeps code when name is denied at the %s",
    (position) => {
      const error = tenantError().redact(["name"]);

      const log =
        position === "root"
          ? error.toLogObject()
          : (new BaseError("outer", error).toLogObject().cause as Record<
              string,
              unknown
            >);

      expect(log.name).toBe("[REDACTED]");
      expect(log.code).toBe("TENANT_9931_SECRET");
      expect(log.retryable).toBe(false);
      expect(log.stack).toBe("[REDACTED]: Request failed\n    at operation");
    },
  );

  it("keeps the name and stack header when only code is denied", () => {
    const error = tenantError().redact(["code"]);

    const log = error.toLogObject();

    expect(log.code).toBe("[REDACTED]");
    expect(log.name).toBe("TENANT_9931_SECRET");
    expect(log.stack).toBe(
      "TENANT_9931_SECRET: Request failed\n    at operation",
    );
  });

  it("masks both copies and the stack header when both keys are denied", () => {
    const error = tenantError().redact(["name", "code"]);

    const log = JSON.parse(JSON.stringify(error)) as Record<string, unknown>;

    expect(log.name).toBe("[REDACTED]");
    expect(log.code).toBe("[REDACTED]");
    expect(log.stack).toBe("[REDACTED]: Request failed\n    at operation");
    expect(log.retryable).toBe(false);
    expect(JSON.stringify(log)).not.toContain("TENANT_9931_SECRET");
  });
});
