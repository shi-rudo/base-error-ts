import {
  readOwnKeys,
  readOwnPropertyDescriptor,
  readPrototype,
  UNREADABLE_REFLECTION,
} from "./guarded-read.js";
import { RESERVED_NODE_KEYS } from "./log-field-keys.js";
import {
  MAX_DATA_DEPTH,
  MAX_DATA_NODES,
  MAX_OWN_LOG_FIELDS,
} from "./walker-bounds.js";

export type OwnLogFieldsIssue = {
  readonly path: readonly (string | number)[];
  readonly reason:
    | "invalid-root"
    | "reserved-key"
    | "unsupported-value"
    | "non-finite-number"
    | "non-plain-object"
    | "accessor"
    | "unsupported-key"
    | "non-enumerable"
    | "sparse-array"
    | "circular-reference"
    | "depth-limit"
    | "width-limit"
    | "node-limit"
    | "unreadable";
};

type Path = readonly (string | number)[];

/**
 * Inspect a hook result in consumer tests without calling getters or toJSON.
 * Empty issues mean a finite JSON record within the inspection limits.
 * At most 100 issues are returned. Values and descriptor inspections share
 * the data-node allowance; depth and root width use the logging limits.
 * Reflection can run Proxy traps. JavaScript cannot interrupt those traps or
 * make own-key enumeration lazy, so their internal work remains unbounded.
 */
export function inspectOwnLogFields(
  value: unknown,
): readonly OwnLogFieldsIssue[] {
  const issues: OwnLogFieldsIssue[] = [];
  const seen = new Set<object>();
  let nodes = 0;
  let stopped = false;

  function report(path: Path, reason: OwnLogFieldsIssue["reason"]): void {
    issues.push({ path, reason });
    if (issues.length >= MAX_OWN_LOG_FIELDS) stopped = true;
  }

  function take(path: Path): boolean {
    if (stopped) return false;
    if (nodes >= MAX_DATA_NODES) {
      report(path, "node-limit");
      stopped = true;
      return false;
    }
    nodes++;
    return true;
  }

  function visit(item: unknown, path: Path): void {
    if (!take(path)) return;
    const root = path.length === 0;
    if (item === null || typeof item !== "object") {
      if (root) report(path, "invalid-root");
      else if (typeof item === "number" && !Number.isFinite(item)) {
        report(path, "non-finite-number");
      } else if (
        item !== null &&
        !["string", "number", "boolean"].includes(typeof item)
      ) {
        report(path, "unsupported-value");
      }
      return;
    }

    try {
      const array = Array.isArray(item);
      const prototype = readPrototype(item);
      if (prototype === UNREADABLE_REFLECTION) {
        report(path, "unreadable");
        return;
      }
      let plain = prototype === null;
      if (prototype !== null) {
        if (!take(path)) return;
        const ancestor = readPrototype(prototype);
        const constructor = readOwnPropertyDescriptor(prototype, "constructor");
        if (
          ancestor === UNREADABLE_REFLECTION ||
          constructor === UNREADABLE_REFLECTION
        ) {
          report(path, "unreadable");
          return;
        }
        // Canonical prototypes work across realms without invoking callbacks.
        if (
          constructor !== undefined &&
          typeof constructor.value === "function"
        ) {
          if (!take(path)) return;
          const declared = readOwnPropertyDescriptor(
            constructor.value,
            "prototype",
          );
          if (declared === UNREADABLE_REFLECTION) {
            report(path, "unreadable");
            return;
          }
          plain =
            declared?.value === prototype &&
            (array || ancestor === null) &&
            Function.prototype.toString.call(constructor.value) ===
              Function.prototype.toString.call(array ? Array : Object);
        }
      }
      if (!plain || (root && array)) {
        report(path, root ? "invalid-root" : "non-plain-object");
        return;
      }
      if (seen.has(item)) {
        report(path, "circular-reference");
        return;
      }
      if (path.length >= MAX_DATA_DEPTH) {
        report(path, "depth-limit");
        return;
      }
      seen.add(item);
      try {
        const keys = readOwnKeys(item);
        if (keys === UNREADABLE_REFLECTION) {
          report(path, "unreadable");
          return;
        }
        const width = root ? MAX_OWN_LOG_FIELDS : MAX_DATA_NODES;
        const cut = keys.length > width;
        if (cut) report(path, "width-limit");
        let indices = 0;
        let length = 0;
        for (
          let index = 0;
          index < keys.length && index < width && !stopped;
          index++
        ) {
          const key = keys[index];
          const child = typeof key === "string" ? [...path, key] : path;
          if (!take(child)) break;
          if (typeof key !== "string") {
            report(path, "unsupported-key");
            continue;
          }
          const numeric =
            array &&
            key.length <= 10 &&
            /^(0|[1-9][0-9]*)$/.test(key) &&
            Number(key) < 0xffff_ffff;
          const childPath = numeric ? [...path, Number(key)] : child;
          try {
            const descriptor = readOwnPropertyDescriptor(item, key);
            if (numeric) indices++;
            if (
              descriptor === undefined ||
              descriptor === UNREADABLE_REFLECTION
            ) {
              report(childPath, "unreadable");
            } else if (
              !Object.prototype.hasOwnProperty.call(descriptor, "value")
            ) {
              report(childPath, "accessor");
            } else if (array && key === "length") {
              if (
                typeof descriptor.value === "number" &&
                Number.isSafeInteger(descriptor.value) &&
                descriptor.value >= 0
              ) {
                length = descriptor.value;
              } else {
                report(childPath, "unreadable");
              }
            } else if (root && RESERVED_NODE_KEYS.has(key)) {
              report(childPath, "reserved-key");
            } else if (array && !numeric) {
              report(childPath, "unsupported-key");
            } else if (!descriptor.enumerable) {
              report(childPath, "non-enumerable");
            } else {
              visit(descriptor.value, childPath);
            }
          } catch {
            report(childPath, "unreadable");
          }
        }
        if (array && !cut && !stopped && indices < length)
          report(path, "sparse-array");
      } finally {
        seen.delete(item);
      }
    } catch {
      report(path, "unreadable");
    }
  }

  visit(value, []);
  return issues;
}
