/**
 * Bounded conversion of log data to detached values. This module owns the
 * JSON compatibility rules; it does not own errors, redaction, or envelopes.
 * The caller supplies error projection and a budget shared with its traversal.
 * Numbers follow JSON conversion at every depth: non-finite values become
 * null and negative zero becomes zero. Bigints become decimal strings.
 */
import {
  readObjectTag,
  readConstructorName,
  readToJSON,
  UNREADABLE_TO_JSON,
  readOwnEnumerableKeys,
  readProperty,
  readPropertyResult,
} from "./guarded-read.js";
import type { LogBuildContext } from "./log-build-context.js";
import { ENVELOPE_KEYS } from "./log-field-keys.js";
import {
  childPosition,
  type LogRegion,
  type WalkPosition,
} from "./log-position.js";
import {
  MAX_LOG_SIZE_MARKER,
  UNSERIALIZABLE_VALUE_MARKER,
} from "./serializer-markers.js";
import {
  MAX_CAUSE_DEPTH,
  MAX_DATA_DEPTH,
  MAX_LOG_NODES,
} from "./walker-bounds.js";

const SIZE_CUT = Symbol("log.size");
const depthCuts = new WeakSet<object>();

export function normalizeLogNumber(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return value === 0 ? 0 : value;
}

/** A serializer cut must not acquire a different diagnosis during redaction. */
export function isLogDataDepthCut(value: object): boolean {
  return depthCuts.has(value);
}

export function copyLogDataDepthCut<T extends object>(
  source: object,
  target: T,
): T {
  if (depthCuts.has(source)) depthCuts.add(target);
  return target;
}

/** JSON unboxes by internal brand; a consumer tag cannot grant or hide it. */
function unboxData(value: object): unknown {
  const tag = readObjectTag(value);
  const tagged =
    tag === undefined || readProperty(value, Symbol.toStringTag) !== undefined;
  let primitive: unknown = value;
  if (tag === "[object Number]" || tagged) {
    try {
      primitive = Number.prototype.valueOf.call(value);
    } catch {
      /* No number brand. */
    }
  }
  if (primitive === value && (tag === "[object String]" || tagged)) {
    try {
      primitive = String.prototype.valueOf.call(value);
    } catch {
      /* No string brand. */
    }
  }
  if (primitive === value && (tag === "[object Boolean]" || tagged)) {
    try {
      primitive = Boolean.prototype.valueOf.call(value);
    } catch {
      /* No boolean brand. */
    }
  }
  if (primitive === value && (tag === "[object BigInt]" || tagged)) {
    try {
      primitive = BigInt.prototype.valueOf.call(value);
    } catch {
      /* No bigint brand. */
    }
  }
  // Number and string wrappers run conversion hooks; booleans use their slot.
  if (typeof primitive === "number") return +(value as unknown as number);
  if (typeof primitive === "string") return String(value);
  return primitive;
}

/**
 * A foreign value as the log object carries it: decoupled from its source
 * and safe for the consumer's `JSON.stringify`. One rule for a plain-object
 * cause and for every field copied off a native error (`details`, `code`,
 * an object under `stack`), so both branches carry the same guarantees.
 *
 * Numbers follow JSON conversion; a bigint, which has no JSON form, is
 * written as its decimal string, at every depth. A function or symbol has
 * no JSON form either and reads as absent. A bounded walker copies objects,
 * honors `toJSON`, and applies JSON value conversions. Foreign reads and
 * descriptor inspections are guarded and charged before expansion. Failed
 * reads, conversions, and key enumeration replace only the affected value.
 * A cycle replaces only the repeated ancestor reference. Budget exhaustion
 * uses the log-size marker.
 * Nothing in here throws.
 *
 * Cause depth and data depth count separately, with the redaction regions.
 * At a depth cap, the copy keeps an empty container and reads no children.
 */
