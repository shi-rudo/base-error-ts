import { describe, expect, it } from "vitest";

import {
  BaseError,
  StructuredAggregateError,
  StructuredError,
} from "../index.js";

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

  it("is logged in full in both the cause and the members of the root", () => {
    const upstream = new Error("upstream timed out");
    const root = Object.assign(new BaseError("root", upstream), {
      errors: [upstream],
    });

    const log = root.toLogObject();

    expect((log.cause as Log).message).toBe("upstream timed out");
    expect(((log.errors as unknown[])[0] as Log).message).toBe(
      "upstream timed out",
    );
  });

  it("keeps a member that is also the cause of its aggregate through fromJSON", () => {
    const first = new StructuredError({
      code: "UPSTREAM_DOWN",
      category: "UPSTREAM",
      retryable: true,
      message: "upstream down",
    });
    const batch = new StructuredAggregateError({
      code: "BATCH_FAILED",
      category: "BATCH",
      retryable: false,
      message: "batch failed",
      errors: [first],
      cause: first,
    });

    const restored = StructuredError.fromJSON(
      JSON.parse(JSON.stringify(batch)) as unknown,
    );

    const members = (restored as unknown as { errors: unknown[] }).errors;
    expect(members[0]).toMatchObject({ code: "UPSTREAM_DOWN" });
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

function upstreamWithSecret(): StructuredError<"DB_DOWN", "INFRA"> {
  return new StructuredError({
    code: "DB_DOWN",
    category: "INFRA",
    retryable: true,
    message: "db down",
    details: { secret: "s3cr3t" },
  });
}

/** Two branches that failed on one upstream error; one carries a policy. */
function branchesSharing(
  upstream: Error,
  order: "policy first" | "policy second",
): { root: BaseError<"root">; withPolicy: number; withoutPolicy: number } {
  const withPolicy = new BaseError("with policy", upstream).redact(["secret"]);
  const withoutPolicy = new BaseError("without policy", upstream);
  const members =
    order === "policy first"
      ? [withPolicy, withoutPolicy]
      : [withoutPolicy, withPolicy];
  return {
    root: new BaseError<"root">(
      "root",
      new AggregateError(members, "both branches failed"),
    ),
    withPolicy: members.indexOf(withPolicy),
    withoutPolicy: members.indexOf(withoutPolicy),
  };
}

function branchCause(log: Log, index: number): unknown {
  const members = (log.cause as Log).errors as Log[];
  return (members[index] as Log).cause;
}

describe("a policy on one branch of a shared cause", () => {
  it("masks the shared cause when its branch comes first", () => {
    const { root, withPolicy, withoutPolicy } = branchesSharing(
      upstreamWithSecret(),
      "policy first",
    );

    const log = root.toLogObject();

    expect(branchCause(log, withPolicy)).toMatchObject({
      details: { secret: "[REDACTED]" },
    });
    expect(branchCause(log, withoutPolicy)).toBe(SHARED);
    expect(JSON.stringify(log)).not.toContain("s3cr3t");
  });

  it("does not reach the shared cause when a branch without a policy comes first", () => {
    const { root, withPolicy, withoutPolicy } = branchesSharing(
      upstreamWithSecret(),
      "policy second",
    );

    const log = root.toLogObject();

    expect(branchCause(log, withoutPolicy)).toMatchObject({
      details: { secret: "s3cr3t" },
    });
    expect(branchCause(log, withPolicy)).toBe(SHARED);
  });

  it.each(["policy first", "policy second"] as const)(
    "masks the shared cause with %s when the cause carries the policy",
    (order) => {
      const upstream = upstreamWithSecret().redact(["secret"]);

      const log = branchesSharing(upstream, order).root.toLogObject();

      expect(JSON.stringify(log)).not.toContain("s3cr3t");
    },
  );

  it.each(["policy first", "policy second"] as const)(
    "masks the shared cause with %s when the root carries the policy",
    (order) => {
      const { root } = branchesSharing(upstreamWithSecret(), order);

      const log = root.redact(["secret"]).toLogObject();

      expect(JSON.stringify(log)).not.toContain("s3cr3t");
    },
  );
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
