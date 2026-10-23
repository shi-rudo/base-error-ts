/**
 * Generated cause graphs for the property tests of the log build, the
 * redaction and `StructuredError.fromJSON`. fast-check generates a plan of
 * plain data, and `buildGraph` turns the plan into live errors, causes,
 * aggregate members and hostile values. A failure therefore shrinks to a
 * small plan that prints as JSON.
 */
import fc from "fast-check";

import {
  BaseError,
  StructuredAggregateError,
  StructuredError,
  partialMask,
  type RedactMask,
} from "../index.js";
import {
  CIRCULAR_CAUSE_CHAIN_MARKER,
  LOG_REDACTION_FAILED_MARKER,
  MAX_CAUSE_DEPTH_MARKER,
  MAX_LOG_SIZE_MARKER,
  SHARED_CAUSE_MARKER,
  UNRENDERABLE_CAUSE_MARKER,
  UNSERIALIZABLE_CAUSE_MARKER,
  UNSERIALIZABLE_VALUE_MARKER,
  circularObjectMarker,
  moreAggregatedErrorsMarker,
} from "../errors/serializer-markers.js";

/**
 * The fixed corpus. A failure prints its seed and its path; pass both to
 * `fc.assert` to replay the shrunk counterexample.
 */
export const CORPUS = { seed: 20_261_022, numRuns: 120 } as const;

/**
 * The payload of every value that the graph throws. It must never reach an
 * output.
 */
export const THROWN_TOKEN = "THROWN-PAYLOAD";

/** The prefix of every string that the graph places under a denied key. */
export const DENIED_TOKEN = "DENIED-VALUE";

const PLAIN_TOKEN = "PLAIN-VALUE";

/**
 * Keys that a policy of the generated graph may deny. No decision field is
 * among them.
 */
export const DENIABLE_KEYS = [
  "secret",
  "tokens",
  "b",
  "details",
  "message",
  "name",
  "stack",
  "timestamp",
] as const;

/** Keys that a policy of the generated graph may allow. All are data keys. */
export const ALLOWABLE_KEYS = ["a", "userId", "note"] as const;

const DATA_KEYS = ["a", "b", "note", "userId", "secret", "tokens"];
const ENVELOPE_KEYS = [
  "name",
  "message",
  "stack",
  "code",
  "category",
  "retryable",
  "timestamp",
  "timestampIso",
  "cause",
  "errors",
  "details",
];
const HAZARD_KEYS = [
  "__proto__",
  "constructor",
  "prototype",
  "toJSON",
  "",
  "0",
];

const MARKER_LOOKALIKES = [
  CIRCULAR_CAUSE_CHAIN_MARKER,
  SHARED_CAUSE_MARKER,
  MAX_CAUSE_DEPTH_MARKER,
  UNSERIALIZABLE_CAUSE_MARKER,
  UNSERIALIZABLE_VALUE_MARKER,
  MAX_LOG_SIZE_MARKER,
  LOG_REDACTION_FAILED_MARKER,
  UNRENDERABLE_CAUSE_MARKER,
  moreAggregatedErrorsMarker(3),
  circularObjectMarker("Object", ["a"]),
  "[REDACTED]",
];

export type LeafSpec =
  | { readonly t: "text" }
  | { readonly t: "marker"; readonly marker: string }
  | { readonly t: "number"; readonly value: number }
  | { readonly t: "boolean"; readonly value: boolean }
  | { readonly t: "null" }
  | { readonly t: "undefined" }
  | { readonly t: "bigint"; readonly value: bigint }
  | { readonly t: "symbol" }
  | { readonly t: "function" }
  | { readonly t: "date"; readonly valid: boolean }
  | { readonly t: "boxed"; readonly kind: "String" | "Number" | "Boolean" }
  | { readonly t: "map" }
  | { readonly t: "set" }
  | { readonly t: "typedArray" }
  | { readonly t: "hostileProxy" }
  | { readonly t: "revokedProxy" }
  | { readonly t: "throwingToJSON" }
  | { readonly t: "lazyChain" }
  | { readonly t: "backRef"; readonly up: number }
  | { readonly t: "shared"; readonly id: number }
  | { readonly t: "errorRef"; readonly node: number }
  | { readonly t: "diamond"; readonly depth: number }
  | { readonly t: "wideArray" };

