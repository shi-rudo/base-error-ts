/**
 * The HTTP edge: parse, run the use case, and answer. The error handler is
 * the one place that translates: `matchThrown` classifies the thrown value,
 * the log edge writes one line, and the public-error pipeline builds the
 * response. Nothing else about an error reaches the wire.
 */
import { createServer } from "node:http";
import type { Server } from "node:http";
import {
  ValidationError,
  isRetryable,
  matchThrown,
  someCauseChain,
  toStructuredError,
} from "../../src/index.js";
import { localize, project, toProblem } from "../../src/public-error/index.js";
import { logError } from "./logging.js";
import { notifyRedemption } from "./notifications.js";
import type { NotificationProvider } from "./notifications.js";
import { enqueueDeadLetter } from "./queue.js";
import { redeemVoucher } from "./redemption.js";
import type { PaymentGateway, Voucher } from "./redemption.js";
import { PublicVoucherErrors } from "./public-errors.js";

export type VoucherService = {
  server: Server;
  vouchers: Map<string, Voucher>;
};

function requestedLocales(acceptLanguage: string | undefined): string[] {
  if (acceptLanguage === undefined) return ["en"];
  return acceptLanguage
    .split(",")
    .map((part) => (part.split(";")[0] ?? "").trim());
}

function respondWithError(
  thrown: unknown,
  acceptLanguage: string | undefined,
): { status: number; headers: Record<string, string>; body: string } {
  // Classify the thrown value once, at the edge.
  const error = matchThrown(thrown)
    .with(SyntaxError, (parseError) => {
      const invalid = new ValidationError("request body is not JSON", {
        cause: parseError,
      });
      invalid.addIssue({ message: "the body must be a JSON object" });
      return invalid;
    })
    .otherwise((value) => toStructuredError(value));

  logError("redemption.rejected", error);

  const view = project(PublicVoucherErrors, error);
  const messages = PublicVoucherErrors.messagesFor(view.code);
  const localized = messages
    ? localize(view, messages, { locales: requestedLocales(acceptLanguage) })
    : view;
  const problem = toProblem(PublicVoucherErrors, localized);
  return {
    status: problem.status,
    headers: {
      ...problem.headers,
      "content-type": "application/problem+json",
    },
    body: JSON.stringify(problem.body),
  };
}

export function startVoucherService(
  gateway: PaymentGateway,
  providers: NotificationProvider[],
): Promise<VoucherService> {
  const vouchers = new Map<string, Voucher>();

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      void (async () => {
        try {
          if (request.method !== "POST" || request.url !== "/redeem") {
            response.writeHead(404, { "content-type": "application/json" });
            response.end(JSON.stringify({ error: "not_found" }));
            return;
          }
          const payload: unknown = JSON.parse(
            Buffer.concat(chunks).toString("utf8"),
          );
          const receipt = await redeemVoucher(
            vouchers,
            gateway,
            payload as Record<string, unknown>,
          );

          // Notification failure is a modeled degradation, never a failed
          // redemption: one WARN line, a dead letter, and a retry decision
          // from the cause chain. The receipt still goes out.
          try {
            await notifyRedemption(providers, receipt);
          } catch (fanout) {
            logError("redemption.notification_failed", fanout);
            enqueueDeadLetter(fanout);
            const retry = someCauseChain(fanout, isRetryable, {
              aggregates: true,
            });
            logError(
              retry
                ? "redemption.notification_retry_scheduled"
                : "redemption.notification_dropped",
              fanout,
            );
          }

          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ receipt }));
        } catch (thrown) {
          const { status, headers, body } = respondWithError(
            thrown,
            request.headers["accept-language"],
          );
          response.writeHead(status, headers);
          response.end(body);
        }
      })();
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, vouchers }));
  });
}
