/**
 * Validators that implement Standard Schema v1 (standardschema.dev), the
 * interface that Zod, Valibot and ArkType implement. The suite has no
 * validator dependency, so it builds them from a parse function.
 */

type Result<T> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<{ readonly message: string }> };

export type TestSchema<T> = {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => Result<T> | Promise<Result<T>>;
    readonly types?: { readonly input: unknown; readonly output: T };
  };
};

/** A schema whose output is what `parse` returns; `undefined` is a failure. */
export function schemaFrom<T>(
  parse: (value: unknown) => T | undefined,
): TestSchema<T> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) => {
        const output = parse(value);
        return output === undefined
          ? { issues: [{ message: "invalid details" }] }
          : { value: output };
      },
    },
  };
}

/** A schema that answers with a promise, as an async refinement does. */
export function asyncSchema<T>(): TestSchema<T> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: () => Promise.resolve({ issues: [{ message: "async" }] }),
    },
  };
}

/**
 * The interface of Standard Schema v1 as standardschema.dev publishes it,
 * with its namespace flattened. Zod, Valibot and ArkType implement it.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1Props<Input, Output>;
}

interface StandardSchemaV1Props<Input, Output> {
  readonly version: 1;
  readonly vendor: string;
  readonly validate: (
    value: unknown,
  ) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
  readonly types?: StandardSchemaV1Types<Input, Output> | undefined;
}

type StandardSchemaV1Result<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<StandardSchemaV1Issue> };

interface StandardSchemaV1Issue {
  readonly message: string;
  readonly path?:
    ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
}

interface StandardSchemaV1Types<Input, Output> {
  readonly input: Input;
  readonly output: Output;
}

/** A schema whose validate throws `error`. */
export function throwingSchema<T>(error: Error): TestSchema<T> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: () => {
        throw error;
      },
    },
  };
}
