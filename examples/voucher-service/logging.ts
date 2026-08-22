/**
 * The log edge. One line per handled failure, structured, with the level
 * decided by an exhaustive `matchError` over the catalog codes. `partialMask`
 * demonstrates a masking redaction on top of the catalog policy.
 */
import { isStructuredError, matchError, partialMask } from "../../src/index.js";
import type { StructuredError } from "../../src/index.js";

export function levelFor(error: StructuredError<string, string>): string {
  return matchError(error, {
    VOUCHER_NOT_FOUND: () => "info",
    VOUCHER_EXPIRED: () => "info",
    VOUCHER_ALREADY_REDEEMED: () => "info",
    PAYMENT_GATEWAY_UNAVAILABLE: () => "error",
    NOTIFICATION_FANOUT_FAILED: () => "warn",
    _: () => "error",
  });
}

export function logError(event: string, error: unknown): string {
  const level = isStructuredError(error) ? levelFor(error) : "error";
  const body = isStructuredError(error)
    ? error
        .redact(["cardNumber"], { mask: partialMask({ keepEnd: 4 }) })
        .toLogObject()
    : { message: String(error) };
  const line = JSON.stringify({ level, event, error: body });
  console.log(line);
  return line;
}
