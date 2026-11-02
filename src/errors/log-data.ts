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
  readOwnKeyCount,
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
  MAX_CAUSE_DEPTH_MARKER,
  MAX_DATA_DEPTH_MARKER,
  MAX_LOG_SIZE_MARKER,
  MORE_KEYS_KEY,
  UNSERIALIZABLE_VALUE_MARKER,
  binaryDataMarker,
  circularObjectMarker,
  moreCharactersMarker,
  moreItemsMarker,
} from "./serializer-markers.js";
import {
  MAX_CAUSE_DEPTH,
  MAX_DATA_DEPTH,
  MAX_DATA_WIDTH,
  MAX_LOG_NODES,
  MAX_LOG_STRING_LENGTH,
} from "./walker-bounds.js";

const SIZE_CUT = Symbol("log.size");

export function normalizeLogNumber(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return value === 0 ? 0 : value;
}

/**
 * A string as the log object writes it: at most `limit` code units of it, and
 * a count marker for the rest. The cut never splits a surrogate pair. The
 * string spends its kept length from the character budget of the build; past
 * the budget it is the size marker, and at the edge it keeps what fits.
 */
export function capLogString(
  value: string,
  context: LogBuildContext,
  limit: number = MAX_LOG_STRING_LENGTH,
): string {
  const characters = context.characters;
  const room = Math.min(limit, characters.limit - characters.used);
  if (room <= 0) return MAX_LOG_SIZE_MARKER;
  if (value.length <= room) {
    characters.used += value.length;
    return value;
  }
  let kept = room;
  const last = value.charCodeAt(kept - 1);
  if (last >= 0xd800 && last <= 0xdbff) kept--;
  characters.used += kept;
  return `${value.slice(0, kept)}${moreCharactersMarker(value.length - kept)}`;
}

/**
 * A stack as the log object writes it. A stack that starts with the header
 * `name: message` of its error gets the header with the name and the message
 * that the log writes, so a cut message does not leave the full message in
 * the stack, and the redaction recognizes the header as before. The frames
 * after the header get their own allowance of {@link MAX_LOG_STRING_LENGTH},
 * so a long message costs the stack no frame. Any other stack is cut like a
 * string. The header forms match the ones that the redaction recognizes.
 */
export function capLogStack(
  stack: string,
  header: { readonly name: unknown; readonly message: unknown },
  logged: { readonly name: unknown; readonly message: unknown },
  context: LogBuildContext,
): string {
  const { name, message } = header;
  if (
    typeof name === "string" &&
    typeof message === "string" &&
    typeof logged.name === "string" &&
    typeof logged.message === "string"
  ) {
    const forms =
      message === "" ? [`${name}: `, name] : [`${name}: ${message}`];
    for (const form of forms) {
      if (stack === form || stack.startsWith(`${form}\n`)) {
        const loggedHeader =
          form === name ? logged.name : `${logged.name}: ${logged.message}`;
        const frames = stack.slice(form.length);
        context.characters.used += loggedHeader.length;
        return frames === ""
          ? loggedHeader
          : `${loggedHeader}${capLogString(frames, context)}`;
      }
    }
  }
  return capLogString(stack, context);
}

/**
 * The marker of the cap that cuts the container at `position`, or
 * `undefined` when no cap cuts it. The spine grows only in the cause region
 * and data depth only in the data region, so the cap names the region: the
 * cause depth marker stays readable in a cause slot, and the data depth
 * marker is data.
 */
function depthCutMarker(position: WalkPosition): string | undefined {
  if (position.spine > MAX_CAUSE_DEPTH) return MAX_CAUSE_DEPTH_MARKER;
  if (position.depth >= MAX_DATA_DEPTH) return MAX_DATA_DEPTH_MARKER;
  return undefined;
}

/**
 * Tags of built-in objects that hold no wrapper slot. Each wrapper probe
 * throws for such an object, and each thrown TypeError captures a stack. So
 * a value with one of these tags skips the probes. A crafted wrapper that
 * borrows such a tag is copied as an object, which is safe.
 */
const SLOTLESS_BUILT_IN_TAGS: ReadonlySet<string> = new Set(
  [
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "WeakRef",
    "Promise",
    "Symbol",
    "ArrayBuffer",
    "SharedArrayBuffer",
    "DataView",
    "Int8Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "Int16Array",
    "Uint16Array",
    "Int32Array",
    "Uint32Array",
    "Float32Array",
    "Float64Array",
    "BigInt64Array",
    "BigUint64Array",
    "Generator",
    "AsyncGenerator",
    "Map Iterator",
    "Set Iterator",
    "Array Iterator",
    "String Iterator",
    "RegExp String Iterator",
    "URL",
    "URLSearchParams",
    "Headers",
    "Request",
    "Response",
    "Blob",
    "File",
    "FormData",
    "AbortController",
    "AbortSignal",
  ].map((name) => `[object ${name}]`),
);

const ARRAY_BUFFER_TAGS: ReadonlySet<string> = new Set([
  "[object ArrayBuffer]",
  "[object SharedArrayBuffer]",
]);

/**
 * The summary of binary data, or `undefined` for any other value. A typed
 * array, a `Buffer`, a `DataView` and an `ArrayBuffer` hold bytes, not log
 * data, and one of them can spend the node budget of the whole build. The
 * summary names the type and the size: the element count of a typed array,
 * the byte count of a `DataView` or a buffer. `ArrayBuffer.isView` reads an
 * internal slot and runs no trap of a Proxy.
 */
