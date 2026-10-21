import { BaseError, StructuredError } from "../index.js";

const error = new BaseError("probe");
const timestamp: number = error.timestamp;
// @ts-expect-error the error stores its time once, in timestamp
void error.timestampIso;

const structured = new StructuredError({
  code: "PAYMENT_FAILED",
  category: "PAYMENT",
  retryable: false,
  message: "payment failed",
});
// @ts-expect-error a subclass inherits no timestampIso
void structured.timestampIso;

void timestamp;
