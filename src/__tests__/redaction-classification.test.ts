import { describe, expect, it } from "vitest";
import { BaseError } from "../index.js";

type Mode = "allow" | "deny";
type Counts = { prototypes: number; ownKeys: number };

function observedRecord(
  customPrototype: boolean,
  fields: Record<string, unknown>,
) {
  const target = Object.assign(
    Object.create(customPrototype ? { kind: "foreign" } : Object.prototype),
    fields,
  ) as Record<string, unknown>;
  const counts: Counts = { prototypes: 0, ownKeys: 0 };
  const value = new Proxy(target, {
    getPrototypeOf(inner) {
      counts.prototypes++;
      return Reflect.getPrototypeOf(inner);
    },
    ownKeys(inner) {
      counts.ownKeys++;
      return Reflect.ownKeys(inner);
    },
  });
  return { value, target, counts };
}

function withDetails(details: unknown) {
  class WithDetails extends BaseError<"WithDetails"> {
    readonly details = details;
  }
  return new WithDetails("original");
}

describe.each<Mode>(["allow", "deny"])(
  "%s redaction classifies each object occurrence once",
  (mode) => {
    describe.each([false, true])("custom prototype: %s", (customPrototype) => {
      it.each(["root", "field", "array"])(
        "bounds reflection for a container at the %s position",
        (position) => {
          const observed = observedRecord(customPrototype, {
            keep: "public",
            secret: "private",
          });
          const details =
            position === "root"
              ? observed.value
              : position === "field"
                ? { child: observed.value }
                : { items: [observed.value] };
          const error = withDetails(details);
          if (mode === "allow") error.redactAllow(["keep"]);
          else error.redact(["secret"]);

          const log = error.toLogObject();
          // Assertion diagnostics can inspect proxies, so snapshot first.
          const counts = { ...observed.counts };

          const expected = { keep: "public", secret: "[REDACTED]" };
          expect(log.details).toEqual(
            position === "root"
              ? expected
              : position === "field"
                ? { child: expected }
                : { items: [expected] },
          );
          expect(counts).toEqual({
            prototypes: 1,
            // A nonplain record needs one enumeration to establish that it
            // contains enumerable data and one to traverse that data.
            ownKeys: customPrototype ? 2 : 1,
          });
        },
      );
    });

    it.each(["field", "array"])(
      "classifies an empty custom-prototype leaf once in a %s",
      (position) => {
        const observed = observedRecord(true, {});
        const error = withDetails(
          position === "field"
            ? { leaf: observed.value }
            : { items: [observed.value] },
        );
        if (mode === "allow") error.redactAllow(["leaf", "items"]);
        else error.redact(["secret"]);

        const log = error.toLogObject();
        const counts = { ...observed.counts };

        const details = log.details as Record<string, unknown>;
        const leaf =
          position === "field" ? details.leaf : (details.items as unknown[])[0];
        expect(leaf === observed.value).toBe(true);
        expect(counts).toEqual({ prototypes: 1, ownKeys: 1 });
      },
    );

    it("reclassifies a shared leaf when a mask adds enumerable fields before its next occurrence", () => {
      const observed = observedRecord(true, {});
      const error = withDetails({
        first: observed.value,
        trigger: "mutate",
        second: observed.value,
      });
      const maskedKeys: string[] = [];
      const mask = (_value: unknown, key: string) => {
        maskedKeys.push(key);
        if (key === "trigger") {
          observed.target.keep = "public";
          observed.target.secret = "private";
        }
        return "[REDACTED]";
      };
      if (mode === "allow") error.redactAllow(["first", "keep"], { mask });
      else error.redact(["trigger", "secret"], { mask });

      const log = error.toLogObject();

      const details = log.details as Record<string, unknown>;
      expect(details.first === observed.value).toBe(true);
      expect(details.trigger).toBe("[REDACTED]");
      expect(details.second).toEqual({ keep: "public", secret: "[REDACTED]" });
      expect(details.second === observed.value).toBe(false);
      expect(maskedKeys).toEqual(["trigger", "secret"]);
    });
  },
);

describe("denied values do not need classification", () => {
  it.each(["details", "secret"])(
    "masks a hostile value under %s without reflection",
    (key) => {
      const counts: Counts = { prototypes: 0, ownKeys: 0 };
      const hostile = new Proxy(
        {},
        {
          getPrototypeOf() {
            counts.prototypes++;
            throw new Error("prototype unavailable");
          },
          ownKeys() {
            counts.ownKeys++;
            throw new Error("keys unavailable");
          },
        },
      );
      let receivedRawValue = false;
      const error = withDetails(
        key === "details" ? hostile : { secret: hostile },
      ).redact([key], {
        mask(value) {
          receivedRawValue = value === hostile;
          return "[REDACTED]";
        },
      });

      const log = error.toLogObject();
      const observedCounts = { ...counts };

      expect(log.message).toBe("original");
      expect(log.details).toEqual(
        key === "details" ? "[REDACTED]" : { secret: "[REDACTED]" },
      );
      expect(receivedRawValue).toBe(true);
      expect(observedCounts).toEqual({ prototypes: 0, ownKeys: 0 });
    },
  );
});
