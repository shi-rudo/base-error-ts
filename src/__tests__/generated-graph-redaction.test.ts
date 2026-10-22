import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { isCauseSpineMarker } from "../errors/serializer-markers.js";
import {
  ALLOWABLE_KEYS,
  CORPUS,
  DENIABLE_KEYS,
  DENIED_TOKEN,
  buildGraph,
  graphArb,
  maskArb,
  stringMaskArb,
} from "./generated-graph.fixture.js";

type Log = Record<string, unknown>;

type AllowRule = {
  readonly allowed: ReadonlySet<string>;
  readonly mask: string;
};

const PROPERTY_TIMEOUT = 120_000;

const ROOT_ENVELOPE: ReadonlySet<string> = new Set([
  "name",
  "message",
  "stack",
  "code",
  "category",
  "retryable",
  "timestamp",
  "timestampIso",
]);

const CAUSE_ENVELOPE: ReadonlySet<string> = new Set([
  "name",
  "message",
  "stack",
  "code",
  "category",
  "retryable",
]);

function isLog(value: unknown): value is Log {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrimitive(value: unknown): boolean {
  return (
    value === null || (typeof value !== "object" && typeof value !== "function")
  );
}

/**
 * A data leaf survives only under an allowed key. A leaf in an array has no
 * key of its own, so the key of the array decides.
 */
function expectMaskedData(value: unknown, key: string, rule: AllowRule) {
  if (Array.isArray(value)) {
    for (const item of value) expectMaskedData(item, key, rule);
    return;
  }
  if (isLog(value)) {
    for (const inner of Object.keys(value)) {
      expectMaskedData(value[inner], inner, rule);
    }
    return;
  }
  if (rule.allowed.has(key)) return;
  expect(value, `a data leaf under "${key}"`).toBe(rule.mask);
}

function expectCauseSlot(value: unknown, rule: AllowRule) {
  if (value === null || value === undefined || isCauseSpineMarker(value)) {
    return;
  }
  if (isLog(value)) {
    expectNodeShape(value, CAUSE_ENVELOPE, rule);
    return;
  }
  expectMaskedData(value, "cause", rule);
}

/**
 * The shape that the allow-list guarantees, stated from the position of each
 * value: an envelope key keeps a primitive, `cause` and a list under `errors`
 * hold cause nodes or markers, and every other value is data.
 */
function expectNodeShape(
  node: Log,
  envelope: ReadonlySet<string>,
  rule: AllowRule,
) {
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (envelope.has(key) && isPrimitive(value)) continue;
    if (key === "cause") {
      expectCauseSlot(value, rule);
    } else if (key === "errors" && Array.isArray(value)) {
      for (const member of value) expectCauseSlot(member, rule);
    } else {
      expectMaskedData(value, key, rule);
    }
  }
}

describe("generated cause graphs: redaction", () => {
  it(
    "masks every data leaf outside the allowed keys under redactAllow",
    { timeout: PROPERTY_TIMEOUT },
    () => {
      fc.assert(
        fc.property(
          graphArb,
          fc.subarray([...ALLOWABLE_KEYS]),
          stringMaskArb,
          (plan, allowed, mask) => {
            const { root } = buildGraph(plan, {
              rootPolicy: {
                t: "redactAllow",
                keys: allowed,
                mask: { t: "string", value: mask },
              },
            });

            const log = root.toLogObject();

            expectNodeShape(log, ROOT_ENVELOPE, {
              allowed: new Set(allowed),
              mask,
            });
          },
        ),
        CORPUS,
      );
    },
  );

  it(
    "never writes a value placed under a denied key under redact",
    { timeout: PROPERTY_TIMEOUT },
    () => {
      fc.assert(
        fc.property(
          graphArb,
          fc.subarray([...DENIABLE_KEYS], { minLength: 1 }),
          maskArb,
          (plan, denied, mask) => {
            const { root } = buildGraph(plan, {
              deniedKeys: new Set(denied),
              rootPolicy: { t: "redact", keys: denied, mask },
            });

            const log = JSON.stringify(root.toLogObject());

            expect(log).not.toContain(DENIED_TOKEN);
          },
        ),
        CORPUS,
      );
    },
  );
});
