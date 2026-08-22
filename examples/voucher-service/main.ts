/**
 * Voucher Service Example
 *
 * One small service that plays the whole feature set together: the error
 * catalog, validation issues, a notification fan-out with an aggregate, the
 * retry decision on a cause chain, redacted structured logging, the queue
 * round-trip through fromJSON, and the public-error pipeline with localized
 * RFC 9457 responses. Run it with: npx tsx examples/voucher-service/main.ts
 */
import { StructuredError, hasErrorCode } from "../../src/index.js";
import { consumeDeadLetters } from "./queue.js";
import { startVoucherService } from "./server.js";
import type { NotificationProvider, PaymentGateway } from "./redemption.js";

const failures: string[] = [];
function expect(name: string, ok: boolean): void {
  console.log(`${ok ? "ok " : "FAIL"} ${name}`);
  if (!ok) failures.push(name);
}

const gateway: PaymentGateway = {
  charge(amount) {
    if (amount >= 900) {
      return Promise.reject(new Error("connect ECONNREFUSED 10.0.0.7:8443"));
    }
    return Promise.resolve({ chargeId: `charge-${amount}` });
  },
};

let providersDown = false;
const providers: NotificationProvider[] = ["email", "webhook"].map((name) => ({
  name,
  send: () =>
    providersDown
      ? Promise.reject(new Error(`${name} endpoint returned 503`))
      : Promise.resolve(),
}));

const { server, vouchers } = await startVoucherService(gateway, providers);
const address = server.address();
if (address === null || typeof address !== "object") {
  throw new Error("server did not report a port");
}
const base = `http://127.0.0.1:${address.port}`;

vouchers.set("SUSHI10", {
  code: "SUSHI10",
  discountPercent: 10,
  expiresAt: "2026-12-31T00:00:00.000Z",
  redeemed: false,
});
vouchers.set("EXPIRED10", {
  code: "EXPIRED10",
  discountPercent: 10,
  expiresAt: "2026-01-01T00:00:00.000Z",
  redeemed: false,
});
vouchers.set("BIGSPEND", {
  code: "BIGSPEND",
  discountPercent: 0,
  expiresAt: "2026-12-31T00:00:00.000Z",
  redeemed: false,
});

type ProblemBody = {
  code?: string;
  title?: string;
  retryable?: boolean;
  details?: { expiredAt?: string };
  fields?: { field: string; code: string }[];
  receipt?: { charged: number };
};

async function redeem(
  payload: unknown,
  acceptLanguage?: string,
): Promise<{ status: number; headers: Headers; body: ProblemBody }> {
  const response = await fetch(`${base}/redeem`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(acceptLanguage !== undefined
        ? { "accept-language": acceptLanguage }
        : {}),
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: (await response.json()) as ProblemBody,
  };
}

console.log("--- happy path");
const happy = await redeem({ voucherCode: "SUSHI10", amount: 100 });
expect("redemption succeeds", happy.status === 200);
expect(
  "the receipt carries the discounted charge",
  happy.body.receipt?.charged === 90,
);

console.log("--- second redemption conflicts");
const again = await redeem({ voucherCode: "SUSHI10", amount: 100 });
expect("already redeemed maps to 409", again.status === 409);
expect(
  "the public code names the conflict",
  again.body.code === "voucher_already_redeemed",
);

console.log("--- unknown voucher, German client");
const unknown = await redeem({ voucherCode: "NOPE", amount: 10 }, "de-DE,de");
expect("unknown voucher maps to 404", unknown.status === 404);
expect(
  "the title is the localized user message",
  unknown.body.title === "Diesen Gutscheincode kennen wir nicht.",
);
expect(
  "the response names its language",
  unknown.headers.get("content-language") === "de",
);

console.log("--- expired voucher, vetted detail crosses");
const expired = await redeem({ voucherCode: "EXPIRED10", amount: 10 });
expect("expired maps to 409", expired.status === 409);
expect(
  "the vetted expiredAt detail crosses",
  expired.body.details?.expiredAt === "2026-01-01T00:00:00.000Z",
);
expect(
  "the technical message stays inside",
  JSON.stringify(expired.body).includes("voucher store") === false,
);

console.log("--- invalid payload, field faults");
const invalid = await redeem({ amount: -5 });
expect("validation maps to 422", invalid.status === 422);
expect(
  "each issue becomes a field fault",
  Array.isArray(invalid.body.fields) && invalid.body.fields.length === 2,
);
expect(
  "the field name is the derived issue path",
  invalid.body.fields?.[0]?.field === "voucherCode",
);

console.log("--- broken JSON body");
const broken = await redeem("{not json");
expect("a parse failure maps to 422", broken.status === 422);
expect(
  "the parse failure is the invalid_request code",
  broken.body.code === "invalid_request",
);

console.log("--- gateway outage");
const outage = await redeem({ voucherCode: "BIGSPEND", amount: 900 });
expect("the outage maps to 503", outage.status === 503);
expect("the body advises a retry", outage.body.retryable === true);
expect(
  "Retry-After rides as a header",
  outage.headers.get("retry-after") === "15",
);
expect(
  "the card number never crosses",
  JSON.stringify(outage.body).includes("4111") === false,
);
expect(
  "the gateway address never crosses",
  JSON.stringify(outage.body).includes("10.0.0.7") === false,
);

console.log("--- notification fan-out fails, redemption still succeeds");
providersDown = true;
vouchers.set("NOTIFY10", {
  code: "NOTIFY10",
  discountPercent: 10,
  expiresAt: "2026-12-31T00:00:00.000Z",
  redeemed: false,
});
const notified = await redeem({ voucherCode: "NOTIFY10", amount: 50 });
expect("the redemption still succeeds", notified.status === 200);

console.log("--- the dead letter survives the queue boundary");
const [deadLetter] = consumeDeadLetters();
expect(
  "the dead letter is a StructuredError again",
  deadLetter instanceof StructuredError,
);
expect(
  "the aggregate keeps both provider failures",
  Array.isArray((deadLetter as unknown as { errors?: unknown[] }).errors) &&
    (deadLetter as unknown as { errors: unknown[] }).errors.length === 2,
);
expect(
  "hasErrorCode still matches the reconstructed members",
  (deadLetter as unknown as { errors: unknown[] }).errors.every((member) =>
    hasErrorCode("NOTIFICATION_FAILED")(member),
  ),
);

server.close();
if (failures.length > 0) {
  console.error(`\n${failures.length} scenario checks failed`);
  process.exit(1);
}
console.log("\nvoucher service example: all scenario checks passed");