type Access =
  "value" | "hidden" | "getter" | "statefulGetter" | "throwingGetter";

export type EntrySpec = {
  readonly key: string;
  readonly access: Access;
  readonly value: DataSpec;
};

export type DataSpec =
  | LeafSpec
  | {
      readonly t: "object";
      readonly proto: "plain" | "null" | "custom";
      readonly entries: readonly EntrySpec[];
    }
  | { readonly t: "array"; readonly items: readonly DataSpec[] };

export type MaskSpec =
  | { readonly t: "default" }
  | { readonly t: "string"; readonly value: string }
  | { readonly t: "constantFn" }
  | { readonly t: "objectFn" }
  | { readonly t: "bigintFn" }
  | { readonly t: "dateFn" }
  | { readonly t: "throwingFn" }
  | { readonly t: "partial" };

export type PolicySpec =
  | { readonly t: "none" }
  | {
      readonly t: "redact";
      readonly keys: readonly string[];
      readonly mask: MaskSpec;
    }
  | {
      readonly t: "redactAllow";
      readonly keys: readonly string[];
      readonly mask: MaskSpec;
    }
  | {
      readonly t: "redactWith";
      readonly output: "identity" | "throws" | readonly EntrySpec[];
    };

type OwnFieldsSpec =
  | { readonly t: "none" }
  | { readonly t: "record"; readonly entries: readonly EntrySpec[] }
  | { readonly t: "throws" }
  | { readonly t: "nonRecord" };

export type NodeKind =
  | "structured"
  | "base"
  | "aggregate"
  | "nativeError"
  | "nativeAggregate"
  | "plainObject"
  | "primitive"
  | "hostileProxy"
  | "lazyCause"
  | "longChain";

export type RootKind = "structured" | "base" | "aggregate";

export type NodeSpec = {
  readonly kind: NodeKind;
  readonly code: string;
  readonly category: string;
  readonly retryable: boolean;
  readonly details: DataSpec | undefined;
  readonly ownFields: OwnFieldsSpec;
  readonly foreign: readonly EntrySpec[];
  readonly cause: number | undefined;
  readonly members: readonly number[];
  readonly primitive: LeafSpec;
  readonly chainLength: number;
  readonly policy: PolicySpec;
};

export type GraphPlan = {
  readonly rootKind: RootKind;
  readonly nodes: readonly NodeSpec[];
  readonly shared: readonly (readonly EntrySpec[])[];
};

const keyArb = fc.constantFrom(...DATA_KEYS, ...ENVELOPE_KEYS, ...HAZARD_KEYS);

const accessArb: fc.Arbitrary<Access> = fc.oneof(
  { arbitrary: fc.constant("value" as const), weight: 6 },
  fc.constantFrom(
    "hidden" as const,
    "getter" as const,
    "statefulGetter" as const,
    "throwingGetter" as const,
  ),
);

const leafArb: fc.Arbitrary<LeafSpec> = fc.oneof(
  { arbitrary: fc.constant({ t: "text" } as const), weight: 8 },
  {
    arbitrary: fc.record({
      t: fc.constant("marker" as const),
      marker: fc.constantFrom(...MARKER_LOOKALIKES),
    }),
    weight: 2,
  },
  fc.record({ t: fc.constant("number" as const), value: fc.double() }),
  fc.record({ t: fc.constant("boolean" as const), value: fc.boolean() }),
  fc.constant({ t: "null" } as const),
  fc.constant({ t: "undefined" } as const),
  fc.record({ t: fc.constant("bigint" as const), value: fc.bigInt() }),
  fc.record({ t: fc.constant("date" as const), valid: fc.boolean() }),
  fc.record({
    t: fc.constant("boxed" as const),
    kind: fc.constantFrom(
      "String" as const,
      "Number" as const,
      "Boolean" as const,
    ),
  }),
  fc.constantFrom<LeafSpec>(
    { t: "symbol" },
    { t: "function" },
    { t: "map" },
    { t: "set" },
    { t: "typedArray" },
    { t: "hostileProxy" },
    { t: "revokedProxy" },
    { t: "throwingToJSON" },
    { t: "lazyChain" },
  ),
  fc.record({ t: fc.constant("backRef" as const), up: fc.nat({ max: 5 }) }),
  fc.record({ t: fc.constant("shared" as const), id: fc.nat({ max: 2 }) }),
  fc.record({ t: fc.constant("errorRef" as const), node: fc.nat({ max: 7 }) }),
  {
    arbitrary: fc.oneof(
      fc.record({
        t: fc.constant("diamond" as const),
        depth: fc.integer({ min: 1, max: 40 }),
      }),
      fc.constant({ t: "wideArray" } as const),
    ),
    weight: 1,
  },
);

