import { expect, it } from "vitest";
import { BaseError } from "../index.js";
import { MAX_DATA_WIDTH } from "../errors/walker-bounds.js";

function customCause(fields: Record<string, unknown>) {
  class WithDecisions extends BaseError<"WithDecisions"> {
    readonly code = 0;
    readonly retryable = false;
  }
  return new WithDecisions(
    "outer",
    new BaseError("inner").redactWith(() => fields),
  );
}

it("does not read cause-array indices again to mask stack headers", () => {
  let reads = 0;
  const errors = new Proxy(Array(60_000).fill(null), {
    get(target, key, receiver) {
      if (typeof key === "string" && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  const log = customCause({ errors }).redact(["message"]).toLogObject();
  // The copy takes the first entries up to the width cap and reads each once.
  expect(reads).toBe(MAX_DATA_WIDTH);
  expect(log).toMatchObject({ code: 0, retryable: false });
  expect((log.cause as Record<string, unknown>).errors).toHaveLength(
    MAX_DATA_WIDTH + 1,
  );
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
  const log = customCause({ cause }).redact(["message"]).toLogObject();
  expect(JSON.stringify(log)).not.toContain("PRIVATE_MESSAGE");
  expect(reads).toBe(1);
  expect((log.cause as Record<string, unknown>).cause).toMatchObject({
    stack: "Error: [REDACTED]\n    at operation",
  });
});
