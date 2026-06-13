import type { LocalizedMessageSet } from "./LocalizedMessageSet.js";

/**
 * The registered, static description of how one class of error renders
 * publicly. `publicCode` is the wire contract, deliberately distinct from a
 * technical `StructuredError.code`. Generic over the error type so that
 * `projectDetails` never receives a raw `unknown`; the narrowing is the
 * registrant's responsibility (a `register` type guard, or a `registerByCode`
 * nominal claim). There is no channel field: a status, header, or exit code is
 * a transport adapter's concern, outside this package.
 */
export type PublicErrorDefinition<TError = unknown, TDetails = never> = {
  /** Stable public code for the wire. */
  publicCode: string;
  /** Client-safe localized messages for this error class. */
  userMessages: LocalizedMessageSet;
  /**
   * Optional, explicit projection of a vetted, typed subset of the error onto
   * the public view's `details`. Never spread the raw error.
   */
  projectDetails?: (error: TError) => TDetails;
};
