import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { LOG_REDACTION_FAILED_MARKER } from "../errors/serializer-markers.js";
import { MAX_LOG_NODES } from "../errors/walker-bounds.js";
import {
  CORPUS,
  THROWN_TOKEN,
  buildGraph,
  rootPolicyWithoutRedactor,
  graphArb,
  type GraphPlan,
  type NodeKind,
} from "./generated-graph.fixture.js";

type Log = Record<string, unknown>;

/** The node kinds whose log node is an error with the `cause` and members of the plan. */
const LINKED_ERROR_KINDS: ReadonlySet<NodeKind> = new Set([
  "structured",
  "base",
  "aggregate",
  "nativeError",
  "nativeAggregate",
]);

const PROPERTY_TIMEOUT = 120_000;

function isLog(value: unknown): value is Log {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function kindAt(plan: GraphPlan, index: number): NodeKind {
  return index === 0 ? plan.rootKind : plan.nodes[index]!.kind;
}

/**
 * Walks the log and the plan side by side, along `cause` and the members of
 * an aggregate. A structured node that the log writes as a record keeps its
 * decision fields with their types. A marker, a mask or a custom redactor
 * ends the walk on that branch.
 */
function expectDecisionFields(log: unknown, plan: GraphPlan, index: number) {
  if (!isLog(log)) return;
  const spec = plan.nodes[index]!;
  const kind = kindAt(plan, index);
  if (spec.policy.t === "redactWith") return;
  if (kind === "structured" || kind === "aggregate") {
    expect({
      code: log.code,
      category: log.category,
      retryable: log.retryable,
    }).toEqual({
      code: spec.code,
      category: spec.category,
      retryable: spec.retryable,
    });
  }
  if (log.message === LOG_REDACTION_FAILED_MARKER) return;
  if (!LINKED_ERROR_KINDS.has(kind)) return;

  const nodeCount = plan.nodes.length;
  if (spec.cause !== undefined) {
    expectDecisionFields(log.cause, plan, spec.cause % nodeCount);
  }
  const members = log.errors;
  if (
    (kind === "aggregate" || kind === "nativeAggregate") &&
    Array.isArray(members)
  ) {
    spec.members.forEach((member, position) =>
      expectDecisionFields(members[position], plan, member % nodeCount),
    );
  }
}

describe("generated cause graphs: the log build", () => {
  it(
    "logs and renders every graph without a throw, whatever its root policy",
    { timeout: PROPERTY_TIMEOUT },
    () => {
      fc.assert(
        fc.property(graphArb, (plan) => {
          const { root } = buildGraph(plan);

          expect(() => root.toLogObject()).not.toThrow();
          expect(() => root.toString()).not.toThrow();
        }),
        CORPUS,
      );
    },
  );

  it(
    "writes a log that JSON.stringify renders, for every built-in root policy",
    { timeout: PROPERTY_TIMEOUT },
    () => {
      fc.assert(
        fc.property(graphArb, (plan) => {
          const { root } = buildGraph(plan, {
            rootPolicy: rootPolicyWithoutRedactor(plan),
          });

          const fromLog = JSON.stringify(root.toLogObject());
          const fromError = JSON.stringify(root);

          expect(typeof fromLog).toBe("string");
          expect(typeof fromError).toBe("string");
        }),
        CORPUS,
      );
    },
  );

  it(
    "never writes the payload of a thrown value or a rejected hook result",
    { timeout: PROPERTY_TIMEOUT },
    () => {
      fc.assert(
        fc.property(graphArb, (plan) => {
          const { root } = buildGraph(plan, {
            rootPolicy: rootPolicyWithoutRedactor(plan),
          });

          const log = JSON.stringify(root.toLogObject());
          const render = root.toString();

          expect(log).not.toContain(THROWN_TOKEN);
          expect(render).not.toContain(THROWN_TOKEN);
        }),
        CORPUS,
      );
    },
  );

  it(
    "keeps the typed decision fields of every structured node that the log writes",
    { timeout: PROPERTY_TIMEOUT },
    () => {
      fc.assert(
        fc.property(graphArb, (plan) => {
          const { root } = buildGraph(plan);

          const log = root.toLogObject();

          expectDecisionFields(log, plan, 0);
        }),
        CORPUS,
      );
    },
  );

  it(
    "reads foreign values within the log budget",
    { timeout: PROPERTY_TIMEOUT },
    () => {
      fc.assert(
        fc.property(graphArb, (plan) => {
          const graph = buildGraph(plan);

          const beforeLog = graph.reads();
          graph.root.toLogObject();
          const logReads = graph.reads() - beforeLog;
          const beforeRender = graph.reads();
          graph.root.toString();
          const renderReads = graph.reads() - beforeRender;

          expect(logReads).toBeLessThanOrEqual(MAX_LOG_NODES);
          expect(renderReads).toBeLessThanOrEqual(MAX_LOG_NODES);
        }),
        CORPUS,
      );
    },
  );
});