function binarySummary(value: object): string | undefined {
  const tag = readObjectTag(value);
  const view = ArrayBuffer.isView(value);
  if (!view && (tag === undefined || !ARRAY_BUFFER_TAGS.has(tag))) {
    return undefined;
  }
  const size = readProperty(
    value,
    view && tag !== "[object DataView]" ? "length" : "byteLength",
  );
  const type =
    readConstructorName(value) || (tag ?? "[object Object]").slice(8, -1);
  return binaryDataMarker(
    type,
    typeof size === "number" && Number.isSafeInteger(size) && size >= 0
      ? size
      : 0,
  );
}

/**
 * The number of own keys of `value` past the first `taken`, or the
 * unserializable-value marker when the keys cannot be counted. It counts
 * from one enumeration of the keys and reads no descriptor, so the count
 * costs no work that the budget of the build does not bound. A symbol or a
 * non-enumerable key before the cut counts as dropped.
 */
function droppedKeyCount(value: object, taken: number): number | string {
  const count = readOwnKeyCount(value);
  return count === undefined
    ? UNSERIALIZABLE_VALUE_MARKER
    : Math.max(0, count - taken);
}

/**
 * JSON unboxes by internal brand; a consumer tag cannot grant or hide it. A
 * wrapper subclass can name its own tag, so a tagged value is probed for
 * every wrapper slot, unless its tag names a slotless built-in.
 */
function unboxData(value: object): unknown {
  const tag = readObjectTag(value);
  const tagged =
    tag === undefined ||
    (readProperty(value, Symbol.toStringTag) !== undefined &&
      !SLOTLESS_BUILT_IN_TAGS.has(tag));
  const probes = (wrapperTag: string): boolean => tag === wrapperTag || tagged;
  let primitive: unknown = value;
  if (probes("[object Number]")) {
    try {
      primitive = Number.prototype.valueOf.call(value);
    } catch {
      /* No number brand. */
    }
  }
  if (primitive === value && probes("[object String]")) {
    try {
      primitive = String.prototype.valueOf.call(value);
    } catch {
      /* No string brand. */
    }
  }
  if (primitive === value && probes("[object Boolean]")) {
    try {
      primitive = Boolean.prototype.valueOf.call(value);
    } catch {
      /* No boolean brand. */
    }
  }
  if (primitive === value && probes("[object BigInt]")) {
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
 * and safe for the consumer's `JSON.stringify`. One rule covers a
 * plain-object cause and every field copied off a native error (`details`,
 * `code`, an object under `stack`). So both branches carry the same
 * guarantees.
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
 * At a depth cap, the copy writes the marker of that cap and reads no
 * children.
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
    const positionOf = (
      item: unknown,
      array: boolean,
      key: string,
      parent: WalkPosition | undefined,
      arrayParent: boolean,
    ): WalkPosition =>
      parent === undefined
        ? {
            region,
            depth: 0,
            spine: spine + (region === "cause" && !array ? 1 : 0),
          }
        : childPosition(parent, arrayParent, key, item);
    // A marker lists the keys of its object, so one marker per object keeps
    // the work linear when many references return to the same ancestor.
    const circularMarkers = new Map<object, string>();
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
      let position: WalkPosition | undefined;
      try {
        const errorView =
          item !== null && typeof item === "object"
            ? context.dataError(item)
            : undefined;
        if (errorView !== undefined) {
          // A depth cap cuts the view of an error like any container, so the
          // view is not built past the cap. A custom policy that returns a
          // primitive view is cut there as well.
          position = positionOf(item, false, key, parent, arrayParent);
          const cut = depthCutMarker(position);
          if (cut !== undefined) return cut;
          item = errorView();
        } else {
          // Binary data is summarized before its toJSON runs: the toJSON of
          // a Buffer returns every byte.
          if (item !== null && typeof item === "object") {
            const summary = binarySummary(item);
            if (summary !== undefined) return summary;
          }
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
      if (typeof item === "string") return capLogString(item, context);
      if (typeof item === "function" || typeof item === "symbol")
        return undefined;
      if (item === null || typeof item !== "object") return item;
      // The view of an error is a record, at the position of the error.
      if (position === undefined || array) {
        position = positionOf(item, array, key, parent, arrayParent);
      }
      const cut = depthCutMarker(position);
      if (cut !== undefined) return cut;
      if (seen.has(item)) {
        let marker = circularMarkers.get(item);
        if (marker === undefined) {
          marker = serializeCircularObject(item, context);
          circularMarkers.set(item, marker);
        }
        return marker;
      }
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
          const shown = Math.min(count, MAX_DATA_WIDTH);
          const out: unknown[] = [];
          for (let index = 0; index < shown; index++) {
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
          if (count > shown) out.push(moreItemsMarker(count - shown));
          return out;
        }
        const out = Object.create(null) as Record<string, unknown>;
        const keys = readOwnEnumerableKeys(item, MAX_LOG_NODES, budget);
        let taken = 0;
        let entry = keys.next();
        while (!entry.done) {
          if (budget.nodes >= budget.limit) throw SIZE_CUT;
          if (taken === MAX_DATA_WIDTH) {
            out[MORE_KEYS_KEY] = droppedKeyCount(item, taken);
            return Object.setPrototypeOf(out, Object.prototype);
          }
          taken++;
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
  if (typeof value === "string") return capLogString(value, context);
  return value;
}

/**
 * The circular-object marker of a repeated ancestor. The type and key reads
 * are guarded: an object whose keys cannot be read gets its type only.
 */
function serializeCircularObject(
  obj: object,
  context: LogBuildContext,
): string {
  return circularObjectMarker(
    readConstructorName(obj) || "Object",
    readOwnEnumerableKeys(obj, MAX_LOG_NODES, context.budget),
  );
}
