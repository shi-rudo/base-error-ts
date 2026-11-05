import { afterEach, describe, expect, it } from "vitest";
import { BaseError as LibraryBaseError, StructuredError } from "../index.js";

function stackLinesOf(error: Error): string[] {
  return String(error.stack).split("\n");
}

class BaseErrorMapper {
  readonly error: StructuredError<string, string>;

  constructor() {
    this.error = new StructuredError({
      code: "MAPPING_FAILED",
      category: "INTERNAL",
      retryable: false,
      message: "no mapping",
    });
  }
}

// A consumer can have its own class with the name of the library class.
class BaseError {
  readonly error: LibraryBaseError<string>;

  constructor() {
    this.error = new LibraryBaseError("no mapping");
  }
}

function callerOfTheConstructor() {
  return new LibraryBaseError("no mapping");
}

describe("the stack of an error on an engine with captureStackTrace", () => {
  it("starts at the frame of a consumer constructor whose name starts with BaseError", () => {
    const [, firstFrame] = stackLinesOf(new BaseErrorMapper().error);

    expect(firstFrame).toContain("new BaseErrorMapper");
  });

  it("starts at the frame of a consumer class that has the name of the library class", () => {
    const [, firstFrame] = stackLinesOf(new BaseError().error);

    expect(firstFrame).toContain("new BaseError");
  });

  it.each([
    "#installLazyStack",
    "installLazyStack_fn",
    "BaseError.constructor",
    "new BaseError",
  ])("starts at the frame of a consumer function named %s", (name) => {
    const consumerFunction = {
      [name]: () => new LibraryBaseError("no mapping"),
    }[name] as () => Error;

    expect(stackLinesOf(consumerFunction())[1]).toContain(name);
  });

  it("keeps the frame of a constructor that converts the message into a nested error", () => {
    let nested: Error | undefined;
    function conversionOfTheMessage() {
      nested = new LibraryBaseError("nested");
      return "converted";
    }

    new LibraryBaseError({
      toString: conversionOfTheMessage,
    } as unknown as string);

    const frames = stackLinesOf(nested as Error).slice(1);

    expect(frames[0]).toContain("conversionOfTheMessage");
    expect(frames.join("\n")).toContain("new BaseError");
  });
});

describe("the stack of an error on an engine without captureStackTrace", () => {
  const captureStackTrace = Object.getOwnPropertyDescriptor(
    Error,
    "captureStackTrace",
  );
  const originalPrepareStackTrace = Error.prepareStackTrace;

  afterEach(() => {
    Error.prepareStackTrace = originalPrepareStackTrace;
  });

  function withoutCaptureStackTrace<T>(create: () => T): T {
    delete (Error as unknown as Record<string, unknown>).captureStackTrace;
    try {
      return create();
    } finally {
      if (captureStackTrace) {
        Object.defineProperty(Error, "captureStackTrace", captureStackTrace);
      }
    }
  }

  const atFormat: typeof Error.prepareStackTrace = (_error, frames) =>
    frames.map((frame) => `    at ${frame.getFunctionName()}`).join("\n");
  const atSignFormat: typeof Error.prepareStackTrace = (_error, frames) =>
    `${frames.map((frame) => `${frame.getFunctionName()}@a.js:1:1`).join("\n")}\n`;

  it("starts at the caller of the constructor in the default format", () => {
    const error = withoutCaptureStackTrace(callerOfTheConstructor);

    const [header, firstFrame] = stackLinesOf(error);

    expect(header).toBe("BaseError: no mapping");
    expect(firstFrame).toContain("callerOfTheConstructor");
  });

  it.each([
    ["the at format", atFormat],
    ["the fn@file format", atSignFormat],
  ])("starts at the caller of the constructor in %s", (_name, format) => {
    Error.prepareStackTrace = format;
    const error = withoutCaptureStackTrace(callerOfTheConstructor);

    const lines = stackLinesOf(error);

    expect(lines[0]).toBe("BaseError: no mapping");
    expect(lines[1]).toContain("callerOfTheConstructor");
  });

  it("drops the empty line at the end of the fn@file format", () => {
    Error.prepareStackTrace = atSignFormat;
    const error = withoutCaptureStackTrace(callerOfTheConstructor);

    expect(stackLinesOf(error)).not.toContain("");
  });

  it("keeps the frame of a consumer constructor whose name starts with BaseError", () => {
    const { error } = withoutCaptureStackTrace(() => new BaseErrorMapper());

    expect(stackLinesOf(error).join("\n")).toContain("new BaseErrorMapper");
  });

  it("starts at the frame of a consumer class that has the name of the library class", () => {
    const { error } = withoutCaptureStackTrace(() => new BaseError());

    expect(stackLinesOf(error)[1]).toContain("new BaseError");
  });
});
