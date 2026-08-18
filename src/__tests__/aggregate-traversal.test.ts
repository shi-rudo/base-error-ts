import { describe, expect, it } from "vitest";
import {
  everyCauseChain,
  filterCauseChain,
  findInCauseChain,
  getFirstRetryableCause,
  getRootCause,
  isChainRetryable,
  someCauseChain,
  someChainRetryable,
  StructuredError,
} from "../index.js";

const structured = (
  code: string,
  retryable: boolean,
  cause?: unknown,
): StructuredError<string, string> =>
  new StructuredError({
    code,
    category: "TEST",
    retryable,
    message: code,
    ...(cause !== undefined && { cause }),
  });

const messageOf = (value: unknown): string =>
  (value as { message?: string }).message ?? String(value);

/** OUTER -> AggregateError -> [BRANCH_A (retryable), BRANCH_B] */
const fanOut = (): StructuredError<string, string> =>
  structured(
    "OUTER",
    false,
    new AggregateError(
      [structured("BRANCH_A", true), structured("BRANCH_B", false)],
      "all branches failed",
    ),
  );

describe("aggregate traversal", () => {
  describe("the default stays linear", () => {
    it("does not see a retryable member", () => {
      expect(someChainRetryable(fanOut())).toBe(false);
      expect(isChainRetryable(fanOut())).toBe(false);
    });

    it("still accepts a plain maxDepth number", () => {
      const chain = structured("A", false, structured("B", true));

      expect(someChainRetryable(chain, 1)).toBe(true);
      expect(someChainRetryable(chain, 0)).toBe(false);
    });
  });

  describe("with { aggregates: true }", () => {
    it("finds a retryable member of an aggregate", () => {
      expect(someChainRetryable(fanOut(), { aggregates: true })).toBe(true);
      expect(isChainRetryable(fanOut(), { aggregates: true })).toBe(true);
    });

    it("returns the first retryable member", () => {
      const first = getFirstRetryableCause(fanOut(), { aggregates: true });

      expect((first as { code?: string })?.code).toBe("BRANCH_A");
    });

    it("visits the cause before the members, depth-first", () => {
      const error = structured(
        "OUTER",
        false,
        new AggregateError(
          [
            structured("BRANCH_A", false, structured("BRANCH_A_CAUSE", false)),
            structured("BRANCH_B", false),
          ],
          "aggregate",
        ),
      );

      const visited = filterCauseChain(error, () => true, {
        aggregates: true,
      }).map(messageOf);

      expect(visited).toEqual([
        "OUTER",
        "aggregate",
        "BRANCH_A",
        "BRANCH_A_CAUSE",
        "BRANCH_B",
      ]);
    });

    it("descends into a nested aggregate", () => {
      const error = structured(
        "OUTER",
        false,
        new AggregateError(
          [new AggregateError([structured("DEEP", true)], "inner")],
          "outer",
        ),
      );

      expect(someChainRetryable(error, { aggregates: true })).toBe(true);
    });

    it("reads members by shape, not by AggregateError identity", () => {
      class FanOutError extends Error {
        public readonly errors: readonly unknown[];
        public constructor(errors: readonly unknown[]) {
          super("fan-out");
          this.errors = errors;
        }
      }

      const error = structured(
        "OUTER",
        false,
        new FanOutError([structured("BRANCH", true)]),
      );

      expect(someChainRetryable(error, { aggregates: true })).toBe(true);
    });

    it("counts a member hop against maxDepth", () => {
      const error = fanOut();

      expect(someChainRetryable(error, { aggregates: true, maxDepth: 1 })).toBe(
        false,
      );
      expect(someChainRetryable(error, { aggregates: true, maxDepth: 2 })).toBe(
        true,
      );
    });

    it("stops at the node budget on a wide aggregate", () => {
      const branches = Array.from({ length: 50 }, (_, index) =>
        structured(`BRANCH_${index}`, index === 49),
      );
      const error = structured("OUTER", false, new AggregateError(branches));

      expect(
        someChainRetryable(error, { aggregates: true, maxNodes: 10 }),
      ).toBe(false);
      expect(someChainRetryable(error, { aggregates: true })).toBe(true);
    });

    it("terminates when a member points back at the root", () => {
      const aggregate = new AggregateError([], "self-referencing");
      const error = structured("OUTER", false, aggregate);
      aggregate.errors.push(error);

      expect(
        filterCauseChain(error, () => true, { aggregates: true }),
      ).toHaveLength(2);
    });

    it("evaluates every and some over the whole tree", () => {
      const error = fanOut();

      expect(
        someCauseChain(
          error,
          (e) => (e as { code?: string }).code === "BRANCH_B",
          {
            aggregates: true,
          },
        ),
      ).toBe(true);
      expect(
        everyCauseChain(
          error,
          (e) => (e as { code?: string }).code !== undefined,
          {
            aggregates: true,
          },
        ),
      ).toBe(false); // the AggregateError node itself has no code
    });

    it("finds a member with findInCauseChain", () => {
      const found = findInCauseChain(
        fanOut(),
        (e) => (e as { code?: string }).code === "BRANCH_B",
        { aggregates: true },
      );

      expect((found as { code?: string })?.code).toBe("BRANCH_B");
    });
  });

  describe("getRootCause stays linear", () => {
    it("returns the aggregate itself, not one of its members", () => {
      const root = getRootCause(fanOut());

      expect((root as Error).name).toBe("AggregateError");
    });
  });
});
