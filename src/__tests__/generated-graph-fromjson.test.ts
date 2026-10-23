import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { StructuredError } from "../index.js";
import { MAX_LOG_SIZE_MARKER } from "../errors/serializer-markers.js";
import { MAX_CAUSE_DEPTH } from "../errors/walker-bounds.js";
import {
  CORPUS,
  READ_LIMIT,
  buildGraph,
  rootPolicyWithoutRedactor,
  buildPayload,
  dataArb,
  structuredGraphArb,
  type DataSpec,
} from "./generated-graph.fixture.js";

type Log = Record<string, unknown>;

const PROPERTY_TIMEOUT = 120_000;

const DECISION_TYPES = {
  code: "string",
  category: "string",
  retryable: "boolean",
} as const;

function isLog(value: unknown): value is Log {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A payload with the structured envelope around generated data. */
const envelopeArb: fc.Arbitrary<DataSpec> = fc
  .record({
    retryable: fc.boolean(),
    details: dataArb,
    cause: dataArb,
    errors: fc.array(dataArb, { maxLength: 4 }),
  })
  .map(({ retryable, details, cause, errors }) => ({
    t: "object",
    proto: "plain",
    entries: [
      { key: "code", access: "value", value: { t: "text" } },
      { key: "category", access: "value", value: { t: "text" } },
      {
        key: "retryable",
        access: "value",
        value: { t: "boolean", value: retryable },
      },
      { key: "message", access: "value", value: { t: "text" } },
      { key: "details", access: "value", value: details },
      { key: "cause", access: "value", value: cause },
      { key: "errors", access: "value", value: { t: "array", items: errors } },
    ],
  }));

const payloadArb: fc.Arbitrary<DataSpec> = fc.oneof(dataArb, envelopeArb);

/**
 * Walks a log and the log of its reconstruction side by side, along `cause`
 * and the members of an aggregate, up to the cause-depth cap. A primitive on
 * that spine (a marker, a mask, a thrown string) comes back unchanged. So
 * does every decision field that the original log carries with its type.
 * Past the cap, the log and the reconstruction each write their own cut: a
 * plain-object cause ends in an empty container there, as data does.
 */
function expectSameCauseSpine(restored: unknown, original: unknown, hop = 0) {
  if (hop > MAX_CAUSE_DEPTH) return;
  if (!isLog(original)) {
    expect(restored, "a primitive on the cause spine").toEqual(original);
    return;
  }
  expect(isLog(restored), "a restored cause node").toBe(true);
  const node = restored as Log;
  for (const [field, type] of Object.entries(DECISION_TYPES)) {
    if (typeof original[field] === type) {
      expect(node[field], field).toBe(original[field]);
    }
  }
  expectSameCauseSpine(node.cause, original.cause, hop + 1);
  const members = original.errors;
  if (Array.isArray(members) && members.length > 0) {
    const restoredMembers = node.errors;
    expect(Array.isArray(restoredMembers), "restored members").toBe(true);
    members.forEach((member, position) =>
      expectSameCauseSpine(
        (restoredMembers as unknown[])[position],
        member,
        hop + 1,
      ),
    );
  }
}

describe("generated payloads: StructuredError.fromJSON", () => {
  it(
    "reconstructs a typed StructuredError from any payload without a throw",
    { timeout: PROPERTY_TIMEOUT },
    () => {
      fc.assert(
        fc.property(payloadArb, (spec) => {
          const payload = buildPayload(spec).value;

          const error = StructuredError.fromJSON(payload);

          expect(error).toBeInstanceOf(StructuredError);
          expect(typeof error.code).toBe("string");
          expect(typeof error.category).toBe("string");
          expect(typeof error.retryable).toBe("boolean");
          expect(typeof JSON.stringify(error)).toBe("string");
          expect(typeof error.toString()).toBe("string");
        }),
        CORPUS,
      );
    },
  );

  it(
    "reconstructs any JSON-like value without a throw",
    { timeout: PROPERTY_TIMEOUT },
    () => {
      fc.assert(
        fc.property(
          fc.anything({
            withBigInt: true,
            withBoxedValues: true,
            withDate: true,
            withMap: true,
            withNullPrototype: true,
            withObjectString: true,
            withSet: true,
            withSparseArray: true,
            withTypedArray: true,
          }),
          (payload) => {
            const error = StructuredError.fromJSON(payload);

            expect(error).toBeInstanceOf(StructuredError);
            expect(typeof JSON.stringify(error)).toBe("string");
          },
        ),
        CORPUS,
      );
    },
  );

  it(
    "restores the cause spine, its decision fields and the root instant of a logged graph",
    { timeout: PROPERTY_TIMEOUT },
    () => {
      fc.assert(
        fc.property(structuredGraphArb, (plan) => {
          const { root } = buildGraph(plan, {
            rootPolicy: rootPolicyWithoutRedactor(plan),
          });
          const json = JSON.stringify(root.toLogObject());
          fc.pre(!json.includes(MAX_LOG_SIZE_MARKER));
          const log: unknown = JSON.parse(json);

          const restored = StructuredError.fromJSON(log);
          const relog: unknown = JSON.parse(JSON.stringify(restored));

          const { timestampIso } = log as Log;
          if (typeof timestampIso === "string") {
            expect((relog as Log).timestampIso).toBe(timestampIso);
          }
          expectSameCauseSpine(relog, log);
        }),
        CORPUS,
      );
    },
  );

  it(
    "reads a foreign payload within the log budget",
    { timeout: PROPERTY_TIMEOUT },
    () => {
      fc.assert(
        fc.property(payloadArb, (spec) => {
          const payload = buildPayload(spec);

          const before = payload.reads();
          StructuredError.fromJSON(payload.value);
          const reads = payload.reads() - before;

          expect(reads).toBeLessThanOrEqual(READ_LIMIT);
        }),
        CORPUS,
      );
    },
  );
});
