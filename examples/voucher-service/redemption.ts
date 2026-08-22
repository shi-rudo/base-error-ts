/**
 * The domain: redeem one voucher. Pure decisions, thrown catalog errors, and
 * one `guard` invariant. The gateway is the only effect, injected by the
 * caller.
 */
import { guard } from "../../src/index.js";
import { VoucherErrors, invalidRedemption } from "./errors.js";

export type Voucher = {
  code: string;
  discountPercent: number;
  expiresAt: string;
  redeemed: boolean;
};

export type RedemptionRequest = { voucherCode?: unknown; amount?: unknown };

export type PaymentGateway = {
  charge(amount: number, cardNumber: string): Promise<{ chargeId: string }>;
};

export type Receipt = {
  voucherCode: string;
  charged: number;
  discountPercent: number;
  chargeId: string;
};

const NOW = "2026-08-22T12:00:00.000Z";

export async function redeemVoucher(
  vouchers: Map<string, Voucher>,
  gateway: PaymentGateway,
  request: RedemptionRequest,
): Promise<Receipt> {
  const issues: { message: string; path?: (string | number)[] }[] = [];
  if (typeof request.voucherCode !== "string" || request.voucherCode === "") {
    issues.push({ message: "voucherCode is required", path: ["voucherCode"] });
  }
  if (typeof request.amount !== "number" || request.amount <= 0) {
    issues.push({
      message: "amount must be a positive number",
      path: ["amount"],
    });
  }
  if (issues.length > 0) {
    throw invalidRedemption(issues);
  }
  const voucherCode = request.voucherCode as string;
  const amount = request.amount as number;

  const voucher = vouchers.get(voucherCode);
  guard(voucher, () =>
    VoucherErrors.create.VOUCHER_NOT_FOUND(
      `voucher ${voucherCode} not found in the voucher store`,
      { details: { voucherCode } },
    ),
  );

  if (voucher.expiresAt < NOW) {
    throw VoucherErrors.create.VOUCHER_EXPIRED(
      `voucher ${voucherCode} expired at ${voucher.expiresAt}`,
      { details: { voucherCode, expiredAt: voucher.expiresAt } },
    );
  }
  if (voucher.redeemed) {
    throw VoucherErrors.create.VOUCHER_ALREADY_REDEEMED(
      `voucher ${voucherCode} was already redeemed`,
      { details: { voucherCode } },
    );
  }

  const charged = amount * (1 - voucher.discountPercent / 100);
  try {
    const { chargeId } = await gateway.charge(charged, "4111111111116789");
    voucher.redeemed = true;
    return {
      voucherCode,
      charged,
      discountPercent: voucher.discountPercent,
      chargeId,
    };
  } catch (cause) {
    // Translate the infrastructure failure once, and carry the cause.
    throw VoucherErrors.create.PAYMENT_GATEWAY_UNAVAILABLE(
      `charge of ${charged} failed at the payment gateway`,
      { details: { voucherCode, cardNumber: "4111111111116789" }, cause },
    );
  }
}
