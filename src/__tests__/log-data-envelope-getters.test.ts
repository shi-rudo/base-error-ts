import { expect, it } from "vitest";
import { BaseError } from "../index.js";

const keys = ["name", "message", "stack", "code", "category", "retryable"];

function unreadable(key: string): Record<string, unknown> {
  return Object.defineProperty({ keep: 1 }, key, {
    enumerable: true,
    get() {
      throw new Error("PRIVATE");
    },
  });
}

it.each(keys)(
  "does not invent a diagnostic %s from a failed cause read",
  (key) => {
    const cause = unreadable(key);

    const log = new BaseError("outer", cause).toLogObject();

    expect(log.cause).toEqual({ keep: 1 });
  },
);

it.each(keys)("marks a failed %s read inside data", (key) => {
  const cause = { details: unreadable(key) };

  const log = new BaseError("outer", cause).toLogObject();

  expect(log.cause).toEqual({
    details: { keep: 1, [key]: "[Unserializable value]" },
  });
});
