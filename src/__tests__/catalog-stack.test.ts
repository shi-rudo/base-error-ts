import { describe, expect, it } from "vitest";
import { defineErrors, StructuredError } from "../index.js";
import { constructAtCallerOf } from "../errors/BaseError.js";

const Errors = defineErrors({
  USER_NOT_FOUND: { category: "NOT_FOUND", retryable: false },
  CONVERSION_RAN: { category: "INTERNAL", retryable: false },
});

function callerOfTheFactory(message = "no user") {
  return Errors.create.USER_NOT_FOUND(message);
}

function callerOfTheConstructor() {
  return new StructuredError({
    code: "USER_NOT_FOUND",
    category: "NOT_FOUND",
    retryable: false,
    message: "no user",
  });
}

function stackLinesOf(error: Error): string[] {
  return String(error.stack).split("\n");
}

function withStackTraceLimit<T>(limit: number, run: () => T): T {
  const original = Error.stackTraceLimit;
  Error.stackTraceLimit = limit;
  try {
    return run();
  } finally {
    Error.stackTraceLimit = original;
  }
}

describe("the stack of a catalog error", () => {
  it("starts at the caller of the factory, below the header", () => {
    const [header, firstFrame] = stackLinesOf(callerOfTheFactory());

    expect(header).toBe("USER_NOT_FOUND: no user");
    expect(firstFrame).toContain("callerOfTheFactory");
  });

  it("gives every frame of the limit to the caller, not to the factory", () => {
    const error = withStackTraceLimit(1, () => callerOfTheFactory());

    const frames = stackLinesOf(error).slice(1);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toContain("callerOfTheFactory");
  });

  it("leaves the first frame of a directly constructed error", () => {
    const [, firstFrame] = stackLinesOf(callerOfTheConstructor());

    expect(firstFrame).toContain("callerOfTheConstructor");
  });

  it("keeps its own start when the conversion of its message creates more errors", () => {
    let created: Error[] = [];
    function conversionOfTheMessage() {
      created = [
        new StructuredError({
          code: "CONVERSION_RAN",
          category: "INTERNAL",
          retryable: false,
          message: "from the constructor",
        }),
        Errors.create.CONVERSION_RAN("from the factory"),
      ];
      return "converted";
    }
    function callerWithAnObjectMessage() {
      const message = { toString: conversionOfTheMessage };
      return callerOfTheFactory(message as unknown as string);
    }

    const error = callerWithAnObjectMessage();

    expect(stackLinesOf(error)[1]).toContain("callerOfTheFactory");
    for (const nested of created) {
      expect(stackLinesOf(nested)[1]).toContain("conversionOfTheMessage");
    }
  });

  it("does not format the stack until the first read", () => {
    let formats = 0;
    const original = Error.prepareStackTrace;
    Error.prepareStackTrace = (error, frames) => {
      formats += 1;
      return original
        ? original(error, frames)
        : `${String(error)}\n${frames.map((frame) => `    at ${String(frame)}`).join("\n")}`;
    };
    try {
      const error = callerOfTheFactory();
      const formatsBeforeRead = formats;

      void error.stack;

      expect(formatsBeforeRead).toBe(0);
      expect(formats).toBe(1);
    } finally {
      Error.prepareStackTrace = original;
    }
  });

  it("still holds the caller on an engine without captureStackTrace", () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      Error,
      "captureStackTrace",
    );
    delete (Error as unknown as Record<string, unknown>).captureStackTrace;
    let error: Error;
    try {
      error = callerOfTheFactory();
    } finally {
      if (descriptor) {
        Object.defineProperty(Error, "captureStackTrace", descriptor);
      }
    }

    const lines = stackLinesOf(error);

    expect(lines[0]).toBe("USER_NOT_FOUND: no user");
    expect(lines.join("\n")).toContain("callerOfTheFactory");
  });
});

describe("constructAtCallerOf", () => {
  it("does not touch the stack of a later error when the constructor stops before it reads the start", () => {
    class StopsBeforeSuper extends StructuredError<string, string> {
      constructor(fields: {
        code: string;
        category: string;
        retryable: boolean;
        message: string;
      }) {
        if (fields.code === "STOP") throw new RangeError("stopped");
        super(fields);
      }
    }
    function factoryThatStops() {
      return constructAtCallerOf(factoryThatStops, StopsBeforeSuper, {
        code: "STOP",
        category: "INTERNAL",
        retryable: false,
        message: "stopped",
      });
    }

    expect(factoryThatStops).toThrow(RangeError);

    expect(stackLinesOf(callerOfTheConstructor())[1]).toContain(
      "callerOfTheConstructor",
    );
  });
});

describe("a stack without a header", () => {
  const atFormat: typeof Error.prepareStackTrace = (_error, frames) =>
    frames.map((frame) => `    at ${frame.getFunctionName()}`).join("\n");
  const atSignFormat: typeof Error.prepareStackTrace = (_error, frames) =>
    frames.map((frame) => `${frame.getFunctionName()}@a.js:1:1`).join("\n");

  function stackLinesWith(
    format: typeof Error.prepareStackTrace,
    create: () => Error,
  ): string[] {
    const original = Error.prepareStackTrace;
    Error.prepareStackTrace = format;
    try {
      return stackLinesOf(create());
    } finally {
      Error.prepareStackTrace = original;
    }
  }

  it.each([
    ["the at format", atFormat],
    ["the fn@file format", atSignFormat],
  ])("keeps the caller of a catalog error in %s", (_name, format) => {
    const lines = stackLinesWith(format, () => callerOfTheFactory());

    expect(lines[0]).toBe("USER_NOT_FOUND: no user");
    expect(lines[1]).toContain("callerOfTheFactory");
  });

  it.each([
    ["the at format", atFormat],
    ["the fn@file format", atSignFormat],
  ])(
    "keeps the caller of a directly constructed error in %s",
    (_name, format) => {
      const lines = stackLinesWith(format, () => callerOfTheConstructor());

      expect(lines[0]).toBe("USER_NOT_FOUND: no user");
      expect(lines[1]).toContain("callerOfTheConstructor");
    },
  );
});
