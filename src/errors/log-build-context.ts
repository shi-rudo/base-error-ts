import { MAX_LOG_NODES } from "./walker-bounds.js";

/** One library-owned traversal. Consumer callbacks can start independent builds. */
export type LogBuildContext = {
  readonly budget: { nodes: number; readonly limit: number };
  readonly dataError: (value: unknown) => Record<string, unknown> | undefined;
};

export function createLogBuildContext(
  dataError: LogBuildContext["dataError"],
): LogBuildContext {
  return { budget: { nodes: 0, limit: MAX_LOG_NODES }, dataError };
}
