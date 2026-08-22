/**
 * The boundary catalog: one descriptor per public code. Only what stands here
 * can reach a client; everything else degrades to the fallback.
 */
import {
  LocalizedMessageSet,
  definePublicErrors,
} from "../../src/public-error/index.js";
import type { ValidationError } from "../../src/index.js";
import type { VoucherError } from "./errors.js";

export const PublicVoucherErrors = definePublicErrors({
  fallback: {
    publicCode: "internal_error",
    status: 500,
    title: "An unexpected error occurred.",
    userMessages: new LocalizedMessageSet({
      baseLocale: "en",
      messages: {
        en: "Something went wrong. Try again later.",
        de: "Etwas ist schiefgelaufen. Versuche es später erneut.",
      },
    }),
  },
})
  .registerByCode("VOUCHER_NOT_FOUND", {
    publicCode: "voucher_not_found",
    status: 404,
    userMessages: new LocalizedMessageSet({
      baseLocale: "en",
      messages: {
        en: "We do not know this voucher code.",
        de: "Diesen Gutscheincode kennen wir nicht.",
      },
    }),
  })
  .registerByCode("VOUCHER_EXPIRED", {
    publicCode: "voucher_expired",
    status: 409,
    userMessages: new LocalizedMessageSet({
      baseLocale: "en",
      messages: {
        en: "This voucher has expired.",
        de: "Dieser Gutschein ist abgelaufen.",
      },
    }),
    // The one vetted detail that crosses: when the voucher expired.
    projectDetails: (error: VoucherError) => ({
      expiredAt: String(
        (error.details as { expiredAt?: unknown } | undefined)?.expiredAt,
      ),
    }),
  })
  .registerByCode("VOUCHER_ALREADY_REDEEMED", {
    publicCode: "voucher_already_redeemed",
    status: 409,
    userMessages: new LocalizedMessageSet({
      baseLocale: "en",
      messages: {
        en: "This voucher was already redeemed.",
        de: "Dieser Gutschein wurde bereits eingelöst.",
      },
    }),
  })
  .registerByCode("PAYMENT_GATEWAY_UNAVAILABLE", {
    publicCode: "temporarily_unavailable",
    status: 503,
    userMessages: new LocalizedMessageSet({
      baseLocale: "en",
      messages: {
        en: "Payment is briefly unavailable. Retry in a moment.",
        de: "Die Zahlung ist kurz nicht verfügbar. Versuche es gleich erneut.",
      },
    }),
    projectRetryable: () => true,
    projectRetryAfter: () => 15,
  })
  .registerByCode("VALIDATION_FAILED", {
    publicCode: "invalid_request",
    status: 422,
    userMessages: new LocalizedMessageSet({
      baseLocale: "en",
      messages: {
        en: "The request is invalid.",
        de: "Die Anfrage ist ungültig.",
      },
    }),
    // publicIssues is the whitelist; the derived path names the public field.
    projectFields: (error: ValidationError) =>
      error.publicIssues().map((issue) => ({
        field: issue.pointer ?? "",
        code: issue.code ?? "invalid",
      })),
  });
