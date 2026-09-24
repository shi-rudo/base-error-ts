import { isErrorWithCause } from "../index.js";

declare const caught: unknown;
declare const withSlot: { cause: unknown };

if (isErrorWithCause(caught)) {
  const cause: NonNullable<unknown> = caught.cause;

  void cause;
}

if (!isErrorWithCause(withSlot)) {
  const nullish: unknown = withSlot.cause;

  void nullish;
}