const generatedData = fc.letrec<{
  data: DataSpec;
  entry: EntrySpec;
}>((tie) => ({
  data: fc.oneof(
    { maxDepth: 4, depthSize: "small", withCrossShrink: true },
    { arbitrary: leafArb, weight: 5 },
    {
      arbitrary: fc.record({
        t: fc.constant("object" as const),
        proto: fc.constantFrom(
          "plain" as const,
          "null" as const,
          "custom" as const,
        ),
        entries: fc.array(tie("entry"), { maxLength: 4 }),
      }),
      weight: 3,
    },
    {
      arbitrary: fc.record({
        t: fc.constant("array" as const),
        items: fc.array(tie("data"), { maxLength: 4 }),
      }),
      weight: 1,
    },
  ),
  entry: fc.record({ key: keyArb, access: accessArb, value: tie("data") }),
}));

export const dataArb: fc.Arbitrary<DataSpec> = generatedData.data;
const entryArb: fc.Arbitrary<EntrySpec> = generatedData.entry;

export const maskArb: fc.Arbitrary<MaskSpec> = fc.oneof(
  { arbitrary: fc.constant({ t: "default" } as const), weight: 3 },
  fc.record({
    t: fc.constant("string" as const),
    value: fc.constantFrom("[M]", "", SHARED_CAUSE_MARKER),
  }),
  fc.constantFrom<MaskSpec>(
    { t: "constantFn" },
    { t: "objectFn" },
    { t: "bigintFn" },
    { t: "dateFn" },
    { t: "throwingFn" },
    { t: "partial" },
  ),
);

/** A string mask, so that every masked leaf reads as one known value. */
export const stringMaskArb: fc.Arbitrary<string> = fc.constantFrom(
  "[REDACTED]",
  "[M]",
  SHARED_CAUSE_MARKER,
);

const policyArb: fc.Arbitrary<PolicySpec> = fc.oneof(
  { arbitrary: fc.constant({ t: "none" } as const), weight: 4 },
  fc.record({
    t: fc.constant("redact" as const),
    keys: fc.subarray([...DENIABLE_KEYS]),
    mask: maskArb,
  }),
  fc.record({
    t: fc.constant("redactAllow" as const),
    keys: fc.subarray([...ALLOWABLE_KEYS]),
    mask: maskArb,
  }),
  fc.record({
    t: fc.constant("redactWith" as const),
    output: fc.oneof(
      fc.constantFrom("identity" as const, "throws" as const),
      fc.array(entryArb, { maxLength: 3 }),
    ),
  }),
);

const ownFieldsArb: fc.Arbitrary<OwnFieldsSpec> = fc.oneof(
  { arbitrary: fc.constant({ t: "none" } as const), weight: 3 },
  fc.record({
    t: fc.constant("record" as const),
    entries: fc.array(entryArb, { maxLength: 4 }),
  }),
  fc.constantFrom<OwnFieldsSpec>({ t: "throws" }, { t: "nonRecord" }),
);

const nodeArb: fc.Arbitrary<NodeSpec> = fc.record({
  kind: fc.constantFrom<NodeKind>(
    "structured",
    "base",
    "aggregate",
    "nativeError",
    "nativeAggregate",
    "plainObject",
    "primitive",
    "hostileProxy",
    "lazyCause",
    "longChain",
  ),
  code: fc.constantFrom("ALPHA", "BETA_FAILED", SHARED_CAUSE_MARKER),
  category: fc.constantFrom("INTERNAL", "PERSISTENCE", "NETWORK"),
  retryable: fc.boolean(),
  details: fc.option(dataArb, { nil: undefined }),
  ownFields: ownFieldsArb,
  foreign: fc.array(entryArb, { maxLength: 3 }),
  cause: fc.option(fc.nat({ max: 7 }), { nil: undefined }),
  members: fc.array(fc.nat({ max: 7 }), { maxLength: 4 }),
  primitive: leafArb,
  chainLength: fc.integer({ min: 1, max: 130 }),
  policy: policyArb,
});

