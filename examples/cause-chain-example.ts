import {
  StructuredError,
  getRootCause,
  getRootCauseRetryable,
  isChainRetryable,
  getFirstRetryableCause,
  findInCauseChain,
} from "../src/index.js";

type AppErrorCode =
  | "VALIDATION_ERROR"
  | "DATABASE_ERROR"
  | "NETWORK_ERROR"
  | "UNKNOWN_ERROR";
type AppErrorCategory = "CLIENT" | "DATABASE" | "NETWORK" | "INTERNAL";

interface AppErrorDetails {
  field?: string;
  value?: unknown;
  query?: string;
  table?: string;
  endpoint?: string;
  statusCode?: number;
  [key: string]: unknown;
}

class AppError extends StructuredError<
  AppErrorCode,
  AppErrorCategory,
  AppErrorDetails
> {
  constructor(options: {
    code: AppErrorCode;
    category: AppErrorCategory;
    retryable: boolean;
    message: string;
    details?: AppErrorDetails;
    cause?: unknown;
  }) {
    super(options);
  }
}

async function fetchUserData(
  userId: string,
): Promise<{ name: string; email: string }> {
  const response = await fetch(`https://api.example.com/users/${userId}`);

  if (!response.ok) {
    throw new AppError({
      code: "NETWORK_ERROR",
      category: "NETWORK",
      retryable: response.status >= 500 || response.status === 429,
      message: `Failed to fetch user: ${response.statusText}`,
      details: { endpoint: `/users/${userId}`, statusCode: response.status },
    });
  }

  return response.json();
}

async function getUserWithProfile(
  userId: string,
): Promise<{ user: { name: string }; profile: { bio: string } }> {
  let user: { name: string; email: string };
  try {
    user = await fetchUserData(userId);
  } catch (error) {
    throw new AppError({
      code: "NETWORK_ERROR",
      category: "NETWORK",
      retryable: true,
      message: "Failed to fetch user data for profile lookup",
      details: { endpoint: `/users/${userId}` },
      cause: error,
    });
  }

  const profileResponse = await fetch(
    `https://api.example.com/users/${userId}/profile`,
  );
  if (!profileResponse.ok) {
    throw new AppError({
      code: "NETWORK_ERROR",
      category: "NETWORK",
      retryable:
        profileResponse.status >= 500 || profileResponse.status === 429,
      message: "Failed to fetch user profile",
      details: {
        endpoint: `/users/${userId}/profile`,
        statusCode: profileResponse.status,
      },
    });
  }

  return { user: { name: user.name }, profile: await profileResponse.json() };
}

async function processUserOperation(userId: string): Promise<void> {
  try {
    await getUserWithProfile(userId);
  } catch (error) {
    console.log("=== Cause Chain Traversal Examples ===\n");

    const rootCause = getRootCause(error);
    console.log("1. Root cause:", rootCause);
    console.log(
      "   Is StructuredError with retryable?",
      rootCause && typeof rootCause === "object" && "retryable" in rootCause,
    );

    const rootIsRetryable = getRootCauseRetryable(error);
    console.log("\n2. Root cause retryable:", rootIsRetryable);

    const chainRetryable = isChainRetryable(error);
    console.log("3. Any error in chain retryable:", chainRetryable);

    const firstRetryable = getFirstRetryableCause(error);
    console.log("4. First retryable error:", firstRetryable);

    const dbError = findInCauseChain(
      error,
      (e): e is AppError & { retryable: true } =>
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        e.code === "DATABASE_ERROR" &&
        "retryable" in e &&
        e.retryable === true,
    );
    console.log("5. Found DATABASE_ERROR:", dbError);

    console.log("\n=== Retry Decision Example ===\n");

    if (rootIsRetryable) {
      console.log("✓ Root cause is retryable - should retry");
    } else if (chainRetryable) {
      console.log("✓ Some error in chain is retryable - should retry");
    } else {
      console.log("✗ No retryable error in chain - should not retry");
    }
  }
}

async function demonstrateRetryPatterns(): Promise<void> {
  console.log("\n=== Retry Pattern: Exponential Backoff ===\n");

  async function withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;

        if (attempt === maxRetries) {
          console.log(
            `Attempt ${attempt + 1}/${maxRetries + 1}: Final attempt failed`,
          );
          break;
        }

        const isRetryable = isChainRetryable(error);
        console.log(
          `Attempt ${attempt + 1}/${maxRetries + 1}: Retryable = ${isRetryable}`,
        );

        if (!isRetryable) {
          console.log("Non-retryable error, giving up");
          throw error;
        }

        const delay = Math.pow(2, attempt) * 100;
        console.log(`Waiting ${delay}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  let callCount = 0;

  try {
    await withRetry(() => {
      callCount++;
      if (callCount < 3) {
        throw new AppError({
          code: "NETWORK_ERROR",
          category: "NETWORK",
          retryable: true,
          message: "Temporary network failure",
          details: { statusCode: 503 },
        });
      }
      return Promise.resolve("success");
    });
    console.log("Operation succeeded after retries!");
  } catch (error) {
    console.log("Operation failed:", error);
  }
}

async function main(): Promise<void> {
  console.log("Cause Chain Traversal Demo\n");

  await processUserOperation("user-123");

  await demonstrateRetryPatterns();
}

main().catch(console.error);
