import { BaseError } from "../index.js";

type Log = Record<string, unknown>;
type Redactor = Parameters<BaseError<string>["redactWith"]>[0];
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;
type MutableRecordTransform = Assert<Same<Redactor, (log: Log) => Log>>;

class ConsumerError extends BaseError<"ConsumerError"> {
  readonly consumerField = "consumer";
}

const error = new ConsumerError("failed");
const chained: ConsumerError = error.redactWith((log) => {
  delete log.code;
  log.extra = new Map<string, unknown>();
  return { replacement: log, bigint: 1n };
});

// @ts-expect-error the callback must return a record synchronously
error.redactWith(async (log) => log);
// @ts-expect-error the callback cannot return a primitive
error.redactWith(() => "redacted");
// @ts-expect-error the callback cannot return null
error.redactWith(() => null);
// @ts-expect-error the callback cannot return undefined
error.redactWith(() => undefined);
// @ts-expect-error the callback cannot omit its return value
error.redactWith(() => {});
// @ts-expect-error the callback receives unknown field values
error.redactWith((log: { code: string }) => log);

void chained;
const signature: MutableRecordTransform = true;
void signature;
