import { isArrayValue, readProperty } from "../errors/guarded-read.js";
import type { FieldFault } from "./types.js";

/**
 * The closed-shape copy of a fault list: exactly `{ field, code }` per fault,
 * null-prototype and frozen. Each member is read once, so the value that
 * passes the check is the value that is copied. A value that is not a list,
 * or one fault without a string `field` and `code`, fails the whole list,
 * because a partial list misreports which fields failed.
 */
export function copyFieldFaults(
  value: unknown,
): readonly FieldFault[] | undefined {
  if (!isArrayValue(value)) return undefined;
  const length = readProperty(value, "length");
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0
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
    const copy = Object.create(null) as { field: string; code: string };
    copy.field = field;
    copy.code = code;
    faults.push(Object.freeze(copy));
  }
  return Object.freeze(faults);
}
