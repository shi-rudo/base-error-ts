import { describe, expect, it } from "vitest";

import { BaseError, StructuredError } from "../index.js";

const SHARED = "[Shared cause]";
const CIRCULAR = "[Circular cause chain]";

type Log = Record<string, unknown>;

/** A fan-out whose two branches failed on the same upstream error. */
function fanOutSharing(upstream: Error): AggregateError {
  return new AggregateError([upstream, upstream], "both branches failed");
}

describe("a cause shared by two branches", () => {
  it("is logged in full once and as the shared marker afterwards", () => {
    const upstream = new Error("upstream timed out");

    const log = new BaseError("root", fanOutSharing(upstream)).toLogObject();

    const members = (log.cause as Log).errors as unknown[];
    expect((members[0] as Log).message).toBe("upstream timed out");
    expect(members[1]).toBe(SHARED);
  });

  it("renders as the shared marker in toString", () => {
    const upstream = new Error("upstream timed out");

    const lines = new BaseError("root", fanOutSharing(upstream))
      .toString()
      .split("\n");

    expect(lines.slice(2)).toEqual([
      "  - Error: upstream timed out",
      `  - ${SHARED}`,
    ]);
  });

  it("is shared across the cause and the members of the root", () => {
    const upstream = new Error("upstream timed out");
    const root = Object.assign(new BaseError("root", upstream), {
      errors: [upstream],
    });

    const log = root.toLogObject();

    expect((log.cause as Log).message).toBe("upstream timed out");
    expect((log.errors as unknown[])[0]).toBe(SHARED);
  });

  it("stays readable under an allow-list", () => {
    const upstream = new Error("upstream timed out");

    const log = new BaseError("root", fanOutSharing(upstream))
      .redactAllow([])
      .toLogObject();

    expect(((log.cause as Log).errors as unknown[])[1]).toBe(SHARED);
  });

  it("survives a fromJSON round trip as the marker text", () => {
    const upstream = new Error("upstream timed out");
    const error = new StructuredError({
      code: "FAN_OUT",
      category: "UPSTREAM",
      retryable: true,
      message: "fan-out failed",
      cause: fanOutSharing(upstream),
    });

    const restored = StructuredError.fromJSON(
      JSON.parse(JSON.stringify(error)) as unknown,
    );

    const cause = (restored as unknown as { cause: AggregateError }).cause;
    expect(cause.errors[1]).toBe(SHARED);
  });
});

describe("a cause that closes a cycle", () => {
  it("is marked where the chain returns to the root", () => {
    const first = new BaseError("first");
    const second = new BaseError("second", first);
    Object.defineProperty(first, "cause", { value: second });

    const log = first.toLogObject();

    expect((log.cause as Log).message).toBe("second");
    expect((log.cause as Log).cause).toBe(CIRCULAR);
  });
});
