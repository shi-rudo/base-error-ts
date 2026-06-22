import type { PublicErrorView } from "../src/presentation/index.js";
import { defineProblemDetailsAdapter } from "../src/problem-details/index.js";

const problems = defineProblemDetailsAdapter({
  definitions: {
    ACCOUNT_NOT_FOUND: {
      type: "https://api.example.com/problems/account-not-found",
      status: 404,
    },
  },
  fallback: {
    type: "https://api.example.com/problems/internal-error",
    status: 500,
  },
});

const view: PublicErrorView<{ accountId: string }, "ACCOUNT_NOT_FOUND"> = {
  code: "ACCOUNT_NOT_FOUND",
  message: "Account not found",
  locale: "en",
  details: { accountId: "a-123" },
};

const mapped = problems.map(view, {
  instance: "https://api.example.com/problem-occurrences/p-123",
  extensions: { support_id: "p-123" },
});

if (
  mapped.status !== 404 ||
  mapped.headers["content-type"] !== "application/problem+json" ||
  mapped.body.type !== "https://api.example.com/problems/account-not-found"
) {
  throw new Error("unexpected problem-details mapping");
}

console.log(JSON.stringify(mapped.body, null, 2));