export const graphArb: fc.Arbitrary<GraphPlan> = fc.record({
  rootKind: fc.constantFrom<RootKind>("structured", "base", "aggregate"),
  nodes: fc.array(nodeArb, { minLength: 1, maxLength: 8 }),
  shared: fc.array(fc.array(entryArb, { maxLength: 3 }), {
    minLength: 3,
    maxLength: 3,
  }),
});

/**
 * A plan whose root is a `StructuredError`, so a round trip has a typed root
 * to restore.
 */
export const structuredGraphArb: fc.Arbitrary<GraphPlan> = graphArb.map(
  (plan) => ({
    ...plan,
    rootKind: plan.rootKind === "base" ? "structured" : plan.rootKind,
  }),
);

/**
 * The node kinds whose `cause`, members and fields the builder wires from the
 * plan.
 */
const WIRED_KINDS: ReadonlySet<NodeKind> = new Set([
  "structured",
  "base",
  "aggregate",
  "nativeError",
  "nativeAggregate",
  "plainObject",
  "longChain",
]);

/**
 * The root policy of the plan without a custom redactor. The output of a
 * custom redactor on the logged error is consumer-owned, so no property of
 * JSON safety or of content holds for it.
 */
export function rootPolicyWithoutRedactor(plan: GraphPlan): PolicySpec {
  const policy = plan.nodes[0]?.policy ?? { t: "none" };
  return policy.t === "redactWith" ? { t: "none" } : policy;
}

const LIBRARY_KINDS: ReadonlySet<NodeKind> = new Set([
  "structured",
  "base",
  "aggregate",
]);

const KEPT_LIBRARY_KEYS: ReadonlySet<string> = new Set([
  "code",
  "category",
  "retryable",
  "toJSON",
]);

/**
 * Whether a foreign entry goes onto a node. An error of this library keeps
 * its decision fields and an aggregate its member list, because the
 * properties compare both with the plan. An error of this library also keeps
 * its `toJSON`: code that replaces it owns what `JSON.stringify` then does.
 */
function keepsForeignEntry(kind: NodeKind, entry: EntrySpec): boolean {
  if (LIBRARY_KINDS.has(kind) && KEPT_LIBRARY_KEYS.has(entry.key)) return false;
  const aggregate = kind === "aggregate" || kind === "nativeAggregate";
  return !(aggregate && entry.key === "errors");
}

const ownFieldsHooks = new WeakMap<object, () => unknown>();

function ownFieldsOf(error: object): Record<string, unknown> {
  const hook = ownFieldsHooks.get(error);
  return (hook ? hook() : {}) as Record<string, unknown>;
}

class GeneratedBaseError extends BaseError<"GeneratedBaseError"> {
  protected override buildOwnLogFields(): Record<string, unknown> {
    return ownFieldsOf(this);
  }
}

class GeneratedStructuredError extends StructuredError<string, string> {
  protected override buildOwnLogFields(): Record<string, unknown> {
    return ownFieldsOf(this);
  }
}

class GeneratedAggregateError extends StructuredAggregateError<string, string> {
  protected override buildOwnLogFields(): Record<string, unknown> {
    return ownFieldsOf(this);
  }
}

export type BuildOptions = {
  /** Strings under these keys carry {@link DENIED_TOKEN}. */
  readonly deniedKeys?: ReadonlySet<string>;
  /** The root policy. `"plan"` applies the policy of node 0. */
  readonly rootPolicy?: PolicySpec | "plan";
};

export type BuiltGraph = {
  readonly root: BaseError<string>;
  /** Foreign reads so far: getters, Proxy traps and lazy structures. */
  readonly reads: () => number;
};

type Placement = {
  readonly denied: boolean;
  readonly ancestors: readonly object[];
};

const TOP: Placement = { denied: false, ancestors: [] };

