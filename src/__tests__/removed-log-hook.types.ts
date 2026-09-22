import { BaseError, StructuredError, type OwnLogFields } from "../index.js";

class BaseConsumer extends BaseError<"BaseConsumer"> {
  // @ts-expect-error the library no longer declares a whole-envelope hook
  protected override buildLogObject(): Record<string, unknown> {
    // @ts-expect-error consumers cannot call the removed superclass hook
    return super.buildLogObject();
  }

  protected override buildOwnLogFields(): OwnLogFields {
    return { requestId: "req-123" };
  }
}

class StructuredConsumer extends StructuredError<"FAILED", "INTERNAL"> {
  // @ts-expect-error StructuredError has no whole-envelope override contract
  protected override buildLogObject(): Record<string, unknown> {
    // @ts-expect-error StructuredError cannot supply the removed superclass hook
    return super.buildLogObject();
  }

  protected override buildOwnLogFields(): OwnLogFields {
    return { requestId: "req-123" };
  }
}

void BaseConsumer;
void StructuredConsumer;
