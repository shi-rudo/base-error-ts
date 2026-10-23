import { MAX_LOG_NODES } from "./walker-bounds.js";

/** One library-owned traversal. Consumer callbacks can start independent builds. */
export type LogBuildContext = {
  readonly budget: { nodes: number; readonly limit: number };
  /**
   * The builder of the diagnostic view when `value` is an error that the log
   * projects, or `undefined`. The copier calls the builder only for a value
   * that it keeps, so an error past a depth cap costs no view.
   */
  readonly dataError: (
    value: unknown,
  ) => (() => Record<string, unknown>) | undefined;
};

export function createLogBuildContext(
  dataError: LogBuildContext["dataError"],
): LogBuildContext {
  return { budget: { nodes: 0, limit: MAX_LOG_NODES }, dataError };
}
