/**
 * The notification fan-out. Both providers run; the failures of a partial or
 * total miss collect into one aggregate, and the caller decides on a retry
 * from the cause chain.
 */
import { StructuredAggregateError } from "../../src/index.js";
import { VoucherErrors } from "./errors.js";
import type { Receipt } from "./redemption.js";

export type NotificationProvider = {
  name: string;
  send(receipt: Receipt): Promise<void>;
};

export async function notifyRedemption(
  providers: NotificationProvider[],
  receipt: Receipt,
): Promise<void> {
  const outcomes = await Promise.allSettled(
    providers.map((provider) =>
      provider.send(receipt).catch((cause) => {
        throw VoucherErrors.create.NOTIFICATION_FAILED(
          `provider ${provider.name} rejected the redemption notification`,
          { details: { provider: provider.name }, cause },
        );
      }),
    ),
  );

  const failures = outcomes
    .filter(
      (outcome): outcome is PromiseRejectedResult =>
        outcome.status === "rejected",
    )
    .map((outcome) => outcome.reason as unknown);
  if (failures.length > 0) {
    throw new StructuredAggregateError({
      code: "NOTIFICATION_FANOUT_FAILED",
      category: "UPSTREAM",
      retryable: failures.length < providers.length ? false : true,
      message: `${failures.length} of ${providers.length} notification providers failed`,
      errors: failures,
    });
  }
}