export function serializeLogData(
  value: unknown,
  context: LogBuildContext,
  region: LogRegion = "data",
  spine = 0,
): unknown {
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  )
    return undefined;
  const budget = context.budget;
  if (budget.nodes >= budget.limit) return MAX_LOG_SIZE_MARKER;
  if (typeof value === "object" && value !== null) {
    const seen = new Set<object>();
    const copy = (
      input: unknown,
      key: string,
      parent?: WalkPosition,
      arrayParent = false,
    ): unknown => {
      if (budget.nodes >= budget.limit) throw SIZE_CUT;
      budget.nodes++;
      let item = input;
      let array = false;
      try {
        const errorData =
          item !== null && typeof item === "object"
            ? context.dataError(item)
            : undefined;
        if (errorData !== undefined) {
          item = errorData;
        } else {
          const toJSON = readToJSON(item);
          if (toJSON === UNREADABLE_TO_JSON) return UNSERIALIZABLE_VALUE_MARKER;
          if (typeof toJSON === "function")
            item = Reflect.apply(toJSON, item, [key]);
        }
        if (item !== null && typeof item === "object") {
          item = unboxData(item);
          array = Array.isArray(item);
        }
      } catch {
        return UNSERIALIZABLE_VALUE_MARKER;
      }
      if (typeof item === "bigint") return item.toString();
      if (typeof item === "number") return normalizeLogNumber(item);
      if (typeof item === "function" || typeof item === "symbol")
        return undefined;
      if (item === null || typeof item !== "object") return item;
      const position =
        parent === undefined
          ? {
              region,
              depth: 0,
              spine: spine + (region === "cause" && !array ? 1 : 0),
            }
          : childPosition(parent, arrayParent, key, item);
      if (
        position.depth >= MAX_DATA_DEPTH ||
        position.spine > MAX_CAUSE_DEPTH
      ) {
        const terminal = array ? [] : {};
        depthCuts.add(terminal);
        return terminal;
      }
      if (seen.has(item)) return serializeCircularObject(item, context);
      seen.add(item);
      try {
        if (array) {
          const lengthRead = readPropertyResult(item, "length");
          if (!lengthRead.readable) return UNSERIALIZABLE_VALUE_MARKER;
          const length = lengthRead.value;
          const count =
            typeof length === "number" &&
            Number.isSafeInteger(length) &&
            length >= 0
              ? length
              : 0;
          const out: unknown[] = [];
          for (let index = 0; index < count; index++) {
            if (budget.nodes >= budget.limit) throw SIZE_CUT;
            const field = readPropertyResult(item, String(index));
            out.push(
              copy(
                field.readable ? field.value : UNSERIALIZABLE_VALUE_MARKER,
                String(index),
                position,
                true,
              ) ?? null,
            );
          }
          return out;
        }
        const out = Object.create(null) as Record<string, unknown>;
        const keys = readOwnEnumerableKeys(item, MAX_LOG_NODES, budget);
        let entry = keys.next();
        while (!entry.done) {
          if (budget.nodes >= budget.limit) throw SIZE_CUT;
          const key = entry.value;
          const read = readPropertyResult(item, key);
          // A failed diagnostic read must not manufacture a scalar decision.
          let fieldValue: unknown = UNSERIALIZABLE_VALUE_MARKER;
          if (read.readable) fieldValue = read.value;
          else if (position.region !== "data" && ENVELOPE_KEYS.has(key))
            fieldValue = undefined;
          const field = copy(fieldValue, key, position);
          if (field !== undefined) out[key] = field;
          entry = keys.next();
        }
        if (!entry.value) return UNSERIALIZABLE_VALUE_MARKER;
        // A cut can fall on a non-enumerable key and yield no field.
        if (budget.nodes >= budget.limit) throw SIZE_CUT;
        return Object.setPrototypeOf(out, Object.prototype);
      } finally {
        seen.delete(item);
      }
    };
    try {
      return copy(value, "");
    } catch (error) {
      if (error === SIZE_CUT) return MAX_LOG_SIZE_MARKER;
      return UNSERIALIZABLE_VALUE_MARKER;
    }
  }
  budget.nodes++;
  if (typeof value === "number") return normalizeLogNumber(value);
  if (typeof value === "bigint") return value.toString();
  return value;
}

/**
 * Creates a more useful representation of circular objects for debugging.
 * Instead of just "[object Object]", it extracts key information. Total:
 * the constructor and key reads are foreign, and a Proxy whose traps throw
 * gets the bare marker instead of an exception.
 */
function serializeCircularObject(
  obj: object,
  context: LogBuildContext,
): string {
  try {
    const type = readConstructorName(obj) || "Object";
    const keys = Array.from(readOwnEnumerableKeys(obj, 6, context.budget));
    const keyInfo =
      keys.length > 0 ? ` with keys: [${keys.slice(0, 5).join(", ")}]` : "";
    const moreKeys = keys.length > 5 ? "..." : "";

    return `[Circular ${type}${keyInfo}${moreKeys}]`;
  } catch {
    return "[Circular Object]";
  }
}
