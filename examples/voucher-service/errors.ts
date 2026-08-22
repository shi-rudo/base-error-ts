/**
 * The error vocabulary of the voucher service: one catalog, defined once at
 * the composition root. Factories live under `create`, static facts under
 * `meta`, and provenance checks under `is`.
 */
import { defineErrors, detailsType, ValidationError } from "../../src/index.js";
import type { CatalogError } from "../../src/index.js";

export const VoucherErrors = defineErrors({
  VOUCHER_NOT_FOUND: {
    category: "NOT_FOUND",
    retryable: false,
    details: detailsType<{ voucherCode: string }>(),
    metadata: { docs: "https://errors.example/voucher-not-found" },
  },
  VOUCHER_EXPIRED: {
    category: "CONFLICT",
    retryable: false,
    details: detailsType<{ voucherCode: string; expiredAt: string }>(),
    metadata: { docs: "https://errors.example/voucher-expired" },
  },
  VOUCHER_ALREADY_REDEEMED: {
    category: "CONFLICT",
    retryable: false,
    details: detailsType<{ voucherCode: string }>(),
    metadata: { docs: "https://errors.example/voucher-already-redeemed" },
  },
  PAYMENT_GATEWAY_UNAVAILABLE: {
    category: "UPSTREAM",
    retryable: true,
    details: detailsType<{ voucherCode: string; cardNumber: string }>(),
    metadata: { docs: "https://errors.example/payment-gateway-unavailable" },
    // The gateway details carry the card number; the catalog masks it in
    // every log, so no call site can forget.
    redaction: { mode: "deny", keys: ["cardNumber"] },
  },
  NOTIFICATION_FAILED: {
    category: "UPSTREAM",
    retryable: true,
    details: detailsType<{ provider: string }>(),
    metadata: { docs: "https://errors.example/notification-failed" },
  },
});

export type VoucherError = CatalogError<typeof VoucherErrors>;

/** A request that fails validation collects every issue into one error. */
export function invalidRedemption(
  issues: { message: string; path?: (string | number)[] }[],
): ValidationError {
  const error = new ValidationError("redemption request is invalid");
  for (const issue of issues) {
    error.addIssue(issue);
  }
  return error;
}
