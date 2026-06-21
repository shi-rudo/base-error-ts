import { describe, expect, it } from "vitest";

import { hasErrorCode, matchThrown } from "../index.js";

class NetworkError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

class TimeoutError extends NetworkError {}
class ParseError extends Error {}

describe("matchThrown", () => {
  it("matches constructors and subclasses", () => {
    const network = matchThrown(new NetworkError(500))
      .with(NetworkError, (error) => `network:${error.status}`)
      .otherwise(() => "fallback");
    const timeout = matchThrown(new TimeoutError(504))
      .with(NetworkError, (error) => `network:${error.status}`)
      .otherwise(() => "fallback");

    expect(network).toBe("network:500");
    expect(timeout).toBe("network:504");
  });

  it("passes the original unmatched value to the fallback", () => {
    const thrown = { reason: "not-an-error" };
    const received = matchThrown(thrown)
      .with(NetworkError, () => "network")
      .otherwise((value) => value);

    expect(received).toBe(thrown);
  });

  it("supports a matcher with no registered cases", () => {
    expect(matchThrown("failed").otherwise((value) => String(value))).toBe(
      "failed",
    );
  });

  it("does not evaluate cases before otherwise", () => {
    let calls = 0;
    const matcher = matchThrown(new NetworkError(500)).with(
      NetworkError,
      () => {
        calls++;
        return "network";
      },
    );

    expect(calls).toBe(0);
    expect(matcher.otherwise(() => "fallback")).toBe("network");
    expect(calls).toBe(1);
  });

  it("matches any constructor in a non-empty group", () => {
    const result = matchThrown(new ParseError("invalid"))
      .withAny([NetworkError, ParseError], (error) => error.constructor.name)
      .otherwise(() => "fallback");

    expect(result).toBe("ParseError");
  });

  it("snapshots constructor groups when they are registered", () => {
    const constructors: [
      typeof NetworkError,
      ...(typeof NetworkError | typeof ParseError)[],
    ] = [NetworkError];
    const matcher = matchThrown(new ParseError("invalid")).withAny(
      constructors,
      () => "matched",
    );
    constructors.push(ParseError);

    expect(matcher.otherwise(() => "fallback")).toBe("fallback");
  });

  it("matches reusable type guards", () => {
    const error = Object.assign(new Error("broken pipe"), { code: "EPIPE" });
    const result = matchThrown(error)
      .when(hasErrorCode("EPIPE"), (matched) => matched.code)
      .otherwise(() => "fallback");

    expect(result).toBe("EPIPE");
  });

  it("matches plain predicates against non-Error thrown values", () => {
    const result = matchThrown("failed")
      .when(
        (value) => typeof value === "string",
        (value) => String(value),
      )
      .otherwise(() => "fallback");

    expect(result).toBe("failed");
  });

  it("uses the first matching case and skips later cases", () => {
    let laterTests = 0;
    const result = matchThrown(new TimeoutError(504))
      .with(NetworkError, () => "first")
      .when(
        () => {
          laterTests++;
          return true;
        },
        () => "second",
      )
      .otherwise(() => "fallback");

    expect(result).toBe("first");
    expect(laterTests).toBe(0);
  });

  it("returns promise handlers without wrapping them", async () => {
    const promise = Promise.resolve("retried");
    const result = matchThrown(new NetworkError(503))
      .with(NetworkError, () => promise)
      .otherwise(() => "fallback");

    expect(result).toBe(promise);
    await expect(result).resolves.toBe("retried");
  });

  it("keeps branches from a partial matcher independent", () => {
    const base = matchThrown(new ParseError("invalid")).with(
      NetworkError,
      () => "network",
    );
    const parseBranch = base.with(ParseError, () => "parse");
    const otherBranch = base.when(
      () => true,
      () => "other",
    );

    expect(parseBranch.otherwise(() => "fallback")).toBe("parse");
    expect(otherBranch.otherwise(() => "fallback")).toBe("other");
    expect(base.otherwise(() => "fallback")).toBe("fallback");
  });

  it("does not evaluate predicates before otherwise", () => {
    let calls = 0;
    const matcher = matchThrown("failed").when(
      () => {
        calls++;
        return true;
      },
      () => "matched",
    );

    expect(calls).toBe(0);
    expect(matcher.otherwise(() => "fallback")).toBe("matched");
    expect(calls).toBe(1);
  });

  it("propagates predicate and handler errors", () => {
    const predicateFailure = new Error("predicate failed");
    const handlerFailure = new Error("handler failed");

    expect(() =>
      matchThrown("failed")
        .when(
          () => {
            throw predicateFailure;
          },
          () => "unreachable",
        )
        .otherwise(() => "fallback"),
    ).toThrow(predicateFailure);

    expect(() =>
      matchThrown(new NetworkError(500))
        .with(NetworkError, () => {
          throw handlerFailure;
        })
        .otherwise(() => "fallback"),
    ).toThrow(handlerFailure);
  });

  it("propagates Symbol.hasInstance and fallback errors", () => {
    const instanceFailure = new Error("instance check failed");
    const fallbackFailure = new Error("fallback failed");
    class ThrowingInstanceError extends Error {
      static override [Symbol.hasInstance](): boolean {
        throw instanceFailure;
      }
    }

    expect(() =>
      matchThrown("failed")
        .with(ThrowingInstanceError, () => "unreachable")
        .otherwise(() => "fallback"),
    ).toThrow(instanceFailure);

    expect(() =>
      matchThrown("failed").otherwise(() => {
        throw fallbackFailure;
      }),
    ).toThrow(fallbackFailure);
  });
});
