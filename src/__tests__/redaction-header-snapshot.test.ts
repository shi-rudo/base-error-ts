import { expect, it } from "vitest";
import { BaseError } from "../index.js";

function legacy(fields: Record<string, unknown>) {
  class Legacy extends BaseError<"Legacy"> {
    protected override buildLogObject(): Record<string, unknown> {
      return { message: "outer", ...fields, code: 0, retryable: false };
    }
  }
  return new Legacy("outer");
}

it("does not read cause-array indices again to mask stack headers", () => {
  let reads = 0;
  const errors = new Proxy(Array(60_000).fill(null), {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  const log = legacy({ errors }).redact(["message"]).toLogObject();
  expect(reads).toBe(60_000);
  expect(log).toMatchObject({ code: 0, retryable: false });
  expect(log.errors).toHaveLength(60_000);
});

it("masks the stack value that was copied even when its getter changes later", () => {
  let reads = 0;
  const cause = {
    name: "Error",
    message: "PRIVATE_MESSAGE",
    get stack() {
      reads++;
      return reads === 1
        ? "Error: PRIVATE_MESSAGE\n    at operation"
        : undefined;
    },
  };
  const log = legacy({ cause }).redact(["message"]).toLogObject();
  expect(JSON.stringify(log)).not.toContain("PRIVATE_MESSAGE");
  expect(reads).toBe(1);
  expect(log.cause).toMatchObject({
    stack: "Error: [REDACTED]\n    at operation",
  });
});
