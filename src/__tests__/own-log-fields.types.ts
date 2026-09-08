import { BaseError, StructuredError, type OwnLogFields } from "../index.js";

class RequestError extends StructuredError<"REQUEST_FAILED", "INTERNAL"> {
  constructor() {
    super({
      code: "REQUEST_FAILED",
      category: "INTERNAL",
      retryable: false,
      message: "request failed",
    });
  }

  protected override buildOwnLogFields(): OwnLogFields {
    return {
      requestId: "req-1",
      attempt: 2,
      cached: false,
      optional: null,
      context: { region: "eu", versions: [1, 2] as const },
    };
  }
}

class LegacyFieldsError extends BaseError<"LegacyFieldsError"> {
  protected override buildOwnLogFields(): Record<string, unknown> {
    return { recordedAt: new Date(0) };
  }
}

const readonlyFields = { tags: ["retry", "network"] } as const;
const fields: OwnLogFields = readonlyFields;
const checkedFields = { requestId: "req-1" } satisfies OwnLogFields;

// @ts-expect-error own log fields contain data, not callbacks
const callback: OwnLogFields = { value: () => "secret" };
// @ts-expect-error a nested toJSON callback is not data
const customJson: OwnLogFields = { value: { toJSON: () => "secret" } };
// @ts-expect-error convert dates explicitly before returning own log fields
const date: OwnLogFields = { value: new Date(0) };
// @ts-expect-error convert maps explicitly before returning own log fields
const map: OwnLogFields = { value: new Map<string, string>() };
// @ts-expect-error convert sets explicitly before returning own log fields
const set: OwnLogFields = { value: new Set<string>() };
// @ts-expect-error convert bigints explicitly before returning own log fields
const bigint: OwnLogFields = { value: 1n };
// @ts-expect-error omit absent fields or use null
const absent: OwnLogFields = { value: undefined };
// @ts-expect-error symbols are not data
const symbol: OwnLogFields = { value: Symbol("value") };
// @ts-expect-error describe nested errors through the cause chain
const error: OwnLogFields = { value: new Error("nested") };
// @ts-expect-error own fields must be a record
const array: OwnLogFields = ["value"];
// @ts-expect-error the recommended contract is read-only
fields.extra = "value";

void RequestError;
void LegacyFieldsError;
void checkedFields;
void callback;
void customJson;
void date;
void map;
void set;
void bigint;
void absent;
void symbol;
void error;
void array;