/** Builds the live graph of `plan`. Every call builds fresh, independent values. */
export function buildGraph(
  plan: GraphPlan,
  options: BuildOptions = {},
): BuiltGraph {
  const deniedKeys = options.deniedKeys ?? new Set<string>();
  let reads = 0;
  let serial = 0;
  const nodes: unknown[] = [];
  const memberLists = new Map<number, unknown[]>();
  const chainTails = new Map<number, Error>();
  const sharedObjects = new Map<number, object>();
  const sharedInProgress = new Set<number>();

  const text = (denied: boolean): string =>
    `${denied ? DENIED_TOKEN : PLAIN_TOKEN}-${serial++}`;

  const thrown = (): never => {
    throw {
      message: THROWN_TOKEN,
      toJSON: () => THROWN_TOKEN,
      toString: () => THROWN_TOKEN,
    };
  };

  const counted = <T>(value: T): T => {
    reads++;
    return value;
  };

  const hostileProxy = (): object => {
    const trap = (): never => {
      reads++;
      return thrown();
    };
    return new Proxy(
      {},
      {
        get: trap,
        has: trap,
        ownKeys: trap,
        getOwnPropertyDescriptor: trap,
        getPrototypeOf: trap,
        defineProperty: trap,
        set: trap,
        deleteProperty: trap,
        isExtensible: trap,
        preventExtensions: trap,
      },
    );
  };

  const lazyChain = (): object => {
    const link = {};
    Object.defineProperty(link, "next", {
      get: () => counted(lazyChain()),
      enumerable: true,
    });
    return link;
  };

  const diamond = (depth: number): object => {
    let node: object = { leaf: text(false) };
    for (let level = 0; level < depth; level++) {
      const below = node;
      node = {};
      for (const side of ["left", "right"]) {
        Object.defineProperty(node, side, {
          get: () => counted(below),
          enumerable: true,
        });
      }
    }
    return node;
  };

  const wideArray = (): unknown[] =>
    new Proxy<unknown[]>([], {
      get(target, key, receiver) {
        if (key === "length") return counted(1e9);
        if (typeof key === "string" && /^\d+$/.test(key)) {
          return counted(PLAIN_TOKEN);
        }
        return Reflect.get(target, key, receiver) as unknown;
      },
    });

  const nodeAt = (index: number): unknown => nodes[index % nodes.length];

  function leaf(spec: LeafSpec, placement: Placement): unknown {
    switch (spec.t) {
      case "text":
        return text(placement.denied);
      case "marker":
        return spec.marker;
      case "number":
      case "boolean":
      case "bigint":
        return spec.value;
      case "null":
        return null;
      case "undefined":
        return undefined;
      case "symbol":
        return Symbol(text(placement.denied));
      case "function":
        return function generatedFunction() {};
      case "date":
        return new Date(spec.valid ? 0 : Number.NaN);
      case "boxed":
        if (spec.kind === "String") return new String(text(placement.denied));
        return spec.kind === "Number" ? new Number(1) : new Boolean(false);
      case "map":
        return new Map([[text(false), text(false)]]);
      case "set":
        return new Set([text(false)]);
      case "typedArray":
        return new Uint8Array([1, 2, 3]);
      case "hostileProxy":
        return hostileProxy();
      case "revokedProxy": {
        const { proxy, revoke } = Proxy.revocable({}, {});
        revoke();
        return proxy;
      }
      case "throwingToJSON":
        return {
          toJSON: () => {
            reads++;
            return thrown();
          },
        };
      case "lazyChain":
        return lazyChain();
      case "backRef": {
        const { ancestors } = placement;
        if (ancestors.length === 0) return text(placement.denied);
        return ancestors[ancestors.length - 1 - (spec.up % ancestors.length)];
      }
      case "shared":
        return sharedObject(spec.id, placement);
      case "errorRef":
        return nodeAt(spec.node);
      case "diamond":
        return diamond(spec.depth);
      case "wideArray":
        return wideArray();
    }
  }

  function sharedObject(id: number, placement: Placement): unknown {
    const existing = sharedObjects.get(id);
    if (existing) return existing;
    if (sharedInProgress.has(id)) return text(placement.denied);
    sharedInProgress.add(id);
    const target = {};
    sharedObjects.set(id, target);
    for (const entry of plan.shared[id] ?? []) {
      defineEntry(target, entry, TOP);
    }
    sharedInProgress.delete(id);
    return target;
  }

  function data(spec: DataSpec, placement: Placement): unknown {
    if (spec.t === "array") {
      const array: unknown[] = [];
      const inside = {
        ...placement,
        ancestors: [...placement.ancestors, array],
      };
      for (const item of spec.items) array.push(data(item, inside));
      return array;
    }
    if (spec.t === "object") {
      const target: object =
        spec.proto === "null"
          ? Object.create(null)
          : spec.proto === "custom"
            ? Object.create({ inherited: PLAIN_TOKEN })
            : {};
      for (const entry of spec.entries) defineEntry(target, entry, placement);
      return target;
    }
    return leaf(spec, placement);
  }

  function defineEntry(
    target: object,
    entry: EntrySpec,
    placement: Placement,
  ): void {
    const inside: Placement = {
      denied: placement.denied || deniedKeys.has(entry.key),
      ancestors: [...placement.ancestors, target],
    };
    const descriptor = { configurable: true, enumerable: true };
    switch (entry.access) {
      case "value":
      case "hidden":
        Object.defineProperty(target, entry.key, {
          ...descriptor,
          enumerable: entry.access === "value",
          writable: true,
          value: data(entry.value, inside),
        });
        return;
      case "getter": {
        const value = data(entry.value, inside);
        Object.defineProperty(target, entry.key, {
          ...descriptor,
          get: () => counted(value),
        });
        return;
      }
      case "statefulGetter":
        Object.defineProperty(target, entry.key, {
          ...descriptor,
          get: () => counted(text(inside.denied)),
        });
        return;
      case "throwingGetter":
        Object.defineProperty(target, entry.key, {
          ...descriptor,
          get: () => {
            reads++;
            return thrown();
          },
        });
        return;
    }
  }

  function record(entries: readonly EntrySpec[]): Record<string, unknown> {
    const target: Record<string, unknown> = {};
    for (const entry of entries) defineEntry(target, entry, TOP);
    return target;
  }

  function mask(spec: MaskSpec): { mask?: RedactMask } {
    switch (spec.t) {
      case "default":
        return {};
      case "string":
        return { mask: spec.value };
      case "constantFn":
        return { mask: () => "[FN]" };
      case "objectFn":
        return { mask: () => ({ masked: true }) };
      case "bigintFn":
        return { mask: () => 1n };
      case "dateFn":
        return { mask: () => new Date(0) };
      case "throwingFn":
        return {
          mask: () => {
            reads++;
            return thrown();
          },
        };
      case "partial":
        return { mask: partialMask({ keepStart: 2, keepEnd: 2 }) };
    }
  }

  function applyPolicy(error: BaseError<string>, policy: PolicySpec): void {
    switch (policy.t) {
      case "none":
        return;
      case "redact":
        error.redact([...policy.keys], mask(policy.mask));
        return;
      case "redactAllow":
        error.redactAllow([...policy.keys], mask(policy.mask));
        return;
      case "redactWith": {
        const { output } = policy;
        error.redactWith(
          output === "identity"
            ? (log) => log
            : output === "throws"
              ? () => thrown()
              : () => record(output),
        );
        return;
      }
    }
  }

  function createNode(spec: NodeSpec, index: number): unknown {
    const kind = index === 0 ? plan.rootKind : spec.kind;
    const message = text(deniedKeys.has("message"));
    const structured = {
      code: spec.code,
      category: spec.category,
      retryable: spec.retryable,
      message,
    };
    switch (kind) {
      case "structured":
        return new GeneratedStructuredError(structured);
      case "base":
        return new GeneratedBaseError(message, undefined, {
          name: text(deniedKeys.has("name")),
        });
      case "aggregate": {
        const error = new GeneratedAggregateError({
          ...structured,
          errors: [],
        });
        memberLists.set(index, error.errors as unknown[]);
        return error;
      }
      case "nativeError":
        return new Error(message);
      case "nativeAggregate": {
        const error = new AggregateError([], message);
        memberLists.set(index, error.errors as unknown[]);
        return error;
      }
      case "plainObject":
        return { name: "PlainCause", message };
      case "primitive":
        return leaf(spec.primitive, TOP);
      case "hostileProxy":
        return hostileProxy();
      case "lazyCause":
        return lazyCause(message);
      case "longChain": {
        const tail = new Error(message);
        chainTails.set(index, tail);
        let head = tail;
        for (let hop = 1; hop < spec.chainLength; hop++) {
          const next = new Error(text(deniedKeys.has("message")));
          Object.defineProperty(next, "cause", {
            value: head,
            configurable: true,
            writable: true,
          });
          head = next;
        }
        return head;
      }
    }
  }

  function lazyCause(message: string): Error {
    const error = new Error(message);
    Object.defineProperty(error, "cause", {
      get: () => counted(lazyCause(message)),
      configurable: true,
    });
    return error;
  }

  function wireNode(spec: NodeSpec, index: number): void {
    const node = nodes[index];
    const kind = index === 0 ? plan.rootKind : spec.kind;
    if (!WIRED_KINDS.has(kind)) return;
    if (typeof node !== "object" || node === null) return;

    if (kind !== "longChain") {
      for (const entry of spec.foreign) {
        if (keepsForeignEntry(kind, entry)) defineEntry(node, entry, TOP);
      }
    }
    if (kind === "structured" || kind === "aggregate") {
      if (spec.details !== undefined) {
        const placement = { denied: deniedKeys.has("details"), ancestors: [] };
        Object.defineProperty(node, "details", {
          value: data(spec.details, placement),
          configurable: true,
          enumerable: true,
          writable: true,
        });
      }
    }
    if (kind === "structured" || kind === "aggregate" || kind === "base") {
      wireOwnFields(node, spec.ownFields);
    }
    if (spec.cause !== undefined) {
      const holder = chainTails.get(index) ?? node;
      Object.defineProperty(holder, "cause", {
        value: nodeAt(spec.cause),
        configurable: true,
        writable: true,
        enumerable: kind === "plainObject",
      });
    }
    memberLists.get(index)?.push(...spec.members.map(nodeAt));
  }

  function wireOwnFields(error: object, spec: OwnFieldsSpec): void {
    switch (spec.t) {
      case "none":
        return;
      case "record": {
        const fields = record(spec.entries);
        ownFieldsHooks.set(error, () => fields);
        return;
      }
      case "throws":
        ownFieldsHooks.set(error, () => thrown());
        return;
      case "nonRecord":
        ownFieldsHooks.set(error, () => THROWN_TOKEN);
        return;
    }
  }

  plan.nodes.forEach((spec, index) => nodes.push(createNode(spec, index)));
  plan.nodes.forEach((spec, index) => wireNode(spec, index));
  plan.nodes.forEach((spec, index) => {
    const kind = spec.kind;
    if (index === 0) return;
    if (kind === "structured" || kind === "aggregate" || kind === "base") {
      applyPolicy(nodes[index] as BaseError<string>, spec.policy);
    }
  });

  const root = nodes[0] as BaseError<string>;
  const rootPolicy = options.rootPolicy ?? "plan";
  const planPolicy = plan.nodes[0]?.policy ?? { t: "none" };
  applyPolicy(root, rootPolicy === "plan" ? planPolicy : rootPolicy);

  return { root, reads: () => reads };
}

const EMPTY_NODE: NodeSpec = {
  kind: "structured",
  code: "PAYLOAD",
  category: "INTERNAL",
  retryable: false,
  details: undefined,
  ownFields: { t: "none" },
  foreign: [],
  cause: undefined,
  members: [],
  primitive: { t: "null" },
  chainLength: 1,
  policy: { t: "none" },
};

export type BuiltPayload = {
  readonly value: unknown;
  /** Foreign reads so far: getters, Proxy traps and lazy structures. */
  readonly reads: () => number;
};

/** Builds the live value of one data plan, for an entry point that takes data. */
export function buildPayload(spec: DataSpec): BuiltPayload {
  const graph = buildGraph({
    rootKind: "structured",
    nodes: [{ ...EMPTY_NODE, details: spec }],
    shared: [[], [], []],
  });
  const holder = graph.root as unknown as { readonly details: unknown };
  return { value: holder.details, reads: graph.reads };
}
