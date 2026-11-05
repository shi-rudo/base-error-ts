import { describe, expect, it } from "vitest";
import { BaseError } from "../index.js";

describe("the identity of an error of an unusual target", () => {
  class OtherClass extends BaseError<string> {}

  it("names ES5 inheritance without a reset of the constructor after its own function", () => {
    function LegacyError(message: string) {
      return Reflect.construct(BaseError, [message], LegacyError);
    }
    LegacyError.prototype = Object.create(BaseError.prototype);

    const error = LegacyError("m");

    expect(error.name).toBe("LegacyError");
    expect(error._tag).toBe("LegacyError");
  });

  it("names a subclass with an overwritten prototype constructor after the subclass", () => {
    class OverwrittenConstructorError extends BaseError<string> {}
    Object.defineProperty(
      OverwrittenConstructorError.prototype,
      "constructor",
      {
        value: OtherClass,
      },
    );

    const error = new OverwrittenConstructorError("m");

    expect(error.name).toBe("OverwrittenConstructorError");
    expect(error._tag).toBe("OverwrittenConstructorError");
  });

  it("names a proxied subclass after the subclass", () => {
    class SubclassBehindProxy extends BaseError<string> {}
    const ProxiedSubclass = new Proxy(SubclassBehindProxy, {});

    const error = new ProxiedSubclass("m");

    expect(error.name).toBe("SubclassBehindProxy");
  });

  it("names an anonymous class from a mixin BaseError", () => {
    function classFromMixin() {
      return class extends BaseError<string> {};
    }
    const MixedError = classFromMixin();

    const error = new MixedError("m");

    expect(MixedError.name).toBe("");
    expect(error.name).toBe("BaseError");
    expect(error._tag).toBe("BaseError");
    expect(String(error.stack).split("\n")[0]).toBe("BaseError: m");
  });

  it("names a class with a name that is no string BaseError", () => {
    class ClassWithNumericName extends BaseError<string> {}
    Object.defineProperty(ClassWithNumericName, "name", { value: 42 });

    const error = new ClassWithNumericName("m");

    expect(error.name).toBe("BaseError");
  });

  it("names BaseError behind a proxy BaseError", () => {
    const ProxiedBaseError = new Proxy(BaseError, {});

    const error = new ProxiedBaseError("m");

    expect(error.name).toBe("BaseError");
  });

  it("creates an error for a target whose prototype has no constructor", () => {
    function NullPrototypeTarget() {}
    NullPrototypeTarget.prototype = Object.create(null);

    const error = Reflect.construct(
      BaseError,
      ["m"],
      NullPrototypeTarget,
    ) as Error;

    expect(error.message).toBe("m");
    expect(error.name).toBe("NullPrototypeTarget");
    expect(String(error.stack)).toContain("NullPrototypeTarget: m");
  });

  it("keeps the prototype of Error for a target whose prototype is null, as Error does", () => {
    function NullTarget() {}
    NullTarget.prototype = null;

    const error = Reflect.construct(BaseError, ["m"], NullTarget) as Error;

    expect(error.message).toBe("m");
    expect(error).toBeInstanceOf(Error);
  });

  it("creates an error for a target without a prototype, as Error does", () => {
    function BoundTarget() {}
    const boundTarget = BoundTarget.bind(undefined);

    const error = Reflect.construct(BaseError, ["m"], boundTarget) as Error;

    expect(error.message).toBe("m");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("bound BoundTarget");
  });
});
