import { isInstanceOf } from "./guarded-read.js";
import type { ErrorClass } from "./guards.js";

/** A keyed set of local Error constructors. */
export type ErrorClassMap = Readonly<Record<string, ErrorClass>>;

type ErrorClassHandlers<TClasses extends ErrorClassMap> = {
  readonly [K in keyof TClasses]: (error: InstanceType<TClasses[K]>) => unknown;
};

type MatchResult<THandlers> = THandlers[keyof THandlers] extends (
  ...args: never[]
) => infer R
  ? R
  : never;

type ValidClassDefinition<TClasses extends ErrorClassMap> = [
  keyof TClasses,
] extends [never]
  ? never
  : string extends keyof TClasses
    ? never
    : Exclude<keyof TClasses, string> extends never
      ? Extract<keyof TClasses, `${number}`> extends never
        ? TClasses
        : never
      : never;

/** A reusable, exhaustive matcher for a closed set of Error classes. */
export interface ErrorClassSet<TClasses extends ErrorClassMap> {
  /** Match a value using exactly one handler for every declared class key. */
  match<const THandlers extends ErrorClassHandlers<TClasses>>(
    value: unknown,
    handlers: THandlers &
      Record<Exclude<keyof THandlers, keyof TClasses>, never>,
  ): MatchResult<THandlers>;
}

/** Define a reusable, exhaustive set of local Error classes. */
export function defineErrorClassSet<const TClasses extends ErrorClassMap>(
  classes: ValidClassDefinition<TClasses>,
): ErrorClassSet<TClasses> {
  const ownKeys = Reflect.ownKeys(classes);
  if (ownKeys.some((key) => typeof key !== "string")) {
    throw new Error("defineErrorClassSet: keys must be strings");
  }

  const keys = Object.keys(classes) as Array<Extract<keyof TClasses, string>>;
  if (keys.length === 0) {
    throw new Error("defineErrorClassSet: class definition must not be empty");
  }
  if (keys.some((key) => key.trim() === "")) {
    throw new Error(
      "defineErrorClassSet: keys must not be empty or whitespace-only",
    );
  }
  if (keys.some((key) => Number.isFinite(Number(key)))) {
    throw new Error("defineErrorClassSet: keys must not be numeric");
  }

  const snapshot = Object.freeze({ ...classes }) as TClasses;
  const constructors = keys.map((key) => snapshot[key]);
  if (new Set(constructors).size !== constructors.length) {
    throw new Error("defineErrorClassSet: constructors must be unique");
  }

  // match() is first-match-wins in key order, so a base class listed before
  // one of its subclasses would silently make the subclass handler
  // unreachable; surface that as a definition error with the fix in the text.
  for (let earlier = 0; earlier < constructors.length; earlier++) {
    for (let later = earlier + 1; later < constructors.length; later++) {
      const earlierClass = constructors[earlier] as ErrorClass;
      const laterClass = constructors[later] as ErrorClass;
      if (laterClass.prototype instanceof earlierClass) {
        throw new Error(
          `defineErrorClassSet: "${keys[later] as string}" extends "${keys[earlier] as string}" ` +
            "and is listed after it; list subclasses before their base class, " +
            "or the subclass handler is unreachable",
        );
      }
    }
  }

  return Object.freeze({
    match<const THandlers extends ErrorClassHandlers<TClasses>>(
      value: unknown,
      handlers: THandlers &
        Record<Exclude<keyof THandlers, keyof TClasses>, never>,
    ): MatchResult<THandlers> {
      for (const key of keys) {
        const constructor = snapshot[key] as ErrorClass;
        if (isInstanceOf(value, constructor)) {
          const handler = handlers[key] as (
            error: InstanceType<TClasses[typeof key]>,
          ) => MatchResult<THandlers>;
          return handler(value as InstanceType<TClasses[typeof key]>);
        }
      }

      throw new Error("value is outside the declared error class set");
    },
  });
}
