import { isArrayValue, readProperty } from "../errors/guarded-read.js";
import { MAX_DATA_NODES } from "../errors/walker-bounds.js";
import type { FieldFault } from "./types.js";

/**
 * The closed-shape copy of a fault list: exactly `{ field, code }` per fault,
 * frozen. Each member is read once, so the value that passes the check is the
 * value that is copied. The copy fails when the value is not a list, or when
 * one fault has no string `field` and `code`. A partial list would misreport
 * which fields failed. A list longer than {@link MAX_DATA_NODES} fails as
 * well, so the copy stays bounded when the list is a Proxy.
 */
export function copyFieldFaults(
  value: unknown,
): readonly FieldFault[] | undefined {
  if (!isArrayValue(value)) return undefined;
  const length = readProperty(value, "length");
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > MAX_DATA_NODES
  ) {
    return undefined;
  }
  const faults: FieldFault[] = [];
  for (let index = 0; index < length; index++) {
    const fault = readProperty(value, String(index));
    const field = readProperty(fault, "field");
    const code = readProperty(fault, "code");
    if (typeof field !== "string" || typeof code !== "string") {
      return undefined;
    }
    faults.push(Object.freeze({ field, code }));
  }
  return Object.freeze(faults);
}
